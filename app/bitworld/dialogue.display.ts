/**
 * dialogue.display.ts - Modular dialogue display system
 *
 * This module provides different visual styles for rendering dialogue text,
 * similar to how mask.ts provides different face styles. Users can switch
 * between different dialogue displays (subtitle, host-style, etc.)
 */

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Context needed to render dialogue
 */
export interface DialogueRenderContext {
    ctx: CanvasRenderingContext2D;
    text: string;
    canvasWidth: number;
    canvasHeight: number;
    charWidth: number;
    charHeight: number;
    fontSize: number;
    fontFamily: string;
    textColor: string;
    backgroundColor: string;
    timestamp?: number; // Optional timestamp for animations
    position?: 'center' | 'bottom'; // Vertical positioning (default varies by display)
}

/**
 * A complete dialogue display definition
 */
export interface DialogueDisplay {
    name: string;
    description: string;

    // Render the dialogue with the given context
    render: (context: DialogueRenderContext) => void;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Wrap text to fit within a maximum width
 */
export function wrapText(text: string, maxWidth: number): string[] {
    const paragraphs = text.split('\n');
    const lines: string[] = [];

    for (const paragraph of paragraphs) {
        const trimmed = paragraph.trim();
        if (trimmed === '') {
            lines.push('');
            continue;
        }

        const words = trimmed.split(' ');
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            if (testLine.length <= maxWidth) {
                currentLine = testLine;
            } else {
                if (currentLine) {
                    lines.push(currentLine);
                    currentLine = word;
                } else {
                    lines.push(word.substring(0, maxWidth));
                    currentLine = word.substring(maxWidth);
                }
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }
    }

    return lines;
}

// ============================================================================
// DISPLAY DEFINITIONS
// ============================================================================

/**
 * Subtitle Display - Simple black bar at bottom with white text
 */
export const SubtitleDisplay: DialogueDisplay = {
    name: 'subtitle',
    description: 'Classic subtitle style - black bar at bottom with white text',

    render(context: DialogueRenderContext) {
        const {
            ctx,
            text,
            canvasWidth,
            canvasHeight,
            charWidth,
            charHeight,
            fontSize,
            fontFamily
        } = context;

        // Constants
        const MAX_WIDTH_CHARS = 60;
        const MARGIN_CHARS = 4;
        const BACKGROUND_COLOR = 'rgba(0, 0, 0, 0.8)';
        const TEXT_COLOR = '#FFFFFF';

        // Calculate layout
        const availableWidthChars = Math.floor(canvasWidth / charWidth);
        const availableHeightChars = Math.floor(canvasHeight / charHeight);
        const maxWidthChars = Math.min(MAX_WIDTH_CHARS, availableWidthChars - (2 * MARGIN_CHARS));
        const wrappedLines = wrapText(text, maxWidthChars);

        const dialogueHeight = wrappedLines.length;
        const bottomMargin = 3;
        const startRow = Math.max(MARGIN_CHARS, availableHeightChars - bottomMargin - dialogueHeight);
        const startCol = Math.floor((availableWidthChars - maxWidthChars) / 2);

        const verticalTextOffset = (charHeight - fontSize) / 2 + (fontSize * 0.1);

        // Set font
        ctx.save();
        ctx.font = `${fontSize}px "${fontFamily}"`;
        ctx.textBaseline = 'top';

        // Draw background
        ctx.fillStyle = BACKGROUND_COLOR;
        for (let lineIndex = 0; lineIndex < wrappedLines.length; lineIndex++) {
            const rowIndex = startRow + lineIndex;
            const line = wrappedLines[lineIndex];
            const screenX = startCol * charWidth;
            const screenY = rowIndex * charHeight;
            const lineWidth = line.length * charWidth;
            ctx.fillRect(screenX, screenY, lineWidth, charHeight);
        }

        // Draw text
        ctx.fillStyle = TEXT_COLOR;
        for (let lineIndex = 0; lineIndex < wrappedLines.length; lineIndex++) {
            const rowIndex = startRow + lineIndex;
            const line = wrappedLines[lineIndex];
            const screenX = startCol * charWidth;
            const screenY = rowIndex * charHeight;
            ctx.fillText(line, screenX, screenY + verticalTextOffset);
        }

        ctx.restore();
    }
};

/**
 * Host Display - Styled dialogue with glow effect and fade-in
 */
export const HostDisplay: DialogueDisplay = {
    name: 'host',
    description: 'Styled dialogue with glow effect, pulsing, and fade-in animation',

    render(context: DialogueRenderContext) {
        const {
            ctx,
            text,
            canvasWidth,
            canvasHeight,
            charWidth,
            charHeight,
            fontSize,
            fontFamily,
            textColor,
            backgroundColor,
            timestamp,
            position = 'bottom' // Default to bottom positioning
        } = context;

        // Constants
        const MAX_WIDTH_CHARS = 60;
        const MARGIN_CHARS = 4;
        const FADE_DURATION = 800; // ms
        const GLOW_RADIUS = 2;
        const CARDINAL_EXTENSION = 1;

        // Calculate fade progress
        const textElapsed = timestamp ? Date.now() - timestamp : FADE_DURATION;
        let fadeProgress = Math.min(1, textElapsed / FADE_DURATION);
        fadeProgress = fadeProgress * fadeProgress * (3 - 2 * fadeProgress); // Smooth easing

        // Calculate layout
        const availableWidthChars = Math.floor(canvasWidth / charWidth);
        const availableHeightChars = Math.floor(canvasHeight / charHeight);
        const maxWidthChars = Math.min(MAX_WIDTH_CHARS, availableWidthChars - (2 * MARGIN_CHARS));
        const wrappedLines = wrapText(text, maxWidthChars);

        const maxLineWidth = Math.max(...wrappedLines.map(line => line.length));
        const totalHeight = wrappedLines.length;

        // Calculate positioning based on position parameter
        const startCol = Math.floor((availableWidthChars - maxLineWidth) / 2);
        let startRow: number;

        if (position === 'bottom') {
            // Bottom positioning (like subtitles)
            const bottomMargin = 3;
            startRow = Math.max(MARGIN_CHARS, availableHeightChars - bottomMargin - totalHeight);
        } else {
            // Center positioning
            startRow = Math.floor((availableHeightChars - totalHeight) / 2);
        }

        const verticalTextOffset = (charHeight - fontSize) / 2 + (fontSize * 0.1);

        // Set font
        ctx.save();
        ctx.font = `${fontSize}px "${fontFamily}"`;
        ctx.textBaseline = 'top';

        // Calculate glow pulse intensity
        const pulseSpeed = 0.001;
        const pulsePhase = (Date.now() * pulseSpeed) % (Math.PI * 2);
        const basePulse = 0.6 + Math.sin(pulsePhase) * 0.2; // 0.4 to 0.8

        // Flickering noise
        const flickerSpeed = 0.05;
        const time = Date.now() * flickerSpeed;
        const flicker1 = Math.sin(time * 2.3) * 0.5 + 0.5;
        const flicker2 = Math.sin(time * 4.7) * 0.5 + 0.5;
        const randomNoise = Math.random();

        const flickerPerturbation = (flicker1 * 0.08 + flicker2 * 0.05 + randomNoise * 0.07);
        const pulseIntensity = basePulse + flickerPerturbation;

        const glowAlphas = [
            0.6 * pulseIntensity * fadeProgress,
            0.3 * pulseIntensity * fadeProgress
        ];

        // Parse background color for glow
        const bgHex = backgroundColor.replace('#', '');
        const bgR = parseInt(bgHex.substring(0, 2), 16);
        const bgG = parseInt(bgHex.substring(2, 4), 16);
        const bgB = parseInt(bgHex.substring(4, 6), 16);

        // Calculate bounding box for all text (including spaces)
        let minCol = Infinity, maxCol = -Infinity;
        let minRow = Infinity, maxRow = -Infinity;

        wrappedLines.forEach((line, lineIndex) => {
            if (line.length > 0) {
                const col = startCol;
                const row = startRow + lineIndex;

                // Update bounding box to include entire line (including spaces)
                minCol = Math.min(minCol, col);
                maxCol = Math.max(maxCol, col + line.length - 1);
                minRow = Math.min(minRow, row);
                maxRow = Math.max(maxRow, row);
            }
        });

        // Render glow around the entire text bounding box
        const maxRadius = GLOW_RADIUS + CARDINAL_EXTENSION;

        // Iterate over the extended bounding box
        for (let row = minRow - maxRadius; row <= maxRow + maxRadius; row++) {
            for (let col = minCol - maxRadius; col <= maxCol + maxRadius; col++) {
                // Skip if this is inside the text bounding box (not glow area)
                if (col >= minCol && col <= maxCol && row >= minRow && row <= maxRow) continue;

                // Calculate distance from this cell to the nearest edge of the text bounding box
                const distX = Math.max(0, Math.max(minCol - col, col - maxCol));
                const distY = Math.max(0, Math.max(minRow - row, row - maxRow));
                const distance = Math.max(distX, distY); // Chebyshev distance to bounding box

                if (distance === 0 || distance > maxRadius) continue;

                // Check if on cardinal direction (aligned with bounding box edge)
                const isCardinal = (distX === 0 || distY === 0);
                const effectiveRadius = isCardinal ? maxRadius : GLOW_RADIUS;

                if (distance > effectiveRadius) continue;

                // Calculate alpha based on distance
                let alpha;
                if (distance <= GLOW_RADIUS) {
                    alpha = glowAlphas[distance - 1];
                } else {
                    // Extended glow (only on cardinals)
                    alpha = glowAlphas[GLOW_RADIUS - 1] * 0.3;
                }
                if (!alpha) continue;

                const screenX = col * charWidth;
                const screenY = row * charHeight;

                ctx.fillStyle = `rgba(${bgR}, ${bgG}, ${bgB}, ${alpha})`;
                ctx.fillRect(screenX, screenY, charWidth, charHeight);
            }
        }

        // Render the entire text block as a unified solid rectangle
        ctx.globalAlpha = fadeProgress;

        // First, fill the entire bounding box with background color (solid block)
        const blockX = minCol * charWidth;
        const blockY = minRow * charHeight;
        const blockWidth = (maxCol - minCol + 1) * charWidth;
        const blockHeight = (maxRow - minRow + 1) * charHeight;

        ctx.fillStyle = backgroundColor;
        ctx.fillRect(blockX, blockY, blockWidth, blockHeight);

        // Then, render all characters on top
        ctx.fillStyle = textColor;
        wrappedLines.forEach((line, lineIndex) => {
            for (let x = 0; x < line.length; x++) {
                const char = line[x];
                if (char && char.trim() !== '') {
                    const screenX = (startCol + x) * charWidth;
                    const screenY = (startRow + lineIndex) * charHeight;
                    ctx.fillText(char, screenX, screenY + verticalTextOffset);
                }
            }
        });

        ctx.globalAlpha = 1.0;
        ctx.restore();
    }
};

// ============================================================================
// DISPLAY REGISTRY
// ============================================================================

/**
 * Collection of all available dialogue displays
 */
export const DialogueDisplayRegistry: Record<string, DialogueDisplay> = {
    subtitle: SubtitleDisplay,
    host: HostDisplay,
};

/**
 * Get a dialogue display by name, defaults to subtitle
 */
export function getDialogueDisplay(name: string): DialogueDisplay {
    return DialogueDisplayRegistry[name] || SubtitleDisplay;
}

/**
 * Get list of all available dialogue display names
 */
export function getAvailableDialogueDisplays(): string[] {
    return Object.keys(DialogueDisplayRegistry);
}

/**
 * Default dialogue display to use
 */
export const DefaultDialogueDisplay = SubtitleDisplay;
