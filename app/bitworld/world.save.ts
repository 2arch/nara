import { useState, useEffect, useRef, useCallback } from 'react';
import { logger } from './logger';
import { database } from '@/app/firebase'; // Adjust path if needed
import { ref, set, onValue, off, DataSnapshot, get, onChildAdded, onChildChanged, onChildRemoved, update, serverTimestamp } from 'firebase/database';
// Import functions and constants directly from @sanity/diff-match-patch
import { makeDiff, DIFF_EQUAL } from '@sanity/diff-match-patch';
import type { WorldData } from './world.engine'; // Adjust path if needed
import type { WorldSettings } from './settings';

// Debounce delay for saving (in milliseconds)
const SAVE_DEBOUNCE_DELAY = 10; // Instant saves
const MERGE_INTERVAL = 100; // Merge every 100ms for instant updates

// Enable direct saves (bypass client channel system)
const USE_DIRECT_SAVES = true;

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
    userUid?: string | null, // Add user UID parameter
    isReadOnly?: boolean, // Read-only flag to prevent write attempts
    localClipboard?: any[], // Clipboard items
    setLocalClipboard?: React.Dispatch<React.SetStateAction<any[]>> // Clipboard setter
) {
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Store the last version of data known to be saved or received from Firebase
    const lastSyncedDataRef = useRef<WorldData | null>(null);
    const lastSyncedSettingsRef = useRef<WorldSettings | null>(null);
    const lastSyncedClipboardRef = useRef<any[] | null>(null);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const settingsSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const clipboardSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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

    const clipboardRefPath = worldId ?
        (currentStateName ?
            (isBlogs ? `worlds/blog/posts/${currentStateName}/clipboard` : getWorldPath(`${currentStateName}/clipboard`)) :
            (isBlogs ? null : getWorldPath(`${worldId}/clipboard`))) :
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
        const clipboardPath = clipboardRefPath;

        if (!dataPath || !settingsPath) {
            setIsLoading(false);
            return;
        }

        const dataRef = ref(database, dataPath);
        const settingsRef = ref(database, settingsPath);
        const clipboardRef = clipboardPath ? ref(database, clipboardPath) : null;

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

        const handleClipboard = (snapshot: DataSnapshot) => {
            const clipboard = snapshot.val() as any[] | null;
            if (setLocalClipboard) {
                if (clipboard) {
                    setLocalClipboard(clipboard);
                    lastSyncedClipboardRef.current = [...clipboard];
                } else {
                    // Initialize empty clipboard if none exists
                    lastSyncedClipboardRef.current = [];
                }
            }
        };

        const settingsUnsubscribe = onValue(settingsRef, handleSettings, handleError);
        const clipboardUnsubscribe = clipboardRef ? onValue(clipboardRef, handleClipboard, handleError) : null;

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
            if (clipboardUnsubscribe) clipboardUnsubscribe();
            dataListeners.forEach(unsubscribe => unsubscribe());
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            if (settingsSaveTimeoutRef.current) clearTimeout(settingsSaveTimeoutRef.current);
            if (clipboardSaveTimeoutRef.current) clearTimeout(clipboardSaveTimeoutRef.current);
        };
    }, [worldId, userUid, currentStateName, autoLoadData, isBlogs, worldDataRefPath, settingsRefPath, clipboardRefPath, setLocalWorldData, setLocalSettings, setLocalClipboard]);

    // --- Save Data to Client Channel (Debounced) ---
    useEffect(() => {
        if (isLoading || !worldId || !clientDataRefPath || !lastSyncedDataRef.current) {
            return;
        }

        // Skip saves in read-only mode
        if (isReadOnly) {
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
            if (!worldId) return;

            // Use direct path if enabled, otherwise use client channel
            const savePath = USE_DIRECT_SAVES ? worldDataRefPath : clientDataRefPath;
            if (!savePath) return;

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

                if (USE_DIRECT_SAVES) {
                    // Direct save - write entire data to canonical path
                    const dataRef = ref(database, savePath);
                    await set(dataRef, cleanWorldData);
                    lastSyncedDataRef.current = { ...localWorldData };
                } else {
                    // Client channel save with timestamps
                    const updates: Record<string, any> = {};

                    // Add/update all current keys
                    for (const [key, value] of Object.entries(cleanWorldData)) {
                        updates[`${savePath}/${key}`] = {
                            value,
                            timestamp: serverTimestamp()
                        };
                    }

                    // Mark deleted keys with deletion tombstones
                    const lastSyncedKeys = Object.keys(lastSyncedDataRef.current || {});
                    const currentKeys = Object.keys(cleanWorldData);
                    const deletedKeys = lastSyncedKeys.filter(key => !currentKeys.includes(key));

                    for (const key of deletedKeys) {
                        // Write deletion marker with timestamp for conflict resolution
                        updates[`${savePath}/${key}`] = {
                            deleted: true,
                            timestamp: serverTimestamp()
                        };
                    }

                    await update(ref(database), updates);
                    lastSyncedDataRef.current = { ...localWorldData };
                }
            } catch (err: any) {
                // Silently skip permission errors (viewing other users' states or new states)
                if (err.code !== 'PERMISSION_DENIED' && !err.message?.includes('Permission denied')) {
                    logger.error("Firebase: Error saving data to client channel:", err);
                    setError(`Failed to save world data: ${err.message}`);
                }
            } finally {
                setIsSaving(false);
            }
        }, SAVE_DEBOUNCE_DELAY);

        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, [localWorldData, isLoading, worldId, clientDataRefPath, worldDataRefPath, isBlogs, isReadOnly]);

    // --- Periodic Merge: Client Channels → Canonical ---
    useEffect(() => {
        if (isLoading || !worldId || !usersBasePath || !worldDataRefPath) {
            return;
        }

        // Skip merge when using direct saves
        if (USE_DIRECT_SAVES) {
            return;
        }

        // Skip merge in read-only mode
        if (isReadOnly) {
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
                const deletedKeys = new Set<string>();

                for (const clientId in allClientsData) {
                    const clientData = allClientsData[clientId]?.data;
                    if (!clientData) continue;

                    for (const [key, entry] of Object.entries(clientData as Record<string, any>)) {
                        const entryTimestamp = entry?.timestamp || 0;
                        const isDeleted = entry?.deleted === true;
                        const entryValue = entry?.value;

                        // Last-write-wins: keep entry with most recent timestamp
                        if (!timestamps[key] || entryTimestamp > timestamps[key]) {
                            timestamps[key] = entryTimestamp;

                            if (isDeleted) {
                                // Mark as deleted - will be excluded from merge
                                deletedKeys.add(key);
                                delete mergedData[key]; // Remove if it was added before
                            } else if (entryValue !== null && entryValue !== undefined) {
                                // Valid data - add to merge
                                mergedData[key] = entryValue;
                                deletedKeys.delete(key); // Un-mark deletion if newer data arrived
                            }
                        }
                    }
                }

                // Write merged data to canonical path
                try {
                    const canonicalRef = ref(database, worldDataRefPath);
                    await set(canonicalRef, mergedData);

                    // Clean up tombstones from all client channels after successful merge
                    const cleanupUpdates: Record<string, any> = {};
                    for (const clientId in allClientsData) {
                        const clientData = allClientsData[clientId]?.data;
                        if (!clientData) continue;

                        for (const [key, entry] of Object.entries(clientData as Record<string, any>)) {
                            // Remove entries that are marked as deleted
                            if (entry?.deleted === true) {
                                cleanupUpdates[`${usersBasePath}/${clientId}/data/${key}`] = null;
                            }
                        }
                    }

                    // Execute cleanup if there are tombstones to remove
                    if (Object.keys(cleanupUpdates).length > 0) {
                        await update(ref(database), cleanupUpdates);
                    }
                } catch (writeErr: any) {
                    // Permission denied errors are expected when viewing other users' states
                    // or when the state doesn't exist yet - silently skip
                    if (writeErr.code === 'PERMISSION_DENIED' || writeErr.message?.includes('Permission denied')) {
                        return; // Silently skip merge for read-only or non-existent states
                    }
                    throw writeErr; // Re-throw other errors
                }
            } catch (err: any) {
                // Only log errors that aren't permission-related
                if (err.code !== 'PERMISSION_DENIED' && !err.message?.includes('Permission denied')) {
                    logger.error("Firebase: Error during merge:", err);
                }
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
    }, [isLoading, worldId, usersBasePath, worldDataRefPath, isBlogs, isReadOnly]);

    // --- Save Settings on Change (Debounced) ---
    useEffect(() => {
        if (isLoading || !worldId || !settingsRefPath || !lastSyncedSettingsRef.current) {
            return;
        }

        // Skip settings saves in read-only mode
        if (isReadOnly) {
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
    }, [localSettings, isLoading, worldId, settingsRefPath, isReadOnly]);

    // --- Save Clipboard on Change (Debounced) ---
    useEffect(() => {
        if (isLoading || !worldId || !clipboardRefPath || !lastSyncedClipboardRef.current || !localClipboard) {
            return;
        }

        // Skip clipboard saves in read-only mode
        if (isReadOnly) {
            return;
        }

        if (clipboardSaveTimeoutRef.current) {
            clearTimeout(clipboardSaveTimeoutRef.current);
        }

        if (JSON.stringify(localClipboard) === JSON.stringify(lastSyncedClipboardRef.current)) {
            return;
        }

        clipboardSaveTimeoutRef.current = setTimeout(async () => {
            if (!worldId || !clipboardRefPath) return;

            setIsSaving(true);
            setError(null);
            const dbRef = ref(database, clipboardRefPath);

            try {
                // Clean clipboard array - remove undefined values recursively
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

                const cleanClipboard = cleanObject(localClipboard);

                await set(dbRef, cleanClipboard);
                lastSyncedClipboardRef.current = [...localClipboard];
            } catch (err: any) {
                logger.error("Firebase: Error saving clipboard:", err);
                setError(`Failed to save clipboard: ${err.message}`);
            } finally {
                setIsSaving(false);
            }
        }, SAVE_DEBOUNCE_DELAY);

        return () => {
            if (clipboardSaveTimeoutRef.current) {
                clearTimeout(clipboardSaveTimeoutRef.current);
            }
        };
    }, [localClipboard, isLoading, worldId, clipboardRefPath, isReadOnly]);

    // Function to clear all world data from Firebase
    const clearWorldData = useCallback(async () => {
        if (!worldId || isReadOnly || isBlogs) {
            return;
        }

        try {
            const updates: Record<string, any> = {};

            // Clear canonical data
            if (worldDataRefPath) {
                updates[worldDataRefPath] = null;
            }

            // Clear all client channels
            if (usersBasePath) {
                updates[usersBasePath] = null;
            }

            // Clear clipboard
            if (clipboardRefPath) {
                updates[clipboardRefPath] = null;
            }

            // Execute all deletes in one operation
            await update(ref(database), updates);

            // Update local refs to prevent re-sync
            lastSyncedDataRef.current = {};
            lastSyncedClipboardRef.current = [];

            logger.info('Firebase: World data cleared successfully');
        } catch (err: any) {
            logger.error('Firebase: Error clearing world data:', err);
            throw err;
        }
    }, [worldId, worldDataRefPath, usersBasePath, clipboardRefPath, isReadOnly, isBlogs]);

    return { isLoading, isSaving, error, clearWorldData };
}
 