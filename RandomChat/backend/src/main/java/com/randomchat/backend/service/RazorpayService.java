package com.randomchat.backend.service;

import com.randomchat.backend.model.PaymentOrder;
import com.randomchat.backend.repository.PaymentOrderRepository;
import com.razorpay.Order;
import com.razorpay.RazorpayClient;
import com.razorpay.RazorpayException;
import com.razorpay.Utils;
import lombok.extern.slf4j.Slf4j;
import org.json.JSONObject;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.time.LocalDateTime;
import java.util.Map;

/**
 * Handles Razorpay order creation and payment verification.
 * The key_secret never leaves the server — your identity is fully protected.
 */
@Service
@Slf4j
public class RazorpayService {

    @Value("${razorpay.key_id}")
    private String keyId;

    @Value("${razorpay.key_secret}")
    private String keySecret;

    @Value("${razorpay.premium_amount}")
    private int premiumAmount;

    @Value("${razorpay.currency}")
    private String currency;

    private final PaymentOrderRepository paymentOrderRepository;
    private final UserService userService;

    private RazorpayClient razorpayClient;

    public RazorpayService(PaymentOrderRepository paymentOrderRepository, UserService userService) {
        this.paymentOrderRepository = paymentOrderRepository;
        this.userService = userService;
    }

    @PostConstruct
    public void init() {
        try {
            this.razorpayClient = new RazorpayClient(keyId, keySecret);
            log.info("✅ Razorpay client initialized (key: {}...)", keyId.substring(0, Math.min(12, keyId.length())));
        } catch (RazorpayException e) {
            log.error("❌ Failed to initialize Razorpay client: {}", e.getMessage());
        }
    }

    /**
     * Creates a Razorpay order and persists the record.
     *
     * @return Map with orderId, amount, currency, keyId for frontend checkout
     */
    public Map<String, Object> createOrder(String userId, String nickname) throws Exception {
        if (razorpayClient == null) {
            throw new RuntimeException("Payment system is not configured. Contact support.");
        }

        // Prevent duplicate active orders (optional guard)
        var existing = paymentOrderRepository.findByUserIdOrderByCreatedAtDesc(userId);
        for (PaymentOrder po : existing) {
            if (po.getStatus() == PaymentOrder.Status.PAID) {
                throw new RuntimeException("You already have an active premium subscription.");
            }
        }

        JSONObject orderReq = new JSONObject();
        orderReq.put("amount", premiumAmount);
        orderReq.put("currency", currency);
        orderReq.put("receipt",
                "nova_" + userId.substring(0, Math.min(20, userId.length())) + "_" + System.currentTimeMillis());
        orderReq.put("payment_capture", 1); // auto-capture

        // Notes — helps with dashboard identification, never shown to the user
        JSONObject notes = new JSONObject();
        notes.put("userId", userId);
        notes.put("purpose", "Nova Plus Premium");
        orderReq.put("notes", notes);

        Order razorpayOrder = razorpayClient.orders.create(orderReq);
        String orderId = razorpayOrder.get("id");

        // Persist
        PaymentOrder po = PaymentOrder.builder()
                .userId(userId)
                .nickname(nickname)
                .razorpayOrderId(orderId)
                .amount(premiumAmount)
                .currency(currency)
                .status(PaymentOrder.Status.CREATED)
                .build();
        paymentOrderRepository.save(po);

        log.info("📦 Created Razorpay order {} for user {}", orderId, userId);

        return Map.of(
                "orderId", orderId,
                "amount", premiumAmount,
                "currency", currency,
                "keyId", keyId);
    }

    /**
     * Verifies the payment signature from Razorpay Checkout.
     * If valid, marks the order as PAID and grants premium.
     */
    public boolean verifyAndCompletePayment(String razorpayOrderId, String razorpayPaymentId,
            String razorpaySignature) {
        try {
            // Cryptographic signature verification
            JSONObject options = new JSONObject();
            options.put("razorpay_order_id", razorpayOrderId);
            options.put("razorpay_payment_id", razorpayPaymentId);
            options.put("razorpay_signature", razorpaySignature);

            boolean isValid = Utils.verifyPaymentSignature(options, keySecret);

            if (!isValid) {
                log.warn("⚠️ Invalid payment signature for order {}", razorpayOrderId);
                return false;
            }

            // Update order record
            PaymentOrder po = paymentOrderRepository.findByRazorpayOrderId(razorpayOrderId).orElse(null);
            if (po == null) {
                log.warn("⚠️ Order not found in DB: {}", razorpayOrderId);
                return false;
            }

            if (po.getStatus() == PaymentOrder.Status.PAID) {
                log.info("ℹ️ Order {} already marked as PAID", razorpayOrderId);
                return true; // idempotent
            }

            po.setRazorpayPaymentId(razorpayPaymentId);
            po.setRazorpaySignature(razorpaySignature);
            po.setStatus(PaymentOrder.Status.PAID);
            po.setPaidAt(LocalDateTime.now());
            paymentOrderRepository.save(po);

            // Grant premium
            userService.grantPremium(po.getUserId());

            log.info("✅ Payment verified & premium granted for user {} (order {})", po.getUserId(), razorpayOrderId);
            return true;

        } catch (Exception e) {
            log.error("❌ Payment verification error: {}", e.getMessage(), e);
            return false;
        }
    }

    /**
     * Processes a Razorpay webhook event (payment.captured).
     * This acts as a fallback — if the frontend verification fails,
     * the webhook will still grant premium.
     */
    public void handleWebhookEvent(String eventType, JSONObject payload) {
        if (!"payment.captured".equals(eventType))
            return;

        try {
            JSONObject paymentEntity = payload.getJSONObject("payment").getJSONObject("entity");
            String orderId = paymentEntity.getString("order_id");
            String paymentId = paymentEntity.getString("id");

            PaymentOrder po = paymentOrderRepository.findByRazorpayOrderId(orderId).orElse(null);
            if (po == null) {
                log.warn("⚠️ Webhook: order {} not found", orderId);
                return;
            }

            if (po.getStatus() == PaymentOrder.Status.PAID) {
                log.info("ℹ️ Webhook: order {} already PAID", orderId);
                return;
            }

            po.setRazorpayPaymentId(paymentId);
            po.setStatus(PaymentOrder.Status.PAID);
            po.setPaidAt(LocalDateTime.now());
            paymentOrderRepository.save(po);

            userService.grantPremium(po.getUserId());
            log.info("✅ Webhook: premium granted for user {} (order {})", po.getUserId(), orderId);

        } catch (Exception e) {
            log.error("❌ Webhook processing error: {}", e.getMessage(), e);
        }
    }

    public String getKeyId() {
        return keyId;
    }
}
