// components/BitPageCanvas.tsx
import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { WorldEngine, Point } from './world.engine';
import { useMonogramSystem } from './monogram';
import { useCanvasButtons, type CanvasButton } from './canvas.buttons';

// --- Constants ---
const FONT_FAMILY = 'IBM Plex Mono';
const CURSOR_COLOR_PRIMARY = '#0066FF';
const CURSOR_COLOR_SECONDARY = '#FF6B35';

interface BitPageCanvasProps {
    engine: WorldEngine;
    cursorColorAlternate: boolean;
    className?: string;
    showCursor?: boolean;
    monogramEnabled?: boolean;
    topBoundary?: number; // Y coordinate that acts as the top boundary (default: 0)
    buttons?: CanvasButton[]; // Optional canvas buttons
}

export function BitPageCanvas({ 
    engine, 
    cursorColorAlternate, 
    className, 
    showCursor = true, 
    monogramEnabled = false,
    topBoundary = 0,
    buttons = []
}: BitPageCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const devicePixelRatioRef = useRef(1);
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState<{ clientY: number; offsetY: number } | null>(null);
    
    // === Canvas Button System ===
    // Get character dimensions to ensure buttons align with text grid
    const { width: effectiveCharWidth, height: effectiveCharHeight } = engine.getEffectiveCharDims(engine.zoomLevel);
    const { renderButtons, handleButtonClick } = useCanvasButtons(buttons, effectiveCharWidth, effectiveCharHeight);
    
    // === Monogram System ===
    const monogramSystem = useMonogramSystem({
        mode: 'nara',
        speed: 0.5,
        complexity: 1.0,
        colorShift: 0,
        enabled: monogramEnabled,
        geometryType: 'octahedron'
    });
    
    // === Canvas Setup ===
    const handleResize = useCallback(() => {
        const dpr = window.devicePixelRatio || 1;
        devicePixelRatioRef.current = dpr;
        const cssWidth = window.innerWidth;
        const cssHeight = window.innerHeight;
        setCanvasSize({ width: cssWidth, height: cssHeight });

        const canvas = canvasRef.current;
        if (canvas) {
            canvas.width = Math.floor(cssWidth * dpr);
            canvas.height = Math.floor(cssHeight * dpr);
            canvas.style.width = `${cssWidth}px`;
            canvas.style.height = `${cssHeight}px`;
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.imageSmoothingEnabled = false;
        }
    }, []);

    useEffect(() => {
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [handleResize]);

    // === Cursor Boundary Helpers ===
    const getHorizontalBounds = useCallback(() => {
        if (!canvasSize.width || !canvasSize.height) return { minX: 20, maxX: 100 };
        
        const { width: effectiveCharWidth } = engine.getEffectiveCharDims(engine.zoomLevel);
        
        // Calculate text area start position based on actual sidebar width
        const sidebarPixelWidth = Math.floor(canvasSize.width * 0.23);
        const sidebarCharColumns = Math.ceil(sidebarPixelWidth / effectiveCharWidth);
        
        // Text area starts after sidebar with 2-character gap
        const textAreaStartX = sidebarCharColumns + 2;
        const remainingWidth = canvasSize.width - sidebarPixelWidth;
        const textCharColumns = Math.floor(remainingWidth / effectiveCharWidth) - 2; // Account for gap
        
        return { minX: textAreaStartX, maxX: textAreaStartX + textCharColumns - 1 };
    }, [canvasSize, engine]);

    
    const constrainCursorPosition = useCallback((newPos: Point): Point => {
        const { minX, maxX } = getHorizontalBounds();
        const minY = topBoundary;
        
        return {
            x: Math.max(minX, Math.min(maxX, newPos.x)),
            y: Math.max(minY, newPos.y) // Only constrain top, allow infinite scroll down
        };
    }, [getHorizontalBounds, topBoundary]);

    // === Word Wrapping Logic ===
    const findWordBreak = useCallback((line: string, maxLength: number): { breakPoint: number; isWordBreak: boolean } => {
        if (line.length <= maxLength) {
            return { breakPoint: line.length, isWordBreak: false };
        }
        
        // Find the last space before maxLength
        let lastSpace = -1;
        for (let i = maxLength - 1; i >= 0; i--) {
            if (line[i] === ' ') {
                lastSpace = i;
                break;
            }
        }
        
        // If we found a space and it's not too early in the line, break there
        if (lastSpace > maxLength * 0.6) { // Don't break if space is too early (less than 60% of max)
            return { breakPoint: lastSpace + 1, isWordBreak: true }; // +1 to skip the space
        }
        
        // Otherwise, hard break at max length
        return { breakPoint: maxLength, isWordBreak: false };
    }, []);

    const handleAutoWrap = useCallback((currentPos: Point, char: string): { newPos: Point; shouldWrap: boolean } => {
        const { minX, maxX } = getHorizontalBounds();
        const lineWidth = maxX - minX + 1;
        
        // If we're not at the edge, no wrapping needed
        if (currentPos.x < maxX) {
            return { newPos: currentPos, shouldWrap: false };
        }
        
        // We're at the right edge, need to wrap
        // Get the current line of text to check for word breaks
        let currentLine = '';
        for (let x = minX; x <= maxX; x++) {
            const key = `${x},${currentPos.y}`;
            const charData = engine.worldData[key];
            const lineChar = charData ? engine.getCharacter(charData) : '';
            currentLine += lineChar || ' ';
        }
        
        // Add the character we're about to place
        currentLine += char;
        
        // Check if we need word wrapping
        const { breakPoint, isWordBreak } = findWordBreak(currentLine, lineWidth);
        
        if (isWordBreak && breakPoint < currentLine.length - 1) {
            // Word wrap: move part of the current line to next line
            const keepOnCurrentLine = currentLine.substring(0, breakPoint).trim();
            const moveToNextLine = currentLine.substring(breakPoint).trim();
            
            // Clear the part that will be moved
            for (let x = minX + keepOnCurrentLine.length; x <= maxX; x++) {
                const key = `${x},${currentPos.y}`;
                if (engine.worldData[key]) {
                    delete engine.worldData[key];
                }
            }
            
            // Place the wrapped text on the next line
            for (let i = 0; i < moveToNextLine.length; i++) {
                const key = `${minX + i},${currentPos.y + 1}`;
                if (moveToNextLine[i] !== ' ') { // Don't place leading spaces
                    engine.worldData[key] = moveToNextLine[i];
                }
            }
            
            // Position cursor after the wrapped text
            return { 
                newPos: { x: minX + moveToNextLine.length, y: currentPos.y + 1 }, 
                shouldWrap: true 
            };
        } else {
            // Simple line wrap: just move to next line
            return { 
                newPos: { x: minX, y: currentPos.y + 1 }, 
                shouldWrap: true 
            };
        }
    }, [getHorizontalBounds, engine.worldData, findWordBreak]);

    // === Text Reflow System ===
    const reflowText = useCallback(() => {
        const { minX, maxX } = getHorizontalBounds();
        const lineWidth = maxX - minX + 1;
        // Collect text content preserving explicit line structure
        const paragraphs: string[] = [];
        const allKeys = Object.keys(engine.worldData)
            .filter(key => {
                const [xStr, yStr] = key.split(',');
                const x = parseInt(xStr, 10);
                const y = parseInt(yStr, 10);
                return !isNaN(x) && !isNaN(y) && y >= topBoundary;
            })
            .sort((a, b) => {
                const [aX, aY] = a.split(',').map(Number);
                const [bX, bY] = b.split(',').map(Number);
                return aY - bY || aX - bX; // Sort by Y first, then X
            });

        // Group by lines and extract text, preserving empty lines as paragraph breaks
        let currentLine = '';
        let currentY = topBoundary;
        let lastY = topBoundary - 1;
        
        for (const key of allKeys) {
            const [x, y] = key.split(',').map(Number);
            const charData = engine.worldData[key];
            const char = engine.getCharacter(charData);
            
            if (y > currentY) {
                // New line detected
                if (currentLine.trim()) {
                    paragraphs.push(currentLine.trim());
                } else if (currentLine === '' && y > lastY + 1) {
                    // Empty line gap - treat as paragraph break
                    paragraphs.push(''); 
                }
                
                currentLine = '';
                lastY = currentY;
                currentY = y;
                
                // Add empty paragraphs for multi-line gaps
                while (currentY > lastY + 1) {
                    paragraphs.push('');
                    lastY++;
                }
            }
            
            currentLine += char || ' ';
        }
        
        // Don't forget the last line
        if (currentLine.trim()) {
            paragraphs.push(currentLine.trim());
        }

        if (paragraphs.length === 0) return; // Nothing to reflow

        // Clear existing text data
        for (const key of Object.keys(engine.worldData)) {
            const [xStr, yStr] = key.split(',');
            const x = parseInt(xStr, 10);
            const y = parseInt(yStr, 10);
            if (!isNaN(x) && !isNaN(y) && y >= topBoundary) {
                delete engine.worldData[key];
            }
        }

        // Reflow each paragraph separately, preserving paragraph breaks
        let currentLineY = topBoundary;

        for (const paragraph of paragraphs) {
            if (paragraph === '') {
                // Empty paragraph - skip a line
                currentLineY++;
                continue;
            }
            
            // Word wrap this paragraph
            const words = paragraph.split(' ');
            let currentLineText = '';

            for (const word of words) {
                const testLine = currentLineText ? `${currentLineText} ${word}` : word;
                
                if (testLine.length <= lineWidth) {
                    // Word fits on current line
                    currentLineText = testLine;
                } else {
                    // Word doesn't fit, finish current line and start new one
                    if (currentLineText) {
                        // Place current line
                        for (let i = 0; i < currentLineText.length; i++) {
                            const key = `${minX + i},${currentLineY}`;
                            engine.worldData[key] = currentLineText[i];
                        }
                        currentLineY++;
                    }
                    
                    // Start new line with the word
                    currentLineText = word;
                    
                    // Handle very long words that exceed line width
                    while (currentLineText.length > lineWidth) {
                        const part = currentLineText.substring(0, lineWidth);
                        for (let i = 0; i < part.length; i++) {
                            const key = `${minX + i},${currentLineY}`;
                            engine.worldData[key] = part[i];
                        }
                        currentLineText = currentLineText.substring(lineWidth);
                        currentLineY++;
                    }
                }
            }

            // Place the final line of this paragraph
            if (currentLineText) {
                for (let i = 0; i < currentLineText.length; i++) {
                    const key = `${minX + i},${currentLineY}`;
                    engine.worldData[key] = currentLineText[i];
                }
                currentLineY++; // Move to next line after paragraph
            }
        }

        // Hide cursor during reflow - user must click to place cursor again
        engine.cursorPos.x = -1000; // Move cursor off-screen
        engine.cursorPos.y = -1000;
        
    }, [getHorizontalBounds, engine.worldData, engine.cursorPos, engine.getCharacter, topBoundary, engine]);

    // Store previous canvas size to detect actual resizes
    const prevCanvasSizeRef = useRef(canvasSize);

    // Re-enable text reflow only on actual viewport size changes
    useEffect(() => {
        const prevSize = prevCanvasSizeRef.current;
        
        // Only reflow if canvas dimensions actually changed
        if (canvasSize.width > 0 && canvasSize.height > 0 &&
            (prevSize.width !== canvasSize.width || prevSize.height !== canvasSize.height)) {
            
            prevCanvasSizeRef.current = canvasSize;
            
            // Immediate reflow for width changes (affects text wrapping)
            if (prevSize.width !== canvasSize.width) {
                reflowText();
            } else {
                // Small delay only for height changes
                const timeoutId = setTimeout(() => {
                    reflowText();
                }, 50);
                
                return () => clearTimeout(timeoutId);
            }
        }
    }, [canvasSize.width, canvasSize.height, reflowText]);

    // Position cursor at start of text area on initialization
    useEffect(() => {
        if (canvasSize.width > 0 && canvasSize.height > 0) {
            const { minX } = getHorizontalBounds();
            // Only adjust if cursor is at (0,0) - the initial position
            if (engine.cursorPos.x === 0 && engine.cursorPos.y === 0) {
                engine.cursorPos.x = minX;
                engine.cursorPos.y = topBoundary;
            }
        }
    }, [canvasSize, getHorizontalBounds, engine.cursorPos, topBoundary]);

    // === Vertical Panning Logic ===
    const handlePanStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        setIsPanning(true);
        setPanStart({
            clientY,
            offsetY: engine.viewOffset.y
        });
    }, [engine.viewOffset.y]);

    const handlePanMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        if (!isPanning || !panStart) return;
        
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        const deltaY = clientY - panStart.clientY;
        
        // Convert pixel movement to world coordinates (vertical only)
        const { height: effectiveCharHeight } = engine.getEffectiveCharDims(engine.zoomLevel);
        const worldDeltaY = -deltaY / effectiveCharHeight; // Negative for natural scroll direction
        
        // Calculate new Y position, but constrain to top boundary
        const newY = Math.max(topBoundary, panStart.offsetY + worldDeltaY);
        
        // Update view offset (Y only, keep X unchanged)
        engine.setViewOffset({
            x: engine.viewOffset.x,
            y: newY
        });
    }, [isPanning, panStart, engine, topBoundary]);

    const handlePanEnd = useCallback(() => {
        setIsPanning(false);
        setPanStart(null);
    }, []);

    // === Vertical Scroll Wheel Support ===
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        
        const { height: effectiveCharHeight } = engine.getEffectiveCharDims(engine.zoomLevel);
        const scrollSensitivity = 3; // Characters per wheel unit
        const worldDeltaY = (e.deltaY / 100) * scrollSensitivity;
        
        // Calculate new Y position, but constrain to top boundary
        const newY = Math.max(topBoundary, engine.viewOffset.y + worldDeltaY);
        
        // Update view offset (Y only)
        engine.setViewOffset({
            x: engine.viewOffset.x,
            y: newY
        });
    }, [engine, topBoundary]);

    // === Drawing Logic ===
    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        const dpr = devicePixelRatioRef.current;
        const { width: cssWidth, height: cssHeight } = canvasSize;
        if (cssWidth === 0 || cssHeight === 0) return;

        const currentZoom = engine.zoomLevel;
        const { width: effectiveCharWidth, height: effectiveCharHeight, fontSize: effectiveFontSize } = engine.getEffectiveCharDims(currentZoom);
        const currentOffset = engine.viewOffset;
        const verticalTextOffset = 0;

        ctx.save();
        ctx.scale(dpr, dpr);
        
        // Clear canvas with background
        ctx.fillStyle = engine.backgroundColor || '#FFFFFF';
        ctx.fillRect(0, 0, cssWidth, cssHeight);
        
        ctx.imageSmoothingEnabled = false;
        ctx.font = `${effectiveFontSize}px ${FONT_FAMILY}`;
        ctx.textBaseline = 'top';

        // Calculate viewport bounds
        const startWorldX = currentOffset.x;
        const startWorldY = currentOffset.y;
        const endWorldX = startWorldX + (cssWidth / effectiveCharWidth);
        const endWorldY = startWorldY + (cssHeight / effectiveCharHeight);

        // === Render Monogram Patterns ===
        if (monogramEnabled) {
            const monogramPattern = monogramSystem.generateMonogramPattern(
                startWorldX, startWorldY, endWorldX, endWorldY
            );
            
            for (const key in monogramPattern) {
                const [xStr, yStr] = key.split(',');
                const worldX = parseInt(xStr, 10);
                const worldY = parseInt(yStr, 10);
                
                if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                    const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                    if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && 
                        screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                        
                        const cell = monogramPattern[key];
                        
                        // Only render if there's no regular text at this position
                        const textKey = `${worldX},${worldY}`;
                        const charData = engine.worldData[textKey];
                        const char = charData ? engine.getCharacter(charData) : '';
                        if (!char || char.trim() === '') {
                            ctx.fillStyle = cell.color;
                            ctx.fillText(cell.char, screenPos.x, screenPos.y + verticalTextOffset);
                        }
                    }
                }
            }
        }

        // === Render Basic Text ===
        for (const key in engine.worldData) {
            const [xStr, yStr] = key.split(',');
            if (isNaN(parseInt(xStr)) || isNaN(parseInt(yStr))) continue;
            
            const worldX = parseInt(xStr, 10);
            const worldY = parseInt(yStr, 10);
            
            if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                const charData = engine.worldData[key];
                const char = charData ? engine.getCharacter(charData) : '';
                const charStyle = charData ? engine.getCharacterStyle(charData) : undefined;
                const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                
                if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && 
                    screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                    if (char && char.trim() !== '') {
                        // Apply character-specific styling or fall back to engine defaults
                        const textColor = charStyle?.color || engine.currentTextStyle?.color || engine.textColor;
                        const backgroundColor = charStyle?.background || engine.currentTextStyle?.background;
                        
                        // Draw background if specified
                        if (backgroundColor) {
                            ctx.fillStyle = backgroundColor;
                            ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                        }
                        
                        // Draw character
                        ctx.fillStyle = textColor;
                        ctx.fillText(char, screenPos.x, screenPos.y + verticalTextOffset);
                    }
                }
            }
        }

        // === Render Search Highlights ===
        if (engine.isSearchActive && engine.searchData) {
            for (const key in engine.searchData) {
                const [xStr, yStr] = key.split(',');
                if (isNaN(parseInt(xStr)) || isNaN(parseInt(yStr))) continue;
                
                const worldX = parseInt(xStr, 10);
                const worldY = parseInt(yStr, 10);
                
                if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                    const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                    
                    if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && 
                        screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                        
                        // Yellow background for search matches
                        ctx.fillStyle = '#FFFF0080';
                        ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                    }
                }
            }
        }

        // === Render Top Boundary Line ===
        if (currentOffset.y <= topBoundary + 2) { // Show boundary when close to top
            const boundaryScreenY = engine.worldToScreen(0, topBoundary, currentZoom, currentOffset).y;
            if (boundaryScreenY >= -2 && boundaryScreenY <= cssHeight + 2) {
                ctx.strokeStyle = '#CCCCCC';
                ctx.lineWidth = 1;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.moveTo(0, boundaryScreenY);
                ctx.lineTo(cssWidth, boundaryScreenY);
                ctx.stroke();
                ctx.setLineDash([]); // Reset line dash
            }
        }

        // === Render Cursor ===
        if (showCursor) {
            const cursorScreenPos = engine.worldToScreen(engine.cursorPos.x, engine.cursorPos.y, currentZoom, currentOffset);
            const cursorColor = cursorColorAlternate ? CURSOR_COLOR_PRIMARY : CURSOR_COLOR_SECONDARY;
            
            if (cursorScreenPos.x >= -effectiveCharWidth && cursorScreenPos.x < cssWidth + effectiveCharWidth && 
                cursorScreenPos.y >= -effectiveCharHeight && cursorScreenPos.y < cssHeight + effectiveCharHeight) {
                
                // Draw cursor background
                ctx.fillStyle = cursorColor;
                ctx.fillRect(cursorScreenPos.x, cursorScreenPos.y, effectiveCharWidth, effectiveCharHeight);
                
                // Draw cursor character if present
                const cursorKey = `${engine.cursorPos.x},${engine.cursorPos.y}`;
                const cursorCharData = engine.worldData[cursorKey];
                const cursorChar = cursorCharData ? engine.getCharacter(cursorCharData) : '';
                
                if (cursorChar && cursorChar.trim() !== '') {
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillText(cursorChar, cursorScreenPos.x, cursorScreenPos.y + verticalTextOffset);
                }
            }
        }

        // === Render Canvas Buttons ===
        if (buttons.length > 0) {
            renderButtons(ctx, cssWidth, cssHeight);
        }

        ctx.restore();
    }, [engine, canvasSize, monogramSystem, monogramEnabled, showCursor, cursorColorAlternate, buttons, renderButtons]);

    // === Drawing Loop ===
    useEffect(() => {
        let animationFrameId: number;
        const renderLoop = () => {
            draw();
            animationFrameId = requestAnimationFrame(renderLoop);
        };
        renderLoop();
        return () => cancelAnimationFrame(animationFrameId);
    }, [draw]);

    // === Event Handlers ===
    const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (e.button !== 0) return; // Only handle left clicks
        
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        
        // Try canvas button click first
        if (buttons.length > 0 && canvasRef.current && handleButtonClick(clickX, clickY, canvasRef.current)) {
            canvasRef.current?.focus();
            return;
        }
        
        // Allow clicking within existing text to position cursor
        const worldPos = engine.screenToWorld(clickX, clickY, engine.zoomLevel, engine.viewOffset);
        
        // Check if the clicked position has text or is a valid cursor position within text
        const clickKey = `${Math.floor(worldPos.x)},${Math.floor(worldPos.y)}`;
        const hasTextAtClick = engine.worldData[clickKey];
        
        // Find if this position is within the bounds of written text
        let isValidPosition = false;
        
        if (hasTextAtClick) {
            // Clicked directly on a character
            isValidPosition = true;
            engine.cursorPos.x = Math.floor(worldPos.x) + 1; // Position after the character
            engine.cursorPos.y = Math.floor(worldPos.y);
        } else {
            // Check if clicked position is within a line that has text
            const clickY = Math.floor(worldPos.y);
            const clickX = Math.floor(worldPos.x);
            const { minX, maxX } = getHorizontalBounds();
            
            // Find text bounds on this line
            let lineStartX = maxX + 1;
            let lineEndX = minX - 1;
            
            for (let x = minX; x <= maxX; x++) {
                const key = `${x},${clickY}`;
                if (engine.worldData[key]) {
                    lineStartX = Math.min(lineStartX, x);
                    lineEndX = Math.max(lineEndX, x);
                }
            }
            
            // Allow clicking within the text bounds of this line (including after last char)
            if (clickY >= topBoundary && lineStartX <= lineEndX && clickX >= lineStartX && clickX <= lineEndX + 1) {
                isValidPosition = true;
                engine.cursorPos.x = Math.min(Math.max(clickX, minX), lineEndX + 1);
                engine.cursorPos.y = clickY;
            }
        }
        
        // If not a valid text position, just focus without moving cursor
        canvasRef.current?.focus();
    }, [engine, buttons, handleButtonClick]);
    
    const handleCanvasKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
        const currentPos = engine.cursorPos;
        
        // Handle cursor movement - navigate through all created lines (including empty ones)
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            const { minX, maxX } = getHorizontalBounds();
            
            // Find the highest and lowest lines that have been used
            let minUsedLine = topBoundary;
            let maxUsedLine = topBoundary;
            
            for (const key of Object.keys(engine.worldData)) {
                const [x, y] = key.split(',').map(Number);
                if (!isNaN(x) && !isNaN(y) && y >= topBoundary && engine.worldData[key]) {
                    maxUsedLine = Math.max(maxUsedLine, y);
                }
            }
            
            let newPos = { ...currentPos };
            
            switch (e.key) {
                case 'ArrowLeft':
                case 'ArrowRight':
                    // For horizontal movement, use engine's logic but constrain to line bounds
                    if (e.key === 'ArrowLeft') {
                        newPos.x = Math.max(minX, currentPos.x - 1);
                    } else {
                        // Find end of text on current line
                        let lineEndX = minX - 1;
                        for (let x = minX; x <= maxX; x++) {
                            if (engine.worldData[`${x},${currentPos.y}`]) {
                                lineEndX = x;
                            }
                        }
                        // Can move to position after last character
                        newPos.x = Math.min(lineEndX + 1, currentPos.x + 1);
                    }
                    break;
                    
                case 'ArrowUp':
                    // Move to previous line (any line from minUsedLine to maxUsedLine)
                    if (currentPos.y > minUsedLine) {
                        newPos.y = currentPos.y - 1;
                        
                        // Find end of text on target line
                        let lineEndX = minX - 1;
                        for (let x = minX; x <= maxX; x++) {
                            if (engine.worldData[`${x},${newPos.y}`]) {
                                lineEndX = x;
                            }
                        }
                        // Position cursor appropriately (at end of line if beyond text)
                        newPos.x = Math.min(currentPos.x, lineEndX + 1);
                        newPos.x = Math.max(newPos.x, minX); // But at least at line start
                    }
                    break;
                    
                case 'ArrowDown':
                    // Allow moving to any line up to maxUsedLine + 1 (for creating new content)
                    if (currentPos.y <= maxUsedLine) {
                        newPos.y = currentPos.y + 1;
                        
                        // Find end of text on target line
                        let lineEndX = minX - 1;
                        for (let x = minX; x <= maxX; x++) {
                            if (engine.worldData[`${x},${newPos.y}`]) {
                                lineEndX = x;
                            }
                        }
                        // Position cursor appropriately (at end of line if beyond text)
                        newPos.x = Math.min(currentPos.x, lineEndX + 1);
                        newPos.x = Math.max(newPos.x, minX); // But at least at line start
                    }
                    break;
            }
            
            engine.cursorPos.x = newPos.x;
            engine.cursorPos.y = newPos.y;
            
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        
        // Handle backspace with boundary checking and line wrapping support
        if (e.key === 'Backspace') {
            const { minX, maxX } = getHorizontalBounds();
            
            if (currentPos.x > minX) {
                // Check if there's a character to the left of cursor to delete
                const leftKey = `${currentPos.x - 1},${currentPos.y}`;
                const hasLeftChar = engine.worldData[leftKey];
                
                if (hasLeftChar) {
                    // Delete the character to the left
                    delete engine.worldData[leftKey];
                    
                    // Collect all text to the right of the cursor on the same line
                    const textToShiftLeft: Array<{char: string}> = [];
                    for (let x = currentPos.x; x <= maxX; x++) {
                        const key = `${x},${currentPos.y}`;
                        if (engine.worldData[key]) {
                            const char = engine.getCharacter(engine.worldData[key]);
                            textToShiftLeft.push({char});
                            delete engine.worldData[key]; // Remove from current position
                        }
                    }
                    
                    // Shift all collected text one position to the left
                    for (let i = 0; i < textToShiftLeft.length; i++) {
                        const {char} = textToShiftLeft[i];
                        const newX = currentPos.x - 1 + i; // Start from where deleted char was
                        const shiftKey = `${newX},${currentPos.y}`;
                        engine.worldData[shiftKey] = char;
                    }
                }
                // Always move cursor left when not at beginning of line
                engine.cursorPos.x -= 1;
                
                e.preventDefault();
                e.stopPropagation();
                return;
            } else if (currentPos.x === minX && currentPos.y > topBoundary) {
                // At beginning of line, move to end of previous line
                // Find the last character on the previous line
                let lastCharX = minX; // Default to beginning of line
                for (let x = minX; x <= maxX; x++) {
                    const key = `${x},${currentPos.y - 1}`;
                    if (engine.worldData[key]) {
                        lastCharX = x + 1; // Position after the last character
                    }
                }
                
                // If no characters found on previous line, stay at beginning
                if (lastCharX === minX) {
                    // Empty line - position at beginning
                    lastCharX = minX;
                }
                
                engine.cursorPos.x = lastCharX;
                engine.cursorPos.y -= 1;
                
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            
            // At top-left corner, do nothing
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        
        
        // Handle Enter key for line breaks (respects boundaries)
        if (e.key === 'Enter') {
            const { minX } = getHorizontalBounds();
            // Move to the beginning of the next line within bounds
            engine.cursorPos.x = minX;
            engine.cursorPos.y += 1;
            
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        
        // Use engine's handler for text input to ensure proper saving
        const handled = engine.handleKeyDown(e.key, e.ctrlKey, e.metaKey, e.shiftKey);
        
        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, [engine, constrainCursorPosition]);

    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (e.button === 0) { // Left mouse button for panning
            handlePanStart(e);
        }
    }, [handlePanStart]);

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        handlePanMove(e);
    }, [handlePanMove]);

    const handleMouseUp = useCallback(() => {
        handlePanEnd();
    }, [handlePanEnd]);

    // Touch events for mobile support
    const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        handlePanStart(e);
    }, [handlePanStart]);

    const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        handlePanMove(e);
    }, [handlePanMove]);

    const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        handlePanEnd();
    }, [handlePanEnd]);

    return (
        <canvas
            ref={canvasRef}
            className={className}
            onClick={handleCanvasClick}
            onKeyDown={handleCanvasKeyDown}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp} // Stop panning if mouse leaves canvas
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onWheel={handleWheel}
            tabIndex={0}
            style={{ 
                display: 'block', 
                outline: 'none', 
                width: '100%', 
                height: '100%', 
                cursor: isPanning ? 'grabbing' : 'grab',
                touchAction: 'none' // Prevent default touch behaviors
            }}
        />
    );
}