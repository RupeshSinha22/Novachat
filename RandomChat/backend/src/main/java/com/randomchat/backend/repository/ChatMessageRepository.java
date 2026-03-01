package com.randomchat.backend.repository;

import com.randomchat.backend.model.ChatMessage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ChatMessageRepository extends JpaRepository<ChatMessage, Long> {
    List<ChatMessage> findByRoomNameOrderByTimestampAsc(String roomName);

    // Get all distinct room names
    @Query("SELECT DISTINCT cm.roomName FROM ChatMessage cm WHERE cm.roomName IS NOT NULL ORDER BY cm.roomName DESC")
    List<String> findDistinctRoomNames();

    // Count messages per room
    long countByRoomName(String roomName);

    // Delete all messages in a room
    void deleteByRoomName(String roomName);

    // Get messages by sender
    List<ChatMessage> findBySenderIdOrderByTimestampDesc(String senderId);

    // Count messages in a room after a timestamp (for unread DM counts)
    long countByRoomNameAndTimestampAfter(String roomName, java.time.LocalDateTime after);

    // Get the last message in a room
    ChatMessage findTop1ByRoomNameOrderByTimestampDesc(String roomName);
}
