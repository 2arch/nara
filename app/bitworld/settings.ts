// app/bitworld/settings.ts
import { useState, useCallback } from 'react';
import type { MonogramOptions } from './monogram';

export interface WorldSettings {
    isDebugVisible: boolean;
    monogramOptions: MonogramOptions;
    labelProximityThreshold: number;
    textColor?: string;
    backgroundColor?: string;
    hasCustomTextColor?: boolean; // Track if user has set custom text color via /text --g
    customBackground?: {
        type: 'ai-generated' | 'custom';
        content: string; // SVG string for AI backgrounds, color/gradient for custom
        prompt?: string; // The prompt used to generate AI background
    };
    spawnPoint?: {
        x: number;
        y: number;
    };
    // Persisted monogram state
    monogramMode?: import('./monogram').MonogramMode;
    monogramEnabled?: boolean;
    // Autocomplete
    isAutocompleteEnabled?: boolean;
}

export const initialSettings: WorldSettings = {
    isDebugVisible: false,
    monogramOptions: {
        mode: 'perlin',
        speed: 0.5, // Slower default speed
        complexity: 1.0,
        colorShift: 0,
        enabled: false,
        geometryType: 'octahedron',
        interactiveTrails: true,
        trailIntensity: 0.5,
        trailFadeMs: 500
    },
    labelProximityThreshold: 999999,
    isAutocompleteEnabled: false, // Autocomplete disabled by default
};

export function useWorldSettings() {
    const [settings, setSettings] = useState<WorldSettings>(initialSettings);

    const updateSettings = useCallback((newSettings: Partial<WorldSettings>) => {
        setSettings(prev => ({ ...prev, ...newSettings }));
    }, []);

    return {
        settings,
        setSettings,
        updateSettings,
    };
}
