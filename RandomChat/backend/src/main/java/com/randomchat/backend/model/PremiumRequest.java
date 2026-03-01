package com.randomchat.backend.model;

import jakarta.persistence.*;
import lombok.*;
import com.fasterxml.jackson.annotation.JsonFormat;
import java.time.LocalDateTime;

@Entity
@Table(name = "premium_requests")
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class PremiumRequest {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 128, nullable = false)
    private String userId;

    @Column(length = 128)
    private String nickname;

    /** UPI transaction / UTR reference number submitted by user */
    @Column(length = 64, nullable = false)
    private String transactionId;

    public enum Status {
        PENDING, APPROVED, REJECTED
    }

    @Enumerated(EnumType.STRING)
    @Builder.Default
    private Status status = Status.PENDING;

    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss")
    private LocalDateTime requestedAt;

    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss")
    private LocalDateTime resolvedAt;

    @PrePersist
    public void prePersist() {
        if (requestedAt == null)
            requestedAt = LocalDateTime.now();
    }
}
