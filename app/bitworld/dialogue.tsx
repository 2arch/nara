// components/Dialogue.tsx
import { useState, useEffect, useCallback } from 'react';
import type { WorldEngine } from './world.engine';

// --- Dialogue Constants ---
const DIALOGUE_FONT_SIZE = 16; // Fixed font size in pixels
const DEBUG_FONT_SIZE = 12; // Fixed font size for debug text
const FONT_FAMILY = 'IBM Plex Mono'; // Ensure this matches the canvas font
const CHAR_WIDTH_RATIO = 0.6; // Monospace character width is roughly 60% of its height (font size)

const DIALOGUE_MAX_WIDTH_CHARS = 60;
const DIALOGUE_MARGIN_CHARS = 4;
const DIALOGUE_BACKGROUND_COLOR = 'rgba(0, 0, 0, 0.8)';
const DIALOGUE_TEXT_COLOR = '#FFFFFF';
const HEADER_TEXT_COLOR = '#FFFFFF';
const HEADER_FONT_SIZE = 14;
const HEADER_MARGIN_CHARS = 2;

export interface DialogueLayout {
    lines: string[];
    startRow: number;
    startCol: number;
    maxWidthChars: number;
    dialogueHeight: number;
}

// Props for rendering, independent of world zoom
export interface DialogueProps {
    canvasWidth: number;
    canvasHeight: number;
    ctx: CanvasRenderingContext2D;
}

// Debug dialogue constants
const DEBUG_MARGIN_CHARS = 2;

export function useDialogue() {
    // --- Dialogue Text Wrapping Functions ---
    const wrapText = useCallback((text: string, maxWidth: number): string[] => {
        const inputLines = text.split('\n');
        const lines: string[] = [];

        for (const inputLine of inputLines) {
            if (inputLine.length <= maxWidth) {
                lines.push(inputLine);
            } else {
                const words = inputLine.split(' ');
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
        }
        
        return lines;
    }, []);

    const calculateDialogueLayout = useCallback((dialogueText: string, canvasWidth: number, canvasHeight: number, charWidth: number, charHeight: number): DialogueLayout => {
        const availableWidthChars = Math.floor(canvasWidth / charWidth);
        const availableHeightChars = Math.floor(canvasHeight / charHeight);
        
        const maxWidthChars = Math.min(DIALOGUE_MAX_WIDTH_CHARS, availableWidthChars - (2 * DIALOGUE_MARGIN_CHARS));
        const wrappedLines = wrapText(dialogueText, maxWidthChars);
        
        const dialogueHeight = wrappedLines.length;
        const bottomMargin = 3;
        const startRow = availableHeightChars - bottomMargin - dialogueHeight;
        
        const totalAvailableWidth = availableWidthChars;
        const dialogueBlockWidth = maxWidthChars;
        const startCol = Math.floor((totalAvailableWidth - dialogueBlockWidth) / 2);
        
        return {
            lines: wrappedLines,
            startRow: Math.max(DIALOGUE_MARGIN_CHARS, startRow),
            startCol,
            maxWidthChars,
            dialogueHeight
        };
    }, [wrapText]);

    const renderDialogue = useCallback((props: DialogueProps & { dialogueText: string }) => {
        const { canvasWidth, canvasHeight, ctx, dialogueText } = props;
        // Use fixed dimensions for dialogue, independent of world zoom
        const charHeight = DIALOGUE_FONT_SIZE;
        const charWidth = DIALOGUE_FONT_SIZE * CHAR_WIDTH_RATIO;
        const verticalTextOffset = (charHeight - DIALOGUE_FONT_SIZE) / 2 + (DIALOGUE_FONT_SIZE * 0.1);

        const dialogueLayout = calculateDialogueLayout(dialogueText, canvasWidth, canvasHeight, charWidth, charHeight);
        
        // Set font properties for rendering
        ctx.save();
        ctx.font = `${DIALOGUE_FONT_SIZE}px "${FONT_FAMILY}"`;
        ctx.textBaseline = 'top';

        // Draw background
        ctx.fillStyle = DIALOGUE_BACKGROUND_COLOR;
        for (let lineIndex = 0; lineIndex < dialogueLayout.lines.length; lineIndex++) {
            const rowIndex = dialogueLayout.startRow + lineIndex;
            const line = dialogueLayout.lines[lineIndex];
            const screenX = dialogueLayout.startCol * charWidth;
            const screenY = rowIndex * charHeight;
            const lineWidth = line.length * charWidth;
            ctx.fillRect(screenX, screenY, lineWidth, charHeight);
        }
        
        // Draw text
        ctx.fillStyle = DIALOGUE_TEXT_COLOR;
        for (let lineIndex = 0; lineIndex < dialogueLayout.lines.length; lineIndex++) {
            const rowIndex = dialogueLayout.startRow + lineIndex;
            const line = dialogueLayout.lines[lineIndex];
            const screenX = dialogueLayout.startCol * charWidth;
            const screenY = rowIndex * charHeight;
            ctx.fillText(line, screenX, screenY + verticalTextOffset);
        }
        ctx.restore();
    }, [calculateDialogueLayout]);

    const calculateDebugLayout = useCallback((canvasWidth: number, canvasHeight: number, charWidth: number, charHeight: number, debugText: string): DialogueLayout => {
        const availableHeightChars = Math.floor(canvasHeight / charHeight);
        
        const lines = debugText.split('\n');
        const dialogueHeight = lines.length;
        const maxWidthChars = Math.max(...lines.map(l => l.length));

        return {
            lines,
            startRow: availableHeightChars - dialogueHeight - 1, // Positioned at the bottom
            startCol: DEBUG_MARGIN_CHARS, // Left-aligned
            maxWidthChars,
            dialogueHeight
        };
    }, []);

    const renderDebugDialogue = useCallback((props: DialogueProps & { debugText: string }) => {
        const { canvasWidth, canvasHeight, ctx, debugText } = props;
        
        // Use fixed dimensions for debug text
        const charHeight = DEBUG_FONT_SIZE;
        const charWidth = DEBUG_FONT_SIZE * CHAR_WIDTH_RATIO;
        const verticalTextOffset = (charHeight - DEBUG_FONT_SIZE) / 2 + (DEBUG_FONT_SIZE * 0.1);

        const debugLayout = calculateDebugLayout(canvasWidth, canvasHeight, charWidth, charHeight, debugText);
        
        ctx.save();
        ctx.font = `${DEBUG_FONT_SIZE}px "${FONT_FAMILY}"`;
        ctx.textBaseline = 'top';

        // Draw background
        ctx.fillStyle = DIALOGUE_BACKGROUND_COLOR;
        for (let lineIndex = 0; lineIndex < debugLayout.lines.length; lineIndex++) {
            const rowIndex = debugLayout.startRow + lineIndex;
            const line = debugLayout.lines[lineIndex];
            const screenX = debugLayout.startCol * charWidth;
            const screenY = rowIndex * charHeight;
            const lineWidth = line.length * charWidth;
            ctx.fillRect(screenX, screenY, lineWidth, charHeight);
        }
        
        // Draw text
        ctx.fillStyle = DIALOGUE_TEXT_COLOR;
        for (let lineIndex = 0; lineIndex < debugLayout.lines.length; lineIndex++) {
            const rowIndex = debugLayout.startRow + lineIndex;
            const line = debugLayout.lines[lineIndex];
            const screenX = debugLayout.startCol * charWidth;
            const screenY = rowIndex * charHeight;
            ctx.fillText(line, screenX, screenY + verticalTextOffset);
        }
        ctx.restore();
    }, [calculateDebugLayout]);

    const renderHeaderDialogue = useCallback((props: DialogueProps) => {
        const { canvasWidth, canvasHeight, ctx } = props;
        const charHeight = HEADER_FONT_SIZE;
        const charWidth = HEADER_FONT_SIZE * CHAR_WIDTH_RATIO;
        const topY = HEADER_MARGIN_CHARS * charHeight / 2;

        ctx.save();
        ctx.font = `${HEADER_FONT_SIZE}px "${FONT_FAMILY}"`;
        ctx.textBaseline = 'top';

        // Draw "nara" on the left
        const leftText = "nara web services";
        const leftX = HEADER_MARGIN_CHARS * charWidth;
        ctx.fillStyle = DIALOGUE_BACKGROUND_COLOR;
        ctx.fillRect(leftX, topY, leftText.length * charWidth, charHeight);
        ctx.fillStyle = HEADER_TEXT_COLOR;
        ctx.fillText(leftText, leftX, topY);

        // Draw "v 1.0.0" on the right
        const rightText = "v 1.0.0";
        const rightX = canvasWidth - ((rightText.length + HEADER_MARGIN_CHARS) * charWidth);
        ctx.fillStyle = DIALOGUE_BACKGROUND_COLOR;
        ctx.fillRect(rightX, topY, rightText.length * charWidth, charHeight);
        ctx.fillStyle = HEADER_TEXT_COLOR;
        ctx.fillText(rightText, rightX, topY);

        ctx.restore();
    }, []);

    return {
        renderDialogue,
        renderDebugDialogue,
        renderHeaderDialogue,
    };
}

export function useDebugDialogue(engine: WorldEngine) {
    const [isClient, setIsClient] = useState(false);
    const [debugText, setDebugText] = useState('');
    
    useEffect(() => {
        setIsClient(true);
    }, []);
    
    useEffect(() => {
        if (!isClient || !engine.settings.isDebugVisible) {
            setDebugText('');
            return;
        }
        
        const distance = engine.getCursorDistanceFromCenter ? engine.getCursorDistanceFromCenter() : 0;
        const angleData = engine.getAngleDebugData ? engine.getAngleDebugData() : null;
        
        const text = [
            `Cursor: (${engine.cursorPos.x}, ${engine.cursorPos.y})`,
            `Distance: ${distance.toFixed(2)}`,
            `Points: ${angleData ? 2 : 0}`,
            angleData 
                ? `Angle: ${angleData.degrees.toFixed(1)}°`
                : 'Angle: --°',
            angleData 
                ? `Current: (${angleData.firstPoint.x.toFixed(1)}, ${angleData.firstPoint.y.toFixed(1)})`
                : 'Current: (---, ---)',
            angleData 
                ? `Previous: (${angleData.lastPoint.x.toFixed(1)}, ${angleData.lastPoint.y.toFixed(1)})`
                : 'Previous: (---, ---)'
        ].join('\n');
        
        setDebugText(text);
    }, [isClient, engine.cursorPos, engine.viewOffset, engine.getCursorDistanceFromCenter, engine.getAngleDebugData, engine.settings.isDebugVisible]);
    
    return { debugText };
}