// app/bitworld/settings.ts
import { useState, useCallback } from 'react';

export interface WorldSettings {
    isDebugVisible: boolean;
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
    // Autocomplete
    isAutocompleteEnabled?: boolean;
}

export const initialSettings: WorldSettings = {
    isDebugVisible: false,
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
