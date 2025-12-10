/**
 * post.ts - Client-side image post-processing system
 *
 * Provides a unified API for image transformations:
 * - Color effects (monochrome, sepia, invert, ghost)
 * - Geometry operations (crop, fit, trim transparent)
 * - Analysis utilities (bounding box detection, transparency stats)
 *
 * All operations use Canvas API for browser-based processing.
 */

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface PostEffectOptions {
    color?: string;           // Hex color for effects like ghost
    targetWidth?: number;     // Target width for fit operations
    targetHeight?: number;    // Target height for fit operations
    padding?: number;         // Padding to add around content (in pixels)
    alphaThreshold?: number;  // Threshold for transparency detection (0-255, default 10)
}

export type PostEffect = (
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    options?: PostEffectOptions
) => void;

export interface BoundingBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
}

export interface ImageAnalysis {
    width: number;
    height: number;
    contentBounds: BoundingBox;
    transparentPixels: number;
    opaquePixels: number;
    transparentPercent: number;
    paddingLeft: number;
    paddingRight: number;
    paddingTop: number;
    paddingBottom: number;
}

export interface CropFitResult {
    dataUrl: string;
    originalBounds: BoundingBox;
    scale: number;
    offsetX: number;
    offsetY: number;
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Convert hex color to RGB
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const cleanHex = hex.replace('#', '');
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);

    if (isNaN(r) || isNaN(g) || isNaN(b)) {
        return { r: 255, g: 255, b: 255 };
    }
    return { r, g, b };
}

/**
 * Load an image from URL into an HTMLImageElement
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
        img.src = url;
    });
}

/**
 * Create a canvas from an image
 */
export function imageToCanvas(img: HTMLImageElement): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');
    ctx.drawImage(img, 0, 0);
    return { canvas, ctx };
}

// ============================================================================
// ANALYSIS
// ============================================================================

/**
 * Find the bounding box of non-transparent content in an image
 */
export function findContentBounds(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    alphaThreshold: number = 10
): BoundingBox {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    let minX = width, minY = height, maxX = 0, maxY = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const alpha = data[idx + 3];

            if (alpha > alphaThreshold) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }

    // Handle empty image
    if (maxX < minX || maxY < minY) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }

    return {
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
    };
}

/**
 * Analyze an image for transparency and content bounds
 */
export function analyzeImage(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    alphaThreshold: number = 10
): ImageAnalysis {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    let minX = width, minY = height, maxX = 0, maxY = 0;
    let transparentPixels = 0;
    let opaquePixels = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const alpha = data[idx + 3];

            if (alpha > alphaThreshold) {
                opaquePixels++;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            } else {
                transparentPixels++;
            }
        }
    }

    const total = width * height;
    const contentBounds: BoundingBox = (maxX >= minX && maxY >= minY)
        ? { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 }
        : { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };

    return {
        width,
        height,
        contentBounds,
        transparentPixels,
        opaquePixels,
        transparentPercent: (transparentPixels / total) * 100,
        paddingLeft: contentBounds.minX,
        paddingRight: width - contentBounds.maxX - 1,
        paddingTop: contentBounds.minY,
        paddingBottom: height - contentBounds.maxY - 1
    };
}

/**
 * Analyze an image from URL
 */
export async function analyzeImageUrl(imageUrl: string): Promise<ImageAnalysis> {
    const img = await loadImage(imageUrl);
    const { ctx } = imageToCanvas(img);
    return analyzeImage(ctx, img.width, img.height);
}

// ============================================================================
// COLOR EFFECTS
// ============================================================================

/**
 * Convert to monochrome (grayscale)
 * Uses luminosity formula: 0.299*R + 0.587*G + 0.114*B
 */
export const monochromeEffect: PostEffect = (canvas, ctx) => {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        data[i] = gray;
        data[i + 1] = gray;
        data[i + 2] = gray;
    }

    ctx.putImageData(imageData, 0, 0);
};

/**
 * Apply sepia tone (vintage photograph look)
 */
export const sepiaEffect: PostEffect = (canvas, ctx) => {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        data[i] = Math.min(255, (r * 0.393) + (g * 0.769) + (b * 0.189));
        data[i + 1] = Math.min(255, (r * 0.349) + (g * 0.686) + (b * 0.168));
        data[i + 2] = Math.min(255, (r * 0.272) + (g * 0.534) + (b * 0.131));
    }

    ctx.putImageData(imageData, 0, 0);
};

/**
 * Invert all colors
 */
export const invertEffect: PostEffect = (canvas, ctx) => {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        data[i] = 255 - data[i];
        data[i + 1] = 255 - data[i + 1];
        data[i + 2] = 255 - data[i + 2];
    }

    ctx.putImageData(imageData, 0, 0);
};

/**
 * Ghost effect - solid colored silhouette
 * @param options.color - Hex color (default: #ffffff)
 */
export const ghostEffect: PostEffect = (canvas, ctx, options) => {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const ghostColor = hexToRgb(options?.color || '#ffffff');

    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0) {
            data[i] = ghostColor.r;
            data[i + 1] = ghostColor.g;
            data[i + 2] = ghostColor.b;
            data[i + 3] = 255;
        }
    }

    ctx.putImageData(imageData, 0, 0);
};

// ============================================================================
// BACKGROUND REMOVAL
// ============================================================================

/**
 * Calculate color distance between two RGB colors
 */
function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
    return Math.sqrt(
        Math.pow(r1 - r2, 2) +
        Math.pow(g1 - g2, 2) +
        Math.pow(b1 - b2, 2)
    );
}

/**
 * Detect background color by sampling corners and edges
 * Returns the most common color found in edge regions
 */
export function detectBackgroundColor(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
): { r: number; g: number; b: number } | null {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Sample pixels from corners and edges
    const sampleSize = Math.min(10, Math.floor(Math.min(width, height) / 4));
    const samples: Array<{ r: number; g: number; b: number }> = [];

    // Sample from corners
    const corners = [
        { x: 0, y: 0 },                    // top-left
        { x: width - 1, y: 0 },            // top-right
        { x: 0, y: height - 1 },           // bottom-left
        { x: width - 1, y: height - 1 }    // bottom-right
    ];

    for (const corner of corners) {
        for (let dy = 0; dy < sampleSize; dy++) {
            for (let dx = 0; dx < sampleSize; dx++) {
                const x = Math.min(Math.max(corner.x + (corner.x === 0 ? dx : -dx), 0), width - 1);
                const y = Math.min(Math.max(corner.y + (corner.y === 0 ? dy : -dy), 0), height - 1);
                const idx = (y * width + x) * 4;
                const alpha = data[idx + 3];

                // Only sample opaque pixels
                if (alpha > 200) {
                    samples.push({
                        r: data[idx],
                        g: data[idx + 1],
                        b: data[idx + 2]
                    });
                }
            }
        }
    }

    if (samples.length === 0) return null;

    // Find the most common color (clustering by similarity)
    const colorCounts = new Map<string, { count: number; r: number; g: number; b: number }>();
    const tolerance = 30; // Colors within this distance are considered the same

    for (const sample of samples) {
        let foundMatch = false;
        for (const [key, value] of colorCounts) {
            if (colorDistance(sample.r, sample.g, sample.b, value.r, value.g, value.b) < tolerance) {
                value.count++;
                foundMatch = true;
                break;
            }
        }
        if (!foundMatch) {
            const key = `${sample.r},${sample.g},${sample.b}`;
            colorCounts.set(key, { count: 1, ...sample });
        }
    }

    // Return the most common color
    let maxCount = 0;
    let bgColor: { r: number; g: number; b: number } | null = null;

    for (const value of colorCounts.values()) {
        if (value.count > maxCount) {
            maxCount = value.count;
            bgColor = { r: value.r, g: value.g, b: value.b };
        }
    }

    return bgColor;
}

/**
 * Remove background color from image, making it transparent
 * Uses flood-fill from edges to only remove connected background regions
 *
 * @param imageUrl - Source image URL
 * @param tolerance - Color distance tolerance (default: 40)
 * @param edgeOnly - If true, only remove background connected to edges (flood-fill)
 */
export async function removeBackground(
    imageUrl: string,
    tolerance: number = 40,
    edgeOnly: boolean = true
): Promise<string> {
    const img = await loadImage(imageUrl);
    const { canvas, ctx } = imageToCanvas(img);
    const width = canvas.width;
    const height = canvas.height;

    // Detect background color
    const bgColor = detectBackgroundColor(ctx, width, height);
    if (!bgColor) {
        return canvas.toDataURL('image/png');
    }

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    if (edgeOnly) {
        // Flood-fill from edges - only remove background connected to borders
        const visited = new Set<number>();
        const toProcess: Array<{ x: number; y: number }> = [];

        // Add all edge pixels to processing queue
        for (let x = 0; x < width; x++) {
            toProcess.push({ x, y: 0 });
            toProcess.push({ x, y: height - 1 });
        }
        for (let y = 0; y < height; y++) {
            toProcess.push({ x: 0, y });
            toProcess.push({ x: width - 1, y });
        }

        while (toProcess.length > 0) {
            const { x, y } = toProcess.pop()!;
            const key = y * width + x;

            if (visited.has(key)) continue;
            if (x < 0 || x >= width || y < 0 || y >= height) continue;

            visited.add(key);

            const idx = key * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const a = data[idx + 3];

            // Check if this pixel matches background color
            if (a > 10 && colorDistance(r, g, b, bgColor.r, bgColor.g, bgColor.b) < tolerance) {
                // Make transparent
                data[idx + 3] = 0;

                // Add neighbors to queue
                toProcess.push({ x: x - 1, y });
                toProcess.push({ x: x + 1, y });
                toProcess.push({ x, y: y - 1 });
                toProcess.push({ x, y: y + 1 });
            }
        }
    } else {
        // Simple threshold - remove all pixels matching background color
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            if (colorDistance(r, g, b, bgColor.r, bgColor.g, bgColor.b) < tolerance) {
                data[i + 3] = 0; // Make transparent
            }
        }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
}

/**
 * Remove background and crop to content
 * Combines removeBackground + cropAndFit for full cleanup
 */
export async function removeBackgroundAndFit(
    imageUrl: string,
    targetWidth: number,
    targetHeight: number,
    tolerance: number = 40
): Promise<CropFitResult> {
    // First remove background
    const cleanedUrl = await removeBackground(imageUrl, tolerance, true);

    // Then crop and fit
    return cropAndFit(cleanedUrl, targetWidth, targetHeight);
}

// ============================================================================
// GEOMETRY EFFECTS
// ============================================================================

/**
 * Trim transparent padding from image edges
 * Returns a new canvas cropped to content bounds
 */
export function trimTransparent(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    alphaThreshold: number = 10
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; bounds: BoundingBox } {
    const bounds = findContentBounds(ctx, canvas.width, canvas.height, alphaThreshold);

    if (bounds.width === 0 || bounds.height === 0) {
        // Empty image, return as-is
        return { canvas, ctx, bounds };
    }

    // Create new canvas with trimmed dimensions
    const trimmedCanvas = document.createElement('canvas');
    trimmedCanvas.width = bounds.width;
    trimmedCanvas.height = bounds.height;
    const trimmedCtx = trimmedCanvas.getContext('2d');
    if (!trimmedCtx) throw new Error('Failed to get canvas context');

    // Copy content region
    trimmedCtx.drawImage(
        canvas,
        bounds.minX, bounds.minY, bounds.width, bounds.height,
        0, 0, bounds.width, bounds.height
    );

    return { canvas: trimmedCanvas, ctx: trimmedCtx, bounds };
}

/**
 * Crop and fit image to target dimensions while maintaining aspect ratio
 * - Trims transparent padding
 * - Scales to fit within target bounds
 * - Centers content
 *
 * @param imageUrl - Source image URL
 * @param targetWidth - Target width in pixels
 * @param targetHeight - Target height in pixels
 * @param padding - Optional padding around content (default: 0)
 */
export async function cropAndFit(
    imageUrl: string,
    targetWidth: number,
    targetHeight: number,
    padding: number = 0
): Promise<CropFitResult> {
    const img = await loadImage(imageUrl);
    const { canvas: srcCanvas, ctx: srcCtx } = imageToCanvas(img);

    // Find content bounds
    const bounds = findContentBounds(srcCtx, img.width, img.height);

    if (bounds.width === 0 || bounds.height === 0) {
        // Empty image
        return {
            dataUrl: srcCanvas.toDataURL('image/png'),
            originalBounds: bounds,
            scale: 1,
            offsetX: 0,
            offsetY: 0
        };
    }

    // Calculate available space (accounting for padding)
    const availableWidth = targetWidth - (padding * 2);
    const availableHeight = targetHeight - (padding * 2);

    // Calculate scale to fit content within available space
    const scaleX = availableWidth / bounds.width;
    const scaleY = availableHeight / bounds.height;
    const scale = Math.min(scaleX, scaleY, 1); // Never upscale

    // Calculate final content dimensions
    const finalWidth = Math.floor(bounds.width * scale);
    const finalHeight = Math.floor(bounds.height * scale);

    // Calculate centering offsets
    const offsetX = Math.floor((targetWidth - finalWidth) / 2);
    const offsetY = Math.floor((targetHeight - finalHeight) / 2);

    // Create output canvas
    const outCanvas = document.createElement('canvas');
    outCanvas.width = targetWidth;
    outCanvas.height = targetHeight;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) throw new Error('Failed to get canvas context');

    // Clear with transparency
    outCtx.clearRect(0, 0, targetWidth, targetHeight);

    // Disable smoothing for pixel art
    outCtx.imageSmoothingEnabled = false;

    // Draw cropped and scaled content centered
    outCtx.drawImage(
        srcCanvas,
        bounds.minX, bounds.minY, bounds.width, bounds.height, // Source rect (cropped)
        offsetX, offsetY, finalWidth, finalHeight              // Dest rect (scaled & centered)
    );

    return {
        dataUrl: outCanvas.toDataURL('image/png'),
        originalBounds: bounds,
        scale,
        offsetX,
        offsetY
    };
}

/**
 * Fit image to target dimensions (no crop, just scale)
 * Maintains aspect ratio, centers content
 */
export async function fitToSize(
    imageUrl: string,
    targetWidth: number,
    targetHeight: number
): Promise<string> {
    const img = await loadImage(imageUrl);

    const scaleX = targetWidth / img.width;
    const scaleY = targetHeight / img.height;
    const scale = Math.min(scaleX, scaleY);

    const finalWidth = Math.floor(img.width * scale);
    const finalHeight = Math.floor(img.height * scale);
    const offsetX = Math.floor((targetWidth - finalWidth) / 2);
    const offsetY = Math.floor((targetHeight - finalHeight) / 2);

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');

    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, offsetX, offsetY, finalWidth, finalHeight);

    return canvas.toDataURL('image/png');
}

// ============================================================================
// EFFECT REGISTRY & APPLICATION
// ============================================================================

/**
 * Named effect presets
 */
export const effects: Record<string, PostEffect> = {
    monochrome: monochromeEffect,
    sepia: sepiaEffect,
    invert: invertEffect,
    ghost: ghostEffect,
};

/**
 * Get an effect by name
 */
export function getEffect(name: string): PostEffect | undefined {
    return effects[name.toLowerCase()];
}

/**
 * Get list of available effect names
 */
export function getAvailableEffects(): string[] {
    return Object.keys(effects);
}

/**
 * Apply a named effect to an image
 * @param imageUrl - URL or data URL of the image
 * @param effectName - Name of the effect to apply
 * @param options - Effect options
 * @returns Data URL of processed image
 */
export async function applyEffect(
    imageUrl: string,
    effectName: string,
    options?: PostEffectOptions
): Promise<string> {
    const effect = getEffect(effectName);
    if (!effect) {
        throw new Error(`Unknown effect: ${effectName}`);
    }

    const img = await loadImage(imageUrl);
    const { canvas, ctx } = imageToCanvas(img);
    effect(canvas, ctx, options);
    return canvas.toDataURL('image/png');
}

/**
 * Apply multiple effects in sequence
 */
export async function applyEffectChain(
    imageUrl: string,
    effectNames: string[],
    options?: PostEffectOptions
): Promise<string> {
    let currentUrl = imageUrl;

    for (const name of effectNames) {
        currentUrl = await applyEffect(currentUrl, name, options);
    }

    return currentUrl;
}

// ============================================================================
// LEGACY EXPORTS (for backwards compatibility with skins.ts)
// ============================================================================

// Re-export with old names for compatibility
export const applySkin = applyEffect;
export { effects as skins };
export type SkinEffect = PostEffect;
export type SkinEffectOptions = PostEffectOptions;
