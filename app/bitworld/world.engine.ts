// hooks/useWorldEngine.ts
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useWorldSave } from './world.save'; // Import the new hook
import { useCommandSystem, CommandState, CommandExecution, BackgroundMode, COLOR_MAP } from './commands'; // Import command system
import { getSmartIndentation, calculateWordDeletion, extractLineCharacters, detectTextBlocks, findClosestBlock, findBlockForDeletion, extractAllTextBlocks, groupTextBlocksIntoClusters, filterClustersForLabeling, generateTextBlockFrames, generateHierarchicalFrames, HierarchicalFrameSystem, HierarchicalFrame, HierarchyLevel, defaultDistanceConfig, DistanceBasedConfig } from './bit.blocks'; // Import block detection utilities
import { useWorldSettings, WorldSettings } from './settings';
import { set, ref, increment, runTransaction, serverTimestamp, onValue } from 'firebase/database';
import { database, auth, storage, getUserProfile } from '@/app/firebase';
import { ref as storageRef, uploadString, getDownloadURL } from 'firebase/storage';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
// Import lightweight AI utilities (no GenAI dependency)
import { createSubtitleCycler, setDialogueWithRevert, abortCurrentAI, isAIActive, detectImageIntent } from './ai.utils';
import { logger } from './logger';
import { useAutoDialogue } from './dialogue';
import { get } from 'firebase/database';
import { parseGIFFromArrayBuffer, getCurrentFrame, isGIFUrl } from './gif.parser';

// API route helper functions for AI operations
const callTransformAPI = async (text: string, instructions: string, userId?: string): Promise<string> => {
    const response = await fetch('/api/transform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, instructions, userId })
    });
    const data = await response.json();
    return data.result;
};

const callExplainAPI = async (text: string, analysisType?: string, userId?: string): Promise<string> => {
    const response = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, analysisType, userId })
    });
    const data = await response.json();
    return data.result;
};

const callSummarizeAPI = async (text: string, focus?: string, userId?: string): Promise<string> => {
    const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, focus, userId })
    });
    const data = await response.json();
    return data.result;
};

const callChatAPI = async (prompt: string, addToHistory: boolean, userId?: string, worldContext?: any): Promise<string> => {
    const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, addToHistory, userId, worldContext })
    });
    const data = await response.json();
    return data.result;
};

const callGenerateImageAPI = async (prompt: string, referenceImage?: string, userId?: string, aspectRatio?: string): Promise<any> => {
    const response = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, referenceImage, userId, aspectRatio })
    });
    const data = await response.json();
    return data.result;
};

// Keep clearChatHistory as a local import since it's a simple utility
const clearChatHistory = async () => {
    const ai = await import('./ai');
    return ai.clearChatHistory();
};

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
    src: string; // Data URL or blob URL (for GIFs, this is the first frame URL)
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    originalWidth: number;
    originalHeight: number;
    // GIF animation data (optional)
    isAnimated?: boolean;
    frameTiming?: Array<{ url: string; delay: number }>; // Frame URLs and delays
    totalDuration?: number; // Total animation duration in ms
    animationStartTime?: number; // Timestamp when animation started (for frame calculation)
}

export interface ListData {
    startX: number;
    startY: number;
    endX: number;
    visibleHeight: number;
    scrollOffset: number;
    color: string;
    title?: string;
}

export interface ListContent {
    [lineIndex: number]: string;
}

export interface ClipboardItem {
    id: string;
    content: string; // The text content from the bound
    startX: number;
    endX: number;
    startY: number;
    endY: number;
    maxY?: number;
    title?: string;
    color?: string;
    timestamp: number;
}

export interface MultiplayerCursor {
    uid: string;
    username: string;
    x: number;
    y: number;
    color: string;
    lastUpdate: number;
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
    commandSystem: {
        selectCommand: (command: string) => void;
        executeCommandString: (command: string) => void;
        startCommand: (cursorPos: Point) => void;
        startCommandWithInput: (cursorPos: Point, input: string) => void;
    };
    chatData: WorldData;
    suggestionData: WorldData;
    lightModeData: WorldData;
    hostData: { text: string; color?: string; centerPos: Point; timestamp?: number } | null; // Host messages rendered at fixed position with streaming
    stagedImageData: ImageData[]; // Ephemeral staged images (cleared with Escape, supports multiple)
    clipboardItems: ClipboardItem[]; // Clipboard items from Cmd+click on bounds
    searchData: WorldData;
    viewOffset: Point;
    cursorPos: Point;
    zoomLevel: number;
    backgroundMode: BackgroundMode;
    backgroundColor?: string; // Optional - undefined for transparent stream/image backgrounds
    backgroundImage?: string;
    backgroundVideo?: string;
    backgroundStream?: MediaStream;
    switchBackgroundMode: (newMode: BackgroundMode, bgColor?: string, textColor?: string, textBg?: string, aiPrompt?: string) => boolean;
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
    handleCanvasClick: (canvasRelativeX: number, canvasRelativeY: number, clearSelection?: boolean, shiftKey?: boolean, metaKey?: boolean, ctrlKey?: boolean) => void;
    handleCanvasWheel: (deltaX: number, deltaY: number, canvasRelativeX: number, canvasRelativeY: number, ctrlOrMetaKey: boolean) => void;
    handlePanStart: (clientX: number, clientY: number) => PanStartInfo | null;
    handlePanMove: (clientX: number, clientY: number, panStartInfo: PanStartInfo) => Point;
    handlePanEnd: (newOffset: Point) => void;
    handleKeyDown: (key: string, ctrlKey: boolean, metaKey: boolean, shiftKey: boolean, altKey?: boolean) => Promise<boolean>;
    setViewOffset: React.Dispatch<React.SetStateAction<Point>>;
    setZoomLevel: React.Dispatch<React.SetStateAction<number>>;
    selectionStart: Point | null;
    selectionEnd: Point | null;
    aiProcessingRegion: { startX: number, endX: number, startY: number, endY: number } | null;
    selectedNoteKey: string | null; // Track selected note region from canvas
    setSelectedNoteKey: React.Dispatch<React.SetStateAction<string | null>>; // Allow canvas to update selected note
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
    dialogueTimestamp: number | undefined; // Timestamp when dialogue text was set (for animations)
    setDialogueText: (text: string) => void;
    setTapeRecordingCallback: (callback: () => Promise<void> | void) => void;
    tapeRecordingCallback: (() => Promise<void> | void) | null;
    setScreenshotCallback: (callback: () => Promise<string | null>) => void;
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
    latexMode: {
        isActive: boolean;
        currentInput: string;
        inputPositions: Point[];
        startPos: Point;
        previewImage: string | null;
    };
    setLatexMode: React.Dispatch<React.SetStateAction<{
        isActive: boolean;
        currentInput: string;
        inputPositions: Point[];
        startPos: Point;
        previewImage: string | null;
    }>>;
    latexData: WorldData; // Rendered LaTeX input data
    smilesMode: {
        isActive: boolean;
        currentInput: string;
        inputPositions: Point[];
        startPos: Point;
        previewImage: string | null;
    };
    setSmilesMode: React.Dispatch<React.SetStateAction<{
        isActive: boolean;
        currentInput: string;
        inputPositions: Point[];
        startPos: Point;
        previewImage: string | null;
    }>>;
    smilesData: WorldData; // Rendered SMILES (molecular structure) input data
    clearLatexData: () => void;
    clearSmilesData: () => void;
    clearChatData: () => void;
    clearLightModeData: () => void;
    // Agent system
    agentEnabled: boolean;
    agentPos: Point;
    agentState: 'idle' | 'typing' | 'moving' | 'walking' | 'selecting';
    agentSelectionStart: Point | null;
    agentSelectionEnd: Point | null;
    // Multiplayer cursors
    multiplayerCursors: MultiplayerCursor[];
    // Host mode for onboarding
    hostMode: {
        isActive: boolean;
        currentInputType: import('./host.flows').InputType | null;
    };
    setHostMode: React.Dispatch<React.SetStateAction<{
        isActive: boolean;
        currentInputType: import('./host.flows').InputType | null;
    }>>;
    setHostData: React.Dispatch<React.SetStateAction<{ text: string; color?: string; centerPos: Point; timestamp?: number } | null>>;
    setStagedImageData: React.Dispatch<React.SetStateAction<ImageData[]>>;
    // Ephemeral text rendering for host dialogue
    addInstantAIResponse: (startPos: Point, text: string, options?: {
        wrapWidth?: number;
        fadeDelay?: number;
        fadeInterval?: number;
        color?: string;
        queryText?: string;
    }) => { width: number; height: number };
    setWorldData: React.Dispatch<React.SetStateAction<WorldData>>;
    // Monogram command callback
    setMonogramCommandHandler: (handler: (args: string[]) => void) => void;
    // Host dialogue flow callback
    setHostDialogueHandler: (handler: () => void) => void;
    // Upgrade flow callback
    setUpgradeFlowHandler: (handler: () => void) => void;
    triggerUpgradeFlow: () => void;
    // Tutorial flow callback
    setTutorialFlowHandler: (handler: () => void) => void;
    triggerTutorialFlow: () => void;
    // Tutorial command validation callback
    setCommandValidationHandler: (handler: (command: string, args: string[], worldState?: any) => boolean) => void;
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
    boundKeys: string[]; // Cached list of bound_ keys for performance
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
    cameraMode: import('./commands').CameraMode;
    setCameraMode: (mode: import('./commands').CameraMode) => void;
    gridMode: import('./commands').GridMode;
    cycleGridMode: () => void;
    artefactsEnabled: boolean;
    artifactType: import('./commands').ArtifactType;
    isReadOnly: boolean; // Read-only mode for observers
    // IME composition support
    isComposing: boolean;
    compositionText: string;
    compositionStartPos: Point | null;
    handleCompositionStart: () => void;
    handleCompositionUpdate: (text: string) => void;
    handleCompositionEnd: (text: string) => void;
    // Face detection for piloting geometry
    isFaceDetectionEnabled: boolean;
    faceOrientation?: {
        rotX: number;
        rotY: number;
        rotZ: number;
        mouthOpen?: number; // Mouth openness (0-1)
    };
    setFaceDetectionEnabled: (enabled: boolean) => void;
}

// --- Hook Input ---
interface UseWorldEngineProps {
    initialWorldData?: WorldData; // Optional initial data (might be overridden by Firebase)
    initialCursorPos?: Point;
    initialViewOffset?: Point;
    initialZoomLevel?: number;
    worldId: string | null; // Add worldId for persistence
    initialBackgroundColor?: string;
    initialTextColor?: string; // Initial text color
    userUid?: string | null; // Add user UID for user-specific persistence
    username?: string; // Add username for routing
    enableCommands?: boolean; // Enable/disable command system (default: true)
    initialStateName?: string | null; // Initial state name from URL
    initialPatternId?: string; // Pattern ID from URL for deterministic pattern generation
    onMonogramCommand?: (args: string[]) => void; // Callback for monogram commands
    isReadOnly?: boolean; // Read-only mode (observer/viewer)
    skipInitialBackground?: boolean; // Skip applying initialBackgroundColor (let host flow control it)
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

/**
 * Generate deterministic pattern from pattern ID
 * @param patternId Base36 pattern identifier from URL
 * @param centerPos Center position for pattern placement
 * @returns Pattern data object ready for worldData storage
 */
function generatePatternFromId(patternId: string, centerPos: Point = { x: 0, y: 0 }): {
    patternData: any;
    patternKey: string;
} {
    // Convert pattern ID to numeric seed (base36 decode)
    const seed = parseInt(patternId, 36);

    // If invalid, use hash of the string
    const numericSeed = isNaN(seed) ? patternId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) : seed;

    // Deterministic RNG based on seed
    const random = (n: number) => {
        const x = Math.sin(numericSeed + n) * 10000;
        return x - Math.floor(x);
    };

    // BSP generation (same as pattern command)
    const width = 120;
    const height = 60;

    type BSPNode = {
        x: number;
        y: number;
        width: number;
        height: number;
        leftChild?: BSPNode;
        rightChild?: BSPNode;
        room?: { x: number; y: number; width: number; height: number };
    };

    const bspSplit = (node: BSPNode, depth: number, maxDepth: number, rng: (n: number) => number, rngOffset: number): void => {
        if (depth >= maxDepth) {
            const margin = 2;
            if (node.width < margin * 2 + 3 || node.height < margin * 2 + 3) return;
            const roomWidth = Math.floor(rng(rngOffset) * 12) + 28;
            const roomHeight = Math.floor(rng(rngOffset + 1) * 6) + 10;
            const roomX = node.x + margin + Math.floor(rng(rngOffset + 2) * Math.max(0, node.width - roomWidth - margin * 2));
            const roomY = node.y + margin + Math.floor(rng(rngOffset + 3) * Math.max(0, node.height - roomHeight - margin * 2));
            node.room = { x: roomX, y: roomY, width: roomWidth, height: roomHeight };
            return;
        }
        const visualWidth = node.width * 1;
        const visualHeight = node.height * 2;
        const splitHorizontal = visualHeight > visualWidth ? true : (visualWidth > visualHeight ? false : rng(rngOffset + depth) > 0.5);
        if (splitHorizontal && node.height >= 20) {
            const splitY = node.y + Math.floor(node.height / 2) + Math.floor(rng(rngOffset + depth + 1) * 6) - 3;
            node.leftChild = { x: node.x, y: node.y, width: node.width, height: splitY - node.y };
            node.rightChild = { x: node.x, y: splitY, width: node.width, height: node.y + node.height - splitY };
        } else if (!splitHorizontal && node.width >= 40) {
            const splitX = node.x + Math.floor(node.width / 2) + Math.floor(rng(rngOffset + depth + 2) * 8) - 4;
            node.leftChild = { x: node.x, y: node.y, width: splitX - node.x, height: node.height };
            node.rightChild = { x: splitX, y: node.y, width: node.x + node.width - splitX, height: node.height };
        } else {
            const margin = 2;
            const roomWidth = Math.max(28, Math.min(node.width - margin * 2, 40));
            const roomHeight = Math.max(10, Math.min(node.height - margin * 2, 16));
            if (roomWidth >= 28 && roomHeight >= 10) {
                node.room = { x: node.x + margin, y: node.y + margin, width: roomWidth, height: roomHeight };
            }
            return;
        }
        if (node.leftChild) bspSplit(node.leftChild, depth + 1, maxDepth, rng, rngOffset + depth * 10);
        if (node.rightChild) bspSplit(node.rightChild, depth + 1, maxDepth, rng, rngOffset + depth * 10 + 5);
    };

    const collectRooms = (node: BSPNode): Array<{ x: number; y: number; width: number; height: number }> => {
        const result: Array<{ x: number; y: number; width: number; height: number }> = [];
        if (node.room) result.push(node.room);
        if (node.leftChild) result.push(...collectRooms(node.leftChild));
        if (node.rightChild) result.push(...collectRooms(node.rightChild));
        return result;
    };

    const rootNode: BSPNode = {
        x: Math.floor(centerPos.x - width / 2),
        y: Math.floor(centerPos.y - height / 2),
        width: width,
        height: height
    };

    bspSplit(rootNode, 0, 3, random, 100);
    const rooms = collectRooms(rootNode);

    // Calculate actual bounding box from rooms
    const corridorPadding = 3;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const room of rooms) {
        const roomMinX = room.x;
        const roomMinY = room.y;
        const roomMaxX = room.x + room.width;
        const roomMaxY = room.y + room.height;
        const centerX = room.x + Math.floor(room.width / 2);
        const centerY = room.y + Math.floor(room.height / 2);

        minX = Math.min(minX, roomMinX, centerX - corridorPadding);
        minY = Math.min(minY, roomMinY, centerY - corridorPadding);
        maxX = Math.max(maxX, roomMaxX, centerX + corridorPadding);
        maxY = Math.max(maxY, roomMaxY, centerY + corridorPadding);
    }

    const actualWidth = maxX - minX;
    const actualHeight = maxY - minY;
    const actualCenterX = minX + actualWidth / 2;
    const actualCenterY = minY + actualHeight / 2;

    const patternKey = `pattern_${patternId}`;
    const patternData = {
        centerX: actualCenterX,
        centerY: actualCenterY,
        width: actualWidth,
        height: actualHeight,
        timestamp: numericSeed,
        rooms: rooms
    };

    return { patternData, patternKey };
}

// --- The Hook ---
export function useWorldEngine({
    initialWorldData = {},
    initialCursorPos = { x: 0, y: 0 },
    initialViewOffset = { x: 0, y: 0 },
    initialZoomLevel = 1, // Default zoom level index
    worldId = null,      // Default to no persistence
    initialBackgroundColor,
    initialTextColor,
    userUid = null,      // Default to no user-specific persistence
    enableCommands = true, // Default to enabled
    username,            // Username for routing
    initialStateName = null, // Initial state name from URL
    initialPatternId,    // Pattern ID from URL for deterministic generation
    onMonogramCommand,   // Callback for monogram commands
    isReadOnly = false,  // Read-only mode (default to writeable)
    skipInitialBackground = false, // Skip applying initialBackgroundColor
}: UseWorldEngineProps): WorldEngine {
    // === Router ===
    const router = useRouter();

    // Calculate centered initial view offset to prevent pan tracking from seeing initialization jump
    const calculateCenteredOffset = (targetX: number, targetY: number, zoomLvl: number): Point => {
        if (typeof window === 'undefined') return { x: targetX, y: targetY };
        
        // Use approximate char dimensions for initial calculation
        const baseCharWidth = 10;
        const baseCharHeight = 16;
        const zoomFactor = Math.pow(1.2, zoomLvl - 1);
        const effectiveCharWidth = baseCharWidth * zoomFactor;
        const effectiveCharHeight = baseCharHeight * zoomFactor;
        
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const charsInViewportWidth = viewportWidth / effectiveCharWidth;
        const charsInViewportHeight = viewportHeight / effectiveCharHeight;
        
        return {
            x: targetX - (charsInViewportWidth / 2),
            y: targetY - (charsInViewportHeight / 2)
        };
    };
    
    // Calculate initial centered offset if initialViewOffset is provided (non-zero)
    const initialCenteredOffset = (initialViewOffset.x !== 0 || initialViewOffset.y !== 0)
        ? calculateCenteredOffset(initialViewOffset.x, initialViewOffset.y, initialZoomLevel)
        : initialViewOffset;
    
    // Track if we've already applied initial positioning to prevent useEffect from reapplying
    const hasAppliedSpawnRef = useRef(initialViewOffset.x !== 0 || initialViewOffset.y !== 0);

    const [isSelecting, setIsSelecting] = useState(false);
    const [selectionStart, setSelectionStart] = useState<Point | null>(null);
    const [selectionEnd, setSelectionEnd] = useState<Point | null>(null);
    const [aiProcessingRegion, setAiProcessingRegion] = useState<{ startX: number, endX: number, startY: number, endY: number } | null>(null);
    const [selectedNoteKey, setSelectedNoteKey] = useState<string | null>(null); // Track selected note region from canvas

    // === State ===
    const [worldData, setWorldData] = useState<WorldData>(initialWorldData);
    const [cursorPos, setCursorPos] = useState<Point>(initialCursorPos);
    const cursorPosRef = useRef<Point>(initialCursorPos); // Ref for synchronous cursor position access
    const [viewOffset, setViewOffset] = useState<Point>(initialCenteredOffset);
    const [zoomLevel, setZoomLevel] = useState<number>(initialZoomLevel); // Store zoom *level*, not index
    const [focusedBoundKey, setFocusedBoundKey] = useState<string | null>(null); // Track which bound is focused
    const [boundCycleIndex, setBoundCycleIndex] = useState<number>(0); // Track which bound to cycle to next
    const [dialogueText, setDialogueTextState] = useState('');
    const [dialogueTimestamp, setDialogueTimestamp] = useState<number | undefined>(undefined);
    const tapeRecordingCallbackRef = useRef<(() => Promise<void> | void) | null>(null);

    // Wrapper for setDialogueText that also updates timestamp
    const setDialogueText = useCallback((text: string) => {
        setDialogueTextState(text);
        setDialogueTimestamp(text ? Date.now() : undefined); // Set timestamp if text exists, clear if empty
    }, []);
    const [membershipLevel, setMembershipLevel] = useState<string | undefined>(undefined);

    // Inline autocomplete state
    const [suggestionData, setSuggestionData] = useState<WorldData>({});
    const [currentSuggestion, setCurrentSuggestion] = useState<string>('');
    const [currentSuggestions, setCurrentSuggestions] = useState<string[]>([]);
    const [currentSuggestionIndex, setCurrentSuggestionIndex] = useState<number>(0);
    const suggestionDebounceRef = useRef<NodeJS.Timeout | null>(null);
    const currentSuggestionRef = useRef<string>(''); // Ref for immediate access

    // Double ESC detection for AI interruption
    const lastEscTimeRef = useRef<number | null>(null);
    const [lastEnterX, setLastEnterX] = useState<number | null>(null); // Track X position from last Enter

    // Monogram command handler ref
    const monogramCommandHandlerRef = useRef<((args: string[]) => void) | null>(null);

    // Host dialogue handler ref
    const hostDialogueHandlerRef = useRef<(() => void) | null>(null);

    // Upgrade flow handler ref
    const upgradeFlowHandlerRef = useRef<(() => void) | null>(null);

    // Tutorial flow handler ref
    const tutorialFlowHandlerRef = useRef<(() => void) | null>(null);

    // Command validation handler ref (for tutorial flow)
    const commandValidationHandlerRef = useRef<((command: string, args: string[], worldState?: any) => boolean) | null>(null);

    // Auto-clear temporary dialogue messages
    useAutoDialogue(dialogueText, setDialogueText);

    // Keep cursorPosRef synchronized with cursorPos state
    useEffect(() => {
        cursorPosRef.current = cursorPos;
    }, [cursorPos]);

    // Fetch user membership level
    useEffect(() => {
        const fetchMembership = async () => {
            if (userUid) {
                try {
                    const profile = await getUserProfile(userUid);
                    if (profile && profile.membership) {
                        setMembershipLevel(profile.membership);
                    }
                } catch (error) {
                    console.error('Error fetching membership:', error);
                }
            }
        };

        fetchMembership();
    }, [userUid]);

    // Auto-generate pattern from URL parameter if provided
    useEffect(() => {
        if (initialPatternId && worldData) {
            // Check if pattern already exists in world data
            const patternKey = `pattern_${initialPatternId}`;
            const patternExists = patternKey in worldData;

            if (!patternExists) {
                // Generate pattern at origin (0, 0)
                const { patternData, patternKey: generatedKey } = generatePatternFromId(initialPatternId, { x: 0, y: 0 });

                // Add pattern to world data
                setWorldData((prev: WorldData) => ({
                    ...prev,
                    [generatedKey]: JSON.stringify(patternData)
                }));

                console.log(`Pattern ${initialPatternId} generated from URL`);
            }
        }
    }, [initialPatternId]); // Only run once on mount when initialPatternId exists

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

    const [latexMode, setLatexMode] = useState<{
        isActive: boolean;
        currentInput: string;
        inputPositions: Point[];
        startPos: Point;
        previewImage: string | null;
    }>({
        isActive: false,
        currentInput: '',
        inputPositions: [],
        startPos: { x: 0, y: 0 },
        previewImage: null
    });

    // === SMILES Mode State (for molecular structure input) ===
    const [smilesMode, setSmilesMode] = useState<{
        isActive: boolean;
        currentInput: string;
        inputPositions: Point[];
        startPos: Point;
        previewImage: string | null;
    }>({
        isActive: false,
        currentInput: '',
        inputPositions: [],
        startPos: { x: 0, y: 0 },
        previewImage: null
    });

    // === Host Mode State (for onboarding) ===
    const [hostMode, setHostMode] = useState<{
        isActive: boolean;
        currentInputType: import('./host.flows').InputType | null;
    }>({
        isActive: false,
        currentInputType: null
    });

    const [chatData, setChatData] = useState<WorldData>({});
    const [latexData, setLatexData] = useState<WorldData>({});
    const [smilesData, setSmilesData] = useState<WorldData>({});
    const [searchData, setSearchData] = useState<WorldData>({});
    const [hostData, setHostData] = useState<{ text: string; color?: string; centerPos: Point; timestamp?: number } | null>(null);
    const [stagedImageData, setStagedImageData] = useState<ImageData[]>([]); // Ephemeral staged images (supports multiple)
    const [clipboardItems, setClipboardItems] = useState<ClipboardItem[]>([]); // Clipboard items from Cmd+click on bounds

    // === IME Composition State ===
    const [isComposing, setIsComposing] = useState<boolean>(false);
    const isComposingRef = useRef<boolean>(false); // Ref for synchronous access
    const [compositionText, setCompositionText] = useState<string>('');
    const [compositionStartPos, setCompositionStartPos] = useState<Point | null>(null);
    const compositionStartPosRef = useRef<Point | null>(null); // Ref for synchronous access
    const justTypedCharRef = useRef<boolean>(false); // Track if we just typed a character before composition starts
    const preCompositionCursorPosRef = useRef<Point | null>(null); // Track cursor position before backing up
    const justCancelledCompositionRef = useRef<boolean>(false); // Track if we just cancelled composition with backspace
    const compositionCancelledByModeExitRef = useRef<boolean>(false); // Track if composition was cancelled by exiting mode

     // === Multiplayer Cursors ===
 const [multiplayerCursors, setMultiplayerCursors] = useState<MultiplayerCursor[]>([]);

    // === Agent System ===
    const [agentEnabled, setAgentEnabled] = useState<boolean>(false);
    const [agentPos, setAgentPos] = useState<Point>({ x: 0, y: 0 });
    const [agentState, setAgentState] = useState<'idle' | 'typing' | 'moving' | 'walking' | 'selecting'>('idle');
    const [agentIdleTimer, setAgentIdleTimer] = useState<number>(0);
    const [agentTargetPos, setAgentTargetPos] = useState<Point | null>(null);
    const [agentStartPos, setAgentStartPos] = useState<Point>({ x: 0, y: 0 }); // Track where agent started for line breaks
    const [agentSelectionStart, setAgentSelectionStart] = useState<Point | null>(null);
    const [agentSelectionEnd, setAgentSelectionEnd] = useState<Point | null>(null);
    const lastViewOffsetRef = useRef<Point>(viewOffset);

    
    // Agent greetings
    const AGENT_GREETINGS = [
        'hello',
        'hi there',
        'hey',
        'greetings',
        'howdy',
        'sup',
        'yo',
        'hiya',
        'what\'s up',
        'good to see you'
    ];

    // Agent commands - simple commands the agent can execute
    const AGENT_COMMANDS = [
        '/bg chalk',
        '/bg sulfur',
        '/bg garden',
        '/bg white',
        '/text chalk',
        '/text sulfur',
        '/text garden'
    ];
    
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

    // Cache bound keys to avoid filtering on every render
    const boundKeys = useMemo(() => {
        return Object.keys(worldData).filter(k => k.startsWith('bound_'));
    }, [worldData]);

    const getAllBounds = useCallback(() => {
        const bounds: Array<{startX: number, endX: number, startY: number, endY: number, color: string, title?: string}> = [];
        for (const key of boundKeys) {
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
        return bounds;
    }, [worldData, boundKeys]);

    // Tape recording callback setter
    const setTapeRecordingCallback = useCallback((callback: () => Promise<void> | void) => {
        tapeRecordingCallbackRef.current = callback;
    }, []);

    const setScreenshotCallback = useCallback((callback: () => Promise<string | null>) => {
        captureScreenshotCallbackRef.current = callback;
    }, []);

    // === Character Dimensions Calculation ===
    const getEffectiveCharDims = useCallback((zoom: number): { width: number; height: number; fontSize: number } => {
        if (charSizeCacheRef.current[zoom]) {
            return charSizeCacheRef.current[zoom];
        }
        // Simple scaling - adjust as needed
        const effectiveWidth = Math.max(1, Math.round(BASE_CHAR_WIDTH * zoom));
        const effectiveHeight = Math.max(1, Math.round(effectiveWidth * 2.0)); // Perfect 1:2 ratio (width:height)
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

            // Helper function to upload images to Firebase Storage
    const uploadImageToStorage = useCallback(async (dataUrl: string, mimeType: string = 'image/png'): Promise<string> => {
        if (!userUid || !currentStateName) {
            // Fallback to base64 if no storage available
            return dataUrl;
        }

        try {
            // Generate unique filename with correct extension
            const timestamp = Date.now();
            const random = Math.random().toString(36).substring(7);
            const extension = mimeType === 'image/gif' ? 'gif' : 'png';
            const filename = `${timestamp}_${random}.${extension}`;

            // Upload to Firebase Storage
            const imageRef = storageRef(storage, `worlds/${userUid}/${currentStateName}/images/${filename}`);
            await uploadString(imageRef, dataUrl, 'data_url');

            // Get public download URL
            const downloadUrl = await getDownloadURL(imageRef);
            return downloadUrl;
        } catch (error) {
            logger.error('Error uploading to Firebase Storage:', error);
            // Fallback to base64 on error
            return dataUrl;
        }
    }, [userUid, currentStateName]);
    
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
    // Includes support for selected note regions when there's no text selection
    const getNormalizedSelection = useCallback(() => {
        // First check for text selection
        if (selectionStart && selectionEnd) {
            const startX = Math.min(selectionStart.x, selectionEnd.x);
            const startY = Math.min(selectionStart.y, selectionEnd.y);
            const endX = Math.max(selectionStart.x, selectionEnd.x);
            const endY = Math.max(selectionStart.y, selectionEnd.y);
            return { startX, startY, endX, endY };
        }

        // If no text selection, check for selected note region
        if (selectedNoteKey) {
            try {
                const noteData = JSON.parse(worldData[selectedNoteKey] as string);
                if (noteData && noteData.startX !== undefined && noteData.endX !== undefined &&
                    noteData.startY !== undefined && noteData.endY !== undefined) {
                    return {
                        startX: noteData.startX,
                        endX: noteData.endX,
                        startY: noteData.startY,
                        endY: noteData.endY
                    };
                }
            } catch (e) {
                // Invalid note data, return null
            }
        }

        return null;
    }, [selectionStart, selectionEnd, selectedNoteKey, worldData]);

    // Helper function to check if there's an active selection
    const hasActiveSelection = useCallback(() => {
        return selectionStart !== null && selectionEnd !== null;
    }, [selectionStart, selectionEnd]);

    // === Settings System ===
    const { settings, setSettings, updateSettings } = useWorldSettings();

    // Callback to cancel IME composition (for command system)
    const cancelComposition = useCallback(() => {
        if (isComposingRef.current) {
            // Mark that composition was cancelled by mode exit
            compositionCancelledByModeExitRef.current = true;

            setIsComposing(false);
            isComposingRef.current = false;
            setCompositionText('');
            setCompositionStartPos(null);
            compositionStartPosRef.current = null;
            justTypedCharRef.current = false;
            preCompositionCursorPosRef.current = null;
            justCancelledCompositionRef.current = false;
        }
    }, []);

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
        switchMode,
        addEphemeralText,
        addAIResponse,
        addInstantAIResponse,
        lightModeData,
        backgroundMode,
        backgroundColor,
        backgroundImage,
        backgroundVideo,
        backgroundStream,
        switchBackgroundMode,
        textColor,
        fontFamily,
        currentTextStyle,
        searchPattern,
        isSearchActive,
        clearSearch,
        clearLightModeData,
        setLightModeData,
        cameraMode,
        setCameraMode,
        isIndentEnabled,
        isMoveMode,
        exitMoveMode,
        gridMode,
        cycleGridMode,
        artefactsEnabled,
        artifactType,
        isFullscreenMode,
        fullscreenRegion,
        setFullscreenMode,
        exitFullscreenMode,
        restorePreviousBackground,
        executeCommandString,
        startCommand,
        startCommandWithInput,
        addComposedText,
        removeCompositionTrigger,
        isFaceDetectionEnabled,
        faceOrientation,
        setFaceDetectionEnabled,
    } = useCommandSystem({ setDialogueText, initialBackgroundColor, initialTextColor, skipInitialBackground, getAllLabels, getAllBounds, availableStates, username, userUid, membershipLevel, updateSettings, settings, getEffectiveCharDims, zoomLevel, clipboardItems, toggleRecording: tapeRecordingCallbackRef.current || undefined, isReadOnly, getNormalizedSelection, setWorldData, worldData, setSelectionStart, setSelectionEnd, uploadImageToStorage, cancelComposition, triggerUpgradeFlow: () => {
        if (upgradeFlowHandlerRef.current) {
            upgradeFlowHandlerRef.current();
        }
    }, triggerTutorialFlow: () => {
        if (tutorialFlowHandlerRef.current) {
            tutorialFlowHandlerRef.current();
        }
    }, onCommandExecuted: (command: string, args: string[]) => {
        if (commandValidationHandlerRef.current) {
            // Pass worldData plus selection state for validation
            const worldState = {
                worldData,
                selectionStart,
                selectionEnd,
                hasSelection: selectionStart !== null && selectionEnd !== null
            };
            commandValidationHandlerRef.current(command, args, worldState);
        }
    } });

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

    // === Fullscreen Mode Zoom Constraint ===
    useEffect(() => {
        if (isFullscreenMode && fullscreenRegion) {
            // Calculate zoom to fit region width to viewport
            const regionWidth = fullscreenRegion.endX - fullscreenRegion.startX + 1;
            const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 800;

            // Calculate zoom level that fits region width exactly
            const { width: baseCharWidth } = getEffectiveCharDims(1.0);
            const requiredZoom = viewportWidth / (regionWidth * baseCharWidth);

            // Clamp zoom to reasonable bounds (0.1 to 5.0)
            const constrainedZoom = Math.max(0.1, Math.min(5.0, requiredZoom));

            setZoomLevel(constrainedZoom);

            // Center viewport on region
            const centerX = fullscreenRegion.startX + regionWidth / 2;
            const centerY = fullscreenRegion.startY +
                ((fullscreenRegion.endY || fullscreenRegion.startY) - fullscreenRegion.startY) / 2;

            setViewOffset({
                x: centerX - (viewportWidth / (2 * baseCharWidth * constrainedZoom)),
                y: centerY - (window.innerHeight / (2 * baseCharWidth * constrainedZoom))
            });
        }
    }, [isFullscreenMode, fullscreenRegion, getEffectiveCharDims]);

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

        // Skip compilation sync in read-only mode
        if (isReadOnly) return;

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
    }, [worldData, worldId, compileTextStrings, currentStateName, getUserPath, userUid, isReadOnly]);

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

    const renameState = useCallback(async (oldName: string, newName: string): Promise<boolean> => {
        if (!worldId || !userUid) return false;

        try {
            // Read the old state data
            const oldStateRef = ref(database, getUserPath(`${oldName}`));
            const snapshot = await get(oldStateRef);

            if (!snapshot.exists()) {
                logger.error('State does not exist:', oldName);
                return false;
            }

            const stateData = snapshot.val();

            // Write to new state location
            const newStateRef = ref(database, getUserPath(`${newName}`));
            await set(newStateRef, stateData);

            // Delete old state
            await set(oldStateRef, null);

            // If we're renaming the current state, update the current state name
            if (currentStateName === oldName) {
                setCurrentStateName(newName);
            }

            return true;
        } catch (error) {
            logger.error('Error renaming state:', error);
            return false;
        }
    }, [worldId, currentStateName, getUserPath, userUid]);

    const captureScreenshotCallbackRef = useRef<(() => Promise<string | null>) | null>(null);

    const publishState = useCallback(async (stateName: string, isPublic: boolean, captureScreenshot: boolean = true): Promise<boolean> => {
        if (!worldId || !userUid) return false;

        try {
            // Capture screenshot if publishing and callback is available
            if (isPublic && captureScreenshot) {
                if (captureScreenshotCallbackRef.current) {
                    try {
                        const screenshotDataUrl = await captureScreenshotCallbackRef.current();

                        if (screenshotDataUrl) {
                            // TEMPORARY: Store base64 directly in database until Storage CORS is configured
                            // TODO: Switch to Firebase Storage once bucket is ready
                            const screenshotRef = ref(database, getUserPath(`${stateName}/screenshot`));
                            await set(screenshotRef, screenshotDataUrl);
                            logger.debug('Screenshot captured and stored for state:', stateName);
                        }
                    } catch (error) {
                        logger.warn('Failed to capture screenshot:', error);
                        // Continue with publishing even if screenshot fails
                    }
                }
            }

            // Set the public flag at the root level of the state (not in metadata)
            const publicRef = ref(database, getUserPath(`${stateName}/public`));
            await set(publicRef, isPublic);
            return true;
        } catch (error) {
            console.error('❌ Error updating state publish status:', error);
            logger.error('Error updating state publish status:', error);
            return false;
        }
    }, [worldId, getUserPath, userUid]);

    const getStatePublishStatus = useCallback((stateName: string): boolean => {
        // For now, return false as default. This would need to be implemented
        // with actual metadata loading from Firebase
        return false;
    }, []);

    // Load available states on component mount (deferred to not block initial render)
    useEffect(() => {
        if (userUid === undefined) return;

        // Defer loading states until after initial render
        const timeoutId = setTimeout(() => {
            loadAvailableStates().then(states => {
                setAvailableStates(states);
            });
        }, 1000);

        return () => clearTimeout(timeoutId);
    }, [loadAvailableStates, userUid]);
    
    // Load compiled text on mount (deferred to not block initial render)
    useEffect(() => {
        if (!worldId || !userUid) return;

        // Defer loading compiled text until after initial render
        const timeoutId = setTimeout(() => {
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
        }, 1000);

        return () => clearTimeout(timeoutId);
    }, [worldId, currentStateName, getUserPath, userUid]);

    // Track page views for published pages
    useEffect(() => {
        // Only track views for published pages (read-only mode) with valid state
        if (!isReadOnly || !userUid || !currentStateName) return;

        const trackPageView = async () => {
            try {
                const viewsPath = getUserPath(`${currentStateName}/analytics/views`);
                const viewsRef = ref(database, viewsPath);

                // Use transaction to atomically increment the view counter
                await runTransaction(viewsRef, (currentViews) => {
                    return (currentViews || 0) + 1;
                });

                logger.debug('Page view tracked for:', currentStateName);
            } catch (error) {
                // Silently fail if analytics tracking fails (non-critical)
                logger.debug('Failed to track page view:', error);
            }
        };

        trackPageView();
    }, [isReadOnly, userUid, currentStateName, getUserPath]);

    // Initialize new state if it doesn't exist (skip for read-only viewers)
    useEffect(() => {
        if (!currentStateName || !userUid || !worldId) return;

        // Skip initialization check for read-only viewers
        if (isReadOnly) return;

        const checkAndInitializeState = async () => {
            try {
                // Check if state exists
                const stateRef = ref(database, getUserPath(`${currentStateName}`));
                const snapshot = await get(stateRef);

                // If state doesn't exist and we have write permission (we're the owner), initialize it
                if (!snapshot.exists()) {
                    // Only initialize if worldData is empty (fresh state)
                    if (Object.keys(worldData).length === 0) {
                        logger.debug(`Initializing new state: ${currentStateName}`);
                        // Create minimal state structure
                        const initialStateData = {
                            worldData: {},
                            settings: settings,
                            timestamp: Date.now(),
                            cursorPos: { x: 0, y: 0 },
                            viewOffset: { x: 0, y: 0 },
                            zoomLevel: 1
                        };
                        await set(stateRef, initialStateData);
                    }
                }
            } catch (error: any) {
                // Silently skip permission errors (we don't own this state)
                if (error.code !== 'PERMISSION_DENIED' && !error.message?.includes('Permission denied')) {
                    logger.error('Error checking/initializing state:', error);
                }
            }
        };

        checkAndInitializeState();
    }, [currentStateName, userUid, worldId, getUserPath, settings, worldData, isReadOnly]);

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

    

    
    const isPanningRef = useRef(false);
    const clipboardRef = useRef<{ text: string, width: number, height: number } | null>(null);

    // === Persistence ===
    // Only enable world save when userUid is available to prevent permission errors on refresh
    // Special case: allow public worlds
    const shouldEnableWorldSave = worldId && (userUid !== undefined);
    const {
        isLoading: isLoadingWorld,
        isSaving: isSavingWorld,
        error: worldPersistenceError,
        clearWorldData,
        fetchReplayLog
    } = useWorldSave(
        shouldEnableWorldSave ? worldId : null,
        worldData,
        setWorldData,
        settings,
        setSettings,
        true,
        currentStateName,
        userUid,
        isReadOnly, // Pass read-only flag to prevent write attempts
        clipboardItems, // Clipboard items
        setClipboardItems // Clipboard setter
    ); // Only enable when userUid is available

    // === Multiplayer Cursor Sync ===
    const lastCursorUpdateRef = useRef<number>(0);
    const cursorUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const CURSOR_UPDATE_THROTTLE = 100; // Update every 100ms max
    const CURSOR_STALE_TIMEOUT = 10000; // Remove cursors not updated in 10 seconds

    // Send cursor position to Firebase (throttled)
    useEffect(() => {
        if (!userUid || !username || isReadOnly || !worldId) return;
        // Only sync cursors for public worlds (userUid === 'public')
        if (userUid !== 'public') return;

        const now = Date.now();
        const timeSinceLastUpdate = now - lastCursorUpdateRef.current;

        // Clear any pending update
        if (cursorUpdateTimeoutRef.current) {
            clearTimeout(cursorUpdateTimeoutRef.current);
        }

        // Throttle updates
        const delay = Math.max(0, CURSOR_UPDATE_THROTTLE - timeSinceLastUpdate);

        cursorUpdateTimeoutRef.current = setTimeout(async () => {
            try {
                // Use the authenticated user's UID for cursor tracking
                const currentUser = auth.currentUser;
                if (!currentUser) return;

                const cursorPath = `worlds/${userUid}/${worldId}/cursors/${currentUser.uid}`;
                const cursorRef = ref(database, cursorPath);
                await set(cursorRef, {
                    x: cursorPos.x,
                    y: cursorPos.y,
                    username,
                    color: textColor || '#FF69B4',
                    lastUpdate: serverTimestamp()
                });
                lastCursorUpdateRef.current = Date.now();
            } catch (error) {
                // Silently fail - cursor sync is non-critical
                logger.debug('Failed to update cursor position:', error);
            }
        }, delay);

        return () => {
            if (cursorUpdateTimeoutRef.current) {
                clearTimeout(cursorUpdateTimeoutRef.current);
            }
        };
    }, [cursorPos.x, cursorPos.y, userUid, username, worldId, isReadOnly, textColor]);

    // Listen to other users' cursors
    useEffect(() => {
        if (!worldId || !userUid || userUid !== 'public') return;

        const cursorsPath = `worlds/${userUid}/${worldId}/cursors`;
        const cursorsRef = ref(database, cursorsPath);
        
        const unsubscribe = onValue(cursorsRef, (snapshot) => {
            const cursorsData = snapshot.val() || {};
            const now = Date.now();
            const currentUser = auth.currentUser;
            
            const cursors: MultiplayerCursor[] = Object.entries(cursorsData)
                .filter(([uid]) => uid !== currentUser?.uid) // Exclude own cursor
                .map(([uid, data]: [string, any]) => ({
                    uid,
                    username: data.username || 'Anonymous',
                    x: data.x || 0,
                    y: data.y || 0,
                    color: data.color || '#FF69B4',
                    lastUpdate: data.lastUpdate || now
                }))
                .filter(cursor => {
                    // Filter out stale cursors
                    const age = now - cursor.lastUpdate;
                    return age < CURSOR_STALE_TIMEOUT;
                });

            setMultiplayerCursors(cursors);
        }, (error) => {
            logger.debug('Failed to listen to cursors:', error);
        });

        return () => {
            unsubscribe();
        };
    }, [worldId, userUid]);

    // Cleanup own cursor on unmount
    useEffect(() => {
        return () => {
            if (!worldId || !userUid || isReadOnly || userUid !== 'public') return;
            const currentUser = auth.currentUser;
            if (!currentUser) return;

            const cursorPath = `worlds/${userUid}/${worldId}/cursors/${currentUser.uid}`;
            const cursorRef = ref(database, cursorPath);
            set(cursorRef, null).catch(() => {});
        };
    }, [userUid, worldId, isReadOnly]);

    // === Apply spawn point or URL coordinates when settings load ===
    useEffect(() => {
        // Only apply once when settings first load
        if (!hasAppliedSpawnRef.current && !isLoadingWorld) {
            // Priority 1: URL coordinates (highest priority)
            if (initialViewOffset && initialViewOffset.x !== 0 && initialViewOffset.y !== 0) {
                const targetX = initialViewOffset.x;
                const targetY = initialViewOffset.y;

                // Get effective character dimensions
                const { width: effectiveCharWidth, height: effectiveCharHeight } = getEffectiveCharDims(initialZoomLevel || zoomLevel);

                if (effectiveCharWidth > 0 && effectiveCharHeight > 0 && typeof window !== 'undefined') {
                    const viewportWidth = window.innerWidth;
                    const viewportHeight = window.innerHeight;

                    // Calculate how many characters fit in viewport
                    const charsInViewportWidth = viewportWidth / effectiveCharWidth;
                    const charsInViewportHeight = viewportHeight / effectiveCharHeight;

                    // Center target coordinates by offsetting half the viewport
                    const centeredOffsetX = targetX - (charsInViewportWidth / 2);
                    const centeredOffsetY = targetY - (charsInViewportHeight / 2);

                    setCursorPos({ x: targetX, y: targetY });
                    setViewOffset({ x: centeredOffsetX, y: centeredOffsetY });

                    // Apply URL zoom if provided
                    if (initialZoomLevel) {
                        setZoomLevel(initialZoomLevel);
                    }
                } else {
                    // Fallback if dimensions aren't available
                    setCursorPos({ x: targetX, y: targetY });
                    setViewOffset({ x: targetX, y: targetY });
                    if (initialZoomLevel) {
                        setZoomLevel(initialZoomLevel);
                    }
                }

                hasAppliedSpawnRef.current = true;
            }
            // Priority 2: Spawn point from settings
            else if (settings.spawnPoint) {
                const spawnX = settings.spawnPoint.x;
                const spawnY = settings.spawnPoint.y;

                // Center the spawn point in viewport by calculating offset
                // Get effective character dimensions
                const { width: effectiveCharWidth, height: effectiveCharHeight } = getEffectiveCharDims(zoomLevel);

                if (effectiveCharWidth > 0 && effectiveCharHeight > 0 && typeof window !== 'undefined') {
                    const viewportWidth = window.innerWidth;
                    const viewportHeight = window.innerHeight;

                    // Calculate how many characters fit in viewport
                    const charsInViewportWidth = viewportWidth / effectiveCharWidth;
                    const charsInViewportHeight = viewportHeight / effectiveCharHeight;

                    // Center spawn point by offsetting half the viewport
                    const centeredOffsetX = spawnX - (charsInViewportWidth / 2);
                    const centeredOffsetY = spawnY - (charsInViewportHeight / 2);

                    setCursorPos({ x: spawnX, y: spawnY });
                    setViewOffset({ x: centeredOffsetX, y: centeredOffsetY });
                } else {
                    // Fallback if dimensions aren't available
                    setCursorPos({ x: spawnX, y: spawnY });
                    setViewOffset({ x: spawnX, y: spawnY });
                }

                hasAppliedSpawnRef.current = true;
            }
        }
    }, [settings.spawnPoint, isLoadingWorld, zoomLevel, initialViewOffset, initialZoomLevel, getEffectiveCharDims]);

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

    const findTaskAt = useCallback((x: number, y: number): { key: string, data: any } | null => {
        for (const key in worldData) {
            if (key.startsWith('task_')) {
                try {
                    const taskData = JSON.parse(worldData[key] as string);
                    const { startX, endX, startY, endY } = taskData;

                    // Check if the cursor position is within the task bounds
                    if (x >= startX && x <= endX && y >= startY && y <= endY) {
                        return { key, data: taskData };
                    }
                } catch (e) {
                    // Ignore parsing errors
                }
            }
        }
        return null;
    }, [worldData]);

    const findLinkAt = useCallback((x: number, y: number): { key: string, data: any } | null => {
        for (const key in worldData) {
            if (key.startsWith('link_')) {
                try {
                    const linkData = JSON.parse(worldData[key] as string);
                    const { startX, endX, startY, endY } = linkData;

                    // Check if the cursor position is within the link bounds
                    if (x >= startX && x <= endX && y >= startY && y <= endY) {
                        return { key, data: linkData };
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

    // === Camera Tracking ===
    const updateCameraTracking = useCallback((nextCursorPos: Point) => {
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
    }, [cameraMode, viewOffset, zoomLevel, getEffectiveCharDims]);

    // Track cursor position changes for camera updates in chat/command modes
    const prevCursorPosRef = useRef<Point>(cursorPos);
    const prevCommandStateActiveRef = useRef<boolean>(commandState.isActive);
    useEffect(() => {
        // Only update camera if cursor actually moved
        if (prevCursorPosRef.current.x !== cursorPos.x || prevCursorPosRef.current.y !== cursorPos.y) {
            // Update camera if in chat or command mode
            // BUT: Don't update if we just exited command mode (prevents viewport jump when command completes)
            const justExitedCommandMode = prevCommandStateActiveRef.current && !commandState.isActive;
            if ((chatMode.isActive || commandState.isActive) && !justExitedCommandMode) {
                updateCameraTracking(cursorPos);
            }
            prevCursorPosRef.current = cursorPos;
        }
        prevCommandStateActiveRef.current = commandState.isActive;
    }, [cursorPos, chatMode.isActive, commandState.isActive, updateCameraTracking]);

    // === Agent Behavior System ===
    useEffect(() => {
        if (!agentEnabled) return;

        const agentInterval = setInterval(() => {
            setAgentIdleTimer(prev => {
                const newTimer = prev + 1;

                // If moving toward target (viewport relocation), take one step
                if (agentState === 'moving' && agentTargetPos) {
                    // Clear any active selection when starting to move
                    if (agentSelectionStart || agentSelectionEnd) {
                        setAgentSelectionStart(null);
                        setAgentSelectionEnd(null);
                    }

                    setAgentPos(prevPos => {
                        const dx = agentTargetPos.x - prevPos.x;
                        const dy = agentTargetPos.y - prevPos.y;

                        // If reached target, stop moving
                        if (dx === 0 && dy === 0) {
                            setAgentState('idle');
                            setAgentTargetPos(null);
                            return prevPos;
                        }

                        // Move one step toward target (prioritize horizontal or vertical based on distance)
                        const stepX = dx !== 0 ? (dx > 0 ? 1 : -1) : 0;
                        const stepY = dy !== 0 ? (dy > 0 ? 1 : -1) : 0;

                        // Move in one direction at a time (alternate between x and y)
                        if (Math.abs(dx) >= Math.abs(dy)) {
                            return { x: prevPos.x + stepX, y: prevPos.y };
                        } else {
                            return { x: prevPos.x, y: prevPos.y + stepY };
                        }
                    });
                }

                // Random walking when idle (10% chance each tick to start walking)
                if (agentState === 'idle' && Math.random() < 0.1) {
                    // Clear any active selection when starting to walk
                    if (agentSelectionStart || agentSelectionEnd) {
                        setAgentSelectionStart(null);
                        setAgentSelectionEnd(null);
                    }
                    setAgentState('walking');
                    return 0;
                }

                // If walking, take a step
                if (agentState === 'walking') {
                    setAgentPos(prevPos => {
                        // Random walk: choose random direction
                        const directions = [
                            { x: 1, y: 0 },   // right
                            { x: -1, y: 0 },  // left
                            { x: 0, y: 1 },   // down
                            { x: 0, y: -1 },  // up
                        ];
                        const dir = directions[Math.floor(Math.random() * directions.length)];
                        return { x: prevPos.x + dir.x, y: prevPos.y + dir.y };
                    });

                    // After 3-5 steps, go back to idle
                    if (newTimer > Math.random() * 2 + 3) {
                        setAgentState('idle');
                        return 0;
                    }
                }

                // Random chance to say a greeting while idle (1% chance each tick)
                if (agentState === 'idle' && Math.random() < 0.01) {
                    // Clear any active selection when starting to type
                    if (agentSelectionStart || agentSelectionEnd) {
                        setAgentSelectionStart(null);
                        setAgentSelectionEnd(null);
                    }

                    const greeting = AGENT_GREETINGS[Math.floor(Math.random() * AGENT_GREETINGS.length)];

                    // Set to typing state to disable repositioning and walking during typing
                    setAgentState('typing');

                    // Type out greeting character by character with cursor trail
                    let charIndex = 0;
                    // Start typing 2 spaces to the right of current position
                    const startPos = { x: agentPos.x + 2, y: agentPos.y };

                    const typeInterval = setInterval(() => {
                        if (charIndex < greeting.length) {
                            const char = greeting[charIndex];
                            const charPos = { x: startPos.x + charIndex, y: startPos.y };

                            // Place permanent character with pink bg and white text
                            const styledChar: StyledCharacter = {
                                char,
                                style: {
                                    color: '#FFFFFF',
                                    background: '#FF69B4'
                                }
                            };
                            const key = `${charPos.x},${charPos.y}`;
                            setWorldData(prev => ({ ...prev, [key]: styledChar }));

                            charIndex++;

                            // Move agent cursor to position after the character (like normal typing)
                            setAgentPos({ x: startPos.x + charIndex, y: startPos.y });
                        } else {
                            // Done typing, go back to idle
                            clearInterval(typeInterval);
                            setAgentState('idle');
                        }
                    }, 100);
                }

                // Random chance to execute a command while idle (3% chance each tick)
                if (agentState === 'idle' && Math.random() < 0.03) {
                    // Clear any active selection when starting to type command
                    if (agentSelectionStart || agentSelectionEnd) {
                        setAgentSelectionStart(null);
                        setAgentSelectionEnd(null);
                    }

                    const command = AGENT_COMMANDS[Math.floor(Math.random() * AGENT_COMMANDS.length)];

                    // Set to typing state
                    setAgentState('typing');

                    // Type out command character by character
                    let charIndex = 0;
                    const startPos = { x: agentPos.x + 2, y: agentPos.y };

                    const typeInterval = setInterval(() => {
                        if (charIndex < command.length) {
                            const char = command[charIndex];
                            const charPos = { x: startPos.x + charIndex, y: startPos.y };

                            // Place permanent character with pink bg and white text
                            const styledChar: StyledCharacter = {
                                char,
                                style: {
                                    color: '#FFFFFF',
                                    background: '#FF69B4'
                                }
                            };
                            const key = `${charPos.x},${charPos.y}`;
                            setWorldData(prev => ({ ...prev, [key]: styledChar }));

                            charIndex++;
                            setAgentPos({ x: startPos.x + charIndex, y: startPos.y });
                        } else {
                            // Done typing, execute the command
                            clearInterval(typeInterval);

                            // Parse and execute command
                            const parts = command.trim().substring(1).split(' '); // Remove '/' and split
                            const cmd = parts[0];
                            const args = parts.slice(1);

                            if (cmd === 'bg' && args.length > 0) {
                                switchBackgroundMode('color', args[0]);
                            } else if (cmd === 'text' && args.length > 0) {
                                const colorValue = COLOR_MAP[args[0]] || args[0];
                                if (updateSettings) {
                                    updateSettings({ textColor: colorValue });
                                }
                            }

                            setAgentState('idle');
                        }
                    }, 100);
                }

                // Random chance to start selecting a region while idle (8% chance)
                if (agentState === 'idle' && Math.random() < 0.08) {
                    // Pick a small rectangular region to select
                    const width = Math.floor(Math.random() * 20) + 10; // 10-30 cells wide
                    const height = Math.floor(Math.random() * 10) + 5; // 5-15 cells tall

                    const selStart = { x: agentPos.x, y: agentPos.y };
                    const selEnd = { x: agentPos.x + width, y: agentPos.y + height };

                    // Make selection instant - no gradual expansion
                    setAgentSelectionStart(selStart);
                    setAgentSelectionEnd(selEnd);
                    setAgentState('selecting');

                    return 0; // Reset timer for hold period
                }

                // If selecting, just hold the selection then clear
                if (agentState === 'selecting') {
                    if (newTimer > 10) { // Hold for 1 second
                        setAgentSelectionStart(null);
                        setAgentSelectionEnd(null);
                        setAgentState('idle');
                        return 0;
                    }
                    return newTimer; // Continue incrementing during hold
                }

                return newTimer;
            });
        }, 100); // Tick every 100ms for smooth movement

        return () => clearInterval(agentInterval);
    }, [agentEnabled, agentState, agentPos, agentTargetPos, switchBackgroundMode, updateSettings, setWorldData]);

    // Agent follows viewport when panning
    useEffect(() => {
        if (!agentEnabled) return;

        const viewOffsetDiff = {
            x: Math.abs(viewOffset.x - lastViewOffsetRef.current.x),
            y: Math.abs(viewOffset.y - lastViewOffsetRef.current.y)
        };

        // If viewport has moved significantly (panning occurred)
        if (viewOffsetDiff.x > 1 || viewOffsetDiff.y > 1) {
            // Update the last known viewport position
            lastViewOffsetRef.current = { ...viewOffset };

            // Don't move agent if it's currently typing
            if (agentState === 'typing') return;

            // Check if agent is off-screen
            const centerPos = getViewportCenter();
            const { width: effectiveCharWidth, height: effectiveCharHeight } = getEffectiveCharDims(zoomLevel);

            // Calculate viewport dimensions in world coordinates
            const viewportWidth = window.innerWidth / effectiveCharWidth;
            const viewportHeight = window.innerHeight / effectiveCharHeight;

            // Calculate viewport bounds
            const viewportLeft = centerPos.x - viewportWidth / 2;
            const viewportRight = centerPos.x + viewportWidth / 2;
            const viewportTop = centerPos.y - viewportHeight / 2;
            const viewportBottom = centerPos.y + viewportHeight / 2;

            // Check if agent is off-screen
            const isOffScreen = agentPos.x < viewportLeft || agentPos.x > viewportRight ||
                                agentPos.y < viewportTop || agentPos.y > viewportBottom;

            // Only relocate if agent is off-screen
            if (isOffScreen) {
                // Use smaller dimension to ensure agent stays in visible region
                const maxRadius = Math.min(viewportWidth, viewportHeight) / 2.5; // Stay within ~40% of viewport

                // Random angle and distance using polar coordinates
                const angle = Math.random() * Math.PI * 2; // 0 to 2π
                const distance = Math.random() * maxRadius;

                // Convert polar to cartesian and add to center
                const newTargetPos = {
                    x: Math.round(centerPos.x + distance * Math.cos(angle)),
                    y: Math.round(centerPos.y + distance * Math.sin(angle))
                };

                // Set target and start moving
                setAgentTargetPos(newTargetPos);
                setAgentState('moving');
            }
        }
    }, [agentEnabled, viewOffset, agentState, agentPos, getViewportCenter, getEffectiveCharDims, zoomLevel]);

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

    const getNoteRegion = useCallback((worldData: WorldData, cursorPos: Point): { startX: number; endX: number; startY: number; endY: number } | null => {
        // Check if cursor is within any note region
        const cursorX = cursorPos.x;
        const cursorY = cursorPos.y;

        // Look through all note_ entries
        for (const key in worldData) {
            if (key.startsWith('note_')) {
                try {
                    const noteData = JSON.parse(worldData[key] as string);

                    // Check if cursor is within this note region
                    if (cursorX >= noteData.startX && cursorX <= noteData.endX &&
                        cursorY >= noteData.startY && cursorY <= noteData.endY) {

                        return {
                            startX: noteData.startX,
                            endX: noteData.endX,
                            startY: noteData.startY,
                            endY: noteData.endY
                        };
                    }
                } catch (e) {
                    // Skip invalid note data
                }
            }
        }

        return null;
    }, []);

    const getMailRegion = useCallback((worldData: WorldData, cursorPos: Point): { startX: number; endX: number; startY: number; endY: number } | null => {
        // Check if cursor is within any mail region
        const cursorX = cursorPos.x;
        const cursorY = cursorPos.y;

        // Look through all mail_ entries
        for (const key in worldData) {
            if (key.startsWith('mail_')) {
                try {
                    const mailData = JSON.parse(worldData[key] as string);

                    // Check if cursor is within this mail region
                    if (cursorX >= mailData.startX && cursorX <= mailData.endX &&
                        cursorY >= mailData.startY && cursorY <= mailData.endY) {

                        return {
                            startX: mailData.startX,
                            endX: mailData.endX,
                            startY: mailData.startY,
                            endY: mailData.endY
                        };
                    }
                } catch (e) {
                    // Skip invalid mail data
                }
            }
        }

        return null;
    }, []);

    // === List Detection ===
    const findListAt = useCallback((x: number, y: number): { key: string; data: ListData } | null => {
        for (const key in worldData) {
            if (key.startsWith('list_')) {
                try {
                    const listData = JSON.parse(worldData[key] as string) as ListData;
                    const { startX, endX, startY, visibleHeight } = listData;

                    // Check if position is within list viewport (no title bar)
                    if (x >= startX && x <= endX &&
                        y >= startY && y < startY + visibleHeight) {
                        return { key, data: listData };
                    }
                } catch (e) {
                    // Skip invalid list data
                }
            }
        }
        return null;
    }, [worldData]);

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

        // Find and delete tasks intersecting with selection
        const tasksToDelete = new Set<string>();
        for (const key in newWorldData) {
            if (key.startsWith('task_')) {
                try {
                    const taskData = JSON.parse(newWorldData[key] as string);
                    const { startX, endX, startY, endY } = taskData;

                    // Check for intersection between task bounds and selection bounds
                    if (startX <= selection.endX && endX >= selection.startX &&
                        startY <= selection.endY && endY >= selection.startY) {
                        tasksToDelete.add(key);
                    }
                } catch (e) {
                    // ignore
                }
            }
        }

        if (tasksToDelete.size > 0) {
            deleted = true;
            tasksToDelete.forEach(key => {
                delete newWorldData[key];
            });
        }

        // Find and delete links intersecting with selection
        const linksToDelete = new Set<string>();
        for (const key in newWorldData) {
            if (key.startsWith('link_')) {
                try {
                    const linkData = JSON.parse(newWorldData[key] as string);
                    const { startX, endX, startY, endY } = linkData;

                    // Check for intersection between link bounds and selection bounds
                    if (startX <= selection.endX && endX >= selection.startX &&
                        startY <= selection.endY && endY >= selection.startY) {
                        linksToDelete.add(key);
                    }
                } catch (e) {
                    // ignore
                }
            }
        }

        if (linksToDelete.size > 0) {
            deleted = true;
            linksToDelete.forEach(key => {
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

    // Word wrap helper: wraps text to fit within maxWidth, preserving paragraph breaks
    const wordWrap = useCallback((text: string, maxWidth: number): string[] => {
        const lines: string[] = [];
        const paragraphs = text.split('\n');

        for (const paragraph of paragraphs) {
            if (paragraph.length === 0) {
                lines.push('');
                continue;
            }

            const words = paragraph.split(' ');
            let currentLine = '';

            for (const word of words) {
                if (currentLine.length === 0) {
                    // First word on the line
                    if (word.length > maxWidth) {
                        // Word is too long, break it
                        let remaining = word;
                        while (remaining.length > 0) {
                            lines.push(remaining.substring(0, maxWidth));
                            remaining = remaining.substring(maxWidth);
                        }
                    } else {
                        currentLine = word;
                    }
                } else {
                    // Check if adding this word (with space) would exceed width
                    if (currentLine.length + 1 + word.length <= maxWidth) {
                        currentLine += ' ' + word;
                    } else {
                        // Push current line and start new one
                        lines.push(currentLine);
                        if (word.length > maxWidth) {
                            // Word is too long, break it
                            let remaining = word;
                            while (remaining.length > maxWidth) {
                                lines.push(remaining.substring(0, maxWidth));
                                remaining = remaining.substring(maxWidth);
                            }
                            currentLine = remaining;
                        } else {
                            currentLine = word;
                        }
                    }
                }
            }

            // Push remaining line
            if (currentLine.length > 0) {
                lines.push(currentLine);
            }
        }

        return lines;
    }, []);

    // Define pasteText BEFORE handleKeyDown uses it
    const pasteText = useCallback(async (): Promise<boolean> => {
        try {
            // First, try to read image from clipboard if there's a selection
            const selection = getNormalizedSelection();

            if (selection) {
                try {
                    const clipboardItems = await navigator.clipboard.read();
                    for (const item of clipboardItems) {
                        // Check for image types
                        const imageType = item.types.find(type => type.startsWith('image/'));
                        if (imageType) {
                            const blob = await item.getType(imageType);

                            // Convert blob to data URL
                            const reader = new FileReader();
                            const imageDataUrl = await new Promise<string>((resolve, reject) => {
                                reader.onload = () => resolve(reader.result as string);
                                reader.onerror = reject;
                                reader.readAsDataURL(blob);
                            });

                            // Upload to storage if available
                            let finalImageUrl = imageDataUrl;
                            if (uploadImageToStorage) {
                                try {
                                    finalImageUrl = await uploadImageToStorage(imageDataUrl);
                                } catch (error) {
                                    logger.error('Failed to upload pasted image:', error);
                                }
                            }

                            // Get selection bounds
                            const minX = selection.startX;
                            const maxX = selection.endX;
                            const minY = selection.startY;
                            const maxY = selection.endY;

                            // Load image to get dimensions
                            const img = new Image();
                            img.onload = () => {
                                const { width: charWidth, height: charHeight } = getEffectiveCharDims(zoomLevel);

                                const selectionCellsWide = maxX - minX + 1;
                                const selectionCellsHigh = maxY - minY + 1;
                                const selectionPixelsWide = selectionCellsWide * charWidth;
                                const selectionPixelsHigh = selectionCellsHigh * charHeight;

                                const imageAspect = img.width / img.height;
                                const selectionAspect = selectionPixelsWide / selectionPixelsHigh;

                                let scaledWidth, scaledHeight;
                                if (imageAspect > selectionAspect) {
                                    scaledWidth = selectionPixelsWide;
                                    scaledHeight = selectionPixelsWide / imageAspect;
                                } else {
                                    scaledHeight = selectionPixelsHigh;
                                    scaledWidth = selectionPixelsHigh * imageAspect;
                                }

                                const cellsWide = Math.ceil(scaledWidth / charWidth);
                                const cellsHigh = Math.ceil(scaledHeight / charHeight);

                                // Clear selection area and place image
                                const newWorldData = { ...worldData };

                                // Clear the selection
                                for (let y = minY; y <= maxY; y++) {
                                    for (let x = minX; x <= maxX; x++) {
                                        delete newWorldData[`${x},${y}`];
                                    }
                                }

                                // Add image
                                (newWorldData[`image_${Date.now()}`] as any) = {
                                    type: 'image',
                                    src: finalImageUrl,
                                    startX: minX,
                                    startY: minY,
                                    endX: minX + cellsWide - 1,
                                    endY: minY + cellsHigh - 1,
                                    width: img.width,
                                    height: img.height,
                                    timestamp: Date.now()
                                };

                                setWorldData(newWorldData);
                                setSelectionStart(null);
                                setSelectionEnd(null);
                                setDialogueWithRevert("Image pasted", setDialogueText);
                            };
                            img.src = imageDataUrl;

                            return true;
                        }
                    }
                } catch (err) {
                    // No image in clipboard or error reading, fall through to text paste
                    logger.debug('No image in clipboard, trying text:', err);
                }
            }

            // Fall back to text paste
            const clipText = await navigator.clipboard.readText();

            const pasteStartX = selection ? selection.startX : cursorPos.x;
            const pasteStartY = selection ? selection.startY : cursorPos.y;

            let linesToPaste: string[];

            // If there's a selection with width > 1, word wrap to fit within the box width
            if (selection) {
                const boxWidth = selection.endX - selection.startX + 1;
                const boxHeight = selection.endY - selection.startY + 1;

                // Only word wrap if it's a multi-cell selection (not a single cell)
                if (boxWidth > 1 || boxHeight > 1) {
                    linesToPaste = wordWrap(clipText, boxWidth);
                } else {
                    linesToPaste = clipText.split('\n');
                }
            } else {
                linesToPaste = clipText.split('\n');
            }

            const finalCursorX = pasteStartX + (linesToPaste[linesToPaste.length - 1]?.length || 0);
            const finalCursorY = pasteStartY + linesToPaste.length - 1;

            // Build complete paste data in one pass (no chunking to avoid hundreds of re-renders)
            const worldUpdate: WorldData = {};
            for (let i = 0; i < linesToPaste.length; i++) {
                const line = linesToPaste[i];
                for (let j = 0; j < line.length; j++) {
                    worldUpdate[`${pasteStartX + j},${pasteStartY + i}`] = line[j];
                }
            }

            // Single atomic update: delete selection + paste text
            setWorldData(prev => {
                const updated = { ...prev };

                // Delete selection area
                if (selection) {
                    for (let y = selection.startY; y <= selection.endY; y++) {
                        for (let x = selection.startX; x <= selection.endX; x++) {
                            delete updated[`${x},${y}`];
                        }
                    }
                }

                // Apply paste
                return { ...updated, ...worldUpdate };
            });

            // Update cursor and clear selection after state update
            setCursorPos({ x: finalCursorX, y: finalCursorY });
            setSelectionStart(null);
            setSelectionEnd(null);

            // Auto-detect URLs in pasted text and create links
            // Check if pasted text is a single line URL
            if (linesToPaste.length === 1) {
                const pastedText = linesToPaste[0].trim();
                const urlRegex = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/[^\s]*)?$/;

                if (urlRegex.test(pastedText)) {
                    // Auto-create link for single-line URL paste
                    let validUrl = pastedText;
                    if (!pastedText.match(/^https?:\/\//i)) {
                        validUrl = 'https://' + pastedText;
                    }

                    const linkKey = `link_${pasteStartX},${pasteStartY}_${Date.now()}`;
                    const linkData = {
                        startX: pasteStartX,
                        endX: finalCursorX - 1,
                        startY: pasteStartY,
                        endY: finalCursorY,
                        url: validUrl,
                        timestamp: Date.now()
                    };

                    // Add link data after a short delay to ensure paste is rendered
                    setTimeout(() => {
                        setWorldData(prev => ({
                            ...prev,
                            [linkKey]: JSON.stringify(linkData)
                        }));
                    }, 50);
                }
            }

            return true;
        } catch (err) {
            logger.warn('Could not read from system clipboard or paste failed:', err);
            return false;
        }
    }, [worldData, cursorPos, getNormalizedSelection, wordWrap, uploadImageToStorage, getEffectiveCharDims, zoomLevel, setDialogueWithRevert, setSelectionStart, setSelectionEnd]);

    // Now define cutSelection, which depends on the above
    const cutSelection = useCallback(() => {
        if (copySelectedCharacters()) { // Now defined above
            return deleteSelectedCharacters(); // Now defined above
        }
        return false;
    }, [copySelectedCharacters, deleteSelectedCharacters]); // Dependencies are correct

    // === Event Handlers ===

    // Helper to clear autocomplete suggestions - call this on ANY interaction
    const clearAutocompleteSuggestions = useCallback(() => {
        setCurrentSuggestion('');
        setSuggestionData({});
        setCurrentSuggestions([]);
        setCurrentSuggestionIndex(0);
        currentSuggestionRef.current = ''; // Also clear the ref
    }, []);

    const handleKeyDown = useCallback(async (key: string, ctrlKey: boolean, metaKey: boolean, shiftKey: boolean, altKey: boolean = false): Promise<boolean> => {
        // Clear autocomplete on ANY key press (except Tab which handles suggestions)
        if (key !== 'Tab') {
            clearAutocompleteSuggestions();
        }

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

        // === Read-Only Mode: Block writes on mobile, allow ephemeral typing on desktop ===
        // Exception: Allow input when host mode is active (for signup/login flows)
        const isMobile = typeof window !== 'undefined' && 'ontouchstart' in window;

        if (isReadOnly && !hostMode.isActive) {
            // On mobile: block all typing (pan only)
            if (isMobile) {
                const allowedKeys = [
                    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
                    'PageUp', 'PageDown', 'Home', 'End',
                    'Escape', 'Tab'
                ];

                // Allow pan shortcuts (Ctrl/Cmd + arrows)
                if (isMod && (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight')) {
                    return false; // Let pan handler process it
                }

                // Block everything except allowed navigation
                if (!allowedKeys.includes(key)) {
                    return true; // Block and prevent default
                }
            }
            // On desktop: allow typing but make it ephemeral (handled below)
            // Allow commands in read-only mode - we'll gate specific commands later
        }

        // === LaTeX Mode Exit ===
        if (key === 'Escape' && latexMode.isActive) {
            setLatexMode({
                isActive: false,
                currentInput: '',
                inputPositions: [],
                startPos: { x: 0, y: 0 },
                previewImage: null
            });
            setLatexData({});
            setDialogueWithRevert("LaTeX mode canceled", setDialogueText);
            return true;
        }

        // === LaTeX Mode Backspace ===
        if (key === 'Backspace' && latexMode.isActive && latexMode.currentInput.length > 0) {
            const lastPos = latexMode.inputPositions[latexMode.inputPositions.length - 1];
            if (lastPos) {
                // Remove last character from latexData
                setLatexData(prev => {
                    const updated = { ...prev };
                    delete updated[`${lastPos.x},${lastPos.y}`];
                    return updated;
                });

                // Update latexMode state
                setLatexMode(prev => ({
                    ...prev,
                    currentInput: prev.currentInput.slice(0, -1),
                    inputPositions: prev.inputPositions.slice(0, -1)
                }));

                // Move cursor back
                setCursorPos(lastPos);
            }
            return true;
        }

        // === SMILES Mode Exit ===
        if (key === 'Escape' && smilesMode.isActive) {
            setSmilesMode({
                isActive: false,
                currentInput: '',
                inputPositions: [],
                startPos: { x: 0, y: 0 },
                previewImage: null
            });
            setSmilesData({});
            setDialogueWithRevert("SMILES mode canceled", setDialogueText);
            return true;
        }

        // === SMILES Mode Backspace ===
        if (key === 'Backspace' && smilesMode.isActive && smilesMode.currentInput.length > 0) {
            const lastPos = smilesMode.inputPositions[smilesMode.inputPositions.length - 1];
            if (lastPos) {
                // Remove last character from smilesData
                setSmilesData(prev => {
                    const updated = { ...prev };
                    delete updated[`${lastPos.x},${lastPos.y}`];
                    return updated;
                });

                // Update smilesMode state
                setSmilesMode(prev => ({
                    ...prev,
                    currentInput: prev.currentInput.slice(0, -1),
                    inputPositions: prev.inputPositions.slice(0, -1)
                }));

                // Move cursor back
                setCursorPos(lastPos);
            }
            return true;
        }

        // === Chat Mode Exit ===
        // Don't allow ESC out of chat mode if in host mode (authentication) or read-only
        if (key === 'Escape' && chatMode.isActive && !hostMode.isActive && !isReadOnly) {
            // Cancel any active composition before exiting
            if (isComposingRef.current) {
                compositionCancelledByModeExitRef.current = true;
                setIsComposing(false);
                isComposingRef.current = false;
                setCompositionText('');
                setCompositionStartPos(null);
                compositionStartPosRef.current = null;
                justTypedCharRef.current = false;
                preCompositionCursorPosRef.current = null;
                justCancelledCompositionRef.current = false;
            }

            setChatMode({
                isActive: false,
                currentInput: '',
                inputPositions: [],
                isProcessing: false
            });
            setChatData({});
            setDialogueWithRevert("Chat mode canceled", setDialogueText);
            return true;
        }

        // === Note Mode Exit/Cancel ===
        if (key === 'Escape' && currentMode === 'note') {
            // Check if there's a meaningful selection (not just cursor preview)
            const hasMeaningfulSelection = selectionStart && selectionEnd &&
                (selectionStart.x !== selectionEnd.x || selectionStart.y !== selectionEnd.y);

            if (hasMeaningfulSelection) {
                // Cancel the selection
                setSelectionStart(null);
                setSelectionEnd(null);
                setDialogueWithRevert("Selection canceled", setDialogueText);
                return true;
            }

            // Exit note mode back to default
            setSelectionStart(null);
            setSelectionEnd(null);
            switchMode('default');
            setDialogueWithRevert("Note mode exited", setDialogueText);
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

        // === Fullscreen Mode Exit ===
        if (key === 'Escape' && isFullscreenMode) {
            exitFullscreenMode();
            setDialogueWithRevert("Exited fullscreen mode", setDialogueText);
            return true;
        }

        // === Staged Artifact Clearing ===
        if (key === 'Escape' && (stagedImageData.length > 0 || Object.keys(lightModeData).length > 0)) {
            setStagedImageData([]);
            clearLightModeData();
            setDialogueWithRevert("Staged artifact cleared", setDialogueText);
            return true;
        }

        // === Command Handling (Early Priority) ===
        if (enableCommands) {
            // Set justTypedCharRef for command mode character input (for IME composition)
            if (commandState.isActive && key.length === 1 && !isMod && key !== ' ' && !isComposingRef.current) {
                justTypedCharRef.current = true;
            }

            const commandResult = await handleCommandKeyDown(key, cursorPos, setCursorPos, ctrlKey, metaKey, shiftKey, altKey, isComposingRef.current);
            if (commandResult && typeof commandResult === 'object') {
                // It's a command execution object - handle it
                const exec = commandResult as CommandExecution;

                // In read-only mode, only allow signin and share commands
                if (isReadOnly && exec.command !== 'signin' && exec.command !== 'share') {
                    setDialogueWithRevert("Only /signin and /share commands available in read-only mode", setDialogueText);
                    return true;
                }
                if (exec.command === 'debug') {
                    if (exec.args[0] === 'on') {
                        const newSettings = { isDebugVisible: true };
                        updateSettings(newSettings);
                    } else if (exec.args[0] === 'off') {
                        const newSettings = { isDebugVisible: false };
                        updateSettings(newSettings);
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

                    // Notify tutorial flow that chat command was executed
                    if (commandValidationHandlerRef.current) {
                        const worldState = {
                            worldData,
                            selectionStart,
                            selectionEnd,
                            hasSelection: selectionStart !== null && selectionEnd !== null
                        };
                        commandValidationHandlerRef.current('chat', exec.args, worldState);
                    }
                } else if (exec.command === 'ai-chat') {
                    // One-shot AI prompt
                    const aiPrompt = exec.args[0];
                    const isPermanent = exec.args[1] === 'permanent'; // Flag from Cmd+Enter

                    if (!aiPrompt || !aiPrompt.trim()) {
                        setDialogueWithRevert("No prompt provided", setDialogueText);
                        return true;
                    }

                    // Priority 1: Check if there's an active selection
                    const hasSelection = selectionStart && selectionEnd &&
                        (selectionStart.x !== selectionEnd.x || selectionStart.y !== selectionEnd.y);

                    if (hasSelection && selectionStart && selectionEnd) {
                        const minX = Math.floor(Math.min(selectionStart.x, selectionEnd.x));
                        const maxX = Math.floor(Math.max(selectionStart.x, selectionEnd.x));
                        const minY = Math.floor(Math.min(selectionStart.y, selectionEnd.y));
                        const maxY = Math.floor(Math.max(selectionStart.y, selectionEnd.y));

                        // Check if selection contains an image
                        let selectedImageData: string | null = null;
                        let selectedImageKey: string | null = null;

                        for (const key in worldData) {
                            if (key.startsWith('image_')) {
                                const imgData = worldData[key];
                                if (imgData && typeof imgData === 'object' && 'type' in imgData && imgData.type === 'image') {
                                    const img = imgData as any;
                                    // Check if image overlaps with selection
                                    if (img.startX <= maxX && img.endX >= minX &&
                                        img.startY <= maxY && img.endY >= minY) {
                                        selectedImageData = img.src;
                                        selectedImageKey = key;
                                        break;
                                    }
                                }
                            }
                        }

                        // If selection contains an image, do image-to-image generation
                        if (selectedImageData && selectedImageKey) {
                            setDialogueWithRevert("Generating image...", setDialogueText);

                            // Show visual feedback for image generation
                            setAiProcessingRegion({ startX: minX, endX: maxX, startY: minY, endY: maxY });

                            // Convert image to base64 if it's a URL (for CORS-safe image-to-image)
                            (async () => {
                                let base64ImageData: string;

                                // Check if it's already a data URL
                                if (selectedImageData && selectedImageData.startsWith('data:')) {
                                    base64ImageData = selectedImageData;
                                    logger.debug('Image is already base64 data URL');
                                }
                                // Check if it's a Firebase Storage URL
                                else if (selectedImageData && (selectedImageData.startsWith('http://') || selectedImageData.startsWith('https://'))) {
                                    logger.debug('Fetching Firebase Storage URL:', selectedImageData);
                                    try {
                                        // Fetch and convert to base64 (with CORS mode)
                                        const response = await fetch(selectedImageData, { mode: 'cors' });
                                        if (!response.ok) {
                                            throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
                                        }
                                        const blob = await response.blob();
                                        base64ImageData = await new Promise<string>((resolve, reject) => {
                                            const reader = new FileReader();
                                            reader.onloadend = () => resolve(reader.result as string);
                                            reader.onerror = reject;
                                            reader.readAsDataURL(blob);
                                        });
                                        logger.debug('Successfully converted to base64');
                                    } catch (error) {
                                        logger.error('Failed to fetch image for conversion:', error);
                                        setAiProcessingRegion(null); // Clear visual feedback
                                        setDialogueWithRevert("Could not load image for editing", setDialogueText);
                                        return true;
                                    }
                                } else {
                                    logger.error('Invalid image format:', selectedImageData);
                                    setAiProcessingRegion(null); // Clear visual feedback
                                    setDialogueWithRevert("Invalid image format", setDialogueText);
                                    return true;
                                }

                                callGenerateImageAPI(aiPrompt, base64ImageData, userUid || undefined).then(async (result) => {
                                // Check if quota exceeded
                                if (result.text && result.text.startsWith('AI limit reached')) {
                                    if (upgradeFlowHandlerRef.current) {
                                        upgradeFlowHandlerRef.current();
                                    }
                                    return true;
                                }

                                if (result.imageData) {
                                    const newWorldData = { ...worldData };

                                    // Upload to storage if available
                                    let finalImageUrl = result.imageData;
                                    if (uploadImageToStorage) {
                                        try {
                                            finalImageUrl = await uploadImageToStorage(result.imageData);
                                        } catch (error) {
                                            logger.error('Failed to upload generated image:', error);
                                        }
                                    }

                                    // Get image dimensions for scaling
                                    const img = new Image();
                                    img.onload = () => {
                                        const { width: charWidth, height: charHeight } = getEffectiveCharDims(zoomLevel);

                                        const selectionCellsWide = maxX - minX + 1;
                                        const selectionCellsHigh = maxY - minY + 1;
                                        const selectionPixelsWide = selectionCellsWide * charWidth;
                                        const selectionPixelsHigh = selectionCellsHigh * charHeight;

                                        const imageAspect = img.width / img.height;
                                        const selectionAspect = selectionPixelsWide / selectionPixelsHigh;

                                        // Cover behavior: scale to fill, then crop overflow
                                        let scaledWidth, scaledHeight;
                                        if (imageAspect > selectionAspect) {
                                            // Image is wider - match height, crop width
                                            scaledHeight = selectionPixelsHigh;
                                            scaledWidth = selectionPixelsHigh * imageAspect;
                                        } else {
                                            // Image is taller - match width, crop height
                                            scaledWidth = selectionPixelsWide;
                                            scaledHeight = selectionPixelsWide / imageAspect;
                                        }

                                        // Always use exact selection dimensions (image will be cropped by renderer)
                                        const cellsWide = selectionCellsWide;
                                        const cellsHigh = selectionCellsHigh;

                                        // Delete old image and create new one at selection bounds
                                        const updatedWorldData = { ...worldData };
                                        if (selectedImageKey) {
                                            delete updatedWorldData[selectedImageKey];
                                        }

                                        (updatedWorldData[`image_${Date.now()}`] as any) = {
                                            type: 'image',
                                            src: finalImageUrl,
                                            startX: minX,
                                            startY: minY,
                                            endX: minX + cellsWide - 1,
                                            endY: minY + cellsHigh - 1,
                                            width: img.width,
                                            height: img.height,
                                            timestamp: Date.now()
                                        };
                                        setWorldData(updatedWorldData);
                                        setAiProcessingRegion(null); // Clear visual feedback
                                        setDialogueWithRevert("Image transformed", setDialogueText);

                                        // Clear selection after processing
                                        setSelectionStart(null);
                                        setSelectionEnd(null);
                                    };
                                    img.src = result.imageData;
                                } else {
                                    setAiProcessingRegion(null); // Clear visual feedback
                                    setDialogueWithRevert("Image generation failed", setDialogueText);
                                }
                                }).catch((error) => {
                                    setAiProcessingRegion(null); // Clear visual feedback
                                    setDialogueWithRevert(`AI error: ${error.message || 'Could not generate image'}`, setDialogueText);
                                });
                            })(); // Close async IIFE
                            return true;
                        }

                        // Otherwise, check if prompt is asking for image generation
                        // Helper to detect image generation requests
                        const isImageGenerationPrompt = (prompt: string): boolean => {
                            const lowerPrompt = prompt.toLowerCase();
                            const imageKeywords = [
                                'draw', 'paint', 'sketch', 'illustrate', 'image', 'picture',
                                'photo', 'render', 'visualize', 'create a scene', 'show me',
                                'generate an image', 'make an image', 'design', 'artwork'
                            ];
                            return imageKeywords.some(keyword => lowerPrompt.includes(keyword));
                        };

                        if (isImageGenerationPrompt(aiPrompt)) {
                            // Generate image in the selection bounds
                            setDialogueWithRevert("Generating image...", setDialogueText);

                            // Show visual feedback for image generation
                            setAiProcessingRegion({ startX: minX, endX: maxX, startY: minY, endY: maxY });

                            callGenerateImageAPI(aiPrompt, undefined, userUid || undefined).then(async (result) => {
                                // Check if quota exceeded
                                if (result.text && result.text.startsWith('AI limit reached')) {
                                    if (upgradeFlowHandlerRef.current) {
                                        upgradeFlowHandlerRef.current();
                                    }
                                    return true;
                                }

                                if (result.imageData) {
                                    const newWorldData = { ...worldData };

                                    // Upload to storage if available
                                    let finalImageUrl = result.imageData;
                                    if (uploadImageToStorage) {
                                        try {
                                            finalImageUrl = await uploadImageToStorage(result.imageData);
                                        } catch (error) {
                                            logger.error('Failed to upload generated image:', error);
                                        }
                                    }

                                    // Get image dimensions for scaling
                                    const img = new Image();
                                    img.onload = () => {
                                        const { width: charWidth, height: charHeight } = getEffectiveCharDims(zoomLevel);

                                        const selectionCellsWide = maxX - minX + 1;
                                        const selectionCellsHigh = maxY - minY + 1;
                                        const selectionPixelsWide = selectionCellsWide * charWidth;
                                        const selectionPixelsHigh = selectionCellsHigh * charHeight;

                                        const imageAspect = img.width / img.height;
                                        const selectionAspect = selectionPixelsWide / selectionPixelsHigh;

                                        // Cover behavior: scale to fill, then crop overflow
                                        let scaledWidth, scaledHeight;
                                        if (imageAspect > selectionAspect) {
                                            // Image is wider - match height, crop width
                                            scaledHeight = selectionPixelsHigh;
                                            scaledWidth = selectionPixelsHigh * imageAspect;
                                        } else {
                                            // Image is taller - match width, crop height
                                            scaledWidth = selectionPixelsWide;
                                            scaledHeight = selectionPixelsWide / imageAspect;
                                        }

                                        // Always use exact selection dimensions (image will be cropped by renderer)
                                        const cellsWide = selectionCellsWide;
                                        const cellsHigh = selectionCellsHigh;

                                        // Clear the selection area and create image
                                        const updatedWorldData = { ...worldData };
                                        for (let y = minY; y <= maxY; y++) {
                                            for (let x = minX; x <= maxX; x++) {
                                                delete updatedWorldData[`${x},${y}`];
                                            }
                                        }

                                        (updatedWorldData[`image_${Date.now()}`] as any) = {
                                            type: 'image',
                                            src: finalImageUrl,
                                            startX: minX,
                                            startY: minY,
                                            endX: minX + cellsWide - 1,
                                            endY: minY + cellsHigh - 1,
                                            originalWidth: img.width,
                                            originalHeight: img.height
                                        };

                                        setWorldData(updatedWorldData);
                                        setAiProcessingRegion(null); // Clear visual feedback
                                        setDialogueWithRevert("Image generated", setDialogueText);

                                        // Clear selection after processing
                                        setSelectionStart(null);
                                        setSelectionEnd(null);
                                    };
                                    img.src = finalImageUrl;
                                } else {
                                    setAiProcessingRegion(null); // Clear visual feedback
                                    setDialogueWithRevert("Could not generate image", setDialogueText);
                                }
                            }).catch((error) => {
                                setAiProcessingRegion(null); // Clear visual feedback
                                setDialogueWithRevert(`AI error: ${error.message || 'Could not generate image'}`, setDialogueText);
                            });

                            return true;
                        }

                        // Otherwise, extract text from selection and do text transformation
                        const getCharacter = (cellData: any): string => {
                            if (!cellData) return '';
                            if (typeof cellData === 'string') return cellData;
                            if (typeof cellData === 'object' && 'char' in cellData) return cellData.char;
                            return '';
                        };

                        // Extract text from selection
                        let selectedText = '';
                        for (let y = minY; y <= maxY; y++) {
                            let line = '';
                            for (let x = minX; x <= maxX; x++) {
                                const cellKey = `${x},${y}`;
                                line += getCharacter(worldData[cellKey]);
                            }
                            selectedText += line.trimEnd() + '\n';
                        }
                        selectedText = selectedText.trim();

                        // If there's text in the selection, use it as context
                        const fullPrompt = selectedText
                            ? `${aiPrompt}\n\nExisting text:\n${selectedText}`
                            : aiPrompt;

                        setDialogueWithRevert(selectedText ? "Transforming text..." : "Generating text...", setDialogueText);
                        callChatAPI(fullPrompt, true, userUid || undefined).then((response) => {
                            // Check if quota exceeded
                            if (response.startsWith('AI limit reached')) {
                                if (upgradeFlowHandlerRef.current) {
                                    upgradeFlowHandlerRef.current();
                                }
                                return true;
                            }

                            const newWorldData = { ...worldData };

                            // Clear the selection area
                            for (let y = minY; y <= maxY; y++) {
                                for (let x = minX; x <= maxX; x++) {
                                    delete newWorldData[`${x},${y}`];
                                }
                            }

                            // Wrap and write AI response in the selection bounds
                            const wrapWidth = maxX - minX + 1;
                            const wrapText = (text: string, maxWidth: number): string[] => {
                                const paragraphs = text.split('\n');
                                const lines: string[] = [];

                                for (const paragraph of paragraphs) {
                                    if (paragraph.trim() === '') {
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

                            // Write wrapped response starting at selection top-left
                            for (let lineIndex = 0; lineIndex < wrappedLines.length; lineIndex++) {
                                const line = wrappedLines[lineIndex];
                                for (let charIndex = 0; charIndex < line.length; charIndex++) {
                                    const char = line[charIndex];
                                    const x = minX + charIndex;
                                    const y = minY + lineIndex;
                                    const key = `${x},${y}`;
                                    newWorldData[key] = char;
                                }
                            }

                            setWorldData(newWorldData);
                            setDialogueWithRevert(selectedText ? "Text transformed" : "Text generated", setDialogueText);

                            // Clear selection after processing
                            setSelectionStart(null);
                            setSelectionEnd(null);
                        }).catch((error) => {
                            setDialogueWithRevert(`AI error: ${error.message || 'Could not transform text'}`, setDialogueText);
                        });

                        return true;
                    }

                    // Priority 2: Check if there's an image at the command start position
                    let existingImageData: string | null = null;
                    let existingImageKey: string | null = null;
                    let imageRegion: { startX: number, endX: number, startY: number, endY: number } | null = null;

                    for (const key in worldData) {
                        if (key.startsWith('image_')) {
                            const imgData = worldData[key];
                            if (imgData && typeof imgData === 'object' && 'type' in imgData && imgData.type === 'image') {
                                const img = imgData as any;
                                // Check if command was typed over this image
                                if (exec.commandStartPos.x >= img.startX && exec.commandStartPos.x <= img.endX &&
                                    exec.commandStartPos.y >= img.startY && exec.commandStartPos.y <= img.endY) {
                                    existingImageData = img.src;
                                    existingImageKey = key;
                                    imageRegion = {
                                        startX: img.startX,
                                        endX: img.endX,
                                        startY: img.startY,
                                        endY: img.endY
                                    };
                                    break;
                                }
                            }
                        }
                    }

                    // If image exists, do image-to-image generation
                    if (existingImageData && existingImageKey && imageRegion) {
                        setDialogueWithRevert("Generating image...", setDialogueText);

                        // Convert image to base64 if it's a URL (for CORS-safe image-to-image)
                        (async () => {
                            let base64ImageData: string;

                            // Check if it's already a data URL
                            if (existingImageData.startsWith('data:')) {
                                base64ImageData = existingImageData;
                                logger.debug('Image is already base64 data URL');
                            }
                            // Check if it's a Firebase Storage URL
                            else if (existingImageData.startsWith('http://') || existingImageData.startsWith('https://')) {
                                logger.debug('Fetching Firebase Storage URL:', existingImageData);
                                try {
                                    // Fetch and convert to base64 (with CORS mode)
                                    const response = await fetch(existingImageData, { mode: 'cors' });
                                    if (!response.ok) {
                                        throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
                                    }
                                    const blob = await response.blob();
                                    base64ImageData = await new Promise<string>((resolve, reject) => {
                                        const reader = new FileReader();
                                        reader.onloadend = () => resolve(reader.result as string);
                                        reader.onerror = reject;
                                        reader.readAsDataURL(blob);
                                    });
                                    logger.debug('Successfully converted to base64');
                                } catch (error) {
                                    logger.error('Failed to fetch image for conversion:', error);
                                    setDialogueWithRevert("Could not load image for editing", setDialogueText);
                                    return true;
                                }
                            } else {
                                logger.error('Invalid image format:', existingImageData);
                                setDialogueWithRevert("Invalid image format", setDialogueText);
                                return true;
                            }

                            // Calculate aspect ratio from image region
                            const regionWidth = imageRegion!.endX - imageRegion!.startX + 1;
                            const regionHeight = imageRegion!.endY - imageRegion!.startY + 1;
                            const aspectRatio = regionWidth > regionHeight ? '16:9' : regionHeight > regionWidth ? '9:16' : '1:1';

                            // Show visual feedback for image generation
                            setAiProcessingRegion(imageRegion);

                            callGenerateImageAPI(aiPrompt, base64ImageData, userUid || undefined, aspectRatio).then(async (result) => {
                            // Check if quota exceeded
                            if (result.text && result.text.startsWith('AI limit reached')) {
                                if (upgradeFlowHandlerRef.current) {
                                    upgradeFlowHandlerRef.current();
                                }
                                return true;
                            }

                            if (result.imageData) {
                                // Upload to storage if available
                                let finalImageUrl = result.imageData;
                                if (uploadImageToStorage) {
                                    try {
                                        finalImageUrl = await uploadImageToStorage(result.imageData);
                                    } catch (error) {
                                        logger.error('Failed to upload generated image:', error);
                                    }
                                }

                                // Get image dimensions for scaling
                                const img = new Image();
                                img.onload = () => {
                                    const { width: charWidth, height: charHeight } = getEffectiveCharDims(zoomLevel);

                                    const regionCellsWide = imageRegion!.endX - imageRegion!.startX + 1;
                                    const regionCellsHigh = imageRegion!.endY - imageRegion!.startY + 1;
                                    const regionPixelsWide = regionCellsWide * charWidth;
                                    const regionPixelsHigh = regionCellsHigh * charHeight;

                                    const imageAspect = img.width / img.height;
                                    const regionAspect = regionPixelsWide / regionPixelsHigh;

                                    // Cover behavior: scale to fill, then crop overflow
                                    let scaledWidth, scaledHeight;
                                    if (imageAspect > regionAspect) {
                                        // Image is wider - match height, crop width
                                        scaledHeight = regionPixelsHigh;
                                        scaledWidth = regionPixelsHigh * imageAspect;
                                    } else {
                                        // Image is taller - match width, crop height
                                        scaledWidth = regionPixelsWide;
                                        scaledHeight = regionPixelsWide / imageAspect;
                                    }

                                    // Always use exact region dimensions (image will be cropped by renderer)
                                    const cellsWide = regionCellsWide;
                                    const cellsHigh = regionCellsHigh;

                                    // Use functional setState to avoid overwriting concurrent edits
                                    setWorldData(currentWorldData => {
                                        const updatedWorldData = { ...currentWorldData };
                                        (updatedWorldData[existingImageKey!] as any) = {
                                            type: 'image',
                                            src: finalImageUrl,
                                            startX: imageRegion!.startX,
                                            startY: imageRegion!.startY,
                                            endX: imageRegion!.startX + cellsWide - 1,
                                            endY: imageRegion!.startY + cellsHigh - 1,
                                            width: img.width,
                                            height: img.height,
                                            timestamp: Date.now()
                                        };
                                        return updatedWorldData;
                                    });
                                    setAiProcessingRegion(null); // Clear visual feedback
                                    setDialogueWithRevert("Image transformed", setDialogueText);
                                };
                                img.src = result.imageData;
                            } else {
                                setAiProcessingRegion(null); // Clear visual feedback
                                setDialogueWithRevert("Image generation failed", setDialogueText);
                            }
                            }).catch((error) => {
                                setAiProcessingRegion(null); // Clear visual feedback
                                setDialogueWithRevert(`AI error: ${error.message || 'Could not generate image'}`, setDialogueText);
                            });
                        })(); // Close async IIFE
                        return true;
                    }

                    // Priority 3: Check if there's a text block at the command position
                    const getCharacter = (cellData: any): string => {
                        if (!cellData) return '';
                        if (typeof cellData === 'string') return cellData;
                        if (typeof cellData === 'object' && 'char' in cellData) return cellData.char;
                        return '';
                    };

                    // Simple flood-fill to find connected text block (includes spaces between text)
                    const findTextBlock = (startPos: { x: number, y: number }): { x: number, y: number }[] => {
                        const visited = new Set<string>();
                        const textPositions: { x: number, y: number }[] = [];
                        const queue: { x: number, y: number }[] = [startPos];

                        while (queue.length > 0) {
                            const pos = queue.shift()!;
                            const key = `${pos.x},${pos.y}`;

                            if (visited.has(key)) continue;
                            visited.add(key);

                            const char = getCharacter(worldData[key]);

                            if (char && char.trim() !== '') {
                                textPositions.push(pos);

                                // Check 4 directions
                                const directions = [
                                    { x: pos.x - 1, y: pos.y },
                                    { x: pos.x + 1, y: pos.y },
                                    { x: pos.x, y: pos.y - 1 },
                                    { x: pos.x, y: pos.y + 1 }
                                ];

                                for (const dir of directions) {
                                    const dirKey = `${dir.x},${dir.y}`;
                                    if (!visited.has(dirKey)) {
                                        queue.push(dir);
                                    }
                                }
                            } else if (textPositions.length > 0) {
                                // If we've found text and this is a space, check if it connects text
                                const hasTextLeft = getCharacter(worldData[`${pos.x - 1},${pos.y}`]).trim() !== '';
                                const hasTextRight = getCharacter(worldData[`${pos.x + 1},${pos.y}`]).trim() !== '';

                                if (hasTextLeft || hasTextRight) {
                                    // Continue searching horizontally through spaces
                                    if (!visited.has(`${pos.x - 1},${pos.y}`)) {
                                        queue.push({ x: pos.x - 1, y: pos.y });
                                    }
                                    if (!visited.has(`${pos.x + 1},${pos.y}`)) {
                                        queue.push({ x: pos.x + 1, y: pos.y });
                                    }
                                }
                            }
                        }

                        return textPositions;
                    };

                    let textBlock = findTextBlock(exec.commandStartPos);

                    // If no text found at start position, search nearby in 3x3 area
                    if (textBlock.length === 0) {
                        for (let dy = -1; dy <= 1; dy++) {
                            for (let dx = -1; dx <= 1; dx++) {
                                const checkPos = { x: exec.commandStartPos.x + dx, y: exec.commandStartPos.y + dy };
                                const checkKey = `${checkPos.x},${checkPos.y}`;
                                const checkChar = getCharacter(worldData[checkKey]);

                                if (checkChar && checkChar.trim() !== '') {
                                    // Found text nearby, use that as start
                                    textBlock = findTextBlock(checkPos);
                                    if (textBlock.length > 0) break;
                                }
                            }
                            if (textBlock.length > 0) break;
                        }
                    }

                    if (textBlock.length > 0) {
                        // Found a text block - extract the text and use as context
                        const minX = Math.min(...textBlock.map(p => p.x));
                        const maxX = Math.max(...textBlock.map(p => p.x));
                        const minY = Math.min(...textBlock.map(p => p.y));
                        const maxY = Math.max(...textBlock.map(p => p.y));

                        // Extract text content from bounding box
                        let existingText = '';
                        for (let y = minY; y <= maxY; y++) {
                            let line = '';
                            for (let x = minX; x <= maxX; x++) {
                                const cellKey = `${x},${y}`;
                                line += getCharacter(worldData[cellKey]);
                            }
                            existingText += line.trimEnd() + '\n';
                        }
                        existingText = existingText.trim();

                        // Send existing text + prompt to AI
                        const fullPrompt = `${aiPrompt}\n\nExisting text:\n${existingText}`;

                        setDialogueWithRevert("Transforming text...", setDialogueText);
                        callChatAPI(fullPrompt, true, userUid || undefined).then((response) => {
                            // Check if quota exceeded
                            if (response.startsWith('AI limit reached')) {
                                if (upgradeFlowHandlerRef.current) {
                                    upgradeFlowHandlerRef.current();
                                }
                                return true;
                            }

                            // Replace text in the bounding box with AI response
                            const newWorldData = { ...worldData };

                            // Clear the existing text block
                            for (let y = minY; y <= maxY; y++) {
                                for (let x = minX; x <= maxX; x++) {
                                    delete newWorldData[`${x},${y}`];
                                }
                            }

                            // Wrap and write AI response at the same position
                            const wrapWidth = maxX - minX + 1; // Use same width as original text block
                            const wrapText = (text: string, maxWidth: number): string[] => {
                                const paragraphs = text.split('\n');
                                const lines: string[] = [];

                                for (const paragraph of paragraphs) {
                                    if (paragraph.trim() === '') {
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

                            // Write wrapped response starting at minX, minY
                            for (let lineIndex = 0; lineIndex < wrappedLines.length; lineIndex++) {
                                const line = wrappedLines[lineIndex];
                                for (let charIndex = 0; charIndex < line.length; charIndex++) {
                                    const char = line[charIndex];
                                    const x = minX + charIndex;
                                    const y = minY + lineIndex;
                                    const key = `${x},${y}`;
                                    newWorldData[key] = char;
                                }
                            }

                            setWorldData(newWorldData);
                            setDialogueWithRevert("Text transformed", setDialogueText);
                        }).catch((error) => {
                            setDialogueWithRevert(`AI error: ${error.message || 'Could not transform text'}`, setDialogueText);
                        });

                        return true;
                    }

                    // Priority 4: Default text-based AI chat (no selection, no image, no text block)
                    setDialogueWithRevert("Asking AI...", setDialogueText);
                    callChatAPI(aiPrompt, true, userUid || undefined).then((response) => {
                        // Check if quota exceeded
                        if (response.startsWith('AI limit reached')) {
                            if (upgradeFlowHandlerRef.current) {
                                upgradeFlowHandlerRef.current();
                            }
                            return;
                        }

                        // Start response on next line, same X as where '/' was typed
                        const responseStartPos = {
                            x: exec.commandStartPos.x,
                            y: exec.commandStartPos.y + 1
                        };

                        if (isPermanent) {
                            // Cmd+Enter: Write permanently to canvas with wrapping
                            const wrapWidth = 80; // Default wrap width

                            // Text wrapping function
                            const wrapText = (text: string, maxWidth: number): string[] => {
                                const paragraphs = text.split('\n');
                                const lines: string[] = [];

                                for (const paragraph of paragraphs) {
                                    if (paragraph.trim() === '') {
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

                            // Move cursor to end of response
                            setCursorPos({
                                x: responseStartPos.x + wrappedLines[wrappedLines.length - 1].length,
                                y: responseStartPos.y + wrappedLines.length - 1
                            });

                            setDialogueWithRevert("AI response written", setDialogueText);
                        } else {
                            // Enter: Show ephemeral response (like chat mode)
                            createSubtitleCycler(response, setDialogueText);

                            // Also show as ephemeral text at response start position
                            addInstantAIResponse(responseStartPos, response, { queryText: aiPrompt, centered: false });
                        }
                    }).catch((error) => {
                        setDialogueWithRevert(`AI error: ${error.message || 'Could not get AI response'}`, setDialogueText);
                    });
                } else if (exec.command === 'label') {
                    // Check if this is a --distance command
                    if (exec.args.length >= 2 && exec.args[0] === '--distance') {
                        const distanceStr = exec.args[1];

                        if (distanceStr.toLowerCase() === 'off') {
                            // Set to maximum value to effectively disable distance filtering
                            const newSettings = { labelProximityThreshold: 999999 };
                            updateSettings(newSettings);
                            setDialogueWithRevert("Label distance filtering disabled", setDialogueText);
                        } else {
                            const distance = parseInt(distanceStr, 10);

                            if (!isNaN(distance) && distance > 0) {
                                // Update the labelProximityThreshold setting
                                const newSettings = { labelProximityThreshold: distance };
                                updateSettings(newSettings);
                                setDialogueWithRevert(`Label distance threshold set to ${distance}`, setDialogueText);
                            } else {
                                setDialogueWithRevert("Invalid distance. Please provide a positive number or 'off'.", setDialogueText);
                            }
                        }
                    } else if (exec.args.length === 0 && selectionStart && selectionEnd) {
                        // No args provided but there's a selection - extract text from selection
                        const hasSelection = selectionStart.x !== selectionEnd.x || selectionStart.y !== selectionEnd.y;

                        if (hasSelection) {
                            const minX = Math.floor(Math.min(selectionStart.x, selectionEnd.x));
                            const maxX = Math.floor(Math.max(selectionStart.x, selectionEnd.x));
                            const minY = Math.floor(Math.min(selectionStart.y, selectionEnd.y));
                            const maxY = Math.floor(Math.max(selectionStart.y, selectionEnd.y));

                            // Helper to extract character from cell data
                            const getCharacter = (cellData: any): string => {
                                if (!cellData) return '';
                                if (typeof cellData === 'string') return cellData;
                                if (typeof cellData === 'object' && 'char' in cellData) return cellData.char;
                                return '';
                            };

                            // Extract text from selection
                            let selectedText = '';
                            for (let y = minY; y <= maxY; y++) {
                                let line = '';
                                for (let x = minX; x <= maxX; x++) {
                                    const cellKey = `${x},${y}`;
                                    line += getCharacter(worldData[cellKey]);
                                }
                                selectedText += line.trimEnd() + ' ';
                            }
                            selectedText = selectedText.trim();

                            if (selectedText) {
                                // Create label at selection start position
                                const labelKey = `label_${minX},${minY}`;
                                // Don't save color - let it adapt to current canvas colors dynamically
                                const newLabel = {
                                    text: selectedText
                                };

                                setWorldData(prev => ({
                                    ...prev,
                                    [labelKey]: JSON.stringify(newLabel)
                                }));

                                setDialogueWithRevert(`Label "${selectedText}" created`, setDialogueText);

                                // Clear selection after creating label
                                setSelectionStart(null);
                                setSelectionEnd(null);

                                // Notify tutorial flow
                                if (commandValidationHandlerRef.current) {
                                    const worldState = {
                                        worldData,
                                        selectionStart,
                                        selectionEnd,
                                        hasSelection: selectionStart !== null && selectionEnd !== null
                                    };
                                    commandValidationHandlerRef.current('label', [selectedText], worldState);
                                }
                            } else {
                                setDialogueWithRevert("Selection is empty", setDialogueText);
                            }
                        } else {
                            setDialogueWithRevert("Make a selection first or provide label text: /label 'text'", setDialogueText);
                        }
                    } else if (exec.args.length >= 1) {
                        // Parse the raw command input to handle quoted strings
                        const fullCommand = exec.command + ' ' + exec.args.join(' ');
                        const commandParts = fullCommand.split(' ');

                        let text = '';
                        let labelColor: string | undefined = undefined; // Don't set default - let it adapt dynamically

                        // Check for quoted text (single quotes)
                        const quotedMatch = fullCommand.match(/label\s+'([^']+)'(?:\s+(\S+))?/);

                        if (quotedMatch) {
                            // Found quoted text
                            text = quotedMatch[1];
                            if (quotedMatch[2]) {
                                // Resolve color name to hex
                                const colorArg = quotedMatch[2];
                                labelColor = (COLOR_MAP[colorArg.toLowerCase()] || colorArg).toUpperCase();

                                // Validate hex color
                                if (!/^#[0-9A-F]{6}$/i.test(labelColor)) {
                                    setDialogueWithRevert(`Invalid color: ${colorArg}. Use hex code or name.`, setDialogueText);
                                    return true;
                                }
                            }
                        } else {
                            // No quotes - use first argument as text
                            text = exec.args[0];
                            if (exec.args[1]) {
                                // Resolve color name to hex
                                const colorArg = exec.args[1];
                                labelColor = (COLOR_MAP[colorArg.toLowerCase()] || colorArg).toUpperCase();

                                // Validate hex color
                                if (!/^#[0-9A-F]{6}$/i.test(labelColor)) {
                                    setDialogueWithRevert(`Invalid color: ${colorArg}. Use hex code or name.`, setDialogueText);
                                    return true;
                                }
                            }
                        }

                        const labelKey = `label_${exec.commandStartPos.x},${exec.commandStartPos.y}`;
                        const newLabel: any = {
                            text
                        };

                        // Only save color if explicitly provided
                        if (labelColor) {
                            newLabel.color = labelColor;
                        }

                        setWorldData(prev => ({
                            ...prev,
                            [labelKey]: JSON.stringify(newLabel)
                        }));

                        setDialogueWithRevert(`Label "${text}" created`, setDialogueText);

                        // Notify tutorial flow that label command was executed
                        if (commandValidationHandlerRef.current) {
                            commandValidationHandlerRef.current('label', exec.args, worldData);
                        }
                    } else {
                        setDialogueWithRevert("Usage: /label 'text' [textColor] [backgroundColor] or /label --distance <number>", setDialogueText);
                    }
                } else if (exec.command === 'map') {
                    // /map command - generate ephemeral procedural labels

                    // Simple Perlin-like noise function for organic placement
                    const simpleNoise = (x: number, y: number, seed: number = 0): number => {
                        const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
                        return (n - Math.floor(n)) * 2 - 1; // -1 to 1
                    };

                    // Get viewport center
                    const viewportCenter = getViewportCenter();
                    const centerX = Math.floor(viewportCenter.x);
                    const centerY = Math.floor(viewportCenter.y);

                    // Generate labels with tasteful spacing
                    const newLightData: WorldData = {};
                    const mapRadius = 80; // Exploration radius
                    const minSpacing = 25; // Minimum distance between labels
                    const labelCount = 8; // Number of labels to generate
                    const seed = Date.now(); // Random seed for this generation

                    // Words for procedural labels (exploration-themed)
                    const labelWords = [
                        'vista', 'ridge', 'valley', 'peak', 'grove',
                        'crossing', 'hollow', 'meadow', 'outlook', 'passage',
                        'haven', 'clearing', 'ascent', 'trail', 'junction'
                    ];

                    const placedLabels: Array<{x: number, y: number}> = [];

                    // Generate labels with Poisson-disk-like spacing
                    let attempts = 0;
                    const maxAttempts = 100;

                    while (placedLabels.length < labelCount && attempts < maxAttempts) {
                        attempts++;

                        // Use noise to pick angle and radius for organic placement
                        const angleNoise = simpleNoise(attempts * 0.1, seed * 0.001, 1);
                        const radiusNoise = simpleNoise(attempts * 0.1, seed * 0.001, 2);

                        const angle = angleNoise * Math.PI * 2;
                        const radius = mapRadius * 0.4 + (radiusNoise + 1) * 0.5 * mapRadius * 0.6;

                        const labelX = Math.floor(centerX + Math.cos(angle) * radius);
                        const labelY = Math.floor(centerY + Math.sin(angle) * radius);

                        // Check minimum spacing
                        let tooClose = false;
                        for (const placed of placedLabels) {
                            const dx = labelX - placed.x;
                            const dy = labelY - placed.y;
                            const dist = Math.sqrt(dx * dx + dy * dy);
                            if (dist < minSpacing) {
                                tooClose = true;
                                break;
                            }
                        }

                        if (!tooClose) {
                            placedLabels.push({x: labelX, y: labelY});

                            // Pick a word using noise
                            const wordIndex = Math.floor((simpleNoise(labelX * 0.1, labelY * 0.1, seed) + 1) * 0.5 * labelWords.length) % labelWords.length;
                            const word = labelWords[wordIndex];

                            // Create proper label entry (same format as permanent labels)
                            const labelKey = `label_${labelX},${labelY}`;
                            newLightData[labelKey] = JSON.stringify({
                                text: word,
                                color: textColor
                            });
                        }
                    }

                    // Set ephemeral data (cleared with Escape)
                    setLightModeData(newLightData);
                    setDialogueWithRevert(`Generated ${placedLabels.length} waypoints. Press Escape to clear.`, setDialogueText);

                } else if (exec.command === 'task') {
                    // /task command - create a toggleable task from selection
                    if (selectionStart && selectionEnd) {
                        const hasSelection = selectionStart.x !== selectionEnd.x || selectionStart.y !== selectionEnd.y;

                        if (hasSelection) {
                            const normalized = getNormalizedSelection();
                            if (normalized) {
                                // Get color argument (no default - let it adapt dynamically)
                                let hexColor: string | undefined = undefined;

                                if (exec.args.length > 0) {
                                    const highlightColor = exec.args[0];
                                    // Resolve color name to hex
                                    hexColor = (COLOR_MAP[highlightColor.toLowerCase()] || highlightColor).toUpperCase();

                                    // Validate hex color
                                    if (!/^#[0-9A-F]{6}$/i.test(hexColor)) {
                                        setDialogueWithRevert(`Invalid color: ${highlightColor}. Use hex code or name.`, setDialogueText);
                                        return true;
                                    }
                                }

                                // Create task data
                                const taskKey = `task_${normalized.startX},${normalized.startY}_${Date.now()}`;
                                const taskData: any = {
                                    startX: normalized.startX,
                                    endX: normalized.endX,
                                    startY: normalized.startY,
                                    endY: normalized.endY,
                                    completed: false,
                                    timestamp: Date.now()
                                };

                                // Only save color if explicitly provided
                                if (hexColor) {
                                    taskData.color = hexColor;
                                }

                                // Store task in worldData
                                setWorldData(prev => ({
                                    ...prev,
                                    [taskKey]: JSON.stringify(taskData)
                                }));

                                const width = normalized.endX - normalized.startX + 1;
                                const height = normalized.endY - normalized.startY + 1;
                                setDialogueWithRevert(`Task created (${width}×${height}). Click to toggle completion.`, setDialogueText);

                                // Clear selection
                                setSelectionStart(null);
                                setSelectionEnd(null);
                            }
                        } else {
                            setDialogueWithRevert("Selection must span more than one cell", setDialogueText);
                        }
                    } else {
                        setDialogueWithRevert("Make a selection first", setDialogueText);
                    }
                } else if (exec.command === 'link') {
                    // /link command - create a clickable link from selection
                    if (selectionStart && selectionEnd) {
                        const hasSelection = selectionStart.x !== selectionEnd.x || selectionStart.y !== selectionEnd.y;

                        if (hasSelection) {
                            const normalized = getNormalizedSelection();
                            if (normalized && exec.args.length > 0) {
                                const url = exec.args[0];

                                // Basic URL validation
                                let validUrl = url;
                                if (!url.match(/^https?:\/\//i)) {
                                    validUrl = 'https://' + url;
                                }

                                // Create link data
                                const linkKey = `link_${normalized.startX},${normalized.startY}_${Date.now()}`;
                                const linkData: any = {
                                    startX: normalized.startX,
                                    endX: normalized.endX,
                                    startY: normalized.startY,
                                    endY: normalized.endY,
                                    url: validUrl,
                                    timestamp: Date.now()
                                };

                                // Get optional color argument
                                if (exec.args.length > 1) {
                                    const colorArg = exec.args[1];
                                    const hexColor = (COLOR_MAP[colorArg.toLowerCase()] || colorArg).toUpperCase();
                                    if (/^#[0-9A-F]{6}$/i.test(hexColor)) {
                                        linkData.color = hexColor;
                                    }
                                }

                                // Store link in worldData
                                setWorldData(prev => ({
                                    ...prev,
                                    [linkKey]: JSON.stringify(linkData)
                                }));

                                const width = normalized.endX - normalized.startX + 1;
                                const height = normalized.endY - normalized.startY + 1;
                                setDialogueWithRevert(`Link created (${width}×${height}). Click to open.`, setDialogueText);

                                // Clear selection
                                setSelectionStart(null);
                                setSelectionEnd(null);
                            } else {
                                setDialogueWithRevert("Usage: /link [url] [color]", setDialogueText);
                            }
                        } else {
                            setDialogueWithRevert("Selection must span more than one cell", setDialogueText);
                        }
                    } else {
                        setDialogueWithRevert("Make a selection first", setDialogueText);
                    }
                } else if (exec.command === 'margin') {
                    // /margin command - create a margin note for selected text
                    console.log('[/margin] Command triggered in world engine');

                    if (selectionStart && selectionEnd) {
                        const hasSelection = selectionStart.x !== selectionEnd.x || selectionStart.y !== selectionEnd.y;
                        console.log('[/margin] Selection exists:', { selectionStart, selectionEnd, hasSelection });

                        if (hasSelection) {
                            console.log('[/margin] Loading bit.blocks functions...');
                            // Use dynamic import to load margin calculation functions
                            import('./bit.blocks').then(({ findTextBlockForSelection, calculateMarginPlacement }) => {
                                console.log('[/margin] Functions loaded');
                                const normalized = getNormalizedSelection();
                                console.log('[/margin] Normalized selection:', normalized);

                                if (normalized) {
                                    // Find the text block containing this selection
                                    const textBlock = findTextBlockForSelection(normalized, worldData);
                                    console.log('[/margin] Text block found:', textBlock);

                                    if (textBlock) {
                                        // Calculate margin placement (right, left, or bottom)
                                        const marginPlacement = calculateMarginPlacement(
                                            textBlock,
                                            normalized.startY,
                                            worldData
                                        );
                                        console.log('[/margin] Margin placement calculated:', marginPlacement);

                                        if (marginPlacement) {
                                            // Create note region data
                                            const noteRegion = {
                                                startX: marginPlacement.startX,
                                                endX: marginPlacement.endX,
                                                startY: marginPlacement.startY,
                                                endY: marginPlacement.endY,
                                                timestamp: Date.now()
                                            };

                                            // Store note region in worldData with unique key
                                            const noteKey = `note_${marginPlacement.startX},${marginPlacement.startY}_${Date.now()}`;
                                            setWorldData(prev => ({
                                                ...prev,
                                                [noteKey]: JSON.stringify(noteRegion)
                                            }));
                                            console.log('[/margin] Note region created with key:', noteKey, noteRegion);

                                            const width = marginPlacement.endX - marginPlacement.startX + 1;
                                            const height = marginPlacement.endY - marginPlacement.startY + 1;
                                            setDialogueWithRevert(
                                                `Margin note created (${width}×${height}) on ${marginPlacement.position}`,
                                                setDialogueText
                                            );

                                            // Clear selection
                                            setSelectionStart(null);
                                            setSelectionEnd(null);
                                        } else {
                                            console.log('[/margin] No available margin space found');
                                            setDialogueWithRevert("Could not find available margin space", setDialogueText);
                                        }
                                    } else {
                                        console.log('[/margin] No text block found for selection');
                                        setDialogueWithRevert("Could not find text block for selection", setDialogueText);
                                    }
                                }
                            }).catch((error) => {
                                console.error('[/margin] Error loading margin functions:', error);
                                setDialogueWithRevert("Error creating margin note", setDialogueText);
                            });
                        } else {
                            console.log('[/margin] Selection must span more than one cell');
                            setDialogueWithRevert("Selection must span more than one cell", setDialogueText);
                        }
                    } else {
                        console.log('[/margin] No selection exists');
                        setDialogueWithRevert("Make a selection first", setDialogueText);
                    }
                } else if (exec.command === 'monogram') {
                    // Handle monogram via callback
                    if (monogramCommandHandlerRef.current) {
                        monogramCommandHandlerRef.current(exec.args);
                    } else {
                        setDialogueWithRevert("Monogram control not available", setDialogueText);
                    }
                } else if (exec.command === 'signin') {
                    // Trigger sign in flow via callback
                    if (hostDialogueHandlerRef.current) {
                        hostDialogueHandlerRef.current();
                    } else {
                        setDialogueWithRevert("Sign in flow not available", setDialogueText);
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
                        const hasRegionFlag = exec.args.includes('--region');
                        const hasSelection = selectionStart !== null && selectionEnd !== null;

                        setDialogueWithRevert("Publishing state...", setDialogueText);
                        publishState(currentStateName, true).then((success) => {
                            if (success) {
                                // Generate base URL
                                const baseUrl = `${window.location.origin}/@${username}/${currentStateName}`;

                                // If --region flag or has selection, include coordinates
                                if (hasRegionFlag || hasSelection) {
                                    let targetX, targetY;

                                    if (hasSelection && selectionStart && selectionEnd) {
                                        // Use center of selection
                                        const normalized = getNormalizedSelection();
                                        if (normalized) {
                                            targetX = Math.floor((normalized.startX + normalized.endX) / 2);
                                            targetY = Math.floor((normalized.startY + normalized.endY) / 2);
                                        }
                                    } else {
                                        // Use cursor position
                                        targetX = cursorPos.x;
                                        targetY = cursorPos.y;
                                    }

                                    if (targetX !== undefined && targetY !== undefined) {
                                        const urlWithCoords = `${baseUrl}?v=${targetX}.${targetY}.${zoomLevel.toFixed(2)}`;
                                        navigator.clipboard.writeText(urlWithCoords).then(() => {
                                            setDialogueWithRevert(`Published with region link copied to clipboard`, setDialogueText);
                                        });
                                    }
                                } else {
                                    // Regular publish without coordinates
                                    navigator.clipboard.writeText(baseUrl).then(() => {
                                        setDialogueWithRevert(`State "${currentStateName}" published, link copied`, setDialogueText);
                                    });
                                }
                            } else {
                                setDialogueWithRevert(`Failed to publish state "${currentStateName}"`, setDialogueText);
                            }
                        });
                    } else {
                        setDialogueWithRevert("No current state to publish", setDialogueText);
                    }
                } else if (exec.command === 'share') {
                    // Share current view
                    if (currentStateName) {
                        // In read-only mode or when not logged in, just generate link without publishing
                        if (isReadOnly || !userUid) {
                            const baseUrl = window.location.href.split('?')[0]; // Current URL without query params
                            let targetX, targetY;

                            // Check if there's an active selection
                            if (selectionStart !== null && selectionEnd !== null) {
                                // Use center of selection
                                const normalized = getNormalizedSelection();
                                if (normalized) {
                                    targetX = Math.floor((normalized.startX + normalized.endX) / 2);
                                    targetY = Math.floor((normalized.startY + normalized.endY) / 2);
                                }
                            } else {
                                // Use cursor position
                                targetX = cursorPos.x;
                                targetY = cursorPos.y;
                            }

                            const urlWithCoords = `${baseUrl}?v=${targetX}.${targetY}.${zoomLevel.toFixed(2)}`;
                            navigator.clipboard.writeText(urlWithCoords).then(() => {
                                setDialogueWithRevert(`Share link copied to clipboard`, setDialogueText);
                            });
                        } else {
                            // Logged in and can publish: normal publish flow
                            setDialogueWithRevert("Publishing and generating share link...", setDialogueText);
                            publishState(currentStateName, true).then((success) => {
                                if (success) {
                                    const baseUrl = `${window.location.origin}/@${username}/${currentStateName}`;
                                    let targetX, targetY;

                                    // Check if there's an active selection
                                    if (selectionStart !== null && selectionEnd !== null) {
                                        // Use center of selection
                                        const normalized = getNormalizedSelection();
                                        if (normalized) {
                                            targetX = Math.floor((normalized.startX + normalized.endX) / 2);
                                            targetY = Math.floor((normalized.startY + normalized.endY) / 2);
                                        }
                                    } else {
                                        // Use cursor position
                                        targetX = cursorPos.x;
                                        targetY = cursorPos.y;
                                    }

                                    const urlWithCoords = `${baseUrl}?v=${targetX}.${targetY}.${zoomLevel.toFixed(2)}`;
                                    navigator.clipboard.writeText(urlWithCoords).then(() => {
                                        setDialogueWithRevert(`Share link copied to clipboard`, setDialogueText);
                                    });
                                } else {
                                    setDialogueWithRevert(`Failed to publish state "${currentStateName}"`, setDialogueText);
                                }
                            });
                        }
                    } else {
                        // No state name (e.g., public worlds like /base) - just share current URL with coordinates
                        const baseUrl = window.location.href.split('?')[0]; // Current URL without query params
                        let targetX, targetY;

                        // Check if there's an active selection
                        if (selectionStart !== null && selectionEnd !== null) {
                            // Use center of selection
                            const normalized = getNormalizedSelection();
                            if (normalized) {
                                targetX = Math.floor((normalized.startX + normalized.endX) / 2);
                                targetY = Math.floor((normalized.startY + normalized.endY) / 2);
                            }
                        } else {
                            // Use cursor position
                            targetX = cursorPos.x;
                            targetY = cursorPos.y;
                        }

                        const urlWithCoords = `${baseUrl}?v=${targetX}.${targetY}.${zoomLevel.toFixed(2)}`;
                        navigator.clipboard.writeText(urlWithCoords).then(() => {
                            setDialogueWithRevert(`Share link copied to clipboard`, setDialogueText);
                        });

                        // Log share event for analytics (public worlds only)
                        if (userUid === 'public' && worldId) {
                            const sharePath = `worlds/public/${worldId}/shares/${Date.now()}`;
                            const shareData = {
                                position: { x: targetX, y: targetY },
                                zoom: zoomLevel,
                                timestamp: serverTimestamp(),
                                url: urlWithCoords,
                                hasSelection: selectionStart !== null && selectionEnd !== null
                            };
                            set(ref(database, sharePath), shareData).catch((error) => {
                                logger.error('Failed to log share event:', error);
                            });
                        }
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
                } else if (exec.command === 'state' && exec.args.length >= 2 && exec.args[0] === '--rm') {
                    // Delete state command: /state --rm <stateName>
                    const stateName = exec.args[1];
                    setDialogueWithRevert(`Deleting state "${stateName}"...`, setDialogueText);
                    deleteState(stateName).then((success) => {
                        if (success) {
                            loadAvailableStates().then(setAvailableStates);
                            setDialogueWithRevert(`State "${stateName}" deleted successfully`, setDialogueText);
                        } else {
                            setDialogueWithRevert(`Failed to delete state "${stateName}"`, setDialogueText);
                        }
                    });
                } else if (exec.command === 'state' && exec.args.length >= 3 && exec.args[0] === '--mv') {
                    // Rename state command: /state --mv <oldName> <newName>
                    const oldName = exec.args[1];
                    const newName = exec.args[2];
                    setDialogueWithRevert(`Renaming state "${oldName}" to "${newName}"...`, setDialogueText);
                    renameState(oldName, newName).then((success) => {
                        if (success) {
                            loadAvailableStates().then(setAvailableStates);
                            setDialogueWithRevert(`State "${oldName}" renamed to "${newName}" successfully`, setDialogueText);
                        } else {
                            setDialogueWithRevert(`Failed to rename state "${oldName}"`, setDialogueText);
                        }
                    });
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
                } else if (exec.command === 'spawn') {
                    // Set spawn point at current cursor position
                    const spawnPoint = { x: cursorPos.x, y: cursorPos.y };

                    // Update settings with spawn point
                    const newSettings = { spawnPoint };
                    updateSettings(newSettings);
                    setDialogueWithRevert(`Spawn point set at (${spawnPoint.x}, ${spawnPoint.y})`, setDialogueText);
                } else if (exec.command === 'stage') {
                    // Check if using template file (--up flag)
                    const hasUpFlag = exec.args.length > 0 && exec.args[0] === '--up';

                    if (hasUpFlag) {
                        // Open file picker for .nara or .stage template
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = '.nara,.stage,.json';

                        input.onchange = (e) => {
                            const file = (e.target as HTMLInputElement).files?.[0];
                            if (!file) return;

                            setDialogueWithRevert(`Loading ${file.name}...`, setDialogueText);

                            const reader = new FileReader();
                            reader.onload = (event) => {
                                const templateContent = event.target?.result as string;

                                import('./stage.parser').then(({ parseAndRenderTemplate }) => {
                                    parseAndRenderTemplate(templateContent, cursorPos)
                                        .then(({ textData, imageData }) => {
                                            setLightModeData(textData);
                                            setStagedImageData(imageData);
                                            setDialogueWithRevert(`Template staged: ${file.name}`, setDialogueText);
                                        })
                                        .catch((error) => {
                                            setDialogueWithRevert(`Failed to parse template: ${error.message}`, setDialogueText);
                                        });
                                });
                            };

                            reader.onerror = () => {
                                setDialogueWithRevert('Failed to read template file', setDialogueText);
                            };

                            reader.readAsText(file);
                        };

                        input.click();
                        return true; // Command handled
                    }

                    // Original hardcoded template behavior
                    // Stage a structured artifact with image + text regions
                    // Default image if no URL provided
                    const defaultImageUrl = 'https://d2w9rnfcy7mm78.cloudfront.net/40233614/original_0d11441860fbe41b13c3a9bf97c18e42.webp?1760119834?bc=0';
                    const imageUrl = exec.args.length > 0 ? exec.args[0] : defaultImageUrl;

                    setDialogueWithRevert("Staging artifact...", setDialogueText);

                    // Bogus text generator
                    const generateBogusText = (length: number): string => {
                        const words = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua'];
                        let result = '';
                        for (let i = 0; i < length; i++) {
                            result += words[Math.floor(Math.random() * words.length)] + ' ';
                        }
                        return result.trim();
                    };

                    // Load image to get dimensions
                    const img = new Image();
                    img.crossOrigin = 'anonymous';

                    img.onload = () => {
                        // Image dimensions: 40 cells wide
                        const imageWidthInCells = 40;
                        const aspectRatio = img.height / img.width;
                        const imageHeightInCells = Math.round(imageWidthInCells * aspectRatio);

                        const startX = cursorPos.x;
                        const startY = cursorPos.y;

                        // Create structured artifact
                        const stagedData: any = {};
                        const stagedImages: ImageData[] = [];

                        // === TITLE (above image) ===
                        const titleText = generateBogusText(3).toUpperCase();
                        let titleY = startY - 3;
                        for (let i = 0; i < titleText.length; i++) {
                            const key = `${startX + i},${titleY}`;
                            stagedData[key] = titleText[i];
                        }

                        // === MAIN IMAGE ===
                        const imageData: ImageData = {
                            type: 'image',
                            src: imageUrl,
                            startX,
                            startY,
                            endX: startX + imageWidthInCells,
                            endY: startY + imageHeightInCells,
                            originalWidth: img.width,
                            originalHeight: img.height
                        };
                        stagedImages.push(imageData);

                        // === CAPTION (below image) ===
                        const captionText = generateBogusText(8);
                        let captionY = startY + imageHeightInCells + 2;
                        const captionWidth = imageWidthInCells;

                        // Word wrap caption
                        const captionWords = captionText.split(' ');
                        let currentLine = '';
                        let lineY = captionY;

                        for (const word of captionWords) {
                            const testLine = currentLine ? `${currentLine} ${word}` : word;
                            if (testLine.length <= captionWidth) {
                                currentLine = testLine;
                            } else {
                                // Write current line
                                for (let i = 0; i < currentLine.length; i++) {
                                    const key = `${startX + i},${lineY}`;
                                    stagedData[key] = currentLine[i];
                                }
                                lineY++;
                                currentLine = word;
                            }
                        }
                        // Write final line
                        if (currentLine) {
                            for (let i = 0; i < currentLine.length; i++) {
                                const key = `${startX + i},${lineY}`;
                                stagedData[key] = currentLine[i];
                            }
                        }

                        // === SIDEBAR TEXT (right of image) ===
                        const sidebarX = startX + imageWidthInCells + 3;
                        const sidebarWidth = 30;
                        const sidebarStartY = startY;

                        // Sidebar header
                        const sidebarHeader = 'NOTES';
                        for (let i = 0; i < sidebarHeader.length; i++) {
                            const key = `${sidebarX + i},${sidebarStartY}`;
                            stagedData[key] = sidebarHeader[i];
                        }

                        // Sidebar divider
                        const dividerY = sidebarStartY + 1;
                        for (let i = 0; i < sidebarWidth; i++) {
                            const key = `${sidebarX + i},${dividerY}`;
                            stagedData[key] = '-';
                        }

                        // Sidebar body text (multiple lines)
                        const sidebarText = generateBogusText(40);
                        const sidebarWords = sidebarText.split(' ');
                        let sidebarLine = '';
                        let sidebarLineY = dividerY + 2;

                        for (const word of sidebarWords) {
                            const testLine = sidebarLine ? `${sidebarLine} ${word}` : word;
                            if (testLine.length <= sidebarWidth) {
                                sidebarLine = testLine;
                            } else {
                                // Write line
                                for (let i = 0; i < sidebarLine.length; i++) {
                                    const key = `${sidebarX + i},${sidebarLineY}`;
                                    stagedData[key] = sidebarLine[i];
                                }
                                sidebarLineY++;
                                sidebarLine = word;
                            }
                        }
                        // Write final line
                        if (sidebarLine) {
                            for (let i = 0; i < sidebarLine.length; i++) {
                                const key = `${sidebarX + i},${sidebarLineY}`;
                                stagedData[key] = sidebarLine[i];
                            }
                        }

                        // === FOOTER (centered below everything) ===
                        const footerY = startY + imageHeightInCells + 5;
                        const footerText = '— ' + generateBogusText(2) + ' —';
                        const footerStartX = startX + Math.floor((imageWidthInCells - footerText.length) / 2);
                        for (let i = 0; i < footerText.length; i++) {
                            const key = `${footerStartX + i},${footerY}`;
                            stagedData[key] = footerText[i];
                        }

                        // Store in ephemeral light mode data (text) and staged images
                        setLightModeData(stagedData);
                        setStagedImageData(stagedImages);

                        setDialogueWithRevert(`Artifact staged (ephemeral) - press Escape to clear`, setDialogueText);
                    };

                    img.onerror = () => {
                        setDialogueWithRevert("Failed to load image. Check URL.", setDialogueText);
                    };

                    img.src = imageUrl;
                } else if (exec.command === 'zoom') {
                    // Gradually zoom in by 30%
                    const startZoom = zoomLevel;
                    const targetZoom = startZoom * 1.3;
                    const duration = 500; // 500ms animation
                    const startTime = Date.now();

                    const animateZoom = () => {
                        const elapsed = Date.now() - startTime;
                        const progress = Math.min(elapsed / duration, 1);

                        // Easing function for smooth animation (ease-out)
                        const easeProgress = 1 - Math.pow(1 - progress, 3);

                        const currentZoom = startZoom + (targetZoom - startZoom) * easeProgress;
                        setZoomLevel(currentZoom);

                        if (progress < 1) {
                            requestAnimationFrame(animateZoom);
                        }
                    };

                    requestAnimationFrame(animateZoom);
                    setDialogueWithRevert(`Zooming to ${Math.round(targetZoom * 100)}%`, setDialogueText);
                } else if (exec.command === 'agent') {
                    // Toggle agent
                    const newAgentEnabled = !agentEnabled;
                    setAgentEnabled(newAgentEnabled);

                    if (newAgentEnabled) {
                        // Initialize agent at viewport center
                        const centerPos = getViewportCenter();
                        setAgentPos(centerPos);
                        setAgentStartPos(centerPos); // Set initial start position
                        setAgentState('idle');
                        setAgentIdleTimer(0);
                        setDialogueWithRevert("Agent enabled", setDialogueText);
                    } else {
                        setDialogueWithRevert("Agent disabled", setDialogueText);
                    }
                } else if (exec.command === 'full') {
                    // Toggle fullscreen mode for bound/list at cursor
                    if (isFullscreenMode) {
                        // Exit fullscreen mode
                        exitFullscreenMode();
                        setDialogueWithRevert("Exited fullscreen mode", setDialogueText);
                    } else {
                        // Find bound or list at cursor position
                        const cursorX = cursorPos.x;
                        const cursorY = cursorPos.y;
                        let foundRegion = false;

                        // Check for bound at cursor
                        for (const key in worldData) {
                            if (key.startsWith('bound_')) {
                                try {
                                    const boundData = JSON.parse(worldData[key] as string);
                                    const { startX, endX, startY, endY, maxY } = boundData;
                                    const actualEndY = maxY !== null && maxY !== undefined ? maxY : endY;

                                    // Check if cursor is within bound
                                    if (cursorX >= startX && cursorX <= endX &&
                                        cursorY >= startY && cursorY <= actualEndY) {
                                        setFullscreenMode(true, {
                                            type: 'bound',
                                            key,
                                            startX,
                                            endX,
                                            startY,
                                            endY: actualEndY
                                        });
                                        setDialogueWithRevert("Entered fullscreen mode - Press Escape or /full to exit", setDialogueText);
                                        foundRegion = true;
                                        break;
                                    }
                                } catch (e) {
                                    // Skip invalid bound data
                                }
                            }
                        }

                        // If no bound found, check for list
                        if (!foundRegion) {
                            for (const key in worldData) {
                                if (key.startsWith('list_')) {
                                    try {
                                        const listData = JSON.parse(worldData[key] as string);
                                        const { startX, endX, startY, visibleHeight } = listData;
                                        const endY = startY + visibleHeight - 1;

                                        // Check if cursor is within list viewport
                                        if (cursorX >= startX && cursorX <= endX &&
                                            cursorY >= startY && cursorY <= endY) {
                                            setFullscreenMode(true, {
                                                type: 'list',
                                                key,
                                                startX,
                                                endX,
                                                startY,
                                                endY
                                            });
                                            setDialogueWithRevert("Entered fullscreen mode - Press Escape or /full to exit", setDialogueText);
                                            foundRegion = true;
                                            break;
                                        }
                                    } catch (e) {
                                        // Skip invalid list data
                                    }
                                }
                            }
                        }

                        if (!foundRegion) {
                            setDialogueWithRevert("No bound or list found at cursor position", setDialogueText);
                        }
                    }
                } else if (exec.command === 'clear') {
                    // Clear the entire canvas
                    setWorldData({});
                    setChatData({});
                    setSearchData({});
                    clearLightModeData();
                    // Clear client-side data
                    setClipboardItems([]);
                    setStagedImageData([]);
                    setHostData(null);
                    // Reset cursor to origin
                    setCursorPos({ x: 0, y: 0 });
                    // Clear any selections
                    setSelectionStart(null);
                    setSelectionEnd(null);
                    // Clear cluster labels and frames
                    setClusterLabels([]);
                    setTextFrames([]);
                    setHierarchicalFrames(null);
                    // Clear Firebase data (canonical + all client channels)
                    if (clearWorldData) {
                        clearWorldData().catch(err => {
                            logger.error('Failed to clear Firebase data:', err);
                        });
                    }
                    setDialogueWithRevert("Canvas cleared", setDialogueText);
                } else if (exec.command === 'replay') {
                    // Replay the canvas creation sequence
                    const speed = exec.args && exec.args.length > 0 ? parseInt(exec.args[0], 10) : 100;

                    setDialogueWithRevert("Loading replay...", setDialogueText);

                    if (fetchReplayLog) {
                        fetchReplayLog().then((replayLog) => {
                            if (replayLog.length === 0) {
                                setDialogueWithRevert("No replay data available", setDialogueText);
                                return;
                            }

                            setDialogueWithRevert(`Replaying ${replayLog.length} changes at ${speed}ms per change...`, setDialogueText);

                            // Clear canvas first
                            setWorldData({});

                            // Replay each change in sequence
                            let index = 0;
                            const replayInterval = setInterval(() => {
                                if (index >= replayLog.length) {
                                    clearInterval(replayInterval);
                                    setDialogueWithRevert("Replay complete", setDialogueText);
                                    return;
                                }

                                const entry = replayLog[index];
                                setWorldData(prev => {
                                    const next = { ...prev };
                                    if (entry.value === null) {
                                        // Deletion
                                        delete next[entry.key];
                                    } else {
                                        // Addition or update
                                        next[entry.key] = entry.value;
                                    }
                                    return next;
                                });

                                index++;
                            }, speed);
                        }).catch(err => {
                            logger.error('Failed to fetch replay log:', err);
                            setDialogueWithRevert("Failed to load replay data", setDialogueText);
                        });
                    } else {
                        setDialogueWithRevert("Replay not available for this world", setDialogueText);
                    }
                } else if (exec.command === 'clip') {
                    // Paste clipboard content at cursor
                    if (exec.clipContent) {
                        const lines = exec.clipContent.split('\n');
                        const startX = cursorPos.x;
                        const startY = cursorPos.y;

                        // Place text line by line
                        for (let i = 0; i < lines.length; i++) {
                            const line = lines[i];
                            for (let j = 0; j < line.length; j++) {
                                const char = line[j];
                                const key = `${startX + j},${startY + i}`;
                                setWorldData(prev => ({
                                    ...prev,
                                    [key]: { char, color: textColor }
                                }));
                            }
                        }

                        // Move cursor to end of pasted content
                        const lastLine = lines[lines.length - 1];
                        setCursorPos({
                            x: startX + lastLine.length,
                            y: startY + lines.length - 1
                        });

                        setDialogueWithRevert(`Pasted clipboard item`, setDialogueText);
                    }
                } else if (exec.command === 'latex') {
                    // Activate LaTeX input mode
                    setLatexMode({
                        isActive: true,
                        currentInput: '',
                        inputPositions: [],
                        startPos: exec.commandStartPos,
                        previewImage: null
                    });
                    setDialogueWithRevert("LaTeX mode active - Type your equation, press Enter to render", setDialogueText);
                } else if (exec.command === 'smiles') {
                    // Activate SMILES input mode
                    setSmilesMode({
                        isActive: true,
                        currentInput: '',
                        inputPositions: [],
                        startPos: exec.commandStartPos,
                        previewImage: null
                    });
                    setDialogueWithRevert("SMILES mode active - Type molecule notation, press Enter to render", setDialogueText);
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
                } else if (exec.command === 'list') {
                    logger.debug('List command execution:', exec);

                    // Create scrollable list from selection
                    const selection = getNormalizedSelection();

                    if (selection) {
                        // Calculate visible height from selection size (full selection, no title bar)
                        const selectionHeight = selection.endY - selection.startY + 1; // Full selection height
                        let visibleHeight = selectionHeight; // Use selection as viewport size
                        let color = '#FF8800'; // Default orange (not used for rendering, just metadata)
                        let totalContentLines = 100; // Default total capacity (creates scrollable list)

                        // Optional argument: color only (no height override)
                        if (exec.args.length > 0) {
                            color = exec.args[0];
                        }


                        // Capture existing content in selection region as initial list content
                        const initialContent: ListContent = {};
                        let lineIndex = 0;

                        // Capture existing text from selection (entire selection, no title bar)
                        for (let y = selection.startY; y <= selection.endY; y++) {
                            let lineText = '';
                            for (let x = selection.startX; x <= selection.endX; x++) {
                                const key = `${x},${y}`;
                                const charData = worldData[key];
                                if (charData && !isImageData(charData)) {
                                    lineText += getCharacter(charData);
                                } else {
                                    lineText += ' ';
                                }
                            }
                            // Store line even if empty (preserves structure)
                            initialContent[lineIndex] = lineText;
                            lineIndex++;
                        }

                        // Start with just the captured content - no pre-allocation
                        const capturedLines = lineIndex;


                        // Create list metadata
                        const listKey = `list_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                        const listData: ListData = {
                            startX: selection.startX,
                            endX: selection.endX,
                            startY: selection.startY,
                            visibleHeight: visibleHeight,
                            scrollOffset: 0,
                            color: color
                        };


                        // Store list and content
                        let newWorldData = { ...worldData };
                        newWorldData[listKey] = JSON.stringify(listData);
                        newWorldData[`${listKey}_content`] = JSON.stringify(initialContent);


                        // Clear the selection area (content now in list storage)
                        for (let y = selection.startY; y <= selection.endY; y++) {
                            for (let x = selection.startX; x <= selection.endX; x++) {
                                delete newWorldData[`${x},${y}`];
                            }
                        }

                        setWorldData(newWorldData);
                        setDialogueWithRevert(`List created with ${lineIndex} lines (${visibleHeight} visible)`, setDialogueText);

                        // Clear selection
                        setSelectionStart(null);
                        setSelectionEnd(null);
                    } else {
                        setDialogueWithRevert(`No region selected. Select an area first, then use /list [visibleHeight] [color]`, setDialogueText);
                    }
                } else if (exec.command === 'unlist') {
                    // Find and remove any list that contains the cursor position
                    const cursorX = cursorPos.x;
                    const cursorY = cursorPos.y;
                    let foundList = false;
                    let newWorldData = { ...worldData };


                    // Look through all list_ entries to find one that contains the cursor
                    for (const key in worldData) {
                        if (key.startsWith('list_')) {
                            try {
                                const listData = JSON.parse(worldData[key] as string);

                                // Check if cursor is within the list viewport
                                const withinList = cursorX >= listData.startX && cursorX <= listData.endX &&
                                                  cursorY >= listData.startY && cursorY < listData.startY + listData.visibleHeight;

                                if (withinList) {
                                    // Remove this list and its content
                                    delete newWorldData[key];
                                    delete newWorldData[`${key}_content`];
                                    foundList = true;
                                }
                            } catch (e) {
                                console.error('Error parsing list data:', key, e);
                            }
                        }
                    }

                    if (foundList) {
                        setWorldData(newWorldData);
                        setDialogueWithRevert(`List removed`, setDialogueText);
                    } else {
                        setDialogueWithRevert(`No list found at cursor position`, setDialogueText);
                    }
                } else if (exec.command === 'glitch') {
                    // Create glitched region with 1:1 square cells by subdividing each cell vertically
                    const selection = getNormalizedSelection();

                    if (!selection) {
                        setDialogueWithRevert(`Select a region to glitch (minimum 1x2)`, setDialogueText);
                        return true;
                    }

                    const width = selection.endX - selection.startX + 1;
                    const height = selection.endY - selection.startY + 1;

                    // Validate minimum size (at least 1x2 - one row, two columns)
                    if (width < 2 && height < 2) {
                        setDialogueWithRevert(`Glitch region must be at least 1x2 (one row, two columns)`, setDialogueText);
                        setSelectionStart(null);
                        setSelectionEnd(null);
                        return true;
                    }

                    const newWorldData = { ...worldData };

                    // Remove any existing text in the selected region
                    for (let y = selection.startY; y <= selection.endY; y++) {
                        for (let x = selection.startX; x <= selection.endX; x++) {
                            const key = `${x},${y}`;
                            delete newWorldData[key];
                        }
                    }

                    // Create glitch metadata entry to mark this region as glitched
                    const glitchKey = `glitched_${selection.startX},${selection.startY}`;
                    const glitchData = {
                        startX: selection.startX,
                        endX: selection.endX,
                        startY: selection.startY,
                        endY: selection.endY
                    };
                    newWorldData[glitchKey] = JSON.stringify(glitchData);

                    setWorldData(newWorldData);

                    // Clear selection
                    setSelectionStart(null);
                    setSelectionEnd(null);

                    setDialogueWithRevert(`Region glitched (${width}x${height} → ${width}x${height*2} square cells)`, setDialogueText);
                } else if (exec.command === 'upload') {
                    // Check if there's a selection for image placement
                    const selection = getNormalizedSelection();
                    if (!selection) {
                        setDialogueWithRevert("Please select a region first, then use /upload", setDialogueText);
                        return true;
                    }

                    // Check if --bitmap flag is present
                    const isBitmapMode = exec.args.includes('--bitmap');

                    // Create and trigger file input
                    const fileInput = document.createElement('input');
                    fileInput.type = 'file';
                    fileInput.accept = 'image/*';
                    fileInput.style.display = 'none';

                    fileInput.onchange = async (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (!file) return;

                        try {
                            setDialogueWithRevert(isBitmapMode ? "Processing bitmap..." : "Processing image...", setDialogueText);

                            // Check if file is a GIF
                            const isGIF = file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');

                            if (isGIF && !isBitmapMode) {
                                // Parse GIF and show immediately (optimistic), upload in background
                                const arrayBufferReader = new FileReader();
                                arrayBufferReader.onload = async (event) => {
                                    const arrayBuffer = event.target?.result as ArrayBuffer;

                                    try {
                                        setDialogueWithRevert("Loading GIF...", setDialogueText);

                                        const parsedGIF = parseGIFFromArrayBuffer(arrayBuffer);

                                        if (!parsedGIF || !parsedGIF.frames || parsedGIF.frames.length === 0) {
                                            setDialogueWithRevert("Error parsing GIF, falling back to static image", setDialogueText);
                                            // Fall back to regular image upload
                                            const reader = new FileReader();
                                            reader.onload = async (e) => {
                                                const dataUrl = e.target?.result as string;
                                                const img = new Image();
                                                img.onload = async () => {
                                                    const selectionWidth = selection.endX - selection.startX + 1;
                                                    const selectionHeight = selection.endY - selection.startY + 1;
                                                    const storageUrl = await uploadImageToStorage(dataUrl);
                                                    const imageData: ImageData = {
                                                        type: 'image',
                                                        src: storageUrl,
                                                        startX: selection.startX,
                                                        startY: selection.startY,
                                                        endX: selection.endX,
                                                        endY: selection.endY,
                                                        originalWidth: img.width,
                                                        originalHeight: img.height
                                                    };
                                                    const imageKey = `image_${selection.startX},${selection.startY}`;
                                                    setWorldData(prev => ({ ...prev, [imageKey]: imageData }));
                                                    setSelectionStart(null);
                                                    setSelectionEnd(null);
                                                    setDialogueWithRevert(`Image uploaded to region (${selectionWidth}x${selectionHeight} cells)`, setDialogueText);
                                                };
                                                img.src = dataUrl;
                                            };
                                            reader.readAsDataURL(file);
                                            return true;
                                        }

                                        // Calculate selection dimensions
                                        const selectionWidth = selection.endX - selection.startX + 1;
                                        const selectionHeight = selection.endY - selection.startY + 1;

                                        // Convert frames to local data URLs immediately
                                        const localFrameTiming: Array<{ url: string; delay: number }> = [];

                                        for (let i = 0; i < parsedGIF.frames.length; i++) {
                                            const frame = parsedGIF.frames[i];

                                            // Create canvas to convert ImageData to data URL
                                            const canvas = document.createElement('canvas');
                                            canvas.width = frame.imageData.width;
                                            canvas.height = frame.imageData.height;
                                            const ctx = canvas.getContext('2d');

                                            if (ctx) {
                                                ctx.putImageData(frame.imageData, 0, 0);
                                                const frameDataUrl = canvas.toDataURL('image/png');

                                                localFrameTiming.push({
                                                    url: frameDataUrl,
                                                    delay: frame.delay
                                                });
                                            }
                                        }

                                        // Create image key
                                        const imageKey = `image_${selection.startX},${selection.startY}`;

                                        // Show GIF immediately with local data URLs (optimistic)
                                        const optimisticImageData: ImageData = {
                                            type: 'image',
                                            src: localFrameTiming[0].url,
                                            startX: selection.startX,
                                            startY: selection.startY,
                                            endX: selection.endX,
                                            endY: selection.endY,
                                            originalWidth: parsedGIF.width,
                                            originalHeight: parsedGIF.height,
                                            isAnimated: true,
                                            frameTiming: localFrameTiming,
                                            totalDuration: parsedGIF.totalDuration,
                                            animationStartTime: Date.now()
                                        };

                                        setWorldData(prev => ({
                                            ...prev,
                                            [imageKey]: optimisticImageData
                                        }));

                                        // Clear selection immediately
                                        setSelectionStart(null);
                                        setSelectionEnd(null);

                                        setDialogueWithRevert(`GIF loaded (${localFrameTiming.length} frames)`, setDialogueText);

                                        // Upload to Firebase in background
                                        (async () => {
                                            const uploadedFrameTiming: Array<{ url: string; delay: number }> = [];

                                            for (let i = 0; i < localFrameTiming.length; i++) {
                                                const frameStorageUrl = await uploadImageToStorage(localFrameTiming[i].url);
                                                uploadedFrameTiming.push({
                                                    url: frameStorageUrl,
                                                    delay: localFrameTiming[i].delay
                                                });
                                            }

                                            // Update with Firebase URLs once upload complete
                                            setWorldData(prev => {
                                                const existing = prev[imageKey];
                                                if (existing && typeof existing === 'object' && 'type' in existing && existing.type === 'image') {
                                                    return {
                                                        ...prev,
                                                        [imageKey]: {
                                                            ...existing,
                                                            src: uploadedFrameTiming[0].url,
                                                            frameTiming: uploadedFrameTiming
                                                        }
                                                    };
                                                }
                                                return prev;
                                            });
                                        })();
                                    } catch (error) {
                                        logger.error('Error parsing GIF:', error);
                                        setDialogueWithRevert("Error parsing GIF animation", setDialogueText);
                                    }
                                };
                                arrayBufferReader.readAsArrayBuffer(file);
                            } else {
                                // Regular image upload (non-GIF or bitmap mode)
                                const reader = new FileReader();
                                reader.onload = async (event) => {
                                    const dataUrl = event.target?.result as string;

                                    // Create image to get dimensions
                                    const img = new Image();
                                    img.onload = async () => {
                                        // Calculate selection dimensions
                                        const selectionWidth = selection.endX - selection.startX + 1;
                                        const selectionHeight = selection.endY - selection.startY + 1;

                                        let finalSrc = dataUrl;

                                        if (isBitmapMode) {
                                            try {
                                                // Import bitmap processing utilities
                                                const { processImageToBitmap } = await import('./image.bitmap');

                                                // Use the larger of the two selection dimensions for grid size
                                                const gridSize = Math.max(selectionWidth, selectionHeight);

                                                // Process image to bitmap using current text color
                                                const bitmapCanvas = processImageToBitmap(img, {
                                                    gridSize,
                                                    color: textColor
                                                });

                                                // Convert bitmap canvas to data URL
                                                finalSrc = bitmapCanvas.toDataURL();
                                            } catch (bitmapError) {
                                                logger.error('Error processing bitmap:', bitmapError);
                                                setDialogueWithRevert("Error processing bitmap, using original image", setDialogueText);
                                            }
                                        }

                                        // Upload to Firebase Storage and get URL
                                        const storageUrl = await uploadImageToStorage(finalSrc);

                                        // Create image data entry
                                        const imageData: ImageData = {
                                            type: 'image',
                                            src: storageUrl,
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

                                        const modeText = isBitmapMode ? "Bitmap" : "Image";
                                        setDialogueWithRevert(`${modeText} uploaded to region (${selectionWidth}x${selectionHeight} cells)`, setDialogueText);
                                    };
                                    img.src = dataUrl;
                                };
                                reader.readAsDataURL(file);
                            }
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

        // === Restore Previous Background (from /bg over image) ===
        // Only runs if command mode didn't consume the ESC key
        if (key === 'Escape' && restorePreviousBackground()) {
            setDialogueWithRevert("Background restored", setDialogueText);
            return true;
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
                        // Don't add a position for the newline - it's not a visible character
                        inputPositions: prev.inputPositions
                    }));

                    // Move cursor to next line at start position
                    setCursorPos({ x: startX, y: cursorPos.y + 1 });
                    return true;
                } else if (metaKey || ctrlKey) {
                    // Cmd+Enter (or Ctrl+Enter): Send chat message and write response directly to canvas
                    if (chatMode.currentInput.trim() && !chatMode.isProcessing) {
                        setChatMode(prev => ({ ...prev, isProcessing: true }));
                        setDialogueWithRevert("Processing...", setDialogueText);

                        callChatAPI(chatMode.currentInput.trim(), true, userUid || undefined).then((response) => {
                            // Check if quota exceeded
                            if (response.startsWith('AI limit reached')) {
                                if (upgradeFlowHandlerRef.current) {
                                    upgradeFlowHandlerRef.current();
                                }
                                setChatMode(prev => ({ ...prev, isProcessing: false }));
                                return true;
                            }

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

                        callChatAPI(chatMode.currentInput.trim(), true, userUid || undefined).then((response) => {
                            // Check if quota exceeded
                            if (response.startsWith('AI limit reached')) {
                                if (upgradeFlowHandlerRef.current) {
                                    upgradeFlowHandlerRef.current();
                                }
                                setChatMode(prev => ({ ...prev, isProcessing: false }));
                                return true;
                            }

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
                // Only allow exiting chat mode if NOT in host mode
                if (!hostMode.isActive) {
                    // Cancel any active composition before exiting
                    if (isComposingRef.current) {
                        compositionCancelledByModeExitRef.current = true;
                        setIsComposing(false);
                        isComposingRef.current = false;
                        setCompositionText('');
                        setCompositionStartPos(null);
                        compositionStartPosRef.current = null;
                        justTypedCharRef.current = false;
                        preCompositionCursorPosRef.current = null;
                        justCancelledCompositionRef.current = false;
                    }

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
                // In host mode, Escape does nothing - user stays in chat mode
                return true;
            } else if (key.length === 1 && !isComposingRef.current) {
                // Add character to chat input (skip during IME composition)
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

                // Mark that we just typed a character (for IME composition logic)
                if (key !== ' ') {
                    justTypedCharRef.current = true;
                }

                return true;
            } else if (key === 'Backspace') {
                if (metaKey) {
                    // Cmd+Backspace: Delete entire line (current line of chat input)
                    if (chatMode.currentInput.length > 0) {
                        // Find the start of current line in the input
                        const lines = chatMode.currentInput.split('\n');
                        const currentLineIndex = lines.length - 1; // We're always at the last line in chat mode

                        // Remove the last line
                        lines.pop();
                        const newInput = lines.join('\n');

                        // Find positions to remove (all positions from the start of last line)
                        const firstPosOfLine = chatMode.inputPositions.findIndex((pos, idx) => {
                            // Count newlines up to this position
                            const inputUpToHere = chatMode.currentInput.slice(0, idx);
                            const newlinesCount = (inputUpToHere.match(/\n/g) || []).length;
                            return newlinesCount === currentLineIndex;
                        });

                        const positionsToKeep = firstPosOfLine >= 0 ?
                            chatMode.inputPositions.slice(0, firstPosOfLine) :
                            [];

                        // Clear chat data for removed positions
                        setChatData(prev => {
                            const newChatData = { ...prev };
                            const positionsToRemove = firstPosOfLine >= 0 ?
                                chatMode.inputPositions.slice(firstPosOfLine) :
                                chatMode.inputPositions;

                            positionsToRemove.forEach(pos => {
                                delete newChatData[`${pos.x},${pos.y}`];
                            });
                            return newChatData;
                        });

                        setChatMode(prev => ({
                            ...prev,
                            currentInput: newInput,
                            inputPositions: positionsToKeep
                        }));

                        // Move cursor to end of previous line (if exists)
                        if (positionsToKeep.length > 0) {
                            const lastPos = positionsToKeep[positionsToKeep.length - 1];
                            setCursorPos({ x: lastPos.x + 1, y: lastPos.y });
                        } else {
                            // No more input, move to start
                            const startPos = chatMode.inputPositions[0] || cursorPos;
                            setCursorPos({ x: startPos.x, y: startPos.y });
                        }
                    }
                } else if (altKey) {
                    // Option+Backspace: Delete last word
                    if (chatMode.currentInput.length > 0) {
                        // Split by whitespace and newlines, but preserve newlines in the structure
                        const lastNewlineIndex = chatMode.currentInput.lastIndexOf('\n');
                        const currentLine = lastNewlineIndex >= 0 ?
                            chatMode.currentInput.slice(lastNewlineIndex + 1) :
                            chatMode.currentInput;

                        const words = currentLine.trim().split(/\s+/);

                        if (words.length > 0 && currentLine.length > 0) {
                            // Calculate how many characters to remove (last word + trailing spaces)
                            const lastWord = words[words.length - 1];
                            const charsToRemove = lastWord.length;

                            // Remove trailing spaces before the word
                            let additionalSpaces = 0;
                            for (let i = chatMode.currentInput.length - charsToRemove - 1; i >= 0; i--) {
                                if (chatMode.currentInput[i] === ' ' || chatMode.currentInput[i] === '\t') {
                                    additionalSpaces++;
                                } else {
                                    break;
                                }
                            }

                            const totalCharsToRemove = charsToRemove + additionalSpaces;
                            const newInput = chatMode.currentInput.slice(0, -totalCharsToRemove);
                            const positionsToKeep = chatMode.inputPositions.slice(0, -totalCharsToRemove);

                            // Clear chat data for removed positions
                            setChatData(prev => {
                                const newChatData = { ...prev };
                                const positionsToRemove = chatMode.inputPositions.slice(-totalCharsToRemove);

                                positionsToRemove.forEach(pos => {
                                    delete newChatData[`${pos.x},${pos.y}`];
                                });
                                return newChatData;
                            });

                            setChatMode(prev => ({
                                ...prev,
                                currentInput: newInput,
                                inputPositions: positionsToKeep
                            }));

                            // Move cursor to end of new input
                            if (positionsToKeep.length > 0) {
                                const lastPos = positionsToKeep[positionsToKeep.length - 1];
                                setCursorPos({ x: lastPos.x + 1, y: lastPos.y });
                            } else {
                                const startPos = chatMode.inputPositions[0] || cursorPos;
                                setCursorPos({ x: startPos.x, y: startPos.y });
                            }
                        }
                    }
                } else {
                    // Regular backspace
                    if (chatMode.currentInput.length > 0) {
                        // Check if we're deleting a newline character
                        const lastChar = chatMode.currentInput[chatMode.currentInput.length - 1];
                        const isNewline = lastChar === '\n';

                        // Remove last character from chat input
                        const newInput = chatMode.currentInput.slice(0, -1);

                        if (isNewline) {
                            // Backspacing over newline: just remove it from input string, keep positions unchanged
                            // The cursor should move to end of previous line (after last visible character)
                            const lastPos = chatMode.inputPositions[chatMode.inputPositions.length - 1];

                            setChatMode(prev => ({
                                ...prev,
                                currentInput: newInput,
                                // Don't remove any positions - newlines don't have positions
                                inputPositions: prev.inputPositions
                            }));

                            // Move cursor to end of previous line (after last character)
                            if (lastPos) {
                                setCursorPos({ x: lastPos.x + 1, y: lastPos.y });
                            }
                        } else {
                            // Regular character deletion
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
                    } else {
                        // No input to delete - just move cursor left (like regular backspace)
                        setCursorPos({ x: cursorPos.x - 1, y: cursorPos.y });
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
            // Special handling for /plan command - doesn't need text, just selection bounds
            if (pendingCommand.command === 'plan') {
                const selection = getNormalizedSelection();

                if (selection) {
                    // Check if there's a meaningful selection (not just a 1-cell cursor)
                    const hasMeaningfulSelection =
                        selection.startX !== selection.endX || selection.startY !== selection.endY;

                    if (!hasMeaningfulSelection) {
                        setDialogueWithRevert("Selection must span more than one cell", setDialogueText);
                    } else {
                        // Create plan region data
                        const noteRegion = {
                            startX: selection.startX,
                            endX: selection.endX,
                            startY: selection.startY,
                            endY: selection.endY,
                            timestamp: Date.now()
                        };

                        // Store note region in worldData with unique key
                        const noteKey = `note_${selection.startX},${selection.startY}_${Date.now()}`;
                        const newWorldData = { ...worldData };
                        newWorldData[noteKey] = JSON.stringify(noteRegion);
                        setWorldData(newWorldData);

                        const width = selection.endX - selection.startX + 1;
                        const height = selection.endY - selection.startY + 1;
                        setDialogueWithRevert(`Plan region saved (${width}×${height})`, setDialogueText);

                        // Clear selection
                        setSelectionStart(null);
                        setSelectionEnd(null);

                        // Clear pending command
                        setPendingCommand(null);
                    }
                } else {
                    setDialogueWithRevert("No region selected. Make a selection first, then press Enter", setDialogueText);
                }
                return true;
            }

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
                            callTransformAPI(selectedText, instructions, userUid || undefined).then((result) => {
                                // Check if quota exceeded
                                if (result.startsWith('AI limit reached')) {
                                    if (upgradeFlowHandlerRef.current) {
                                        upgradeFlowHandlerRef.current();
                                    }
                                    return true;
                                }

                                createSubtitleCycler(result, setDialogueText);
                            }).catch(() => {
                                setDialogueWithRevert(`Could not transform text`, setDialogueText);
                            });
                        }
                    } else if (exec.command === 'explain') {
                        const selectedText = exec.args[0];
                        const instructions = exec.args.length > 1 ? exec.args.slice(1).join(' ') : 'analysis';

                        setDialogueWithRevert("Processing explanation...", setDialogueText);
                        callExplainAPI(selectedText, instructions, userUid || undefined).then((result) => {
                            // Check if quota exceeded
                            if (result.startsWith('AI limit reached')) {
                                if (upgradeFlowHandlerRef.current) {
                                    upgradeFlowHandlerRef.current();
                                }
                                return true;
                            }

                            createSubtitleCycler(result, setDialogueText);
                        }).catch(() => {
                            setDialogueWithRevert(`Could not explain text`, setDialogueText);
                        });
                    } else if (exec.command === 'summarize') {
                        const selectedText = exec.args[0];
                        const focus = exec.args.length > 1 ? exec.args.slice(1).join(' ') : undefined;

                        setDialogueWithRevert("Processing summary...", setDialogueText);
                        callSummarizeAPI(selectedText, focus, userUid || undefined).then((result) => {
                            // Check if quota exceeded
                            if (result.startsWith('AI limit reached')) {
                                if (upgradeFlowHandlerRef.current) {
                                    upgradeFlowHandlerRef.current();
                                }
                                return true;
                            }

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
                    } else if (exec.command === 'list') {
                        // Create scrollable list from selection
                        const selection = getNormalizedSelection();

                        if (selection) {
                            // Parse arguments: [visibleHeight] [color]
                            let visibleHeight = 10; // Default visible lines
                            let color = '#B0B0B0'; // Default gray

                            if (exec.args.length > 0) {
                                const heightArg = parseInt(exec.args[0], 10);
                                if (!isNaN(heightArg) && heightArg > 0) {
                                    visibleHeight = heightArg;
                                }
                                if (exec.args.length > 1) {
                                    color = exec.args[1];
                                }
                            }

                            // Extract title from top bar
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

                            // Capture existing content in selection region as initial list content
                            const initialContent: ListContent = {};
                            let lineIndex = 0;

                            for (let y = selection.startY + 1; y <= selection.endY; y++) {
                                let lineText = '';
                                for (let x = selection.startX; x <= selection.endX; x++) {
                                    const key = `${x},${y}`;
                                    const charData = worldData[key];
                                    if (charData && !isImageData(charData)) {
                                        lineText += getCharacter(charData);
                                    } else {
                                        lineText += ' ';
                                    }
                                }
                                // Store line even if empty (preserves structure)
                                initialContent[lineIndex] = lineText;
                                lineIndex++;
                            }

                            // Create list metadata
                            const listKey = `list_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                            const listData: ListData = {
                                startX: selection.startX,
                                endX: selection.endX,
                                startY: selection.startY,
                                visibleHeight: visibleHeight,
                                scrollOffset: 0,
                                color: color,
                                title: title || undefined
                            };

                            // Store list and content
                            let newWorldData = { ...worldData };
                            newWorldData[listKey] = JSON.stringify(listData);
                            newWorldData[`${listKey}_content`] = JSON.stringify(initialContent);

                            // Clear the selection area (content now in list storage)
                            for (let y = selection.startY; y <= selection.endY; y++) {
                                for (let x = selection.startX; x <= selection.endX; x++) {
                                    delete newWorldData[`${x},${y}`];
                                }
                            }

                            setWorldData(newWorldData);
                            setDialogueWithRevert(`List created with ${lineIndex} lines (${visibleHeight} visible)`, setDialogueText);

                            // Clear selection
                            setSelectionStart(null);
                            setSelectionEnd(null);
                        } else {
                            setDialogueWithRevert(`No region selected. Select an area first, then use /list [visibleHeight] [color]`, setDialogueText);
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
        // === Note Mode - Confirm Region ===
        else if (key === 'Enter' && currentMode === 'note' && selectionStart && selectionEnd) {
            // Check if there's a meaningful selection (not just a 1-cell cursor)
            const hasMeaningfulSelection =
                selectionStart.x !== selectionEnd.x || selectionStart.y !== selectionEnd.y;

            if (!hasMeaningfulSelection) {
                // No meaningful selection - skip note region saving, let Enter behave normally
                // Don't return true, fall through to normal Enter handling
            } else {

            const minX = Math.floor(Math.min(selectionStart.x, selectionEnd.x));
            const maxX = Math.floor(Math.max(selectionStart.x, selectionEnd.x));
            const minY = Math.floor(Math.min(selectionStart.y, selectionEnd.y));
            const maxY = Math.floor(Math.max(selectionStart.y, selectionEnd.y));

            // Create note region data
            const noteRegion = {
                startX: minX,
                endX: maxX,
                startY: minY,
                endY: maxY,
                timestamp: Date.now()
            };

            // Store note region in worldData with unique key
            const noteKey = `note_${minX},${minY}_${Date.now()}`;
            setWorldData(prev => ({
                ...prev,
                [noteKey]: JSON.stringify(noteRegion)
            }));

            // Clear the selection after saving
            setSelectionStart(null);
            setSelectionEnd(null);

            const width = maxX - minX + 1;
            const height = maxY - minY + 1;
            setDialogueWithRevert(`Plan region saved (${width}×${height})`, setDialogueText);
            return true;
            }
        }
        // === Selection/Plan Region AI Fill (Cmd+Enter) ===
        else if (key === 'Enter' && metaKey && !chatMode.isActive) {
            // First priority: Check if there's an active selection
            let targetRegion: { startX: number, endX: number, startY: number, endY: number } | null = null;

            if (currentSelectionActive) {
                // Use the current selection as target region
                const minX = Math.floor(Math.min(selectionStart!.x, selectionEnd!.x));
                const maxX = Math.floor(Math.max(selectionStart!.x, selectionEnd!.x));
                const minY = Math.floor(Math.min(selectionStart!.y, selectionEnd!.y));
                const maxY = Math.floor(Math.max(selectionStart!.y, selectionEnd!.y));

                targetRegion = { startX: minX, endX: maxX, startY: minY, endY: maxY };
            } else {
                // Second priority: Check if cursor is inside a saved note region
                for (const key in worldData) {
                    if (key.startsWith('note_')) {
                        try {
                            const noteData = JSON.parse(worldData[key] as string);
                            if (cursorPos.x >= noteData.startX && cursorPos.x <= noteData.endX &&
                                cursorPos.y >= noteData.startY && cursorPos.y <= noteData.endY) {
                                targetRegion = noteData;
                                break;
                            }
                        } catch (e) {
                            // Skip invalid note data
                        }
                    }
                }

                // Third priority: Auto-detect if cursor/text is over an image
                if (!targetRegion) {
                    for (const key in worldData) {
                        if (key.startsWith('image_')) {
                            const imgData = worldData[key];
                            if (imgData && typeof imgData === 'object' && 'type' in imgData && imgData.type === 'image') {
                                const img = imgData as any;
                                // Check if cursor is within image bounds
                                if (cursorPos.x >= img.startX && cursorPos.x <= img.endX &&
                                    cursorPos.y >= img.startY && cursorPos.y <= img.endY) {
                                    // Found image under cursor - use image bounds as target region
                                    targetRegion = {
                                        startX: img.startX,
                                        endX: img.endX,
                                        startY: img.startY,
                                        endY: img.endY
                                    };
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            if (targetRegion) {
                // Check for existing image in the region
                let existingImageData: string | null = null;
                let existingImageKey: string | null = null;

                for (const key in worldData) {
                    if (key.startsWith('image_')) {
                        const imgData = worldData[key];
                        if (imgData && typeof imgData === 'object' && 'type' in imgData && imgData.type === 'image') {
                            const img = imgData as any;
                            // Check if image overlaps with target region
                            if (img.startX <= targetRegion.endX && img.endX >= targetRegion.startX &&
                                img.startY <= targetRegion.endY && img.endY >= targetRegion.startY) {
                                existingImageData = img.src;
                                existingImageKey = key;
                                break;
                            }
                        }
                    }
                }

                // Extract text from target region
                let textToSend = '';
                for (let y = targetRegion.startY; y <= targetRegion.endY; y++) {
                    let lineText = '';
                    for (let x = targetRegion.startX; x <= targetRegion.endX; x++) {
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
                    if (y < targetRegion.endY) textToSend += '\n';
                }

                if (textToSend.trim() || existingImageData) {
                    // Detect intent: image-to-image or text-to-image or text-to-text
                    const hasImageIntent = existingImageData ||
                        detectImageIntent(textToSend).intent === 'image';

                    if (hasImageIntent) {
                        // Image generation/editing path
                        setDialogueWithRevert("Generating image...", setDialogueText);

                        callGenerateImageAPI(textToSend.trim(), existingImageData || undefined, userUid || undefined).then(async (result) => {
                            // Check if quota exceeded
                            if (result.text && result.text.startsWith('AI limit reached')) {
                                if (upgradeFlowHandlerRef.current) {
                                    upgradeFlowHandlerRef.current();
                                }
                                return true;
                            }

                            if (!result.imageData) {
                                setDialogueWithRevert("Image generation failed", setDialogueText);
                                return true;
                            }

                            setDialogueWithRevert("Image generated successfully", setDialogueText);

                            // Load the generated image to get its dimensions
                            const img = new Image();
                            img.onload = async () => {
                                // Calculate grid cell size based on current zoom
                                const { width: charWidth, height: charHeight } = getEffectiveCharDims(zoomLevel);

                                // Calculate target region dimensions in cells
                                const regionCellsWide = targetRegion.endX - targetRegion.startX + 1;
                                const regionCellsHigh = targetRegion.endY - targetRegion.startY + 1;

                                // Calculate target region dimensions in pixels
                                const regionPixelsWide = regionCellsWide * charWidth;
                                const regionPixelsHigh = regionCellsHigh * charHeight;

                                // Scale image to fit within the region while maintaining aspect ratio
                                const imageAspect = img.width / img.height;
                                const regionAspect = regionPixelsWide / regionPixelsHigh;

                                let scaledWidth, scaledHeight;
                                if (imageAspect > regionAspect) {
                                    // Image is wider - fit to width
                                    scaledWidth = regionPixelsWide;
                                    scaledHeight = regionPixelsWide / imageAspect;
                                } else {
                                    // Image is taller - fit to height
                                    scaledHeight = regionPixelsHigh;
                                    scaledWidth = regionPixelsHigh * imageAspect;
                                }

                                // Calculate cell span based on scaled dimensions
                                const cellsWide = Math.ceil(scaledWidth / charWidth);
                                const cellsHigh = Math.ceil(scaledHeight / charHeight);

                                // Upload to storage
                                const storageUrl = await uploadImageToStorage(result.imageData!);

                                // Create image data structure
                                const imageData: ImageData = {
                                    type: 'image',
                                    src: storageUrl,
                                    startX: targetRegion.startX,
                                    startY: targetRegion.startY,
                                    endX: targetRegion.startX + cellsWide - 1,
                                    endY: targetRegion.startY + cellsHigh - 1,
                                    originalWidth: img.width,
                                    originalHeight: img.height
                                };

                                // Remove existing image if present
                                const newWorldData = { ...worldData };
                                if (existingImageKey) {
                                    delete newWorldData[existingImageKey];
                                }

                                // Clear text in target region
                                for (let y = targetRegion.startY; y <= targetRegion.endY; y++) {
                                    for (let x = targetRegion.startX; x <= targetRegion.endX; x++) {
                                        const key = `${x},${y}`;
                                        if (newWorldData[key] && !isImageData(newWorldData[key])) {
                                            delete newWorldData[key];
                                        }
                                    }
                                }

                                // Add new image
                                const imageKey = `image_${targetRegion.startX},${targetRegion.startY}`;
                                newWorldData[imageKey] = imageData;
                                setWorldData(newWorldData);

                                // Clear selection if we were using a selection (not a saved plan region)
                                if (currentSelectionActive) {
                                    setSelectionStart(null);
                                    setSelectionEnd(null);
                                }

                                // Keep cursor position
                                setCursorPos(cursorPos);
                            };

                            img.onerror = () => {
                                logger.error('Error loading generated image');
                                setDialogueWithRevert("Error loading generated image", setDialogueText);
                            };

                            img.src = result.imageData!;
                        }).catch((error) => {
                            logger.error('Error in image generation:', error);
                            setDialogueWithRevert("Could not generate image", setDialogueText);
                        });
                    } else {
                        // Text generation path (existing logic)
                        setDialogueWithRevert("Processing region...", setDialogueText);

                        // Calculate target region dimensions
                        const regionWidth = targetRegion.endX - targetRegion.startX + 1;
                        const regionHeight = targetRegion.endY - targetRegion.startY + 1;

                        // Calculate approximate target character count (80% fill to account for wrapping)
                        const targetChars = Math.floor(regionWidth * regionHeight * 0.8);

                        // Update world context
                        const currentLabels = getAllLabels();
                        const currentCompiledText = compiledTextCache;
                        const compiledTextString = Object.entries(currentCompiledText)
                            .sort(([aLine], [bLine]) => parseInt(aLine) - parseInt(bLine))
                            .map(([lineY, text]) => `Line ${lineY}: ${text}`)
                            .join('\n');

                        // Create enhanced prompt with character count target
                        const enhancedPrompt = `${textToSend.trim()}\n\n[Write a detailed response of approximately ${targetChars} characters to fill the available space. Be expansive and thorough.]`;

                        const worldContext = {
                            compiledText: compiledTextString,
                            labels: currentLabels,
                            metadata: `Canvas viewport center: ${JSON.stringify(getViewportCenter())}, Current cursor: ${JSON.stringify(cursorPos)}`
                        };

                        callChatAPI(enhancedPrompt, true, userUid || undefined, worldContext).then((response) => {
                            // Check if quota exceeded
                            if (response.startsWith('AI limit reached')) {
                                if (upgradeFlowHandlerRef.current) {
                                    upgradeFlowHandlerRef.current();
                                }
                                return true;
                            }

                            // Don't show response in dialogue - write directly to target region
                            setDialogueWithRevert("AI response filled", setDialogueText);

                            // Wrap text to fit within target region width
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

                            const wrappedLines = wrapText(response, regionWidth);

                            // Clear existing text in target region
                            const newWorldData = { ...worldData };
                            for (let y = targetRegion.startY; y <= targetRegion.endY; y++) {
                                for (let x = targetRegion.startX; x <= targetRegion.endX; x++) {
                                    const key = `${x},${y}`;
                                    if (newWorldData[key] && !isImageData(newWorldData[key])) {
                                        delete newWorldData[key];
                                    }
                                }
                            }

                            // Write response into target region
                            for (let lineIndex = 0; lineIndex < Math.min(wrappedLines.length, regionHeight); lineIndex++) {
                                const line = wrappedLines[lineIndex];
                                for (let charIndex = 0; charIndex < Math.min(line.length, regionWidth); charIndex++) {
                                    const char = line[charIndex];
                                    const x = targetRegion.startX + charIndex;
                                    const y = targetRegion.startY + lineIndex;
                                    const key = `${x},${y}`;
                                    newWorldData[key] = char;
                                }
                            }
                            setWorldData(newWorldData);

                            // Clear selection if we were using a selection (not a saved plan region)
                            if (currentSelectionActive) {
                                setSelectionStart(null);
                                setSelectionEnd(null);
                            }

                            // Keep cursor position
                            setCursorPos(cursorPos);
                        }).catch((error) => {
                            logger.error('Error in region AI fill:', error);
                            setDialogueWithRevert("Could not process region", setDialogueText);
                        });
                    }

                    return true;
                } else {
                    setDialogueWithRevert("Region is empty", setDialogueText);
                    return false;
                }
            }

            // === Quick Chat (Cmd+Enter) ===
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
                    } else if (closestBlockResult) {
                        // Cursor is NOT within a block, but there are blocks on the line
                        // Use the closest block (respects 2+ cell gap boundaries)
                        const block = closestBlockResult.block;
                        textToSend = block.characters.map(c => c.char).join('');
                        chatStartPos = { x: block.start, y: currentY };
                    } else {
                        // No blocks found at all (shouldn't happen if lineChars.length > 0)
                        setDialogueWithRevert("No text found to send to AI", setDialogueText);
                        return false;
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
                
                // Prepare world context and chat
                const worldContext = {
                    compiledText: compiledTextString,
                    labels: currentLabels,
                    metadata: `Canvas viewport center: ${JSON.stringify(getViewportCenter())}, Current cursor: ${JSON.stringify(cursorPos)}`
                };

                // Use world context for AI chat
                callChatAPI(textToSend.trim(), true, userUid || undefined, worldContext).then((response) => {
                    // Check if quota exceeded
                    if (response.startsWith('AI limit reached')) {
                        if (upgradeFlowHandlerRef.current) {
                            upgradeFlowHandlerRef.current();
                        }
                        return;
                    }

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

                    // Move cursor to next line after AI response
                    const nextCursorY = responseStartPos.y + wrappedLines.length + 1;
                    setCursorPos({ x: chatStartPos.x, y: nextCursorY });
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
        // --- List-specific Enter handling ---
        else if (key === 'Enter') {
            // === LaTeX Mode: Place image on canvas ===
            if (latexMode.isActive && latexMode.currentInput.trim()) {
                const latexInput = latexMode.currentInput.trim();
                const startPosition = latexMode.startPos;

                // Convert LaTeX to SVG with current text color
                (async () => {
                    const { convertLatexToSVG } = await import('./utils.latex');
                    const imageDataUrl = await convertLatexToSVG(latexInput, textColor);

                    if (imageDataUrl) {
                        // Create an image element to get dimensions
                        const img = new Image();
                        img.onload = async () => {
                            const { width: effectiveCharWidth, height: effectiveCharHeight } = getEffectiveCharDims(zoomLevel);

                            // Calculate grid cells needed
                            const cellsWide = Math.ceil(img.width / effectiveCharWidth);
                            const cellsHigh = Math.ceil(img.height / effectiveCharHeight);

                            // Upload to Firebase Storage and get URL
                            const storageUrl = await uploadImageToStorage(imageDataUrl);

                            // Create image data structure
                            const imageData: ImageData = {
                                type: 'image',
                                src: storageUrl,
                                startX: startPosition.x,
                                startY: startPosition.y,
                                endX: startPosition.x + cellsWide - 1,
                                endY: startPosition.y + cellsHigh - 1,
                                originalWidth: img.width,
                                originalHeight: img.height
                            };

                            // Add to world data
                            const imageKey = `image_${startPosition.x},${startPosition.y}`;
                            setWorldData(prev => {
                                const updated = {
                                    ...prev,
                                    [imageKey]: imageData
                                };
                                return updated;
                            });

                            setDialogueWithRevert(`LaTeX equation rendered (${cellsWide}×${cellsHigh} cells)`, setDialogueText);
                        };

                        img.onerror = (err) => {
                            console.error('Image failed to load:', err);
                            setDialogueWithRevert("Failed to load LaTeX image", setDialogueText);
                        };

                        img.src = imageDataUrl;
                    } else {
                        setDialogueWithRevert("Failed to render LaTeX equation", setDialogueText);
                    }
                })();

                // Clear LaTeX mode immediately
                setLatexMode({
                    isActive: false,
                    currentInput: '',
                    inputPositions: [],
                    startPos: { x: 0, y: 0 },
                    previewImage: null
                });
                setLatexData({});

                return true; // Prevent default Enter behavior
            }

            // === SMILES Mode: Place molecule image on canvas ===
            if (smilesMode.isActive && smilesMode.currentInput.trim()) {
                const smilesInput = smilesMode.currentInput.trim();
                const startPosition = smilesMode.startPos;

                // Convert SMILES to SVG with current text color
                (async () => {
                    const { convertSMILESToSVG } = await import('./utils.SMILES');
                    const imageDataUrl = await convertSMILESToSVG(smilesInput, textColor);

                    if (imageDataUrl) {
                        // Create an image element to get dimensions
                        const img = new Image();
                        img.onload = async () => {
                            const { width: effectiveCharWidth, height: effectiveCharHeight } = getEffectiveCharDims(zoomLevel);

                            // Calculate grid cells needed
                            const cellsWide = Math.ceil(img.width / effectiveCharWidth);
                            const cellsHigh = Math.ceil(img.height / effectiveCharHeight);

                            // Upload to Firebase Storage and get URL
                            const storageUrl = await uploadImageToStorage(imageDataUrl);

                            // Create image data structure
                            const imageData: ImageData = {
                                type: 'image',
                                src: storageUrl,
                                startX: startPosition.x,
                                startY: startPosition.y,
                                endX: startPosition.x + cellsWide - 1,
                                endY: startPosition.y + cellsHigh - 1,
                                originalWidth: img.width,
                                originalHeight: img.height
                            };

                            // Add to world data
                            const imageKey = `image_${startPosition.x},${startPosition.y}`;
                            setWorldData(prev => {
                                const updated = {
                                    ...prev,
                                    [imageKey]: imageData
                                };
                                return updated;
                            });

                            setDialogueWithRevert(`Molecule rendered (${cellsWide}×${cellsHigh} cells)`, setDialogueText);
                        };

                        img.onerror = (err) => {
                            console.error('SMILES image failed to load:', err);
                            setDialogueWithRevert("Failed to load molecule image", setDialogueText);
                        };

                        img.src = imageDataUrl;
                    } else {
                        setDialogueWithRevert("Failed to render molecule - check SMILES notation", setDialogueText);
                    }
                })();

                // Clear SMILES mode immediately
                setSmilesMode({
                    isActive: false,
                    currentInput: '',
                    inputPositions: [],
                    startPos: { x: 0, y: 0 },
                    previewImage: null
                });
                setSmilesData({});

                return true; // Prevent default Enter behavior
            }

            // Check if cursor is in a list first
            const listAt = findListAt(cursorPos.x, cursorPos.y);
            if (listAt) {
                const { key: listKey, data: listData } = listAt;
                const contentKey = `${listKey}_content`;
                const contentData = worldData[contentKey];

                if (contentData) {
                    try {
                        const content = JSON.parse(contentData as string) as ListContent;

                        // Calculate which content line we're on
                        const viewportRow = cursorPos.y - listData.startY;
                        if (viewportRow >= 0 && viewportRow < listData.visibleHeight) {
                            const contentLineIndex = listData.scrollOffset + viewportRow;
                            const currentLine = content[contentLineIndex] || '';
                            const cursorCol = cursorPos.x - listData.startX;

                            // Split line at cursor: text before cursor stays, text after moves to next line
                            const beforeCursor = currentLine.substring(0, cursorCol);
                            const afterCursor = currentLine.substring(cursorCol);

                            // Shift all lines after current line down by 1
                            const totalLines = Object.keys(content).length;
                            const updatedContent = { ...content };

                            // Shift lines down (work backwards to avoid overwriting)
                            for (let i = totalLines; i > contentLineIndex; i--) {
                                updatedContent[i] = content[i - 1] || '';
                            }

                            // Update current and next line
                            updatedContent[contentLineIndex] = beforeCursor;
                            updatedContent[contentLineIndex + 1] = afterCursor;

                            // Auto-grow if needed
                            if (contentLineIndex >= totalLines - 10) {
                                for (let i = totalLines + 1; i < totalLines + 21; i++) {
                                    if (!updatedContent[i]) {
                                        updatedContent[i] = '';
                                    }
                                }
                            }

                            // Save updated content
                            setWorldData(prev => ({
                                ...prev,
                                [contentKey]: JSON.stringify(updatedContent)
                            }));

                            // Move cursor to start of next line
                            if (viewportRow < listData.visibleHeight - 1) {
                                // Next line is visible, just move cursor down
                                setCursorPos({ x: listData.startX, y: cursorPos.y + 1 });
                            } else {
                                // Next line would be off screen, need to scroll down
                                const maxScroll = Math.max(0, totalLines - listData.visibleHeight);
                                const newScrollOffset = Math.min(maxScroll, listData.scrollOffset + 1);

                                setWorldData(prev => ({
                                    ...prev,
                                    [listKey]: JSON.stringify({ ...listData, scrollOffset: newScrollOffset }),
                                    [contentKey]: JSON.stringify(updatedContent)
                                }));

                                // Keep cursor at same screen position (last visible line)
                                setCursorPos({ x: listData.startX, y: cursorPos.y });
                            }

                            return true; // Handled by list
                        }
                    } catch (e) {
                        console.error('Error handling Enter in list:', e);
                    }
                }
            }

            // Not in a list, continue with normal Enter behavior
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
            // Failsafe: if targetIndent is NaN, undefined, or null, use previous cursor X position
            if (targetIndent !== undefined && targetIndent !== null && !isNaN(targetIndent)) {
                nextCursorPos.x = targetIndent;
            } else {
                // Fallback to current cursor X if targetIndent is invalid
                nextCursorPos.x = cursorPos.x;
                logger.warn('targetIndent was invalid (NaN/null/undefined), using current cursor X:', cursorPos.x);
            }
            moved = true;
        } else if (key === 'ArrowUp') {
            if (isMod) {
                // Cmd+Up: Move to the topmost line with content
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
            } else if (altKey) {
                // Opt+Up: Navigate blocks (alternates between top and bottom)
                // First, find current block boundaries
                let currentBlockTop = cursorPos.y;
                let currentBlockBottom = cursorPos.y;

                // Check if current line has content
                let currentLineHasContent = false;
                for (const k in worldData) {
                    if (k.startsWith('block_') || k.startsWith('label_') || k.startsWith('bound_')) continue;
                    const [xStr, yStr] = k.split(',');
                    const y = parseInt(yStr, 10);
                    if (y === cursorPos.y) {
                        currentLineHasContent = true;
                        break;
                    }
                }

                if (currentLineHasContent) {
                    // Find top of current block
                    for (let y = cursorPos.y - 1; y >= 0; y--) {
                        let hasContent = false;
                        for (const k in worldData) {
                            if (k.startsWith('block_') || k.startsWith('label_') || k.startsWith('bound_')) continue;
                            const [xStr, yStr] = k.split(',');
                            const checkY = parseInt(yStr, 10);
                            if (checkY === y) {
                                hasContent = true;
                                break;
                            }
                        }
                        if (hasContent) {
                            currentBlockTop = y;
                        } else {
                            break; // Hit a gap, stop
                        }
                    }

                    // If we're not at the top of current block, go to top
                    if (cursorPos.y > currentBlockTop) {
                        nextCursorPos.y = currentBlockTop;
                    } else {
                        // We're at top of block, find bottom of previous block
                        let searchY = currentBlockTop - 1;
                        let foundGap = false;
                        let foundBlock = false;
                        let previousBlockBottom = currentBlockTop - 1;

                        while (searchY >= 0) {
                            let hasContent = false;
                            for (const k in worldData) {
                                if (k.startsWith('block_') || k.startsWith('label_') || k.startsWith('bound_')) continue;
                                const [xStr, yStr] = k.split(',');
                                const y = parseInt(yStr, 10);
                                if (y === searchY) {
                                    hasContent = true;
                                    break;
                                }
                            }

                            if (!hasContent) {
                                foundGap = true;
                            } else if (hasContent && foundGap) {
                                // Found content after gap - this is bottom of previous block
                                previousBlockBottom = searchY;
                                foundBlock = true;
                                break;
                            } else if (hasContent && !foundGap) {
                                // Still traversing current block's gap
                                foundGap = true;
                            }

                            searchY--;
                        }

                        nextCursorPos.y = foundBlock ? previousBlockBottom : Math.max(0, cursorPos.y - 1);
                    }
                } else {
                    // Not in a block, just move up by 1
                    nextCursorPos.y = cursorPos.y - 1;
                }
            } else {
                nextCursorPos.y -= 1;
            }
            moved = true;
        } else if (key === 'ArrowDown') {
            if (isMod) {
                // Cmd+Down: Move to the bottommost line with content
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
            } else if (altKey) {
                // Opt+Down: Navigate blocks (alternates between bottom and top)
                // First, find current block boundaries
                let currentBlockTop = cursorPos.y;
                let currentBlockBottom = cursorPos.y;

                // Check if current line has content
                let currentLineHasContent = false;
                for (const k in worldData) {
                    if (k.startsWith('block_') || k.startsWith('label_') || k.startsWith('bound_')) continue;
                    const [xStr, yStr] = k.split(',');
                    const y = parseInt(yStr, 10);
                    if (y === cursorPos.y) {
                        currentLineHasContent = true;
                        break;
                    }
                }

                if (currentLineHasContent) {
                    // Find bottom of current block
                    const maxY = 10000; // Reasonable upper bound
                    for (let y = cursorPos.y + 1; y <= maxY; y++) {
                        let hasContent = false;
                        for (const k in worldData) {
                            if (k.startsWith('block_') || k.startsWith('label_') || k.startsWith('bound_')) continue;
                            const [xStr, yStr] = k.split(',');
                            const checkY = parseInt(yStr, 10);
                            if (checkY === y) {
                                hasContent = true;
                                break;
                            }
                        }
                        if (hasContent) {
                            currentBlockBottom = y;
                        } else {
                            break; // Hit a gap, stop
                        }
                    }

                    // If we're not at the bottom of current block, go to bottom
                    if (cursorPos.y < currentBlockBottom) {
                        nextCursorPos.y = currentBlockBottom;
                    } else {
                        // We're at bottom of block, find top of next block
                        let searchY = currentBlockBottom + 1;
                        let foundGap = false;
                        let foundBlock = false;
                        let nextBlockTop = currentBlockBottom + 1;

                        while (searchY <= maxY) {
                            let hasContent = false;
                            for (const k in worldData) {
                                if (k.startsWith('block_') || k.startsWith('label_') || k.startsWith('bound_')) continue;
                                const [xStr, yStr] = k.split(',');
                                const y = parseInt(yStr, 10);
                                if (y === searchY) {
                                    hasContent = true;
                                    break;
                                }
                            }

                            if (!hasContent) {
                                foundGap = true;
                            } else if (hasContent && foundGap) {
                                // Found content after gap - this is top of next block
                                nextBlockTop = searchY;
                                foundBlock = true;
                                break;
                            }

                            searchY++;
                            // Safety: don't search forever
                            if (searchY > currentBlockBottom + 1000) break;
                        }

                        nextCursorPos.y = foundBlock ? nextBlockTop : cursorPos.y + 1;
                    }
                } else {
                    // Not in a block, just move down by 1
                    nextCursorPos.y = cursorPos.y + 1;
                }
            } else {
                nextCursorPos.y += 1;
            }
            moved = true;
        } else if (key === 'ArrowLeft') {
            if (isMod) {
                // Cmd+Left: Move to beginning of line (leftmost character position)
                let leftmostX = 0;
                for (const k in worldData) {
                    if (k.startsWith('block_') || k.startsWith('label_') || k.startsWith('bound_')) continue;
                    const [xStr, yStr] = k.split(',');
                    const checkY = parseInt(yStr, 10);
                    if (checkY === cursorPos.y) {
                        const checkX = parseInt(xStr, 10);
                        if (leftmostX === 0 || checkX < leftmostX) {
                            leftmostX = checkX;
                        }
                    }
                }
                nextCursorPos.x = leftmostX;
            } else if (altKey) {
                // Opt+Left: Move to the beginning of the current word or previous word
                // First check if there's any content on this line
                let hasContentOnLine = false;
                let leftmostX = cursorPos.x;
                for (const k in worldData) {
                    if (k.startsWith('block_') || k.startsWith('label_') || k.startsWith('bound_')) continue;
                    const [xStr, yStr] = k.split(',');
                    const checkY = parseInt(yStr, 10);
                    if (checkY === cursorPos.y) {
                        hasContentOnLine = true;
                        const checkX = parseInt(xStr, 10);
                        if (checkX < leftmostX) {
                            leftmostX = checkX;
                        }
                    }
                }

                // If no content on line, just move left by 1
                if (!hasContentOnLine) {
                    nextCursorPos.x = cursorPos.x - 1;
                } else {
                    let x = cursorPos.x - 1;
                    let passedContent = false;

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
                }
            } else {
                nextCursorPos.x -= 1;
            }
            setLastEnterX(null); // Reset Enter X tracking on horizontal movement
            moved = true;
        } else if (key === 'ArrowRight') {
            if (isMod) {
                // Cmd+Right: Move to end of line (rightmost character position + 1)
                let rightmostX = cursorPos.x;
                for (const k in worldData) {
                    if (k.startsWith('block_') || k.startsWith('label_') || k.startsWith('bound_')) continue;
                    const [xStr, yStr] = k.split(',');
                    const checkY = parseInt(yStr, 10);
                    if (checkY === cursorPos.y) {
                        const checkX = parseInt(xStr, 10);
                        if (checkX > rightmostX) {
                            rightmostX = checkX;
                        }
                    }
                }
                // Position cursor one space after the rightmost character
                nextCursorPos.x = rightmostX > cursorPos.x ? rightmostX + 1 : cursorPos.x;
            } else if (altKey) {
                // Opt+Right: Move to the end of the current word or next word
                // First check if there's any content on this line
                let hasContentOnLine = false;
                let rightmostX = cursorPos.x;
                for (const k in worldData) {
                    if (k.startsWith('block_') || k.startsWith('label_') || k.startsWith('bound_')) continue;
                    const [xStr, yStr] = k.split(',');
                    const checkY = parseInt(yStr, 10);
                    if (checkY === cursorPos.y) {
                        hasContentOnLine = true;
                        const checkX = parseInt(xStr, 10);
                        if (checkX > rightmostX) {
                            rightmostX = checkX;
                        }
                    }
                }

                // If no content on line, just move right by 1
                if (!hasContentOnLine) {
                    nextCursorPos.x = cursorPos.x + 1;
                } else {
                    let x = cursorPos.x;
                    let currentLine = cursorPos.y;

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
                }
            } else {
                nextCursorPos.x += 1;
            }
            setLastEnterX(null); // Reset Enter X tracking on horizontal movement
            moved = true;
        }
        // --- List-specific Backspace handling ---
        else if (key === 'Backspace') {

            // During IME composition, let the native IME handle backspace
            if (isComposingRef.current) {
                return true;
            }

            // Skip this backspace if we just cancelled composition (to prevent deleting previous character)
            if (justCancelledCompositionRef.current) {
                justCancelledCompositionRef.current = false;
                return true;
            }

            // Check if cursor is in a list first (and no selection active)
            if (!currentSelectionActive) {
                const listAt = findListAt(cursorPos.x, cursorPos.y);
                if (listAt) {
                    const { key: listKey, data: listData } = listAt;
                    const contentKey = `${listKey}_content`;
                    const contentData = worldData[contentKey];

                    if (contentData) {
                        try {
                            const content = JSON.parse(contentData as string) as ListContent;

                            // Calculate which content line we're on
                            const viewportRow = cursorPos.y - listData.startY;
                            if (viewportRow >= 0 && viewportRow < listData.visibleHeight) {
                                const contentLineIndex = listData.scrollOffset + viewportRow;
                                const currentLine = content[contentLineIndex] || '';
                                const cursorCol = cursorPos.x - listData.startX;

                                if (cursorCol > 0) {
                                    // Delete character before cursor
                                    const newLine = currentLine.substring(0, cursorCol - 1) + currentLine.substring(cursorCol);

                                    const updatedContent = { ...content, [contentLineIndex]: newLine };

                                    setWorldData(prev => ({
                                        ...prev,
                                        [contentKey]: JSON.stringify(updatedContent)
                                    }));

                                    // Move cursor left
                                    setCursorPos({ x: cursorPos.x - 1, y: cursorPos.y });

                                    return true; // Handled by list
                                } else if (contentLineIndex > 0) {
                                    // At start of line - merge with previous line
                                    const previousLine = content[contentLineIndex - 1] || '';
                                    const mergedLine = previousLine + currentLine;
                                    const previousLineLength = previousLine.length;

                                    // Shift all lines after current line up by 1
                                    const totalLines = Object.keys(content).length;
                                    const updatedContent = { ...content };

                                    // Update previous line with merged content
                                    updatedContent[contentLineIndex - 1] = mergedLine;

                                    // Shift lines up
                                    for (let i = contentLineIndex; i < totalLines - 1; i++) {
                                        updatedContent[i] = content[i + 1] || '';
                                    }

                                    // Remove last line
                                    delete updatedContent[totalLines - 1];

                                    setWorldData(prev => ({
                                        ...prev,
                                        [contentKey]: JSON.stringify(updatedContent)
                                    }));

                                    // Move cursor to end of previous line
                                    if (viewportRow > 0) {
                                        // Previous line is visible
                                        setCursorPos({ x: listData.startX + previousLineLength, y: cursorPos.y - 1 });
                                    } else {
                                        // Need to scroll up to see previous line
                                        const newScrollOffset = Math.max(0, listData.scrollOffset - 1);

                                        setWorldData(prev => ({
                                            ...prev,
                                            [listKey]: JSON.stringify({ ...listData, scrollOffset: newScrollOffset }),
                                            [contentKey]: JSON.stringify(updatedContent)
                                        }));

                                        // Keep cursor at same screen position
                                        setCursorPos({ x: listData.startX + previousLineLength, y: cursorPos.y });
                                    }

                                    return true; // Handled by list
                                }
                                // At start of first line - do nothing
                                return true;
                            }
                        } catch (e) {
                            console.error('Error handling Backspace in list:', e);
                        }
                    }
                }
            }

            // Not in a list, continue with normal Backspace behavior
            if (currentSelectionActive) {
                if (deleteSelectedCharacters()) {
                    // State updates happen inside deleteSelectedCharacters
                    // Update local nextCursorPos for consistency if needed, though state is already set
                    nextCursorPos = { x: selectionStart?.x ?? cursorPos.x, y: selectionStart?.y ?? cursorPos.y };
                }
            } else if (metaKey) {
                // Cmd+Backspace: Delete whole line (using text block detection with 2+ cell gap rule)
                nextWorldData = { ...worldData }; // Create a copy before modifying

                // Use text block detection to find the current block
                // Don't include spaces - we want to detect gaps based on empty cells
                const lineChars = extractLineCharacters(worldData, cursorPos.y, false);
                if (lineChars.length === 0) {
                    // No characters on this line
                    nextCursorPos.x = cursorPos.x;
                } else {
                    const blocks = detectTextBlocks(lineChars);
                    const currentBlock = findBlockForDeletion(blocks, cursorPos.x);

                    if (currentBlock) {
                        // Delete all characters in the current block
                        let deletedAny = false;
                        for (let x = currentBlock.start; x <= currentBlock.end; x++) {
                            const key = `${x},${cursorPos.y}`;
                            if (worldData[key]) {
                                delete nextWorldData[key];
                                deletedAny = true;
                            }
                        }

                        if (deletedAny) {
                            worldDataChanged = true;
                            nextCursorPos.x = currentBlock.start; // Position cursor at start of deleted block

                            // Also delete any tasks/links/labels that intersect the deleted region
                            for (const key in nextWorldData) {
                                if (key.startsWith('task_') || key.startsWith('link_')) {
                                    try {
                                        const data = JSON.parse(nextWorldData[key] as string);
                                        const { startX, endX, startY, endY } = data;
                                        // Check if intersects deleted region
                                        if (startX <= currentBlock.end && endX >= currentBlock.start && startY === cursorPos.y && endY === cursorPos.y) {
                                            delete nextWorldData[key];
                                        }
                                    } catch (e) {
                                        // ignore
                                    }
                                } else if (key.startsWith('label_')) {
                                    const coordsStr = key.substring('label_'.length);
                                    const [lxStr, lyStr] = coordsStr.split(',');
                                    const lx = parseInt(lxStr, 10);
                                    const ly = parseInt(lyStr, 10);
                                    try {
                                        const charData = nextWorldData[key];
                                        if (!isImageData(charData)) {
                                            const charString = getCharacter(charData);
                                            const data = JSON.parse(charString);
                                            const text = data.text || '';
                                            const endX = lx + text.length - 1;
                                            // Check if intersects deleted region
                                            if (lx <= currentBlock.end && endX >= currentBlock.start && ly === cursorPos.y) {
                                                delete nextWorldData[key];
                                            }
                                        }
                                    } catch (e) {
                                        // ignore
                                    }
                                }
                            }
                        } else {
                            nextCursorPos.x = cursorPos.x;
                        }
                    } else {
                        // No block found, keep cursor where it is
                        nextCursorPos.x = cursorPos.x;
                    }
                }
            } else if (altKey) {
                // Option+Backspace: Delete word or spaces, respecting 2+ cell gap block boundaries
                nextWorldData = { ...worldData }; // Create a copy before modifying

                // Get text blocks on this line (don't include spaces to detect gaps)
                const lineChars = extractLineCharacters(worldData, cursorPos.y, false);
                if (lineChars.length === 0) {
                    nextCursorPos.x = cursorPos.x;
                } else {
                    const blocks = detectTextBlocks(lineChars);
                    const currentBlock = findBlockForDeletion(blocks, cursorPos.x);

                    if (currentBlock) {
                        // Check what type of character we're starting on
                        let x = cursorPos.x - 1;
                        const startKey = `${x},${cursorPos.y}`;
                        const startCharData = worldData[startKey];

                        if (!startCharData) {
                            // No character at cursor position, fallback to regular backspace
                            nextCursorPos.x = cursorPos.x;
                        } else {
                            const startChar = isImageData(startCharData) ? '' : getCharacter(startCharData);
                            const startingOnSpace = startChar === ' ' || startChar === '\t';
                            let deletedAny = false;

                            // Don't go past the start of the current block
                            while (x >= currentBlock.start) {
                                const key = `${x},${cursorPos.y}`;
                                const charData = worldData[key];

                                if (!charData) {
                                    // Empty cell - stop here (we've hit the block boundary)
                                    break;
                                }

                                const char = isImageData(charData) ? '' : getCharacter(charData);
                                const isSpace = char === ' ' || char === '\t';

                                if (startingOnSpace) {
                                    // Started on space - delete all consecutive spaces
                                    if (isSpace) {
                                        delete nextWorldData[key];
                                        deletedAny = true;
                                    } else {
                                        // Hit a non-space, stop
                                        break;
                                    }
                                } else {
                                    // Started on word - delete word characters, stop at spaces
                                    if (isSpace) {
                                        // Hit a space - stop here
                                        break;
                                    } else {
                                        // Delete non-space character (part of the word)
                                        delete nextWorldData[key];
                                        deletedAny = true;
                                    }
                                }

                                x--;
                            }

                            if (deletedAny) {
                                worldDataChanged = true;
                                nextCursorPos.x = x + 1;

                                // Also delete any tasks/links/labels that intersect the deleted region
                                const deletedStartX = x + 1;
                                const deletedEndX = cursorPos.x - 1;
                                for (const key in nextWorldData) {
                                    if (key.startsWith('task_') || key.startsWith('link_')) {
                                        try {
                                            const data = JSON.parse(nextWorldData[key] as string);
                                            const { startX, endX, startY, endY } = data;
                                            // Check if intersects deleted region
                                            if (startX <= deletedEndX && endX >= deletedStartX && startY === cursorPos.y && endY === cursorPos.y) {
                                                delete nextWorldData[key];
                                            }
                                        } catch (e) {
                                            // ignore
                                        }
                                    } else if (key.startsWith('label_')) {
                                        const coordsStr = key.substring('label_'.length);
                                        const [lxStr, lyStr] = coordsStr.split(',');
                                        const lx = parseInt(lxStr, 10);
                                        const ly = parseInt(lyStr, 10);
                                        try {
                                            const charData = nextWorldData[key];
                                            if (!isImageData(charData)) {
                                                const charString = getCharacter(charData);
                                                const data = JSON.parse(charString);
                                                const text = data.text || '';
                                                const endX = lx + text.length - 1;
                                                // Check if intersects deleted region
                                                if (lx <= deletedEndX && endX >= deletedStartX && ly === cursorPos.y) {
                                                    delete nextWorldData[key];
                                                }
                                            }
                                        } catch (e) {
                                            // ignore
                                        }
                                    }
                                }
                            } else {
                                // Nothing deleted, fallback to regular backspace
                                const deleteKey = `${cursorPos.x - 1},${cursorPos.y}`;
                                if (worldData[deleteKey]) {
                                    delete nextWorldData[deleteKey];
                                    worldDataChanged = true;
                                }
                                nextCursorPos.x -= 1;
                            }
                        }
                    } else {
                        // No block found, fallback to regular backspace
                        const deleteKey = `${cursorPos.x - 1},${cursorPos.y}`;
                        if (worldData[deleteKey]) {
                            delete nextWorldData[deleteKey];
                            worldDataChanged = true;
                        }
                        nextCursorPos.x -= 1;
                    }
                }
            } else {
                // Regular Backspace: Check for task first, then link, then label
                const taskToDelete = findTaskAt(cursorPos.x - 1, cursorPos.y);
                if (taskToDelete) {
                    nextWorldData = { ...worldData };
                    delete nextWorldData[taskToDelete.key];
                    worldDataChanged = true;
                    // Move cursor to the start of where the task was
                    nextCursorPos.x = taskToDelete.data.startX;
                    nextCursorPos.y = taskToDelete.data.startY;
                } else {
                    const linkToDelete = findLinkAt(cursorPos.x - 1, cursorPos.y);
                    if (linkToDelete) {
                        nextWorldData = { ...worldData };
                        delete nextWorldData[linkToDelete.key];
                        worldDataChanged = true;
                        // Move cursor to the start of where the link was
                        nextCursorPos.x = linkToDelete.data.startX;
                        nextCursorPos.y = linkToDelete.data.startY;
                    } else {
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
                        // Check if we're within a note region first
                        const noteRegion = getNoteRegion(worldData, cursorPos);
                        if (noteRegion && cursorPos.x === noteRegion.startX && cursorPos.y > noteRegion.startY) {
                            // We're at the start of a line within a note region (but not the first line)
                            // Move cursor to the end of the previous line within the note
                            nextCursorPos.x = noteRegion.endX + 1;
                            nextCursorPos.y = cursorPos.y - 1;
                            moved = true;
                            // Don't delete anything, just move cursor
                        } else if (noteRegion && cursorPos.x > noteRegion.startX) {
                            // We're within a note region but not at the start - do normal backspace
                            const deleteKey = `${cursorPos.x - 1},${cursorPos.y}`;
                            if (worldData[deleteKey]) {
                                nextWorldData = { ...worldData };
                                delete nextWorldData[deleteKey];
                                worldDataChanged = true;
                            }
                            nextCursorPos.x -= 1;
                            moved = true;
                        } else {
                            // Check if we're within a mail region
                            const mailRegion = getMailRegion(worldData, cursorPos);
                            if (mailRegion && cursorPos.x === mailRegion.startX && cursorPos.y > mailRegion.startY) {
                                // We're at the start of a line within a mail region (but not the first line)
                                // Move cursor to the end of the previous line within the mail
                                nextCursorPos.x = mailRegion.endX + 1;
                                nextCursorPos.y = cursorPos.y - 1;
                                moved = true;
                                // Don't delete anything, just move cursor
                            } else if (mailRegion && cursorPos.x > mailRegion.startX) {
                                // We're within a mail region but not at the start - do normal backspace
                                const deleteKey = `${cursorPos.x - 1},${cursorPos.y}`;
                                if (worldData[deleteKey]) {
                                    nextWorldData = { ...worldData };
                                    delete nextWorldData[deleteKey];
                                    worldDataChanged = true;
                                }
                                nextCursorPos.x -= 1;
                                moved = true;
                            } else {
                                // Check if we're at the beginning of a line (need to merge with previous line)
                                // Only merge if cursor is actually before any characters on this line, not at first character
                                const currentLineChars = extractLineCharacters(worldData, cursorPos.y);
                                const isAtLineStart = currentLineChars.length > 0 ?
                                    cursorPos.x < currentLineChars[0].x :
                                    cursorPos.x === 0;

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
                        }
                    }
                }
            }
            moved = true; // Cursor position changed or selection was deleted
        } else if (key === 'Tab') {
            // Tab key is ONLY for accepting autocomplete suggestions
            // Always prevent default browser behavior (focusing address bar)
            preventDefault = true;

            // Use ref for immediate access to suggestion (state may not have updated yet)
            const suggestionToAccept = currentSuggestionRef.current;

            if (suggestionToAccept) {
                // Accept the current suggestion
                const suggestionLength = suggestionToAccept.length;
                nextWorldData = { ...worldData };

                for (let i = 0; i < suggestionLength; i++) {
                    const key = `${cursorPos.x + i},${cursorPos.y}`;
                    const char = suggestionToAccept[i];

                    // Check if current text style is different from global defaults
                    const hasCustomStyle = currentTextStyle.color !== textColor || currentTextStyle.background !== undefined;

                    if (hasCustomStyle) {
                        // Store styled character
                        const style: { color?: string; background?: string } = {
                            color: currentTextStyle.color
                        };
                        if (currentTextStyle.background !== undefined) {
                            style.background = currentTextStyle.background;
                        }

                        nextWorldData[key] = {
                            char: char,
                            style: style
                        };
                    } else {
                        // Store plain character
                        nextWorldData[key] = char;
                    }
                }

                worldDataChanged = true;
                nextCursorPos.x += suggestionLength;
                moved = true;

                // Clear suggestion
                setCurrentSuggestion('');
                setSuggestionData({});
                setCurrentSuggestions([]);
                setCurrentSuggestionIndex(0);
            }
            // If no suggestion, Tab does nothing (but still prevents default browser behavior)
        } else if (key === 'Delete') {
            // Check if cursor is in a list first (and no selection active)
            if (!currentSelectionActive) {
                const listAt = findListAt(cursorPos.x, cursorPos.y);
                if (listAt) {
                    const { key: listKey, data: listData } = listAt;
                    const contentKey = `${listKey}_content`;
                    const contentData = worldData[contentKey];

                    if (contentData) {
                        try {
                            const content = JSON.parse(contentData as string) as ListContent;

                            // Calculate which content line we're on
                            const viewportRow = cursorPos.y - listData.startY;
                            if (viewportRow >= 0 && viewportRow < listData.visibleHeight) {
                                const contentLineIndex = listData.scrollOffset + viewportRow;
                                const currentLine = content[contentLineIndex] || '';
                                const cursorCol = cursorPos.x - listData.startX;

                                if (cursorCol < currentLine.length) {
                                    // Delete character at cursor
                                    const newLine = currentLine.substring(0, cursorCol) + currentLine.substring(cursorCol + 1);

                                    const updatedContent = { ...content, [contentLineIndex]: newLine };

                                    setWorldData(prev => ({
                                        ...prev,
                                        [contentKey]: JSON.stringify(updatedContent)
                                    }));

                                    // Cursor doesn't move
                                    moved = true;
                                    return true; // Handled by list
                                } else {
                                    // At end of line - merge with next line
                                    const totalLines = Object.keys(content).length;
                                    if (contentLineIndex < totalLines - 1) {
                                        const nextLine = content[contentLineIndex + 1] || '';
                                        const mergedLine = currentLine + nextLine;

                                        // Shift all lines after next line up by 1
                                        const updatedContent = { ...content };

                                        // Update current line with merged content
                                        updatedContent[contentLineIndex] = mergedLine;

                                        // Shift lines up
                                        for (let i = contentLineIndex + 1; i < totalLines - 1; i++) {
                                            updatedContent[i] = content[i + 1] || '';
                                        }

                                        // Remove last line
                                        delete updatedContent[totalLines - 1];

                                        setWorldData(prev => ({
                                            ...prev,
                                            [contentKey]: JSON.stringify(updatedContent)
                                        }));

                                        // Cursor doesn't move
                                        moved = true;
                                        return true; // Handled by list
                                    }
                                }
                                // At end of last line - do nothing
                                return true;
                            }
                        } catch (e) {
                            console.error('Error handling Delete in list:', e);
                        }
                    }
                }
            }

            // Not in a list, continue with normal Delete behavior
            if (currentSelectionActive) {
                 if (deleteSelectedCharacters()) {
                    // State updates happen inside deleteSelectedCharacters
                    nextCursorPos = { x: selectionStart?.x ?? cursorPos.x, y: selectionStart?.y ?? cursorPos.y };
                 }
            } else {
                // Delete char at current cursor pos, check for task first, then link, then label
                const taskToDelete = findTaskAt(cursorPos.x, cursorPos.y);
                if (taskToDelete) {
                    nextWorldData = { ...worldData };
                    delete nextWorldData[taskToDelete.key];
                    worldDataChanged = true;
                    // Cursor does not move
                } else {
                    const linkToDelete = findLinkAt(cursorPos.x, cursorPos.y);
                    if (linkToDelete) {
                        nextWorldData = { ...worldData };
                        delete nextWorldData[linkToDelete.key];
                        worldDataChanged = true;
                        // Cursor does not move
                    } else {
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
                }
            }
             // Treat deletion as a cursor-affecting action for selection clearing logic below
             moved = true; // Set moved to true to trigger selection update/clear logic
        }
        // --- Typing ---
        else if (!isMod && key.length === 1 && !isComposingRef.current) { // Basic check for printable chars, skip during IME composition
            // Check if cursor is in a list - handle list editing separately
            const listAt = findListAt(cursorPos.x, cursorPos.y);
            if (listAt) {
                const { key: listKey, data: listData } = listAt;
                const contentKey = `${listKey}_content`;
                const contentData = worldData[contentKey];

                if (contentData) {
                    try {
                        const content = JSON.parse(contentData as string) as ListContent;

                        // Calculate which content line we're editing (no title bar, direct mapping)
                        const viewportRow = cursorPos.y - listData.startY;
                        if (viewportRow >= 0 && viewportRow < listData.visibleHeight) {
                            const contentLineIndex = listData.scrollOffset + viewportRow;
                            const currentLine = content[contentLineIndex] || '';
                            const cursorCol = cursorPos.x - listData.startX;
                            const listWidth = listData.endX - listData.startX + 1;


                            // Auto-grow: Add empty lines if typing near the end
                            const totalLines = Object.keys(content).length;
                            const updatedContent = { ...content };

                            if (contentLineIndex >= totalLines - 10) {
                                for (let i = totalLines; i < totalLines + 20; i++) {
                                    if (!updatedContent[i]) {
                                        updatedContent[i] = '';
                                    }
                                }
                            }

                            // Check if inserting this character would exceed width
                            const wouldExceedWidth = currentLine.length >= listWidth;

                            if (wouldExceedWidth) {

                                // Need to wrap current line first, THEN insert character on next line
                                // Find wrap point in current line
                                let wrapPoint = 0;
                                for (let col = listWidth - 1; col >= 0; col--) {
                                    if (currentLine[col] === ' ') {
                                        wrapPoint = col + 1;
                                        break;
                                    }
                                }
                                if (wrapPoint === 0) {
                                    wrapPoint = listWidth;
                                }

                                const lineBeforeWrap = currentLine.substring(0, wrapPoint);
                                const overflow = currentLine.substring(wrapPoint);

                                // Update current line
                                updatedContent[contentLineIndex] = lineBeforeWrap;

                                // Put overflow + new character on next line
                                const nextLineContent = (updatedContent[contentLineIndex + 1] || content[contentLineIndex + 1] || '').trimEnd();
                                updatedContent[contentLineIndex + 1] = overflow + key + nextLineContent;


                                // Save and move cursor to next line
                                setWorldData(prev => ({
                                    ...prev,
                                    [contentKey]: JSON.stringify(updatedContent)
                                }));

                                // Move cursor to next line, after the character we just inserted
                                const newCursorCol = overflow.length + 1;
                                if (viewportRow < listData.visibleHeight - 1) {
                                    setCursorPos({ x: listData.startX + newCursorCol, y: cursorPos.y + 1 });
                                } else {
                                    // Need to scroll
                                    const newScrollOffset = listData.scrollOffset + 1;
                                    setWorldData(prev => ({
                                        ...prev,
                                        [listKey]: JSON.stringify({ ...listData, scrollOffset: newScrollOffset })
                                    }));
                                    setCursorPos({ x: listData.startX + newCursorCol, y: cursorPos.y });
                                }
                            } else {

                                // Insert character normally
                                const newLine = currentLine.substring(0, cursorCol) + key + currentLine.substring(cursorCol);
                                updatedContent[contentLineIndex] = newLine;

                                // Check if THIS LINE now needs reflow (in case we inserted in the middle)
                                if (newLine.length > listWidth) {
                                // Line exceeds width - need to reflow
                                const totalLinesBeforeWrap = Object.keys(content).length;

                                // Track cursor position as character offset from start of current line
                                const cursorCharOffset = cursorCol + 1; // +1 for the inserted character

                                // Reflow starting from current line
                                let currentReflowLine = newLine;
                                let reflowLineIndex = contentLineIndex;
                                let charsProcessed = 0;
                                let cursorFinalLine = contentLineIndex;
                                let cursorFinalCol = cursorCol + 1;

                                while (currentReflowLine.length > listWidth && reflowLineIndex < totalLinesBeforeWrap + 20) {
                                    // Find wrap point (look for last space before boundary)
                                    let wrapPoint = 0;
                                    for (let col = listWidth - 1; col >= 0; col--) {
                                        if (currentReflowLine[col] === ' ') {
                                            wrapPoint = col + 1;
                                            break;
                                        }
                                    }
                                    if (wrapPoint === 0) {
                                        wrapPoint = listWidth;
                                    }

                                    // Split current line
                                    const lineBeforeWrap = currentReflowLine.substring(0, wrapPoint);
                                    const overflow = currentReflowLine.substring(wrapPoint);

                                    // Update current line in updatedContent
                                    updatedContent[reflowLineIndex] = lineBeforeWrap;

                                    // Track cursor position
                                    if (reflowLineIndex === contentLineIndex) {
                                        // First line - check if cursor is on this line or wraps
                                        if (cursorCharOffset <= lineBeforeWrap.length) {
                                            cursorFinalLine = reflowLineIndex;
                                            cursorFinalCol = cursorCharOffset;
                                        } else {
                                            cursorFinalLine = reflowLineIndex + 1;
                                            cursorFinalCol = cursorCharOffset - lineBeforeWrap.length;
                                        }
                                    }

                                    // Get next line's content and prepend overflow
                                    // IMPORTANT: Read from updatedContent to get any reflowed changes, fall back to content
                                    // Trim the next line to remove trailing spaces that might have been left from previous reflows
                                    const nextLineContent = (updatedContent[reflowLineIndex + 1] || content[reflowLineIndex + 1] || '').trimEnd();
                                    currentReflowLine = overflow + nextLineContent;

                                    // Move to next line
                                    reflowLineIndex++;
                                }

                                // Update the last line after reflow loop (this line is <= listWidth)
                                updatedContent[reflowLineIndex] = currentReflowLine;


                                // Auto-grow if needed
                                if (reflowLineIndex >= totalLinesBeforeWrap - 10) {
                                    for (let i = totalLinesBeforeWrap + 1; i < totalLinesBeforeWrap + 21; i++) {
                                        if (!updatedContent[i]) {
                                            updatedContent[i] = '';
                                        }
                                    }
                                }

                                // Save updated content
                                setWorldData(prev => ({
                                    ...prev,
                                    [contentKey]: JSON.stringify(updatedContent)
                                }));

                                // Move cursor to final position after reflow
                                const finalViewportRow = cursorFinalLine - listData.scrollOffset;
                                if (finalViewportRow >= 0 && finalViewportRow < listData.visibleHeight) {
                                    // Cursor is visible
                                    setCursorPos({ x: listData.startX + cursorFinalCol, y: listData.startY + finalViewportRow });
                                } else if (finalViewportRow >= listData.visibleHeight) {
                                    // Need to scroll down to show cursor
                                    const newScrollOffset = cursorFinalLine - listData.visibleHeight + 1;
                                    setWorldData(prev => ({
                                        ...prev,
                                        [listKey]: JSON.stringify({ ...listData, scrollOffset: newScrollOffset })
                                    }));
                                    setCursorPos({ x: listData.startX + cursorFinalCol, y: listData.startY + listData.visibleHeight - 1 });
                                } else {
                                    // Just set cursor position
                                    setCursorPos({ x: listData.startX + cursorFinalCol, y: cursorPos.y });
                                }
                            } else {
                                // No wrapping needed - just save and move cursor right
                                setWorldData(prev => ({
                                    ...prev,
                                    [contentKey]: JSON.stringify(updatedContent)
                                }));

                                // Don't move cursor beyond list boundary
                                if (cursorPos.x < listData.endX) {
                                    setCursorPos({ x: cursorPos.x + 1, y: cursorPos.y });
                                } else {
                                    // At boundary - stay in place (should trigger wrap on next character)
                                    setCursorPos({ x: cursorPos.x, y: cursorPos.y });
                                }
                            }
                            }
                        }

                        return true; // Handled by list editing
                    } catch (e) {
                        // Fall through to normal typing if content is invalid
                    }
                }
            }

            // Check if cursor is in a glitched region - block typing if so
            let isInGlitchedRegion = false;
            for (const key in worldData) {
                if (key.startsWith('glitched_')) {
                    try {
                        const glitchData = JSON.parse(worldData[key] as string);
                        if (cursorPos.x >= glitchData.startX && cursorPos.x <= glitchData.endX &&
                            cursorPos.y >= glitchData.startY && cursorPos.y <= glitchData.endY) {
                            isInGlitchedRegion = true;
                            break;
                        }
                    } catch (e) {
                        // Skip invalid glitch data
                    }
                }
            }

            if (isInGlitchedRegion) {
                // Don't allow typing in glitched regions - they use a different coordinate system
                return true;
            }

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

            // Check for note region word wrapping (if not already handled by bounded region)
            if (!worldDataChanged) {
                const noteRegion = getNoteRegion(dataToDeleteFrom, cursorAfterDelete);
                if (noteRegion && proposedCursorPos.x > noteRegion.endX) {
                    // We're typing past the right edge of a note region
                    const nextLineY = cursorAfterDelete.y + 1;

                    // Check if wrapping would exceed note's height limit
                    if (nextLineY <= noteRegion.endY) {
                        // Simple word wrapping: scan backwards to find the last space, then move everything after it
                        const currentLineY = cursorAfterDelete.y;
                        let wrapPoint = noteRegion.startX; // Default to start of line if no space found

                        // Scan backwards from the boundary to find the last space
                        for (let x = noteRegion.endX; x >= noteRegion.startX; x--) {
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
                        if (wrapPoint > noteRegion.startX && wrapPoint <= cursorAfterDelete.x) {
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
                            let newX = noteRegion.startX;
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
                                x: noteRegion.startX,
                                y: nextLineY
                            };
                        }
                    } else {
                        // Can't wrap within note region (would exceed endY) - don't allow typing beyond bounds
                        // Keep cursor at current position
                        proposedCursorPos = {
                            x: cursorAfterDelete.x,
                            y: cursorAfterDelete.y
                        };
                        // Don't type the character
                        return true;
                    }
                }
            }

            // Check for mail region word wrapping (if not already handled by note or bounded region)
            if (!worldDataChanged) {
                const mailRegion = getMailRegion(dataToDeleteFrom, cursorAfterDelete);
                if (mailRegion && proposedCursorPos.x > mailRegion.endX) {
                    // We're typing past the right edge of a mail region
                    const nextLineY = cursorAfterDelete.y + 1;

                    // Check if wrapping would exceed mail's height limit
                    if (nextLineY <= mailRegion.endY) {
                        // Simple word wrapping: scan backwards to find the last space, then move everything after it
                        const currentLineY = cursorAfterDelete.y;
                        let wrapPoint = mailRegion.startX; // Default to start of line if no space found

                        // Scan backwards from the boundary to find the last space
                        for (let x = mailRegion.endX; x >= mailRegion.startX; x--) {
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
                        if (wrapPoint > mailRegion.startX && wrapPoint <= cursorAfterDelete.x) {
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
                            let newX = mailRegion.startX;
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
                                x: mailRegion.startX,
                                y: nextLineY
                            };
                        }
                    } else {
                        // Can't wrap within mail region (would exceed endY) - don't allow typing beyond bounds
                        // Keep cursor at current position
                        proposedCursorPos = {
                            x: cursorAfterDelete.x,
                            y: cursorAfterDelete.y
                        };
                        // Don't type the character
                        return true;
                    }
                }
            }

            nextCursorPos = proposedCursorPos;
            moved = true;

            // Check if chat mode is active first (for host mode compatibility)
            if (latexMode.isActive) {
                // Add to latex data instead of world data
                setLatexData(prev => ({
                    ...prev,
                    [`${cursorAfterDelete.x},${cursorAfterDelete.y}`]: key
                }));

                setLatexMode(prev => ({
                    ...prev,
                    currentInput: prev.currentInput + key,
                    inputPositions: [...prev.inputPositions, cursorAfterDelete]
                }));
            } else if (smilesMode.isActive) {
                // Add to SMILES data instead of world data
                setSmilesData(prev => ({
                    ...prev,
                    [`${cursorAfterDelete.x},${cursorAfterDelete.y}`]: key
                }));

                setSmilesMode(prev => ({
                    ...prev,
                    currentInput: prev.currentInput + key,
                    inputPositions: [...prev.inputPositions, cursorAfterDelete]
                }));
            } else if (chatMode.isActive) {
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
            } else if (currentMode === 'air') {
                // Air mode: Add ephemeral text that disappears after 2 seconds
                addEphemeralText(cursorAfterDelete, key);
                // Don't modify worldData in air mode
            } else if (currentMode === 'chat') {
                // Chat mode but not active: activate it
                setChatMode({
                    isActive: true,
                    currentInput: key,
                    inputPositions: [cursorAfterDelete],
                    isProcessing: false
                });
                setChatData({
                    [`${cursorAfterDelete.x},${cursorAfterDelete.y}`]: key
                });
                setDialogueWithRevert("Chat mode activated. Enter: ephemeral response, Cmd+Enter: permanent response, Shift+Enter: new line. Use /exit to leave.", setDialogueText);
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

                // Generate autocomplete suggestion with debouncing (only if enabled)
                if (settings.isAutocompleteEnabled) {
                    if (suggestionDebounceRef.current) {
                        clearTimeout(suggestionDebounceRef.current);
                    }

                    suggestionDebounceRef.current = setTimeout(async () => {
                    try {
                        // Get current line text for context
                        let currentLineText = '';
                        for (let x = cursorAfterDelete.x - 20; x < cursorAfterDelete.x + 1; x++) {
                            const char = worldData[`${x},${cursorAfterDelete.y}`];
                            if (char && typeof char === 'string') {
                                currentLineText += char;
                            }
                        }
                        currentLineText = currentLineText.trim();

                        if (currentLineText.length > 0) {
                            let suggestions: string[] = [];
                            try {
                                const response = await fetch('/api/autocomplete', {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                    },
                                    body: JSON.stringify({ currentText: currentLineText })
                                });

                                if (response.ok) {
                                    const data = await response.json();
                                    suggestions = data.suggestions || [];
                                }
                            } catch (aiError) {
                                // Silently fail
                            }

                            if (suggestions.length > 0) {
                                setCurrentSuggestions(suggestions);
                                setCurrentSuggestionIndex(0);

                                // Use first suggestion
                                const firstSuggestion = suggestions[0];
                                setCurrentSuggestion(firstSuggestion);
                                currentSuggestionRef.current = firstSuggestion; // Set ref immediately

                                // Create suggestion data (gray ghost text two positions after cursor)
                                const newSuggestionData: WorldData = {};
                                for (let i = 0; i < firstSuggestion.length; i++) {
                                    // Position suggestion two cells to the right of cursor
                                    const suggestionKey = `${cursorAfterDelete.x + 2 + i},${cursorAfterDelete.y}`;
                                    newSuggestionData[suggestionKey] = firstSuggestion[i];
                                }
                                setSuggestionData(newSuggestionData);
                            }
                        }
                    } catch (error) {
                        logger.error('Error generating autocomplete:', error);
                    }
                    }, 300); // 300ms debounce
                } // End if isAutocompleteEnabled

                // Mark that we just typed a character (for IME composition logic)
                // But not for space, since space ends composition
                if (key !== ' ') {
                    justTypedCharRef.current = true;
                }
            }
        }
        // --- Other ---
        else {
            preventDefault = false; // Don't prevent default for unhandled keys
        }

        // === Update State ===
        if (moved) {
            setCursorPos(nextCursorPos);
            // Update ref synchronously so IME composition handlers see the latest position
            cursorPosRef.current = nextCursorPos;

            // Camera tracking modes
            updateCameraTracking(nextCursorPos);
            
            // Update selection based on movement and shift key
            // Only use shift for selection when using navigation keys, not when typing
            if (shiftKey && (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight')) {
                 updateSelection(nextCursorPos);
            } else if (!isMod && key !== 'Delete' && key !== 'Backspace' && key !== '/') {
                 // Clear selection if moving without Shift/Mod,
                 // unless it was Backspace/Delete which handle selection internally
                 // Also preserve selection when typing '/' to open command mode
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
        handleCommandKeyDown, textColor, currentTextStyle, findListAt, getNoteRegion, getMailRegion
        // Include setters used directly in the handler (if any, preferably avoid)
        // setCursorPos, setWorldData, setSelectionStart, setSelectionEnd // Setters are stable, no need to list
    ]);

    const handleCanvasClick = useCallback((canvasRelativeX: number, canvasRelativeY: number, clearSelection: boolean = false, shiftKey: boolean = false, metaKey: boolean = false, ctrlKey: boolean = false): void => {
        // Clear autocomplete on canvas click
        clearAutocompleteSuggestions();

        const newCursorPos = screenToWorld(canvasRelativeX, canvasRelativeY, zoomLevel, viewOffset);

        // === Cmd+Click to Add Text Block to Clipboard ===
        if ((metaKey || ctrlKey) && !shiftKey) {

            // Find connected text block at cursor position
            const findTextBlock = (startPos: Point): Point[] => {
                const visited = new Set<string>();
                const textPositions: Point[] = [];
                const queue: Point[] = [startPos];

                while (queue.length > 0) {
                    const pos = queue.shift()!;
                    const key = `${pos.x},${pos.y}`;

                    if (visited.has(key)) continue;
                    visited.add(key);

                    const charData = worldData[key];
                    // Skip if this is image data
                    if (isImageData(charData)) continue;

                    const char = charData ? getCharacter(charData) : '';

                    if (char && char.trim() !== '') {
                        textPositions.push(pos);

                        // Check all 4 directions
                        const directions = [
                            { x: pos.x - 1, y: pos.y },
                            { x: pos.x + 1, y: pos.y },
                            { x: pos.x, y: pos.y - 1 },
                            { x: pos.x, y: pos.y + 1 }
                        ];

                        for (const dir of directions) {
                            const dirKey = `${dir.x},${dir.y}`;
                            if (!visited.has(dirKey)) {
                                queue.push(dir);
                            }
                        }
                    } else if (textPositions.length > 0) {
                        // If we've found text and this is a space, check if it connects text
                        const leftData = worldData[`${pos.x - 1},${pos.y}`];
                        const rightData = worldData[`${pos.x + 1},${pos.y}`];
                        const hasTextLeft = leftData && !isImageData(leftData) && getCharacter(leftData).trim() !== '';
                        const hasTextRight = rightData && !isImageData(rightData) && getCharacter(rightData).trim() !== '';

                        if (hasTextLeft || hasTextRight) {
                            if (!visited.has(`${pos.x - 1},${pos.y}`)) queue.push({ x: pos.x - 1, y: pos.y });
                            if (!visited.has(`${pos.x + 1},${pos.y}`)) queue.push({ x: pos.x + 1, y: pos.y });
                        }
                    }
                }

                // If no text found, search nearby 3x3
                if (textPositions.length === 0) {
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const checkPos = { x: startPos.x + dx, y: startPos.y + dy };
                            const checkKey = `${checkPos.x},${checkPos.y}`;
                            const checkData = worldData[checkKey];

                            if (checkData && !isImageData(checkData) && getCharacter(checkData).trim() !== '') {
                                return findTextBlock(checkPos);
                            }
                        }
                    }
                    return [];
                }

                return textPositions;
            };

            const textBlock = findTextBlock(newCursorPos);

            if (textBlock.length > 0) {
                // Calculate bounding box
                const minX = Math.min(...textBlock.map(p => p.x));
                const maxX = Math.max(...textBlock.map(p => p.x));
                const minY = Math.min(...textBlock.map(p => p.y));
                const maxY = Math.max(...textBlock.map(p => p.y));

                // Extract text content line by line
                const content: string[] = [];
                for (let y = minY; y <= maxY; y++) {
                    let line = '';
                    for (let x = minX; x <= maxX; x++) {
                        const cellKey = `${x},${y}`;
                        const char = worldData[cellKey];
                        if (typeof char === 'string') {
                            line += char;
                        } else if (char && typeof char === 'object' && 'char' in char) {
                            line += char.char;
                        } else {
                            line += ' ';
                        }
                    }
                    content.push(line.trimEnd());
                }

                const contentString = content.join('\n');

                // Check if this content already exists in clipboard
                const existingItem = clipboardItems.find(item => item.content === contentString);

                if (existingItem) {
                    // Already in clipboard, just show feedback
                    setDialogueWithRevert(`Already in clipboard: ${content[0]?.substring(0, 20) || 'text'}...`, setDialogueText);
                    return; // Don't process regular click behavior
                }

                // Create clipboard item
                const clipboardItem: ClipboardItem = {
                    id: `${minX},${minY}-${Date.now()}`,
                    content: contentString,
                    startX: minX,
                    endX: maxX,
                    startY: minY,
                    endY: maxY,
                    maxY: maxY,
                    title: undefined,
                    color: undefined,
                    timestamp: Date.now()
                };

                // Add to clipboard (prepend to keep most recent first)
                setClipboardItems(prev => [clipboardItem, ...prev]);

                // Visual feedback
                setDialogueWithRevert(`Added to clipboard: ${content[0]?.substring(0, 20) || 'text'}...`, setDialogueText);

                return; // Don't process regular click behavior
            }
        }

        // Check if clicking in a glitched region - block cursor movement if so
        let isInGlitchedRegion = false;
        for (const key in worldData) {
            if (key.startsWith('glitched_')) {
                try {
                    const glitchData = JSON.parse(worldData[key] as string);
                    if (newCursorPos.x >= glitchData.startX && newCursorPos.x <= glitchData.endX &&
                        newCursorPos.y >= glitchData.startY && newCursorPos.y <= glitchData.endY) {
                        isInGlitchedRegion = true;
                        break;
                    }
                } catch (e) {
                    // Skip invalid glitch data
                }
            }
        }

        if (isInGlitchedRegion) {
            // Don't allow cursor movement into glitched regions
            return;
        }

        // === Click to Toggle Task Completion ===
        // Check if clicked within a task region
        for (const key in worldData) {
            if (key.startsWith('task_')) {
                try {
                    const taskData = JSON.parse(worldData[key] as string);
                    const { startX, endX, startY, endY } = taskData;

                    // Check if click is within task bounds
                    if (newCursorPos.x >= startX && newCursorPos.x <= endX &&
                        newCursorPos.y >= startY && newCursorPos.y <= endY) {
                        // Toggle task completion
                        const updatedTaskData = {
                            ...taskData,
                            completed: !taskData.completed
                        };

                        setWorldData(prev => ({
                            ...prev,
                            [key]: JSON.stringify(updatedTaskData)
                        }));

                        const status = updatedTaskData.completed ? 'completed' : 'reopened';
                        setDialogueWithRevert(`Task ${status}`, setDialogueText);

                        return; // Don't process regular click behavior
                    }
                } catch (e) {
                    // Skip invalid task data
                }
            }
        }

        // === Click to Open Link ===
        // Check if clicked within a link region
        for (const key in worldData) {
            if (key.startsWith('link_')) {
                try {
                    const linkData = JSON.parse(worldData[key] as string);
                    const { startX, endX, startY, endY, url } = linkData;

                    // Check if click is within link bounds
                    if (newCursorPos.x >= startX && newCursorPos.x <= endX &&
                        newCursorPos.y >= startY && newCursorPos.y <= endY) {
                        // Open link in new tab
                        window.open(url, '_blank', 'noopener,noreferrer');
                        setDialogueWithRevert(`Opening link...`, setDialogueText);

                        return; // Don't process regular click behavior
                    }
                } catch (e) {
                    // Skip invalid link data
                }
            }
        }

        // === Click Mail Send Link ===
        // Check if clicked on "send" link in mail regions
        for (const key in worldData) {
            if (key.startsWith('mail_')) {
                try {
                    const mailData = JSON.parse(worldData[key] as string);
                    const { startX, endX, startY, endY } = mailData;

                    // "send" text is positioned at bottom-right (endX-3 to endX, at endY)
                    const sendText = 'send';
                    const sendStartX = endX - sendText.length + 1;
                    const sendEndX = endX;
                    const sendY = endY;

                    // Check if click is within "send" bounds
                    if (newCursorPos.x >= sendStartX && newCursorPos.x <= sendEndX &&
                        newCursorPos.y === sendY) {

                        // Parse mail content
                        let toLine = '';
                        let subjectLine = '';
                        let messageLines: string[] = [];

                        // Extract row 1 (to)
                        for (let x = startX; x <= endX; x++) {
                            const row1Key = `${x},${startY}`;
                            const row1Data = worldData[row1Key];
                            if (row1Data && !isImageData(row1Data)) {
                                toLine += getCharacter(row1Data) || '';
                            }

                            // Extract row 2 (subject)
                            if (endY >= startY + 1) {
                                const row2Key = `${x},${startY + 1}`;
                                const row2Data = worldData[row2Key];
                                if (row2Data && !isImageData(row2Data)) {
                                    subjectLine += getCharacter(row2Data) || '';
                                }
                            }
                        }

                        // Extract message (row 3+)
                        // Treat consecutive non-empty lines as continuous text (word-wrapped)
                        // Only break paragraphs on empty lines
                        let currentParagraph = '';
                        const paragraphs: string[] = [];
                        
                        for (let y = startY + 2; y <= endY; y++) {
                            let rowContent = '';
                            for (let x = startX; x <= endX; x++) {
                                const cellKey = `${x},${y}`;
                                const cellData = worldData[cellKey];
                                if (cellData && !isImageData(cellData)) {
                                    rowContent += getCharacter(cellData) || '';
                                }
                            }
                            
                            const trimmedRow = rowContent.trim();
                            if (trimmedRow) {
                                // Non-empty line - add to current paragraph with space
                                if (currentParagraph) {
                                    currentParagraph += ' ' + trimmedRow;
                                } else {
                                    currentParagraph = trimmedRow;
                                }
                            } else if (currentParagraph) {
                                // Empty line - end current paragraph
                                paragraphs.push(currentParagraph);
                                currentParagraph = '';
                            }
                        }
                        
                        // Add final paragraph if exists
                        if (currentParagraph) {
                            paragraphs.push(currentParagraph);
                        }

                        const to = toLine.trim();
                        const subject = subjectLine.trim();
                        const message = paragraphs.join('\n\n'); // Double newline between paragraphs

                        if (!to || !subject || !message) {
                            setDialogueWithRevert('Missing fields: To (row 1), Subject (row 2), Message (row 3+)', setDialogueText);
                            return;
                        }

                        // Send email via API
                        setDialogueWithRevert('Sending email...', setDialogueText);
                        setAiProcessingRegion({ startX, endX, startY, endY });

                        fetch('/api/mail/send', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email: to, subject, message })
                        })
                        .then(response => response.json())
                        .then(result => {
                            if (result.success) {
                                setDialogueWithRevert('Email sent successfully!', setDialogueText);
                            } else {
                                setDialogueWithRevert(`Failed to send: ${result.error}`, setDialogueText);
                            }
                        })
                        .catch(error => {
                            setDialogueWithRevert('Error sending email', setDialogueText);
                            console.error(error);
                        })
                        .finally(() => {
                            setAiProcessingRegion(null);
                        });

                        return; // Don't process regular click behavior
                    }
                } catch (e) {
                    // Skip invalid mail data
                }
            }
        }

        // If in chat mode, clear previous input when clicking
        if (chatMode.isActive && chatMode.currentInput) {
            setChatData({});
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
    }, [zoomLevel, viewOffset, screenToWorld, selectionStart, selectionEnd, chatMode, worldData, setDialogueText, clipboardItems, getCharacter, isImageData]);

    const handleCanvasWheel = useCallback((deltaX: number, deltaY: number, canvasRelativeX: number, canvasRelativeY: number, ctrlOrMetaKey: boolean): void => {
        // First, check if mouse is over a list (unless zooming with ctrl/meta)
        if (!ctrlOrMetaKey) {
            const worldPos = screenToWorld(canvasRelativeX, canvasRelativeY, zoomLevel, viewOffset);
            const listAtPos = findListAt(worldPos.x, worldPos.y);

            if (listAtPos) {
                // Scroll the list content instead of panning world
                const { key, data } = listAtPos;
                const scrollSpeed = 3; // Lines per scroll tick
                const scrollDelta = Math.sign(deltaY) * scrollSpeed;

                // Get content length from storage
                const contentKey = `${key}_content`;
                const contentData = worldData[contentKey];
                let totalLines = 0;
                if (contentData) {
                    try {
                        const content = JSON.parse(worldData[contentKey] as string) as ListContent;
                        totalLines = Object.keys(content).length;
                    } catch (e) {
                        // Invalid content, treat as empty
                    }
                }

                // Calculate max scroll offset
                const maxScroll = Math.max(0, totalLines - data.visibleHeight);

                // Update scroll offset with bounds checking
                const newScrollOffset = Math.max(0, Math.min(maxScroll, data.scrollOffset + scrollDelta));

                // Update list data with new scroll offset
                const updatedListData = { ...data, scrollOffset: newScrollOffset };
                setWorldData(prev => ({
                    ...prev,
                    [key]: JSON.stringify(updatedListData)
                }));

                return; // Don't pan world
            }
        }

        if (ctrlOrMetaKey) {
            // Zooming
            if (isFullscreenMode && fullscreenRegion) {
                // In fullscreen mode, allow zoom but constrain to keep region visible
                const worldPointBeforeZoom = screenToWorld(canvasRelativeX, canvasRelativeY, zoomLevel, viewOffset);
                const delta = deltaY * ZOOM_SENSITIVITY;
                let newZoom = zoomLevel * (1 - delta);

                // Calculate zoom bounds based on region width
                const regionWidth = fullscreenRegion.endX - fullscreenRegion.startX + 1;
                const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 800;
                const { width: baseCharWidth } = getEffectiveCharDims(1.0);
                const fitZoom = viewportWidth / (regionWidth * baseCharWidth);

                // Allow zoom from 50% of fit to 200% of fit
                const minZoom = fitZoom * 0.5;
                const maxZoom = fitZoom * 2.0;
                newZoom = Math.min(Math.max(newZoom, minZoom), maxZoom);

                const { width: effectiveWidthAfter } = getEffectiveCharDims(newZoom);
                if (effectiveWidthAfter === 0) return;

                // Keep X centered on region, allow Y to follow mouse
                const regionCenterX = fullscreenRegion.startX + regionWidth / 2;
                const newViewOffsetX = regionCenterX - (viewportWidth / 2 / effectiveWidthAfter);
                const newViewOffsetY = worldPointBeforeZoom.y - (canvasRelativeY / effectiveWidthAfter);

                setZoomLevel(newZoom);
                setViewOffset({ x: newViewOffsetX, y: newViewOffsetY });
                return;
            }

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

            // Constrain panning if in fullscreen mode
            if (isFullscreenMode && fullscreenRegion) {
                // Allow scrolling within region bounds with margins
                const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 800;
                const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 600;
                const viewportWidthInChars = viewportWidth / effectiveCharWidth;
                const viewportHeightInChars = viewportHeight / effectiveCharHeight;

                const regionWidth = fullscreenRegion.endX - fullscreenRegion.startX + 1;
                const horizontalMargin = regionWidth * 0.2; // 20% margin on each side
                const verticalMargin = viewportHeightInChars * 0.5; // 50% viewport margin top

                setViewOffset(prev => {
                    const newX = prev.x + deltaWorldX;
                    const newY = prev.y + deltaWorldY;

                    // Allow horizontal panning within margins
                    const minX = fullscreenRegion.startX - horizontalMargin;
                    const maxX = fullscreenRegion.endX + horizontalMargin - viewportWidthInChars;

                    // Vertical bounds - allow margin above region start, infinite below
                    const minY = fullscreenRegion.startY - verticalMargin;

                    return {
                        x: Math.max(minX, Math.min(maxX, newX)),
                        y: Math.max(minY, newY)
                    };
                });
            } else {
                setViewOffset(prev => ({ x: prev.x + deltaWorldX, y: prev.y + deltaWorldY }));
            }
        }
    }, [zoomLevel, viewOffset, screenToWorld, getEffectiveCharDims, findListAt, worldData, isFullscreenMode, fullscreenRegion]);

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
        let newOffset = {
            x: panStartInfo.startOffset.x - deltaWorldX,
            y: panStartInfo.startOffset.y - deltaWorldY,
        };

        // Constrain panning if in fullscreen mode
        if (isFullscreenMode && fullscreenRegion) {
            const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 800;
            const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 600;
            const viewportWidthInChars = viewportWidth / effectiveCharWidth;
            const viewportHeightInChars = viewportHeight / effectiveCharHeight;

            const regionWidth = fullscreenRegion.endX - fullscreenRegion.startX + 1;
            const horizontalMargin = regionWidth * 0.2; // 20% margin on each side
            const verticalMargin = viewportHeightInChars * 0.5; // 50% viewport margin top

            // Allow horizontal panning within margins
            const minX = fullscreenRegion.startX - horizontalMargin;
            const maxX = fullscreenRegion.endX + horizontalMargin - viewportWidthInChars;
            newOffset.x = Math.max(minX, Math.min(maxX, newOffset.x));

            // Vertical - allow margin above region start, infinite below
            const minY = fullscreenRegion.startY - verticalMargin;
            newOffset.y = Math.max(minY, newOffset.y);
        }

        // Track viewport history with throttling to prevent infinite loops
        if (typeof window !== 'undefined' && effectiveCharWidth > 0 && effectiveCharHeight > 0) {
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const centerX = newOffset.x + (viewportWidth / effectiveCharWidth) / 2;
            const centerY = newOffset.y + (viewportHeight / effectiveCharHeight) / 2;

        }

        return newOffset;
    }, [zoomLevel, getEffectiveCharDims, viewOffset, isFullscreenMode, fullscreenRegion]);

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

        // In note mode, show prompt to confirm region with Enter
        if (currentMode === 'note' && selectionStart && selectionEnd) {
            setDialogueWithRevert("Press Enter to confirm note region, or Escape to cancel", setDialogueText);
        }

        // We keep the selection intact regardless
        // The selection will be cleared in other functions if needed
        // This allows the selection to persist after mouse up
    }, [currentMode, selectionStart, selectionEnd, setDialogueText]);

    // === IME Composition Handlers ===
    const handleCompositionStart = useCallback((): void => {
        setIsComposing(true);
        isComposingRef.current = true; // Update ref synchronously

        const currentPos = { ...cursorPosRef.current };
        // Save the original cursor position in case composition is cancelled
        preCompositionCursorPosRef.current = { ...currentPos };

        let startPos: Point;

        // Only back up if we just typed a character (trigger character for composition)
        if (justTypedCharRef.current) {
            // Back up one position to where the trigger character was written
            startPos = { x: currentPos.x - 1, y: currentPos.y };

            // Remove the trigger character from the appropriate data store
            const triggerKey = `${startPos.x},${startPos.y}`;

            if (chatMode.isActive && !commandState.isActive) {
                // Remove from chatData
                setChatData(prev => {
                    const newChatData = { ...prev };
                    delete newChatData[triggerKey];
                    return newChatData;
                });

                // Remove from chat mode input and positions
                setChatMode(prev => ({
                    ...prev,
                    currentInput: prev.currentInput.slice(0, -1),
                    inputPositions: prev.inputPositions.slice(0, -1)
                }));
            } else if (commandState.isActive) {
                // Remove from commandData using command system helper
                removeCompositionTrigger();
            } else {
                // Regular mode: Remove from worldData
                setWorldData(prev => {
                    const newWorldData = { ...prev };
                    delete newWorldData[triggerKey];
                    return newWorldData;
                });
            }

            // Move cursor back to where composition should start
            setCursorPos(startPos);
            cursorPosRef.current = startPos;

            // Reset the flag
            justTypedCharRef.current = false;
        } else {
            // No trigger character, start composition at current position
            startPos = currentPos;
            // Clear the flag anyway to be safe
            justTypedCharRef.current = false;
        }

        setCompositionStartPos(startPos);
        compositionStartPosRef.current = startPos;
        setCompositionText('');
    }, [chatMode.isActive, commandState.isActive, removeCompositionTrigger]);

    const handleCompositionUpdate = useCallback((text: string): void => {
        setCompositionText(text);
    }, []);

    const handleCompositionEnd = useCallback((text: string): void => {
        // If composition was cancelled by mode exit, don't process the text
        if (compositionCancelledByModeExitRef.current) {
            compositionCancelledByModeExitRef.current = false;
            return;
        }

        // Use ref to get the most up-to-date start position synchronously
        const startPos = compositionStartPosRef.current || cursorPosRef.current;

        // Clear composition state FIRST to remove preview immediately
        setIsComposing(false);
        isComposingRef.current = false; // Update ref synchronously
        setCompositionText('');
        setCompositionStartPos(null);
        compositionStartPosRef.current = null;

        if (!text) {
            // Composition was cancelled (e.g., backspace emptied it)
            // Keep cursor at composition start position (where the trigger was)
            // Mark that we just cancelled composition so next backspace is skipped
            justCancelledCompositionRef.current = true;
            preCompositionCursorPosRef.current = null;
            return;
        }
        // Calculate final cursor position after placing all characters
        const finalCursorPos = { x: startPos.x + text.length, y: startPos.y };

        // Detect which mode is active and write to appropriate data store
        if (chatMode.isActive && !commandState.isActive) {
            // Chat mode: write to chatData and update chatMode state
            setChatData(prev => {
                const newChatData = { ...prev };
                let currentPos = { ...startPos };

                for (const char of text) {
                    const key = `${currentPos.x},${currentPos.y}`;
                    newChatData[key] = char;
                    currentPos.x++;
                }

                return newChatData;
            });

            // Update chat mode input and positions
            setChatMode(prev => {
                const newPositions = [...prev.inputPositions];
                let currentPos = { ...startPos };

                for (const char of text) {
                    newPositions.push({ ...currentPos });
                    currentPos.x++;
                }

                return {
                    ...prev,
                    currentInput: prev.currentInput + text,
                    inputPositions: newPositions
                };
            });
        } else if (commandState.isActive) {
            // Command mode: use command system's helper to handle composed text
            addComposedText(text, startPos);
        } else {
            // Regular mode: write to worldData with styling
            setWorldData(prev => {
                const newWorldData = { ...prev };
                let currentPos = { ...startPos };

                for (const char of text) {
                    const key = `${currentPos.x},${currentPos.y}`;

                    // Check if current text style is different from global defaults
                    const hasCustomStyle = currentTextStyle.color !== textColor || currentTextStyle.background !== undefined;

                    if (hasCustomStyle) {
                        // Store styled character
                        const style: { color?: string; background?: string } = {
                            color: currentTextStyle.color
                        };
                        if (currentTextStyle.background !== undefined) {
                            style.background = currentTextStyle.background;
                        }

                        newWorldData[key] = {
                            char: char,
                            style: style
                        };
                    } else {
                        // Store plain character
                        newWorldData[key] = char;
                    }

                    currentPos.x++;
                }

                return newWorldData;
            });
        }

        // Update cursor position to after the composed text
        setCursorPos(finalCursorPos);
        cursorPosRef.current = finalCursorPos;

        // Clear the refs
        justTypedCharRef.current = false;
        preCompositionCursorPosRef.current = null;
        justCancelledCompositionRef.current = false;
    }, [currentTextStyle, textColor, chatMode.isActive, commandState.isActive, addComposedText]);

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
        commandSystem: { selectCommand, executeCommandString, startCommand, startCommandWithInput },
        chatData,
        suggestionData,
        lightModeData,
        searchData,
        viewOffset,
        cursorPos,
        zoomLevel,
        backgroundMode,
        backgroundColor,
        backgroundImage,
        backgroundVideo,
        backgroundStream,
        switchBackgroundMode,
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
        aiProcessingRegion,
        selectedNoteKey, // Expose selected note key for canvas
        setSelectedNoteKey, // Allow canvas to update selected note
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
        boundKeys, // Cached list of bound_ keys for performance
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
        dialogueTimestamp,
        setDialogueText,
        setTapeRecordingCallback,
        tapeRecordingCallback: tapeRecordingCallbackRef.current,
        setScreenshotCallback,
        chatMode,
        setChatMode,
        clearChatData: () => setChatData({}),
        latexMode,
        setLatexMode,
        latexData,
        clearLatexData: () => setLatexData({}),
        smilesMode,
        setSmilesMode,
        smilesData,
        clearSmilesData: () => setSmilesData({}),
        clearLightModeData: clearLightModeData,
        hostMode,
        setHostMode,
        hostData,
        setHostData,
        stagedImageData, // Ephemeral staged images
        setStagedImageData, // Update staged image (for moving/resizing)
        clipboardItems, // Clipboard items from Cmd+click on bounds
        addInstantAIResponse,
        setWorldData,
        setMonogramCommandHandler: (handler: (args: string[]) => void) => {
            monogramCommandHandlerRef.current = handler;
        },
        setHostDialogueHandler: (handler: () => void) => {
            hostDialogueHandlerRef.current = handler;
        },
        setUpgradeFlowHandler: (handler: () => void) => {
            upgradeFlowHandlerRef.current = handler;
        },
        triggerUpgradeFlow: () => {
            if (upgradeFlowHandlerRef.current) {
                upgradeFlowHandlerRef.current();
            }
        },
        setTutorialFlowHandler: (handler: () => void) => {
            tutorialFlowHandlerRef.current = handler;
        },
        triggerTutorialFlow: () => {
            if (tutorialFlowHandlerRef.current) {
                tutorialFlowHandlerRef.current();
            }
        },
        setCommandValidationHandler: (handler: (command: string, args: string[], worldState?: any) => boolean) => {
            commandValidationHandlerRef.current = handler;
        },
        // Agent system
        agentEnabled,
        agentPos,
        agentState,
        agentSelectionStart,
        agentSelectionEnd,
        // Multiplayer cursors
        multiplayerCursors,
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
        cameraMode,
        setCameraMode,
        gridMode,
        cycleGridMode,
        artefactsEnabled,
        artifactType,
        isReadOnly, // Read-only mode flag
        // IME composition support
        isComposing,
        compositionText,
        compositionStartPos,
        handleCompositionStart,
        handleCompositionUpdate,
        handleCompositionEnd,
        // Face detection
        isFaceDetectionEnabled,
        faceOrientation,
        setFaceDetectionEnabled,
    };
}