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
            timestamp
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

        // Center the text
        const startCol = Math.floor((availableWidthChars - maxLineWidth) / 2);
        const startRow = Math.floor((availableHeightChars - totalHeight) / 2);

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

        // Collect all text cell positions
        const textCells = new Set<string>();
        wrappedLines.forEach((line, lineIndex) => {
            for (let x = 0; x < line.length; x++) {
                const char = line[x];
                if (char && char.trim() !== '') {
                    textCells.add(`${startCol + x},${startRow + lineIndex}`);
                }
            }
        });

        // Render glow for each text cell
        const maxRadius = GLOW_RADIUS + CARDINAL_EXTENSION;
        textCells.forEach(cellKey => {
            const [cx, cy] = cellKey.split(',').map(Number);

            for (let dy = -maxRadius; dy <= maxRadius; dy++) {
                for (let dx = -maxRadius; dx <= maxRadius; dx++) {
                    if (dx === 0 && dy === 0) continue; // Skip the text cell itself

                    const glowCol = cx + dx;
                    const glowRow = cy + dy;

                    // Skip if this is also a text cell
                    if (textCells.has(`${glowCol},${glowRow}`)) continue;

                    // Check if on cardinal direction
                    const isCardinal = (dx === 0 || dy === 0);
                    const effectiveRadius = isCardinal ? maxRadius : GLOW_RADIUS;

                    const distance = Math.max(Math.abs(dx), Math.abs(dy));
                    if (distance > effectiveRadius) continue;

                    // Calculate alpha
                    let alpha;
                    if (distance <= GLOW_RADIUS) {
                        alpha = glowAlphas[distance - 1];
                    } else {
                        alpha = glowAlphas[GLOW_RADIUS - 1] * 0.3;
                    }
                    if (!alpha) continue;

                    const screenX = glowCol * charWidth;
                    const screenY = glowRow * charHeight;

                    ctx.fillStyle = `rgba(${bgR}, ${bgG}, ${bgB}, ${alpha})`;
                    ctx.fillRect(screenX, screenY, charWidth, charHeight);
                }
            }
        });

        // Render actual text with full background
        ctx.globalAlpha = fadeProgress;
        wrappedLines.forEach((line, lineIndex) => {
            for (let x = 0; x < line.length; x++) {
                const char = line[x];
                const screenX = (startCol + x) * charWidth;
                const screenY = (startRow + lineIndex) * charHeight;

                if (char && char.trim() !== '') {
                    // Full background for text cell
                    ctx.fillStyle = backgroundColor;
                    ctx.fillRect(screenX, screenY, charWidth, charHeight);

                    // Render character
                    ctx.fillStyle = textColor;
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
