// hooks/useCanvasButtons.tsx
import { useCallback, useState } from 'react';

const FONT_FAMILY = 'IBM Plex Mono';

export interface CanvasButton {
    id: string;
    text: string;
    onClick: () => void;
    position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | 'sidebar-left';
    style?: 'primary' | 'secondary' | 'outlined';
    width?: number; // Optional fixed width in characters
}

export interface ButtonRegion {
    id: string;
    rect: { x: number; y: number; width: number; height: number };
}

interface ButtonLayout {
    charWidth: number;
    charHeight: number;
    buttons: Array<{
        id: string;
        x: number;
        y: number;
        width: number;
        height: number;
        text: string;
        style: 'primary' | 'secondary' | 'outlined';
    }>;
}

export function useCanvasButtons(buttons: CanvasButton[], charWidth?: number, charHeight?: number) {
    const [pressedButton, setPressedButton] = useState<string | null>(null);

    // Calculate button layout based on canvas size and button positions
    const calculateButtonLayout = useCallback((canvasWidth: number, canvasHeight: number): ButtonLayout => {
        const effectiveCharHeight = charHeight || 16; // Use passed height or fallback
        const effectiveCharWidth = charWidth || (16 * 0.6); // Use passed width or fallback
        const margin = 20; // Margin from edges in pixels
        const buttonSpacing = 8; // Spacing between buttons

        const layout: ButtonLayout = {
            charWidth: effectiveCharWidth,
            charHeight: effectiveCharHeight,
            buttons: []
        };

        // Group buttons by position
        const buttonsByPosition: { [key: string]: CanvasButton[] } = {};
        buttons.forEach(button => {
            const position = button.position || 'top-right';
            if (!buttonsByPosition[position]) {
                buttonsByPosition[position] = [];
            }
            buttonsByPosition[position].push(button);
        });

        // Calculate positions for each group
        Object.entries(buttonsByPosition).forEach(([position, positionButtons]) => {
            positionButtons.forEach((button, index) => {
                let buttonWidth = (button.width || button.text.length) * effectiveCharWidth + 16; // Add padding
                let x, y;

                switch (position) {
                    case 'top-left':
                        x = margin;
                        y = margin + index * (effectiveCharHeight + buttonSpacing);
                        break;
                    case 'top-right':
                        x = canvasWidth - margin - buttonWidth;
                        y = margin + index * (effectiveCharHeight + buttonSpacing);
                        break;
                    case 'sidebar-left':
                        // Sidebar spans the left 23% of the canvas
                        const sidebarWidth = Math.floor(canvasWidth * 0.23);
                        x = 0; // No margin from left edge
                        y = index * effectiveCharHeight; // No extra spacing - align with text grid
                        // Override buttonWidth to leave a gap before text area
                        buttonWidth = sidebarWidth - (effectiveCharWidth * 2); // Leave two character columns for gap
                        break;
                    case 'bottom-left':
                        x = margin;
                        y = canvasHeight - margin - (effectiveCharHeight * (positionButtons.length - index));
                        break;
                    case 'bottom-right':
                        x = canvasWidth - margin - buttonWidth;
                        y = canvasHeight - margin - (effectiveCharHeight * (positionButtons.length - index));
                        break;
                    case 'center':
                    default:
                        x = (canvasWidth - buttonWidth) / 2;
                        y = (canvasHeight / 2) + (index - positionButtons.length / 2) * (effectiveCharHeight + buttonSpacing);
                        break;
                }

                layout.buttons.push({
                    id: button.id,
                    x,
                    y,
                    width: buttonWidth,
                    height: effectiveCharHeight,
                    text: button.text,
                    style: button.style || 'primary'
                });
            });
        });

        return layout;
    }, [buttons]);

    // Render buttons on canvas
    const renderButtons = useCallback((ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) => {
        const layout = calculateButtonLayout(canvasWidth, canvasHeight);
        const verticalTextOffset = (layout.charHeight - 16) / 2 + (16 * 0.1);

        ctx.save();
        ctx.font = `16px "${FONT_FAMILY}"`;
        ctx.textBaseline = 'top';

        // Track clickable regions
        const clickableRegions: ButtonRegion[] = [];

        layout.buttons.forEach(button => {
            const isPressed = pressedButton === button.id;
            
            // Button colors based on style and pressed state
            let backgroundColor: string;
            let textColor: string;
            
            switch (button.style) {
                case 'outlined':
                    backgroundColor = isPressed ? '#E0E0E0' : 'transparent';
                    textColor = isPressed ? '#000000' : '#000000';
                    break;
                case 'secondary':
                    backgroundColor = isPressed ? '#666666' : '#888888';
                    textColor = '#FFFFFF';
                    break;
                case 'primary':
                default:
                    backgroundColor = isPressed ? '#333333' : '#000000';
                    textColor = '#FFFFFF';
                    break;
            }

            // Draw button background
            if (button.style === 'outlined') {
                // Draw border for outlined buttons
                ctx.strokeStyle = isPressed ? '#333333' : '#000000';
                ctx.lineWidth = 1;
                ctx.strokeRect(button.x, button.y, button.width, button.height);
                if (backgroundColor !== 'transparent') {
                    ctx.fillStyle = backgroundColor;
                    ctx.fillRect(button.x + 1, button.y + 1, button.width - 2, button.height - 2);
                }
            } else {
                // Solid background for primary/secondary buttons
                ctx.fillStyle = backgroundColor;
                ctx.fillRect(button.x, button.y, button.width, button.height);
            }

            // Draw button text (centered)
            ctx.fillStyle = textColor;
            const textX = button.x + (button.width - (button.text.length * layout.charWidth)) / 2;
            ctx.fillText(button.text, textX, button.y + verticalTextOffset);

            // Store clickable region
            clickableRegions.push({
                id: button.id,
                rect: { x: button.x, y: button.y, width: button.width, height: button.height }
            });
        });

        // Store regions for click handling
        (ctx.canvas as any).canvasButtonRegions = clickableRegions;

        ctx.restore();
    }, [calculateButtonLayout, pressedButton]);

    // Handle button clicks
    const handleButtonClick = useCallback((clickX: number, clickY: number, canvas: HTMLCanvasElement): boolean => {
        const regions = (canvas as any).canvasButtonRegions as ButtonRegion[];
        if (!regions) return false;

        for (const region of regions) {
            if (clickX >= region.rect.x && clickX <= region.rect.x + region.rect.width &&
                clickY >= region.rect.y && clickY <= region.rect.y + region.rect.height) {
                
                // Find the button and execute its onClick
                const button = buttons.find(b => b.id === region.id);
                if (button) {
                    setPressedButton(region.id);
                    setTimeout(() => setPressedButton(null), 150);
                    button.onClick();
                    return true;
                }
            }
        }
        return false;
    }, [buttons]);

    return {
        renderButtons,
        handleButtonClick,
        pressedButton
    };
}