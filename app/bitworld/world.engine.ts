// hooks/useWorldEngine.ts
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useWorldSave } from './world.save'; // Import the new hook
import { useCommandSystem, CommandState, CommandExecution, BackgroundMode } from './commands'; // Import command system
import { getSmartIndentation, calculateWordDeletion, extractLineCharacters, detectTextBlocks, findClosestBlock, extractAllTextBlocks, groupTextBlocksIntoClusters, filterClustersForLabeling, generateTextBlockFrames, generateHierarchicalFrames, HierarchicalFrameSystem, HierarchicalFrame, HierarchyLevel, defaultDistanceConfig, DistanceBasedConfig } from './bit.blocks'; // Import block detection utilities
import { useWorldSettings, WorldSettings } from './settings';
import { set, ref } from 'firebase/database';
import { database, auth } from '@/app/firebase';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { transformText, explainText, summarizeText, createSubtitleCycler, chatWithAI, clearChatHistory, setDialogueWithRevert, updateWorldContext, abortCurrentAI, isAIActive } from './ai';
import { logger } from './logger';
import { useAutoDialogue } from './dialogue';
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
    fadeStart?: number; // Timestamp for fade animation
}

export interface ImageData {
    type: 'image';
    src: string; // Data URL or blob URL
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    originalWidth: number;
    originalHeight: number;
}

export interface WorldData { [key: string]: string | StyledCharacter | ImageData; }
export interface Point { x: number; y: number; }

export interface PanStartInfo {
    startX: number;
    startY: number;
    startOffset: Point;
}

export interface WorldEngine {
    worldData: WorldData;
    commandData: WorldData;
    commandState: CommandState;
    commandSystem: { selectCommand: (command: string) => void };
    chatData: WorldData;
    lightModeData: WorldData;
    searchData: WorldData;
    viewOffset: Point;
    cursorPos: Point;
    zoomLevel: number;
    backgroundMode: BackgroundMode;
    backgroundColor: string;
    backgroundImage?: string;
    backgroundVideo?: string;
    textColor: string;
    fontFamily: string;
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
    batchMoveCharacters: (moves: Array<{fromX: number, fromY: number, toX: number, toY: number, char: string}>) => void;
    moveImage: (imageKey: string, deltaX: number, deltaY: number) => void;
    deleteImage: (imageKey: string) => void;
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
    compiledTextCache: { [lineY: number]: string }; // Direct access to compiled text cache for real-time updates
    // Navigation system properties
    isNavVisible: boolean;
    setIsNavVisible: (visible: boolean) => void;
    navOriginPosition: Point;
    navColorFilters: Set<string>;
    navSortMode: 'chronological' | 'closest' | 'farthest';
    navMode: 'labels' | 'states' | 'bounds';
    toggleNavMode: () => void;
    getAllLabels: () => Array<{text: string, x: number, y: number, color: string}>;
    getAllBounds: () => Array<{startX: number, endX: number, startY: number, endY: number, color: string, title?: string}>;
    getSortedLabels: (sortMode: 'chronological' | 'closest' | 'farthest', originPos: Point) => Array<{text: string, x: number, y: number, color: string}>;
    getUniqueColors: () => string[];
    toggleColorFilter: (color: string) => void;
    cycleSortMode: () => void;
    getCharacter: (data: string | StyledCharacter) => string;
    getCharacterStyle: (data: string | StyledCharacter) => { color?: string; background?: string } | undefined;
    isImageData: (data: string | StyledCharacter | ImageData) => data is ImageData;
    getCanvasSize: () => { width: number; height: number };
    saveState: (stateName: string) => Promise<boolean>;
    loadState: (stateName: string) => Promise<boolean>;
    availableStates: string[];
    currentStateName: string | null;
    loadAvailableStates: () => Promise<string[]>;
    username?: string;
    userUid?: string | null;
    // Text frame and cluster system
    textFrames: Array<{
        boundingBox: {
            minX: number;
            maxX: number;
            minY: number;
            maxY: number;
        };
    }>;
    framesVisible: boolean;
    updateTextFrames: () => Promise<void>;
    // Hierarchical frame system
    hierarchicalFrames: HierarchicalFrameSystem | null;
    useHierarchicalFrames: boolean;
    hierarchicalConfig: DistanceBasedConfig;
    clusterLabels: Array<{
        clusterId: string;
        position: { x: number; y: number };
        text: string;
        confidence: number;
        boundingBox: {
            minX: number;
            maxX: number;
            minY: number;
            maxY: number;
        };
    }>;
    clustersVisible: boolean;
    updateClusterLabels: () => Promise<void>;
    focusedBoundKey: string | null;
    isMoveMode: boolean;
    gridMode: import('./commands').GridMode;
    cycleGridMode: () => void;
    artefactsEnabled: boolean;
    artifactType: import('./commands').ArtifactType;
}

// --- Hook Input ---
interface UseWorldEngineProps {
    initialWorldData?: WorldData; // Optional initial data (might be overridden by Firebase)
    initialCursorPos?: Point;
    initialViewOffset?: Point;
    initialZoomLevel?: number;
    worldId: string | null; // Add worldId for persistence
    initialBackgroundColor?: string;
    userUid?: string | null; // Add user UID for user-specific persistence
    username?: string; // Add username for routing
    enableCommands?: boolean; // Enable/disable command system (default: true)
    initialStateName?: string | null; // Initial state name from URL
}



/**
 * Gets smart indentation only if there are nearby text blocks (within maxDistance)
 * @param worldData Combined world data
 * @param cursorPos Current cursor position  
 * @param maxDistance Maximum horizontal distance to consider for indentation
 * @returns X position for indentation or null if no nearby blocks
 */
function getNearbySmartIndentation(worldData: WorldData, cursorPos: {x: number, y: number}, maxDistance: number): number | null {
    // Check a few lines above and below for nearby text
    const searchRange = 3; // Check 3 lines up/down
    
    for (let offsetY = -searchRange; offsetY <= searchRange; offsetY++) {
        const checkY = cursorPos.y + offsetY;
        const lineChars = extractLineCharacters(worldData, checkY);
        
        if (lineChars.length === 0) continue;
        
        const blocks = detectTextBlocks(lineChars);
        const closest = findClosestBlock(blocks, cursorPos.x);
        
        if (closest && closest.distance <= maxDistance) {
            return closest.block.start;
        }
    }
    
    return null; // No nearby text blocks found
}

// --- The Hook ---
export function useWorldEngine({
    initialWorldData = {},
    initialCursorPos = { x: 0, y: 0 },
    initialViewOffset = { x: 0, y: 0 },
    initialZoomLevel = 1, // Default zoom level index
    worldId = null,      // Default to no persistence
    initialBackgroundColor,
    userUid = null,      // Default to no user-specific persistence
    enableCommands = true, // Default to enabled
    username,            // Username for routing
    initialStateName = null, // Initial state name from URL
}: UseWorldEngineProps): WorldEngine {
    // === Router ===
    const router = useRouter();
    
    const [isSelecting, setIsSelecting] = useState(false);
    const [selectionStart, setSelectionStart] = useState<Point | null>(null);
    const [selectionEnd, setSelectionEnd] = useState<Point | null>(null);

    // === State ===
    const [worldData, setWorldData] = useState<WorldData>(initialWorldData);
    const [cursorPos, setCursorPos] = useState<Point>(initialCursorPos);
    const [viewOffset, setViewOffset] = useState<Point>(initialViewOffset);
    const [zoomLevel, setZoomLevel] = useState<number>(initialZoomLevel); // Store zoom *level*, not index
    const [focusedBoundKey, setFocusedBoundKey] = useState<string | null>(null); // Track which bound is focused
    const [boundCycleIndex, setBoundCycleIndex] = useState<number>(0); // Track which bound to cycle to next
    const [dialogueText, setDialogueText] = useState('');
    
    // Double ESC detection for AI interruption
    const lastEscTimeRef = useRef<number | null>(null);
    const [lastEnterX, setLastEnterX] = useState<number | null>(null); // Track X position from last Enter
    
    // Auto-clear temporary dialogue messages
    useAutoDialogue(dialogueText, setDialogueText);
    
    // Effect to detect when cursor is on a bounded region
    useEffect(() => {
        let foundBoundKey: string | null = null;
        let bestMatch: { key: string, priority: number } | null = null;
        
        for (const key in worldData) {
            if (key.startsWith('bound_')) {
                try {
                    const boundData = JSON.parse(worldData[key] as string);
                    const { startX, endX, startY, endY, maxY } = boundData;
                    
                    // Check if cursor is within the bounded region
                    const withinOriginalBounds = cursorPos.x >= startX && cursorPos.x <= endX &&
                                                 cursorPos.y >= startY && cursorPos.y <= endY;
                    
                    // Also check if cursor is in the column constraint area (below the bound but within maxY)
                    const withinColumnConstraint = endY < cursorPos.y && 
                                                  cursorPos.x >= startX && cursorPos.x <= endX &&
                                                  (maxY === null || maxY === undefined || cursorPos.y <= maxY);
                    
                    if (withinOriginalBounds || withinColumnConstraint) {
                        // Priority system: prefer bounds where cursor is on top bar, then original bounds, then column constraints
                        let priority = 0;
                        if (cursorPos.y === startY) {
                            priority = 3; // Highest priority: cursor is on the top bar
                        } else if (withinOriginalBounds) {
                            priority = 2; // Medium priority: cursor is within original bounds
                        } else if (withinColumnConstraint) {
                            priority = 1; // Lowest priority: cursor is in column constraint area
                        }
                        
                        // Use the bound with highest priority, or if tied, the first one found
                        if (!bestMatch || priority > bestMatch.priority) {
                            bestMatch = { key, priority };
                        }
                    }
                } catch (e) {
                    // Skip invalid bound data
                }
            }
        }
        
        foundBoundKey = bestMatch?.key || null;
        setFocusedBoundKey(foundBoundKey);
    }, [cursorPos, worldData]);
    
    // Helper function to get world paths directly under /worlds/{userUid}/
    const getUserPath = useCallback((worldPath: string) => userUid ? `worlds/${userUid}/${worldPath.replace('worlds/', '')}` : `worlds/${worldPath.replace('worlds/', '')}`, [userUid]);

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
    
    // === Text Frame and Cluster System ===
    const [textFrames, setTextFrames] = useState<Array<{
        boundingBox: {
            minX: number;
            maxX: number;
            minY: number;
            maxY: number;
        };
    }>>([]);
    const [framesVisible, setFramesVisible] = useState<boolean>(false);
    
    // === Hierarchical Frame System ===
    const [hierarchicalFrames, setHierarchicalFrames] = useState<HierarchicalFrameSystem | null>(null);
    const [useHierarchicalFrames, setUseHierarchicalFrames] = useState<boolean>(true);
    const [showAllLevels, setShowAllLevels] = useState<boolean>(true);
    const [hierarchicalConfig, setHierarchicalConfig] = useState<DistanceBasedConfig>(defaultDistanceConfig);
    
    const [clusterLabels, setClusterLabels] = useState<Array<{
        clusterId: string;
        position: { x: number; y: number };
        text: string;
        confidence: number;
        boundingBox: {
            minX: number;
            maxX: number;
            minY: number;
            maxY: number;
        };
    }>>([]);
    const [clustersVisible, setClustersVisible] = useState<boolean>(false);
    
    // === State Management System ===
    const [statePrompt, setStatePrompt] = useState<{
        type: 'load_confirm' | 'save_before_load_confirm' | 'save_before_load_name' | 'delete_confirm' | null;
        stateName?: string;
        loadStateName?: string; // The state we want to load after saving
        inputBuffer?: string;
    }>({ type: null });
    const [availableStates, setAvailableStates] = useState<string[]>([]);
    const [currentStateName, setCurrentStateName] = useState<string | null>(initialStateName); // Track which state we're currently in

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
                        const labelData = JSON.parse(worldData[key] as string);
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

    const getAllBounds = useCallback(() => {
        const bounds: Array<{startX: number, endX: number, startY: number, endY: number, color: string, title?: string}> = [];
        for (const key in worldData) {
            if (key.startsWith('bound_')) {
                try {
                    const boundData = JSON.parse(worldData[key] as string);
                    if (boundData.startX !== undefined && boundData.endX !== undefined &&
                        boundData.startY !== undefined && boundData.endY !== undefined) {
                        bounds.push({
                            startX: boundData.startX,
                            endX: boundData.endX,
                            startY: boundData.startY,
                            endY: boundData.endY,
                            color: boundData.color || '#FFFF00',
                            title: boundData.title
                        });
                    }
                } catch (e) {
                    // Skip invalid bound data
                }
            }
        }
        return bounds;
    }, [worldData]);

    // === Character Dimensions Calculation ===
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

    // === Screen-World Coordinate Conversion ===
    const screenToWorld = useCallback((screenX: number, screenY: number, currentZoom: number, currentOffset: Point): Point => {
        const { width: effectiveCharWidth, height: effectiveCharHeight } = getEffectiveCharDims(currentZoom);
        if (effectiveCharWidth === 0 || effectiveCharHeight === 0) return currentOffset;
        const worldX = screenX / effectiveCharWidth + currentOffset.x;
        const worldY = screenY / effectiveCharHeight + currentOffset.y;
        return { x: Math.floor(worldX), y: Math.floor(worldY) };
    }, [getEffectiveCharDims]);

    // === Viewport Center Calculation ===
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

        // === Text Frame Generation (No AI) ===
    const updateTextFrames = useCallback(async () => {
        try {
            
            if (useHierarchicalFrames) {
                // Generate hierarchical frames based on distance from viewport
                const viewportCenter = getViewportCenter();
                const hierarchicalSystem = generateHierarchicalFrames(
                    worldData, 
                    viewportCenter, 
                    zoomLevel, 
                    hierarchicalConfig,
                    undefined,
                    showAllLevels
                );
                logger.debug('Generated hierarchical frames:', hierarchicalSystem.activeFrames.length);
                logger.debug('Levels:', Object.fromEntries(hierarchicalSystem.levels));
                
                setHierarchicalFrames(hierarchicalSystem);
                
                // Also generate simple frames for backward compatibility
                const simpleFrames = hierarchicalSystem.activeFrames.map(frame => ({
                    boundingBox: frame.boundingBox
                }));
                setTextFrames(simpleFrames);
            } else {
                // Generate simple bounding frames around text clusters
                const frames = generateTextBlockFrames(worldData);
                logger.debug('Generated simple frames:', frames.length);
                
                setTextFrames(frames);
                setHierarchicalFrames(null);
            }
        } catch (error) {
            logger.error('Error updating text frames:', error);
        }
    }, [worldData, useHierarchicalFrames, zoomLevel, hierarchicalConfig, showAllLevels, getViewportCenter]);

    // === Text Cluster Label Generation ===
    const updateClusterLabels = useCallback(async () => {
        try {
            
            // Import clustering functions
            const { 
                filterClustersForLabeling, 
                generateClusterLabels,
                HierarchyLevel
            } = await import('./bit.blocks');

            let clustersToLabel;

            if (useHierarchicalFrames && hierarchicalFrames) {
                // Use L2 frames directly - create synthetic clusters from blue frame bounding boxes
                const l2Frames = hierarchicalFrames.levels.get(HierarchyLevel.GROUPED) || [];
                logger.debug('Found L2 frames:', l2Frames.length);
                
                // Create synthetic clusters directly from L2 frame bounding boxes (filter out invalid ones)
                clustersToLabel = l2Frames
                    .filter(frame => {
                        const bbox = frame.boundingBox;
                        const isValid = !isNaN(bbox.minX) && !isNaN(bbox.maxX) && !isNaN(bbox.minY) && !isNaN(bbox.maxY);
                        if (!isValid) {
                            logger.debug('Filtering out invalid L2 frame:', frame.id, bbox);
                        }
                        return isValid;
                    })
                    .map((frame, index) => ({
                        id: `l2_frame_${index}`,
                        blocks: [], // Not needed for labeling
                        lines: [], // Not needed for labeling
                        boundingBox: frame.boundingBox,
                        density: 1.0, // Set high enough to pass filtering
                        totalCharacters: 100, // Fake values to pass filtering
                        estimatedWords: 10,
                        centroid: frame.center,
                        leftMargin: frame.boundingBox.minX
                    }));
                logger.debug('Using synthetic L2 clusters from blue frames:', clustersToLabel.length);
            } else {
                // Fallback: generate frames first to get clusters
                logger.debug('No hierarchical frames available, generating them first...');
                await updateTextFrames();
                
                if (hierarchicalFrames) {
                    const l2Frames = hierarchicalFrames.levels.get(HierarchyLevel.GROUPED) || [];
                    clustersToLabel = l2Frames
                        .filter(frame => {
                            const bbox = frame.boundingBox;
                            const isValid = !isNaN(bbox.minX) && !isNaN(bbox.maxX) && !isNaN(bbox.minY) && !isNaN(bbox.maxY);
                            if (!isValid) {
                                logger.debug('Filtering out invalid L2 frame:', frame.id, bbox);
                            }
                            return isValid;
                        })
                        .map((frame, index) => ({
                            id: `l2_frame_${index}`,
                            blocks: [], 
                            lines: [], 
                            boundingBox: frame.boundingBox,
                            density: 1.0,
                            totalCharacters: 100,
                            estimatedWords: 10,
                            centroid: frame.center,
                            leftMargin: frame.boundingBox.minX
                        }));
                    logger.debug('Generated synthetic L2 clusters from blue frames:', clustersToLabel.length);
                } else {
                    logger.debug('Failed to generate hierarchical frames, skipping cluster labels');
                    return;
                }
            }
            
            // Debug L2 cluster properties
            clustersToLabel.forEach((cluster, i) => {
                logger.debug(`L2 cluster ${i}:`, {
                    id: cluster.id,
                    blocks: cluster.blocks.length,
                    density: cluster.density,
                    words: cluster.estimatedWords,
                    boundingBox: cluster.boundingBox
                });
            });
            
            // Skip filtering - use all valid L2 clusters directly for labeling
            logger.debug('Using all L2 clusters directly for labeling:', clustersToLabel.length);
            
            // Generate AI labels for L2 clusters
            const aiLabels = await generateClusterLabels(clustersToLabel, worldData);
            logger.debug('Generated AI labels for L2:', aiLabels.length);
            
            // Convert to simplified format for rendering
            const simplifiedLabels = aiLabels.map(label => ({
                clusterId: label.clusterId,
                position: label.position,
                text: label.text,
                confidence: label.confidence,
                boundingBox: label.boundingBox
            }));
            
            logger.debug('Final L2 cluster labels:', simplifiedLabels);
            setClusterLabels(simplifiedLabels);
            
            // Save cluster regions to Firebase if we have a current state
            if (currentStateName && userUid) {
                try {
                    const regionsRef = ref(database, getUserPath(`${currentStateName}/regions`));
                    const regionsData = {
                        clusters: simplifiedLabels,
                        lastGenerated: Date.now(),
                        clustersVisible: true // Set to true since we just generated
                    };
                    await set(regionsRef, regionsData);
                    logger.debug('Cluster regions saved to Firebase');
                } catch (error) {
                    logger.error('Failed to save cluster regions:', error);
                }
            }
            
        } catch (error) {
            logger.error('Error updating cluster labels:', error);
            // Don't clear existing labels on error, just log it
        }
    }, [worldData, currentStateName, userUid, getUserPath, useHierarchicalFrames, hierarchicalFrames, updateTextFrames]);

    // === Responsive Frame Updates ===
    // Auto-update frames when world data changes (with debounce)
    useEffect(() => {
        if (!framesVisible) return; // Only auto-update if frames are visible
        
        const debounceTimeout = setTimeout(() => {
            updateTextFrames();
            // Note: Cluster labels (AI) only regenerate when explicitly requested via /cluster command
        }, 500); // 500ms debounce to avoid excessive updates while typing
        
        return () => clearTimeout(debounceTimeout);
    }, [worldData, framesVisible, updateTextFrames]);

    // === Selection Helper Functions ===
    // Helper function to get normalized selection bounds
    const getNormalizedSelection = useCallback(() => {
        if (!selectionStart || !selectionEnd) return null;
        const startX = Math.min(selectionStart.x, selectionEnd.x);
        const startY = Math.min(selectionStart.y, selectionEnd.y);
        const endX = Math.max(selectionStart.x, selectionEnd.x);
        const endY = Math.max(selectionStart.y, selectionEnd.y);
        return { startX, startY, endX, endY };
    }, [selectionStart, selectionEnd]);

    // Helper function to check if there's an active selection
    const hasActiveSelection = useCallback(() => {
        return selectionStart !== null && selectionEnd !== null;
    }, [selectionStart, selectionEnd]);

    // === Settings System ===
    const { settings, setSettings, updateSettings } = useWorldSettings();
    
    // === Command System ===
    const { 
        commandState, 
        commandData, 
        handleKeyDown: handleCommandKeyDown,
        selectCommand,
        pendingCommand,
        executePendingCommand,
        setPendingCommand,
        currentMode,
        addEphemeralText,
        addAIResponse,
        addInstantAIResponse,
        lightModeData,
        backgroundMode,
        backgroundColor,
        backgroundImage,
        backgroundVideo,
        textColor,
        fontFamily,
        currentTextStyle,
        searchPattern,
        isSearchActive,
        clearSearch,
        cameraMode,
        isIndentEnabled,
        isMoveMode,
        exitMoveMode,
        gridMode,
        cycleGridMode,
        artefactsEnabled,
        artifactType,
    } = useCommandSystem({ setDialogueText, initialBackgroundColor, getAllLabels, getAllBounds, availableStates, username, updateSettings, settings });

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
            // Skip special keys (blocks, labels, bounds, etc.)
            if (key.startsWith('block_') || key.startsWith('label_') || key.startsWith('bound_')) {
                continue;
            }

            const [xStr, yStr] = key.split(',');
            const x = parseInt(xStr, 10);
            const y = parseInt(yStr, 10);
            const charData = worldData[key];
            
            // Skip image data - only process text characters
            if (isImageData(charData)) {
                continue;
            }
            
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
                    if (checkCharData && !isImageData(checkCharData)) {
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
    
    // === Ambient Text Compilation System ===
    const [compiledTextCache, setCompiledTextCache] = useState<{ [lineY: number]: string }>({});
    const lastCompiledRef = useRef<{ [lineY: number]: string }>({});
    const compilationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    
    const compileTextStrings = useCallback((worldData: WorldData): { [lineY: number]: { content: string, range: { minX: number, maxX: number, minY: number, maxY: number } } } => {
        const compiledLines: { [lineY: number]: { content: string, range: { minX: number, maxX: number, minY: number, maxY: number } } } = {};
        const lineData: { [lineY: number]: Array<{ x: number, char: string }> } = {};
        
        // Group characters by line
        for (const key in worldData) {
            // Skip special keys (blocks, labels, bounds, etc.)
            if (key.startsWith('block_') || key.startsWith('label_') || key.startsWith('bound_')) {
                continue;
            }
            
            const [xStr, yStr] = key.split(',');
            const x = parseInt(xStr, 10);
            const y = parseInt(yStr, 10);
            
            if (!isNaN(x) && !isNaN(y)) {
                // Skip image data - only process text characters
                if (isImageData(worldData[key])) {
                    continue;
                }
                const char = getCharacter(worldData[key]);
                
                if (!lineData[y]) {
                    lineData[y] = [];
                }
                lineData[y].push({ x, char });
            }
        }
        
        // Sort lines by y-coordinate and compile each line into a string with order-based indexing
        const sortedYValues = Object.keys(lineData).map(y => parseInt(y, 10)).sort((a, b) => a - b);
        let lineIndex = 0;
        
        for (const y of sortedYValues) {
            const chars = lineData[y].sort((a, b) => a.x - b.x);
            
            if (chars.length === 0) continue;
            
            // Calculate range for this line
            const minX = Math.min(...chars.map(c => c.x));
            const maxX = Math.max(...chars.map(c => c.x));
            const minY = y;
            const maxY = y;
            
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
            
            // Only store non-empty lines with order-based index
            if (line.trim()) {
                compiledLines[lineIndex] = {
                    content: line,
                    range: { minX, maxX, minY, maxY }
                };
                lineIndex++;
            }
        }
        
        return compiledLines;
    }, []);

    // Ambient text compilation and Firebase sync
    useEffect(() => {
        if (!worldId || userUid === undefined) return;

        // Additional check to ensure userUid is not null/undefined before proceeding
        if (!userUid) return;

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
                if (lastCompiledRef.current[y] !== compiled[y].content) {
                    changes[y] = {
                        old: lastCompiledRef.current[y],
                        new: compiled[y].content
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
                
                const contentPath = currentStateName ? 
                    getUserPath(`${currentStateName}/content`) :
                    getUserPath(`${worldId}/content`);
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
                
                // Convert compiled objects to just content strings
                const compiledContentOnly: { [lineY: number]: string } = {};
                for (const lineY in compiled) {
                    compiledContentOnly[parseInt(lineY)] = compiled[lineY].content;
                }
                
                // Send batch update to Firebase
                set(compiledTextRef, { ...lastCompiledRef.current, ...updates })
                    .then(() => {
                        lastCompiledRef.current = compiledContentOnly;
                        setCompiledTextCache(compiledContentOnly);
                    })
                    .catch(error => {
                        logger.error('Failed to sync compiled text:', error);
                    });
            }
        }, 300); // 300ms debounce

        return () => {
            if (compilationTimeoutRef.current) {
                clearTimeout(compilationTimeoutRef.current);
            }
        };
    }, [worldData, worldId, compileTextStrings, currentStateName, getUserPath, userUid]);

    // === State Management Functions ===
    const saveState = useCallback(async (stateName: string): Promise<boolean> => {
        if (!worldId || userUid === undefined) return false;
        
        // Additional check to ensure userUid is not null/undefined before proceeding
        if (!userUid) return false;
        
        try {
            // Save directly to worlds/{userId}/{stateName}
            const stateRef = ref(database, getUserPath(`${stateName}`));
            
            // Compile text strings from individual characters
            const compiledText = compileTextStrings(worldData);
            
            const stateData = {
                worldData, // Individual character positions (for canvas)
                compiledText, // Compiled text strings (for text operations)
                settings,
                timestamp: Date.now(),
                cursorPos,
                viewOffset,
                zoomLevel,
                regions: {
                    clusters: clusterLabels,
                    lastGenerated: clusterLabels.length > 0 ? Date.now() : null,
                    clustersVisible: clustersVisible
                }
            };
            
            await set(stateRef, stateData);
            setCurrentStateName(stateName); // Track that we're now in this state
            return true;
        } catch (error) {
            logger.error('Error saving state:', error);
            return false;
        }
    }, [worldId, worldData, settings, cursorPos, viewOffset, zoomLevel, clusterLabels, clustersVisible, getUserPath, userUid]);

    const loadState = useCallback(async (stateName: string): Promise<boolean> => {
        if (!worldId || userUid === undefined) return false;
        
        // Additional check to ensure userUid is not null/undefined before proceeding
        if (!userUid) return false;
        
        try {
            // Load directly from worlds/{userId}/{stateName}
            const stateRef = ref(database, getUserPath(`${stateName}`));
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
                if (stateData.regions) {
                    // Restore cluster regions if they exist
                    if (stateData.regions.clusters) {
                        setClusterLabels(stateData.regions.clusters);
                    }
                    if (stateData.regions.clustersVisible !== undefined) {
                        setClustersVisible(stateData.regions.clustersVisible);
                    }
                }
            } else {
                return false;
            }
            
            setCurrentStateName(stateName); // Track that we're now in this state
            return true;
        } catch (error) {
            logger.error('Error loading state:', error);
            return false;
        }
    }, [worldId, setSettings, getUserPath, userUid]);

    const loadAvailableStates = useCallback(async (): Promise<string[]> => {
        try {
            if (!userUid) {
                return [];
            }
            
            const statesPath = `worlds/${userUid}`;
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
            
            if (statesData && typeof statesData === 'object') {
                // Filter out 'home' and only return actual saved states
                const allKeys = Object.keys(statesData);
                const stateNames = allKeys.filter(key => key !== 'home').sort();
                return stateNames;
            }
            return [];
        } catch (error) {
            // For public viewing, permission errors are expected when trying to list states
            // Return empty array gracefully without logging errors for permission issues
            if (error instanceof Error && error.message && error.message.includes('Permission denied')) {
                return [];
            }
            logger.error('Error loading available states:', error);
            return [];
        }
    }, [userUid, worldId]);

    const deleteState = useCallback(async (stateName: string): Promise<boolean> => {
        if (!worldId || !userUid) return false;
        
        try {
            const stateRef = ref(database, getUserPath(`${stateName}`));
            await set(stateRef, null); // Firebase way to delete
            
            // If we're deleting the current state, clear the current state name
            if (currentStateName === stateName) {
                setCurrentStateName(null);
            }
            
            return true;
        } catch (error) {
            logger.error('Error deleting state:', error);
            return false;
        }
    }, [worldId, currentStateName, getUserPath, userUid]);

    const publishState = useCallback(async (stateName: string, isPublic: boolean): Promise<boolean> => {
        if (!worldId || !userUid) return false;
        
        try {
            // Set the public flag at the root level of the state (not in metadata)
            const publicRef = ref(database, getUserPath(`${stateName}/public`));
            await set(publicRef, isPublic);
            return true;
        } catch (error) {
            logger.error('Error updating state publish status:', error);
            return false;
        }
    }, [worldId, getUserPath, userUid]);

    const getStatePublishStatus = useCallback((stateName: string): boolean => {
        // For now, return false as default. This would need to be implemented
        // with actual metadata loading from Firebase
        return false;
    }, []);

    // Load available states on component mount
    useEffect(() => {
        if (userUid === undefined) return;
        loadAvailableStates().then(states => {
            setAvailableStates(states);
        });
    }, [loadAvailableStates, userUid]);
    
    // Load compiled text on mount
    useEffect(() => {
        if (!worldId || !userUid) return;
        
        const contentPath = currentStateName ? 
            getUserPath(`${currentStateName}/content`) :
            getUserPath(`${worldId}/content`);
        const compiledTextRef = ref(database, contentPath);
        get(compiledTextRef).then((snapshot) => {
            const compiledText = snapshot.val();
            if (compiledText) {
                lastCompiledRef.current = compiledText;
                setCompiledTextCache(compiledText);
            }
        }).catch(error => {
            // For public viewing, permission errors are expected when accessing content
            if (error instanceof Error && error.message && error.message.includes('Permission denied')) {
                return;
            }
            logger.error('Failed to load compiled text:', error);
        });
    }, [worldId, currentStateName, getUserPath, userUid]);

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
    const [navMode, setNavMode] = useState<'labels' | 'states' | 'bounds'>('labels');

    const toggleNavMode = useCallback(() => {
        setNavMode(prev => {
            if (prev === 'labels') return 'states';
            if (prev === 'states') return 'bounds';
            return 'labels';
        });
    }, []);

    // === Immediate Settings Save Function ===
    const saveSettingsToFirebase = useCallback(async (newSettings: Partial<WorldSettings>) => {
        if (!worldId || !userUid) return;
        
        try {
            const settingsRef = ref(database, getUserPath(`${worldId}/settings`));
            // Merge settings and filter out undefined values to prevent Firebase errors
            const merged = { ...settings, ...newSettings };
            const updatedSettings = Object.entries(merged).reduce((acc, [key, value]) => {
                if (value !== undefined) {
                    (acc as any)[key] = value;
                }
                return acc;
            }, {} as WorldSettings);
            await set(settingsRef, updatedSettings);
        } catch (error) {
            logger.error('Failed to save settings to Firebase:', error);
        }
    }, [worldId, settings, getUserPath, userUid]);
    

    
    const isPanningRef = useRef(false);
    const clipboardRef = useRef<{ text: string, width: number, height: number } | null>(null);

    // === Persistence ===
    // Only enable world save when userUid is available to prevent permission errors on refresh
    const shouldEnableWorldSave = worldId && (userUid !== undefined);
    const {
        isLoading: isLoadingWorld,
        isSaving: isSavingWorld,
        error: worldPersistenceError
    } = useWorldSave(
        shouldEnableWorldSave ? worldId : null, 
        worldData, 
        setWorldData, 
        settings, 
        setSettings, 
        true, 
        currentStateName, 
        userUid
    ); // Only enable when userUid is available

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
                    const charData = worldData[key];
                    
                    // Skip image data - only process text/label characters
                    if (isImageData(charData)) {
                        continue;
                    }
                    
                    const charString = getCharacter(charData);
                    const data = JSON.parse(charString);
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

    const isImageData = useCallback((data: string | StyledCharacter | ImageData): data is ImageData => {
        return typeof data === 'object' && 'type' in data && data.type === 'image';
    }, []);

    // === Bounded Region Detection ===
    const getBoundedRegion = useCallback((worldData: WorldData, cursorPos: Point): { startX: number; endX: number; y: number } | null => {
        // Check if cursor is within any bounded region
        const cursorX = cursorPos.x;
        const cursorY = cursorPos.y;
        
        let closestBoundAbove: { startX: number; endX: number; y: number } | null = null;
        let closestBoundY = -Infinity;
        
        // Look through all bound_ entries
        for (const key in worldData) {
            if (key.startsWith('bound_')) {
                try {
                    const boundData = JSON.parse(worldData[key] as string);
                    
                    // First check: is cursor within the bounds of this region?
                    if (cursorX >= boundData.startX && cursorX <= boundData.endX &&
                        cursorY >= boundData.startY && cursorY <= boundData.endY) {
                        
                        // Return the bounds for the current row (supporting multi-row bounded regions)
                        return { 
                            startX: boundData.startX, 
                            endX: boundData.endX, 
                            y: cursorY 
                        };
                    }
                    
                    // Second check: is this bound above us and within x range?
                    // Find the closest bound above that spans our x position
                    if (boundData.endY < cursorY && // Bound is above current position
                        cursorX >= boundData.startX && cursorX <= boundData.endX && // We're within its x range
                        boundData.endY > closestBoundY && // It's closer than any previous bound
                        (boundData.maxY === null || boundData.maxY === undefined || cursorY <= boundData.maxY)) { // Check height limit
                        
                        closestBoundAbove = {
                            startX: boundData.startX,
                            endX: boundData.endX,
                            y: cursorY // Use current cursor Y for the returned bound
                        };
                        closestBoundY = boundData.endY;
                    }
                } catch (e) {
                    // Skip invalid bound data
                }
            }
        }
        
        // Return the closest bound above if found
        return closestBoundAbove;
    }, []);


    // === Helper Functions (Largely unchanged, but use state variables) ===
    const worldToScreen = useCallback((worldX: number, worldY: number, currentZoom: number, currentOffset: Point): Point => {
        const { width: effectiveCharWidth, height: effectiveCharHeight } = getEffectiveCharDims(currentZoom);
        const screenX = (worldX - currentOffset.x) * effectiveCharWidth;
        const screenY = (worldY - currentOffset.y) * effectiveCharHeight;
        return { x: screenX, y: screenY };
    }, [getEffectiveCharDims]);

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
                const char = charData && !isImageData(charData) ? getCharacter(charData) : ' ';
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
                    const charData = newWorldData[key];
                    
                    // Skip image data - only process text/label characters
                    if (isImageData(charData)) {
                        continue;
                    }
                    
                    const charString = getCharacter(charData);
                    const data = JSON.parse(charString);
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
                const char = charData && !isImageData(charData) ? getCharacter(charData) : ' ';
                line += char; // Use space for empty cells
            }
            lines.push(line);
        }
        const copiedText = lines.join('\n');

        if (copiedText.length > 0 || (selectionWidth > 0 && selectionHeight > 0)) { // Copy even if selection is empty spaces
            // clipboardRef.current = { text: copiedText, width: selectionWidth, height: selectionHeight }; // Assuming clipboardRef exists
            // Use system clipboard as well
            navigator.clipboard.writeText(copiedText).catch(err => logger.warn('Could not copy to system clipboard:', err));
            return true;
        }
        return false;
    }, [worldData, getNormalizedSelection]); // Removed clipboardRef dependency for now

    // Define pasteText BEFORE handleKeyDown uses it
    const pasteText = useCallback(async (): Promise<boolean> => {
        try {
            const clipText = await navigator.clipboard.readText();
            
            const selection = getNormalizedSelection();
            const pasteStartX = selection ? selection.startX : cursorPos.x;
            const pasteStartY = selection ? selection.startY : cursorPos.y;

            const linesToPaste = clipText.split('\n');
            const finalCursorX = pasteStartX + (linesToPaste[linesToPaste.length - 1]?.length || 0);
            const finalCursorY = pasteStartY + linesToPaste.length - 1;

            // Optimistically update cursor and clear selection
            setCursorPos({ x: finalCursorX, y: finalCursorY });
            setSelectionStart(null);
            setSelectionEnd(null);

            // Apply deletion first
            if (selection) {
                setWorldData(prev => {
                    const updated = { ...prev };
                    for (let y = selection.startY; y <= selection.endY; y++) {
                        for (let x = selection.startX; x <= selection.endX; x++) {
                            delete updated[`${x},${y}`];
                        }
                    }
                    return updated;
                });
            }

            // Process paste in chunks
            const processChunk = (lineIndex = 0) => {
                const chunkSize = 50; // lines per chunk
                const chunkEnd = Math.min(lineIndex + chunkSize, linesToPaste.length);
                
                const worldUpdateChunk: WorldData = {};
                for (let i = lineIndex; i < chunkEnd; i++) {
                    const line = linesToPaste[i];
                    for (let j = 0; j < line.length; j++) {
                        worldUpdateChunk[`${pasteStartX + j},${pasteStartY + i}`] = line[j];
                    }
                }

                setWorldData(prev => ({ ...prev, ...worldUpdateChunk }));

                if (chunkEnd < linesToPaste.length) {
                    setTimeout(() => processChunk(chunkEnd), 16);
                }
            };

            // Start chunking after a short delay to allow deletion to render
            setTimeout(() => processChunk(0), 16);

            return true;
        } catch (err) {
            logger.warn('Could not read from system clipboard or paste failed:', err);
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

        // === Double ESC Detection for AI Interruption ===
        if (key === 'Escape') {
            const currentTime = Date.now();
            const lastEscTime = lastEscTimeRef.current;
            
            if (lastEscTime && currentTime - lastEscTime < 500) { // 500ms window for double ESC
                // Double ESC detected - interrupt AI operations
                if (isAIActive()) {
                    const wasAborted = abortCurrentAI();
                    if (wasAborted) {
                        setDialogueWithRevert("AI operation interrupted", setDialogueText, 1500);
                        // Clear any chat processing state
                        setChatMode(prev => ({ 
                            ...prev, 
                            isProcessing: false 
                        }));
                        lastEscTimeRef.current = null; // Reset ESC timing
                        return true;
                    }
                }
                lastEscTimeRef.current = null; // Reset on double ESC
            } else {
                // First ESC - record the time
                lastEscTimeRef.current = currentTime;
            }
        } else {
            // Reset ESC timing on any other key
            lastEscTimeRef.current = null;
        }

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

        // === Move Mode Exit ===
        if (key === 'Escape' && isMoveMode) {
            exitMoveMode();
            setDialogueWithRevert("Move mode disabled", setDialogueText);
            return true;
        }
        
        // === Command Handling (Early Priority) ===
        if (enableCommands) {
            const commandResult = handleCommandKeyDown(key, cursorPos, setCursorPos);
            if (commandResult && typeof commandResult === 'object') {
                // It's a command execution object - handle it
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
                                    const viewportCharWidth = window.innerWidth / effectiveCharWidth;
                                    const viewportCharHeight = window.innerHeight / effectiveCharHeight;
                                    setViewOffset({
                                        x: targetX - viewportCharWidth / 2,
                                        y: targetY - viewportCharHeight / 2
                                    });
                                }
                            }
                        }
                    } else {
                        // Open navigation dialogue
                        setIsNavVisible(true);
                    }
                } else if (exec.command === 'chat') {
                    setChatMode({
                        isActive: true,
                        currentInput: '',
                        inputPositions: [],
                        isProcessing: false
                    });
                } else if (exec.command === 'label') {
                    // Check if this is a --distance command
                    if (exec.args.length >= 2 && exec.args[0] === '--distance') {
                        const distanceStr = exec.args[1];
                        
                        if (distanceStr.toLowerCase() === 'off') {
                            // Set to maximum value to effectively disable distance filtering
                            const newSettings = { labelProximityThreshold: 999999 };
                            updateSettings(newSettings);
                            saveSettingsToFirebase(newSettings);
                            setDialogueWithRevert("Label distance filtering disabled", setDialogueText);
                        } else {
                            const distance = parseInt(distanceStr, 10);
                            
                            if (!isNaN(distance) && distance > 0) {
                                // Update the labelProximityThreshold setting
                                const newSettings = { labelProximityThreshold: distance };
                                updateSettings(newSettings);
                                saveSettingsToFirebase(newSettings);
                                setDialogueWithRevert(`Label distance threshold set to ${distance}`, setDialogueText);
                            } else {
                                setDialogueWithRevert("Invalid distance. Please provide a positive number or 'off'.", setDialogueText);
                            }
                        }
                    } else if (exec.args.length >= 1) {
                        // Parse the raw command input to handle quoted strings
                        const fullCommand = exec.command + ' ' + exec.args.join(' ');
                        const commandParts = fullCommand.split(' ');
                        
                        let text = '';
                        let textColor = '#000000'; // Default black text
                        let backgroundColor = '#FFFFFF'; // Default white background
                        
                        // Check for quoted text (single quotes)
                        const quotedMatch = fullCommand.match(/label\s+'([^']+)'(?:\s+(\S+))?(?:\s+(\S+))?/);
                        
                        if (quotedMatch) {
                            // Found quoted text
                            text = quotedMatch[1];
                            if (quotedMatch[2]) textColor = quotedMatch[2];
                            if (quotedMatch[3]) backgroundColor = quotedMatch[3];
                        } else {
                            // No quotes - use first argument as text
                            text = exec.args[0];
                            if (exec.args[1]) textColor = exec.args[1];
                            if (exec.args[2]) backgroundColor = exec.args[2];
                        }
                        
                        const labelKey = `label_${exec.commandStartPos.x},${exec.commandStartPos.y}`;
                        const newLabel = { 
                            text, 
                            color: textColor,
                            background: backgroundColor
                        };
                        
                        setWorldData(prev => ({
                            ...prev,
                            [labelKey]: JSON.stringify(newLabel)
                        }));
                        
                        setDialogueWithRevert(`Label "${text}" created`, setDialogueText);
                    } else {
                        setDialogueWithRevert("Usage: /label 'text' [textColor] [backgroundColor] or /label --distance <number>", setDialogueText);
                    }
                } else if (exec.command === 'signout') {
                    // Sign out from Firebase
                    signOut(auth).then(() => {
                        // Sign-out successful, navigate to home
                        router.push('/');
                    }).catch((error) => {
                        // An error happened
                        logger.error('Sign out error:', error);
                        setDialogueWithRevert("Failed to sign out", setDialogueText);
                    });
                } else if (exec.command === 'publish') {
                    // Publish current state
                    if (currentStateName) {
                        setDialogueWithRevert("Publishing state...", setDialogueText);
                        publishState(currentStateName, true).then((success) => {
                            if (success) {
                                setDialogueWithRevert(`State "${currentStateName}" published successfully`, setDialogueText);
                            } else {
                                setDialogueWithRevert(`Failed to publish state "${currentStateName}"`, setDialogueText);
                            }
                        });
                    } else {
                        setDialogueWithRevert("No current state to publish", setDialogueText);
                    }
                } else if (exec.command === 'unpublish') {
                    // Unpublish current state
                    if (currentStateName) {
                        setDialogueWithRevert("Unpublishing state...", setDialogueText);
                        publishState(currentStateName, false).then((success) => {
                            if (success) {
                                setDialogueWithRevert(`State "${currentStateName}" unpublished successfully`, setDialogueText);
                            } else {
                                setDialogueWithRevert(`Failed to unpublish state "${currentStateName}"`, setDialogueText);
                            }
                        });
                    } else {
                        setDialogueWithRevert("No current state to unpublish", setDialogueText);
                    }
                } else if (exec.command === 'cluster') {
                    if (exec.args.length === 0) {
                        // Generate frames + AI clusters + waypoints (everything)
                        updateTextFrames();
                        updateClusterLabels();
                        setFramesVisible(true);
                        setClustersVisible(true);
                        setDialogueWithRevert("Generating frames + AI cluster analysis with waypoints...", setDialogueText, 3000);
                    } else if (exec.args[0] === 'on') {
                        // Turn on cluster and frame visibility
                        setFramesVisible(true);
                        setClustersVisible(true);
                        setDialogueWithRevert("Cluster labels and frames visible", setDialogueText);
                    } else if (exec.args[0] === 'off') {
                        // Turn off cluster and frame visibility
                        setFramesVisible(false);
                        setClustersVisible(false);
                        setDialogueWithRevert("Cluster labels and frames hidden", setDialogueText);
                    } else if (exec.args[0] === 'refresh') {
                        // Force regeneration of everything
                        updateTextFrames();
                        updateClusterLabels();
                        setDialogueWithRevert("Force regenerating frames + clusters + waypoints...", setDialogueText, 3000);
                    } else {
                        setDialogueWithRevert("Usage: /cluster [on|off|refresh] - Generate frames + AI clusters + waypoints. Use /frames for frames only.", setDialogueText);
                    }
                } else if (exec.command === 'frames') {
                    if (exec.args.length === 0 || exec.args[0] === 'toggle') {
                        // Generate frames and toggle visibility
                        updateTextFrames();
                        const newVisibility = !framesVisible;
                        setFramesVisible(newVisibility);
                        const statusText = newVisibility ? 'visible' : 'hidden';
                        setDialogueWithRevert(`Generating text frames... frames ${statusText}`, setDialogueText, 2000);
                    } else if (exec.args[0] === 'on') {
                        // Generate frames and turn on visibility
                        updateTextFrames();
                        setFramesVisible(true);
                        setDialogueWithRevert("Generating text frames... frames visible", setDialogueText, 2000);
                    } else if (exec.args[0] === 'off') {
                        // Turn off frame visibility
                        setFramesVisible(false);
                        setDialogueWithRevert("Text frames hidden", setDialogueText);
                    } else if (exec.args[0] === 'hierarchical') {
                        if (exec.args[1] === 'on') {
                            setUseHierarchicalFrames(true);
                            updateTextFrames();
                            setFramesVisible(true);
                            setDialogueWithRevert("Hierarchical frames enabled - distance-based clustering active", setDialogueText, 2500);
                        } else if (exec.args[1] === 'off') {
                            setUseHierarchicalFrames(false);
                            updateTextFrames();
                            setDialogueWithRevert("Hierarchical frames disabled - using simple frames", setDialogueText, 2000);
                        } else {
                            setDialogueWithRevert("Usage: /frames hierarchical [on|off] - Enable/disable distance-based clustering", setDialogueText);
                        }
                    } else if (exec.args[0] === 'config') {
                        if (exec.args[1] === 'radius' && exec.args[2]) {
                            const newRadius = parseInt(exec.args[2], 10);
                            if (!isNaN(newRadius) && newRadius > 0) {
                                setHierarchicalConfig({...hierarchicalConfig, baseRadius: newRadius});
                                if (useHierarchicalFrames) updateTextFrames();
                                setDialogueWithRevert(`Base merge radius set to ${newRadius}`, setDialogueText);
                            } else {
                                setDialogueWithRevert("Invalid radius - must be positive number", setDialogueText);
                            }
                        } else if (exec.args[1] === 'scaling' && exec.args[2]) {
                            const newScaling = parseInt(exec.args[2], 10);
                            if (!isNaN(newScaling) && newScaling > 0) {
                                setHierarchicalConfig({...hierarchicalConfig, distanceScaling: newScaling});
                                if (useHierarchicalFrames) updateTextFrames();
                                setDialogueWithRevert(`Distance scaling set to ${newScaling}`, setDialogueText);
                            } else {
                                setDialogueWithRevert("Invalid scaling - must be positive number", setDialogueText);
                            }
                        } else {
                            setDialogueWithRevert("Usage: /frames config [radius|scaling] <value> - Configure hierarchical parameters", setDialogueText);
                        }
                    } else if (exec.args[0] === 'levels') {
                        if (exec.args[1] === 'all') {
                            setShowAllLevels(true);
                            if (useHierarchicalFrames) updateTextFrames();
                            setDialogueWithRevert("Showing all hierarchy levels simultaneously", setDialogueText);
                        } else if (exec.args[1] === 'distance') {
                            setShowAllLevels(false);
                            if (useHierarchicalFrames) updateTextFrames();
                            setDialogueWithRevert("Showing levels based on distance from viewport", setDialogueText);
                        } else {
                            setDialogueWithRevert("Usage: /frames levels [all|distance] - Control level display mode", setDialogueText);
                        }
                    } else {
                        setDialogueWithRevert("Usage: /frames [on|off|toggle|hierarchical|config|levels] - Control frame generation and display", setDialogueText);
                    }
                } else if (exec.command === 'clear') {
                    // Clear the entire canvas
                    setWorldData({});
                    setChatData({});
                    setSearchData({});
                    // Reset cursor to origin
                    setCursorPos({ x: 0, y: 0 });
                    // Clear any selections
                    setSelectionStart(null);
                    setSelectionEnd(null);
                    // Clear cluster labels and frames
                    setClusterLabels([]);
                    setTextFrames([]);
                    setHierarchicalFrames(null);
                    setDialogueWithRevert("Canvas cleared", setDialogueText);
                } else if (exec.command === 'cam') {
                    const newMode = exec.args[0];
                    let modeText = '';
                    switch (newMode) {
                        case 'focus':
                            modeText = 'Camera focus mode: cursor will stay centered';
                            break;
                        default:
                            modeText = 'Camera default mode: cursor will stay in view';
                    }
                    setDialogueWithRevert(modeText, setDialogueText);
                } else if (exec.command === 'bound') {
                    
                    // Create bounded region entry spanning the selected area
                    let selection = getNormalizedSelection();
                    
                    // Check for single-cell selection on existing bound
                    let isOnExistingBound = false;
                    if (selection && selection.startX === selection.endX && selection.startY === selection.endY) {
                        const cursorX = selection.startX;
                        const cursorY = selection.startY;
                        
                        // Check if this single cell is on an existing bound
                        for (const key in worldData) {
                            if (key.startsWith('bound_')) {
                                try {
                                    const boundData = JSON.parse(worldData[key] as string);
                                    
                                    const withinBounds = (cursorX >= boundData.startX && cursorX <= boundData.endX &&
                                                         cursorY >= boundData.startY && cursorY <= boundData.endY) ||
                                                        (boundData.endY < cursorY && 
                                                         cursorX >= boundData.startX && cursorX <= boundData.endX &&
                                                         (boundData.maxY === null || boundData.maxY === undefined || cursorY <= boundData.maxY));
                                    
                                    if (withinBounds) {
                                        isOnExistingBound = true;
                                        break;
                                    }
                                } catch (e) {
                                    // Skip invalid bound data
                                }
                            }
                        }
                        
                        if (isOnExistingBound) {
                            // Clear selection to trigger update mode
                            setSelectionStart(null);
                            setSelectionEnd(null);
                            selection = null;
                        }
                    }
                    
                    if (selection) {
                        // Multi-cell selection - proceed with creation (unless it's single cell not on a bound)
                        if (selection.startX === selection.endX && selection.startY === selection.endY && !isOnExistingBound) {
                            // Single cell not on existing bound - reject
                            setDialogueWithRevert(`Cannot create bound from single cell. Select at least 2 cells.`, setDialogueText);
                            setSelectionStart(null);
                            setSelectionEnd(null);
                            return true;
                        }
                        
                        // Check if selection fully encloses existing bounds OR includes their top bars
                        const enclosedBounds: Array<{key: string, data: any}> = [];
                        
                        for (const key in worldData) {
                            if (key.startsWith('bound_')) {
                                try {
                                    const boundData = JSON.parse(worldData[key] as string);
                                    
                                    // Check if this bound is fully enclosed by the selection
                                    const fullyEncloses = selection.startX <= boundData.startX && 
                                        selection.endX >= boundData.endX &&
                                        selection.startY <= boundData.startY && 
                                        selection.endY >= boundData.endY;
                                    
                                    // Special case: For infinite bounds, check if selection includes the top bar
                                    const isInfiniteBound = boundData.maxY === null || boundData.maxY === undefined;
                                    const includesTopBar = isInfiniteBound &&
                                        selection.startX <= boundData.startX && 
                                        selection.endX >= boundData.endX &&
                                        selection.startY <= boundData.startY && 
                                        selection.endY >= boundData.startY; // Just needs to include the top row
                                    
                                    // Also check if selection partially overlaps with the bound's top bar
                                    const partiallyIncludesTopBar = boundData.startY >= selection.startY && 
                                        boundData.startY <= selection.endY &&
                                        ((boundData.startX >= selection.startX && boundData.startX <= selection.endX) ||
                                         (boundData.endX >= selection.startX && boundData.endX <= selection.endX) ||
                                         (selection.startX >= boundData.startX && selection.startX <= boundData.endX));
                                    
                                    if (fullyEncloses || includesTopBar || partiallyIncludesTopBar) {
                                        enclosedBounds.push({key, data: boundData});
                                    }
                                } catch (e) {
                                    // Skip invalid bound data
                                }
                            }
                        }
                        
                        // Parse arguments: color (optional) and height (optional)
                        let color = '#B0B0B0'; // Default heather gray background
                        let height: number | null = null; // null means infinite
                        
                        if (exec.args.length > 0) {
                            // First arg could be color or height
                            const firstArg = exec.args[0];
                            const parsedHeight = parseInt(firstArg, 10);
                            
                            if (!isNaN(parsedHeight)) {
                                // First arg is a number, treat as height
                                height = parsedHeight;
                                // Check if there's a color as second arg
                                if (exec.args.length > 1) {
                                    color = exec.args[1];
                                }
                            } else {
                                // First arg is color
                                color = firstArg;
                                // Check if there's a height as second arg
                                if (exec.args.length > 1) {
                                    const secondHeight = parseInt(exec.args[1], 10);
                                    if (!isNaN(secondHeight)) {
                                        height = secondHeight;
                                    }
                                }
                            }
                        }
                        
                        logger.debug('Using color:', color);
                        logger.debug('Using height:', height);
                        
                        // Calculate maxY based on height
                        // Height represents total rows from startY, not additional rows from endY
                        const maxY = height !== null ? selection.startY + height - 1 : null;
                        
                        // If we found enclosed bounds, merge them into one
                        if (enclosedBounds.length > 0) {
                            
                            // Remove all old bounds
                            const newWorldData = { ...worldData };
                            for (const {key} of enclosedBounds) {
                                delete newWorldData[key];
                            }
                            
                            // Extract title from topbar (characters on startY row within bound)
                            let title = '';
                            for (let x = selection.startX; x <= selection.endX; x++) {
                                const key = `${x},${selection.startY}`;
                                const charData = newWorldData[key];
                                if (charData && !isImageData(charData)) {
                                    const char = getCharacter(charData);
                                    if (char && char.trim()) {
                                        title += char;
                                    }
                                }
                            }
                            title = title.trim();

                            // Create merged bound with new dimensions
                            const boundKey = `bound_${selection.startX},${selection.startY}`;
                            const boundData = {
                                startX: selection.startX,
                                endX: selection.endX,
                                startY: selection.startY,
                                endY: selection.endY,
                                maxY: maxY, // Use new height if specified
                                color: color, // Use new color
                                title: title || undefined // Only include title if non-empty
                            };
                            
                            newWorldData[boundKey] = JSON.stringify(boundData);
                            setWorldData(newWorldData);
                            logger.debug('Created merged bound:', boundData);
                            
                            const mergeMsg = enclosedBounds.length > 1 ? 
                                `Merged ${enclosedBounds.length} bounds` : 
                                'Updated existing bound';
                            const heightMsg = height !== null ? ` (height: ${height} rows)` : ' (infinite height)';
                            setDialogueWithRevert(`${mergeMsg}${heightMsg}`, setDialogueText);
                        } else {
                            // Extract title from topbar (characters on startY row within bound)
                            let title = '';
                            for (let x = selection.startX; x <= selection.endX; x++) {
                                const key = `${x},${selection.startY}`;
                                const charData = worldData[key];
                                if (charData && !isImageData(charData)) {
                                    const char = getCharacter(charData);
                                    if (char && char.trim()) {
                                        title += char;
                                    }
                                }
                            }
                            title = title.trim();

                            // Store bounded region as a single entry like labels
                            const boundKey = `bound_${selection.startX},${selection.startY}`;
                            const boundData = {
                                startX: selection.startX,
                                endX: selection.endX,
                                startY: selection.startY,
                                endY: selection.endY,
                                maxY: maxY, // New field: maximum Y where this bound has effect
                                color: color,
                                title: title || undefined // Only include title if non-empty
                            };
                            logger.debug('boundKey:', boundKey);
                            logger.debug('boundData:', boundData);

                            let newWorldData = { ...worldData };
                            newWorldData[boundKey] = JSON.stringify(boundData);
                            
                            logger.debug('Setting worldData with new bound region');
                            setWorldData(newWorldData);
                            
                            const heightMsg = height !== null ? ` (height: ${height} rows)` : ' (infinite height)';
                            setDialogueWithRevert(`Bounded region created${heightMsg}`, setDialogueText);
                        }
                        
                        // Clear the selection after creating/updating the bound
                        logger.debug('Clearing selection');
                        setSelectionStart(null);
                        setSelectionEnd(null);
                    } else {
                        // No selection - check if cursor is in an existing bound to update it
                        logger.debug('No selection found - checking for existing bound at cursor');
                        const cursorX = cursorPos.x;
                        const cursorY = cursorPos.y;
                        let foundBoundKey: string | null = null;
                        let foundBoundData: any = null;
                        
                        // Look through all bound_ entries to find one that contains the cursor
                        for (const key in worldData) {
                            if (key.startsWith('bound_')) {
                                try {
                                    const boundData = JSON.parse(worldData[key] as string);
                                    
                                    // Check if cursor is within the bounds of this region (considering maxY)
                                    const withinOriginalBounds = cursorX >= boundData.startX && cursorX <= boundData.endX &&
                                                               cursorY >= boundData.startY && cursorY <= boundData.endY;
                                    
                                    // Also check if cursor is in the column constraint area
                                    const withinColumnConstraint = boundData.endY < cursorY && 
                                                                  cursorX >= boundData.startX && cursorX <= boundData.endX &&
                                                                  (boundData.maxY === null || boundData.maxY === undefined || cursorY <= boundData.maxY);
                                    
                                    if (withinOriginalBounds || withinColumnConstraint) {
                                        foundBoundKey = key;
                                        foundBoundData = boundData;
                                        break;
                                    }
                                } catch (e) {
                                    // Skip invalid bound data
                                }
                            }
                        }
                        
                        if (foundBoundKey && foundBoundData) {
                            // Update existing bound
                            logger.debug('Found existing bound to update:', foundBoundKey, foundBoundData);
                            
                            // Parse arguments for update
                            let newColor = foundBoundData.color; // Keep existing color by default
                            let newHeight: number | null = null; // null means keep existing
                            
                            if (exec.args.length > 0) {
                                // First arg could be color or height
                                const firstArg = exec.args[0];
                                const parsedHeight = parseInt(firstArg, 10);
                                
                                if (!isNaN(parsedHeight)) {
                                    // First arg is a number, treat as height
                                    newHeight = parsedHeight;
                                    // Check if there's a color as second arg
                                    if (exec.args.length > 1) {
                                        newColor = exec.args[1];
                                    }
                                } else {
                                    // First arg is color
                                    newColor = firstArg;
                                    // Check if there's a height as second arg
                                    if (exec.args.length > 1) {
                                        const secondHeight = parseInt(exec.args[1], 10);
                                        if (!isNaN(secondHeight)) {
                                            newHeight = secondHeight;
                                        }
                                    }
                                }
                            }
                            
                            // Calculate new maxY if height changed
                            const newMaxY = newHeight !== null ? foundBoundData.startY + newHeight - 1 : foundBoundData.maxY;
                            
                            // Update the bound data
                            const updatedBoundData = {
                                ...foundBoundData,
                                color: newColor,
                                maxY: newMaxY
                            };
                            
                            let newWorldData = { ...worldData };
                            newWorldData[foundBoundKey] = JSON.stringify(updatedBoundData);
                            setWorldData(newWorldData);
                            
                            const heightMsg = newHeight !== null ? ` (new height: ${newHeight} rows)` : '';
                            setDialogueWithRevert(`Bounded region updated - color: ${newColor}${heightMsg}`, setDialogueText);
                        } else {
                            logger.debug('No bound found at cursor position');
                            setDialogueWithRevert(`No region selected and no bound at cursor. Select an area first, then use /bound`, setDialogueText);
                        }
                    }
                } else if (exec.command === 'unbound') {
                    // Find and remove any bound that contains the cursor position
                    const cursorX = cursorPos.x;
                    const cursorY = cursorPos.y;
                    let foundBound = false;
                    let newWorldData = { ...worldData };
                    
                    logger.debug('Unbound command - cursor position:', cursorX, cursorY);
                    logger.debug('Looking for bounds in worldData...');
                    
                    // Look through all bound_ entries to find one that contains the cursor
                    for (const key in worldData) {
                        if (key.startsWith('bound_')) {
                            try {
                                const boundData = JSON.parse(worldData[key] as string);
                                logger.debug('Checking bound:', key, boundData);
                                
                                // Check if cursor is within the bounds of this region (considering maxY)
                                const withinOriginalBounds = cursorX >= boundData.startX && cursorX <= boundData.endX &&
                                                           cursorY >= boundData.startY && cursorY <= boundData.endY;
                                
                                // Also check if cursor is in the column constraint area (below the bound but within maxY)
                                const withinColumnConstraint = boundData.endY < cursorY && 
                                                              cursorX >= boundData.startX && cursorX <= boundData.endX &&
                                                              (boundData.maxY === null || boundData.maxY === undefined || cursorY <= boundData.maxY);
                                
                                logger.debug('Within original bounds:', withinOriginalBounds);
                                logger.debug('Within column constraint:', withinColumnConstraint);
                                
                                if (withinOriginalBounds || withinColumnConstraint) {
                                    // Remove this bound
                                    delete newWorldData[key];
                                    foundBound = true;
                                    logger.debug('Removing bound:', key, boundData);
                                }
                            } catch (e) {
                                logger.error('Error parsing bound data:', key, e);
                                // Skip invalid bound data
                            }
                        }
                    }
                    
                    if (foundBound) {
                        setWorldData(newWorldData);
                        setDialogueWithRevert(`Bounded region removed`, setDialogueText);
                    } else {
                        logger.debug('No bound found at cursor position');
                        setDialogueWithRevert(`No bounded region found at cursor position`, setDialogueText);
                    }
                } else if (exec.command === 'upload') {
                    // Check if there's a selection for image placement
                    const selection = getNormalizedSelection();
                    if (!selection) {
                        setDialogueWithRevert("Please select a region first, then use /upload", setDialogueText);
                        return true;
                    }
                    
                    // Create and trigger file input
                    const fileInput = document.createElement('input');
                    fileInput.type = 'file';
                    fileInput.accept = 'image/*';
                    fileInput.style.display = 'none';
                    
                    fileInput.onchange = async (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (!file) return;
                        
                        try {
                            setDialogueWithRevert("Processing image...", setDialogueText);
                            
                            // Convert file to data URL
                            const reader = new FileReader();
                            reader.onload = async (event) => {
                                const dataUrl = event.target?.result as string;
                                
                                // Create image to get dimensions
                                const img = new Image();
                                img.onload = () => {
                                    // Calculate selection dimensions
                                    const selectionWidth = selection.endX - selection.startX + 1;
                                    const selectionHeight = selection.endY - selection.startY + 1;
                                    
                                    // Create image data entry
                                    const imageData: ImageData = {
                                        type: 'image',
                                        src: dataUrl,
                                        startX: selection.startX,
                                        startY: selection.startY,
                                        endX: selection.endX,
                                        endY: selection.endY,
                                        originalWidth: img.width,
                                        originalHeight: img.height
                                    };
                                    
                                    // Store image with unique key
                                    const imageKey = `image_${selection.startX},${selection.startY}`;
                                    setWorldData(prev => ({
                                        ...prev,
                                        [imageKey]: imageData
                                    }));
                                    
                                    // Clear selection
                                    setSelectionStart(null);
                                    setSelectionEnd(null);
                                    
                                    setDialogueWithRevert(`Image uploaded to region (${selectionWidth}x${selectionHeight} cells)`, setDialogueText);
                                };
                                img.src = dataUrl;
                            };
                            reader.readAsDataURL(file);
                        } catch (error) {
                            logger.error('Error uploading image:', error);
                            setDialogueWithRevert("Error uploading image", setDialogueText);
                        } finally {
                            document.body.removeChild(fileInput);
                        }
                    };
                    
                    document.body.appendChild(fileInput);
                    fileInput.click();
                }
                
                setCursorPos(exec.commandStartPos);
                return true;
            } else if (commandResult === true) {
                // Command mode handled the key, but didn't execute a command
                return true;
            }
        }

        // === State Prompt Handling ===
        if (statePrompt.type) {
            if (key === 'Escape') {
                setStatePrompt({ type: null });
                setDialogueWithRevert("Operation cancelled", setDialogueText);
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
                        setDialogueWithRevert("Saving current work...", setDialogueText);
                        saveState(saveStateName).then((success) => {
                            if (success) {
                                loadAvailableStates().then(setAvailableStates);
                                // Now load the requested state
                                setDialogueWithRevert("Loading requested state...", setDialogueText);
                                loadState(loadStateName).then((loadSuccess) => {
                                    if (loadSuccess) {
                                        setDialogueWithRevert(`Current work saved as "${saveStateName}", "${loadStateName}" loaded successfully`, setDialogueText);
                                    } else {
                                        setDialogueWithRevert(`Current work saved as "${saveStateName}", but failed to load "${loadStateName}"`, setDialogueText);
                                    }
                                    setStatePrompt({ type: null });
                                });
                            } else {
                                setDialogueWithRevert("Failed to save current work", setDialogueText);
                                setStatePrompt({ type: null });
                            }
                        });
                    } else {
                        setDialogueWithRevert("State name cannot be empty", setDialogueText);
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
                    setDialogueWithRevert("Loading state...", setDialogueText);
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
                    setDialogueWithRevert("Deleting state...", setDialogueText);
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
                if (shiftKey) {
                    // Shift+Enter: Move to next line without sending to AI
                    const newInput = chatMode.currentInput + '\n';
                    const startX = chatMode.inputPositions[0]?.x || cursorPos.x;
                    
                    setChatMode(prev => ({
                        ...prev,
                        currentInput: newInput,
                        inputPositions: [...prev.inputPositions, { x: startX, y: cursorPos.y + 1 }]
                    }));
                    
                    // Move cursor to next line at start position
                    setCursorPos({ x: startX, y: cursorPos.y + 1 });
                    return true;
                } else if (metaKey || ctrlKey) {
                    // Cmd+Enter (or Ctrl+Enter): Send chat message and write response directly to canvas
                    if (chatMode.currentInput.trim() && !chatMode.isProcessing) {
                        setChatMode(prev => ({ ...prev, isProcessing: true }));
                        setDialogueWithRevert("Processing...", setDialogueText);
                        
                        chatWithAI(chatMode.currentInput.trim()).then((response) => {
                            // Show response in dialogue system
                            createSubtitleCycler(response, setDialogueText);
                            
                            // Write response permanently to canvas below the input
                            const responseStartPos = {
                                x: chatMode.inputPositions[0]?.x || cursorPos.x,
                                y: (chatMode.inputPositions[chatMode.inputPositions.length - 1]?.y || cursorPos.y) + 2 // Start 2 lines below last input line
                            };
                            
                            // Calculate dynamic wrap width based on input
                            const inputLines = chatMode.currentInput.trim().split('\n');
                            const maxInputLineLength = Math.max(...inputLines.map(line => line.length));
                            const wrapWidth = Math.max(30, maxInputLineLength);
                            
                            // Text wrapping that honors paragraph breaks
                            const wrapText = (text: string, maxWidth: number): string[] => {
                                const paragraphs = text.split('\n');
                                const lines: string[] = [];
                                
                                for (let i = 0; i < paragraphs.length; i++) {
                                    const paragraph = paragraphs[i].trim();
                                    
                                    if (paragraph === '') {
                                        lines.push('');
                                        continue;
                                    }
                                    
                                    const words = paragraph.split(' ');
                                    let currentLine = '';
                                    
                                    for (const word of words) {
                                        const testLine = currentLine ? `${currentLine} ${word}` : word;
                                        if (testLine.length <= maxWidth) {
                                            currentLine = testLine;
                                        } else {
                                            if (currentLine) lines.push(currentLine);
                                            currentLine = word;
                                        }
                                    }
                                    if (currentLine) lines.push(currentLine);
                                }
                                return lines;
                            };
                            
                            const wrappedLines = wrapText(response, wrapWidth);
                            
                            // Write each character permanently to worldData
                            const newWorldData = { ...worldData };
                            for (let lineIndex = 0; lineIndex < wrappedLines.length; lineIndex++) {
                                const line = wrappedLines[lineIndex];
                                for (let charIndex = 0; charIndex < line.length; charIndex++) {
                                    const char = line[charIndex];
                                    const x = responseStartPos.x + charIndex;
                                    const y = responseStartPos.y + lineIndex;
                                    const key = `${x},${y}`;
                                    newWorldData[key] = char;
                                }
                            }
                            setWorldData(newWorldData);
                            
                            // Clear current input from chat data after response
                            setChatData({});
                            setChatMode(prev => ({
                                ...prev,
                                currentInput: '',
                                inputPositions: [],
                                isProcessing: false
                            }));
                        }).catch(() => {
                            setDialogueWithRevert("Could not process chat message", setDialogueText);
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
                } else {
                    // Regular Enter: Send chat message and show ephemeral response
                    if (chatMode.currentInput.trim() && !chatMode.isProcessing) {
                        setChatMode(prev => ({ ...prev, isProcessing: true }));
                        setDialogueWithRevert("Processing...", setDialogueText);
                        
                        chatWithAI(chatMode.currentInput.trim()).then((response) => {
                            // Show response in dialogue system (subtitle-style)
                            createSubtitleCycler(response, setDialogueText);
                            
                            // Also show response as ephemeral text at cursor location
                            // Find a good position for the AI response (slightly below current input)
                            const responseStartPos = {
                                x: chatMode.inputPositions[0]?.x || cursorPos.x,
                                y: (chatMode.inputPositions[chatMode.inputPositions.length - 1]?.y || cursorPos.y) + 2 // Start 2 lines below last input line
                            };
                            addInstantAIResponse(responseStartPos, response, { queryText: chatMode.currentInput.trim() });
                            
                            // Clear current input from chat data after response
                            setChatData({});
                            setChatMode(prev => ({
                                ...prev,
                                currentInput: '',
                                inputPositions: [],
                                isProcessing: false
                            }));
                        }).catch(() => {
                            setDialogueWithRevert("Could not process chat message", setDialogueText);
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
                }
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
                setDialogueWithRevert("Chat mode deactivated.", setDialogueText);
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
                            setDialogueWithRevert("Processing transformation...", setDialogueText);
                            transformText(selectedText, instructions).then((result) => {
                                createSubtitleCycler(result, setDialogueText);
                            }).catch(() => {
                                setDialogueWithRevert(`Could not transform text`, setDialogueText);
                            });
                        }
                    } else if (exec.command === 'explain') {
                        const selectedText = exec.args[0];
                        const instructions = exec.args.length > 1 ? exec.args.slice(1).join(' ') : 'analysis';
                        
                        setDialogueWithRevert("Processing explanation...", setDialogueText);
                        explainText(selectedText, instructions).then((result) => {
                            createSubtitleCycler(result, setDialogueText);
                        }).catch(() => {
                            setDialogueWithRevert(`Could not explain text`, setDialogueText);
                        });
                    } else if (exec.command === 'summarize') {
                        const selectedText = exec.args[0];
                        const focus = exec.args.length > 1 ? exec.args.slice(1).join(' ') : undefined;
                        
                        setDialogueWithRevert("Processing summary...", setDialogueText);
                        summarizeText(selectedText, focus).then((result) => {
                            createSubtitleCycler(result, setDialogueText);
                        }).catch(() => {
                            setDialogueWithRevert(`Could not summarize text`, setDialogueText);
                        });
                    } else if (exec.command === 'bound') {
                        
                        // Create bounded region entry spanning the selected area
                        const selection = getNormalizedSelection();
                        
                        if (selection) {
                            const color = exec.args.length > 0 ? exec.args[0] : '#FFFF00'; // Default yellow background

                            // Extract title from topbar (characters on startY row within bound)
                            let title = '';
                            for (let x = selection.startX; x <= selection.endX; x++) {
                                const key = `${x},${selection.startY}`;
                                const charData = worldData[key];
                                if (charData && !isImageData(charData)) {
                                    const char = getCharacter(charData);
                                    if (char && char.trim()) {
                                        title += char;
                                    }
                                }
                            }
                            title = title.trim();

                            // Store bounded region as a single entry like labels
                            const boundKey = `bound_${selection.startX},${selection.startY}`;
                            const boundData = {
                                startX: selection.startX,
                                endX: selection.endX,
                                startY: selection.startY,
                                endY: selection.endY,
                                color: color,
                                title: title || undefined // Only include title if non-empty
                            };
                            logger.debug('boundKey:', boundKey);
                            logger.debug('boundData:', boundData);

                            let newWorldData = { ...worldData };
                            newWorldData[boundKey] = JSON.stringify(boundData);
                            
                            logger.debug('Setting worldData with new bound region');
                            setWorldData(newWorldData);
                            setDialogueWithRevert(`Bounded region created`, setDialogueText);
                            
                            // Clear the selection after creating the bound
                            logger.debug('Clearing selection');
                            setSelectionStart(null);
                            setSelectionEnd(null);
                        } else {
                            logger.debug('No selection found!');
                            setDialogueWithRevert(`No region selected. Select an area first by clicking and dragging, then use /bound`, setDialogueText);
                        }
                    }
                }
                
                // Clear selection after executing pending command
                clearSelectionState();
            } else {
                setDialogueWithRevert("Please select some text first, then press Enter to execute the command", setDialogueText);
            }
            return false;
        }
        // === Quick Chat (Cmd+Enter) ===
        else if (key === 'Enter' && metaKey && !chatMode.isActive) {
            // Extract text to send to AI - selection, enclosing text block, or current line
            let textToSend = '';
            let chatStartPos = cursorPos;
            
            if (currentSelectionActive) {
                // Use selected text
                const minX = Math.min(selectionStart!.x, selectionEnd!.x);
                const maxX = Math.max(selectionStart!.x, selectionEnd!.x);
                const minY = Math.min(selectionStart!.y, selectionEnd!.y);
                const maxY = Math.max(selectionStart!.y, selectionEnd!.y);
                
                // Extract selected text
                for (let y = minY; y <= maxY; y++) {
                    let lineText = '';
                    for (let x = minX; x <= maxX; x++) {
                        const key = `${x},${y}`;
                        const charData = worldData[key];
                        if (charData && !isImageData(charData)) {
                            const char = getCharacter(charData);
                            lineText += char;
                        } else {
                            lineText += ' ';
                        }
                    }
                    textToSend += lineText.trimEnd();
                    if (y < maxY) textToSend += '\n';
                }
                chatStartPos = { x: minX, y: minY };
            } else {
                // Find enclosing text block using block detection
                const currentY = cursorPos.y;
                const lineChars = extractLineCharacters(worldData, currentY);
                
                if (lineChars.length > 0) {
                    const blocks = detectTextBlocks(lineChars);
                    const closestBlockResult = findClosestBlock(blocks, cursorPos.x);
                    
                    if (closestBlockResult && closestBlockResult.distance === 0) {
                        // Cursor is within a text block - use that block
                        const block = closestBlockResult.block;
                        textToSend = block.characters.map(c => c.char).join('');
                        chatStartPos = { x: block.start, y: currentY };
                    } else {
                        // No enclosing block or cursor not within block - fall back to entire line
                        let lineText = '';
                        let minX = cursorPos.x;
                        let maxX = cursorPos.x;
                        
                        // Find the extent of text on current line
                        for (const key in worldData) {
                            const [xStr, yStr] = key.split(',');
                            const x = parseInt(xStr, 10);
                            const y = parseInt(yStr, 10);
                            
                            if (y === currentY) {
                                minX = Math.min(minX, x);
                                maxX = Math.max(maxX, x);
                            }
                        }
                        
                        // Extract the line text
                        for (let x = minX; x <= maxX; x++) {
                            const key = `${x},${currentY}`;
                            const charData = worldData[key];
                            if (charData && !isImageData(charData)) {
                                const char = getCharacter(charData);
                                lineText += char;
                            } else {
                                lineText += ' ';
                            }
                        }
                        textToSend = lineText.trim();
                        chatStartPos = { x: minX, y: currentY };
                    }
                } else {
                    // No text on line
                    setDialogueWithRevert("No text found to send to AI", setDialogueText);
                    return false;
                }
            }
            
            // Send to AI if we have text
            if (textToSend.trim()) {
                setDialogueWithRevert("Processing...", setDialogueText);
                
                // First update the cached context with current world state
                const currentLabels = getAllLabels();
                const currentCompiledText = compiledTextCache;
                
                // Convert compiled text cache to string format
                const compiledTextString = Object.entries(currentCompiledText)
                    .sort(([aLine], [bLine]) => parseInt(aLine) - parseInt(bLine))
                    .map(([lineY, text]) => `Line ${lineY}: ${text}`)
                    .join('\n');
                
                // Update world context first, then chat
                updateWorldContext({
                    compiledText: compiledTextString,
                    labels: currentLabels,
                    metadata: `Canvas viewport center: ${JSON.stringify(getViewportCenter())}, Current cursor: ${JSON.stringify(cursorPos)}`
                });
                
                // Use world context for AI chat
                chatWithAI(textToSend.trim(), true).then((response) => { // true = use context
                    // Show response in dialogue system
                    createSubtitleCycler(response, setDialogueText);
                    
                    // Write response permanently to canvas below the input
                    const responseStartPos = {
                        x: chatStartPos.x,
                        y: chatStartPos.y + (textToSend.split('\n').length) + 1 // Below the input text
                    };
                    
                    // Calculate dynamic wrap width based on query
                    const queryLines = textToSend.trim().split('\n');
                    const maxQueryLineLength = Math.max(...queryLines.map(line => line.length));
                    const wrapWidth = Math.max(30, maxQueryLineLength);
                    
                    // Text wrapping that honors paragraph breaks
                    const wrapText = (text: string, maxWidth: number): string[] => {
                        const paragraphs = text.split('\n');
                        const lines: string[] = [];
                        
                        for (let i = 0; i < paragraphs.length; i++) {
                            const paragraph = paragraphs[i].trim();
                            
                            if (paragraph === '') {
                                lines.push('');
                                continue;
                            }
                            
                            const words = paragraph.split(' ');
                            let currentLine = '';
                            
                            for (const word of words) {
                                const testLine = currentLine ? `${currentLine} ${word}` : word;
                                if (testLine.length <= maxWidth) {
                                    currentLine = testLine;
                                } else {
                                    if (currentLine) lines.push(currentLine);
                                    currentLine = word;
                                }
                            }
                            if (currentLine) lines.push(currentLine);
                        }
                        return lines;
                    };
                    
                    const wrappedLines = wrapText(response, wrapWidth);
                    
                    // Write each character permanently to worldData
                    const newWorldData = { ...worldData };
                    for (let lineIndex = 0; lineIndex < wrappedLines.length; lineIndex++) {
                        const line = wrappedLines[lineIndex];
                        for (let charIndex = 0; charIndex < line.length; charIndex++) {
                            const char = line[charIndex];
                            const x = responseStartPos.x + charIndex;
                            const y = responseStartPos.y + lineIndex;
                            const key = `${x},${y}`;
                            newWorldData[key] = char;
                        }
                    }
                    setWorldData(newWorldData);
                }).catch((error) => {
                    logger.error('Error in context-aware chat:', error);
                    setDialogueWithRevert("Could not process message", setDialogueText);
                });
                
                // Clear selection after sending
                clearSelectionState();
            } else {
                setDialogueWithRevert("No text to send - select text or place cursor on a line with content", setDialogueText);
            }
            return true;
        }
        // --- Movement ---
        else if (key === 'Enter') {
            const dataToCheck = currentMode === 'air' ? 
                { ...worldData, ...lightModeData } : 
                worldData;
            
            // Function to find reasonable text block alignment in current viewport
            const getViewportSmartIndentation = (worldData: WorldData, cursorPos: {x: number, y: number}): number | null => {
                if (typeof window === 'undefined') return null;
                
                const { width: effectiveCharWidth, height: effectiveCharHeight } = getEffectiveCharDims(zoomLevel);
                if (effectiveCharWidth === 0 || effectiveCharHeight === 0) return null;
                
                const viewportCharWidth = window.innerWidth / effectiveCharWidth;
                const viewportCharHeight = window.innerHeight / effectiveCharHeight;
                
                const viewportMinY = Math.floor(viewOffset.y);
                const viewportMaxY = Math.ceil(viewOffset.y + viewportCharHeight);
                const viewportMinX = Math.floor(viewOffset.x);
                const viewportMaxX = Math.ceil(viewOffset.x + viewportCharWidth);
                
                let bestIndent: number | null = null;
                // Adaptive max distance based on viewport width - wider viewport allows for larger search radius
                const maxDistance = Math.min(Math.floor(viewportCharWidth / 4), 20);
                
                logger.debug('Checking viewport bounds:', { viewportMinY, viewportMaxY, viewportMinX, viewportMaxX });
                logger.debug('Cursor position:', cursorPos);
                
                // Only check lines that are visible in viewport
                for (let checkY = viewportMinY; checkY <= viewportMaxY; checkY++) {
                    const lineChars = extractLineCharacters(worldData, checkY);
                    
                    if (lineChars.length === 0) continue;
                    
                    const blocks = detectTextBlocks(lineChars);
                    logger.debug(`Line ${checkY} has ${blocks.length} text blocks`);
                    
                    // Find blocks that are within reasonable distance AND visible in viewport
                    for (const block of blocks) {
                        // Check if block start is within viewport X bounds
                        if (block.start < viewportMinX || block.start > viewportMaxX) {
                            logger.debug(`Block at ${block.start}: outside viewport X bounds, skipping`);
                            continue;
                        }
                        
                        const distance = Math.abs(block.start - cursorPos.x);
                        
                        logger.debug(`Block at ${block.start}: distance=${distance}, within viewport`);
                        
                        if (distance <= maxDistance) {
                            // Prefer blocks that are closer to current cursor position
                            if (bestIndent === null) {
                                bestIndent = block.start;
                            } else {
                                // Choose the block that's closer to cursor's current X
                                const currentBestDistance = Math.abs(bestIndent - cursorPos.x);
                                if (distance < currentBestDistance) {
                                    bestIndent = block.start;
                                }
                            }
                        }
                    }
                }
                
                logger.debug('Final bestIndent (close and visible only):', bestIndent);
                return bestIndent;
            };

            // Function to find the beginning x position of the current text block
            const getCurrentTextBlockStart = (worldData: WorldData, cursorPos: {x: number, y: number}): number | null => {
                const lineChars = extractLineCharacters(worldData, cursorPos.y);
                if (lineChars.length === 0) return null;
                
                const blocks = detectTextBlocks(lineChars);
                
                // Find the block that contains the cursor position OR the cursor is just after it
                for (const block of blocks) {
                    // Check if cursor is inside the block or just after it (common when typing)
                    if (cursorPos.x >= block.start && cursorPos.x <= block.end + 1) {
                        return block.start;
                    }
                }
                
                // If cursor is not directly associated with any block, find the closest one to the left
                let closestBlock = null;
                let minDistance = Infinity;
                
                for (const block of blocks) {
                    if (block.end < cursorPos.x) {
                        const distance = cursorPos.x - block.end;
                        if (distance < minDistance) {
                            minDistance = distance;
                            closestBlock = block;
                        }
                    }
                }
                
                return closestBlock ? closestBlock.start : null;
            };
            
            // Check if current line has any characters
            const currentLineHasText = Object.keys(dataToCheck).some(key => {
                const [, y] = key.split(',');
                return parseInt(y) === cursorPos.y;
            });
            
            let targetIndent;
            
            
            if (isIndentEnabled) {
                // Smart indentation is enabled - use current behavior
                if (currentLineHasText) {
                    // Line has text - FIRST try to use the start of current text block
                    // This ensures we respect the complete block even if it starts outside viewport
                    const currentBlockStart = getCurrentTextBlockStart(dataToCheck, cursorPos);
                    if (currentBlockStart !== null) {
                        targetIndent = currentBlockStart;
                    } else {
                        // Fallback to smart indentation
                        targetIndent = getSmartIndentation(dataToCheck, cursorPos);
                        
                        // If smart indentation returns 0, try to find leftmost text block in viewport
                        if (targetIndent === 0) {
                            const nearbyIndent = getViewportSmartIndentation(dataToCheck, cursorPos);
                            if (nearbyIndent !== null) {
                                targetIndent = nearbyIndent;
                            }
                        }
                    }
                    setLastEnterX(targetIndent);
                } else if (lastEnterX !== null) {
                    // Empty line and we have a previous Enter X position - use it
                    // But check if it's still within viewport
                    const { width: effectiveCharWidth } = getEffectiveCharDims(zoomLevel);
                    if (effectiveCharWidth > 0 && typeof window !== 'undefined') {
                        const viewportCharWidth = window.innerWidth / effectiveCharWidth;
                        const viewportMinX = Math.floor(viewOffset.x);
                        const viewportMaxX = Math.ceil(viewOffset.x + viewportCharWidth);
                        
                        if (lastEnterX >= viewportMinX && lastEnterX <= viewportMaxX) {
                            targetIndent = lastEnterX;
                        } else {
                            // lastEnterX is outside viewport, try to find a visible text block instead
                            const nearbyIndent = getViewportSmartIndentation(dataToCheck, cursorPos);
                            if (nearbyIndent !== null) {
                                targetIndent = nearbyIndent;
                                setLastEnterX(nearbyIndent);
                            } else {
                                targetIndent = cursorPos.x;
                                setLastEnterX(cursorPos.x);
                            }
                        }
                    } else {
                        targetIndent = lastEnterX;
                    }
                } else {
                    // Empty line, no previous Enter position - check for nearby text blocks
                    const nearbyIndent = getViewportSmartIndentation(dataToCheck, cursorPos); // Find leftmost text block in viewport
                    if (nearbyIndent !== null) {
                        targetIndent = nearbyIndent;
                        setLastEnterX(targetIndent);
                    } else {
                        // No nearby text - use current X position and remember it
                        targetIndent = cursorPos.x;
                        setLastEnterX(targetIndent);
                    }
                }
            } else {
                // Smart indentation is disabled - maintain beginning position of current text block
                if (currentLineHasText && lastEnterX === null) {
                    // First Enter on a line with text - find the beginning of the current text block and remember it
                    const blockStart = getCurrentTextBlockStart(dataToCheck, cursorPos);
                    if (blockStart !== null) {
                        targetIndent = blockStart;
                        setLastEnterX(targetIndent);
                    } else {
                        // Fallback to current position if no block found
                        targetIndent = cursorPos.x;
                        setLastEnterX(targetIndent);
                    }
                } else if (lastEnterX !== null) {
                    // We already have a remembered position - stick to it regardless of current line content
                    targetIndent = lastEnterX;
                } else {
                    // Empty line, no previous position - use current X position and remember it
                    targetIndent = cursorPos.x;
                    setLastEnterX(targetIndent);
                }
            }
            
            // Viewport bounds check - don't jump outside visible area
            const { width: effectiveCharWidth } = getEffectiveCharDims(zoomLevel);
            if (effectiveCharWidth > 0 && typeof window !== 'undefined') {
                const viewportCharWidth = window.innerWidth / effectiveCharWidth;
                const viewportMinX = Math.floor(viewOffset.x);
                const viewportMaxX = Math.ceil(viewOffset.x + viewportCharWidth);
                
                logger.debug('Viewport X bounds:', { viewportMinX, viewportMaxX });
                logger.debug('Proposed targetIndent:', targetIndent);
                logger.debug('Current cursor X:', cursorPos.x);
                
                // If targetIndent would put cursor outside viewport, keep the targetIndent
                // but don't fall back to current position - maintain the text block alignment
                if (targetIndent < viewportMinX || targetIndent > viewportMaxX) {
                    logger.debug('Target indent is outside viewport, but maintaining it for text block alignment');
                    // Keep targetIndent as is - don't change it
                    // This ensures text blocks maintain their indentation even when starting outside viewport
                }
            }
            
            logger.debug('Final targetIndent after viewport check:', targetIndent);
            
            nextCursorPos.y = cursorPos.y + 1;
            nextCursorPos.x = targetIndent !== undefined && targetIndent !== null ? targetIndent : cursorPos.x;            
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
                    const char = charData && !isImageData(charData) ? getCharacter(charData) : '';
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
                        const char = charData && !isImageData(charData) ? getCharacter(charData) : '';
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
            setLastEnterX(null); // Reset Enter X tracking on horizontal movement
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
                const startChar = startCharData && !isImageData(startCharData) ? getCharacter(startCharData) : '';
                let inWord = !!startChar && startChar !== ' ' && startChar !== '\t';
                
                // Find the end of current word or beginning of next word
                while (x <= rightmostX) {
                    const key = `${x},${currentLine}`;
                    const charData = worldData[key];
                    const char = charData && !isImageData(charData) ? getCharacter(charData) : '';
                    
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
            setLastEnterX(null); // Reset Enter X tracking on horizontal movement
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
                    const char = charData && !isImageData(charData) ? getCharacter(charData) : '';
                    
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
                    // Check if we're at the beginning of a line (need to merge with previous line)
                    const currentLineChars = extractLineCharacters(worldData, cursorPos.y);
                    const isAtLineStart = cursorPos.x === 0 || 
                        (currentLineChars.length > 0 && cursorPos.x <= currentLineChars[0].x);
                    
                    if (isAtLineStart && cursorPos.y > 0) {
                        // Find the last character position on the previous line
                        const prevLineChars = extractLineCharacters(worldData, cursorPos.y - 1);
                        let targetX = 0; // Default to start of line if no characters
                        
                        if (prevLineChars.length > 0) {
                            // Find rightmost character on previous line
                            targetX = Math.max(...prevLineChars.map(c => c.x)) + 1;
                        }
                        
                        // Collect all text from current line to move it
                        nextWorldData = { ...worldData };
                        const currentLineData = currentLineChars.map(c => ({ 
                            char: c.char, 
                            originalKey: `${c.x},${cursorPos.y}` 
                        }));
                        
                        // Remove all characters from current line
                        for (const charData of currentLineData) {
                            delete nextWorldData[charData.originalKey];
                        }
                        
                        // Add characters to previous line starting from targetX
                        for (let i = 0; i < currentLineData.length; i++) {
                            const newKey = `${targetX + i},${cursorPos.y - 1}`;
                            nextWorldData[newKey] = currentLineData[i].char;
                        }
                        
                        // Move cursor to the junction point
                        nextCursorPos.x = targetX;
                        nextCursorPos.y = cursorPos.y - 1;
                        worldDataChanged = true;
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
            }
            moved = true; // Cursor position changed or selection was deleted
        } else if (key === 'Tab') {
            // Cycle through all available bounds
            const bounds: Array<{key: string, data: any}> = [];
            
            for (const key in worldData) {
                if (key.startsWith('bound_')) {
                    try {
                        const boundData = JSON.parse(worldData[key] as string);
                        bounds.push({key, data: boundData});
                    } catch (e) {
                        // Skip invalid bound data
                    }
                }
            }
            
            if (bounds.length === 0) {
                logger.debug('No bounds found');
            } else {
                // Sort bounds by their position for consistent cycling
                bounds.sort((a, b) => {
                    if (a.data.startY !== b.data.startY) {
                        return a.data.startY - b.data.startY; // Sort by Y first
                    }
                    return a.data.startX - b.data.startX; // Then by X
                });
                
                // Cycle to next bound
                const nextIndex = boundCycleIndex % bounds.length;
                const targetBound = bounds[nextIndex];
                
                // Find the last character within the bounded region
                let lastCharX = targetBound.data.startX;
                let lastCharY = targetBound.data.startY;
                let foundChar = false;
                
                // Scan from bottom-right to top-left to find the last character
                for (let y = targetBound.data.endY; y >= targetBound.data.startY; y--) {
                    for (let x = targetBound.data.endX; x >= targetBound.data.startX; x--) {
                        const key = `${x},${y}`;
                        const charData = worldData[key];
                        if (charData && !isImageData(charData)) {
                            const char = getCharacter(charData);
                            if (char && char !== ' ' && char !== '\t') {
                                lastCharX = x;
                                lastCharY = y;
                                foundChar = true;
                                break;
                            }
                        }
                    }
                    if (foundChar) break;
                }
                
                // Move cursor to the last character position (or start if no text found)
                nextCursorPos = { 
                    x: lastCharX, 
                    y: lastCharY 
                };
                
                
                // Immediately center viewport on the new cursor position
                if (typeof window !== 'undefined') {
                    const { width: effectiveCharWidth, height: effectiveCharHeight } = getEffectiveCharDims(zoomLevel);
                    if (effectiveCharWidth > 0 && effectiveCharHeight > 0) {
                        const viewportCharWidth = window.innerWidth / effectiveCharWidth;
                        const viewportCharHeight = window.innerHeight / effectiveCharHeight;
                        
                        const centerX = nextCursorPos.x - viewportCharWidth / 2;
                        const centerY = nextCursorPos.y - viewportCharHeight / 2;
                        
                        setViewOffset({ x: centerX, y: centerY });
                    }
                }
                
                setBoundCycleIndex(nextIndex + 1); // Prepare for next cycle
                moved = true;
            }
            
            preventDefault = true; // Prevent Tab from moving focus
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
            let proposedCursorPos = { x: cursorAfterDelete.x + 1, y: cursorAfterDelete.y }; // Move cursor right
            
            // Check for bounded region word wrapping
            const boundedRegion = getBoundedRegion(dataToDeleteFrom, cursorAfterDelete);
            if (boundedRegion && proposedCursorPos.x > boundedRegion.endX) {
                // We're typing past the right edge of a bounded region
                // Check if we can wrap to next line without exceeding height limit
                const nextLineY = cursorAfterDelete.y + 1;
                
                // Find the bound that controls this region to check maxY and if we're within bounds
                let canWrap = true;
                let isWithinBoundedRegion = false;
                
                for (const key in dataToDeleteFrom) {
                    if (key.startsWith('bound_')) {
                        try {
                            const boundData = JSON.parse(dataToDeleteFrom[key] as string);
                            
                            // Check if we're currently within this bound's original region or its column constraint area
                            const withinOriginalBounds = cursorAfterDelete.x >= boundData.startX && 
                                                         cursorAfterDelete.x <= boundData.endX &&
                                                         cursorAfterDelete.y >= boundData.startY && 
                                                         cursorAfterDelete.y <= boundData.endY;
                            
                            const withinColumnConstraint = boundData.endY < cursorAfterDelete.y && 
                                                          cursorAfterDelete.x >= boundData.startX && 
                                                          cursorAfterDelete.x <= boundData.endX &&
                                                          (boundData.maxY === null || boundData.maxY === undefined || cursorAfterDelete.y <= boundData.maxY);
                            
                            if (withinOriginalBounds || withinColumnConstraint) {
                                isWithinBoundedRegion = true;
                                
                                // Check if wrapping would exceed height limit
                                if (boundData.maxY !== null && boundData.maxY !== undefined && nextLineY > boundData.maxY) {
                                    canWrap = false;
                                    break;
                                }
                            }
                        } catch (e) {
                            // Skip invalid bound data
                        }
                    }
                }
                
                if (isWithinBoundedRegion) {
                    if (canWrap) {
                        // Simple word wrapping: scan backwards to find the last space, then move everything after it
                        const currentLineY = cursorAfterDelete.y;
                        let wrapPoint = boundedRegion.startX; // Default to start of line if no space found
                        
                        // Scan backwards from the boundary to find the last space
                        for (let x = boundedRegion.endX; x >= boundedRegion.startX; x--) {
                            const charKey = `${x},${currentLineY}`;
                            const charData = dataToDeleteFrom[charKey];
                            const char = typeof charData === 'string' ? charData : 
                                        (charData && typeof charData === 'object' && 'char' in charData) ? charData.char : '';
                            
                            if (char === ' ') {
                                wrapPoint = x + 1; // Start wrapping after the space
                                break;
                            }
                        }
                        
                        // Only do word wrapping if we found a space and there's something to wrap
                        if (wrapPoint > boundedRegion.startX && wrapPoint <= cursorAfterDelete.x) {
                            // Collect all characters from wrap point to cursor
                            const textToWrap: Array<{x: number, char: string, style?: any}> = [];
                            
                            for (let x = wrapPoint; x <= cursorAfterDelete.x; x++) {
                                const charKey = `${x},${currentLineY}`;
                                const charData = dataToDeleteFrom[charKey];
                                if (charData) {
                                    const char = typeof charData === 'string' ? charData : 
                                               (charData && typeof charData === 'object' && 'char' in charData) ? charData.char : '';
                                    const style = typeof charData === 'object' && 'style' in charData ? charData.style : undefined;
                                    if (char) {
                                        textToWrap.push({x, char, style});
                                    }
                                }
                            }
                            
                            // Remove the text from current line (but keep the space)
                            const updatedWorldData = { ...dataToDeleteFrom };
                            for (let x = wrapPoint; x <= cursorAfterDelete.x; x++) {
                                const charKey = `${x},${currentLineY}`;
                                delete updatedWorldData[charKey];
                            }
                            
                            // Add the text to next line
                            let newX = boundedRegion.startX;
                            for (const {char, style} of textToWrap) {
                                if (char !== ' ') { // Skip spaces when wrapping
                                    const newKey = `${newX},${nextLineY}`;
                                    updatedWorldData[newKey] = style ? {char, style} : char;
                                    newX++;
                                }
                            }
                            
                            // Add the current character being typed
                            const finalKey = `${newX},${nextLineY}`;
                            updatedWorldData[finalKey] = key;
                            
                            // Update world data and cursor position
                            setWorldData(updatedWorldData);
                            setCursorPos({ x: newX + 1, y: nextLineY });
                            worldDataChanged = true;
                            
                            // Skip normal character placement since we handled it above
                            return true;
                        } else {
                            // No good wrap point found - just move to next line
                            proposedCursorPos = { 
                                x: boundedRegion.startX, 
                                y: nextLineY 
                            };
                        }
                    } else {
                        // Can't wrap within bounded region - allow typing beyond bounds
                        proposedCursorPos = { 
                            x: cursorAfterDelete.x + 1, 
                            y: cursorAfterDelete.y 
                        };
                    }
                } else {
                    // We're outside bounded region - normal wrapping rules apply
                    proposedCursorPos = { 
                        x: boundedRegion.startX, 
                        y: nextLineY 
                    };
                }
            }
            
            nextCursorPos = proposedCursorPos;
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
                    setDialogueText("Chat mode activated. Enter: ephemeral response, Cmd+Enter: permanent response, Shift+Enter: new line. Use /exit to leave.");
                }
            } else {
                // Air mode (default): Normal text input to worldData
                nextWorldData = { ...dataToDeleteFrom }; // Start with data after potential deletion
                const currentKey = `${cursorAfterDelete.x},${cursorAfterDelete.y}`;
                
                // Check if current text style is different from global defaults
                const hasCustomStyle = currentTextStyle.color !== textColor || currentTextStyle.background !== undefined;
                
                if (hasCustomStyle) {
                    // Store styled character (filter out undefined values for Firebase)
                    const style: { color?: string; background?: string } = {
                        color: currentTextStyle.color
                    };
                    if (currentTextStyle.background !== undefined) {
                        style.background = currentTextStyle.background;
                    }
                    
                    const styledChar: StyledCharacter = {
                        char: key,
                        style: style
                    };
                    nextWorldData[currentKey] = styledChar;
                } else {
                    // Store plain character (backward compatibility)
                    nextWorldData[currentKey] = key;
                }
                
                worldDataChanged = true; // Mark that synchronous data change occurred
                setLastEnterX(null); // Reset Enter X tracking when typing
            }
        }
        // --- Other ---
        else {
            preventDefault = false; // Don't prevent default for unhandled keys
        }

        // === Update State ===
        if (moved) {
            setCursorPos(nextCursorPos);
            
            // Camera tracking modes
            if (typeof window !== 'undefined') {
                const { width: effectiveCharWidth, height: effectiveCharHeight } = getEffectiveCharDims(zoomLevel);
                if (effectiveCharWidth > 0 && effectiveCharHeight > 0) {
                    const viewportCharWidth = window.innerWidth / effectiveCharWidth;
                    const viewportCharHeight = window.innerHeight / effectiveCharHeight;
                    
                    if (cameraMode === 'default') {
                        // Default mode: Keep cursor in view (was ripstop behavior)
                        // Check if cursor is outside current viewport bounds
                        const cursorOutsideLeft = nextCursorPos.x < viewOffset.x;
                        const cursorOutsideRight = nextCursorPos.x >= viewOffset.x + viewportCharWidth;
                        const cursorOutsideTop = nextCursorPos.y < viewOffset.y;
                        const cursorOutsideBottom = nextCursorPos.y >= viewOffset.y + viewportCharHeight;
                        
                        let newViewOffset = { ...viewOffset };
                        
                        // Adjust view to keep cursor in bounds
                        if (cursorOutsideLeft) {
                            newViewOffset.x = nextCursorPos.x;
                        } else if (cursorOutsideRight) {
                            newViewOffset.x = nextCursorPos.x - viewportCharWidth + 1;
                        }
                        
                        if (cursorOutsideTop) {
                            newViewOffset.y = nextCursorPos.y;
                        } else if (cursorOutsideBottom) {
                            newViewOffset.y = nextCursorPos.y - viewportCharHeight + 1;
                        }
                        
                        // Update view offset if needed
                        if (newViewOffset.x !== viewOffset.x || newViewOffset.y !== viewOffset.y) {
                            setViewOffset(newViewOffset);
                        }
                    } else if (cameraMode === 'focus') {
                        // Focus mode: Center cursor in viewport
                        const centerX = nextCursorPos.x - viewportCharWidth / 2;
                        const centerY = nextCursorPos.y - viewportCharHeight / 2;
                        
                        setViewOffset({ x: centerX, y: centerY });
                    }
                }
            }
            
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
        currentMode, addEphemeralText, cameraMode, viewOffset, zoomLevel, getEffectiveCharDims, // Mode system dependencies
        getNormalizedSelection, deleteSelectedCharacters, copySelectedCharacters, cutSelection, pasteText, getSelectedText, // Callback dependencies
        handleCommandKeyDown, textColor, currentTextStyle
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
            setLastEnterX(null); // Reset Enter X tracking when clicking
        } else if (clearSelection && !clickedInsideSelection) {
            // Only clear selection if:
            // 1. We're explicitly asked to clear it AND
            // 2. The click is outside existing selection
            setSelectionStart(null);
            setSelectionEnd(null);
            setCursorPos(newCursorPos);
            setLastEnterX(null); // Reset Enter X tracking when clicking
        } else {
            // Just move the cursor without affecting selection
            setCursorPos(newCursorPos);
            setLastEnterX(null); // Reset Enter X tracking when clicking
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
            
        }
        
        return newOffset;
    }, [zoomLevel, getEffectiveCharDims, viewOffset]);

    const handlePanEnd = useCallback((newOffset: Point): void => {
        if (isPanningRef.current) {
            isPanningRef.current = false;
            setViewOffset(newOffset); // Set final state
        }
    }, []);

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

    const batchMoveCharacters = useCallback((moves: Array<{fromX: number, fromY: number, toX: number, toY: number, char: string}>): void => {
        const newWorldData = { ...worldData };
        
        // First, delete all characters from their original positions
        for (const move of moves) {
            const fromKey = `${move.fromX},${move.fromY}`;
            delete newWorldData[fromKey];
        }
        
        // Then, place all characters at their new positions
        for (const move of moves) {
            const toKey = `${move.toX},${move.toY}`;
            newWorldData[toKey] = move.char;
        }
        
        // Apply all changes in one batch
        setWorldData(newWorldData);
    }, [worldData]);

    const moveImage = useCallback((imageKey: string, deltaX: number, deltaY: number): void => {
        const imageData = worldData[imageKey];
        if (!imageData || !isImageData(imageData)) {
            logger.error('Invalid image key or data:', imageKey);
            return;
        }
        
        // Create new image data with updated coordinates
        const newImageData: ImageData = {
            ...imageData,
            startX: imageData.startX + deltaX,
            startY: imageData.startY + deltaY,
            endX: imageData.endX + deltaX,
            endY: imageData.endY + deltaY
        };
        
        // Create new image key based on new position
        const newImageKey = `image_${newImageData.startX},${newImageData.startY}`;
        
        // Update world data - remove old image and add new one
        setWorldData(prev => {
            const newData = { ...prev };
            delete newData[imageKey]; // Remove old image
            newData[newImageKey] = newImageData; // Add moved image
            return newData;
        });
    }, [worldData, isImageData]);

    const deleteImage = useCallback((imageKey: string): void => {
        if (!worldData[imageKey]) {
            logger.error('Image key not found:', imageKey);
            return;
        }
        
        // Remove the image from world data
        setWorldData(prev => {
            const newData = { ...prev };
            delete newData[imageKey];
            return newData;
        });
    }, [worldData]);

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
                    const charData = worldData[key];
                    
                    // Skip image data - only process text/label characters
                    if (isImageData(charData)) {
                        continue;
                    }
                    
                    const charString = getCharacter(charData);
                    const labelData = JSON.parse(charString);
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
                        // Skip image data - only process text/label characters
                        if (isImageData(worldData[key])) {
                            continue;
                        }
                        const labelData = JSON.parse(getCharacter(worldData[key]));
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
                    
                    lastKnownPositionRef.current = { x: center.x, y: center.y };
                }
            }
        }, 100); // Update every 100ms

        return () => clearInterval(interval);
    }, [getViewportCenter]);


    return {
        worldData,
        commandData,
        commandState,
        commandSystem: { selectCommand },
        chatData,
        lightModeData,
        searchData,
        viewOffset,
        cursorPos,
        zoomLevel,
        backgroundMode,
        backgroundColor,
        backgroundImage,
        backgroundVideo,
        textColor,
        fontFamily,
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
        batchMoveCharacters,
        moveImage,
        deleteImage,
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
        getAllBounds,
        getSortedLabels,
        getUniqueColors,
        toggleColorFilter,
        navColorFilters,
        cycleSortMode,
        navSortMode,
        navMode,
        toggleNavMode,
        isBlock,
        isNavVisible,
        setIsNavVisible,
        navOriginPosition,
        dialogueText,
        setDialogueText,
        chatMode,
        setChatMode,
        getCharacter,
        getCharacterStyle,
        isImageData,
        getCompiledText: () => compiledTextCache,
        compiledTextCache: compiledTextCache, // Direct access to compiled text cache for real-time updates
        getCanvasSize: () => ({ width: window.innerWidth, height: window.innerHeight }),
        // State management functions
        saveState,
        loadState,
        availableStates,
        currentStateName,
        loadAvailableStates,
        username, // Expose username for routing
        userUid, // Expose userUid for Firebase operations
        // Text frame and cluster system
        textFrames,
        framesVisible,
        updateTextFrames,
        // Hierarchical frame system
        hierarchicalFrames,
        useHierarchicalFrames,
        hierarchicalConfig,
        clusterLabels,
        clustersVisible,
        updateClusterLabels,
        focusedBoundKey, // Expose focused bound for rendering
        isMoveMode,
        gridMode,
        cycleGridMode,
        artefactsEnabled,
        artifactType,
    };
}