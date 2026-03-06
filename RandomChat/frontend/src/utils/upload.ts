/**
 * Direct Cloudinary Upload Utility
 * 
 * Uploads files directly from the browser → Cloudinary CDN, 
 * bypassing the backend server entirely. This is 3-5x faster
 * because the file only travels once over the network.
 * 
 * Falls back to backend upload for local development when
 * Cloudinary is not configured.
 */

const API = import.meta.env.VITE_API_URL || 'http://localhost:8080/api';

// ── Image Compression ──────────────────────────────────

/**
 * Compress an image using the Canvas API before uploading.
 * - Resizes to maxWidth (preserving aspect ratio)
 * - Converts to JPEG with reduced quality
 * - Skips GIFs and non-image files
 * - Skips tiny files (< 200KB) where compression isn't worth it
 */
export async function compressImage(
    file: File,
    maxWidth = 1920,
    quality = 0.82
): Promise<File> {
    // Only compress raster images (skip GIFs to preserve animation)
    if (!file.type.startsWith('image/') || file.type === 'image/gif') {
        return file;
    }
    // Skip tiny files — compression overhead isn't worth it
    if (file.size < 200 * 1024) {
        return file;
    }

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(img.src);
            let { width, height } = img;

            // Skip if already small enough
            if (width <= maxWidth && file.size < 1024 * 1024) {
                resolve(file);
                return;
            }

            // Scale down if wider than maxWidth
            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
                (blob) => {
                    if (blob && blob.size < file.size) {
                        // Compression helped — use the smaller version
                        const name = file.name.replace(/\.\w+$/, '.jpg');
                        resolve(new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() }));
                    } else {
                        // Compressed version is bigger — keep original
                        resolve(file);
                    }
                },
                'image/jpeg',
                quality
            );
        };
        img.onerror = () => resolve(file);
        img.src = URL.createObjectURL(file);
    });
}

// ── Upload ─────────────────────────────────────────────

export interface UploadResult {
    url: string;
    type: string;
}

/**
 * Upload a file to cloud storage. 
 *
 * Strategy:
 * 1. Compress the image (if applicable)
 * 2. Request a signed Cloudinary token from the backend
 * 3a. If Cloudinary is configured → upload directly (fast!)
 * 3b. Otherwise → fall back to uploading through the backend
 */
export async function directUpload(
    file: File,
    folder = 'novachat/chat'
): Promise<UploadResult | null> {
    // Step 1: Compress images
    const processedFile = await compressImage(file);

    try {
        // Step 2: Get a signed token from our backend
        const sigRes = await fetch(
            `${API}/cloudinary/signature?folder=${encodeURIComponent(folder)}`
        );

        if (sigRes.ok) {
            const sigData = await sigRes.json();

            if (sigData.directUpload) {
                // Step 3a: Direct upload to Cloudinary CDN (fast path!)
                const form = new FormData();
                form.append('file', processedFile);
                form.append('api_key', sigData.apiKey);
                form.append('timestamp', String(sigData.timestamp));
                form.append('signature', sigData.signature);
                form.append('folder', sigData.folder);

                const cloudRes = await fetch(
                    `https://api.cloudinary.com/v1_1/${sigData.cloudName}/auto/upload`,
                    { method: 'POST', body: form }
                );

                if (!cloudRes.ok) {
                    const errBody = await cloudRes.text();
                    console.error('[upload] Cloudinary rejected upload:', errBody);
                    throw new Error('Cloudinary upload failed');
                }

                const cloudData = await cloudRes.json();
                return {
                    url: cloudData.secure_url,
                    type: processedFile.type || file.type || 'application/octet-stream',
                };
            }
        }
    } catch (err) {
        console.warn('[upload] Direct upload failed, falling back to backend:', err);
    }

    // Step 3b: Fallback — upload through the backend (local dev or error)
    try {
        const form = new FormData();
        form.append('file', processedFile);
        const res = await fetch(`${API}/files/upload`, { method: 'POST', body: form });
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
}
