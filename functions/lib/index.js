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
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSprite = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
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
async function processJob(jobId, description) {
    const jobRef = db.collection("spriteJobs").doc(jobId);
    const apiKey = PIXELLAB_API_KEY;
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
            const storagePath = `sprites/${jobId}/rotations/${direction}.png`;
            const publicUrl = await downloadAndUploadToStorage(pixellabUrl, storagePath);
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
        const { description } = req.body;
        if (!description || typeof description !== "string") {
            res.status(400).json({ error: "description is required" });
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
                progress: 0,
                total: DIRECTIONS.length,
                createdAt: now,
                updatedAt: now,
            });
            console.log(`[${jobId}] Job created for: "${description}"`);
            // Start processing in background (don't await)
            processJob(jobId, description).catch(err => {
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
//# sourceMappingURL=index.js.map