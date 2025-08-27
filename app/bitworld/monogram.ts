import { useState, useCallback, useRef, useEffect } from 'react';
import type { Point } from './world.engine';

// --- Monogram Pattern Types ---
export type MonogramMode = 'plasma' | 'perlin' | 'nara';

export interface MonogramCell {
    char: string;
    color: string;
    intensity: number; // 0-1 for effects
}

export interface MonogramPattern {
    [key: string]: MonogramCell; // key format: "x,y"
}

export interface MonogramOptions {
    mode: MonogramMode;
    speed: number; // Animation speed multiplier (0.1 - 3.0)
    complexity: number; // Pattern complexity (0.1 - 2.0)
    colorShift: number; // Color phase shift (0 - 6.28)
    enabled: boolean;
}

// --- Mathematical Pattern Generators ---
const useMonogramSystem = (
    initialOptions?: MonogramOptions,
    onOptionsChange?: (options: MonogramOptions) => void
) => {
    const [options, setOptions] = useState<MonogramOptions>(
        initialOptions || {
            mode: 'plasma',
            speed: 0.5, // Slower default speed
            complexity: 1.0,
            colorShift: 0,
            enabled: false
        }
    );

    const timeRef = useRef<number>(0);
    const animationFrameRef = useRef<number>(0);
    
    // Update time for animations
    useEffect(() => {
        const updateTime = () => {
            timeRef.current += 0.02 * options.speed;
            animationFrameRef.current = requestAnimationFrame(updateTime);
        };
        
        if (options.enabled) {
            animationFrameRef.current = requestAnimationFrame(updateTime);
        }

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [options.enabled, options.speed]);

    // Sync with external options changes only on mount
    useEffect(() => {
        if (initialOptions) {
            setOptions(initialOptions);
        }
    }, []); // Empty dependency array - only run on mount

    // Call onChange when options change, but avoid calling it on initial mount
    const isInitialMount = useRef(true);
    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }
        if (onOptionsChange) {
            onOptionsChange(options);
        }
    }, [options]); // Remove onOptionsChange from deps to avoid infinite loop

    // Character sets for different intensities
    const getCharForIntensity = useCallback((intensity: number, mode: MonogramMode): string => {
        const chars = {
            plasma: [' ', '░', '▒', '▓', '█'],
            perlin: [' ', '-', '─', '═', '╫'],
            nara: ['░', '▒', '▓', '█'], // Back to varied blocks for texture
        };
        
        const charSet = chars[mode] || chars.plasma;
        const index = Math.floor(intensity * (charSet.length - 1));
        return charSet[Math.min(index, charSet.length - 1)];
    }, []);

    // Get color from palette based on value
    const getColorFromPalette = useCallback((value: number, mode: MonogramMode): string => {
        if (mode === 'nara') {
            // Pure black for NARA mode
            return 'black';
        }
        // Monochromatic scheme for other modes
        const lightness = 50 + (value % 1) * 50;
        return `hsl(0, 0%, ${lightness}%)`;
    }, []);

    // Plasma effect
    const calculatePlasma = useCallback((x: number, y: number, time: number): number => {
        const complexity = options.complexity;
        const plasma1 = Math.sin(x * 0.1 * complexity + time);
        const plasma2 = Math.sin(y * 0.1 * complexity + time * 1.3);
        const plasma3 = Math.sin((x + y) * 0.07 * complexity + time * 0.7);
        const plasma4 = Math.sin(Math.sqrt(x * x + y * y) * 0.08 * complexity + time * 1.1);
        
        return (plasma1 + plasma2 + plasma3 + plasma4) / 4;
    }, [options.complexity]);


    // Simplified Perlin noise implementation
    const perlinNoise = useCallback((x: number, y: number): number => {
        // Gradient vectors for 2D
        const grad = (hash: number, x: number, y: number) => {
            const h = hash & 3;
            const u = h < 2 ? x : y;
            const v = h < 2 ? y : x;
            return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
        };
        
        // Fade function
        const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
        const lerp = (t: number, a: number, b: number) => a + t * (b - a);
        
        // Integer and fractional parts
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const fx = x - Math.floor(x);
        const fy = y - Math.floor(y);
        
        // Simplified permutation table (using sin for pseudo-randomness)
        const perm = (i: number) => Math.floor(Math.abs(Math.sin(i * 12.9898) * 43758.5453) * 256) & 255;
        
        const u = fade(fx);
        const v = fade(fy);
        
        const a = perm(X) + Y;
        const b = perm(X + 1) + Y;
        
        const x1 = lerp(u, grad(perm(a), fx, fy), grad(perm(b), fx - 1, fy));
        const x2 = lerp(u, grad(perm(a + 1), fx, fy - 1), grad(perm(b + 1), fx - 1, fy - 1));
        
        return lerp(v, x1, x2);
    }, []);

    // Pure Perlin noise flow (no text, just beautiful flowing patterns)
    const calculatePerlin = useCallback((x: number, y: number, time: number): number => {
        const complexity = options.complexity;
        const scale = 1.2 * complexity;
        
        // Normalized coordinates
        const nx = x * 0.02;
        const ny = y * 0.02;
        
        // Create flowing distortion using layered noise
        const flow1 = perlinNoise(nx * scale + time * 2, ny * scale + time);
        const flow2 = perlinNoise(nx * scale * 2 - time, ny * scale * 2);
        
        // Combine flows for complex movement
        const dx = nx + flow1 * 0.3 + flow2 * 0.1;
        const dy = ny + flow2 * 0.3 - flow1 * 0.1;
        
        // Sample noise at distorted position for intensity
        const intensity1 = perlinNoise(dx * 5, dy * 5);
        const intensity2 = perlinNoise(dx * 8 + time, dy * 8);
        
        // Combine intensities and normalize
        const rawIntensity = (intensity1 + intensity2 + 2) / 4;
        
        // Add some temporal variation for more organic movement
        const temporalWave = Math.sin(time * 0.5 + nx * 3 + ny * 2) * 0.1 + 0.9;
        
        return Math.max(0, Math.min(1, rawIntensity * temporalWave));
    }, [options.complexity, perlinNoise]);

    // Cached text bitmap to avoid repeated Canvas API calls
    const textBitmapCache = useRef<{ [key: string]: ImageData }>({});
    
    // Text-to-bitmap renderer using Canvas API (with caching)
    const textToBitmap = useCallback((text: string, fontSize: number = 48): ImageData | null => {
        if (typeof window === 'undefined') return null;
        
        const cacheKey = `${text}-${fontSize}`;
        if (textBitmapCache.current[cacheKey]) {
            return textBitmapCache.current[cacheKey];
        }
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        
        // Set up canvas for text measurement
        ctx.font = `${fontSize}px "Courier New", Courier, monospace`;
        ctx.textBaseline = 'top';
        const textMetrics = ctx.measureText(text);
        const textWidth = Math.ceil(textMetrics.width);
        const textHeight = fontSize * 1.2; // Account for descenders
        
        // Resize canvas to fit text with some padding
        canvas.width = textWidth + 4;
        canvas.height = textHeight + 4;
        
        // Clear and redraw with correct settings
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `${fontSize}px "Courier New", Courier, monospace`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'white';
        ctx.fillText(text, 2, 2);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        textBitmapCache.current[cacheKey] = imageData;
        
        return imageData;
    }, []);

    // NARA text stretch distortion effect
    const calculateNara = useCallback((x: number, y: number, time: number, viewportBounds?: {
        startX: number,
        startY: number,
        endX: number,
        endY: number
    }): number => {
        if (!viewportBounds) return 0;
        
        const complexity = options.complexity;
        
        // Cache text bitmap with much larger font size
        const textBitmap = textToBitmap("NARA", 120);
        if (!textBitmap) return 0;
        
        // Calculate viewport dimensions and center
        const viewportWidth = viewportBounds.endX - viewportBounds.startX;
        const viewportHeight = viewportBounds.endY - viewportBounds.startY;
        const centerX = (viewportBounds.startX + viewportBounds.endX) / 2;
        const centerY = (viewportBounds.startY + viewportBounds.endY) / 2;
        
        // Scale text to fit viewport nicely (adjusted for larger font and movement bounds)
        // Using 0.6 to ensure text + movement stays within comfortable bounds
        const scale = (viewportWidth * 0.6) / textBitmap.width;
        
        // Continuous transformation parameters
        const translationSpeed = 0.3; // Speed of text movement
        const morphSpeed = 0.5; // Speed of morphing effects
        
        // Calculate continuous translation offset within 80% viewport bounds
        // This keeps the text from getting too close to edges (10% margin on each side)
        const maxTranslateX = viewportWidth * 0.1; // 10% margin = 80% movement area
        const maxTranslateY = viewportHeight * 0.1; // 10% margin = 80% movement area
        const translateX = Math.sin(time * translationSpeed) * maxTranslateX;
        const translateY = Math.cos(time * translationSpeed * 0.7) * maxTranslateY;
        
        // Optimized bitmap sampling function with continuous transformations
        const sampleTextBitmap = (screenX: number, screenY: number): number => {
            // Transform screen coordinates relative to center
            const relX = screenX - centerX;
            const relY = screenY - centerY;
            
            // Apply continuous translation
            const transX = relX - translateX;
            const transY = relY - translateY;
            
            // Multi-layered noise for smooth morphing
            const noiseScale1 = 0.01 * complexity;
            const noiseScale2 = 0.005 * complexity;
            
            // Use time for continuous noise evolution
            const noiseX1 = perlinNoise(
                transX * noiseScale1 + Math.cos(time * morphSpeed) * 5,
                transY * noiseScale1 + Math.sin(time * morphSpeed) * 5
            );
            const noiseY1 = perlinNoise(
                transX * noiseScale1 + Math.sin(time * morphSpeed * 1.3) * 5,
                transY * noiseScale1 + Math.cos(time * morphSpeed * 1.3) * 5
            );
            
            // Second layer for more complex morphing
            const noiseX2 = perlinNoise(
                transX * noiseScale2 + time * morphSpeed * 0.5,
                transY * noiseScale2 - time * morphSpeed * 0.3
            );
            const noiseY2 = perlinNoise(
                transX * noiseScale2 - time * morphSpeed * 0.3,
                transY * noiseScale2 + time * morphSpeed * 0.5
            );
            
            // Combine noise layers for smooth morphing
            const morphAmount = Math.min(viewportWidth, viewportHeight) * 0.15 * complexity;
            const distortX = (noiseX1 * 0.7 + noiseX2 * 0.3) * morphAmount;
            const distortY = (noiseY1 * 0.7 + noiseY2 * 0.3) * morphAmount;
            
            // Wave distortion that flows continuously
            const waveFreq = 0.02;
            const waveAmp = viewportHeight * 0.05 * complexity;
            const wavePhase = time * 0.8;
            const waveX = Math.sin(transY * waveFreq + wavePhase) * waveAmp;
            const waveY = Math.cos(transX * waveFreq * 0.7 + wavePhase * 1.3) * waveAmp * 0.5;
            
            // Apply all transformations
            const finalX = transX - distortX - waveX;
            const finalY = transY - distortY - waveY;
            
            // Transform to bitmap coordinates
            const bitmapX = Math.floor(finalX / scale + textBitmap.width / 2);
            const bitmapY = Math.floor(finalY / scale + textBitmap.height / 2);
            
            // Hard boundary check - no edge fading
            if (bitmapX < 0 || bitmapX >= textBitmap.width || 
                bitmapY < 0 || bitmapY >= textBitmap.height) {
                return 0; // Clean cutoff, no artifacts
            }
            
            // Sample bitmap directly
            const pixelIndex = (bitmapY * textBitmap.width + bitmapX) * 4;
            let brightness = textBitmap.data[pixelIndex] / 255;
            
            // Safe glow effect - enhance bright pixels without sampling outside bounds
            if (brightness > 0.7) {
                // Boost brightness for strong pixels to create glow effect
                brightness = Math.min(1, brightness * 1.3);
            } else if (brightness > 0.4) {
                // Moderate boost for medium pixels
                brightness = Math.min(1, brightness * 1.1);
            }
            
            return brightness;
        };
        
        // Sample at current position
        let brightness = sampleTextBitmap(x, y);
        
        // Clean trailing effect - only in movement direction and within bounds
        if (brightness < 0.3) {
            const trailDirection = Math.atan2(translateY, translateX);
            const trailLength = 3; // Shorter trail to avoid artifacts
            
            for (let i = 1; i <= trailLength; i++) {
                const trailX = x - Math.cos(trailDirection) * i * 1.5;
                const trailY = y - Math.sin(trailDirection) * i * 1.5;
                
                // Ensure trail positions are within viewport bounds
                if (trailX >= viewportBounds.startX && trailX <= viewportBounds.endX &&
                    trailY >= viewportBounds.startY && trailY <= viewportBounds.endY) {
                    const trailBrightness = sampleTextBitmap(trailX, trailY);
                    if (trailBrightness > 0.2) { // Higher threshold to avoid artifacts
                        brightness = Math.max(brightness, trailBrightness * (0.6 - i * 0.15));
                        break; // Only take the first valid trail pixel
                    }
                }
            }
        }
        
        // More subtle scanline effect to avoid horizontal splits
        const scanlineIntensity = 0.95 + Math.sin(time * 2.5 + y * 0.02) * 0.05;
        brightness *= scanlineIntensity;
        
        // Add subtle flicker for organic feel
        const flicker = 0.95 + Math.sin(time * 15 + x * 0.01) * 0.05;
        brightness *= flicker;
        
        // Add gentle breathing/pulse effect
        const pulse = 0.9 + Math.sin(time * 1.5) * 0.1;
        brightness *= pulse;
        
        return Math.max(0, Math.min(1, brightness));
    }, [options.complexity, perlinNoise, textToBitmap]);


    // Main pattern calculation function
    const calculatePattern = useCallback((x: number, y: number, time: number, mode: MonogramMode, viewportBounds?: {
        startX: number,
        startY: number,
        endX: number,
        endY: number
    }): number => {
        switch (mode) {
            case 'plasma': return calculatePlasma(x, y, time);
            case 'perlin': return calculatePerlin(x, y, time);
            case 'nara': return calculateNara(x, y, time, viewportBounds);
            default: return calculatePlasma(x, y, time);
        }
    }, [calculatePlasma, calculatePerlin, calculateNara]);

    // Generate monogram pattern for given viewport bounds
    const generateMonogramPattern = useCallback((
        startWorldX: number,
        startWorldY: number,
        endWorldX: number,
        endWorldY: number
    ): MonogramPattern => {
        if (!options.enabled) return {};

        const pattern: MonogramPattern = {};
        const time = timeRef.current;
        
        // For NARA mode, use finer sampling for better quality
        const step = (options.mode === 'nara') ? 1 : Math.max(1, Math.floor(3 - options.complexity * 2));
        
        for (let worldY = Math.floor(startWorldY); worldY <= Math.ceil(endWorldY); worldY += step) {
            for (let worldX = Math.floor(startWorldX); worldX <= Math.ceil(endWorldX); worldX += step) {
                
                let rawValue: number;
                let intensity: number;
                
                // Special handling for nara mode that needs viewport bounds
                if (options.mode === 'nara') {
                    const viewportBounds = {
                        startX: startWorldX,
                        startY: startWorldY,
                        endX: endWorldX,
                        endY: endWorldY
                    };
                    rawValue = calculatePattern(worldX, worldY, time, options.mode, viewportBounds);
                    intensity = rawValue;
                } else {
                    rawValue = calculatePattern(worldX, worldY, time, options.mode);
                    intensity = Math.abs(rawValue);
                }
                
                // Skip very low intensity cells for performance
                if (options.mode === 'nara' && intensity < 0.15) continue; // Higher threshold to avoid artifacts
                if (options.mode !== 'nara' && intensity < 0.1) continue;
                
                const char = getCharForIntensity(intensity, options.mode);
                
                let color: string;
                if (options.mode === 'nara') {
                    // Pure black for NARA mode for maximum visibility
                    color = 'black';
                } else {
                    const colorValue = rawValue * Math.PI + time * 0.5;
                    color = getColorFromPalette(colorValue, options.mode);
                }
                
                // For NARA mode, only set the exact position to avoid grid artifacts
                if (options.mode === 'nara') {
                    const key = `${worldX},${worldY}`;
                    pattern[key] = {
                        char,
                        color,
                        intensity
                    };
                } else {
                    // Fill in pattern around the calculated point if step > 1
                    for (let dy = 0; dy < step && worldY + dy <= Math.ceil(endWorldY); dy++) {
                        for (let dx = 0; dx < step && worldX + dx <= Math.ceil(endWorldX); dx++) {
                            const key = `${worldX + dx},${worldY + dy}`;
                            pattern[key] = {
                                char,
                                color,
                                intensity: Math.min(1, intensity + Math.random() * 0.1)
                            };
                        }
                    }
                }
            }
        }
        
        return pattern;
    }, [options, calculatePattern, getCharForIntensity, getColorFromPalette]);

    // Cycle to next mode
    const cycleMode = useCallback(() => {
        const modes: MonogramMode[] = ['plasma', 'perlin', 'nara'];
        setOptions(prev => {
            const currentIndex = modes.indexOf(prev.mode);
            const nextIndex = (currentIndex + 1) % modes.length;
            return { ...prev, mode: modes[nextIndex] };
        });
    }, []);

    // Toggle enabled state
    const toggleEnabled = useCallback(() => {
        setOptions(prev => ({ ...prev, enabled: !prev.enabled }));
    }, []);

    // Update specific option
    const updateOption = useCallback(<K extends keyof MonogramOptions>(
        key: K, 
        value: MonogramOptions[K] | ((prevValue: MonogramOptions[K]) => MonogramOptions[K])
    ) => {
        setOptions(prev => {
            const newValue = typeof value === 'function' 
                ? (value as (prevValue: MonogramOptions[K]) => MonogramOptions[K])(prev[key])
                : value;
            return { ...prev, [key]: newValue };
        });
    }, []);

    return {
        options,
        generateMonogramPattern,
        cycleMode,
        toggleEnabled,
        updateOption,
        setOptions
    };
};

export { useMonogramSystem };