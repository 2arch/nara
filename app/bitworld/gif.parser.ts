// GIF frame parser using gifuct-js
import { parseGIF, decompressFrames } from 'gifuct-js';

export interface GIFFrame {
    imageData: ImageData;
    delay: number; // milliseconds
}

export interface ParsedGIF {
    frames: GIFFrame[];
    width: number;
    height: number;
    totalDuration: number; // Total animation duration in ms
}

/**
 * Parse a GIF file and extract all frames with timing information
 */
export async function parseGIFFromURL(url: string): Promise<ParsedGIF | null> {
    try {
        // Fetch the GIF as an ArrayBuffer
        const response = await fetch(url);
        if (!response.ok) {
            console.error('Failed to fetch GIF:', response.statusText);
            return null;
        }

        const arrayBuffer = await response.arrayBuffer();
        return parseGIFFromArrayBuffer(arrayBuffer);
    } catch (error) {
        console.error('Error parsing GIF from URL:', error);
        return null;
    }
}

/**
 * Parse a GIF from an ArrayBuffer
 */
export function parseGIFFromArrayBuffer(arrayBuffer: ArrayBuffer): ParsedGIF | null {
    try {
        // Parse GIF structure
        const gif = parseGIF(arrayBuffer);

        // Decompress frames
        const frames = decompressFrames(gif, true);

        if (!frames || frames.length === 0) {
            console.error('No frames found in GIF');
            return null;
        }

        // Convert frames to ImageData and calculate timing
        const parsedFrames: GIFFrame[] = [];
        let totalDuration = 0;

        for (const frame of frames) {
            // Extract frame data (patch is at frame level, dims are separate)
            const { width, height } = frame.dims;
            const delay = frame.delay || 10; // Default to 10 centiseconds if not specified
            const patch = frame.patch;

            // Validate patch data
            if (!patch || patch.length === 0) {
                console.warn('Frame has empty patch data, skipping');
                continue;
            }

            // Create ImageData from frame patch (RGBA pixel data)
            const imageData = new ImageData(
                new Uint8ClampedArray(patch),
                width,
                height
            );

            // Convert delay from centiseconds to milliseconds (GIF uses centiseconds)
            let delayMs = delay * 10;

            // Cap delays at 100ms (10fps minimum) to keep animations smooth
            // Many GIFs have unreasonably slow delays
            if (delayMs > 100) {
                delayMs = 100;
            }

            // Minimum 16ms (60fps max)
            if (delayMs < 16) {
                delayMs = 16;
            }

            totalDuration += delayMs;

            parsedFrames.push({
                imageData,
                delay: delayMs
            });
        }

        // Ensure we have at least one valid frame
        if (parsedFrames.length === 0) {
            console.error('No valid frames parsed from GIF');
            return null;
        }

        return {
            frames: parsedFrames,
            width: frames[0].dims.width,
            height: frames[0].dims.height,
            totalDuration
        };
    } catch (error) {
        console.error('Error parsing GIF from ArrayBuffer:', error);
        return null;
    }
}

/**
 * Calculate which frame should be displayed at a given time
 */
export function getCurrentFrame(parsedGIF: ParsedGIF, elapsedMs: number): number {
    if (!parsedGIF || parsedGIF.frames.length === 0) return 0;

    // Loop the animation
    const loopedTime = elapsedMs % parsedGIF.totalDuration;

    // Find the frame that should be displayed at this time
    let accumulatedTime = 0;
    for (let i = 0; i < parsedGIF.frames.length; i++) {
        accumulatedTime += parsedGIF.frames[i].delay;
        if (loopedTime < accumulatedTime) {
            return i;
        }
    }

    // Fallback to last frame
    return parsedGIF.frames.length - 1;
}

/**
 * Check if a URL points to a GIF file
 */
export function isGIFUrl(url: string): boolean {
    return url.toLowerCase().endsWith('.gif') || url.includes('.gif?');
}
