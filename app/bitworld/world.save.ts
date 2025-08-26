import { useState, useEffect, useRef, useCallback } from 'react';
import { database } from '@/app/firebase'; // Adjust path if needed
import { ref, set, onValue, off, DataSnapshot } from 'firebase/database';
// Import functions and constants directly from @sanity/diff-match-patch
import { makeDiff, DIFF_EQUAL } from '@sanity/diff-match-patch';
import type { WorldData } from './world.engine'; // Adjust path if needed
import type { WorldSettings } from './settings';

// Debounce delay for saving (in milliseconds)
const SAVE_DEBOUNCE_DELAY = 100; // 1 second

export function useWorldSave(
    worldId: string | null,
    localWorldData: WorldData,
    setLocalWorldData: (data: WorldData) => void,
    localSettings: WorldSettings,
    setLocalSettings: (settings: WorldSettings) => void,
    autoLoadData: boolean = true
) {
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Store the last version of data known to be saved or received from Firebase
    const lastSyncedDataRef = useRef<WorldData | null>(null);
    const lastSyncedSettingsRef = useRef<WorldSettings | null>(null);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const settingsSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const worldDataRefPath = worldId ? `worlds/${worldId}/data` : null;
    const settingsRefPath = worldId ? `worlds/${worldId}/settings` : null;

    // --- Load Initial Data & Settings ---
    useEffect(() => {
        if (!worldId) {
            setIsLoading(false);
            console.warn('useWorldSave: No worldId provided, persistence disabled.');
            return;
        }

        setIsLoading(true);
        setError(null);
        
        const dataRef = ref(database, `worlds/${worldId}/data`);
        const settingsRef = ref(database, `worlds/${worldId}/settings`);

        const handleData = (snapshot: DataSnapshot) => {
            if (!autoLoadData) {
                // Don't auto-load data, but still track it for saving purposes
                const data = snapshot.val() as WorldData | null;
                const initialData = data || {};
                lastSyncedDataRef.current = { ...initialData };
                return;
            }
            
            const data = snapshot.val() as WorldData | null;
            const initialData = data || {};
            if (JSON.stringify(initialData) !== JSON.stringify(lastSyncedDataRef.current)) {
                setLocalWorldData(initialData);
                lastSyncedDataRef.current = { ...initialData };
            }
        };

        const handleSettings = (snapshot: DataSnapshot) => {
            const settings = snapshot.val() as WorldSettings | null;
            if (settings) {
                setLocalSettings(settings);
                lastSyncedSettingsRef.current = { ...settings };
            }
        };

        const handleError = (err: Error) => {
            console.error("Firebase: Error loading data:", err);
            setError(`Failed to load world data: ${err.message}`);
            setIsLoading(false);
        };

        const worldRef = ref(database, `worlds/${worldId}`);
        onValue(worldRef, (snapshot) => {
            const world = snapshot.val();
            handleData(snapshot.child('data'));
            handleSettings(snapshot.child('settings'));
            setIsLoading(false);
        }, handleError);

        return () => {
            off(worldRef);
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            if (settingsSaveTimeoutRef.current) clearTimeout(settingsSaveTimeoutRef.current);
        };
    }, [worldId, setLocalWorldData, setLocalSettings]);

    // --- Save Data on Change (Debounced) ---
    useEffect(() => {
        if (isLoading || !worldId || !worldDataRefPath || !lastSyncedDataRef.current) {
            return;
        }

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        const lastSyncedStr = JSON.stringify(lastSyncedDataRef.current || {});
        const currentStr = JSON.stringify(localWorldData || {});

        const diff = makeDiff(lastSyncedStr, currentStr);
        const hasChanges = diff.length > 1 || (diff.length === 1 && diff[0][0] !== DIFF_EQUAL);

        if (!hasChanges) {
            return;
        }

        saveTimeoutRef.current = setTimeout(async () => {
            if (!worldId || !worldDataRefPath) return;

            setIsSaving(true);
            setError(null);
            const dbRef = ref(database, worldDataRefPath);

            try {
                await set(dbRef, localWorldData);
                lastSyncedDataRef.current = { ...localWorldData };
            } catch (err: any) {
                console.error("Firebase: Error saving data:", err);
                setError(`Failed to save world data: ${err.message}`);
            } finally {
                setIsSaving(false);
            }
        }, SAVE_DEBOUNCE_DELAY);

        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, [localWorldData, isLoading, worldId, worldDataRefPath]);

    // --- Save Settings on Change (Debounced) ---
    useEffect(() => {
        if (isLoading || !worldId || !settingsRefPath || !lastSyncedSettingsRef.current) {
            return;
        }

        if (settingsSaveTimeoutRef.current) {
            clearTimeout(settingsSaveTimeoutRef.current);
        }

        if (JSON.stringify(localSettings) === JSON.stringify(lastSyncedSettingsRef.current)) {
            return;
        }

        settingsSaveTimeoutRef.current = setTimeout(async () => {
            if (!worldId || !settingsRefPath) return;

            setIsSaving(true);
            setError(null);
            const dbRef = ref(database, settingsRefPath);

            try {
                await set(dbRef, localSettings);
                lastSyncedSettingsRef.current = { ...localSettings };
            } catch (err: any) {
                console.error("Firebase: Error saving settings:", err);
                setError(`Failed to save settings: ${err.message}`);
            } finally {
                setIsSaving(false);
            }
        }, SAVE_DEBOUNCE_DELAY);

        return () => {
            if (settingsSaveTimeoutRef.current) {
                clearTimeout(settingsSaveTimeoutRef.current);
            }
        };
    }, [localSettings, isLoading, worldId, settingsRefPath]);

    return { isLoading, isSaving, error };
}
 