const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

const PIXELLAB_API_KEY = process.env.PIXELLAB_API_KEY || '9bb378e0-6b46-442d-9019-96216f8e8ba7';
const PIXELLAB_API_URL = 'https://api.pixellab.ai/v1';

const DIRECTIONS = [
    'south', 'south-west', 'west', 'north-west',
    'north', 'north-east', 'east', 'south-east'
];

app.use(cors());
app.use(express.json());

async function fetchPixellab(endpoint, body) {
    const response = await fetch(`${PIXELLAB_API_URL}/${endpoint}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${PIXELLAB_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    return response;
}

async function generateBaseCharacter(description) {
    console.log('  Generating base character...');
    const response = await fetchPixellab('generate-image-pixflux', {
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
        throw new Error('No image data in response');
    }

    return data.image.base64;
}

async function rotateCharacter(baseImage, toDirection) {
    console.log(`  Rotating to ${toDirection}...`);
    const response = await fetchPixellab('rotate', {
        from_image: { type: 'base64', base64: baseImage },
        image_size: { width: 64, height: 64 },
        from_direction: 'south',
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

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Generate sprite endpoint
app.post('/generate-sprite', async (req, res) => {
    const { description } = req.body;

    if (!description || typeof description !== 'string') {
        return res.status(400).json({ error: 'description is required' });
    }

    console.log(`[${new Date().toISOString()}] Starting generation: "${description}"`);

    try {
        // Step 1: Generate base character
        const baseImage = await generateBaseCharacter(description);
        console.log('  Base character generated');

        // Step 2: Rotate to all 8 directions (sequential)
        const images = {};
        for (const direction of DIRECTIONS) {
            const rotatedImage = await rotateCharacter(baseImage, direction);
            images[direction] = rotatedImage;
            console.log(`    ${direction}: done`);
        }

        console.log(`[${new Date().toISOString()}] Generation complete`);

        res.json({
            success: true,
            images,
            directions: DIRECTIONS,
        });

    } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[${new Date().toISOString()}] Error:`, errMsg);
        res.status(500).json({ error: errMsg });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sprite server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`Generate: POST http://localhost:${PORT}/generate-sprite`);
});
