package com.randomchat.backend.controller;

import com.cloudinary.Cloudinary;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import java.util.TreeMap;

/**
 * Provides a signed upload token so the frontend can upload files
 * directly to Cloudinary (browser → Cloudinary, no backend hop).
 * The API secret never leaves the server.
 */
@RestController
@RequestMapping("/api/cloudinary")
@CrossOrigin(origins = "*")
public class CloudinarySignatureController {

    @Autowired(required = false)
    private Cloudinary cloudinary;

    @Value("${cloudinary.cloud_name:}")
    private String cloudName;

    @Value("${cloudinary.api_key:}")
    private String apiKey;

    @Value("${cloudinary.api_secret:}")
    private String apiSecret;

    /**
     * Generate a signed upload signature so the frontend can upload
     * directly to Cloudinary without exposing the API secret.
     *
     * @param folder Cloudinary folder, e.g. "novachat/chat" or "novachat/avatars"
     */
    @GetMapping("/signature")
    public ResponseEntity<?> getUploadSignature(
            @RequestParam(value = "folder", defaultValue = "novachat/chat") String folder) {

        if (cloudinary == null || cloudName.isEmpty()) {
            // Cloudinary not configured → tell frontend to fall back to backend upload
            return ResponseEntity.ok(Map.of("directUpload", false));
        }

        long timestamp = System.currentTimeMillis() / 1000L;

        // Parameters that will be signed (must be sorted alphabetically)
        Map<String, Object> paramsToSign = new TreeMap<>();
        paramsToSign.put("folder", folder);
        paramsToSign.put("timestamp", timestamp);

        String signature = sign(paramsToSign, apiSecret);

        Map<String, Object> response = new HashMap<>();
        response.put("directUpload", true);
        response.put("signature", signature);
        response.put("timestamp", timestamp);
        response.put("cloudName", cloudName);
        response.put("apiKey", apiKey);
        response.put("folder", folder);

        return ResponseEntity.ok(response);
    }

    /**
     * Cloudinary signature: sort params alphabetically, join with "&",
     * append the API secret, and SHA-1 hash the result.
     */
    private String sign(Map<String, Object> params, String secret) {
        TreeMap<String, Object> sorted = new TreeMap<>(params);
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, Object> entry : sorted.entrySet()) {
            if (sb.length() > 0)
                sb.append("&");
            sb.append(entry.getKey()).append("=").append(entry.getValue());
        }
        sb.append(secret);
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] digest = md.digest(sb.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : digest) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (Exception e) {
            throw new RuntimeException("Failed to generate Cloudinary signature", e);
        }
    }
}
