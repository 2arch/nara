import { NextRequest, NextResponse } from 'next/server';

const PIXELLAB_API_KEY = process.env.PIXELLAB_API_KEY || '9bb378e0-6b46-442d-9019-96216f8e8ba7';
const PIXELLAB_API_URL = 'https://api.pixellab.ai/v1';

// Pixellab API is slow - 30-60s per image generation
const FETCH_TIMEOUT_MS = 120000;

// Next.js route config - extend timeout
export const maxDuration = 300;

const DIRECTIONS = [
    'south', 'south-west', 'west', 'north-west',
    'north', 'north-east', 'east', 'south-east'
] as const;

type Direction = typeof DIRECTIONS[number];

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
    } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof Error && err.name === 'AbortError') {
            throw new Error(`Request timeout after ${FETCH_TIMEOUT_MS / 1000}s`);
        }
        throw err;
    }
}

async function generateBaseCharacter(description: string, log: (msg: string) => void): Promise<string> {
    log(`Generating base character...`);

    const response = await fetchWithTimeout(`${PIXELLAB_API_URL}/generate-image-pixflux`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${PIXELLAB_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            description,
            image_size: { width: 64, height: 64 },
            text_guidance_scale: 8,
            no_background: true,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to generate: ${response.status} - ${errorText.slice(0, 100)}`);
    }

    const data = await response.json();
    if (!data.image?.base64) {
        throw new Error('No image data in response');
    }

    log(`Base character generated`);
    return data.image.base64;
}

async function rotateCharacter(baseImageBase64: string, toDirection: Direction, log: (msg: string) => void): Promise<string> {
    log(`  Rotating to ${toDirection}...`);

    const response = await fetchWithTimeout(`${PIXELLAB_API_URL}/rotate`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${PIXELLAB_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from_image: { type: 'base64', base64: baseImageBase64 },
            image_size: { width: 64, height: 64 },
            from_direction: 'south',
            to_direction: toDirection,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to rotate to ${toDirection}: ${response.status}`);
    }

    const data = await response.json();
    if (!data.image?.base64) {
        throw new Error(`No image data for ${toDirection}`);
    }

    log(`    ${toDirection}: done`);
    return data.image.base64;
}

export async function POST(request: NextRequest) {
    const steps: string[] = [];
    const log = (msg: string) => {
        steps.push(msg);
        console.log(`[SpriteAPI] ${msg}`);
    };

    try {
        const { description } = await request.json();

        if (!description || typeof description !== 'string') {
            return NextResponse.json(
                { error: 'description is required' },
                { status: 400 }
            );
        }

        log(`Starting generation for: "${description}"`);

        // Step 1: Generate base character (facing south)
        const baseImage = await generateBaseCharacter(description, log);

        // Step 2: Rotate to all 8 directions (sequential to avoid rate limiting)
        log(`Rotating to 8 directions...`);
        const directionImages: Record<string, string> = {};

        for (const direction of DIRECTIONS) {
            const rotatedImage = await rotateCharacter(baseImage, direction, log);
            directionImages[direction] = rotatedImage;
        }

        log(`All rotations complete`);

        // Return base64 images - client will composite them
        return NextResponse.json({
            success: true,
            images: directionImages,
            directions: DIRECTIONS,
            steps,
        });

    } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Failed to generate sprite';
        log(`ERROR: ${errMsg}`);
        return NextResponse.json(
            { error: errMsg, steps },
            { status: 500 }
        );
    }
}
