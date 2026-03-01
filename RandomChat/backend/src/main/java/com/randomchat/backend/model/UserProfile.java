package com.randomchat.backend.model;

import jakarta.persistence.*;
import lombok.*;
import com.fasterxml.jackson.annotation.JsonFormat;
import java.time.LocalDateTime;

@Entity
@Table(name = "user_profiles")
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class UserProfile {
    @Id
    @Column(length = 128)
    private String userId; // Firebase UID or anon ID

    private String nickname;

    @Column(length = 512)
    private String avatarUrl;

    private String country;
    private String language;

    @Column(columnDefinition = "TEXT")
    private String interests; // Comma-separated

    private String gender; // MALE, FEMALE, OTHER

    private boolean ageVerified;
    private boolean termsAccepted;

    private int reputationScore;
    private boolean isBanned;

    @Column(name = "public_profile", columnDefinition = "boolean default true")
    @Builder.Default
    private boolean publicProfile = true;

    @Column(columnDefinition = "boolean default false")
    @Builder.Default
    private boolean premium = false;

    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss")
    private LocalDateTime premiumSince;

    @Column(length = 45)
    private String lastIp;

    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss")
    private LocalDateTime createdAt;
    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss")
    private LocalDateTime lastSeen;

    @PrePersist
    public void prePersist() {
        if (createdAt == null)
            createdAt = LocalDateTime.now();
        if (reputationScore == 0)
            reputationScore = 100;
    }
}
