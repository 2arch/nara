import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();

// API key
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
    idleReady?: boolean;  // True when idle frames are in Firestore
    error?: string;
    createdAt: admin.firestore.Timestamp;
    updatedAt: admin.firestore.Timestamp;
}

async function fetchPixellabV2(apiKey: string, endpoint: string, body: object): Promise<Response> {
    return fetch(`${PIXELLAB_API_V2_URL}/${endpoint}`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
}

async function pollBackgroundJob(apiKey: string, jobId: string, jobType: string, maxWaitTime: number = 300000): Promise<any> {
    const startTime = Date.now();
    const pollInterval = 2000;
    let pollCount = 0;

    while (Date.now() - startTime < maxWaitTime) {
        pollCount++;
        const response = await fetch(`${PIXELLAB_API_V2_URL}/background-jobs/${jobId}`, {
            headers: { "Authorization": `Bearer ${apiKey}` },
        });

        if (!response.ok) {
            throw new Error(`Failed to poll job ${jobId}: ${response.status}`);
        }

        const data = await response.json();
        console.log(`[pollJob ${jobType}] Poll #${pollCount} - Status: ${data.status}`);

        if (data.status === "completed" || data.status === "complete") {
            console.log(`[pollJob ${jobType}] Job complete!`);
            return data;
        } else if (data.status === "failed" || data.status === "error") {
            const errorMsg = data.error || data.last_response?.error || "Unknown error";
            throw new Error(`Job ${jobId} failed: ${errorMsg}`);
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Job ${jobId} timed out after ${maxWaitTime}ms`);
}

// Animate a single direction with retries
async function animateDirection(
    apiKey: string,
    characterId: string,
    direction: string,
    maxRetries: number = 3
): Promise<string[]> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[animate] ${direction} - Attempt ${attempt}/${maxRetries}`);

            const animateRes = await fetchPixellabV2(apiKey, "animate-character", {
                character_id: characterId,
                template_animation_id: "walking-8-frames",
                action_description: "walking",
                directions: [direction],
            });

            if (!animateRes.ok) {
                const errorText = await animateRes.text();
                throw new Error(`Animation request failed: ${animateRes.status} - ${errorText}`);
            }

            const animateData = await animateRes.json();
            const jobIds = animateData.background_job_ids;

            if (!jobIds || jobIds.length === 0) {
                throw new Error("No animation job IDs returned");
            }

            const jobData = await pollBackgroundJob(apiKey, jobIds[0], `anim-${direction}`);
            const frames = jobData.last_response?.images?.map((img: any) => img.base64) || [];

            if (frames.length === 0) {
                throw new Error("No frames returned");
            }

            console.log(`[animate] ${direction} - Success (${frames.length} frames)`);
            return frames;

        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            console.log(`[animate] ${direction} - Attempt ${attempt} failed: ${lastError.message}`);

            if (attempt < maxRetries) {
                const waitTime = 5000 * attempt;
                console.log(`[animate] ${direction} - Waiting ${waitTime}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }

    throw new Error(`Animation for ${direction} failed after ${maxRetries} attempts: ${lastError?.message}`);
}

// Main processing function
async function processJob(jobId: string, description: string): Promise<void> {
    const jobRef = db.collection("spriteJobs").doc(jobId);
    const apiKey = PIXELLAB_API_KEY;

    try {
        // Step 1: Create character with 8 directions
        await jobRef.update({
            status: "generating",
            currentDirection: "creating character",
            progress: 0,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[${jobId}] Step 1: Creating character...`);

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

        console.log(`[${jobId}] Polling character job: ${characterJobId}`);

        await jobRef.update({
            currentDirection: "waiting for character",
            progress: 1,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        const characterJobData = await pollBackgroundJob(apiKey, characterJobId, "character");
        console.log(`[${jobId}] Character created!`);

        // Step 2: Extract idle frames and save to Firestore IMMEDIATELY
        // Client can start compositing + uploading idle while we animate
        console.log(`[${jobId}] Step 2: Saving idle frames to Firestore...`);

        const idleFrames: Record<string, string[]> = {};

        for (const direction of DIRECTIONS) {
            const rotationImage = characterJobData.last_response?.images?.[direction]?.base64 || "";
            if (rotationImage) {
                idleFrames[direction] = [rotationImage];
            } else {
                console.warn(`[${jobId}] No rotation image for ${direction}`);
            }
        }

        // Save idle frames - client can now composite and upload idle.png
        await jobRef.update({
            idleFrames,
            idleReady: true,
            progress: 2,
            currentDirection: "idle ready, starting animations",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[${jobId}] Idle frames saved to Firestore (idleReady: true)`);

        // Step 3: Animate each direction sequentially
        console.log(`[${jobId}] Step 3: Animating directions...`);

        const walkFrames: Record<string, string[]> = {};

        for (let i = 0; i < DIRECTIONS.length; i++) {
            const direction = DIRECTIONS[i];

            await jobRef.update({
                currentDirection: `animating ${direction}`,
                progress: 3 + i,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            console.log(`[${jobId}] Animating ${direction} (${i + 1}/${DIRECTIONS.length})...`);

            const frames = await animateDirection(apiKey, characterId, direction);
            walkFrames[direction] = frames;

            console.log(`[${jobId}] Walk ${direction} complete (${frames.length} frames)`);
        }

        // Step 4: Save walk frames to Firestore
        console.log(`[${jobId}] Step 4: Saving walk frames to Firestore...`);

        await jobRef.update({
            status: "complete",
            progress: DIRECTIONS.length + 3,
            currentDirection: null,
            walkFrames,
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

// Main endpoint
export const generateSprite = onRequest(
    {
        timeoutSeconds: 3600,
        memory: "512MiB",
        cors: true,
    },
    async (req, res) => {
        if (req.method === "OPTIONS") {
            res.status(204).send("");
            return;
        }

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

                if (job.status === "complete") {
                    res.status(200).json({
                        jobId,
                        status: job.status,
                        progress: job.progress,
                        total: job.total,
                        walkFrames: job.walkFrames,
                        idleFrames: job.idleFrames,
                    });
                } else if (job.status === "error") {
                    res.status(200).json({
                        jobId,
                        status: job.status,
                        error: job.error,
                    });
                } else {
                    // Still generating - include idleFrames if ready
                    const response: any = {
                        jobId,
                        status: job.status,
                        progress: job.progress,
                        total: job.total,
                        currentDirection: job.currentDirection,
                        idleReady: job.idleReady,
                    };

                    // Include idleFrames so client can start compositing early
                    if (job.idleReady && job.idleFrames) {
                        response.idleFrames = job.idleFrames;
                    }

                    res.status(200).json(response);
                }
            } catch (error) {
                const errMsg = error instanceof Error ? error.message : "Unknown error";
                res.status(500).json({ error: errMsg });
            }
            return;
        }

        if (req.method === "POST") {
            const { description } = req.body;

            if (!description || typeof description !== "string") {
                res.status(400).json({ error: "description is required" });
                return;
            }

            try {
                const jobRef = db.collection("spriteJobs").doc();
                const jobId = jobRef.id;

                const now = admin.firestore.FieldValue.serverTimestamp();
                await jobRef.set({
                    status: "pending",
                    description,
                    progress: 0,
                    total: DIRECTIONS.length + 3,
                    createdAt: now,
                    updatedAt: now,
                });

                console.log(`[${jobId}] Job created for: "${description}"`);

                processJob(jobId, description).catch(err => {
                    console.error(`[${jobId}] Background processing failed:`, err);
                });

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
