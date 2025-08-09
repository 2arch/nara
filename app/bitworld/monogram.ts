import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { Point } from './world.engine';

// --- Monogram Pattern Types ---
export type MonogramMode = 'plasma' | 'waves' | 'cellular' | 'spiral' | 'noise';

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

// --- Psychedelic Color Palettes ---
const RAINBOW_COLORS = [
    '#FF0080', '#FF4000', '#FF8000', '#FFD000', '#80FF00', '#00FF80', '#00D0FF', '#0080FF', '#4000FF', '#8000FF'
];

const PLASMA_COLORS = [
    '#FF006E', '#FB5607', '#FFBE0B', '#8338EC', '#3A86FF'
];

const COSMIC_COLORS = [
    '#FF00FF', '#FF0040', '#FF4000', '#FFFF00', '#40FF00', '#00FF40', '#00FFFF', '#0040FF', '#4000FF', '#8000FF'
];

// --- Mathematical Pattern Generators ---
const useMonogramSystem = () => {
    const [options, setOptions] = useState<MonogramOptions>({
        mode: 'plasma',
        speed: 1.0,
        complexity: 1.0,
        colorShift: 0,
        enabled: true
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
            waves: [' ', '░', '▒', '▓', '█'],
            cellular: [' ', '░', '▒', '▓', '█'],
            spiral: [' ', '░', '▒', '▓', '█'],
            noise: [' ', '░', '▒', '▓', '█'],
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

    // Wave interference patterns
    const calculateWaves = useCallback((x: number, y: number, time: number): number => {
        const complexity = options.complexity;
        const wave1 = Math.sin(Math.sqrt(x * x + y * y) * 0.2 * complexity + time * 2);
        const wave2 = Math.sin((x - Math.sin(time * 0.5) * 10) * 0.15 * complexity + time);
        const wave3 = Math.sin((y - Math.cos(time * 0.3) * 10) * 0.15 * complexity + time * 1.5);
        const wave4 = Math.sin((x + y) * 0.1 * complexity + time * 0.8);
        
        return (wave1 + wave2 + wave3 + wave4) / 4;
    }, [options.complexity]);

    // Cellular automata-like pattern
    const calculateCellular = useCallback((x: number, y: number, time: number): number => {
        const complexity = options.complexity;
        const cellX = Math.floor(x / (4 / complexity));
        const cellY = Math.floor(y / (4 / complexity));
        
        const seed = Math.sin(cellX * 12.9898 + cellY * 78.233 + time * 0.5) * 43758.5453;
        const noise = (seed % 1 + 1) % 1; // Ensure positive
        
        const neighbors = Math.sin(cellX + cellY + time) * 0.5 + 0.5;
        return (noise + neighbors * 0.7) / 1.7;
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

    // Perlin-like noise pattern
    const calculateNoise = useCallback((x: number, y: number, time: number): number => {
        const complexity = options.complexity;
        
        // Multi-octave noise simulation
        let value = 0;
        let amplitude = 1;
        let frequency = 0.02 * complexity;
        
        for (let i = 0; i < 4; i++) {
            const noiseX = x * frequency + time * 0.5;
            const noiseY = y * frequency + time * 0.3;
            
            // Simple noise function using sine waves
            const noise = Math.sin(noiseX * 12.9898) * Math.sin(noiseY * 78.233) + 
                         Math.sin(noiseX * 32.421) * Math.sin(noiseY * 19.177);
            
            value += noise * amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }
        
        return (value + 1) / 2; // Normalize to 0-1
    }, [options.complexity]);

    // Main pattern calculation function
    const calculatePattern = useCallback((x: number, y: number, time: number, mode: MonogramMode): number => {
        switch (mode) {
            case 'plasma': return calculatePlasma(x, y, time);
            case 'waves': return calculateWaves(x, y, time);
            case 'cellular': return calculateCellular(x, y, time);
            case 'spiral': return calculateSpiral(x, y, time);
            case 'noise': return calculateNoise(x, y, time);
            default: return calculatePlasma(x, y, time);
        }
    }, [calculatePlasma, calculateWaves, calculateCellular, calculateSpiral, calculateNoise]);

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
        const modes: MonogramMode[] = ['plasma', 'waves', 'spiral', 'cellular', 'noise'];
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