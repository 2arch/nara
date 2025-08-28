// components/BitSignupCanvas.tsx
import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { WorldEngine } from './world.engine';
import { useMonogramSystem } from './monogram';

// --- Constants ---
const FONT_FAMILY = 'IBM Plex Mono';
const CURSOR_COLOR_PRIMARY = '#0066FF';
const CURSOR_COLOR_SECONDARY = '#FF6B35';

interface BitSignupCanvasProps {
    engine: WorldEngine;
    cursorColorAlternate: boolean;
    className?: string;
    monogramEnabled?: boolean;
}

interface WindowSize {
    width: number;
    height: number;
}

export function BitSignupCanvas({ engine, cursorColorAlternate, className, monogramEnabled = false }: BitSignupCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const devicePixelRatioRef = useRef(1);
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
    const [windowSize, setWindowSize] = useState<WindowSize>({ width: 0, height: 0 });
    
    // === Form Interaction State ===
    const [focusedInput, setFocusedInput] = useState<string | null>(null);
    const [pressedButton, setPressedButton] = useState<string | null>(null);
    
    // === Monogram System (Hard-coded 'nara' pattern) ===
    const monogramSystem = useMonogramSystem({
        mode: 'nara',
        speed: 0.5,
        complexity: 1.0,
        colorShift: 0,
        enabled: monogramEnabled,
        geometryType: 'octahedron'
    });
    
    // === Form Event Handlers ===
    const handleInputClick = useCallback((inputKey: string, clickOffset: number) => {
        setFocusedInput(inputKey);
        
        // Update focus state in the input data
        for (const key in engine.worldData) {
            if (key.startsWith('input_')) {
                const inputData = JSON.parse(engine.worldData[key]);
                inputData.focused = (key === inputKey);
                
                if (key === inputKey) {
                    const { value, viewOffset } = inputData;
                    const textLength = (value || '').length;
                    inputData.cursorPos = Math.min(viewOffset + clickOffset, textLength);
                }
                
                engine.worldData[key] = JSON.stringify(inputData);
            }
        }
    }, [engine]);
    
    const handleButtonClick = useCallback((buttonKey: string) => {
        setPressedButton(buttonKey);
        setTimeout(() => setPressedButton(null), 150);
        
        const buttonData = JSON.parse(engine.worldData[buttonKey]);
        const { action } = buttonData;
        
        if (action === 'signup') {
            const formData: { [key: string]: string } = {};
            for (const key in engine.worldData) {
                if (key.startsWith('input_')) {
                    const inputData = JSON.parse(engine.worldData[key]);
                    const { type, value } = inputData;
                    formData[type] = value || '';
                }
            }
            
            console.log('Signup form submitted:', formData);
            // TODO: Handle actual signup logic
        }
    }, [engine]);
    
    const handleFormKeyDown = useCallback((key: string, ctrlKey: boolean, metaKey: boolean, shiftKey: boolean, altKey: boolean) => {
        if (!focusedInput) return false;
        
        const inputData = JSON.parse(engine.worldData[focusedInput]);
        let { value, cursorPos, viewOffset, width } = inputData;
        value = value || '';
        
        let updated = false;
        
        if (key === 'Backspace') {
            if (cursorPos > 0) {
                if (metaKey) {
                    // Cmd + Backspace: Delete from cursor to beginning
                    value = value.slice(cursorPos);
                    cursorPos = 0;
                    updated = true;
                } else if (altKey) {
                    // Option + Backspace: Delete word
                    let wordStart = cursorPos;
                    while (wordStart > 0 && /\s/.test(value[wordStart - 1])) {
                        wordStart--;
                    }
                    while (wordStart > 0 && !/\s/.test(value[wordStart - 1])) {
                        wordStart--;
                    }
                    value = value.slice(0, wordStart) + value.slice(cursorPos);
                    cursorPos = wordStart;
                    updated = true;
                } else {
                    // Regular backspace
                    value = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
                    cursorPos--;
                    updated = true;
                }
            }
        } else if (key === 'Delete') {
            if (cursorPos < value.length) {
                value = value.slice(0, cursorPos) + value.slice(cursorPos + 1);
                updated = true;
            }
        } else if (key === 'ArrowLeft') {
            if (cursorPos > 0) {
                cursorPos--;
                updated = true;
            }
        } else if (key === 'ArrowRight') {
            if (cursorPos < value.length) {
                cursorPos++;
                updated = true;
            }
        } else if (key === 'Tab') {
            // Move to next input
            const inputKeys = Object.keys(engine.worldData).filter(k => k.startsWith('input_')).sort();
            const currentIndex = inputKeys.indexOf(focusedInput);
            const nextIndex = (currentIndex + 1) % inputKeys.length;
            setFocusedInput(inputKeys[nextIndex]);
            
            // Update focus states
            inputKeys.forEach(k => {
                const data = JSON.parse(engine.worldData[k]);
                data.focused = (k === inputKeys[nextIndex]);
                engine.worldData[k] = JSON.stringify(data);
            });
            
            return true;
        } else if (key.length === 1) {
            // Regular character input
            value = value.slice(0, cursorPos) + key + value.slice(cursorPos);
            cursorPos++;
            updated = true;
        }
        
        if (updated) {
            // Adjust view offset if cursor is outside visible area
            if (cursorPos < viewOffset) {
                viewOffset = cursorPos;
            } else if (cursorPos >= viewOffset + width) {
                viewOffset = cursorPos - width + 1;
            }
            
            inputData.value = value;
            inputData.cursorPos = cursorPos;
            inputData.viewOffset = Math.max(0, viewOffset);
            
            engine.worldData[focusedInput] = JSON.stringify(inputData);
        }
        
        return updated;
    }, [focusedInput, engine]);

    // === Canvas Setup ===
    const handleResize = useCallback(() => {
        const dpr = window.devicePixelRatio || 1;
        devicePixelRatioRef.current = dpr;
        const cssWidth = window.innerWidth;
        const cssHeight = window.innerHeight;
        setCanvasSize({ width: cssWidth, height: cssHeight });
        setWindowSize({ width: cssWidth, height: cssHeight });

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
        
        // Clear canvas with transparency to show monogram background
        ctx.clearRect(0, 0, cssWidth, cssHeight);
        
        ctx.imageSmoothingEnabled = false;
        ctx.font = `${effectiveFontSize}px ${FONT_FAMILY}`;
        ctx.textBaseline = 'top';

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
                        if ((!char || char.trim() === '') && !engine.worldData[`input_${textKey}`] && !engine.worldData[`button_${textKey}`]) {
                            ctx.fillStyle = cell.color;
                            ctx.fillText(cell.char, screenPos.x, screenPos.y + verticalTextOffset);
                        }
                    }
                }
            }
        }

        // === Render Basic Text ===
        ctx.fillStyle = engine.textColor;
        for (const key in engine.worldData) {
            if (key.startsWith('input_') || key.startsWith('button_')) continue;
            
            const [xStr, yStr] = key.split(',');
            const worldX = parseInt(xStr, 10);
            const worldY = parseInt(yStr, 10);
            
            if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                const charData = engine.worldData[key];
                const char = charData ? engine.getCharacter(charData) : '';
                const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                
                if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && 
                    screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                    if (char && char.trim() !== '') {
                        ctx.fillStyle = engine.textColor;
                        ctx.fillText(char, screenPos.x, screenPos.y + verticalTextOffset);
                    }
                }
            }
        }

        // === Render Input Fields ===
        for (const key in engine.worldData) {
            if (key.startsWith('input_')) {
                const coords = key.substring('input_'.length);
                const [xStr, yStr] = coords.split(',');
                const worldX = parseInt(xStr, 10);
                const worldY = parseInt(yStr, 10);
                
                if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                    const inputData = JSON.parse(engine.worldData[key]);
                    const { value, placeholder, width, viewOffset, focused, type } = inputData;
                    
                    const displayText = value || placeholder || '';
                    const visibleText = displayText.substring(viewOffset, viewOffset + width).padEnd(width, ' ');
                    
                    // Draw emanating effect around input border
                    const startScreenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                    const endScreenPos = engine.worldToScreen(worldX + width - 1, worldY, currentZoom, currentOffset);
                    if (startScreenPos.x > -effectiveCharWidth * 2 && startScreenPos.x < cssWidth + effectiveCharWidth) {
                        const inputWidth = (endScreenPos.x - startScreenPos.x + effectiveCharWidth);
                        const inputHeight = effectiveCharHeight;
                        
                        // Create responsive emanating gradient effect
                        const isMobile = windowSize.width < 768;
                        const emanationIntensity = isMobile ? 0.6 : 0.8;
                        const emanationSize = isMobile ? 0.2 : 0.3;
                        
                        const gradient = ctx.createRadialGradient(
                            startScreenPos.x + inputWidth/2, startScreenPos.y + inputHeight/2, 0,
                            startScreenPos.x + inputWidth/2, startScreenPos.y + inputHeight/2, Math.max(inputWidth, inputHeight) * emanationIntensity
                        );
                        gradient.addColorStop(0, focused ? 'rgba(33, 150, 243, 0.3)' : 'rgba(0, 0, 0, 0.2)');
                        gradient.addColorStop(0.7, focused ? 'rgba(33, 150, 243, 0.1)' : 'rgba(0, 0, 0, 0.05)');
                        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
                        
                        // Draw emanating background
                        ctx.fillStyle = gradient;
                        ctx.fillRect(
                            startScreenPos.x - inputWidth * emanationSize,
                            startScreenPos.y - inputHeight * emanationSize, 
                            inputWidth * (1 + emanationSize * 2),
                            inputHeight * (1 + emanationSize * 2)
                        );
                        
                        // Corner emanation effects
                        const corners = [
                            { x: startScreenPos.x - 1, y: startScreenPos.y - 1 }, // Top-left
                            { x: startScreenPos.x + inputWidth + 1, y: startScreenPos.y - 1 }, // Top-right
                            { x: startScreenPos.x - 1, y: startScreenPos.y + inputHeight + 1 }, // Bottom-left
                            { x: startScreenPos.x + inputWidth + 1, y: startScreenPos.y + inputHeight + 1 } // Bottom-right
                        ];
                        
                        corners.forEach(corner => {
                            const cornerRadius = isMobile ? effectiveCharWidth * 1.5 : effectiveCharWidth * 2;
                            const cornerGradient = ctx.createRadialGradient(
                                corner.x, corner.y, 0,
                                corner.x, corner.y, cornerRadius
                            );
                            cornerGradient.addColorStop(0, focused ? 'rgba(33, 150, 243, 0.4)' : 'rgba(0, 0, 0, 0.3)');
                            cornerGradient.addColorStop(0.5, focused ? 'rgba(33, 150, 243, 0.1)' : 'rgba(0, 0, 0, 0.1)');
                            cornerGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
                            
                            ctx.fillStyle = cornerGradient;
                            const cornerSize = cornerRadius * 0.75;
                            ctx.fillRect(
                                corner.x - cornerSize,
                                corner.y - cornerSize,
                                cornerSize * 2,
                                cornerSize * 2
                            );
                        });
                        
                        // Main border on top
                        ctx.strokeStyle = focused ? '#2196F3' : '#000000';
                        ctx.lineWidth = focused ? 3 : 2;
                        ctx.strokeRect(startScreenPos.x - 1, startScreenPos.y - 1, 
                                     inputWidth + 2, 
                                     inputHeight + 2);
                    }
                    
                    // Render input cells
                    for (let i = 0; i < width; i++) {
                        const cellX = worldX + i;
                        const screenPos = engine.worldToScreen(cellX, worldY, currentZoom, currentOffset);
                        
                        if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && 
                            screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                            
                            // Background
                            ctx.fillStyle = focused ? '#E3F2FD' : '#F5F5F5';
                            ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                            
                            // Character
                            const char = visibleText[i];
                            if (char && char !== ' ') {
                                const displayChar = type === 'password' && value ? '•' : char;
                                ctx.fillStyle = value ? '#000000' : '#888888';
                                ctx.fillText(displayChar, screenPos.x, screenPos.y + verticalTextOffset);
                            }
                            
                            // Cursor
                            if (focused && focusedInput === key && i === (inputData.cursorPos - viewOffset)) {
                                const cursorColor = cursorColorAlternate ? CURSOR_COLOR_SECONDARY : CURSOR_COLOR_PRIMARY;
                                ctx.fillStyle = cursorColor;
                                ctx.globalAlpha = 0.5;
                                ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                                ctx.globalAlpha = 1.0;
                                
                                if (char && char !== ' ') {
                                    const displayChar = type === 'password' && value ? '•' : char;
                                    ctx.fillStyle = value ? '#000000' : '#888888';
                                    ctx.fillText(displayChar, screenPos.x, screenPos.y + verticalTextOffset);
                                }
                            }
                        }
                    }
                }
            }
        }

        // === Render Buttons ===
        for (const key in engine.worldData) {
            if (key.startsWith('button_')) {
                const coords = key.substring('button_'.length);
                const [xStr, yStr] = coords.split(',');
                const worldX = parseInt(xStr, 10);
                const worldY = parseInt(yStr, 10);
                
                if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                    const buttonData = JSON.parse(engine.worldData[key]);
                    const { text, width, style } = buttonData;
                    
                    // Center text
                    const textLength = text.length;
                    const padding = Math.max(0, Math.floor((width - textLength) / 2));
                    const centeredText = ' '.repeat(padding) + text;
                    const buttonText = centeredText.padEnd(width, ' ').substring(0, width);
                    
                    // Draw outer border
                    const startScreenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                    const endScreenPos = engine.worldToScreen(worldX + width - 1, worldY, currentZoom, currentOffset);
                    if (startScreenPos.x > -effectiveCharWidth * 2 && startScreenPos.x < cssWidth + effectiveCharWidth) {
                        ctx.strokeStyle = '#000000';
                        ctx.lineWidth = 2;
                        ctx.strokeRect(startScreenPos.x - 1, startScreenPos.y - 1, 
                                     (endScreenPos.x - startScreenPos.x + effectiveCharWidth) + 2, 
                                     effectiveCharHeight + 2);
                    }
                    
                    // Render button cells
                    for (let i = 0; i < width; i++) {
                        const cellX = worldX + i;
                        const screenPos = engine.worldToScreen(cellX, worldY, currentZoom, currentOffset);
                        
                        if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && 
                            screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                            
                            // Background
                            const isPressed = pressedButton === key;
                            if (style === 'primary') {
                                ctx.fillStyle = isPressed ? '#1976D2' : '#2196F3';
                            } else {
                                ctx.fillStyle = isPressed ? '#424242' : '#757575';
                            }
                            ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                            
                            // Text
                            const char = buttonText[i];
                            if (char && char !== ' ') {
                                ctx.fillStyle = '#FFFFFF';
                                ctx.fillText(char, screenPos.x, screenPos.y + verticalTextOffset);
                            }
                        }
                    }
                }
            }
        }

        ctx.restore();
    }, [engine, canvasSize, cursorColorAlternate, focusedInput, pressedButton]);

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
        if (e.button !== 0) return;

        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        
        const worldPos = engine.screenToWorld(clickX, clickY, engine.zoomLevel, engine.viewOffset);
        const worldX = Math.floor(worldPos.x);
        const worldY = Math.floor(worldPos.y);
        
        // Check for input clicks
        for (const key in engine.worldData) {
            if (key.startsWith('input_')) {
                const coords = key.substring('input_'.length);
                const [inputXStr, inputYStr] = coords.split(',');
                const inputX = parseInt(inputXStr, 10);
                const inputY = parseInt(inputYStr, 10);
                
                const inputData = JSON.parse(engine.worldData[key]);
                const { width } = inputData;
                
                if (worldY === inputY && worldX >= inputX && worldX < inputX + width) {
                    handleInputClick(key, worldX - inputX);
                    canvasRef.current?.focus();
                    return;
                }
            }
        }
        
        // Check for button clicks
        for (const key in engine.worldData) {
            if (key.startsWith('button_')) {
                const coords = key.substring('button_'.length);
                const [buttonXStr, buttonYStr] = coords.split(',');
                const buttonX = parseInt(buttonXStr, 10);
                const buttonY = parseInt(buttonYStr, 10);
                
                const buttonData = JSON.parse(engine.worldData[key]);
                const { width } = buttonData;
                
                if (worldY === buttonY && worldX >= buttonX && worldX < buttonX + width) {
                    handleButtonClick(key);
                    canvasRef.current?.focus();
                    return;
                }
            }
        }
        
        canvasRef.current?.focus();
    }, [engine, handleInputClick, handleButtonClick]);
    
    const handleCanvasKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
        // Only handle form inputs - no monogram controls
        if (handleFormKeyDown(e.key, e.ctrlKey, e.metaKey, e.shiftKey, e.altKey)) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, [handleFormKeyDown]);

    return (
        <canvas
            ref={canvasRef}
            className={className}
            onClick={handleCanvasClick}
            onKeyDown={handleCanvasKeyDown}
            tabIndex={0}
            style={{ display: 'block', outline: 'none', width: '100%', height: '100%', cursor: 'text' }}
        />
    );
}