import { NextRequest, NextResponse } from 'next/server';

const PIXELLAB_API_KEY = process.env.PIXELLAB_API_KEY || '9bb378e0-6b46-442d-9019-96216f8e8ba7';
const PIXELLAB_API_URL = 'https://api.pixellab.ai/v1';

const DIRECTIONS = [
    'south', 'south-west', 'west', 'north-west',
    'north', 'north-east', 'east', 'south-east'
] as const;

type Direction = typeof DIRECTIONS[number];

// In-memory job storage (for serverless, consider using KV or Redis)
// Jobs expire after 10 minutes
const jobs = new Map<string, {
    status: 'pending' | 'generating' | 'complete' | 'error';
    description: string;
    progress: number;
    total: number;
    images: Record<string, string>;
    error?: string;
    createdAt: number;
}>();

// Clean up old jobs periodically
function cleanupJobs() {
    const now = Date.now();
    const TEN_MINUTES = 10 * 60 * 1000;
    for (const [id, job] of jobs) {
        if (now - job.createdAt > TEN_MINUTES) {
            jobs.delete(id);
        }
    }
}

function generateJobId(): string {
    return Math.random().toString(36).substring(2, 15);
}

async function fetchPixellab(url: string, body: object): Promise<Response> {
    return fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${PIXELLAB_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
}

// Process a single direction (called incrementally)
async function processDirection(
    jobId: string,
    baseImage: string,
    direction: Direction,
    directionIndex: number
): Promise<void> {
    const job = jobs.get(jobId);
    if (!job) return;

    try {
        const response = await fetchPixellab(`${PIXELLAB_API_URL}/rotate`, {
            from_image: { type: 'base64', base64: baseImage },
            image_size: { width: 64, height: 64 },
            from_direction: 'south',
            to_direction: direction,
        });

        if (!response.ok) {
            throw new Error(`Rotate failed: ${response.status}`);
        }

        const data = await response.json();
        if (!data.image?.base64) {
            throw new Error('No image data');
        }

        job.images[direction] = data.image.base64;
        job.progress = directionIndex + 1;

        if (job.progress === job.total) {
            job.status = 'complete';
        }
    } catch (err) {
        job.status = 'error';
        job.error = err instanceof Error ? err.message : 'Unknown error';
    }
}

// Start generation job
export async function POST(request: NextRequest) {
    cleanupJobs();

    try {
        const { description } = await request.json();

        if (!description || typeof description !== 'string') {
            return NextResponse.json({ error: 'description is required' }, { status: 400 });
        }

        // Create job
        const jobId = generateJobId();
        jobs.set(jobId, {
            status: 'pending',
            description,
            progress: 0,
            total: DIRECTIONS.length,
            images: {},
            createdAt: Date.now(),
        });

        // Start async generation (don't await - let it run in background)
        (async () => {
            const job = jobs.get(jobId);
            if (!job) return;

            try {
                job.status = 'generating';

                // Generate base character
                const response = await fetchPixellab(`${PIXELLAB_API_URL}/generate-image-pixflux`, {
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
                    throw new Error('No image data');
                }

                const baseImage = data.image.base64;

                // Process all directions sequentially
                for (let i = 0; i < DIRECTIONS.length; i++) {
                    await processDirection(jobId, baseImage, DIRECTIONS[i], i);
                    const currentJob = jobs.get(jobId);
                    if (currentJob?.status === 'error') break;
                }
            } catch (err) {
                const currentJob = jobs.get(jobId);
                if (currentJob) {
                    currentJob.status = 'error';
                    currentJob.error = err instanceof Error ? err.message : 'Unknown error';
                }
            }
        })();

        // Return immediately with job ID
        return NextResponse.json({
            jobId,
            status: 'pending',
            message: 'Generation started. Poll /api/generate-sprite/status?jobId=' + jobId,
        });

    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to start generation' },
            { status: 500 }
        );
    }
}

// Poll for job status
export async function GET(request: NextRequest) {
    cleanupJobs();

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
        return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    const job = jobs.get(jobId);
    if (!job) {
        return NextResponse.json({ error: 'Job not found or expired' }, { status: 404 });
    }

    return NextResponse.json({
        jobId,
        status: job.status,
        progress: job.progress,
        total: job.total,
        ...(job.status === 'complete' && { images: job.images, directions: DIRECTIONS }),
        ...(job.status === 'error' && { error: job.error }),
    });
}
