import { useState, useEffect, useRef, useCallback } from 'react';
import { logger } from './logger';
import { database } from '@/app/firebase'; // Adjust path if needed
import { ref, set, onValue, off, DataSnapshot, get, onChildAdded, onChildChanged, onChildRemoved, update, serverTimestamp } from 'firebase/database';
// Import functions and constants directly from @sanity/diff-match-patch
import { makeDiff, DIFF_EQUAL } from '@sanity/diff-match-patch';
import type { WorldData } from './world.engine'; // Adjust path if needed
import type { WorldSettings } from './settings';

// Debounce delay for saving (in milliseconds)
const SAVE_DEBOUNCE_DELAY = 100;
const MERGE_INTERVAL = 500; // Merge every 500ms

// Generate unique ephemeral client ID
function generateClientId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function useWorldSave(
    worldId: string | null,
    localWorldData: WorldData,
    setLocalWorldData: React.Dispatch<React.SetStateAction<WorldData>>,
    localSettings: WorldSettings,
    setLocalSettings: React.Dispatch<React.SetStateAction<WorldSettings>>,
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
    const mergeIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Ephemeral client ID for this session
    const clientIdRef = useRef<string | null>(null);
    if (!clientIdRef.current) {
        clientIdRef.current = generateClientId();
    }

    // Build world paths directly under /worlds/{userUid}/ when userUid is provided
    const getWorldPath = (worldPath: string) => userUid ? `worlds/${userUid}/${worldPath}` : `worlds/${worldPath}`;

    // For blog posts, use direct path structure: worlds/blog/posts/{post}/data
    const isBlogs = userUid === 'blog' && worldId === 'posts';

    // Canonical path (for reading merged data)
    const worldDataRefPath = worldId ?
        (currentStateName ?
            (isBlogs ? `worlds/blog/posts/${currentStateName}/data` : getWorldPath(`${currentStateName}/data`)) :
            (isBlogs ? null : getWorldPath(`${worldId}/data`))) :
        null;

    // Client-specific channel path (for writing this client's data)
    const clientDataRefPath = worldId && clientIdRef.current ?
        (currentStateName ?
            (isBlogs ? `worlds/blog/posts/${currentStateName}/users/${clientIdRef.current}/data` : getWorldPath(`${currentStateName}/users/${clientIdRef.current}/data`)) :
            (isBlogs ? null : getWorldPath(`${worldId}/users/${clientIdRef.current}/data`))) :
        null;

    // Base path for all client channels (for merge operation)
    const usersBasePath = worldId ?
        (currentStateName ?
            (isBlogs ? `worlds/blog/posts/${currentStateName}/users` : getWorldPath(`${currentStateName}/users`)) :
            (isBlogs ? null : getWorldPath(`${worldId}/users`))) :
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
            logger.warn('useWorldSave: No worldId provided, persistence disabled.');
            return;
        }

        // For user-specific worlds, wait for authentication
        if (!userUid && worldId !== 'blog' && worldId !== 'homeWorld') {
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setError(null);

        const dataPath = worldDataRefPath;
        const settingsPath = settingsRefPath;

        if (!dataPath || !settingsPath) {
            setIsLoading(false);
            return;
        }

        const dataRef = ref(database, dataPath);
        const settingsRef = ref(database, settingsPath);

        const handleError = (err: Error) => {
            // For public viewing, permission errors are expected and should not be logged as errors
            if (err.message && err.message.includes('Permission denied')) {
                setIsLoading(false);
                return;
            }
            logger.error("Firebase: Error loading data:", err);
            setError(`Failed to load world data: ${err.message}`);
            setIsLoading(false);
        };

        const timeoutId = setTimeout(() => {
            if (isLoading) {
                setIsLoading(false);
                logger.warn('Firebase: Data loading timed out.');
            }
        }, 5000); // 5 second timeout

        if (isBlogs) {
            setIsLoading(false);
            clearTimeout(timeoutId);
            const settingsUnsubscribe = onValue(settingsRef, (snapshot) => {
                const settings = snapshot.val() as WorldSettings | null;
                if (settings) {
                    setLocalSettings(settings);
                    lastSyncedSettingsRef.current = { ...settings };
                }
            }, handleError);
            return () => settingsUnsubscribe();
        }

        const initialData: WorldData = {};
        let initialDataLoaded = false;

        const handleSettings = (snapshot: DataSnapshot) => {
            const settings = snapshot.val() as WorldSettings | null;
            if (settings) {
                setLocalSettings(settings);
                lastSyncedSettingsRef.current = { ...settings };
            }
        };

        const settingsUnsubscribe = onValue(settingsRef, handleSettings, handleError);

        const dataListeners = [
            onChildAdded(dataRef, (snapshot) => {
                const key = snapshot.key;
                const value = snapshot.val();
                if (!key) return;

                if (!initialDataLoaded) {
                    initialData[key] = value;
                } else if (autoLoadData) {
                    setLocalWorldData((prevData: WorldData) => {
                        if (prevData[key] && JSON.stringify(prevData[key]) === JSON.stringify(value)) return prevData;
                        const newData = { ...prevData, [key]: value };
                        if (lastSyncedDataRef.current) lastSyncedDataRef.current[key] = value;
                        return newData;
                    });
                }
            }),
            onChildChanged(dataRef, (snapshot) => {
                const key = snapshot.key;
                const value = snapshot.val();
                if (!key || !autoLoadData) return;

                setLocalWorldData((prevData: WorldData) => {
                    if (prevData[key] && JSON.stringify(prevData[key]) === JSON.stringify(value)) return prevData;
                    const newData = { ...prevData, [key]: value };
                    if (lastSyncedDataRef.current) lastSyncedDataRef.current[key] = value;
                    return newData;
                });
            }),
            onChildRemoved(dataRef, (snapshot) => {
                const key = snapshot.key;
                if (!key || !autoLoadData) return;

                setLocalWorldData((prevData: WorldData) => {
                    if (!prevData[key]) return prevData;
                    const newData = { ...prevData };
                    delete newData[key];
                    if (lastSyncedDataRef.current) delete lastSyncedDataRef.current[key];
                    return newData;
                });
            })
        ];

        get(dataRef).then(() => {
            clearTimeout(timeoutId);
            if (autoLoadData) {
                setLocalWorldData(initialData);
                lastSyncedDataRef.current = { ...initialData };
            } else {
                lastSyncedDataRef.current = initialData;
            }
            initialDataLoaded = true;
            setIsLoading(false);
        }).catch(handleError);

        return () => {
            clearTimeout(timeoutId);
            settingsUnsubscribe();
            dataListeners.forEach(unsubscribe => unsubscribe());
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            if (settingsSaveTimeoutRef.current) clearTimeout(settingsSaveTimeoutRef.current);
        };
    }, [worldId, userUid, currentStateName, autoLoadData, isBlogs, worldDataRefPath, settingsRefPath, setLocalWorldData, setLocalSettings]);

    // --- Save Data to Client Channel (Debounced) ---
    useEffect(() => {
        if (isLoading || !worldId || !clientDataRefPath || !lastSyncedDataRef.current) {
            return;
        }

        // For blog posts, disable auto-save hook since state system handles saving
        if (isBlogs) {
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

        const diff = makeDiff(lastSyncedStr, currentStr);
        const hasChanges = diff.length > 1 || (diff.length === 1 && diff[0][0] !== DIFF_EQUAL);

        if (!hasChanges) {
            return;
        }

        saveTimeoutRef.current = setTimeout(async () => {
            if (!worldId || !clientDataRefPath) return;

            setIsSaving(true);
            setError(null);

            try {
                // Clean world data - remove undefined values recursively
                const cleanObject = (obj: any): any => {
                    if (obj === null || typeof obj !== 'object') {
                        return obj;
                    }

                    if (Array.isArray(obj)) {
                        return obj.map(cleanObject);
                    }

                    return Object.entries(obj).reduce((acc, [key, value]) => {
                        if (value !== undefined) {
                            acc[key] = typeof value === 'object' ? cleanObject(value) : value;
                        }
                        return acc;
                    }, {} as any);
                };

                const cleanWorldData = cleanObject(localWorldData);

                // Write to client-specific channel with timestamp
                const updates: Record<string, any> = {};
                for (const [key, value] of Object.entries(cleanWorldData)) {
                    updates[`${clientDataRefPath}/${key}`] = {
                        value,
                        timestamp: serverTimestamp()
                    };
                }

                await update(ref(database), updates);
                lastSyncedDataRef.current = { ...localWorldData };
            } catch (err: any) {
                logger.error("Firebase: Error saving data to client channel:", err);
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
    }, [localWorldData, isLoading, worldId, clientDataRefPath, isBlogs]);

    // --- Periodic Merge: Client Channels → Canonical ---
    useEffect(() => {
        if (isLoading || !worldId || !usersBasePath || !worldDataRefPath) {
            return;
        }

        // For blog posts, skip merge
        if (isBlogs) {
            return;
        }

        const performMerge = async () => {
            try {
                const usersRef = ref(database, usersBasePath);
                const snapshot = await get(usersRef);

                if (!snapshot.exists()) {
                    return;
                }

                const allClientsData = snapshot.val();
                const mergedData: Record<string, any> = {};
                const timestamps: Record<string, number> = {};

                // Collect all data from all client channels
                for (const clientId in allClientsData) {
                    const clientData = allClientsData[clientId]?.data;
                    if (!clientData) continue;

                    for (const [key, entry] of Object.entries(clientData as Record<string, any>)) {
                        const entryTimestamp = entry?.timestamp || 0;
                        const entryValue = entry?.value;

                        // Last-write-wins: keep entry with most recent timestamp
                        if (!timestamps[key] || entryTimestamp > timestamps[key]) {
                            timestamps[key] = entryTimestamp;
                            mergedData[key] = entryValue;
                        }
                    }
                }

                // Write merged data to canonical path
                if (Object.keys(mergedData).length > 0) {
                    const canonicalRef = ref(database, worldDataRefPath);
                    await set(canonicalRef, mergedData);
                }
            } catch (err: any) {
                logger.error("Firebase: Error during merge:", err);
            }
        };

        // Perform initial merge
        performMerge();

        // Set up periodic merge
        mergeIntervalRef.current = setInterval(performMerge, MERGE_INTERVAL);

        return () => {
            if (mergeIntervalRef.current) {
                clearInterval(mergeIntervalRef.current);
            }
        };
    }, [isLoading, worldId, usersBasePath, worldDataRefPath, isBlogs]);

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
                // Clean settings object - remove undefined values recursively
                const cleanObject = (obj: any): any => {
                    if (obj === null || typeof obj !== 'object') {
                        return obj;
                    }
                    
                    if (Array.isArray(obj)) {
                        return obj.map(cleanObject);
                    }
                    
                    return Object.entries(obj).reduce((acc, [key, value]) => {
                        if (value !== undefined) {
                            acc[key] = typeof value === 'object' ? cleanObject(value) : value;
                        }
                        return acc;
                    }, {} as any);
                };
                
                const cleanSettings = cleanObject(localSettings);
                
                await set(dbRef, cleanSettings);
                lastSyncedSettingsRef.current = { ...localSettings };
            } catch (err: any) {
                logger.error("Firebase: Error saving settings:", err);
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
 