import { useState, useCallback } from 'react';
import type { PixelatedFrame } from './gif.utils';

// --- GIF Viewport Types ---
export interface GifViewportCell {
    char: string;
    color: string;
    type: 'border' | 'content';
}

export interface GifViewportData {
    [key: string]: GifViewportCell; // key format: "x,y"
}

export interface GifViewportOptions {
    enabled: boolean;
    showBorder: boolean;
    borderColor: string;
    borderChar: string;
    animationSpeed: number; // milliseconds per frame
    centerX: number; // world coordinate to center GIF
    centerY: number; // world coordinate to center GIF
}

// --- GIF Viewport System Hook ---
const useGifViewportSystem = () => {
    const [options, setOptions] = useState<GifViewportOptions>({
        enabled: true,
        showBorder: true,
        borderColor: 'blue',
        borderChar: '█',
        animationSpeed: 100, // 100ms per frame
        centerX: 0, // Center at world origin
        centerY: 0
    });

    // Generate GIF viewport data for current frame and viewport bounds
    const generateGifViewportData = useCallback((
        gifFrames: PixelatedFrame[],
        startWorldX: number,
        startWorldY: number,
        endWorldX: number,
        endWorldY: number
    ): GifViewportData => {
        if (!options.enabled || gifFrames.length === 0) return {};

        const viewportData: GifViewportData = {};
        const frameIndex = Math.floor(Date.now() / options.animationSpeed) % gifFrames.length;
        const frame = gifFrames[frameIndex];
        
        if (!frame) return {};

        // Center the gif around the specified world coordinates
        const gifWorldStartX = Math.floor(options.centerX - frame.width / 2);
        const gifWorldStartY = Math.floor(options.centerY - frame.height / 2);

        // Generate border if enabled
        if (options.showBorder) {
            // Asymmetric borders: 2 cells left/right, 1 cell top/bottom
            const borderStartX = gifWorldStartX - 2;
            const borderStartY = gifWorldStartY - 1;
            const borderWidth = frame.width + 4;
            const borderHeight = frame.height + 2;

            // Only generate border cells that are visible in current viewport
            if (borderStartX <= endWorldX && borderStartX + borderWidth >= startWorldX &&
                borderStartY <= endWorldY && borderStartY + borderHeight >= startWorldY) {
                
                for (let by = 0; by < borderHeight; by++) {
                    for (let bx = 0; bx < borderWidth; bx++) {
                        const worldX = borderStartX + bx;
                        const worldY = borderStartY + by;
                        
                        // Check if this cell is visible and is a border cell
                        const isVisible = worldX >= startWorldX - 1 && worldX <= endWorldX + 1 && 
                                         worldY >= startWorldY - 1 && worldY <= endWorldY + 1;
                        // Border definition: 2 cells left/right, 1 cell top/bottom
                        const isBorder = bx < 2 || bx >= borderWidth - 2 || by < 1 || by >= borderHeight - 1;
                        
                        if (isVisible && isBorder) {
                            const key = `${worldX},${worldY}`;
                            viewportData[key] = {
                                char: options.borderChar,
                                color: options.borderColor,
                                type: 'border'
                            };
                        }
                    }
                }
            }
        }

        // Generate GIF content data
        for (let y = 0; y < frame.height; y++) {
            for (let x = 0; x < frame.width; x++) {
                const worldX = gifWorldStartX + x;
                const worldY = gifWorldStartY + y;
                
                // Check if this pixel is visible in the current world viewport
                const isVisible = worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && 
                                 worldY >= startWorldY - 5 && worldY <= endWorldY + 5;
                
                if (isVisible) {
                    const pixelIndex = y * frame.width + x;
                    const pixel = frame.data[pixelIndex];
                    
                    if (pixel && pixel.char.trim() !== '') {
                        const key = `${worldX},${worldY}`;
                        viewportData[key] = {
                            char: pixel.char,
                            color: pixel.color,
                            type: 'content'
                        };
                    }
                }
            }
        }

        return viewportData;
    }, [options]);

    // Update specific option
    const updateOption = useCallback(<K extends keyof GifViewportOptions>(
        key: K, 
        value: GifViewportOptions[K] | ((prevValue: GifViewportOptions[K]) => GifViewportOptions[K])
    ) => {
        setOptions(prev => {
            const newValue = typeof value === 'function' 
                ? (value as (prevValue: GifViewportOptions[K]) => GifViewportOptions[K])(prev[key])
                : value;
            return { ...prev, [key]: newValue };
        });
    }, []);

    // Toggle enabled state
    const toggleEnabled = useCallback(() => {
        setOptions(prev => ({ ...prev, enabled: !prev.enabled }));
    }, []);

    // Toggle border visibility
    const toggleBorder = useCallback(() => {
        setOptions(prev => ({ ...prev, showBorder: !prev.showBorder }));
    }, []);

    // Set animation speed (with bounds checking)
    const setAnimationSpeed = useCallback((speed: number) => {
        setOptions(prev => ({ 
            ...prev, 
            animationSpeed: Math.max(50, Math.min(1000, speed)) 
        }));
    }, []);

    // Set border color
    const setBorderColor = useCallback((color: string) => {
        setOptions(prev => ({ ...prev, borderColor: color }));
    }, []);

    // Set center position
    const setCenterPosition = useCallback((x: number, y: number) => {
        setOptions(prev => ({ ...prev, centerX: x, centerY: y }));
    }, []);

    return {
        options,
        generateGifViewportData,
        updateOption,
        toggleEnabled,
        toggleBorder,
        setAnimationSpeed,
        setBorderColor,
        setCenterPosition,
        setOptions
    };
};

export { useGifViewportSystem };