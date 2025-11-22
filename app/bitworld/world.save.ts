import { useState, useEffect, useRef, useCallback } from 'react';
import { logger } from './logger';
import { database } from '@/app/firebase'; // Adjust path if needed
import { ref, set, onValue, DataSnapshot, get, onChildAdded, onChildChanged, onChildRemoved, update, serverTimestamp } from 'firebase/database';
// Import functions and constants directly from @sanity/diff-match-patch
import { makeDiff, DIFF_EQUAL } from '@sanity/diff-match-patch';
import type { WorldData } from './world.engine'; // Adjust path if needed
import type { WorldSettings } from './settings';

// Debounce delay for saving (in milliseconds)
const SAVE_DEBOUNCE_DELAY = 300; // Debounce saves to batch rapid changes (like paste)

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
    setLocalClipboard?: React.Dispatch<React.SetStateAction<any[]>>, // Clipboard setter
    recorder?: any // DataRecorder instance for recording content changes
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

    // Send queue to prevent overlapping saves
    const clientIdRef = useRef<string>(`${Date.now()}-${Math.random().toString(36).substr(2, 6)}`);
    const isSendingRef = useRef(false);
    const pendingSaveRef = useRef(false);

    // Replay sequence counter
    const replayCounterRef = useRef<number>(0);

    // Build world paths directly under /worlds/{userUid}/ when userUid is provided
    const getWorldPath = (worldPath: string) => userUid ? `worlds/${userUid}/${worldPath}` : `worlds/${worldPath}`;

    // For blog posts, use direct path structure: worlds/blog/posts/{post}/data
    const isBlogs = userUid === 'blog' && worldId === 'posts';

    // Data path (direct saves to canonical location)
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

    const clipboardRefPath = worldId ?
        (currentStateName ?
            (isBlogs ? `worlds/blog/posts/${currentStateName}/clipboard` : getWorldPath(`${currentStateName}/clipboard`)) :
            (isBlogs ? null : getWorldPath(`${worldId}/clipboard`))) :
        null;

    const replayRefPath = worldId ?
        (currentStateName ?
            (isBlogs ? `worlds/blog/posts/${currentStateName}/replay` : getWorldPath(`${currentStateName}/replay`)) :
            (isBlogs ? null : getWorldPath(`${worldId}/replay`))) :
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
            logger.debug(`📥 Settings received from Firebase:`, settings);
            if (settings) {
                setLocalSettings(settings);
                lastSyncedSettingsRef.current = { ...settings };
                logger.debug(`📥 Applied settings locally:`, settings);
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
                    // Update local state and lastSyncedDataRef atomically
                    setLocalWorldData((prevData: WorldData) => {
                        const isDuplicate = prevData[key] && JSON.stringify(prevData[key]) === JSON.stringify(value);
                        if (isDuplicate) {
                            // Confirmed echo - safe to update lastSyncedDataRef
                            if (lastSyncedDataRef.current) {
                                lastSyncedDataRef.current[key] = value;
                            }
                            logger.debug(`📥 Received duplicate for ${key}, skipping render`);
                            return prevData;
                        }

                        // New data from Firebase (possibly from another client or initial sync)
                        // Only update lastSyncedDataRef if we're actually applying this change
                        if (lastSyncedDataRef.current) {
                            lastSyncedDataRef.current[key] = value;
                        }
                        logger.debug(`📥 Received new data for ${key}`);
                        return { ...prevData, [key]: value };
                    });
                }
            }),
            onChildChanged(dataRef, (snapshot) => {
                const key = snapshot.key;
                const value = snapshot.val();
                if (!key || !autoLoadData) return;

                // Update local state and lastSyncedDataRef atomically
                setLocalWorldData((prevData: WorldData) => {
                    const isDuplicate = prevData[key] && JSON.stringify(prevData[key]) === JSON.stringify(value);
                    if (isDuplicate) {
                        // Confirmed echo - safe to update lastSyncedDataRef
                        if (lastSyncedDataRef.current) {
                            lastSyncedDataRef.current[key] = value;
                        }
                        logger.debug(`📥 Received duplicate change for ${key}, skipping render`);
                        return prevData;
                    }

                    // New data from Firebase (possibly from another client or initial sync)
                    // Only update lastSyncedDataRef if we're actually applying this change
                    if (lastSyncedDataRef.current) {
                        lastSyncedDataRef.current[key] = value;
                    }
                    logger.debug(`📥 Received changed data for ${key}`);
                    return { ...prevData, [key]: value };
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

        get(dataRef).then(async () => {
            clearTimeout(timeoutId);
            if (autoLoadData) {
                setLocalWorldData(initialData);
                lastSyncedDataRef.current = { ...initialData };
            } else {
                lastSyncedDataRef.current = initialData;
            }
            initialDataLoaded = true;

            // Initialize replay counter by finding max index in replay log
            if (replayRefPath) {
                try {
                    const replayRef = ref(database, replayRefPath);
                    const replaySnapshot = await get(replayRef);
                    if (replaySnapshot.exists()) {
                        const replayData = replaySnapshot.val();
                        const indices = Object.keys(replayData).map(k => parseInt(k, 10));
                        const maxIndex = Math.max(...indices);
                        replayCounterRef.current = maxIndex + 1;
                        logger.debug(`📼 Replay counter initialized to ${replayCounterRef.current}`);
                    } else {
                        replayCounterRef.current = 0;
                        logger.debug(`📼 Replay log empty, counter initialized to 0`);
                    }
                } catch (err) {
                    logger.warn('Failed to initialize replay counter:', err);
                    replayCounterRef.current = 0;
                }
            }

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

    // --- Save Data (Direct to Firebase) ---
    useEffect(() => {
        if (isLoading || !worldId || !worldDataRefPath || !lastSyncedDataRef.current) {
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
            // Even if no changes detected, check if there's a pending save to retry
            if (pendingSaveRef.current) {
                logger.debug(`📤 No changes detected but pending save exists, forcing retry`);
                pendingSaveRef.current = false;
                setTimeout(() => setError(null), 5);
            }
            return;
        }

        saveTimeoutRef.current = setTimeout(async () => {
            if (!worldId || !worldDataRefPath) return;

            // If already sending, mark pending and return
            if (isSendingRef.current) {
                pendingSaveRef.current = true;
                logger.debug(`📤 Save already in progress, marking pending`);
                return;
            }

            isSendingRef.current = true;
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

                // Direct save - write only changed keys to avoid overwriting other users' data
                const updates: Record<string, any> = {};

                // Add/update changed keys (direct values, no conflict resolution)
                for (const [key, value] of Object.entries(cleanWorldData)) {
                    const lastSyncedValue = lastSyncedDataRef.current?.[key];

                    // Fast path for simple string values (most common case)
                    if (typeof value === 'string' && typeof lastSyncedValue === 'string') {
                        if (value !== lastSyncedValue) {
                            updates[`${worldDataRefPath}/${key}`] = value;
                            logger.debug(`📤 Sending ${key} from client ${clientIdRef.current}`);
                        }
                    } else {
                        // Slow path for objects/complex values
                        if (JSON.stringify(value) !== JSON.stringify(lastSyncedValue)) {
                            updates[`${worldDataRefPath}/${key}`] = value;
                            logger.debug(`📤 Sending ${key} from client ${clientIdRef.current}`);
                        }
                    }
                }

                // Delete removed keys
                const lastSyncedKeys = Object.keys(lastSyncedDataRef.current || {});
                const currentKeys = Object.keys(cleanWorldData);
                const deletedKeys = lastSyncedKeys.filter(k => !currentKeys.includes(k));

                for (const key of deletedKeys) {
                    updates[`${worldDataRefPath}/${key}`] = null;
                    logger.debug(`📤 Deleting ${key} from client ${clientIdRef.current}`);
                }

                // Only write if there are changes
                if (Object.keys(updates).length > 0) {
                    logger.debug(`📤 Sending ${Object.keys(updates).length} updates to Firebase`, updates);

                    // Add replay log entries for each change
                    if (replayRefPath) {
                        for (const [fullPath, value] of Object.entries(updates)) {
                            // Extract the key from the full path (e.g., "worlds/uid/home/data/5,10" -> "5,10")
                            const key = fullPath.split('/').pop();
                            if (key) {
                                const replayEntry = {
                                    key,
                                    value,
                                    timestamp: Date.now()
                                };
                                updates[`${replayRefPath}/${replayCounterRef.current}`] = replayEntry;
                                replayCounterRef.current++;
                            }
                        }
                    }

                    // Record content changes for session recording
                    if (recorder && recorder.isRecording) {
                        for (const [fullPath, value] of Object.entries(updates)) {
                            // Extract the key from the full path
                            const key = fullPath.split('/').pop();
                            if (key && !fullPath.includes('/replay/')) { // Skip replay log entries
                                recorder.recordContentChange(key, value);
                            }
                        }
                    }

                    await update(ref(database), updates);

                    // Note: Firebase listeners will update lastSyncedDataRef when data is confirmed
                    // No optimistic updates to prevent race conditions during simultaneous typing
                    logger.debug(`✅ Write complete, waiting for Firebase confirmation`);
                }
            } catch (err: any) {
                // Silently skip permission errors (viewing other users' states or new states)
                if (err.code !== 'PERMISSION_DENIED' && !err.message?.includes('Permission denied')) {
                    logger.error("Firebase: Error saving data:", err);
                    setError(`Failed to save world data: ${err.message}`);
                }
            } finally {
                setIsSaving(false);
                isSendingRef.current = false;

                // If there's a pending save, trigger it with a micro-delay
                if (pendingSaveRef.current) {
                    pendingSaveRef.current = false;
                    logger.debug(`📤 Triggering pending save with micro-delay`);
                    // Micro-delay to ensure Firebase listeners have processed
                    setTimeout(() => {
                        setError(null); // Trigger re-run
                    }, 5);
                }
            }
        }, SAVE_DEBOUNCE_DELAY);

        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, [localWorldData, isLoading, worldId, worldDataRefPath, isBlogs, isReadOnly]);


    // --- Save Settings on Change (Debounced) ---
    useEffect(() => {
        logger.debug(`🔍 Settings save effect triggered. Loading: ${isLoading}, worldId: ${worldId}, settingsRefPath: ${settingsRefPath}, readOnly: ${isReadOnly}`);

        if (isLoading || !worldId || !settingsRefPath || !lastSyncedSettingsRef.current) {
            logger.debug(`🔍 Settings save skipped - missing requirements`);
            return;
        }

        // Skip settings saves in read-only mode
        if (isReadOnly) {
            logger.debug(`🔍 Settings save skipped - read-only mode`);
            return;
        }

        if (settingsSaveTimeoutRef.current) {
            clearTimeout(settingsSaveTimeoutRef.current);
        }

        const currentSettingsStr = JSON.stringify(localSettings);
        const lastSyncedStr = JSON.stringify(lastSyncedSettingsRef.current);
        logger.debug(`🔍 Settings comparison - Current: ${currentSettingsStr.slice(0, 100)}..., LastSynced: ${lastSyncedStr.slice(0, 100)}...`);

        if (currentSettingsStr === lastSyncedStr) {
            logger.debug(`🔍 Settings save skipped - no changes detected`);
            return;
        }

        logger.debug(`🔍 Settings changed - scheduling save`);

        settingsSaveTimeoutRef.current = setTimeout(async () => {
            if (!worldId || !settingsRefPath) return;

            logger.debug(`📤 Saving settings to ${settingsRefPath}:`, localSettings);
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
                logger.debug(`📤 Clean settings to save:`, cleanSettings);

                await set(dbRef, cleanSettings);
                lastSyncedSettingsRef.current = { ...localSettings };
                logger.debug(`✅ Settings saved successfully to Firebase`);
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

            // Clear world data
            if (worldDataRefPath) {
                updates[worldDataRefPath] = null;
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
    }, [worldId, worldDataRefPath, clipboardRefPath, isReadOnly, isBlogs]);

    // Function to fetch replay log
    const fetchReplayLog = useCallback(async (): Promise<Array<{ key: string; value: any; timestamp: number }>> => {
        if (!replayRefPath) {
            return [];
        }

        try {
            const replayRef = ref(database, replayRefPath);
            const snapshot = await get(replayRef);

            if (!snapshot.exists()) {
                return [];
            }

            const replayData = snapshot.val();

            // Convert to array and sort by index
            return Object.entries(replayData)
                .sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10))
                .map(([_, entry]) => entry as { key: string; value: any; timestamp: number });
        } catch (err: any) {
            logger.error('Firebase: Error fetching replay log:', err);
            return [];
        }
    }, [replayRefPath]);

    return { isLoading, isSaving, error, clearWorldData, fetchReplayLog };
}
 