package com.randomchat.backend.config;

import com.cloudinary.Cloudinary;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.Map;

@Configuration
public class CloudinaryConfig {
    @Value("${cloudinary.cloud_name:}")
    private String cloudName;

    @Value("${cloudinary.api_key:}")
    private String apiKey;

    @Value("${cloudinary.api_secret:}")
    private String apiSecret;

    @Bean
    public Cloudinary cloudinary() {
        if (cloudName == null || cloudName.isEmpty()) {
            // Return null for local dev (falls back to local file storage)
            return null;
        }
        return new Cloudinary(Map.of(
                "cloud_name", cloudName,
                "api_key", apiKey,
                "api_secret", apiSecret));
    }
}
