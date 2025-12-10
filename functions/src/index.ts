import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import JSZip from "jszip";
import sharp from "sharp";

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();
const storage = admin.storage();

// API config
const PIXELLAB_API_KEY = process.env.PIXELLAB_API_KEY || "9bb378e0-6b46-442d-9019-96216f8e8ba7";
const PIXELLAB_API_V2_URL = "https://api.pixellab.ai/v2";

const DIRECTIONS = [
    "south", "south-west", "west", "north-west",
    "north", "north-east", "east", "south-east"
] as const;

interface RetryInfo {
    type: "rate_limit" | "timeout" | "error";
    attempt: number;
    maxAttempts: number;
    direction?: string;
    phase?: string;
    waitMs: number;
    message: string;
}

interface SpriteJob {
    status: "pending" | "generating" | "complete" | "error";
    description: string;
    progress: number;
    total: number;
    currentPhase?: string;
    rotationsReady?: boolean;
    characterId?: string;
    lastRetry?: RetryInfo;
    error?: string;
    createdAt: admin.firestore.Timestamp;
    updatedAt: admin.firestore.Timestamp;
}

const MAX_RETRIES = 8;
const FETCH_TIMEOUT_MS = 60000; // 60 seconds
const POLL_TIMEOUT_MS = 300000; // 5 minutes for background jobs

// Fetch with timeout using AbortController
async function fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        return response;
    } finally {
        clearTimeout(timeout);
    }
}

// V2 API POST helper
async function fetchPixellabV2(
    apiKey: string,
    endpoint: string,
    body: object,
    timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<Response> {
    return fetchWithTimeout(
        `${PIXELLAB_API_V2_URL}/${endpoint}`,
        {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        },
        timeoutMs
    );
}

// V2 API GET helper
async function getPixellabV2(
    apiKey: string,
    endpoint: string,
    timeoutMs: number = 30000
): Promise<Response> {
    return fetchWithTimeout(
        `${PIXELLAB_API_V2_URL}/${endpoint}`,
        {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
            },
        },
        timeoutMs
    );
}

// Poll V2 background job until complete
async function pollBackgroundJob(
    apiKey: string,
    jobId: string,
    jobType: string,
    jobRef: admin.firestore.DocumentReference,
    maxWaitTime: number = POLL_TIMEOUT_MS
): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 3000; // 3 seconds
    let pollCount = 0;

    while (Date.now() - startTime < maxWaitTime) {
        pollCount++;

        try {
            const response = await getPixellabV2(apiKey, `background-jobs/${jobId}`);

            if (!response.ok) {
                throw new Error(`Failed to poll job ${jobId}: ${response.status}`);
            }

            const data = await response.json();
            const queuePos = data.last_response?.queue_position;
            const statusDetail = data.last_response?.status || data.status;

            console.log(`[pollJob ${jobType}] Poll #${pollCount} - Status: ${data.status}, Detail: ${statusDetail}, Queue: ${queuePos}`);

            if (data.status === "completed" || data.status === "complete") {
                console.log(`[pollJob ${jobType}] Job complete!`);
                return;
            } else if (data.status === "failed" || data.status === "error") {
                const errorMsg = data.error || data.last_response?.error || "Unknown error";
                throw new Error(`Job ${jobId} failed: ${errorMsg}`);
            }

            // Update progress in Firestore with queue position
            const phaseMsg = queuePos
                ? `${jobType} (queue position: ${queuePos})`
                : `${jobType} (${statusDetail})`;

            await jobRef.update({
                currentPhase: phaseMsg,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

        } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                console.log(`[pollJob ${jobType}] Poll #${pollCount} timed out, retrying...`);
            } else {
                throw error;
            }
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Job ${jobId} timed out after ${maxWaitTime}ms`);
}

// Download image from URL and upload to Firebase Storage
async function downloadAndUploadToStorage(
    imageUrl: string,
    storagePath: string
): Promise<string> {
    // Download image from Pixellab's Backblaze
    const response = await fetchWithTimeout(imageUrl, { method: "GET" }, 30000);

    if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Firebase Storage
    const bucket = storage.bucket();
    const file = bucket.file(storagePath);

    await file.save(buffer, {
        metadata: {
            contentType: "image/png",
        },
    });

    // Make publicly accessible
    await file.makePublic();

    return `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
}

// Create character with retries (handles rate limits and timeouts)
async function createCharacterWithRetries(
    apiKey: string,
    description: string,
    jobRef: admin.firestore.DocumentReference,
    jobId: string
): Promise<{ characterId: string; backgroundJobId: string }> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[${jobId}] Creating character - Attempt ${attempt}/${MAX_RETRIES}`);

            const response = await fetchPixellabV2(apiKey, "create-character-with-8-directions", {
                description,
                image_size: { width: 64, height: 64 },
                view: "low top-down",
                outline: "single color outline",
                shading: "medium shading",
                detail: "medium detail",
            });

            if (response.status === 429) {
                const waitMs = Math.pow(2, attempt) * 2000;
                const retryInfo: RetryInfo = {
                    type: "rate_limit",
                    attempt,
                    maxAttempts: MAX_RETRIES,
                    phase: "character_creation",
                    waitMs,
                    message: `Rate limited, waiting ${waitMs / 1000}s before retry`,
                };

                console.log(`[${jobId}] ${retryInfo.message}`);
                await jobRef.update({
                    lastRetry: retryInfo,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });

                await new Promise(resolve => setTimeout(resolve, waitMs));
                continue;
            }

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Character creation failed: ${response.status} - ${errorText}`);
            }

            const data = await response.json();

            // V2 API returns these fields directly (not nested in data)
            return {
                characterId: data.character_id,
                backgroundJobId: data.background_job_id,
            };

        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            const isTimeout = lastError.name === "AbortError";

            const waitMs = Math.pow(2, attempt) * 2000;
            const retryInfo: RetryInfo = {
                type: isTimeout ? "timeout" : "error",
                attempt,
                maxAttempts: MAX_RETRIES,
                phase: "character_creation",
                waitMs,
                message: isTimeout
                    ? `Request timed out, waiting ${waitMs / 1000}s before retry`
                    : `Error: ${lastError.message}, waiting ${waitMs / 1000}s before retry`,
            };

            console.log(`[${jobId}] ${retryInfo.message}`);
            await jobRef.update({
                lastRetry: retryInfo,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            if (attempt < MAX_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, waitMs));
            }
        }
    }

    throw lastError || new Error(`Character creation failed after ${MAX_RETRIES} attempts`);
}

// Main processing function using V2 API
async function processJob(
    jobId: string,
    description: string,
    userUid: string,
    spriteId: string
): Promise<void> {
    const jobRef = db.collection("spriteJobs").doc(jobId);
    const apiKey = PIXELLAB_API_KEY;
    const storagePath = `sprites/${userUid}/${spriteId}`;

    try {
        // Step 1: Create character with 8 directions using V2 API
        await jobRef.update({
            status: "generating",
            currentPhase: "creating character (8 directions)",
            progress: 0,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[${jobId}] Step 1: Creating character with V2 API...`);

        const { characterId, backgroundJobId } = await createCharacterWithRetries(
            apiKey,
            description,
            jobRef,
            jobId
        );

        console.log(`[${jobId}] Character job started: ${backgroundJobId}, characterId: ${characterId}`);

        // Poll until character creation completes
        await jobRef.update({
            currentPhase: "waiting for character generation",
            characterId,
            progress: 1,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await pollBackgroundJob(apiKey, backgroundJobId, "character", jobRef);

        console.log(`[${jobId}] Character created! Fetching rotation URLs...`);

        // Step 2: Get character details to get rotation URLs
        await jobRef.update({
            currentPhase: "fetching rotation images",
            progress: 2,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        const charResponse = await getPixellabV2(apiKey, `characters/${characterId}`);
        if (!charResponse.ok) {
            throw new Error(`Failed to get character: ${charResponse.status}`);
        }

        const charData = await charResponse.json();
        const rotationUrls = charData.rotation_urls;

        if (!rotationUrls) {
            throw new Error("No rotation URLs in character response");
        }

        console.log(`[${jobId}] Got rotation URLs, uploading to Firebase Storage...`);

        // Step 3: Download images and upload to Firebase Storage
        await jobRef.update({
            currentPhase: "uploading to storage",
            progress: 3,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        const storagePaths: Record<string, string> = {};

        for (const direction of DIRECTIONS) {
            const pixellabUrl = rotationUrls[direction];

            if (!pixellabUrl) {
                console.warn(`[${jobId}] No URL for direction: ${direction}`);
                continue;
            }

            const filePath = `${storagePath}/rotations/${direction}.png`;
            const publicUrl = await downloadAndUploadToStorage(pixellabUrl, filePath);
            storagePaths[direction] = publicUrl;

            console.log(`[${jobId}] Uploaded ${direction} to Storage`);
        }

        // Mark rotations as ready - client can now update cursor
        await jobRef.update({
            currentPhase: "rotations complete",
            rotationsReady: true,
            storagePaths,
            progress: 4,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[${jobId}] All rotations uploaded! rotationsReady: true`);

        // For now, mark as complete (animations will be added in next step)
        await jobRef.update({
            status: "complete",
            currentPhase: null,
            progress: DIRECTIONS.length,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[${jobId}] Complete!`);

    } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[${jobId}] Error:`, errMsg);

        await jobRef.update({
            status: "error",
            error: errMsg,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
}

// Main endpoint - handles both POST (start) and GET (status)
export const generateSprite = onRequest(
    {
        timeoutSeconds: 3600,
        memory: "512MiB",
        cors: true,
    },
    async (req, res) => {
        // Handle preflight
        if (req.method === "OPTIONS") {
            res.status(204).send("");
            return;
        }

        // GET - Poll job status
        if (req.method === "GET") {
            const jobId = req.query.jobId as string;

            if (!jobId) {
                res.status(400).json({ error: "jobId query parameter required" });
                return;
            }

            try {
                const jobDoc = await db.collection("spriteJobs").doc(jobId).get();

                if (!jobDoc.exists) {
                    res.status(404).json({ error: "Job not found" });
                    return;
                }

                const job = jobDoc.data() as SpriteJob & { storagePaths?: Record<string, string> };

                // Build response based on status
                const response: any = {
                    jobId,
                    status: job.status,
                    progress: job.progress,
                    total: job.total,
                };

                if (job.status === "complete") {
                    response.rotationsReady = job.rotationsReady;
                    response.storagePaths = job.storagePaths;
                    response.characterId = job.characterId;
                } else if (job.status === "error") {
                    response.error = job.error;
                } else {
                    // Still generating
                    response.currentPhase = job.currentPhase;
                    response.rotationsReady = job.rotationsReady;
                    response.lastRetry = job.lastRetry;

                    // Include storage paths if rotations are ready
                    if (job.rotationsReady) {
                        response.storagePaths = job.storagePaths;
                    }
                }

                res.status(200).json(response);

            } catch (error) {
                const errMsg = error instanceof Error ? error.message : "Unknown error";
                res.status(500).json({ error: errMsg });
            }
            return;
        }

        // POST - Start new job
        if (req.method === "POST") {
            const { description, userUid, spriteId } = req.body;

            if (!description || typeof description !== "string") {
                res.status(400).json({ error: "description is required" });
                return;
            }

            if (!userUid || typeof userUid !== "string") {
                res.status(400).json({ error: "userUid is required" });
                return;
            }

            if (!spriteId || typeof spriteId !== "string") {
                res.status(400).json({ error: "spriteId is required" });
                return;
            }

            try {
                // Create job document
                const jobRef = db.collection("spriteJobs").doc();
                const jobId = jobRef.id;

                const now = admin.firestore.FieldValue.serverTimestamp();
                await jobRef.set({
                    status: "pending",
                    description,
                    userUid,
                    spriteId,
                    progress: 0,
                    total: DIRECTIONS.length,
                    createdAt: now,
                    updatedAt: now,
                });

                console.log(`[${jobId}] Job created for user ${userUid}, sprite ${spriteId}: "${description}"`);

                // Start processing in background (don't await)
                processJob(jobId, description, userUid, spriteId).catch(err => {
                    console.error(`[${jobId}] Background processing failed:`, err);
                });

                // Return immediately with job ID
                res.status(202).json({
                    jobId,
                    status: "pending",
                    message: `Poll GET /generateSprite?jobId=${jobId} for status`,
                });

            } catch (error) {
                const errMsg = error instanceof Error ? error.message : "Unknown error";
                console.error("Failed to create job:", errMsg);
                res.status(500).json({ error: errMsg });
            }
            return;
        }

        res.status(405).json({ error: "Method not allowed" });
    }
);

// Animation job interface
interface AnimationJob {
    status: "pending" | "generating" | "complete" | "partial" | "error";
    characterId: string;
    userUid: string;
    spriteId: string;
    progress: number;
    total: number;
    currentPhase?: string;
    completedDirections?: string[];
    missingDirections?: string[];
    error?: string;
    createdAt: admin.firestore.Timestamp;
    updatedAt: admin.firestore.Timestamp;
}

// Process animation job
async function processAnimationJob(
    jobId: string,
    characterId: string,
    userUid: string,
    spriteId: string,
    directionsToUpload: string[] | null = null // Only upload these directions (null = all)
): Promise<void> {
    const jobRef = db.collection("animationJobs").doc(jobId);
    const apiKey = PIXELLAB_API_KEY;
    const storagePath = `sprites/${userUid}/${spriteId}`;

    try {
        await jobRef.update({
            status: "generating",
            currentPhase: "requesting animation",
            progress: 0,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[${jobId}] Starting animation for character ${characterId}`);

        // Step 1: Request walk animation
        const animPayload: any = {
            character_id: characterId,
            template_animation_id: "walking-8-frames",
        };

        if (directionsToUpload && directionsToUpload.length > 0) {
            animPayload.directions = directionsToUpload;
            console.log(`[${jobId}] Requesting animation only for: ${directionsToUpload.join(", ")}`);
        }

        const animResponse = await fetchPixellabV2(apiKey, "animate-character", animPayload);

        if (!animResponse.ok) {
            const errText = await animResponse.text();
            throw new Error(`Animation request failed: ${animResponse.status} - ${errText}`);
        }

        const animData = await animResponse.json();

        // Log full response to debug field names
        console.log(`[${jobId}] Animation API response:`, JSON.stringify(animData, null, 2));

        // The animate-character endpoint returns:
        // - background_job_ids: array of job IDs (one per direction)
        // - directions: array of direction names being animated
        const backgroundJobIds: string[] = animData.background_job_ids || [];
        const animDirections: string[] = animData.directions || [];

        if (backgroundJobIds.length === 0) {
            // No jobs means all directions already have animations
            console.log(`[${jobId}] All directions already have animations, fetching frames...`);
        } else {
            console.log(`[${jobId}] Animation jobs started for ${animDirections.length} directions:`, animDirections);
            console.log(`[${jobId}] Job IDs:`, backgroundJobIds);

            // Step 2: Poll ALL jobs until complete (track successes/failures)
            await jobRef.update({
                currentPhase: `generating ${animDirections.length} directions`,
                progress: 1,
                animatingDirections: animDirections,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            const jobResults: { direction: string; jobId: string; success: boolean; error?: string }[] = [];

            // Poll all jobs in parallel
            const pollPromises = backgroundJobIds.map(async (bgJobId, index) => {
                const direction = animDirections[index] || `direction_${index}`;
                try {
                    await pollBackgroundJob(apiKey, bgJobId, `animation-${direction}`, jobRef);
                    console.log(`[${jobId}] Direction ${direction} completed successfully`);
                    return { direction, jobId: bgJobId, success: true };
                } catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    console.warn(`[${jobId}] Direction ${direction} failed: ${errMsg}`);
                    return { direction, jobId: bgJobId, success: false, error: errMsg };
                }
            });

            const results = await Promise.all(pollPromises);
            jobResults.push(...results);

            const succeeded = results.filter(r => r.success);
            const failed = results.filter(r => !r.success);

            console.log(`[${jobId}] Animation results: ${succeeded.length} succeeded, ${failed.length} failed`);

            // Store which directions failed for potential retry
            if (failed.length > 0) {
                await jobRef.update({
                    failedDirections: failed.map(f => f.direction),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }

            if (succeeded.length === 0 && backgroundJobIds.length > 0) {
                throw new Error(`All animation jobs failed. First error: ${failed[0]?.error || "Unknown error"}`);
            }
        }

        console.log(`[${jobId}] Animation generation complete, downloading ZIP...`);

        // Step 3: Download character ZIP (contains all animation frames)
        await jobRef.update({
            currentPhase: "downloading character ZIP",
            progress: 2,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // The /characters/{id}/zip endpoint is the ONLY way to get animation frame data
        const zipResponse = await getPixellabV2(apiKey, `characters/${characterId}/zip`, 120000);
        if (!zipResponse.ok) {
            const errText = await zipResponse.text();
            throw new Error(`Failed to download character ZIP: ${zipResponse.status} - ${errText}`);
        }

        const zipBuffer = await zipResponse.arrayBuffer();
        console.log(`[${jobId}] Downloaded ZIP: ${zipBuffer.byteLength} bytes`);

        // Step 4: Extract animation frames from ZIP
        await jobRef.update({
            currentPhase: "extracting animation frames",
            progress: 3,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        const zip = await JSZip.loadAsync(zipBuffer);

        // Parse metadata.json to get animation structure
        const metadataFile = zip.file("metadata.json");
        if (!metadataFile) {
            throw new Error("No metadata.json found in ZIP");
        }

        const metadataJson = await metadataFile.async("string");
        const metadata = JSON.parse(metadataJson);
        console.log(`[${jobId}] ZIP metadata loaded`);

        // Get walking animation frames from metadata
        const walkAnimData = metadata.frames?.animations?.["walking-8-frames"];
        if (!walkAnimData) {
            console.error(`[${jobId}] No walking-8-frames in metadata. Available:`,
                Object.keys(metadata.frames?.animations || {})
            );
            throw new Error("No walking-8-frames animation found in ZIP");
        }

        // Step 5: Upload animation frames to Firebase Storage
        await jobRef.update({
            currentPhase: "uploading animation frames",
            progress: 4,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        const allFramePaths: Record<string, string[]> = {};
        const bucket = storage.bucket();

        // Determine which directions to process
        const directionsToProcess = directionsToUpload || DIRECTIONS;
        console.log(`[${jobId}] Processing directions: ${directionsToProcess.join(", ")}`);

        for (const direction of directionsToProcess) {
            const framePaths = walkAnimData[direction];
            if (!framePaths || !Array.isArray(framePaths)) {
                console.log(`[${jobId}] No frames for direction: ${direction}`);
                continue;
            }

            // Deduplicate frame paths (ZIP metadata may repeat frames)
            const uniqueFramePaths = [...new Set(framePaths)];
            console.log(`[${jobId}] ${direction}: ${uniqueFramePaths.length} unique frames`);

            allFramePaths[direction] = [];

            for (let i = 0; i < uniqueFramePaths.length; i++) {
                const zipPath = uniqueFramePaths[i]; // e.g., "animations/walking-8-frames/south/frame_000.png"
                const frameFile = zip.file(zipPath);

                if (!frameFile) {
                    console.warn(`[${jobId}] Frame not found in ZIP: ${zipPath}`);
                    continue;
                }

                try {
                    const frameData = await frameFile.async("nodebuffer");
                    const storageDest = `${storagePath}/walk_frames/${direction}_${i}.png`;

                    const file = bucket.file(storageDest);
                    await file.save(frameData, {
                        metadata: { contentType: "image/png" },
                    });
                    await file.makePublic();

                    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storageDest}`;
                    allFramePaths[direction].push(publicUrl);

                    console.log(`[${jobId}] Uploaded ${direction} frame ${i}`);
                } catch (err) {
                    console.warn(`[${jobId}] Failed to upload ${direction} frame ${i}:`, err);
                }
            }
        }

        // Determine which directions were completed
        const downloadedDirections = Object.keys(allFramePaths).filter(d => allFramePaths[d].length > 0);
        const missingDirections = DIRECTIONS.filter(d => !allFramePaths[d] || allFramePaths[d].length === 0);
        const isPartial = downloadedDirections.length < DIRECTIONS.length;

        await jobRef.update({
            status: isPartial ? "partial" : "complete",
            currentPhase: null,
            progress: downloadedDirections.length,
            totalDirections: DIRECTIONS.length,
            completedDirections: downloadedDirections,
            missingDirections: missingDirections,
            framePaths: allFramePaths,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Update metadata.json with animation status
        try {
            const metadataPath = `${storagePath}/metadata.json`;
            const metadataFile = bucket.file(metadataPath);

            // Read existing metadata
            const [exists] = await metadataFile.exists();
            let metadata: any = {};

            if (exists) {
                const [content] = await metadataFile.download();
                metadata = JSON.parse(content.toString());
            }

            // Update with animation results
            metadata.animation = {
                status: isPartial ? "partial" : "complete",
                completedDirections: downloadedDirections,
                missingDirections: missingDirections,
                framePaths: allFramePaths,
                lastUpdated: new Date().toISOString(),
            };

            await metadataFile.save(JSON.stringify(metadata, null, 2), {
                metadata: { contentType: "application/json" },
            });

            console.log(`[${jobId}] Metadata updated with animation status`);
        } catch (err) {
            console.warn(`[${jobId}] Failed to update metadata:`, err);
        }

        if (isPartial) {
            console.log(`[${jobId}] Animation partially complete: ${downloadedDirections.length}/${DIRECTIONS.length} directions`);
            console.log(`[${jobId}] Missing: ${missingDirections.join(', ')}`);
        } else {
            console.log(`[${jobId}] Animation complete! All ${DIRECTIONS.length} directions`);
        }

    } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[${jobId}] Animation error:`, errMsg);

        await jobRef.update({
            status: "error",
            error: errMsg,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
}

// Animation endpoint
export const animateSprite = onRequest(
    {
        timeoutSeconds: 3600,
        memory: "512MiB",
        cors: true,
    },
    async (req, res) => {
        // Handle preflight
        if (req.method === "OPTIONS") {
            res.status(204).send("");
            return;
        }

        // GET - Poll job status
        if (req.method === "GET") {
            const jobId = req.query.jobId as string;

            if (!jobId) {
                res.status(400).json({ error: "jobId query parameter required" });
                return;
            }

            try {
                const jobDoc = await db.collection("animationJobs").doc(jobId).get();

                if (!jobDoc.exists) {
                    res.status(404).json({ error: "Job not found" });
                    return;
                }

                const job = jobDoc.data() as AnimationJob & { framePaths?: Record<string, string[]> };

                const response: any = {
                    jobId,
                    status: job.status,
                    progress: job.progress,
                    total: job.total,
                };

                if (job.status === "complete" || job.status === "partial") {
                    response.framePaths = job.framePaths;
                    response.completedDirections = job.completedDirections;
                    response.missingDirections = job.missingDirections;
                } else if (job.status === "error") {
                    response.error = job.error;
                } else {
                    response.currentPhase = job.currentPhase;
                }

                res.status(200).json(response);

            } catch (error) {
                const errMsg = error instanceof Error ? error.message : "Unknown error";
                res.status(500).json({ error: errMsg });
            }
            return;
        }

        // POST - Start new animation job
        if (req.method === "POST") {
            const { characterId, userUid, spriteId, directionsToUpload } = req.body;

            if (!characterId || typeof characterId !== "string") {
                res.status(400).json({ error: "characterId is required" });
                return;
            }

            if (!userUid || typeof userUid !== "string") {
                res.status(400).json({ error: "userUid is required" });
                return;
            }

            // Optional: only upload specific directions (for retry/continue scenarios)
            let targetDirections: string[] | null = null;
            if (directionsToUpload && Array.isArray(directionsToUpload)) {
                targetDirections = directionsToUpload.filter((d: any) => typeof d === "string" && DIRECTIONS.includes(d as any));
                console.log(`[animateSprite] Will only upload directions: ${targetDirections.join(", ")}`);
            }

            if (!spriteId || typeof spriteId !== "string") {
                res.status(400).json({ error: "spriteId is required" });
                return;
            }

            try {
                const jobRef = db.collection("animationJobs").doc();
                const jobId = jobRef.id;

                const now = admin.firestore.FieldValue.serverTimestamp();
                await jobRef.set({
                    status: "pending",
                    characterId,
                    userUid,
                    spriteId,
                    progress: 0,
                    total: DIRECTIONS.length,
                    createdAt: now,
                    updatedAt: now,
                });

                console.log(`[${jobId}] Animation job created for character ${characterId}`);

                // Start processing in background
                processAnimationJob(jobId, characterId, userUid, spriteId, targetDirections).catch(err => {
                    console.error(`[${jobId}] Background animation failed:`, err);
                });

                res.status(202).json({
                    jobId,
                    status: "pending",
                    message: `Poll GET /animateSprite?jobId=${jobId} for status`,
                });

            } catch (error) {
                const errMsg = error instanceof Error ? error.message : "Unknown error";
                console.error("Failed to create animation job:", errMsg);
                res.status(500).json({ error: errMsg });
            }
            return;
        }

        res.status(405).json({ error: "Method not allowed" });
    }
);

// One-shot function to upload sprite sheets directly
// POST /uploadSprites { characterId, userId, spriteId, idleBase64, walkBase64 }
export const uploadSprites = onRequest(
    {
        timeoutSeconds: 60,
        memory: "256MiB",
        cors: true,
    },
    async (req, res) => {
        if (req.method === "OPTIONS") {
            res.status(204).send("");
            return;
        }

        if (req.method !== "POST") {
            res.status(405).json({ error: "Method not allowed" });
            return;
        }

        try {
            let { characterId, userId, spriteId, idleBase64, walkBase64 } = req.body;

            if (!characterId) {
                res.status(400).json({ error: "characterId required" });
                return;
            }

            const bucket = storage.bucket("nara-a65bc.firebasestorage.app");

            // If userId/spriteId not provided, search by characterId
            if (!userId || !spriteId) {
                console.log(`Searching for sprite with characterId: ${characterId}`);
                const [files] = await bucket.getFiles({ prefix: "sprites/" });
                let found = false;

                for (const file of files) {
                    if (file.name.endsWith("metadata.json")) {
                        try {
                            const [content] = await file.download();
                            const metadata = JSON.parse(content.toString());
                            if (metadata.characterId === characterId) {
                                const parts = file.name.split("/");
                                userId = parts[1];
                                spriteId = parts[2];
                                console.log(`Found sprite: userId=${userId}, spriteId=${spriteId}`);
                                found = true;
                                break;
                            }
                        } catch (e) {
                            // Skip files that can't be parsed
                        }
                    }
                }

                if (!found) {
                    res.status(404).json({ error: "Sprite not found for characterId: " + characterId });
                    return;
                }
            }

            const storagePath = `sprites/${userId}/${spriteId}`;
            const results: string[] = [];

            // Upload idle.png if provided
            if (idleBase64) {
                const idleBuffer = Buffer.from(idleBase64, "base64");
                const idleFile = bucket.file(`${storagePath}/idle.png`);
                await idleFile.save(idleBuffer, {
                    metadata: {
                        contentType: "image/png",
                        metadata: { firebaseStorageDownloadTokens: require("crypto").randomUUID() }
                    }
                });
                results.push("idle.png uploaded");
                console.log(`Uploaded idle.png to ${storagePath}`);
            }

            // Upload walk.png if provided
            if (walkBase64) {
                const walkBuffer = Buffer.from(walkBase64, "base64");
                const walkFile = bucket.file(`${storagePath}/walk.png`);
                await walkFile.save(walkBuffer, {
                    metadata: {
                        contentType: "image/png",
                        metadata: { firebaseStorageDownloadTokens: require("crypto").randomUUID() }
                    }
                });
                results.push("walk.png uploaded");
                console.log(`Uploaded walk.png to ${storagePath}`);
            }

            res.status(200).json({
                success: true,
                storagePath,
                results
            });

        } catch (error) {
            const errMsg = error instanceof Error ? error.message : "Unknown error";
            console.error("Upload error:", errMsg);
            res.status(500).json({ error: errMsg });
        }
    }
);

// ... (existing exports)

// Tileset job interface
interface TilesetJob {
    status: "pending" | "generating" | "complete" | "error";
    description: string;
    userUid: string;
    tilesetId: string;
    progress: number;
    currentPhase?: string;
    imageUrl?: string;
    error?: string;
    createdAt: admin.firestore.Timestamp;
    updatedAt: admin.firestore.Timestamp;
}

// Process tileset job
async function processTilesetJob(
    jobId: string,
    description: string,
    userUid: string,
    tilesetId: string
): Promise<void> {
    const jobRef = db.collection("tilesetJobs").doc(jobId);
    const apiKey = PIXELLAB_API_KEY;
    const storagePath = `tilesets/${userUid}/${tilesetId}/tileset.png`;
    const metadataPath = `tilesets/${userUid}/${tilesetId}/metadata.json`;

    try {
        await jobRef.update({
            status: "generating",
            currentPhase: "requesting tileset",
            progress: 0,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[${jobId}] Starting tileset generation: "${description}"`);

        // Step 1: Request tileset using the v2 tilesets endpoint
        const response = await fetchPixellabV2(apiKey, "tilesets", {
            upper_description: description,
            lower_description: "simple background",
            tile_size: { width: 32, height: 32 },
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Tileset request failed: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        const backgroundJobId = data.background_job_id;
        const pixellabTilesetId = data.tileset_id;

        console.log(`[${jobId}] Tileset job started: ${backgroundJobId}, tileset_id: ${pixellabTilesetId}`);

        // Step 2: Poll job
        await jobRef.update({
            currentPhase: "generating tileset",
            progress: 1,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await pollBackgroundJob(apiKey, backgroundJobId, "tileset", jobRef);

        console.log(`[${jobId}] Tileset generated! Fetching and remapping...`);

        // Step 3: Fetch PNG and metadata from MCP endpoints, then remap to corner-index order
        // The MCP endpoints provide proper metadata with corner info for each tile
        const mcpBaseUrl = "https://api.pixellab.ai/mcp/tilesets";

        console.log(`[${jobId}] Fetching tileset image from MCP endpoint...`);
        const pngResponse = await fetchWithTimeout(`${mcpBaseUrl}/${pixellabTilesetId}/image`, {
            headers: { "Authorization": `Bearer ${apiKey}` }
        });

        if (!pngResponse.ok) {
            throw new Error(`Failed to fetch tileset PNG: ${pngResponse.status}`);
        }

        const originalPngBuffer = Buffer.from(await pngResponse.arrayBuffer());
        console.log(`[${jobId}] Fetched PNG: ${originalPngBuffer.length} bytes`);

        console.log(`[${jobId}] Fetching tileset metadata...`);
        const metadataResponse = await fetchWithTimeout(`${mcpBaseUrl}/${pixellabTilesetId}/metadata`, {
            headers: { "Authorization": `Bearer ${apiKey}` }
        });

        if (!metadataResponse.ok) {
            throw new Error(`Failed to fetch tileset metadata: ${metadataResponse.status}`);
        }

        const metadata = await metadataResponse.json();
        // Tiles are nested under tileset_data.tiles in the API response
        const tiles = metadata.tileset_data?.tiles || metadata.tiles || [];
        console.log(`[${jobId}] Metadata tiles: ${tiles.length}`);

        // Remap tiles to corner-index order (0-15)
        // Corner encoding: NW*8 + NE*4 + SW*2 + SE*1 where upper=1, lower=0
        const tileSize = 32;
        const cols = 4;

        // Create mapping from cornerIndex to source position
        const tileMapping: { cornerIndex: number; srcX: number; srcY: number }[] = [];

        for (const tile of tiles) {
            const corners = tile.corners || {};
            const nw = corners.NW === 'upper' ? 1 : 0;
            const ne = corners.NE === 'upper' ? 1 : 0;
            const sw = corners.SW === 'upper' ? 1 : 0;
            const se = corners.SE === 'upper' ? 1 : 0;
            const cornerIndex = nw * 8 + ne * 4 + sw * 2 + se * 1;

            const bbox = tile.bounding_box || {};
            tileMapping.push({
                cornerIndex,
                srcX: bbox.x || 0,
                srcY: bbox.y || 0
            });
        }

        console.log(`[${jobId}] Tile mapping:`, tileMapping.map(t => `${t.cornerIndex}@(${t.srcX},${t.srcY})`).join(', '));

        // Extract tiles from source and place in corner-index order
        const composites: sharp.OverlayOptions[] = [];

        for (const mapping of tileMapping) {
            // Extract tile from source position
            const tileBuffer = await sharp(originalPngBuffer)
                .extract({ left: mapping.srcX, top: mapping.srcY, width: tileSize, height: tileSize })
                .toBuffer();

            // Calculate destination position based on corner index
            const destX = (mapping.cornerIndex % cols) * tileSize;
            const destY = Math.floor(mapping.cornerIndex / cols) * tileSize;

            composites.push({
                input: tileBuffer,
                left: destX,
                top: destY
            });
        }

        // Create remapped tileset
        const remappedBuffer = await sharp({
            create: {
                width: cols * tileSize,
                height: cols * tileSize,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        }).composite(composites).png().toBuffer();

        console.log(`[${jobId}] Created remapped tileset: ${remappedBuffer.length} bytes`);

        // Upload to Firebase Storage
        const bucket = storage.bucket();
        const file = bucket.file(storagePath);
        await file.save(remappedBuffer, {
            metadata: { contentType: "image/png" },
        });
        await file.makePublic();

        const resultUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
        console.log(`[${jobId}] Uploaded remapped tileset: ${resultUrl}`);

        // Save metadata.json
        const metadataFile = bucket.file(metadataPath);
        const tilesetMetadata = {
            id: tilesetId,
            name: description,
            description: description,
            createdAt: new Date().toISOString(),
            tileSize: 32,
            gridSize: 4,
        };
        await metadataFile.save(JSON.stringify(tilesetMetadata, null, 2), {
            metadata: { contentType: "application/json" },
        });
        await metadataFile.makePublic();
        console.log(`[${jobId}] Metadata saved to ${metadataPath}`);

        // Complete
        await jobRef.update({
            status: "complete",
            imageUrl: resultUrl,
            currentPhase: null,
            progress: 3,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

    } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[${jobId}] Tileset error:`, errMsg);

        await jobRef.update({
            status: "error",
            error: errMsg,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
}

// Tileset generation endpoint
export const generateTileset = onRequest(
    {
        timeoutSeconds: 3600,
        memory: "512MiB",
        cors: true,
    },
    async (req, res) => {
        // Handle preflight
        if (req.method === "OPTIONS") {
            res.status(204).send("");
            return;
        }

        // GET - Poll job status
        if (req.method === "GET") {
            const jobId = req.query.jobId as string;

            if (!jobId) {
                res.status(400).json({ error: "jobId query parameter required" });
                return;
            }

            try {
                const jobDoc = await db.collection("tilesetJobs").doc(jobId).get();

                if (!jobDoc.exists) {
                    res.status(404).json({ error: "Job not found" });
                    return;
                }

                const job = jobDoc.data() as TilesetJob;
                res.status(200).json(job);

            } catch (error) {
                const errMsg = error instanceof Error ? error.message : "Unknown error";
                res.status(500).json({ error: errMsg });
            }
            return;
        }

        // POST - Start new job
        if (req.method === "POST") {
            const { description, userUid, tilesetId } = req.body;

            if (!description || typeof description !== "string") {
                res.status(400).json({ error: "description is required" });
                return;
            }

            if (!userUid || typeof userUid !== "string") {
                res.status(400).json({ error: "userUid is required" });
                return;
            }

            if (!tilesetId || typeof tilesetId !== "string") {
                res.status(400).json({ error: "tilesetId is required" });
                return;
            }

            try {
                const jobRef = db.collection("tilesetJobs").doc();
                const jobId = jobRef.id;

                const now = admin.firestore.FieldValue.serverTimestamp();
                await jobRef.set({
                    status: "pending",
                    description,
                    userUid,
                    tilesetId,
                    progress: 0,
                    createdAt: now,
                    updatedAt: now,
                });

                console.log(`[${jobId}] Tileset job created: "${description}"`);

                processTilesetJob(jobId, description, userUid, tilesetId).catch(err => {
                    console.error(`[${jobId}] Background processing failed:`, err);
                });

                res.status(202).json({
                    jobId,
                    status: "pending",
                    message: `Poll GET /generateTileset?jobId=${jobId} for status`,
                });

            } catch (error) {
                const errMsg = error instanceof Error ? error.message : "Unknown error";
                console.error("Failed to create job:", errMsg);
                res.status(500).json({ error: errMsg });
            }
            return;
        }

        res.status(405).json({ error: "Method not allowed" });
    }
);

// Map Object job interface
interface MapObjectJob {
    status: "pending" | "generating" | "complete" | "error";
    description: string;
    userUid: string;
    objectId: string;
    width: number;
    height: number;
    progress: number;
    currentPhase?: string;
    imageUrl?: string;
    error?: string;
    createdAt: admin.firestore.Timestamp;
    updatedAt: admin.firestore.Timestamp;
}

// 4 cardinal directions for object rotations
const OBJECT_DIRECTIONS = ["south", "west", "north", "east"] as const;

// Process map object job - uses bitforge + generate-8-rotations-v2 for objects with 4 rotations
async function processMapObjectJob(
    jobId: string,
    description: string,
    userUid: string,
    objectId: string,
    width: number,
    height: number
): Promise<void> {
    const jobRef = db.collection("mapObjectJobs").doc(jobId);
    const apiKey = PIXELLAB_API_KEY;
    const baseStoragePath = `objects/${userUid}/${objectId}`;
    const metadataPath = `${baseStoragePath}/metadata.json`;

    // Clamp dimensions to bitforge limits (16-200px)
    const clampedWidth = Math.min(Math.max(width, 16), 200);
    const clampedHeight = Math.min(Math.max(height, 16), 200);

    // Rotation endpoint has stricter limit (max 84px)
    const rotationWidth = Math.min(clampedWidth, 84);
    const rotationHeight = Math.min(clampedHeight, 84);

    try {
        await jobRef.update({
            status: "generating",
            currentPhase: "creating object",
            progress: 0,
            total: 6, // bitforge + rotations + upload
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[${jobId}] Starting map object generation: "${description}" (${clampedWidth}x${clampedHeight}px)`);

        // Step 1: Create image using bitforge with no_background for true transparency
        const bitforgeResponse = await fetchPixellabV2(apiKey, "create-image-bitforge", {
            description,
            image_size: { width: clampedWidth, height: clampedHeight },
            view: "high top-down",
            direction: "south", // Ensure base image faces south for correct rotation mapping
            outline: "single color outline",
            shading: "medium shading",
            detail: "medium detail",
            no_background: true,
        });

        if (!bitforgeResponse.ok) {
            const errText = await bitforgeResponse.text();
            throw new Error(`Bitforge creation failed: ${bitforgeResponse.status} - ${errText}`);
        }

        const bitforgeData = await bitforgeResponse.json();

        // Bitforge returns base64 directly
        const base64Image = bitforgeData.image?.base64;
        if (!base64Image) {
            throw new Error("No base64 image returned from bitforge");
        }

        console.log(`[${jobId}] Bitforge complete, saving base image immediately...`);

        // Step 2: Save base image immediately so client can display it
        const bucket = storage.bucket();
        const southPath = `${baseStoragePath}/south.png`;
        const southFile = bucket.file(southPath);
        const southBuffer = Buffer.from(base64Image, "base64");
        await southFile.save(southBuffer, { metadata: { contentType: "image/png" } });
        await southFile.makePublic();
        const southUrl = `https://storage.googleapis.com/${bucket.name}/${southPath}`;

        // Update job with base image - client can use this immediately
        await jobRef.update({
            currentPhase: "generating rotations",
            progress: 1,
            imageUrl: southUrl,
            baseImageReady: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[${jobId}] Base image ready: ${southUrl}, now generating rotations...`);

        // Step 3: Generate 8 rotations (we'll use 4 cardinal directions)
        const rotateResponse = await fetchPixellabV2(apiKey, "generate-8-rotations-v2", {
            method: "rotate_character",
            image_size: { width: rotationWidth, height: rotationHeight },
            reference_image: {
                image: { base64: `data:image/png;base64,${base64Image}` },
                width: rotationWidth,
                height: rotationHeight,
            },
            description,
            view: "high top-down",
            no_background: true,
        }, 180000); // 3 minute timeout for rotation generation

        if (!rotateResponse.ok) {
            const errText = await rotateResponse.text();
            throw new Error(`Rotation generation failed: ${rotateResponse.status} - ${errText}`);
        }

        const rotateData = await rotateResponse.json();

        // The API returns 8 images in order: south, south-west, west, north-west, north, north-east, east, south-east
        const allImages = rotateData.images;
        if (!allImages || allImages.length < 8) {
            throw new Error(`Expected 8 rotation images, got ${allImages?.length || 0}`);
        }

        console.log(`[${jobId}] Got 8 rotations, extracting 4 cardinal directions...`);

        // Step 4: Upload only 4 cardinal directions (indices 0, 2, 4, 6)
        await jobRef.update({
            currentPhase: "uploading rotations",
            progress: 2,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        const rotationUrls: Record<string, string> = { south: southUrl };

        // Map direction names to indices in the 8-rotation array
        const directionIndices: Record<string, number> = {
            south: 0,
            west: 2,
            north: 4,
            east: 6,
        };

        // Upload west, north, east (skip south - already uploaded from bitforge)
        for (const direction of OBJECT_DIRECTIONS) {
            if (direction === "south") continue; // Already uploaded from bitforge

            const idx = directionIndices[direction];
            const imgData = allImages[idx];
            const imgBase64 = imgData.base64;

            if (!imgBase64) {
                console.warn(`[${jobId}] No base64 for direction ${direction}`);
                continue;
            }

            const storagePath = `${baseStoragePath}/${direction}.png`;
            const file = bucket.file(storagePath);
            const buffer = Buffer.from(imgBase64, "base64");

            await file.save(buffer, {
                metadata: { contentType: "image/png" },
            });
            await file.makePublic();

            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
            rotationUrls[direction] = publicUrl;
            console.log(`[${jobId}] Uploaded ${direction}: ${publicUrl}`);
        }

        // Step 4: Save metadata.json
        await jobRef.update({
            currentPhase: "saving metadata",
            progress: 5,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        const metadataFile = bucket.file(metadataPath);
        const objectMetadata = {
            id: objectId,
            description,
            width: clampedWidth,
            height: clampedHeight,
            rotations: rotationUrls,
            createdAt: new Date().toISOString(),
        };
        await metadataFile.save(JSON.stringify(objectMetadata, null, 2), {
            metadata: { contentType: "application/json" },
        });
        await metadataFile.makePublic();
        console.log(`[${jobId}] Metadata saved to ${metadataPath}`);

        // Complete - rotations are now ready
        await jobRef.update({
            status: "complete",
            rotations: rotationUrls,
            rotationsReady: true,
            currentPhase: null,
            progress: 6,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[${jobId}] Map object complete with 4 rotations!`);

    } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[${jobId}] Map object error:`, errMsg);

        await jobRef.update({
            status: "error",
            error: errMsg,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
}

// Map object generation endpoint
export const generateMapObject = onRequest(
    {
        timeoutSeconds: 3600,
        memory: "512MiB",
        cors: true,
    },
    async (req, res) => {
        // Handle preflight
        if (req.method === "OPTIONS") {
            res.status(204).send("");
            return;
        }

        // GET - Poll job status
        if (req.method === "GET") {
            const jobId = req.query.jobId as string;

            if (!jobId) {
                res.status(400).json({ error: "jobId query parameter required" });
                return;
            }

            try {
                const jobDoc = await db.collection("mapObjectJobs").doc(jobId).get();

                if (!jobDoc.exists) {
                    res.status(404).json({ error: "Job not found" });
                    return;
                }

                const job = jobDoc.data() as MapObjectJob;
                res.status(200).json(job);

            } catch (error) {
                const errMsg = error instanceof Error ? error.message : "Unknown error";
                res.status(500).json({ error: errMsg });
            }
            return;
        }

        // POST - Start new job
        if (req.method === "POST") {
            const { description, userUid, objectId, width, height } = req.body;

            if (!description || typeof description !== "string") {
                res.status(400).json({ error: "description is required" });
                return;
            }

            if (!userUid || typeof userUid !== "string") {
                res.status(400).json({ error: "userUid is required" });
                return;
            }

            if (!objectId || typeof objectId !== "string") {
                res.status(400).json({ error: "objectId is required" });
                return;
            }

            if (!width || typeof width !== "number" || width < 32 || width > 400) {
                res.status(400).json({ error: "width must be a number between 32 and 400" });
                return;
            }

            if (!height || typeof height !== "number" || height < 32 || height > 400) {
                res.status(400).json({ error: "height must be a number between 32 and 400" });
                return;
            }

            try {
                const jobRef = db.collection("mapObjectJobs").doc();
                const jobId = jobRef.id;

                const now = admin.firestore.FieldValue.serverTimestamp();
                await jobRef.set({
                    status: "pending",
                    description,
                    userUid,
                    objectId,
                    width,
                    height,
                    progress: 0,
                    createdAt: now,
                    updatedAt: now,
                });

                console.log(`[${jobId}] Map object job created: "${description}" (${width}x${height}px)`);

                processMapObjectJob(jobId, description, userUid, objectId, width, height).catch(err => {
                    console.error(`[${jobId}] Background processing failed:`, err);
                });

                res.status(202).json({
                    jobId,
                    status: "pending",
                    message: `Poll GET /generateMapObject?jobId=${jobId} for status`,
                });

            } catch (error) {
                const errMsg = error instanceof Error ? error.message : "Unknown error";
                console.error("Failed to create job:", errMsg);
                res.status(500).json({ error: errMsg });
            }
            return;
        }

        res.status(405).json({ error: "Method not allowed" });
    }
);
