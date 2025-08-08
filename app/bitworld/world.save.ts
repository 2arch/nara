import { useState, useEffect, useRef, useCallback } from 'react';
import { database } from '@/app/firebase'; // Adjust path if needed
import { ref, set, onValue, off, DataSnapshot } from 'firebase/database';
// Import functions and constants directly from @sanity/diff-match-patch
import { makeDiff, DIFF_EQUAL } from '@sanity/diff-match-patch';
import type { WorldData } from './world.engine'; // Adjust path if needed

// Debounce delay for saving (in milliseconds)
const SAVE_DEBOUNCE_DELAY = 100; // 1 second

export function useWorldSave(
    worldId: string | null,
    localWorldData: WorldData,
    setLocalWorldData: (data: WorldData) => void
) {
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Store the last version of data known to be saved or received from Firebase
    const lastSyncedDataRef = useRef<WorldData | null>(null);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    // No need for dmpRef instance anymore

    const worldDataRefPath = worldId ? `worlds/${worldId}/data` : null;

    // --- Load Initial Data ---
    useEffect(() => {
        if (!worldId || !worldDataRefPath) {
            setIsLoading(false);
            console.warn('useWorldSave: No worldId provided, persistence disabled.');
            return;
        }

        setIsLoading(true);
        setError(null);
        const dbRef = ref(database, worldDataRefPath);

        const handleData = (snapshot: DataSnapshot) => {
            const data = snapshot.val() as WorldData | null;
            const initialData = data || {}; // Use empty object if no data exists yet

            // Only update local state if it's truly different from remote
            if (JSON.stringify(initialData) !== JSON.stringify(lastSyncedDataRef.current)) {
                console.log('Firebase: Received updated data for', worldId);
                setLocalWorldData(initialData);
                lastSyncedDataRef.current = { ...initialData }; // Store a copy
            }
            setIsLoading(false);
        };

        const handleError = (err: Error) => {
            console.error("Firebase: Error loading data:", err);
            setError(`Failed to load world data: ${err.message}`);
            setIsLoading(false);
        };

        onValue(dbRef, handleData, handleError);

        return () => {
            off(dbRef, 'value', handleData);
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, [worldId, setLocalWorldData, worldDataRefPath]);

    // --- Save Data on Change (Debounced) ---
    useEffect(() => {
        if (isLoading || !worldId || !worldDataRefPath || !lastSyncedDataRef.current) {
            return;
        }

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        // Use DMP to check if a *meaningful* change occurred
        const lastSyncedStr = JSON.stringify(lastSyncedDataRef.current || {});
        const currentStr = JSON.stringify(localWorldData || {});

        // Use the imported makeDiff function directly
        const diff = makeDiff(lastSyncedStr, currentStr);
        // Check if the diff array has more than one element,
        // or if the single element is not an EQUAL diff.
        const hasChanges = diff.length > 1 || (diff.length === 1 && diff[0][0] !== DIFF_EQUAL);

        if (!hasChanges) {
            return; // No actual change, don't schedule a save
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
    }, [localWorldData, isLoading, worldId, worldDataRefPath]); // Keep dependencies

    return { isLoading, isSaving, error };
} 