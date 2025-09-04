// hooks/useCanvasInputs.tsx
import { useCallback, useState } from 'react';

const FONT_FAMILY = 'IBM Plex Mono';

export interface CanvasInput {
    id: string;
    type: 'text' | 'password' | 'email';
    placeholder: string;
    value: string;
    onValueChange: (value: string) => void;
    position?: 'center' | 'custom';
    width?: number; // Width in characters
    x?: number; // Custom x position (pixels)
    y?: number; // Custom y position (pixels)
}

export interface InputRegion {
    id: string;
    rect: { x: number; y: number; width: number; height: number };
}

interface InputLayout {
    charWidth: number;
    charHeight: number;
    inputs: Array<{
        id: string;
        x: number;
        y: number;
        width: number;
        height: number;
        type: 'text' | 'password' | 'email';
        placeholder: string;
        value: string;
    }>;
}

export function useCanvasInputs(inputs: CanvasInput[], charWidth?: number, charHeight?: number) {
    const [focusedInput, setFocusedInput] = useState<string | null>(null);
    const [cursorPositions, setCursorPositions] = useState<Record<string, number>>({});
    const [passwordVisible, setPasswordVisible] = useState<Record<string, boolean>>({});

    // Calculate input layout based on canvas size and input positions
    const calculateInputLayout = useCallback((canvasWidth: number, canvasHeight: number): InputLayout => {
        const effectiveCharHeight = charHeight || 16;
        const effectiveCharWidth = charWidth || (16 * 0.6);

        const layout: InputLayout = {
            charWidth: effectiveCharWidth,
            charHeight: effectiveCharHeight,
            inputs: []
        };

        inputs.forEach((input, index) => {
            const inputWidth = (input.width || 30) * effectiveCharWidth;
            let x, y;

            if (input.position === 'custom' && input.x !== undefined && input.y !== undefined) {
                x = input.x;
                y = input.y;
            } else {
                // Default center positioning with vertical stacking
                x = (canvasWidth - inputWidth) / 2;
                y = (canvasHeight / 2) - (inputs.length * effectiveCharHeight / 2) + (index * effectiveCharHeight * 1.5);
            }

            layout.inputs.push({
                id: input.id,
                x,
                y,
                width: inputWidth,
                height: effectiveCharHeight,
                type: input.type,
                placeholder: input.placeholder,
                value: input.value
            });
        });

        return layout;
    }, [inputs, charWidth, charHeight]);

    // Render inputs on canvas
    const renderInputs = useCallback((ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number, cursorAlternate: boolean) => {
        const layout = calculateInputLayout(canvasWidth, canvasHeight);
        const verticalTextOffset = (layout.charHeight - 16) / 2 + (16 * 0.1);

        ctx.save();
        ctx.font = `16px "${FONT_FAMILY}"`;
        ctx.textBaseline = 'top';

        // Track clickable regions
        const clickableRegions: InputRegion[] = [];

        layout.inputs.forEach(inputLayout => {
            const input = inputs.find(i => i.id === inputLayout.id);
            if (!input) return;

            const isFocused = focusedInput === input.id;
            const cursorPos = cursorPositions[input.id] || 0;
            
            // Determine display value
            let displayValue = input.value || inputLayout.placeholder;
            let isPlaceholder = !input.value;
            
            if (input.type === 'password' && input.value && !passwordVisible[input.id]) {
                displayValue = '•'.repeat(input.value.length);
                isPlaceholder = false;
            }

            // Draw input background
            ctx.fillStyle = isFocused ? '#E3F2FD' : '#F5F5F5';
            ctx.fillRect(inputLayout.x, inputLayout.y, inputLayout.width, inputLayout.height);

            // Draw input border
            ctx.strokeStyle = isFocused ? '#2196F3' : '#000000';
            ctx.strokeRect(inputLayout.x - 1, inputLayout.y - 1, inputLayout.width + 2, inputLayout.height + 2);

            // Draw input text
            ctx.fillStyle = isPlaceholder ? '#888888' : '#000000';
            const maxDisplayChars = Math.floor((inputLayout.width - 8) / layout.charWidth); // Account for padding
            const displayText = displayValue.substring(0, maxDisplayChars);
            ctx.fillText(displayText, inputLayout.x + 4, inputLayout.y + verticalTextOffset);

            // Draw cursor if focused
            if (isFocused && cursorAlternate) {
                const cursorX = inputLayout.x + 4 + Math.min(cursorPos, displayText.length) * layout.charWidth;
                ctx.fillStyle = '#0066FF';
                ctx.fillRect(cursorX, inputLayout.y + 2, 2, layout.charHeight - 4);
            }

            // Store clickable region
            clickableRegions.push({
                id: input.id,
                rect: { x: inputLayout.x, y: inputLayout.y, width: inputLayout.width, height: inputLayout.height }
            });
        });

        // Store regions for click handling
        (ctx.canvas as any).canvasInputRegions = clickableRegions;

        ctx.restore();
    }, [inputs, calculateInputLayout, focusedInput, cursorPositions, passwordVisible]);

    // Handle input clicks
    const handleInputClick = useCallback((clickX: number, clickY: number, canvas: HTMLCanvasElement): boolean => {
        const regions = (canvas as any).canvasInputRegions as InputRegion[];
        if (!regions) return false;

        const layout = calculateInputLayout(canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);

        for (const region of regions) {
            if (clickX >= region.rect.x && clickX <= region.rect.x + region.rect.width &&
                clickY >= region.rect.y && clickY <= region.rect.y + region.rect.height) {
                
                const input = inputs.find(i => i.id === region.id);
                if (input) {
                    // Calculate cursor position based on click location
                    const relativeX = clickX - region.rect.x - 4; // Account for padding
                    const charIndex = Math.max(0, Math.min(
                        input.value.length,
                        Math.floor(relativeX / layout.charWidth)
                    ));
                    
                    setFocusedInput(input.id);
                    setCursorPositions(prev => ({
                        ...prev,
                        [input.id]: charIndex
                    }));
                    return true;
                }
            }
        }
        return false;
    }, [inputs, calculateInputLayout]);

    // Handle keyboard input for focused input
    const handleInputKeyDown = useCallback((key: string): boolean => {
        if (!focusedInput) return false;

        const input = inputs.find(i => i.id === focusedInput);
        if (!input) return false;

        const currentValue = input.value;
        const currentCursorPos = cursorPositions[focusedInput] || 0;

        if (key === 'Backspace') {
            if (currentCursorPos > 0) {
                const newValue = currentValue.slice(0, currentCursorPos - 1) + currentValue.slice(currentCursorPos);
                input.onValueChange(newValue);
                setCursorPositions(prev => ({
                    ...prev,
                    [focusedInput]: currentCursorPos - 1
                }));
            }
            return true;
        } else if (key === 'Delete') {
            if (currentCursorPos < currentValue.length) {
                const newValue = currentValue.slice(0, currentCursorPos) + currentValue.slice(currentCursorPos + 1);
                input.onValueChange(newValue);
            }
            return true;
        } else if (key === 'ArrowLeft') {
            setCursorPositions(prev => ({
                ...prev,
                [focusedInput]: Math.max(0, currentCursorPos - 1)
            }));
            return true;
        } else if (key === 'ArrowRight') {
            setCursorPositions(prev => ({
                ...prev,
                [focusedInput]: Math.min(currentValue.length, currentCursorPos + 1)
            }));
            return true;
        } else if (key === 'Home') {
            setCursorPositions(prev => ({
                ...prev,
                [focusedInput]: 0
            }));
            return true;
        } else if (key === 'End') {
            setCursorPositions(prev => ({
                ...prev,
                [focusedInput]: currentValue.length
            }));
            return true;
        } else if (key === 'Tab') {
            // Tab navigation through inputs
            const currentIndex = inputs.findIndex(i => i.id === focusedInput);
            const nextIndex = (currentIndex + 1) % inputs.length;
            setFocusedInput(inputs[nextIndex].id);
            return true;
        } else if (key === 'Enter') {
            // Move to next input or trigger submit
            const currentIndex = inputs.findIndex(i => i.id === focusedInput);
            if (currentIndex < inputs.length - 1) {
                setFocusedInput(inputs[currentIndex + 1].id);
            }
            return true;
        } else if (key.length === 1 && !key.match(/[\x00-\x1F\x7F]/)) {
            // Regular character input
            const newValue = currentValue.slice(0, currentCursorPos) + key + currentValue.slice(currentCursorPos);
            input.onValueChange(newValue);
            setCursorPositions(prev => ({
                ...prev,
                [focusedInput]: currentCursorPos + 1
            }));
            return true;
        }

        return false;
    }, [inputs, focusedInput, cursorPositions]);

    // Toggle password visibility
    const togglePasswordVisibility = useCallback((inputId: string) => {
        setPasswordVisible(prev => ({
            ...prev,
            [inputId]: !prev[inputId]
        }));
    }, []);

    // Clear focus
    const clearFocus = useCallback(() => {
        setFocusedInput(null);
    }, []);

    return {
        renderInputs,
        handleInputClick,
        handleInputKeyDown,
        togglePasswordVisibility,
        clearFocus,
        focusedInput,
        passwordVisible
    };
}