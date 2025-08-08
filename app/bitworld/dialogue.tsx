// components/Dialogue.tsx
import { useState, useEffect, useCallback } from 'react';

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
        const words = text.split(' ');
        const lines: string[] = [];
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
        const startRow = availableHeightChars - DIALOGUE_MARGIN_CHARS - dialogueHeight;
        
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

    return {
        dialogueText,
        setDialogueText,
        renderDialogue
    };
}