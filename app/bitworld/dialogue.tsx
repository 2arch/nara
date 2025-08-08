// components/Dialogue.tsx
import { useState, useEffect, useCallback } from 'react';
import type { WorldEngine } from './world.engine';

// --- Dialogue Constants ---
const DIALOGUE_MAX_WIDTH_CHARS = 60; // Maximum characters per line
const DIALOGUE_MARGIN_CHARS = 4; // Margin from screen edges in characters
const DIALOGUE_BACKGROUND_COLOR = 'rgba(0, 0, 0, 0.8)'; // Dark background for dialogue
const DIALOGUE_TEXT_COLOR = '#FFFFFF'; // White text for dialogue

export interface DialogueLayout {
    lines: string[];
    startRow: number;
    startCol: number;
    maxWidthChars: number;
    dialogueHeight: number;
}

export interface DialogueProps {
    canvasWidth: number;
    canvasHeight: number;
    effectiveCharWidth: number;
    effectiveCharHeight: number;
    verticalTextOffset: number;
    ctx: CanvasRenderingContext2D;
}

// Debug dialogue constants
const DEBUG_MAX_WIDTH_CHARS = 25; // Smaller width for debug info
const DEBUG_MARGIN_CHARS = 0; // Smaller margin

export function useDialogue() {
    // Dialogue text state  
    const [dialogueText, setDialogueText] = useState('Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.');
    
    // Lorem ipsum variations for cycling
    const loremTexts = [
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
        'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
        'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.',
        'At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident.',
        'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt neque porro quisquam est qui dolorem.'
    ];

    // Update dialogue text every second
    useEffect(() => {
        const interval = setInterval(() => {
            setDialogueText(prev => {
                const currentIndex = loremTexts.indexOf(prev);
                const nextIndex = (currentIndex + 1) % loremTexts.length;
                return loremTexts[nextIndex];
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [loremTexts]);

    // --- Dialogue Text Wrapping Functions ---
    const wrapText = useCallback((text: string, maxWidth: number): string[] => {
        // First split by explicit line breaks
        const inputLines = text.split('\n');
        const lines: string[] = [];

        for (const inputLine of inputLines) {
            if (inputLine.length <= maxWidth) {
                // Line fits, add it as-is
                lines.push(inputLine);
            } else {
                // Line is too long, wrap by words
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
                            // Word is longer than max width, break it
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

    const calculateDialogueLayout = useCallback((canvasWidth: number, canvasHeight: number, effectiveCharWidth: number, effectiveCharHeight: number): DialogueLayout => {
        const availableWidthChars = Math.floor(canvasWidth / effectiveCharWidth);
        const availableHeightChars = Math.floor(canvasHeight / effectiveCharHeight);
        
        // Calculate actual max width considering margins
        const maxWidthChars = Math.min(DIALOGUE_MAX_WIDTH_CHARS, availableWidthChars - (2 * DIALOGUE_MARGIN_CHARS));
        
        // Wrap text to fit width
        const wrappedLines = wrapText(dialogueText, maxWidthChars);
        
        // Calculate positioning (biased to bottom, stretching upward, centered horizontally)
        const dialogueHeight = wrappedLines.length;
        // Use smaller bottom margin (1 char instead of DIALOGUE_MARGIN_CHARS)
        const bottomMargin = 3;
        const startRow = availableHeightChars - bottomMargin - dialogueHeight;
        
        // Center the dialogue block horizontally
        const totalAvailableWidth = availableWidthChars;
        const dialogueBlockWidth = maxWidthChars;
        const startCol = Math.floor((totalAvailableWidth - dialogueBlockWidth) / 2);
        
        return {
            lines: wrappedLines,
            startRow: Math.max(DIALOGUE_MARGIN_CHARS, startRow), // Don't go above top margin
            startCol,
            maxWidthChars,
            dialogueHeight
        };
    }, [dialogueText, wrapText]);

    const renderDialogue = useCallback(({ canvasWidth, canvasHeight, effectiveCharWidth, effectiveCharHeight, verticalTextOffset, ctx }: DialogueProps) => {
        const dialogueLayout = calculateDialogueLayout(canvasWidth, canvasHeight, effectiveCharWidth, effectiveCharHeight);
        
        // Draw background cells for dialogue
        ctx.fillStyle = DIALOGUE_BACKGROUND_COLOR;
        for (let lineIndex = 0; lineIndex < dialogueLayout.lines.length; lineIndex++) {
            const rowIndex = dialogueLayout.startRow + lineIndex;
            const line = dialogueLayout.lines[lineIndex];
            
            // Fill background for the entire width of this line
            for (let charIndex = 0; charIndex < line.length; charIndex++) {
                const colIndex = dialogueLayout.startCol + charIndex;
                const screenX = colIndex * effectiveCharWidth;
                const screenY = rowIndex * effectiveCharHeight;
                
                ctx.fillRect(screenX, screenY, effectiveCharWidth, effectiveCharHeight);
            }
        }
        
        // Draw dialogue text
        ctx.fillStyle = DIALOGUE_TEXT_COLOR;
        for (let lineIndex = 0; lineIndex < dialogueLayout.lines.length; lineIndex++) {
            const rowIndex = dialogueLayout.startRow + lineIndex;
            const line = dialogueLayout.lines[lineIndex];
            
            // Draw each character
            for (let charIndex = 0; charIndex < line.length; charIndex++) {
                const char = line[charIndex];
                const colIndex = dialogueLayout.startCol + charIndex;
                const screenX = colIndex * effectiveCharWidth;
                const screenY = rowIndex * effectiveCharHeight;
                
                ctx.fillText(char, screenX, screenY + verticalTextOffset);
            }
        }
    }, [calculateDialogueLayout]);

    const calculateDebugLayout = useCallback((canvasWidth: number, canvasHeight: number, effectiveCharWidth: number, effectiveCharHeight: number, debugText: string): DialogueLayout => {
        const availableWidthChars = Math.floor(canvasWidth / effectiveCharWidth);
        const availableHeightChars = Math.floor(canvasHeight / effectiveCharHeight);
        
        // Always use single row configuration at very bottom
        const singleLineText = debugText.replace(/\n/g, ' | ');
        const maxAvailableWidth = availableWidthChars - DEBUG_MARGIN_CHARS;
        const singleLineWrapped = wrapText(singleLineText, maxAvailableWidth);
        const line = singleLineWrapped[0] || '';
        
        return {
            lines: [line],
            startRow: availableHeightChars - 1, // Very bottom, slammed against bottom
            startCol: Math.max(0, availableWidthChars - line.length - DEBUG_MARGIN_CHARS), // Right-aligned with margin
            maxWidthChars: line.length,
            dialogueHeight: 1
        };
    }, [wrapText]);

    const renderDebugDialogue = useCallback((props: DialogueProps & { debugText: string }) => {
        const { canvasWidth, canvasHeight, effectiveCharWidth, effectiveCharHeight, verticalTextOffset, ctx, debugText } = props;
        const debugLayout = calculateDebugLayout(canvasWidth, canvasHeight, effectiveCharWidth, effectiveCharHeight, debugText);
        
        // Draw background cells for debug dialogue
        ctx.fillStyle = DIALOGUE_BACKGROUND_COLOR;
        for (let lineIndex = 0; lineIndex < debugLayout.lines.length; lineIndex++) {
            const rowIndex = debugLayout.startRow + lineIndex;
            const line = debugLayout.lines[lineIndex];
            
            // Fill background for the entire width of this line
            for (let charIndex = 0; charIndex < debugLayout.maxWidthChars; charIndex++) {
                const colIndex = debugLayout.startCol + charIndex;
                const screenX = colIndex * effectiveCharWidth;
                const screenY = rowIndex * effectiveCharHeight;
                
                ctx.fillRect(screenX, screenY, effectiveCharWidth, effectiveCharHeight);
            }
        }
        
        // Draw debug text
        ctx.fillStyle = DIALOGUE_TEXT_COLOR;
        for (let lineIndex = 0; lineIndex < debugLayout.lines.length; lineIndex++) {
            const rowIndex = debugLayout.startRow + lineIndex;
            const line = debugLayout.lines[lineIndex];
            
            // Draw each character
            for (let charIndex = 0; charIndex < line.length; charIndex++) {
                const char = line[charIndex];
                const colIndex = debugLayout.startCol + charIndex;
                const screenX = colIndex * effectiveCharWidth;
                const screenY = rowIndex * effectiveCharHeight;
                
                ctx.fillText(char, screenX, screenY + verticalTextOffset);
            }
        }
    }, [calculateDebugLayout]);

    return {
        dialogueText,
        setDialogueText,
        renderDialogue,
        renderDebugDialogue
    };
}

export function useDebugDialogue(engine: WorldEngine) {
    const [isClient, setIsClient] = useState(false);
    const [debugText, setDebugText] = useState('');
    
    useEffect(() => {
        setIsClient(true);
    }, []);
    
    useEffect(() => {
        if (!isClient) return;
        
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
    }, [isClient, engine.cursorPos, engine.viewOffset, engine.getCursorDistanceFromCenter, engine.getAngleDebugData]);
    
    return { debugText };
}