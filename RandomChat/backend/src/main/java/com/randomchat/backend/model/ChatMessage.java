package com.randomchat.backend.model;

import jakarta.persistence.*;
import lombok.*;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.datatype.jsr310.ser.LocalDateTimeSerializer;

import java.io.IOException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;

@Entity
@Table(name = "chat_messages")
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class ChatMessage {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(columnDefinition = "TEXT")
    private String content;

    private String senderId;
    private String senderNickname;
    private String roomName;

    @Enumerated(EnumType.STRING)
    private MessageType type;

    private String attachmentUrl;
    private String attachmentType;

    @JsonSerialize(using = LocalDateTimeSerializer.class)
    @JsonDeserialize(using = FlexibleDateTimeDeserializer.class)
    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss")
    private LocalDateTime timestamp;

    @PrePersist
    public void prePersist() {
        if (timestamp == null) {
            timestamp = LocalDateTime.now();
        }
    }

    /**
     * Handles ALL timestamp formats the frontend might send:
     * - "2026-02-28T22:35:09.123Z" (ISO 8601 with ms + Z)
     * - "2026-02-28T22:35:09Z" (ISO 8601 without ms)
     * - "2026-02-28T22:35:09" (plain LocalDateTime)
     * - "2026-02-28T22:35:09.123+05:30" (with offset)
     */
    public static class FlexibleDateTimeDeserializer extends JsonDeserializer<LocalDateTime> {
        @Override
        public LocalDateTime deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
            String text = p.getText().trim();
            if (text.isEmpty())
                return null;
            try {
                // Try ISO instant (handles Z and +offset and ms)
                Instant instant = Instant.parse(text);
                return LocalDateTime.ofInstant(instant, ZoneId.systemDefault());
            } catch (DateTimeParseException e1) {
                try {
                    // Try plain LocalDateTime
                    return LocalDateTime.parse(text, DateTimeFormatter.ISO_LOCAL_DATE_TIME);
                } catch (DateTimeParseException e2) {
                    // Last resort
                    return LocalDateTime.parse(text, DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss"));
                }
            }
        }
    }
}
