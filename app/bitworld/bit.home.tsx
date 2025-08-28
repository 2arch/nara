// components/BitHomeCanvas.tsx
import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { WorldEngine } from './world.engine';
import { useMonogramSystem } from './monogram';

// --- Constants ---
const FONT_FAMILY = 'IBM Plex Mono';
const CURSOR_COLOR_PRIMARY = '#0066FF';
const CURSOR_COLOR_SECONDARY = '#FF6B35';

interface BitHomeCanvasProps {
    engine: WorldEngine;
    cursorColorAlternate: boolean;
    className?: string;
    monogramEnabled?: boolean;
}

export function BitHomeCanvas({ engine, cursorColorAlternate, className, monogramEnabled = false }: BitHomeCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const devicePixelRatioRef = useRef(1);
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
    
    // === Form State (Dialogue-style) ===
    const [focusedInput, setFocusedInput] = useState<'email' | 'password' | null>(null);
    const [pressedButton, setPressedButton] = useState<string | null>(null);
    const [passwordVisible, setPasswordVisible] = useState(false);
    const [formState, setFormState] = useState({
        email: { value: '', cursorPos: 0 },
        password: { value: '', cursorPos: 0 }
    });
    
    // === Monogram System (Hard-coded 'nara' pattern) ===
    const monogramSystem = useMonogramSystem({
        mode: 'nara',
        speed: 0.5,
        complexity: 1.0,
        colorShift: 0,
        enabled: monogramEnabled,
        geometryType: 'octahedron'
    });
    
    // === Form Layout Calculation (Dialogue.tsx pattern) ===
    const calculateFormLayout = useCallback((canvasWidth: number, canvasHeight: number) => {
        const charHeight = 16; // Fixed font size like dialogue
        const charWidth = 16 * 0.6; // Fixed character width ratio
        
        // Responsive form dimensions
        const baseInputWidth = canvasWidth < 768 ? 20 : 30;
        const passwordInputWidth = baseInputWidth - 5;
        const toggleButtonWidth = 4;
        const buttonWidth = canvasWidth < 768 ? 10 : 15;
        const spacing = 2;
        
        // Center everything in viewport (dialogue pattern)
        const formHeight = 5; // email + password + button + spacing
        const centerX = Math.floor(canvasWidth / 2);
        const centerY = Math.floor(canvasHeight / 2);
        
        return {
            charWidth,
            charHeight,
            fields: {
                email: { 
                    x: centerX - (baseInputWidth * charWidth) / 2, 
                    y: centerY - (formHeight * charHeight) / 2, 
                    width: baseInputWidth 
                },
                password: { 
                    x: centerX - ((passwordInputWidth + toggleButtonWidth) * charWidth) / 2, 
                    y: centerY - (formHeight * charHeight) / 2 + spacing * charHeight, 
                    width: passwordInputWidth 
                },
                toggle: {
                    x: centerX - ((passwordInputWidth + toggleButtonWidth) * charWidth) / 2 + passwordInputWidth * charWidth,
                    y: centerY - (formHeight * charHeight) / 2 + spacing * charHeight,
                    width: toggleButtonWidth
                },
                button: { 
                    x: centerX - (buttonWidth * charWidth) / 2, 
                    y: centerY - (formHeight * charHeight) / 2 + (spacing * 2) * charHeight, 
                    width: buttonWidth 
                }
            }
        };
    }, []);
    
    // === Form Rendering Function (Dialogue.tsx pattern) ===
    const renderForm = useCallback((ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) => {
        const layout = calculateFormLayout(canvasWidth, canvasHeight);
        const verticalTextOffset = (layout.charHeight - 16) / 2 + (16 * 0.1);
        
        ctx.save();
        ctx.font = `16px "${FONT_FAMILY}"`;
        ctx.textBaseline = 'top';
        
        // Track clickable regions (dialogue pattern)
        const clickableRegions: Array<{type: 'email' | 'password' | 'toggle' | 'button', rect: {x: number, y: number, width: number, height: number}}> = [];
        
        // === Render Email Field ===
        const emailField = layout.fields.email;
        const emailValue = formState.email.value || 'Enter your email';
        const emailFocused = focusedInput === 'email';
        
        ctx.fillStyle = emailFocused ? '#E3F2FD' : '#F5F5F5';
        ctx.fillRect(emailField.x, emailField.y, emailField.width * layout.charWidth, layout.charHeight);
        
        ctx.strokeStyle = emailFocused ? '#2196F3' : '#000000';
        ctx.lineWidth = emailFocused ? 3 : 2;
        ctx.strokeRect(emailField.x - 1, emailField.y - 1, emailField.width * layout.charWidth + 2, layout.charHeight + 2);
        
        ctx.fillStyle = formState.email.value ? '#000000' : '#888888';
        const emailDisplayText = emailValue.substring(0, emailField.width - 2);
        ctx.fillText(emailDisplayText, emailField.x + 4, emailField.y + verticalTextOffset);
        
        // Email cursor
        if (emailFocused && cursorColorAlternate) {
            const cursorX = emailField.x + 4 + Math.min(formState.email.cursorPos, emailDisplayText.length) * layout.charWidth;
            ctx.fillStyle = '#0066FF';
            ctx.fillRect(cursorX, emailField.y + 2, 2, layout.charHeight - 4);
        }
        
        clickableRegions.push({
            type: 'email',
            rect: { x: emailField.x, y: emailField.y, width: emailField.width * layout.charWidth, height: layout.charHeight }
        });
        
        // === Render Password Field ===
        const passwordField = layout.fields.password;
        const passwordValue = formState.password.value || 'Enter your password';
        const passwordDisplay = (formState.password.value && !passwordVisible) ? '•'.repeat(formState.password.value.length) : passwordValue;
        const passwordFocused = focusedInput === 'password';
        
        ctx.fillStyle = passwordFocused ? '#E3F2FD' : '#F5F5F5';
        ctx.fillRect(passwordField.x, passwordField.y, passwordField.width * layout.charWidth, layout.charHeight);
        
        ctx.strokeStyle = passwordFocused ? '#2196F3' : '#000000';
        ctx.lineWidth = passwordFocused ? 3 : 2;
        ctx.strokeRect(passwordField.x - 1, passwordField.y - 1, passwordField.width * layout.charWidth + 2, layout.charHeight + 2);
        
        ctx.fillStyle = formState.password.value ? '#000000' : '#888888';
        const passwordDisplayText = passwordDisplay.substring(0, passwordField.width - 2);
        ctx.fillText(passwordDisplayText, passwordField.x + 4, passwordField.y + verticalTextOffset);
        
        // Password cursor
        if (passwordFocused && cursorColorAlternate) {
            const cursorX = passwordField.x + 4 + Math.min(formState.password.cursorPos, passwordDisplayText.length) * layout.charWidth;
            ctx.fillStyle = '#0066FF';
            ctx.fillRect(cursorX, passwordField.y + 2, 2, layout.charHeight - 4);
        }
        
        clickableRegions.push({
            type: 'password',
            rect: { x: passwordField.x, y: passwordField.y, width: passwordField.width * layout.charWidth, height: layout.charHeight }
        });
        
        // === Render Toggle Button ===
        const toggleField = layout.fields.toggle;
        const toggleText = passwordVisible ? 'hide' : 'show';
        
        ctx.fillStyle = pressedButton === 'toggle' ? '#1976D2' : '#2196F3';
        ctx.fillRect(toggleField.x, toggleField.y, toggleField.width * layout.charWidth, layout.charHeight);
        
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.strokeRect(toggleField.x - 1, toggleField.y - 1, toggleField.width * layout.charWidth + 2, layout.charHeight + 2);
        
        ctx.fillStyle = '#FFFFFF';
        const toggleTextX = toggleField.x + ((toggleField.width * layout.charWidth) - (toggleText.length * layout.charWidth)) / 2;
        ctx.fillText(toggleText, toggleTextX, toggleField.y + verticalTextOffset);
        
        clickableRegions.push({
            type: 'toggle',
            rect: { x: toggleField.x, y: toggleField.y, width: toggleField.width * layout.charWidth, height: layout.charHeight }
        });
        
        // === Render Signup Button ===
        const buttonField = layout.fields.button;
        const buttonText = 'Sign Up';
        
        ctx.fillStyle = pressedButton === 'signup' ? '#1976D2' : '#2196F3';
        ctx.fillRect(buttonField.x, buttonField.y, buttonField.width * layout.charWidth, layout.charHeight);
        
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.strokeRect(buttonField.x - 1, buttonField.y - 1, buttonField.width * layout.charWidth + 2, layout.charHeight + 2);
        
        ctx.fillStyle = '#FFFFFF';
        const buttonTextX = buttonField.x + ((buttonField.width * layout.charWidth) - (buttonText.length * layout.charWidth)) / 2;
        ctx.fillText(buttonText, buttonTextX, buttonField.y + verticalTextOffset);
        
        clickableRegions.push({
            type: 'button',
            rect: { x: buttonField.x, y: buttonField.y, width: buttonField.width * layout.charWidth, height: layout.charHeight }
        });
        
        // Store regions for click handling (dialogue pattern)
        (ctx.canvas as any).formClickableRegions = clickableRegions;
        
        ctx.restore();
    }, [formState, passwordVisible, cursorColorAlternate, pressedButton, focusedInput, calculateFormLayout]);

    // === Form Event Handlers (Dialogue-style) ===
    const handleFormClick = useCallback((clickX: number, clickY: number): boolean => {
        const canvas = canvasRef.current;
        if (!canvas) return false;
        
        const regions = (canvas as any).formClickableRegions;
        if (!regions) return false;
        
        for (const region of regions) {
            if (clickX >= region.rect.x && clickX <= region.rect.x + region.rect.width &&
                clickY >= region.rect.y && clickY <= region.rect.y + region.rect.height) {
                
                if (region.type === 'email') {
                    const layout = calculateFormLayout(canvasSize.width, canvasSize.height);
                    const relativeX = clickX - region.rect.x - 4;
                    const charIndex = Math.max(0, Math.min(
                        formState.email.value.length,
                        Math.floor(relativeX / layout.charWidth)
                    ));
                    setFocusedInput('email');
                    setFormState(prev => ({
                        ...prev,
                        email: { ...prev.email, cursorPos: charIndex }
                    }));
                    return true;
                } else if (region.type === 'password') {
                    const layout = calculateFormLayout(canvasSize.width, canvasSize.height);
                    const relativeX = clickX - region.rect.x - 4;
                    const charIndex = Math.max(0, Math.min(
                        formState.password.value.length,
                        Math.floor(relativeX / layout.charWidth)
                    ));
                    setFocusedInput('password');
                    setFormState(prev => ({
                        ...prev,
                        password: { ...prev.password, cursorPos: charIndex }
                    }));
                    return true;
                } else if (region.type === 'toggle') {
                    setPressedButton('toggle');
                    setTimeout(() => setPressedButton(null), 150);
                    setPasswordVisible(prev => !prev);
                    return true;
                } else if (region.type === 'button') {
                    setPressedButton('signup');
                    setTimeout(() => setPressedButton(null), 150);
                    console.log('Form submitted:', formState);
                    return true;
                }
            }
        }
        return false;
    }, [formState, canvasSize, calculateFormLayout]);
    
    const handleFormKeyDown = useCallback((key: string): boolean => {
        if (!focusedInput) return false;
        
        const field = focusedInput;
        const currentValue = formState[field].value;
        const currentCursorPos = formState[field].cursorPos;
        
        if (key === 'Backspace') {
            if (currentCursorPos > 0) {
                const newValue = currentValue.slice(0, currentCursorPos - 1) + currentValue.slice(currentCursorPos);
                setFormState(prev => ({
                    ...prev,
                    [field]: { ...prev[field], value: newValue, cursorPos: currentCursorPos - 1 }
                }));
            }
            return true;
        } else if (key === 'Delete') {
            if (currentCursorPos < currentValue.length) {
                const newValue = currentValue.slice(0, currentCursorPos) + currentValue.slice(currentCursorPos + 1);
                setFormState(prev => ({
                    ...prev,
                    [field]: { ...prev[field], value: newValue }
                }));
            }
            return true;
        } else if (key === 'ArrowLeft') {
            setFormState(prev => ({
                ...prev,
                [field]: { ...prev[field], cursorPos: Math.max(0, currentCursorPos - 1) }
            }));
            return true;
        } else if (key === 'ArrowRight') {
            setFormState(prev => ({
                ...prev,
                [field]: { ...prev[field], cursorPos: Math.min(currentValue.length, currentCursorPos + 1) }
            }));
            return true;
        } else if (key === 'Home') {
            setFormState(prev => ({
                ...prev,
                [field]: { ...prev[field], cursorPos: 0 }
            }));
            return true;
        } else if (key === 'End') {
            setFormState(prev => ({
                ...prev,
                [field]: { ...prev[field], cursorPos: currentValue.length }
            }));
            return true;
        } else if (key === 'Tab') {
            setFocusedInput(focusedInput === 'email' ? 'password' : 'email');
            return true;
        } else if (key === 'Enter') {
            if (focusedInput === 'email') {
                setFocusedInput('password');
            } else {
                console.log('Form submitted:', formState);
            }
            return true;
        } else if (key.length === 1 && !key.match(/[\x00-\x1F\x7F]/)) {
            const newValue = currentValue.slice(0, currentCursorPos) + key + currentValue.slice(currentCursorPos);
            setFormState(prev => ({
                ...prev,
                [field]: { ...prev[field], value: newValue, cursorPos: currentCursorPos + 1 }
            }));
            return true;
        }
        
        return false;
    }, [focusedInput, formState]);

    // === Canvas Setup (BitCanvas pattern) ===
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

    // === Drawing Logic (Dialogue style with form overlay) ===
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
        
        // Clear canvas
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
                        if (!char || char.trim() === '') {
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
            const [xStr, yStr] = key.split(',');
            if (isNaN(parseInt(xStr)) || isNaN(parseInt(yStr))) continue;
            
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

        // === Render Form (Dialogue-style overlay) ===
        renderForm(ctx, cssWidth, cssHeight);

        ctx.restore();
    }, [engine, canvasSize, monogramSystem, monogramEnabled, renderForm]);

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
        
        // Try form click first (dialogue pattern)
        if (handleFormClick(clickX, clickY)) {
            canvasRef.current?.focus();
            return;
        }
        
        // Clear focus if clicking elsewhere
        setFocusedInput(null);
        canvasRef.current?.focus();
    }, [handleFormClick]);
    
    const handleCanvasKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
        // Try form key handling first
        if (handleFormKeyDown(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            return;
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