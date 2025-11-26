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
// API key - set via environment variable or use default for testing
const PIXELLAB_API_KEY = process.env.PIXELLAB_API_KEY || "9bb378e0-6b46-442d-9019-96216f8e8ba7";
const PIXELLAB_API_V2_URL = "https://api.pixellab.ai/v2";
const DIRECTIONS = [
    "south", "south-west", "west", "north-west",
    "north", "north-east", "east", "south-east"
];
async function fetchPixellabV2(apiKey, endpoint, body, method = "POST") {
    return fetch(`${PIXELLAB_API_V2_URL}/${endpoint}`, {
        method,
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: method === "POST" ? JSON.stringify(body) : undefined,
    });
}
async function pollBackgroundJob(apiKey, jobId, maxWaitTime = 300000) {
    const startTime = Date.now();
    const pollInterval = 2000; // 2 seconds
    while (Date.now() - startTime < maxWaitTime) {
        const response = await fetch(`${PIXELLAB_API_V2_URL}/background-jobs/${jobId}`, {
            headers: {
                "Authorization": `Bearer ${apiKey}`,
            },
        });
        if (!response.ok) {
            throw new Error(`Failed to poll job ${jobId}: ${response.status}`);
        }
        const data = await response.json();
        if (data.status === "completed") {
            return data;
        }
        else if (data.status === "failed") {
            throw new Error(`Job ${jobId} failed: ${data.error || "Unknown error"}`);
        }
        // Still processing, wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    throw new Error(`Job ${jobId} timed out after ${maxWaitTime}ms`);
}
// Process job in background using V2 API (updates Firestore as it progresses)
async function processJob(jobId, description) {
    var _a, _b, _c, _d;
    const jobRef = db.collection("spriteJobs").doc(jobId);
    const apiKey = PIXELLAB_API_KEY;
    try {
        // Step 1: Create character with 8 directions using V2 API
        await jobRef.update({
            status: "generating",
            currentDirection: "creating character with 8 directions",
            progress: 0,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[${jobId}] Step 1: Creating character with V2 API...`);
        const createCharRes = await fetchPixellabV2(apiKey, "create-character-with-8-directions", {
            description,
            image_size: { width: 64, height: 64 },
            view: "low top-down",
            outline: "single color outline",
            shading: "medium shading",
            detail: "medium detail",
        });
        if (!createCharRes.ok) {
            const errorText = await createCharRes.text();
            throw new Error(`Character creation failed: ${createCharRes.status} - ${errorText}`);
        }
        const createData = await createCharRes.json();
        const characterId = createData.character_id;
        const characterJobId = createData.background_job_id;
        console.log(`[${jobId}] Character job started: ${characterJobId}`);
        // Poll until character creation completes
        await jobRef.update({
            currentDirection: "waiting for character rotations",
            progress: 1,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await pollBackgroundJob(apiKey, characterJobId);
        console.log(`[${jobId}] Character created successfully`);
        // Step 2: Animate character with walking-8-frames template
        await jobRef.update({
            currentDirection: "creating walk animations",
            progress: 2,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[${jobId}] Step 2: Animating character...`);
        const animateRes = await fetchPixellabV2(apiKey, "animate-character", {
            character_id: characterId,
            template_animation_id: "walking-8-frames",
            action_description: "walking",
        });
        if (!animateRes.ok) {
            const errorText = await animateRes.text();
            throw new Error(`Animation failed: ${animateRes.status} - ${errorText}`);
        }
        const animateData = await animateRes.json();
        const animationJobIds = animateData.background_job_ids;
        console.log(`[${jobId}] Animation jobs started: ${animationJobIds.length} jobs`);
        // Poll all animation jobs
        const walkFrames = {};
        for (let i = 0; i < animationJobIds.length; i++) {
            const animJobId = animationJobIds[i];
            const direction = DIRECTIONS[i];
            await jobRef.update({
                currentDirection: `animating ${direction}`,
                progress: 2 + i,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            const animJobData = await pollBackgroundJob(apiKey, animJobId);
            // Extract base64 frames from animation job (use all frames from template)
            const frames = ((_a = animJobData.frames) === null || _a === void 0 ? void 0 : _a.map((f) => f.base64)) || [];
            walkFrames[direction] = frames;
            console.log(`[${jobId}] Walk ${direction} complete (${frames.length} frames)`);
        }
        // Step 3: Create static idle frames from character rotations
        console.log(`[${jobId}] Step 3: Creating idle frames...`);
        const idleFrames = {};
        // Get character data to extract rotation images
        const getCharRes = await fetch(`${PIXELLAB_API_V2_URL}/characters/${characterId}`, {
            headers: {
                "Authorization": `Bearer ${apiKey}`,
            },
        });
        if (!getCharRes.ok) {
            throw new Error(`Failed to get character: ${getCharRes.status}`);
        }
        const charData = await getCharRes.json();
        // Use rotation images for idle (match walk frame count)
        for (let i = 0; i < DIRECTIONS.length; i++) {
            const direction = DIRECTIONS[i];
            const rotationImage = ((_c = (_b = charData.rotations) === null || _b === void 0 ? void 0 : _b[i]) === null || _c === void 0 ? void 0 : _c.base64) || "";
            const walkFrameCount = ((_d = walkFrames[direction]) === null || _d === void 0 ? void 0 : _d.length) || 8;
            idleFrames[direction] = Array(walkFrameCount).fill(rotationImage);
        }
        console.log(`[${jobId}] Idle frames created`);
        // Update job with complete data
        await jobRef.update({
            status: "complete",
            progress: DIRECTIONS.length + 2,
            currentDirection: null,
            walkFrames,
            idleFrames,
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
    memory: "256MiB",
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
            // Return status with animation frames if complete
            if (job.status === "complete") {
                res.status(200).json({
                    jobId,
                    status: job.status,
                    progress: job.progress,
                    total: job.total,
                    walkFrames: job.walkFrames,
                    idleFrames: job.idleFrames,
                    directions: DIRECTIONS,
                });
            }
            else if (job.status === "error") {
                res.status(200).json({
                    jobId,
                    status: job.status,
                    error: job.error,
                });
            }
            else {
                res.status(200).json({
                    jobId,
                    status: job.status,
                    progress: job.progress,
                    total: job.total,
                    currentDirection: job.currentDirection,
                });
            }
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
        const apiKey = PIXELLAB_API_KEY;
        if (!apiKey) {
            res.status(500).json({ error: "PIXELLAB_API_KEY not configured" });
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