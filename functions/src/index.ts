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
    images?: Record<string, string>;
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
    const response = await fetchPixellab(apiKey, "generate-image-pixflux", {
        description,
        image_size: { width: 64, height: 64 },
        text_guidance_scale: 8,
        no_background: true,
    });

    if (!response.ok) {
        throw new Error(`Base generation failed: ${response.status}`);
    }

    const data = await response.json();
    if (!data.image?.base64) {
        throw new Error("No image data in response");
    }

    return data.image.base64;
}

async function rotateCharacter(apiKey: string, baseImage: string, toDirection: Direction): Promise<string> {
    const response = await fetchPixellab(apiKey, "rotate", {
        from_image: { type: "base64", base64: baseImage },
        image_size: { width: 64, height: 64 },
        from_direction: "south",
        to_direction: toDirection,
    });

    if (!response.ok) {
        throw new Error(`Rotate to ${toDirection} failed: ${response.status}`);
    }

    const data = await response.json();
    if (!data.image?.base64) {
        throw new Error(`No image data for ${toDirection}`);
    }

    return data.image.base64;
}

// Process job in background (updates Firestore as it progresses)
async function processJob(jobId: string, description: string): Promise<void> {
    const jobRef = db.collection("spriteJobs").doc(jobId);
    const apiKey = PIXELLAB_API_KEY;

    try {
        // Update status to generating
        await jobRef.update({
            status: "generating",
            currentDirection: "base",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[${jobId}] Generating base character...`);
        const baseImage = await generateBaseCharacter(apiKey, description);
        console.log(`[${jobId}] Base character generated`);

        const images: Record<string, string> = {};

        // Process each direction
        for (let i = 0; i < DIRECTIONS.length; i++) {
            const direction = DIRECTIONS[i];

            await jobRef.update({
                progress: i,
                currentDirection: direction,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            console.log(`[${jobId}] [${i + 1}/8] Rotating to ${direction}...`);
            const rotatedImage = await rotateCharacter(apiKey, baseImage, direction);
            images[direction] = rotatedImage;
            console.log(`[${jobId}] ${direction}: done`);

            // Small delay to avoid rate limits
            if (i < DIRECTIONS.length - 1) {
                await new Promise(r => setTimeout(r, 500));
            }
        }

        // Mark complete with images
        await jobRef.update({
            status: "complete",
            progress: DIRECTIONS.length,
            currentDirection: null,
            images,
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

                // Return status without images if still processing
                if (job.status === "complete") {
                    res.status(200).json({
                        jobId,
                        status: job.status,
                        progress: job.progress,
                        total: job.total,
                        images: job.images,
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
