/**
 * Test script to simulate the /api/generate-sprite route
 * Run with: npx ts-node scripts/test-sprite-generation.ts
 */

import sharp from 'sharp';
import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';

const PIXELLAB_API_KEY = process.env.PIXELLAB_API_KEY || '9bb378e0-6b46-442d-9019-96216f8e8ba7';
const PIXELLAB_API_URL = 'https://api.pixellab.ai/v1';

const DIRECTIONS = [
    'south', 'south-west', 'west', 'north-west',
    'north', 'north-east', 'east', 'south-east'
] as const;

type Direction = typeof DIRECTIONS[number];

const WALK_FRAME_SIZE = { width: 32, height: 40 };
const IDLE_FRAME_SIZE = { width: 24, height: 40 };
const WALK_FRAMES_PER_DIR = 6;
const IDLE_FRAMES_PER_DIR = 7;

function log(msg: string) {
    const ts = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`[${ts}] ${msg}`);
}

async function generateBaseCharacter(description: string): Promise<Buffer> {
    log(`Calling Pixellab generate-image-pixflux API...`);
    log(`  URL: ${PIXELLAB_API_URL}/generate-image-pixflux`);
    log(`  Description: "${description}"`);

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
    });

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
}

async function rotateCharacter(baseImageBuffer: Buffer, toDirection: Direction): Promise<Buffer> {
    const base64 = baseImageBuffer.toString('base64');
    log(`  Rotating to ${toDirection}...`);

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
    });

    log(`    ${toDirection}: status ${response.status}`);

    if (!response.ok) {
        const errorText = await response.text();
        log(`    ${toDirection}: error - ${errorText.slice(0, 200)}`);
        throw new Error(`Failed to rotate to ${toDirection}: ${response.status}`);
    }

    const data = await response.json();
    if (!data.image?.base64) {
        log(`    ${toDirection}: no image.base64 in response`);
        throw new Error(`No image data for ${toDirection}`);
    }

    const buffer = Buffer.from(data.image.base64, 'base64');
    log(`    ${toDirection}: ✓ ${buffer.length} bytes`);
    return buffer;
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

    const scale = Math.min(
        targetSize.width / metadata.width,
        targetSize.height / metadata.height
    );
    const newWidth = Math.round(metadata.width * scale);
    const newHeight = Math.round(metadata.height * scale);

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

    const compositeOps: sharp.OverlayOptions[] = [];

    for (let row = 0; row < DIRECTIONS.length; row++) {
        const direction = DIRECTIONS[row];
        const buffer = directionBuffers.get(direction);

        if (!buffer) {
            log(`Warning: Missing buffer for direction: ${direction}`);
            continue;
        }

        const resizedFrame = await resizeAndCenter(buffer, frameSize);

        for (let col = 0; col < framesPerDirection; col++) {
            compositeOps.push({
                input: resizedFrame,
                left: col * frameSize.width,
                top: row * frameSize.height,
            });
        }
    }

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

async function main() {
    const description = process.argv[2] || 'wizard';
    const spriteName = description.replace(/[^a-z0-9]/gi, '_').toLowerCase();

    log(`=== Testing Sprite Generation ===`);
    log(`Description: "${description}"`);
    log(`Sprite name: "${spriteName}"`);
    log(`API Key: ${PIXELLAB_API_KEY.slice(0, 8)}...`);
    log(``);

    try {
        // Step 1: Generate base character
        log(`Step 1: Generating base character...`);
        const baseBuffer = await generateBaseCharacter(description);
        log(`Step 1: Complete\n`);

        // Step 2: Rotate to all 8 directions
        log(`Step 2: Rotating to 8 directions...`);
        const directionBuffers = new Map<Direction, Buffer>();

        for (const direction of DIRECTIONS) {
            try {
                const buffer = await rotateCharacter(baseBuffer, direction);
                directionBuffers.set(direction, buffer);
            } catch (err) {
                log(`  ✗ ${direction} FAILED: ${err}`);
            }
        }
        log(`Step 2: Complete (${directionBuffers.size}/8 directions)\n`);

        // Step 3: Composite sprite sheets
        log(`Step 3: Compositing sprite sheets...`);
        const [walkSheet, idleSheet] = await Promise.all([
            compositeSpriteSheet(directionBuffers, WALK_FRAME_SIZE, WALK_FRAMES_PER_DIR),
            compositeSpriteSheet(directionBuffers, IDLE_FRAME_SIZE, IDLE_FRAMES_PER_DIR),
        ]);
        log(`  Walk sheet: ${walkSheet.length} bytes`);
        log(`  Idle sheet: ${idleSheet.length} bytes`);
        log(`Step 3: Complete\n`);

        // Step 4: Save files
        log(`Step 4: Saving files...`);
        const spritesDir = join(process.cwd(), 'public', 'sprites', 'generated');
        await mkdir(spritesDir, { recursive: true });

        const walkPath = join(spritesDir, `${spriteName}_walk.png`);
        const idlePath = join(spritesDir, `${spriteName}_idle.png`);
        const basePath = join(spritesDir, `${spriteName}_base.png`);

        await Promise.all([
            writeFile(walkPath, walkSheet),
            writeFile(idlePath, idleSheet),
            writeFile(basePath, baseBuffer),
        ]);

        log(`  Saved: ${walkPath}`);
        log(`  Saved: ${idlePath}`);
        log(`  Saved: ${basePath}`);
        log(`Step 4: Complete\n`);

        log(`=== SUCCESS ===`);
        log(`Walk sheet: /sprites/generated/${spriteName}_walk.png`);
        log(`Idle sheet: /sprites/generated/${spriteName}_idle.png`);

    } catch (error) {
        log(`\n=== FAILED ===`);
        log(`Error: ${error}`);
        process.exit(1);
    }
}

main();
