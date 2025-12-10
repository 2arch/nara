"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateMapObject = exports.generateTileset = exports.uploadSprites = exports.animateSprite = exports.generateSprite = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const jszip_1 = __importDefault(require("jszip"));
const sharp_1 = __importDefault(require("sharp"));
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
];
const MAX_RETRIES = 8;
const FETCH_TIMEOUT_MS = 60000; // 60 seconds
const POLL_TIMEOUT_MS = 300000; // 5 minutes for background jobs
// Fetch with timeout using AbortController
async function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, Object.assign(Object.assign({}, options), { signal: controller.signal }));
        return response;
    }
    finally {
        clearTimeout(timeout);
    }
}
// V2 API POST helper
async function fetchPixellabV2(apiKey, endpoint, body, timeoutMs = FETCH_TIMEOUT_MS) {
    return fetchWithTimeout(`${PIXELLAB_API_V2_URL}/${endpoint}`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    }, timeoutMs);
}
// V2 API GET helper
async function getPixellabV2(apiKey, endpoint, timeoutMs = 30000) {
    return fetchWithTimeout(`${PIXELLAB_API_V2_URL}/${endpoint}`, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
        },
    }, timeoutMs);
}
// Poll V2 background job until complete
async function pollBackgroundJob(apiKey, jobId, jobType, jobRef, maxWaitTime = POLL_TIMEOUT_MS) {
    var _a, _b, _c;
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
            const queuePos = (_a = data.last_response) === null || _a === void 0 ? void 0 : _a.queue_position;
            const statusDetail = ((_b = data.last_response) === null || _b === void 0 ? void 0 : _b.status) || data.status;
            console.log(`[pollJob ${jobType}] Poll #${pollCount} - Status: ${data.status}, Detail: ${statusDetail}, Queue: ${queuePos}`);
            if (data.status === "completed" || data.status === "complete") {
                console.log(`[pollJob ${jobType}] Job complete!`);
                return;
            }
            else if (data.status === "failed" || data.status === "error") {
                const errorMsg = data.error || ((_c = data.last_response) === null || _c === void 0 ? void 0 : _c.error) || "Unknown error";
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
        }
        catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                console.log(`[pollJob ${jobType}] Poll #${pollCount} timed out, retrying...`);
            }
            else {
                throw error;
            }
        }
        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    throw new Error(`Job ${jobId} timed out after ${maxWaitTime}ms`);
}
// Download image from URL and upload to Firebase Storage
async function downloadAndUploadToStorage(imageUrl, storagePath) {
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
async function createCharacterWithRetries(apiKey, description, jobRef, jobId) {
    let lastError = null;
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
                const retryInfo = {
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
        }
        catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            const isTimeout = lastError.name === "AbortError";
            const waitMs = Math.pow(2, attempt) * 2000;
            const retryInfo = {
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
async function processJob(jobId, description, userUid, spriteId) {
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
        const { characterId, backgroundJobId } = await createCharacterWithRetries(apiKey, description, jobRef, jobId);
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
        const storagePaths = {};
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
    }
    catch (error) {
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
exports.generateSprite = (0, https_1.onRequest)({
    timeoutSeconds: 3600,
    memory: "512MiB",
    cors: true,
}, async (req, res) => {
    // Handle preflight
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    // GET - Poll job status
    if (req.method === "GET") {
        const jobId = req.query.jobId;
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
            const job = jobDoc.data();
            // Build response based on status
            const response = {
                jobId,
                status: job.status,
                progress: job.progress,
                total: job.total,
            };
            if (job.status === "complete") {
                response.rotationsReady = job.rotationsReady;
                response.storagePaths = job.storagePaths;
                response.characterId = job.characterId;
            }
            else if (job.status === "error") {
                response.error = job.error;
            }
            else {
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
        }
        catch (error) {
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
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : "Unknown error";
            console.error("Failed to create job:", errMsg);
            res.status(500).json({ error: errMsg });
        }
        return;
    }
    res.status(405).json({ error: "Method not allowed" });
});
// Process animation job
async function processAnimationJob(jobId, characterId, userUid, spriteId, directionsToUpload = null // Only upload these directions (null = all)
) {
    var _a, _b, _c, _d;
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
        const animPayload = {
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
        const backgroundJobIds = animData.background_job_ids || [];
        const animDirections = animData.directions || [];
        if (backgroundJobIds.length === 0) {
            // No jobs means all directions already have animations
            console.log(`[${jobId}] All directions already have animations, fetching frames...`);
        }
        else {
            console.log(`[${jobId}] Animation jobs started for ${animDirections.length} directions:`, animDirections);
            console.log(`[${jobId}] Job IDs:`, backgroundJobIds);
            // Step 2: Poll ALL jobs until complete (track successes/failures)
            await jobRef.update({
                currentPhase: `generating ${animDirections.length} directions`,
                progress: 1,
                animatingDirections: animDirections,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            const jobResults = [];
            // Poll all jobs in parallel
            const pollPromises = backgroundJobIds.map(async (bgJobId, index) => {
                const direction = animDirections[index] || `direction_${index}`;
                try {
                    await pollBackgroundJob(apiKey, bgJobId, `animation-${direction}`, jobRef);
                    console.log(`[${jobId}] Direction ${direction} completed successfully`);
                    return { direction, jobId: bgJobId, success: true };
                }
                catch (err) {
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
                throw new Error(`All animation jobs failed. First error: ${((_a = failed[0]) === null || _a === void 0 ? void 0 : _a.error) || "Unknown error"}`);
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
        const zip = await jszip_1.default.loadAsync(zipBuffer);
        // Parse metadata.json to get animation structure
        const metadataFile = zip.file("metadata.json");
        if (!metadataFile) {
            throw new Error("No metadata.json found in ZIP");
        }
        const metadataJson = await metadataFile.async("string");
        const metadata = JSON.parse(metadataJson);
        console.log(`[${jobId}] ZIP metadata loaded`);
        // Get walking animation frames from metadata
        const walkAnimData = (_c = (_b = metadata.frames) === null || _b === void 0 ? void 0 : _b.animations) === null || _c === void 0 ? void 0 : _c["walking-8-frames"];
        if (!walkAnimData) {
            console.error(`[${jobId}] No walking-8-frames in metadata. Available:`, Object.keys(((_d = metadata.frames) === null || _d === void 0 ? void 0 : _d.animations) || {}));
            throw new Error("No walking-8-frames animation found in ZIP");
        }
        // Step 5: Upload animation frames to Firebase Storage
        await jobRef.update({
            currentPhase: "uploading animation frames",
            progress: 4,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        const allFramePaths = {};
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
                }
                catch (err) {
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
            let metadata = {};
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
        }
        catch (err) {
            console.warn(`[${jobId}] Failed to update metadata:`, err);
        }
        if (isPartial) {
            console.log(`[${jobId}] Animation partially complete: ${downloadedDirections.length}/${DIRECTIONS.length} directions`);
            console.log(`[${jobId}] Missing: ${missingDirections.join(', ')}`);
        }
        else {
            console.log(`[${jobId}] Animation complete! All ${DIRECTIONS.length} directions`);
        }
    }
    catch (error) {
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
exports.animateSprite = (0, https_1.onRequest)({
    timeoutSeconds: 3600,
    memory: "512MiB",
    cors: true,
}, async (req, res) => {
    // Handle preflight
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    // GET - Poll job status
    if (req.method === "GET") {
        const jobId = req.query.jobId;
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
            const job = jobDoc.data();
            const response = {
                jobId,
                status: job.status,
                progress: job.progress,
                total: job.total,
            };
            if (job.status === "complete" || job.status === "partial") {
                response.framePaths = job.framePaths;
                response.completedDirections = job.completedDirections;
                response.missingDirections = job.missingDirections;
            }
            else if (job.status === "error") {
                response.error = job.error;
            }
            else {
                response.currentPhase = job.currentPhase;
            }
            res.status(200).json(response);
        }
        catch (error) {
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
        let targetDirections = null;
        if (directionsToUpload && Array.isArray(directionsToUpload)) {
            targetDirections = directionsToUpload.filter((d) => typeof d === "string" && DIRECTIONS.includes(d));
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
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : "Unknown error";
            console.error("Failed to create animation job:", errMsg);
            res.status(500).json({ error: errMsg });
        }
        return;
    }
    res.status(405).json({ error: "Method not allowed" });
});
// One-shot function to upload sprite sheets directly
// POST /uploadSprites { characterId, userId, spriteId, idleBase64, walkBase64 }
exports.uploadSprites = (0, https_1.onRequest)({
    timeoutSeconds: 60,
    memory: "256MiB",
    cors: true,
}, async (req, res) => {
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
                    }
                    catch (e) {
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
        const results = [];
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
    }
    catch (error) {
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        console.error("Upload error:", errMsg);
        res.status(500).json({ error: errMsg });
    }
});
// Process tileset job
async function processTilesetJob(jobId, description, userUid, tilesetId) {
    var _a;
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
        const tiles = ((_a = metadata.tileset_data) === null || _a === void 0 ? void 0 : _a.tiles) || metadata.tiles || [];
        console.log(`[${jobId}] Metadata tiles: ${tiles.length}`);
        // Remap tiles to corner-index order (0-15)
        // Corner encoding: NW*8 + NE*4 + SW*2 + SE*1 where upper=1, lower=0
        const tileSize = 32;
        const cols = 4;
        // Create mapping from cornerIndex to source position
        const tileMapping = [];
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
        const composites = [];
        for (const mapping of tileMapping) {
            // Extract tile from source position
            const tileBuffer = await (0, sharp_1.default)(originalPngBuffer)
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
        const remappedBuffer = await (0, sharp_1.default)({
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
    }
    catch (error) {
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
exports.generateTileset = (0, https_1.onRequest)({
    timeoutSeconds: 3600,
    memory: "512MiB",
    cors: true,
}, async (req, res) => {
    // Handle preflight
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    // GET - Poll job status
    if (req.method === "GET") {
        const jobId = req.query.jobId;
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
            const job = jobDoc.data();
            res.status(200).json(job);
        }
        catch (error) {
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
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : "Unknown error";
            console.error("Failed to create job:", errMsg);
            res.status(500).json({ error: errMsg });
        }
        return;
    }
    res.status(405).json({ error: "Method not allowed" });
});
// Process map object job
async function processMapObjectJob(jobId, description, userUid, objectId, width, height) {
    const jobRef = db.collection("mapObjectJobs").doc(jobId);
    const apiKey = PIXELLAB_API_KEY;
    const storagePath = `objects/${userUid}/${objectId}/object.png`;
    const metadataPath = `objects/${userUid}/${objectId}/metadata.json`;
    try {
        await jobRef.update({
            status: "generating",
            currentPhase: "requesting map object",
            progress: 0,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[${jobId}] Starting map object generation: "${description}" (${width}x${height}px)`);
        // Step 1: Request map object using the v2 map-objects endpoint
        const response = await fetchPixellabV2(apiKey, "map-objects", {
            description,
            image_size: { width, height },
            view: "high top-down",
            outline: "single color outline",
            shading: "medium shading",
            detail: "medium detail",
        });
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Map object request failed: ${response.status} - ${errText}`);
        }
        const data = await response.json();
        const backgroundJobId = data.background_job_id;
        const pixellabObjectId = data.object_id;
        console.log(`[${jobId}] Map object job started: ${backgroundJobId}, object_id: ${pixellabObjectId}`);
        // Step 2: Poll job
        await jobRef.update({
            currentPhase: "generating object",
            progress: 1,
            pixellabObjectId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await pollBackgroundJob(apiKey, backgroundJobId, "map-object", jobRef);
        console.log(`[${jobId}] Map object generated! Fetching image...`);
        // Step 3: Fetch the generated image from MCP endpoint (like tilesets do)
        await jobRef.update({
            currentPhase: "downloading image",
            progress: 2,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Fetch from the MCP endpoint which provides the PNG directly
        const mcpDownloadUrl = `https://api.pixellab.ai/mcp/map-objects/${pixellabObjectId}/download`;
        console.log(`[${jobId}] Fetching from MCP: ${mcpDownloadUrl}`);
        const pngResponse = await fetchWithTimeout(mcpDownloadUrl, {
            headers: { "Authorization": `Bearer ${apiKey}` }
        }, 60000);
        if (!pngResponse.ok) {
            throw new Error(`Failed to fetch map object PNG: ${pngResponse.status}`);
        }
        const pngBuffer = Buffer.from(await pngResponse.arrayBuffer());
        console.log(`[${jobId}] Fetched PNG: ${pngBuffer.length} bytes`);
        // Step 4: Upload to Firebase Storage
        await jobRef.update({
            currentPhase: "uploading to storage",
            progress: 3,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        const bucket = storage.bucket();
        const file = bucket.file(storagePath);
        await file.save(pngBuffer, {
            metadata: { contentType: "image/png" },
        });
        await file.makePublic();
        const resultUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
        console.log(`[${jobId}] Uploaded map object: ${resultUrl}`);
        // Save metadata.json
        const metadataFile = bucket.file(metadataPath);
        const objectMetadata = {
            id: objectId,
            description,
            width,
            height,
            createdAt: new Date().toISOString(),
        };
        await metadataFile.save(JSON.stringify(objectMetadata, null, 2), {
            metadata: { contentType: "application/json" },
        });
        await metadataFile.makePublic();
        console.log(`[${jobId}] Metadata saved to ${metadataPath}`);
        // Complete
        await jobRef.update({
            status: "complete",
            imageUrl: resultUrl,
            currentPhase: null,
            progress: 4,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[${jobId}] Map object complete!`);
    }
    catch (error) {
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
exports.generateMapObject = (0, https_1.onRequest)({
    timeoutSeconds: 3600,
    memory: "512MiB",
    cors: true,
}, async (req, res) => {
    // Handle preflight
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    // GET - Poll job status
    if (req.method === "GET") {
        const jobId = req.query.jobId;
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
            const job = jobDoc.data();
            res.status(200).json(job);
        }
        catch (error) {
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
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : "Unknown error";
            console.error("Failed to create job:", errMsg);
            res.status(500).json({ error: errMsg });
        }
        return;
    }
    res.status(405).json({ error: "Method not allowed" });
});
//# sourceMappingURL=index.js.map