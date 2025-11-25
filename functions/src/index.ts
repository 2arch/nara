import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();

// API key - set via environment variable or use default for testing
const PIXELLAB_API_KEY = process.env.PIXELLAB_API_KEY || "9bb378e0-6b46-442d-9019-96216f8e8ba7";
const PIXELLAB_API_URL = "https://api.pixellab.ai/v1";

const DIRECTIONS = [
    "south", "south-west", "west", "north-west",
    "north", "north-east", "east", "south-east"
] as const;

type Direction = typeof DIRECTIONS[number];

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

async function fetchPixellab(apiKey: string, endpoint: string, body: object): Promise<Response> {
    return fetch(`${PIXELLAB_API_URL}/${endpoint}`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
}

async function generateBaseCharacter(apiKey: string, description: string): Promise<string> {
    console.log(`[generateBaseCharacter] Starting generation for: "${description}"`);

    const response = await fetchPixellab(apiKey, "generate-image-pixflux", {
        description,
        image_size: { width: 64, height: 64 },
        text_guidance_scale: 8,
        no_background: true,
    });

    console.log(`[generateBaseCharacter] Response status: ${response.status}`);

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[generateBaseCharacter] Error response:`, errorText);
        throw new Error(`Base generation failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`[generateBaseCharacter] Response data keys:`, Object.keys(data));

    if (!data.image?.base64) {
        console.error(`[generateBaseCharacter] No image data in response:`, JSON.stringify(data));
        throw new Error("No image data in response");
    }

    console.log(`[generateBaseCharacter] Success - base64 length: ${data.image.base64.length}`);
    return data.image.base64;
}

async function rotateCharacter(apiKey: string, baseImage: string, toDirection: Direction): Promise<string> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetchPixellab(apiKey, "rotate", {
                from_image: { type: "base64", base64: baseImage },
                image_size: { width: 64, height: 64 },
                from_direction: "south",
                to_direction: toDirection,
            });

            if (response.status === 429) {
                // Rate limit - wait with exponential backoff
                const waitTime = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s
                console.log(`Rate limited on ${toDirection}, waiting ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }

            if (!response.ok) {
                throw new Error(`Rotate to ${toDirection} failed: ${response.status}`);
            }

            const data = await response.json();
            if (!data.image?.base64) {
                throw new Error(`No image data for ${toDirection}`);
            }

            return data.image.base64;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt < maxRetries - 1) {
                const waitTime = Math.pow(2, attempt) * 2000;
                console.log(`Error on ${toDirection}, retrying in ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }

    throw lastError || new Error(`Failed to rotate to ${toDirection} after ${maxRetries} attempts`);
}

// Process job in background (updates Firestore as it progresses)
async function processJob(jobId: string, description: string): Promise<void> {
    const jobRef = db.collection("spriteJobs").doc(jobId);
    const apiKey = PIXELLAB_API_KEY;

    try {
        // Update status to generating
        await jobRef.update({
            status: "generating",
            currentDirection: "creating character",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[${jobId}] Step 1: Generating base character...`);

        // Step 1: Generate base character image
        const baseImage = await generateBaseCharacter(apiKey, description);
        console.log(`[${jobId}] Base character generated`);

        // Step 2: Rotate to all 8 directions
        await jobRef.update({
            currentDirection: "rotating",
            progress: 1,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[${jobId}] Step 2: Rotating to all directions...`);
        const rotatedImages: Record<string, string> = { south: baseImage };

        // Rotate sequentially with delay to avoid rate limiting
        for (const direction of DIRECTIONS.filter(dir => dir !== "south")) {
            const rotated = await rotateCharacter(apiKey, baseImage, direction);
            rotatedImages[direction] = rotated;
            await jobRef.update({
                progress: admin.firestore.FieldValue.increment(1),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            console.log(`[${jobId}] Rotated to ${direction}`);

            // Small delay between rotations to respect rate limits
            await new Promise(r => setTimeout(r, 1000)); // 1 second delay
        }

        console.log(`[${jobId}] All rotations complete`);

        // Step 3: Generate walking animations for each direction
        await jobRef.update({
            currentDirection: "animating walk",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[${jobId}] Step 3: Generating walking animations...`);
        const walkFrames: Record<string, string[]> = {};

        for (const direction of DIRECTIONS) {
            await jobRef.update({
                currentDirection: `walk ${direction}`,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            // Retry logic for walk animation
            let walkSuccess = false;
            let walkAttempts = 0;
            const maxWalkAttempts = 3;

            while (!walkSuccess && walkAttempts < maxWalkAttempts) {
                walkAttempts++;
                try {
                    const walkRes = await fetch(`${PIXELLAB_API_URL}/animate-with-text`, {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${apiKey}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            description,
                            action: "walking",
                            reference_image: { type: "base64", base64: rotatedImages[direction] },
                            image_size: { width: 64, height: 64 },
                            n_frames: 6,
                            direction,
                            view: "low top-down",
                            text_guidance_scale: 8,
                        }),
                    });

                    if (walkRes.status === 429 && walkAttempts < maxWalkAttempts) {
                        const waitTime = Math.pow(2, walkAttempts - 1) * 2000;
                        console.log(`[${jobId}] Rate limited on walk ${direction}, waiting ${waitTime}ms (attempt ${walkAttempts}/${maxWalkAttempts})`);
                        await new Promise(r => setTimeout(r, waitTime));
                        continue;
                    }

                    if (!walkRes.ok) {
                        throw new Error(`Walk animation ${direction} failed: ${walkRes.status}`);
                    }

                    const walkData = await walkRes.json();
                    walkFrames[direction] = walkData.images.map((img: any) => img.base64);
                    console.log(`[${jobId}] Walk ${direction} complete (${walkFrames[direction].length} frames)`);
                    walkSuccess = true;
                } catch (error) {
                    if (walkAttempts >= maxWalkAttempts) {
                        throw error;
                    }
                    const waitTime = Math.pow(2, walkAttempts - 1) * 2000;
                    console.log(`[${jobId}] Error on walk ${direction}, retrying in ${waitTime}ms`);
                    await new Promise(r => setTimeout(r, waitTime));
                }
            }

            // Small delay between animations
            await new Promise(r => setTimeout(r, 500));
        }

        // Step 4: Create static idle frames (use rotated images, no animation needed)
        console.log(`[${jobId}] Step 4: Creating static idle frames...`);
        const idleFrames: Record<string, string[]> = {};

        for (const direction of DIRECTIONS) {
            // Use the static rotated image for all 7 idle frames
            idleFrames[direction] = Array(7).fill(rotatedImages[direction]);
        }
        console.log(`[${jobId}] Static idle frames created`);

        // Update job with complete animation frames
        await jobRef.update({
            status: "complete",
            progress: DIRECTIONS.length,
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
        timeoutSeconds: 300,
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

// Quick endpoint - generates base image only, duplicates for all directions
// No polling needed - returns immediately with all images
export const generateSpriteQuick = onRequest(
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
            console.log(`[quick] Generating: "${description}"`);
            const baseImage = await generateBaseCharacter(apiKey, description);
            console.log(`[quick] Done`);

            // Use the same image for all 8 directions
            const images: Record<string, string> = {};
            for (const dir of DIRECTIONS) {
                images[dir] = baseImage;
            }

            res.status(200).json({
                status: "complete",
                images,
                directions: DIRECTIONS,
            });

        } catch (error) {
            const errMsg = error instanceof Error ? error.message : "Unknown error";
            console.error(`[quick] Error:`, errMsg);
            res.status(500).json({ error: errMsg });
        }
    }
);
