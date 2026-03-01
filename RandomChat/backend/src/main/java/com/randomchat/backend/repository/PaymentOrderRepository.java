package com.randomchat.backend.repository;

import com.randomchat.backend.model.PaymentOrder;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface PaymentOrderRepository extends JpaRepository<PaymentOrder, Long> {

    Optional<PaymentOrder> findByRazorpayOrderId(String razorpayOrderId);

    Optional<PaymentOrder> findByRazorpayPaymentId(String razorpayPaymentId);

    List<PaymentOrder> findByUserIdOrderByCreatedAtDesc(String userId);

    List<PaymentOrder> findByStatusOrderByCreatedAtDesc(PaymentOrder.Status status);

    boolean existsByUserIdAndStatus(String userId, PaymentOrder.Status status);
}
