import { NextRequest, NextResponse } from 'next/server';
import sharpModule, { OverlayOptions } from 'sharp';
import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';

const sharp = sharpModule;

const PIXELLAB_API_KEY = process.env.PIXELLAB_API_KEY || '9bb378e0-6b46-442d-9019-96216f8e8ba7';
const PIXELLAB_API_URL = 'https://api.pixellab.ai/v1';

// Pixellab API is slow - 30-60s per image generation
const FETCH_TIMEOUT_MS = 120000; // 2 minutes per request

// Next.js route config - extend timeout to 5 minutes for full generation
export const maxDuration = 300;

// Sprite sheet configuration (matching Mudkip format)
const WALK_FRAME_SIZE = { width: 32, height: 40 };
const IDLE_FRAME_SIZE = { width: 24, height: 40 };
const WALK_FRAMES_PER_DIR = 6;
const IDLE_FRAMES_PER_DIR = 7;
const DIRECTIONS = [
    'south', 'south-west', 'west', 'north-west',
    'north', 'north-east', 'east', 'south-east'
] as const;

type Direction = typeof DIRECTIONS[number];

interface PixellabRotateResponse {
    image: {
        base64: string;
    };
}

async function generateBaseCharacter(description: string, log: (msg: string) => void): Promise<Buffer> {
    log(`Calling Pixellab generate-image-pixflux API...`);
    log(`  URL: ${PIXELLAB_API_URL}/generate-image-pixflux`);
    log(`  Description: "${description}"`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(`${PIXELLAB_API_URL}/generate-image-pixflux`, {
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
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        log(`  Response status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errorText = await response.text();
            log(`  Error body: ${errorText.slice(0, 500)}`);
            throw new Error(`Failed to generate base character: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        log(`  Response keys: ${Object.keys(data).join(', ')}`);

        if (!data.image?.base64) {
            log(`  ERROR: No image.base64 in response`);
            log(`  Full response: ${JSON.stringify(data).slice(0, 500)}`);
            throw new Error('No image data in response');
        }

        const buffer = Buffer.from(data.image.base64, 'base64');
        log(`  Got image: ${buffer.length} bytes`);
        return buffer;
    } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof Error && err.name === 'AbortError') {
            throw new Error(`Pixellab API timeout after ${FETCH_TIMEOUT_MS / 1000}s`);
        }
        throw err;
    }
}

async function rotateCharacter(baseImageBuffer: Buffer, toDirection: Direction, log: (msg: string) => void): Promise<Buffer> {
    const base64 = baseImageBuffer.toString('base64');
    log(`  Rotating to ${toDirection}...`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(`${PIXELLAB_API_URL}/rotate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PIXELLAB_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from_image: { type: 'base64', base64 },
                image_size: { width: 64, height: 64 },
                from_direction: 'south',
                to_direction: toDirection,
            }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        log(`    ${toDirection}: status ${response.status}`);

        if (!response.ok) {
            const errorText = await response.text();
            log(`    ${toDirection}: error - ${errorText.slice(0, 200)}`);
            throw new Error(`Failed to rotate to ${toDirection}: ${response.status} - ${errorText.slice(0, 100)}`);
        }

        const data = await response.json();
        if (!data.image?.base64) {
            log(`    ${toDirection}: no image.base64 in response`);
            throw new Error(`No image data for ${toDirection}`);
        }

        const buffer = Buffer.from(data.image.base64, 'base64');
        log(`    ${toDirection}: ✓ ${buffer.length} bytes`);
        return buffer;
    } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof Error && err.name === 'AbortError') {
            throw new Error(`Rotate ${toDirection} timeout after ${FETCH_TIMEOUT_MS / 1000}s`);
        }
        throw err;
    }
}

async function resizeAndCenter(
    imageBuffer: Buffer,
    targetSize: { width: number; height: number }
): Promise<Buffer> {
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
        throw new Error('Could not get image dimensions');
    }

    // Calculate scale to fit within target
    const scale = Math.min(
        targetSize.width / metadata.width,
        targetSize.height / metadata.height
    );
    const newWidth = Math.round(metadata.width * scale);
    const newHeight = Math.round(metadata.height * scale);

    // Resize and extend to center on transparent canvas
    return sharp(imageBuffer)
        .resize(newWidth, newHeight, { fit: 'inside' })
        .extend({
            top: Math.floor((targetSize.height - newHeight) / 2),
            bottom: Math.ceil((targetSize.height - newHeight) / 2),
            left: Math.floor((targetSize.width - newWidth) / 2),
            right: Math.ceil((targetSize.width - newWidth) / 2),
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
}

async function compositeSpriteSheet(
    directionBuffers: Map<Direction, Buffer>,
    frameSize: { width: number; height: number },
    framesPerDirection: number
): Promise<Buffer> {
    const sheetWidth = frameSize.width * framesPerDirection;
    const sheetHeight = frameSize.height * DIRECTIONS.length;

    // Create composite operations for each direction
    const compositeOps: OverlayOptions[] = [];

    for (let row = 0; row < DIRECTIONS.length; row++) {
        const direction = DIRECTIONS[row];
        const buffer = directionBuffers.get(direction);

        if (!buffer) {
            console.warn(`Missing buffer for direction: ${direction}`);
            continue;
        }

        // Resize frame to target size
        const resizedFrame = await resizeAndCenter(buffer, frameSize);

        // Repeat same frame across all columns (static sprite)
        for (let col = 0; col < framesPerDirection; col++) {
            compositeOps.push({
                input: resizedFrame,
                left: col * frameSize.width,
                top: row * frameSize.height,
            });
        }
    }

    // Create transparent base and composite all frames
    return sharp({
        create: {
            width: sheetWidth,
            height: sheetHeight,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
    })
        .composite(compositeOps)
        .png()
        .toBuffer();
}

export async function POST(request: NextRequest) {
    const steps: string[] = [];
    const log = (msg: string) => {
        const ts = new Date().toISOString().split('T')[1].split('.')[0];
        steps.push(`[${ts}] ${msg}`);
        console.log(`[SpriteAPI] ${msg}`);
    };

    try {
        const { description, name } = await request.json();
        log(`Request: description="${description}", name="${name}"`);

        if (!description || typeof description !== 'string') {
            return NextResponse.json(
                { error: 'description is required and must be a string', steps },
                { status: 400 }
            );
        }

        const spriteName = name || description.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const spritesDir = join(process.cwd(), 'public', 'sprites', 'generated');

        // Ensure output directory exists
        await mkdir(spritesDir, { recursive: true });
        log(`Output dir: ${spritesDir}`);

        // Step 1: Generate base character (facing south)
        log(`Step 1: Generating base character...`);
        const baseBuffer = await generateBaseCharacter(description, log);
        log(`Step 1: Complete`);

        // Step 2: Rotate to all 8 directions (sequential to avoid rate limiting)
        log(`Step 2: Rotating to 8 directions (sequential)...`);
        const directionBuffers = new Map<Direction, Buffer>();
        const failedDirections: string[] = [];

        for (const direction of DIRECTIONS) {
            try {
                const buffer = await rotateCharacter(baseBuffer, direction, log);
                directionBuffers.set(direction, buffer);
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                log(`  ✗ ${direction} FAILED: ${errMsg}`);
                failedDirections.push(direction);
            }
        }

        if (failedDirections.length > 0) {
            return NextResponse.json({
                error: `Failed to rotate: ${failedDirections.join(', ')}`,
                steps
            }, { status: 500 });
        }
        log(`Step 2: All ${directionBuffers.size} rotations complete`);

        // Step 3: Composite sprite sheets
        log(`Step 3: Compositing sprite sheets...`);

        const [walkSheet, idleSheet] = await Promise.all([
            compositeSpriteSheet(directionBuffers, WALK_FRAME_SIZE, WALK_FRAMES_PER_DIR),
            compositeSpriteSheet(directionBuffers, IDLE_FRAME_SIZE, IDLE_FRAMES_PER_DIR),
        ]);
        log(`Step 3: Walk=${walkSheet.length}b, Idle=${idleSheet.length}b`);

        // Step 4: Save sprite sheets
        log(`Step 4: Saving files...`);
        const walkPath = join(spritesDir, `${spriteName}_walk.png`);
        const idlePath = join(spritesDir, `${spriteName}_idle.png`);

        await Promise.all([
            writeFile(walkPath, walkSheet),
            writeFile(idlePath, idleSheet),
        ]);

        // Also save the base image for reference
        const basePath = join(spritesDir, `${spriteName}_base.png`);
        await writeFile(basePath, baseBuffer);
        log(`Step 4: Files saved`);

        const result = {
            name: spriteName,
            walkSheet: `/sprites/generated/${spriteName}_walk.png`,
            idleSheet: `/sprites/generated/${spriteName}_idle.png`,
            baseImage: `/sprites/generated/${spriteName}_base.png`,
            steps,
        };

        log(`Done!`);

        return NextResponse.json(result);
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Failed to generate sprite';
        log(`ERROR: ${errMsg}`);
        console.error('Sprite generation failed:', error);
        return NextResponse.json(
            { error: errMsg, steps },
            { status: 500 }
        );
    }
}
