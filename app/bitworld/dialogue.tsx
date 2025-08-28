// components/Dialogue.tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { WorldEngine, WorldData } from './world.engine';

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

// Props for header dialogue with click handler
export interface HeaderDialogueProps extends DialogueProps {
    onHeaderClick?: (x: number, y: number) => void;
}

// Debug dialogue constants
const DEBUG_MARGIN_CHARS = 2;

// Nav dialogue constants  
const NAV_MARGIN_CHARS = 2;
const NAV_BACKGROUND_COLOR = 'rgba(0, 0, 0, 0.4)';
const NAV_TEXT_COLOR = '#FFFFFF';

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

    const formatTableOfContents = useCallback((labels: Array<{text: string, x: number, y: number, color: string}>, maxWidth: number, originPosition: {x: number, y: number}, uniqueColors: string[], activeFilters: Set<string>, sortMode: string): string => {
        const availableWidth = maxWidth - NAV_MARGIN_CHARS * 2;
        
        // Line 0: "index" with current position coordinates on the same line (space-between, no dots)
        const currentPosCoordinates = `(${Math.round(originPosition.x)},${Math.round(originPosition.y)})`;
        const indexSpaceWidth = availableWidth - 'index'.length - currentPosCoordinates.length;
        let indexLine = 'index';
        if (indexSpaceWidth > 0) {
            const indexSpaces = ' '.repeat(indexSpaceWidth);
            indexLine = `index${indexSpaces}${currentPosCoordinates}`;
        } else {
            indexLine = `index${currentPosCoordinates}`;
        }
        
        const lines: string[] = [indexLine];
        
        // Line 1: Empty space
        lines.push('');
        
        // Line 2: Color filter buttons and sort button with space-between justification
        const buttonSize = 2; // Each button is 2 chars wide ("█ ")
        const maxButtons = Math.floor((availableWidth - 10) / buttonSize); // Reserve space for sort button
        
        // Build color buttons string
        let colorButtonsStr = '';
        for (let i = 0; i < Math.min(uniqueColors.length, maxButtons); i++) {
            const color = uniqueColors[i];
            const isActive = activeFilters.has(color);
            const buttonChar = isActive ? '█' : '░';
            colorButtonsStr += `${buttonChar} `;
        }
        
        // Build sort button string with full word
        const sortModeNames: {[key: string]: string} = {
            'chronological': 'chrono',
            'closest': 'closest',  
            'farthest': 'farthest'
        };
        const sortButtonText = sortModeNames[sortMode] || sortMode;
        const sortButton = `[${sortButtonText}]`;
        
        // Calculate spacing for space-between layout
        const totalButtonContentWidth = colorButtonsStr.length + sortButton.length;
        const remainingSpace = availableWidth - totalButtonContentWidth;
        const spacingBetween = remainingSpace > 0 ? ' '.repeat(remainingSpace) : '';
        
        const buttonLine = `${colorButtonsStr}${spacingBetween}${sortButton}`;
        
        lines.push(buttonLine);
        
        // Line 3: Empty space
        lines.push('');
        
        // Filter labels based on active color filters
        const filteredLabels = activeFilters.size === 0 ? labels : labels.filter(label => activeFilters.has(label.color));
        
        if (filteredLabels.length === 0) {
            if (activeFilters.size === 0) {
                lines.push('No labels found.');
            } else {
                lines.push('No labels match selected filters.');
            }
            return lines.join('\n');
        }
        
        // Find the longest coordinate string to ensure consistent alignment
        let maxCoordLength = 0;
        for (const label of filteredLabels) {
            const coordinates = `(${label.x},${label.y})`;
            maxCoordLength = Math.max(maxCoordLength, coordinates.length);
        }
        
        for (const label of filteredLabels) {
            const coordinates = `(${label.x},${label.y})`;
            // Pad coordinates to consistent width (right-align them)
            const paddedCoordinates = coordinates.padStart(maxCoordLength, ' ');
            
            const dotsWidth = availableWidth - label.text.length - maxCoordLength;
            
            if (dotsWidth > 0) {
                const dots = '+'.repeat(dotsWidth);
                lines.push(`${label.text}${dots}${paddedCoordinates}`);
            } else {
                // If text is too long, truncate it
                const maxTextWidth = availableWidth - maxCoordLength - 3; // 3 for minimum dots
                if (maxTextWidth > 0) {
                    const truncatedText = label.text.substring(0, maxTextWidth);
                    const dots = '...';
                    lines.push(`${truncatedText}${dots}${paddedCoordinates}`);
                } else {
                    // Fallback if everything is too long
                    lines.push(`${label.text.substring(0, availableWidth)}`);
                }
            }
            lines.push(''); // Add blank line between entries
        }
        
        return lines.join('\n');
    }, []);

    const calculateNavLayout = useCallback((canvasWidth: number, canvasHeight: number, charWidth: number, charHeight: number, navText: string): DialogueLayout => {
        const availableWidthChars = Math.floor(canvasWidth / charWidth);
        const availableHeightChars = Math.floor(canvasHeight / charHeight);
        
        const lines = navText.split('\n');
        const dialogueHeight = lines.length;
        const maxWidthChars = Math.max(...lines.map(l => l.length));

        // Add extra top margin to account for the header (60px = ~4 char rows + 2 for breathing room)
        const headerMargin = 2;
        // Center the nav content horizontally
        const totalAvailableWidth = availableWidthChars;
        const navContentWidth = maxWidthChars;
        const startCol = Math.max(0, Math.floor((totalAvailableWidth - navContentWidth) / 2));
        
        return {
            lines,
            startRow: NAV_MARGIN_CHARS + headerMargin, // Top-aligned with header spacing
            startCol, // Centered
            maxWidthChars,
            dialogueHeight
        };
    }, []);

    const renderNavDialogue = useCallback((props: DialogueProps & { 
        labels: Array<{text: string, x: number, y: number, color: string}>, 
        originPosition: {x: number, y: number}, 
        uniqueColors: string[], 
        activeFilters: Set<string>,
        sortMode: string,
        onCoordinateClick?: (x: number, y: number) => void,
        onColorFilterClick?: (color: string) => void,
        onSortModeClick?: () => void
    }) => {
        const { canvasWidth, canvasHeight, ctx, labels, originPosition, uniqueColors, activeFilters, sortMode, onCoordinateClick, onColorFilterClick, onSortModeClick } = props;
        
        // Use fixed dimensions for nav text
        const charHeight = DIALOGUE_FONT_SIZE;
        const charWidth = DIALOGUE_FONT_SIZE * CHAR_WIDTH_RATIO;
        const verticalTextOffset = (charHeight - DIALOGUE_FONT_SIZE) / 2 + (DIALOGUE_FONT_SIZE * 0.1);

        // Calculate max width for table of contents formatting
        const maxWidthChars = Math.floor(canvasWidth / charWidth) - (NAV_MARGIN_CHARS * 2);
        const navText = formatTableOfContents(labels, maxWidthChars, originPosition, uniqueColors, activeFilters, sortMode);
        const navLayout = calculateNavLayout(canvasWidth, canvasHeight, charWidth, charHeight, navText);
        
        ctx.save();
        ctx.font = `${DIALOGUE_FONT_SIZE}px "${FONT_FAMILY}"`;
        ctx.textBaseline = 'top';

        // Draw full-screen background
        ctx.fillStyle = NAV_BACKGROUND_COLOR;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        
        // Draw text and track coordinate positions
        ctx.fillStyle = NAV_TEXT_COLOR;
        const coordinateRegions: Array<{x: number, y: number, rect: {x: number, y: number, width: number, height: number}, labelX: number, labelY: number}> = [];
        const buttonRegions: Array<{type: 'color' | 'sort', color?: string, rect: {x: number, y: number, width: number, height: number}}> = [];
        
        let labelIndex = 0;
        for (let lineIndex = 0; lineIndex < navLayout.lines.length; lineIndex++) {
            const rowIndex = navLayout.startRow + lineIndex;
            const line = navLayout.lines[lineIndex];
            const screenX = navLayout.startCol * charWidth;
            const screenY = rowIndex * charHeight;
            
            // Special rendering for button line (line index 2)
            if (lineIndex === 2) {
                // Draw the line with colored buttons
                let currentX = screenX;
                let charIndex = 0;
                
                // Draw color filter buttons with their actual colors
                const buttonSize = 2;
                const maxButtons = Math.floor((maxWidthChars - 10) / buttonSize);
                for (let i = 0; i < Math.min(uniqueColors.length, maxButtons); i++) {
                    const color = uniqueColors[i];
                    const isActive = activeFilters.has(color);
                    const buttonChar = isActive ? '█' : '░';
                    
                    // Draw button character in its actual color
                    ctx.fillStyle = color;
                    ctx.fillText(buttonChar, currentX, screenY + verticalTextOffset);
                    currentX += charWidth;
                    
                    // Draw space in white
                    ctx.fillStyle = NAV_TEXT_COLOR;
                    ctx.fillText(' ', currentX, screenY + verticalTextOffset);
                    currentX += charWidth;
                    
                    charIndex += 2;
                }
                
                // Draw the spacing and sort button in white
                ctx.fillStyle = NAV_TEXT_COLOR;
                const remainingText = line.substring(charIndex);
                ctx.fillText(remainingText, currentX, screenY + verticalTextOffset);
            } else {
                // Normal line rendering
                ctx.fillStyle = NAV_TEXT_COLOR;
                ctx.fillText(line, screenX, screenY + verticalTextOffset);
            }
            
            // Track button regions if this is the button line (line index 2)
            if (lineIndex === 2 && (onColorFilterClick || onSortModeClick)) {
                let regionX = screenX;
                
                // Track color filter buttons  
                const buttonSize = 2;
                const maxButtons = Math.floor((maxWidthChars - 10) / buttonSize);
                for (let i = 0; i < Math.min(uniqueColors.length, maxButtons); i++) {
                    const color = uniqueColors[i];
                    buttonRegions.push({
                        type: 'color',
                        color: color,
                        rect: {
                            x: regionX,
                            y: screenY,
                            width: buttonSize * charWidth,
                            height: charHeight
                        }
                    });
                    regionX += buttonSize * charWidth;
                }
                
                // Track sort button - it's now positioned at the end with spacing
                if (onSortModeClick) {
                    // Calculate sort button position based on the formatted line
                    const colorButtonsLength = Math.min(uniqueColors.length, maxButtons) * buttonSize;
                    const sortButtonStart = line.lastIndexOf('[');
                    if (sortButtonStart !== -1) {
                        const sortButtonX = screenX + (sortButtonStart * charWidth);
                        // Calculate width based on actual sort button text
                        const sortButtonText = line.substring(sortButtonStart);
                        buttonRegions.push({
                            type: 'sort',
                            rect: {
                                x: sortButtonX,
                                y: screenY,
                                width: sortButtonText.length * charWidth,
                                height: charHeight
                            }
                        });
                    }
                }
            }
            
            // Check if this line contains coordinates (skip title line with current position, empty lines, and button line)
            if (line.includes('(') && line.includes(')') && labelIndex < labels.length && lineIndex !== 0) {
                const label = labels[labelIndex];
                const coordinates = `(${label.x},${label.y})`;
                const coordStartIndex = line.lastIndexOf('(');
                
                if (coordStartIndex !== -1) {
                    const coordScreenX = screenX + (coordStartIndex * charWidth);
                    const coordWidth = coordinates.length * charWidth;
                    
                    coordinateRegions.push({
                        x: label.x,
                        y: label.y,
                        rect: {
                            x: coordScreenX,
                            y: screenY,
                            width: coordWidth,
                            height: charHeight
                        },
                        labelX: label.x,
                        labelY: label.y
                    });
                }
                labelIndex++;
            }
        }
        
        // Store regions globally for click handling
        if (onCoordinateClick || onColorFilterClick || onSortModeClick) {
            (ctx.canvas as any).navCoordinateRegions = coordinateRegions;
            (ctx.canvas as any).navButtonRegions = buttonRegions;
        }
        
        ctx.restore();
    }, [calculateNavLayout, formatTableOfContents]);

    const handleNavClick = useCallback((canvas: HTMLCanvasElement, clickX: number, clickY: number, onCoordinateClick?: (x: number, y: number) => void, onColorFilterClick?: (color: string) => void, onSortModeClick?: () => void): boolean => {
        // Check button clicks first
        const buttonRegions = (canvas as any).navButtonRegions;
        if (buttonRegions && (onColorFilterClick || onSortModeClick)) {
            for (const button of buttonRegions) {
                if (clickX >= button.rect.x && clickX <= button.rect.x + button.rect.width &&
                    clickY >= button.rect.y && clickY <= button.rect.y + button.rect.height) {
                    if (button.type === 'color' && button.color && onColorFilterClick) {
                        onColorFilterClick(button.color);
                        return true;
                    } else if (button.type === 'sort' && onSortModeClick) {
                        onSortModeClick();
                        return true;
                    }
                }
            }
        }
        
        // Check coordinate clicks
        if (!onCoordinateClick) return false;
        
        const regions = (canvas as any).navCoordinateRegions;
        if (!regions) return false;
        
        for (const region of regions) {
            if (clickX >= region.rect.x && clickX <= region.rect.x + region.rect.width &&
                clickY >= region.rect.y && clickY <= region.rect.y + region.rect.height) {
                onCoordinateClick(region.labelX, region.labelY);
                return true;
            }
        }
        return false;
    }, []);

    const calculateMonogramLayout = useCallback((canvasWidth: number, canvasHeight: number, charWidth: number, charHeight: number, monogramText: string): DialogueLayout => {
        const availableWidthChars = Math.floor(canvasWidth / charWidth);
        const availableHeightChars = Math.floor(canvasHeight / charHeight);
        
        const lines = monogramText.split('\n');
        const dialogueHeight = lines.length;
        const maxWidthChars = Math.max(...lines.map(l => l.length));

        return {
            lines,
            startRow: availableHeightChars - dialogueHeight - 1, // Positioned at the bottom
            startCol: availableWidthChars - maxWidthChars - DEBUG_MARGIN_CHARS, // Right-aligned
            maxWidthChars,
            dialogueHeight
        };
    }, []);

    const renderMonogramControls = useCallback((props: DialogueProps & { monogramText: string }) => {
        const { canvasWidth, canvasHeight, ctx, monogramText } = props;
        
        // Use fixed dimensions for monogram text
        const charHeight = DEBUG_FONT_SIZE;
        const charWidth = DEBUG_FONT_SIZE * CHAR_WIDTH_RATIO;
        const verticalTextOffset = (charHeight - DEBUG_FONT_SIZE) / 2 + (DEBUG_FONT_SIZE * 0.1);

        const monogramLayout = calculateMonogramLayout(canvasWidth, canvasHeight, charWidth, charHeight, monogramText);
        
        ctx.save();
        ctx.font = `${DEBUG_FONT_SIZE}px "${FONT_FAMILY}"`;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'right'; // Set text alignment to right

        // Draw background - need to adjust for right-aligned text
        ctx.fillStyle = DIALOGUE_BACKGROUND_COLOR;
        for (let lineIndex = 0; lineIndex < monogramLayout.lines.length; lineIndex++) {
            const rowIndex = monogramLayout.startRow + lineIndex;
            const line = monogramLayout.lines[lineIndex];
            const screenX = (monogramLayout.startCol + monogramLayout.maxWidthChars) * charWidth; // Right edge
            const screenY = rowIndex * charHeight;
            const lineWidth = line.length * charWidth;
            // Draw background from right edge leftward
            ctx.fillRect(screenX - lineWidth, screenY, lineWidth, charHeight);
        }
        
        // Draw text (right-aligned)
        ctx.fillStyle = DIALOGUE_TEXT_COLOR;
        for (let lineIndex = 0; lineIndex < monogramLayout.lines.length; lineIndex++) {
            const rowIndex = monogramLayout.startRow + lineIndex;
            const line = monogramLayout.lines[lineIndex];
            const screenX = (monogramLayout.startCol + monogramLayout.maxWidthChars) * charWidth; // Right edge
            const screenY = rowIndex * charHeight;
            ctx.fillText(line, screenX, screenY + verticalTextOffset);
        }
        
        ctx.textAlign = 'left'; // Reset text alignment
        ctx.restore();
    }, [calculateMonogramLayout]);

    return {
        renderDialogue,
        renderDebugDialogue,
        renderNavDialogue,
        renderMonogramControls,
        handleNavClick,
    };
}

export function useDebugDialogue(engine: WorldEngine) {
    const [isClient, setIsClient] = useState(false);
    const [debugText, setDebugText] = useState('');
    const [lastChar, setLastChar] = useState<{char: string, x: number, y: number} | null>(null);
    const prevWorldDataRef = useRef<WorldData>({});
    
    useEffect(() => {
        setIsClient(true);
    }, []);
    
    // Track worldData changes
    useEffect(() => {
        if (!isClient || !engine.settings.isDebugVisible) return;
        
        // Find the most recent addition
        for (const key in engine.worldData) {
            if (!prevWorldDataRef.current[key] && !key.startsWith('block_') && !key.startsWith('label_') && !key.startsWith('deepspawn_')) {
                const [xStr, yStr] = key.split(',');
                const x = parseInt(xStr, 10);
                const y = parseInt(yStr, 10);
                const charData = engine.worldData[key];
                const char = engine.getCharacter(charData);
                
                if (!isNaN(x) && !isNaN(y) && char) {
                    setLastChar({ char, x, y });
                    break;
                }
            }
        }
        
        // Update reference
        prevWorldDataRef.current = { ...engine.worldData };
    }, [engine.worldData, engine.settings.isDebugVisible, isClient]);
    
    useEffect(() => {
        if (!isClient || !engine.settings.isDebugVisible) {
            setDebugText('');
            return;
        }
        
        const distance = engine.getCursorDistanceFromCenter ? engine.getCursorDistanceFromCenter() : 0;
        const angleData = engine.getAngleDebugData ? engine.getAngleDebugData() : null;
        
        const text = [
            `Cursor: (${engine.cursorPos.x}, ${engine.cursorPos.y})`,
            lastChar ? `Last char: ${lastChar.char}, ${lastChar.x}, ${lastChar.y}` : 'Last char: --, --, --',
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
    }, [isClient, engine.cursorPos, engine.viewOffset, engine.getCursorDistanceFromCenter, engine.getAngleDebugData, engine.settings.isDebugVisible, lastChar]);
    
    return { debugText };
}