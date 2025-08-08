import { useState, useEffect, useRef, useCallback } from 'react';
import { database } from '@/app/firebase'; // Adjust path if needed
import { ref, set, onValue, off, DataSnapshot, update } from 'firebase/database';
import type { WorldData } from './world.engine.new'; // Adjust path if needed
import { TextThemeName, BackgroundThemeName, TextTheme, BackgroundTheme, RunePathEffects, RunePathEffectName } from './themes';
import equal from 'fast-deep-equal';

// --- INTERFACES & CONSTANTS ---

// Debounce delay for saving (in milliseconds)
const SAVE_DEBOUNCE_DELAY = 100;

// Maximum number of history states to keep
const MAX_HISTORY_STATES = 100;

// Interface for theme and layer settings
export interface ThemeSettings {
  textTheme: TextThemeName;
  backgroundTheme: BackgroundThemeName;
  font?: string;
  layerSettings?: {
    layerCount: number;
    currentLayer: number;
    inactiveLayerOpacity: number;
    layerVisibilityFactor: number;
    isLayerLocked: boolean;
  };
  runes?: { [position: string]: string; };
  userTextPresets?: TextTheme[];
  userBackgroundPresets?: BackgroundTheme[];
  userPathPresets?: RunePathEffects[];
  currentRunePathEffect?: RunePathEffectName;
  customRunePathColor?: string;
  runePathSpeed?: number;
  runePathFadeLength?: number;
}

// --- HELPER FUNCTIONS ---

/**
 * Recursively sanitizes an object for Firebase by converting undefined values to null.
 */
const sanitizeForFirebase = (obj: any): any => {
  if (obj === undefined) {
    return null;
  }
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForFirebase(item));
  }
  const sanitizedObj: { [key: string]: any } = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      sanitizedObj[key] = sanitizeForFirebase(obj[key]);
    }
  }
  return sanitizedObj;
};

/**
 * Recursively calculates a deep diff between two objects, generating a flat
 * object with slash-separated paths suitable for Firebase's update() method.
 */
const calculateDeepDiff = (current: any, base: any, path: string = ''): { [key: string]: any } => {
    const updates: { [key: string]: any } = {};
    const currentObj = (current !== null && typeof current === 'object') ? current : {};
    const baseObj = (base !== null && typeof base === 'object') ? base : {};
    const allKeys = new Set([...Object.keys(currentObj), ...Object.keys(baseObj)]);

    for (const key of allKeys) {
        const currentPath = path ? `${path}/${key}` : key;
        const currentValue = currentObj[key];
        const baseValue = baseObj[key];

        if (equal(currentValue, baseValue)) continue;

        if (currentValue === undefined && key in currentObj) {
            updates[currentPath] = null; // Explicit undefined becomes a delete
        } else if (!(key in currentObj) && key in baseObj) {
            updates[currentPath] = null; // Key deleted in current
        } else if (
            typeof currentValue === 'object' && currentValue !== null && !Array.isArray(currentValue) &&
            typeof baseValue === 'object' && baseValue !== null && !Array.isArray(baseValue)
        ) {
            const nestedUpdates = calculateDeepDiff(currentValue, baseValue, currentPath);
            Object.assign(updates, nestedUpdates);
        } else {
            updates[currentPath] = sanitizeForFirebase(currentValue);
        }
    }
    return updates;
};

/**
 * Applies a diff patch (from calculateDeepDiff) to a base object, creating a new merged object.
 * This is essential for merging pending local changes with incoming server data.
 */
const applyPatch = (base: any, patch: { [path: string]: any }): any => {
    const result = JSON.parse(JSON.stringify(base)); // Deep copy to avoid mutation

    for (const path in patch) {
        const value = patch[path];
        const parts = path.split('/');
        let current = result;

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (current[part] === undefined || typeof current[part] !== 'object' || current[part] === null) {
                current[part] = {}; // Create nested objects if they don't exist
            }
            current = current[part];
        }

        const lastPart = parts[parts.length - 1];
        if (value === null) {
            delete current[lastPart]; // A null value in a patch means delete
        } else {
            current[lastPart] = value;
        }
    }
    return result;
};

// --- THE REACT HOOK ---

export function useWorldSave(
    worldId: string | null,
    localWorldData: WorldData,
    setLocalWorldDataDirectly: (updater: WorldData | ((prevState: WorldData) => WorldData)) => void,
    themeSettings?: ThemeSettings,
    setThemeSettings?: (settings: ThemeSettings) => void,
    currentUserId?: string | null
) {
    const [isLoadingInitial, setIsLoadingInitial] = useState(true);
    const [isSavingUI, setIsSavingUI] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [themeLoaded, setThemeLoaded] = useState(false);

    const lastSyncedDataRef = useRef<WorldData | null>(null);
    const lastSyncedThemeRef = useRef<ThemeSettings | null>(null);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const themeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const historyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const [undoStack, setUndoStack] = useState<WorldData[]>([]);
    const [redoStack, setRedoStack] = useState<WorldData[]>([]);
    const isUndoRedoOperationRef = useRef(false);
    const lastHistoryStateRef = useRef<WorldData | null>(null);

    const isMountedRef = useRef(true);
    const initialDataLoaded = useRef(false);
    const isSavingRef = useRef(false);

    const latestLocalDataForSaveRef = useRef<WorldData>(localWorldData);
    useEffect(() => {
        latestLocalDataForSaveRef.current = localWorldData;
    }, [localWorldData]);

    const worldDataRefPath = worldId ? `worlds/${worldId}/data` : null;
    const themeSettingsRefPath = worldId ? `worlds/${worldId}/theme` : null;

    // --- History (Undo/Redo) Management ---
    const pushToHistory = useCallback((dataToSave: WorldData) => {
        if (isUndoRedoOperationRef.current || equal(dataToSave, lastHistoryStateRef.current)) return;
        lastHistoryStateRef.current = { ...dataToSave };
        setUndoStack(prev => {
            const newStack = [...prev, dataToSave];
            return newStack.length > MAX_HISTORY_STATES ? newStack.slice(newStack.length - MAX_HISTORY_STATES) : newStack;
        });
        setRedoStack([]);
    }, []);

    const undo = useCallback(() => {
        if (undoStack.length === 0) return false;
        setUndoStack(prev => {
            const newStack = [...prev];
            const previousState = newStack.pop();
            if (!previousState) return prev;
            isUndoRedoOperationRef.current = true;
            setRedoStack(currentRedoStack => [...currentRedoStack, latestLocalDataForSaveRef.current]);
            setLocalWorldDataDirectly(previousState);
            setTimeout(() => { isUndoRedoOperationRef.current = false; }, 0);
            return newStack;
        });
        return true;
    }, [undoStack, setLocalWorldDataDirectly]);

    const redo = useCallback(() => {
        if (redoStack.length === 0) return false;
        setRedoStack(prev => {
            const newStack = [...prev];
            const nextState = newStack.pop();
            if (!nextState) return prev;
            isUndoRedoOperationRef.current = true;
            setUndoStack(currentUndoStack => [...currentUndoStack, latestLocalDataForSaveRef.current]);
            setLocalWorldDataDirectly(nextState);
            setTimeout(() => { isUndoRedoOperationRef.current = false; }, 0);
            return newStack;
        });
        return true;
    }, [redoStack, setLocalWorldDataDirectly]);

    useEffect(() => {
        if (isLoadingInitial || isUndoRedoOperationRef.current) return;
        if (historyTimeoutRef.current) clearTimeout(historyTimeoutRef.current);
        historyTimeoutRef.current = setTimeout(() => {
            pushToHistory({...latestLocalDataForSaveRef.current});
        }, SAVE_DEBOUNCE_DELAY);
        return () => { if (historyTimeoutRef.current) clearTimeout(historyTimeoutRef.current); };
    }, [localWorldData, isLoadingInitial, pushToHistory]);


    // --- Data Loading and Synchronization (FIXED LOGIC) ---
    useEffect(() => {
        isMountedRef.current = true;
        if (!worldId || !worldDataRefPath) {
            setIsLoadingInitial(false);
            initialDataLoaded.current = true;
            console.warn('useWorldSave: No worldId provided, persistence disabled.');
            return () => { isMountedRef.current = false; };
        }

        if (!initialDataLoaded.current) setIsLoadingInitial(true);
        setError(null);
        const dbRef = ref(database, worldDataRefPath);

        const handleData = (snapshot: DataSnapshot) => {
            if (!isMountedRef.current) return;

            const firebaseData = snapshot.val() as WorldData | null;
            const latestFirebaseState = firebaseData || {};
            const previousSyncState = lastSyncedDataRef.current || {};
            lastSyncedDataRef.current = { ...latestFirebaseState };

            if (!initialDataLoaded.current) {
                setLocalWorldDataDirectly(latestFirebaseState);
                initialDataLoaded.current = true;
                setIsLoadingInitial(false);
                return;
            }

            if (isSavingRef.current) {
                isSavingRef.current = false;
                setIsSavingUI(false);
                return;
            }

            // **INTELLIGENT MERGE TO PREVENT DISAPPEARING TEXT**
            setLocalWorldDataDirectly(currentLocalData => {
                const pendingLocalChanges = calculateDeepDiff(currentLocalData, previousSyncState);

                if (Object.keys(pendingLocalChanges).length === 0) {
                    return latestFirebaseState; // No local changes, safe to accept server state
                }

                // Merge: Apply our pending local changes on top of the new server state
                console.log("Merging external changes with pending local changes.");
                const mergedData = applyPatch(latestFirebaseState, pendingLocalChanges);

                return equal(mergedData, currentLocalData) ? currentLocalData : mergedData;
            });
        };

        const handleError = (err: Error) => {
            if (!isMountedRef.current) return;
            setError(`Failed to load world data: ${err.message}`);
            setIsLoadingInitial(false);
            initialDataLoaded.current = true;
            isSavingRef.current = false;
            setIsSavingUI(false);
        };

        const listener = onValue(dbRef, handleData, handleError);

        return () => {
            isMountedRef.current = false;
            off(dbRef, 'value', listener);
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            if (historyTimeoutRef.current) clearTimeout(historyTimeoutRef.current);
            if (themeTimeoutRef.current) clearTimeout(themeTimeoutRef.current);
        };
    }, [worldId, worldDataRefPath, setLocalWorldDataDirectly]);


    // --- Data Saving Effect (Uses Deep Diff) ---
    useEffect(() => {
        if (!initialDataLoaded.current || !worldId || !worldDataRefPath || isUndoRedoOperationRef.current || isSavingRef.current) {
            return;
        }

        const updatesNeeded = calculateDeepDiff(latestLocalDataForSaveRef.current, lastSyncedDataRef.current);
        
        if (Object.keys(updatesNeeded).length === 0) {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            if (isSavingUI) setIsSavingUI(false);
            return;
        }

        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        setIsSavingUI(true);

        saveTimeoutRef.current = setTimeout(async () => {
            saveTimeoutRef.current = null;
            const updatesToSend = calculateDeepDiff(latestLocalDataForSaveRef.current, lastSyncedDataRef.current);

            if (Object.keys(updatesToSend).length === 0) {
                setIsSavingUI(false);
                return;
            }

            if (!currentUserId) {
                console.warn("[Save Timeout] Aborted: User not logged in.");
                setError("You must be logged in to save changes.");
                setIsSavingUI(false);
                return;
            }

            isSavingRef.current = true;
            setError(null);
            const dbRef = ref(database, worldDataRefPath);

            try {
                await update(dbRef, updatesToSend);
            } catch (err: any) {
                console.error("[Save Timeout] Firebase update error:", err);
                setError(`Failed to save world data: ${err.message}`);
                isSavingRef.current = false;
                setIsSavingUI(false);
            }
        }, SAVE_DEBOUNCE_DELAY);

        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
                saveTimeoutRef.current = null;
                setIsSavingUI(false);
            }
        };
    }, [localWorldData, worldId, worldDataRefPath, currentUserId]);


    // --- Theme Management (Unchanged) ---
    useEffect(() => {
        if (!worldId || !themeSettingsRefPath || !setThemeSettings) {
            setThemeLoaded(true);
            return;
        }
        const themeRef = ref(database, themeSettingsRefPath);
        const handleThemeData = (snapshot: DataSnapshot) => {
            if (!isMountedRef.current) return;
            const themeData = snapshot.val() as ThemeSettings | null;
            if (themeData && !equal(themeData, lastSyncedThemeRef.current)) {
                setThemeSettings(themeData);
                lastSyncedThemeRef.current = { ...themeData };
            }
            setThemeLoaded(true);
        };
        const handleError = (err: Error) => { if (!isMountedRef.current) return; setThemeLoaded(true); };
        onValue(themeRef, handleThemeData, handleError);
        return () => { off(themeRef, 'value', handleThemeData); if (themeTimeoutRef.current) clearTimeout(themeTimeoutRef.current); };
    }, [worldId, themeSettingsRefPath, setThemeSettings]);

    useEffect(() => {
        if (!themeSettings || !setThemeSettings || !worldId || !themeSettingsRefPath || !themeLoaded || equal(themeSettings, lastSyncedThemeRef.current)) return;
        
        if (themeTimeoutRef.current) clearTimeout(themeTimeoutRef.current);
        
        themeTimeoutRef.current = setTimeout(async () => {
            if (!isMountedRef.current) return;
            if (!currentUserId) {
                console.warn("[Theme Save Timeout] Aborted: User not logged in.");
                return; 
            }
            try {
                const themeRef = ref(database, themeSettingsRefPath);
                await set(themeRef, themeSettings);
                lastSyncedThemeRef.current = { ...themeSettings };
            } catch (err: any) {
                console.error("Failed to save theme settings", err);
            }
        }, SAVE_DEBOUNCE_DELAY);

        return () => { if (themeTimeoutRef.current) clearTimeout(themeTimeoutRef.current); };
    }, [themeSettings, worldId, themeSettingsRefPath, themeLoaded, setThemeSettings, currentUserId]);

    
    return {
        isLoading: isLoadingInitial || !themeLoaded,
        isSaving: isSavingUI,
        error,
        undo,
        redo,
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0
    };
}