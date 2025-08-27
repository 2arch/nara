// hooks/useWorldEngine.ts
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useWorldSave } from './world.save'; // Import the new hook
import { useCommandSystem, CommandState, CommandExecution, BackgroundMode } from './commands'; // Import command system
import { getSmartIndentation, calculateWordDeletion } from './text-blocks'; // Import block detection utilities
import { useDeepspawnSystem } from './deepspawn'; // Import deepspawn system
import { useWorldSettings, WorldSettings } from './settings';
import { set, ref } from 'firebase/database';
import { database } from '@/app/firebase';
import { transformText, explainText, summarizeText, createSubtitleCycler, chatWithAI, clearChatHistory, setDialogueWithRevert } from './ai';
import { get } from 'firebase/database';

// --- Constants --- (Copied and relevant ones kept)
const BASE_FONT_SIZE = 16;
const BASE_CHAR_WIDTH = BASE_FONT_SIZE * 0.6;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5.0;
const ZOOM_SENSITIVITY = 0.002;

// --- Block Management Constants ---
const BLOCK_PREFIX = 'block_';// Circle packing constants
const MIN_BLOCK_DISTANCE = 6;  // Minimum cells between blocks

// --- Interfaces ---
export interface StyledCharacter {
    char: string;
    style?: {
        color?: string;
        background?: string;
    };
}

export interface WorldData { [key: string]: string | StyledCharacter; }
export interface Point { x: number; y: number; }

export interface PanStartInfo {
    startX: number;
    startY: number;
    startOffset: Point;
}

export interface WorldEngine {
    worldData: WorldData;
    deepspawnData: WorldData;
    commandData: WorldData;
    commandState: CommandState;
    chatData: WorldData;
    lightModeData: WorldData;
    searchData: WorldData;
    viewOffset: Point;
    cursorPos: Point;
    zoomLevel: number;
    panningDirection: number | null;
    backgroundMode: BackgroundMode;
    backgroundColor: string;
    backgroundImage?: string;
    backgroundVideo?: string;
    textColor: string;
    currentTextStyle: {
        color: string;
        background?: string;
    };
    searchPattern: string;
    isSearchActive: boolean;
    clearSearch: () => void;
    settings: WorldSettings;
    updateSettings: (newSettings: Partial<WorldSettings>) => void;
    getEffectiveCharDims: (zoom: number) => { width: number; height: number; fontSize: number; };
    screenToWorld: (screenX: number, screenY: number, currentZoom: number, currentOffset: Point) => Point;
    worldToScreen: (worldX: number, worldY: number, currentZoom: number, currentOffset: Point) => Point;
    handleCanvasClick: (canvasRelativeX: number, canvasRelativeY: number, clearSelection?: boolean, shiftKey?: boolean) => void;
    handleCanvasWheel: (deltaX: number, deltaY: number, canvasRelativeX: number, canvasRelativeY: number, ctrlOrMetaKey: boolean) => void;
    handlePanStart: (clientX: number, clientY: number) => PanStartInfo | null;
    handlePanMove: (clientX: number, clientY: number, panStartInfo: PanStartInfo) => Point;
    handlePanEnd: (newOffset: Point) => void;
    handleKeyDown: (key: string, ctrlKey: boolean, metaKey: boolean, shiftKey: boolean) => boolean;
    setViewOffset: React.Dispatch<React.SetStateAction<Point>>;
    setZoomLevel: React.Dispatch<React.SetStateAction<number>>;
    selectionStart: Point | null;
    selectionEnd: Point | null;
    handleSelectionStart: (canvasRelativeX: number, canvasRelativeY: number) => void;
    handleSelectionMove: (canvasRelativeX: number, canvasRelativeY: number) => void;
    handleSelectionEnd: () => void;
    deleteCharacter: (x: number, y: number) => void;
    placeCharacter: (char: string, x: number, y: number) => void;
    deleteSelection: () => boolean;
    copySelection: () => boolean;
    cutSelection: () => boolean;
    paste: () => Promise<boolean>;
    isLoadingWorld: boolean;
    isSavingWorld: boolean;
    worldPersistenceError: string | null;
    getViewportCenter: () => Point;
    getCursorDistanceFromCenter: () => number;
    getBlocksInRegion: (center: Point, radius: number) => Point[];
    isBlock: (x: number, y: number) => boolean;
    directionPoints: { current: Point & { timestamp: number } | null, previous: Point & { timestamp: number } | null };
    getAngleDebugData: () => { firstPoint: Point & { timestamp: number }, lastPoint: Point & { timestamp: number }, angle: number, degrees: number, pointCount: number } | null;
    settings: WorldSettings;
    dialogueText: string;
    setDialogueText: (text: string) => void;
    chatMode: {
        isActive: boolean;
        currentInput: string;
        inputPositions: Point[];
        isProcessing: boolean;
    };
    setChatMode: React.Dispatch<React.SetStateAction<{
        isActive: boolean;
        currentInput: string;
        inputPositions: Point[];
        isProcessing: boolean;
    }>>;
    // Text compilation access
    getCompiledText: () => { [lineY: number]: string };
    // Navigation system properties
    isNavVisible: boolean;
    setIsNavVisible: (visible: boolean) => void;
    navOriginPosition: Point;
    navColorFilters: Set<string>;
    navSortMode: 'chronological' | 'closest' | 'farthest';
    getAllLabels: () => Array<{text: string, x: number, y: number, color: string}>;
    getSortedLabels: (sortMode: 'chronological' | 'closest' | 'farthest', originPos: Point) => Array<{text: string, x: number, y: number, color: string}>;
    getUniqueColors: () => string[];
    toggleColorFilter: (color: string) => void;
    cycleSortMode: () => void;
    getCharacter: (data: string | StyledCharacter) => string;
    getCharacterStyle: (data: string | StyledCharacter) => { color?: string; background?: string } | undefined;
}

// --- Hook Input ---
interface UseWorldEngineProps {
    initialWorldData?: WorldData; // Optional initial data (might be overridden by Firebase)
    initialCursorPos?: Point;
    initialViewOffset?: Point;
    initialZoomLevel?: number;
    worldId: string | null; // Add worldId for persistence
    initialBackgroundColor?: string;
}

// --- The Hook ---
export function useWorldEngine({
    initialWorldData = {},
    initialCursorPos = { x: 0, y: 0 },
    initialViewOffset = { x: 0, y: 0 },
    initialZoomLevel = 1, // Default zoom level index
    worldId = null,      // Default to no persistence
    initialBackgroundColor,
}: UseWorldEngineProps): WorldEngine {
    // === State ===
    const [worldData, setWorldData] = useState<WorldData>(initialWorldData);
    const [cursorPos, setCursorPos] = useState<Point>(initialCursorPos);
    const [viewOffset, setViewOffset] = useState<Point>(initialViewOffset);
    const [zoomLevel, setZoomLevel] = useState<number>(initialZoomLevel); // Store zoom *level*, not index
    const [dialogueText, setDialogueText] = useState('');
    
    // === Chat Mode State ===
    const [chatMode, setChatMode] = useState<{
        isActive: boolean;
        currentInput: string;
        inputPositions: Point[];
        isProcessing: boolean;
    }>({
        isActive: false,
        currentInput: '',
        inputPositions: [],
        isProcessing: false
    });
    
    const [chatData, setChatData] = useState<WorldData>({});
    const [searchData, setSearchData] = useState<WorldData>({});
    
    // === State Management System ===
    const [statePrompt, setStatePrompt] = useState<{
        type: 'load_confirm' | 'save_before_load_confirm' | 'save_before_load_name' | 'delete_confirm' | null;
        stateName?: string;
        loadStateName?: string; // The state we want to load after saving
        inputBuffer?: string;
    }>({ type: null });
    const [availableStates, setAvailableStates] = useState<string[]>([]);
    const [currentStateName, setCurrentStateName] = useState<string | null>(null); // Track which state we're currently in

    const getAllLabels = useCallback(() => {
        const labels: Array<{text: string, x: number, y: number, color: string}> = [];
        for (const key in worldData) {
            if (key.startsWith('label_')) {
                const coordsStr = key.substring('label_'.length);
                const [xStr, yStr] = coordsStr.split(',');
                const x = parseInt(xStr, 10);
                const y = parseInt(yStr, 10);
                if (!isNaN(x) && !isNaN(y)) {
                    try {
                        const labelData = JSON.parse(worldData[key]);
                        const text = labelData.text || '';
                        const color = labelData.color || '#000000';
                        if (text.trim()) {
                            labels.push({ text, x, y, color });
                        }
                    } catch (e) {
                        // Skip invalid label data
                    }
                }
            }
        }
        return labels;
    }, [worldData]);

    // === Command System ===
    const { 
        commandState, 
        commandData, 
        handleKeyDown: handleCommandKeyDown,
        pendingCommand,
        executePendingCommand,
        setPendingCommand,
        currentMode,
        addEphemeralText,
        lightModeData,
        backgroundMode,
        backgroundColor,
        backgroundImage,
        backgroundVideo,
        backgroundStream,
        textColor,
        currentTextStyle,
        searchPattern,
        isSearchActive,
        clearSearch,
    } = useCommandSystem({ setDialogueText, initialBackgroundColor, getAllLabels, availableStates });

    // Generate search data when search pattern changes
    useEffect(() => {
        if (!isSearchActive || !searchPattern.trim()) {
            setSearchData({});
            return;
        }

        const newSearchData: WorldData = {};
        const pattern = searchPattern.toLowerCase();

        // Search through worldData for matches
        for (const key in worldData) {
            // Skip special keys (blocks, labels, etc.)
            if (key.startsWith('block_') || key.startsWith('deepspawn_') || key.startsWith('label_')) {
                continue;
            }

            const [xStr, yStr] = key.split(',');
            const x = parseInt(xStr, 10);
            const y = parseInt(yStr, 10);
            const charData = worldData[key];
            const char = getCharacter(charData);

            if (char && !isNaN(x) && !isNaN(y)) {
                // Check if this position starts a match
                let matchFound = false;
                let matchLength = 0;

                // Build text string from current position
                let textAtPosition = '';
                for (let i = 0; i < pattern.length; i++) {
                    const checkKey = `${x + i},${y}`;
                    const checkCharData = worldData[checkKey];
                    if (checkCharData) {
                        const checkChar = getCharacter(checkCharData);
                        textAtPosition += checkChar.toLowerCase();
                    } else {
                        break;
                    }
                }

                // Check if the built text matches the pattern
                if (textAtPosition === pattern) {
                    matchFound = true;
                    matchLength = pattern.length;
                }

                // If match found, mark all characters in the match
                if (matchFound) {
                    for (let i = 0; i < matchLength; i++) {
                        const matchKey = `${x + i},${y}`;
                        if (worldData[matchKey]) {
                            newSearchData[matchKey] = worldData[matchKey];
                        }
                    }
                }
            }
        }

        setSearchData(newSearchData);
    }, [isSearchActive, searchPattern, worldData]);
    
    // === Settings System ===
    const { settings, setSettings, updateSettings } = useWorldSettings();
    
    // === Ambient Text Compilation System ===
    const [compiledTextCache, setCompiledTextCache] = useState<{ [lineY: number]: string }>({});
    const lastCompiledRef = useRef<{ [lineY: number]: string }>({});
    const compilationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    
    const compileTextStrings = useCallback((worldData: WorldData): { [lineY: number]: string } => {
        const compiledLines: { [lineY: number]: string } = {};
        const lineData: { [lineY: number]: Array<{ x: number, char: string }> } = {};
        
        // Group characters by line
        for (const key in worldData) {
            // Skip special keys (blocks, labels, etc.)
            if (key.startsWith('block_') || key.startsWith('deepspawn_') || key.startsWith('label_')) {
                continue;
            }
            
            const [xStr, yStr] = key.split(',');
            const x = parseInt(xStr, 10);
            const y = parseInt(yStr, 10);
            
            if (!isNaN(x) && !isNaN(y)) {
                const char = getCharacter(worldData[key]);
                
                if (!lineData[y]) {
                    lineData[y] = [];
                }
                lineData[y].push({ x, char });
            }
        }
        
        // Compile each line into a string
        for (const lineY in lineData) {
            const y = parseInt(lineY, 10);
            const chars = lineData[y].sort((a, b) => a.x - b.x);
            
            if (chars.length === 0) continue;
            
            // Build string with proper spacing
            let line = '';
            let lastX = chars[0].x - 1;
            
            for (const { x, char } of chars) {
                // Add spaces for gaps
                while (lastX + 1 < x) {
                    line += ' ';
                    lastX++;
                }
                line += char;
                lastX = x;
            }
            
            // Only store non-empty lines
            if (line.trim()) {
                compiledLines[y] = line;
            }
        }
        
        return compiledLines;
    }, []);

    // Ambient text compilation and Firebase sync
    useEffect(() => {
        if (!worldId) return;

        // Clear any pending compilation
        if (compilationTimeoutRef.current) {
            clearTimeout(compilationTimeoutRef.current);
        }

        // Debounced compilation (300ms after last change)
        compilationTimeoutRef.current = setTimeout(() => {
            const compiled = compileTextStrings(worldData);
            const changes: { [lineY: number]: { old: string | undefined, new: string } } = {};
            
            // Detect changes
            for (const lineY in compiled) {
                const y = parseInt(lineY);
                if (lastCompiledRef.current[y] !== compiled[y]) {
                    changes[y] = {
                        old: lastCompiledRef.current[y],
                        new: compiled[y]
                    };
                }
            }
            
            // Detect deletions
            for (const lineY in lastCompiledRef.current) {
                const y = parseInt(lineY);
                if (!compiled[y]) {
                    changes[y] = {
                        old: lastCompiledRef.current[y],
                        new: ''
                    };
                }
            }
            
            // Send only changes to Firebase
            if (Object.keys(changes).length > 0) {
                const contentPath = currentStateName ? `worlds/${worldId}/states/${currentStateName}/content` : `worlds/${worldId}/content`;
                const compiledTextRef = ref(database, contentPath);
                
                // Create append operations for changed lines
                const updates: { [path: string]: any } = {};
                for (const lineY in changes) {
                    const change = changes[lineY];
                    if (change.new) {
                        updates[`${lineY}`] = change.new;
                    } else {
                        updates[`${lineY}`] = null; // Delete empty lines
                    }
                }
                
                // Send batch update to Firebase
                set(compiledTextRef, { ...lastCompiledRef.current, ...updates })
                    .then(() => {
                        console.log('Compiled text synced:', { 
                            changedLines: Object.keys(changes).length,
                            changes 
                        });
                        lastCompiledRef.current = compiled;
                        setCompiledTextCache(compiled);
                    })
                    .catch(error => {
                        console.error('Failed to sync compiled text:', error);
                    });
            }
        }, 300); // 300ms debounce

        return () => {
            if (compilationTimeoutRef.current) {
                clearTimeout(compilationTimeoutRef.current);
            }
        };
    }, [worldData, worldId, compileTextStrings, currentStateName]);

    // === State Management Functions ===
    const saveState = useCallback(async (stateName: string): Promise<boolean> => {
        if (!worldId) return false;
        
        try {
            const stateRef = ref(database, `worlds/${worldId}/states/${stateName}`);
            
            // Compile text strings from individual characters
            const compiledText = compileTextStrings(worldData);
            
            const stateData = {
                worldData, // Individual character positions (for canvas)
                compiledText, // Compiled text strings (for text operations)
                settings,
                timestamp: Date.now(),
                cursorPos,
                viewOffset,
                zoomLevel
            };
            
            console.log('Saving state with compiled text:', { 
                characterCount: Object.keys(worldData).length,
                lineCount: Object.keys(compiledText).length,
                compiledText 
            });
            
            await set(stateRef, stateData);
            setCurrentStateName(stateName); // Track that we're now in this state
            return true;
        } catch (error) {
            console.error('Error saving state:', error);
            return false;
        }
    }, [worldId, worldData, settings, cursorPos, viewOffset, zoomLevel]);

    const loadState = useCallback(async (stateName: string): Promise<boolean> => {
        if (!worldId) return false;
        
        try {
            const stateRef = ref(database, `worlds/${worldId}/states/${stateName}`);
            const snapshot = await get(stateRef);
            const stateData = snapshot.val();
            
            if (stateData) {
                setWorldData(stateData.worldData || {});
                if (stateData.settings) {
                    setSettings(stateData.settings);
                }
                if (stateData.cursorPos) {
                    setCursorPos(stateData.cursorPos);
                }
                if (stateData.viewOffset) {
                    setViewOffset(stateData.viewOffset);
                }
                if (stateData.zoomLevel) {
                    setZoomLevel(stateData.zoomLevel);
                }
                
                // Log compiled text if available (for debugging/analysis)
                if (stateData.compiledText) {
                    console.log('Loaded state with compiled text:', {
                        lineCount: Object.keys(stateData.compiledText).length,
                        compiledText: stateData.compiledText
                    });
                }
                
                setCurrentStateName(stateName); // Track that we're now in this state
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error loading state:', error);
            return false;
        }
    }, [worldId, setSettings]);

    const loadAvailableStates = useCallback(async (): Promise<string[]> => {
        console.log('loadAvailableStates called with worldId:', worldId);
        if (!worldId) {
            console.log('No worldId provided, returning empty array');
            return [];
        }
        
        try {
            const statesPath = `worlds/${worldId}/states`;
            console.log('Loading states from path:', statesPath);
            const statesRef = ref(database, statesPath);
            
            // Add timeout to avoid hanging
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Firebase timeout')), 5000);
            });
            
            const snapshot = await Promise.race([
                get(statesRef),
                timeoutPromise
            ]);
            
            const statesData = (snapshot as any).val();
            console.log('Firebase snapshot data:', statesData);
            
            if (statesData && typeof statesData === 'object') {
                const stateNames = Object.keys(statesData).sort();
                console.log('Found states:', stateNames);
                return stateNames;
            }
            console.log('No states found in Firebase');
            return [];
        } catch (error) {
            console.error('Error loading available states:', error);
            console.error('This might be due to Firebase connection limits. Try refreshing the page.');
            return [];
        }
    }, [worldId]);

    const deleteState = useCallback(async (stateName: string): Promise<boolean> => {
        if (!worldId) return false;
        
        try {
            const stateRef = ref(database, `worlds/${worldId}/states/${stateName}`);
            await set(stateRef, null); // Firebase way to delete
            
            // If we're deleting the current state, clear the current state name
            if (currentStateName === stateName) {
                setCurrentStateName(null);
            }
            
            return true;
        } catch (error) {
            console.error('Error deleting state:', error);
            return false;
        }
    }, [worldId, currentStateName]);

    // Load available states on component mount
    useEffect(() => {
        loadAvailableStates().then(states => {
            console.log('Loaded available states:', states);
            setAvailableStates(states);
        });
    }, [loadAvailableStates]);
    
    // Load compiled text on mount
    useEffect(() => {
        if (!worldId) return;
        
        const contentPath = currentStateName ? `worlds/${worldId}/states/${currentStateName}/content` : `worlds/${worldId}/content`;
        const compiledTextRef = ref(database, contentPath);
        get(compiledTextRef).then((snapshot) => {
            const compiledText = snapshot.val();
            if (compiledText) {
                console.log('Loaded existing compiled text:', compiledText);
                lastCompiledRef.current = compiledText;
                setCompiledTextCache(compiledText);
            }
        }).catch(error => {
            console.error('Failed to load compiled text:', error);
        });
    }, [worldId, currentStateName]);

    // Helper function to detect if there's unsaved work
    const hasUnsavedWork = useCallback((): boolean => {
        return Object.keys(worldData).length > 0;
    }, [worldData]);
    
    // === Nav Visibility (Ephemeral - Not Persisted) ===
    const [isNavVisible, setIsNavVisible] = useState(false);
    const [navOriginPosition, setNavOriginPosition] = useState<Point>({ x: 0, y: 0 });
    const [navColorFilters, setNavColorFilters] = useState<Set<string>>(new Set());
    
    // Sort modes: chronological -> closest -> farthest
    type NavSortMode = 'chronological' | 'closest' | 'farthest';
    const [navSortMode, setNavSortMode] = useState<NavSortMode>('chronological');

    // === Immediate Settings Save Function ===
    const saveSettingsToFirebase = useCallback(async (newSettings: Partial<WorldSettings>) => {
        if (!worldId) return;
        
        try {
            const settingsRef = ref(database, `worlds/${worldId}/settings`);
            const updatedSettings = { ...settings, ...newSettings };
            await set(settingsRef, updatedSettings);
            console.log('Settings saved immediately to Firebase:', updatedSettings);
        } catch (error) {
            console.error('Failed to save settings to Firebase:', error);
        }
    }, [worldId, settings]);
    
    // === Deepspawn System ===
    const { 
        deepspawnData, 
        directionPoints, 
        updateDirectionPoint, 
        getPanningDirection, 
        getAngleDebugData 
    } = useDeepspawnSystem(settings.isDeepspawnVisible);

    // Helper function to extract recent text from world data around a position
    const getRecentText = useCallback((centerX: number, centerY: number, radius: number = 20): string => {
        const textChunks: string[] = [];
        
        // Collect text in a radius around the center position
        for (let y = centerY - radius; y <= centerY + radius; y++) {
            let rowText = '';
            for (let x = centerX - radius; x <= centerX + radius; x++) {
                const key = `${x},${y}`;
                const charData = worldData[key];
                if (charData && !key.startsWith('block_') && !key.startsWith('deepspawn_') && !key.startsWith('label_')) {
                    const char = getCharacter(charData);
                    if (char.trim() !== '') {
                        rowText += char;
                    } else {
                        rowText += ' ';
                    }
                } else {
                    rowText += ' ';
                }
            }
            if (rowText.trim()) {
                textChunks.push(rowText.trim());
            }
        }
        
        // Join and clean up the text
        return textChunks.join(' ').replace(/\s+/g, ' ').trim();
    }, [worldData]);
    
    // Calculate panning direction (memoized to avoid recalculating on every render)
    const panningDirection = useMemo(() => getPanningDirection(), [getPanningDirection]);
    const isPanningRef = useRef(false);
    const [isSelecting, setIsSelecting] = useState(false);
    const [selectionStart, setSelectionStart] = useState<Point | null>(null);
    const [selectionEnd, setSelectionEnd] = useState<Point | null>(null);
    const clipboardRef = useRef<{ text: string, width: number, height: number } | null>(null);

    // === Persistence ===
    const {
        isLoading: isLoadingWorld,
        isSaving: isSavingWorld,
        error: worldPersistenceError
    } = useWorldSave(worldId, worldData, setWorldData, settings, setSettings, false, currentStateName); // Disable auto-loading

    // === Refs === (Keep refs for things not directly tied to re-renders or persistence)
    const charSizeCacheRef = useRef<{ [key: number]: { width: number; height: number; fontSize: number } }>({});

    const findLabelAt = useCallback((x: number, y: number): { key: string, data: { text: string, color: string } } | null => {
        for (const key in worldData) {
            if (key.startsWith('label_')) {
                const coordsStr = key.substring('label_'.length);
                const [lxStr, lyStr] = coordsStr.split(',');
                const lx = parseInt(lxStr, 10);
                const ly = parseInt(lyStr, 10);

                try {
                    const data = JSON.parse(worldData[key]);
                    const text = data.text || '';
                    const width = text.length;

                    if (y === ly && x >= lx && x < lx + width) {
                        return { key, data };
                    }
                } catch (e) {
                    // Ignore parsing errors
                }
            }
        }
        return null;
    }, [worldData]);

    // === Character Utility Functions ===
    const getCharacter = useCallback((data: string | StyledCharacter): string => {
        if (typeof data === 'string') {
            return data;
        }
        return data.char;
    }, []);

    const getCharacterStyle = useCallback((data: string | StyledCharacter): { color?: string; background?: string } | undefined => {
        if (typeof data === 'string') {
            return undefined;
        }
        return data.style;
    }, []);

    // === Helper Functions (Largely unchanged, but use state variables) ===
    const getEffectiveCharDims = useCallback((zoom: number): { width: number; height: number; fontSize: number } => {
        if (charSizeCacheRef.current[zoom]) {
            return charSizeCacheRef.current[zoom];
        }
        // Simple scaling - adjust as needed
        const effectiveWidth = Math.max(1, Math.round(BASE_CHAR_WIDTH * zoom));
        const effectiveHeight = Math.max(1, Math.round(effectiveWidth * 1.8)); // Maintain aspect ratio roughly
        const effectiveFontSize = Math.max(1, Math.round(effectiveWidth * 1.5));

        const dims = { width: effectiveWidth, height: effectiveHeight, fontSize: effectiveFontSize };
        charSizeCacheRef.current[zoom] = dims;
        return dims;
    }, []); // No dependencies needed if constants are outside

    const screenToWorld = useCallback((screenX: number, screenY: number, currentZoom: number, currentOffset: Point): Point => {
        const { width: effectiveCharWidth, height: effectiveCharHeight } = getEffectiveCharDims(currentZoom);
        if (effectiveCharWidth === 0 || effectiveCharHeight === 0) return currentOffset;
        const worldX = screenX / effectiveCharWidth + currentOffset.x;
        const worldY = screenY / effectiveCharHeight + currentOffset.y;
        return { x: Math.floor(worldX), y: Math.floor(worldY) };
    }, [getEffectiveCharDims]);

    const worldToScreen = useCallback((worldX: number, worldY: number, currentZoom: number, currentOffset: Point): Point => {
        const { width: effectiveCharWidth, height: effectiveCharHeight } = getEffectiveCharDims(currentZoom);
        const screenX = (worldX - currentOffset.x) * effectiveCharWidth;
        const screenY = (worldY - currentOffset.y) * effectiveCharHeight;
        return { x: screenX, y: screenY };
    }, [getEffectiveCharDims]);

    // === Helper Functions ===
    const getNormalizedSelection = useCallback(() => {
        if (!selectionStart || !selectionEnd) return null;
        const startX = Math.min(selectionStart.x, selectionEnd.x);
        const startY = Math.min(selectionStart.y, selectionEnd.y);
        const endX = Math.max(selectionStart.x, selectionEnd.x);
        const endY = Math.max(selectionStart.y, selectionEnd.y);
        return { startX, startY, endX, endY };
    }, [selectionStart, selectionEnd]);

    // Helper function to get selected text as string
    const getSelectedText = useCallback(() => {
        const selection = getNormalizedSelection();
        if (!selection) return '';
        
        let selectedText = '';
        for (let y = selection.startY; y <= selection.endY; y++) {
            let rowText = '';
            for (let x = selection.startX; x <= selection.endX; x++) {
                const key = `${x},${y}`;
                const charData = worldData[key];
                const char = charData ? getCharacter(charData) : ' ';
                rowText += char;
            }
            if (y > selection.startY) selectedText += '\n';
            selectedText += rowText.trimEnd(); // Remove trailing spaces from each row
        }
        return selectedText.trim();
    }, [getNormalizedSelection, worldData]);

    // Define deleteSelectedCharacters BEFORE cutSelection and pasteText
    const deleteSelectedCharacters = useCallback(() => {
        const selection = getNormalizedSelection();
        if (!selection) return false; // No selection to delete

        let newWorldData = { ...worldData };
        let deleted = false;

        // Delete single characters within selection
        for (let y = selection.startY; y <= selection.endY; y++) {
            for (let x = selection.startX; x <= selection.endX; x++) {
                const key = `${x},${y}`;
                if (newWorldData[key]) {
                    delete newWorldData[key];
                    deleted = true;
                }
            }
        }

        // Find and delete labels intersecting with selection
        const labelsToDelete = new Set<string>();
        for (const key in newWorldData) {
            if (key.startsWith('label_')) {
                const coordsStr = key.substring('label_'.length);
                const [lxStr, lyStr] = coordsStr.split(',');
                const lx = parseInt(lxStr, 10);
                const ly = parseInt(lyStr, 10);

                try {
                    const data = JSON.parse(newWorldData[key]);
                    const text = data.text || '';
                    const width = text.length;
                    const endX = lx + width - 1;

                    // Check for intersection between label bounds and selection bounds
                    if (lx <= selection.endX && endX >= selection.startX && ly >= selection.startY && ly <= selection.endY) {
                        labelsToDelete.add(key);
                    }
                } catch (e) {
                    // ignore
                }
            }
        }

        if (labelsToDelete.size > 0) {
            deleted = true;
            labelsToDelete.forEach(key => {
                delete newWorldData[key];
            });
        }

        if (deleted) {
            setWorldData(newWorldData);
            // Move cursor to the start of the deleted selection
            setCursorPos({ x: selection.startX, y: selection.startY });
            // Clear selection state
            setSelectionStart(null);
            setSelectionEnd(null);
        }
        return deleted;
    }, [worldData, getNormalizedSelection]); // Removed setCursorPos, setSelectionStart, setSelectionEnd setters

    // Define copySelectedCharacters BEFORE cutSelection
    const copySelectedCharacters = useCallback(() => {
        const selection = getNormalizedSelection();
        if (!selection) return false;

        const lines: string[] = [];
        const selectionWidth = selection.endX - selection.startX + 1;
        const selectionHeight = selection.endY - selection.startY + 1;

        for (let y = selection.startY; y <= selection.endY; y++) {
            let line = '';
            for (let x = selection.startX; x <= selection.endX; x++) {
                const key = `${x},${y}`;
                const charData = worldData[key];
                const char = charData ? getCharacter(charData) : ' ';
                line += char; // Use space for empty cells
            }
            lines.push(line);
        }
        const copiedText = lines.join('\n');

        if (copiedText.length > 0 || (selectionWidth > 0 && selectionHeight > 0)) { // Copy even if selection is empty spaces
            // clipboardRef.current = { text: copiedText, width: selectionWidth, height: selectionHeight }; // Assuming clipboardRef exists
            // Use system clipboard as well
            navigator.clipboard.writeText(copiedText).catch(err => console.warn('Could not copy to system clipboard:', err));
            return true;
        }
        return false;
    }, [worldData, getNormalizedSelection]); // Removed clipboardRef dependency for now

    // Define pasteText BEFORE handleKeyDown uses it
    const pasteText = useCallback(async (): Promise<boolean> => { // Ensure return type is Promise<boolean>
        try {
            const clipText = await navigator.clipboard.readText();
            // Delete current selection before pasting
            // Use a temporary variable to hold the potentially modified worldData
            let dataAfterDelete = worldData;
            const selection = getNormalizedSelection();
            let deleted = false;
            if (selection) {
                let newWorldData = { ...worldData };
                for (let y = selection.startY; y <= selection.endY; y++) {
                    for (let x = selection.startX; x <= selection.endX; x++) {
                        const key = `${x},${y}`;
                        if (newWorldData[key]) {
                            delete newWorldData[key];
                            deleted = true;
                        }
                    }
                }
                if (deleted) {
                    dataAfterDelete = newWorldData; // Update the data to use for pasting
                    // Don't set state here yet, batch with paste changes
                }
            }

            // Use cursor position *after* potential deletion
            const pasteStartX = deleted && selection ? selection.startX : cursorPos.x;
            const pasteStartY = deleted && selection ? selection.startY : cursorPos.y;

            let finalWorldData = { ...dataAfterDelete }; // Start pasting onto data after deletion
            const linesToPaste = clipText.split('\n');
            let currentY = pasteStartY;
            let finalCursorX = pasteStartX;
            let finalCursorY = pasteStartY;

            for (let i = 0; i < linesToPaste.length; i++) {
                const line = linesToPaste[i];
                let currentX = pasteStartX;
                for (let j = 0; j < line.length; j++) {
                    const char = line[j];
                    const key = `${currentX},${currentY}`;
                    finalWorldData[key] = char;
                    currentX++;
                }
                if (i === linesToPaste.length - 1) {
                    finalCursorX = currentX;
                    finalCursorY = currentY;
                }
                currentY++;
            }

            // Batch state updates
            setWorldData(finalWorldData);
            setCursorPos({ x: finalCursorX, y: finalCursorY });
            // Clear selection after paste is complete
            setSelectionStart(null);
            setSelectionEnd(null);

            return true;

        } catch (err) {
            console.warn('Could not read from system clipboard or paste failed:', err);
            return false;
        }
    }, [worldData, cursorPos, getNormalizedSelection]); // Removed deleteSelectedCharacters dependency, logic inlined

    // Now define cutSelection, which depends on the above
    const cutSelection = useCallback(() => {
        if (copySelectedCharacters()) { // Now defined above
            return deleteSelectedCharacters(); // Now defined above
        }
        return false;
    }, [copySelectedCharacters, deleteSelectedCharacters]); // Dependencies are correct

    // === Event Handlers ===

    const handleKeyDown = useCallback((key: string, ctrlKey: boolean, metaKey: boolean, shiftKey: boolean): boolean => {
        let preventDefault = true;
        let nextCursorPos = { ...cursorPos };
        let nextWorldData = { ...worldData }; // Create mutable copy only if needed
        let moved = false;
        let worldDataChanged = false; // Track if world data is modified synchronously

        const isMod = ctrlKey || metaKey; // Modifier key check
        const currentSelectionActive = !!(selectionStart && selectionEnd && (selectionStart.x !== selectionEnd.x || selectionStart.y !== selectionEnd.y));

        // === Nav Dialogue Handling (Priority) ===
        if (key === 'Escape' && isNavVisible) {
            setIsNavVisible(false);
            return true;
        }

        // === Search Clearing ===
        if (key === 'Escape' && isSearchActive) {
            clearSearch();
            setDialogueWithRevert("Search cleared", setDialogueText);
            return true;
        }

        // === State Prompt Handling ===
        if (statePrompt.type) {
            if (key === 'Escape') {
                setStatePrompt({ type: null });
                setDialogueText("Operation cancelled");
                return true;
            }
            
            if (statePrompt.type === 'save_before_load_confirm') {
                if (key.toLowerCase() === 'y') {
                    // User wants to save - ask for state name
                    setStatePrompt({ ...statePrompt, type: 'save_before_load_name', inputBuffer: '' });
                    setDialogueText("Enter state name for current work: ");
                    return true;
                } else if (key.toLowerCase() === 'n') {
                    // User doesn't want to save - proceed directly to load
                    const loadStateName = statePrompt.loadStateName!;
                    setStatePrompt({ type: 'load_confirm', stateName: loadStateName });
                    setDialogueText(`Load state "${loadStateName}"? This will replace current work. (y/n)`);
                    return true;
                }
            } else if (statePrompt.type === 'save_before_load_name') {
                if (key === 'Enter') {
                    const saveStateName = (statePrompt.inputBuffer || '').trim();
                    if (saveStateName) {
                        const loadStateName = statePrompt.loadStateName!;
                        setDialogueText("Saving current work...");
                        saveState(saveStateName).then((success) => {
                            if (success) {
                                loadAvailableStates().then(setAvailableStates);
                                // Now load the requested state
                                setDialogueText("Loading requested state...");
                                loadState(loadStateName).then((loadSuccess) => {
                                    if (loadSuccess) {
                                        setDialogueText(`Current work saved as "${saveStateName}", "${loadStateName}" loaded successfully`);
                                    } else {
                                        setDialogueText(`Current work saved as "${saveStateName}", but failed to load "${loadStateName}"`);
                                    }
                                    setStatePrompt({ type: null });
                                });
                            } else {
                                setDialogueText("Failed to save current work");
                                setStatePrompt({ type: null });
                            }
                        });
                    } else {
                        setDialogueText("State name cannot be empty");
                        setStatePrompt({ type: null });
                    }
                    return true;
                } else if (key === 'Backspace') {
                    const currentInput = statePrompt.inputBuffer || '';
                    if (currentInput.length > 0) {
                        const newInput = currentInput.slice(0, -1);
                        setStatePrompt(prev => ({ ...prev, inputBuffer: newInput }));
                        setDialogueText("Enter state name for current work: " + newInput);
                    }
                    return true;
                } else if (key.length === 1) {
                    const currentInput = statePrompt.inputBuffer || '';
                    const newInput = currentInput + key;
                    setStatePrompt(prev => ({ ...prev, inputBuffer: newInput }));
                    setDialogueText("Enter state name for current work: " + newInput);
                    return true;
                }
            } else if (statePrompt.type === 'load_confirm') {
                if (key.toLowerCase() === 'y') {
                    const stateName = statePrompt.stateName!;
                    setDialogueText("Loading state...");
                    loadState(stateName).then((success) => {
                        if (success) {
                            setDialogueWithRevert(`State "${stateName}" loaded successfully`, setDialogueText);
                        } else {
                            setDialogueWithRevert("Failed to load state", setDialogueText);
                        }
                        setStatePrompt({ type: null });
                    });
                    return true;
                } else if (key.toLowerCase() === 'n') {
                    setStatePrompt({ type: null });
                    setDialogueWithRevert("Load cancelled", setDialogueText);
                    return true;
                }
            } else if (statePrompt.type === 'delete_confirm') {
                if (key.toLowerCase() === 'y') {
                    const stateName = statePrompt.stateName!;
                    setDialogueText("Deleting state...");
                    deleteState(stateName).then((success) => {
                        if (success) {
                            loadAvailableStates().then(setAvailableStates);
                            setDialogueWithRevert(`State "${stateName}" deleted successfully`, setDialogueText);
                        } else {
                            setDialogueWithRevert("Failed to delete state", setDialogueText);
                        }
                        setStatePrompt({ type: null });
                    });
                    return true;
                } else if (key.toLowerCase() === 'n') {
                    setStatePrompt({ type: null });
                    setDialogueWithRevert("Delete cancelled", setDialogueText);
                    return true;
                }
            }
            
            // If we're in a prompt, consume all other keys
            return true;
        }

        // === Chat Mode Handling ===
        if (chatMode.isActive && !commandState.isActive) {
            if (key === 'Enter') {
                // Send chat message - prevent if already processing
                if (chatMode.currentInput.trim() && !chatMode.isProcessing) {
                    setChatMode(prev => ({ ...prev, isProcessing: true }));
                    setDialogueText("Processing...");
                    
                    chatWithAI(chatMode.currentInput.trim()).then((response) => {
                        createSubtitleCycler(response, setDialogueText);
                        // Clear current input from chat data after response
                        setChatData({});
                        setChatMode(prev => ({
                            ...prev,
                            currentInput: '',
                            inputPositions: [],
                            isProcessing: false
                        }));
                    }).catch(() => {
                        setDialogueText("Could not process chat message");
                        // Clear chat data even on error
                        setChatData({});
                        setChatMode(prev => ({ 
                            ...prev, 
                            currentInput: '',
                            inputPositions: [],
                            isProcessing: false 
                        }));
                    });
                }
                return true;
            } else if (key === 'Escape') {
                // Exit chat mode
                setChatMode({
                    isActive: false,
                    currentInput: '',
                    inputPositions: [],
                    isProcessing: false
                });
                // Clear any chat input
                setChatData({});
                setDialogueText("Chat mode deactivated.");
                return true;
            } else if (key.length === 1) {
                // Add character to chat input
                const newInput = chatMode.currentInput + key;
                const currentKey = `${cursorPos.x},${cursorPos.y}`;
                
                setChatMode(prev => ({
                    ...prev,
                    currentInput: newInput,
                    inputPositions: [...prev.inputPositions, cursorPos]
                }));
                
                // Add to chatData instead of worldData
                setChatData(prev => ({
                    ...prev,
                    [currentKey]: key
                }));
                
                // Move cursor immediately for chat mode
                setCursorPos({ x: cursorPos.x + 1, y: cursorPos.y });
                return true;
            } else if (key === 'Backspace') {
                if (chatMode.currentInput.length > 0) {
                    // Remove last character from chat input
                    const newInput = chatMode.currentInput.slice(0, -1);
                    const lastPos = chatMode.inputPositions[chatMode.inputPositions.length - 1];
                    
                    if (lastPos) {
                        setChatMode(prev => ({
                            ...prev,
                            currentInput: newInput,
                            inputPositions: prev.inputPositions.slice(0, -1)
                        }));
                        
                        // Remove from chatData
                        setChatData(prev => {
                            const newChatData = { ...prev };
                            delete newChatData[`${lastPos.x},${lastPos.y}`];
                            return newChatData;
                        });
                        
                        // Move cursor immediately for chat mode
                        setCursorPos({ x: lastPos.x, y: lastPos.y });
                    }
                }
                return true;
            }
        }

        // === Command Handling ===
        const commandResult = handleCommandKeyDown(key, cursorPos, setCursorPos);
        if (commandResult && typeof commandResult === 'object') {
            // It's a command execution object
            const exec = commandResult as CommandExecution;
            if (exec.command === 'debug') {
                if (exec.args[0] === 'on') {
                    const newSettings = { isDebugVisible: true };
                    updateSettings(newSettings);
                    saveSettingsToFirebase(newSettings);
                } else if (exec.args[0] === 'off') {
                    const newSettings = { isDebugVisible: false };
                    updateSettings(newSettings);
                    saveSettingsToFirebase(newSettings);
                } else {
                    setDialogueWithRevert("Usage: /debug [on|off] - Toggle debug information display", setDialogueText);
                }
            } else if (exec.command === 'deepspawn') {
                if (exec.args[0] === 'on') {
                    const newSettings = { isDeepspawnVisible: true };
                    updateSettings(newSettings);
                    saveSettingsToFirebase(newSettings);
                } else if (exec.args[0] === 'off') {
                    const newSettings = { isDeepspawnVisible: false };
                    updateSettings(newSettings);
                    saveSettingsToFirebase(newSettings);
                } else {
                    setDialogueWithRevert("Usage: /deepspawn [on|off] - Toggle deepspawn objects visibility", setDialogueText);
                }
            } else if (exec.command === 'nav') {
                if (exec.args.length === 2) {
                    // Navigate to specific coordinates (x, y)
                    const targetX = parseInt(exec.args[0], 10);
                    const targetY = parseInt(exec.args[1], 10);
                    
                    if (!isNaN(targetX) && !isNaN(targetY)) {
                        // Move camera to center on the target position
                        if (typeof window !== 'undefined') {
                            const { width: effectiveCharWidth, height: effectiveCharHeight } = getEffectiveCharDims(zoomLevel);
                            if (effectiveCharWidth > 0 && effectiveCharHeight > 0) {
                                const viewportWidth = window.innerWidth;
                                const viewportHeight = window.innerHeight;
                                
                                const newViewOffset = {
                                    x: -targetX + (viewportWidth / (2 * effectiveCharWidth)),
                                    y: -targetY + (viewportHeight / (2 * effectiveCharHeight))
                                };
                                setViewOffset(newViewOffset);
                            }
                        }
                        setIsNavVisible(false);
                        setDialogueWithRevert(`Navigated to label at (${targetX}, ${targetY})`, setDialogueText);
                    } else {
                        setDialogueWithRevert("Invalid coordinates for navigation", setDialogueText);
                    }
                } else {
                    // No arguments or invalid arguments - show nav table of contents
                    const currentCenter = getViewportCenter();
                    setNavOriginPosition(currentCenter);
                    setIsNavVisible(true);
                }
            } else if (exec.command === 'pending_selection') {
                // Show prompt for selection
                const commandName = exec.args[0];
                setDialogueWithRevert(`Select a region of text, then press Enter to ${commandName}`, setDialogueText, 5000);
            } else if (exec.command === 'transform') {
                // This handles both old system (pre-selected text) and new system (text as first arg)
                const selectedText = exec.args.length > 0 && exec.args[0].length > 10 ? exec.args[0] : getSelectedText();
                const instructions = exec.args.length > 1 ? exec.args.slice(1).join(' ') : exec.args.length === 1 && exec.args[0].length <= 10 ? exec.args[0] : '';
                
                if (selectedText && instructions) {
                    setDialogueText("Processing transformation...");
                    
                    // Use AI to transform the text
                    transformText(selectedText, instructions).then((result) => {
                        createSubtitleCycler(result, setDialogueText);
                    }).catch(() => {
                        setDialogueText(`Could not transform text`);
                    });
                } else if (!selectedText) {
                    setDialogueWithRevert("Select a region of text first, then use: /transform [instructions]", setDialogueText);
                } else {
                    setDialogueWithRevert("Usage: /transform [instructions] (e.g., /transform make uppercase, /transform convert to bullet points)", setDialogueText);
                }
            } else if (exec.command === 'explain') {
                // This handles both old system (pre-selected text) and new system (text as first arg)
                const selectedText = exec.args.length > 0 && exec.args[0].length > 10 ? exec.args[0] : getSelectedText();
                const instructions = exec.args.length > 1 ? exec.args.slice(1).join(' ') : exec.args.length === 1 && exec.args[0].length <= 10 ? exec.args[0] : 'analysis';
                
                if (selectedText) {
                    setDialogueText("Processing explanation...");
                    
                    // Use AI to explain the text
                    explainText(selectedText, instructions).then((result) => {
                        createSubtitleCycler(result, setDialogueText);
                    }).catch(() => {
                        setDialogueText(`Could not explain text`);
                    });
                } else {
                    setDialogueWithRevert("Select a region of text first, then use: /explain [optional: how to explain]", setDialogueText);
                }
            } else if (exec.command === 'summarize') {
                // This handles both old system (pre-selected text) and new system (text as first arg)
                const selectedText = exec.args.length > 0 && exec.args[0].length > 10 ? exec.args[0] : getSelectedText();
                const focus = exec.args.length > 1 ? exec.args.slice(1).join(' ') : exec.args.length === 1 && exec.args[0].length <= 10 ? exec.args[0] : undefined;
                
                if (selectedText) {
                    setDialogueText("Processing summary...");
                    
                    // Use AI to summarize the text
                    summarizeText(selectedText, focus).then((result) => {
                        createSubtitleCycler(result, setDialogueText);
                    }).catch(() => {
                        setDialogueText(`Could not summarize text`);
                    });
                } else {
                    setDialogueWithRevert("Select a region of text first, then use: /summarize [optional focus]", setDialogueText);
                }
            } else if (exec.command === 'chat') {
                if (!chatMode.isActive) {
                    // Enter chat mode
                    setChatMode({
                        isActive: true,
                        currentInput: '',
                        inputPositions: [],
                        isProcessing: false
                    });
                    setDialogueText("Chat mode activated. Type anywhere and press Enter to chat. Use /exit to leave chat mode.");
                } else {
                    // Exit chat mode
                    setChatMode({
                        isActive: false,
                        currentInput: '',
                        inputPositions: [],
                        isProcessing: false
                    });
                    // Clear any chat input
                    setChatData({});
                    setDialogueWithRevert("Chat mode deactivated.", setDialogueText);
                }
            } else if (exec.command === 'modes') {
                setDialogueText("Available modes: edit, view, select. Usage: /modes [mode] (coming soon)");
            } else if (exec.command === 'settings') {
                setDialogueText("Settings menu: /settings [option] [value] (coming soon)");
            } else if (exec.command === 'label') {
                if (exec.args.length >= 1) {
                    let color = 'black';
                    let text = '';
                    const lastArg = exec.args[exec.args.length - 1].toLowerCase();
                    const commonColors = ['black', 'white', 'red', 'green', 'blue', 'yellow', 'purple', 'orange', 'pink', 'cyan', 'magenta'];
                    const isLastArgColor = lastArg.startsWith('#') || commonColors.includes(lastArg);

                    if (exec.args.length > 1 && isLastArgColor) {
                        color = exec.args.pop() as string;
                        text = exec.args.join(' ');
                    } else {
                        text = exec.args.join(' ');
                    }
                    
                    const position = { x: exec.commandStartPos.x + 1, y: exec.commandStartPos.y };
                    const key = `label_${position.x},${position.y}`;
                    const value = JSON.stringify({ text, color });
                    
                    setWorldData(prev => ({
                        ...prev,
                        [key]: value
                    }));
                } else {
                    setDialogueWithRevert("Usage: /label [text] [color] (e.g., /label important note red, /label heading blue)", setDialogueText);
                }
            } else if (exec.command === 'state') {
                if (exec.args.length === 0) {
                    // No arguments - clear canvas and exit current state
                    setWorldData({});
                    setCurrentStateName(null);
                    setDialogueText("Canvas cleared");
                } else if (exec.args[0] === '--rm') {
                    // Delete state command
                    if (exec.args.length < 2) {
                        setDialogueText(`Usage: /state --rm [name]. Available states: ${availableStates.join(', ')}`);
                    } else {
                        const stateNameToDelete = exec.args[1];
                        if (availableStates.includes(stateNameToDelete)) {
                            // State exists - ask for confirmation
                            setStatePrompt({ type: 'delete_confirm', stateName: stateNameToDelete });
                            setDialogueText(`Delete state "${stateNameToDelete}"? This cannot be undone. (y/n)`);
                        } else {
                            setDialogueText(`State "${stateNameToDelete}" not found. Available states: ${availableStates.join(', ')}`);
                        }
                    }
                } else {
                    const stateName = exec.args[0];
                    console.log('State command:', stateName, 'Available states:', availableStates);
                    
                    if (worldId && stateName) {
                        if (availableStates.includes(stateName)) {
                            // State exists - load it directly (simplified from old working code)
                            setDialogueText(`Loading state "${stateName}"...`);
                            loadState(stateName).then((success) => {
                                if (success) {
                                    setDialogueText(`State "${stateName}" loaded successfully`);
                                } else {
                                    setDialogueText(`Failed to load state "${stateName}"`);
                                }
                            });
                        } else {
                            // State doesn't exist - create new state
                            setDialogueText(`Creating new state "${stateName}"...`);
                            saveState(stateName).then((success) => {
                                if (success) {
                                    loadAvailableStates().then(setAvailableStates);
                                    setDialogueText(`State "${stateName}" created and saved successfully`);
                                } else {
                                    setDialogueText(`Failed to create state "${stateName}"`);
                                }
                            });
                        }
                    } else if (!worldId) {
                        setDialogueText("No world ID available for state management");
                    } else {
                        setDialogueText("Please provide a state name");
                    }
                }
            }
            
            // Return cursor to command start position
            setCursorPos(exec.commandStartPos);
            
            return true; // Command was handled
        } else if (commandResult === true) {
            // Command mode handled the key, but didn't execute a command
            return true;
        }


        // Function to clear selection state
        const clearSelectionState = () => {
            setSelectionStart(null);
            setSelectionEnd(null);
        };

        // Function to update selection end or start a new one
        const updateSelection = (newPos: Point) => {
            if (!selectionStart || !shiftKey) { // Start new selection if shift not held or no selection exists
                setSelectionStart(cursorPos);
                setSelectionEnd(newPos);
            } else { // Otherwise, just update the end point
                setSelectionEnd(newPos);
            }
        };

        // --- Clipboard ---
        if (isMod && key.toLowerCase() === 'c') {
            copySelectedCharacters();
        } else if (isMod && key.toLowerCase() === 'x') {
            if (cutSelection()) { // cutSelection returns boolean indicating success
                 // State updates (worldData, cursor, selection) happen inside cutSelection->deleteSelectedCharacters
                 // No need to set worldDataChanged = true here, as state is already set
            }
        } else if (isMod && key.toLowerCase() === 'v') {
            pasteText(); // Call async paste, state updates happen inside it
            // Don't set worldDataChanged = true here, paste handles its own state updates
        }
        // === Pending Command Handling ===
        else if (key === 'Enter' && pendingCommand && pendingCommand.isWaitingForSelection) {
            const currentSelection = getSelectedText();
            if (currentSelection) {
                // Execute the pending command with the selected text
                const commandExecution = executePendingCommand(currentSelection);
                if (commandExecution) {
                    // Process the command as if it was just executed
                    const exec = commandExecution;
                    if (exec.command === 'transform') {
                        const selectedText = exec.args[0];
                        const instructions = exec.args.slice(1).join(' ');
                        
                        if (selectedText && instructions) {
                            setDialogueText("Processing transformation...");
                            transformText(selectedText, instructions).then((result) => {
                                createSubtitleCycler(result, setDialogueText);
                            }).catch(() => {
                                setDialogueText(`Could not transform text`);
                            });
                        }
                    } else if (exec.command === 'explain') {
                        const selectedText = exec.args[0];
                        const instructions = exec.args.length > 1 ? exec.args.slice(1).join(' ') : 'analysis';
                        
                        setDialogueText("Processing explanation...");
                        explainText(selectedText, instructions).then((result) => {
                            createSubtitleCycler(result, setDialogueText);
                        }).catch(() => {
                            setDialogueText(`Could not explain text`);
                        });
                    } else if (exec.command === 'summarize') {
                        const selectedText = exec.args[0];
                        const focus = exec.args.length > 1 ? exec.args.slice(1).join(' ') : undefined;
                        
                        setDialogueText("Processing summary...");
                        summarizeText(selectedText, focus).then((result) => {
                            createSubtitleCycler(result, setDialogueText);
                        }).catch(() => {
                            setDialogueText(`Could not summarize text`);
                        });
                    }
                }
                
                // Clear selection after executing pending command
                clearSelectionState();
            } else {
                setDialogueWithRevert("Please select some text first, then press Enter to execute the command", setDialogueText);
            }
            return false;
        }
        // --- Movement ---
        else if (key === 'Enter') {
            // Smart Indentation System using block detection  
            const dataToCheck = currentMode === 'air' ? 
                { ...worldData, ...lightModeData } : 
                worldData;
            
            // Use utility function for smart indentation with 2+ space gap
            const targetIndent = getSmartIndentation(dataToCheck, cursorPos);
            
            nextCursorPos.y = cursorPos.y + 1;
            nextCursorPos.x = targetIndent;
            moved = true;
        } else if (key === 'ArrowUp') {
            if (isMod) {
                // Meta+Up: Move to the topmost line with content
                let topY = cursorPos.y;
                let foundAnyContent = false;
                
                // Scan world data to find the minimum y coordinate with content
                for (const k in worldData) {
                    const [, yStr] = k.split(',');
                    const y = parseInt(yStr, 10);
                    if (!foundAnyContent || y < topY) {
                        topY = y;
                        foundAnyContent = true;
                    }
                }
                
                nextCursorPos.y = foundAnyContent ? topY : 0;
            } else {
                nextCursorPos.y -= 1;
            }
            moved = true;
        } else if (key === 'ArrowDown') {
            if (isMod) {
                // Meta+Down: Move to the bottommost line with content
                let bottomY = cursorPos.y;
                let foundAnyContent = false;
                
                // Scan world data to find the maximum y coordinate with content
                for (const k in worldData) {
                    const [, yStr] = k.split(',');
                    const y = parseInt(yStr, 10);
                    if (!foundAnyContent || y > bottomY) {
                        bottomY = y;
                        foundAnyContent = true;
                    }
                }
                
                nextCursorPos.y = foundAnyContent ? bottomY : cursorPos.y;
            } else {
                nextCursorPos.y += 1;
            }
            moved = true;
        } else if (key === 'ArrowLeft') {
            if (isMod) {
                // Meta+Left: Move to the beginning of the current word or previous word
                let x = cursorPos.x - 1;
                let passedContent = false;
                
                // Find the leftmost character on this line to determine search range
                let leftmostX = x;
                for (const k in worldData) {
                    const [xStr, yStr] = k.split(',');
                    const checkY = parseInt(yStr, 10);
                    if (checkY === cursorPos.y) {
                        const checkX = parseInt(xStr, 10);
                        if (checkX < leftmostX) {
                            leftmostX = checkX;
                        }
                    }
                }
                
                // First, skip any spaces to the left
                while (x >= leftmostX) {
                    const key = `${x},${cursorPos.y}`;
                    const charData = worldData[key];
                    const char = charData ? getCharacter(charData) : '';
                    if (!char || char === ' ' || char === '\t') {
                        x--;
                    } else {
                        passedContent = true;
                        break;
                    }
                }
                
                // If we found content, continue to find the beginning of the word
                if (passedContent) {
                    // Continue until we find a space or beginning of content
                    while (x >= leftmostX) {
                        const key = `${x-1},${cursorPos.y}`;
                        const charData = worldData[key];
                        const char = charData ? getCharacter(charData) : '';
                        if (!char || char === ' ' || char === '\t') {
                            break;
                        }
                        x--;
                    }
                }
                
                nextCursorPos.x = x;
            } else {
                nextCursorPos.x -= 1;
            }
            moved = true;
        } else if (key === 'ArrowRight') {
            if (isMod) {
                // Meta+Right: Move to the end of the current word or next word
                let x = cursorPos.x;
                let currentLine = cursorPos.y;
                
                // Find the rightmost character on this line to determine search range
                let rightmostX = x;
                for (const k in worldData) {
                    const [xStr, yStr] = k.split(',');
                    const checkY = parseInt(yStr, 10);
                    if (checkY === cursorPos.y) {
                        const checkX = parseInt(xStr, 10);
                        if (checkX > rightmostX) {
                            rightmostX = checkX;
                        }
                    }
                }
                
                // First, see if we're in the middle of a word
                const startKey = `${x},${currentLine}`;
                const startCharData = worldData[startKey];
                const startChar = startCharData ? getCharacter(startCharData) : '';
                let inWord = !!startChar && startChar !== ' ' && startChar !== '\t';
                
                // Find the end of current word or beginning of next word
                while (x <= rightmostX) {
                    const key = `${x},${currentLine}`;
                    const charData = worldData[key];
                    const char = charData ? getCharacter(charData) : '';
                    
                    if (!char) {
                        // No character at this position, keep looking
                        x++;
                        continue;
                    }
                    
                    const isSpace = char === ' ' || char === '\t';
                    
                    if (inWord && isSpace) {
                        // We've reached the end of the current word
                        break;
                    } else if (!inWord && !isSpace) {
                        // We've reached the beginning of the next word
                        inWord = true;
                    }
                    
                    x++;
                }
                
                nextCursorPos.x = x;
            } else {
                nextCursorPos.x += 1;
            }
            moved = true;
        }
        // --- Deletion ---
        else if (key === 'Backspace') {
            if (currentSelectionActive) {
                if (deleteSelectedCharacters()) {
                    // State updates happen inside deleteSelectedCharacters
                    // Update local nextCursorPos for consistency if needed, though state is already set
                    nextCursorPos = { x: selectionStart?.x ?? cursorPos.x, y: selectionStart?.y ?? cursorPos.y };
                }
            } else if (metaKey) { 
                nextWorldData = { ...worldData }; // Create a copy before modifying
                
                let deletedAny = false;
                let x = cursorPos.x - 1; // Start from the character to the left of cursor
                
                // Find the leftmost character on this line to determine range
                let leftmostX = cursorPos.x - 1;
                for (const k in worldData) {
                    const [xStr, yStr] = k.split(',');
                    const checkY = parseInt(yStr, 10);
                    if (checkY === cursorPos.y) {
                        const checkX = parseInt(xStr, 10);
                        if (checkX < leftmostX) {
                            leftmostX = checkX;
                        }
                    }
                }
                
                // Continue deleting until we've checked all possible positions to the left
                while (x >= leftmostX) {
                    const key = `${x},${cursorPos.y}`;
                    const charData = worldData[key];
                    const char = charData ? getCharacter(charData) : '';
                    
                    // Stop at whitespace or when no character exists
                    if (!char || char === ' ' || char === '\t') {
                        if (!deletedAny) {
                            // If we haven't deleted anything yet but found whitespace,
                            // delete it and continue looking for text
                            if (char) {
                                delete nextWorldData[key];
                                deletedAny = true;
                            }
                        } else {
                            // If we've already deleted some text, stop at whitespace
                            break;
                        }
                    } else {
                        // Delete the character
                        delete nextWorldData[key];
                        deletedAny = true;
                    }
                    
                    x--;
                }
                
                // Only mark as changed if we actually deleted something
                if (deletedAny) {
                    worldDataChanged = true;
                    nextCursorPos.x = x + 1; // Move cursor to where we stopped
                } else {
                    // If we didn't delete anything, perform regular backspace behavior
                    const deleteKey = `${cursorPos.x - 1},${cursorPos.y}`;
                    if (worldData[deleteKey]) {
                        delete nextWorldData[deleteKey];
                        worldDataChanged = true;
                    }
                    nextCursorPos.x -= 1;
                }
            } else {
                // Regular Backspace: Check for label first
                const labelToDelete = findLabelAt(cursorPos.x - 1, cursorPos.y);
                if (labelToDelete) {
                    nextWorldData = { ...worldData };
                    delete nextWorldData[labelToDelete.key];
                    worldDataChanged = true;
                    // Move cursor to the start of where the label was
                    const coordsStr = labelToDelete.key.substring('label_'.length);
                    const [lxStr, lyStr] = coordsStr.split(',');
                    nextCursorPos.x = parseInt(lxStr, 10);
                    nextCursorPos.y = parseInt(lyStr, 10);
                } else {
                    // Delete one character to the left
                    const deleteKey = `${cursorPos.x - 1},${cursorPos.y}`;
                    if (worldData[deleteKey]) {
                        nextWorldData = { ...worldData }; // Create copy before modifying
                        delete nextWorldData[deleteKey]; // Remove char from world
                        worldDataChanged = true;
                    }
                    nextCursorPos.x -= 1; // Move cursor left regardless
                }
            }
            moved = true; // Cursor position changed or selection was deleted
        } else if (key === 'Delete') {
            if (currentSelectionActive) {
                 if (deleteSelectedCharacters()) {
                    // State updates happen inside deleteSelectedCharacters
                    nextCursorPos = { x: selectionStart?.x ?? cursorPos.x, y: selectionStart?.y ?? cursorPos.y };
                 }
            } else {
                // Delete char at current cursor pos, check for label first
                const labelToDelete = findLabelAt(cursorPos.x, cursorPos.y);
                if (labelToDelete) {
                    nextWorldData = { ...worldData };
                    delete nextWorldData[labelToDelete.key];
                    worldDataChanged = true;
                    // Cursor does not move
                } else {
                    const deleteKey = `${cursorPos.x},${cursorPos.y}`;
                    if (worldData[deleteKey]) {
                        nextWorldData = { ...worldData }; // Create copy before modifying
                        delete nextWorldData[deleteKey];
                        worldDataChanged = true;
                    }
                }
            }
             // Treat deletion as a cursor-affecting action for selection clearing logic below
             moved = true; // Set moved to true to trigger selection update/clear logic
        }
        // --- Typing ---
        else if (!isMod && key.length === 1) { // Basic check for printable chars
            let dataToDeleteFrom = worldData;
            let cursorAfterDelete = cursorPos;

            if (currentSelectionActive) {
                // Inline deletion logic to avoid async issues and manage state batching
                const selection = getNormalizedSelection();
                if (selection) {
                    let tempWorldData = { ...worldData };
                    let deleted = false;
                    for (let y = selection.startY; y <= selection.endY; y++) {
                        for (let x = selection.startX; x <= selection.endX; x++) {
                            const delKey = `${x},${y}`;
                            if (tempWorldData[delKey]) {
                                delete tempWorldData[delKey];
                                deleted = true;
                            }
                        }
                    }
                    if (deleted) {
                        dataToDeleteFrom = tempWorldData; // Use the modified data
                        cursorAfterDelete = { x: selection.startX, y: selection.startY }; // Set cursor for typing
                        // Don't set state here yet
                    }
                }
            }

            // Now type the character - handle different modes
            nextCursorPos = { x: cursorAfterDelete.x + 1, y: cursorAfterDelete.y }; // Move cursor right
            moved = true;
            
            if (currentMode === 'air') {
                // Air mode: Add ephemeral text that disappears after 2 seconds
                addEphemeralText(cursorAfterDelete, key);
                // Don't modify worldData in air mode
            } else if (currentMode === 'chat') {
                // Chat mode: Use existing chat functionality
                if (chatMode.isActive) {
                    // Add to chat data instead of world data
                    setChatData(prev => ({
                        ...prev,
                        [`${cursorAfterDelete.x},${cursorAfterDelete.y}`]: key
                    }));
                    setChatMode(prev => ({
                        ...prev,
                        currentInput: prev.currentInput + key,
                        inputPositions: [...prev.inputPositions, cursorAfterDelete]
                    }));
                } else {
                    // If not in active chat mode but mode is chat, activate it
                    setChatMode({
                        isActive: true,
                        currentInput: key,
                        inputPositions: [cursorAfterDelete],
                        isProcessing: false
                    });
                    setChatData({
                        [`${cursorAfterDelete.x},${cursorAfterDelete.y}`]: key
                    });
                    setDialogueText("Chat mode activated. Type anywhere and press Enter to chat. Use /exit to leave chat mode.");
                }
            } else {
                // Air mode (default): Normal text input to worldData
                nextWorldData = { ...dataToDeleteFrom }; // Start with data after potential deletion
                const currentKey = `${cursorAfterDelete.x},${cursorAfterDelete.y}`;
                
                // Check if current text style is different from global defaults
                const hasCustomStyle = currentTextStyle.color !== textColor || currentTextStyle.background !== undefined;
                
                if (hasCustomStyle) {
                    // Store styled character
                    const styledChar: StyledCharacter = {
                        char: key,
                        style: {
                            color: currentTextStyle.color,
                            background: currentTextStyle.background
                        }
                    };
                    nextWorldData[currentKey] = styledChar;
                } else {
                    // Store plain character (backward compatibility)
                    nextWorldData[currentKey] = key;
                }
                
                worldDataChanged = true; // Mark that synchronous data change occurred
            }
        }
        // --- Other ---
        else {
            preventDefault = false; // Don't prevent default for unhandled keys
        }

        // === Update State ===
        if (moved) {
            setCursorPos(nextCursorPos);
            // Update selection based on movement and shift key
            // Only use shift for selection when using navigation keys, not when typing
            if (shiftKey && (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight')) {
                 updateSelection(nextCursorPos);
            } else if (!isMod && key !== 'Delete' && key !== 'Backspace') {
                 // Clear selection if moving without Shift/Mod,
                 // unless it was Backspace/Delete which handle selection internally
                 clearSelectionState();
            } else if (key === 'Delete' || key === 'Backspace') {
                 // Backspace/Delete already cleared selection if needed via deleteSelectedCharacters
                 // If no selection was active, ensure we clear any potential single-cell selection state
                 if (!currentSelectionActive) {
                     clearSelectionState();
                 }
            }
        }

        // Only update worldData if it changed *synchronously* during this handler execution
        if (worldDataChanged) {
             setWorldData(nextWorldData); // This triggers the useWorldSave hook
        }

        return preventDefault;
    }, [
        cursorPos, worldData, selectionStart, selectionEnd, commandState, chatMode, chatData, // State dependencies
        currentMode, addEphemeralText, // Mode system dependencies
        getNormalizedSelection, deleteSelectedCharacters, copySelectedCharacters, cutSelection, pasteText, getSelectedText, // Callback dependencies
        handleCommandKeyDown
        // Include setters used directly in the handler (if any, preferably avoid)
        // setCursorPos, setWorldData, setSelectionStart, setSelectionEnd // Setters are stable, no need to list
    ]);

    const handleCanvasClick = useCallback((canvasRelativeX: number, canvasRelativeY: number, clearSelection: boolean = false, shiftKey: boolean = false): void => {
        const newCursorPos = screenToWorld(canvasRelativeX, canvasRelativeY, zoomLevel, viewOffset);
        
        // If in chat mode, clear previous input when clicking
        if (chatMode.isActive && chatMode.currentInput) {
            setChatData({});
            setChatMode(prev => ({
                ...prev,
                currentInput: '',
                inputPositions: []
            }));
        }

        // Determine if click is inside current selection (if any)
        let clickedInsideSelection = false;
        if (selectionStart && selectionEnd) {
            const minX = Math.min(selectionStart.x, selectionEnd.x);
            const maxX = Math.max(selectionStart.x, selectionEnd.x);
            const minY = Math.min(selectionStart.y, selectionEnd.y);
            const maxY = Math.max(selectionStart.y, selectionEnd.y);
            
            clickedInsideSelection = 
                newCursorPos.x >= minX && newCursorPos.x <= maxX && 
                newCursorPos.y >= minY && newCursorPos.y <= maxY;
        }

        if (shiftKey && selectionStart) {
            // Extend selection if shift is held and selection exists
            setSelectionEnd(newCursorPos);
            setCursorPos(newCursorPos); // Update cursor with selection
        } else if (clearSelection && !clickedInsideSelection) {
            // Only clear selection if:
            // 1. We're explicitly asked to clear it AND
            // 2. The click is outside existing selection
            setSelectionStart(null);
            setSelectionEnd(null);
            setCursorPos(newCursorPos);
        } else {
            // Just move the cursor without affecting selection
            setCursorPos(newCursorPos);
        }
    }, [zoomLevel, viewOffset, screenToWorld, selectionStart, selectionEnd, chatMode]);

    const handleCanvasWheel = useCallback((deltaX: number, deltaY: number, canvasRelativeX: number, canvasRelativeY: number, ctrlOrMetaKey: boolean): void => {
        if (ctrlOrMetaKey) {
            // Zooming
            const worldPointBeforeZoom = screenToWorld(canvasRelativeX, canvasRelativeY, zoomLevel, viewOffset);
            const delta = deltaY * ZOOM_SENSITIVITY;
            let newZoom = zoomLevel * (1 - delta);
            newZoom = Math.min(Math.max(newZoom, MIN_ZOOM), MAX_ZOOM);

            const { width: effectiveWidthAfter, height: effectiveHeightAfter } = getEffectiveCharDims(newZoom);
            if (effectiveWidthAfter === 0 || effectiveHeightAfter === 0) return;

            const newViewOffsetX = worldPointBeforeZoom.x - (canvasRelativeX / effectiveWidthAfter);
            const newViewOffsetY = worldPointBeforeZoom.y - (canvasRelativeY / effectiveHeightAfter);

            setZoomLevel(newZoom);
            setViewOffset({ x: newViewOffsetX, y: newViewOffsetY });
        } else {
            // Panning
            const { width: effectiveCharWidth, height: effectiveCharHeight } = getEffectiveCharDims(zoomLevel);
            if (effectiveCharWidth === 0 || effectiveCharHeight === 0) return;
            const deltaWorldX = deltaX / effectiveCharWidth;
            const deltaWorldY = deltaY / effectiveCharHeight;
            setViewOffset(prev => ({ x: prev.x + deltaWorldX, y: prev.y + deltaWorldY }));
        }
    }, [zoomLevel, viewOffset, screenToWorld, getEffectiveCharDims]);

    const handlePanStart = useCallback((clientX: number, clientY: number): PanStartInfo | null => {
        isPanningRef.current = true;
        return {
            startX: clientX,
            startY: clientY,
            startOffset: viewOffset,
        };
    }, [viewOffset]);

    const handlePanMove = useCallback((clientX: number, clientY: number, panStartInfo: PanStartInfo): Point => {
        if (!isPanningRef.current) return viewOffset; // Should not happen if called correctly

        const { width: effectiveCharWidth, height: effectiveCharHeight } = getEffectiveCharDims(zoomLevel);
        if (effectiveCharWidth === 0 || effectiveCharHeight === 0) return viewOffset;

        const dx = clientX - panStartInfo.startX;
        const dy = clientY - panStartInfo.startY;
        const deltaWorldX = dx / effectiveCharWidth;
        const deltaWorldY = dy / effectiveCharHeight;

        // Calculate new offset
        const newOffset = {
            x: panStartInfo.startOffset.x - deltaWorldX,
            y: panStartInfo.startOffset.y - deltaWorldY,
        };
        
        // Track viewport history with throttling to prevent infinite loops
        if (typeof window !== 'undefined' && effectiveCharWidth > 0 && effectiveCharHeight > 0) {
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const centerX = newOffset.x + (viewportWidth / effectiveCharWidth) / 2;
            const centerY = newOffset.y + (viewportHeight / effectiveCharHeight) / 2;
            
            // Update direction tracking with viewport center during panning
            const recentText = getRecentText(centerX, centerY);
            updateDirectionPoint(centerX, centerY, recentText);
        }
        
        return newOffset;
    }, [zoomLevel, getEffectiveCharDims, viewOffset, getRecentText]);

    const handlePanEnd = useCallback((newOffset: Point): void => {
        if (isPanningRef.current) {
            isPanningRef.current = false;
            setViewOffset(newOffset); // Set final state
            
            // Track viewport center for direction calculation
            if (typeof window !== 'undefined') {
                // Calculate center inline to avoid dependency issues
                const { width: effectiveCharWidth, height: effectiveCharHeight } = getEffectiveCharDims(zoomLevel);
                if (effectiveCharWidth > 0 && effectiveCharHeight > 0) {
                    const viewportWidth = window.innerWidth;
                    const viewportHeight = window.innerHeight;
                    const centerX = newOffset.x + (viewportWidth / effectiveCharWidth) / 2;
                    const centerY = newOffset.y + (viewportHeight / effectiveCharHeight) / 2;
                    
                    // Update direction tracking with final viewport center
                    const recentText = getRecentText(centerX, centerY);
                    updateDirectionPoint(centerX, centerY, recentText);
                }
            }
        }
    }, [zoomLevel, getEffectiveCharDims, updateDirectionPoint, getRecentText]);

    const handleSelectionStart = useCallback((canvasRelativeX: number, canvasRelativeY: number): void => {
        const worldPos = screenToWorld(canvasRelativeX, canvasRelativeY, zoomLevel, viewOffset);
        setSelectionStart(worldPos);
        setSelectionEnd(worldPos);
        setCursorPos(worldPos); // Move cursor to selection start
    }, [zoomLevel, viewOffset, screenToWorld]);

    const handleSelectionMove = useCallback((canvasRelativeX: number, canvasRelativeY: number): void => {
        if (selectionStart) { // This is correct - we want to update only if a selection has started
            const worldPos = screenToWorld(canvasRelativeX, canvasRelativeY, zoomLevel, viewOffset);
            setSelectionEnd(worldPos);
        }
    }, [selectionStart, zoomLevel, viewOffset, screenToWorld]);

    const handleSelectionEnd = useCallback((): void => {
        // Simply mark selection process as ended
        setIsSelecting(false);
        
        // We keep the selection intact regardless
        // The selection will be cleared in other functions if needed
        // This allows the selection to persist after mouse up
    }, []);

    const deleteCharacter = useCallback((x: number, y: number): void => {
        const key = `${x},${y}`;
        const newWorldData = { ...worldData };
        delete newWorldData[key];
        setWorldData(newWorldData);
    }, [worldData]);

    const placeCharacter = useCallback((char: string, x: number, y: number): void => {
        if (char.length !== 1) return; // Only handle single characters
        const key = `${x},${y}`;
        const newWorldData = { ...worldData };
        newWorldData[key] = char;
        setWorldData(newWorldData);
    }, [worldData]);

    const getViewportCenter = useCallback((): Point => {
        // Calculate center of viewport in world coordinates
        const { width: effectiveCharWidth, height: effectiveCharHeight } = getEffectiveCharDims(zoomLevel);
        if (effectiveCharWidth === 0 || effectiveCharHeight === 0) {
            return { x: 0, y: 0 };
        }
        
        // Check if we're in browser environment
        if (typeof window === 'undefined') {
            return { x: 0, y: 0 };
        }
        
        // Use window dimensions for viewport size
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // Center of screen in screen coordinates
        const centerScreenX = viewportWidth / 2;
        const centerScreenY = viewportHeight / 2;
        
        // Convert to world coordinates
        return screenToWorld(centerScreenX, centerScreenY, zoomLevel, viewOffset);
    }, [zoomLevel, viewOffset, getEffectiveCharDims, screenToWorld]);

    const getCursorDistanceFromCenter = useCallback((): number => {
        const center = getViewportCenter();
        const deltaX = cursorPos.x - center.x;
        const deltaY = cursorPos.y - center.y;
        
        // Pythagorean theorem: distance = sqrt(deltaX^2 + deltaY^2)
        return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    }, [cursorPos, getViewportCenter]);


    const getBlocksInRegion = useCallback((center: Point, radius: number): Point[] => {
        const blocksInRegion: Point[] = [];
        for (const key in worldData) {
            if (key.startsWith(BLOCK_PREFIX)) {
                const coords = key.substring(BLOCK_PREFIX.length);
                const [xStr, yStr] = coords.split(',');
                const x = parseInt(xStr, 10);
                const y = parseInt(yStr, 10);
                if (!isNaN(x) && !isNaN(y)) {
                    const distance = Math.sqrt(Math.pow(x - center.x, 2) + Math.pow(y - center.y, 2));
                    if (distance <= radius) {
                        blocksInRegion.push({ x, y });
                    }
                }
            }
        }
        return blocksInRegion;
    }, [worldData]);

    const getUniqueColors = useCallback(() => {
        const colors = new Set<string>();
        for (const key in worldData) {
            if (key.startsWith('label_')) {
                try {
                    const labelData = JSON.parse(worldData[key]);
                    const color = labelData.color || '#000000';
                    colors.add(color);
                } catch (e) {
                    // Skip invalid label data
                }
            }
        }
        return Array.from(colors).sort();
    }, [worldData]);

    const toggleColorFilter = useCallback((color: string) => {
        setNavColorFilters(prev => {
            const newFilters = new Set(prev);
            if (newFilters.has(color)) {
                newFilters.delete(color);
            } else {
                newFilters.add(color);
            }
            return newFilters;
        });
    }, []);

    const cycleSortMode = useCallback(() => {
        setNavSortMode(prev => {
            const nextMode = (() => {
                switch (prev) {
                    case 'chronological': return 'closest';
                    case 'closest': return 'farthest';
                    case 'farthest': return 'chronological';
                    default: return 'chronological';
                }
            })();
            
            // Update origin position when switching to distance modes to reflect current viewport center
            if (nextMode === 'closest' || nextMode === 'farthest') {
                const currentCenter = getViewportCenter();
                setNavOriginPosition(currentCenter);
            }
            
            return nextMode;
        });
    }, [getViewportCenter]);

    const getSortedLabels = useCallback((sortMode: NavSortMode, originPos: Point) => {
        const labels: Array<{text: string, x: number, y: number, color: string, creationIndex: number}> = [];
        let creationIndex = 0;
        
        // Collect labels with creation order (based on key order in worldData)
        for (const key in worldData) {
            if (key.startsWith('label_')) {
                const coordsStr = key.substring('label_'.length);
                const [xStr, yStr] = coordsStr.split(',');
                const x = parseInt(xStr, 10);
                const y = parseInt(yStr, 10);
                if (!isNaN(x) && !isNaN(y)) {
                    try {
                        const labelData = JSON.parse(worldData[key]);
                        const text = labelData.text || '';
                        const color = labelData.color || '#000000';
                        if (text.trim()) {
                            labels.push({ text, x, y, color, creationIndex: creationIndex++ });
                        }
                    } catch (e) {
                        // Skip invalid label data
                    }
                }
            }
        }
        
        // Sort based on mode
        switch (sortMode) {
            case 'chronological':
                return labels.sort((a, b) => a.creationIndex - b.creationIndex);
            
            case 'closest':
                return labels.sort((a, b) => {
                    const distA = Math.sqrt(Math.pow(a.x - originPos.x, 2) + Math.pow(a.y - originPos.y, 2));
                    const distB = Math.sqrt(Math.pow(b.x - originPos.x, 2) + Math.pow(b.y - originPos.y, 2));
                    return distA - distB;
                });
            
            case 'farthest':
                return labels.sort((a, b) => {
                    const distA = Math.sqrt(Math.pow(a.x - originPos.x, 2) + Math.pow(a.y - originPos.y, 2));
                    const distB = Math.sqrt(Math.pow(b.x - originPos.x, 2) + Math.pow(b.y - originPos.y, 2));
                    return distB - distA; // Reverse order for farthest first
                });
            
            default:
                return labels;
        }
    }, [worldData]);

    const isBlock = useCallback((x: number, y: number): boolean => {
        const key = `${BLOCK_PREFIX}${x},${y}`;
        return !!worldData[key];
    }, [worldData]);

    // Track last known position to avoid idle updates
    const lastKnownPositionRef = useRef<Point | null>(null);

    // Continuously track viewport center for direction calculation
    useEffect(() => {
        const interval = setInterval(() => {
            if (typeof window !== 'undefined') {
                const center = getViewportCenter();
                
                // Only update if position has actually changed
                if (!lastKnownPositionRef.current || 
                    Math.abs(center.x - lastKnownPositionRef.current.x) > 0.1 ||
                    Math.abs(center.y - lastKnownPositionRef.current.y) > 0.1) {
                    
                    const recentText = getRecentText(center.x, center.y);
                    updateDirectionPoint(center.x, center.y, recentText);
                    lastKnownPositionRef.current = { x: center.x, y: center.y };
                }
            }
        }, 100); // Update every 100ms

        return () => clearInterval(interval);
    }, [getViewportCenter, updateDirectionPoint, getRecentText]);


    return {
        worldData,
        deepspawnData,
        commandData,
        commandState,
        chatData,
        lightModeData,
        searchData,
        viewOffset,
        cursorPos,
        zoomLevel,
        panningDirection,
        backgroundMode,
        backgroundColor,
        backgroundImage,
        backgroundVideo,
        backgroundStream,
        textColor,
        currentTextStyle,
        searchPattern,
        isSearchActive,
        clearSearch,
        settings,
        updateSettings,
        getEffectiveCharDims,
        screenToWorld,
        worldToScreen,
        handleCanvasClick,
        handleCanvasWheel,
        handlePanStart,
        handlePanMove,
        handlePanEnd,
        handleKeyDown,
        setViewOffset, // Expose setter
        setZoomLevel, // Expose zoom setter
        selectionStart,
        selectionEnd,
        handleSelectionStart,
        handleSelectionMove,
        handleSelectionEnd,
        deleteCharacter,
        placeCharacter,
        deleteSelection: deleteSelectedCharacters,
        copySelection: copySelectedCharacters,
        cutSelection: cutSelection,
        paste: pasteText,
        isLoadingWorld,
        isSavingWorld,
        worldPersistenceError,
        getViewportCenter,
        getCursorDistanceFromCenter,
        getBlocksInRegion,
        getAllLabels,
        getSortedLabels,
        getUniqueColors,
        toggleColorFilter,
        navColorFilters,
        cycleSortMode,
        navSortMode,
        isBlock,
        directionPoints,
        getAngleDebugData,
        settings,
        isNavVisible,
        setIsNavVisible,
        navOriginPosition,
        dialogueText,
        setDialogueText,
        chatMode,
        setChatMode,
        getCharacter,
        getCharacterStyle,
        getCompiledText: () => compiledTextCache,
    };
}