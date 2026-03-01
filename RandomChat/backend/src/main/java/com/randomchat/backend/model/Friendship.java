package com.randomchat.backend.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "friendships")
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class Friendship {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 128, nullable = false)
    private String senderId; // who sent the request

    @Column(length = 128, nullable = false)
    private String receiverId; // who received the request

    // display names snapshot (so friends panel doesn't need extra lookups)
    private String senderNickname;
    private String receiverNickname;

    @Enumerated(EnumType.STRING)
    @Builder.Default
    private FriendshipStatus status = FriendshipStatus.PENDING;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    // Track when each user last read their DM conversation (for unread badges)
    private LocalDateTime senderLastReadAt;
    private LocalDateTime receiverLastReadAt;

    /** Deterministic DM room name: dm_{sortedId1}_{sortedId2} */
    public String getDmRoomName() {
        String a = senderId.compareTo(receiverId) < 0 ? senderId : receiverId;
        String b = senderId.compareTo(receiverId) < 0 ? receiverId : senderId;
        return "dm_" + a + "_" + b;
    }

    @PrePersist
    public void prePersist() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    public void preUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
