package com.randomchat.backend.service;

import com.randomchat.backend.model.ChatMessage;
import com.randomchat.backend.model.MessageType;
import com.randomchat.backend.repository.ChatMessageRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

/**
 * Matchmaking service with Redis-backed queue for production scalability.
 * If Redis is unavailable, falls back to in-memory queues automatically.
 */
@Service
@Slf4j
public class MatchmakingService {

    private final SimpMessagingTemplate messagingTemplate;
    private final ChatMessageRepository chatMessageRepository;
    private final UserService userService;
    private final StringRedisTemplate redisTemplate;

    // Redis key prefixes
    private static final String REDIS_QUEUE = "novachat:matchmaking:queue";
    private static final String REDIS_USER_ROOMS = "novachat:user:rooms";
    private static final String REDIS_SESSIONS = "novachat:user:sessions";
    private static final String REDIS_NICKNAMES = "novachat:user:nicknames";
    private static final String REDIS_ROOM_COUNTER = "novachat:room:counter";
    private static final String REDIS_INTERESTS = "novachat:user:interests";
    private static final String REDIS_GENDER_FILTER = "novachat:user:genderFilter";
    private static final String REDIS_USER_GENDER = "novachat:user:gender";

    // In-memory fallback (used when Redis is not available)
    private final ConcurrentHashMap<String, String> userRooms = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, String[]> roomUsers = new ConcurrentHashMap<>();
    private final ConcurrentLinkedDeque<String> waitingQueue = new ConcurrentLinkedDeque<>();
    private final ConcurrentHashMap<String, String> activeSessions = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, String> userNicknames = new ConcurrentHashMap<>();
    // Interest + gender filter maps
    private final ConcurrentHashMap<String, String> userInterests = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, String> userGenderFilters = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, String> userGenders = new ConcurrentHashMap<>();
    private final AtomicInteger roomCounter = new AtomicInteger(0);

    // Grace period: pending disconnects that can be cancelled on reconnect
    private final ConcurrentHashMap<String, ScheduledFuture<?>> pendingDisconnects = new ConcurrentHashMap<>();
    private final ScheduledExecutorService disconnectScheduler = Executors.newScheduledThreadPool(2);

    // Track Redis availability
    private volatile boolean redisAvailable = false;

    public MatchmakingService(
            SimpMessagingTemplate messagingTemplate,
            ChatMessageRepository chatMessageRepository,
            UserService userService,
            StringRedisTemplate redisTemplate) {
        this.messagingTemplate = messagingTemplate;
        this.chatMessageRepository = chatMessageRepository;
        this.userService = userService;
        this.redisTemplate = redisTemplate;

        // Check Redis connectivity on startup
        checkRedisAvailability();
    }

    private void checkRedisAvailability() {
        try {
            redisTemplate.getConnectionFactory().getConnection().ping();
            redisAvailable = true;
            log.info("✅ Redis connected — using Redis-backed matchmaking queue");
        } catch (Exception e) {
            redisAvailable = false;
            log.warn("⚠️ Redis not available — falling back to in-memory matchmaking. " +
                    "For production, install and start Redis. Error: {}", e.getMessage());
        }
    }

    // ─── Redis Helper Methods ───────────────────

    private void redisSetUserRoom(String userId, String room) {
        try {
            redisTemplate.opsForHash().put(REDIS_USER_ROOMS, userId, room);
        } catch (Exception e) {
            handleRedisFallback(e);
        }
    }

    private String redisGetUserRoom(String userId) {
        try {
            Object val = redisTemplate.opsForHash().get(REDIS_USER_ROOMS, userId);
            return val != null ? val.toString() : null;
        } catch (Exception e) {
            handleRedisFallback(e);
            return null;
        }
    }

    private void redisRemoveUserRoom(String userId) {
        try {
            redisTemplate.opsForHash().delete(REDIS_USER_ROOMS, userId);
        } catch (Exception e) {
            handleRedisFallback(e);
        }
    }

    private void redisSetSession(String userId, String sessionId) {
        try {
            redisTemplate.opsForHash().put(REDIS_SESSIONS, userId, sessionId);
        } catch (Exception e) {
            handleRedisFallback(e);
        }
    }

    private String redisGetSession(String userId) {
        try {
            Object val = redisTemplate.opsForHash().get(REDIS_SESSIONS, userId);
            return val != null ? val.toString() : null;
        } catch (Exception e) {
            handleRedisFallback(e);
            return null;
        }
    }

    private void redisRemoveSession(String userId) {
        try {
            redisTemplate.opsForHash().delete(REDIS_SESSIONS, userId);
        } catch (Exception e) {
            handleRedisFallback(e);
        }
    }

    private void redisSetNickname(String userId, String nickname) {
        try {
            redisTemplate.opsForHash().put(REDIS_NICKNAMES, userId, nickname);
        } catch (Exception e) {
            handleRedisFallback(e);
        }
    }

    private String redisGetNickname(String userId) {
        try {
            Object val = redisTemplate.opsForHash().get(REDIS_NICKNAMES, userId);
            return val != null ? val.toString() : userId;
        } catch (Exception e) {
            handleRedisFallback(e);
            return userId;
        }
    }

    private void redisRemoveNickname(String userId) {
        try {
            redisTemplate.opsForHash().delete(REDIS_NICKNAMES, userId);
        } catch (Exception e) {
            handleRedisFallback(e);
        }
    }

    private void redisAddToQueue(String userId, boolean isPremium) {
        try {
            if (isPremium) {
                redisTemplate.opsForList().leftPush(REDIS_QUEUE, userId);
            } else {
                redisTemplate.opsForList().rightPush(REDIS_QUEUE, userId);
            }
        } catch (Exception e) {
            handleRedisFallback(e);
        }
    }

    private void redisRemoveFromQueue(String userId) {
        try {
            redisTemplate.opsForList().remove(REDIS_QUEUE, 0, userId);
        } catch (Exception e) {
            handleRedisFallback(e);
        }
    }

    private long redisQueueSize() {
        try {
            Long size = redisTemplate.opsForList().size(REDIS_QUEUE);
            return size != null ? size : 0;
        } catch (Exception e) {
            handleRedisFallback(e);
            return 0;
        }
    }

    private long redisIncrementRoomCounter() {
        try {
            Long val = redisTemplate.opsForValue().increment(REDIS_ROOM_COUNTER);
            return val != null ? val : roomCounter.incrementAndGet();
        } catch (Exception e) {
            handleRedisFallback(e);
            return roomCounter.incrementAndGet();
        }
    }

    private void handleRedisFallback(Exception e) {
        if (redisAvailable) {
            redisAvailable = false;
            log.warn("⚠️ Redis connection lost — switching to in-memory fallback. Error: {}", e.getMessage());
        }
    }

    // ─── Interest + Gender helpers ───────────────

    private void storeUserMeta(String userId, String interests, String genderFilter, String gender) {
        if (redisAvailable) {
            try {
                if (interests != null)
                    redisTemplate.opsForHash().put(REDIS_INTERESTS, userId, interests);
                if (genderFilter != null)
                    redisTemplate.opsForHash().put(REDIS_GENDER_FILTER, userId, genderFilter);
                if (gender != null)
                    redisTemplate.opsForHash().put(REDIS_USER_GENDER, userId, gender);
                return;
            } catch (Exception e) {
                handleRedisFallback(e);
            }
        }
        if (interests != null)
            userInterests.put(userId, interests);
        if (genderFilter != null)
            userGenderFilters.put(userId, genderFilter);
        if (gender != null)
            userGenders.put(userId, gender);
    }

    private void removeUserMeta(String userId) {
        if (redisAvailable) {
            try {
                redisTemplate.opsForHash().delete(REDIS_INTERESTS, userId);
                redisTemplate.opsForHash().delete(REDIS_GENDER_FILTER, userId);
                redisTemplate.opsForHash().delete(REDIS_USER_GENDER, userId);
                return;
            } catch (Exception e) {
                handleRedisFallback(e);
            }
        }
        userInterests.remove(userId);
        userGenderFilters.remove(userId);
        userGenders.remove(userId);
    }

    private String getUserMeta(String userId, String redisKey, ConcurrentHashMap<String, String> fallback) {
        if (redisAvailable) {
            try {
                Object val = redisTemplate.opsForHash().get(redisKey, userId);
                return val != null ? val.toString() : null;
            } catch (Exception e) {
                handleRedisFallback(e);
            }
        }
        return fallback.get(userId);
    }

    /**
     * Calculate shared interests between two comma-separated interest strings.
     */
    private Set<String> sharedInterests(String interestsA, String interestsB) {
        if (interestsA == null || interestsB == null || interestsA.isBlank() || interestsB.isBlank())
            return Collections.emptySet();
        Set<String> setA = Arrays.stream(interestsA.split(","))
                .map(String::trim).map(String::toLowerCase)
                .filter(s -> !s.isBlank()).collect(Collectors.toSet());
        return Arrays.stream(interestsB.split(","))
                .map(String::trim).map(String::toLowerCase)
                .filter(setA::contains).collect(Collectors.toSet());
    }

    /**
     * Check if two users are gender-compatible given each other's genderFilter.
     * genderFilter = "ANY", "MALE", "FEMALE", "OTHER", or null/blank = any.
     */
    private boolean genderCompatible(String genderA, String filterA, String genderB, String filterB) {
        boolean aWantsB = filterA == null || filterA.isBlank() || filterA.equalsIgnoreCase("ANY")
                || (genderB != null && filterA.equalsIgnoreCase(genderB));
        boolean bWantsA = filterB == null || filterB.isBlank() || filterB.equalsIgnoreCase("ANY")
                || (genderA != null && filterB.equalsIgnoreCase(genderA));
        return aWantsB && bWantsA;
    }

    /**
     * Try to find a match from the in-memory waiting queue that is compatible
     * (gender filter OK). If preferSharedInterests=true, only return a candidate
     * with ≥1 shared interest. Returns null if none found.
     */
    private String findMatch(String userId, String myInterests, String myGenderFilter, String myGender,
            boolean preferSharedInterests) {
        List<String> snapshot = new ArrayList<>(waitingQueue);
        for (String candidate : snapshot) {
            if (candidate.equals(userId))
                continue;
            String candInterests = getUserMeta(candidate, REDIS_INTERESTS, userInterests);
            String candFilter = getUserMeta(candidate, REDIS_GENDER_FILTER, userGenderFilters);
            String candGender = getUserMeta(candidate, REDIS_USER_GENDER, userGenders);
            if (!genderCompatible(myGender, myGenderFilter, candGender, candFilter))
                continue;
            if (preferSharedInterests && sharedInterests(myInterests, candInterests).isEmpty())
                continue;
            // Found a valid candidate — remove from queue
            if (waitingQueue.remove(candidate))
                return candidate;
        }
        return null;
    }

    /**
     * Try to find a match from the Redis waiting queue that is compatible
     * (gender filter OK). If preferSharedInterests=true, only return a candidate
     * with ≥1 shared interest. Returns null if none found.
     */
    private String findMatchRedis(String userId, String myInterests, String myGenderFilter, String myGender,
            boolean preferSharedInterests) {
        try {
            List<String> snapshot = redisTemplate.opsForList().range(REDIS_QUEUE, 0, -1);
            if (snapshot != null) {
                for (String candidate : snapshot) {
                    if (candidate.equals(userId))
                        continue;
                    String candInterests = getUserMeta(candidate, REDIS_INTERESTS, userInterests);
                    String candFilter = getUserMeta(candidate, REDIS_GENDER_FILTER, userGenderFilters);
                    String candGender = getUserMeta(candidate, REDIS_USER_GENDER, userGenders);
                    if (!genderCompatible(myGender, myGenderFilter, candGender, candFilter))
                        continue;
                    if (preferSharedInterests && sharedInterests(myInterests, candInterests).isEmpty())
                        continue;

                    // Found a valid candidate — remove from queue
                    Long removed = redisTemplate.opsForList().remove(REDIS_QUEUE, 1, candidate);
                    if (removed != null && removed > 0) {
                        return candidate;
                    }
                }
            }
        } catch (Exception e) {
            handleRedisFallback(e);
        }
        return null;
    }

    // ─── Core Matchmaking ───────────────────────

    public synchronized void joinLobby(String userId, String sessionId, String nickname,
            String interests, String genderFilter, String gender, boolean isPremium) {
        if (userService.isBanned(userId)) {
            ChatMessage banned = ChatMessage.builder()
                    .type(MessageType.SYSTEM)
                    .content("Your account has been banned from NovaChat.")
                    .timestamp(LocalDateTime.now())
                    .build();
            messagingTemplate.convertAndSend("/queue/user/" + userId + "/match", banned);
            return;
        }

        // Clean up stale session + cancel any pending disconnect
        ScheduledFuture<?> pendingDc = pendingDisconnects.remove(userId);
        if (pendingDc != null) {
            pendingDc.cancel(false);
            log.info("✅ Cancelled pending disconnect for {} (user reconnected)", userId);
        }
        String oldSession = redisAvailable ? redisGetSession(userId) : activeSessions.get(userId);
        if (oldSession != null) {
            if (redisAvailable) {
                redisRemoveFromQueue(userId);
            } else {
                waitingQueue.remove(userId);
            }
            String oldRoom = redisAvailable ? redisGetUserRoom(userId) : userRooms.remove(userId);
            if (redisAvailable) {
                redisRemoveUserRoom(userId);
            }
            if (oldRoom != null) {
                String[] users = roomUsers.get(oldRoom);
                if (users != null) {
                    for (String u : users) {
                        if (!u.equals(userId)) {
                            if (redisAvailable) {
                                redisRemoveUserRoom(u);
                            } else {
                                userRooms.remove(u);
                            }
                            ChatMessage disconnectMsg = ChatMessage.builder()
                                    .type(MessageType.DISCONNECTED)
                                    .content("Stranger has disconnected.")
                                    .roomName(oldRoom)
                                    .timestamp(LocalDateTime.now())
                                    .build();
                            messagingTemplate.convertAndSend("/queue/user/" + u + "/match", disconnectMsg);
                        }
                    }
                    roomUsers.remove(oldRoom);
                }
            }
        }

        // Store session + nickname
        if (redisAvailable) {
            redisSetSession(userId, sessionId);
            if (nickname != null)
                redisSetNickname(userId, nickname);
        } else {
            activeSessions.put(userId, sessionId);
            if (nickname != null)
                userNicknames.put(userId, nickname);
        }

        // Store interests / gender meta (used for smart matching)
        storeUserMeta(userId, interests, genderFilter, gender);

        // ── Smart match: prefer interest+gender match, fall back to gender-only match
        // ──
        String matchedUser = null;
        String myInterests = interests;
        String myGenderFilter = genderFilter;
        String myGender = gender;

        if (redisAvailable) {
            // Try interest+gender match first
            matchedUser = findMatchRedis(userId, myInterests, myGenderFilter, myGender, true);
            // Fall back to any gender-compatible match
            if (matchedUser == null) {
                matchedUser = findMatchRedis(userId, myInterests, myGenderFilter, myGender, false);
            }
        } else {
            // Try interest+gender match first
            matchedUser = findMatch(userId, myInterests, myGenderFilter, myGender, true);
            // Fall back to any gender-compatible match
            if (matchedUser == null) {
                matchedUser = findMatch(userId, myInterests, myGenderFilter, myGender, false);
            }
        }

        if (matchedUser != null && !matchedUser.equals(userId)) {
            long roomNum = redisAvailable ? redisIncrementRoomCounter() : roomCounter.incrementAndGet();
            String roomName = "room_" + roomNum;

            if (redisAvailable) {
                redisSetUserRoom(userId, roomName);
                redisSetUserRoom(matchedUser, roomName);
            } else {
                userRooms.put(userId, roomName);
                userRooms.put(matchedUser, roomName);
            }
            roomUsers.put(roomName, new String[] { userId, matchedUser });

            String nick1 = redisAvailable ? redisGetNickname(userId) : userNicknames.getOrDefault(userId, userId);
            String nick2 = redisAvailable ? redisGetNickname(matchedUser)
                    : userNicknames.getOrDefault(matchedUser, matchedUser);

            // Compute shared interests for the match banner
            String candidateInterests = getUserMeta(matchedUser, REDIS_INTERESTS, userInterests);
            Set<String> common = sharedInterests(myInterests, candidateInterests);
            String baseContent = "You're now chatting with a random stranger. Say hi! 👋";
            String matchContent = common.isEmpty()
                    ? baseContent
                    : "MATCHED|" + String.join(",", common);

            ChatMessage matchForUser = ChatMessage.builder()
                    .type(MessageType.MATCHED)
                    .content(matchContent)
                    .senderId(matchedUser)
                    .senderNickname(nick2)
                    .roomName(roomName)
                    .timestamp(LocalDateTime.now())
                    .build();

            ChatMessage matchForMatched = ChatMessage.builder()
                    .type(MessageType.MATCHED)
                    .content(matchContent)
                    .senderId(userId)
                    .senderNickname(nick1)
                    .roomName(roomName)
                    .timestamp(LocalDateTime.now())
                    .build();

            messagingTemplate.convertAndSend("/queue/user/" + userId + "/match", matchForUser);
            messagingTemplate.convertAndSend("/queue/user/" + matchedUser + "/match", matchForMatched);
            chatMessageRepository.save(matchForUser);

            // Clean up meta for both matched users
            removeUserMeta(userId);
            removeUserMeta(matchedUser);

            log.info("🎉 Matched {} with {} in {} | shared interests: {}", nick1, nick2, roomName, common);
        } else {
            if (redisAvailable) {
                redisAddToQueue(userId, isPremium);
            } else {
                if (isPremium) {
                    waitingQueue.addFirst(userId);
                } else {
                    waitingQueue.addLast(userId);
                }
            }
            log.debug("⏳ {} added to queue (size: {}) [Premium: {}]", userId, getQueueSize(), isPremium);
        }
    }

    /**
     * Immediate disconnect — user explicitly clicked Skip/Leave.
     * No grace period, partner is notified right away.
     */
    public synchronized void disconnectImmediate(String userId, String sessionId) {
        String activeSession = redisAvailable ? redisGetSession(userId) : activeSessions.get(userId);
        if (activeSession != null && !activeSession.equals(sessionId))
            return;

        // Cancel any pending graceful disconnect
        ScheduledFuture<?> existing = pendingDisconnects.remove(userId);
        if (existing != null)
            existing.cancel(false);

        // Remove session FIRST so executeDisconnect doesn't think user reconnected
        if (redisAvailable) {
            redisRemoveSession(userId);
        } else {
            activeSessions.remove(userId);
        }

        log.info("🔴 Immediate disconnect for {}", userId);
        executeDisconnect(userId);
    }

    /**
     * Graceful disconnect — WebSocket connection dropped (page refresh, network
     * issue).
     * Uses 5-second grace period to allow reconnection.
     */
    public synchronized void disconnect(String userId, String sessionId) {
        String activeSession = redisAvailable ? redisGetSession(userId) : activeSessions.get(userId);
        if (activeSession != null && !activeSession.equals(sessionId))
            return;

        // If session was already removed (e.g. by disconnectImmediate), skip
        if (activeSession == null) {
            String room = redisAvailable ? redisGetUserRoom(userId) : userRooms.get(userId);
            if (room == null) {
                log.info("ℹ️ Disconnect for {} skipped — already cleaned up", userId);
                return;
            }
        }

        // Cancel any pending disconnect for this user (duplicate event)
        ScheduledFuture<?> existing = pendingDisconnects.remove(userId);
        if (existing != null)
            existing.cancel(false);

        // Schedule room destruction after a grace period (5 seconds)
        // This allows page refreshes to reconnect without losing the chat
        ScheduledFuture<?> future = disconnectScheduler.schedule(() -> {
            pendingDisconnects.remove(userId);
            executeDisconnect(userId);
        }, 5, TimeUnit.SECONDS);
        pendingDisconnects.put(userId, future);

        log.info("⏳ Disconnect scheduled for {} (5s grace period)", userId);
    }

    /** Actually perform the disconnect — called after grace period expires */
    private synchronized void executeDisconnect(String userId) {
        // Check if user has reconnected during grace period
        String currentSession = redisAvailable ? redisGetSession(userId) : activeSessions.get(userId);
        String currentRoom = redisAvailable ? redisGetUserRoom(userId) : userRooms.get(userId);

        // If user reconnected (new session exists), don't destroy anything
        if (currentSession != null && currentRoom != null) {
            log.info("✅ {} reconnected during grace period — keeping room {}", userId, currentRoom);
            return;
        }

        if (redisAvailable) {
            redisRemoveFromQueue(userId);
            redisRemoveSession(userId);
            redisRemoveNickname(userId);
        } else {
            waitingQueue.remove(userId);
            activeSessions.remove(userId);
            userNicknames.remove(userId);
        }

        String room = redisAvailable ? redisGetUserRoom(userId) : userRooms.remove(userId);
        if (redisAvailable) {
            redisRemoveUserRoom(userId);
        }

        if (room != null) {
            String[] users = roomUsers.remove(room);
            if (users != null) {
                for (String u : users) {
                    if (!u.equals(userId)) {
                        if (redisAvailable) {
                            redisRemoveUserRoom(u);
                        } else {
                            userRooms.remove(u);
                        }
                        ChatMessage disconnectMsg = ChatMessage.builder()
                                .type(MessageType.DISCONNECTED)
                                .content("Stranger has disconnected.")
                                .roomName(room)
                                .timestamp(LocalDateTime.now())
                                .build();
                        messagingTemplate.convertAndSend("/queue/user/" + u + "/match", disconnectMsg);
                        chatMessageRepository.save(disconnectMsg);
                    }
                }
            }
        }
    }

    public String getRoom(String userId) {
        if (redisAvailable) {
            String room = redisGetUserRoom(userId);
            return room != null ? room : userRooms.get(userId);
        }
        return userRooms.get(userId);
    }

    /**
     * Rejoin an existing room after page refresh.
     * If the room still exists and the user was part of it, re-register and resume.
     */
    public synchronized void rejoinRoom(String userId, String sessionId, String nickname, String roomName) {
        // Cancel any pending disconnect for this user
        ScheduledFuture<?> pendingDc = pendingDisconnects.remove(userId);
        if (pendingDc != null) {
            pendingDc.cancel(false);
            log.info("✅ Cancelled pending disconnect for {} (rejoin)", userId);
        }

        // Check if the room still exists
        String[] users = roomUsers.get(roomName);
        if (users == null) {
            log.warn("⚠️ Room {} no longer exists for rejoin by {}", roomName, userId);
            ChatMessage noRoom = ChatMessage.builder()
                    .type(MessageType.SYSTEM)
                    .content("Chat session expired. Please start a new chat.")
                    .timestamp(LocalDateTime.now())
                    .build();
            messagingTemplate.convertAndSend("/queue/user/" + userId + "/match", noRoom);
            return;
        }

        // Re-register session and mappings
        if (redisAvailable) {
            redisSetSession(userId, sessionId);
            if (nickname != null)
                redisSetNickname(userId, nickname);
            redisSetUserRoom(userId, roomName);
        } else {
            activeSessions.put(userId, sessionId);
            if (nickname != null)
                userNicknames.put(userId, nickname);
            userRooms.put(userId, roomName);
        }

        // Find the stranger in the room
        String strangerId = null;
        for (String u : users) {
            if (!u.equals(userId)) {
                strangerId = u;
                break;
            }
        }

        String strangerNick = strangerId != null
                ? (redisAvailable ? redisGetNickname(strangerId) : userNicknames.getOrDefault(strangerId, strangerId))
                : "Stranger";

        // Send MATCHED message to confirm rejoin
        ChatMessage rejoinMsg = ChatMessage.builder()
                .type(MessageType.MATCHED)
                .content("REJOIN")
                .senderId(strangerId != null ? strangerId : "system")
                .senderNickname(strangerNick)
                .roomName(roomName)
                .timestamp(LocalDateTime.now())
                .build();

        messagingTemplate.convertAndSend("/queue/user/" + userId + "/match", rejoinMsg);
        log.info("🔄 {} rejoined room {} successfully", userId, roomName);
    }

    /** Get the user IDs in a room (for REST message history endpoint) */
    public String[] getRoomUsers(String roomName) {
        return roomUsers.get(roomName);
    }

    public int getQueueSize() {
        if (redisAvailable) {
            return (int) redisQueueSize();
        }
        return waitingQueue.size();
    }

    public int getActiveChats() {
        return roomUsers.size();
    }

    /**
     * Create a direct-message room between two friends.
     * Uses a deterministic room name so both users end up in the same room.
     */
    public synchronized void createDmRoom(String userId, String sessionId, String nickname, String targetUserId) {
        if (userService.isBanned(userId)) {
            ChatMessage banned = ChatMessage.builder()
                    .type(MessageType.SYSTEM)
                    .content("Your account has been banned from NovaChat.")
                    .timestamp(LocalDateTime.now())
                    .build();
            messagingTemplate.convertAndSend("/queue/user/" + userId + "/match", banned);
            return;
        }

        if (redisAvailable) {
            redisSetSession(userId, sessionId);
            if (nickname != null)
                redisSetNickname(userId, nickname);
        } else {
            activeSessions.put(userId, sessionId);
            if (nickname != null)
                userNicknames.put(userId, nickname);
        }

        // Deterministic DM room name
        String dmRoom;
        if (userId.compareTo(targetUserId) < 0) {
            dmRoom = "dm_" + userId + "_" + targetUserId;
        } else {
            dmRoom = "dm_" + targetUserId + "_" + userId;
        }

        // If both users are already in this DM room, skip
        String currentRoom = redisAvailable ? redisGetUserRoom(userId) : userRooms.get(userId);
        if (dmRoom.equals(currentRoom))
            return;

        // Remove from any global queue
        if (redisAvailable) {
            redisRemoveFromQueue(userId);
            redisSetUserRoom(userId, dmRoom);
        } else {
            waitingQueue.remove(userId);
            userRooms.put(userId, dmRoom);
        }

        // Check if the target is already waiting in this DM room
        String[] existingUsers = roomUsers.get(dmRoom);
        if (existingUsers != null) {
            // Target is already in the room — add this user and send MATCHED
            roomUsers.put(dmRoom, new String[] { existingUsers[0], userId });

            String nick1 = redisAvailable ? redisGetNickname(userId) : userNicknames.getOrDefault(userId, userId);
            String nick2 = redisAvailable ? redisGetNickname(existingUsers[0])
                    : userNicknames.getOrDefault(existingUsers[0], existingUsers[0]);

            ChatMessage matchForUser = ChatMessage.builder()
                    .type(MessageType.MATCHED)
                    .content("Direct message connected! 💬")
                    .senderId(existingUsers[0])
                    .senderNickname(nick2)
                    .roomName(dmRoom)
                    .timestamp(LocalDateTime.now())
                    .build();

            ChatMessage matchForTarget = ChatMessage.builder()
                    .type(MessageType.MATCHED)
                    .content("Direct message connected! 💬")
                    .senderId(userId)
                    .senderNickname(nick1)
                    .roomName(dmRoom)
                    .timestamp(LocalDateTime.now())
                    .build();

            messagingTemplate.convertAndSend("/queue/user/" + userId + "/match", matchForUser);
            messagingTemplate.convertAndSend("/queue/user/" + existingUsers[0] + "/match", matchForTarget);
        } else {
            // Target hasn't joined yet — put this user in the DM room and wait
            roomUsers.put(dmRoom, new String[] { userId });

            ChatMessage waiting = ChatMessage.builder()
                    .type(MessageType.MATCHED)
                    .content("Waiting for your friend to connect... 💬")
                    .senderId("system")
                    .senderNickname("system")
                    .roomName(dmRoom)
                    .timestamp(LocalDateTime.now())
                    .build();
            messagingTemplate.convertAndSend("/queue/user/" + userId + "/match", waiting);
        }
    }

    public void sendMessageToRoom(String room, ChatMessage message, String senderId) {
        message.setRoomName(room);
        message.setTimestamp(LocalDateTime.now());

        // Apply profanity filter to text messages
        if (message.getType() == MessageType.CHAT && message.getContent() != null) {
            message.setContent(userService.filterProfanity(message.getContent()));
        }

        // ALWAYS deliver messages to users first (never block on DB)
        String[] users = roomUsers.get(room);
        if (users != null) {
            for (String u : users) {
                if (!u.equals(senderId)) {
                    messagingTemplate.convertAndSend("/queue/user/" + u + "/messages", message);
                }
            }
        }

        // Then persist to DB (non-critical — don't block delivery)
        if (message.getType() != MessageType.TYPING) {
            try {
                chatMessageRepository.save(message);
            } catch (Exception e) {
                log.error("⚠️ Failed to save message to DB (delivery was still successful): {}", e.getMessage());
            }
        }
    }

    /**
     * Returns whether Redis is currently active and being used.
     */
    public boolean isRedisActive() {
        return redisAvailable;
    }
}
