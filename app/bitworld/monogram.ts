// monogram.ts
// WebGPU chunk-based monogram system
// Ephemeral visual layer - never saved to worldData
// Integrates seamlessly with bit.canvas rendering loop

import { useState, useCallback, useRef, useEffect } from 'react';
import { getMask, type FaceFeature as MaskFaceFeature, type FaceDynamics, type FaceBounds } from './mask';

export type MonogramMode = 'clear' | 'perlin' | 'nara' | 'voronoi' | 'face3d';

// Trail position interface for interactive monogram trails
interface MonogramTrailPosition {
    x: number;
    y: number;
    timestamp: number;
    intensity: number;
}

export interface MonogramOptions {
    enabled: boolean;
    speed: number;
    complexity: number;
    mode: MonogramMode;
    // Interactive trail options
    interactiveTrails?: boolean;
    trailIntensity?: number;
    trailFadeMs?: number;
    // Interface options
    showInterfaceVoronoi?: boolean;
    // Face piloting options
    faceOrientation?: {
        rotX: number;
        rotY: number;
        rotZ: number;
        mouthOpen?: number;
        leftEyeBlink?: number;
        rightEyeBlink?: number;
        isTracked?: boolean;
    };
}

// Shared WGSL utility functions for Perlin noise
// Used by both PERLIN and NARA shader modes
const PERLIN_UTILS_WGSL = `
fn fade(t: f32) -> f32 {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn lerp(t: f32, a: f32, b: f32) -> f32 {
    return a + t * (b - a);
}

fn grad(hash: u32, x: f32, y: f32) -> f32 {
    let h = hash & 3u;
    let u = select(y, x, h < 2u);
    let v = select(x, y, h < 2u);
    let sign_u = select(u, -u, (h & 1u) == 0u);
    let sign_v = select(v, -v, (h & 2u) == 0u);
    return sign_u + sign_v;
}

fn hash(i: i32) -> u32 {
    var x = u32(i);
    x = ((x >> 16u) ^ x) * 0x45d9f3bu;
    x = ((x >> 16u) ^ x) * 0x45d9f3bu;
    x = (x >> 16u) ^ x;
    return x & 255u;
}

fn perlin(worldX: f32, worldY: f32) -> f32 {
    let X = i32(floor(worldX));
    let Y = i32(floor(worldY));
    let fx = fract(worldX);
    let fy = fract(worldY);

    let u = fade(fx);
    let v = fade(fy);

    let a = hash(X) + u32(Y);
    let b = hash(X + 1) + u32(Y);

    let x1 = lerp(u, grad(hash(i32(a)), fx, fy), grad(hash(i32(b)), fx - 1.0, fy));
    let x2 = lerp(u, grad(hash(i32(a + 1u)), fx, fy - 1.0), grad(hash(i32(b + 1u)), fx - 1.0, fy - 1.0));

    return lerp(v, x1, x2);
}
`;

// WebGPU Compute Shader - Generates 32x32 chunk of Perlin noise
const CHUNK_PERLIN_SHADER = `
@group(0) @binding(0) var<storage, read_write> output: array<f32>;
@group(0) @binding(1) var<uniform> params: ChunkParams;

struct ChunkParams {
    chunkWorldX: f32,
    chunkWorldY: f32,
    chunkSize: f32,
    time: f32,
    complexity: f32,
}

${PERLIN_UTILS_WGSL}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let localX = global_id.x;
    let localY = global_id.y;
    let chunkSize = u32(params.chunkSize);

    if (localX >= chunkSize || localY >= chunkSize) {
        return;
    }

    let worldX = params.chunkWorldX + f32(localX);
    let worldY = params.chunkWorldY + f32(localY);

    // Compute perlin noise
    let scale = 0.03 * params.complexity;  // Smaller scale = more zoomed in, larger features
    let time = params.time;

    let nx = worldX * scale;
    let ny = (worldY * 0.5) * scale;

    let flow1 = perlin(nx + time * 2.0, ny + time);
    let flow2 = perlin(nx * 2.0 - time, ny * 2.0);

    let dx = nx + flow1 * 0.3 + flow2 * 0.1;
    let dy = ny + flow2 * 0.3 - flow1 * 0.1;

    let intensity1 = perlin(dx * 2.0, dy * 2.0);
    let intensity2 = perlin(dx * 3.0 + time, dy * 3.0);

    let rawIntensity = (intensity1 + intensity2 + 2.0) / 4.0;
    let temporalWave = sin(time * 0.5 + nx * 2.0 + ny * 1.5) * 0.05 + 0.95;
    let finalIntensity = rawIntensity * temporalWave;

    let index = localY * chunkSize + localX;
    output[index] = finalIntensity;
}
`;

// WebGPU Compute Shader - NARA mode with texture sampling and distortion
const CHUNK_NARA_SHADER = `
@group(0) @binding(0) var<storage, read_write> output: array<f32>;
@group(0) @binding(1) var<uniform> params: NaraParams;
@group(0) @binding(2) var naraTexture: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> trailData: array<vec4<f32>>; // x, y, age, intensity
@group(0) @binding(4) var<uniform> trailParams: TrailParams;

struct NaraParams {
    chunkWorldX: f32,
    chunkWorldY: f32,
    chunkSize: f32,
    time: f32,
    complexity: f32,
    centerX: f32,
    centerY: f32,
    textureWidth: f32,
    textureHeight: f32,
    scale: f32,
    viewportWidth: f32,
    viewportHeight: f32,
}

struct TrailParams {
    trailCount: u32,
    trailFadeMs: f32,
    trailIntensity: f32,
    complexity: f32,
}

${PERLIN_UTILS_WGSL}

// Calculate trail effect for a world position
fn calculateTrailEffect(worldX: f32, worldY: f32) -> f32 {
    if (trailParams.trailCount == 0u) {
        return 0.0;
    }

    var maxTrailIntensity = 0.0;

    // Iterate through trail segments
    for (var i = 0u; i < trailParams.trailCount - 1u; i++) {
        let currentPos = trailData[i];
        let nextPos = trailData[i + 1u];

        let age = currentPos.z; // Age in ms
        if (age > trailParams.trailFadeMs) {
            continue;
        }

        // Calculate distance from point to line segment
        let dx = nextPos.x - currentPos.x;
        let dy = nextPos.y - currentPos.y;
        let segmentLength = sqrt(dx * dx + dy * dy);

        if (segmentLength > 0.0) {
            // Scale Y by 0.5 for vertical stretching
            let scaledY = worldY * 0.5;
            let scaledCurrentY = currentPos.y * 0.5;
            let scaledNextY = nextPos.y * 0.5;
            let scaledDy = scaledNextY - scaledCurrentY;
            let scaledSegmentLength = sqrt(dx * dx + scaledDy * scaledDy);

            let t = clamp(
                ((worldX - currentPos.x) * dx + (scaledY - scaledCurrentY) * scaledDy) / (scaledSegmentLength * scaledSegmentLength),
                0.0,
                1.0
            );
            let projX = currentPos.x + t * dx;
            let projY = currentPos.y + t * dy;
            let distance = sqrt((worldX - projX) * (worldX - projX) + ((worldY * 0.5) - (projY * 0.5)) * ((worldY * 0.5) - (projY * 0.5)));

            // Trail width decreases with age (comet effect)
            let ageFactor = 1.0 - (age / trailParams.trailFadeMs);
            let trailWidth = 0.7 + trailParams.complexity * 1.0 * ageFactor;

            if (distance <= trailWidth) {
                // Calculate fade based on distance and age
                let distanceFade = 1.0 - (distance / trailWidth);
                let pathFade = ageFactor;

                // Position along trail (0 = oldest, 1 = newest)
                let positionFactor = f32(i) / max(1.0, f32(trailParams.trailCount - 1u));

                // Comet intensity: brighter at head, dimmer at tail
                let cometFade = 0.3 + 0.7 * positionFactor;

                let trailIntensity = distanceFade * pathFade * cometFade * trailParams.trailIntensity;
                maxTrailIntensity = max(maxTrailIntensity, trailIntensity);
            }
        }
    }

    return min(1.0, maxTrailIntensity);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let localX = global_id.x;
    let localY = global_id.y;
    let chunkSize = u32(params.chunkSize);

    if (localX >= chunkSize || localY >= chunkSize) {
        return;
    }

    let worldX = params.chunkWorldX + f32(localX);
    let worldY = params.chunkWorldY + f32(localY);

    // 1. Translate to center-relative coordinates
    let relX = worldX - params.centerX;
    let relY = worldY - params.centerY;

    // 2. Apply continuous translation (viewport-relative like CPU)
    let maxTranslateX = params.viewportWidth * 0.1;
    let maxTranslateY = params.viewportHeight * 0.1;
    let translateX = sin(params.time * 0.3) * maxTranslateX;
    let translateY = cos(params.time * 0.3 * 0.7) * maxTranslateY;
    let transX = relX - translateX;
    let transY = relY - translateY;

    // 3. Multi-layer Perlin noise distortion
    let noiseScale1 = 0.01 * params.complexity;
    let noiseScale2 = 0.005 * params.complexity;
    let morphSpeed = 0.5;

    let noiseX1 = perlin(
        transX * noiseScale1 + cos(params.time * morphSpeed) * 5.0,
        transY * noiseScale1 + sin(params.time * morphSpeed) * 5.0
    );
    let noiseY1 = perlin(
        transX * noiseScale1 + sin(params.time * morphSpeed * 1.3) * 5.0,
        transY * noiseScale1 + cos(params.time * morphSpeed * 1.3) * 5.0
    );

    let noiseX2 = perlin(
        transX * noiseScale2 + params.time * morphSpeed * 0.5,
        transY * noiseScale2 - params.time * morphSpeed * 0.3
    );
    let noiseY2 = perlin(
        transX * noiseScale2 - params.time * morphSpeed * 0.3,
        transY * noiseScale2 + params.time * morphSpeed * 0.5
    );

    // 4. Combine noise layers - viewport-relative like CPU
    let minViewportDim = min(params.viewportWidth, params.viewportHeight);
    let morphAmount = minViewportDim * 0.15 * params.complexity;
    let distortX = (noiseX1 * 0.7 + noiseX2 * 0.3) * morphAmount;
    let distortY = (noiseY1 * 0.7 + noiseY2 * 0.3) * morphAmount;

    // 5. Wave distortion - viewport-relative like CPU
    let waveFreq = 0.02;
    let waveAmp = params.viewportHeight * 0.05 * params.complexity;
    let wavePhase = params.time * 0.8;
    let waveX = sin(transY * waveFreq + wavePhase) * waveAmp;
    let waveY = cos(transX * waveFreq * 0.7 + wavePhase * 1.3) * waveAmp * 0.5;

    // 6. Apply all transformations
    let finalX = transX - distortX - waveX;
    let finalY = transY - distortY - waveY;

    // 7. Transform to texture coordinates (pixel coordinates for textureLoad)
    let texPixelX = finalX / params.scale + params.textureWidth / 2.0;
    let texPixelY = finalY / params.scale + params.textureHeight / 2.0;

    // 8. Bounds check and sample
    var brightness = 0.0;
    if (texPixelX >= 0.0 && texPixelX < params.textureWidth &&
        texPixelY >= 0.0 && texPixelY < params.textureHeight) {
        // Use textureLoad for compute shaders (not textureSample)
        let texCoord = vec2<i32>(i32(texPixelX), i32(texPixelY));
        brightness = textureLoad(naraTexture, texCoord, 0).r;

        // 9. Glow enhancement
        if (brightness > 0.7) {
            brightness = min(1.0, brightness * 1.3);
        } else if (brightness > 0.4) {
            brightness = min(1.0, brightness * 1.1);
        }

        // 10. Post-effects
        let scanline = 0.95 + sin(params.time * 2.5 + worldY * 0.02) * 0.05;
        let flicker = 0.95 + sin(params.time * 15.0 + worldX * 0.01) * 0.05;
        let pulse = 0.9 + sin(params.time * 1.5) * 0.1;

        brightness = brightness * scanline * flicker * pulse;
    }

    // 11. Add trail effect
    let trailEffect = calculateTrailEffect(worldX, worldY);
    brightness = max(brightness, trailEffect);

    let index = localY * chunkSize + localX;
    output[index] = max(0.0, min(1.0, brightness));
}
`;

// WebGPU Compute Shader - Voronoi mode (Euclidean edge detection)
const CHUNK_VORONOI_SHADER = `
@group(0) @binding(0) var<storage, read_write> output: array<f32>;
@group(0) @binding(1) var<uniform> params: ChunkParams;
@group(0) @binding(2) var<storage, read> activeCells: array<vec2<f32>>;
@group(0) @binding(3) var<uniform> cellParams: CellParams;

struct ChunkParams {
    chunkWorldX: f32,
    chunkWorldY: f32,
    chunkSize: f32,
    time: f32,
    complexity: f32,
    activeSeedX: f32,
    activeSeedY: f32,
    hasActiveSeed: f32,
}

struct CellParams {
    count: u32,
    _pad1: u32,
    _pad2: u32,
    _pad3: u32,
}

${PERLIN_UTILS_WGSL}

// Hash function for Voronoi (returns vec2 in 0..1 range)
fn hash2(p: vec2<f32>) -> vec2<f32> {
    var p2 = vec2<f32>(
        dot(p, vec2<f32>(127.1, 311.7)),
        dot(p, vec2<f32>(269.5, 183.3))
    );
    return fract(sin(p2) * 43758.5453);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let localX = global_id.x;
    let localY = global_id.y;
    let chunkSize = u32(params.chunkSize);

    if (localX >= chunkSize || localY >= chunkSize) {
        return;
    }

    let worldX = params.chunkWorldX + f32(localX);
    let worldY = params.chunkWorldY + f32(localY);

    // Voronoi Scale
    let scale = 0.1 * params.complexity;
    
    // Y is scaled by 0.5 to match the aspect ratio of the grid cells (1x2)
    // but the voronoi logic itself should work in a more uniform space to avoid stretching 
    // too much, or we can embrace the stretch. CPU logic used worldY * 0.5.
    let px = worldX * scale;
    let py = (worldY * 0.5) * scale;

    let ix = floor(px);
    let iy = floor(py);
    let fx = fract(px);
    let fy = fract(py);

    var f1 = 100.0;
    var f2 = 100.0;
    
    // Track the closest seed coordinate for filling active cell
    var closestSeedX = 0.0;
    var closestSeedY = 0.0;

    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let neighbor = vec2<f32>(f32(i), f32(j));
            
            // Replaced hash-based placement with Perlin noise placement
            // This creates a more "organic" distribution where neighbor points
            // are correlated, rather than white noise chaos.
            let cellX = ix + neighbor.x;
            let cellY = iy + neighbor.y;
            
            // Use noise to determine offset within the cell
            // Scale controls "coherence" (lower = groups of cells move together)
            let noiseScale = 0.35; 
            
            // Generate two independent noise values for X and Y offsets
            let n1 = perlin(cellX * noiseScale, cellY * noiseScale);
            let n2 = perlin(cellX * noiseScale + 52.1, cellY * noiseScale + 19.4);
            
            // Map noise (-1..1) to safe cell offset (0.1 .. 0.9)
            let p = vec2<f32>(0.5 + 0.4 * n1, 0.5 + 0.4 * n2);
            
            // Static point (relative to neighbor cell)
            let point = neighbor + p;
            
            let diff = point - vec2<f32>(fx, fy);
            
            // Euclidean distance
            let dist = length(diff);

            if (dist < f1) {
                f2 = f1;
                f1 = dist;
                // Store the global seed ID (cell index)
                closestSeedX = ix + f32(i);
                closestSeedY = iy + f32(j);
            } else if (dist < f2) {
                f2 = dist;
            }
        }
    }

    let thickness = 0.1;
    let d = f2 - f1;
    var intensity = 0.0;

    if (d < thickness) {
        intensity = 1.0 - (d / thickness);
    }
    
    // Slight boost to make edges clearer
    intensity = intensity * 1.0; 
    
    // 1. Fill hovered cell (lighter)
    if (params.hasActiveSeed > 0.5) {
        if (abs(closestSeedX - params.activeSeedX) < 0.1 && abs(closestSeedY - params.activeSeedY) < 0.1) {
             intensity = max(intensity, 0.3); // Hover intensity
        }
    }

    // 2. Fill toggled cells (stronger)
    for (var k = 0u; k < cellParams.count; k++) {
        let cell = activeCells[k];
        if (abs(cell.x - closestSeedX) < 0.1 && abs(cell.y - closestSeedY) < 0.1) {
            intensity = max(intensity, 0.6); // Active intensity
            break;
        }
    }

    let index = localY * chunkSize + localX;
    output[index] = intensity;
}
`;

// WebGPU Compute Shader - Face3D mode (Projected 3D Geometry)
const CHUNK_FACE_SHADER = `
@group(0) @binding(0) var<storage, read_write> output: array<f32>;
@group(0) @binding(1) var<uniform> params: FaceParams;
@group(0) @binding(2) var<storage, read> features: array<FaceFeature>;

struct FaceParams {
    chunkWorldX: f32,
    chunkWorldY: f32,
    chunkSize: f32,
    time: f32,
    complexity: f32,
    
    // Viewport center
    centerX: f32,
    centerY: f32,
    
    // Viewport dimensions
    viewportWidth: f32,
    viewportHeight: f32,
    
    // Rotation (pitch, yaw, roll)
    rotX: f32,
    rotY: f32,
    rotZ: f32,
    
    // Feature count
    featureCount: f32,
}

struct FaceFeature {
    // Position (center)
    cx: f32,
    cy: f32,
    cz: f32,
    
    // Size
    width: f32,
    height: f32,
    
    // Orientation (0=Front, 1=Right, 2=Left, 3=Top, 4=Bottom)
    orientation: f32,
    _pad2: f32,
    _pad3: f32,
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let localX = global_id.x;
    let localY = global_id.y;
    let chunkSize = u32(params.chunkSize);

    if (localX >= chunkSize || localY >= chunkSize) {
        return;
    }

    let worldX = params.chunkWorldX + f32(localX);
    let worldY = params.chunkWorldY + f32(localY);
    
    // --- 3D PROJECTION LOGIC ---
    
    let faceScale = params.viewportWidth * 0.015 * params.complexity;
    let centerX = params.centerX;
    let centerY = params.centerY;
    
    // Precompute rotation matrices (simplified)
    let cosX = cos(params.rotX); let sinX = sin(params.rotX);
    let cosY = cos(params.rotY); let sinY = sin(params.rotY);
    let cosZ = cos(params.rotZ); let sinZ = sin(params.rotZ);
    
    var finalIntensity = 0.0;
    
    // Iterate through features
    let count = u32(params.featureCount);
    for (var i = 0u; i < count; i++) {
        let f = features[i];
        let orient = u32(f.orientation);
        
        let halfW = f.width * 0.5;
        let halfH = f.height * 0.5;
        
        // Define 4 corners based on orientation
        var p0: vec3<f32>; var p1: vec3<f32>; var p2: vec3<f32>; var p3: vec3<f32>;
        
        if (orient == 1u) { // Right Face (+X normal)
            // YZ Plane. Winding: FrontTop -> FrontBot -> BackBot -> BackTop
            // Local Z is width (depth), Y is height
            p0 = vec3<f32>(0.0, -halfH, -halfW);
            p1 = vec3<f32>(0.0,  halfH, -halfW);
            p2 = vec3<f32>(0.0,  halfH,  halfW);
            p3 = vec3<f32>(0.0, -halfH,  halfW);
        } else if (orient == 2u) { // Left Face (-X normal)
            // YZ Plane. Winding: FrontTop -> BackTop -> BackBot -> FrontBot
            p0 = vec3<f32>(0.0, -halfH, -halfW);
            p1 = vec3<f32>(0.0, -halfH,  halfW);
            p2 = vec3<f32>(0.0,  halfH,  halfW);
            p3 = vec3<f32>(0.0,  halfH, -halfW);
        } else if (orient == 3u) { // Top Face (-Y normal)
            // XZ Plane. Winding: BackLeft -> BackRight -> FrontRight -> FrontLeft
            // Local X is width, Z is height (depth)
            p0 = vec3<f32>(-halfW, 0.0,  halfH);
            p1 = vec3<f32>( halfW, 0.0,  halfH);
            p2 = vec3<f32>( halfW, 0.0, -halfH);
            p3 = vec3<f32>(-halfW, 0.0, -halfH);
        } else if (orient == 4u) { // Bottom Face (+Y normal)
            // XZ Plane. Winding: FrontLeft -> FrontRight -> BackRight -> BackLeft
            p0 = vec3<f32>(-halfW, 0.0, -halfH);
            p1 = vec3<f32>( halfW, 0.0, -halfH);
            p2 = vec3<f32>( halfW, 0.0,  halfH);
            p3 = vec3<f32>(-halfW, 0.0,  halfH);
        } else { // Front Face (XY Plane, -Z normal)
            // Standard winding: TL -> TR -> BR -> BL
            p0 = vec3<f32>(-halfW, -halfH, 0.0);
            p1 = vec3<f32>( halfW, -halfH, 0.0);
            p2 = vec3<f32>( halfW,  halfH, 0.0);
            p3 = vec3<f32>(-halfW,  halfH, 0.0);
        }

        // Apply Center Offset
        p0 = p0 + vec3<f32>(f.cx, f.cy, f.cz);
        p1 = p1 + vec3<f32>(f.cx, f.cy, f.cz);
        p2 = p2 + vec3<f32>(f.cx, f.cy, f.cz);
        p3 = p3 + vec3<f32>(f.cx, f.cy, f.cz);
        
        // Project Points Function (inline)
        var corners: array<vec3<f32>, 4>;
        
        for (var c = 0; c < 4; c++) {
            var pt: vec3<f32>;
            if (c == 0) { pt = p0; }
            else if (c == 1) { pt = p1; }
            else if (c == 2) { pt = p2; }
            else { pt = p3; }
            
            // Scale
            var x = pt.x * faceScale;
            var y = pt.y * faceScale;
            var z = pt.z * faceScale;
            
            // Rotate X
            let ry = y * cosX - z * sinX;
            let rz = y * sinX + z * cosX;
            y = ry; z = rz;
            
            // Rotate Y
            let rx = x * cosY + z * sinY;
            z = -x * sinY + z * cosY;
            x = rx;
            
            // Rotate Z
            let rxx = x * cosZ - y * sinZ;
            y = x * sinZ + y * cosZ;
            x = rxx;
            
            // Perspective Project
            let dist = 500.0;
            let projX = centerX + (x * dist * 0.5) / (dist + z);
            let projY = centerY + (y * dist * 0.5) / (dist + z);
            
            corners[c] = vec3<f32>(projX, projY, z);
        }
        
        // Check point in quad (2D winding number / cross product)
        var inside = true;
        var avgDepth = 0.0;
        
        for (var j = 0; j < 4; j++) {
            let pA = corners[j];
            let pB = corners[(j + 1) % 4];
            
            let cp = (pB.x - pA.x) * (worldY - pA.y) - (pB.y - pA.y) * (worldX - pA.x);
            
            // Backface culling: cp < 0.0 means facing away or outside
            if (cp < 0.0) { inside = false; }
            avgDepth = avgDepth + pA.z;
        }
        
        if (inside) {
            avgDepth = avgDepth / 4.0;
            
            // Calculate shading based on depth and distance from center
            let depthFactor = max(0.3, 1.0 - abs(avgDepth) / 100.0);
            
            // Simple flat shading based on orientation to distinguish faces
            // Sides are slightly darker to give volume feel
            var sideShade = 1.0;
            if (orient != 0u) { sideShade = 0.85; }
            if (orient == 3u || orient == 4u) { sideShade = 0.7; } // Top/Bottom darker
            
            // Soft edge falloff
            // Center of quad
            let qCx = (corners[0].x + corners[2].x) * 0.5;
            let qCy = (corners[0].y + corners[2].y) * 0.5;
            let distToCenter = sqrt(pow(worldX - qCx, 2.0) + pow(worldY - qCy, 2.0));
            let radius = sqrt(pow(corners[1].x - corners[0].x, 2.0) + pow(corners[1].y - corners[0].y, 2.0));
            let edgeFalloff = min(1.0, distToCenter / (radius * 0.9));
            
            let intensity = depthFactor * sideShade * (1.0 - edgeFalloff * 0.3);
            
            finalIntensity = max(finalIntensity, intensity);
        }
    }

    let index = localY * chunkSize + localX;
    output[index] = finalIntensity;
}
`;

class MonogramSystem {
    private chunks: Map<string, Float32Array> = new Map();
    private device: GPUDevice | null = null;
    private pipeline: GPUComputePipeline | null = null;
    private paramsBuffer: GPUBuffer | null = null;
    private isInitialized = false;

    // NARA mode GPU resources
    private naraPipeline: GPUComputePipeline | null = null;
    private naraParamsBuffer: GPUBuffer | null = null;
    private naraTexture: GPUTexture | null = null;
    private naraAnchor: { x: number, y: number } | null = null;

    // Voronoi mode GPU resources
    private voronoiPipeline: GPUComputePipeline | null = null;
    private activeCellsBuffer: GPUBuffer | null = null;
    private cellParamsBuffer: GPUBuffer | null = null;
    
    // Face3D mode GPU resources
    private facePipeline: GPUComputePipeline | null = null;
    private faceParamsBuffer: GPUBuffer | null = null;
    private featuresBuffer: GPUBuffer | null = null;
    private currentFaceOrientation: NonNullable<MonogramOptions['faceOrientation']> | null = null;
    
    // Trail tracking
    private mouseTrail: MonogramTrailPosition[] = [];
    private lastMousePos: { x: number, y: number } | null = null;
    private trailBuffer: GPUBuffer | null = null;
    private trailParamsBuffer: GPUBuffer | null = null;
    private readonly MAX_TRAIL_POSITIONS = 100;

    private readonly CHUNK_SIZE = 32;
    private readonly MAX_CHUNKS = 200;
    private chunkAccessTime: Map<string, number> = new Map();

    private time = 0;
    private options: MonogramOptions;

    // Track last viewport for auto-reload on invalidation
    private lastViewport: { startX: number, startY: number, endX: number, endY: number } | null = null;

    // Interactive Voronoi state
    private activeSeed: { x: number, y: number } | null = null;
    private toggledCells: Set<string> = new Set();
    private readonly MAX_ACTIVE_CELLS = 64;


    constructor(options: MonogramOptions) {
        this.options = options;
    }

    // Generate "NARA" text bitmap using Canvas API (CPU)
    private generateNaraTextBitmap(): { imageData: ImageData, width: number, height: number } | null {
        if (typeof window === 'undefined' || typeof document === 'undefined') return null;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const fontSize = 120;
        const text = 'NARA';

        // Measure text
        ctx.font = `bold ${fontSize}px "Courier New", Courier, monospace`;
        ctx.textBaseline = 'top';
        const metrics = ctx.measureText(text);
        const textWidth = Math.ceil(metrics.width);
        const textHeight = fontSize * 1.2;

        // Set canvas size
        canvas.width = textWidth + 8;
        canvas.height = textHeight + 4;

        // Draw text
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `bold ${fontSize}px "Courier New", Courier, monospace`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'white';
        ctx.fillText(text, 4, 2);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return { imageData, width: canvas.width, height: canvas.height };
    }

    async initialize(): Promise<boolean> {
        if (this.isInitialized) {
            return this.isInitialized;
        }
        if (!navigator.gpu) {
            return false;
        }

        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) return false;

            this.device = await adapter.requestDevice();

            const shaderModule = this.device.createShaderModule({
                code: CHUNK_PERLIN_SHADER
            });

            this.pipeline = this.device.createComputePipeline({
                layout: 'auto',
                compute: {
                    module: shaderModule,
                    entryPoint: 'main'
                }
            });

            this.paramsBuffer = this.device.createBuffer({
                size: 8 * 4,  // 8 floats: chunkWorldX, chunkWorldY, chunkSize, time, complexity, activeSeedX, activeSeedY, hasActiveSeed
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });

            // Create NARA pipeline and resources
            const naraShaderModule = this.device.createShaderModule({
                code: CHUNK_NARA_SHADER
            });

            this.naraPipeline = this.device.createComputePipeline({
                layout: 'auto',
                compute: {
                    module: naraShaderModule,
                    entryPoint: 'main'
                }
            });

            this.naraParamsBuffer = this.device.createBuffer({
                size: 12 * 4,  // 12 floats: chunkWorldX, chunkWorldY, chunkSize, time, complexity, centerX, centerY, textureWidth, textureHeight, scale, viewportWidth, viewportHeight
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });

            // Create Voronoi pipeline (uses same ChunkParams as Perlin)
            const voronoiShaderModule = this.device.createShaderModule({
                code: CHUNK_VORONOI_SHADER
            });

            this.voronoiPipeline = this.device.createComputePipeline({
                layout: 'auto',
                compute: {
                    module: voronoiShaderModule,
                    entryPoint: 'main'
                }
            });

            // Create buffer for active Voronoi cells (list of vec2 seeds)
            this.activeCellsBuffer = this.device.createBuffer({
                size: this.MAX_ACTIVE_CELLS * 2 * 4, // 2 floats (x, y) * 4 bytes
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
            });

            // Create buffer for cell params (count)
            this.cellParamsBuffer = this.device.createBuffer({
                size: 4 * 4, // 4 u32 (aligned to 16 bytes)
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });
            
            // Create Face3D pipeline
            const faceShaderModule = this.device.createShaderModule({
                code: CHUNK_FACE_SHADER
            });
            
            this.facePipeline = this.device.createComputePipeline({
                layout: 'auto',
                compute: {
                    module: faceShaderModule,
                    entryPoint: 'main'
                }
            });
            
            // Face params buffer (viewport, rotation, etc.)
            this.faceParamsBuffer = this.device.createBuffer({
                size: 16 * 4, // 16 floats
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });
            
            // Features buffer (list of quads)
            // Max 32 features for now (Macintosh mask has ~7)
            const MAX_FEATURES = 32;
            this.featuresBuffer = this.device.createBuffer({
                size: MAX_FEATURES * 8 * 4, // 8 floats per feature
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
            });

            // Generate and upload NARA text texture
            const textBitmap = this.generateNaraTextBitmap();
            if (textBitmap) {
                // Create texture
                this.naraTexture = this.device.createTexture({
                    size: [textBitmap.width, textBitmap.height, 1],
                    format: 'r8unorm',  // Single channel (red) for grayscale
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
                });

                // Upload bitmap data to texture (extract red channel)
                const textureData = new Uint8Array(textBitmap.width * textBitmap.height);
                for (let i = 0; i < textureData.length; i++) {
                    textureData[i] = textBitmap.imageData.data[i * 4]; // Red channel
                }

                // Debug: Check texture data
                const nonZeroPixels = textureData.filter(v => v > 128).length;
                const totalPixels = textureData.length;

                this.device.queue.writeTexture(
                    { texture: this.naraTexture },
                    textureData,
                    { bytesPerRow: textBitmap.width },
                    [textBitmap.width, textBitmap.height, 1]
                );

            }

            // Create trail buffer (4 floats per position: x, y, age, intensity)
            this.trailBuffer = this.device.createBuffer({
                size: this.MAX_TRAIL_POSITIONS * 4 * 4, // 4 floats * 4 bytes each
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
            });

            // Create trail params buffer (trailCount, trailFadeMs, trailIntensity, complexity)
            this.trailParamsBuffer = this.device.createBuffer({
                size: 4 * 4, // 4 floats * 4 bytes each
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });

            this.isInitialized = true;
            return true;
        } catch (error) {
            console.error('[Monogram] WebGPU init failed:', error);
            return false;
        }
    }

    private worldToChunk(worldX: number, worldY: number): string {
        const chunkX = Math.floor(worldX / this.CHUNK_SIZE);
        const chunkY = Math.floor(worldY / this.CHUNK_SIZE);
        return `${chunkX},${chunkY}`;
    }

    private chunkToWorld(chunkKey: string): { x: number, y: number } {
        const [cx, cy] = chunkKey.split(',').map(Number);
        return {
            x: cx * this.CHUNK_SIZE,
            y: cy * this.CHUNK_SIZE
        };
    }

    private getClosestSeed(worldX: number, worldY: number): { x: number, y: number } {
        // Must match shader logic exactly
        const complexity = this.options.complexity;
        const scale = 0.1 * complexity;
        const px = worldX * scale;
        const py = (worldY * 0.5) * scale;
        
        const ix = Math.floor(px);
        const iy = Math.floor(py);
        const fx = px - ix;
        const fy = py - iy;

        let minDist = 100.0;
        let seedX = 0;
        let seedY = 0;

        // Hash function matching shader
        const hash2 = (x: number, y: number) => {
            const dot1 = x * 127.1 + y * 311.7;
            const dot2 = x * 269.5 + y * 183.3;
            // Simulate GLSL sin/fract
            const sin1 = Math.sin(dot1) * 43758.5453;
            const sin2 = Math.sin(dot2) * 43758.5453;
            return {
                x: sin1 - Math.floor(sin1),
                y: sin2 - Math.floor(sin2)
            };
        };

        for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
                const neighborX = i;
                const neighborY = j;
                const p = hash2(ix + neighborX, iy + neighborY);
                
                const pointX = neighborX + p.x;
                const pointY = neighborY + p.y;
                
                const diffX = pointX - fx;
                const diffY = pointY - fy;
                
                const dist = Math.sqrt(diffX*diffX + diffY*diffY);

                if (dist < minDist) {
                    minDist = dist;
                    seedX = ix + neighborX;
                    seedY = iy + neighborY;
                }
            }
        }
        return { x: seedX, y: seedY };
    }

    toggleCell(worldX: number, worldY: number) {
        if (this.options.mode !== 'voronoi') return;

        const seed = this.getClosestSeed(worldX, worldY);
        const key = `${seed.x},${seed.y}`;

        if (this.toggledCells.has(key)) {
            this.toggledCells.delete(key);
        } else {
            if (this.toggledCells.size < this.MAX_ACTIVE_CELLS) {
                this.toggledCells.add(key);
            }
        }

        // Invalidate chunks to force re-render
        this.chunks.clear();
        this.chunkAccessTime.clear();
    }

    updateMousePosition(worldX: number, worldY: number) {
        // 1. Voronoi Interactive Logic
        if (this.options.mode === 'voronoi') {
            const newSeed = this.getClosestSeed(worldX, worldY);
            
            let changed = false;
            if (!this.activeSeed) {
                changed = true;
            } else if (this.activeSeed.x !== newSeed.x || this.activeSeed.y !== newSeed.y) {
                changed = true;
            }

            if (changed) {
                this.activeSeed = newSeed;
                // Invalidate all chunks to force re-render with new highlight
                this.chunks.clear();
                this.chunkAccessTime.clear();
            }

            // Conflict resolution: disable comet trail logic in Voronoi mode
            return;
        }

        if (!this.options.interactiveTrails) {
            return;
        }

        const currentPos = { x: worldX, y: worldY };

        // Only add to trail if mouse has actually moved significantly
        // Lower threshold (0.2) for smoother trails on touch
        if (!this.lastMousePos ||
            Math.abs(currentPos.x - this.lastMousePos.x) > 0.2 ||
            Math.abs(currentPos.y - this.lastMousePos.y) > 0.2) {

            const now = Date.now();
            const intensity = this.options.trailIntensity ?? 1.0;

            this.mouseTrail.push({
                x: worldX,
                y: worldY,
                timestamp: now,
                intensity
            });

            // Remove old positions
            const trailFadeMs = this.options.trailFadeMs ?? 2000;
            const beforeFilter = this.mouseTrail.length;
            this.mouseTrail = this.mouseTrail.filter(pos => now - pos.timestamp < trailFadeMs);
            const afterFilter = this.mouseTrail.length;

            // Limit trail length
            if (this.mouseTrail.length > this.MAX_TRAIL_POSITIONS) {
                this.mouseTrail = this.mouseTrail.slice(-this.MAX_TRAIL_POSITIONS);
            }

            this.lastMousePos = currentPos;

            // Upload trail data to GPU
            this.uploadTrailData();
        }
    }

    clearTrail() {
        this.mouseTrail = [];
        this.lastMousePos = null;

        // Upload empty trail to GPU
        if (this.device && this.trailBuffer) {
            this.uploadTrailData();
        }
    }

    private uploadTrailData() {
        if (!this.device || !this.trailBuffer) {
            return;
        }

        // Pack trail data: [x, y, age, intensity] for each position
        const trailData = new Float32Array(this.MAX_TRAIL_POSITIONS * 4);
        const now = Date.now();

        for (let i = 0; i < this.mouseTrail.length; i++) {
            const pos = this.mouseTrail[i];
            const age = now - pos.timestamp;
            trailData[i * 4 + 0] = pos.x;
            trailData[i * 4 + 1] = pos.y;
            trailData[i * 4 + 2] = age; // Age in ms
            trailData[i * 4 + 3] = pos.intensity;
        }

        this.device.queue.writeBuffer(this.trailBuffer, 0, trailData);
    }

    private async computeChunk(chunkWorldX: number, chunkWorldY: number): Promise<Float32Array> {
        if (!this.device) {
            throw new Error('[Monogram] Not initialized');
        }

        const mode = this.options.mode;

        // Route to appropriate pipeline based on mode
        if (mode === 'nara') {
            return this.computeChunkNara(chunkWorldX, chunkWorldY);
        } else if (mode === 'voronoi') {
            return this.computeChunkVoronoi(chunkWorldX, chunkWorldY);
        } else if (mode === 'face3d') {
            return this.computeChunkFace(chunkWorldX, chunkWorldY);
        } else {
            return this.computeChunkPerlin(chunkWorldX, chunkWorldY);
        }
    }

    private async computeChunkVoronoi(chunkWorldX: number, chunkWorldY: number): Promise<Float32Array> {
        if (!this.device || !this.voronoiPipeline || !this.paramsBuffer || !this.activeCellsBuffer || !this.cellParamsBuffer) {
            throw new Error('[Monogram] Voronoi pipeline not initialized');
        }

        const device = this.device;
        const bufferSize = this.CHUNK_SIZE * this.CHUNK_SIZE * 4;

        const outputBuffer = device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        const stagingBuffer = device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
        });

        const paramsData = new Float32Array([
            chunkWorldX,
            chunkWorldY,
            this.CHUNK_SIZE,
            this.time,
            this.options.complexity,
            this.activeSeed ? this.activeSeed.x : 0,
            this.activeSeed ? this.activeSeed.y : 0,
            this.activeSeed ? 1.0 : 0.0
        ]);
        device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

        // Upload active cells
        const cellData = new Float32Array(this.MAX_ACTIVE_CELLS * 2);
        let idx = 0;
        this.toggledCells.forEach(key => {
            if (idx < this.MAX_ACTIVE_CELLS) {
                const [x, y] = key.split(',').map(Number);
                cellData[idx * 2 + 0] = x;
                cellData[idx * 2 + 1] = y;
                idx++;
            }
        });
        device.queue.writeBuffer(this.activeCellsBuffer, 0, cellData);

        // Upload cell count
        const countData = new Uint32Array([this.toggledCells.size, 0, 0, 0]);
        device.queue.writeBuffer(this.cellParamsBuffer, 0, countData);

        const bindGroup = device.createBindGroup({
            layout: this.voronoiPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: outputBuffer } },
                { binding: 1, resource: { buffer: this.paramsBuffer } },
                { binding: 2, resource: { buffer: this.activeCellsBuffer } },
                { binding: 3, resource: { buffer: this.cellParamsBuffer } }
            ]
        });

        const commandEncoder = device.createCommandEncoder();
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.voronoiPipeline);
        computePass.setBindGroup(0, bindGroup);
        computePass.dispatchWorkgroups(
            Math.ceil(this.CHUNK_SIZE / 8),
            Math.ceil(this.CHUNK_SIZE / 8)
        );
        computePass.end();

        commandEncoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, bufferSize);
        device.queue.submit([commandEncoder.finish()]);

        await stagingBuffer.mapAsync(GPUMapMode.READ);
        const result = new Float32Array(stagingBuffer.getMappedRange());
        const intensities = new Float32Array(result);
        stagingBuffer.unmap();

        outputBuffer.destroy();
        stagingBuffer.destroy();

        return intensities;
    }

    private async computeChunkPerlin(chunkWorldX: number, chunkWorldY: number): Promise<Float32Array> {
        if (!this.device || !this.pipeline || !this.paramsBuffer) {
            throw new Error('[Monogram] Perlin pipeline not initialized');
        }

        const device = this.device;
        const bufferSize = this.CHUNK_SIZE * this.CHUNK_SIZE * 4;

        const outputBuffer = device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        const stagingBuffer = device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
        });

        const paramsData = new Float32Array([
            chunkWorldX,
            chunkWorldY,
            this.CHUNK_SIZE,
            this.time,
            this.options.complexity
        ]);
        device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

        const bindGroup = device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: outputBuffer } },
                { binding: 1, resource: { buffer: this.paramsBuffer } }
            ]
        });

        const commandEncoder = device.createCommandEncoder();
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.pipeline);
        computePass.setBindGroup(0, bindGroup);
        computePass.dispatchWorkgroups(
            Math.ceil(this.CHUNK_SIZE / 8),
            Math.ceil(this.CHUNK_SIZE / 8)
        );
        computePass.end();

        commandEncoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, bufferSize);
        device.queue.submit([commandEncoder.finish()]);

        await stagingBuffer.mapAsync(GPUMapMode.READ);
        const result = new Float32Array(stagingBuffer.getMappedRange());
        const intensities = new Float32Array(result);
        stagingBuffer.unmap();

        outputBuffer.destroy();
        stagingBuffer.destroy();

        return intensities;
    }

    private async computeChunkNara(chunkWorldX: number, chunkWorldY: number): Promise<Float32Array> {
        if (!this.device || !this.naraPipeline || !this.naraParamsBuffer || !this.naraTexture) {
            throw new Error('[Monogram] NARA pipeline not initialized');
        }

        const device = this.device;
        const bufferSize = this.CHUNK_SIZE * this.CHUNK_SIZE * 4;

        // Set anchor point on first use (center of first viewport)
        if (!this.naraAnchor && this.lastViewport) {
            this.naraAnchor = {
                x: (this.lastViewport.startX + this.lastViewport.endX) / 2,
                y: (this.lastViewport.startY + this.lastViewport.endY) / 2
            };
        }

        const centerX = this.naraAnchor?.x ?? 0;
        const centerY = this.naraAnchor?.y ?? 0;

        // Calculate viewport-based scale
        const viewportWidth = this.lastViewport ? (this.lastViewport.endX - this.lastViewport.startX) : 100;
        const viewportHeight = this.lastViewport ? (this.lastViewport.endY - this.lastViewport.startY) : 100;
        const textureWidth = this.naraTexture.width;
        const textureHeight = this.naraTexture.height;
        const scale = (viewportWidth * 0.6) / textureWidth;

        const outputBuffer = device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        const stagingBuffer = device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
        });

        const paramsData = new Float32Array([
            chunkWorldX,
            chunkWorldY,
            this.CHUNK_SIZE,
            this.time,
            this.options.complexity,
            centerX,
            centerY,
            textureWidth,
            textureHeight,
            scale,
            viewportWidth,
            viewportHeight
        ]);
        device.queue.writeBuffer(this.naraParamsBuffer, 0, paramsData);

        // Upload trail params
        const trailCount = this.mouseTrail.length;
        const trailFadeMs = this.options.trailFadeMs ?? 2000;
        const trailIntensity = this.options.trailIntensity ?? 1.0;
        const trailParamsData = new Float32Array([
            trailCount,                                  // trailCount (u32 but stored as f32)
            trailFadeMs,                                 // trailFadeMs
            trailIntensity,                              // trailIntensity
            this.options.complexity                      // complexity
        ]);
        device.queue.writeBuffer(this.trailParamsBuffer!, 0, trailParamsData);

        const bindGroup = device.createBindGroup({
            layout: this.naraPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: outputBuffer } },
                { binding: 1, resource: { buffer: this.naraParamsBuffer } },
                { binding: 2, resource: this.naraTexture.createView() },
                { binding: 3, resource: { buffer: this.trailBuffer! } },
                { binding: 4, resource: { buffer: this.trailParamsBuffer! } }
            ]
        });

        const commandEncoder = device.createCommandEncoder();
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.naraPipeline);
        computePass.setBindGroup(0, bindGroup);
        computePass.dispatchWorkgroups(
            Math.ceil(this.CHUNK_SIZE / 8),
            Math.ceil(this.CHUNK_SIZE / 8)
        );
        computePass.end();

        commandEncoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, bufferSize);
        device.queue.submit([commandEncoder.finish()]);

        await stagingBuffer.mapAsync(GPUMapMode.READ);
        const result = new Float32Array(stagingBuffer.getMappedRange());
        const intensities = new Float32Array(result);
        stagingBuffer.unmap();

        outputBuffer.destroy();
        stagingBuffer.destroy();

        return intensities;
    }
    
    private async computeChunkFace(chunkWorldX: number, chunkWorldY: number): Promise<Float32Array> {
        if (!this.device || !this.facePipeline || !this.faceParamsBuffer || !this.featuresBuffer) {
            throw new Error('[Monogram] Face pipeline not initialized');
        }

        const device = this.device;
        const bufferSize = this.CHUNK_SIZE * this.CHUNK_SIZE * 4;
        
        // Use current viewport center for face anchoring
        // Default to center of world if no viewport known yet
        const viewportWidth = this.lastViewport ? (this.lastViewport.endX - this.lastViewport.startX) : 100;
        const viewportHeight = this.lastViewport ? (this.lastViewport.endY - this.lastViewport.startY) : 100;
        const centerX = this.lastViewport ? (this.lastViewport.startX + this.lastViewport.endX) / 2 : 0;
        const centerY = this.lastViewport ? (this.lastViewport.startY + this.lastViewport.endY) / 2 : 0;
        
        // Rotation values from tracked data
        const rotX = this.currentFaceOrientation?.rotX ?? 0.3;
        const rotY = this.currentFaceOrientation?.rotY ?? 0.3;
        const rotZ = this.currentFaceOrientation?.rotZ ?? 0.0;
        
        // Prepare face features
        // We regenerate features each frame to handle blinks/mouth movement
        const mask = getMask('macintosh');
        const dynamics: FaceDynamics = {
            mouthOpen: this.currentFaceOrientation?.mouthOpen ?? 0,
            leftEyeBlink: this.currentFaceOrientation?.leftEyeBlink ?? 0,
            rightEyeBlink: this.currentFaceOrientation?.rightEyeBlink ?? 0,
        };
        const features = mask.getFeaturesWithDynamics(dynamics);
        
        // Upload features to GPU
        const featureData = new Float32Array(32 * 8); // Max 32 features, 8 floats each (padded)
        features.forEach((f, i) => {
            if (i >= 32) return;
            const offset = i * 8;
            featureData[offset + 0] = f.cx;
            featureData[offset + 1] = f.cy;
            featureData[offset + 2] = f.cz;
            featureData[offset + 3] = f.width;
            featureData[offset + 4] = f.height;
            // Store orientation in padding field
            // We need to cast f as any or update type definition in next step
            const orient = (f as any).orientation ?? 0;
            featureData[offset + 5] = orient; 
            // pad2, pad3 left as 0
        });
        device.queue.writeBuffer(this.featuresBuffer, 0, featureData);

        const outputBuffer = device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        const stagingBuffer = device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
        });

        const paramsData = new Float32Array([
            chunkWorldX,
            chunkWorldY,
            this.CHUNK_SIZE,
            this.time,
            this.options.complexity,
            
            centerX,
            centerY,
            viewportWidth,
            viewportHeight,
            
            rotX,
            rotY,
            rotZ,
            
            features.length,
            0, 0, 0 // padding
        ]);
        device.queue.writeBuffer(this.faceParamsBuffer, 0, paramsData);

        const bindGroup = device.createBindGroup({
            layout: this.facePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: outputBuffer } },
                { binding: 1, resource: { buffer: this.faceParamsBuffer } },
                { binding: 2, resource: { buffer: this.featuresBuffer } },
            ]
        });

        const commandEncoder = device.createCommandEncoder();
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.facePipeline);
        computePass.setBindGroup(0, bindGroup);
        computePass.dispatchWorkgroups(
            Math.ceil(this.CHUNK_SIZE / 8),
            Math.ceil(this.CHUNK_SIZE / 8)
        );
        computePass.end();

        commandEncoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, bufferSize);
        device.queue.submit([commandEncoder.finish()]);

        await stagingBuffer.mapAsync(GPUMapMode.READ);
        const result = new Float32Array(stagingBuffer.getMappedRange());
        const intensities = new Float32Array(result);
        stagingBuffer.unmap();

        outputBuffer.destroy();
        stagingBuffer.destroy();

        return intensities;
    }

    private async ensureChunk(chunkKey: string): Promise<Float32Array> {
        // For smooth animation: always recompute chunks with current time
        // No caching - pattern flows continuously like water
        const { x, y } = this.chunkToWorld(chunkKey);
        const intensities = await this.computeChunk(x, y);

        // Store in cache for this frame only (avoids recomputing same chunk multiple times per frame)
        this.chunks.set(chunkKey, intensities);
        this.chunkAccessTime.set(chunkKey, Date.now());

        this.evictOldChunks();

        return intensities;
    }

    private evictOldChunks() {
        if (this.chunks.size <= this.MAX_CHUNKS) return;

        const sorted = Array.from(this.chunkAccessTime.entries())
            .sort((a, b) => a[1] - b[1]);

        const toRemove = sorted.slice(0, sorted.length - this.MAX_CHUNKS);

        for (const [chunkKey] of toRemove) {
            this.chunks.delete(chunkKey);
            this.chunkAccessTime.delete(chunkKey);
        }
    }

    async preloadViewport(startWorldX: number, startWorldY: number, endWorldX: number, endWorldY: number): Promise<void> {
        if (!this.isInitialized || !this.options.enabled) return;

        // Store viewport for auto-reload on animation invalidation
        this.lastViewport = { startX: startWorldX, startY: startWorldY, endX: endWorldX, endY: endWorldY };

        const startChunkX = Math.floor(startWorldX / this.CHUNK_SIZE);
        const endChunkX = Math.floor(endWorldX / this.CHUNK_SIZE);
        const startChunkY = Math.floor(startWorldY / this.CHUNK_SIZE);
        const endChunkY = Math.floor(endWorldY / this.CHUNK_SIZE);

        const promises: Promise<Float32Array>[] = [];

        for (let cy = startChunkY; cy <= endChunkY; cy++) {
            for (let cx = startChunkX; cx <= endChunkX; cx++) {
                const chunkKey = `${cx},${cy}`;
                promises.push(this.ensureChunk(chunkKey));
            }
        }

        await Promise.all(promises);
    }

    sampleAt(worldX: number, worldY: number): number {
        if (!this.options.enabled) return 0;

        // If mode is 'clear', return 0 (no background pattern, only character glows)
        if (this.options.mode === 'clear') return 0;

        const chunkKey = this.worldToChunk(worldX, worldY);
        const chunk = this.chunks.get(chunkKey);

        if (!chunk) return 0;

        const chunkOrigin = this.chunkToWorld(chunkKey);
        const localX = Math.floor(worldX) - chunkOrigin.x;
        const localY = Math.floor(worldY) - chunkOrigin.y;

        if (localX < 0 || localX >= this.CHUNK_SIZE || localY < 0 || localY >= this.CHUNK_SIZE) {
            return 0;
        }

        const index = localY * this.CHUNK_SIZE + localX;
        return chunk[index];
    }

    updateTime(deltaTime: number) {
        this.time += deltaTime * this.options.speed;
    }
    
    updateFaceData(faceData: MonogramOptions['faceOrientation']) {
        this.currentFaceOrientation = faceData || null;
        // Do NOT clear chunks here - it causes rapid blinking (flicker) as we wait for async GPU compute
        // Instead, we keep the old chunks visible until the new ones are computed and overwrite them
        
        // Trigger immediate re-render of visible area with new face orientation
        if (this.lastViewport) {
            this.preloadViewport(
                this.lastViewport.startX,
                this.lastViewport.startY,
                this.lastViewport.endX,
                this.lastViewport.endY
            ).catch(e => {
                // Ignore errors from rapid updates
            });
        }
    }

    setOptions(options: Partial<MonogramOptions>) {
        const complexityChanged = options.complexity !== undefined && options.complexity !== this.options.complexity;
        const modeChanged = options.mode !== undefined && options.mode !== this.options.mode;

        this.options = { ...this.options, ...options };

        if (complexityChanged || modeChanged) {
            this.chunks.clear();
            this.chunkAccessTime.clear();
        }

        // Update face data if provided in options
        if (options.faceOrientation) {
            this.currentFaceOrientation = options.faceOrientation;
        }
    }

    toggleEnabled() {
        this.options.enabled = !this.options.enabled;
    }

    getOptions(): MonogramOptions {
        return { ...this.options };
    }

    isReady(): boolean {
        return this.isInitialized;
    }

    destroy() {
        this.chunks.clear();
        this.chunkAccessTime.clear();
        this.paramsBuffer?.destroy();
        this.device?.destroy();
        this.isInitialized = false;
    }
}

// React hook
export function useMonogram(initialOptions?: Partial<MonogramOptions>) {
    const [options, setOptions] = useState<MonogramOptions>({
        enabled: initialOptions?.enabled ?? true,
        speed: initialOptions?.speed ?? 0.5,  // Single speed controller (lower = slower)
        complexity: initialOptions?.complexity ?? 1.0,
        mode: initialOptions?.mode ?? 'nara',
        interactiveTrails: initialOptions?.interactiveTrails ?? true,
        trailIntensity: initialOptions?.trailIntensity ?? 1.0,
        trailFadeMs: initialOptions?.trailFadeMs ?? 2000,
        faceOrientation: initialOptions?.faceOrientation
    });

    const systemRef = useRef<MonogramSystem | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);

    // Mouse trail tracking
    const [mouseTrail, setMouseTrail] = useState<MonogramTrailPosition[]>([]);
    const lastMousePosRef = useRef<{ x: number, y: number } | null>(null);

    useEffect(() => {
        const system = new MonogramSystem(options);
        systemRef.current = system;

        system.initialize().then(success => {
            setIsInitialized(success);
        });

        return () => {
            system.destroy();
        };
    }, []);

    // Propagate options changes to the MonogramSystem
    useEffect(() => {
        systemRef.current?.setOptions(options);
    }, [options]);

    useEffect(() => {
        if (!options.enabled) return;

        let lastTime = Date.now();
        let animationFrame: number;

        const animate = () => {
            const now = Date.now();
            const deltaTime = (now - lastTime) / 1000;
            lastTime = now;

            systemRef.current?.updateTime(deltaTime);
            animationFrame = requestAnimationFrame(animate);
        };

        animationFrame = requestAnimationFrame(animate);

        return () => cancelAnimationFrame(animationFrame);
    }, [options.enabled]);

    const preloadViewport = useCallback(async (startX: number, startY: number, endX: number, endY: number) => {
        await systemRef.current?.preloadViewport(startX, startY, endX, endY);
    }, []);

    // Update mouse position for interactive trails
    const updateMousePosition = useCallback((worldPos: { x: number, y: number }) => {
        if (!options.interactiveTrails) return;

        const currentPos = worldPos;

        // Only add to trail if mouse has actually moved significantly
        if (!lastMousePosRef.current ||
            Math.abs(currentPos.x - lastMousePosRef.current.x) > 0.5 ||
            Math.abs(currentPos.y - lastMousePosRef.current.y) > 0.5) {

            setMouseTrail(prev => {
                const now = Date.now();

                // Add new position with calculated intensity
                const intensity = (options.trailIntensity ?? 1.0) * (0.8 + Math.random() * 0.4);
                const newTrail = [...prev, {
                    x: currentPos.x,
                    y: currentPos.y,
                    timestamp: now,
                    intensity
                }];

                // Remove old positions
                const fadeMs = options.trailFadeMs ?? 2000;
                return newTrail.filter(pos => now - pos.timestamp < fadeMs);
            });

            lastMousePosRef.current = currentPos;
        }
    }, [options.interactiveTrails, options.trailIntensity, options.trailFadeMs]);

    // Clear trail (useful when transitioning between interaction modes)
    const clearTrail = useCallback(() => {
        setMouseTrail([]);
        lastMousePosRef.current = null;
        systemRef.current?.clearTrail();
    }, []);

    const toggleCell = useCallback((worldX: number, worldY: number) => {
        systemRef.current?.toggleCell(worldX, worldY);
    }, []);
    
    // Explicitly update face data (useful for high-frequency updates outside of options)
    const setFaceData = useCallback((faceData: { 
        rotX: number; 
        rotY: number; 
        rotZ: number; 
        mouthOpen?: number; 
        leftEyeBlink?: number; 
        rightEyeBlink?: number; 
        isTracked?: boolean; 
    }) => {
        systemRef.current?.updateFaceData(faceData);
    }, []);

    // Calculate interactive trail intensity at a given position
    const calculateInteractiveTrail = useCallback((x: number, y: number): number => {
        if (!options.interactiveTrails || mouseTrail.length < 2) return 0;

        const now = Date.now();
        const fadeMs = options.trailFadeMs ?? 2000;
        const complexity = options.complexity;
        const trailIntensity = options.trailIntensity ?? 1.0;

        let maxTrailIntensity = 0;

        // Check each segment of the trail
        for (let i = 0; i < mouseTrail.length - 1; i++) {
            const currentPos = mouseTrail[i];
            const nextPos = mouseTrail[i + 1];

            const age = now - currentPos.timestamp;
            if (age > fadeMs) continue;

            // Calculate distance from point to line segment between trail positions
            const dx = nextPos.x - currentPos.x;
            const dy = nextPos.y - currentPos.y;
            const segmentLength = Math.sqrt(dx * dx + dy * dy);

            if (segmentLength > 0) {
                // Project point onto line segment - scale Y by 0.5 to stretch pattern
                const scaledY = y * 0.5;
                const scaledCurrentPosY = currentPos.y * 0.5;
                const scaledNextPosY = nextPos.y * 0.5;

                const t = Math.max(0, Math.min(1, (
                    (x - currentPos.x) * dx + (scaledY - scaledCurrentPosY) * (scaledNextPosY - scaledCurrentPosY)
                ) / (dx * dx + (scaledNextPosY - scaledCurrentPosY) * (scaledNextPosY - scaledCurrentPosY))));

                const projX = currentPos.x + t * dx;
                const projY = scaledCurrentPosY + t * (scaledNextPosY - scaledCurrentPosY);

                const distance = Math.sqrt((x - projX) ** 2 + (scaledY - projY) ** 2);

                // Comet effect - brighter at the head (newer positions)
                const cometProgress = 1 - (i / (mouseTrail.length - 1));
                const cometFade = 0.3 + 0.7 * Math.pow(cometProgress, 2);

                // Distance-based fade
                const radius = 8 * complexity;
                const distanceFade = Math.max(0, 1 - (distance / radius));

                // Time-based fade
                const pathFade = 1 - (age / fadeMs);

                if (distanceFade > 0) {
                    const intensity = distanceFade * pathFade * cometFade * trailIntensity;
                    maxTrailIntensity = Math.max(maxTrailIntensity, intensity);
                }
            }
        }

        return Math.min(1, maxTrailIntensity);
    }, [options.interactiveTrails, options.trailFadeMs, options.complexity, options.trailIntensity, mouseTrail]);

    const sampleAt = useCallback((worldX: number, worldY: number): number => {
        // Get GPU-computed base pattern
        const gpuIntensity = systemRef.current?.sampleAt(worldX, worldY) ?? 0;

        // Add CPU-computed trail effect
        const trailIntensity = calculateInteractiveTrail(worldX, worldY);

        // Combine: max of GPU pattern and trail
        return Math.max(gpuIntensity, trailIntensity);
    }, [calculateInteractiveTrail]);

    const toggleEnabled = useCallback(() => {
        setOptions(prev => ({ ...prev, enabled: !prev.enabled }));
    }, []);

    // Clean up old trail positions periodically
    useEffect(() => {
        if (!options.interactiveTrails) {
            setMouseTrail([]);
            return;
        }

        const cleanup = setInterval(() => {
            const now = Date.now();
            const fadeMs = options.trailFadeMs ?? 2000;
            setMouseTrail(prev => prev.filter(pos => now - pos.timestamp < fadeMs));
        }, 200); // Clean up every 200ms

        return () => clearInterval(cleanup);
    }, [options.interactiveTrails, options.trailFadeMs]);

    return {
        options,
        setOptions,
        toggleEnabled,
        preloadViewport,
        sampleAt,
        isInitialized,
        updateMousePosition,
        clearTrail,
        toggleCell,
        setFaceData
    };
}