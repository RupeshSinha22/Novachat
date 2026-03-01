package com.randomchat.backend.service;

import com.randomchat.backend.model.Report;
import com.randomchat.backend.model.UserProfile;
import com.randomchat.backend.repository.ReportRepository;
import com.randomchat.backend.repository.UserProfileRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.List;

@Service
@RequiredArgsConstructor
public class UserService {

    private final UserProfileRepository profileRepo;
    private final ReportRepository reportRepo;

    private static final List<String> PROFANITY_LIST = Arrays.asList(
            "fuck", "shit", "bitch", "asshole", "bastard", "cunt", "dick", "pussy",
            "nigger", "faggot", "retard", "whore", "slut");

    public UserProfile getOrCreateProfile(String userId, String nickname) {
        return profileRepo.findById(userId).orElseGet(() -> {
            UserProfile p = UserProfile.builder()
                    .userId(userId)
                    .nickname(nickname != null ? nickname : generateNickname())
                    .reputationScore(100)
                    .build();
            return profileRepo.save(p);
        });
    }

    public UserProfile updateProfile(String userId, String nickname, String avatarUrl,
            String country, String language, String interests, String gender, Boolean publicProfile) {
        UserProfile p = profileRepo.findById(userId)
                .orElseGet(() -> UserProfile.builder().userId(userId).reputationScore(100).build());
        if (nickname != null && !nickname.isBlank())
            p.setNickname(nickname);
        if (avatarUrl != null)
            p.setAvatarUrl(avatarUrl);
        if (country != null)
            p.setCountry(country);
        if (language != null)
            p.setLanguage(language);
        if (interests != null)
            p.setInterests(interests);
        if (gender != null && !gender.isBlank())
            p.setGender(gender);
        if (publicProfile != null)
            p.setPublicProfile(publicProfile);
        if (gender != null && !gender.isBlank())
            p.setGender(gender);
        return profileRepo.save(p);
    }

    public void markAgeVerified(String userId) {
        UserProfile p = profileRepo.findById(userId).orElse(null);
        if (p != null) {
            p.setAgeVerified(true);
            p.setTermsAccepted(true);
            profileRepo.save(p);
        }
    }

    public Report submitReport(String reporterId, String reportedId, String roomName,
            Report.ReportReason reason, String details) {
        // Deduct reputation on report
        profileRepo.findById(reportedId).ifPresent(p -> {
            p.setReputationScore(Math.max(0, p.getReputationScore() - 5));
            profileRepo.save(p);
        });

        Report r = Report.builder()
                .reporterId(reporterId)
                .reportedId(reportedId)
                .roomName(roomName)
                .reason(reason)
                .details(details)
                .reviewed(false)
                .build();
        return reportRepo.save(r);
    }

    public boolean isBanned(String userId) {
        return profileRepo.findById(userId).map(UserProfile::isBanned).orElse(false);
    }

    public void banUser(String userId) {
        profileRepo.findById(userId).ifPresent(p -> {
            p.setBanned(true);
            profileRepo.save(p);
        });
    }

    public void unbanUser(String userId) {
        profileRepo.findById(userId).ifPresent(p -> {
            p.setBanned(false);
            profileRepo.save(p);
        });
    }

    public String filterProfanity(String text) {
        if (text == null)
            return text;
        String lower = text.toLowerCase();
        for (String word : PROFANITY_LIST) {
            lower = lower.replace(word, "*".repeat(word.length()));
        }
        return lower;
    }

    public String generateNickname() {
        String[] adjectives = { "Swift", "Cosmic", "Shadow", "Neon", "Frost", "Blaze", "Storm", "Ghost", "Luna",
                "Echo" };
        String[] nouns = { "Wolf", "Tiger", "Phoenix", "Raven", "Cipher", "Nova", "Vortex", "Hawk", "Drake", "Fox" };
        int num = (int) (Math.random() * 9000) + 1000;
        return adjectives[(int) (Math.random() * adjectives.length)] +
                nouns[(int) (Math.random() * nouns.length)] + num;
    }

    public List<Report> getPendingReports() {
        return reportRepo.findByReviewedFalseOrderByCreatedAtDesc();
    }

    public List<UserProfile> getAllUsers() {
        return profileRepo.findAll();
    }

    public void grantPremium(String userId) {
        UserProfile p = profileRepo.findById(userId)
                .orElseGet(() -> UserProfile.builder().userId(userId).reputationScore(100).build());
        p.setPremium(true);
        p.setPremiumSince(java.time.LocalDateTime.now());
        profileRepo.save(p);
    }

    public long getPendingReportCount() {
        return reportRepo.countByReviewedFalse();
    }
}
