package com.randomchat.backend.controller;

import com.cloudinary.Cloudinary;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/files")
@CrossOrigin(origins = "*")
public class FileController {

    @Autowired(required = false)
    private Cloudinary cloudinary;

    private final Path fileStorageLocation;

    public FileController() {
        this.fileStorageLocation = Paths.get("uploads").toAbsolutePath().normalize();
        try {
            Files.createDirectories(this.fileStorageLocation);
        } catch (Exception ex) {
            // Ignore on cloud — ephemeral filesystem
        }
    }

    @PostMapping("/upload")
    public ResponseEntity<Map<String, String>> uploadFile(@RequestParam("file") MultipartFile file) {
        try {
            // If Cloudinary is configured, use cloud storage (production)
            if (cloudinary != null) {
                Map uploadResult = cloudinary.uploader().upload(file.getBytes(), Map.of(
                        "folder", "novachat/chat",
                        "resource_type", "auto"));
                String url = (String) uploadResult.get("secure_url");
                String type = file.getContentType();
                return ResponseEntity.ok(Map.of("url", url, "type", type != null ? type : "application/octet-stream"));
            }

            // Fallback: local file storage (development)
            String fileName = StringUtils.cleanPath(file.getOriginalFilename());
            if (fileName.contains("..")) {
                throw new RuntimeException("Invalid path sequence in filename: " + fileName);
            }
            String uniqueFileName = UUID.randomUUID().toString() + "_" + fileName;
            Path targetLocation = this.fileStorageLocation.resolve(uniqueFileName);
            Files.copy(file.getInputStream(), targetLocation, StandardCopyOption.REPLACE_EXISTING);

            String fileDownloadUri = ServletUriComponentsBuilder.fromCurrentContextPath()
                    .path("/uploads/")
                    .path(uniqueFileName)
                    .toUriString();

            Map<String, String> response = new HashMap<>();
            response.put("url", fileDownloadUri);
            response.put("type", file.getContentType());
            return ResponseEntity.ok(response);

        } catch (IOException ex) {
            return ResponseEntity.internalServerError().body(Map.of("error", "Upload failed: " + ex.getMessage()));
        }
    }
}
