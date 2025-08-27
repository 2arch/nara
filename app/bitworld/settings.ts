// app/bitworld/settings.ts
import { useState, useCallback } from 'react';
import type { MonogramOptions } from './monogram';

export interface WorldSettings {
    isDebugVisible: boolean;
    isDeepspawnVisible: boolean;
    monogramOptions: MonogramOptions;
}

export const initialSettings: WorldSettings = {
    isDebugVisible: false,
    isDeepspawnVisible: false,
    monogramOptions: {
        mode: 'plasma',
        speed: 0.5, // Slower default speed
        complexity: 1.0,
        colorShift: 0,
        enabled: false
    },
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
