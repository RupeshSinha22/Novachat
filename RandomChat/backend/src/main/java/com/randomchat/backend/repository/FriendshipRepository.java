package com.randomchat.backend.repository;

import com.randomchat.backend.model.Friendship;
import com.randomchat.backend.model.FriendshipStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface FriendshipRepository extends JpaRepository<Friendship, Long> {

    // Find all accepted friendships where user is either sender or receiver
    @Query("SELECT f FROM Friendship f WHERE (f.senderId = :userId OR f.receiverId = :userId) AND f.status = :status")
    List<Friendship> findByUserIdAndStatus(@Param("userId") String userId, @Param("status") FriendshipStatus status);

    // Find all pending requests directed AT this user (incoming)
    List<Friendship> findByReceiverIdAndStatus(String receiverId, FriendshipStatus status);

    // Find all pending requests sent BY this user (outgoing)
    List<Friendship> findBySenderIdAndStatus(String senderId, FriendshipStatus status);

    // Find an existing record between two users (either direction)
    @Query("SELECT f FROM Friendship f WHERE " +
            "(f.senderId = :a AND f.receiverId = :b) OR " +
            "(f.senderId = :b AND f.receiverId = :a)")
    Optional<Friendship> findBetween(@Param("a") String a, @Param("b") String b);
}
