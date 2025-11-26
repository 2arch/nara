import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();

// API key - set via environment variable or use default for testing
const PIXELLAB_API_KEY = process.env.PIXELLAB_API_KEY || "9bb378e0-6b46-442d-9019-96216f8e8ba7";
const PIXELLAB_API_V2_URL = "https://api.pixellab.ai/v2";

const DIRECTIONS = [
    "south", "south-west", "west", "north-west",
    "north", "north-east", "east", "south-east"
] as const;

interface SpriteJob {
    status: "pending" | "generating" | "complete" | "error";
    description: string;
    progress: number;
    total: number;
    currentDirection?: string;
    walkFrames?: Record<string, string[]>;
    idleFrames?: Record<string, string[]>;
    error?: string;
    createdAt: admin.firestore.Timestamp;
    updatedAt: admin.firestore.Timestamp;
}

async function fetchPixellabV2(apiKey: string, endpoint: string, body: object, method: string = "POST"): Promise<Response> {
    return fetch(`${PIXELLAB_API_V2_URL}/${endpoint}`, {
        method,
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: method === "POST" ? JSON.stringify(body) : undefined,
    });
}

async function pollBackgroundJob(apiKey: string, jobId: string, maxWaitTime: number = 300000): Promise<any> {
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
        } else if (data.status === "failed") {
            throw new Error(`Job ${jobId} failed: ${data.error || "Unknown error"}`);
        }

        // Still processing, wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Job ${jobId} timed out after ${maxWaitTime}ms`);
}

// Process job in background using V2 API (updates Firestore as it progresses)
async function processJob(jobId: string, description: string): Promise<void> {
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
        const walkFrames: Record<string, string[]> = {};

        for (let i = 0; i < animationJobIds.length; i++) {
            const animJobId = animationJobIds[i];
            const direction = DIRECTIONS[i];

            await jobRef.update({
                currentDirection: `animating ${direction}`,
                progress: 2 + i,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            const animJobData = await pollBackgroundJob(apiKey, animJobId);

            // Extract base64 frames from animation job
            const frames = animJobData.frames?.map((f: any) => f.base64) || [];

            // Pad or trim to 7 frames
            if (frames.length < 7) {
                // Repeat frames to fill
                while (frames.length < 7) {
                    frames.push(...frames.slice(0, Math.min(frames.length, 7 - frames.length)));
                }
            } else if (frames.length > 7) {
                frames.length = 7;
            }

            walkFrames[direction] = frames;
            console.log(`[${jobId}] Walk ${direction} complete (${frames.length} frames)`);
        }

        // Step 3: Create static idle frames from character rotations
        console.log(`[${jobId}] Step 3: Creating idle frames...`);
        const idleFrames: Record<string, string[]> = {};

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

        // Use rotation images for idle
        for (let i = 0; i < DIRECTIONS.length; i++) {
            const direction = DIRECTIONS[i];
            const rotationImage = charData.rotations?.[i]?.base64 || "";
            idleFrames[direction] = Array(7).fill(rotationImage);
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
        memory: "256MiB",
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

                const job = jobDoc.data() as SpriteJob;

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
                } else if (job.status === "error") {
                    res.status(200).json({
                        jobId,
                        status: job.status,
                        error: job.error,
                    });
                } else {
                    res.status(200).json({
                        jobId,
                        status: job.status,
                        progress: job.progress,
                        total: job.total,
                        currentDirection: job.currentDirection,
                    });
                }
            } catch (error) {
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

