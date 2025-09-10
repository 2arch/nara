import { useState, useEffect, useRef, useCallback } from 'react';
import { database } from '@/app/firebase'; // Adjust path if needed
import { ref, set, onValue, off, DataSnapshot, get } from 'firebase/database';
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
    autoLoadData: boolean = true,
    currentStateName?: string | null,
    userUid?: string | null // Add user UID parameter
) {
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Store the last version of data known to be saved or received from Firebase
    const lastSyncedDataRef = useRef<WorldData | null>(null);
    const lastSyncedSettingsRef = useRef<WorldSettings | null>(null);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const settingsSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Build world paths directly under /worlds/{userUid}/ when userUid is provided
    const getWorldPath = (worldPath: string) => userUid ? `worlds/${userUid}/${worldPath}` : `worlds/${worldPath}`;
    
    // For blog posts, use direct path structure: worlds/blog/posts/{post}/data
    const isBlogs = userUid === 'blog' && worldId === 'posts';
    const worldDataRefPath = worldId ? 
        (currentStateName ? 
            (isBlogs ? `worlds/blog/posts/${currentStateName}/data` : getWorldPath(`${currentStateName}/data`)) :
            (isBlogs ? null : getWorldPath(`${worldId}/data`))) : 
        null;
    const settingsRefPath = worldId ? 
        (currentStateName ? 
            (isBlogs ? `worlds/blog/posts/${currentStateName}/settings` : getWorldPath(`${currentStateName}/settings`)) :
            (isBlogs ? null : getWorldPath(`${worldId}/settings`))) : 
        null;

    // --- Load Initial Data & Settings ---
    useEffect(() => {
        if (!worldId) {
            setIsLoading(false);
            console.warn('useWorldSave: No worldId provided, persistence disabled.');
            return;
        }

        // Allow null userUid for global worlds (saves to worlds/{worldId}/data directly)
        // if (!userUid) {
        //     setIsLoading(false);
        //     return;
        // }

        setIsLoading(true);
        setError(null);
        
        const dataPath = currentStateName ? 
            (isBlogs ? `worlds/blog/posts/${currentStateName}/data` : getWorldPath(`${currentStateName}/data`)) :
            getWorldPath(`${worldId}/data`);
        const settingsPath = currentStateName ? 
            (isBlogs ? `worlds/blog/posts/${currentStateName}/settings` : getWorldPath(`${currentStateName}/settings`)) :
            getWorldPath(`${worldId}/settings`);
            
        console.log('Blog save hook - paths:', { dataPath, settingsPath, currentStateName, isBlogs });
        const dataRef = ref(database, dataPath);
        const settingsRef = ref(database, settingsPath);

        const handleData = (snapshot: DataSnapshot) => {
            // For blog posts, completely skip data handling to avoid conflicts
            if (isBlogs) {
                return;
            }
            
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

        // Add a timeout to prevent infinite loading
        const timeoutId = setTimeout(() => {
            setIsLoading(false);
        }, 5000); // 5 second timeout

        // Store reference for proper cleanup
        let unsubscribe: (() => void) | null = null;
        
        // Set up persistent listener with proper cleanup tracking
        // Always listen to the specific data and settings paths, not the parent object
        let dataUnsubscribe: (() => void) | null = null;
        let settingsUnsubscribe: (() => void) | null = null;
        
        dataUnsubscribe = onValue(dataRef, (snapshot) => {
            clearTimeout(timeoutId);
            handleData(snapshot);
            setIsLoading(false);
        }, handleError);
        
        settingsUnsubscribe = onValue(settingsRef, (snapshot) => {
            handleSettings(snapshot);
        }, handleError);
        
        unsubscribe = () => {
            if (dataUnsubscribe) dataUnsubscribe();
            if (settingsUnsubscribe) settingsUnsubscribe();
        };

        return () => {
            // Proper cleanup: call the unsubscribe function returned by onValue
            clearTimeout(timeoutId);
            if (unsubscribe) {
                unsubscribe();
                unsubscribe = null;
            }
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            if (settingsSaveTimeoutRef.current) clearTimeout(settingsSaveTimeoutRef.current);
        };
    }, [worldId, setLocalWorldData, setLocalSettings, currentStateName, userUid, autoLoadData]);

    // --- Save Data on Change (Debounced) ---
    useEffect(() => {
        if (isLoading || !worldId || !worldDataRefPath || !lastSyncedDataRef.current) {
            return;
        }
        
        // For blog posts, disable auto-save hook since state system handles saving
        if (isBlogs) {
            console.log('Skipping auto-save for blog posts - using state system');
            return;
        }

        // Prevent saving empty data on initial mount - only save if data has meaningful content
        const hasContent = Object.keys(localWorldData || {}).length > 0;
        const lastSyncedHasContent = Object.keys(lastSyncedDataRef.current || {}).length > 0;
        
        if (!hasContent && !lastSyncedHasContent) {
            // Both current and last synced are empty - don't save empty state
            return;
        }

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        const lastSyncedStr = JSON.stringify(lastSyncedDataRef.current || {});
        const currentStr = JSON.stringify(localWorldData || {});

        console.log('Save hook diff check:', { 
            lastSyncedKeys: Object.keys(lastSyncedDataRef.current || {}),
            currentKeys: Object.keys(localWorldData || {}),
            isBlogs,
            currentStateName
        });

        const diff = makeDiff(lastSyncedStr, currentStr);
        const hasChanges = diff.length > 1 || (diff.length === 1 && diff[0][0] !== DIFF_EQUAL);

        if (!hasChanges) {
            console.log('No changes detected, skipping save');
            return;
        }
        
        console.log('Changes detected, preparing to save');

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
 