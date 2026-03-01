package com.randomchat.backend.controller;

import com.randomchat.backend.model.ChatMessage;
import com.randomchat.backend.service.MatchmakingService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.stereotype.Controller;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.util.Map;

@Controller
@RequiredArgsConstructor
@Slf4j
public class ChatController {

    private final MatchmakingService matchmakingService;

    @MessageMapping("/chat.join")
    public void joinLobby(@Payload Map<String, Object> payload, SimpMessageHeaderAccessor headerAccessor) {
        String userId = (String) payload.get("senderId");
        String nickname = (String) payload.get("senderNickname");
        String interests = (String) payload.getOrDefault("interests", "");
        String genderFilter = (String) payload.getOrDefault("genderFilter", "ANY");
        String gender = (String) payload.getOrDefault("gender", "");
        boolean isPremium = Boolean.TRUE.equals(payload.get("isPremium"));
        String sessionId = headerAccessor.getSessionId();

        Map<String, Object> attrs = headerAccessor.getSessionAttributes();
        if (attrs != null) {
            attrs.put("userId", userId);
            attrs.put("sessionId", sessionId);
        }
        matchmakingService.joinLobby(userId, sessionId, nickname, interests, genderFilter, gender, isPremium);
    }

    @MessageMapping("/chat.leave")
    public void leaveLobby(@Payload Map<String, Object> payload, SimpMessageHeaderAccessor headerAccessor) {
        String userId = (String) payload.get("senderId");
        String sessionId = headerAccessor.getSessionId();
        log.info("👋 chat.leave from {} (session: {})", userId, sessionId);
        // Explicit leave — disconnect immediately, no grace period
        matchmakingService.disconnectImmediate(userId, sessionId);
    }

    @MessageMapping("/chat.send")
    public void sendMessage(@Payload ChatMessage message) {
        try {
            String userId = message.getSenderId();
            String room = matchmakingService.getRoom(userId);
            log.info("📨 chat.send from {} | type={} | room={} | content-len={}",
                    userId, message.getType(), room,
                    message.getContent() != null ? message.getContent().length() : 0);
            if (room != null) {
                matchmakingService.sendMessageToRoom(room, message, userId);
            } else {
                log.warn("⚠️ No room found for user {}", userId);
            }
        } catch (Exception e) {
            log.error("❌ Error in chat.send: {}", e.getMessage(), e);
        }
    }

    @MessageMapping("/chat.dm")
    public void startDm(@Payload ChatMessage message, SimpMessageHeaderAccessor headerAccessor) {
        String userId = message.getSenderId();
        String sessionId = headerAccessor.getSessionId();
        String nickname = message.getSenderNickname();
        String targetUserId = message.getContent(); // target friend's userId is passed in content

        Map<String, Object> attrs = headerAccessor.getSessionAttributes();
        if (attrs != null) {
            attrs.put("userId", userId);
            attrs.put("sessionId", sessionId);
        }
        matchmakingService.createDmRoom(userId, sessionId, nickname, targetUserId);
    }

    @MessageMapping("/chat.rejoin")
    public void rejoinRoom(@Payload Map<String, Object> payload, SimpMessageHeaderAccessor headerAccessor) {
        String userId = (String) payload.get("senderId");
        String roomName = (String) payload.get("roomName");
        String nickname = (String) payload.get("senderNickname");
        String sessionId = headerAccessor.getSessionId();

        Map<String, Object> attrs = headerAccessor.getSessionAttributes();
        if (attrs != null) {
            attrs.put("userId", userId);
            attrs.put("sessionId", sessionId);
        }

        log.info("🔄 Rejoin request from {} for room {}", userId, roomName);
        matchmakingService.rejoinRoom(userId, sessionId, nickname, roomName);
    }

    @EventListener
    public void handleWebSocketDisconnect(SessionDisconnectEvent event) {
        SimpMessageHeaderAccessor headerAccessor = SimpMessageHeaderAccessor.wrap(event.getMessage());
        Map<String, Object> attrs = headerAccessor.getSessionAttributes();
        if (attrs != null) {
            String userId = (String) attrs.get("userId");
            String sessionId = (String) attrs.get("sessionId");
            if (userId != null) {
                matchmakingService.disconnect(userId, sessionId);
            }
        }
    }
}
