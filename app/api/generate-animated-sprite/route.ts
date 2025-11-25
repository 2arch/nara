import { NextRequest, NextResponse } from 'next/server';

const PIXELLAB_API_KEY = process.env.PIXELLAB_API_KEY || '9bb378e0-6b46-442d-9019-96216f8e8ba7';
const PIXELLAB_API_URL = 'https://api.pixellab.ai/v1';

const SPRITE_DIRECTIONS = [
    'south', 'south-west', 'west', 'north-west',
    'north', 'north-east', 'east', 'south-east'
] as const;

interface AnimationFrame {
    base64: string;
}

interface AnimationData {
    frames: AnimationFrame[];
}

export async function POST(request: NextRequest) {
    try {
        const { description } = await request.json();

        if (!description) {
            return NextResponse.json({ error: 'Description required' }, { status: 400 });
        }

        console.log(`[AnimatedSprite] Starting generation for: "${description}"`);

        // Step 1: Create character with 8 directions
        console.log('[AnimatedSprite] Step 1: Creating character...');
        const characterRes = await fetch(`${PIXELLAB_API_URL}/generate-image-pixflux`, {
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

        if (!characterRes.ok) {
            throw new Error(`Character generation failed: ${characterRes.status}`);
        }

        const characterData = await characterRes.json();
        const baseImage = characterData.image?.base64;
        if (!baseImage) {
            throw new Error('No base image in response');
        }

        console.log('[AnimatedSprite] Base character created');

        // Step 2: Rotate to all 8 directions
        console.log('[AnimatedSprite] Step 2: Rotating to 8 directions...');
        const rotationPromises = SPRITE_DIRECTIONS.map(async (direction) => {
            const rotateRes = await fetch(`${PIXELLAB_API_URL}/rotate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${PIXELLAB_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    from_image: { type: 'base64', base64: baseImage },
                    image_size: { width: 64, height: 64 },
                    from_direction: 'south',
                    to_direction: direction,
                }),
            });

            if (!rotateRes.ok) {
                throw new Error(`Rotation to ${direction} failed`);
            }

            const rotateData = await rotateRes.json();
            return { direction, image: rotateData.image?.base64 };
        });

        const rotations = await Promise.all(rotationPromises);
        console.log('[AnimatedSprite] All rotations complete');

        // For now, return static images (animations would require character ID setup)
        // TODO: Implement actual PixelLab character creation + animation workflow
        const staticImages: Record<string, string> = {};
        for (const { direction, image} of rotations) {
            staticImages[direction] = image;
        }

        return NextResponse.json({
            status: 'complete',
            images: staticImages,
            // Note: These are static for now. Full animation requires:
            // 1. POST to /mcp/characters to create character
            // 2. POST to /mcp/characters/{id}/animations to generate animations
            // 3. Poll for completion
            // 4. Download frames from character ZIP
        });

    } catch (error: any) {
        console.error('[AnimatedSprite] Error:', error);
        return NextResponse.json(
            { error: error.message || 'Sprite generation failed' },
            { status: 500 }
        );
    }
}
