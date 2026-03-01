package com.randomchat.backend.controller;

import com.randomchat.backend.service.RazorpayService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.json.JSONObject;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Payment endpoints for Razorpay integration.
 * No admin identity is ever revealed to the user.
 */
@RestController
@RequestMapping("/api/payment")
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
@Slf4j
public class PaymentController {

    private final RazorpayService razorpayService;

    /**
     * Step 1: Create a Razorpay order.
     * Frontend calls this to get an order_id + key_id for Checkout.
     */
    @PostMapping("/create-order")
    public ResponseEntity<?> createOrder(@RequestBody Map<String, String> body) {
        try {
            String userId = body.get("userId");
            String nickname = body.get("nickname");

            if (userId == null || userId.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Missing userId"));
            }

            Map<String, Object> order = razorpayService.createOrder(userId, nickname);
            return ResponseEntity.ok(order);

        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Order creation failed", e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", "Payment system temporarily unavailable. Please try again."));
        }
    }

    /**
     * Step 2: Verify payment after Razorpay Checkout completes.
     * The frontend sends razorpay_order_id, razorpay_payment_id,
     * razorpay_signature.
     * Server verifies the signature cryptographically — impossible to fake.
     */
    @PostMapping("/verify")
    public ResponseEntity<?> verifyPayment(@RequestBody Map<String, String> body) {
        try {
            String orderId = body.get("razorpay_order_id");
            String paymentId = body.get("razorpay_payment_id");
            String signature = body.get("razorpay_signature");

            if (orderId == null || paymentId == null || signature == null) {
                return ResponseEntity.badRequest().body(Map.of("error", "Missing payment details"));
            }

            boolean verified = razorpayService.verifyAndCompletePayment(orderId, paymentId, signature);

            if (verified) {
                return ResponseEntity.ok(Map.of(
                        "status", "success",
                        "message", "Payment verified! Premium is now active."));
            } else {
                return ResponseEntity.badRequest().body(Map.of(
                        "status", "failed",
                        "error",
                        "Payment verification failed. If money was deducted, it will be refunded automatically."));
            }
        } catch (Exception e) {
            log.error("Payment verification error", e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", "Verification error. Contact support."));
        }
    }

    /**
     * Razorpay Webhook endpoint.
     * Configure in Razorpay Dashboard → Settings → Webhooks → URL:
     * https://yourdomain.com/api/payment/webhook
     * This acts as a fallback — even if the user closes the browser mid-payment,
     * the webhook guarantees premium is granted.
     */
    @PostMapping("/webhook")
    public ResponseEntity<?> handleWebhook(@RequestBody String payload) {
        try {
            JSONObject json = new JSONObject(payload);
            String event = json.getString("event");
            JSONObject data = json.getJSONObject("payload");

            log.info("📬 Razorpay webhook received: {}", event);

            razorpayService.handleWebhookEvent(event, data);

            // Always return 200 to Razorpay so it doesn't retry
            return ResponseEntity.ok(Map.of("status", "ok"));
        } catch (Exception e) {
            log.error("Webhook error", e);
            return ResponseEntity.ok(Map.of("status", "ok")); // still 200 to prevent retries
        }
    }
}
