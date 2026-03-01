package com.randomchat.backend.controller;

import com.randomchat.backend.model.ChatMessage;
import com.randomchat.backend.model.MessageType;
import com.randomchat.backend.model.Friendship;
import com.randomchat.backend.model.FriendshipStatus;
import com.randomchat.backend.model.PremiumRequest;
import com.randomchat.backend.model.Report;
import com.randomchat.backend.model.UserProfile;
import com.randomchat.backend.repository.ChatMessageRepository;
import com.randomchat.backend.repository.PremiumRequestRepository;
import com.randomchat.backend.service.FriendshipService;
import com.randomchat.backend.service.MatchmakingService;
import com.randomchat.backend.service.UserService;
import com.cloudinary.Cloudinary;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;
import org.springframework.transaction.annotation.Transactional;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
public class ApiController {

    private final UserService userService;
    private final MatchmakingService matchmakingService;
    private final FriendshipService friendshipService;
    private final ChatMessageRepository chatMessageRepository;
    private final PremiumRequestRepository premiumRequestRepository;

    @Autowired(required = false)
    private Cloudinary cloudinary;

    // ──────────────────────────────────────────
    // User profiles
    // ──────────────────────────────────────────

    @GetMapping("/profile/{userId}")
    public ResponseEntity<UserProfile> getProfile(@PathVariable("userId") String userId) {
        UserProfile p = userService.getOrCreateProfile(userId, null);
        return ResponseEntity.ok(p);
    }

    @PostMapping("/profile/{userId}")
    public ResponseEntity<UserProfile> updateProfile(
            @PathVariable("userId") String userId,
            @RequestParam(value = "nickname", required = false) String nickname,
            @RequestParam(value = "country", required = false) String country,
            @RequestParam(value = "language", required = false) String language,
            @RequestParam(value = "interests", required = false) String interests,
            @RequestParam(value = "gender", required = false) String gender,
            @RequestParam(value = "publicProfile", required = false) Boolean publicProfile) {
        UserProfile p = userService.updateProfile(userId, nickname, null, country, language, interests, gender,
                publicProfile);
        return ResponseEntity.ok(p);
    }

    @PostMapping("/profile/{userId}/avatar")
    public ResponseEntity<Map<String, String>> uploadAvatar(
            @PathVariable("userId") String userId,
            @RequestParam("file") MultipartFile file) {
        try {
            String url;
            if (cloudinary != null) {
                // Cloud storage (production)
                Map uploadResult = cloudinary.uploader().upload(file.getBytes(), Map.of(
                        "folder", "novachat/avatars",
                        "resource_type", "image"));
                url = (String) uploadResult.get("secure_url");
            } else {
                // Local storage (development)
                String uploadDir = "uploads/avatars/";
                Files.createDirectories(Paths.get(uploadDir));
                String fileName = userId + "_" + UUID.randomUUID() + "_" + file.getOriginalFilename();
                Path p = Paths.get(uploadDir + fileName);
                Files.write(p, file.getBytes());
                url = ServletUriComponentsBuilder.fromCurrentContextPath()
                        .path("/uploads/avatars/")
                        .path(fileName)
                        .toUriString();
            }
            userService.updateProfile(userId, null, url, null, null, null, null, null);
            return ResponseEntity.ok(Map.of("url", url));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/profile/{userId}/verify-age")
    public ResponseEntity<Void> verifyAge(@PathVariable("userId") String userId) {
        userService.markAgeVerified(userId);
        return ResponseEntity.ok().build();
    }

    // ──────────────────────────────────────────
    // Reports
    // ──────────────────────────────────────────

    @PostMapping("/report")
    public ResponseEntity<Report> submitReport(@RequestBody Map<String, String> body) {
        Report r = userService.submitReport(
                body.get("reporterId"),
                body.get("reportedId"),
                body.get("roomName"),
                Report.ReportReason.valueOf(body.getOrDefault("reason", "OTHER")),
                body.get("details"));
        return ResponseEntity.ok(r);
    }

    // ──────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────

    @GetMapping("/admin/stats")
    public ResponseEntity<Map<String, Object>> getStats() {
        Map<String, Object> stats = new HashMap<>();
        stats.put("activeChats", matchmakingService.getActiveChats());
        stats.put("waitingUsers", matchmakingService.getQueueSize());
        stats.put("pendingReports", userService.getPendingReportCount());
        stats.put("totalUsers", userService.getAllUsers().size());
        stats.put("redisActive", matchmakingService.isRedisActive());
        return ResponseEntity.ok(stats);
    }

    @GetMapping("/admin/reports")
    public ResponseEntity<?> getPendingReports() {
        return ResponseEntity.ok(userService.getPendingReports());
    }

    @GetMapping("/admin/users")
    public ResponseEntity<?> getAllUsers() {
        return ResponseEntity.ok(userService.getAllUsers());
    }

    @PostMapping("/admin/ban/{userId}")
    public ResponseEntity<Void> banUser(@PathVariable("userId") String userId) {
        userService.banUser(userId);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/admin/unban/{userId}")
    public ResponseEntity<Void> unbanUser(@PathVariable("userId") String userId) {
        userService.unbanUser(userId);
        return ResponseEntity.ok().build();
    }

    /** Get all distinct chat rooms with message counts */
    @GetMapping("/admin/rooms")
    public ResponseEntity<?> getAllRooms() {
        try {
            List<String> rooms = chatMessageRepository.findDistinctRoomNames();
            List<Map<String, Object>> result = rooms.stream().map(room -> {
                Map<String, Object> m = new HashMap<>();
                m.put("roomName", room);
                m.put("messageCount", chatMessageRepository.countByRoomName(room));
                return m;
            }).toList();
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.ok(List.of());
        }
    }

    /** Get all messages for a specific room (admin) */
    @GetMapping("/admin/rooms/{roomName}/messages")
    public ResponseEntity<?> getRoomMessages(@PathVariable("roomName") String roomName) {
        try {
            List<ChatMessage> msgs = chatMessageRepository.findByRoomNameOrderByTimestampAsc(roomName);
            return ResponseEntity.ok(msgs);
        } catch (Exception e) {
            return ResponseEntity.ok(List.of());
        }
    }

    /** Delete a room and all its messages (admin) */
    @DeleteMapping("/admin/rooms/{roomName}")
    @Transactional
    public ResponseEntity<?> deleteRoom(@PathVariable("roomName") String roomName) {
        try {
            long count = chatMessageRepository.countByRoomName(roomName);
            chatMessageRepository.deleteByRoomName(roomName);
            return ResponseEntity.ok(Map.of("deleted", count, "roomName", roomName));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    /** Get messages for a room (public — for rejoin after page refresh) */
    @GetMapping("/chat/messages/{roomName}")
    public ResponseEntity<?> getChatMessages(
            @PathVariable("roomName") String roomName,
            @RequestParam("userId") String userId) {
        try {
            // Verify the user is actually in this room
            String userRoom = matchmakingService.getRoom(userId);
            if (userRoom == null || !userRoom.equals(roomName)) {
                return ResponseEntity.status(403).body(Map.of("error", "Not authorized"));
            }
            List<ChatMessage> msgs = chatMessageRepository.findByRoomNameOrderByTimestampAsc(roomName);
            // Filter out system messages like MATCHED, DISCONNECTED
            List<ChatMessage> chatMsgs = msgs.stream()
                    .filter(m -> m.getType() == MessageType.CHAT)
                    .toList();
            return ResponseEntity.ok(chatMsgs);
        } catch (Exception e) {
            return ResponseEntity.ok(List.of());
        }
    }

    // ──────────────────────────────────────────
    // Premium
    // ──────────────────────────────────────────

    /** User submits a payment request with UPI transaction ID */
    @PostMapping("/premium/request")
    public ResponseEntity<?> requestPremium(@RequestBody Map<String, String> body) {
        try {
            String userId = body.get("userId");
            String txnId = body.get("transactionId");
            String nickname = body.get("nickname");
            if (userId == null || txnId == null || txnId.isBlank())
                return ResponseEntity.badRequest().body(Map.of("error", "Missing fields"));
            if (premiumRequestRepository.existsByUserIdAndStatus(userId, PremiumRequest.Status.PENDING))
                return ResponseEntity.badRequest().body(Map.of("error", "You already have a pending request"));
            if (premiumRequestRepository.findByTransactionId(txnId).isPresent())
                return ResponseEntity.badRequest().body(Map.of("error", "Transaction ID already used"));
            PremiumRequest req = PremiumRequest.builder()
                    .userId(userId).nickname(nickname)
                    .transactionId(txnId).status(PremiumRequest.Status.PENDING).build();
            return ResponseEntity.ok(premiumRequestRepository.save(req));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /** Check current user's premium status */
    @GetMapping("/premium/status/{userId}")
    public ResponseEntity<?> getPremiumStatus(@PathVariable("userId") String userId) {
        UserProfile p = userService.getOrCreateProfile(userId, null);
        List<PremiumRequest> reqs = premiumRequestRepository.findByUserIdOrderByRequestedAtDesc(userId);
        Map<String, Object> res = new HashMap<>();
        res.put("premium", p.isPremium());
        res.put("premiumSince", p.getPremiumSince());
        res.put("requests", reqs);
        return ResponseEntity.ok(res);
    }

    /** Lightweight check — used during random chat so both users can benefit */
    @GetMapping("/premium/check/{userId}")
    public ResponseEntity<?> checkStrangerPremium(@PathVariable("userId") String userId) {
        UserProfile p = userService.getOrCreateProfile(userId, null);
        return ResponseEntity.ok(Map.of("premium", p.isPremium()));
    }

    /**
     * Payment details are now handled securely via /api/payment/create-order
     * (see PaymentController). No admin identity is exposed.
     */

    /** Admin: get all pending premium requests */
    @GetMapping("/admin/premium/pending")
    public ResponseEntity<?> getPendingPremiumRequests() {
        return ResponseEntity.ok(
                premiumRequestRepository.findByStatusOrderByRequestedAtDesc(PremiumRequest.Status.PENDING));
    }

    /** Admin: approve a premium request → grants premium to user */
    @PostMapping("/admin/premium/{requestId}/approve")
    public ResponseEntity<?> approvePremium(@PathVariable("requestId") Long requestId) {
        try {
            PremiumRequest req = premiumRequestRepository.findById(requestId)
                    .orElseThrow(() -> new RuntimeException("Not found"));
            req.setStatus(PremiumRequest.Status.APPROVED);
            req.setResolvedAt(LocalDateTime.now());
            premiumRequestRepository.save(req);
            userService.grantPremium(req.getUserId());
            return ResponseEntity.ok(req);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** Admin: reject a premium request */
    @PostMapping("/admin/premium/{requestId}/reject")
    public ResponseEntity<?> rejectPremium(@PathVariable("requestId") Long requestId) {
        try {
            PremiumRequest req = premiumRequestRepository.findById(requestId)
                    .orElseThrow(() -> new RuntimeException("Not found"));
            req.setStatus(PremiumRequest.Status.REJECTED);
            req.setResolvedAt(LocalDateTime.now());
            return ResponseEntity.ok(premiumRequestRepository.save(req));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    // ──────────────────────────────────────────
    // Friends
    // ──────────────────────────────────────────

    /**
     * Check friendship status between two users — declared before /friends/{userId}
     * to avoid path conflict
     */
    @GetMapping("/friends/status")
    public ResponseEntity<Map<String, Object>> getFriendStatus(
            @RequestParam("userId") String userId,
            @RequestParam("otherId") String otherId) {
        try {
            return friendshipService.getFriendshipBetween(userId, otherId)
                    .map(f -> {
                        Map<String, Object> res = new HashMap<>();
                        res.put("friendshipId", f.getId());
                        res.put("status", f.getStatus().name());
                        res.put("senderId", f.getSenderId());
                        return ResponseEntity.ok(res);
                    })
                    .orElse(ResponseEntity.ok(Map.of("status", "NONE")));
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.ok(Map.of("status", "NONE"));
        }
    }

    /** Send a friend request */
    @PostMapping("/friends/request")
    public ResponseEntity<?> sendFriendRequest(@RequestBody Map<String, String> body) {
        try {
            Friendship f = friendshipService.sendRequest(
                    body.get("senderId"),
                    body.get("receiverId"),
                    body.get("senderNickname"),
                    body.get("receiverNickname"));
            return ResponseEntity.ok(f);
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** Accept a friend request */
    @PostMapping("/friends/{friendshipId}/accept")
    public ResponseEntity<?> acceptFriendRequest(
            @PathVariable("friendshipId") Long friendshipId,
            @RequestParam("userId") String userId) {
        try {
            return ResponseEntity.ok(friendshipService.acceptRequest(friendshipId, userId));
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** Decline a friend request */
    @PostMapping("/friends/{friendshipId}/decline")
    public ResponseEntity<?> declineFriendRequest(
            @PathVariable("friendshipId") Long friendshipId,
            @RequestParam("userId") String userId) {
        try {
            return ResponseEntity.ok(friendshipService.declineRequest(friendshipId, userId));
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** Remove a friend */
    @DeleteMapping("/friends/{friendshipId}")
    public ResponseEntity<?> removeFriend(
            @PathVariable("friendshipId") Long friendshipId,
            @RequestParam("userId") String userId) {
        try {
            friendshipService.removeFriend(friendshipId, userId);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** Get all accepted friends */
    @GetMapping("/friends/{userId}")
    public ResponseEntity<?> getFriends(@PathVariable("userId") String userId) {
        try {
            return ResponseEntity.ok(friendshipService.getFriends(userId));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /** Get pending incoming friend requests */
    @GetMapping("/friends/{userId}/incoming")
    public ResponseEntity<?> getIncomingRequests(@PathVariable("userId") String userId) {
        try {
            return ResponseEntity.ok(friendshipService.getIncomingRequests(userId));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /** Get pending outgoing friend requests */
    @GetMapping("/friends/{userId}/outgoing")
    public ResponseEntity<?> getOutgoingRequests(@PathVariable("userId") String userId) {
        try {
            return ResponseEntity.ok(friendshipService.getOutgoingRequests(userId));
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    // ──────────────────────────────────────────
    // Direct Messages (persistent, works offline)
    // ──────────────────────────────────────────

    /** Send a DM to a friend (saves to DB, works even if friend is offline) */
    @PostMapping("/dm/send")
    public ResponseEntity<?> sendDm(@RequestBody Map<String, String> body) {
        try {
            String senderId = body.get("senderId");
            String receiverId = body.get("receiverId");
            String content = body.get("content");
            String attachmentUrl = body.get("attachmentUrl");
            String attachmentType = body.get("attachmentType");
            String senderNickname = body.get("senderNickname");

            // Verify they are friends
            var friendship = friendshipService.getFriendshipBetween(senderId, receiverId);
            if (friendship.isEmpty() || friendship.get().getStatus() != FriendshipStatus.ACCEPTED) {
                return ResponseEntity.badRequest().body(Map.of("error", "Not friends"));
            }

            // Build deterministic DM room name
            String dmRoom = friendship.get().getDmRoomName();

            // Save message to DB
            ChatMessage msg = ChatMessage.builder()
                    .roomName(dmRoom)
                    .senderId(senderId)
                    .senderNickname(senderNickname != null ? senderNickname : senderId)
                    .content(content)
                    .attachmentUrl(attachmentUrl)
                    .attachmentType(attachmentType)
                    .type(MessageType.CHAT)
                    .build();
            chatMessageRepository.save(msg);

            // Update sender's read timestamp (they've seen their own message)
            Friendship f = friendship.get();
            if (f.getSenderId().equals(senderId)) {
                f.setSenderLastReadAt(msg.getTimestamp());
            } else {
                f.setReceiverLastReadAt(msg.getTimestamp());
            }
            friendshipService.saveFriendship(f);

            return ResponseEntity.ok(msg);
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** Get DM message history between two friends */
    @GetMapping("/dm/messages")
    public ResponseEntity<?> getDmMessages(
            @RequestParam("userId") String userId,
            @RequestParam("friendId") String friendId) {
        try {
            var friendship = friendshipService.getFriendshipBetween(userId, friendId);
            if (friendship.isEmpty()) {
                return ResponseEntity.ok(List.of());
            }
            String dmRoom = friendship.get().getDmRoomName();
            List<ChatMessage> messages = chatMessageRepository.findByRoomNameOrderByTimestampAsc(dmRoom);
            // Filter to only CHAT type messages
            messages = messages.stream()
                    .filter(m -> m.getType() == MessageType.CHAT)
                    .toList();
            return ResponseEntity.ok(messages);
        } catch (Exception e) {
            return ResponseEntity.ok(List.of());
        }
    }

    /** Mark a DM conversation as read */
    @PostMapping("/dm/read")
    public ResponseEntity<?> markDmRead(
            @RequestParam("userId") String userId,
            @RequestParam("friendId") String friendId) {
        try {
            var friendship = friendshipService.getFriendshipBetween(userId, friendId);
            if (friendship.isEmpty()) {
                return ResponseEntity.ok(Map.of("ok", true));
            }
            Friendship f = friendship.get();
            java.time.LocalDateTime now = java.time.LocalDateTime.now();
            if (f.getSenderId().equals(userId)) {
                f.setSenderLastReadAt(now);
            } else {
                f.setReceiverLastReadAt(now);
            }
            friendshipService.saveFriendship(f);
            return ResponseEntity.ok(Map.of("ok", true));
        } catch (Exception e) {
            return ResponseEntity.ok(Map.of("ok", true));
        }
    }

    /** Get all DM conversations for a user with unread counts and last message */
    @GetMapping("/dm/conversations")
    public ResponseEntity<?> getDmConversations(@RequestParam("userId") String userId) {
        try {
            List<Friendship> friends = friendshipService.getFriends(userId);
            List<Map<String, Object>> conversations = new java.util.ArrayList<>();

            for (Friendship f : friends) {
                String dmRoom = f.getDmRoomName();
                String friendId = f.getSenderId().equals(userId) ? f.getReceiverId() : f.getSenderId();
                String friendNick = f.getSenderId().equals(userId) ? f.getReceiverNickname() : f.getSenderNickname();

                // Get last message
                ChatMessage lastMsg = chatMessageRepository.findTop1ByRoomNameOrderByTimestampDesc(dmRoom);

                // Calculate unread count
                java.time.LocalDateTime lastRead = f.getSenderId().equals(userId)
                        ? f.getSenderLastReadAt()
                        : f.getReceiverLastReadAt();
                long unread = 0;
                if (lastRead != null) {
                    unread = chatMessageRepository.countByRoomNameAndTimestampAfter(dmRoom, lastRead);
                } else if (lastMsg != null) {
                    // Never read — all messages are unread
                    unread = chatMessageRepository.countByRoomName(dmRoom);
                }

                Map<String, Object> conv = new HashMap<>();
                conv.put("friendshipId", f.getId());
                conv.put("friendId", friendId);
                conv.put("friendNickname", friendNick != null ? friendNick : friendId);
                conv.put("dmRoomName", dmRoom);
                conv.put("unreadCount", unread);
                // For last message preview — show descriptive text for media-only messages
                String lastMsgPreview = null;
                if (lastMsg != null) {
                    if (lastMsg.getContent() != null && !lastMsg.getContent().isBlank()) {
                        lastMsgPreview = lastMsg.getContent();
                    } else if (lastMsg.getAttachmentUrl() != null) {
                        String aType = lastMsg.getAttachmentType();
                        if (aType != null && aType.startsWith("image"))
                            lastMsgPreview = "📷 Photo";
                        else if (aType != null && aType.startsWith("video"))
                            lastMsgPreview = "🎥 Video";
                        else
                            lastMsgPreview = "📎 Attachment";
                    }
                }
                conv.put("lastMessage", lastMsgPreview);
                conv.put("lastMessageTime", lastMsg != null ? lastMsg.getTimestamp() : null);
                conv.put("lastMessageSenderId", lastMsg != null ? lastMsg.getSenderId() : null);
                conversations.add(conv);
            }

            // Sort by last message time (most recent first)
            conversations.sort((a, b) -> {
                var ta = (java.time.LocalDateTime) a.get("lastMessageTime");
                var tb = (java.time.LocalDateTime) b.get("lastMessageTime");
                if (ta == null && tb == null)
                    return 0;
                if (ta == null)
                    return 1;
                if (tb == null)
                    return -1;
                return tb.compareTo(ta);
            });

            return ResponseEntity.ok(conversations);
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.ok(List.of());
        }
    }

    /** Get total unread DM count across all conversations */
    @GetMapping("/dm/unread-count")
    public ResponseEntity<?> getUnreadCount(@RequestParam("userId") String userId) {
        try {
            List<Friendship> friends = friendshipService.getFriends(userId);
            long total = 0;
            for (Friendship f : friends) {
                String dmRoom = f.getDmRoomName();
                java.time.LocalDateTime lastRead = f.getSenderId().equals(userId)
                        ? f.getSenderLastReadAt()
                        : f.getReceiverLastReadAt();
                if (lastRead != null) {
                    total += chatMessageRepository.countByRoomNameAndTimestampAfter(dmRoom, lastRead);
                } else {
                    total += chatMessageRepository.countByRoomName(dmRoom);
                }
            }
            return ResponseEntity.ok(Map.of("unread", total));
        } catch (Exception e) {
            return ResponseEntity.ok(Map.of("unread", 0));
        }
    }
}
