import { Frame } from 'gifuct-js';

export interface PixelatedFrame {
    width: number;
    height: number;
    data: { char: string; color: string }[];
}

const a = [' ', '░', '▒', '▓', '█'];

// Fixed viewport dimensions for consistent gif display
// Character cells are 1:2 width:height, so to get a square visual viewport:
// We need 2x as many horizontal characters as vertical characters
const VIEWPORT_WIDTH = 60; // characters
const VIEWPORT_HEIGHT = 30; // characters (creates a visually square 60:60 viewport due to 1:2 cell ratio)

export const processGifFrame = (frame: Frame): PixelatedFrame => {
    const { width, height } = frame.dims;
    
    // Create original canvas
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    if (!tempCtx) throw new Error('Could not create canvas context');

    tempCanvas.width = width;
    tempCanvas.height = height;
    const imageData = tempCtx.createImageData(width, height);
    imageData.data.set(frame.patch);
    tempCtx.putImageData(imageData, 0, 0);

    // Step 1: Calculate the optimal character grid size based on GIF aspect ratio
    const gifAspectRatio = width / height; // GIF's actual aspect ratio
    const characterCellAspectRatio = 0.5; // Character cells are 1:2 (width:height)
    
    // To display the GIF with correct proportions, we need to account for both:
    // - The GIF's natural aspect ratio
    // - The character cell aspect ratio
    const correctedAspectRatio = gifAspectRatio / characterCellAspectRatio;
    
    // Calculate character grid dimensions that preserve the GIF's aspect ratio
    let charWidth, charHeight;
    if (correctedAspectRatio > 1) {
        // Wider than tall - constrain by width
        charWidth = VIEWPORT_WIDTH;
        charHeight = Math.round(VIEWPORT_WIDTH / correctedAspectRatio);
    } else {
        // Taller than wide - constrain by height  
        charHeight = VIEWPORT_HEIGHT;
        charWidth = Math.round(VIEWPORT_HEIGHT * correctedAspectRatio);
    }
    
    // Ensure we don't exceed viewport bounds
    charWidth = Math.min(charWidth, VIEWPORT_WIDTH);
    charHeight = Math.min(charHeight, VIEWPORT_HEIGHT);

    // Step 2: Create appropriately sized canvas for the character grid
    const charCanvas = document.createElement('canvas');
    const charCtx = charCanvas.getContext('2d', { willReadFrequently: true });
    if (!charCtx) throw new Error('Could not create canvas context');

    charCanvas.width = charWidth;
    charCanvas.height = charHeight;
    
    // Scale the GIF to fit the character grid exactly (no cropping needed now)
    charCtx.drawImage(tempCanvas, 0, 0, charWidth, charHeight);

    // Step 3: Create the final viewport canvas and center the character grid
    const viewportCanvas = document.createElement('canvas');
    const viewportCtx = viewportCanvas.getContext('2d', { willReadFrequently: true });
    if (!viewportCtx) throw new Error('Could not create canvas context');

    viewportCanvas.width = VIEWPORT_WIDTH;
    viewportCanvas.height = VIEWPORT_HEIGHT;
    
    // Center the character grid in the viewport
    const offsetX = Math.floor((VIEWPORT_WIDTH - charWidth) / 2);
    const offsetY = Math.floor((VIEWPORT_HEIGHT - charHeight) / 2);
    
    viewportCtx.drawImage(charCanvas, offsetX, offsetY);

    // Step 4: Process the final viewport into character data
    const viewportImageData = viewportCtx.getImageData(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    const data: { char: string; color: string }[] = [];

    for (let i = 0; i < viewportImageData.data.length; i += 4) {
        const r = viewportImageData.data[i];
        const g = viewportImageData.data[i + 1];
        const b = viewportImageData.data[i + 2];
        const alpha = viewportImageData.data[i + 3];
        
        // Handle transparency (areas outside the centered gif)
        if (alpha < 128) {
            data.push({
                char: ' ',
                color: 'transparent',
            });
        } else {
            const gray = (r + g + b) / 3;
            const charIndex = Math.floor((gray / 255) * (a.length - 1));
            data.push({
                char: a[charIndex],
                color: `rgb(${r},${g},${b})`,
            });
        }
    }

    return {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        data,
    };
};
