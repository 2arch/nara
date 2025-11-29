/**
 * Chat bubble system for character sprite
 * Built on the pixel grid framework - all elements are grid-aligned cells
 */

export interface BubbleState {
    isVisible: boolean;
    text: string;
    timestamp: number;
    duration: number;       // ms, 0 = permanent
    maxCharsPerLine: number; // Max characters per line before wrapping
}

export interface BubbleGridConfig {
    backgroundColor: string;
    textColor: string;
    borderColor: string;
    paddingCells: number;   // Padding in grid cells
    tailHeightCells: number; // Tail height in cells
    tailWidthCells: number;  // Tail width in cells
    offsetYCells: number;    // Gap above character in cells
    fadeInDuration: number;
    fadeOutDuration: number;
    defaultDuration: number;
    maxCharsPerLine: number;
}

export const DEFAULT_BUBBLE_CONFIG: BubbleGridConfig = {
    backgroundColor: '#ffffff',
    textColor: '#000000',
    borderColor: '#000000',
    paddingCells: 1,        // 1 cell padding
    tailHeightCells: 2,     // 2 cells tall tail
    tailWidthCells: 3,      // 3 cells wide tail base
    offsetYCells: 1,        // 1 cell gap above character
    fadeInDuration: 150,
    fadeOutDuration: 300,
    defaultDuration: 5000,
    maxCharsPerLine: 20,    // Characters per line
};

export function createInitialBubbleState(): BubbleState {
    return {
        isVisible: false,
        text: '',
        timestamp: 0,
        duration: 0,
        maxCharsPerLine: DEFAULT_BUBBLE_CONFIG.maxCharsPerLine,
    };
}

export function showBubble(
    text: string,
    duration: number = DEFAULT_BUBBLE_CONFIG.defaultDuration
): BubbleState {
    return {
        isVisible: true,
        text,
        timestamp: Date.now(),
        duration,
        maxCharsPerLine: DEFAULT_BUBBLE_CONFIG.maxCharsPerLine,
    };
}

export function hideBubble(): BubbleState {
    return createInitialBubbleState();
}

export function calculateBubbleOpacity(
    state: BubbleState,
    config: BubbleGridConfig = DEFAULT_BUBBLE_CONFIG
): number {
    if (!state.isVisible) return 0;

    const elapsed = Date.now() - state.timestamp;

    if (elapsed < config.fadeInDuration) {
        return elapsed / config.fadeInDuration;
    }

    if (state.duration > 0) {
        const fadeOutStart = state.duration - config.fadeOutDuration;
        if (elapsed >= fadeOutStart) {
            const fadeOutElapsed = elapsed - fadeOutStart;
            return Math.max(0, 1 - (fadeOutElapsed / config.fadeOutDuration));
        }
    }

    return 1;
}

export function isBubbleExpired(state: BubbleState): boolean {
    if (!state.isVisible || state.duration === 0) return false;
    return Date.now() - state.timestamp >= state.duration;
}

/**
 * Wrap text into lines based on character count
 */
export function wrapBubbleText(text: string, maxChars: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;

        if (testLine.length > maxChars && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }

    if (currentLine) {
        lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [''];
}

/**
 * Calculate bubble dimensions in grid cells
 */
export function calculateBubbleDimensions(
    text: string,
    config: BubbleGridConfig = DEFAULT_BUBBLE_CONFIG
): { widthCells: number; heightCells: number; lines: string[] } {
    const lines = wrapBubbleText(text, config.maxCharsPerLine);
    const maxLineLength = Math.max(...lines.map(l => l.length));

    // Width: text width + padding on each side + border on each side
    const widthCells = maxLineLength + (config.paddingCells * 2) + 2; // +2 for borders

    // Height: lines * 2 (each char is 2 cells tall) + padding top/bottom + borders
    const textHeightCells = lines.length * 2;
    const heightCells = textHeightCells + (config.paddingCells * 2) + 2; // +2 for borders

    return { widthCells, heightCells, lines };
}

export interface BubbleRenderParams {
    ctx: CanvasRenderingContext2D;
    state: BubbleState;
    characterCenterX: number;  // Screen X center of character
    characterTopY: number;     // Screen Y top of character
    cellWidth: number;         // effectiveCharWidth
    cellHeight: number;        // effectiveCharHeight
    config?: BubbleGridConfig;
    renderTextFn: (ctx: CanvasRenderingContext2D, char: string, x: number, y: number) => void;
}

/**
 * Render bubble using grid cells
 */
export function renderBubble(params: BubbleRenderParams): void {
    const { ctx, state, characterCenterX, characterTopY, cellWidth, cellHeight, renderTextFn } = params;
    const config = params.config || DEFAULT_BUBBLE_CONFIG;

    if (!state.isVisible || !state.text) return;

    const opacity = calculateBubbleOpacity(state, config);
    if (opacity <= 0) return;

    ctx.save();
    ctx.globalAlpha = opacity;

    const { widthCells, heightCells, lines } = calculateBubbleDimensions(state.text, config);

    // Calculate bubble position (centered above character)
    const bubbleWidthPx = widthCells * cellWidth;
    const bubbleHeightPx = heightCells * cellHeight;
    const tailHeightPx = config.tailHeightCells * cellHeight;
    const offsetPx = config.offsetYCells * cellHeight;

    const bubbleLeft = characterCenterX - bubbleWidthPx / 2;
    const bubbleTop = characterTopY - bubbleHeightPx - tailHeightPx - offsetPx;

    // Draw bubble body (filled background) - slightly inset for rounded corners
    ctx.fillStyle = config.backgroundColor;
    ctx.fillRect(bubbleLeft + cellWidth, bubbleTop, bubbleWidthPx - 2 * cellWidth, bubbleHeightPx); // Main body
    ctx.fillRect(bubbleLeft, bubbleTop + cellHeight, cellWidth, bubbleHeightPx - 2 * cellHeight); // Left strip
    ctx.fillRect(bubbleLeft + bubbleWidthPx - cellWidth, bubbleTop + cellHeight, cellWidth, bubbleHeightPx - 2 * cellHeight); // Right strip

    // Draw border using individual cells (skip corners for rounded look)
    ctx.fillStyle = config.borderColor;

    // Top border (skip first and last for rounded corners)
    for (let i = 1; i < widthCells - 1; i++) {
        ctx.fillRect(bubbleLeft + i * cellWidth, bubbleTop, cellWidth, cellHeight);
    }

    // Bottom border (skip first and last for rounded corners)
    for (let i = 1; i < widthCells - 1; i++) {
        ctx.fillRect(bubbleLeft + i * cellWidth, bubbleTop + bubbleHeightPx - cellHeight, cellWidth, cellHeight);
    }

    // Left border (skip first and last for rounded corners)
    for (let j = 1; j < heightCells - 1; j++) {
        ctx.fillRect(bubbleLeft, bubbleTop + j * cellHeight, cellWidth, cellHeight);
    }

    // Right border (skip first and last for rounded corners)
    for (let j = 1; j < heightCells - 1; j++) {
        ctx.fillRect(bubbleLeft + bubbleWidthPx - cellWidth, bubbleTop + j * cellHeight, cellWidth, cellHeight);
    }

    // Draw tail (solid filled triangle pointing down)
    const tailCenterX = characterCenterX;
    const tailTopY = bubbleTop + bubbleHeightPx - cellHeight; // Overlap with bottom border by 1 cell

    // Fill tail as solid triangle - all cells filled with background color
    ctx.fillStyle = config.backgroundColor;
    for (let row = 0; row < config.tailHeightCells; row++) {
        const cellsInRow = config.tailWidthCells - row * 2;
        if (cellsInRow <= 0) {
            // Single center cell for the tip
            ctx.fillRect(
                tailCenterX - cellWidth / 2,
                tailTopY + row * cellHeight,
                cellWidth,
                cellHeight
            );
            break;
        }

        const rowStartX = tailCenterX - (cellsInRow * cellWidth) / 2;
        // Fill entire row
        ctx.fillRect(rowStartX, tailTopY + row * cellHeight, cellsInRow * cellWidth, cellHeight);
    }

    // Draw tail border (just the outer edges, not through the middle)
    ctx.fillStyle = config.borderColor;
    for (let row = 0; row < config.tailHeightCells; row++) {
        const cellsInRow = config.tailWidthCells - row * 2;
        if (cellsInRow <= 0) {
            // Tip cell - draw it as border
            ctx.fillRect(
                tailCenterX - cellWidth / 2,
                tailTopY + row * cellHeight,
                cellWidth,
                cellHeight
            );
            break;
        }

        const rowStartX = tailCenterX - (cellsInRow * cellWidth) / 2;

        // Only draw left edge cell
        ctx.fillRect(rowStartX, tailTopY + row * cellHeight, cellWidth, cellHeight);

        // Only draw right edge cell (if more than 1 cell in row)
        if (cellsInRow > 1) {
            ctx.fillRect(
                rowStartX + (cellsInRow - 1) * cellWidth,
                tailTopY + row * cellHeight,
                cellWidth,
                cellHeight
            );
        }
    }

    // Draw text inside bubble
    const textStartX = bubbleLeft + (config.paddingCells + 1) * cellWidth; // +1 for border
    const textStartY = bubbleTop + (config.paddingCells + 1) * cellHeight; // +1 for border

    ctx.fillStyle = config.textColor;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        const lineY = textStartY + lineIdx * 2 * cellHeight; // Each line is 2 cells tall

        for (let charIdx = 0; charIdx < line.length; charIdx++) {
            const char = line[charIdx];
            const charX = textStartX + charIdx * cellWidth;

            if (char && char !== ' ') {
                renderTextFn(ctx, char, charX, lineY);
            }
        }
    }

    ctx.restore();
}
