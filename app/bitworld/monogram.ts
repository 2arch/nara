import { useState, useCallback, useRef, useEffect } from 'react';
import type { Point } from './world.engine';

// --- Monogram Pattern Types ---
export type MonogramMode = 'plasma' | 'spiral' | 'nara';

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
const useMonogramSystem = () => {
    const [options, setOptions] = useState<MonogramOptions>({
        mode: 'plasma',
        speed: 1.0,
        complexity: 1.0,
        colorShift: 0,
        enabled: false
    });

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

    // Character sets for different intensities
    const getCharForIntensity = useCallback((intensity: number, mode: MonogramMode): string => {
        const chars = {
            plasma: [' ', '░', '▒', '▓', '█'],
            spiral: [' ', '░', '▒', '▓', '█'],
            nara: [' ', '.', ':', '+', '#', 'N', 'A', 'R', 'A'],
        };
        
        const charSet = chars[mode] || chars.plasma;
        const index = Math.floor(intensity * (charSet.length - 1));
        return charSet[Math.min(index, charSet.length - 1)];
    }, []);

    // Get color from palette based on value
    const getColorFromPalette = useCallback((value: number, mode: MonogramMode): string => {
        // Monochromatic scheme: vary lightness, keep hue/saturation constant
        const lightness = 50 + (value % 1) * 50; // Vary lightness from 50% to 100%
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

    // Spiral pattern
    const calculateSpiral = useCallback((x: number, y: number, time: number): number => {
        const complexity = options.complexity;
        const centerX = Math.sin(time * 0.2) * 5;
        const centerY = Math.cos(time * 0.3) * 5;
        
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        
        const spiral = Math.sin(distance * 0.3 * complexity - time * 3 + angle * 3);
        const radialWave = Math.sin(distance * 0.1 * complexity + time);
        
        return (spiral + radialWave) / 2;
    }, [options.complexity]);

    // NARA text with reaction-diffusion
    const calculateNara = useCallback((x: number, y: number, time: number): number => {
        const complexity = options.complexity;
        
        // Define NARA text pattern (each letter is ~6 units wide, 5 units tall)
        const naraPattern = {
            // N (x: 0-4)
            'N': (px: number, py: number) => {
                if (py < 0 || py >= 5) return 0;
                if (px === 0 || px === 4) return 1;
                if (px === 1 && py === 1) return 1;
                if (px === 2 && py === 2) return 1;
                if (px === 3 && py === 3) return 1;
                return 0;
            },
            // A (x: 6-10)
            'A': (px: number, py: number) => {
                if (py < 0 || py >= 5) return 0;
                if (py === 0 && px >= 1 && px <= 3) return 1;
                if (py === 2 && px >= 1 && px <= 3) return 1;
                if ((px === 0 || px === 4) && py >= 1) return 1;
                return 0;
            },
            // R (x: 12-16)
            'R1': (px: number, py: number) => {
                if (py < 0 || py >= 5) return 0;
                if (px === 0) return 1;
                if (py <= 2 && px === 4) return 1;
                if ((py === 0 || py === 2) && px >= 1 && px <= 3) return 1;
                if (py === 3 && px === 2) return 1;
                if (py === 4 && px === 3) return 1;
                return 0;
            },
            // A (x: 18-22)
            'A2': (px: number, py: number) => {
                if (py < 0 || py >= 5) return 0;
                if (py === 0 && px >= 1 && px <= 3) return 1;
                if (py === 2 && px >= 1 && px <= 3) return 1;
                if ((px === 0 || px === 4) && py >= 1) return 1;
                return 0;
            }
        };
        
        // Center the text
        const centerX = Math.sin(time * 0.1) * 2;
        const centerY = Math.cos(time * 0.15) * 1;
        const textX = x - centerX;
        const textY = y - centerY + 2;
        
        // Get base text intensity
        let textIntensity = 0;
        
        // Check N
        if (textX >= 0 && textX < 5) {
            textIntensity = naraPattern.N(Math.floor(textX), Math.floor(textY));
        }
        // Check A
        else if (textX >= 6 && textX < 11) {
            textIntensity = naraPattern.A(Math.floor(textX - 6), Math.floor(textY));
        }
        // Check R
        else if (textX >= 12 && textX < 17) {
            textIntensity = naraPattern.R1(Math.floor(textX - 12), Math.floor(textY));
        }
        // Check A
        else if (textX >= 18 && textX < 23) {
            textIntensity = naraPattern.A2(Math.floor(textX - 18), Math.floor(textY));
        }
        
        // Apply reaction-diffusion effect
        const reactionA = Math.sin(x * 0.1 * complexity + time) * 0.5 + 0.5;
        const reactionB = Math.cos(y * 0.1 * complexity + time * 1.2) * 0.5 + 0.5;
        const diffusion = Math.sin((x + y) * 0.05 * complexity + time * 0.8) * 0.3 + 0.7;
        
        // Blend text with reaction-diffusion
        const fluidEffect = (reactionA * reactionB * diffusion) * 0.6;
        const distanceFromText = Math.min(
            Math.abs(textX - 11.5), // Distance from center of "NARA"
            Math.abs(textY - 2.5)
        );
        
        // Create flowing effect that spreads from text
        const flowRadius = 8 + Math.sin(time * 0.5) * 3;
        const flowIntensity = Math.max(0, (flowRadius - distanceFromText) / flowRadius);
        
        return Math.max(
            textIntensity * 0.8, // Original text (slightly dimmed)
            fluidEffect * flowIntensity * 0.7 // Flowing reaction-diffusion
        );
    }, [options.complexity]);

    // Main pattern calculation function
    const calculatePattern = useCallback((x: number, y: number, time: number, mode: MonogramMode): number => {
        switch (mode) {
            case 'plasma': return calculatePlasma(x, y, time);
            case 'spiral': return calculateSpiral(x, y, time);
            case 'nara': return calculateNara(x, y, time);
            default: return calculatePlasma(x, y, time);
        }
    }, [calculatePlasma, calculateSpiral, calculateNara]);

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
        
        // Sample every 2nd or 3rd cell for performance, depending on complexity
        const step = Math.max(1, Math.floor(3 - options.complexity * 2));
        
        for (let worldY = Math.floor(startWorldY); worldY <= Math.ceil(endWorldY); worldY += step) {
            for (let worldX = Math.floor(startWorldX); worldX <= Math.ceil(endWorldX); worldX += step) {
                
                const rawValue = calculatePattern(worldX, worldY, time, options.mode);
                const intensity = Math.abs(rawValue);
                
                // Skip very low intensity cells for performance
                if (intensity < 0.1) continue;
                
                const char = getCharForIntensity(intensity, options.mode);
                const colorValue = rawValue * Math.PI + time * 0.5;
                const color = getColorFromPalette(colorValue, options.mode);
                
                // Fill in pattern around the calculated point if step > 1
                for (let dy = 0; dy < step && worldY + dy <= Math.ceil(endWorldY); dy++) {
                    for (let dx = 0; dx < step && worldX + dx <= Math.ceil(endWorldX); dx++) {
                        const key = `${worldX + dx},${worldY + dy}`;
                        pattern[key] = {
                            char,
                            color,
                            intensity: Math.min(1, intensity + Math.random() * 0.1) // Add slight variation
                        };
                    }
                }
            }
        }
        
        return pattern;
    }, [options, calculatePattern, getCharForIntensity, getColorFromPalette]);

    // Cycle to next mode
    const cycleMode = useCallback(() => {
        const modes: MonogramMode[] = ['plasma', 'spiral', 'nara'];
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