// app/bitworld/settings.ts
import { useState, useCallback } from 'react';

export interface WorldSettings {
    isDebugVisible: boolean;
    isDeepspawnVisible: boolean;
}

export const initialSettings: WorldSettings = {
    isDebugVisible: false,
    isDeepspawnVisible: false,
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
