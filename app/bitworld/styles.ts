/**
 * styles.ts - Composable visual styling system
 *
 * Generalizes dialogue.display.ts concepts into reusable style primitives
 * that can be applied to text, notes, patterns, paths, images, and more.
 */

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Base render context - common properties needed for any rendering
 */
export interface BaseRenderContext {
    ctx: CanvasRenderingContext2D;
    charWidth: number;
    charHeight: number;
    timestamp?: number; // For animations
}

/**
 * Rectangle bounds in cell coordinates
 */
export interface CellBounds {
    x: number;      // Top-left X (in cells)
    y: number;      // Top-left Y (in cells)
    width: number;  // Width in cells
    height: number; // Height in cells
}

/**
 * Fill style - how to fill an area
 */
export interface FillStyle {
    type: 'solid' | 'none' | 'stripe' | 'dither' | 'dots' | 'cross' | 'diagonal';
    color?: string;           // For solid/pattern fills
    backgroundColor?: string; // For patterns (background color)
    alpha?: number;           // Optional alpha override (0-1)
    density?: number;         // Pattern density (0-1), default 0.5
    angle?: number;           // Pattern rotation in degrees
}

/**
 * Border/Frame style - how to draw outlines
 */
export interface BorderStyle {
    type: 'none' | 'solid' | 'glow';

    // Common properties
    color?: string;
    thickness?: number;       // In cells (for solid borders)

    // Glow-specific properties
    glowRadius?: number;      // Glow radius in cells
    glowIntensity?: number;   // Base intensity (0-1)
    pulse?: boolean;          // Whether to pulse
    flicker?: boolean;        // Whether to add flicker noise
    cardinalExtension?: number; // Extra glow on cardinal directions
}

/**
 * Text glow style - special glow for text characters
 */
export interface TextGlowStyle {
    enabled: boolean;
    color?: string;
    radius?: number;          // Glow radius in cells
    intensity?: number;       // Base intensity (0-1)
    pulse?: boolean;
    flicker?: boolean;
}

/**
 * Fade animation style
 */
export interface FadeStyle {
    enabled: boolean;
    duration?: number;        // Fade duration in ms
    easing?: 'linear' | 'smooth' | 'ease-in' | 'ease-out';
}

/**
 * Complete style definition for rectangular objects (notes, patterns, images)
 */
export interface RectStyle {
    fill: FillStyle;
    border: BorderStyle;
    fade?: FadeStyle;
}

/**
 * Complete style definition for text
 */
export interface TextStyle {
    fill: FillStyle;          // Text color
    background?: FillStyle;   // Optional background behind text
    glow?: TextGlowStyle;     // Optional glow effect
    fade?: FadeStyle;
}

/**
 * Style definition for paths/corridors
 */
export interface PathStyle {
    fill: FillStyle;          // Path fill color
    border?: BorderStyle;     // Optional border
}

// ============================================================================
// PREDEFINED FILLS
// ============================================================================

export const FILLS = {
    none: { type: 'none' } as FillStyle,

    solid: (color: string, alpha: number = 1.0): FillStyle => ({
        type: 'solid',
        color,
        alpha
    }),

    transparent: (color: string, alpha: number): FillStyle => ({
        type: 'solid',
        color,
        alpha
    }),

    // Lo-fi infill patterns
    stripe: (color: string, bgColor: string = 'transparent', density: number = 0.5): FillStyle => ({
        type: 'stripe',
        color,
        backgroundColor: bgColor,
        density
    }),

    dither: (color: string, bgColor: string = 'transparent', density: number = 0.5): FillStyle => ({
        type: 'dither',
        color,
        backgroundColor: bgColor,
        density
    }),

    dots: (color: string, bgColor: string = 'transparent', density: number = 0.5): FillStyle => ({
        type: 'dots',
        color,
        backgroundColor: bgColor,
        density
    }),

    cross: (color: string, bgColor: string = 'transparent', density: number = 0.5): FillStyle => ({
        type: 'cross',
        color,
        backgroundColor: bgColor,
        density
    }),

    diagonal: (color: string, bgColor: string = 'transparent', density: number = 0.5, angle: number = 45): FillStyle => ({
        type: 'diagonal',
        color,
        backgroundColor: bgColor,
        density,
        angle
    }),
};

// ============================================================================
// PREDEFINED BORDERS
// ============================================================================

export const BORDERS = {
    none: { type: 'none' } as BorderStyle,

    solid: (color: string, thickness: number = 1): BorderStyle => ({
        type: 'solid',
        color,
        thickness
    }),

    glow: (color: string, options?: {
        radius?: number;
        intensity?: number;
        pulse?: boolean;
        flicker?: boolean;
        cardinalExtension?: number;
    }): BorderStyle => ({
        type: 'glow',
        color,
        glowRadius: options?.radius ?? 2,
        glowIntensity: options?.intensity ?? 0.6,
        pulse: options?.pulse ?? true,
        flicker: options?.flicker ?? true,
        cardinalExtension: options?.cardinalExtension ?? 1
    }),
};

// ============================================================================
// PREDEFINED TEXT GLOWS
// ============================================================================

export const TEXT_GLOWS = {
    none: { enabled: false } as TextGlowStyle,

    subtle: (color: string): TextGlowStyle => ({
        enabled: true,
        color,
        radius: 1,
        intensity: 0.3,
        pulse: false,
        flicker: false
    }),

    pulsing: (color: string): TextGlowStyle => ({
        enabled: true,
        color,
        radius: 2,
        intensity: 0.6,
        pulse: true,
        flicker: true
    }),
};

// ============================================================================
// PREDEFINED FADES
// ============================================================================

export const FADES = {
    none: { enabled: false } as FadeStyle,

    quick: { enabled: true, duration: 400, easing: 'smooth' } as FadeStyle,
    medium: { enabled: true, duration: 800, easing: 'smooth' } as FadeStyle,
    slow: { enabled: true, duration: 1500, easing: 'smooth' } as FadeStyle,
};

// ============================================================================
// PREDEFINED COMPLETE STYLES
// ============================================================================

/**
 * Rect styles for notes, patterns, images
 */
export const RECT_STYLES = {
    // Default styles (no style applied)
    note: {
        fill: FILLS.none,
        border: BORDERS.solid('#888888', 1)
    } as RectStyle,

    pattern: {
        fill: FILLS.none,
        border: BORDERS.solid('#888888', 1)
    } as RectStyle,

    // Solid border (for /style solid)
    solid: {
        fill: FILLS.none,
        border: BORDERS.solid('#ffffff', 1)
    } as RectStyle,

    // Glow border (for /style glow)
    glow: {
        fill: FILLS.none,
        border: BORDERS.glow('#888888', {
            radius: 2,
            intensity: 0.5,
            pulse: true,
            flicker: true
        })
    } as RectStyle,

    // Enhanced glow (for /style glowing)
    glowing: {
        fill: FILLS.none,
        border: BORDERS.glow('#ffffff', {
            radius: 3,
            intensity: 0.7,
            pulse: true,
            flicker: true,
            cardinalExtension: 2
        })
    } as RectStyle,

    // Lo-fi infill patterns (for /style stripe, /style dither, etc.)
    stripe: {
        fill: FILLS.stripe('#888888', 'transparent', 0.5),
        border: BORDERS.solid('#888888', 1)
    } as RectStyle,

    dither: {
        fill: FILLS.dither('#888888', 'transparent', 0.5),
        border: BORDERS.solid('#888888', 1)
    } as RectStyle,

    dots: {
        fill: FILLS.dots('#888888', 'transparent', 0.3),
        border: BORDERS.solid('#888888', 1)
    } as RectStyle,

    cross: {
        fill: FILLS.cross('#888888', 'transparent', 0.5),
        border: BORDERS.solid('#888888', 1)
    } as RectStyle,

    diagonal: {
        fill: FILLS.diagonal('#888888', 'transparent', 0.5, 45),
        border: BORDERS.solid('#888888', 1)
    } as RectStyle,

    // Image frame
    imageFrame: {
        fill: FILLS.none,
        border: BORDERS.solid('#ffffff', 1)
    } as RectStyle,

    // Subtle iframe
    iframe: {
        fill: FILLS.transparent('#000000', 0.3),
        border: BORDERS.solid('#666666', 1)
    } as RectStyle,
};

/**
 * Text styles
 */
export const TEXT_STYLES = {
    // Plain text (no styling)
    plain: {
        fill: FILLS.solid('#ffffff'),
    } as TextStyle,

    // Subtitle style (from dialogue.display)
    subtitle: {
        fill: FILLS.solid('#ffffff'),
        background: FILLS.transparent('#000000', 0.8),
    } as TextStyle,

    // Host style with glow (from dialogue.display)
    host: {
        fill: FILLS.solid('#ffffff'),
        background: FILLS.solid('#000000'),
        glow: TEXT_GLOWS.pulsing('#000000'),
        fade: FADES.medium,
    } as TextStyle,
};

/**
 * Path/corridor styles
 */
export const PATH_STYLES = {
    // Simple corridor
    corridor: {
        fill: FILLS.solid('#333333')
    } as PathStyle,

    // Glowing path
    glowingPath: {
        fill: FILLS.solid('#444444'),
        border: BORDERS.glow('#666666', { radius: 1, intensity: 0.3 })
    } as PathStyle,
};

// ============================================================================
// RENDERING UTILITIES
// ============================================================================

/**
 * Calculate fade progress based on timestamp and fade style
 */
export function calculateFadeProgress(fade: FadeStyle | undefined, timestamp: number | undefined): number {
    if (!fade?.enabled || !timestamp) return 1.0;

    const elapsed = Date.now() - timestamp;
    let progress = Math.min(1, elapsed / (fade.duration ?? 800));

    // Apply easing
    switch (fade.easing) {
        case 'smooth':
            progress = progress * progress * (3 - 2 * progress); // Smoothstep
            break;
        case 'ease-in':
            progress = progress * progress;
            break;
        case 'ease-out':
            progress = 1 - (1 - progress) * (1 - progress);
            break;
        default:
            // linear - no transformation
    }

    return progress;
}

/**
 * Calculate pulsing glow intensity
 */
export function calculateGlowIntensity(
    baseIntensity: number,
    pulse: boolean,
    flicker: boolean
): number {
    let intensity = baseIntensity;

    if (pulse) {
        const pulseSpeed = 0.001;
        const pulsePhase = (Date.now() * pulseSpeed) % (Math.PI * 2);
        const basePulse = 0.6 + Math.sin(pulsePhase) * 0.2; // 0.4 to 0.8
        intensity *= basePulse;
    }

    if (flicker) {
        const flickerSpeed = 0.05;
        const time = Date.now() * flickerSpeed;
        const flicker1 = Math.sin(time * 2.3) * 0.5 + 0.5;
        const flicker2 = Math.sin(time * 4.7) * 0.5 + 0.5;
        const randomNoise = Math.random();
        const flickerPerturbation = (flicker1 * 0.08 + flicker2 * 0.05 + randomNoise * 0.07);
        intensity += flickerPerturbation;
    }

    return Math.max(0, Math.min(1, intensity));
}

/**
 * Parse hex color to RGB
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const cleaned = hex.replace('#', '');
    return {
        r: parseInt(cleaned.substring(0, 2), 16),
        g: parseInt(cleaned.substring(2, 4), 16),
        b: parseInt(cleaned.substring(4, 6), 16)
    };
}

/**
 * Render fill patterns (solid, stripe, dither, dots, cross, diagonal)
 */
function renderFill(
    context: BaseRenderContext,
    bounds: CellBounds,
    fill: FillStyle,
    fadeProgress: number
): void {
    const { ctx, charWidth, charHeight } = context;

    const screenX = bounds.x * charWidth;
    const screenY = bounds.y * charHeight;
    const screenWidth = bounds.width * charWidth;
    const screenHeight = bounds.height * charHeight;

    const alpha = fill.alpha ?? 1.0;
    ctx.globalAlpha = fadeProgress * alpha;

    // Render background if specified
    if (fill.backgroundColor && fill.backgroundColor !== 'transparent') {
        ctx.fillStyle = fill.backgroundColor;
        ctx.fillRect(screenX, screenY, screenWidth, screenHeight);
    }

    if (!fill.color) {
        ctx.globalAlpha = fadeProgress;
        return;
    }

    switch (fill.type) {
        case 'solid':
            ctx.fillStyle = fill.color;
            ctx.fillRect(screenX, screenY, screenWidth, screenHeight);
            break;

        case 'stripe':
            // Horizontal stripes
            ctx.fillStyle = fill.color;
            const stripeSpacing = 2; // cells between stripes
            for (let row = bounds.y; row < bounds.y + bounds.height; row++) {
                if (row % (stripeSpacing + 1) === 0) {
                    const y = row * charHeight;
                    ctx.fillRect(screenX, y, screenWidth, charHeight);
                }
            }
            break;

        case 'dither':
            // Checkerboard dither pattern
            ctx.fillStyle = fill.color;
            const density = fill.density ?? 0.5;
            for (let row = bounds.y; row < bounds.y + bounds.height; row++) {
                for (let col = bounds.x; col < bounds.x + bounds.width; col++) {
                    // Checkerboard pattern with density control
                    const isEvenRow = row % 2 === 0;
                    const isEvenCol = col % 2 === 0;
                    const shouldFill = (isEvenRow === isEvenCol);

                    if (shouldFill && Math.random() < density) {
                        const x = col * charWidth;
                        const y = row * charHeight;
                        ctx.fillRect(x, y, charWidth, charHeight);
                    }
                }
            }
            break;

        case 'dots':
            // Dot pattern
            ctx.fillStyle = fill.color;
            const dotDensity = fill.density ?? 0.3;
            const dotSpacing = 2; // cells between dots
            for (let row = bounds.y; row < bounds.y + bounds.height; row += dotSpacing) {
                for (let col = bounds.x; col < bounds.x + bounds.width; col += dotSpacing) {
                    if (Math.random() < dotDensity) {
                        const x = col * charWidth + charWidth / 4;
                        const y = row * charHeight + charHeight / 4;
                        const size = Math.min(charWidth, charHeight) / 2;
                        ctx.fillRect(x, y, size, size);
                    }
                }
            }
            break;

        case 'cross':
            // Cross/plus pattern
            ctx.fillStyle = fill.color;
            const crossSpacing = 3; // cells between crosses
            for (let row = bounds.y; row < bounds.y + bounds.height; row += crossSpacing) {
                for (let col = bounds.x; col < bounds.x + bounds.width; col += crossSpacing) {
                    const x = col * charWidth;
                    const y = row * charHeight;
                    // Horizontal line
                    ctx.fillRect(x, y + charHeight / 2 - 1, charWidth, 2);
                    // Vertical line
                    ctx.fillRect(x + charWidth / 2 - 1, y, 2, charHeight);
                }
            }
            break;

        case 'diagonal':
            // Diagonal lines
            ctx.fillStyle = fill.color;
            ctx.save();
            ctx.translate(screenX + screenWidth / 2, screenY + screenHeight / 2);
            ctx.rotate((fill.angle ?? 45) * Math.PI / 180);

            const diagSpacing = 3;
            const maxDim = Math.max(screenWidth, screenHeight) * 2;
            for (let offset = -maxDim; offset < maxDim; offset += diagSpacing * charWidth) {
                ctx.fillRect(offset, -maxDim, 2, maxDim * 2);
            }
            ctx.restore();
            break;
    }

    ctx.globalAlpha = fadeProgress;
}

/**
 * Render a styled rectangle (for notes, patterns, images, etc.)
 */
export function renderStyledRect(
    context: BaseRenderContext,
    bounds: CellBounds,
    style: RectStyle
): void {
    const { ctx, charWidth, charHeight, timestamp } = context;

    // Calculate screen coordinates
    const screenX = bounds.x * charWidth;
    const screenY = bounds.y * charHeight;
    const screenWidth = bounds.width * charWidth;
    const screenHeight = bounds.height * charHeight;

    // Calculate fade
    const fadeProgress = calculateFadeProgress(style.fade, timestamp);

    ctx.save();
    ctx.globalAlpha = fadeProgress;

    // Render glow border first (if applicable)
    if (style.border.type === 'glow' && style.border.color) {
        renderGlowBorder(context, bounds, style.border);
    }

    // Render fill
    if (style.fill.type !== 'none') {
        renderFill(context, bounds, style.fill, fadeProgress);
    }

    // Render solid border (if applicable)
    if (style.border.type === 'solid' && style.border.color && style.border.thickness) {
        const thickness = (style.border.thickness * charWidth);
        ctx.strokeStyle = style.border.color;
        ctx.lineWidth = thickness;
        ctx.strokeRect(
            screenX + thickness / 2,
            screenY + thickness / 2,
            screenWidth - thickness,
            screenHeight - thickness
        );
    }

    ctx.restore();
}

/**
 * Render glow border around a rectangle
 */
function renderGlowBorder(
    context: BaseRenderContext,
    bounds: CellBounds,
    border: BorderStyle
): void {
    const { ctx, charWidth, charHeight } = context;
    const { color, glowRadius = 2, glowIntensity = 0.6, pulse = true, flicker = true, cardinalExtension = 1 } = border;

    if (!color) return;

    // Calculate dynamic intensity
    const intensity = calculateGlowIntensity(glowIntensity, pulse, flicker);

    // Parse color
    const rgb = hexToRgb(color);

    // Glow alphas (2 layers)
    const glowAlphas = [
        0.6 * intensity,
        0.3 * intensity
    ];

    const minCol = bounds.x;
    const maxCol = bounds.x + bounds.width - 1;
    const minRow = bounds.y;
    const maxRow = bounds.y + bounds.height - 1;

    const maxRadius = glowRadius + cardinalExtension;

    // Render glow cells
    for (let row = minRow - maxRadius; row <= maxRow + maxRadius; row++) {
        for (let col = minCol - maxRadius; col <= maxCol + maxRadius; col++) {
            // Skip interior
            if (col >= minCol && col <= maxCol && row >= minRow && row <= maxRow) continue;

            // Calculate distance to bounding box
            const distX = Math.max(0, Math.max(minCol - col, col - maxCol));
            const distY = Math.max(0, Math.max(minRow - row, row - maxRow));
            const distance = Math.max(distX, distY); // Chebyshev distance

            if (distance === 0 || distance > maxRadius) continue;

            // Check if on cardinal direction
            const isCardinal = (distX === 0 || distY === 0);
            const effectiveRadius = isCardinal ? maxRadius : glowRadius;

            if (distance > effectiveRadius) continue;

            // Calculate alpha
            let alpha;
            if (distance <= glowRadius) {
                alpha = glowAlphas[distance - 1];
            } else {
                // Extended glow (only on cardinals)
                alpha = glowAlphas[glowRadius - 1] * 0.3;
            }
            if (!alpha) continue;

            const screenX = col * charWidth;
            const screenY = row * charHeight;

            ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
            ctx.fillRect(screenX, screenY, charWidth, charHeight);
        }
    }
}

// ============================================================================
// STYLE REGISTRY
// ============================================================================

/**
 * Global registry of named styles that can be referenced by objects
 */
export interface StyleRegistry {
    rects: Record<string, RectStyle>;
    texts: Record<string, TextStyle>;
    paths: Record<string, PathStyle>;
}

export const DEFAULT_STYLE_REGISTRY: StyleRegistry = {
    rects: RECT_STYLES,
    texts: TEXT_STYLES,
    paths: PATH_STYLES,
};

/**
 * Get a rect style by name
 */
export function getRectStyle(name: string, registry: StyleRegistry = DEFAULT_STYLE_REGISTRY): RectStyle {
    return registry.rects[name] || RECT_STYLES.note;
}

/**
 * Get a text style by name
 */
export function getTextStyle(name: string, registry: StyleRegistry = DEFAULT_STYLE_REGISTRY): TextStyle {
    return registry.texts[name] || TEXT_STYLES.plain;
}

/**
 * Get a path style by name
 */
export function getPathStyle(name: string, registry: StyleRegistry = DEFAULT_STYLE_REGISTRY): PathStyle {
    return registry.paths[name] || PATH_STYLES.corridor;
}

// ============================================================================
// TEXT RENDERING
// ============================================================================

/**
 * Context for rendering text blocks (dialogue, canvas text, etc.)
 */
export interface TextRenderContext extends BaseRenderContext {
    text: string;
    canvasWidth: number;
    canvasHeight: number;
    fontSize: number;
    fontFamily: string;
    position?: 'center' | 'bottom';  // Vertical positioning
}

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

/**
 * Render styled text block (replaces dialogue.display.ts functionality)
 */
export function renderStyledText(
    context: TextRenderContext,
    style: TextStyle
): void {
    const {
        ctx,
        text,
        canvasWidth,
        canvasHeight,
        charWidth,
        charHeight,
        fontSize,
        fontFamily,
        timestamp,
        position = 'bottom'
    } = context;

    // Constants
    const MAX_WIDTH_CHARS = 60;
    const MARGIN_CHARS = 4;

    // Calculate layout
    const availableWidthChars = Math.floor(canvasWidth / charWidth);
    const availableHeightChars = Math.floor(canvasHeight / charHeight);
    const maxWidthChars = Math.min(MAX_WIDTH_CHARS, availableWidthChars - (2 * MARGIN_CHARS));
    const wrappedLines = wrapText(text, maxWidthChars);

    const maxLineWidth = Math.max(...wrappedLines.map(line => line.length));
    const totalHeight = wrappedLines.length;

    // Calculate positioning
    const startCol = Math.floor((availableWidthChars - maxLineWidth) / 2);
    let startRow: number;

    if (position === 'bottom') {
        const bottomMargin = 3;
        startRow = Math.max(MARGIN_CHARS, availableHeightChars - bottomMargin - totalHeight);
    } else {
        startRow = Math.floor((availableHeightChars - totalHeight) / 2);
    }

    const verticalTextOffset = (charHeight - fontSize) / 2 + (fontSize * 0.1);

    // Calculate fade
    const fadeProgress = calculateFadeProgress(style.fade, timestamp);

    // Calculate text bounding box
    let minCol = Infinity, maxCol = -Infinity;
    let minRow = Infinity, maxRow = -Infinity;

    wrappedLines.forEach((line, lineIndex) => {
        if (line.length > 0) {
            const col = startCol;
            const row = startRow + lineIndex;
            minCol = Math.min(minCol, col);
            maxCol = Math.max(maxCol, col + line.length - 1);
            minRow = Math.min(minRow, row);
            maxRow = Math.max(maxRow, row);
        }
    });

    ctx.save();
    ctx.font = `${fontSize}px "${fontFamily}"`;
    ctx.textBaseline = 'top';

    // Render text glow if enabled
    if (style.glow?.enabled && style.glow.color) {
        renderTextGlow(context, { x: minCol, y: minRow, width: maxCol - minCol + 1, height: maxRow - minRow + 1 }, style.glow, fadeProgress);
    }

    // Render background if present
    if (style.background?.type === 'solid' && style.background.color) {
        ctx.globalAlpha = fadeProgress * (style.background.alpha ?? 1.0);
        ctx.fillStyle = style.background.color;

        // Fill per-line backgrounds (for subtitle style)
        for (let lineIndex = 0; lineIndex < wrappedLines.length; lineIndex++) {
            const line = wrappedLines[lineIndex];
            const screenX = startCol * charWidth;
            const screenY = (startRow + lineIndex) * charHeight;
            const lineWidth = line.length * charWidth;
            ctx.fillRect(screenX, screenY, lineWidth, charHeight);
        }

        ctx.globalAlpha = fadeProgress;
    }

    // Render text
    if (style.fill.type === 'solid' && style.fill.color) {
        ctx.globalAlpha = fadeProgress * (style.fill.alpha ?? 1.0);
        ctx.fillStyle = style.fill.color;

        wrappedLines.forEach((line, lineIndex) => {
            const screenX = startCol * charWidth;
            const screenY = (startRow + lineIndex) * charHeight;
            ctx.fillText(line, screenX, screenY + verticalTextOffset);
        });
    }

    ctx.restore();
}

/**
 * Render glow effect around text bounding box
 */
function renderTextGlow(
    context: TextRenderContext,
    bounds: CellBounds,
    glow: TextGlowStyle,
    fadeProgress: number
): void {
    const { ctx, charWidth, charHeight } = context;
    const { color, radius = 2, intensity = 0.6, pulse = true, flicker = true } = glow;

    if (!color) return;

    // Calculate dynamic intensity
    const dynamicIntensity = calculateGlowIntensity(intensity, pulse, flicker);

    // Parse color
    const rgb = hexToRgb(color);

    // Glow alphas (2 layers)
    const glowAlphas = [
        0.6 * dynamicIntensity * fadeProgress,
        0.3 * dynamicIntensity * fadeProgress
    ];

    const minCol = bounds.x;
    const maxCol = bounds.x + bounds.width - 1;
    const minRow = bounds.y;
    const maxRow = bounds.y + bounds.height - 1;

    const cardinalExtension = 1;
    const maxRadius = radius + cardinalExtension;

    // Render glow cells
    for (let row = minRow - maxRadius; row <= maxRow + maxRadius; row++) {
        for (let col = minCol - maxRadius; col <= maxCol + maxRadius; col++) {
            // Skip interior
            if (col >= minCol && col <= maxCol && row >= minRow && row <= maxRow) continue;

            // Calculate distance to bounding box
            const distX = Math.max(0, Math.max(minCol - col, col - maxCol));
            const distY = Math.max(0, Math.max(minRow - row, row - maxRow));
            const distance = Math.max(distX, distY);

            if (distance === 0 || distance > maxRadius) continue;

            const isCardinal = (distX === 0 || distY === 0);
            const effectiveRadius = isCardinal ? maxRadius : radius;

            if (distance > effectiveRadius) continue;

            let alpha;
            if (distance <= radius) {
                alpha = glowAlphas[distance - 1];
            } else {
                alpha = glowAlphas[radius - 1] * 0.3;
            }
            if (!alpha) continue;

            const screenX = col * charWidth;
            const screenY = row * charHeight;

            ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
            ctx.fillRect(screenX, screenY, charWidth, charHeight);
        }
    }
}
