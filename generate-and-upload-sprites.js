/**
 * Procedural Ruins Sprite Generator & Uploader
 * Generates mossy cobblestone border tiles and uploads to Firebase Storage
 */

const fs = require('fs');
const path = require('path');

// Check if canvas is available, otherwise use sharp or jimp
let createCanvas, Canvas;
try {
    const canvas = require('canvas');
    createCanvas = canvas.createCanvas;
    Canvas = canvas;
} catch (e) {
    console.error('canvas package not found. Install with: npm install canvas');
    console.log('Falling back to browser-based generation...');
    process.exit(1);
}

const SIZE = 64;
const OUTPUT_DIR = path.join(__dirname, 'tmp-sprites');

// Tile configurations
const tiles = [
    { name: 'corner-tl', type: 'corner', rotation: 0 },
    { name: 'corner-tr', type: 'corner', rotation: 90 },
    { name: 'corner-br', type: 'corner', rotation: 180 },
    { name: 'corner-bl', type: 'corner', rotation: 270 },
    { name: 'edge-top', type: 'edge', rotation: 0 },
    { name: 'edge-right', type: 'edge', rotation: 90 },
    { name: 'edge-bottom', type: 'edge', rotation: 180 },
    { name: 'edge-left', type: 'edge', rotation: 270 }
];

// Noise function (Perlin-like)
function noise(x, y, seed = 0) {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
    return n - Math.floor(n);
}

function smoothNoise(x, y, scale, seed) {
    const sx = x / scale;
    const sy = y / scale;
    const x0 = Math.floor(sx);
    const x1 = x0 + 1;
    const y0 = Math.floor(sy);
    const y1 = y0 + 1;

    const fx = sx - x0;
    const fy = sy - y0;

    const n00 = noise(x0, y0, seed);
    const n10 = noise(x1, y0, seed);
    const n01 = noise(x0, y1, seed);
    const n11 = noise(x1, y1, seed);

    const nx0 = n00 * (1 - fx) + n10 * fx;
    const nx1 = n01 * (1 - fx) + n11 * fx;

    return nx0 * (1 - fy) + nx1 * fy;
}

function generateStoneTexture(darkness, mossAmount, noiseScale) {
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(SIZE, SIZE);
    const data = imageData.data;

    const seed = Math.random() * 1000;

    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const idx = (y * SIZE + x) * 4;

            // Multi-octave noise for stone texture
            let n = 0;
            n += smoothNoise(x, y, noiseScale, seed) * 0.5;
            n += smoothNoise(x, y, noiseScale / 2, seed + 1) * 0.25;
            n += smoothNoise(x, y, noiseScale / 4, seed + 2) * 0.125;
            n += smoothNoise(x, y, noiseScale / 8, seed + 3) * 0.0625;

            // Base stone color (gray with variation)
            const stoneBase = 80 + n * 60;
            let r = stoneBase * (1 - darkness);
            let g = stoneBase * (1 - darkness);
            let b = stoneBase * (1 - darkness * 0.8);

            // Add moss (green overlay)
            const mossNoise = smoothNoise(x, y, noiseScale * 0.7, seed + 10);
            if (mossNoise > (1 - mossAmount)) {
                const mossIntensity = (mossNoise - (1 - mossAmount)) / mossAmount;
                r = r * (1 - mossIntensity) + 40 * mossIntensity;
                g = g * (1 - mossIntensity) + 80 * mossIntensity;
                b = b * (1 - mossIntensity) + 35 * mossIntensity;
            }

            // Add cracks/damage
            const crackNoise = smoothNoise(x * 2, y * 2, noiseScale / 2, seed + 20);
            if (crackNoise < 0.1) {
                r *= 0.6;
                g *= 0.6;
                b *= 0.6;
            }

            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255;
        }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

function generateCorner(baseTexture, rotation) {
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');

    // Draw base texture
    ctx.drawImage(baseTexture, 0, 0);

    // Add corner detail (darker edge lines)
    ctx.save();
    ctx.translate(SIZE / 2, SIZE / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-SIZE / 2, -SIZE / 2);

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(SIZE, 0);
    ctx.moveTo(0, 0);
    ctx.lineTo(0, SIZE);
    ctx.stroke();

    ctx.restore();

    return canvas;
}

function generateEdge(baseTexture, rotation) {
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');

    // Draw base texture
    ctx.drawImage(baseTexture, 0, 0);

    // Add edge detail (darker line at top)
    ctx.save();
    ctx.translate(SIZE / 2, SIZE / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-SIZE / 2, -SIZE / 2);

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(SIZE, 0);
    ctx.stroke();

    ctx.restore();

    return canvas;
}

async function generateSprites() {
    console.log('🏛️  Generating ruins sprites...');

    // Create output directory
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Generation parameters
    const darkness = 0.3;
    const mossAmount = 0.4;
    const noiseScale = 8;

    const filePaths = [];

    for (const tile of tiles) {
        const baseTexture = generateStoneTexture(darkness, mossAmount, noiseScale);
        let canvas;

        if (tile.type === 'corner') {
            canvas = generateCorner(baseTexture, tile.rotation);
        } else {
            canvas = generateEdge(baseTexture, tile.rotation);
        }

        // Save to file
        const fileName = `${tile.name}.png`;
        const filePath = path.join(OUTPUT_DIR, fileName);
        const buffer = canvas.toBuffer('image/png');
        fs.writeFileSync(filePath, buffer);
        filePaths.push({ name: fileName, path: filePath });

        console.log(`  ✓ Generated ${fileName}`);
    }

    console.log(`\n✓ All sprites generated in ${OUTPUT_DIR}`);
    return filePaths;
}

async function uploadToFirebase(filePaths) {
    console.log('\n📤 Uploading to Firebase Storage...');

    // Try to use firebase-admin
    let admin;
    try {
        admin = require('firebase-admin');
    } catch (e) {
        console.error('firebase-admin not found. Install with: npm install firebase-admin');
        console.log('\nManual upload instructions:');
        console.log('1. Go to Firebase Console > Storage');
        console.log('2. Create folder: sprites/borders/ruins/');
        console.log(`3. Upload all files from: ${OUTPUT_DIR}`);
        return false;
    }

    // Initialize Firebase Admin (if not already)
    if (!admin.apps.length) {
        try {
            // Try to use service account from environment or file
            const serviceAccount = process.env.GOOGLE_APPLICATION_CREDENTIALS
                ? require(process.env.GOOGLE_APPLICATION_CREDENTIALS)
                : null;

            if (!serviceAccount) {
                console.log('\n⚠️  Firebase Admin not configured.');
                console.log('To auto-upload, set GOOGLE_APPLICATION_CREDENTIALS environment variable');
                console.log('Or manually upload from:', OUTPUT_DIR);
                return false;
            }

            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                storageBucket: 'nara-a65bc.firebasestorage.app'
            });
        } catch (e) {
            console.error('Failed to initialize Firebase Admin:', e.message);
            return false;
        }
    }

    const bucket = admin.storage().bucket();
    const uploadPath = 'sprites/borders/ruins';

    for (const file of filePaths) {
        const destination = `${uploadPath}/${file.name}`;
        await bucket.upload(file.path, {
            destination,
            metadata: {
                contentType: 'image/png',
                cacheControl: 'public, max-age=31536000', // Cache for 1 year
            }
        });
        console.log(`  ✓ Uploaded ${file.name} to ${destination}`);
    }

    console.log('\n✓ All sprites uploaded to Firebase Storage!');
    return true;
}

function cleanup() {
    console.log('\n🧹 Cleaning up temporary files...');
    if (fs.existsSync(OUTPUT_DIR)) {
        fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
        console.log(`  ✓ Removed ${OUTPUT_DIR}`);
    }
}

async function main() {
    try {
        const filePaths = await generateSprites();
        const uploaded = await uploadToFirebase(filePaths);

        if (uploaded) {
            cleanup();
        } else {
            console.log(`\n💾 Sprites saved locally at: ${OUTPUT_DIR}`);
            console.log('Upload manually, then run: rm -rf tmp-sprites/');
        }
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

main();
