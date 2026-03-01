package com.randomchat.backend.model;

import jakarta.persistence.*;
import lombok.*;
import com.fasterxml.jackson.annotation.JsonFormat;
import java.time.LocalDateTime;

/**
 * Tracks Razorpay payment orders for premium upgrades.
 * Stores the Razorpay order_id and payment_id for reconciliation.
 */
@Entity
@Table(name = "payment_orders")
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class PaymentOrder {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 128, nullable = false)
    private String userId;

    @Column(length = 128)
    private String nickname;

    /** Razorpay order_id (starts with order_...) */
    @Column(length = 64, nullable = false, unique = true)
    private String razorpayOrderId;

    /** Razorpay payment_id (starts with pay_...) — set after successful payment */
    @Column(length = 64)
    private String razorpayPaymentId;

    /** Razorpay signature — for verification */
    @Column(length = 256)
    private String razorpaySignature;

    /** Amount in paise */
    private int amount;

    @Column(length = 10)
    private String currency;

    public enum Status {
        CREATED, PAID, FAILED
    }

    @Enumerated(EnumType.STRING)
    @Builder.Default
    private Status status = Status.CREATED;

    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss")
    private LocalDateTime createdAt;

    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss")
    private LocalDateTime paidAt;

    @PrePersist
    public void prePersist() {
        if (createdAt == null)
            createdAt = LocalDateTime.now();
    }
}
