import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Point, WorldData } from './world.engine';
import { rewrapNoteText, findConnectedPaintRegion, getAllPaintBlobs, calculatePatternBorderCells, createPaintBlob, regeneratePatternPaint } from './world.engine';
import { generateImage, generateVideo, setDialogueWithRevert } from './ai';
import { detectImageIntent } from './ai.utils';
import { MAKE_ACTIONS, AGENT_MOVEMENT } from './ai.tools';
import type { WorldSettings } from './settings';
import { useFaceDetection, useSmoothFaceOrientation, faceOrientationToRotation } from './face';
import { DataRecorder } from './recorder';
import { saveSprite, getUserSprites, deleteSprite, renameSprite, type SavedSprite, getUserTilesets, deleteTileset, type SavedTileset } from '../firebase';
import { applySkin, getAvailableEffects } from './post';

// Grid cell span constant (characters occupy 2 vertically-stacked cells)
const GRID_CELL_SPAN = 2;

// Sprite sheet configuration
const SPRITE_DIRECTIONS = [
    'south', 'south-west', 'west', 'north-west',
    'north', 'north-east', 'east', 'south-east'
] as const;
const WALK_FRAME_SIZE = { width: 32, height: 40 };
const IDLE_FRAME_SIZE = { width: 32, height: 40 };
const WALK_FRAMES_PER_DIR = 8;
const IDLE_FRAMES_PER_DIR = 8;

// Composite individual direction images into a sprite sheet using Canvas API
async function compositeSpriteSheet(
    directionImages: Record<string, string>,
    frameSize: { width: number; height: number },
    framesPerDirection: number
): Promise<string> {
    const sheetWidth = frameSize.width * framesPerDirection;
    const sheetHeight = frameSize.height * SPRITE_DIRECTIONS.length;

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = sheetWidth;
    canvas.height = sheetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');

    // Load and draw each direction
    for (let row = 0; row < SPRITE_DIRECTIONS.length; row++) {
        const direction = SPRITE_DIRECTIONS[row];
        const base64 = directionImages[direction];
        if (!base64) continue;

        // Load image from base64
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = `data:image/png;base64,${base64}`;
        });

        // Calculate scaling to fit frame
        const scale = Math.min(
            frameSize.width / img.width,
            frameSize.height / img.height
        );
        const scaledWidth = img.width * scale;
        const scaledHeight = img.height * scale;
        const offsetX = (frameSize.width - scaledWidth) / 2;
        const offsetY = (frameSize.height - scaledHeight) / 2;

        // Draw the same image for each frame column (static sprite)
        for (let col = 0; col < framesPerDirection; col++) {
            ctx.drawImage(
                img,
                col * frameSize.width + offsetX,
                row * frameSize.height + offsetY,
                scaledWidth,
                scaledHeight
            );
        }
    }

    // Return as data URL
    return canvas.toDataURL('image/png');
}

// Composite sprite sheet from Storage refs (CORS is enabled on bucket)
async function compositeSpriteSheetFromRefs(
    storageRefs: { direction: string; ref: any }[],
    frameSize: { width: number; height: number },
    framesPerDirection: number
): Promise<string> {

    const sheetWidth = frameSize.width * framesPerDirection;
    const sheetHeight = frameSize.height * SPRITE_DIRECTIONS.length;

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = sheetWidth;
    canvas.height = sheetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');

    const { getDownloadURL } = await import('firebase/storage');

    // Load and draw each direction
    for (let row = 0; row < SPRITE_DIRECTIONS.length; row++) {
        const direction = SPRITE_DIRECTIONS[row];
        const refInfo = storageRefs.find(r => r.direction === direction);
        if (!refInfo) {
            continue;
        }

        // Get download URL and load with CORS
        const url = await getDownloadURL(refInfo.ref);

        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = 'anonymous'; // CORS is now enabled on bucket
            image.onload = () => resolve(image);
            image.onerror = (e) => {
                console.error(`[compositeSpriteSheetFromRefs] Failed to load ${direction}:`, e);
                reject(new Error(`Failed to load image for ${direction}`));
            };
            image.src = url;
        });

        // Calculate scaling to fit frame
        const scale = Math.min(
            frameSize.width / img.width,
            frameSize.height / img.height
        );
        const scaledWidth = img.width * scale;
        const scaledHeight = img.height * scale;
        const offsetX = (frameSize.width - scaledWidth) / 2;
        const offsetY = (frameSize.height - scaledHeight) / 2;

        // Draw the same image for each frame column (static sprite)
        for (let col = 0; col < framesPerDirection; col++) {
            ctx.drawImage(
                img,
                col * frameSize.width + offsetX,
                row * frameSize.height + offsetY,
                scaledWidth,
                scaledHeight
            );
        }
    }

    return canvas.toDataURL('image/png');
}

// Composite sprite sheet from URL map (CORS is enabled on bucket)
async function compositeSpriteSheetFromUrls(
    storagePaths: Record<string, string>,
    frameSize: { width: number; height: number },
    framesPerDirection: number
): Promise<string> {
    const sheetWidth = frameSize.width * framesPerDirection;
    const sheetHeight = frameSize.height * SPRITE_DIRECTIONS.length;

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = sheetWidth;
    canvas.height = sheetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');

    // Load and draw each direction
    for (let row = 0; row < SPRITE_DIRECTIONS.length; row++) {
        const direction = SPRITE_DIRECTIONS[row];
        const url = storagePaths[direction];
        if (!url) {
            continue;
        }

        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = 'anonymous'; // CORS is now enabled on bucket
            image.onload = () => resolve(image);
            image.onerror = (e) => {
                console.error(`[compositeSpriteSheetFromUrls] Failed to load ${direction}:`, e);
                reject(new Error(`Failed to load image for ${direction}`));
            };
            image.src = url;
        });

        // Calculate scaling to fit frame
        const scale = Math.min(
            frameSize.width / img.width,
            frameSize.height / img.height
        );
        const scaledWidth = img.width * scale;
        const scaledHeight = img.height * scale;
        const offsetX = (frameSize.width - scaledWidth) / 2;
        const offsetY = (frameSize.height - scaledHeight) / 2;

        // Draw the same image for each frame column (static sprite)
        for (let col = 0; col < framesPerDirection; col++) {
            ctx.drawImage(
                img,
                col * frameSize.width + offsetX,
                row * frameSize.height + offsetY,
                scaledWidth,
                scaledHeight
            );
        }
    }

    return canvas.toDataURL('image/png');
}

// Composite animated frames from PixelLab into sprite sheet
async function compositeAnimatedSpriteSheet(
    animationFrames: Record<string, string[]>, // direction -> array of base64 frames
    frameSize: { width: number; height: number },
    framesPerDirection: number
): Promise<string> {
    const sheetWidth = frameSize.width * framesPerDirection;
    const sheetHeight = frameSize.height * SPRITE_DIRECTIONS.length;

    const canvas = document.createElement('canvas');
    canvas.width = sheetWidth;
    canvas.height = sheetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');

    // Draw each direction row with its animation frames
    for (let row = 0; row < SPRITE_DIRECTIONS.length; row++) {
        const direction = SPRITE_DIRECTIONS[row];
        const frames = animationFrames[direction];
        if (!frames) continue;

        // Draw each frame in this direction
        for (let col = 0; col < Math.min(frames.length, framesPerDirection); col++) {
            const frameBase64 = frames[col];

            // Load frame image
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = reject;
                image.src = `data:image/png;base64,${frameBase64}`;
            });

            // Calculate scaling to fit frame
            const scale = Math.min(
                frameSize.width / img.width,
                frameSize.height / img.height
            );
            const scaledWidth = img.width * scale;
            const scaledHeight = img.height * scale;
            const offsetX = (frameSize.width - scaledWidth) / 2;
            const offsetY = (frameSize.height - scaledHeight) / 2;

            // Draw to sprite sheet
            ctx.drawImage(
                img,
                col * frameSize.width + offsetX,
                row * frameSize.height + offsetY,
                scaledWidth,
                scaledHeight
            );
        }
    }

    return canvas.toDataURL('image/png');
}

// --- Command System Types ---
export interface CommandState {
    isActive: boolean;
    input: string;
    matchedCommands: string[];
    selectedIndex: number;
    commandStartPos: Point;
    originalCursorPos: Point; // Store original cursor position to restore on Escape
    hasNavigated: boolean; // Track if user has used arrow keys to navigate
    helpMode?: boolean; // Flag to show help text for all commands
    recordingTimestamp?: number; // Timestamp when command started (for playback sync)
}

export interface PendingCommand {
    command: string;
    args: string[];
    isWaitingForSelection: boolean;
}

export interface CommandExecution {
    command: string;
    args: string[];
    commandStartPos: Point;
    clipContent?: string; // For /clip command
}

// --- Mode System Types ---
export type CanvasMode = 'default' | 'air' | 'chat' | 'note';
export type BackgroundMode = 'transparent' | 'color' | 'image' | 'video' | 'space' | 'stream';
export type CameraMode = 'default' | 'focus';

export type GridMode = 'dots' | 'lines';
export type ArtifactType = 'images' | 'questions';

export interface ModeState {
    currentMode: CanvasMode;
    lightModeData: WorldData; // Ephemeral text data for air mode
    backgroundMode: BackgroundMode;
    backgroundColor?: string; // Optional - undefined for transparent stream/image backgrounds
    backgroundImage?: string; // URL or data URL for generated images
    backgroundVideo?: string; // URL or data URL for generated videos
    backgroundStream?: MediaStream; // MediaStream for screen share
    textColor: string;
    textBackground?: string; // Background color for text
    fontFamily: string; // Font family for text rendering
    currentTextStyle: {
        color: string;
        background?: string;
    }; // Current persistent text style
    searchPattern: string; // Current search pattern
    isSearchActive: boolean; // Whether search highlighting is active
    cameraMode: CameraMode; // Camera tracking mode
    isIndentEnabled: boolean; // Whether smart indentation is enabled for Enter key
    isMoveMode: boolean; // Whether move mode is active for dragging text blocks
    gridMode: GridMode; // 3D grid rendering mode
    artefactsEnabled: boolean; // Whether 3D artifacts are enabled in space mode
    artifactType: ArtifactType; // Type of artifacts to show (images or questions)
    isFullscreenMode: boolean; // Whether fullscreen/constrained mode is active
    fullscreenRegion?: { // The region to constrain viewport to
        type: 'bound' | 'list';
        key: string;
        startX: number;
        endX: number;
        startY: number;
        endY?: number; // For lists/finite bounds
    };
    isFaceDetectionEnabled: boolean; // Whether face-piloted geometry is active
    isCharacterEnabled: boolean; // Whether character sprite replaces cursor
    characterSprite?: { // Custom character sprite URLs (from /be <prompt>)
        walkSheet: string;
        idleSheet: string;
        name: string;
        ghostMode?: boolean; // If true, auto-applies ghost effect with textColor
        baseWalkPath?: string; // Original sprite path (before ghost effect)
        baseIdlePath?: string;
    };
    isGeneratingSprite?: boolean; // True while generating sprite via API
    spriteProgress?: number; // Current progress (0-8) for sprite generation
    spriteDebugLog?: string[]; // Debug log for sprite generation
    faceOrientation?: { // Face rotation and expression data from MediaPipe
        rotX: number;
        rotY: number;
        rotZ: number;
        mouthOpen?: number; // Mouth openness (0-1)
        leftEyeBlink?: number; // Left eye blink (0=open, 1=closed)
        rightEyeBlink?: number; // Right eye blink (0=open, 1=closed)
        isTracked?: boolean; // True if from MediaPipe tracking, false if autonomous
    };
    isPaintMode: boolean; // Whether paint mode is active
    paintTool: 'brush' | 'fill' | 'lasso' | 'eraser'; // Current paint tool
    paintColor: string; // Current paint brush color
    paintBrushSize: number; // Paint brush radius in cells
    isAgentMode: boolean; // Whether agent spawning mode is active
    agentSpriteName?: string; // Name of sprite to use for agents (uses ghost effect)
    isAgentAttached: boolean; // Whether selected agents are attached to cursor
    viewOverlay?: { // View overlay state for fullscreen note viewing
        noteKey: string; // Key of the note being viewed
        content: string; // Wrapped text content for the overlay
        scrollOffset: number; // Current scroll position
        maxScroll: number; // Maximum scroll value
    };
    isVoiceMode: boolean; // Whether voice input mode is active
    voiceState?: VoiceState; // Detailed voice mode state
}

// Voice mode state for speech-to-text
export interface VoiceState {
    isListening: boolean; // Currently listening for speech
    isProcessing: boolean; // Processing audio through AI
    transcript: string; // Current/partial transcript
    error?: string; // Any error message
    provider: 'browser' | 'gemini'; // Which STT provider to use
}

interface UseCommandSystemProps {
    setDialogueText: (text: string) => void;
    initialBackgroundColor?: string;
    initialTextColor?: string;
    skipInitialBackground?: boolean; // Skip applying initialBackgroundColor (let host flow control it)
    getAllChips?: () => Array<{text: string, x: number, y: number, color: string}>;
    getAllBounds?: () => Array<{startX: number, endX: number, startY: number, endY: number, color: string, title?: string}>;
    availableStates?: string[];
    username?: string;
    userUid?: string | null;
    membershipLevel?: string; // User's membership level (e.g., 'super', 'pro', etc.)
    updateSettings?: (settings: Partial<WorldSettings>) => void;
    settings?: WorldSettings;
    getEffectiveCharDims: (zoom: number) => { width: number; height: number; fontSize: number; };
    zoomLevel: number;
    clipboardItems?: Array<{id: string, content: string, startX: number, endX: number, startY: number, endY: number, timestamp: number}>;
    toggleRecording?: () => Promise<void> | void;
    isReadOnly?: boolean;
    getNormalizedSelection?: () => { startX: number, endX: number, startY: number, endY: number } | null;
    setWorldData?: (data: any) => void;
    worldData?: any;
    setSelectionStart?: (pos: { x: number, y: number } | null) => void;
    setSelectionEnd?: (pos: { x: number, y: number } | null) => void;
    uploadImageToStorage?: (dataUrl: string, mimeType?: string) => Promise<string>;
    triggerUpgradeFlow?: () => void;
    triggerTutorialFlow?: () => void;
    onCommandExecuted?: (command: string, args: string[]) => void;
    cancelComposition?: () => void; // Callback to cancel IME composition
    selectedNoteKey?: string | null; // Currently selected note
    selectedPatternKey?: string | null; // Currently selected pattern
    selectedAgentIds?: Set<string>; // Currently selected agent IDs
    currentScale?: { w: number; h: number }; // Current text scale
    setCurrentScale?: (scale: { w: number; h: number }) => void; // Set current text scale
    monogramSystem?: { // WebGPU monogram background system
        setOptions: (updater: ((prev: any) => any) | any) => void;
        toggleEnabled: () => void;
        options?: {
            enabled?: boolean;
            speed?: number;
            complexity?: number;
            mode?: 'clear' | 'perlin' | 'nara' | 'voronoi' | 'face3d';
        };
    };
    recorder?: DataRecorder;
    setBounds?: (bounds: { minX: number; minY: number; maxX: number; maxY: number } | undefined) => void; // Set canvas bounds dynamically
    setBoundWindow?: (window: { windowX: number; windowY: number; windowWidth: number; windowHeight: number; titleBarHeight: number } | undefined) => void; // Set windowed bound mode
    canvasState?: 0 | 1; // Current canvas state (0=infinite, 1=bounded)
    setCanvasState?: (state: 0 | 1) => void; // Toggle canvas state (0=infinite, 1=bounded)
    setBoundedWorldData?: (data: any) => void; // Clear/set ephemeral bounded world data
    boundedSource?: { type: 'note' | 'selection' | 'empty'; noteKey?: string; originalBounds: { minX: number; minY: number; maxX: number; maxY: number }; boundedMinX: number; boundedMinY: number } | null;
    setBoundedSource?: (source: { type: 'note' | 'selection' | 'empty'; noteKey?: string; originalBounds: { minX: number; minY: number; maxX: number; maxY: number }; boundedMinX: number; boundedMinY: number } | null) => void;
    boundedWorldData?: Record<string, any>; // Current bounded world data for syncing back
    setZoomLevel?: (zoom: number) => void; // Set zoom level for auto-zoom on bound
    setViewOffset?: (offset: { x: number; y: number }) => void; // Set view offset for centering on bound
    selectionStart?: { x: number; y: number } | null; // Current selection start for bounding from selection
    selectionEnd?: { x: number; y: number } | null; // Current selection end for bounding from selection
    setProcessingRegion?: (region: { startX: number; endX: number; startY: number; endY: number } | null) => void; // Set processing region for visual feedback
}

// --- Command System Constants ---
// Commands available in read-only mode (not authenticated or not owner)
const READ_ONLY_COMMANDS = ['signin', 'share'];

// Commands organized by category for logical ordering
const AVAILABLE_COMMANDS = [
    // Navigation & View
    'nav', 'search', 'cam', 'indent', 'zoom', 'map', 'view', 'bound',
    // Content Creation
    'chip', 'task', 'link', 'pack', 'clip', 'upload', 'paint', 'agent', 'pattern', 'connect', 'export', 'data', 'list', 'grow', 'duplicate', 'name',
    // Special
    'mode', 'note', 'mail', 'shell', 'chat', 'voice', 'talk', 'tutorial', 'help', 'script', 'run',
    // Styling & Display
    'bg', 'text', 'font', 'style', 'display', 'scale', 'be',
    // State Management
    'state', 'random', 'clear', 'replay',
    // Sharing & Publishing
    'publish', 'unpublish', 'share', 'spawn', 'monogram',
    // Recording
    'record',
    // Account
    'signin', 'signout', 'account', 'upgrade',
    // Debug
    'debug'
];

// Category mapping for visual organization
export const COMMAND_CATEGORIES: { [category: string]: string[] } = {
    'nav': ['nav', 'search', 'cam', 'indent', 'zoom', 'map', 'view', 'bound'],
    'create': ['chip', 'task', 'link', 'pack', 'clip', 'upload', 'paint', 'agent', 'export', 'data', 'list', 'grow', 'duplicate', 'name'],
    'special': ['mode', 'note', 'mail', 'shell', 'chat', 'voice', 'talk', 'tutorial', 'help', 'script', 'run'],
    'style': ['bg', 'text', 'font', 'style', 'display', 'be'],
    'state': ['state', 'random', 'clear', 'replay', 'record'],
    'share': ['publish', 'unpublish', 'share', 'spawn', 'monogram'],
    'account': ['signin', 'signout', 'account', 'upgrade'],
    'debug': ['debug']
};

const MODE_COMMANDS = ['default', 'air', 'chat', 'note'];
const BG_COMMANDS: string[] = []; // Removed 'clear', 'live', 'web' options
const FONT_COMMANDS = ['IBM Plex Mono', 'Neureal'];
const NAV_COMMANDS: string[] = [];
const CAMERA_COMMANDS = ['default', 'focus'];
const DISPLAY_COMMANDS = ['expand', 'scroll'];

// Detailed help descriptions for each command
export const COMMAND_HELP: { [command: string]: string } = {
    'nav': 'Navigate to chips or coordinates. /nav opens chip list, /nav chipName jumps to that chip, /nav x y jumps to coordinates. Chips act as spatial bookmarks.',
    'search': 'Search through all text on your canvas. Type /search followed by your query to find and navigate to specific content. Useful for finding ideas in large canvases.',
    'map': 'Generate a procedural map of ephemeral labels around your viewport. Creates a tasteful exploration terrain with temporary waypoints that disappear when you press Escape.',
    'cam': 'Control camera behavior. Use /cam focus to enable focus mode, which smoothly follows your cursor. Use /cam default to return to normal panning.',
    'indent': 'Toggle text indentation. This affects how new lines are indented when you press Enter, helping you organize thoughts hierarchically.',
    'view': 'View a note as a fullscreen overlay. Position cursor inside a note and type /view. The note content appears centered with margins, text wrapped to fit. Scroll if content overflows. Press Escape to exit.',
    'bound': 'Constrain canvas to a bounded region. Type /bound [width] [height] to limit the canvas (e.g., /bound 1000 1000 for 1M cells). Cursor and panning stay within bounds. Type /bound alone to remove bounds and return to infinite canvas.',
    'chip': 'Create a spatial chip at your current selection. Type /chip \'text\' [color]. Defaults to current text color (accent). Custom colors: /chip \'text\' crimson. Chips show as colored cells with cutout text.',
    'task': 'Create a toggleable task from selected text. Select text, then type /task [color]. Click the highlighted task to toggle completion (adds strikethrough). Click again to un-complete it.',
    'link': 'Create a clickable link from selected text. Select text, then type /link [url]. Click the underlined link to open the URL in a new tab. URLs are auto-detected when pasted.',
    'pack': 'Pack world data into a collapsible chip. Select region or cursor over note, then /pack [name] [color]. Or /pack [existingName] to instantiate a copy at cursor. Click pack to toggle collapsed/expanded.',
    'clip': 'Save selected text to your clipboard. Select text, then type /clip to capture it. Access your clips later to paste them anywhere on the canvas.',
    'export': 'Export selected area as a PNG image. Make a selection, then type /export to download it as an image. Use /export --grid to include grid lines in the export.',
    'upload': 'Upload files to your canvas. Images are rasterized to fit. Scripts (.js, .py) become executable script notes - use /run to execute. Also supports .json, .txt, .md, .csv as text notes.',
    'paint': 'Enter paint mode to draw filled regions on the canvas. Drag to draw a continuous stroke, double-click/double-tap to fill the enclosed area. Press ESC to exit.',
    'agent': 'Spawn and configure agents. /agent spawns at cursor. /agent [sprite] spawns specific sprite. Select agents then: /agent follow-color black, /agent sense radius 5, /agent list, /agent clear.',
    'data': 'Create a data table from selected text. Select CSV-formatted text (comma-separated values), then type /data to convert it into an interactive table with resizable columns and rows. First row becomes the header.',
    'script': 'Convert a note into an executable script. Usage: /script [lang]. Languages: js/javascript (default), py/python. Auto-detects Python from import, def, print(), etc. Use /run to execute.',
    'run': 'Execute the script note at cursor position. JavaScript uses print() or console.log(). Python uses Pyodide (~10MB, lazy loaded on first use). Use #!py at start of script for Python.',
    'grow': 'Run cellular automata from cursor position. Animates step by step. /grow [steps] [rule] [color]. Rules: life, grow, maze, seeds, coral. Example: /grow 20 coral green. Uses existing paint as seed if present.',
    'duplicate': 'Duplicate the note at cursor. Creates an identical copy 3 cells to the right. Also available via Cmd+D (Mac) or Ctrl+D (Windows).',
    'name': 'Name a note for script references. Usage: /name mydata. Named data notes can be read by scripts using nara.read_table("mydata"). Names must be unique and contain only letters, numbers, underscores.',
    'list': 'Create a scrollable list from selected text. Select text, then type /list [color]. The selection becomes a scrollable region. Drag to scroll through content that extends beyond the visible area.',
    'mode': 'Switch canvas modes. /mode default for standard writing, /mode air for ephemeral text that doesn\'t save, /mode chat to talk with AI, /mode note for focused note-taking.',
    'note': 'Quick shortcut to enter note mode. This creates a focused writing space perfect for drafting ideas before placing them on your main canvas.',
    'display': 'Toggle note display mode. Use inside a note: /display to toggle, /display expand to grow note as you type, /display scroll for terminal-style auto-scrolling. Controls how notes behave when text wraps beyond bounds.',
    'mail': '[SUPER ONLY] Create an email region. Select a rectangular area, type /mail. Row 1 = recipient email, Row 2 = subject line, Row 3+ = message body. Click the send button to deliver the email.',
    'shell': 'Convert a note into a terminal shell. Position cursor inside a note and type /shell to connect to the terminal server. Interact with the shell through the canvas. Supports keyboard input, arrow keys, and command history.',
    'chat': 'Quick shortcut to enter chat mode. Talk with AI to transform, expand, or generate text. The AI can help you develop ideas or create content based on your prompts.',
    'voice': 'Toggle voice input mode. Speak commands or dictate text using your microphone. Uses browser speech recognition for instant results or Gemini for higher accuracy. Say "stop" or press Escape to exit.',
    'talk': 'Enable face-piloted geometry with different face styles. Type /talk to use default Macintosh face, or /talk [facename] to select a specific face (macintosh, robot, kawaii). Activates your front webcam and tracks your face to control the face in real-time.',
    'tutorial': 'Start the interactive tutorial. Learn the basics of spatial writing through hands-on exercises that teach you core commands and concepts.',
    'help': 'Show this detailed help menu. The command list stays open with descriptions for every available command, so you can explore what\'s possible.',
    'tab': 'Toggle AI-powered autocomplete suggestions. When enabled, type and see AI suggestions appear as gray text. Press Tab to accept suggestions.',
    'bg': 'Change background. Use /bg [color] for solid colors (white, black, sulfur), /bg webcam for camera, /bg video for video, or /bg [prompt] to generate an AI background image.',
    'text': 'Change text color. Type /text followed by a color name (garden, sky, sunset, etc.). This sets the color for all new text you write on the canvas.',
    'font': 'Change font family. Type /font followed by a font name: "IBM Plex Mono" for a clean monospace font, or "Neureal" for a more stylized aesthetic.',
    'scale': 'Change text scale. Type /scale followed by dimensions like 1x2 (default), 1x6 (tall), or 4x4 (square). Affects new text you write.',
    'style': 'Apply visual styles to selected notes or patterns. Select a note/pattern or position cursor inside one, then type /style [stylename]. Available: solid (white border), glow (pulsing gray glow), glowing (enhanced bright glow). Example: /style glow',
    'state': 'Save or load canvas states. Type /state to see saved states, /state save [name] to save current canvas, /state load [name] to restore a saved state. Perfect for versioning your work.',
    'record': 'Record and replay sessions. /record start begins recording, /record stop saves and auto-plays. /record play replays most recent. /record load lists all, /record load <name> plays specific recording.',
    'random': 'Randomize text styling. Applies random colors and styles to your text for a more organic, playful aesthetic. Great for breaking out of rigid design patterns.',
    'clear': 'Clear all text from the canvas. WARNING: This deletes everything on your current canvas. Use /state save first if you want to preserve your work.',
    'publish': 'Publish your canvas publicly. Makes your canvas accessible at your public URL (nara.ws/username/canvasname). Others can view but not edit.',
    'unpublish': 'Unpublish your canvas. Makes your canvas private again. It will no longer be accessible at the public URL.',
    'share': 'Get a shareable link to your canvas. Copy this link to share your canvas with others. If published, they can view it; if private, you control access.',
    'spawn': 'Set your spawn point. This is where you\'ll start when you open this canvas. Type /spawn to set it to your current position.',
    'monogram': 'Control WebGPU background effects. /monogram to toggle on/off, /monogram clear for character glows only, /monogram perlin for perlin noise with character glows, /monogram nara for animated NARA text.',
    'signin': 'Sign in to your Nara account. Required for saving work, publishing canvases, and accessing AI features.',
    'signout': 'Sign out of your Nara account. You\'ll return to read-only mode.',
    'account': 'Manage your account settings. Use /account reset to reset your password.',
    'upgrade': 'Upgrade to Nara Pro for unlimited AI operations. Starts a guided conversation to learn about Pro benefits and pricing before upgrading.',
    'debug': 'Toggle debug mode. Shows technical information about canvas state, performance, and rendering. Useful for troubleshooting or understanding the system.',
    'be': 'Toggle ghost cursor. /be alone enables a ghost sprite that matches your text color. /be [prompt] generates a new character. Use /be --post [effect] <sprite> [color] to apply effects (monochrome, sepia, invert, ghost).'
};

// Standardized color mapping used throughout the application
export const COLOR_MAP: { [name: string]: string } = {
    'white': '#FFFFFF',
    'black': '#000000',
    'sulfur': '#F0FF6A',
    'chalk': '#69AED6',
    'cobalt': '#0B109F',
    'shamrock': '#10B981',
    'spring': '#D4FF00',
    'garden': '#162400',
    'crimson': '#FF5200',
    'orchid': '#FFC0CB',
};

// --- Command System Hook ---
export function useCommandSystem({ setDialogueText, initialBackgroundColor, initialTextColor, skipInitialBackground = false, getAllChips, getAllBounds = () => [], availableStates = [], username, userUid, membershipLevel, updateSettings, settings, getEffectiveCharDims, zoomLevel, clipboardItems = [], toggleRecording, isReadOnly = false, getNormalizedSelection, setWorldData, worldData, setSelectionStart, setSelectionEnd, uploadImageToStorage, triggerUpgradeFlow, triggerTutorialFlow, onCommandExecuted, cancelComposition, selectedNoteKey, selectedPatternKey, selectedAgentIds, currentScale, setCurrentScale, monogramSystem, recorder, setBounds, canvasState, setCanvasState, setBoundedWorldData, boundedSource, setBoundedSource, boundedWorldData, setZoomLevel, setViewOffset, selectionStart, selectionEnd, setProcessingRegion }: UseCommandSystemProps) {
    const router = useRouter();
    const backgroundStreamRef = useRef<MediaStream | undefined>(undefined);
    const previousBackgroundStateRef = useRef<{
        mode: BackgroundMode;
        color?: string;
        image?: string;
        video?: string;
        textColor: string;
        textBackground?: string;
    } | null>(null);
    const previousCameraModeRef = useRef<CameraMode | null>(null); // Store camera mode before command mode
    const lastKnownOrientationRef = useRef<{
        rotX: number;
        rotY: number;
        rotZ: number;
        mouthOpen?: number;
        leftEyeBlink?: number;
        rightEyeBlink?: number;
    } | null>(null); // Store last known face orientation for smooth autonomous transitions
    const [commandState, setCommandState] = useState<CommandState>({
        isActive: false,
        input: '',
        matchedCommands: [],
        selectedIndex: 0,
        commandStartPos: { x: 0, y: 0 },
        originalCursorPos: { x: 0, y: 0 },
        hasNavigated: false
    });

    const [commandData, setCommandData] = useState<WorldData>({});
    const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(null);
    
    // Mode system state
    const [modeState, setModeState] = useState<ModeState>({
        currentMode: 'default',
        lightModeData: {},
        backgroundMode: 'color', // Default to color background
        backgroundColor: '#FFFFFF', // White background
        backgroundImage: undefined,
        backgroundVideo: undefined,
        backgroundStream: undefined,
        textColor: '#000000', // Black text on white background
        textBackground: undefined, // No text background by default
        fontFamily: 'IBM Plex Mono', // Default font
        currentTextStyle: {
            color: '#000000', // Default black text
            background: undefined
        },
        searchPattern: '', // No search pattern initially
        isSearchActive: false, // Search not active initially
        cameraMode: 'default', // Default camera mode for all devices
        isIndentEnabled: true, // Smart indentation enabled by default
        isMoveMode: false, // Move mode not active initially
        gridMode: 'dots', // Default grid mode
        artefactsEnabled: false, // Artifacts enabled by default in space mode
        artifactType: 'images', // Default to image artifacts
        isFullscreenMode: false, // Fullscreen mode not active initially
        fullscreenRegion: undefined, // No fullscreen region initially
        isFaceDetectionEnabled: false, // Face detection not active initially
        isCharacterEnabled: false, // Character sprite cursor not active initially
        faceOrientation: undefined, // No face orientation initially
        isPaintMode: false, // Paint mode not active initially
        paintTool: 'brush', // Default to brush tool
        paintColor: '#000000', // Default black paint
        paintBrushSize: 1, // Default brush size (1 cell radius)
        isAgentMode: false, // Agent spawning mode not active initially
        isAgentAttached: false, // Agents not attached to cursor initially
        isVoiceMode: false, // Voice input mode not active initially
    });

    // User's saved sprites
    const [userSprites, setUserSprites] = useState<SavedSprite[]>([]);

    // User's saved tilesets
    const [userTilesets, setUserTilesets] = useState<SavedTileset[]>([]);

    // Fetch user sprites and tilesets when userUid changes
    useEffect(() => {
        if (userUid) {
            getUserSprites(userUid).then(sprites => {
                setUserSprites(sprites);
            });
            getUserTilesets(userUid).then(tilesets => {
                setUserTilesets(tilesets);
            });
        } else {
            setUserSprites([]);
            setUserTilesets([]);
        }
    }, [userUid]);

    // Face detection system
    const { faceData, isReady: faceReady, hasDetection } = useFaceDetection({
        enabled: modeState.isFaceDetectionEnabled,
        videoStream: backgroundStreamRef.current,
    });

    const smoothOrientation = useSmoothFaceOrientation(faceData, 0.3);

    // Update face orientation in state when detected
    useEffect(() => {
        if (modeState.isFaceDetectionEnabled && hasDetection && faceData) {
            // Face is actively tracked - use MediaPipe data
            const rotation = faceOrientationToRotation(smoothOrientation, true, false, false);

            // Extract expressions from blendshapes
            let mouthOpen = 0;
            let leftEyeBlink = 0;
            let rightEyeBlink = 0;

            if (faceData.blendshapes) {
                // Mouth openness
                const jawOpen = faceData.blendshapes.get('jawOpen') ?? 0;
                const mouthOpen1 = faceData.blendshapes.get('mouthOpen') ?? 0;
                mouthOpen = Math.max(jawOpen, mouthOpen1);

                // Eye blinks (MediaPipe provides separate left/right eye blinks)
                leftEyeBlink = faceData.blendshapes.get('eyeBlinkLeft') ?? 0;
                rightEyeBlink = faceData.blendshapes.get('eyeBlinkRight') ?? 0;
            }

            const trackedOrientation = {
                ...rotation,
                mouthOpen,
                leftEyeBlink,
                rightEyeBlink,
                isTracked: true // Mark as tracked by MediaPipe
            };

            // Store this as last known orientation
            lastKnownOrientationRef.current = {
                rotX: rotation.rotX,
                rotY: rotation.rotY,
                rotZ: rotation.rotZ,
                mouthOpen,
                leftEyeBlink,
                rightEyeBlink
            };

            setModeState(prev => ({
                ...prev,
                faceOrientation: trackedOrientation
            }));
        } else if (modeState.isFaceDetectionEnabled && !hasDetection) {
            // Face lost - transition to autonomous mode using last known position
            if (lastKnownOrientationRef.current) {
                // Keep the last orientation but mark as autonomous
                setModeState(prev => ({
                    ...prev,
                    faceOrientation: {
                        ...lastKnownOrientationRef.current!,
                        isTracked: false // Mark as autonomous
                    }
                }));
            } else {
                // No previous orientation - use neutral pose
                setModeState(prev => ({
                    ...prev,
                    faceOrientation: {
                        rotX: 0,
                        rotY: 0,
                        rotZ: 0,
                        mouthOpen: 0,
                        leftEyeBlink: 0,
                        rightEyeBlink: 0,
                        isTracked: false
                    }
                }));
            }
        }
    }, [modeState.isFaceDetectionEnabled, hasDetection, faceData, smoothOrientation]);

    // Function to load saved color preferences
    const loadColorPreferences = useCallback((settings: WorldSettings) => {
        if (settings.backgroundColor || settings.textColor || settings.customBackground) {
            setModeState(prev => {
                const updates: Partial<ModeState> = {};
                
                if (settings.customBackground) {
                    // Load AI-generated background
                    if (settings.customBackground.type === 'ai-generated') {
                        if (settings.customBackground.content.includes('video') || settings.customBackground.content.includes('.mp4')) {
                            updates.backgroundMode = 'video';
                            updates.backgroundVideo = settings.customBackground.content;
                        } else {
                            updates.backgroundMode = 'image';
                            updates.backgroundImage = settings.customBackground.content;
                        }
                        updates.backgroundColor = undefined;
                    }
                } else if (settings.backgroundColor) {
                    // Load solid color background
                    updates.backgroundMode = 'color';
                    updates.backgroundColor = settings.backgroundColor;
                    updates.backgroundImage = undefined;
                    updates.backgroundVideo = undefined;
                }
                
                if (settings.textColor) {
                    updates.textColor = settings.textColor;
                    updates.currentTextStyle = {
                        color: settings.textColor,
                        background: prev.currentTextStyle.background
                    };
                }
                
                return { ...prev, ...updates };
            });
        }
    }, []);

    // Utility function to clear command state (used after command execution)
    const clearCommandState = useCallback(() => {
        setCommandState({
            isActive: false,
            input: '',
            matchedCommands: [],
            selectedIndex: 0,
            commandStartPos: { x: 0, y: 0 },
            originalCursorPos: { x: 0, y: 0 },
            hasNavigated: false
        });
        setCommandData({});
    }, [setCommandState, setCommandData]);

    // Utility function to validate and normalize color (supports color names and hex codes)
    const validateColor = useCallback((color: string): { valid: boolean; hexColor?: string; error?: string } => {
        const hexColor = (COLOR_MAP[color.toLowerCase()] || color).toUpperCase();
        if (!/^#[0-9A-F]{6}$/i.test(hexColor)) {
            return { valid: false, error: `Invalid color: ${color}. Use hex code (e.g., #FF0000) or name (e.g., red, blue).` };
        }
        return { valid: true, hexColor };
    }, []);

    // Utility function to wrap text to fit within a maximum width
    const wrapText = useCallback((text: string, maxWidth: number): string[] => {
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
                    if (currentLine) {
                        lines.push(currentLine);
                        currentLine = word;
                    } else {
                        lines.push(word.substring(0, maxWidth));
                        currentLine = word.substring(maxWidth);
                    }
                }
            }
            if (currentLine) lines.push(currentLine);
        }
        return lines;
    }, []);

    /**
     * Draw text string to WorldData grid at specified position
     * Core rendering primitive for character-by-character grid text
     */
    const drawTextToGrid = useCallback((
        text: string,
        startX: number,
        startY: number,
        existingData: WorldData = {}
    ): WorldData => {
        const result = { ...existingData };
        for (let i = 0; i < text.length; i++) {
            result[`${startX + i},${startY}`] = text[i];
        }
        return result;
    }, []);

    /**
     * Draw command text with vertical suggestion list below
     * Used for command autocomplete display
     */
    const drawCommandWithSuggestions = useCallback((
        commandText: string,
        suggestions: string[],
        startPos: Point
    ): WorldData => {
        let data: WorldData = {};

        // Draw main command text
        data = drawTextToGrid(commandText, startPos.x, startPos.y, data);

        // Draw suggestions vertically below
        suggestions.forEach((suggestion, index) => {
            const spacing = currentScale ? currentScale.h : GRID_CELL_SPAN;
            const suggestionY = startPos.y + spacing + (index * spacing);
            data = drawTextToGrid(suggestion, startPos.x, suggestionY, data);
        });

        return data;
    }, [drawTextToGrid]);

    // Utility function to render command display (command text + autocomplete suggestions)
    const renderCommandDisplay = useCallback((input: string, matchedCommands: string[], commandStartPos: Point): WorldData => {
        const commandText = `/${input}`;
        return drawCommandWithSuggestions(commandText, matchedCommands, commandStartPos);
    }, [drawCommandWithSuggestions]);

    // Utility function to parse command arguments from command string
    const parseCommandArgs = useCallback((commandString: string): { command: string; args: string[]; firstArg?: string } => {
        const parts = commandString.split(/\s+/);
        return {
            command: parts[0],
            args: parts.slice(1),
            firstArg: parts[1]
        };
    }, []);

    /**
     * Parse current command input into convenient parts
     * Provides multiple formats for accessing arguments
     */
    const parseCurrentInput = useCallback(() => {
        const parts = commandState.input.trim().split(/\s+/);
        return {
            parts,
            arg1: parts[1],
            arg2: parts[2],
            arg3: parts[3],
            restAsString: parts.slice(1).join(' '),
            argsArray: parts.slice(1)
        };
    }, [commandState.input]);

    // Utility function to calculate selection dimensions
    const calculateSelectionDimensions = useCallback((selection: { startX: number; endX: number; startY: number; endY: number }): { width: number; height: number } => {
        return {
            width: selection.endX - selection.startX + 1,
            height: selection.endY - selection.startY + 1
        };
    }, []);

    // Utility function to create a pending command (waiting for selection)
    const createPendingCommand = useCallback((command: string, message: string, args: string[] = []) => {
        setPendingCommand({
            command,
            args,
            isWaitingForSelection: true
        });
        setDialogueWithRevert(message, setDialogueText);
    }, [setPendingCommand, setDialogueText]);

    // Utility function to execute simple passthrough commands (clear state + return to world engine)
    const executeSimpleCommand = useCallback((command: string, args: string[] = []): CommandExecution => {
        clearCommandState();
        return {
            command,
            args,
            commandStartPos: commandState.commandStartPos
        };
    }, [commandState.commandStartPos, clearCommandState]);

    /**
     * Execute command that triggers optional callback
     * Handles callback invocation, cleanup, and optional fallback message
     */
    const executeCallbackCommand = useCallback((
        callback: (() => void) | undefined,
        fallbackMessage?: string
    ): null => {
        if (callback) {
            callback();
        } else if (fallbackMessage) {
            setDialogueWithRevert(fallbackMessage, setDialogueText);
        }

        clearCommandState();
        return null;
    }, [setDialogueText, clearCommandState]);

    /**
     * Toggle a boolean mode state and show feedback
     * Handles state update, feedback message, and cleanup
     */
    const executeToggleModeCommand = useCallback(<K extends keyof ModeState>(
        modeKey: K,
        enabledMessage: string,
        disabledMessage: string
    ): null => {
        setModeState(prev => ({
            ...prev,
            [modeKey]: !(prev[modeKey] as boolean)
        }));

        const newState = !(modeState[modeKey] as boolean);
        setDialogueWithRevert(
            newState ? enabledMessage : disabledMessage,
            setDialogueText
        );

        clearCommandState();
        return null;
    }, [modeState, setModeState, setDialogueText, clearCommandState]);

    /**
     * Create a region entity from current selection
     * Handles validation, creation, and feedback
     */
    const createRegionFromSelection = useCallback((
        regionType: 'mail' | 'note' | 'list',
        options: {
            successMessage?: (dims: { width: number; height: number }) => string;
            additionalData?: Record<string, any>;
            pendingMessage?: string;
            contentType?: 'text' | 'mail' | 'list' | 'image';
            additionalWorldDataCallback?: (key: string, selection: any, worldData: WorldData) => WorldData;
        } = {}
    ): boolean => {
        const existingSelection = getNormalizedSelection?.();

        if (!existingSelection) {
            const defaultPendingMsg = `Make a selection, then press Enter to create ${regionType} region`;
            createPendingCommand(regionType, options.pendingMessage || defaultPendingMsg);
            return false;
        }

        const hasMeaningfulSelection =
            existingSelection.startX !== existingSelection.endX ||
            existingSelection.startY !== existingSelection.endY;

        if (!hasMeaningfulSelection) {
            setDialogueWithRevert("Selection must span more than one cell", setDialogueText);
            return false;
        }

        if (!setWorldData || !worldData || !setSelectionStart || !setSelectionEnd) {
            return false;
        }

        const timestamp = Date.now();

        // Capture and internalize data for all note types
        let capturedData: Record<string, string> = {};
        const cellsToRemove: string[] = [];

        // Always capture data for notes (including mail and list types)
        for (let y = existingSelection.startY; y <= existingSelection.endY; y++) {
            for (let x = existingSelection.startX; x <= existingSelection.endX; x++) {
                const cellKey = `${x},${y}`;
                const cellData = worldData[cellKey];
                if (cellData !== undefined) {
                    // Convert to relative coordinates (note origin is 0,0)
                    const relativeX = x - existingSelection.startX;
                    const relativeY = y - existingSelection.startY;
                    const relativeKey = `${relativeX},${relativeY}`;
                    capturedData[relativeKey] = typeof cellData === 'string' ? cellData : JSON.stringify(cellData);
                    cellsToRemove.push(cellKey);
                }
            }
        }

        // All regions are now notes with contentType
        // Viewport size is derived from bounds (startX→endX, startY→endY)
        // Content can extend beyond viewport and is scrolled via scrollOffsetX/Y

        // GRID_CELL_SPAN constant (from world.engine.ts)
        const GRID_CELL_SPAN = 2;

        // Align coordinates to GRID_CELL_SPAN boundaries for proper grid alignment
        // Characters are at Y=0,2,4,6... and each occupies GRID_CELL_SPAN cells
        // For a character at Y=6, it occupies cells [6,7], so endY should include cell 7
        const alignedStartY = Math.floor(existingSelection.startY / GRID_CELL_SPAN) * GRID_CELL_SPAN;
        // endY should extend to the end of the last character span
        const alignedEndY = Math.floor(existingSelection.endY / GRID_CELL_SPAN) * GRID_CELL_SPAN + (GRID_CELL_SPAN - 1);

        const regionData = {
            startX: existingSelection.startX,
            endX: existingSelection.endX,
            startY: alignedStartY,
            endY: alignedEndY,
            timestamp,
            contentType: options.contentType || (regionType === 'mail' ? 'mail' : regionType === 'list' ? 'list' : 'text'),
            data: capturedData,
            scrollOffset: 0,      // Vertical scroll (Y axis)
            scrollOffsetX: 0,     // Horizontal scroll (X axis)
            ...options.additionalData
        };

        // Always create as note_ prefix (unified namespace)
        const key = `note_${existingSelection.startX},${existingSelection.startY}_${timestamp}`;
        let newWorldData = { ...worldData };

        // Remove captured data from global worldData (internalize it)
        cellsToRemove.forEach(cellKey => delete newWorldData[cellKey]);

        newWorldData[key] = JSON.stringify(regionData);

        // Allow caller to add additional world data (e.g., mail button)
        if (options.additionalWorldDataCallback) {
            newWorldData = options.additionalWorldDataCallback(key, existingSelection, newWorldData);
        }

        setWorldData(newWorldData);

        const { width, height } = calculateSelectionDimensions(existingSelection);
        const defaultSuccessMsg = (dims: { width: number; height: number }) =>
            `${regionType.charAt(0).toUpperCase() + regionType.slice(1)} region created (${dims.width}×${dims.height})`;
        const successMsg = options.successMessage || defaultSuccessMsg;
        setDialogueWithRevert(successMsg({ width, height }), setDialogueText);

        setSelectionStart(null);
        setSelectionEnd(null);

        return true;
    }, [
        getNormalizedSelection,
        setWorldData,
        worldData,
        setSelectionStart,
        setSelectionEnd,
        setDialogueText,
        calculateSelectionDimensions,
        createPendingCommand
    ]);

    // Utility function to match commands based on input
    const matchCommands = useCallback((input: string): string[] => {
        // Filter signin/signout based on authentication state
        const isAuthenticated = !!userUid;

        // When no input, return commands in category display order
        if (!input) {
            const commandsInOrder: string[] = [];
            Object.values(COMMAND_CATEGORIES).forEach(categoryCommands => {
                categoryCommands.forEach(cmd => {
                    if (isAuthenticated && cmd === 'signin') return;
                    if (!isAuthenticated && cmd === 'signout') return;
                    if (cmd === 'mail' && membershipLevel !== 'super') return;
                    commandsInOrder.push(cmd);
                });
            });
            return commandsInOrder;
        }

        let commandList = isReadOnly ? READ_ONLY_COMMANDS : AVAILABLE_COMMANDS;
        commandList = commandList.filter(cmd => {
            if (isAuthenticated && cmd === 'signin') return false; // Hide signin when authenticated
            if (!isAuthenticated && cmd === 'signout') return false; // Hide signout when not authenticated
            if (cmd === 'mail' && membershipLevel !== 'super') return false; // Hide mail unless super member
            return true;
        });
        const lowerInput = input.toLowerCase().split(' ')[0];
        
        // Special handling for mode command with subcommands
        if (lowerInput === 'mode') {
            const parts = input.toLowerCase().split(' ');
            if (parts.length > 1) {
                // Show mode subcommands that match the second part
                const modeInput = parts[1];
                return MODE_COMMANDS
                    .filter(mode => mode.startsWith(modeInput))
                    .map(mode => `mode ${mode}`);
            }
            return MODE_COMMANDS.map(mode => `mode ${mode}`);
        }

        if (lowerInput === 'bg') {
            const parts = input.toLowerCase().split(' ');
            if (parts.length > 1) {
                const bgInput = parts[1];
                // Combine BG_COMMANDS with color names from COLOR_MAP
                const colorNames = Object.keys(COLOR_MAP);
                const allOptions = [...BG_COMMANDS, ...colorNames];
                const suggestions = allOptions
                    .filter(bg => bg.startsWith(bgInput))
                    .map(bg => `bg ${bg}`);

                const currentCommand = `bg ${bgInput}`;
                if (bgInput.length > 0 && !suggestions.some(s => s === currentCommand)) {
                     return [currentCommand, ...suggestions];
                }
                return suggestions;
            }
            // Show all BG_COMMANDS plus all color names
            const colorNames = Object.keys(COLOR_MAP);
            const allOptions = [...BG_COMMANDS, ...colorNames];
            return allOptions.map(bg => `bg ${bg}`);
        }

        if (lowerInput === 'font') {
            const parts = input.toLowerCase().split(' ');
            if (parts.length > 1) {
                const fontInput = parts[1];
                const suggestions = FONT_COMMANDS
                    .filter(font => font.toLowerCase().startsWith(fontInput))
                    .map(font => `font ${font}`);
                
                const currentCommand = `font ${fontInput}`;
                if (fontInput.length > 0 && !suggestions.some(s => s === currentCommand)) {
                     return [currentCommand, ...suggestions];
                }
                return suggestions;
            }
            return FONT_COMMANDS.map(font => `font ${font}`);
        }

        if (lowerInput === 'nav') {
            const parts = input.toLowerCase().split(' ');
            const chips = getAllChips ? getAllChips() : [];
            const bounds = getAllBounds ? getAllBounds() : [];

            // Get chip names
            const chipNames = chips.map(chip => chip.text.toLowerCase());

            // Get bound titles (fallback to bound[width] if no title)
            const boundNames = bounds.map(bound => {
                if (bound.title) {
                    return bound.title.toLowerCase();
                } else {
                    const width = bound.endX - bound.startX + 1;
                    return `bound[${width}]`;
                }
            });

            // Combine both chips and bounds
            const allTargets = [...chipNames, ...boundNames];

            if (parts.length > 1) {
                const navInput = parts[1];
                const suggestions = allTargets
                    .filter(target => target.startsWith(navInput))
                    .map(target => `nav ${target}`);

                const currentCommand = `nav ${navInput}`;
                if (navInput.length > 0 && !suggestions.some(s => s === currentCommand)) {
                     return [currentCommand, ...suggestions];
                }
                return suggestions;
            }
            return allTargets.length > 0 ? allTargets.map(target => `nav ${target}`) : ['nav'];
        }

        if (lowerInput === 'search') {
            const parts = input.split(' ');
            if (parts.length > 1) {
                // Return the full search command with its arguments
                return [input];
            }
            return ['search'];
        }

        if (lowerInput === 'paint' || lowerInput.startsWith('paint ')) {
            const parts = input.toLowerCase().split(' ');
            const paintTools = ['brush', 'fill', 'lasso', 'eraser'];
            const colorNames = Object.keys(COLOR_MAP);

            if (parts.length > 1) {
                const firstArg = parts[1];

                // Check if first arg is a tool
                if (paintTools.includes(firstArg)) {
                    // After tool, suggest colors
                    if (parts.length > 2) {
                        const secondArg = parts[2];
                        const suggestions = colorNames
                            .filter(opt => opt.startsWith(secondArg))
                            .map(opt => `paint ${firstArg} ${opt}`);

                        const currentCommand = `paint ${firstArg} ${secondArg}`;
                        if (secondArg.length > 0 && !suggestions.some(s => s === currentCommand)) {
                            return [currentCommand, ...suggestions];
                        }
                        return suggestions.length > 0 ? suggestions : [currentCommand];
                    }
                    // Just typed tool, show colors
                    return colorNames.map(opt => `paint ${firstArg} ${opt}`);
                }

                // First arg is not a complete tool - suggest tools and colors
                const allOptions = [...paintTools, ...colorNames];
                const suggestions = allOptions
                    .filter(opt => opt.startsWith(firstArg))
                    .map(opt => `paint ${opt}`);

                const currentCommand = `paint ${firstArg}`;
                if (firstArg.length > 0 && !suggestions.some(s => s === currentCommand)) {
                    return [currentCommand, ...suggestions];
                }
                return suggestions.length > 0 ? suggestions : [currentCommand];
            }

            // Just typed 'paint', show tools first, then colors
            const allOptions = [...paintTools, ...colorNames];
            return allOptions.map(opt => `paint ${opt}`);
        }

        if (lowerInput === 'state') {
            const parts = input.toLowerCase().split(' ');
            
            if (parts.length > 1) {
                const secondArg = parts[1];
                
                // Handle --rm flag
                if (secondArg === '--rm') {
                    if (parts.length > 2) {
                        // After --rm, show state suggestions that match the input
                        const stateInput = parts[2];
                        const suggestions = availableStates
                            .filter(state => state.toLowerCase().startsWith(stateInput))
                            .map(state => `state --rm ${state}`);
                        
                        const currentCommand = `state --rm ${stateInput}`;
                        if (stateInput.length > 0 && !suggestions.some(s => s === currentCommand)) {
                             return [currentCommand, ...suggestions];
                        }
                        return suggestions.length > 0 ? suggestions : [`state --rm ${stateInput}`];
                    }
                    // Just typed --rm, show all states for deletion
                    return availableStates.length > 0 ? availableStates.map(state => `state --rm ${state}`) : ['state --rm'];
                } else {
                    // Regular state command suggestions
                    const stateInput = secondArg;
                    const suggestions = availableStates
                        .filter(state => state.toLowerCase().startsWith(stateInput))
                        .map(state => `state ${state}`);
                    
                    const currentCommand = `state ${stateInput}`;
                    if (stateInput.length > 0 && !suggestions.some(s => s === currentCommand)) {
                         return [currentCommand, ...suggestions];
                    }
                    return suggestions.length > 0 ? suggestions : [`state ${stateInput}`];
                }
            }
            // Always show available states, or allow new state creation
            if (availableStates.length > 0) {
                return availableStates.map(state => `state ${state}`);
            } else {
                return ['state']; // Just show the command itself if no states exist
            }
        }

        if (lowerInput === 'chip') {
            const parts = input.split(' ');

            if (parts.length > 1) {
                const secondArg = parts[1];

                // Handle --distance flag
                if (secondArg === '--distance') {
                    if (parts.length > 2) {
                        // User is typing the distance number
                        return [input];
                    }
                    // Just typed --distance, show example
                    return ['chip --distance <number>'];
                } else if (parts.length === 2 && secondArg.startsWith("'")) {
                    // Typing quoted text - show as is
                    return [input];
                } else if (parts.length >= 2 && input.includes("'")) {
                    // Check if user is typing color after quoted text
                    const quoteMatch = input.match(/'([^']+)'\s*(\S*)$/);
                    if (quoteMatch && quoteMatch[2]) {
                        // User is typing color - show color suggestions
                        const colorInput = quoteMatch[2].toLowerCase();
                        const colorNames = Object.keys(COLOR_MAP);
                        const suggestions = colorNames
                            .filter(color => color.startsWith(colorInput))
                            .map(color => `chip '${quoteMatch[1]}' ${color}`);
                        return suggestions.length > 0 ? suggestions : [input];
                    } else if (quoteMatch && quoteMatch[1] && input.endsWith("' ")) {
                        // Completed quoted text, show color options
                        const colorNames = Object.keys(COLOR_MAP);
                        return colorNames.map(color => `chip '${quoteMatch[1]}' ${color}`);
                    }
                    return [input];
                } else {
                    // Regular chip command - show as typed
                    return [input];
                }
            }
            return ['chip', 'chip --distance', "chip 'text'", ...Object.keys(COLOR_MAP).map(color => `chip 'text' ${color}`)];
        }

        if (lowerInput === 'task') {
            const parts = input.split(' ');

            if (parts.length > 1) {
                // User is typing color argument - show color suggestions
                const colorInput = parts[1].toLowerCase();
                const colorNames = Object.keys(COLOR_MAP);
                const suggestions = colorNames
                    .filter(color => color.startsWith(colorInput))
                    .map(color => `task ${color}`);
                return suggestions.length > 0 ? suggestions : [input];
            }
            // Show color examples
            return ['task', ...Object.keys(COLOR_MAP).map(color => `task ${color}`)];
        }

        if (lowerInput === 'text') {
            const parts = input.split(' ');

            if (parts.length > 1) {
                const secondArg = parts[1].toLowerCase();

                // Handle --g flag for global color update
                if (secondArg === '--g') {
                    if (parts.length > 2) {
                        // User is typing the color after --g
                        const colorInput = parts[2].toLowerCase();
                        const colorNames = Object.keys(COLOR_MAP);
                        const suggestions = colorNames
                            .filter(color => color.startsWith(colorInput))
                            .map(color => `text --g ${color}`);
                        return suggestions.length > 0 ? suggestions : [input];
                    }
                    // Just typed --g, show all color options
                    const colorNames = Object.keys(COLOR_MAP);
                    return colorNames.map(color => `text --g ${color}`);
                } else {
                    // Regular text command - show color suggestions
                    const colorNames = Object.keys(COLOR_MAP);
                    const suggestions = colorNames
                        .filter(color => color.startsWith(secondArg))
                        .map(color => `text ${color}`);
                    return suggestions.length > 0 ? suggestions : [input];
                }
            }
            // Show --g option and color examples
            return ['text --g', ...Object.keys(COLOR_MAP).map(color => `text ${color}`)];
        }

        if (lowerInput === 'data') {
            // No arguments for data command
            return ['data'];
        }

        if (lowerInput === 'list') {
            const parts = input.split(' ');

            if (parts.length > 1) {
                // User is typing color argument - show what they've typed
                return [input];
            }
            return ['list', 'list #FF8800', 'list #00FF00', 'list #0088FF'];
        }

        if (lowerInput === 'cam') {
            const parts = input.toLowerCase().split(' ');
            if (parts.length > 1) {
                // Show camera subcommands that match the second part
                const cameraInput = parts[1];
                return CAMERA_COMMANDS
                    .filter(camera => camera.startsWith(cameraInput))
                    .map(camera => `cam ${camera}`);
            }
            return CAMERA_COMMANDS.map(camera => `cam ${camera}`);
        }

        if (lowerInput === 'display') {
            const parts = input.toLowerCase().split(' ');
            if (parts.length > 1) {
                // Show display subcommands that match the second part
                const displayInput = parts[1];
                return DISPLAY_COMMANDS
                    .filter(mode => mode.startsWith(displayInput))
                    .map(mode => `display ${mode}`);
            }
            return DISPLAY_COMMANDS.map(mode => `display ${mode}`);
        }

        if (lowerInput === 'upload') {
            const parts = input.split(' ');

            if (parts.length > 1) {
                const secondArg = parts[1];

                // Handle --bitmap flag
                if (secondArg === '--bitmap') {
                    return ['upload --bitmap'];
                } else if ('--bitmap'.startsWith(secondArg)) {
                    return ['upload --bitmap'];
                }
            }
            return ['upload', 'upload --bitmap'];
        }

        if (lowerInput === 'clip') {
            // Show clipboard entries
            if (clipboardItems.length === 0) {
                return ['clip'];
            }
            return clipboardItems.map((item, idx) => {
                // Get first line of content, trimmed to max 50 chars
                const firstLine = item.content.split('\n')[0].trim();
                const preview = firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;
                return `clip ${idx} ${preview}`;
            });
        }

        if (lowerInput === 'monogram') {
            const parts = input.toLowerCase().split(' ');
            const MONOGRAM_OPTIONS = ['clear', 'perlin', 'nara', 'face', 'on', 'off'];
            if (parts.length > 1) {
                // Show monogram options that match the input
                const monogramInput = parts[1];
                return MONOGRAM_OPTIONS
                    .filter(option => option.startsWith(monogramInput))
                    .map(option => `monogram ${option}`);
            }
            return MONOGRAM_OPTIONS.map(option => `monogram ${option}`);
        }

        if (lowerInput === 'be' || lowerInput.startsWith('be ')) {
            const parts = input.split(' ');
            const BE_FLAGS = ['--rm', '--re', '--rename', '--sheet', '--animate', '--animate-continue', '--re-animate'];

            // Public sprites available in /public folder
            const PUBLIC_SPRITES = [
                { name: 'default', walkPath: '/sprites/default_walk.png', idlePath: '/sprites/default_idle.png' },
            ];

            if (parts.length > 1) {
                const secondArg = parts[1].toLowerCase();

                // Handle --sheet flag (create sheet from existing rotations)
                if (secondArg === '--sheet' || '--sheet'.startsWith(secondArg)) {
                    if (parts.length > 2) {
                        const spriteInput = parts[2].toLowerCase();
                        const matchingSprites = userSprites
                            .filter(sprite => sprite.name.toLowerCase().includes(spriteInput))
                            .map(sprite => `be --sheet ${sprite.name}`);
                        return matchingSprites.length > 0 ? matchingSprites : [`be --sheet ${spriteInput}`];
                    }
                    // Show all sprite names
                    return userSprites.length > 0
                        ? userSprites.map(sprite => `be --sheet ${sprite.name}`)
                        : ['be --sheet'];
                }

                // Handle --rm flag
                if (secondArg === '--rm' || '--rm'.startsWith(secondArg)) {
                    if (parts.length > 2) {
                        const spriteInput = parts[2].toLowerCase();
                        const matchingSprites = userSprites
                            .filter(sprite => sprite.name.toLowerCase().includes(spriteInput))
                            .map(sprite => `be --rm ${sprite.name}`);
                        return matchingSprites.length > 0 ? matchingSprites : [`be --rm ${spriteInput}`];
                    }
                    return userSprites.map(sprite => `be --rm ${sprite.name}`);
                }

                // Handle --re flag (regenerate)
                if (secondArg === '--re' || '--re'.startsWith(secondArg)) {
                    if (parts.length > 2) {
                        const spriteInput = parts[2].toLowerCase();
                        const matchingSprites = userSprites
                            .filter(sprite => sprite.name.toLowerCase().includes(spriteInput))
                            .map(sprite => `be --re ${sprite.name}`);
                        return matchingSprites.length > 0 ? matchingSprites : [`be --re ${spriteInput}`];
                    }
                    return userSprites.map(sprite => `be --re ${sprite.name}`);
                }

                // Handle --rename flag (rename sprite)
                if (secondArg === '--rename' || '--rename'.startsWith(secondArg)) {
                    if (parts.length > 2) {
                        const spriteInput = parts[2].toLowerCase();
                        const matchingSprites = userSprites
                            .filter(sprite => sprite.name.toLowerCase().includes(spriteInput))
                            .map(sprite => `be --rename ${sprite.name}`);
                        if (parts.length > 3) {
                            // Already have sprite name, show input for new name
                            return [input];
                        }
                        return matchingSprites.length > 0 ? matchingSprites : [`be --rename ${spriteInput}`];
                    }
                    return userSprites.length > 0
                        ? userSprites.map(sprite => `be --rename ${sprite.name}`)
                        : ['be --rename'];
                }

                // Handle --animate flag (generate walk animation)
                if (secondArg === '--animate' || '--animate'.startsWith(secondArg)) {
                    if (parts.length > 2) {
                        const spriteInput = parts[2].toLowerCase();
                        const matchingSprites = userSprites
                            .filter(sprite => sprite.name.toLowerCase().includes(spriteInput))
                            .map(sprite => `be --animate ${sprite.name}`);
                        return matchingSprites.length > 0 ? matchingSprites : [`be --animate ${spriteInput}`];
                    }
                    // Show all sprite names
                    return userSprites.length > 0
                        ? userSprites.map(sprite => `be --animate ${sprite.name}`)
                        : ['be --animate'];
                }

                // Handle --animate-continue flag (continue failed animation)
                if (secondArg === '--animate-continue' || '--animate-continue'.startsWith(secondArg)) {
                    if (parts.length > 2) {
                        const spriteInput = parts[2].toLowerCase();
                        const matchingSprites = userSprites
                            .filter(sprite => sprite.name.toLowerCase().includes(spriteInput))
                            .map(sprite => `be --animate-continue ${sprite.name}`);
                        return matchingSprites.length > 0 ? matchingSprites : [`be --animate-continue ${spriteInput}`];
                    }
                    return userSprites.length > 0
                        ? userSprites.map(sprite => `be --animate-continue ${sprite.name}`)
                        : ['be --animate-continue'];
                }

                // Handle --re-animate flag (alias for --animate-continue)
                if (secondArg === '--re-animate' || '--re-animate'.startsWith(secondArg)) {
                    if (parts.length > 2) {
                        const spriteInput = parts[2].toLowerCase();
                        const matchingSprites = userSprites
                            .filter(sprite => sprite.name.toLowerCase().includes(spriteInput))
                            .map(sprite => `be --re-animate ${sprite.name}`);
                        return matchingSprites.length > 0 ? matchingSprites : [`be --re-animate ${spriteInput}`];
                    }
                    return userSprites.length > 0
                        ? userSprites.map(sprite => `be --re-animate ${sprite.name}`)
                        : ['be --re-animate'];
                }

                // Check if typing a flag
                const flagMatch = BE_FLAGS.filter(f => f.startsWith(secondArg));
                if (flagMatch.length > 0 && secondArg.startsWith('-')) {
                    const suggestions = flagMatch.map(f => `be ${f}`);
                    // If the user typed something like 'be --a', ensure animate options are there
                    if (secondArg.startsWith('--ani')) {
                        if (!suggestions.includes('be --animate')) suggestions.push('be --animate');
                        if (!suggestions.includes('be --animate-continue')) suggestions.push('be --animate-continue');
                        if (!suggestions.includes('be --re-animate')) suggestions.push('be --re-animate');
                    }
                    return suggestions;
                }

                // Regular sprite selection or prompt (includes public sprites)
                const spriteInput = parts.slice(1).join(' ').toLowerCase();
                // Match user sprites by name OR id
                const matchingUserSpritesByName = userSprites
                    .filter(sprite => sprite.name.toLowerCase().includes(spriteInput))
                    .map(sprite => `be ${sprite.name}`);
                const matchingUserSpritesById = userSprites
                    .filter(sprite => sprite.id.toLowerCase().includes(spriteInput))
                    .map(sprite => `be ${sprite.id}`);
                const matchingPublicSprites = PUBLIC_SPRITES
                    .filter(sprite => sprite.name.toLowerCase().includes(spriteInput))
                    .map(sprite => `be ${sprite.name}`);
                // Combine and dedupe
                const allMatches = [...new Set([...matchingUserSpritesByName, ...matchingUserSpritesById, ...matchingPublicSprites])];
                if (allMatches.length > 0) {
                    return [...allMatches, `be ${spriteInput}`];
                }
                return [`be ${spriteInput}`];
            }
            // Show flags + saved sprites (by name and id) + public sprites
            const baseOptions = ['be --rm', 'be --re', 'be --rename', 'be --sheet', 'be --animate', 'be --animate-continue', 'be --re-animate'];
            const userSpriteByName = userSprites.map(sprite => `be ${sprite.name}`);
            const userSpriteById = userSprites.map(sprite => `be ${sprite.id}`);
            const publicSpriteOptions = PUBLIC_SPRITES.map(sprite => `be ${sprite.name}`);
            if (userSprites.length > 0) {
                return [...baseOptions, ...userSpriteByName, ...userSpriteById, ...publicSpriteOptions];
            }
            return [...baseOptions, ...publicSpriteOptions];
        }

        // Handle make command suggestions (similar to be command)
        if (lowerInput === 'make' || lowerInput.startsWith('make ')) {
            const parts = input.split(' ');

            if (parts.length > 1) {
                // User is typing a tileset name or description
                const tilesetInput = parts.slice(1).join(' ').toLowerCase();

                // Match user tilesets by name
                const matchingUserTilesets = userTilesets
                    .filter(tileset => tileset.name.toLowerCase().includes(tilesetInput))
                    .map(tileset => `make ${tileset.name}`);

                if (matchingUserTilesets.length > 0) {
                    // Show matching saved tilesets + allow new prompt
                    return [...matchingUserTilesets, `make ${tilesetInput}`];
                }
                // No matches - just show what they're typing
                return [`make ${tilesetInput}`];
            }

            // Show saved tilesets when just typing "make"
            if (userTilesets.length > 0) {
                return userTilesets.map(tileset => `make ${tileset.name}`);
            }
            return ['make'];
        }

        return commandList.filter(cmd => cmd.toLowerCase().startsWith(lowerInput));
    }, [getAllChips, getAllBounds, availableStates, clipboardItems, isReadOnly, userUid, membershipLevel, userSprites, userTilesets]);

    // Mode switching functionality
    const switchMode = useCallback((newMode: CanvasMode) => {
        setModeState(prev => {
            // Clear air mode data when switching away from air mode
            const lightModeData = newMode === 'air' ? prev.lightModeData : {};
            
            return {
                ...prev,
                currentMode: newMode,
                lightModeData
            };
        });
    }, []);

    const switchBackgroundMode = useCallback((newMode: BackgroundMode, bgColor?: string, textColor?: string, textBg?: string, aiPrompt?: string): boolean => {
        if (newMode === 'color' && bgColor) {
            const bgColorResult = validateColor(bgColor);
            if (!bgColorResult.valid) {
                setDialogueWithRevert(`Invalid background color: ${bgColor}. Please use a name (e.g., white) or hex code (e.g., #1a1a1a).`, setDialogueText);
                return false;
            }
            const hexBgColor = bgColorResult.hexColor!;
            
            let finalTextColor: string;
            let preserveCustomText = false;

            if (textColor) {
                // User specified text color - validate it
                const textColorResult = validateColor(textColor);
                if (!textColorResult.valid) {
                    setDialogueWithRevert(`Invalid text color: ${textColor}. Please use a name (e.g., white) or hex code (e.g., #1a1a1a).`, setDialogueText);
                    return false;
                }
                finalTextColor = textColorResult.hexColor!;
            } else if (settings?.hasCustomTextColor && settings?.textColor) {
                // User has previously set a custom text color via /text --g
                // Preserve it instead of auto-assigning
                finalTextColor = settings.textColor;
                preserveCustomText = true;
            } else {
                // Auto-assign text color based on background brightness for optimal contrast
                const rgb = parseInt(hexBgColor.substring(1), 16);
                const r = (rgb >> 16) & 0xff;
                const g = (rgb >>  8) & 0xff;
                const b = (rgb >>  0) & 0xff;
                const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                finalTextColor = luma < 128 ? '#FFFFFF' : '#000000';
            }

            let finalTextBg: string | undefined;
            if (textBg) {
                // User specified text background - validate it
                const textBgResult = validateColor(textBg);
                if (!textBgResult.valid) {
                    setDialogueWithRevert(`Invalid text background: ${textBg}. Please use a name (e.g., white) or hex code (e.g., #1a1a1a).`, setDialogueText);
                    return false;
                }
                finalTextBg = textBgResult.hexColor!;
            }

            setModeState(prev => ({
                ...prev,
                backgroundMode: 'color',
                backgroundColor: hexBgColor,
                textColor: finalTextColor,
                textBackground: finalTextBg,
                currentTextStyle: {
                    color: finalTextColor,
                    background: finalTextBg
                }
            }));

            // Save color preferences to settings
            if (updateSettings) {
                const newSettings = {
                    backgroundColor: hexBgColor,
                    textColor: finalTextColor,
                    customBackground: undefined // Clear any AI background when setting solid color
                };
                updateSettings(newSettings);
            }
        } else if (newMode === 'transparent') {
            const finalTextColor = textColor || '#FFFFFF'; // Default to white text for transparent background
            setModeState(prev => ({
                ...prev,
                backgroundMode: 'transparent',
                backgroundImage: undefined,
                textColor: finalTextColor,
                textBackground: textBg,
                currentTextStyle: {
                    color: finalTextColor,
                    background: textBg
                }
            }));

            // Save color preferences to settings
            if (updateSettings) {
                const newSettings = {
                    backgroundColor: undefined, // Transparent has no color
                    textColor: finalTextColor,
                    customBackground: undefined
                };
                updateSettings(newSettings);
            }
        } else if (newMode === 'space') {
            const finalTextColor = textColor || '#FFFFFF'; // Default to white text for space background
            setModeState(prev => ({
                ...prev,
                backgroundMode: 'space',
                backgroundImage: undefined,
                textColor: finalTextColor,
                textBackground: textBg,
                currentTextStyle: {
                    color: finalTextColor,
                    background: textBg
                }
            }));

            // Save color preferences to settings
            if (updateSettings) {
                const newSettings = {
                    backgroundColor: undefined, // Space mode has no solid color
                    textColor: finalTextColor,
                    customBackground: undefined
                };
                updateSettings(newSettings);
            }
        } else if (newMode === 'image' && bgColor) {
            // bgColor is actually the image URL/data for image mode
            const finalTextColor = textColor || '#FFFFFF'; // Default to white text on images
            setModeState(prev => ({
                ...prev,
                backgroundMode: 'image',
                backgroundImage: bgColor, // Using bgColor parameter as image URL
                backgroundVideo: undefined,
                textColor: finalTextColor,
                textBackground: textBg,
                currentTextStyle: {
                    color: finalTextColor,
                    background: textBg
                }
            }));

            // Save AI-generated background to settings if prompt is provided
            if (updateSettings && aiPrompt) {
                const newSettings = {
                    backgroundColor: undefined,
                    textColor: finalTextColor,
                    customBackground: {
                        type: 'ai-generated' as const,
                        content: bgColor,
                        prompt: aiPrompt
                    }
                };
                updateSettings(newSettings);
            }
        } else if (newMode === 'video' && bgColor) {
            // bgColor is actually the video URL/data for video mode
            const finalTextColor = textColor || '#FFFFFF'; // Default to white text on videos
            setModeState(prev => ({
                ...prev,
                backgroundMode: 'video',
                backgroundImage: undefined,
                backgroundVideo: bgColor, // Using bgColor parameter as video URL
                textColor: finalTextColor,
                textBackground: textBg,
                currentTextStyle: {
                    color: finalTextColor,
                    background: textBg
                }
            }));

            // Save AI-generated video background to settings if prompt is provided
            if (updateSettings && aiPrompt) {
                const newSettings = {
                    backgroundColor: undefined,
                    textColor: finalTextColor,
                    customBackground: {
                        type: 'ai-generated' as const,
                        content: bgColor,
                        prompt: aiPrompt
                    }
                };
                updateSettings(newSettings);
            }
        } else if (newMode === 'stream') {
            // Stream mode for screen sharing or webcam
            const finalTextColor = textColor || '#FFFFFF'; // Default to white text on stream
            setModeState(prev => ({
                ...prev,
                backgroundMode: 'stream',
                backgroundColor: undefined, // Clear backgroundColor so stream shows through
                backgroundImage: undefined,
                backgroundVideo: undefined,
                textColor: finalTextColor,
                textBackground: textBg,
                currentTextStyle: {
                    color: finalTextColor,
                    background: textBg
                }
            }));
            // Don't save stream mode to settings as it's temporary
        }
        return true;
    }, [setDialogueText, updateSettings]);

    useEffect(() => {
        // Skip applying initial background if host flow will control it (prevents sulfur flash)
        if (!skipInitialBackground && initialBackgroundColor && modeState.backgroundMode !== 'stream') {
            switchBackgroundMode('color', initialBackgroundColor, initialTextColor);
        }
    }, [initialBackgroundColor, initialTextColor, skipInitialBackground]); // Removed switchBackgroundMode to avoid dependency issues

    // Load color preferences from settings when they change
    useEffect(() => {
        if (settings) {
            loadColorPreferences(settings);
        }
    }, [settings, loadColorPreferences]);

    // Reactively update ghost sprite when textColor changes
    useEffect(() => {
        const sprite = modeState.characterSprite;
        if (!sprite?.ghostMode || !sprite.baseWalkPath || !sprite.baseIdlePath) {
            return;
        }

        // Debounce to avoid excessive reprocessing
        const timeoutId = setTimeout(async () => {
            try {
                const ghostColor = modeState.textColor || '#FFFFFF';
                const [walkSheet, idleSheet] = await Promise.all([
                    applySkin(sprite.baseWalkPath!, 'ghost', { color: ghostColor }),
                    applySkin(sprite.baseIdlePath!, 'ghost', { color: ghostColor })
                ]);

                setModeState(prev => ({
                    ...prev,
                    characterSprite: prev.characterSprite ? {
                        ...prev.characterSprite,
                        walkSheet,
                        idleSheet,
                    } : undefined,
                }));
            } catch (err) {
                console.error('Failed to update ghost sprite color:', err);
            }
        }, 100);

        return () => clearTimeout(timeoutId);
    }, [modeState.textColor, modeState.characterSprite?.ghostMode, modeState.characterSprite?.baseWalkPath]);

    // Add ephemeral text (disappears after delay)
    const addEphemeralText = useCallback((pos: Point, char: string, options?: {
        animationDelay?: number;
        frameDelay?: number;
        color?: string;
        background?: string;
    }) => {

        const key = `${pos.x},${pos.y}`;
        const animationDelay = options?.animationDelay || 1500;
        const frameDelay = options?.frameDelay || 80;

        // Symbol sequence for despawn animation - progressive decay
        const despawnSymbols = ['@', '#', '*', '=', ';', ':', '•', '·', '.'];
        let symbolIndex = 0;

        // Set initial character with optional color and background (using StyledCharacter format)
        const charData = (options?.color || options?.background)
            ? {
                char,
                style: {
                    ...(options.color && { color: options.color }),
                    ...(options.background && { background: options.background })
                }
              }
            : char;
        setModeState(prev => ({
            ...prev,
            lightModeData: {
                ...prev.lightModeData,
                [key]: charData
            }
        }));
        
        // Simple fade-out after specified delay
        setTimeout(() => {
            // Remove the character directly without animation
            setModeState(prev => {
                const newLightModeData = { ...prev.lightModeData };
                delete newLightModeData[key];
                return {
                    ...prev,
                    lightModeData: newLightModeData
                };
            });
        }, animationDelay);
    }, [modeState.currentMode]);

    // Calculate dynamic wrap width based on query text
    const calculateResponseWidth = useCallback((queryText: string, minWidth: number = 15): number => {
        const queryLines = queryText.split('\n');
        const maxQueryLineLength = Math.max(...queryLines.map(line => line.length));
        return Math.max(minWidth, maxQueryLineLength);
    }, []);

    // Add AI response as ephemeral text with typewriter effect
    const addAIResponse = useCallback((startPos: Point, text: string, options?: {
        wrapWidth?: number;
        typewriterSpeed?: number;
        lineDelay?: number;
        color?: string;
        persistTime?: number;
        queryText?: string; // Add queryText to calculate dynamic width
    }) => {
        
        const wrapWidth = options?.wrapWidth || (options?.queryText ? calculateResponseWidth(options.queryText) : 30);
        const typewriterSpeed = options?.typewriterSpeed || 50;
        const lineDelay = options?.lineDelay || 150;
        const color = options?.color || '#808080'; // Gray for AI responses (same as regular ephemeral text)
        const persistTime = options?.persistTime || 3000; // Longer persistence for AI
        
        // Text wrapping that honors paragraph breaks
        const wrappedLines = wrapText(text, wrapWidth);
        let lineIndex = 0;
        let charIndex = 0;
        const allCharPositions: Array<{ x: number; y: number; char: string }> = [];
        
        // Calculate total typing time to delay fade start
        const totalChars = wrappedLines.reduce((sum, line) => sum + line.length, 0);
        const totalLines = wrappedLines.length;
        const totalTypingTime = (totalChars * typewriterSpeed) + (totalLines * lineDelay);
        
        const typeNextChar = () => {
            if (lineIndex >= wrappedLines.length) return;
            
            const currentLine = wrappedLines[lineIndex];
            if (charIndex < currentLine.length) {
                const char = currentLine[charIndex];
                const x = startPos.x + charIndex;
                const y = startPos.y + lineIndex;
                
                // Store for later cleanup
                allCharPositions.push({ x, y, char });
                
                // Add character with delayed fade (starts after all typing is done)
                addEphemeralText({ x, y }, char, {
                    color: color,
                    animationDelay: totalTypingTime + persistTime
                });
                
                charIndex++;
                setTimeout(typeNextChar, typewriterSpeed);
            } else {
                // Move to next line
                lineIndex++;
                charIndex = 0;
                if (lineIndex < wrappedLines.length) {
                    setTimeout(typeNextChar, lineDelay);
                }
            }
        };
        
        typeNextChar();
    }, [addEphemeralText, modeState.currentMode, calculateResponseWidth]);
    
    // Add instant AI response with character-by-character fade
    const addInstantAIResponse = useCallback((startPos: Point, text: string, options?: {
        wrapWidth?: number;
        fadeDelay?: number;  // Delay before starting fade
        fadeInterval?: number;  // Delay between each character fade
        color?: string;
        queryText?: string;
        centered?: boolean; // Whether to center the text (default true for backwards compatibility)
    }) => {
        // Calculate intelligent wrap width based on viewport (like dialogue system)
        const BASE_FONT_SIZE = 16;
        const BASE_CHAR_WIDTH = BASE_FONT_SIZE * 0.6;
        const { width: effectiveCharWidth } = getEffectiveCharDims(zoomLevel);
        const charWidth = effectiveCharWidth || BASE_CHAR_WIDTH;

        const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 800;
        const availableWidthChars = Math.floor(viewportWidth / charWidth);
        const MARGIN_CHARS = 8; // Comfortable margin on each side
        const MAX_WIDTH_CHARS = 60; // Maximum for readability

        const intelligentWrapWidth = Math.min(MAX_WIDTH_CHARS, availableWidthChars - (2 * MARGIN_CHARS));
        const wrapWidth = options?.wrapWidth || intelligentWrapWidth;

        const fadeDelay = options?.fadeDelay || 3000;  // Wait 3 seconds before starting fade
        const fadeInterval = options?.fadeInterval || 50;  // 50ms between each character fade
        const color = options?.color || '#808080';
        
        // Text wrapping that honors paragraph breaks
        const wrappedLines = wrapText(text, wrapWidth);
        const allCharPositions: Array<{ x: number; y: number; char: string }> = [];

        // Calculate dimensions for centering (accounting for scale)
        const scale = currentScale || { w: 1, h: 2 };
        const maxLineWidth = Math.max(...wrappedLines.map(line => line.length)) * scale.w;
        const totalHeight = wrappedLines.length * scale.h;

        // Offset startPos to center the text block (unless centered: false)
        const centeredStartX = options?.centered !== false
            ? Math.floor(startPos.x - maxLineWidth / 2)
            : startPos.x;
        const centeredStartY = options?.centered !== false
            ? Math.floor(startPos.y - totalHeight / 2)
            : startPos.y;

        // Add all characters instantly
        let y = centeredStartY;
        wrappedLines.forEach(line => {
            for (let x = 0; x < line.length; x++) {
                const char = line[x];
                const worldX = centeredStartX + (x * scale.w);
                allCharPositions.push({ x: worldX, y, char });

                // Add character instantly with no initial fade
                addEphemeralText({ x: worldX, y }, char, {
                    color: color,
                    animationDelay: fadeDelay + (allCharPositions.length * fadeInterval)  // Stagger fade times
                });
            }
            y += scale.h;
        });

        return { width: maxLineWidth, height: totalHeight };
    }, [addEphemeralText, calculateResponseWidth, currentScale]);

    // Helper to restore camera mode when exiting command mode (mobile only)
    const restoreCameraModeIfNeeded = useCallback(() => {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (isMobile && previousCameraModeRef.current !== null) {
            setModeState(prev => ({ ...prev, cameraMode: previousCameraModeRef.current! }));
            previousCameraModeRef.current = null;
        }
    }, []);

    // Start command mode when '/' is pressed
    const startCommand = useCallback((cursorPos: Point) => {
        // Note: command_start not recorded - command_enter captures full flow for playback

        // On mobile: Save current camera mode and switch to focus
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (isMobile) {
            previousCameraModeRef.current = modeState.cameraMode;
            // Only switch to focus if not already in focus mode
            if (modeState.cameraMode !== 'focus') {
                setModeState(prev => ({ ...prev, cameraMode: 'focus' }));
            }
        }

        // Initialize command display
        const newCommandData: WorldData = {};
        const commandText = '/';

        // Draw initial '/' at cursor position
        const key = `${cursorPos.x},${cursorPos.y}`;
        newCommandData[key] = '/';

        // Filter commands based on authentication state
        const isAuthenticated = !!userUid;

        // Draw all available commands below with category labels
        let currentY = cursorPos.y + GRID_CELL_SPAN;
        Object.entries(COMMAND_CATEGORIES).forEach(([categoryName, commands]) => {
            // Filter commands in this category based on auth state and membership
            const filteredCommands = commands.filter(cmd => {
                if (isAuthenticated && cmd === 'signin') return false;
                if (!isAuthenticated && cmd === 'signout') return false;
                if (cmd === 'mail' && membershipLevel !== 'super') return false; // Hide mail unless super
                return true;
            });

            // Skip empty categories
            if (filteredCommands.length === 0) return;

            filteredCommands.forEach((command, indexInCategory) => {
                // Draw category label to the left of first command in category with lighter background
                if (indexInCategory === 0) {
                    for (let i = 0; i < categoryName.length; i++) {
                        const labelKey = `${cursorPos.x - categoryName.length + i},${currentY}`;
                        newCommandData[labelKey] = {
                            char: categoryName[i],
                            style: {
                                background: 'category-label', // Special marker for category labels
                                color: categoryName // Store category name for hover detection
                            }
                        };
                    }
                }

                // Draw command
                const commandDrawn = drawTextToGrid(command, cursorPos.x, currentY, newCommandData);
                Object.assign(newCommandData, commandDrawn);
                currentY += GRID_CELL_SPAN;
            });
        });

        setCommandData(newCommandData);
        setCommandState({
            isActive: true,
            input: '',
            matchedCommands: matchCommands(''), // Use matchCommands to apply authentication filtering
            selectedIndex: 0,
            commandStartPos: { x: cursorPos.x, y: cursorPos.y },
            originalCursorPos: { x: cursorPos.x, y: cursorPos.y }, // Store original position
            hasNavigated: false,
            recordingTimestamp: recorder?.getCurrentTimestamp() // Store when '/' was pressed
        });
    }, [isReadOnly, matchCommands, userUid, membershipLevel, modeState.cameraMode, recorder]);

    // Handle character input in command mode
    const addCharacter = useCallback((char: string) => {
        // Note: command_input not recorded - command_enter captures full command for playback

        setCommandState(prev => {
            const newInput = prev.input + char;
            const newMatchedCommands = matchCommands(newInput);

            // Update command display at original command start position
            const newCommandData = renderCommandDisplay(newInput, newMatchedCommands, prev.commandStartPos);
            setCommandData(newCommandData);

            return {
                ...prev,
                input: newInput,
                matchedCommands: newMatchedCommands,
                selectedIndex: Math.min(prev.selectedIndex, newMatchedCommands.length - 1),
                hasNavigated: false // Reset navigation when typing
            };
        });
    }, [matchCommands]);

    // Handle backspace in command mode
    const handleBackspace = useCallback((): { shouldExitCommand: boolean; shouldMoveCursor: boolean } => {
        // If no input characters, signal to exit command mode
        if (commandState.input.length === 0) {
            clearCommandState();
            return { shouldExitCommand: true, shouldMoveCursor: true };
        }
        
        // Remove last character from command input and display
        setCommandState(prev => {
            const newInput = prev.input.slice(0, -1);
            const newMatchedCommands = matchCommands(newInput);
            
            // Update command display
            const newCommandData = renderCommandDisplay(newInput, newMatchedCommands, prev.commandStartPos);
            setCommandData(newCommandData);
            
            return {
                ...prev,
                input: newInput,
                matchedCommands: newMatchedCommands,
                selectedIndex: Math.min(prev.selectedIndex, newMatchedCommands.length - 1),
                hasNavigated: false // Reset navigation when backspacing
            };
        });
        
        return { shouldExitCommand: false, shouldMoveCursor: true };
    }, [commandState.input.length, matchCommands]);

    // Navigate command suggestions
    const navigateUp = useCallback(() => {
        setCommandState(prev => ({
            ...prev,
            selectedIndex: Math.max(0, prev.selectedIndex - 1),
            hasNavigated: true
        }));
    }, []);

    const navigateDown = useCallback(() => {
        setCommandState(prev => ({
            ...prev,
            selectedIndex: Math.min(prev.matchedCommands.length - 1, prev.selectedIndex + 1),
            hasNavigated: true
        }));
    }, []);

    // Execute selected command
    const executeCommand = useCallback(async (isPermanent: boolean = false): Promise<CommandExecution | null> => {
        // If user hasn't navigated with arrow keys, use their raw input instead of selected suggestion
        const fullInput = commandState.input.trim();

        // Allow execution even with no matches - treat as AI prompt
        const commandToExecute = commandState.hasNavigated && commandState.matchedCommands.length > 0
            ? commandState.matchedCommands[commandState.selectedIndex]
            : fullInput;

        if (!commandToExecute) return null; // Safety check for undefined command

        const inputParts = commandToExecute.split(/\s+/);
        const commandName = inputParts[0];
        
        // Handle mode switching commands directly
        if (commandName === 'mode') {
            if (inputParts.length === 1) {
                // User typed just 'mode' - clear to default mode (like /state clears canvas)
                switchMode('default');
            } else if (inputParts.length === 2) {
                // User typed 'mode <something>' - use their specified mode
                const modeArg = inputParts[1] as CanvasMode;
                if (MODE_COMMANDS.includes(modeArg)) {
                    if (modeArg === 'chat') {
                        // For chat mode, redirect to /chat
                        router.push('/chat');
                    } else {
                        // For other modes, switch mode in current context
                        switchMode(modeArg);
                        if (modeArg === 'note') {
                            setDialogueWithRevert("Note mode: Make selections and press Enter to save. Esc to exit.", setDialogueText);
                        }
                    }
                }
            }

            // Clear command mode
            clearCommandState();

            return null; // Mode switches don't need further processing
        }

        // Handle tab/autocomplete toggle
        if (commandName === 'tab') {
            if (updateSettings) {
                updateSettings({
                    isAutocompleteEnabled: !settings?.isAutocompleteEnabled
                });
                const newState = !settings?.isAutocompleteEnabled;
                setDialogueWithRevert(
                    `Autocomplete ${newState ? 'enabled' : 'disabled'}`,
                    setDialogueText
                );
            }

            // Clear command mode
            clearCommandState();

            return null; // Autocomplete toggle doesn't need further processing
        }

        // Handle /voice command for voice input mode
        if (commandName === 'voice') {
            const { arg1 } = parseCurrentInput();
            const provider = arg1 === 'gemini' ? 'gemini' : 'browser';

            // Toggle voice mode
            const newVoiceMode = !modeState.isVoiceMode;

            setModeState(prev => ({
                ...prev,
                isVoiceMode: newVoiceMode,
                voiceState: newVoiceMode ? {
                    isListening: false,
                    isProcessing: false,
                    transcript: '',
                    provider
                } : undefined
            }));

            if (newVoiceMode) {
                setDialogueWithRevert(
                    `Voice mode enabled (${provider}). Microphone will activate on canvas.`,
                    setDialogueText
                );
            } else {
                setDialogueWithRevert("Voice mode disabled", setDialogueText);
            }

            // Clear command mode
            clearCommandState();

            return null;
        }

        // Handle /talk command for face-piloted geometry
        if (commandToExecute.startsWith('talk')) {
            const { arg1 } = parseCurrentInput();
            const faceName = arg1 ? arg1.toLowerCase() : 'macintosh';

            try {
                // Always use front camera for face tracking
                const facingMode: 'user' | 'environment' = 'user';
                const maskName = faceName; // Use provided face name or default to macintosh

                // Request webcam access with front camera
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                        facingMode: { ideal: 'user' }
                    },
                    audio: false
                });

                // Stop any existing stream
                if (backgroundStreamRef.current) {
                    backgroundStreamRef.current.getTracks().forEach(track => track.stop());
                }

                // Store stream reference
                backgroundStreamRef.current = stream;

                // Enable face detection
                setModeState(prev => ({
                    ...prev,
                    isFaceDetectionEnabled: true,
                    backgroundStream: stream
                }));

                // Show webcam feed as background (clears backgroundColor so stream shows through)
                switchBackgroundMode('stream');

                setDialogueWithRevert(`Face-piloted geometry active (${maskName} face). Turn your head to pilot the face!`, setDialogueText);
            } catch (error) {
                console.error('Failed to start face detection:', error);
                setDialogueWithRevert("Failed to access camera. Please grant permission.", setDialogueText);
            }

            // Clear command mode
            clearCommandState();

            return null;
        }

        if (commandToExecute.startsWith('bg')) {
            const { arg1: bgArg, arg2: param2, arg3: param3, restAsString: restOfInput } = parseCurrentInput();

            // Check if /bg was called with no args and there's an image at cursor position
            if (!bgArg && worldData) {
                // Look for an image at the command start position
                for (const key in worldData) {
                    // Check for modern Note objects
                    if (key.startsWith('note_')) {
                        let note: any;
                        const rawData = worldData[key];
                        if (typeof rawData === 'string') {
                            try {
                                note = JSON.parse(rawData);
                            } catch (e) {
                                continue;
                            }
                        } else {
                            note = rawData;
                        }

                        if (note && note.contentType === 'image' && note.imageData && note.imageData.src) {
                            // Check if command was typed over this image note
                            if (commandState.commandStartPos.x >= note.startX && commandState.commandStartPos.x <= note.endX &&
                                commandState.commandStartPos.y >= note.startY && commandState.commandStartPos.y <= note.endY) {

                                // Store previous background state
                                previousBackgroundStateRef.current = {
                                    mode: modeState.backgroundMode,
                                    color: modeState.backgroundColor,
                                    image: modeState.backgroundImage,
                                    video: modeState.backgroundVideo,
                                    textColor: modeState.textColor,
                                    textBackground: modeState.textBackground
                                };

                                // Set image as background temporarily
                                switchBackgroundMode('image', note.imageData.src, '#FFFFFF');
                                setDialogueWithRevert("Press ESC to restore background", setDialogueText);

                                // Clear command mode
                                clearCommandState();

                                return null;
                            }
                        }
                    } 
                    // Legacy support for old image_ entities
                    else if (key.startsWith('image_')) {
                        const imgData = worldData[key];
                        if (imgData && typeof imgData === 'object' && 'type' in imgData && imgData.type === 'image') {
                            const img = imgData as any;
                            // Check if command was typed over this image
                            if (commandState.commandStartPos.x >= img.startX && commandState.commandStartPos.x <= img.endX &&
                                commandState.commandStartPos.y >= img.startY && commandState.commandStartPos.y <= img.endY) {

                                // Store previous background state
                                previousBackgroundStateRef.current = {
                                    mode: modeState.backgroundMode,
                                    color: modeState.backgroundColor,
                                    image: modeState.backgroundImage,
                                    video: modeState.backgroundVideo,
                                    textColor: modeState.textColor,
                                    textBackground: modeState.textBackground
                                };

                                // Set image as background temporarily
                                switchBackgroundMode('image', img.src, '#FFFFFF');
                                setDialogueWithRevert("Press ESC to restore background", setDialogueText);

                                // Clear command mode
                                clearCommandState();

                                return null;
                            }
                        }
                    }
                }
            }

            if (bgArg) {
                // Check if this is a webcam request
                if (bgArg.toLowerCase() === 'webcam') {
                    try {
                        // Determine which camera to use based on param2
                        let facingMode: 'user' | 'environment' = 'environment'; // Default to back camera
                        let cameraLabel = 'back';

                        if (param2) {
                            const cameraArg = param2.toLowerCase();
                            if (cameraArg === 'front') {
                                facingMode = 'user';
                                cameraLabel = 'front';
                            } else if (cameraArg === 'back') {
                                facingMode = 'environment';
                                cameraLabel = 'back';
                            }
                        }

                        // Request webcam access
                        const stream = await navigator.mediaDevices.getUserMedia({
                            video: {
                                width: { ideal: 1920 },
                                height: { ideal: 1080 },
                                facingMode: facingMode
                            },
                            audio: false
                        });

                        // Stop any existing stream
                        if (backgroundStreamRef.current) {
                            backgroundStreamRef.current.getTracks().forEach(track => track.stop());
                        }

                        // Store stream reference
                        backgroundStreamRef.current = stream;

                        // Switch to stream background mode (use param3 for text color if provided)
                        switchBackgroundMode('stream', undefined, param3);
                        setDialogueWithRevert(`Webcam background active (${cameraLabel} camera)`, setDialogueText);
                    } catch (error) {
                        console.error('Failed to access webcam:', error);
                        setDialogueWithRevert("Failed to access webcam. Please grant camera permission.", setDialogueText);
                    }

                    // Clear command mode
                    clearCommandState();

                    return null;
                }
                // Check if this is a video background request
                else if (bgArg.toLowerCase() === 'video' || bgArg.toLowerCase().endsWith('.mp4')) {
                    // Determine video URL
                    let videoUrl: string;
                    if (bgArg.toLowerCase() === 'video') {
                        // Default to forest.mp4 in public directory
                        videoUrl = '/forest.mp4';
                    } else if (bgArg.startsWith('http://') || bgArg.startsWith('https://') || bgArg.startsWith('/')) {
                        // Use provided URL or path directly
                        videoUrl = bgArg;
                    } else {
                        // Assume it's in public directory
                        videoUrl = `/${bgArg}`;
                    }
                    
                    // Switch to video background mode
                    switchBackgroundMode('video', videoUrl, param2, param3);
                } else {
                    // Check if bgArg is a valid color
                    const colorCheck = validateColor(bgArg);
                    if (colorCheck.valid) {
                        // Format: /bg {backgroundColor} {textColor} {textBackground}
                        switchBackgroundMode('color', bgArg, param2, param3);
                    } else {
                        // Not a valid color - treat as AI prompt for background generation
                        // Combine all args as the prompt (e.g., "/bg a serene mountain landscape")
                        const fullPrompt = [bgArg, param2, param3, restOfInput].filter(Boolean).join(' ').trim();

                        setDialogueWithRevert("Generating background...", setDialogueText);

                        // Generate image using AI
                        (async () => {
                            try {
                                const result = await generateImage(fullPrompt + " (wide landscape background, seamless, no text)", undefined, userUid || undefined, '16:9');

                                if (result.imageData) {
                                    // Set generated image as background
                                    switchBackgroundMode('image', result.imageData, '#FFFFFF', undefined, fullPrompt);
                                    setDialogueWithRevert("Background generated. Press ESC to restore.", setDialogueText);

                                    // Store previous background for ESC restoration
                                    previousBackgroundStateRef.current = {
                                        mode: modeState.backgroundMode,
                                        color: modeState.backgroundColor,
                                        image: modeState.backgroundImage,
                                        video: modeState.backgroundVideo,
                                        textColor: modeState.textColor,
                                        textBackground: modeState.textBackground
                                    };
                                } else {
                                    setDialogueWithRevert(result.text || "Failed to generate background", setDialogueText);
                                }
                            } catch (error) {
                                console.error('Failed to generate background:', error);
                                setDialogueWithRevert("Failed to generate background", setDialogueText);
                            }
                        })();

                        // Clear command mode immediately
                        clearCommandState();
                        return null;
                    }
                }
            } else {
                // No arguments - default to white background
                switchBackgroundMode('color', '#FFFFFF');
            }

            // Notify tutorial flow that bg command was executed
            if (onCommandExecuted) {
                const args = inputParts.slice(1);
                onCommandExecuted('bg', args);
            }

            // Clear command mode
            clearCommandState();

            return null;
        }

        if (commandToExecute.startsWith('text')) {
            const { arg1: firstArg, arg2, arg3 } = parseCurrentInput();

            // Check if --g flag is present for global update
            const isGlobal = firstArg === '--g';
            const colorArg = isGlobal ? arg2 : firstArg;
            const backgroundArg = isGlobal ? arg3 : arg2;

            if (colorArg) {
                // Validate color format (hex code or named colors)
                let finalTextColor: string;
                if (colorArg.toLowerCase() === 'default') {
                    // Reset to default text color
                    finalTextColor = modeState.textColor; // Use current global text color
                } else {
                    const colorResult = validateColor(colorArg);
                    if (!colorResult.valid) {
                        setDialogueWithRevert(`Invalid color: ${colorArg}. Use hex code (e.g., #FF0000) or name (e.g., red, blue).`, setDialogueText);
                        // Clear command mode
                        clearCommandState();
                        return null;
                    }
                    finalTextColor = colorResult.hexColor!;
                }
                
                let finalTextBackground: string | undefined;
                if (backgroundArg) {
                    if (backgroundArg.toLowerCase() === 'none') {
                        finalTextBackground = undefined;
                    } else {
                        const bgResult = validateColor(backgroundArg);
                        if (!bgResult.valid) {
                            setDialogueWithRevert(`Invalid background color: ${backgroundArg}. Use hex code or name.`, setDialogueText);
                            // Clear command mode
                            clearCommandState();
                            return null;
                        }
                        finalTextBackground = bgResult.hexColor!;
                    }
                }
                
                if (isGlobal) {
                    // Update global text color (affects all text)
                    setModeState(prev => ({
                        ...prev,
                        textColor: finalTextColor,
                        textBackground: finalTextBackground,
                        currentTextStyle: {
                            color: finalTextColor,
                            background: finalTextBackground
                        }
                    }));

                    // Save to settings and mark as custom text color
                    if (updateSettings) {
                        const newSettings = {
                            textColor: finalTextColor,
                            hasCustomTextColor: true
                        };
                        updateSettings(newSettings);
                    }

                    const styleMsg = finalTextBackground ?
                        `Global text: ${finalTextColor} on ${finalTextBackground}` :
                        `Global text color: ${finalTextColor}`;
                    setDialogueWithRevert(styleMsg, setDialogueText);
                } else {
                    // Update the persistent text style for individual character styling only
                    setModeState(prev => ({
                        ...prev,
                        currentTextStyle: {
                            color: finalTextColor,
                            background: finalTextBackground
                        }
                    }));

                    const styleMsg = finalTextBackground ?
                        `Text style: ${finalTextColor} on ${finalTextBackground}` :
                        `Text color: ${finalTextColor}`;
                    setDialogueWithRevert(styleMsg, setDialogueText);
                }
            } else {
                // Reset to default text style
                setModeState(prev => ({
                    ...prev,
                    currentTextStyle: {
                        color: prev.textColor, // Reset to global text color
                        background: undefined
                    }
                }));
                setDialogueWithRevert("Text style reset to default", setDialogueText);
            }

            // Notify tutorial flow that text command was executed
            if (onCommandExecuted) {
                const args = inputParts.slice(1);
                onCommandExecuted('text', args);
            }

            // Clear command mode
            clearCommandState();

            return null;
        }

        if (commandToExecute.startsWith('font')) {
            // Parse the full command (e.g., "font IBM Plex Mono" or "font Apercu Pro")
            const fontCommandParts = commandToExecute.split(' ');
            const fontName = fontCommandParts.slice(1).join(' '); // Join all parts after "font"
            
            if (fontName) {
                // Check if the font name exactly matches one of our available fonts
                const selectedFont = FONT_COMMANDS.find(font => 
                    font.toLowerCase() === fontName.toLowerCase()
                );
                
                if (selectedFont) {
                    // Update font in mode state
                    setModeState(prev => ({
                        ...prev,
                        fontFamily: selectedFont
                    }));
                    setDialogueWithRevert(`Font changed to: ${selectedFont}`, setDialogueText);
                } else {
                    setDialogueWithRevert(`Font not found. Available fonts: ${FONT_COMMANDS.join(', ')}`, setDialogueText);
                }
            } else {
                // No font specified - show available fonts
                setDialogueWithRevert(`Available fonts: ${FONT_COMMANDS.join(', ')}`, setDialogueText);
            }
            
            // Clear command mode
            clearCommandState();
            
            return null;
        }

        if (commandToExecute.startsWith('scale')) {
            if (setCurrentScale) {
                const { arg1 } = parseCurrentInput();
                
                if (arg1) {
                    // Parse format like "1x2", "1x6", "4x4"
                    const parts = arg1.toLowerCase().split('x');
                    if (parts.length === 2) {
                        const w = parseInt(parts[0], 10);
                        const h = parseInt(parts[1], 10);
                        
                        if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
                            setCurrentScale({ w, h });
                            setDialogueWithRevert(`Text scale set to ${w}x${h}`, setDialogueText);
                        } else {
                            setDialogueWithRevert("Invalid scale format. Use width x height (e.g., 1x2)", setDialogueText);
                        }
                    } else {
                        setDialogueWithRevert("Invalid scale format. Use width x height (e.g., 1x2)", setDialogueText);
                    }
                } else {
                    setDialogueWithRevert("Usage: /scale <width>x<height> (e.g., /scale 1x2)", setDialogueText);
                }
            }
            
            clearCommandState();
            return null;
        }

        if (commandToExecute.startsWith('nav')) {
            // Clear command mode
            clearCommandState();

            // Use the command to execute instead of the typed input
            // Extract target name from command (format: "nav targetname")
            const commandParts = commandToExecute.split(' ');
            const targetQuery = commandParts.slice(1).join(' ');

            if (targetQuery) {
                // Try to find a matching chip first
                if (getAllChips) {
                    const chips = getAllChips();
                    const targetChip = chips.find(chip =>
                        chip.text.toLowerCase() === targetQuery.toLowerCase()
                    );

                    if (targetChip) {
                        return {
                            command: 'nav',
                            args: [targetChip.x.toString(), targetChip.y.toString()],
                            commandStartPos: commandState.commandStartPos
                        };
                    }
                }

                // If no chip found, try to find a matching bound
                if (getAllBounds) {
                    const bounds = getAllBounds();
                    const targetBound = bounds.find(bound => {
                        if (bound.title) {
                            return bound.title.toLowerCase() === targetQuery.toLowerCase();
                        } else {
                            const width = bound.endX - bound.startX + 1;
                            return `bound[${width}]` === targetQuery.toLowerCase();
                        }
                    });

                    if (targetBound) {
                        // Navigate to center of bound
                        const boundCenterX = Math.floor((targetBound.startX + targetBound.endX) / 2);
                        return {
                            command: 'nav',
                            args: [boundCenterX.toString(), targetBound.startY.toString()],
                            commandStartPos: commandState.commandStartPos
                        };
                    }
                }
            }

            return { command: 'nav', args: [], commandStartPos: commandState.commandStartPos };
        }

        if (commandToExecute.startsWith('search')) {
            const { restAsString: searchTerm } = parseCurrentInput();
            
            if (searchTerm) {
                // Activate search with the term
                setModeState(prev => ({
                    ...prev,
                    searchPattern: searchTerm,
                    isSearchActive: true
                }));
                setDialogueWithRevert(`Search active: "${searchTerm}" - Press Escape to clear`, setDialogueText);
            } else {
                // No search term - clear search
                setModeState(prev => ({
                    ...prev,
                    searchPattern: '',
                    isSearchActive: false
                }));
                setDialogueWithRevert("Search cleared", setDialogueText);
            }
            
            // Clear command mode
            clearCommandState();
            
            return null;
        }

        if (commandToExecute.startsWith('state')) {
            // Clear command mode
            clearCommandState();
            
            // Parse the command to execute
            const commandParts = commandToExecute.split(' ');
            const args = commandParts.slice(1); // Everything after 'state'
            
            // Don't execute if user selected a placeholder (shouldn't happen now)
            if (args.length === 1 && args[0] === '<name>') {
                setDialogueWithRevert("Please specify a state name", setDialogueText);
                return null;
            }
            
            // Handle navigation for state commands
            if (username) {
                if (args.length === 0) {
                    // Navigate to user's homepage (no state)
                    router.push(`/@${username}`);
                    return null;
                } else if (args[0] === '--rm') {
                    // Delete command - let world engine handle it
                    return {
                        command: 'state',
                        args: args,
                        commandStartPos: commandState.commandStartPos
                    };
                } else {
                    const stateName = args[0];
                    // Navigate to state page
                    router.push(`/@${username}/${stateName}`);
                    return null;
                }
            }
            
            // Notify tutorial flow that state command was executed
            if (onCommandExecuted) {
                onCommandExecuted('state', args);
            }

            // Fallback: Return command execution for world engine to handle (old behavior)
            return {
                command: 'state',
                args: args,
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('random')) {
            // Clear command mode
            clearCommandState();
            
            // Navigate to a random existing state
            if (username && availableStates.length > 0) {
                // Pick a random state from available states
                const randomIndex = Math.floor(Math.random() * availableStates.length);
                const randomStateName = availableStates[randomIndex];
                
                // Navigate to random existing state page
                router.push(`/@${username}/${randomStateName}`);
                setDialogueWithRevert(`Random state: ${randomStateName}`, setDialogueText);
                return null;
            } else if (availableStates.length === 0) {
                setDialogueWithRevert("No existing states found to navigate to", setDialogueText);
                return null;
            }
            
            // Fallback: Return command execution for world engine to handle (old behavior)
            return {
                command: 'random',
                args: [],
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('publish')) {
            // Parse arguments for --region flag
            const parts = commandToExecute.split(/\s+/);
            const hasRegionFlag = parts.includes('--region');

            // Clear command mode
            clearCommandState();

            // Return command execution for world engine to handle
            return {
                command: 'publish',
                args: hasRegionFlag ? ['--region'] : [],
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('record')) {
            const parts = commandToExecute.split(/\s+/);
            const action = parts[1];
            const name = parts.slice(2).join(' '); // Recording name (can have spaces)

            clearCommandState();

            if (!recorder) {
                setDialogueWithRevert("Recorder not initialized", setDialogueText);
                return null;
            }

            if (action === 'start') {
                // Pass engine state for snapshot
                const engineState = {
                    backgroundMode: modeState.backgroundMode,
                    backgroundColor: modeState.backgroundColor,
                    textColor: modeState.textColor,
                    fontFamily: modeState.fontFamily,
                    currentTextStyle: modeState.currentTextStyle,
                    currentScale: currentScale
                };
                recorder.start(engineState);
                setDialogueWithRevert("Recording started...", setDialogueText);
            } else if (action === 'stop') {
                const session = recorder.stop();
                if (session) {
                    // Auto-save with enumerated name and auto-play
                    setDialogueWithRevert("Saving recording...", setDialogueText);
                    recorder.getNextRecordingName().then((autoName) => {
                        recorder.saveToFirebase(autoName).then((result) => {
                            if (result.success) {
                                // Clear canvas and auto-play
                                if (setWorldData) {
                                    setWorldData({});
                                }
                                // Pass engine for state restoration
                                const engineForPlayback = {
                                    switchBackgroundMode,
                                    updateSettings,
                                    setCurrentScale
                                };
                                recorder.startPlayback(engineForPlayback);
                                setDialogueWithRevert(`Saved as '${autoName}'. Playing back...`, setDialogueText);
                            } else {
                                setDialogueWithRevert(`Failed to save: ${result.error}`, setDialogueText);
                            }
                        });
                    });
                } else {
                    setDialogueWithRevert("No active recording to stop", setDialogueText);
                }
            } else if (action === 'play') {
                // Play the most recent (current) recording
                if (recorder.currentRecording) {
                    // Clear canvas and play
                    if (setWorldData) {
                        setWorldData({});
                    }
                    // Pass engine for state restoration
                    const engineForPlayback = {
                        switchBackgroundMode,
                        updateSettings,
                        setCurrentScale
                    };
                    recorder.startPlayback(engineForPlayback);
                    setDialogueWithRevert("Playing most recent recording...", setDialogueText);
                } else {
                    setDialogueWithRevert("No recording available. Use /record start to create one.", setDialogueText);
                }
            } else if (action === 'load') {
                if (!name) {
                    // List available recordings (like /clip)
                    setDialogueWithRevert("Loading recordings list...", setDialogueText);
                    recorder.listRecordings().then((recordings) => {
                        if (recordings.length === 0) {
                            setDialogueWithRevert("No recordings found. Use /record save <name> to save a recording.", setDialogueText);
                        } else {
                            const list = recordings.map(r => {
                                if (r.metadata?.duration) {
                                    const durationSec = (parseInt(r.metadata.duration) / 1000).toFixed(1);
                                    return `${r.name} (${durationSec}s)`;
                                }
                                return r.name;
                            }).join(', ');
                            setDialogueWithRevert(`Available recordings: ${list}`, setDialogueText);
                        }
                    });
                    return null;
                }

                // Load from Firebase Storage and auto-play (like /clip)
                setDialogueWithRevert("Loading recording from Firebase...", setDialogueText);
                recorder.loadFromFirebase(name).then((result) => {
                    if (result.success) {
                        // Clear canvas before playback
                        if (setWorldData) {
                            setWorldData({});
                        }
                        // Pass engine for state restoration
                        const engineForPlayback = {
                            switchBackgroundMode,
                            updateSettings,
                            setCurrentScale
                        };
                        // Auto-play the loaded recording
                        recorder.startPlayback(engineForPlayback);
                        setDialogueWithRevert(`Playing '${name}'...`, setDialogueText);
                    } else {
                        setDialogueWithRevert(`Failed to load: ${result.error}`, setDialogueText);
                    }
                }).catch((error) => {
                    setDialogueWithRevert(`Error loading recording: ${error.message}`, setDialogueText);
                });
            } else if (action === 'download') {
                // Download to local file
                const json = recorder.exportRecording();
                if (json && json !== 'null') {
                    const blob = new Blob([json], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `nara_recording_${Date.now()}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                    setDialogueWithRevert("Recording downloaded to file.", setDialogueText);
                } else {
                    setDialogueWithRevert("No recording to download.", setDialogueText);
                }
            } else if (action === 'upload') {
                 // Upload from local file
                 const input = document.createElement('input');
                 input.type = 'file';
                 input.accept = '.json';
                 input.onchange = (e) => {
                     const file = (e.target as HTMLInputElement).files?.[0];
                     if (file) {
                         const reader = new FileReader();
                         reader.onload = (ev) => {
                             const content = ev.target?.result as string;
                             if (recorder.importRecording(content)) {
                                 setDialogueWithRevert(`Loaded recording: ${file.name}. Type /record save <name> to save to Firebase.`, setDialogueText);
                             } else {
                                 setDialogueWithRevert("Failed to load recording", setDialogueText);
                             }
                         };
                         reader.readAsText(file);
                     }
                 };
                 input.click();
            } else {
                setDialogueWithRevert("Usage: /record start|stop|play|load [name]|download|upload", setDialogueText);
            }

            return null;
        }

        if (commandToExecute.startsWith('replay')) {
            // Parse arguments for speed parameter (default 100ms between characters)
            const parts = commandToExecute.split(/\s+/);
            const speed = parts.length > 1 ? parseInt(parts[1], 10) : 100;

            // Clear command mode
            clearCommandState();

            // Return command execution for world engine to handle
            return {
                command: 'replay',
                args: [speed.toString()],
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('cluster')) {
            return executeSimpleCommand('cluster');
        }

        if (commandToExecute.startsWith('frames')) {
            // Parse frames command arguments
            const parts = commandToExecute.split(' ');
            const args = parts.slice(1); // Remove 'frames' from args
            
            // Clear command mode
            clearCommandState();
            
            // Return command execution for world engine to handle frame toggling
            return {
                command: 'frames',
                args: args,
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('clear')) {
            return executeSimpleCommand('clear');
        }

        if (commandToExecute.startsWith('clip')) {
            const parts = commandToExecute.split(' ');

            // Clear command mode
            clearCommandState();

            // If user selected a specific clipboard entry
            if (parts.length > 1) {
                const clipIndex = parseInt(parts[1]);
                if (!isNaN(clipIndex) && clipIndex >= 0 && clipIndex < clipboardItems.length) {
                    const clipItem = clipboardItems[clipIndex];
                    // Return command execution for world engine to paste clipboard content
                    return {
                        command: 'clip',
                        args: [clipIndex.toString()],
                        commandStartPos: commandState.commandStartPos,
                        clipContent: clipItem.content
                    };
                }
            }

            // No selection or invalid index
            setDialogueWithRevert("No clipboard item selected", setDialogueText);
            return null;
        }

        if (commandToExecute.startsWith('cam')) {
            const parts = commandToExecute.split(' ');
            const cameraMode = parts[1];

            if (CAMERA_COMMANDS.includes(cameraMode)) {
                // Update camera mode in state
                setModeState(prev => ({
                    ...prev,
                    cameraMode: cameraMode as CameraMode
                }));

                // Return command execution to let world engine calculate initial offset
                clearCommandState();

                return {
                    command: 'cam',
                    args: [cameraMode],
                    commandStartPos: commandState.commandStartPos
                };
            } else if (!cameraMode) {
                setDialogueWithRevert(`Current camera mode: ${modeState.cameraMode}`, setDialogueText);
            } else {
                setDialogueWithRevert(`Unknown camera mode. Available: ${CAMERA_COMMANDS.join(', ')}`, setDialogueText);
            }

            // Clear command mode
            clearCommandState();

            return null;
        }

        if (commandToExecute.startsWith('make')) {
            const prompt = commandToExecute.slice(4).trim();

            // Handle /make rotate - rotate object at cursor clockwise (requires rotation data)
            if (prompt === 'rotate' || prompt === 'rot') {
                const cmdPos = commandState.commandStartPos;
                // Find object at cursor position
                let foundObjectKey: string | null = null;
                let foundObjectData: any = null;

                for (const key in worldData) {
                    if (key.startsWith('object_')) {
                        try {
                            const objectData = JSON.parse(worldData[key] as string);
                            if (objectData.type === 'object' &&
                                cmdPos.x >= objectData.startX && cmdPos.x <= objectData.endX &&
                                cmdPos.y >= objectData.startY && cmdPos.y <= objectData.endY) {
                                foundObjectKey = key;
                                foundObjectData = objectData;
                                break;
                            }
                        } catch {}
                    }
                }

                if (!foundObjectKey || !foundObjectData) {
                    setDialogueWithRevert("No object at cursor. Position cursor over an object to rotate.", setDialogueText);
                    clearCommandState();
                    return null;
                }

                // Check if object has rotations (generated by bitforge + generate-8-rotations-v2)
                if (!foundObjectData.rotations || Object.keys(foundObjectData.rotations).length < 2) {
                    setDialogueWithRevert("This object doesn't have rotation data. Objects created before rotation support won't rotate - try creating a new one.", setDialogueText);
                    clearCommandState();
                    return null;
                }

                // Rotate clockwise: south → west → north → east → south
                const rotationOrder = ['south', 'west', 'north', 'east'] as const;
                const currentDir = foundObjectData.currentDirection || 'south';
                const currentIndex = rotationOrder.indexOf(currentDir as any);
                const nextIndex = (currentIndex + 1) % rotationOrder.length;
                const nextDir = rotationOrder[nextIndex];

                // Get the new image URL
                const nextImageUrl = foundObjectData.rotations[nextDir];
                if (!nextImageUrl) {
                    setDialogueWithRevert(`No image for ${nextDir} direction.`, setDialogueText);
                    clearCommandState();
                    return null;
                }

                // Update object data
                const updatedObjectData = {
                    ...foundObjectData,
                    imageUrl: nextImageUrl,
                    currentDirection: nextDir,
                };

                if (setWorldData) {
                    setWorldData((prev: any) => ({
                        ...prev,
                        [foundObjectKey!]: JSON.stringify(updatedObjectData)
                    }));
                }

                setDialogueWithRevert(`Rotated object to face ${nextDir}`, setDialogueText);
                clearCommandState();
                return null;
            }

            if (!prompt) {
                setDialogueWithRevert("Usage: /make <description> - with selection for object, or on painted region for tileset. Use /make rotate to rotate an object.", setDialogueText);
                clearCommandState();
                return null;
            }

            // Check for selection FIRST - if selection exists, generate map object
            if (selectionStart && selectionEnd) {
                const hasSelection = selectionStart.x !== selectionEnd.x || selectionStart.y !== selectionEnd.y;
                if (hasSelection) {
                    // Selection-based map object generation
                    if (!userUid) {
                        setDialogueWithRevert("Must be logged in to generate objects", setDialogueText);
                        clearCommandState();
                        return null;
                    }

                    const minX = Math.min(selectionStart.x, selectionEnd.x);
                    const maxX = Math.max(selectionStart.x, selectionEnd.x);
                    const minY = Math.min(selectionStart.y, selectionEnd.y);
                    const maxY = Math.max(selectionStart.y, selectionEnd.y);

                    const widthCells = maxX - minX + 1;
                    const heightCells = maxY - minY + 1;

                    // Convert to pixels (32px per cell)
                    const pixelWidth = Math.min(widthCells * 32, 400);
                    const pixelHeight = Math.min(heightCells * 32, 400);

                    // Set processing region for visual feedback (pulsing)
                    if (setProcessingRegion) {
                        setProcessingRegion({ startX: minX, endX: maxX, startY: minY, endY: maxY });
                    }

                    setDialogueText(`Generating object: "${prompt}" (${widthCells}×${heightCells} cells)...`);

                    const objectApiUrl = process.env.NEXT_PUBLIC_MAPOBJECT_API_URL ||
                        'https://us-central1-nara-a65bc.cloudfunctions.net/generateMapObject';

                    const objectId = `object_${Date.now()}`;

                    fetch(objectApiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            description: prompt,
                            userUid,
                            objectId,
                            width: pixelWidth,
                            height: pixelHeight
                        }),
                    })
                    .then(res => {
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        return res.json();
                    })
                    .then(async data => {
                        const jobId = data.jobId;

                        // Poll loop
                        const pollInterval = 3000;
                        const maxPolls = 100;
                        let polls = 0;

                        const poll = async () => {
                            polls++;
                            if (polls > maxPolls) throw new Error("Timeout");

                            const statusRes = await fetch(`${objectApiUrl}?jobId=${jobId}`);
                            if (!statusRes.ok) throw new Error("Poll failed");
                            const status = await statusRes.json();

                            setDialogueText(`Generating: ${status.currentPhase || status.status} (${status.progress || 0}/4)`);

                            if (status.status === 'complete' && status.imageUrl) {
                                // Store object with rotation data if available
                                const objectKey = `object_${minX}_${minY}_${Date.now()}`;
                                const objectData: Record<string, any> = {
                                    type: 'object',
                                    startX: minX,
                                    endX: maxX,
                                    startY: minY,
                                    endY: maxY,
                                    imageUrl: status.imageUrl,
                                    description: prompt,
                                    pixelWidth,
                                    pixelHeight,
                                    currentDirection: 'south', // Default facing direction
                                };

                                // Include rotations if available (from generate-8-rotations-v2)
                                if (status.rotations && Object.keys(status.rotations).length > 0) {
                                    objectData.rotations = status.rotations;
                                }

                                if (setWorldData) {
                                    setWorldData((prev: any) => ({
                                        ...prev,
                                        [objectKey]: JSON.stringify(objectData)
                                    }));
                                }

                                // Clear processing region
                                if (setProcessingRegion) {
                                    setProcessingRegion(null);
                                }

                                const rotationInfo = status.rotations ? ' (rotatable with /make rotate)' : '';
                                setDialogueText(`Object "${prompt}" created!${rotationInfo}`)
                                return;
                            } else if (status.status === 'error') {
                                throw new Error(status.error);
                            } else {
                                setTimeout(poll, pollInterval);
                            }
                        };

                        poll();
                    })
                    .catch(err => {
                        // Clear processing region on error
                        if (setProcessingRegion) {
                            setProcessingRegion(null);
                        }
                        setDialogueText(`Error: ${err.message}`);
                        console.error(err);
                    });

                    clearCommandState();
                    return null;
                }
            }

            // No selection - fall back to blob-based tileset generation
            const cursorPos = commandState.originalCursorPos;
            if (!cursorPos) {
                setDialogueWithRevert("Cursor required", setDialogueText);
                clearCommandState();
                return null;
            }

            const region = findConnectedPaintRegion(worldData, cursorPos.x, cursorPos.y);
            if (!region) {
                setDialogueWithRevert("No painted region or selection found", setDialogueText);
                clearCommandState();
                return null;
            }

            // Check if using a saved tileset from user's collection
            const savedTileset = userTilesets.find(t =>
                t.name.toLowerCase() === prompt.toLowerCase() ||
                t.id.toLowerCase() === prompt.toLowerCase()
            );

            if (savedTileset) {
                // Use saved tileset from Firebase Storage
                const tilesetUrl = savedTileset.imageUrl;
                setDialogueText(`Applying tileset: ${savedTileset.name}...`);

                // Apply tiles using CORNER-based Wang autotiling
                const updates: Record<string, string> = {};
                const regionSet = new Set(region.points.map(p => `${p.x},${p.y}`));
                const inRegion = (x: number, y: number) => regionSet.has(`${x},${y}`);

                for (const p of region.points) {
                    const nw = inRegion(p.x, p.y) && inRegion(p.x-1, p.y) &&
                               inRegion(p.x, p.y-1) && inRegion(p.x-1, p.y-1) ? 1 : 0;
                    const ne = inRegion(p.x, p.y) && inRegion(p.x+1, p.y) &&
                               inRegion(p.x, p.y-1) && inRegion(p.x+1, p.y-1) ? 1 : 0;
                    const sw = inRegion(p.x, p.y) && inRegion(p.x-1, p.y) &&
                               inRegion(p.x, p.y+1) && inRegion(p.x-1, p.y+1) ? 1 : 0;
                    const se = inRegion(p.x, p.y) && inRegion(p.x+1, p.y) &&
                               inRegion(p.x, p.y+1) && inRegion(p.x+1, p.y+1) ? 1 : 0;
                    const cornerIndex = nw * 8 + ne * 4 + sw * 2 + se * 1;

                    const key = `paint_${p.x}_${p.y}`;
                    updates[key] = JSON.stringify({
                        type: 'tile', x: p.x, y: p.y, tileset: tilesetUrl, tileIndex: cornerIndex
                    });
                }

                if (setWorldData) {
                    setWorldData((prev: any) => ({ ...prev, ...updates }));
                }
                setDialogueText(`Tileset applied: ${savedTileset.name}`);
                clearCommandState();
                return null;
            }

            // No saved tileset found - generate a new one
            if (!userUid) {
                setDialogueWithRevert("Must be logged in to generate tiles", setDialogueText);
                clearCommandState();
                return null;
            }

            setDialogueText(`Generating tileset: "${prompt}"...`);

            const tilesetApiUrl = process.env.NEXT_PUBLIC_TILESET_API_URL ||
                'https://us-central1-nara-a65bc.cloudfunctions.net/generateTileset';
            
            const tilesetId = `tileset_${Date.now()}`;

            fetch(tilesetApiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description: prompt, userUid, tilesetId }),
            })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(async data => {
                const jobId = data.jobId;
                
                // Poll loop
                const pollInterval = 3000;
                const maxPolls = 100;
                let polls = 0;

                const poll = async () => {
                    polls++;
                    if (polls > maxPolls) throw new Error("Timeout");

                    const statusRes = await fetch(`${tilesetApiUrl}?jobId=${jobId}`);
                    if (!statusRes.ok) throw new Error("Poll failed");
                    const status = await statusRes.json();

                    setDialogueText(`Generating: ${status.currentPhase || status.status} (${status.progress || 0}/3)`);

                    if (status.status === 'complete' && status.imageUrl) {
                        // Apply tiles using CORNER-based Wang autotiling
                        const tilesetUrl = status.imageUrl;
                        const updates: Record<string, string> = {};
                        const regionSet = new Set(region.points.map(p => `${p.x},${p.y}`));
                        const inRegion = (x: number, y: number) => regionSet.has(`${x},${y}`);

                        for (const p of region.points) {
                            const nw = inRegion(p.x, p.y) && inRegion(p.x-1, p.y) &&
                                       inRegion(p.x, p.y-1) && inRegion(p.x-1, p.y-1) ? 1 : 0;
                            const ne = inRegion(p.x, p.y) && inRegion(p.x+1, p.y) &&
                                       inRegion(p.x, p.y-1) && inRegion(p.x+1, p.y-1) ? 1 : 0;
                            const sw = inRegion(p.x, p.y) && inRegion(p.x-1, p.y) &&
                                       inRegion(p.x, p.y+1) && inRegion(p.x-1, p.y+1) ? 1 : 0;
                            const se = inRegion(p.x, p.y) && inRegion(p.x+1, p.y) &&
                                       inRegion(p.x, p.y+1) && inRegion(p.x+1, p.y+1) ? 1 : 0;
                            const cornerIndex = nw * 8 + ne * 4 + sw * 2 + se * 1;

                            const key = `paint_${p.x}_${p.y}`;
                            updates[key] = JSON.stringify({
                                type: 'tile', x: p.x, y: p.y, tileset: tilesetUrl, tileIndex: cornerIndex
                            });
                        }

                        if (setWorldData) {
                            setWorldData((prev: any) => ({ ...prev, ...updates }));
                        }

                        // Add new tileset to local state
                        const newTileset: SavedTileset = {
                            id: tilesetId,
                            name: prompt,
                            description: prompt,
                            imageUrl: tilesetUrl,
                            createdAt: new Date().toISOString(),
                            tileSize: 32,
                            gridSize: 4,
                        };
                        setUserTilesets(prev => [newTileset, ...prev]);

                        setDialogueText(`Tileset "${prompt}" saved & applied!`);
                        return;
                    } else if (status.status === 'error') {
                        throw new Error(status.error);
                    } else {
                        setTimeout(poll, pollInterval);
                    }
                };

                poll();
            })
            .catch(err => {
                setDialogueText(`Error: ${err.message}`);
                console.error(err);
            });

            clearCommandState();
            return null;
        }

        if (commandToExecute.startsWith('indent')) {
            return executeToggleModeCommand('isIndentEnabled', "Smart indentation enabled", "Smart indentation disabled");
        }

        if (commandToExecute.startsWith('be')) {
            const beArgs = commandToExecute.slice(2).trim();

            // Handle --rm flag (delete sprite)
            if (beArgs.startsWith('--rm ')) {
                const spriteName = beArgs.slice(5).trim();
                const spriteToDelete = userSprites.find(s => s.name.toLowerCase() === spriteName.toLowerCase());

                if (!spriteToDelete) {
                    setDialogueWithRevert(`Sprite "${spriteName}" not found`, setDialogueText);
                    clearCommandState();
                    return null;
                }

                if (!userUid) {
                    setDialogueWithRevert("Must be logged in to delete sprites", setDialogueText);
                    clearCommandState();
                    return null;
                }

                setDialogueText(`Deleting sprite: ${spriteToDelete.name}...`);
                deleteSprite(userUid, spriteToDelete.id).then(result => {
                    if (result.success) {
                        setUserSprites(prev => prev.filter(s => s.id !== spriteToDelete.id));
                        setDialogueText(`Deleted sprite: ${spriteToDelete.name}`);
                    } else {
                        setDialogueText(`Failed to delete: ${result.error}`);
                    }
                });

                clearCommandState();
                return null;
            }

            // Parse prompt and customName - may be overridden by --re
            let prompt = beArgs;
            let customName: string | undefined;

            // Handle --re flag (regenerate sprite using saved description)
            if (beArgs.startsWith('--re ')) {
                const spriteName = beArgs.slice(5).trim();
                const spriteToRegen = userSprites.find(s => s.name.toLowerCase() === spriteName.toLowerCase());

                if (!spriteToRegen) {
                    setDialogueWithRevert(`Sprite "${spriteName}" not found`, setDialogueText);
                    clearCommandState();
                    return null;
                }

                // Use the saved description to regenerate, keeping the same name
                prompt = spriteToRegen.description;
                customName = spriteToRegen.name;
                // Fall through to generation logic below
            }

            // Handle --name flag (rename sprite)
            if (beArgs.startsWith('--name ')) {
                const nameArgs = beArgs.slice(7).trim();
                const parts = nameArgs.split(' ');

                if (parts.length < 2) {
                    setDialogueWithRevert("Usage: /be --name <sprite> <newname>", setDialogueText);
                    clearCommandState();
                    return null;
                }

                const oldName = parts[0];
                const newName = parts.slice(1).join('_').toLowerCase().replace(/[^a-z0-9_]/gi, '');

                const spriteToRename = userSprites.find(s => s.name.toLowerCase() === oldName.toLowerCase());

                if (!spriteToRename) {
                    setDialogueWithRevert(`Sprite "${oldName}" not found`, setDialogueText);
                    clearCommandState();
                    return null;
                }

                if (!userUid) {
                    setDialogueWithRevert("Must be logged in to rename sprites", setDialogueText);
                    clearCommandState();
                    return null;
                }

                setDialogueText(`Renaming sprite...`);
                renameSprite(userUid, spriteToRename.id, newName).then(result => {
                    if (result.success) {
                        setUserSprites(prev => prev.map(s =>
                            s.id === spriteToRename.id ? { ...s, name: newName } : s
                        ));
                        setDialogueText(`Renamed: ${oldName} → ${newName}`);
                    } else {
                        setDialogueText(`Failed to rename: ${result.error}`);
                    }
                });

                clearCommandState();
                return null;
            }

            // Handle --post flag (apply post-processing effects to sprite sheets)
            if (beArgs.startsWith('--post ')) {
                const postArgs = beArgs.slice(7).trim().split(' ');

                // Parse arguments: /be --post [effectName] [spriteName] [color]
                // Examples:
                //   /be --post ghost mysprite #ff0000
                //   /be --post ghost mysprite
                //   /be --post mysprite (defaults to monochrome)
                let effectName = 'monochrome'; // default
                let spriteName: string;
                let color: string | undefined;

                if (postArgs.length === 1) {
                    // Just sprite name, use default monochrome
                    spriteName = postArgs[0];
                } else if (postArgs.length === 2) {
                    // Effect name and sprite name
                    effectName = postArgs[0].toLowerCase();
                    spriteName = postArgs[1];
                } else if (postArgs.length >= 3) {
                    // Effect name, sprite name, and color
                    effectName = postArgs[0].toLowerCase();
                    spriteName = postArgs[1];
                    color = postArgs[2];
                } else {
                    const availableEffects = getAvailableEffects();
                    setDialogueWithRevert(`Usage: /be --post [effect] <sprite> [color] (effects: ${availableEffects.join(', ')})`, setDialogueText);
                    clearCommandState();
                    return null;
                }

                // Validate effect name
                const availableEffects = getAvailableEffects();
                if (!availableEffects.includes(effectName)) {
                    setDialogueWithRevert(`Unknown effect: ${effectName}. Valid: ${availableEffects.join(', ')}`, setDialogueText);
                    clearCommandState();
                    return null;
                }

                if (!userUid) {
                    setDialogueWithRevert("Must be logged in to post-process", setDialogueText);
                    clearCommandState();
                    return null;
                }

                // Look up sprite by name to get ID
                const sprite = userSprites.find(s => s.name.toLowerCase() === spriteName.toLowerCase());
                if (!sprite) {
                    setDialogueWithRevert(`Sprite "${spriteName}" not found`, setDialogueText);
                    clearCommandState();
                    return null;
                }
                const spriteId = sprite.id;

                setDialogueText(`Applying ${effectName} effect to ${spriteName}...`);

                (async () => {
                    try {
                        const { ref: storageRef, getDownloadURL, uploadString } = await import('firebase/storage');
                        const { storage } = await import('@/app/firebase');

                        // Load the sprite sheets (idle and walk if available)
                        const sheets: Array<{ name: string; url: string }> = [];

                        try {
                            const idleRef = storageRef(storage, `sprites/${userUid}/${spriteId}/idle.png`);
                            const idleUrl = await getDownloadURL(idleRef);
                            sheets.push({ name: 'idle', url: idleUrl });
                        } catch (err) {
                            // No idle.png found
                        }

                        try {
                            const walkRef = storageRef(storage, `sprites/${userUid}/${spriteId}/walk.png`);
                            const walkUrl = await getDownloadURL(walkRef);
                            sheets.push({ name: 'walk', url: walkUrl });
                        } catch (err) {
                            // No walk.png found
                        }

                        if (sheets.length === 0) {
                            setDialogueText(`No sprite sheets found for ${spriteName}`);
                            return;
                        }

                        // Build options for the effect
                        const effectOptions = color ? { color } : undefined;

                        // Process each sheet using the skins module
                        for (const sheet of sheets) {
                            // Apply effect using skins module
                            const processedDataUrl = await applySkin(sheet.url, effectName, effectOptions);

                            // Upload processed image back to storage
                            const uploadRef = storageRef(storage, `sprites/${userUid}/${spriteId}/${sheet.name}.png`);
                            await uploadString(uploadRef, processedDataUrl, 'data_url');
                        }

                        // Reload the sprite
                        const idleRef = storageRef(storage, `sprites/${userUid}/${spriteId}/idle.png`);
                        const idleUrl = await getDownloadURL(idleRef);

                        let walkUrl = idleUrl; // Fallback to idle
                        try {
                            const walkRef = storageRef(storage, `sprites/${userUid}/${spriteId}/walk.png`);
                            walkUrl = await getDownloadURL(walkRef);
                        } catch (err) {
                            // Using idle for walk
                        }

                        // Set as current cursor
                        setModeState(prev => ({
                            ...prev,
                            isCharacterEnabled: true,
                            characterSprite: {
                                walkSheet: walkUrl,
                                idleSheet: idleUrl,
                                name: spriteName,
                            },
                        }));

                        setDialogueText(`${effectName.charAt(0).toUpperCase() + effectName.slice(1)} effect applied to ${spriteName}!`);
                    } catch (err) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        console.error('[/be --post] Error:', err);
                        setDialogueText(`Failed to post-process: ${errMsg}`);
                    }
                })();

                clearCommandState();
                return null;
            }

            // Handle --sheet flag (create idle sheet from existing rotations)
            if (beArgs.startsWith('--sheet ')) {
                const spriteName = beArgs.slice(8).trim();

                if (!userUid) {
                    setDialogueWithRevert("Must be logged in to create sheet", setDialogueText);
                    clearCommandState();
                    return null;
                }

                // Look up sprite by name to get ID
                const sprite = userSprites.find(s => s.name.toLowerCase() === spriteName.toLowerCase());
                if (!sprite) {
                    setDialogueWithRevert(`Sprite "${spriteName}" not found`, setDialogueText);
                    clearCommandState();
                    return null;
                }
                const spriteId = sprite.id;

                setDialogueText(`Creating idle sheet for ${spriteName}...`);

                (async () => {
                    try {
                        const { ref: storageRef, listAll } = await import('firebase/storage');
                        const { storage } = await import('@/app/firebase');

                        // List rotations in the sprite folder
                        const rotationsRef = storageRef(storage, `sprites/${userUid}/${spriteId}/rotations`);
                        const rotationsList = await listAll(rotationsRef);

                        if (rotationsList.items.length === 0) {
                            setDialogueText(`No rotations found for ${spriteId}`);
                            return;
                        }

                        // Build refs array for the new function
                        const storageRefs = rotationsList.items.map(item => ({
                            direction: item.name.replace('.png', ''),
                            ref: item,
                        }));

                        // Create the spritesheet using Firebase SDK (no CORS issues)
                        const staticSheet = await compositeSpriteSheetFromRefs(
                            storageRefs,
                            IDLE_FRAME_SIZE,
                            IDLE_FRAMES_PER_DIR
                        );

                        // Upload as idle.png only (walk.png created by --animate)
                        const { uploadString } = await import('firebase/storage');
                        const idleRef = storageRef(storage, `sprites/${userUid}/${spriteId}/idle.png`);
                        await uploadString(idleRef, staticSheet, 'data_url');

                        // Set as current cursor (use idle for walk until animated)
                        setModeState(prev => ({
                            ...prev,
                            isCharacterEnabled: true,
                            characterSprite: {
                                walkSheet: staticSheet, // Fallback to idle until --animate creates walk.png
                                idleSheet: staticSheet,
                                name: spriteId,
                            },
                        }));

                        setDialogueText(`Now playing as: ${spriteId}`);
                    } catch (err) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        console.error('[/be --sheet] Error:', err);
                        setDialogueText(`Failed to create sheet: ${errMsg}`);
                    }
                })();

                clearCommandState();
                return null;
            }

            // Handle --animate flag (generate walk animation from existing character)
            if (beArgs.startsWith('--animate ')) {
                const spriteName = beArgs.slice(10).trim();

                if (!userUid) {
                    setDialogueWithRevert("Must be logged in to animate", setDialogueText);
                    clearCommandState();
                    return null;
                }

                // Look up sprite by name to get ID
                const sprite = userSprites.find(s => s.name.toLowerCase() === spriteName.toLowerCase());
                if (!sprite) {
                    setDialogueWithRevert(`Sprite "${spriteName}" not found`, setDialogueText);
                    clearCommandState();
                    return null;
                }
                const spriteId = sprite.id;

                // Helper to add log entry to debug div
                const addLog = (msg: string) => {
                    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
                    setModeState(prev => ({
                        ...prev,
                        spriteDebugLog: [...(prev.spriteDebugLog || []), `[${timestamp}] ${msg}`]
                    }));
                };

                // Set cursor to idle sprite immediately (it will pulse during animation)
                const idleUrl = sprite.idleUrl || '';
                setModeState(prev => ({
                    ...prev,
                    isGeneratingSprite: true,
                    spriteDebugLog: [],
                    isCharacterEnabled: true,
                    characterSprite: {
                        walkSheet: idleUrl, // Use idle for walk temporarily
                        idleSheet: idleUrl,
                        name: spriteName,
                    },
                }));
                setDialogueText(`Generating walk animation for ${spriteName}...`);
                addLog(`Starting animation for: ${spriteName}`);
                addLog(`Cursor set to idle sprite (pulsing)`);

                (async () => {
                    try {
                        const { ref: storageRef, getDownloadURL, getBytes, uploadString } = await import('firebase/storage');
                        const { storage } = await import('@/app/firebase');

                        // Read metadata to get characterId
                        addLog(`Reading metadata...`);
                        const metadataRef = storageRef(storage, `sprites/${userUid}/${spriteId}/metadata.json`);
                        const metadataBytes = await getBytes(metadataRef);
                        const metadataText = new TextDecoder().decode(metadataBytes);
                        const metadata = JSON.parse(metadataText);

                        if (!metadata.characterId) {
                            addLog(`ERROR: No characterId found`);
                            setModeState(prev => ({ ...prev, isGeneratingSprite: false }));
                            setDialogueText(`No characterId found for ${spriteName}. Regenerate with /be.`);
                            return;
                        }

                        addLog(`Found characterId: ${metadata.characterId.slice(0, 8)}...`);
                        setDialogueText(`Requesting animation from Pixellab...`);
                        addLog(`Requesting animation from Pixellab...`);

                        // Call Cloud Function to generate animation
                        const response = await fetch(
                            'https://us-central1-nara-a65bc.cloudfunctions.net/animateSprite',
                            {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    characterId: metadata.characterId,
                                    userUid,
                                    spriteId,
                                }),
                            }
                        );

                        if (!response.ok) {
                            const errText = await response.text();
                            addLog(`ERROR: Animation request failed`);
                            throw new Error(`Animation request failed: ${errText}`);
                        }

                        const { jobId } = await response.json();
                        addLog(`Job started: ${jobId.slice(0, 8)}...`);

                        // Poll for completion
                        const pollInterval = 3000;
                        const maxPolls = 120; // 6 minutes max
                        let pollCount = 0;

                        const poll = async (): Promise<any> => {
                            pollCount++;
                            const statusRes = await fetch(
                                `https://us-central1-nara-a65bc.cloudfunctions.net/animateSprite?jobId=${jobId}`
                            );
                            const status = await statusRes.json();

                            const phase = status.currentPhase || 'processing';
                            addLog(`[${pollCount}] ${status.status} - ${phase}`);

                            if (status.status === 'complete') {
                                return status;
                            } else if (status.status === 'partial') {
                                // Animation partially completed - some directions failed
                                const completed = status.completedDirections?.length || 0;
                                const total = status.totalDirections || 8;
                                addLog(`PARTIAL: ${completed}/${total} directions completed`);
                                if (status.missingDirections?.length > 0) {
                                    addLog(`Missing: ${status.missingDirections.join(', ')}`);
                                }
                                // Treat partial as success - user can retry failed directions with --animate-continue
                                return status;
                            } else if (status.status === 'error') {
                                addLog(`ERROR: ${status.error || 'Animation failed'}`);
                                throw new Error(status.error || 'Animation failed');
                            } else if (pollCount >= maxPolls) {
                                addLog(`ERROR: Animation timed out`);
                                throw new Error('Animation timed out');
                            }

                            // Update dialogue with progress
                            setDialogueText(`Animating ${spriteName}... (${phase})`);
                            await new Promise(r => setTimeout(r, pollInterval));
                            return poll();
                        };

                        const result = await poll();
                        addLog(`Animation complete!`);

                        setDialogueText(`Compositing walk sheet...`);
                        addLog(`Compositing walk sheet...`);

                        // Composite animation frames into walk sprite sheet
                        const framePaths = result.framePaths as Record<string, string[]>;
                        const FRAME_WIDTH = 32;
                        const FRAME_HEIGHT = 40;
                        const FRAMES_PER_DIR = 8;

                        const walkCanvas = document.createElement('canvas');
                        walkCanvas.width = FRAME_WIDTH * FRAMES_PER_DIR;
                        walkCanvas.height = FRAME_HEIGHT * SPRITE_DIRECTIONS.length;
                        const walkCtx = walkCanvas.getContext('2d')!;

                        // Load and draw frames for each direction
                        for (let row = 0; row < SPRITE_DIRECTIONS.length; row++) {
                            const direction = SPRITE_DIRECTIONS[row];
                            const frames = framePaths[direction];
                            if (!frames) {
                                continue;
                            }

                            for (let col = 0; col < frames.length && col < FRAMES_PER_DIR; col++) {
                                const frameUrl = frames[col];
                                try {
                                    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                                        const image = new Image();
                                        image.crossOrigin = 'anonymous';
                                        image.onload = () => resolve(image);
                                        image.onerror = reject;
                                        image.src = frameUrl;
                                    });

                                    // Calculate scaling to fit frame
                                    const scale = Math.min(
                                        FRAME_WIDTH / img.width,
                                        FRAME_HEIGHT / img.height
                                    );
                                    const scaledWidth = img.width * scale;
                                    const scaledHeight = img.height * scale;
                                    const offsetX = (FRAME_WIDTH - scaledWidth) / 2;
                                    const offsetY = (FRAME_HEIGHT - scaledHeight) / 2;

                                    walkCtx.drawImage(
                                        img,
                                        col * FRAME_WIDTH + offsetX,
                                        row * FRAME_HEIGHT + offsetY,
                                        scaledWidth,
                                        scaledHeight
                                    );
                                } catch (err) {
                                    console.warn(`[/be --animate] Failed to load frame ${direction}_${col}:`, err);
                                }
                            }
                        }

                        const walkSheet = walkCanvas.toDataURL('image/png');

                        // Upload walk sheet to Storage
                        const { uploadString: upStr } = await import('firebase/storage');
                        const walkRef = storageRef(storage, `sprites/${userUid}/${spriteId}/walk.png`);
                        await upStr(walkRef, walkSheet, 'data_url');

                        // Load idle sheet
                        const idleRef = storageRef(storage, `sprites/${userUid}/${spriteId}/idle.png`);
                        const idleUrl = await getDownloadURL(idleRef);

                        const idleImg = await new Promise<HTMLImageElement>((resolve, reject) => {
                            const img = new Image();
                            img.crossOrigin = 'anonymous';
                            img.onload = () => resolve(img);
                            img.onerror = reject;
                            img.src = idleUrl;
                        });

                        const idleCanvas = document.createElement('canvas');
                        idleCanvas.width = idleImg.width;
                        idleCanvas.height = idleImg.height;
                        const idleCtx = idleCanvas.getContext('2d')!;
                        idleCtx.drawImage(idleImg, 0, 0);
                        const idleSheet = idleCanvas.toDataURL('image/png');

                        addLog(`Success! Walk animation ready.`);

                        // Set as current cursor with animated walk
                        setModeState(prev => ({
                            ...prev,
                            isGeneratingSprite: false,
                            isCharacterEnabled: true,
                            characterSprite: {
                                walkSheet,
                                idleSheet,
                                name: spriteName,
                            },
                        }));

                        setDialogueText(`${spriteName} now has walk animation!`);

                    } catch (err) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        addLog(`ERROR: ${errMsg}`);
                        console.error('[/be --animate] Error:', err);
                        setModeState(prev => ({ ...prev, isGeneratingSprite: false }));
                        setDialogueText(`Animation failed: ${errMsg}`);
                    }
                })();

                clearCommandState();
                return null;
            }

            // Handle --animate-continue flag (continue animation if walk sheet missing)
            if (beArgs.startsWith('--animate-continue ')) {
                const spriteName = beArgs.slice(19).trim();

                if (!userUid) {
                    setDialogueWithRevert("Must be logged in", setDialogueText);
                    clearCommandState();
                    return null;
                }

                // Look up sprite by name to get ID
                const sprite = userSprites.find(s => s.name.toLowerCase() === spriteName.toLowerCase());
                if (!sprite) {
                    setDialogueWithRevert(`Sprite "${spriteName}" not found`, setDialogueText);
                    clearCommandState();
                    return null;
                }
                const spriteId = sprite.id;

                setDialogueText(`Checking ${spriteName} animation status...`);

                (async () => {
                    try {
                        const { ref: storageRef, getDownloadURL, getBytes, listAll, uploadString: uploadStr } = await import('firebase/storage');
                        const { storage } = await import('@/app/firebase');

                        // Define walkRef for later use
                        const walkRef = storageRef(storage, `sprites/${userUid}/${spriteId}/walk.png`);

                        // Check if walk.png already exists
                        try {
                            await getDownloadURL(walkRef);
                            setDialogueText(`${spriteId} already has walk animation. Use /be ${spriteId} to load.`);
                            return;
                        } catch {
                            // walk.png doesn't exist, check for partial frames
                        }

                        // Check walk_frames/ folder for existing frames
                        const walkFramesRef = storageRef(storage, `sprites/${userUid}/${spriteId}/walk_frames`);
                        let existingFrames: Record<string, string[]> = {};
                        let shouldRequestAnimation = true;
                        let missingDirs: string[] = [...SPRITE_DIRECTIONS]; // Default to all directions

                        try {
                            const framesList = await listAll(walkFramesRef);

                            // Group frames by direction
                            for (const item of framesList.items) {
                                const fileName = item.name; // e.g., "south_0.png"
                                const match = fileName.match(/^(.+)_(\d+)\.png$/);
                                if (match) {
                                    const direction = match[1];
                                    const frameUrl = await getDownloadURL(item);

                                    if (!existingFrames[direction]) {
                                        existingFrames[direction] = [];
                                    }
                                    existingFrames[direction].push(frameUrl);
                                }
                            }

                            // Sort frames by index for each direction
                            for (const direction in existingFrames) {
                                existingFrames[direction].sort();
                            }

                            const existingDirs = Object.keys(existingFrames);
                            if (existingDirs.length > 0) {
                                missingDirs = SPRITE_DIRECTIONS.filter(d => !existingFrames[d]);

                                if (missingDirs.length === 0) {
                                    // All directions already exist, skip animation request
                                    setDialogueText(`All directions complete, creating walk sheet...`);
                                    shouldRequestAnimation = false;
                                } else {
                                    // Some missing, will request animation ONLY for missing directions
                                    setDialogueText(`Found ${existingDirs.length}/${SPRITE_DIRECTIONS.length} dirs. Requesting: ${missingDirs.join(', ')}...`);
                                }
                            }
                        } catch (err) {
                            // No existing frames, will request new animation
                        }

                        // Prepare framePaths for compositing
                        let framePaths: Record<string, string[]> = {};

                        if (shouldRequestAnimation) {
                            // Read metadata and request new animation
                            const metadataRef = storageRef(storage, `sprites/${userUid}/${spriteId}/metadata.json`);
                            const metadataBytes = await getBytes(metadataRef);
                            const metadataText = new TextDecoder().decode(metadataBytes);
                            const metadata = JSON.parse(metadataText);

                            if (!metadata.characterId) {
                                setDialogueText(`No characterId for ${spriteId}. Use /be to regenerate.`);
                                return;
                            }

                            setDialogueText(`Requesting animation for: ${missingDirs.join(', ')}...`);

                            // Same animation flow as --animate, but only for missing directions
                            const response = await fetch(
                                'https://us-central1-nara-a65bc.cloudfunctions.net/animateSprite',
                                {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        characterId: metadata.characterId,
                                        userUid,
                                        spriteId,
                                        directionsToUpload: missingDirs, // Only upload frames for missing directions
                                    }),
                                }
                            );

                            if (!response.ok) {
                                const errText = await response.text();
                                throw new Error(`Animation request failed: ${errText}`);
                            }

                            const { jobId } = await response.json();

                            // Poll for completion
                            const pollInterval = 3000;
                            const maxPolls = 120;
                            let pollCount = 0;

                            const poll = async (): Promise<any> => {
                                pollCount++;
                                const statusRes = await fetch(
                                    `https://us-central1-nara-a65bc.cloudfunctions.net/animateSprite?jobId=${jobId}`
                                );
                                const status = await statusRes.json();

                                if (status.status === 'complete') return status;
                                if (status.status === 'partial') {
                                    // Partial success - some directions completed
                                    return status;
                                }
                                if (status.status === 'error') throw new Error(status.error || 'Animation failed');
                                if (pollCount >= maxPolls) throw new Error('Animation timed out');

                                setDialogueText(`Animating ${spriteId}... (${status.currentPhase || 'processing'})`);
                                await new Promise(r => setTimeout(r, pollInterval));
                                return poll();
                            };

                            const result = await poll();

                            // Get frame paths from API result and merge with existing frames
                            // This ensures we composite ALL directions, not just the newly generated ones
                            framePaths = { ...existingFrames, ...(result.framePaths as Record<string, string[]>) };
                        } else {
                            // Use existing frames from storage
                            framePaths = existingFrames;
                        }

                        // Composite frames (same as --animate)
                        setDialogueText(`Compositing walk sheet...`);
                        const FRAME_WIDTH = 32;
                        const FRAME_HEIGHT = 40;
                        const FRAMES_PER_DIR = 8;

                        const walkCanvas = document.createElement('canvas');
                        walkCanvas.width = FRAME_WIDTH * FRAMES_PER_DIR;
                        walkCanvas.height = FRAME_HEIGHT * SPRITE_DIRECTIONS.length;
                        const walkCtx = walkCanvas.getContext('2d')!;

                        for (let row = 0; row < SPRITE_DIRECTIONS.length; row++) {
                            const direction = SPRITE_DIRECTIONS[row];
                            const frames = framePaths[direction];
                            if (!frames) continue;

                            for (let col = 0; col < frames.length && col < FRAMES_PER_DIR; col++) {
                                try {
                                    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                                        const image = new Image();
                                        image.crossOrigin = 'anonymous';
                                        image.onload = () => resolve(image);
                                        image.onerror = reject;
                                        image.src = frames[col];
                                    });

                                    const scale = Math.min(FRAME_WIDTH / img.width, FRAME_HEIGHT / img.height);
                                    const scaledWidth = img.width * scale;
                                    const scaledHeight = img.height * scale;
                                    const offsetX = (FRAME_WIDTH - scaledWidth) / 2;
                                    const offsetY = (FRAME_HEIGHT - scaledHeight) / 2;

                                    walkCtx.drawImage(img, col * FRAME_WIDTH + offsetX, row * FRAME_HEIGHT + offsetY, scaledWidth, scaledHeight);
                                } catch (err) {
                                    console.warn(`Failed to load frame ${direction}_${col}:`, err);
                                }
                            }
                        }

                        const walkSheet = walkCanvas.toDataURL('image/png');
                        await uploadStr(walkRef, walkSheet, 'data_url');

                        // Load idle and set sprite
                        const idleRef = storageRef(storage, `sprites/${userUid}/${spriteId}/idle.png`);
                        const idleUrl = await getDownloadURL(idleRef);
                        const idleImg = await new Promise<HTMLImageElement>((resolve, reject) => {
                            const img = new Image();
                            img.crossOrigin = 'anonymous';
                            img.onload = () => resolve(img);
                            img.onerror = reject;
                            img.src = idleUrl;
                        });
                        const idleCanvas = document.createElement('canvas');
                        idleCanvas.width = idleImg.width;
                        idleCanvas.height = idleImg.height;
                        idleCanvas.getContext('2d')!.drawImage(idleImg, 0, 0);
                        const idleSheet = idleCanvas.toDataURL('image/png');

                        setModeState(prev => ({
                            ...prev,
                            isCharacterEnabled: true,
                            characterSprite: { walkSheet, idleSheet, name: spriteId },
                        }));

                        setDialogueText(`${spriteId} animation complete!`);
                    } catch (err) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        console.error('[/be --animate-continue] Error:', err);
                        setDialogueText(`Animation failed: ${errMsg}`);
                    }
                })();

                clearCommandState();
                return null;
            }

            // Handle --rename flag (rename sprite and update metadata)
            if (beArgs.startsWith('--rename ')) {
                const renameArgs = beArgs.slice(9).trim();
                const [spriteId, newName] = renameArgs.split(/\s+/);

                if (!userUid) {
                    setDialogueWithRevert("Must be logged in", setDialogueText);
                    clearCommandState();
                    return null;
                }

                if (!spriteId) {
                    setDialogueWithRevert("Usage: /be --rename <spriteId> <newName>", setDialogueText);
                    clearCommandState();
                    return null;
                }

                if (!newName) {
                    setDialogueWithRevert(`Enter new name: /be --rename ${spriteId} <newName>`, setDialogueText);
                    clearCommandState();
                    return null;
                }

                const sanitizedName = newName.toLowerCase().replace(/[^a-z0-9_]/gi, '');
                setDialogueText(`Renaming ${spriteId} to ${sanitizedName}...`);

                (async () => {
                    try {
                        const { ref: storageRef, getBytes, uploadBytes } = await import('firebase/storage');
                        const { storage } = await import('@/app/firebase');

                        // Read existing metadata
                        const metadataRef = storageRef(storage, `sprites/${userUid}/${spriteId}/metadata.json`);
                        const metadataBytes = await getBytes(metadataRef);
                        const metadataText = new TextDecoder().decode(metadataBytes);
                        const metadata = JSON.parse(metadataText);

                        // Update name
                        metadata.name = sanitizedName;
                        metadata.updatedAt = new Date().toISOString();

                        // Save updated metadata
                        const updatedBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
                        await uploadBytes(metadataRef, updatedBlob);

                        // Update local state
                        setUserSprites(prev => prev.map(s =>
                            s.id === spriteId ? { ...s, name: sanitizedName } : s
                        ));

                        setDialogueText(`Renamed to: ${sanitizedName}`);
                    } catch (err) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        console.error('[/be --rename] Error:', err);
                        setDialogueText(`Rename failed: ${errMsg}`);
                    }
                })();

                clearCommandState();
                return null;
            }

            // Parse quoted prompt and optional name: 'prompt text' [name]
            // (Only if not already set by --re)
            if (!beArgs.startsWith('--re ')) {
                const quoteMatch = beArgs.match(/^'([^']+)'(?:\s+(\S+))?$/);
                if (quoteMatch) {
                    prompt = quoteMatch[1];
                    customName = quoteMatch[2]?.toLowerCase().replace(/[^a-z0-9_]/gi, '');
                }

                // Check if this matches a saved sprite name or ID (only if not using quotes)
                if (!quoteMatch) {
                    // First try to match by name, then by ID
                    const savedSprite = userSprites.find(s => s.name.toLowerCase() === prompt.toLowerCase())
                        || userSprites.find(s => s.id.toLowerCase() === prompt.toLowerCase());

                    if (savedSprite) {
                        // Load saved sprite (use idleUrl as fallback if no walkUrl)
                        setDialogueText(`Loading sprite: ${savedSprite.name}...`);
                        const walkSheet = savedSprite.walkUrl || savedSprite.idleUrl;
                        setModeState(prev => ({
                            ...prev,
                            isCharacterEnabled: true,
                            characterSprite: {
                                walkSheet,
                                idleSheet: savedSprite.idleUrl,
                                name: savedSprite.name,
                            },
                        }));
                        setDialogueText(`Now playing as: ${savedSprite.name}`);
                        clearCommandState();
                        return null;
                    }

                    // Check if this matches a public sprite name
                    const PUBLIC_SPRITES = [
                        { name: 'default', walkPath: '/sprites/default_walk.png', idlePath: '/sprites/default_idle.png' },
                    ];
                    const publicSprite = PUBLIC_SPRITES.find(s => s.name.toLowerCase() === prompt.toLowerCase());

                    if (publicSprite) {
                        // Load public sprite
                        setDialogueText(`Loading public sprite: ${publicSprite.name}...`);
                        setModeState(prev => ({
                            ...prev,
                            isCharacterEnabled: true,
                            characterSprite: {
                                walkSheet: publicSprite.walkPath,
                                idleSheet: publicSprite.idlePath,
                                name: publicSprite.name,
                            },
                        }));
                        setDialogueText(`Now playing as: ${publicSprite.name}`);
                        clearCommandState();
                        return null;
                    }
                }
            } // End of !--re block

            // Generate sprite if we have a prompt
            if (prompt) {
                // Helper to add log entry
                const addLog = (msg: string) => {
                    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
                    setModeState(prev => ({
                        ...prev,
                        spriteDebugLog: [...(prev.spriteDebugLog || []), `[${timestamp}] ${msg}`]
                    }));
                };

                // Require user to be logged in
                if (!userUid) {
                    setDialogueWithRevert("Sign in required to generate sprites. Use /signin", setDialogueText);
                    clearCommandState();
                    return null;
                }

                // Generate new sprite from prompt using polling
                setModeState(prev => {
                    return { ...prev, isGeneratingSprite: true, spriteDebugLog: [], spriteProgress: 0 };
                });
                setDialogueText(`Generating "${prompt}"...`);
                addLog(`Starting generation: "${prompt}"`);

                // Generate sprite ID and name
                const spriteId = `sprite_${Date.now()}`;
                const spriteName = customName || prompt.replace(/[^a-z0-9]/gi, '_').toLowerCase();

                // Create placeholder files in Storage immediately
                if (userUid) {
                    addLog(`Creating Storage folder: ${spriteId}`);
                    try {
                        const { ref: storageRef, uploadString, uploadBytes } = await import('firebase/storage');
                        const { storage } = await import('@/app/firebase');

                        // Create placeholder files to establish the folder structure
                        const placeholderData = 'data:text/plain;base64,Z2VuZXJhdGluZy4uLg=='; // "generating..."
                        const walkRef = storageRef(storage, `sprites/${userUid}/${spriteId}/walk.png`);
                        const idleRef = storageRef(storage, `sprites/${userUid}/${spriteId}/idle.png`);
                        const metadataRef = storageRef(storage, `sprites/${userUid}/${spriteId}/metadata.json`);

                        // Create metadata.json with sprite info
                        const metadata = {
                            id: spriteId,
                            name: spriteName,
                            description: prompt,
                            status: 'generating',
                            createdAt: new Date().toISOString(),
                        };
                        const metadataBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });

                        await Promise.all([
                            uploadString(walkRef, placeholderData, 'data_url'),
                            uploadString(idleRef, placeholderData, 'data_url'),
                            uploadBytes(metadataRef, metadataBlob),
                        ]);
                        addLog(`Storage folder created with metadata!`);
                    } catch (error) {
                        const errorMsg = error instanceof Error ? error.message : String(error);
                        addLog(`Warning: Failed to create Storage folder - ${errorMsg}`);
                        console.error('[/be] Storage folder creation failed:', error);
                    }
                }

                const spriteApiUrl = process.env.NEXT_PUBLIC_SPRITE_API_URL ||
                    'https://us-central1-nara-a65bc.cloudfunctions.net/generateSprite';

                // Start the job (send userUid and spriteId for correct Storage path)
                fetch(spriteApiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ description: prompt, userUid, spriteId }),
                })
                    .then(res => {
                        addLog(`POST status: ${res.status}`);
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        return res.json();
                    })
                    .then(async data => {
                        if (data.error) {
                            throw new Error(data.error);
                        }

                        const jobId = data.jobId;
                        addLog(`Job started: ${jobId}`);

                        // Poll for status (V2 API: rotationsReady + storagePaths)
                        const pollInterval = 3000; // 3 seconds
                        const maxPolls = 200; // 10 minutes max
                        let polls = 0;
                        let cursorSet = false;
                        let staticSheet: string | null = null;

                        const poll = async (): Promise<any> => {
                            polls++;
                            if (polls > maxPolls) {
                                throw new Error('Generation timed out');
                            }

                            const statusRes = await fetch(`${spriteApiUrl}?jobId=${jobId}`);
                            if (!statusRes.ok) throw new Error(`Poll failed: ${statusRes.status}`);
                            const status = await statusRes.json();

                            // V2 API uses currentPhase instead of currentDirection
                            const phase = status.currentPhase || status.currentDirection || '';
                            addLog(`[${polls}] ${status.status} ${status.progress || 0}/${status.total || 8} ${phase}`);
                            setModeState(prev => ({ ...prev, spriteProgress: status.progress || 0 }));

                            // Show retry info in debug if present
                            if (status.lastRetry) {
                                const retry = status.lastRetry;
                                addLog(`  ↳ ${retry.type}: ${retry.message} (${retry.attempt}/${retry.maxAttempts})`);
                            }

                            // V2 API: When rotations are ready, create spritesheet and set cursor
                            if (status.rotationsReady && status.storagePaths && !cursorSet) {
                                addLog(`Rotations ready! Creating spritesheet...`);
                                setDialogueText(`Loading character...`);

                                try {
                                    // Create spritesheet from Storage URLs
                                    staticSheet = await compositeSpriteSheetFromUrls(
                                        status.storagePaths,
                                        IDLE_FRAME_SIZE,
                                        IDLE_FRAMES_PER_DIR
                                    );

                                    // Set cursor immediately with static sprite
                                    setModeState(prev => ({
                                        ...prev,
                                        isCharacterEnabled: true,
                                        characterSprite: {
                                            walkSheet: staticSheet!,
                                            idleSheet: staticSheet!,
                                            name: spriteName,
                                        },
                                    }));

                                    cursorSet = true;
                                    addLog(`Cursor set to ${spriteName}!`);
                                    setDialogueText(`Playing as: ${spriteName} (static)`);
                                } catch (err) {
                                    const errMsg = err instanceof Error ? err.message : String(err);
                                    addLog(`Warning: Failed to create spritesheet - ${errMsg}`);
                                }
                            }

                            if (status.status === 'complete') {
                                return { ...status, _staticSheet: staticSheet };
                            } else if (status.status === 'error') {
                                throw new Error(status.error || 'Generation failed');
                            } else {
                                // Update dialogue with progress
                                const cursorStatus = cursorSet ? ' ✓' : '';
                                setDialogueText(`Generating "${prompt}"... (${phase})${cursorStatus}`);
                                await new Promise(r => setTimeout(r, pollInterval));
                                return poll();
                            }
                        };

                        return poll();
                    })
                    .then(async data => {
                        // V2 API: rotationsReady + storagePaths (static rotations)
                        if (data.rotationsReady && data.storagePaths) {
                            addLog(`Generation complete!`);

                            // Use the static sheet we already created during polling
                            let staticSheet = data._staticSheet;
                            if (!staticSheet) {
                                addLog(`Creating spritesheet from storagePaths...`);
                                staticSheet = await compositeSpriteSheetFromUrls(
                                    data.storagePaths,
                                    IDLE_FRAME_SIZE,
                                    IDLE_FRAMES_PER_DIR
                                );
                            }

                            addLog(`Success! Character: ${spriteName}`);

                            // Save sprite info for user
                            if (userUid) {
                                addLog(`Saving sprite metadata...`);
                                setDialogueText(`Saving sprite...`);

                                try {
                                    const { ref: storageRef, uploadBytes, uploadString } = await import('firebase/storage');
                                    const { storage } = await import('@/app/firebase');

                                    // Save the composited static sheet as idle.png only
                                    // walk.png will be created by animation
                                    const idleRef = storageRef(storage, `sprites/${userUid}/${spriteId}/idle.png`);
                                    await uploadString(idleRef, staticSheet, 'data_url');

                                    // Update metadata.json with characterId for animation
                                    const metadata = {
                                        id: spriteId,
                                        name: spriteName,
                                        description: prompt,
                                        status: 'complete',
                                        characterId: data.characterId, // V2 character ID for animations
                                        createdAt: new Date().toISOString(),
                                    };
                                    const metadataRef = storageRef(storage, `sprites/${userUid}/${spriteId}/metadata.json`);
                                    const metadataBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
                                    await uploadBytes(metadataRef, metadataBlob);

                                    addLog(`Idle sprite saved!`);

                                    // Add to local sprites list (no walkUrl yet)
                                    const { getDownloadURL } = await import('firebase/storage');
                                    const finalIdleUrl = await getDownloadURL(idleRef);

                                    setUserSprites(prev => [{
                                        id: spriteId,
                                        name: spriteName,
                                        description: prompt,
                                        walkUrl: '', // Will be set after animation
                                        idleUrl: finalIdleUrl,
                                        createdAt: metadata.createdAt,
                                    }, ...prev]);

                                    // Automatically start animation
                                    addLog(`Starting walk animation...`);
                                    setDialogueText(`Generating walk animation...`);

                                    const animResponse = await fetch(
                                        'https://us-central1-nara-a65bc.cloudfunctions.net/animateSprite',
                                        {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                                characterId: data.characterId,
                                                userUid,
                                                spriteId,
                                            }),
                                        }
                                    );

                                    if (!animResponse.ok) {
                                        addLog(`Animation request failed, use --animate later`);
                                    } else {
                                        const { jobId: animJobId } = await animResponse.json();
                                        addLog(`Animation job: ${animJobId.slice(0, 8)}...`);

                                        // Poll for animation completion
                                        let animPolls = 0;
                                        const maxAnimPolls = 120;
                                        const animPollInterval = 3000;

                                        const animPoll = async (): Promise<any> => {
                                            animPolls++;
                                            const statusRes = await fetch(
                                                `https://us-central1-nara-a65bc.cloudfunctions.net/animateSprite?jobId=${animJobId}`
                                            );
                                            const status = await statusRes.json();
                                            const phase = status.currentPhase || 'processing';
                                            addLog(`[${animPolls}] ${status.status} - ${phase}`);

                                            if (status.status === 'complete') {
                                                return status;
                                            } else if (status.status === 'partial') {
                                                // Partial success - some directions completed
                                                const completed = status.completedDirections?.length || 0;
                                                const total = status.totalDirections || 8;
                                                addLog(`PARTIAL: ${completed}/${total} directions`);
                                                if (status.missingDirections?.length > 0) {
                                                    addLog(`Missing: ${status.missingDirections.join(', ')}`);
                                                    addLog(`Use --animate-continue to retry`);
                                                }
                                                return status;
                                            } else if (status.status === 'error') {
                                                throw new Error(status.error || 'Animation failed');
                                            } else if (animPolls >= maxAnimPolls) {
                                                throw new Error('Animation timed out');
                                            }

                                            setDialogueText(`Animating ${spriteName}... (${phase})`);
                                            await new Promise(r => setTimeout(r, animPollInterval));
                                            return animPoll();
                                        };

                                        try {
                                            const animResult = await animPoll();
                                            addLog(`Animation complete!`);

                                            // Composite animation frames
                                            const framePaths = animResult.framePaths as Record<string, string[]>;
                                            const FRAME_W = 32, FRAME_H = 40, FRAMES = 8;
                                            const walkCanvas = document.createElement('canvas');
                                            walkCanvas.width = FRAME_W * FRAMES;
                                            walkCanvas.height = FRAME_H * SPRITE_DIRECTIONS.length;
                                            const walkCtx = walkCanvas.getContext('2d')!;

                                            for (let row = 0; row < SPRITE_DIRECTIONS.length; row++) {
                                                const dir = SPRITE_DIRECTIONS[row];
                                                const frames = framePaths[dir];
                                                if (!frames) continue;
                                                for (let col = 0; col < frames.length && col < FRAMES; col++) {
                                                    try {
                                                        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                                                            const image = new Image();
                                                            image.crossOrigin = 'anonymous';
                                                            image.onload = () => resolve(image);
                                                            image.onerror = reject;
                                                            image.src = frames[col];
                                                        });
                                                        const scale = Math.min(FRAME_W / img.width, FRAME_H / img.height);
                                                        const w = img.width * scale, h = img.height * scale;
                                                        const x = col * FRAME_W + (FRAME_W - w) / 2;
                                                        const y = row * FRAME_H + (FRAME_H - h);
                                                        walkCtx.drawImage(img, x, y, w, h);
                                                    } catch { /* skip frame */ }
                                                }
                                            }

                                            const walkSheet = walkCanvas.toDataURL('image/png');
                                            const walkRef = storageRef(storage, `sprites/${userUid}/${spriteId}/walk.png`);
                                            await uploadString(walkRef, walkSheet, 'data_url');
                                            addLog(`Walk sheet saved!`);

                                            // Update cursor with animated walk
                                            setModeState(prev => ({
                                                ...prev,
                                                characterSprite: {
                                                    walkSheet,
                                                    idleSheet: staticSheet,
                                                    name: spriteName,
                                                },
                                            }));
                                        } catch (animErr) {
                                            addLog(`Animation failed: ${animErr}`);
                                        }
                                    }
                                } catch (err) {
                                    const errMsg = err instanceof Error ? err.message : String(err);
                                    addLog(`Warning: Failed to save sprite - ${errMsg}`);
                                }
                            }

                            setModeState(prev => ({
                                ...prev,
                                isGeneratingSprite: false,
                                spriteProgress: 0,
                                isCharacterEnabled: true,
                                characterSprite: {
                                    walkSheet: staticSheet, // Initial static, updated if animation succeeds
                                    idleSheet: staticSheet,
                                    name: spriteName,
                                },
                            }));
                            setDialogueText(`Now playing as: ${spriteName}`);
                        } else if (data.walkUrl && data.idleUrl) {
                            // Legacy V1 flow: server returns walkUrl + idleUrl
                            addLog(`Downloading walk spritesheet...`);
                            setDialogueText(`Downloading sprites...`);

                            const walkResponse = await fetch(data.walkUrl);
                            const walkBlob = await walkResponse.blob();
                            const walkReader = new FileReader();
                            const walkSheet = await new Promise<string>((resolve) => {
                                walkReader.onloadend = () => resolve(walkReader.result as string);
                                walkReader.readAsDataURL(walkBlob);
                            });

                            const idleResponse = await fetch(data.idleUrl);
                            const idleBlob = await idleResponse.blob();
                            const idleReader = new FileReader();
                            const idleSheet = await new Promise<string>((resolve) => {
                                idleReader.onloadend = () => resolve(idleReader.result as string);
                                idleReader.readAsDataURL(idleBlob);
                            });

                            addLog(`Success! Animated sprite: ${spriteName}`);

                            if (userUid) {
                                try {
                                    const { ref: storageRef, uploadBytes } = await import('firebase/storage');
                                    const { storage } = await import('@/app/firebase');

                                    const walkRef = storageRef(storage, `sprites/${userUid}/${spriteId}/walk.png`);
                                    await uploadBytes(walkRef, walkBlob, { contentType: 'image/png' });

                                    const idleRef = storageRef(storage, `sprites/${userUid}/${spriteId}/idle.png`);
                                    await uploadBytes(idleRef, idleBlob, { contentType: 'image/png' });

                                    const metadata = {
                                        id: spriteId,
                                        name: spriteName,
                                        description: prompt,
                                        status: 'complete',
                                        createdAt: new Date().toISOString(),
                                    };
                                    const metadataRef = storageRef(storage, `sprites/${userUid}/${spriteId}/metadata.json`);
                                    const metadataBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
                                    await uploadBytes(metadataRef, metadataBlob);

                                    const { getDownloadURL } = await import('firebase/storage');
                                    const [finalWalkUrl, finalIdleUrl] = await Promise.all([
                                        getDownloadURL(walkRef),
                                        getDownloadURL(idleRef),
                                    ]);

                                    setUserSprites(prev => [{
                                        id: spriteId,
                                        name: spriteName,
                                        description: prompt,
                                        walkUrl: finalWalkUrl,
                                        idleUrl: finalIdleUrl,
                                        createdAt: metadata.createdAt,
                                    }, ...prev]);
                                } catch (err) {
                                    addLog(`Warning: Failed to save - ${err}`);
                                }
                            }

                            setModeState(prev => ({
                                ...prev,
                                isGeneratingSprite: false,
                                spriteProgress: 0,
                                isCharacterEnabled: true,
                                characterSprite: {
                                    walkSheet,
                                    idleSheet,
                                    name: spriteName,
                                },
                            }));
                            setDialogueText(`Now playing as: ${spriteName}`);
                        } else if (data.images) {
                            // Legacy format - static images
                            addLog(`Compositing sprite sheets...`);
                            setDialogueText(`Compositing sprite sheets...`);

                            const [walkSheet, idleSheet] = await Promise.all([
                                compositeSpriteSheet(data.images, WALK_FRAME_SIZE, WALK_FRAMES_PER_DIR),
                                compositeSpriteSheet(data.images, IDLE_FRAME_SIZE, IDLE_FRAMES_PER_DIR),
                            ]);

                            addLog(`Success! Sprite: ${spriteName}`);

                            // Save to Firebase if user is logged in
                            if (userUid) {
                                addLog(`Updating sprite in Firestore...`);
                                setDialogueText(`Saving sprite...`);
                                const saveResult = await saveSprite(userUid, spriteName, prompt, walkSheet, idleSheet, spriteId);
                                if (saveResult.success && saveResult.sprite) {
                                    addLog(`Sprite saved!`);
                                    // Update local sprites list
                                    setUserSprites(prev => [saveResult.sprite!, ...prev]);
                                } else {
                                    addLog(`Warning: Failed to save sprite - ${saveResult.error}`);
                                }
                            }

                            setModeState(prev => ({
                                ...prev,
                                isGeneratingSprite: false,
                                spriteProgress: 0,
                                isCharacterEnabled: true,
                                characterSprite: {
                                    walkSheet,
                                    idleSheet,
                                    name: spriteName,
                                },
                            }));
                            setDialogueText(`Now playing as: ${spriteName}`);
                        }
                    })
                    .catch(err => {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        addLog(`Error: ${errMsg}`);
                        console.error('Sprite generation failed:', err);
                        setDialogueText(`Sprite generation failed: ${errMsg}`);
                        setModeState(prev => ({ ...prev, isGeneratingSprite: false, spriteProgress: 0 }));
                    });

                clearCommandState();
                return null;
            } else {
                // No prompt - toggle character mode with default ghost sprite
                if (modeState.isCharacterEnabled) {
                    // Turn off character mode
                    setModeState(prev => ({
                        ...prev,
                        isCharacterEnabled: false,
                        characterSprite: undefined,
                    }));
                    setDialogueWithRevert("Character cursor disabled", setDialogueText);
                } else {
                    // Turn on with default sprite + ghost effect using textColor
                    // Uses a clean sprite optimized for ghost silhouette
                    const DEFAULT_SPRITE = {
                        walkPath: '/sprites/default_walk.png',
                        idlePath: '/sprites/default_idle.png',
                    };

                    setDialogueText("Loading ghost cursor...");

                    // Apply ghost effect to sprite sheets using current textColor
                    (async () => {
                        try {
                            const ghostColor = modeState.textColor || '#FFFFFF';
                            const [walkSheet, idleSheet] = await Promise.all([
                                applySkin(DEFAULT_SPRITE.walkPath, 'ghost', { color: ghostColor }),
                                applySkin(DEFAULT_SPRITE.idlePath, 'ghost', { color: ghostColor })
                            ]);

                            setModeState(prev => ({
                                ...prev,
                                isCharacterEnabled: true,
                                characterSprite: {
                                    walkSheet,
                                    idleSheet,
                                    name: 'default',
                                    ghostMode: true, // Reactive to textColor changes
                                    baseWalkPath: DEFAULT_SPRITE.walkPath,
                                    baseIdlePath: DEFAULT_SPRITE.idlePath,
                                },
                            }));
                            setDialogueWithRevert("Ghost cursor enabled (matches text color)", setDialogueText);
                        } catch (err) {
                            console.error('Failed to load ghost sprite:', err);
                            // Fallback to raw sprite without ghost effect
                            setModeState(prev => ({
                                ...prev,
                                isCharacterEnabled: true,
                                characterSprite: {
                                    walkSheet: DEFAULT_SPRITE.walkPath,
                                    idleSheet: DEFAULT_SPRITE.idlePath,
                                    name: 'default',
                                },
                            }));
                            setDialogueWithRevert("Character cursor enabled", setDialogueText);
                        }
                    })();
                }

                clearCommandState();
                return null;
            }
        }

        if (commandToExecute.startsWith('signin')) {
            return executeSimpleCommand('signin');
        }

        if (commandToExecute.startsWith('signout')) {
            return executeSimpleCommand('signout');
        }

        if (commandToExecute.startsWith('mail')) {
            // /mail command - create mail region from selection
            // Check if user has 'super' membership
            if (membershipLevel !== 'super') {
                setDialogueWithRevert("Mail command requires Super membership", setDialogueText);
                clearCommandState();
                return null;
            }

            createRegionFromSelection('mail', {
                successMessage: (dims) => `Mail region created (${dims.width}×${dims.height}). Row 1: To, Row 2: Subject, Row 3+: Message`,
                pendingMessage: "Make a selection, then press Enter to create mail region",
                additionalWorldDataCallback: (mailKey, selection, worldData) => {
                    // Create send button bound to this mail region (bottom-right corner)
                    const sendButton = {
                        mailKey: mailKey,
                        x: selection.endX,
                        y: selection.endY,
                        text: 'Send',
                        timestamp: Date.now()
                    };
                    const buttonKey = `mailbutton_${mailKey}`;
                    worldData[buttonKey] = JSON.stringify(sendButton);
                    return worldData;
                }
            });

            // Clear command mode
            clearCommandState();

            // Return special flag to indicate cursor should be restored
            return {
                command: 'mail',
                args: [],
                commandStartPos: commandState.commandStartPos,
                restoreCursor: true
            } as CommandExecution & { restoreCursor?: boolean };
        }

        if (commandToExecute.startsWith('note')) {
            // /note command - one-shot note region creation from selection
            // Parse arguments: /note temp creates ephemeral notes with dashed borders
            //                  /note #RRGGBB or /note #RRGGBBAA sets background color
            const args = inputParts.slice(1);
            const isTemp = args.includes('temp');

            // Check if first arg is a color (starts with #)
            const colorArg = args.find(arg => arg.startsWith('#'));

            if (colorArg && worldData && setWorldData) {
                // Setting background color on existing note at cursor
                const cursorPos = commandState.commandStartPos;
                const noteKeys = Object.keys(worldData).filter(k => k.startsWith('note_'));
                let foundNote = null;
                let foundKey = null;

                for (const key of noteKeys) {
                    try {
                        const noteData = JSON.parse(worldData[key] as string);
                        if (cursorPos.x >= noteData.startX && cursorPos.x <= noteData.endX &&
                            cursorPos.y >= noteData.startY && cursorPos.y <= noteData.endY) {
                            foundNote = noteData;
                            foundKey = key;
                            break;
                        }
                    } catch (e) {
                        // Skip invalid note data
                    }
                }

                if (foundNote && foundKey) {
                    // Validate color format (6 or 8 hex chars after #)
                    const hexColor = colorArg.replace('#', '');
                    if (/^[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(hexColor)) {
                        const updatedNote = {
                            ...foundNote,
                            backgroundColor: colorArg.toUpperCase()
                        };
                        setWorldData({
                            ...worldData,
                            [foundKey]: JSON.stringify(updatedNote)
                        });
                        setDialogueText?.(`Note background set to ${colorArg}`);
                    } else {
                        setDialogueText?.("Invalid color format. Use #RRGGBB or #RRGGBBAA");
                    }

                    clearCommandState();
                    return {
                        command: 'note',
                        args: args,
                        commandStartPos: commandState.commandStartPos,
                        restoreCursor: true
                    } as CommandExecution & { restoreCursor?: boolean };
                } else {
                    setDialogueText?.("Not inside a note region");
                    clearCommandState();
                    return {
                        command: 'note',
                        args: args,
                        commandStartPos: commandState.commandStartPos,
                        restoreCursor: true
                    } as CommandExecution & { restoreCursor?: boolean };
                }
            }

            createRegionFromSelection('note', {
                successMessage: (dims) => isTemp
                    ? `Ephemeral note created (${dims.width}×${dims.height})`
                    : `Note region saved (${dims.width}×${dims.height})`,
                pendingMessage: isTemp
                    ? "Make a selection, then press Enter to save as ephemeral note"
                    : "Make a selection, then press Enter to save as note region",
                additionalData: isTemp ? { style: 'ephemeral' } : {}
            });

            // Clear command mode
            clearCommandState();

            // Return special flag to indicate cursor should be restored
            return {
                command: 'note',
                args: args,
                commandStartPos: commandState.commandStartPos,
                restoreCursor: true
            } as CommandExecution & { restoreCursor?: boolean };
        }

        if (commandToExecute.startsWith('display')) {
            // /display command - toggle note display mode (expand vs scroll vs wrap vs paint)
            // Must be used inside a note region
            const args = inputParts.slice(1);
            const mode = args[0] as 'expand' | 'scroll' | 'wrap' | 'paint' | undefined;
            const cursorPos = commandState.commandStartPos;

            if (!worldData || !setWorldData) {
                clearCommandState();
                return { command: 'display', args: [], commandStartPos: commandState.commandStartPos };
            }

            // Find note at cursor position
            const noteKeys = Object.keys(worldData).filter(k => k.startsWith('note_'));
            let foundNote = null;
            let foundKey = null;

            for (const key of noteKeys) {
                try {
                    const noteData = JSON.parse(worldData[key] as string);
                    if (cursorPos.x >= noteData.startX && cursorPos.x <= noteData.endX &&
                        cursorPos.y >= noteData.startY && cursorPos.y <= noteData.endY) {
                        foundNote = noteData;
                        foundKey = key;
                        break;
                    }
                } catch (e) {
                    // Skip invalid note data
                }
            }

            if (!foundNote || !foundKey) {
                setDialogueText?.("Not inside a note region");
                clearCommandState();
                return { command: 'display', args: [], commandStartPos: commandState.commandStartPos };
            }

            // Toggle or set display mode
            let newMode: 'expand' | 'scroll' | 'wrap' | 'paint';
            const currentMode = foundNote.displayMode || 'expand';

            if (mode === 'expand' || mode === 'scroll' || mode === 'wrap' || mode === 'paint') {
                // If user specifies wrap mode while already in wrap, toggle it off
                if (mode === 'wrap' && currentMode === 'wrap') {
                    newMode = 'expand'; // Exit wrap mode back to expand
                } else {
                    newMode = mode;
                }
            } else {
                // Cycle through modes: expand -> scroll -> wrap -> paint -> expand
                if (currentMode === 'expand') {
                    newMode = 'scroll';
                } else if (currentMode === 'scroll') {
                    newMode = 'wrap';
                } else if (currentMode === 'wrap') {
                    newMode = 'paint';
                } else {
                    newMode = 'expand';
                }
            }

            // Update note with new display mode
            let updatedNote = {
                ...foundNote,
                displayMode: newMode
            };

            // Rewrap text when entering wrap mode
            if (newMode === 'wrap') {
                // Pass worldData to enable paint-aware wrapping if paint exists
                updatedNote = rewrapNoteText(updatedNote, worldData);
            }

            setWorldData({
                ...worldData,
                [foundKey]: JSON.stringify(updatedNote)
            });

            // Auto-detect painted region when entering paint mode
            let message = `Display mode: ${newMode}`;
            if (newMode === 'paint') {
                // Check if there are paint cells within note bounds
                let paintCellCount = 0;
                for (let y = foundNote.startY; y <= foundNote.endY && paintCellCount < 10; y++) {
                    for (let x = foundNote.startX; x <= foundNote.endX && paintCellCount < 10; x++) {
                        const paintKey = `paint_${x}_${y}`;
                        if (worldData[paintKey]) {
                            paintCellCount++;
                        }
                    }
                }

                if (paintCellCount > 0) {
                    message = `Paint mode: ${paintCellCount}+ cells detected`;
                } else {
                    message = `Paint mode: no paint detected (draw to create viewport)`;
                }
            } else if (newMode === 'wrap') {
                // Check if paint exists for paint-aware wrapping
                let hasPaint = false;
                for (let y = foundNote.startY; y <= foundNote.endY && !hasPaint; y++) {
                    for (let x = foundNote.startX; x <= foundNote.endX && !hasPaint; x++) {
                        const paintKey = `paint_${x}_${y}`;
                        if (worldData[paintKey]) {
                            hasPaint = true;
                        }
                    }
                }
                if (hasPaint) {
                    message = `Wrap mode: paint-aware (text wraps to paint boundaries)`;
                }
            }

            setDialogueText?.(message);
            clearCommandState();

            return {
                command: 'display',
                args: [newMode],
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('view')) {
            // /view command - show note as fullscreen overlay
            const cursorPos = commandState.commandStartPos;

            // If already viewing, exit
            if (modeState.viewOverlay) {
                setModeState(prev => ({ ...prev, viewOverlay: undefined }));
                setDialogueText?.("Exited view mode");
                clearCommandState();
                return null;
            }

            // Find note at cursor position
            for (const key in worldData) {
                if (key.startsWith('note_')) {
                    try {
                        const noteData = JSON.parse(worldData[key] as string);
                        const { startX, endX, startY, endY } = noteData;

                        // Check if cursor is within note bounds
                        if (cursorPos.x >= startX && cursorPos.x <= endX &&
                            cursorPos.y >= startY && cursorPos.y <= endY) {

                            // Extract text content from note
                            const noteContent = noteData.data || {};
                            const lines: string[] = [];

                            // Find all text in the note region
                            let minY = Infinity, maxY = -Infinity;
                            for (const cellKey in noteContent) {
                                const [, yStr] = cellKey.split(',');
                                const y = parseInt(yStr, 10);
                                if (!isNaN(y)) {
                                    minY = Math.min(minY, y);
                                    maxY = Math.max(maxY, y);
                                }
                            }

                            // Extract lines
                            for (let y = minY; y <= maxY; y++) {
                                let line = '';
                                for (let x = startX; x <= endX; x++) {
                                    const cellKey = `${x},${y}`;
                                    const cellData = noteContent[cellKey];
                                    if (cellData) {
                                        const char = typeof cellData === 'string' ? cellData : cellData.char || ' ';
                                        line += char;
                                    } else {
                                        line += ' ';
                                    }
                                }
                                lines.push(line.trimEnd());
                            }

                            // Join lines and calculate wrapped content
                            const rawContent = lines.join('\n').trim();

                            // Set view overlay state
                            setModeState(prev => ({
                                ...prev,
                                viewOverlay: {
                                    noteKey: key,
                                    content: rawContent,
                                    scrollOffset: 0,
                                    maxScroll: 0 // Will be calculated during render
                                }
                            }));

                            setDialogueText?.("View mode - press Esc to exit");
                            clearCommandState();
                            return null;
                        }
                    } catch (e) {
                        // Skip invalid note data
                    }
                }
            }

            setDialogueText?.("Position cursor inside a note first");
            clearCommandState();
            return null;
        }

        // /bound command - toggle bounded canvas overlay
        if (commandToExecute.startsWith('bound')) {
            const { arg1, arg2 } = parseCurrentInput();
            const cursorPos = commandState.commandStartPos;

            // Helper to apply bounds with auto-zoom
            // sourceInfo: { type, noteKey?, originalBounds } for syncing edits back
            const applyBoundsWithZoom = (
                minX: number, minY: number, maxX: number, maxY: number,
                width: number, height: number,
                boundedData: Record<string, any> = {},
                source: string,
                sourceInfo?: { type: 'note' | 'selection' | 'empty'; noteKey?: string; originalBounds: { minX: number; minY: number; maxX: number; maxY: number } }
            ) => {
                if (setBounds) {
                    setBounds({ minX, minY, maxX, maxY });
                }

                // Auto-zoom to fit bounded region in viewport
                if (setZoomLevel && setViewOffset) {
                    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 800;
                    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 600;

                    const baseCharDims = getEffectiveCharDims(1.0);
                    const cellsWideAtZoom1 = viewportWidth / baseCharDims.width;
                    const cellsHighAtZoom1 = viewportHeight / baseCharDims.height;

                    const targetFill = 0.8;
                    const zoomForWidth = (cellsWideAtZoom1 * targetFill) / width;
                    const zoomForHeight = (cellsHighAtZoom1 * targetFill) / height;
                    const targetZoom = Math.min(zoomForWidth, zoomForHeight);
                    const clampedZoom = Math.max(0.5, Math.min(3.0, targetZoom));

                    // Only auto-zoom if bounded region is small
                    if (clampedZoom > zoomLevel) {
                        setZoomLevel(clampedZoom);

                        const centerX = minX + width / 2;
                        const centerY = minY + height / 2;
                        const charDims = getEffectiveCharDims(clampedZoom);
                        const offsetX = centerX - (viewportWidth / charDims.width) / 2;
                        const offsetY = centerY - (viewportHeight / charDims.height) / 2;
                        setViewOffset({ x: offsetX, y: offsetY });
                    }
                }

                if (setCanvasState) setCanvasState(1);
                if (setBoundedWorldData) setBoundedWorldData(boundedData);

                // Track source for syncing edits back when exiting bounded mode
                if (setBoundedSource) {
                    if (sourceInfo) {
                        setBoundedSource({
                            ...sourceInfo,
                            boundedMinX: minX,
                            boundedMinY: minY
                        });
                    } else {
                        setBoundedSource({ type: 'empty', originalBounds: { minX, minY, maxX, maxY }, boundedMinX: minX, boundedMinY: minY });
                    }
                }

                const cellCount = width * height;
                const cellCountStr = cellCount >= 1000000
                    ? `${(cellCount / 1000000).toFixed(1)}M`
                    : cellCount >= 1000
                        ? `${(cellCount / 1000).toFixed(1)}K`
                        : `${cellCount}`;

                setDialogueWithRevert(`Bounded ${source}: ${width}×${height} (${cellCountStr} cells). /bound to exit.`, setDialogueText);
                clearCommandState();
            };

            // No args: toggle off if bounded, or check for selection/note, or default to 100x100
            if (!arg1 && !arg2) {
                if (canvasState === 1) {
                    // Already bounded - toggle off (return to infinite)
                    // Sync edits back to source based on type
                    if (boundedSource && boundedWorldData && worldData && setWorldData) {
                        const { type, noteKey, originalBounds, boundedMinX, boundedMinY } = boundedSource;

                        if (type === 'note' && noteKey) {
                            // Sync back to note - rewrap content to fit original note dimensions
                            const noteValue = worldData[noteKey];
                            if (noteValue && typeof noteValue === 'string') {
                                try {
                                    const noteData = JSON.parse(noteValue);
                                    const origWidth = originalBounds.maxX - originalBounds.minX;

                                    // Rewrap boundedWorldData to fit original note dimensions
                                    const rewrappedNote = rewrapNoteText({
                                        ...noteData,
                                        startX: 0,
                                        endX: origWidth,
                                        startY: 0,
                                        endY: originalBounds.maxY - originalBounds.minY,
                                        data: (() => {
                                            // Convert bounded coords to relative coords first
                                            const tempData: Record<string, any> = {};
                                            for (const coordKey in boundedWorldData) {
                                                const [xStr, yStr] = coordKey.split(',');
                                                const absX = parseInt(xStr, 10);
                                                const absY = parseInt(yStr, 10);
                                                const relX = absX - boundedMinX;
                                                const relY = absY - boundedMinY;
                                                if (relX >= 0 && relY >= 0) {
                                                    tempData[`${relX},${relY}`] = boundedWorldData[coordKey];
                                                }
                                            }
                                            return tempData;
                                        })()
                                    });

                                    // Update note data with rewrapped content
                                    noteData.data = rewrappedNote.data || {};
                                    const newWorldData = { ...worldData };
                                    newWorldData[noteKey] = JSON.stringify(noteData);
                                    setWorldData(newWorldData);
                                    setDialogueWithRevert("Canvas unbounded - note changes saved", setDialogueText);
                                } catch (e) {
                                    setDialogueWithRevert("Canvas unbounded - failed to save note changes", setDialogueText);
                                }
                            }
                        } else if (type === 'selection') {
                            // Sync back to selection - rewrap and write as individual characters
                            const origWidth = originalBounds.maxX - originalBounds.minX + 1;

                            // Rewrap to fit original selection dimensions
                            const rewrappedData = rewrapNoteText({
                                startX: 0,
                                endX: origWidth,
                                startY: 0,
                                endY: originalBounds.maxY - originalBounds.minY + 1,
                                data: (() => {
                                    const tempData: Record<string, any> = {};
                                    for (const coordKey in boundedWorldData) {
                                        const [xStr, yStr] = coordKey.split(',');
                                        const absX = parseInt(xStr, 10);
                                        const absY = parseInt(yStr, 10);
                                        const relX = absX - boundedMinX;
                                        const relY = absY - boundedMinY;
                                        if (relX >= 0 && relY >= 0) {
                                            tempData[`${relX},${relY}`] = boundedWorldData[coordKey];
                                        }
                                    }
                                    return tempData;
                                })()
                            });

                            // Write rewrapped data back to worldData at original selection position
                            const newWorldData = { ...worldData };
                            if (rewrappedData.data) {
                                for (const coordKey in rewrappedData.data) {
                                    const [xStr, yStr] = coordKey.split(',');
                                    const relX = parseInt(xStr, 10);
                                    const relY = parseInt(yStr, 10);
                                    const absKey = `${originalBounds.minX + relX},${originalBounds.minY + relY}`;
                                    newWorldData[absKey] = rewrappedData.data[coordKey];
                                }
                            }
                            setWorldData(newWorldData);
                            setDialogueWithRevert("Canvas unbounded - selection changes saved", setDialogueText);
                        } else {
                            setDialogueWithRevert("Canvas unbounded - infinite space restored", setDialogueText);
                        }
                    } else {
                        setDialogueWithRevert("Canvas unbounded - infinite space restored", setDialogueText);
                    }

                    if (setBounds) setBounds(undefined);
                    if (setCanvasState) setCanvasState(0);
                    if (setBoundedSource) setBoundedSource(null);
                    if (setBoundedWorldData) setBoundedWorldData({});
                    clearCommandState();
                    return null;
                }

                // Check if there's an active selection - use selection bounds
                // Skip if it's just the default cursor (1x2) - not a real selection
                if (selectionStart && selectionEnd) {
                    const startX = Math.min(selectionStart.x, selectionEnd.x);
                    const endX = Math.max(selectionStart.x, selectionEnd.x);
                    const startY = Math.min(selectionStart.y, selectionEnd.y);
                    const endY = Math.max(selectionStart.y, selectionEnd.y);

                    // Visual bounds (startY - 1 for GRID_CELL_SPAN)
                    const width = endX - startX + 1;
                    const height = endY - startY + 1;

                    // Skip default cursor (1x2) - only bound from actual selection
                    const isActualSelection = width > 1 || (endY - startY) > 0;

                    if (isActualSelection) {
                        // Capture world data within selection as bounded data
                        const boundedData: Record<string, any> = {};
                        for (let y = startY; y <= endY; y++) {
                            for (let x = startX; x <= endX; x++) {
                                const key = `${x},${y}`;
                                if (worldData && worldData[key]) {
                                    boundedData[key] = worldData[key];
                                }
                            }
                        }

                        // Clear selection after bounding
                        if (setSelectionStart) setSelectionStart(null);
                        if (setSelectionEnd) setSelectionEnd(null);

                        applyBoundsWithZoom(
                            startX, startY, endX + 1, endY + 1,
                            width, height, boundedData, 'from selection',
                            { type: 'selection', originalBounds: { minX: startX, minY: startY, maxX: endX, maxY: endY } }
                        );
                        return null;
                    }
                }

                // Check if cursor is over a note - use note bounds and data
                for (const key in worldData) {
                    if (key.startsWith('note_')) {
                        try {
                            const noteData = JSON.parse(worldData[key] as string);
                            const { startX, endX, startY, endY, data: noteContent } = noteData;

                            // Check if cursor is within note bounds
                            if (cursorPos.x >= startX && cursorPos.x <= endX &&
                                cursorPos.y >= startY && cursorPos.y <= endY) {

                                const width = endX - startX + 1;
                                const height = endY - startY + 1; // Note content height

                                // Port note content to bounded world data
                                // Note content uses relative coordinates (0,0 = note's startX, startY)
                                // boundedWorldData uses absolute coordinates
                                const boundedData: Record<string, any> = {};
                                if (noteContent) {
                                    for (const cellKey in noteContent) {
                                        const [xStr, yStr] = cellKey.split(',');
                                        const relX = parseInt(xStr, 10);
                                        const relY = parseInt(yStr, 10);
                                        // Translate to absolute coordinates
                                        const absKey = `${startX + relX},${startY + relY}`;
                                        boundedData[absKey] = noteContent[cellKey];
                                    }
                                }

                                applyBoundsWithZoom(
                                    startX, startY, endX + 1, endY + 1,
                                    width, height, boundedData, 'from note',
                                    { type: 'note', noteKey: key, originalBounds: { minX: startX, minY: startY, maxX: endX, maxY: endY } }
                                );
                                return null;
                            }
                        } catch (e) {
                            // Skip invalid note data
                        }
                    }
                }
                // Not over a note - fall through with default 100x100
            }

            // Determine width/height from args or default
            const width = arg1 ? parseInt(arg1, 10) : 100;
            const height = arg2 ? parseInt(arg2, 10) : (arg1 ? width : 100); // Square if only one arg

            if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
                setDialogueWithRevert("Invalid bounds. Usage: /bound [width] [height]", setDialogueText);
                clearCommandState();
                return null;
            }

            // Set bounds centered on current cursor position
            // Ensure minY is aligned to GRID_CELL_SPAN (2) for cursor/text alignment
            const minX = Math.floor(cursorPos.x - width / 2);
            const rawMinY = Math.floor(cursorPos.y - height / 2);
            const minY = Math.floor(rawMinY / 2) * 2; // Align to even number (GRID_CELL_SPAN = 2)

            // Check if cursor is over a note - rewrap its content to fit the new bounds
            let boundedData: Record<string, any> = {};
            let source = '';
            let sourceNoteKey: string | undefined = undefined;
            let originalNoteBounds: { minX: number; minY: number; maxX: number; maxY: number } | undefined = undefined;
            for (const key in worldData) {
                if (key.startsWith('note_')) {
                    try {
                        const noteData = JSON.parse(worldData[key] as string);
                        const { startX, endX, startY, endY, data: noteContent } = noteData;

                        if (cursorPos.x >= startX && cursorPos.x <= endX &&
                            cursorPos.y >= startY && cursorPos.y <= endY) {
                            // Rewrap note content to fit new bounds width
                            if (noteContent && Object.keys(noteContent).length > 0) {
                                // Create a modified noteData with new dimensions for rewrapping
                                // Note: rewrapNoteText uses noteWidth = endX - startX for line length
                                const rewrappedNote = rewrapNoteText({
                                    ...noteData,
                                    startX: 0,
                                    endX: width,      // rewrap uses endX - startX = width for line length
                                    startY: 0,
                                    endY: height,     // Height will expand as needed during rewrap
                                    data: noteContent
                                });

                                // Translate rewrapped coordinates to bounded region position
                                // Rewrapped data is relative to (0,0), bounded region starts at (minX, minY)
                                // minY is already aligned to GRID_CELL_SPAN for cursor/text alignment
                                if (rewrappedNote.data) {
                                    for (const coordKey in rewrappedNote.data) {
                                        const [xStr, yStr] = coordKey.split(',');
                                        const relX = parseInt(xStr, 10);
                                        const relY = parseInt(yStr, 10);
                                        // Translate to bounded region coordinates (no Y offset needed since minY is grid-aligned)
                                        const newKey = `${minX + relX},${minY + relY}`;
                                        boundedData[newKey] = rewrappedNote.data[coordKey];
                                    }
                                }
                            }
                            source = 'with note content';
                            sourceNoteKey = key; // Track note key for syncing edits back
                            originalNoteBounds = { minX: startX, minY: startY, maxX: endX, maxY: endY };
                            break;
                        }
                    } catch (e) {
                        // Skip invalid note data
                    }
                }
            }

            applyBoundsWithZoom(
                minX, minY, minX + width, minY + height,
                width, height, boundedData, source || 'empty bounds',
                sourceNoteKey && originalNoteBounds
                    ? { type: 'note', noteKey: sourceNoteKey, originalBounds: originalNoteBounds }
                    : undefined
            );
            return null;
        }

        if (commandToExecute.startsWith('data')) {
            // Clear command mode
            clearCommandState();

            // Return command execution for immediate processing
            return {
                command: 'data',
                args: inputParts.slice(1),
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('list')) {
            // Clear command mode
            clearCommandState();

            // Return command execution for immediate processing
            const args = inputParts.slice(1);

            return {
                command: 'list',
                args: args,
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('unlist')) {
            // Clear command mode
            clearCommandState();

            // Return command execution for immediate processing
            return {
                command: 'unlist',
                args: [],
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('move')) {
            return executeToggleModeCommand('isMoveMode', "Move mode enabled - hover over text blocks to drag them. Press Escape to exit.", "Move mode disabled");
        }

        if (commandToExecute.startsWith('paint')) {
            // Parse arguments: /paint [brush|fill|lasso|eraser] [color]
            const paintArgs = commandToExecute.slice(5).trim();
            const parts = paintArgs.split(/\s+/);

            let tool: 'brush' | 'fill' | 'lasso' | 'eraser' = modeState.paintTool; // Keep current tool
            let color: string | null = null;
            let hasToolOrColorArg = false;

            // Parse tool type
            if (parts[0] === 'brush' || parts[0] === 'fill' || parts[0] === 'lasso' || parts[0] === 'eraser') {
                tool = parts[0];
                hasToolOrColorArg = true;
                // Check for color after tool
                if (parts[1]) {
                    const colorResult = validateColor(parts[1]);
                    if (colorResult.valid && colorResult.hexColor) {
                        color = colorResult.hexColor;
                    }
                }
            } else if (parts[0]) {
                // No tool specified, might be just a color
                const colorResult = validateColor(parts[0]);
                if (colorResult.valid && colorResult.hexColor) {
                    color = colorResult.hexColor;
                    hasToolOrColorArg = true;
                }
            }

            // If already in paint mode and no arguments, toggle it off
            // But if there are tool/color arguments, switch to that tool instead
            if (modeState.isPaintMode && !hasToolOrColorArg) {
                setModeState(prev => ({
                    ...prev,
                    isPaintMode: false
                }));
                setDialogueWithRevert("Paint mode disabled", setDialogueText);
                clearCommandState();
                return null;
            }

            // Enable paint mode with specified settings
            if (paintArgs) {
                const toolNames = { brush: 'Brush', fill: 'Fill', lasso: 'Lasso', eraser: 'Eraser' };
                const colorStr = color ? ` (${parts.find(p => validateColor(p).valid) || color})` : '';
                setModeState(prev => ({
                    ...prev,
                    isPaintMode: true,
                    paintTool: tool,
                    paintColor: color || prev.paintColor
                }));
                const actionText = tool === 'fill' ? 'Click to fill.' : tool === 'lasso' ? 'Draw outline then release.' : tool === 'eraser' ? 'Click/drag to erase.' : 'Click/drag to paint.';
                setDialogueWithRevert(`Paint ${toolNames[tool]} enabled${colorStr}. ${actionText} Press ESC to exit.`, setDialogueText);
                clearCommandState();
                return null;
            }

            // No arguments, enable paint mode with current settings
            const toolNames = { brush: 'Brush', fill: 'Fill', lasso: 'Lasso', eraser: 'Eraser' };
            setModeState(prev => ({
                ...prev,
                isPaintMode: true
            }));
            setDialogueWithRevert(`Paint ${toolNames[tool]} enabled. Press ESC to exit.`, setDialogueText);
            clearCommandState();
            return null;
        }

        if (commandToExecute.startsWith('agent')) {
            const agentArgs = commandToExecute.slice(5).trim();
            const argParts = agentArgs.split(/\s+/).filter(p => p.length > 0);

            // Helper: Get target agents from selection
            const getTargetAgents = (): Array<{ id: string; data: any }> => {
                const targets: Array<{ id: string; data: any }> = [];

                if (selectedAgentIds && selectedAgentIds.size > 0) {
                    for (const agentId of selectedAgentIds) {
                        if (worldData && worldData[agentId]) {
                            try {
                                const data = typeof worldData[agentId] === 'string'
                                    ? JSON.parse(worldData[agentId])
                                    : worldData[agentId];
                                targets.push({ id: agentId, data });
                            } catch {}
                        }
                    }
                }

                return targets;
            };

            // Named colors for behavior parsing
            const namedColors: { [key: string]: string } = {
                'black': '#000000',
                'white': '#ffffff',
                'red': '#ff0000',
                'green': '#00ff00',
                'blue': '#0000ff',
                'yellow': '#ffff00',
                'cyan': '#00ffff',
                'magenta': '#ff00ff',
                'orange': '#ff8800',
                'purple': '#8800ff',
            };

            const parseColor = (colorStr: string): string => {
                const lower = colorStr.toLowerCase();
                if (namedColors[lower]) return namedColors[lower];
                if (!lower.startsWith('#')) return '#' + lower;
                return lower;
            };

            // /agent alone → spawn 1 agent at cursor if no agents selected
            if (argParts.length === 0) {
                const targets = getTargetAgents();

                if (targets.length === 0) {
                    // No agents selected or under cursor → spawn one at cursor
                    const cursorPos = commandState.commandStartPos;
                    const sprite = userSprites[0]; // Use first available sprite

                    if (!sprite) {
                        setDialogueWithRevert("No sprites available. Create one with /be first.", setDialogueText);
                        clearCommandState();
                        return null;
                    }

                    // Generate unique agent ID
                    const agentId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    const agentData = {
                        x: cursorPos.x,
                        y: cursorPos.y,
                        spriteName: sprite.name,
                        name: sprite.name.toLowerCase(),
                        behaviors: [],
                        sense: { radius: 1, angle: 360 }
                    };

                    if (setWorldData) {
                        setWorldData((prev: Record<string, any>) => ({
                            ...prev,
                            [agentId]: JSON.stringify(agentData)
                        }));
                    }
                    setDialogueWithRevert(`Spawned ${sprite.name} at (${cursorPos.x}, ${cursorPos.y})`, setDialogueText);
                    clearCommandState();
                    return null;
                } else {
                    // Agents are selected/under cursor → show info
                    const names = targets.map(t => t.data.name || 'unnamed').join(', ');
                    setDialogueWithRevert(`Selected: ${names}. Use /agent <command> to configure.`, setDialogueText);
                    clearCommandState();
                    return null;
                }
            }

            // /agent attach - toggle cursor attachment
            if (argParts[0] === 'attach') {
                if (modeState.isAgentAttached) {
                    setModeState(prev => ({ ...prev, isAgentAttached: false }));
                    setDialogueWithRevert("Agents detached from cursor", setDialogueText);
                } else {
                    setModeState(prev => ({ ...prev, isAgentAttached: true }));
                    setDialogueWithRevert("Agents attached to cursor. /agent attach to detach.", setDialogueText);
                }
                clearCommandState();
                return null;
            }

            // /agent list - show behaviors of selected agents
            if (argParts[0] === 'list') {
                const targets = getTargetAgents();
                if (targets.length === 0) {
                    setDialogueWithRevert("No agents selected. Select agents or position cursor on one.", setDialogueText);
                    clearCommandState();
                    return null;
                }

                const info = targets.map(t => {
                    const behaviors = t.data.behaviors || [];
                    if (behaviors.length === 0) {
                        return `${t.data.name || 'agent'}: no behaviors`;
                    }
                    const behaviorList = behaviors.map((b: any) => {
                        let desc = `${b.type} ${b.color}`;
                        if (b.direction) desc += ` ${b.direction}`;
                        if (b.onColorAction) desc += ` → ${b.onColorAction.action}`;
                        return desc;
                    }).join(', ');
                    return `${t.data.name || 'agent'}: ${behaviorList}`;
                }).join(' | ');

                setDialogueWithRevert(info, setDialogueText);
                clearCommandState();
                return null;
            }

            // /agent clear - clear all behaviors from selected agents
            if (argParts[0] === 'clear') {
                const targets = getTargetAgents();
                if (targets.length === 0) {
                    setDialogueWithRevert("No agents selected", setDialogueText);
                    clearCommandState();
                    return null;
                }

                if (setWorldData) {
                    setWorldData((prev: Record<string, any>) => {
                        const newData = { ...prev };
                        for (const target of targets) {
                            target.data.behaviors = [];
                            newData[target.id] = JSON.stringify(target.data);
                        }
                        return newData;
                    });
                }
                setDialogueWithRevert(`Cleared behaviors from ${targets.length} agent(s)`, setDialogueText);
                clearCommandState();
                return null;
            }

            // /agent sense radius <n> OR /agent sense angle <n>
            if (argParts[0] === 'sense') {
                const targets = getTargetAgents();
                if (targets.length === 0) {
                    setDialogueWithRevert("No agents selected", setDialogueText);
                    clearCommandState();
                    return null;
                }

                // /agent sense - show current
                if (argParts.length === 1) {
                    const info = targets.map(t => {
                        const s = t.data.sense || { radius: 1, angle: 360 };
                        return `${t.data.name || 'agent'}: r=${s.radius} a=${s.angle}°`;
                    }).join(', ');
                    setDialogueWithRevert(info, setDialogueText);
                    clearCommandState();
                    return null;
                }

                const subcommand = argParts[1].toLowerCase();

                if (subcommand === 'radius' && argParts.length >= 3) {
                    const radius = parseInt(argParts[2], 10);
                    if (isNaN(radius) || radius < 1 || radius > 20) {
                        setDialogueWithRevert("Invalid radius. Use 1-20", setDialogueText);
                        clearCommandState();
                        return null;
                    }
                    if (setWorldData) {
                        setWorldData((prev: Record<string, any>) => {
                            const newData = { ...prev };
                            for (const target of targets) {
                                if (!target.data.sense) target.data.sense = { radius: 1, angle: 360 };
                                target.data.sense.radius = radius;
                                newData[target.id] = JSON.stringify(target.data);
                            }
                            return newData;
                        });
                    }
                    setDialogueWithRevert(`Set sense radius to ${radius} for ${targets.length} agent(s)`, setDialogueText);
                    clearCommandState();
                    return null;
                }

                if (subcommand === 'angle' && argParts.length >= 3) {
                    const angle = parseInt(argParts[2], 10);
                    if (isNaN(angle) || angle < 1 || angle > 360) {
                        setDialogueWithRevert("Invalid angle. Use 1-360", setDialogueText);
                        clearCommandState();
                        return null;
                    }
                    if (setWorldData) {
                        setWorldData((prev: Record<string, any>) => {
                            const newData = { ...prev };
                            for (const target of targets) {
                                if (!target.data.sense) target.data.sense = { radius: 1, angle: 360 };
                                target.data.sense.angle = angle;
                                newData[target.id] = JSON.stringify(target.data);
                            }
                            return newData;
                        });
                    }
                    setDialogueWithRevert(`Set sense angle to ${angle}° for ${targets.length} agent(s)`, setDialogueText);
                    clearCommandState();
                    return null;
                }

                setDialogueWithRevert("Usage: /agent sense [radius <n>] [angle <n>]", setDialogueText);
                clearCommandState();
                return null;
            }

            // /agent <behavior-type> <color> [args...] - add behavior directly
            // e.g., /agent follow-color black
            // e.g., /agent turn-on-color green left
            // e.g., /agent on-color red paint #00ff00
            const validBehaviors = ['follow-color', 'avoid-color', 'stop-on-color', 'turn-on-color', 'on-color'];
            if (validBehaviors.includes(argParts[0])) {
                const targets = getTargetAgents();
                if (targets.length === 0) {
                    setDialogueWithRevert("No agents selected", setDialogueText);
                    clearCommandState();
                    return null;
                }

                const behaviorType = argParts[0] as 'follow-color' | 'avoid-color' | 'stop-on-color' | 'turn-on-color' | 'on-color';

                if (argParts.length < 2) {
                    setDialogueWithRevert(`Usage: /agent ${behaviorType} <color> [options]`, setDialogueText);
                    clearCommandState();
                    return null;
                }

                const color = parseColor(argParts[1]);

                // Parse optional direction for turn-on-color
                let direction: 'left' | 'right' | 'reverse' | undefined;
                if (behaviorType === 'turn-on-color' && argParts.length >= 3) {
                    const dir = argParts[2].toLowerCase();
                    if (['left', 'right', 'reverse'].includes(dir)) {
                        direction = dir as 'left' | 'right' | 'reverse';
                    }
                }

                // Parse on-color action
                let onColorAction: { action: string; value?: string } | undefined;
                if (behaviorType === 'on-color') {
                    if (argParts.length < 3) {
                        setDialogueWithRevert("Usage: /agent on-color <color> <action> [value]", setDialogueText);
                        clearCommandState();
                        return null;
                    }
                    const actionType = argParts[2].toLowerCase();
                    const allActions = [...MAKE_ACTIONS, ...AGENT_MOVEMENT];
                    if (!allActions.includes(actionType as any)) {
                        setDialogueWithRevert(`Invalid action: ${actionType}. Use: ${allActions.join(', ')}`, setDialogueText);
                        clearCommandState();
                        return null;
                    }
                    let actionValue: string | undefined;
                    if (argParts.length > 3) {
                        actionValue = argParts.slice(3).join(' ').replace(/^["']|["']$/g, '');
                    }
                    onColorAction = { action: actionType, value: actionValue };
                }

                // Build behavior object
                const newBehavior: any = { type: behaviorType, color };
                if (direction) newBehavior.direction = direction;
                if (onColorAction) newBehavior.onColorAction = onColorAction;

                // Add to all target agents
                if (setWorldData) {
                    setWorldData((prev: Record<string, any>) => {
                        const newData = { ...prev };
                        for (const target of targets) {
                            if (!target.data.behaviors) target.data.behaviors = [];
                            // Check for duplicates
                            const exists = target.data.behaviors.some((b: any) => {
                                if (b.type !== behaviorType || b.color.toLowerCase() !== color.toLowerCase()) return false;
                                if (behaviorType === 'on-color' && onColorAction) {
                                    return b.onColorAction?.action === onColorAction.action;
                                }
                                return true;
                            });
                            if (!exists) {
                                target.data.behaviors.push(newBehavior);
                            }
                            newData[target.id] = JSON.stringify(target.data);
                        }
                        return newData;
                    });
                }

                const actionInfo = onColorAction ? ` → ${onColorAction.action}` : '';
                setDialogueWithRevert(`Added ${behaviorType} ${color}${actionInfo} to ${targets.length} agent(s)`, setDialogueText);
                clearCommandState();
                return null;
            }

            // /agent remove <behavior-type> <color> - remove a specific behavior
            if (argParts[0] === 'remove') {
                const targets = getTargetAgents();
                if (targets.length === 0) {
                    setDialogueWithRevert("No agents selected", setDialogueText);
                    clearCommandState();
                    return null;
                }

                if (argParts.length < 3) {
                    setDialogueWithRevert("Usage: /agent remove <behavior> <color>", setDialogueText);
                    clearCommandState();
                    return null;
                }

                const behaviorType = argParts[1];
                const color = parseColor(argParts[2]);

                if (setWorldData) {
                    setWorldData((prev: Record<string, any>) => {
                        const newData = { ...prev };
                        for (const target of targets) {
                            if (target.data.behaviors) {
                                target.data.behaviors = target.data.behaviors.filter((b: any) =>
                                    !(b.type === behaviorType && b.color.toLowerCase() === color.toLowerCase())
                                );
                            }
                            newData[target.id] = JSON.stringify(target.data);
                        }
                        return newData;
                    });
                }
                setDialogueWithRevert(`Removed ${behaviorType} ${color} from ${targets.length} agent(s)`, setDialogueText);
                clearCommandState();
                return null;
            }

            // /agent <spritename> - spawn agent with specific sprite at cursor
            const spriteName = argParts[0].toLowerCase();
            const sprite = userSprites.find(s => s.name.toLowerCase() === spriteName);
            if (sprite) {
                const cursorPos = commandState.commandStartPos;
                const agentId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const agentData = {
                    x: cursorPos.x,
                    y: cursorPos.y,
                    spriteName: sprite.name,
                    name: sprite.name.toLowerCase(),
                    behaviors: [],
                    sense: { radius: 1, angle: 360 }
                };

                if (setWorldData) {
                    setWorldData((prev: Record<string, any>) => ({
                        ...prev,
                        [agentId]: JSON.stringify(agentData)
                    }));
                }
                setDialogueWithRevert(`Spawned ${sprite.name} at (${cursorPos.x}, ${cursorPos.y})`, setDialogueText);
                clearCommandState();
                return null;
            }

            // Unknown command
            setDialogueWithRevert(`Unknown: /agent ${argParts[0]}. Try: list, clear, sense, follow-color, etc.`, setDialogueText);
            clearCommandState();
            return null;
        }

        if (commandToExecute.startsWith('upgrade')) {
            return executeCallbackCommand(triggerUpgradeFlow, "Upgrade flow not available");
        }

        if (commandToExecute.startsWith('tutorial')) {
            return executeCallbackCommand(triggerTutorialFlow, "Tutorial flow not available");
        }

        if (commandToExecute.startsWith('help')) {
            // Keep command mode active to show all commands
            // Help text will only be shown on hover
            let allCommands = isReadOnly ? READ_ONLY_COMMANDS : AVAILABLE_COMMANDS;

            // Filter out mail command for non-super users
            allCommands = allCommands.filter(cmd => {
                if (cmd === 'mail' && membershipLevel !== 'super') return false;
                return true;
            });

            // Build command data - just show commands, no help text yet
            const newCommandData = drawCommandWithSuggestions('/', allCommands, commandState.commandStartPos);
            setCommandData(newCommandData);
            setCommandState(prev => ({
                ...prev,
                input: '',
                matchedCommands: allCommands,
                selectedIndex: 0,
                helpMode: true
            }));

            return null;
        }

        if (commandToExecute.startsWith('spawn')) {
            return executeSimpleCommand('spawn');
        }

        // Handle monogram command (WebGPU background effects)
        if (commandToExecute.startsWith('monogram')) {
            const parts = commandToExecute.split(/\s+/);
            const args = parts.slice(1);

            if (monogramSystem) {
                if (args.length === 0) {
                    // Toggle enabled state if no args
                    monogramSystem.toggleEnabled();
                    const newState = !monogramSystem.options?.enabled;
                    setDialogueWithRevert(`Monogram background ${newState ? 'enabled' : 'disabled'}`, setDialogueText);
                } else {
                    const option = args[0].toLowerCase();
                    
                    if (option === 'on') {
                        monogramSystem.setOptions((prev: any) => ({ ...prev, enabled: true }));
                        setDialogueWithRevert("Monogram background enabled", setDialogueText);
                    } else if (option === 'off') {
                        monogramSystem.setOptions((prev: any) => ({ ...prev, enabled: false }));
                        setDialogueWithRevert("Monogram background disabled", setDialogueText);
                    } else if (option === 'face') {
                        // Activate face mode (same as /talk)
                        monogramSystem.setOptions((prev: any) => ({ ...prev, mode: 'face3d', enabled: true }));
                        
                        // Trigger camera access for face tracking (same logic as /talk)
                        const startFaceTracking = async () => {
                            try {
                                // Always use front camera for face tracking
                                const facingMode: 'user' | 'environment' = 'user';
                                const maskName = 'macintosh'; 

                                // Request webcam access with front camera
                                const stream = await navigator.mediaDevices.getUserMedia({
                                    video: {
                                        width: { ideal: 1920 },
                                        height: { ideal: 1080 },
                                        facingMode: { ideal: 'user' }
                                    },
                                    audio: false
                                });

                                // Stop any existing stream
                                if (backgroundStreamRef.current) {
                                    backgroundStreamRef.current.getTracks().forEach(track => track.stop());
                                }

                                // Store stream reference
                                backgroundStreamRef.current = stream;

                                // Enable face detection
                                setModeState(prev => ({
                                    ...prev,
                                    isFaceDetectionEnabled: true,
                                    backgroundStream: stream
                                }));

                                // Show webcam feed as background
                                switchBackgroundMode('stream');

                                setDialogueWithRevert(`Face-piloted geometry active. Turn your head to pilot the face!`, setDialogueText);
                            } catch (error) {
                                console.error('Failed to start face detection:', error);
                                setDialogueWithRevert("Failed to access camera. Please grant permission.", setDialogueText);
                            }
                        };
                        
                        startFaceTracking();
                    } else {
                        // Set mode (clear, perlin, nara, etc.)
                        monogramSystem.setOptions((prev: any) => ({ ...prev, mode: option, enabled: true }));
                        setDialogueWithRevert(`Monogram mode set to: ${option}`, setDialogueText);
                    }
                }
            }

            // Clear command mode
            clearCommandState();

            return { command: 'monogram', args, commandStartPos: commandState.commandStartPos };
        }

        if (commandToExecute.startsWith('glitch')) {
            return executeSimpleCommand('glitch');
        }

        if (commandToExecute.startsWith('zoom')) {
            return executeSimpleCommand('zoom');
        }

        // Handle commands that need text selection
        if (['transform', 'explain', 'summarize'].includes(commandToExecute.toLowerCase().split(' ')[0])) {
            // Clear command mode
            clearCommandState();
            
            // Set as pending command waiting for selection
            const args = inputParts.slice(1);
            setPendingCommand({
                command: commandToExecute,
                args: args,
                isWaitingForSelection: true
            });
            
            return { command: 'pending_selection', args: [commandToExecute], commandStartPos: commandState.commandStartPos };
        }

        // Handle share command - always publishes with region coordinates
        if (commandToExecute.startsWith('share')) {
            return executeSimpleCommand('share');
        }

        // Handle latex command - activates LaTeX input mode
        if (commandToExecute.startsWith('latex')) {
            return executeSimpleCommand('latex');
        }

        // Handle smiles command - activates SMILES (molecular structure) input mode
        if (commandToExecute.startsWith('smiles')) {
            return executeSimpleCommand('smiles');
        }

        // Handle upload command - opens file picker for image upload
        if (commandToExecute.startsWith('upload')) {
            const parts = commandToExecute.split(/\s+/);
            const args = parts.slice(1); // Capture --bitmap flag if present

            // Clear command mode
            clearCommandState();

            return { command: 'upload', args, commandStartPos: commandState.commandStartPos };
        }

        // Handle pattern command - generates townscape pattern at cursor position
        if (commandToExecute.startsWith('pattern')) {
            if (setWorldData && worldData) {
                const cursorPos = commandState.commandStartPos;

                // Generate rooms using BSP
                const width = 120;
                const height = 120;
                const timestamp = Date.now();
                const seed = timestamp;
                const random = (n: number) => {
                    const x = Math.sin(seed + n) * 10000;
                    return x - Math.floor(x);
                };

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
                        const roomWidth = Math.floor(rng(rngOffset) * 6) + 14;
                        const roomHeight = Math.floor(rng(rngOffset + 1) * 6) + 10;
                        const roomX = node.x + margin + Math.floor(rng(rngOffset + 2) * Math.max(0, node.width - roomWidth - margin * 2));
                        const roomY = node.y + margin + Math.floor(rng(rngOffset + 3) * Math.max(0, node.height - roomHeight - margin * 2));
                        node.room = { x: roomX, y: roomY, width: roomWidth, height: roomHeight };
                        return;
                    }
                    const visualWidth = node.width * 1;
                    const visualHeight = node.height * 1;
                    const splitHorizontal = visualHeight > visualWidth ? true : (visualWidth > visualHeight ? false : rng(rngOffset + depth) > 0.5);
                    if (splitHorizontal && node.height >= 20) {
                        const splitY = node.y + Math.floor(node.height / 2) + Math.floor(rng(rngOffset + depth + 1) * 6) - 3;
                        node.leftChild = { x: node.x, y: node.y, width: node.width, height: splitY - node.y };
                        node.rightChild = { x: node.x, y: splitY, width: node.width, height: node.y + node.height - splitY };
                    } else if (!splitHorizontal && node.width >= 20) {
                        const splitX = node.x + Math.floor(node.width / 2) + Math.floor(rng(rngOffset + depth + 2) * 8) - 4;
                        node.leftChild = { x: node.x, y: node.y, width: splitX - node.x, height: node.height };
                        node.rightChild = { x: splitX, y: node.y, width: node.x + node.width - splitX, height: node.height };
                    } else {
                        const margin = 2;
                        const roomWidth = Math.max(14, Math.min(node.width - margin * 2, 20));
                        const roomHeight = Math.max(10, Math.min(node.height - margin * 2, 16));
                        if (roomWidth >= 14 && roomHeight >= 10) {
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
                    x: Math.floor(cursorPos.x - width / 2),
                    y: Math.floor(cursorPos.y - height / 2),
                    width: width,
                    height: height
                };

                bspSplit(rootNode, 0, 3, random, 100);
                const rooms = collectRooms(rootNode);

                // Create note objects for each room
                const patternKey = `pattern_${timestamp}`;
                const noteKeys: string[] = [];
                const noteObjects: Record<string, string> = {};

                for (let i = 0; i < rooms.length; i++) {
                    const room = rooms[i];
                    const noteKey = `note_${room.x},${room.y}_${timestamp}_${i}`;
                    const noteData = {
                        startX: room.x,
                        startY: room.y,
                        endX: room.x + room.width,
                        endY: room.y + room.height,
                        timestamp: timestamp,
                        patternKey: patternKey,  // Reference back to parent pattern
                        originPatternKey: patternKey  // Track original pattern for grafting
                    };
                    noteKeys.push(noteKey);
                    noteObjects[noteKey] = JSON.stringify(noteData);
                }

                // Calculate actual bounding box from rooms (accounting for corridors)
                // Corridors are 3 cells wide horizontally, 2 cells tall vertically
                const corridorPadding = 3; // Max corridor extension from room centers

                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const room of rooms) {
                    // Room bounds
                    const roomMinX = room.x;
                    const roomMinY = room.y;
                    const roomMaxX = room.x + room.width;
                    const roomMaxY = room.y + room.height;

                    // Account for corridors extending from room centers
                    const centerX = room.x + Math.floor(room.width / 2);
                    const centerY = room.y + Math.floor(room.height / 2);

                    minX = Math.min(minX, roomMinX, centerX - corridorPadding);
                    minY = Math.min(minY, roomMinY, centerY - corridorPadding);
                    maxX = Math.max(maxX, roomMaxX, centerX + corridorPadding);
                    maxY = Math.max(maxY, roomMaxY, centerY + corridorPadding);
                }

                // Calculate center and dimensions from actual extent
                const actualWidth = maxX - minX;
                const actualHeight = maxY - minY;
                const actualCenterX = minX + actualWidth / 2;
                const actualCenterY = minY + actualHeight / 2;

                // Generate pattern data with note keys instead of inline rooms
                const patternData = {
                    centerX: actualCenterX,
                    centerY: actualCenterY,
                    width: actualWidth,
                    height: actualHeight,
                    timestamp: timestamp,
                    noteKeys: noteKeys,  // Store note keys instead of inline rooms

                    // Pattern generation metadata
                    generationType: 'bsp',
                    generationParams: {
                        depth: 3,
                        width: width,
                        height: height,
                        seed: seed
                    }
                };

                // Calculate outer border cells for wall paint
                const borderCells = calculatePatternBorderCells(rooms, seed);
                let paintBlobData: Record<string, string> = {};
                if (borderCells.length > 0) {
                    const paintBlob = createPaintBlob('#000000', borderCells, patternKey);
                    paintBlobData[`paintblob_${paintBlob.id}`] = JSON.stringify(paintBlob);
                }

                setWorldData((prev: WorldData) => ({
                    ...prev,
                    [patternKey]: JSON.stringify(patternData),
                    ...noteObjects,  // Add all note objects
                    ...paintBlobData  // Add the linked paint blob
                }));

                setDialogueWithRevert(`Pattern generated with ${noteKeys.length} rooms and walls`, setDialogueText);
            }

            // Clear command mode
            clearCommandState();

            return null; // Pattern doesn't need further processing
        }

        if (commandToExecute === 'connect') {
            // Connect selected notes into a pattern with corridors
            const existingSelection = getNormalizedSelection?.();

            if (!existingSelection) {
                setDialogueWithRevert("Make a selection containing notes, then run /connect", setDialogueText);
                clearCommandState();
                return null;
            }

            if (setWorldData && worldData) {
                // Find all notes that overlap with the selection
                const selectionStartX = Math.min(existingSelection.startX, existingSelection.endX);
                const selectionEndX = Math.max(existingSelection.startX, existingSelection.endX);
                const selectionStartY = Math.min(existingSelection.startY, existingSelection.endY);
                const selectionEndY = Math.max(existingSelection.startY, existingSelection.endY);

                const overlappingNotes: string[] = [];

                for (const key in worldData) {
                    if (key.startsWith('note_')) {
                        try {
                            const noteData = JSON.parse(worldData[key] as string);
                            // Check if note overlaps with selection
                            const noteStartX = Math.min(noteData.startX, noteData.endX);
                            const noteEndX = Math.max(noteData.startX, noteData.endX);
                            const noteStartY = Math.min(noteData.startY, noteData.endY);
                            const noteEndY = Math.max(noteData.startY, noteData.endY);

                            const overlapsX = noteStartX <= selectionEndX && noteEndX >= selectionStartX;
                            const overlapsY = noteStartY <= selectionEndY && noteEndY >= selectionStartY;

                            if (overlapsX && overlapsY) {
                                overlappingNotes.push(key);
                            }
                        } catch (e) {
                            // Skip invalid notes
                        }
                    }
                }

                if (overlappingNotes.length < 1) {
                    setDialogueWithRevert("Need at least 1 note in selection to connect", setDialogueText);
                    clearCommandState();
                    return null;
                }

                // Check if any notes are already in a pattern
                const existingPatternKeys = new Set<string>();
                for (const noteKey of overlappingNotes) {
                    const noteData = JSON.parse(worldData[noteKey] as string);
                    if (noteData.patternKey) {
                        existingPatternKeys.add(noteData.patternKey);
                    }
                }

                let patternKey: string;
                let allNoteKeys: string[];
                let isNewPattern = false;

                if (existingPatternKeys.size > 0) {
                    // Use the first existing pattern and merge all notes into it
                    patternKey = Array.from(existingPatternKeys)[0];
                    const existingPatternData = JSON.parse(worldData[patternKey] as string);

                    // Combine existing noteKeys with new overlapping notes (deduplicate)
                    const combinedNoteKeys = new Set([
                        ...(existingPatternData.noteKeys || []),
                        ...overlappingNotes
                    ]);
                    allNoteKeys = Array.from(combinedNoteKeys);

                    // If there were multiple patterns, merge them all
                    if (existingPatternKeys.size > 1) {
                        for (const oldPatternKey of existingPatternKeys) {
                            if (oldPatternKey !== patternKey) {
                                const oldPatternData = JSON.parse(worldData[oldPatternKey] as string);
                                for (const noteKey of oldPatternData.noteKeys || []) {
                                    allNoteKeys.push(noteKey);
                                }
                            }
                        }
                        // Deduplicate again
                        allNoteKeys = Array.from(new Set(allNoteKeys));
                    }
                } else {
                    // No existing pattern - create a new one
                    if (overlappingNotes.length < 2) {
                        setDialogueWithRevert("Need at least 2 notes to create a new pattern", setDialogueText);
                        clearCommandState();
                        return null;
                    }
                    const timestamp = Date.now();
                    patternKey = `pattern_${timestamp}`;
                    allNoteKeys = overlappingNotes;
                    isNewPattern = true;
                }

                // Calculate pattern bounds from all notes
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                const corridorPadding = 3;

                for (const noteKey of allNoteKeys) {
                    try {
                        const noteData = JSON.parse(worldData[noteKey] as string);
                        const noteMinX = noteData.startX;
                        const noteMinY = noteData.startY;
                        // endX/endY are inclusive, add 1 to get exclusive boundary
                        const noteMaxX = noteData.endX + 1;
                        const noteMaxY = noteData.endY + 1;
                        const noteCenterX = (noteMinX + noteMaxX) / 2;
                        const noteCenterY = (noteMinY + noteMaxY) / 2;

                        minX = Math.min(minX, noteMinX, noteCenterX - corridorPadding);
                        minY = Math.min(minY, noteMinY, noteCenterY - corridorPadding);
                        maxX = Math.max(maxX, noteMaxX, noteCenterX + corridorPadding);
                        maxY = Math.max(maxY, noteMaxY, noteCenterY + corridorPadding);
                    } catch (e) {
                        // Skip invalid notes
                    }
                }

                const actualWidth = maxX - minX;
                const actualHeight = maxY - minY;
                const actualCenterX = minX + actualWidth / 2;
                const actualCenterY = minY + actualHeight / 2;

                // Flatten source patterns into atomic leaf nodes (BSP/manual only)
                const flattenSourcePatterns = (patternKeys: Set<string>): any[] => {
                    const leafPatterns: any[] = [];
                    const seen = new Set<string>();

                    const collect = (key: string) => {
                        if (seen.has(key)) return;
                        seen.add(key);

                        try {
                            const sourceData = JSON.parse(worldData[key] as string);

                            if (sourceData.generationType === 'grafted' && sourceData.sourcePatterns) {
                                // Recursively flatten grafted patterns
                                for (const source of sourceData.sourcePatterns) {
                                    collect(source.key || source);
                                }
                            } else {
                                // Leaf pattern (BSP or manual)
                                leafPatterns.push({
                                    key,
                                    type: sourceData.generationType || 'unknown',
                                    // Preserve generation params if they exist (for BSP patterns)
                                    ...(sourceData.generationParams && {
                                        params: sourceData.generationParams
                                    })
                                });
                            }
                        } catch (e) {
                            // Fallback if pattern data is invalid
                            leafPatterns.push({ key, type: 'unknown' });
                        }
                    };

                    patternKeys.forEach(collect);
                    return leafPatterns;
                };

                const sourcePatternMetadata = existingPatternKeys.size > 0
                    ? flattenSourcePatterns(existingPatternKeys)
                    : undefined;

                // Create or update pattern data
                const timestamp = Date.now();
                const patternData = {
                    centerX: actualCenterX,
                    centerY: actualCenterY,
                    width: actualWidth,
                    height: actualHeight,
                    timestamp: timestamp,
                    noteKeys: allNoteKeys,

                    // Pattern generation metadata
                    // 'manual' if creating new pattern from scratch
                    // 'grafted' if merging existing patterns together
                    generationType: (isNewPattern ? 'manual' : 'grafted'),
                    ...(sourcePatternMetadata && {
                        // Flat list of all leaf patterns (atomistic, no nesting)
                        sourcePatterns: sourcePatternMetadata
                    })
                };

                // Update all notes to reference this pattern
                const updatedNotes: Record<string, string> = {};
                for (const noteKey of allNoteKeys) {
                    try {
                        const noteData = JSON.parse(worldData[noteKey] as string);
                        updatedNotes[noteKey] = JSON.stringify({
                            ...noteData,
                            patternKey: patternKey,
                            // Preserve originPatternKey if it exists, otherwise set it to the note's current patternKey
                            originPatternKey: noteData.originPatternKey || noteData.patternKey || patternKey
                        });
                    } catch (e) {
                        // Skip invalid notes
                    }
                }

                // Prepare update data - delete old patterns if merging
                const updateData: Record<string, string> = {
                    [patternKey]: JSON.stringify(patternData),
                    ...updatedNotes
                };

                // If merging multiple patterns, delete the old ones
                if (existingPatternKeys.size > 1) {
                    setWorldData((prev: WorldData) => {
                        const newData = { ...prev, ...updateData };
                        for (const oldPatternKey of existingPatternKeys) {
                            if (oldPatternKey !== patternKey) {
                                delete newData[oldPatternKey];
                            }
                        }
                        return newData;
                    });
                    setDialogueWithRevert(`Merged ${existingPatternKeys.size} patterns into one with ${allNoteKeys.length} notes`, setDialogueText);
                } else {
                    setWorldData((prev: WorldData) => ({
                        ...prev,
                        ...updateData
                    }));

                    if (isNewPattern) {
                        setDialogueWithRevert(`Pattern created from ${allNoteKeys.length} notes`, setDialogueText);
                    } else {
                        setDialogueWithRevert(`Added notes to existing pattern (now ${allNoteKeys.length} notes total)`, setDialogueText);
                    }
                }
            }

            // Clear command mode
            clearCommandState();

            return null; // Pattern doesn't need further processing
        }

        if (commandToExecute.startsWith('style ')) {
            // Apply visual style to selected note or pattern
            const styleName = commandToExecute.substring(6).trim().toLowerCase();

            if (!styleName) {
                setDialogueWithRevert("Usage: /style [stylename] - Available: solid, glow, glowing", setDialogueText);
                clearCommandState();
                return null;
            }

            // Helper function to find note or pattern at cursor position
            const findNoteOrPatternAtCursor = (cursorPos: Point): { key: string, type: 'note' | 'pattern' } | null => {
                if (!worldData) return null;

                const cursorX = cursorPos.x;
                const cursorY = cursorPos.y;

                // First check for notes
                for (const key in worldData) {
                    if (key.startsWith('note_')) {
                        try {
                            const noteData = JSON.parse(worldData[key] as string);
                            if (cursorX >= noteData.startX && cursorX <= noteData.endX &&
                                cursorY >= noteData.startY && cursorY <= noteData.endY) {
                                return { key, type: 'note' };
                            }
                        } catch (e) {
                            // Skip invalid note data
                        }
                    }
                }

                // Then check for patterns
                for (const key in worldData) {
                    if (key.startsWith('pattern_')) {
                        try {
                            const patternData = JSON.parse(worldData[key] as string);
                            if (cursorX >= patternData.startX && cursorX <= patternData.endX &&
                                cursorY >= patternData.startY && cursorY <= patternData.endY) {
                                return { key, type: 'pattern' };
                            }
                        } catch (e) {
                            // Skip invalid pattern data
                        }
                    }
                }

                return null;
            };

            // Determine which note/pattern to style
            let targetKey: string | null = null;
            let targetType: 'note' | 'pattern' | null = null;

            // First priority: explicitly selected note/pattern
            if (selectedNoteKey) {
                targetKey = selectedNoteKey;
                targetType = 'note';
            } else if (selectedPatternKey) {
                targetKey = selectedPatternKey;
                targetType = 'pattern';
            } else {
                // Second priority: auto-detect from cursor position
                const cursorPos = commandState.commandStartPos;
                const detected = findNoteOrPatternAtCursor(cursorPos);
                if (detected) {
                    targetKey = detected.key;
                    targetType = detected.type;
                }
            }

            // If no target found, show error
            if (!targetKey || !targetType) {
                setDialogueWithRevert("No note or pattern found at cursor. Move cursor inside a note/pattern or select one first.", setDialogueText);
                clearCommandState();
                return null;
            }

            // Apply the style
            if (setWorldData && worldData) {
                try {
                    const targetData = JSON.parse(worldData[targetKey] as string);
                    setWorldData((prev: WorldData) => ({
                        ...prev,
                        [targetKey]: JSON.stringify({
                            ...targetData,
                            style: styleName
                        })
                    }));
                    setDialogueWithRevert(`Applied '${styleName}' style to ${targetType}`, setDialogueText);
                } catch (e) {
                    setDialogueWithRevert(`Invalid ${targetType} data`, setDialogueText);
                }
            }

            // Clear command mode
            clearCommandState();

            return null;
        }

        if (commandName === 'export') {
            // Export selected area as PNG image (async to handle image loading)
            const existingSelection = getNormalizedSelection?.();

            if (!existingSelection) {
                setDialogueWithRevert("Make a selection first, then type /export", setDialogueText);
                clearCommandState();
                return null;
            }

            // Check for --grid argument
            const includeGrid = inputParts.includes('--grid');

            // Normalize selection bounds
            const selectionStartX = Math.min(existingSelection.startX, existingSelection.endX);
            const selectionEndX = Math.max(existingSelection.startX, existingSelection.endX);
            const selectionStartY = Math.min(existingSelection.startY, existingSelection.endY);
            const selectionEndY = Math.max(existingSelection.startY, existingSelection.endY);

            const selectionWidth = selectionEndX - selectionStartX + 1;
            const selectionHeight = selectionEndY - selectionStartY + 1;

            // Show loading message
            setDialogueWithRevert(`Exporting ${selectionWidth}×${selectionHeight} selection...`, setDialogueText);

            // Perform export asynchronously
            (async () => {
                try {
                    // Get character dimensions
                    const charDims = getEffectiveCharDims(zoomLevel);
                    const charWidth = charDims.width;
                    const charHeight = charDims.height;

                    // Create export canvas
                    const exportCanvas = document.createElement('canvas');
                    const dpr = window.devicePixelRatio || 1;
                    const canvasWidth = Math.floor(selectionWidth * charWidth);
                    const canvasHeight = Math.floor(selectionHeight * charHeight);

                    exportCanvas.width = canvasWidth * dpr;
                    exportCanvas.height = canvasHeight * dpr;

                    const ctx = exportCanvas.getContext('2d');
                    if (!ctx) {
                        setDialogueWithRevert("Failed to create export canvas", setDialogueText);
                        return;
                    }

                    // Scale context for device pixel ratio
                    ctx.scale(dpr, dpr);

                    // Fill background with current background color
                    ctx.fillStyle = modeState.backgroundColor || '#FFFFFF';
                    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

                    // Helper to convert world coords to canvas coords
                    const worldToCanvas = (x: number, y: number) => ({
                        x: (x - selectionStartX) * charWidth,
                        y: (y - selectionStartY) * charHeight
                    });

                    if (!worldData) {
                        setDialogueWithRevert("No world data to export", setDialogueText);
                        return;
                    }

                    // STEP 1: Render paint blobs (underneath everything)
                    const paintBlobs = getAllPaintBlobs(worldData);
                    for (const blob of paintBlobs) {
                        // Check if blob overlaps with selection
                        if (blob.bounds.maxX < selectionStartX || blob.bounds.minX > selectionEndX ||
                            blob.bounds.maxY < selectionStartY || blob.bounds.minY > selectionEndY) {
                            continue;
                        }

                        ctx.fillStyle = blob.color || '#000000';
                        for (const cellKey of blob.cells) {
                            const [x, y] = cellKey.split(',').map(Number);
                            if (x >= selectionStartX && x <= selectionEndX &&
                                y >= selectionStartY && y <= selectionEndY) {
                                const canvasPos = worldToCanvas(x, y);
                                ctx.fillRect(canvasPos.x, canvasPos.y, charWidth, charHeight);
                            }
                        }
                    }

                    // STEP 2: Render tiles (from /make command) - need to load images
                    const tileImages = new Map<string, HTMLImageElement>();
                    const tileLoadPromises: Promise<void>[] = [];

                    // Collect all tiles in selection and start loading their images
                    const tilesToRender: Array<{x: number, y: number, tileset: string, tileIndex: number}> = [];
                    for (const key in worldData) {
                        if (!key.startsWith('paint_')) continue;

                        try {
                            const paintData = JSON.parse(worldData[key] as string);
                            if (paintData.type === 'tile') {
                                const x = paintData.x;
                                const y = paintData.y;

                                if (x >= selectionStartX && x <= selectionEndX &&
                                    y >= selectionStartY && y <= selectionEndY) {

                                    tilesToRender.push({
                                        x, y,
                                        tileset: paintData.tileset,
                                        tileIndex: paintData.tileIndex || 0
                                    });

                                    // Load tileset image if not already loading
                                    if (!tileImages.has(paintData.tileset)) {
                                        const img = new Image();
                                        img.crossOrigin = "anonymous";
                                        tileImages.set(paintData.tileset, img);

                                        const loadPromise = new Promise<void>((resolve) => {
                                            img.onload = () => resolve();
                                            img.onerror = () => resolve(); // Resolve anyway to not block export
                                            img.src = paintData.tileset;
                                        });
                                        tileLoadPromises.push(loadPromise);
                                    }
                                }
                            }
                        } catch (e) {
                            // Skip invalid paint data
                        }
                    }

                    // Wait for all tile images to load
                    await Promise.all(tileLoadPromises);

                    // Render tiles
                    for (const tile of tilesToRender) {
                        const img = tileImages.get(tile.tileset);
                        if (img && img.complete && img.naturalWidth > 0) {
                            const cols = 4;
                            const rows = 4;
                            const tileW = img.width / cols;
                            const tileH = img.height / rows;

                            const tx = (tile.tileIndex % cols) * tileW;
                            const ty = Math.floor(tile.tileIndex / cols) * tileH;

                            const canvasPos = worldToCanvas(tile.x, tile.y);
                            ctx.drawImage(img, tx, ty, tileW, tileH, canvasPos.x, canvasPos.y, charWidth, charHeight);
                        }
                    }

                    // STEP 3: Render note backgrounds/overlays
                    const notes: any[] = [];
                    for (const key in worldData) {
                        if (key.startsWith('note_')) {
                            try {
                                const noteData = JSON.parse(worldData[key] as string);
                                const noteStartX = Math.min(noteData.startX, noteData.endX);
                                const noteEndX = Math.max(noteData.startX, noteData.endX);
                                const noteStartY = Math.min(noteData.startY, noteData.endY);
                                const noteEndY = Math.max(noteData.startY, noteData.endY);

                                // Check if note overlaps with selection
                                if (noteStartX <= selectionEndX && noteEndX >= selectionStartX &&
                                    noteStartY <= selectionEndY && noteEndY >= selectionStartY) {
                                    notes.push(noteData);
                                }
                            } catch (e) {
                                // Skip invalid notes
                            }
                        }
                    }

                    // Render note overlays (semi-transparent backgrounds)
                    for (const note of notes) {
                        const noteStartX = Math.max(Math.min(note.startX, note.endX), selectionStartX);
                        const noteEndX = Math.min(Math.max(note.startX, note.endX), selectionEndX);
                        const noteStartY = Math.max(Math.min(note.startY, note.endY), selectionStartY);
                        const noteEndY = Math.min(Math.max(note.startY, note.endY), selectionEndY);

                        const contentType = note.contentType || (note.imageData ? 'image' : 'text');

                        if (contentType === 'text' && !note.imageData) {
                            // Render semi-transparent overlay for text notes
                            ctx.fillStyle = `rgba(0, 0, 0, 0.05)`;

                            for (let y = noteStartY; y <= noteEndY; y += GRID_CELL_SPAN) {
                                for (let x = noteStartX; x <= noteEndX; x++) {
                                    const canvasPos = worldToCanvas(x, y);
                                    ctx.fillRect(canvasPos.x, canvasPos.y, charWidth, charHeight * GRID_CELL_SPAN);
                                }
                            }
                        }
                    }

                    // STEP 4: Render text content
                    ctx.font = `${charDims.fontSize}px ${modeState.fontFamily}`;
                    ctx.textBaseline = 'top';

                    const isKoreanChar = (char: string) => {
                        const code = char.charCodeAt(0);
                        return code >= 0xAC00 && code <= 0xD7AF;
                    };

                    for (let y = selectionStartY; y <= selectionEndY; y++) {
                        for (let x = selectionStartX; x <= selectionEndX; x++) {
                            const key = `${x},${y}`;
                            const cellData = worldData[key];

                            if (cellData) {
                                const canvasPos = worldToCanvas(x, y);

                                if (typeof cellData === 'string') {
                                    // Simple text character
                                    ctx.fillStyle = modeState.textColor || '#000000';
                                    const kScale = isKoreanChar(cellData) ? 0.8 : 1.0;
                                    ctx.save();
                                    ctx.translate(canvasPos.x, canvasPos.y);
                                    ctx.scale(kScale, 1);
                                    ctx.fillText(cellData, 0, 0);
                                    ctx.restore();
                                } else if (typeof cellData === 'object' && 'char' in cellData) {
                                    // Styled character
                                    const styledChar = cellData as any;
                                    const char = styledChar.char;
                                    const scale = styledChar.scale || { w: 1, h: 1 };

                                    // Draw background if present
                                    if (styledChar.style?.background) {
                                        ctx.fillStyle = styledChar.style.background;
                                        ctx.fillRect(canvasPos.x, canvasPos.y, charWidth * scale.w, charHeight * scale.h);
                                    }

                                    // Draw character
                                    ctx.fillStyle = styledChar.style?.color || modeState.textColor || '#000000';
                                    const kScale = isKoreanChar(char) ? 0.8 : 1.0;
                                    ctx.save();
                                    ctx.translate(canvasPos.x, canvasPos.y);
                                    ctx.scale(kScale * scale.w, scale.h);
                                    ctx.fillText(char, 0, 0);
                                    ctx.restore();
                                }
                            }
                        }
                    }

                    // STEP 5: Render note images
                    const noteImagePromises: Promise<void>[] = [];
                    const noteImagesToRender: Array<{note: any, img: HTMLImageElement}> = [];

                    for (const note of notes) {
                        const imageData = note.imageData || note.content?.imageData;
                        if (imageData && imageData.src) {
                            const img = new Image();
                            img.crossOrigin = "anonymous";

                            const loadPromise = new Promise<void>((resolve) => {
                                img.onload = () => {
                                    noteImagesToRender.push({ note, img });
                                    resolve();
                                };
                                img.onerror = () => resolve();
                                img.src = imageData.src;
                            });
                            noteImagePromises.push(loadPromise);
                        }
                    }

                    // Wait for all note images to load
                    await Promise.all(noteImagePromises);

                    // Render note images
                    for (const { note, img } of noteImagesToRender) {
                        if (img.complete && img.naturalWidth > 0) {
                            const noteStartX = Math.max(Math.min(note.startX, note.endX), selectionStartX);
                            const noteEndX = Math.min(Math.max(note.startX, note.endX), selectionEndX);
                            const noteStartY = Math.max(Math.min(note.startY, note.endY), selectionStartY);
                            const noteEndY = Math.min(Math.max(note.startY, note.endY), selectionEndY);

                            const startPos = worldToCanvas(noteStartX, noteStartY);
                            const endPos = worldToCanvas(noteEndX + 1, noteEndY + 1);
                            const targetWidth = endPos.x - startPos.x;
                            const targetHeight = endPos.y - startPos.y;

                            const aspectRatio = img.width / img.height;
                            const targetAspectRatio = targetWidth / targetHeight;

                            let drawWidth = targetWidth;
                            let drawHeight = targetHeight;
                            let offsetX = 0;
                            let offsetY = 0;

                            if (aspectRatio > targetAspectRatio) {
                                const scaledWidth = targetHeight * aspectRatio;
                                offsetX = (targetWidth - scaledWidth) / 2;
                                drawWidth = scaledWidth;
                            } else {
                                const scaledHeight = targetWidth / aspectRatio;
                                offsetY = (targetHeight - scaledHeight) / 2;
                                drawHeight = scaledHeight;
                            }

                            ctx.save();
                            ctx.beginPath();
                            ctx.rect(startPos.x, startPos.y, targetWidth, targetHeight);
                            ctx.clip();
                            ctx.drawImage(img, startPos.x + offsetX, startPos.y + offsetY, drawWidth, drawHeight);
                            ctx.restore();
                        }
                    }

                    // STEP 6: Draw grid if requested
                    if (includeGrid) {
                        ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
                        ctx.lineWidth = 1 / dpr;

                        // Vertical lines
                        for (let i = 0; i <= selectionWidth; i++) {
                            const x = i * charWidth;
                            ctx.beginPath();
                            ctx.moveTo(x, 0);
                            ctx.lineTo(x, canvasHeight);
                            ctx.stroke();
                        }

                        // Horizontal lines
                        for (let i = 0; i <= selectionHeight; i++) {
                            const y = i * charHeight;
                            ctx.beginPath();
                            ctx.moveTo(0, y);
                            ctx.lineTo(canvasWidth, y);
                            ctx.stroke();
                        }
                    }

                    // STEP 7: Export as PNG and download
                    const dataUrl = exportCanvas.toDataURL('image/png');
                    const link = document.createElement('a');
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    link.download = `nara-export-${timestamp}.png`;
                    link.href = dataUrl;
                    link.click();

                    setDialogueWithRevert(`Exported ${selectionWidth}×${selectionHeight} selection as PNG`, setDialogueText);
                } catch (error) {
                    console.error('Export failed:', error);
                    setDialogueWithRevert("Export failed - check console for details", setDialogueText);
                }
            })();

            // Clear command mode
            clearCommandState();

            return null;
        }

        // Check if this is an unrecognized command - treat as AI prompt
        if (!AVAILABLE_COMMANDS.includes(commandName.toLowerCase())) {
            // This is an AI prompt, not a recognized command
            const aiPrompt = commandToExecute; // Full input is the prompt

            // Clear command mode
            clearCommandState();

            // Return special command for AI chat - world engine will handle the AI call
            // Pass isPermanent flag to differentiate Enter vs Cmd+Enter
            return {
                command: 'ai-chat',
                args: [aiPrompt, isPermanent ? 'permanent' : 'ephemeral'],
                commandStartPos: commandState.commandStartPos
            };
        }

        // Clear command mode for other commands
        clearCommandState();

        if (commandToExecute.toLowerCase().startsWith(commandName.toLowerCase())) {
            const args = inputParts.slice(1);
            return { command: commandName, args, commandStartPos: commandState.commandStartPos };
        }

        return null;
    }, [commandState, switchMode]);

    // Execute pending command with selection
    const executePendingCommand = useCallback((selectedText: string): CommandExecution | null => {
        if (!pendingCommand) return null;
        
        // Clear pending command state
        const cmd = pendingCommand;
        setPendingCommand(null);
        
        // Return the command execution with the selected text as first argument
        return {
            command: cmd.command,
            args: [selectedText, ...cmd.args],
            commandStartPos: { x: 0, y: 0 } // Not relevant for pending commands
        };
    }, [pendingCommand]);

    // Handle pasting text into command mode
    const pasteIntoCommand = useCallback(async (): Promise<{ success: boolean; newLength: number }> => {
        if (!commandState.isActive) return { success: false, newLength: 0 };

        try {
            const clipText = await navigator.clipboard.readText();
            // Replace newlines with spaces to keep command on one line
            const processedText = clipText.replace(/[\r\n]+/g, ' ').trim();

            if (!processedText) return { success: false, newLength: 0 };

            let newLength = 0;

            // Add each character to the command input
            setCommandState(prev => {
                const newInput = prev.input + processedText;
                newLength = newInput.length;
                const newMatchedCommands = matchCommands(newInput);

                // Update command display at original command start position
                const newCommandData = renderCommandDisplay(newInput, newMatchedCommands, prev.commandStartPos);
                setCommandData(newCommandData);

                return {
                    ...prev,
                    input: newInput,
                    matchedCommands: newMatchedCommands,
                    selectedIndex: Math.min(prev.selectedIndex, newMatchedCommands.length - 1),
                };
            });

            return { success: true, newLength };
        } catch (err) {
            console.warn('Could not paste into command:', err);
            return { success: false, newLength: 0 };
        }
    }, [commandState.isActive, matchCommands]);

    // Handle keyboard events for command mode
    const handleKeyDown = useCallback(async (
        key: string,
        cursorPos: Point,
        setCursorPos: (pos: Point | ((prev: Point) => Point)) => void,
        ctrlKey: boolean = false,
        metaKey: boolean = false,
        shiftKey: boolean = false,
        altKey: boolean = false,
        isComposing: boolean = false
    ): Promise<boolean | CommandExecution | null> => {
        const isPermanent = metaKey || ctrlKey; // Track if Cmd/Ctrl+Enter
        // Handle paste in command mode (Cmd+V or Ctrl+V)
        if (commandState.isActive && key === 'v' && (ctrlKey || metaKey)) {
            pasteIntoCommand().then(result => {
                if (result.success) {
                    // Move cursor to end of pasted content
                    // newLength is the input length, +1 for the '/'
                    setCursorPos({
                        x: commandState.commandStartPos.x + result.newLength + 1,
                        y: commandState.commandStartPos.y
                    });
                }
            });
            return true;
        }

        if (!commandState.isActive) {
            // Check if starting command mode with '/'
            if (key === '/') {
                startCommand(cursorPos);
                // Move cursor to next position
                setCursorPos({ x: cursorPos.x + 1, y: cursorPos.y });
                return true;
            }
            return false;
        }

        // Handle command mode keys
        if (key === '/') {
            // If '/' is pressed while command is active, restart command at new position
            startCommand(cursorPos);
            // Move cursor to next position
            setCursorPos({ x: cursorPos.x + 1, y: cursorPos.y });
            return true;
        } else if (key === 'Enter') {
            const originalPos = commandState.originalCursorPos;

            // Record command_enter with full command and position for playback
            // Use the timestamp from when '/' was pressed so it plays back at that moment
            // Skip recording if this is "record stop" to avoid recording the stop command itself
            const fullInput = commandState.input.trim();
            const commandToRecord = commandState.hasNavigated && commandState.matchedCommands.length > 0
                ? commandState.matchedCommands[commandState.selectedIndex]
                : fullInput;
            if (commandToRecord !== 'record stop') {
                recorder?.recordAction('command_enter', {
                    command: commandToRecord,
                    pos: originalPos
                }, commandState.recordingTimestamp);
            }

            const result = executeCommand(isPermanent);

            // Restore camera mode if needed (mobile only)
            restoreCameraModeIfNeeded();

            // Check if command returned a flag to restore cursor
            if (result && typeof result === 'object' && 'restoreCursor' in result && result.restoreCursor) {
                setCursorPos(originalPos);
            }

            return result;
        } else if (key === 'Escape') {
            // Cancel any active composition before exiting
            if (cancelComposition) {
                cancelComposition();
            }

            // Restore camera mode if needed (mobile only)
            restoreCameraModeIfNeeded();

            // Exit command mode without executing and restore cursor to original position
            const originalPos = commandState.originalCursorPos;
            clearCommandState();
            // Restore cursor to original position
            setCursorPos(originalPos);
            return true;
        } else if (key === 'ArrowUp') {
            navigateUp();
            return true;
        } else if (key === 'ArrowDown') {
            navigateDown();
            return true;
        } else if (key === 'Tab') {
            // Tab completion - complete to the currently selected match
            if (commandState.matchedCommands.length >= 1) {
                const selectedCommand = commandState.matchedCommands[commandState.selectedIndex];
                if (selectedCommand) {
                    // Get new suggestions based on the selected command
                    const newMatchedCommands = matchCommands(selectedCommand);

                    // Update command state with the completed command
                    setCommandState(prev => {
                        const newCommandData = drawCommandWithSuggestions(
                            `/${selectedCommand}`,
                            newMatchedCommands,
                            prev.commandStartPos
                        );
                        setCommandData(newCommandData);

                        return {
                            ...prev,
                            input: selectedCommand,
                            matchedCommands: newMatchedCommands,
                            selectedIndex: 0,
                            hasNavigated: true // Mark that user has navigated/completed
                        };
                    });

                    // Move cursor to end of completed command
                    setCursorPos({
                        x: commandState.commandStartPos.x + selectedCommand.length + 1,
                        y: commandState.commandStartPos.y
                    });
                }
            }
            return true;
        } else if (key === 'Backspace') {
            if (metaKey) {
                // Cmd+Backspace: Delete entire command input
                setCommandState(prev => {
                    const newCommandData: WorldData = {};
                    // Keep only the '/' character
                    newCommandData[`${prev.commandStartPos.x},${prev.commandStartPos.y}`] = '/';
                    setCommandData(newCommandData);

                    return {
                        ...prev,
                        input: '',
                        matchedCommands: matchCommands(''),
                        selectedIndex: 0
                    };
                });
                // Move cursor to just after '/'
                setCursorPos({
                    x: commandState.commandStartPos.x + 1,
                    y: commandState.commandStartPos.y
                });
            } else if (altKey) {
                // Option+Backspace: Delete last word
                const words = commandState.input.trim().split(/\s+/);
                if (words.length > 0 && commandState.input.length > 0) {
                    // Remove last word
                    words.pop();
                    const newInput = words.join(' ');

                    setCommandState(prev => {
                        const newMatchedCommands = matchCommands(newInput);

                        // Update command display
                        const newCommandData = renderCommandDisplay(newInput, newMatchedCommands, prev.commandStartPos);
                        setCommandData(newCommandData);

                        return {
                            ...prev,
                            input: newInput,
                            matchedCommands: newMatchedCommands,
                            selectedIndex: 0
                        };
                    });

                    // Move cursor to end of new input
                    setCursorPos({
                        x: commandState.commandStartPos.x + newInput.length + 1, // +1 for the '/'
                        y: commandState.commandStartPos.y
                    });
                }
            } else {
                // Regular backspace
                const result = handleBackspace();
                if (result.shouldMoveCursor) {
                    setCursorPos(prev => ({ x: prev.x - 1, y: prev.y }));
                }
            }
            return true;
        } else if (key.length === 1 && !isComposing) {
            // Add character to command input (skip during IME composition)
            addCharacter(key);
            // Move cursor forward
            setCursorPos(prev => ({ x: prev.x + 1, y: prev.y }));
            return true;
        }

        return false;
    }, [commandState, startCommand, executeCommand, navigateUp, navigateDown, handleBackspace, addCharacter, pasteIntoCommand, restoreCameraModeIfNeeded]);

    // Select a command from dropdown (for click handling)
    const selectCommand = useCallback((selectedCommand: string) => {
        setCommandState(prev => {
            const newMatchedCommands = matchCommands(selectedCommand);
            
            // Update command display
            const newCommandData: WorldData = {};
            const commandText = `/${selectedCommand}`;
            
            // Draw command text at original command start position
            for (let i = 0; i < commandText.length; i++) {
                const key = `${prev.commandStartPos.x + i},${prev.commandStartPos.y}`;
                newCommandData[key] = commandText[i];
            }
            
            // Draw autocomplete suggestions below (if any)
            newMatchedCommands.forEach((command, index) => {
                const suggestionY = prev.commandStartPos.y + GRID_CELL_SPAN + (index * GRID_CELL_SPAN);
                for (let i = 0; i < command.length; i++) {
                    const key = `${prev.commandStartPos.x + i},${suggestionY}`;
                    newCommandData[key] = command[i];
                }
            });
            
            setCommandData(newCommandData);
            
            return {
                ...prev,
                input: selectedCommand,
                matchedCommands: newMatchedCommands,
                selectedIndex: 0,
                hasNavigated: true // Mark as navigated since user clicked
            };
        });
    }, [matchCommands]);

    // Helper method to execute a command from a string (for keyboard shortcuts)
    // This executes immediately without opening the command palette
    const executeCommandString = useCallback((commandString: string) => {
        // Record command execution for playback
        recorder?.recordAction('command_execute', { command: commandString });

        // Strip leading '/' if present
        const normalizedCommand = commandString.startsWith('/') ? commandString.slice(1) : commandString;

        // Parse the command
        const inputParts = normalizedCommand.split(/\s+/);
        const commandName = inputParts[0];

        // Directly execute based on command name
        if (commandName === 'note') {
            // Check if there's a selection
            const existingSelection = getNormalizedSelection?.();
            if (existingSelection) {
                const hasMeaningfulSelection =
                    existingSelection.startX !== existingSelection.endX ||
                    existingSelection.startY !== existingSelection.endY;

                if (hasMeaningfulSelection && setWorldData && worldData && setSelectionStart && setSelectionEnd) {
                    // Create note region
                    const noteRegion = {
                        startX: existingSelection.startX,
                        endX: existingSelection.endX,
                        startY: existingSelection.startY,
                        endY: existingSelection.endY,
                        timestamp: Date.now()
                    };

                    const noteKey = `note_${existingSelection.startX},${existingSelection.startY}_${Date.now()}`;
                    const newWorldData = { ...worldData };
                    newWorldData[noteKey] = JSON.stringify(noteRegion);
                    setWorldData(newWorldData);

                    const { width, height } = calculateSelectionDimensions(existingSelection);
                    setDialogueWithRevert(`Note region saved (${width}×${height})`, setDialogueText);

                    // Clear selection
                    setSelectionStart(null);
                    setSelectionEnd(null);
                } else {
                    setDialogueWithRevert("Selection must span more than one cell", setDialogueText);
                }
            } else {
                setDialogueWithRevert("Make a selection first", setDialogueText);
            }
        } else if (commandName === 'shell') {
            // Convert note to terminal shell - find note at cursor position or use selected note
            if (worldData && setWorldData) {
                let targetNoteKey: string | null = selectedNoteKey || null;
                let targetNoteData: any = null;

                // If no selected note, search for note at cursor position
                if (!targetNoteKey) {
                    const cursorPos = commandState.commandStartPos;
                    const noteKeys = Object.keys(worldData).filter(k => k.startsWith('note_'));

                    for (const key of noteKeys) {
                        try {
                            const noteData = JSON.parse(worldData[key] as string);
                            if (cursorPos.x >= noteData.startX && cursorPos.x <= noteData.endX &&
                                cursorPos.y >= noteData.startY && cursorPos.y <= noteData.endY) {
                                targetNoteKey = key;
                                targetNoteData = noteData;
                                break;
                            }
                        } catch (e) {
                            continue;
                        }
                    }
                }

                if (targetNoteKey) {
                    try {
                        // Parse note data if not already parsed
                        const noteData = targetNoteData || JSON.parse(worldData[targetNoteKey] as string);

                        // Calculate dimensions
                        const cols = noteData.endX - noteData.startX + 1;
                        const rows = Math.floor((noteData.endY - noteData.startY + 1) / GRID_CELL_SPAN);

                        // Get WebSocket URL - use window.location.hostname for proper host resolution
                        const wsUrl = `ws://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:8767`;

                        // Update note with terminal configuration
                        const updatedNote = {
                            ...noteData,
                            contentType: 'terminal',
                            content: {
                                terminalData: {
                                    wsUrl
                                }
                            }
                        };

                        // Save updated note
                        const newWorldData = { ...worldData };
                        newWorldData[targetNoteKey] = JSON.stringify(updatedNote);
                        setWorldData(newWorldData);

                        setDialogueWithRevert(`Terminal shell activated (${cols}×${rows})`, setDialogueText);
                    } catch (error) {
                        console.error('[shell command] Failed to convert note:', error);
                        setDialogueWithRevert("Failed to create terminal shell", setDialogueText);
                    }
                } else {
                    setDialogueWithRevert("Position cursor inside a note first", setDialogueText);
                }
            } else {
                setDialogueWithRevert("Position cursor inside a note first", setDialogueText);
            }
        } else if (commandName === 'publish') {
            // Execute publish command
            // TODO: Implement publish logic or call existing publish function
            setDialogueWithRevert("Publishing canvas...", setDialogueText);
        } else if (commandName === 'bg') {
            // Handle bg command - change background color
            const bgArg = inputParts[1];
            const textColor = inputParts[2];
            const textBackground = inputParts[3];

            if (bgArg) {
                // Check for special cases
                if (bgArg.toLowerCase() === 'video' || bgArg.toLowerCase().endsWith('.mp4')) {
                    const videoUrl = bgArg.toLowerCase() === 'video' ? '/forest.mp4' :
                        (bgArg.startsWith('http') || bgArg.startsWith('/')) ? bgArg : `/${bgArg}`;
                    switchBackgroundMode('video', videoUrl, textColor, textBackground);
                } else {
                    // Color background
                    switchBackgroundMode('color', bgArg, textColor, textBackground);
                }
            } else {
                // Default to white
                switchBackgroundMode('color', '#FFFFFF');
            }
        } else if (commandName === 'chip') {
            // Handle chip command - create a chip at cursor position
            const chipText = inputParts.slice(1).join(' ') || 'chip';
            const chipCursorPos = commandState.commandStartPos;
            if (setWorldData && worldData && chipCursorPos) {
                const chipKey = `chip_${chipCursorPos.x},${chipCursorPos.y}_${Date.now()}`;
                const chipData = {
                    x: chipCursorPos.x,
                    y: chipCursorPos.y,
                    text: chipText,
                    timestamp: Date.now()
                };
                setWorldData({ ...worldData, [chipKey]: JSON.stringify(chipData) });
                setDialogueWithRevert(`Chip created: ${chipText}`, setDialogueText);
            }
        }
    }, [getNormalizedSelection, setWorldData, worldData, setSelectionStart, setSelectionEnd, setDialogueText, selectedNoteKey, commandState.commandStartPos, switchBackgroundMode]);

    // Helper method to activate command with pre-filled input (for Cmd+F search)
    const startCommandWithInput = useCallback((cursorPos: Point, input: string) => {
        startCommand(cursorPos);

        // Pre-fill the input
        const matchedCmds = matchCommands(input);
        setCommandState(prev => ({
            ...prev,
            input,
            matchedCommands: matchedCmds,
            selectedIndex: 0
        }));

        // Update the command data display
        const newCommandData: WorldData = {};
        const commandText = `/${input}`;

        for (let i = 0; i < commandText.length; i++) {
            const key = `${cursorPos.x + i},${cursorPos.y}`;
            newCommandData[key] = commandText[i];
        }

        // Draw suggestions
        matchedCmds.forEach((command, index) => {
            const suggestionY = cursorPos.y + GRID_CELL_SPAN + (index * GRID_CELL_SPAN);
            for (let i = 0; i < command.length; i++) {
                const key = `${cursorPos.x + i},${suggestionY}`;
                newCommandData[key] = command[i];
            }
        });

        setCommandData(newCommandData);
    }, [startCommand, matchCommands]);

    // Helper method to remove trigger character for IME composition
    const removeCompositionTrigger = useCallback(() => {
        setCommandState(prev => {
            // Remove last character from input
            const newInput = prev.input.slice(0, -1);
            const newMatchedCommands = matchCommands(newInput);

            // Update command display
            const newCommandData = renderCommandDisplay(newInput, newMatchedCommands, prev.commandStartPos);
            setCommandData(newCommandData);

            return {
                ...prev,
                input: newInput,
                matchedCommands: newMatchedCommands,
                selectedIndex: Math.min(prev.selectedIndex, newMatchedCommands.length - 1),
            };
        });
    }, [matchCommands]);

    // Helper method to add composed text from IME (Korean, Japanese, Chinese, etc.)
    const addComposedText = useCallback((text: string, startPos: Point) => {
        setCommandState(prev => {
            const newInput = prev.input + text;
            const newMatchedCommands = matchCommands(newInput);

            // Update command display at original command start position
            const newCommandData = renderCommandDisplay(newInput, newMatchedCommands, prev.commandStartPos);
            setCommandData(newCommandData);

            return {
                ...prev,
                input: newInput,
                matchedCommands: newMatchedCommands,
                selectedIndex: Math.min(prev.selectedIndex, newMatchedCommands.length - 1),
            };
        });
    }, [matchCommands]);

    // Function to restore previous background (for ESC after /bg over image)
    const restorePreviousBackground = useCallback(() => {
        if (previousBackgroundStateRef.current) {
            const prev = previousBackgroundStateRef.current;

            if (prev.mode === 'color') {
                switchBackgroundMode('color', prev.color, prev.textColor, prev.textBackground);
            } else if (prev.mode === 'image') {
                switchBackgroundMode('image', prev.image, prev.textColor, prev.textBackground);
            } else if (prev.mode === 'video') {
                switchBackgroundMode('video', prev.video, prev.textColor, prev.textBackground);
            } else if (prev.mode === 'space') {
                switchBackgroundMode('space', undefined, prev.textColor, prev.textBackground);
            } else if (prev.mode === 'transparent') {
                switchBackgroundMode('transparent', undefined, prev.textColor, prev.textBackground);
            }

            previousBackgroundStateRef.current = null;
            return true;
        }
        return false;
    }, [switchBackgroundMode]);

    return {
        commandState,
        commandData,
        handleKeyDown,
        selectCommand,
        executeCommand, // Expose for agent playback
        executeCommandString,
        startCommand, // Expose startCommand for keyboard shortcuts
        startCommandWithInput, // Expose for Cmd+F
        addCharacter, // Expose for agent playback typing
        addComposedText, // Expose for IME composition
        removeCompositionTrigger, // Expose for IME composition start
        isCommandMode: commandState.isActive,
        // Pending command system
        pendingCommand,
        executePendingCommand,
        setPendingCommand,
        // Mode system exports
        modeState,
        switchMode,
        switchBackgroundMode,
        restorePreviousBackground,
        addEphemeralText,
        addAIResponse,
        addInstantAIResponse,
        currentMode: modeState.currentMode,
        lightModeData: modeState.lightModeData,
        backgroundMode: modeState.backgroundMode,
        backgroundColor: modeState.backgroundColor,
        backgroundImage: modeState.backgroundImage,
        backgroundVideo: modeState.backgroundVideo,
        backgroundStream: backgroundStreamRef.current || modeState.backgroundStream,
        textColor: modeState.textColor,
        textBackground: modeState.textBackground,
        fontFamily: modeState.fontFamily,
        currentTextStyle: modeState.currentTextStyle,
        searchPattern: modeState.searchPattern,
        isSearchActive: modeState.isSearchActive,
        clearSearch: () => setModeState(prev => ({ ...prev, searchPattern: '', isSearchActive: false })),
        clearLightModeData: () => setModeState(prev => ({ ...prev, lightModeData: {} })),
        setLightModeData: (data: WorldData) => setModeState(prev => ({ ...prev, lightModeData: data })),
        cameraMode: modeState.cameraMode,
        setCameraMode: (mode: CameraMode) => setModeState(prev => ({ ...prev, cameraMode: mode })),
        isIndentEnabled: modeState.isIndentEnabled,
        isMoveMode: modeState.isMoveMode,
        exitMoveMode: () => setModeState(prev => ({ ...prev, isMoveMode: false })),
        gridMode: modeState.gridMode,
        cycleGridMode: () => setModeState(prev => ({ 
            ...prev, 
            gridMode: prev.gridMode === 'dots' ? 'lines' : 'dots' 
        })),
        artefactsEnabled: modeState.artefactsEnabled,
        artifactType: modeState.artifactType,
        isFullscreenMode: modeState.isFullscreenMode,
        fullscreenRegion: modeState.fullscreenRegion,
        setFullscreenMode: (enabled: boolean, region?: ModeState['fullscreenRegion']) =>
            setModeState(prev => ({ ...prev, isFullscreenMode: enabled, fullscreenRegion: region })),
        exitFullscreenMode: () =>
            setModeState(prev => ({ ...prev, isFullscreenMode: false, fullscreenRegion: undefined })),
        isFaceDetectionEnabled: modeState.isFaceDetectionEnabled,
        faceOrientation: modeState.faceOrientation,
        setFaceDetectionEnabled: (enabled: boolean) =>
            setModeState(prev => ({ ...prev, isFaceDetectionEnabled: enabled })),
        setFaceOrientation: (orientation: any) =>
            setModeState(prev => ({ ...prev, faceOrientation: orientation })),
        isCharacterEnabled: modeState.isCharacterEnabled,
        characterSprite: modeState.characterSprite,
        isGeneratingSprite: modeState.isGeneratingSprite,
        spriteProgress: modeState.spriteProgress,
        spriteDebugLog: modeState.spriteDebugLog,
        // Paint mode
        isPaintMode: modeState.isPaintMode,
        paintTool: modeState.paintTool,
        paintColor: modeState.paintColor,
        paintBrushSize: modeState.paintBrushSize,
        exitPaintMode: () => setModeState(prev => ({ ...prev, isPaintMode: false })),
        setPaintColor: (color: string) => setModeState(prev => ({ ...prev, paintColor: color })),
        setPaintBrushSize: (size: number) => setModeState(prev => ({ ...prev, paintBrushSize: size })),
        setPaintTool: (tool: 'brush' | 'fill' | 'lasso') => setModeState(prev => ({ ...prev, paintTool: tool })),
        // View overlay
        viewOverlay: modeState.viewOverlay,
        exitViewOverlay: () => setModeState(prev => ({ ...prev, viewOverlay: undefined })),
        setViewOverlayScroll: (scrollOffset: number) => setModeState(prev => ({
            ...prev,
            viewOverlay: prev.viewOverlay ? { ...prev.viewOverlay, scrollOffset } : undefined
        })),
        // Agent mode
        isAgentMode: modeState.isAgentMode,
        agentSpriteName: modeState.agentSpriteName,
        isAgentAttached: modeState.isAgentAttached,
        exitAgentMode: () => setModeState(prev => ({ ...prev, isAgentMode: false, agentSpriteName: undefined })),
        setAgentAttached: (attached: boolean) => setModeState(prev => ({ ...prev, isAgentAttached: attached })),
        // Voice mode
        isVoiceMode: modeState.isVoiceMode,
        voiceState: modeState.voiceState,
        setVoiceListening: (isListening: boolean) => setModeState(prev => ({
            ...prev,
            voiceState: prev.voiceState ? { ...prev.voiceState, isListening } : undefined
        })),
        setVoiceProcessing: (isProcessing: boolean) => setModeState(prev => ({
            ...prev,
            voiceState: prev.voiceState ? { ...prev.voiceState, isProcessing } : undefined
        })),
        setVoiceTranscript: (transcript: string) => setModeState(prev => ({
            ...prev,
            voiceState: prev.voiceState ? { ...prev.voiceState, transcript } : undefined
        })),
        setVoiceError: (error?: string) => setModeState(prev => ({
            ...prev,
            voiceState: prev.voiceState ? { ...prev.voiceState, error } : undefined
        })),
        exitVoiceMode: () => setModeState(prev => ({ ...prev, isVoiceMode: false, voiceState: undefined })),
    };
}
