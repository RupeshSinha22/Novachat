package com.randomchat.backend.service;

import com.randomchat.backend.model.Friendship;
import com.randomchat.backend.model.FriendshipStatus;
import com.randomchat.backend.model.UserProfile;
import com.randomchat.backend.repository.FriendshipRepository;
import com.randomchat.backend.repository.UserProfileRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class FriendshipService {

    private final FriendshipRepository friendshipRepo;
    private final UserProfileRepository profileRepo;

    /** Send a friend request from senderId to receiverId */
    public Friendship sendRequest(String senderId, String receiverId,
            String senderNickname, String receiverNickname) {
        if (senderId.equals(receiverId)) {
            throw new IllegalArgumentException("Cannot friend yourself");
        }

        // Check existing
        Optional<Friendship> existing = friendshipRepo.findBetween(senderId, receiverId);
        if (existing.isPresent()) {
            Friendship f = existing.get();
            // If previously declined, allow re-send
            if (f.getStatus() == FriendshipStatus.DECLINED) {
                f.setStatus(FriendshipStatus.PENDING);
                f.setSenderId(senderId);
                f.setReceiverId(receiverId);
                // Update nicknames
                if (senderNickname != null && !senderNickname.isBlank())
                    f.setSenderNickname(senderNickname);
                if (receiverNickname != null && !receiverNickname.isBlank())
                    f.setReceiverNickname(receiverNickname);
                return friendshipRepo.save(f);
            }
            // Update nicknames if they were stored as raw IDs
            boolean changed = false;
            if (senderNickname != null && !senderNickname.isBlank()
                    && (f.getSenderNickname() == null || f.getSenderNickname().equals(f.getSenderId()))) {
                f.setSenderNickname(senderNickname);
                changed = true;
            }
            if (receiverNickname != null && !receiverNickname.isBlank()
                    && (f.getReceiverNickname() == null || f.getReceiverNickname().equals(f.getReceiverId()))) {
                f.setReceiverNickname(receiverNickname);
                changed = true;
            }
            if (changed)
                friendshipRepo.save(f);
            return f; // return existing (PENDING or ACCEPTED)
        }

        // Resolve nicknames: use provided value, then DB, then raw ID as last resort
        String senderNick = (senderNickname != null && !senderNickname.isBlank()) ? senderNickname
                : profileRepo.findById(senderId).map(UserProfile::getNickname).orElse(senderId);
        String receiverNick = (receiverNickname != null && !receiverNickname.isBlank()) ? receiverNickname
                : profileRepo.findById(receiverId).map(UserProfile::getNickname).orElse(receiverId);

        Friendship f = Friendship.builder()
                .senderId(senderId)
                .receiverId(receiverId)
                .senderNickname(senderNick)
                .receiverNickname(receiverNick)
                .status(FriendshipStatus.PENDING)
                .build();
        return friendshipRepo.save(f);
    }

    /** Accept a pending friend request */
    public Friendship acceptRequest(Long friendshipId, String userId) {
        Friendship f = friendshipRepo.findById(friendshipId)
                .orElseThrow(() -> new IllegalArgumentException("Friendship not found"));
        if (!f.getReceiverId().equals(userId)) {
            throw new IllegalArgumentException("Not authorized to accept this request");
        }
        f.setStatus(FriendshipStatus.ACCEPTED);
        return friendshipRepo.save(f);
    }

    /** Decline a pending friend request */
    public Friendship declineRequest(Long friendshipId, String userId) {
        Friendship f = friendshipRepo.findById(friendshipId)
                .orElseThrow(() -> new IllegalArgumentException("Friendship not found"));
        if (!f.getReceiverId().equals(userId)) {
            throw new IllegalArgumentException("Not authorized to decline this request");
        }
        f.setStatus(FriendshipStatus.DECLINED);
        return friendshipRepo.save(f);
    }

    /** Remove/unfriend */
    public void removeFriend(Long friendshipId, String userId) {
        Friendship f = friendshipRepo.findById(friendshipId)
                .orElseThrow(() -> new IllegalArgumentException("Friendship not found"));
        if (!f.getSenderId().equals(userId) && !f.getReceiverId().equals(userId)) {
            throw new IllegalArgumentException("Not authorized");
        }
        friendshipRepo.delete(f);
    }

    /** Get all accepted friends */
    public List<Friendship> getFriends(String userId) {
        List<Friendship> list = friendshipRepo.findByUserIdAndStatus(userId, FriendshipStatus.ACCEPTED);
        refreshNicknames(list);
        return list;
    }

    /** Get incoming pending requests */
    public List<Friendship> getIncomingRequests(String userId) {
        List<Friendship> list = friendshipRepo.findByReceiverIdAndStatus(userId, FriendshipStatus.PENDING);
        refreshNicknames(list);
        return list;
    }

    /** Get outgoing pending requests */
    public List<Friendship> getOutgoingRequests(String userId) {
        List<Friendship> list = friendshipRepo.findBySenderIdAndStatus(userId, FriendshipStatus.PENDING);
        refreshNicknames(list);
        return list;
    }

    /**
     * Keep friendship nickname snapshots in sync with current profile names.
     * Always checks profiles table and updates if the stored nickname differs.
     */
    private void refreshNicknames(List<Friendship> friendships) {
        for (Friendship f : friendships) {
            boolean changed = false;
            // Refresh sender nickname from profile
            String latestSender = profileRepo.findById(f.getSenderId())
                    .map(UserProfile::getNickname)
                    .filter(n -> n != null && !n.isBlank())
                    .orElse(null);
            if (latestSender != null && !latestSender.equals(f.getSenderNickname())) {
                f.setSenderNickname(latestSender);
                changed = true;
            }
            // Refresh receiver nickname from profile
            String latestReceiver = profileRepo.findById(f.getReceiverId())
                    .map(UserProfile::getNickname)
                    .filter(n -> n != null && !n.isBlank())
                    .orElse(null);
            if (latestReceiver != null && !latestReceiver.equals(f.getReceiverNickname())) {
                f.setReceiverNickname(latestReceiver);
                changed = true;
            }
            if (changed) {
                friendshipRepo.save(f);
            }
        }
    }

    /** Check friendship status between two users */
    public Optional<Friendship> getFriendshipBetween(String a, String b) {
        return friendshipRepo.findBetween(a, b);
    }

    /** Save/update a friendship (used for updating read timestamps, etc.) */
    public Friendship saveFriendship(Friendship f) {
        return friendshipRepo.save(f);
    }
}
