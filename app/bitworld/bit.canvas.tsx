// components/BitCanvas.tsx
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { WorldData, Point, WorldEngine, PanStartInfo, StyledCharacter } from './world.engine'; // Adjust path as needed
import { useDialogue, useDebugDialogue } from './dialogue';
import { useControllerSystem, createCameraController, createGridController, createTapeController, createCommandController } from './controllers';
import { detectTextBlocks, extractLineCharacters, renderFrames, renderHierarchicalFrames, HierarchicalFrame, HierarchyLevel, findTextBlockForSelection } from './bit.blocks';
import { COLOR_MAP, COMMAND_CATEGORIES, COMMAND_HELP } from './commands';
import { useHostDialogue } from './host.dialogue';
import { setDialogueWithRevert } from './ai';
import { CanvasRecorder } from './tape';
import { renderStyledRect, getRectStyle, type CellBounds, type BaseRenderContext } from './styles';
import { useMonogram } from './monogram';

// --- Constants --- (Copied and relevant ones kept)
const GRID_COLOR = '#F2F2F233';
const CURSOR_COLOR_SAVE = '#F2F2F2'; // Green color for saving state
const CURSOR_COLOR_ERROR = '#FF0000'; // Red color for error state
const CURSOR_TEXT_COLOR = '#FFFFFF';
const BACKGROUND_COLOR = '#FFFFFF55';
const DRAW_GRID = true;
const GRID_LINE_WIDTH = 1;
const CURSOR_TRAIL_FADE_MS = 200; // Time in ms for trail to fully fade

// Grid system: Characters span multiple cells vertically (must match world.engine.ts)
const GRID_CELL_SPAN = 2; // Characters occupy 2 vertically-stacked cells



// --- Waypoint Arrow Constants ---
const ARROW_SIZE = 12; // Size of waypoint arrows
const ARROW_MARGIN = 20; // Distance from viewport edge

// ============================================================================
// NOTE-CENTRIC ARCHITECTURE
// Everything is a note - some notes just have attachments
// ============================================================================

/**
 * Image attachment data for notes
 */
interface ImageAttachment {
    src: string;              // Data URL or blob URL
    originalWidth: number;
    originalHeight: number;
    // GIF animation support
    isAnimated?: boolean;
    frameTiming?: Array<{ url: string; delay: number }>;
    totalDuration?: number;
    animationStartTime?: number;
}

/**
 * Unified Note interface - the universal container for all region-spanning content
 *
 * Content types determine function and rendering:
 * - 'text': Text overlay (default)
 * - 'image': Image display
 * - 'iframe': Embedded webpage
 * - 'mail': Email composer
 * - 'bound': Selection/grouping region
 * - 'glitch': Glitch effect region
 * - 'list': Scrollable list
 *
 * All notes work with patterns, styles, and standard operations (move, resize, delete)
 */
interface Note {
    // Bounds (required)
    startX: number;
    endX: number;
    startY: number;
    endY: number;
    timestamp: number;

    // Content type determines function (defaults to 'text' if omitted)
    contentType?: 'text' | 'image' | 'iframe' | 'mail' | 'bound' | 'glitch' | 'list';

    // Visual styling
    style?: string;           // Style name (e.g., "glow", "solid", "glowing")
    patternKey?: string;      // Reference to parent pattern if part of one

    // Content-specific data (based on contentType)
    content?: {
        // Image content
        imageData?: ImageAttachment;
        // Iframe content
        iframeUrl?: string;
        // Mail content
        mailData?: {};
        // List content
        listData?: {
            visibleHeight: number;
            scrollOffset: number;
            color: string;
            title?: string;
        };
        // Bound content (no additional data needed)
        // Glitch content (no additional data needed)
    };

    // Legacy support: top-level properties for backward compatibility
    imageData?: ImageAttachment;
    iframeUrl?: string;
    mailData?: {};
}

// ============================================================================
// NOTE PARSING AND UTILITIES
// ============================================================================

/**
 * Parse note from worldData entry
 * Treats all region-spanning storage formats as unified notes with contentType
 * Supports: note_, image_, iframe_, mail_, bound_, glitched_, list_
 */
function parseNoteFromWorldData(key: string, value: any): Note | null {
    try {
        const data = typeof value === 'string' ? JSON.parse(value) : value;

        // Base note structure (bounds + metadata)
        const baseNote: Note = {
            startX: data.startX,
            endX: data.endX,
            startY: data.startY,
            endY: data.endY,
            timestamp: data.timestamp || Date.now(),
            ...(data.style && { style: data.style }),
            ...(data.patternKey && { patternKey: data.patternKey })
        };

        // Detect content type from key prefix or explicit contentType field
        if (data.contentType) {
            baseNote.contentType = data.contentType;
        } else if (key.startsWith('image_')) {
            baseNote.contentType = 'image';
        } else if (key.startsWith('iframe_')) {
            baseNote.contentType = 'iframe';
        } else if (key.startsWith('mail_')) {
            baseNote.contentType = 'mail';
        } else if (key.startsWith('list_')) {
            baseNote.contentType = 'list';
        } else {
            baseNote.contentType = 'text';
        }

        // Populate content-specific data based on type
        switch (baseNote.contentType) {
            case 'image':
                const imageData: ImageAttachment = {
                    src: data.src,
                    originalWidth: data.originalWidth,
                    originalHeight: data.originalHeight,
                    ...(data.isAnimated && { isAnimated: data.isAnimated }),
                    ...(data.frameTiming && { frameTiming: data.frameTiming }),
                    ...(data.totalDuration && { totalDuration: data.totalDuration }),
                    ...(data.animationStartTime && { animationStartTime: data.animationStartTime })
                };
                // Store in both new and legacy locations for backward compat
                baseNote.content = { imageData };
                baseNote.imageData = imageData;
                break;

            case 'iframe':
                const iframeUrl = data.url || data.iframeUrl;
                baseNote.content = { iframeUrl };
                baseNote.iframeUrl = iframeUrl;
                break;

            case 'mail':
                const mailData = data.mailData || {};
                baseNote.content = { mailData };
                baseNote.mailData = mailData;
                break;

            case 'list':
                baseNote.content = {
                    listData: {
                        visibleHeight: data.visibleHeight || data.endY - data.startY + 1,
                        scrollOffset: data.scrollOffset || 0,
                        color: data.color || '#FFFFFF',
                        title: data.title
                    }
                };
                break;

            case 'bound':
            case 'glitch':
            case 'text':
            default:
                // No additional content data needed
                break;
        }

        return baseNote;
    } catch (e) {
        console.error(`Failed to parse note from key ${key}:`, e);
        return null;
    }
}

/**
 * Check if a point is inside a note
 */
function isPointInNote(point: Point, note: Note): boolean {
    return point.x >= note.startX && point.x <= note.endX &&
           point.y >= note.startY && point.y <= note.endY;
}

/**
 * Find note at a specific position
 * Returns both the key and the note data
 */
function findNoteAtPosition(
    pos: Point,
    worldData: any
): { key: string; note: Note } | null {
    for (const key in worldData) {
        // Check all region-spanning note types
        if (key.startsWith('note_') || key.startsWith('image_') ||
            key.startsWith('iframe_') || key.startsWith('mail_') ||
            key.startsWith('list_')) {

            const note = parseNoteFromWorldData(key, worldData[key]);
            if (note && isPointInNote(pos, note)) {
                return { key, note };
            }
        }
    }
    return null;
}

/**
 * Calculate note dimensions
 */
function getNoteDimensions(note: Note): { width: number; height: number } {
    return {
        width: note.endX - note.startX + 1,
        height: note.endY - note.startY + 1
    };
}

/**
 * Get note type based on contentType (with legacy fallback)
 */
function getNoteType(note: Note): 'text' | 'image' | 'iframe' | 'mail' | 'bound' | 'glitch' | 'list' {
    // Use explicit contentType if available
    if (note.contentType) return note.contentType;

    // Legacy fallback: infer from top-level properties
    if (note.imageData) return 'image';
    if (note.iframeUrl) return 'iframe';
    if (note.mailData) return 'mail';
    return 'text';
}

/**
 * Note rendering context
 * Contains all necessary rendering state and caches
 */
interface NoteRenderContext {
    ctx: CanvasRenderingContext2D;
    engine: any; // WorldEngine interface
    currentZoom: number;
    currentOffset: { x: number; y: number };
    effectiveCharWidth: number;
    effectiveCharHeight: number;
    cssWidth: number;
    cssHeight: number;
    imageCache: Map<string, HTMLImageElement>;
    gifFrameCache: Map<string, { frames: HTMLImageElement[]; delays: number[] }>;
    hexToRgb: (hex: string) => string;
}

/**
 * Unified note rendering function
 * Renders notes based on contentType (text, image, iframe, mail)
 * Note: bound, glitch, and list are rendered separately in the main canvas loop
 */
function renderNote(note: Note, context: NoteRenderContext, renderContext?: BaseRenderContext): void {
    const { ctx, engine, currentZoom, currentOffset, effectiveCharWidth, effectiveCharHeight, cssWidth, cssHeight, hexToRgb } = context;
    const { startX, endX, startY, endY } = note;

    // Get content type (with legacy fallback)
    const contentType = getNoteType(note);

    // Handle different content types
    if (contentType === 'image' && (note.imageData || note.content?.imageData)) {
        // IMAGE NOTE: Render image attachment
        const imageData = note.imageData || note.content?.imageData;
        if (!imageData) return;

        // Check if image is visible in current viewport
        const viewportStartX = Math.floor(-currentOffset.x / currentZoom);
        const viewportEndX = Math.ceil((cssWidth - currentOffset.x) / currentZoom);
        const viewportStartY = Math.floor(-currentOffset.y / currentZoom);
        const viewportEndY = Math.ceil((cssHeight - currentOffset.y) / currentZoom);

        const imageVisible = startX <= viewportEndX && endX >= viewportStartX &&
                            startY <= viewportEndY && endY >= viewportStartY;

        if (!imageVisible) return;

        // Calculate screen positions
        const startScreenPos = engine.worldToScreen(startX, startY, currentZoom, currentOffset);
        const endScreenPos = engine.worldToScreen(endX + 1, endY + 1, currentZoom, currentOffset);
        const targetWidth = endScreenPos.x - startScreenPos.x;
        const targetHeight = endScreenPos.y - startScreenPos.y;

        // Determine which image to use (animated GIF frame or static image)
        let img: HTMLImageElement | undefined;

        if (imageData.isAnimated && imageData.totalDuration && imageData.animationStartTime) {
            const gifData = context.gifFrameCache.get(imageData.src);
            if (gifData && gifData.frames.length > 0) {
                const elapsedMs = Date.now() - imageData.animationStartTime;
                const loopedTime = elapsedMs % imageData.totalDuration;
                let accumulatedTime = 0;
                let frameIndex = 0;

                for (let i = 0; i < gifData.delays.length; i++) {
                    accumulatedTime += gifData.delays[i];
                    if (loopedTime < accumulatedTime) {
                        frameIndex = i;
                        break;
                    }
                }

                img = gifData.frames[frameIndex];
                if (!img || !img.complete || img.naturalWidth === 0) {
                    img = gifData.frames[0];
                }
            } else {
                img = context.imageCache.get(imageData.src);
            }
        } else {
            img = context.imageCache.get(imageData.src);
            if (!img) {
                img = new Image();
                img.src = imageData.src;
                context.imageCache.set(imageData.src, img);
            }
        }

        // Draw image if loaded
        if (img && img.complete && img.naturalWidth > 0) {
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
            ctx.rect(startScreenPos.x, startScreenPos.y, targetWidth, targetHeight);
            ctx.clip();
            ctx.drawImage(img, startScreenPos.x + offsetX, startScreenPos.y + offsetY, drawWidth, drawHeight);
            ctx.restore();
        }

    } else if (contentType === 'iframe') {
        // IFRAME NOTE: Rendered as React component, not on canvas
        return;

    } else if (contentType === 'mail') {
        // MAIL NOTE: Render yellow/amber overlay
        const mailColor = 'rgba(255, 193, 7, 0.15)';
        ctx.fillStyle = mailColor;

        for (let worldY = startY; worldY <= endY; worldY += GRID_CELL_SPAN) {
            for (let worldX = startX; worldX <= endX; worldX++) {
                const bottomScreenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                const topScreenPos = engine.worldToScreen(worldX, worldY - 1, currentZoom, currentOffset);
                if (bottomScreenPos.x >= -effectiveCharWidth && bottomScreenPos.x <= cssWidth &&
                    topScreenPos.y >= -effectiveCharHeight && bottomScreenPos.y <= cssHeight) {
                    ctx.fillRect(topScreenPos.x, topScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                }
            }
        }

    } else {
        // TEXT NOTE: Render with style or default overlay
        if (note.style) {
            const style = getRectStyle(note.style);
            const bounds: CellBounds = {
                x: startX,
                y: startY,
                width: endX - startX + 1,
                height: endY - startY + 1
            };

            const baseRenderContext: BaseRenderContext = renderContext || {
                ctx,
                charWidth: effectiveCharWidth,
                charHeight: effectiveCharHeight,
                timestamp: note.timestamp || Date.now()
            };

            ctx.save();
            const topLeft = engine.worldToScreen(startX, startY, currentZoom, currentOffset);
            ctx.translate(topLeft.x, topLeft.y);

            const screenBounds: CellBounds = {
                x: 0,
                y: 0,
                width: bounds.width,
                height: bounds.height
            };

            renderStyledRect(baseRenderContext, screenBounds, style);
            ctx.restore();
        } else {
            // Default: semi-transparent overlay
            const planColor = `rgba(${hexToRgb(engine.textColor)}, 0.15)`;
            ctx.fillStyle = planColor;

            for (let worldY = startY; worldY <= endY; worldY++) {
                for (let worldX = startX; worldX <= endX; worldX++) {
                    const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                    if (screenPos.x >= -effectiveCharWidth && screenPos.x <= cssWidth &&
                        screenPos.y >= -effectiveCharHeight && screenPos.y <= cssHeight) {
                        ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                    }
                }
            }
        }
    }
}

// ============================================================================

interface CursorTrailPosition {
    x: number;
    y: number;
    timestamp: number;
}


interface BitCanvasProps {
    engine: WorldEngine;
    cursorColorAlternate: boolean;
    className?: string;
    showCursor?: boolean;
    dialogueEnabled?: boolean;
    fontFamily?: string; // Font family for text rendering
    hostModeEnabled?: boolean; // Enable host dialogue mode for onboarding
    initialHostFlow?: string; // Initial flow to start (e.g., 'welcome')
    onAuthSuccess?: (username: string) => void; // Callback after successful auth
    onTutorialComplete?: () => void; // Callback when tutorial is completed
    isVerifyingEmail?: boolean; // Flag to indicate email verification in progress
    hostTextColor?: string; // Text color for host mode
    hostBackgroundColor?: string; // Host background color to save as initial world setting
    onPanDistanceChange?: (distance: number) => void; // Callback for pan distance tracking
    hostDimBackground?: boolean; // Whether to dim background when host dialogue appears
    isPublicWorld?: boolean; // Whether this is a public world (affects sign-up flow)
    monogram?: ReturnType<typeof useMonogram>; // Monogram system for visual effects
}

export function BitCanvas({ engine, cursorColorAlternate, className, showCursor = true, dialogueEnabled = true, fontFamily = 'IBM Plex Mono', hostModeEnabled = false, initialHostFlow, onAuthSuccess, onTutorialComplete, isVerifyingEmail = false, hostTextColor, hostBackgroundColor, onPanDistanceChange, hostDimBackground = true, isPublicWorld = false, monogram: externalMonogram }: BitCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const devicePixelRatioRef = useRef(1);
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
    const [cursorTrail, setCursorTrail] = useState<CursorTrailPosition[]>([]);
    const [agentTrail, setAgentTrail] = useState<CursorTrailPosition[]>([]);
    const [statePublishStatuses, setStatePublishStatuses] = useState<Record<string, boolean>>({});
    const [mouseWorldPos, setMouseWorldPos] = useState<Point | null>(null);
    const [isShiftPressed, setIsShiftPressed] = useState<boolean>(false);
    const [shiftDragStartPos, setShiftDragStartPos] = useState<Point | null>(null);
    const [selectedImageKey, setSelectedImageKey] = useState<string | null>(null);
    const [selectedNoteKey, setSelectedNoteKey] = useState<string | null>(null);
    const [selectedPatternKey, setSelectedPatternKey] = useState<string | null>(null);

    // Resize state
    type ResizeHandle = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';
    const [resizeState, setResizeState] = useState<{
        active: boolean;
        type: 'image' | 'note' | 'iframe' | 'mail' | 'pattern' | null;
        key: string | null;
        handle: ResizeHandle | null;
        originalBounds: { startX: number; startY: number; endX: number; endY: number } | null;
        roomIndex: number | null; // For pattern type: which room in the rooms array (null = pattern boundary)
    }>({
        active: false,
        type: null,
        key: null,
        handle: null,
        originalBounds: null,
        roomIndex: null
    });

    const [selectedIframeKey, setSelectedIframeKey] = useState<string | null>(null);
    const [activeIframeKey, setActiveIframeKey] = useState<string | null>(null); // Double-click activated iframe
    const [selectedMailKey, setSelectedMailKey] = useState<string | null>(null);

    const [clipboardFlashBounds, setClipboardFlashBounds] = useState<Map<string, number>>(new Map()); // boundKey -> timestamp
    const lastCursorPosRef = useRef<Point | null>(null);
    const lastEnterPressRef = useRef<number>(0);
    const [isPasswordVisible, setIsPasswordVisible] = useState<boolean>(false);

    // Sync selectedNoteKey with engine for cross-compatibility with selection-based commands
    useEffect(() => {
        engine.setSelectedNoteKey(selectedNoteKey);
    }, [selectedNoteKey, engine]);

    // Track host mode dim fade-in (should only happen once when host mode activates)
    const hostDimFadeStartRef = useRef<number | null>(null);
    const hasHostDimFadedInRef = useRef<boolean>(false);

    // Pan distance monitoring
    const [panDistance, setPanDistance] = useState<number>(0);
    const [isPanning, setIsPanning] = useState<boolean>(false);
    const panStartPosRef = useRef<Point | null>(null);
    const lastPanMilestoneRef = useRef<number>(0); // Track last logged milestone
    const PAN_MILESTONE_INTERVAL = 25; // Log every 25 cells

    // Viewport center tracking for total distance
    const [totalPannedDistance, setTotalPannedDistance] = useState<number>(0);
    const lastCenterCellRef = useRef<Point | null>(null);
    const lastDistanceMilestoneRef = useRef<number>(0);
    const hasTriggeredSignupPromptRef = useRef<boolean>(false); // Track if we've already prompted signup
    const hasInitializedPanTrackingRef = useRef<boolean>(false); // Track if we've set initial position
    const [isWorldReady, setIsWorldReady] = useState<boolean>(false); // Track if world is ready for signup prompts

    // Canvas recorder for /tape command
    const recorderRef = useRef<CanvasRecorder | null>(null);

    // Screenshot state for Open Graph previews
    const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
    const [showScreenshot, setShowScreenshot] = useState<boolean>(false);
    const [isCanvasReady, setIsCanvasReady] = useState<boolean>(false);
    const hasLoadedScreenshotRef = useRef<boolean>(false); // Prevent multiple loads

    // Initialize canvas recorder
    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas && !recorderRef.current) {
            recorderRef.current = new CanvasRecorder(canvas, 60); // 60fps for smooth recordings
        }
    }, []);

    // Toggle tape recording
    const toggleRecording = useCallback(async () => {
        if (!recorderRef.current) return;

        if (recorderRef.current.getIsRecording()) {
            // Stop recording and download
            await recorderRef.current.stop();
            engine.setDialogueText('Recording stopped. Downloading...');
        } else {
            // Start recording
            recorderRef.current.start();
            engine.setDialogueText('Recording started. Press Cmd+E to stop.');
        }
    }, [engine]);

    // Capture canvas screenshot for Open Graph previews
    const captureScreenshot = useCallback(async (): Promise<string | null> => {
        const canvas = canvasRef.current;

        if (!canvas) {
            return null;
        }

        try {

            // Resize to max 1200px width for og:image (Twitter/OG standard)
            const maxWidth = 1200;
            const scale = Math.min(1, maxWidth / canvas.width);

            if (scale < 1) {
                // Create smaller canvas for compression
                const smallCanvas = document.createElement('canvas');
                smallCanvas.width = canvas.width * scale;
                smallCanvas.height = canvas.height * scale;
                const ctx = smallCanvas.getContext('2d');

                if (ctx) {
                    ctx.drawImage(canvas, 0, 0, smallCanvas.width, smallCanvas.height);

                    // Convert to grayscale for smaller file size
                    const imageData = ctx.getImageData(0, 0, smallCanvas.width, smallCanvas.height);
                    const data = imageData.data;
                    for (let i = 0; i < data.length; i += 4) {
                        const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                        data[i] = gray;     // red
                        data[i + 1] = gray; // green
                        data[i + 2] = gray; // blue
                    }
                    ctx.putImageData(imageData, 0, 0);

                    // Use JPEG with 0.8 quality for smaller file size
                    const dataUrl = smallCanvas.toDataURL('image/jpeg', 0.8);
                    return dataUrl;
                }
            }

            // Fallback: grayscale on original size
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            const tempCtx = tempCanvas.getContext('2d');

            if (tempCtx) {
                tempCtx.drawImage(canvas, 0, 0);
                const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
                const data = imageData.data;
                for (let i = 0; i < data.length; i += 4) {
                    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                    data[i] = gray;
                    data[i + 1] = gray;
                    data[i + 2] = gray;
                }
                tempCtx.putImageData(imageData, 0, 0);
                const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.8);
                return dataUrl;
            }

            // Last fallback: color JPEG
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            return dataUrl;
        } catch (error) {
            console.error('❌ Failed to capture screenshot:', error);
            return null;
        }
    }, []);

    // Register tape recording callback with engine for /tape command
    useEffect(() => {
        engine.setTapeRecordingCallback(toggleRecording);
    }, [engine, toggleRecording]);

    // Register screenshot callback with engine for /publish command
    const hasRegisteredScreenshotRef = useRef<boolean>(false);
    useEffect(() => {
        if (hasRegisteredScreenshotRef.current) return;
        engine.setScreenshotCallback(captureScreenshot);
        hasRegisteredScreenshotRef.current = true;
    }, [engine, captureScreenshot]);

    // Screenshot loading is now handled by:
    // 1. page.tsx for loading screen UX
    // 2. layout.tsx og:image meta tags for crawlers (Embedly, etc.)

    // Mark canvas as ready once worldData has loaded
    useEffect(() => {
        // Consider canvas ready once we have worldData or after a short delay
        const timer = setTimeout(() => {
            setIsCanvasReady(true);
            // Fade out screenshot after canvas is ready
            if (showScreenshot) {
                setTimeout(() => setShowScreenshot(false), 100);
            }
        }, 500); // 500ms delay for canvas to render

        return () => clearTimeout(timer);
    }, [engine.worldData, showScreenshot]);

    // Reset input focus when entering command mode to disable IME (desktop only)
    useEffect(() => {
        if (engine.commandState.isActive && hiddenInputRef.current) {
            // Check if we're on mobile (touch device)
            const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
            
            if (isMobile) {
                // Mobile: just maintain focus to keep keyboard open
                hiddenInputRef.current.focus();
            } else {
                // Desktop: blur and refocus to reset IME composition state
                hiddenInputRef.current.blur();
                setTimeout(() => {
                    if (hiddenInputRef.current) {
                        hiddenInputRef.current.focus();
                    }
                }, 0);
            }
        }
    }, [engine.commandState.isActive]);

    // Track shift key state globally
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Shift') {
                setIsShiftPressed(true);
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'Shift') {
                setIsShiftPressed(false);
                // Clear shift drag state when shift is released
                setShiftDragStartPos(null);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, []);


        // Zoom handler for host dialogue
    const handleZoom = useCallback((targetZoomMultiplier: number, centerPos: Point) => {
        const startZoom = engine.zoomLevel;
        const targetZoom = startZoom * targetZoomMultiplier;
        const duration = 500; // 500ms animation
        const startTime = Date.now();

        const animateZoom = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Easing function for smooth animation (ease-out)
            const easeProgress = 1 - Math.pow(1 - progress, 3);

            const currentZoom = startZoom + (targetZoom - startZoom) * easeProgress;
            engine.setZoomLevel(currentZoom);

            if (progress < 1) {
                requestAnimationFrame(animateZoom);
            }
        };

        requestAnimationFrame(animateZoom);
    }, [engine]);

        // Host dialogue system for onboarding
    const hostDialogue = useHostDialogue({
        setHostData: engine.setHostData,
        getViewportCenter: engine.getViewportCenter,
        setDialogueText: engine.setDialogueText,
        onAuthSuccess,
        onTriggerZoom: handleZoom,
        setHostMode: engine.setHostMode,
        setChatMode: engine.setChatMode,
        addEphemeralText: engine.addInstantAIResponse ?
            (pos, char, options) => {
                // Use addInstantAIResponse to render single character
                engine.addInstantAIResponse(pos, char, {
                    fadeDelay: options?.animationDelay || 1500,
                    color: options?.color,
                    wrapWidth: 1 // Single character
                });
            } : undefined,
        setWorldData: engine.setWorldData,
        hostBackgroundColor: hostBackgroundColor,
        isPublicWorld: isPublicWorld,
        setBackgroundColor: (color: string) => {
            console.log('[BitCanvas] setBackgroundColor called with:', color);
            console.log('[BitCanvas] Current engine backgroundColor:', engine.settings.backgroundColor);
            engine.updateSettings({ backgroundColor: color });
            console.log('[BitCanvas] Engine backgroundColor after update:', engine.settings.backgroundColor);
        },
        setBackgroundMode: (mode: 'color' | 'image' | 'video' | 'transparent') => {
            console.log('[BitCanvas] setBackgroundMode called with:', mode);
            console.log('[BitCanvas] Current engine backgroundMode:', engine.backgroundMode);
            // Background mode is controlled by command system, call switchBackgroundMode
            engine.switchBackgroundMode(mode as any, engine.backgroundImage || '', engine.textColor);
            console.log('[BitCanvas] Engine backgroundMode after update:', engine.backgroundMode);
        },
        setBackgroundImage: (imageUrl: string) => {
            console.log('[BitCanvas] setBackgroundImage called with:', imageUrl);
            console.log('[BitCanvas] Current engine backgroundImage:', engine.backgroundImage);
            // Switch to image mode with the provided URL
            engine.switchBackgroundMode('image' as any, imageUrl, engine.textColor);
            console.log('[BitCanvas] Engine backgroundImage after update:', engine.backgroundImage);
        }
    });

    // Handle email verification flow
    useEffect(() => {
        if (isVerifyingEmail && hostModeEnabled && !hostDialogue.isHostActive) {
            // Check if user already has a username (existing user)
            const checkExistingUser = async () => {
                const { auth } = require('../firebase');
                const { getUserProfile } = require('../firebase');
                const user = auth.currentUser;

                if (user) {
                    const profile = await getUserProfile(user.uid);

                    // If user already has a username, they're an existing user - just redirect
                    if (profile && profile.username) {
                        // Redirect immediately to their world
                        const router = require('next/navigation').useRouter;
                        window.location.href = `/${profile.username}`;
                        return;
                    }
                }

                // New user without username - show verification flow
                engine.setHostMode({ isActive: true, currentInputType: null });
                engine.setChatMode({
                    isActive: true,
                    currentInput: '',
                    inputPositions: [],
                    isProcessing: false
                });


                engine.setHostData({
                    text: 'email verified!',
                    color: '#00AA00',
                    centerPos: engine.getViewportCenter(),
                    timestamp: Date.now()
                });

                if (canvasRef.current) {
                    canvasRef.current.focus();
                }

                setTimeout(() => {
                    hostDialogue.startFlow('verification');
                }, 2000);
            };

            checkExistingUser();
        }
    }, [isVerifyingEmail, hostModeEnabled, hostDialogue.isHostActive, engine, hostDialogue]);

    // Listen for auth state changes (when user verifies email in another tab)
    // DISABLED: This was auto-prompting for username on every page load
    // useEffect(() => {
    //     if (!hostModeEnabled || hostDialogue.isHostActive) return;

    //     const { auth } = require('../firebase');
    //     const { onAuthStateChanged } = require('firebase/auth');

    //     const unsubscribe = onAuthStateChanged(auth, async (user: any) => {
    //         if (user && !hostDialogue.isHostActive) {
    //             const { getUserProfile } = require('../firebase');
    //             const profile = await getUserProfile(user.uid);

    //             if (profile && !profile.username) {
    //                 engine.setHostMode({ isActive: true, currentInputType: null });
    //                 engine.setChatMode({
    //                     isActive: true,
    //                     currentInput: '',
    //                     inputPositions: [],
    //                     isProcessing: false
    //                 });

    //                 if (engine.updateSettings) {
    //                     engine.updateSettings({ textColor: '#FFA500' });
    //                 }

    //                 engine.setHostData({
    //                     text: 'email verified!',
    //                     color: '#00AA00',
    //                     centerPos: engine.getViewportCenter(),
    //                     timestamp: Date.now()
    //                 });

    //                 if (canvasRef.current) {
    //                     canvasRef.current.focus();
    //                 }

    //                 setTimeout(() => {
    //                     hostDialogue.startFlow('verification');
    //                 }, 2000);
    //             }
    //         }
    //     });

    //     return () => unsubscribe();
    // }, [hostModeEnabled, hostDialogue, engine]);

    // No animation - host text renders immediately (removed typing animation)

    // Track if initial host flow has been started (prevent restart after authentication)
    const hasStartedInitialFlowRef = useRef(false);
    const previousCameraModeRef = useRef<'default' | 'focus' | null>(null); // Store camera mode before host flow

    // Start host flow when enabled (only once)
    useEffect(() => {
        if (hostModeEnabled && initialHostFlow && !hostDialogue.isHostActive && !hasStartedInitialFlowRef.current) {
            // Mark as started to prevent restart after authentication completes
            hasStartedInitialFlowRef.current = true;

            // Set host mode colors
            // The background is already set via initialBackgroundColor in page.tsx
            // Set text color if provided
            if (hostTextColor && engine.updateSettings) {
                engine.updateSettings({
                    textColor: hostTextColor
                });
            }

            // Save current camera mode and switch to focus mode (prevents virtual keyboard obscuring input)
            previousCameraModeRef.current = engine.cameraMode;
            if (engine.cameraMode !== 'focus') {
                engine.setCameraMode('focus');
            }

            // Activate host mode in engine
            engine.setHostMode({ isActive: true, currentInputType: null });
            // Activate chat mode for input
            engine.setChatMode({
                isActive: true,
                currentInput: '',
                inputPositions: [],
                isProcessing: false
            });
            // Start the flow
            hostDialogue.startFlow(initialHostFlow);

            // Auto-focus canvas so typing works immediately without clicking
            if (canvasRef.current) {
                canvasRef.current.focus();
            }
        }
    }, [hostModeEnabled, initialHostFlow, hostDialogue.isHostActive, hostTextColor]);

    // Restore camera mode when host flow exits
    const wasHostActiveRef = useRef(false);
    useEffect(() => {
        // Track when host mode transitions from active to inactive
        if (wasHostActiveRef.current && !hostDialogue.isHostActive) {
            // Host flow just exited - restore previous camera mode
            if (previousCameraModeRef.current !== null) {
                engine.setCameraMode(previousCameraModeRef.current);
                previousCameraModeRef.current = null;
            }
        }
        wasHostActiveRef.current = hostDialogue.isHostActive;
    }, [hostDialogue.isHostActive]);

    // Sync host input type with engine for password masking
    useEffect(() => {
        if (hostDialogue.isHostActive) {
            const inputType = hostDialogue.getCurrentInputType();
            const currentInputType = engine.hostMode.currentInputType;
            // Only update if actually changed to avoid infinite loop
            if (currentInputType !== inputType) {
                engine.setHostMode({ isActive: true, currentInputType: inputType });
                // Reset password visibility when moving away from password input
                if (inputType !== 'password') {
                    setIsPasswordVisible(false);
                }
            }
        }
    }, [hostDialogue.isHostActive, hostDialogue.hostState.currentMessageId]);

    // Mark world as ready after initial settling period (2 seconds after mount)
    // This allows spawn points and initial view to settle before enabling signup prompts
    useEffect(() => {
        const readyTimeout = setTimeout(() => {
            setIsWorldReady(true);
        }, 2000);
        
        return () => clearTimeout(readyTimeout);
    }, []); // Run once on mount

    // Track viewport center cell position and calculate total panned distance
    useEffect(() => {
        const interval = setInterval(() => {
            if (typeof window === 'undefined' || !canvasRef.current) return;

            const { width: effectiveCharWidth, height: effectiveCharHeight } = engine.getEffectiveCharDims(engine.zoomLevel);
            if (effectiveCharWidth <= 0 || effectiveCharHeight <= 0) return;

            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            // Calculate center cell coordinate
            const centerCellX = Math.round(engine.viewOffset.x + (viewportWidth / 2) / effectiveCharWidth);
            const centerCellY = Math.round(engine.viewOffset.y + (viewportHeight / 2) / effectiveCharHeight);

            // Initialize position on first run (don't count as panning)
            if (!hasInitializedPanTrackingRef.current) {
                lastCenterCellRef.current = { x: centerCellX, y: centerCellY };
                hasInitializedPanTrackingRef.current = true;
                return;
            }

            if (lastCenterCellRef.current) {
                const dx = centerCellX - lastCenterCellRef.current.x;
                const dy = centerCellY - lastCenterCellRef.current.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance > 0) {
                    const newTotal = totalPannedDistance + distance;
                    setTotalPannedDistance(newTotal);

                    // Notify parent component of pan distance change
                    if (onPanDistanceChange) {
                        onPanDistanceChange(newTotal);
                    }

                    // Check for milestones
                    const currentMilestone = Math.floor(newTotal / PAN_MILESTONE_INTERVAL);
                    if (currentMilestone > lastDistanceMilestoneRef.current) {
                        lastDistanceMilestoneRef.current = currentMilestone;
                    }

                    // Check for 100 cell threshold - trigger signup for unauthenticated users
                    // Only trigger after world is ready (settled from spawn points, etc.)
                    if (newTotal >= 100 && !hasTriggeredSignupPromptRef.current && isWorldReady) {
                        hasTriggeredSignupPromptRef.current = true;

                        // Check if user is authenticated
                        const { auth } = require('../firebase');
                        const user = auth.currentUser;

                        if (!user && hostDialogue && !hostDialogue.isHostActive) {

                            // Activate host mode in engine
                            engine.setHostMode({ isActive: true, currentInputType: null });

                            // Activate chat mode for input
                            engine.setChatMode({
                                isActive: true,
                                currentInput: '',
                                inputPositions: [],
                                isProcessing: false
                            });

                            hostDialogue.startFlow('welcome');
                        }
                    }
                }
            }

            lastCenterCellRef.current = { x: centerCellX, y: centerCellY };
        }, 100); // Check every 100ms

        return () => clearInterval(interval);
    }, [engine.viewOffset, engine.zoomLevel, totalPannedDistance, PAN_MILESTONE_INTERVAL, engine, hostDialogue]);

    const router = useRouter();
    
    // Cache for background images to avoid reloading
    const backgroundImageRef = useRef<HTMLImageElement | null>(null);
    const backgroundImageUrlRef = useRef<string | null>(null);
    
    // Cache for background videos to avoid reloading
    const backgroundVideoRef = useRef<HTMLVideoElement | null>(null);
    const backgroundVideoUrlRef = useRef<string | null>(null);
    
    // Cache for background stream (webcam) video element
    const backgroundStreamVideoRef = useRef<HTMLVideoElement | null>(null);
    
    // Cache for uploaded images to avoid reloading
    const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());

    // Cache for parsed GIF frame data
    const gifFrameCache = useRef<Map<string, { frames: HTMLImageElement[], delays: number[] }>>(new Map());

    // Preload all images immediately when worldData changes (don't wait for viewport)
    useEffect(() => {
        const loadGIFFrames = (frameTiming: Array<{ url: string; delay: number }>, cacheKey: string) => {
            if (gifFrameCache.current.has(cacheKey)) return; // Already cached

            try {
                const frameImages: HTMLImageElement[] = [];
                const frameDelays: number[] = [];

                for (const frame of frameTiming) {
                    // Create image from URL
                    const img = new Image();
                    img.src = frame.url;
                    frameImages.push(img);
                    frameDelays.push(frame.delay);
                }

                // Cache all frames and delays
                gifFrameCache.current.set(cacheKey, { frames: frameImages, delays: frameDelays });
            } catch (error) {
                console.error('Error loading GIF frames:', error);
            }
        };

        for (const key in engine.worldData) {
            if (key.startsWith('image_')) {
                const imageData = engine.worldData[key];
                if (engine.isImageData(imageData)) {
                    // Preload main image
                    if (!imageCache.current.has(imageData.src)) {
                        const img = new Image();
                        img.src = imageData.src;
                        imageCache.current.set(imageData.src, img);
                    }

                    // Load GIF frames if animated
                    if (imageData.isAnimated && imageData.frameTiming && !gifFrameCache.current.has(imageData.src)) {
                        loadGIFFrames(imageData.frameTiming, imageData.src);
                    }
                }
            }
        }
    }, [engine.worldData, engine.isImageData]);

    // Dialogue system
    const { renderDialogue, renderDebugDialogue, renderNavDialogue, handleNavClick } = useDialogue();

    // Debug dialogue system
    const { debugText } = useDebugDialogue(engine);

    // Monogram system (ephemeral GPU-accelerated background)
    // Use external monogram if provided, otherwise create internal one
    const internalMonogram = useMonogram({ enabled: true, speed: 0.5, complexity: 1.0 });
    const monogram = externalMonogram || internalMonogram;

    // Preload monogram chunks when viewport changes
    useEffect(() => {
        if (!monogram.isInitialized) return;

        const effectiveCharDims = engine.getEffectiveCharDims(engine.zoomLevel);
        const startWorldX = engine.viewOffset.x;
        const startWorldY = engine.viewOffset.y;
        const endWorldX = startWorldX + (canvasSize.width / effectiveCharDims.width);
        const endWorldY = startWorldY + (canvasSize.height / effectiveCharDims.height);

        const x1 = Math.floor(startWorldX) - 5;
        const y1 = Math.floor(startWorldY) - 5;
        const x2 = Math.ceil(endWorldX) + 5;
        const y2 = Math.ceil(endWorldY) + 5;

        monogram.preloadViewport(x1, y1, x2, y2);
    }, [engine.viewOffset.x, engine.viewOffset.y, engine.zoomLevel, canvasSize, monogram.isInitialized]);

    // Continuously preload chunks for smooth animation even when static (60fps!)
    useEffect(() => {
        if (!monogram.isInitialized || !monogram.options.enabled) return;

        let animationFrameId: number;

        const refreshChunks = () => {
            const effectiveCharDims = engine.getEffectiveCharDims(engine.zoomLevel);
            const startWorldX = engine.viewOffset.x;
            const startWorldY = engine.viewOffset.y;
            const endWorldX = startWorldX + (canvasSize.width / effectiveCharDims.width);
            const endWorldY = startWorldY + (canvasSize.height / effectiveCharDims.height);

            monogram.preloadViewport(
                Math.floor(startWorldX) - 5,
                Math.floor(startWorldY) - 5,
                Math.ceil(endWorldX) + 5,
                Math.ceil(endWorldY) + 5
            );

            animationFrameId = requestAnimationFrame(refreshChunks);
        };

        animationFrameId = requestAnimationFrame(refreshChunks);

        return () => cancelAnimationFrame(animationFrameId);
    }, [engine.viewOffset.x, engine.viewOffset.y, engine.zoomLevel, canvasSize, monogram.isInitialized, monogram.options.enabled]);

    // Helper function to generate talking mouth animation
    const generateTalkingMouth = useCallback((elapsed: number): number => {
        // Varying mouth open/close pattern (not just sine wave - more natural)
        const time = elapsed * 0.01; // Convert to smoother time scale

        // Combine multiple frequencies for natural variation
        const primary = Math.sin(time * 2.3) * 0.5 + 0.5; // Main talking rhythm
        const secondary = Math.sin(time * 3.7) * 0.3 + 0.3; // Variation
        const tertiary = Math.sin(time * 1.1) * 0.2 + 0.2; // Slower modulation

        // Combine and scale to mouth open range (0 to 0.4 for talking)
        const combined = (primary * 0.5 + secondary * 0.3 + tertiary * 0.2);
        const mouthOpen = combined * 0.4;

        return mouthOpen;
    }, []);

    // State to trigger updates during AI talking
    const [aiTalkingTick, setAiTalkingTick] = useState(0);

    // Continuous update loop while AI is talking
    useEffect(() => {
        // Check both dialogueText (for AI responses) and hostData (for host dialogue)
        const dialogueTimestamp = engine.dialogueTimestamp || engine.hostData?.timestamp;
        const dialogueTextContent = engine.dialogueText || engine.hostData?.text;
        const isAITalking = dialogueTimestamp && dialogueTextContent;

        if (!isAITalking) return;

        // Update at ~30fps while AI is talking
        // Keep talking as long as there's dialogue text (don't limit by duration)
        const interval = setInterval(() => {
            setAiTalkingTick(tick => tick + 1);
        }, 33); // ~30fps

        return () => clearInterval(interval);
    }, [engine.dialogueText, engine.dialogueTimestamp, engine.hostData]);


    // Host dialogue flow handler
    const handleHostDialogueFlow = useCallback(() => {
        // Activate host mode
        engine.setHostMode({ isActive: true, currentInputType: null });

        // Activate chat mode for input
        engine.setChatMode({
            isActive: true,
            currentInput: '',
            inputPositions: [],
            isProcessing: false
        });

        // Start the welcome flow (handles authentication)
        hostDialogue.startFlow('welcome');
    }, [engine, hostDialogue]);

    // Register host dialogue handler with engine
    useEffect(() => {
        engine.setHostDialogueHandler(handleHostDialogueFlow);
    }, [engine, handleHostDialogueFlow]);

    // Upgrade flow handler
    const handleUpgradeFlow = useCallback(() => {
        // Activate host mode
        engine.setHostMode({ isActive: true, currentInputType: null });

        // Activate chat mode for input
        engine.setChatMode({
            isActive: true,
            currentInput: '',
            inputPositions: [],
            isProcessing: false
        });

        // Start the upgrade flow
        hostDialogue.startFlow('upgrade');
    }, [engine, hostDialogue]);

    // Register upgrade flow handler with engine
    useEffect(() => {
        engine.setUpgradeFlowHandler(handleUpgradeFlow);
    }, [engine, handleUpgradeFlow]);

    // Tutorial flow handler
    const handleTutorialFlow = useCallback(() => {
        // Activate host mode
        engine.setHostMode({ isActive: true, currentInputType: null });

        // Do NOT activate chat mode - tutorial validates actual commands on canvas
        // Chat mode will be controlled by individual messages via requiresChatMode field

        // Start the tutorial flow
        hostDialogue.startFlow('tutorial');
    }, [engine, hostDialogue]);

    // Register tutorial flow handler with engine
    useEffect(() => {
        engine.setTutorialFlowHandler(handleTutorialFlow);
    }, [engine, handleTutorialFlow]);

    // Register command validation handler with engine (for tutorial)
    useEffect(() => {
        engine.setCommandValidationHandler((command: string, args: string[], worldState?: any) => {
            return hostDialogue.validateCommand(command, args, worldState);
        });
    }, [engine, hostDialogue]);

    // Monitor tutorial completion
    const prevTutorialActiveRef = useRef(false);
    useEffect(() => {
        const isTutorialActive = hostDialogue.hostState.isActive && hostDialogue.hostState.currentFlowId === 'tutorial';

        // If tutorial was active and now is not, it completed
        if (prevTutorialActiveRef.current && !isTutorialActive && onTutorialComplete) {
            onTutorialComplete();
        }

        prevTutorialActiveRef.current = isTutorialActive;
    }, [hostDialogue.hostState.isActive, hostDialogue.hostState.currentFlowId, onTutorialComplete]);

    // Track clipboard additions for visual feedback
    const prevClipboardLengthRef = useRef(0);
    useEffect(() => {
        const currentLength = engine.clipboardItems.length;

        // If clipboard length increased, a new item was added
        if (currentLength > prevClipboardLengthRef.current) {
            const newItem = engine.clipboardItems[0]; // Most recent is first
            if (newItem) {
                const flashKey = `flash_${newItem.startX},${newItem.startY}`;
                const timestamp = Date.now();

                setClipboardFlashBounds(prev => {
                    const updated = new Map(prev);
                    updated.set(flashKey, timestamp);
                    return updated;
                });

                // Remove flash after 800ms
                setTimeout(() => {
                    setClipboardFlashBounds(prev => {
                        const updated = new Map(prev);
                        updated.delete(flashKey);
                        return updated;
                    });
                }, 800);
            }
        }

        prevClipboardLengthRef.current = currentLength;
    }, [engine.clipboardItems]);


    // Controller system for handling keyboard inputs
    const { registerGroup, handleKeyDown: handleKeyDownFromController, getHelpText } = useControllerSystem();

    // Handle navigation coordinate clicks
    const handleCoordinateClick = useCallback((x: number, y: number) => {
        // Close nav dialogue first
        engine.setIsNavVisible(false);
        
        // Navigate camera to coordinates
        engine.setViewOffset({ x: x - (canvasSize.width / engine.getEffectiveCharDims(engine.zoomLevel).width) / 2, 
                               y: y - (canvasSize.height / engine.getEffectiveCharDims(engine.zoomLevel).height) / 2 });
    }, [engine, canvasSize, router]);

    // Handle color filter clicks
    const handleColorFilterClick = useCallback((color: string) => {
        engine.toggleColorFilter(color);
    }, [engine]);

    // Handle sort mode clicks  
    const handleSortModeClick = useCallback(() => {
        engine.cycleSortMode();
    }, [engine]);
    
    // Handle state clicks
    const handleStateClick = useCallback((state: string) => {
        if (engine.username) {
            router.push(`/@${engine.username}/${state}`);
        }
    }, [engine.username, router]);
    
    // Handle index clicks
    const handleIndexClick = useCallback(() => {
        engine.toggleNavMode();
    }, [engine]);
    
    // Load publish statuses for all states
    const loadStatePublishStatuses = useCallback(async () => {
        if (!engine.userUid || engine.availableStates.length === 0) return;
        
        try {
            const { database } = await import('@/app/firebase');
            const { ref, get } = await import('firebase/database');
            const statuses: Record<string, boolean> = {};
            
            for (const state of engine.availableStates) {
                const publicRef = ref(database, `worlds/${engine.userUid}/${state}/public`);
                const snapshot = await get(publicRef);
                statuses[state] = snapshot.exists() && snapshot.val() === true;
            }
            
            setStatePublishStatuses(statuses);
        } catch (error) {
            console.error('Error loading publish statuses:', error);
        }
    }, [engine.userUid, engine.availableStates]);
    
    // Check if a state is published (from cached statuses)
    const getStatePublishStatus = useCallback((state: string): boolean => {
        return statePublishStatuses[state] || false;
    }, [statePublishStatuses]);
    
    // Handle publish/unpublish clicks
    const handlePublishClick = useCallback(async (state: string) => {
        const isCurrentlyPublished = getStatePublishStatus(state);
        const action = isCurrentlyPublished ? 'Unpublishing' : 'Publishing';
        setDialogueWithRevert(`${action} state...`, engine.setDialogueText);

        try {
            // Use the same Firebase logic as the /publish command
            const { database } = await import('@/app/firebase');
            const { ref, set } = await import('firebase/database');
            const userUid = engine.userUid || 'anonymous';
            const stateRef = ref(database, `worlds/${userUid}/${state}/public`);
            await set(stateRef, !isCurrentlyPublished); // Toggle publish status

            const statusText = isCurrentlyPublished ? 'private' : 'public';
            setDialogueWithRevert(`State "${state}" is now ${statusText}`, engine.setDialogueText);

            // Update cached status
            setStatePublishStatuses(prev => ({
                ...prev,
                [state]: !isCurrentlyPublished
            }));
        } catch (error: any) {
            setDialogueWithRevert(`Error ${action.toLowerCase()} state: ${error.message}`, engine.setDialogueText);
        }
        
        engine.setIsNavVisible(false);
    }, [engine, getStatePublishStatus]);
    
    // Handle navigate clicks
    const handleNavigateClick = useCallback((state: string) => {
        if (engine.username) {
            router.push(`/@${engine.username}/${state}`);
        }
        engine.setIsNavVisible(false);
    }, [engine, router]);
    
    // Arrow drawing function for waypoint arrows
    const drawArrow = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string) => {
        ctx.save();
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        
        // Translate to arrow position and rotate
        ctx.translate(x, y);
        ctx.rotate(angle);
        
        // Draw simple triangle (pointing right, will be rotated)
        ctx.beginPath();
        ctx.moveTo(ARROW_SIZE, 0);                    // Tip of triangle
        ctx.lineTo(-ARROW_SIZE/2, -ARROW_SIZE/2);     // Top back corner
        ctx.lineTo(-ARROW_SIZE/2, ARROW_SIZE/2);      // Bottom back corner
        ctx.closePath();
        ctx.fill();
        
        ctx.restore();
    }, []);
    
    // Viewport edge intersection for waypoint arrows
    const getViewportEdgeIntersection = useCallback((centerX: number, centerY: number, targetX: number, targetY: number, viewportWidth: number, viewportHeight: number) => {
        const dx = targetX - centerX;
        const dy = targetY - centerY;
        
        // Calculate the direction vector
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length === 0) return null;
        
        const dirX = dx / length;
        const dirY = dy / length;
        
        // Find intersection with viewport edges
        const halfWidth = viewportWidth / 2;
        const halfHeight = viewportHeight / 2;
        
        // Calculate intersection with each edge
        const tTop = -halfHeight / dirY;
        const tBottom = halfHeight / dirY;
        const tLeft = -halfWidth / dirX;
        const tRight = halfWidth / dirX;
        
        // Find the smallest positive t (closest edge intersection)
        const validTs = [tTop, tBottom, tLeft, tRight].filter(t => t > 0);
        if (validTs.length === 0) return null;
        
        const t = Math.min(...validTs);
        
        return {
            x: centerX + t * dirX,
            y: centerY + t * dirY,
            angle: Math.atan2(dy, dx) // Angle for arrow direction
        };
    }, []);
    
    // Check if block is in viewport
    const isBlockInViewport = useCallback((worldX: number, worldY: number, viewBounds: {minX: number, maxX: number, minY: number, maxY: number}): boolean => {
        return worldX >= viewBounds.minX && worldX <= viewBounds.maxX && 
               worldY >= viewBounds.minY && worldY <= viewBounds.maxY;
    }, []);
    
    // Load publish statuses when nav opens or states change
    useEffect(() => {
        if (engine.isNavVisible && engine.navMode === 'states') {
            loadStatePublishStatuses();
        }
    }, [engine.isNavVisible, engine.navMode, engine.availableStates, loadStatePublishStatuses]);

    

    useEffect(() => {
        registerGroup(createCameraController(engine));
        registerGroup(createGridController({ cycleGridMode: engine.cycleGridMode }));
        registerGroup(createTapeController(toggleRecording));
        registerGroup(createCommandController({
            executeNote: () => engine.commandSystem.executeCommandString('note'),
            executePublish: () => engine.commandSystem.executeCommandString('publish'),
            openCommandPalette: () => engine.commandSystem.startCommand(engine.cursorPos),
            openSearch: () => engine.commandSystem.startCommandWithInput(engine.cursorPos, 'search '),
            executeLabel: () => engine.commandSystem.executeCommandString('label'),
            executeTask: () => engine.commandSystem.executeCommandString('task')
        }));
    }, [registerGroup, engine.cycleGridMode, toggleRecording, engine.commandSystem, engine.cursorPos]);
    
    // Enhanced debug text - only calculate if debug is visible
    const enhancedDebugText = engine.settings.isDebugVisible ? `${debugText}
Camera & Viewport Controls:
  Home: Return to origin
  Ctrl+H: Reset zoom level` : '';
    





    // Refs for smooth panning
    const panStartInfoRef = useRef<PanStartInfo | null>(null);
    const isMiddleMouseDownRef = useRef(false);
    const intermediatePanOffsetRef = useRef<Point>(engine.viewOffset); // Track offset during pan

    // Ref for tracking selection drag state (mouse button down)
    const isSelectingMouseDownRef = useRef(false);
    
    // Ref for tracking when cursor movement is from click (to skip trail)
    const isClickMovementRef = useRef(false);

    // --- Resize Handler (Canvas specific) ---
    const handleResize = useCallback(() => {
        const dpr = window.devicePixelRatio || 1;
        devicePixelRatioRef.current = dpr;
        const cssWidth = window.innerWidth;
        const cssHeight = window.innerHeight;
        setCanvasSize({ width: cssWidth, height: cssHeight }); // Update CSS size state

        const canvas = canvasRef.current;
        if (canvas) {
            canvas.width = Math.floor(cssWidth * dpr);
            canvas.height = Math.floor(cssHeight * dpr);
            canvas.style.width = `${cssWidth}px`;
            canvas.style.height = `${cssHeight}px`;
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.imageSmoothingEnabled = false;
        }
    }, []); // Empty deps

    // --- Setup Resize Listener ---
    useEffect(() => {
        handleResize(); // Initial size
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [handleResize]);

    // Track cursor movement for trail effect
    useEffect(() => {
        const currentPos = engine.cursorPos;
        
        // Skip trail if movement is from click
        if (isClickMovementRef.current) {
            isClickMovementRef.current = false; // Reset flag
            lastCursorPosRef.current = {...currentPos}; // Update last position without adding to trail
            return;
        }
        
        // Only add to trail if cursor has actually moved
        if (!lastCursorPosRef.current || 
            currentPos.x !== lastCursorPosRef.current.x || 
            currentPos.y !== lastCursorPosRef.current.y) {
            
            const now = Date.now();
            const newTrailPosition = {
                x: currentPos.x,
                y: currentPos.y,
                timestamp: now
            };
            
            setCursorTrail(prev => {
                // Add new position and filter out old ones
                const cutoffTime = now - CURSOR_TRAIL_FADE_MS;
                const updated = [newTrailPosition, ...prev.filter(pos => pos.timestamp >= cutoffTime)];
                return updated;
            });
            
            lastCursorPosRef.current = {...currentPos};
        }
    }, [engine.cursorPos]);

    // Track agent position for trail
    const lastAgentPosRef = useRef<Point | null>(null);
    useEffect(() => {
        if (!engine.agentEnabled) {
            setAgentTrail([]);
            return;
        }

        const currentPos = engine.agentPos;
        const lastPos = lastAgentPosRef.current;

        // Only add to trail if position actually changed
        if (!lastPos || lastPos.x !== currentPos.x || lastPos.y !== currentPos.y) {
            const now = Date.now();
            const newTrailPosition = {
                x: currentPos.x,
                y: currentPos.y,
                timestamp: now
            };

            setAgentTrail(prev => {
                // Add new position and filter out old ones
                const cutoffTime = now - CURSOR_TRAIL_FADE_MS;
                const updated = [newTrailPosition, ...prev.filter(pos => pos.timestamp >= cutoffTime)];
                return updated;
            });

            lastAgentPosRef.current = {...currentPos};
        }
    }, [engine.agentEnabled, engine.agentPos]);

    // --- Tasks Spatial Index Cache ---
    const tasksIndexRef = useRef<Map<string, boolean>>(new Map());
    const completedTasksIndexRef = useRef<Map<string, boolean>>(new Map());
    const lastTasksDataRef = useRef<string>('');

    const updateTasksIndex = useCallback(() => {
        // Create a spatial index of all active (non-completed) tasks for O(1) lookup
        const tasksIndex = new Map<string, boolean>();
        const completedTasksIndex = new Map<string, boolean>();

        for (const labelKey in engine.worldData) {
            if (labelKey.startsWith('label_')) {
                try {
                    const labelData = JSON.parse(engine.worldData[labelKey] as string);
                    if (labelData.type === 'task') {
                        if (!labelData.completed) {
                            // Index every position within active task bounds
                            for (let y = labelData.startY; y <= labelData.endY; y++) {
                                for (let x = labelData.startX; x <= labelData.endX; x++) {
                                    const key = `${x},${y}`;
                                    tasksIndex.set(key, true);
                                }
                            }
                        } else {
                            // Index every position within completed task bounds
                            for (let y = labelData.startY; y <= labelData.endY; y++) {
                                for (let x = labelData.startX; x <= labelData.endX; x++) {
                                    const key = `${x},${y}`;
                                    completedTasksIndex.set(key, true);
                                }
                            }
                        }
                    }
                } catch (e) {
                    // Skip invalid label data
                }
            }
        }

        tasksIndexRef.current = tasksIndex;
        completedTasksIndexRef.current = completedTasksIndex;
    }, [engine.worldData]);

    // Helper function to find image at a specific position
    
        // Helper function to find connected text block (including spaces)
    const findTextBlock = useCallback((startPos: Point, worldData: any, engine: any): Point[] => {
        // Simple flood-fill to find all connected text
        const visited = new Set<string>();
        const textPositions: Point[] = [];
        const queue: Point[] = [startPos];
        
        while (queue.length > 0) {
            const pos = queue.shift()!;
            const key = `${pos.x},${pos.y}`;
            
            if (visited.has(key)) continue;
            visited.add(key);
            
            const charData = worldData[key];
            const char = charData ? engine.getCharacter(charData) : '';
            
            // Include position if it has text
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
                const hasTextLeft = worldData[`${pos.x - 1},${pos.y}`] && !engine.isImageData(worldData[`${pos.x - 1},${pos.y}`]) && engine.getCharacter(worldData[`${pos.x - 1},${pos.y}`]).trim() !== '';
                const hasTextRight = worldData[`${pos.x + 1},${pos.y}`] && !engine.isImageData(worldData[`${pos.x + 1},${pos.y}`]) && engine.getCharacter(worldData[`${pos.x + 1},${pos.y}`]).trim() !== '';
                
                if (hasTextLeft || hasTextRight) {
                    // Continue searching horizontally through spaces
                    if (!visited.has(`${pos.x - 1},${pos.y}`)) queue.push({ x: pos.x - 1, y: pos.y });
                    if (!visited.has(`${pos.x + 1},${pos.y}`)) queue.push({ x: pos.x + 1, y: pos.y });
                }
            }
        }
        
        // If no text found at start position, search nearby
        if (textPositions.length === 0) {
            // Look for text in a 3x3 area around the click
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const checkPos = { x: startPos.x + dx, y: startPos.y + dy };
                    const checkKey = `${checkPos.x},${checkPos.y}`;
                    const checkData = worldData[checkKey];
                    
                    if (checkData && !engine.isImageData(checkData) && engine.getCharacter(checkData).trim() !== '') {
                        // Found text nearby, use that as start
                        return findTextBlock(checkPos, worldData, engine);
                    }
                }
            }
            return [];
        }
        
        // Calculate bounding box
        const minX = Math.min(...textPositions.map(p => p.x));
        const maxX = Math.max(...textPositions.map(p => p.x));
        const minY = Math.min(...textPositions.map(p => p.y));
        const maxY = Math.max(...textPositions.map(p => p.y));
        
        // Return all positions in bounding box
        const block: Point[] = [];
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                block.push({ x, y });
            }
        }
        
        return block;
    }, []);
    
    const findImageAtPosition = useCallback((pos: Point): any => {
        // Check persistent images in worldData
        for (const key in engine.worldData) {
            if (key.startsWith('image_')) {
                const imageData = engine.worldData[key];
                if (engine.isImageData(imageData)) {
                    // Check if position is within image bounds
                    if (pos.x >= imageData.startX && pos.x <= imageData.endX &&
                        pos.y >= imageData.startY && pos.y <= imageData.endY) {
                        return imageData;
                    }
                }
            }
        }
        return null;
    }, [engine]);

    const findPatternAtPosition = useCallback((pos: Point): { key: string; data: any } | null => {
        for (const key in engine.worldData) {
            if (key.startsWith('pattern_')) {
                try {
                    const patternData = JSON.parse(engine.worldData[key] as string);
                    const { centerX, centerY, width = 120, height = 60 } = patternData;

                    const startX = Math.floor(centerX - width / 2);
                    const startY = Math.floor(centerY - height / 2);
                    const endX = startX + width;
                    const endY = startY + height;

                    if (pos.x >= startX && pos.x < endX && pos.y >= startY && pos.y < endY) {
                        return { key, data: patternData };
                    }
                } catch (e) {
                    continue;
                }
            }
        }
        return null;
    }, [engine]);

    const findIframeAtPosition = useCallback((pos: Point): { key: string, data: any } | null => {
        for (const key in engine.worldData) {
            if (key.startsWith('iframe_')) {
                try {
                    const iframeData = JSON.parse(engine.worldData[key] as string);
                    // Check if position is within iframe bounds
                    if (pos.x >= iframeData.startX && pos.x <= iframeData.endX &&
                        pos.y >= iframeData.startY && pos.y <= iframeData.endY) {
                        return { key, data: iframeData };
                    }
                } catch (e) {
                    // Skip invalid iframe data
                }
            }
        }
        return null;
    }, [engine]);

    const findPlanAtPosition = useCallback((pos: Point): { key: string, data: any } | null => {
        // Check all note regions in worldData
        for (const key in engine.worldData) {
            if (key.startsWith('note_')) {
                try {
                    const noteData = JSON.parse(engine.worldData[key] as string);
                    // Check if position is within note bounds
                    if (pos.x >= noteData.startX && pos.x <= noteData.endX &&
                        pos.y >= noteData.startY && pos.y <= noteData.endY) {
                        return { key, data: noteData };
                    }
                } catch (e) {
                    // Skip invalid note data
                }
            }
        }
        return null;
    }, [engine]);

    const findMailAtPosition = useCallback((pos: Point): { key: string, data: any } | null => {
        // Check all mail regions in worldData
        for (const key in engine.worldData) {
            if (key.startsWith('mail_')) {
                try {
                    const mailData = JSON.parse(engine.worldData[key] as string);
                    // Check if position is within mail bounds
                    if (pos.x >= mailData.startX && pos.x <= mailData.endX &&
                        pos.y >= mailData.startY && pos.y <= mailData.endY) {
                        return { key, data: mailData };
                    }
                } catch (e) {
                    // Skip invalid mail data
                }
            }
        }
        return null;
    }, [engine]);

    // Helper to get chronological list of note regions and text blocks
    const getChronologicalItems = useCallback((): Array<{
        type: 'note' | 'textblock',
        timestamp: number,
        content: string,
        bounds: { startX: number, startY: number, endX: number, endY: number }
    }> => {
        const items: Array<{
            type: 'note' | 'textblock',
            timestamp: number,
            content: string,
            bounds: { startX: number, startY: number, endX: number, endY: number }
        }> = [];

        // Collect all note regions
        for (const key in engine.worldData) {
            if (key.startsWith('note_')) {
                try {
                    const noteData = JSON.parse(engine.worldData[key] as string);

                    // Extract text content within note bounds
                    let content = '';
                    for (let y = noteData.startY; y <= noteData.endY; y++) {
                        let rowContent = '';
                        for (let x = noteData.startX; x <= noteData.endX; x++) {
                            const cellKey = `${x},${y}`;
                            const cellData = engine.worldData[cellKey];
                            if (cellData && !engine.isImageData(cellData)) {
                                const char = engine.getCharacter(cellData);
                                rowContent += char || ' ';
                            } else {
                                rowContent += ' ';
                            }
                        }
                        // Trim trailing spaces but preserve line structure
                        if (content.length > 0 || rowContent.trim().length > 0) {
                            content += rowContent.trimEnd() + '\n';
                        }
                    }

                    items.push({
                        type: 'note',
                        timestamp: noteData.timestamp || 0,
                        content: content.trim(),
                        bounds: {
                            startX: noteData.startX,
                            startY: noteData.startY,
                            endX: noteData.endX,
                            endY: noteData.endY
                        }
                    });
                } catch (e) {
                    // Skip invalid note data
                }
            }
        }

        // Collect all text blocks (excluding those already in note regions)
        const processedPositions = new Set<string>();

        // Mark positions within note regions as processed
        for (const item of items) {
            for (let y = item.bounds.startY; y <= item.bounds.endY; y++) {
                for (let x = item.bounds.startX; x <= item.bounds.endX; x++) {
                    processedPositions.add(`${x},${y}`);
                }
            }
        }

        // Find distinct text blocks
        for (const key in engine.worldData) {
            if (processedPositions.has(key)) continue;

            const data = engine.worldData[key];
            if (!data || engine.isImageData(data) || key.startsWith('note_') || key.startsWith('image_')) continue;

            const char = engine.getCharacter(data);
            if (!char || char.trim() === '') continue;

            // Found a text character - find its entire block
            const [xStr, yStr] = key.split(',');
            const startPos = { x: parseInt(xStr), y: parseInt(yStr) };

            if (processedPositions.has(key)) continue;

            const textBlock = findTextBlock(startPos, engine.worldData, engine);
            if (textBlock.length === 0) continue;

            // Mark all positions in this block as processed
            textBlock.forEach(pos => {
                if (pos) processedPositions.add(`${pos.x},${pos.y}`);
            });

            // Extract text content
            let content = '';
            const minX = Math.min(...textBlock.filter(p => p).map(p => p.x));
            const maxX = Math.max(...textBlock.filter(p => p).map(p => p.x));
            const minY = Math.min(...textBlock.filter(p => p).map(p => p.y));
            const maxY = Math.max(...textBlock.map(p => p.y));

            for (let y = minY; y <= maxY; y++) {
                let rowContent = '';
                for (let x = minX; x <= maxX; x++) {
                    const cellKey = `${x},${y}`;
                    const cellData = engine.worldData[cellKey];
                    if (cellData && !engine.isImageData(cellData)) {
                        const char = engine.getCharacter(cellData);
                        rowContent += char || ' ';
                    } else {
                        rowContent += ' ';
                    }
                }
                if (content.length > 0 || rowContent.trim().length > 0) {
                    content += rowContent.trimEnd() + '\n';
                }
            }

            // Use position as pseudo-timestamp for text blocks (no real timestamp)
            const pseudoTimestamp = minY * 1000000 + minX;

            items.push({
                type: 'textblock',
                timestamp: pseudoTimestamp,
                content: content.trim(),
                bounds: { startX: minX, startY: minY, endX: maxX, endY: maxY }
            });
        }

        // Sort by timestamp (note regions by actual timestamp, text blocks by position)
        return items.sort((a, b) => a.timestamp - b.timestamp);
    }, [engine, findTextBlock]);

    // Helper to check if worldPos is within a clipboard-flashed bound
    const isInClipboardFlashBound = useCallback((worldPos: Point): string | null => {
        // Get the most recent clipboard item (first in array)
        const recentItem = engine.clipboardItems[0];
        if (!recentItem) {
            return null;
        }

        const flashKey = `flash_${recentItem.startX},${recentItem.startY}`;

        // Only check if this item is currently flashing
        if (!clipboardFlashBounds.has(flashKey)) {
            return null;
        }

        const { startX, endX, startY, endY } = recentItem;

        if (worldPos.x >= startX && worldPos.x <= endX &&
            worldPos.y >= startY && worldPos.y <= endY) {
            return flashKey;
        }

        return null;
    }, [clipboardFlashBounds, engine.clipboardItems]);

    // --- Cursor Preview Functions ---
    const drawHoverPreview = useCallback((ctx: CanvasRenderingContext2D, worldPos: any, currentZoom: number, currentOffset: Point, effectiveCharWidth: number, effectiveCharHeight: number, cssWidth: number, cssHeight: number, shiftPressed: boolean = false) => {
        // Only show preview if different from current cursor position
        if (worldPos.x === engine.cursorPos.x && worldPos.y === engine.cursorPos.y && !worldPos.subY) return;

        const bottomScreenPos = engine.worldToScreen(worldPos.x, worldPos.y, currentZoom, currentOffset);
        const topScreenPos = engine.worldToScreen(worldPos.x, worldPos.y - 1, currentZoom, currentOffset);
        const screenPos = bottomScreenPos; // Keep for backward compatibility in some checks

        // Check if we're in a clipboard-flashed bound
        const flashingBoundKey = isInClipboardFlashBound(worldPos);

        // Check if we're in a glitched region
        const subY = worldPos.subY !== undefined ? worldPos.subY : 0;
        const hasSubY = worldPos.subY !== undefined;
        const isGlitched = hasSubY || (() => {
            return false;
        })();

        // Adjust height and Y position for glitched cells
        const previewHeight = isGlitched ? effectiveCharHeight / 2 : effectiveCharHeight * GRID_CELL_SPAN;
        const adjustedScreenY = isGlitched ? (screenPos.y + (subY * effectiveCharHeight)) : topScreenPos.y;

        // Only draw if visible on screen
        if (screenPos.x < -effectiveCharWidth || screenPos.x > cssWidth ||
            adjustedScreenY < -previewHeight || adjustedScreenY > cssHeight) return;
        
        // Check if there's existing text at this position OR if we're within a text block
        const key = `${worldPos.x},${worldPos.y}`;
        const hasDirectText = engine.worldData[key] && !engine.isImageData(engine.worldData[key]) && engine.getCharacter(engine.worldData[key]).trim() !== '';
        
        // Try to find a text block starting from this position
        const textBlock = findTextBlock(worldPos, engine.worldData, engine);
        const isWithinTextBlock = textBlock.length > 0;
        
        // Check if we're hovering over an image
        const imageAtPosition = findImageAtPosition(worldPos);
        const isWithinImage = imageAtPosition !== null;
        
        if (isWithinImage) {
            if (shiftPressed) {
                // When shift is pressed, draw border around the entire image
                const topLeftScreen = engine.worldToScreen(imageAtPosition.startX, imageAtPosition.startY, currentZoom, currentOffset);
                const bottomRightScreen = engine.worldToScreen(imageAtPosition.endX + 1, imageAtPosition.endY + 1, currentZoom, currentOffset);

                ctx.strokeStyle = `rgba(${hexToRgb(engine.textColor)}, 0.7)`; // Border matching text accent color
                const lineWidth = 2;
                ctx.lineWidth = lineWidth;
                const halfWidth = lineWidth / 2;
                ctx.strokeRect(
                    topLeftScreen.x + halfWidth,
                    topLeftScreen.y + halfWidth,
                    bottomRightScreen.x - topLeftScreen.x - lineWidth,
                    bottomRightScreen.y - topLeftScreen.y - lineWidth
                );
            }
            // For normal hover over images: no visual feedback (no overlay, no border)
        } else if (hasDirectText || isWithinTextBlock) {

            // Draw overlay for the entire text block using text accent color
            // If we're in a clipboard-flashed bound, multiply with cyan
            let overlayColor: string;
            if (flashingBoundKey) {
                // Multiply gray with cyan: rgba(128,128,128) * rgba(0,255,255) = rgba(0,128,128)
                overlayColor = `rgba(0, 128, 128, 0.4)`; // Cyan-tinted gray
            } else {
                overlayColor = `rgba(${hexToRgb(engine.textColor)}, 0.3)`;
            }
            ctx.fillStyle = overlayColor;

            for (const blockPos of textBlock) {
                const blockBottomScreenPos = engine.worldToScreen(blockPos.x, blockPos.y, currentZoom, currentOffset);
                const blockTopScreenPos = engine.worldToScreen(blockPos.x, blockPos.y - 1, currentZoom, currentOffset);

                // Only draw if visible on screen
                if (blockBottomScreenPos.x >= -effectiveCharWidth && blockBottomScreenPos.x <= cssWidth &&
                    blockTopScreenPos.y >= -effectiveCharHeight && blockBottomScreenPos.y <= cssHeight) {
                    ctx.fillRect(blockTopScreenPos.x, blockTopScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                }
            }
            
            if (shiftPressed) {
                // When shift is pressed, draw border around the entire text block
                const minX = Math.min(...textBlock.map(p => p.x));
                const maxX = Math.max(...textBlock.map(p => p.x));
                const minY = Math.min(...textBlock.map(p => p.y));
                const maxY = Math.max(...textBlock.map(p => p.y));

                const topLeftScreen = engine.worldToScreen(minX, minY, currentZoom, currentOffset);
                const bottomRightScreen = engine.worldToScreen(maxX + 1, maxY + 1, currentZoom, currentOffset);

                ctx.strokeStyle = `rgba(${hexToRgb(engine.textColor)}, 0.7)`; // Border matching text accent color
                const lineWidth = 2;
                ctx.lineWidth = lineWidth;
                const halfWidth = lineWidth / 2;
                ctx.strokeRect(
                    topLeftScreen.x + halfWidth,
                    topLeftScreen.y + halfWidth,
                    bottomRightScreen.x - topLeftScreen.x - lineWidth,
                    bottomRightScreen.y - topLeftScreen.y - lineWidth
                );
            } else {
                // Draw outline around the hovered cell (use adjusted dimensions for glitched cells)
                ctx.strokeStyle = `rgba(${hexToRgb(engine.textColor)}, 0.8)`;
                const lineWidth = 2;
                ctx.lineWidth = lineWidth;
                const halfWidth = lineWidth / 2;
                ctx.strokeRect(screenPos.x + halfWidth, adjustedScreenY + halfWidth, effectiveCharWidth - lineWidth, previewHeight - lineWidth);
            }
        } else {
            if (shiftPressed) {
                // When shift is pressed over empty cell, draw border (use adjusted dimensions for glitched cells)
                ctx.strokeStyle = `rgba(${hexToRgb(engine.textColor)}, 0.7)`; // Border matching text accent color
                const lineWidth = 2;
                ctx.lineWidth = lineWidth;
                const halfWidth = lineWidth / 2;
                ctx.strokeRect(screenPos.x + halfWidth, adjustedScreenY + halfWidth, effectiveCharWidth - lineWidth, previewHeight - lineWidth);

                ctx.fillStyle = `rgba(${hexToRgb(engine.textColor)}, 0.2)`; // Fill matching text accent color
                ctx.fillRect(screenPos.x, adjustedScreenY, effectiveCharWidth, previewHeight);
            } else {
                // Regular preview for empty cells (use adjusted dimensions for glitched cells)
                ctx.strokeStyle = `rgba(${hexToRgb(engine.textColor)}, 0.7)`;
                const lineWidth = 2;
                ctx.lineWidth = lineWidth;
                const halfWidth = lineWidth / 2;
                ctx.strokeRect(screenPos.x + halfWidth, adjustedScreenY + halfWidth, effectiveCharWidth - lineWidth, previewHeight - lineWidth);

                ctx.fillStyle = `rgba(${hexToRgb(engine.textColor)}, 0.2)`;
                ctx.fillRect(screenPos.x, adjustedScreenY, effectiveCharWidth, previewHeight);
            }
        }
    }, [engine, findImageAtPosition, isInClipboardFlashBound]);


    const drawModeSpecificPreview = useCallback((ctx: CanvasRenderingContext2D, worldPos: Point, currentZoom: number, currentOffset: Point, effectiveCharWidth: number, effectiveCharHeight: number, effectiveFontSize: number) => {
        const screenPos = engine.worldToScreen(worldPos.x, worldPos.y, currentZoom, currentOffset);
        
        if (engine.isMoveMode) {
            // Show move cursor - crosshairs
            ctx.strokeStyle = 'rgba(0, 150, 255, 0.8)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            // Horizontal line
            ctx.moveTo(screenPos.x + effectiveCharWidth * 0.2, screenPos.y + effectiveCharHeight * 0.5);
            ctx.lineTo(screenPos.x + effectiveCharWidth * 0.8, screenPos.y + effectiveCharHeight * 0.5);
            // Vertical line
            ctx.moveTo(screenPos.x + effectiveCharWidth * 0.5, screenPos.y + effectiveCharHeight * 0.2);
            ctx.lineTo(screenPos.x + effectiveCharWidth * 0.5, screenPos.y + effectiveCharHeight * 0.8);
            ctx.stroke();
        }
    }, [engine, fontFamily]);

    const drawPositionInfo = useCallback((ctx: CanvasRenderingContext2D, worldPos: Point, currentZoom: number, currentOffset: Point, effectiveCharWidth: number, effectiveCharHeight: number, effectiveFontSize: number, cssWidth: number, cssHeight: number) => {
        const screenPos = engine.worldToScreen(worldPos.x, worldPos.y, currentZoom, currentOffset);
        
        // Calculate distance from current cursor
        const deltaX = worldPos.x - engine.cursorPos.x;
        const deltaY = worldPos.y - engine.cursorPos.y;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        // Create info text
        const infoText = `(${worldPos.x},${worldPos.y}) [${Math.round(distance)}]`;
        const fontSize = Math.max(10, effectiveFontSize * 0.8);
        ctx.font = `${fontSize}px ${fontFamily}`;
        const textMetrics = ctx.measureText(infoText);
        const textWidth = textMetrics.width;
        const textHeight = fontSize;
        
        // Position info box to avoid going off screen
        let infoX = screenPos.x + effectiveCharWidth + 8;
        let infoY = screenPos.y - textHeight - 4;
        
        // Adjust if going off right edge
        if (infoX + textWidth + 8 > cssWidth) {
            infoX = screenPos.x - textWidth - 8;
        }
        
        // Adjust if going off top edge
        if (infoY < 0) {
            infoY = screenPos.y + effectiveCharHeight + 4;
        }
        
        // Draw background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(infoX - 4, infoY - 2, textWidth + 8, textHeight + 4);
        
        // Draw text
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(infoText, infoX, infoY + textHeight - 2);
    }, [engine, fontFamily]);

    // --- Drawing Logic ---
    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        const dpr = devicePixelRatioRef.current;
        const { width: cssWidth, height: cssHeight } = canvasSize;
        if (cssWidth === 0 || cssHeight === 0) return;

        const currentZoom = engine.zoomLevel;
        const {
            width: effectiveCharWidth,
            height: effectiveCharHeight,
            fontSize: effectiveFontSize
        } = engine.getEffectiveCharDims(currentZoom);

        // Update tasks index if task data has changed (check values, not just keys)
        const taskEntries = Object.entries(engine.worldData).filter(([k, v]) => {
            if (!k.startsWith('label_')) return false;
            try {
                const data = JSON.parse(v as string);
                return data.type === 'task';
            } catch (e) {
                return false;
            }
        });
        const currentTasksData = JSON.stringify(taskEntries);
        if (currentTasksData !== lastTasksDataRef.current) {
            updateTasksIndex();
            lastTasksDataRef.current = currentTasksData;
        }

        // Use intermediate offset if panning (mouse or touch), otherwise use engine's state
        const currentOffset = (isMiddleMouseDownRef.current || isTouchPanningRef.current) ? intermediatePanOffsetRef.current : engine.viewOffset;
        const verticalTextOffset = 2; // Small offset to center text better in grid cells

        // Helper function to detect Korean characters (Hangul syllables: U+AC00 to U+D7AF)
        const isKoreanChar = (char: string): boolean => {
            if (!char || char.length === 0) return false;
            const code = char.charCodeAt(0);
            return code >= 0xAC00 && code <= 0xD7AF;
        };

        // Helper function to render text with proper scaling for Korean characters
        const renderText = (ctx: CanvasRenderingContext2D, char: string, x: number, y: number) => {
            if (isKoreanChar(char)) {
                // Scale Korean characters to fit monospace cell (about 0.8x)
                ctx.save();
                ctx.translate(x, y);
                ctx.scale(0.8, 1);
                ctx.fillText(char, 0, 0);
                ctx.restore();
            } else {
                ctx.fillText(char, x, y);
            }
        };

        // --- Actual Drawing (Copied from previous `draw` function) ---
        ctx.save();
        ctx.scale(dpr, dpr);
        
        if (engine.backgroundMode === 'color' && engine.backgroundColor) {
            ctx.fillStyle = engine.backgroundColor;
            ctx.fillRect(0, 0, cssWidth, cssHeight);
        } else if (engine.backgroundMode === 'image' && engine.backgroundImage) {
            // Clear canvas first
            ctx.clearRect(0, 0, cssWidth, cssHeight);
            
            // Check if we need to load a new image
            if (backgroundImageUrlRef.current !== engine.backgroundImage || !backgroundImageRef.current) {
                backgroundImageUrlRef.current = engine.backgroundImage;
                backgroundImageRef.current = new Image();
                backgroundImageRef.current.onload = () => {
                    // Image loaded, the next animation frame will draw it
                };
                backgroundImageRef.current.src = engine.backgroundImage;
            }
            
            // Draw the cached image if it's loaded, maintaining aspect ratio
            if (backgroundImageRef.current && backgroundImageRef.current.complete) {
                const image = backgroundImageRef.current;
                const imageAspect = image.naturalWidth / image.naturalHeight;
                const canvasAspect = cssWidth / cssHeight;

                let drawWidth, drawHeight, drawX, drawY;

                if (imageAspect > canvasAspect) {
                    // Image is wider than canvas - fit to height and crop sides
                    drawHeight = cssHeight;
                    drawWidth = cssHeight * imageAspect;
                    drawX = (cssWidth - drawWidth) / 2;
                    drawY = 0;
                } else {
                    // Image is taller than canvas - fit to width and crop top/bottom
                    drawWidth = cssWidth;
                    drawHeight = cssWidth / imageAspect;
                    drawX = 0;
                    drawY = (cssHeight - drawHeight) / 2;
                }

                ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
            }
        } else if (engine.backgroundMode === 'video' && engine.backgroundVideo) {
            // Clear canvas first
            ctx.clearRect(0, 0, cssWidth, cssHeight);

            // Check if we need to load a new video
            if (backgroundVideoUrlRef.current !== engine.backgroundVideo || !backgroundVideoRef.current) {
                backgroundVideoUrlRef.current = engine.backgroundVideo;
                backgroundVideoRef.current = document.createElement('video');
                backgroundVideoRef.current.src = engine.backgroundVideo;
                backgroundVideoRef.current.loop = true;
                backgroundVideoRef.current.muted = true;
                backgroundVideoRef.current.playsInline = true;
                backgroundVideoRef.current.onloadeddata = () => {
                    // Video loaded, start playing
                    backgroundVideoRef.current?.play().catch(err => {
                        console.warn('Failed to autoplay video:', err);
                    });
                };
            }

            // Draw the video if it's loaded and playing, maintaining aspect ratio
            if (backgroundVideoRef.current && backgroundVideoRef.current.readyState >= 2) {
                const video = backgroundVideoRef.current;
                const videoAspect = video.videoWidth / video.videoHeight;
                const canvasAspect = cssWidth / cssHeight;

                let drawWidth, drawHeight, drawX, drawY;

                if (videoAspect > canvasAspect) {
                    // Video is wider than canvas - fit to height and crop sides
                    drawHeight = cssHeight;
                    drawWidth = cssHeight * videoAspect;
                    drawX = (cssWidth - drawWidth) / 2;
                    drawY = 0;
                } else {
                    // Video is taller than canvas - fit to width and crop top/bottom
                    drawWidth = cssWidth;
                    drawHeight = cssWidth / videoAspect;
                    drawX = 0;
                    drawY = (cssHeight - drawHeight) / 2;
                }

                ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
            }
        } else if (engine.backgroundMode === 'space') {
            // Clear canvas for space background (handled by SpaceBackground component)
            ctx.clearRect(0, 0, cssWidth, cssHeight);
        } else if (engine.backgroundMode === 'stream' && engine.backgroundStream) {
            // Clear canvas first
            ctx.clearRect(0, 0, cssWidth, cssHeight);

            // Set up video element for stream if not already created
            if (!backgroundStreamVideoRef.current) {
                backgroundStreamVideoRef.current = document.createElement('video');
                backgroundStreamVideoRef.current.autoplay = true;
                backgroundStreamVideoRef.current.playsInline = true;
                backgroundStreamVideoRef.current.muted = true;
            }

            // Set the stream as the video source if it changed
            if (backgroundStreamVideoRef.current.srcObject !== engine.backgroundStream) {
                backgroundStreamVideoRef.current.srcObject = engine.backgroundStream;
                backgroundStreamVideoRef.current.play().catch((err: unknown) => {
                    console.warn('Failed to play stream:', err);
                });
            }

            // Draw the stream if video is ready, maintaining aspect ratio
            if (backgroundStreamVideoRef.current.readyState >= 2) {
                const video = backgroundStreamVideoRef.current;
                const videoAspect = video.videoWidth / video.videoHeight;
                const canvasAspect = cssWidth / cssHeight;

                let drawWidth, drawHeight, drawX, drawY;

                if (videoAspect > canvasAspect) {
                    // Video is wider than canvas - fit to height and crop sides
                    drawHeight = cssHeight;
                    drawWidth = cssHeight * videoAspect;
                    drawX = (cssWidth - drawWidth) / 2;
                    drawY = 0;
                } else {
                    // Video is taller than canvas - fit to width and crop top/bottom
                    drawWidth = cssWidth;
                    drawHeight = cssWidth / videoAspect;
                    drawX = 0;
                    drawY = (cssHeight - drawHeight) / 2;
                }

                ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
            }
        } else {
            // Default transparent mode
            ctx.clearRect(0, 0, cssWidth, cssHeight);
        }

        
        ctx.imageSmoothingEnabled = false;
        ctx.font = `${effectiveFontSize}px ${fontFamily}`;
        ctx.textBaseline = 'top';

        // Calculate viewport bounds
        const startWorldX = currentOffset.x;
        const startWorldY = currentOffset.y;
        const endWorldX = startWorldX + (cssWidth / effectiveCharWidth);
        const endWorldY = startWorldY + (cssHeight / effectiveCharHeight);


        if (DRAW_GRID && effectiveCharWidth > 2 && effectiveCharHeight > 2) {
            ctx.strokeStyle = GRID_COLOR;
            ctx.lineWidth = GRID_LINE_WIDTH / dpr;
            ctx.beginPath();
            
            // Draw vertical grid lines (always visible)
            for (let worldX = Math.floor(startWorldX); worldX <= Math.ceil(endWorldX); worldX++) {
                const screenX = Math.floor((worldX - currentOffset.x) * effectiveCharWidth) + 0.5 / dpr;
                if (screenX >= -effectiveCharWidth && screenX <= cssWidth + effectiveCharWidth) { 
                    ctx.moveTo(screenX, 0); 
                    ctx.lineTo(screenX, cssHeight); 
                }
            }
            
            // Draw horizontal grid lines (always visible)
            for (let worldY = Math.floor(startWorldY); worldY <= Math.ceil(endWorldY); worldY++) {
                const screenY = Math.floor((worldY - currentOffset.y) * effectiveCharHeight) + 0.5 / dpr;
                if (screenY >= -effectiveCharHeight && screenY <= cssHeight + effectiveCharHeight) { 
                    ctx.moveTo(0, screenY); 
                    ctx.lineTo(cssWidth, screenY); 
                }
            }
            ctx.stroke();
        }

        // === Render Monogram Background (GPU-Accelerated Bitmap) ===
        if (monogram.options.enabled) {
            let renderedCount = 0;
            let sampleCount = 0;
            let skippedLowIntensity = 0;
            let skippedOutOfBounds = 0;
            let zeroIntensityCount = 0;
            const yStart = Math.floor(startWorldY);
            const yEnd = Math.ceil(endWorldY);
            const xStart = Math.floor(startWorldX);
            const xEnd = Math.ceil(endWorldX);

            for (let worldY = yStart; worldY <= yEnd; worldY++) {
                for (let worldX = xStart; worldX <= xEnd; worldX++) {
                    sampleCount++;
                    // Sample intensity from GPU-computed chunk (already includes character glows)
                    const intensity = monogram.sampleAt(worldX, worldY);

                    if (intensity === 0) {
                        zeroIntensityCount++;
                    }

                    if (intensity <= 0.05) { // Small threshold to skip near-zero values
                        skippedLowIntensity++;
                    } else {
                        const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);

                        // Bounds check
                        if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth &&
                            screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {

                            renderedCount++;
                            // Render perlin noise pattern (GPU already includes character glows in intensity)
                            ctx.fillStyle = engine.textColor;
                            ctx.globalAlpha = intensity * 0.5;
                            ctx.fillRect(
                                screenPos.x,
                                screenPos.y,
                                effectiveCharWidth,
                                effectiveCharHeight
                            );
                            ctx.globalAlpha = 1.0; // Reset alpha
                        } else {
                            skippedOutOfBounds++;
                        }
                    }
                }
            }
        }

        // === Render Air Mode Data (Ephemeral Text) ===
        // Render each ephemeral character individually at its exact grid position
        for (const key in engine.lightModeData) {
            const [xStr, yStr] = key.split(',');
            const worldX = parseInt(xStr, 10);
            const worldY = parseInt(yStr, 10);

            if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                const charData = engine.lightModeData[key];

                // Skip image data - only process text characters
                if (engine.isImageData(charData)) {
                    continue;
                }

                const char = typeof charData === 'string' ? charData : charData.char;
                const color = typeof charData === 'object' && charData.style?.color
                    ? charData.style.color
                    : engine.textColor;

                // Calculate opacity if fadeStart is set
                let opacity = 1.0;
                if (typeof charData === 'object' && charData.fadeStart) {
                    const fadeProgress = (Date.now() - charData.fadeStart) / 1000; // Fade over 1 second
                    opacity = Math.max(0, 1 - fadeProgress);
                }

                // Calculate screen positions for character span
                const bottomScreenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                const topScreenPos = engine.worldToScreen(worldX, worldY - 1, currentZoom, currentOffset);

                if (bottomScreenPos.x > -effectiveCharWidth * 2 && bottomScreenPos.x < cssWidth + effectiveCharWidth &&
                    topScreenPos.y > -effectiveCharHeight * 2 && bottomScreenPos.y < cssHeight + effectiveCharHeight) {
                    if (char) {
                        // Apply text background: use charData.style.background if set, otherwise currentTextStyle.background
                        // Skip text backgrounds when monogram is enabled (monogram provides the glow layer)
                        if (!monogram.options.enabled) {
                            const textBackground = (typeof charData === 'object' && charData.style?.background)
                                ? charData.style.background
                                : engine.currentTextStyle.background;
                            if (textBackground) {
                                if (opacity < 1.0) {
                                    ctx.globalAlpha = opacity;
                                }
                                ctx.fillStyle = textBackground;
                                // Use GRID_CELL_SPAN height to match character height
                                ctx.fillRect(topScreenPos.x, topScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                                if (opacity < 1.0) {
                                    ctx.globalAlpha = 1.0;
                                }
                            }
                        }

                        // Render the character with opacity (only if not a space)
                        if (char.trim() !== '') {
                            if (opacity < 1.0) {
                                ctx.globalAlpha = opacity;
                            }
                            ctx.fillStyle = color; // Use character's color or default
                            renderText(ctx, char, topScreenPos.x, topScreenPos.y + verticalTextOffset);
                            if (opacity < 1.0) {
                                ctx.globalAlpha = 1.0; // Reset alpha
                            }
                        }
                    }
                }
            }
        }

        // === Unified Label Rendering with Viewport Culling ===
        // Query visible labels using spatial index
        const visibleLabelsForRendering = engine.queryVisibleEntities(
            startWorldX - 5,
            startWorldY - 5,
            endWorldX + 5,
            endWorldY + 5
        );

        for (const key of visibleLabelsForRendering) {
            if (!key.startsWith('label_')) continue;

            try {
                const labelData = JSON.parse(engine.worldData[key] as string);
                const { type, startX, endX, startY, endY, x, y, color } = labelData;

                // Additional bounds check for 2D labels (tasks/links that might span beyond their anchor point)
                const labelMinX = startX ?? x;
                const labelMaxX = endX ?? x;
                const labelMinY = startY ?? y;
                const labelMaxY = endY ?? y;

                if (labelMaxX < startWorldX - 5 || labelMinX > endWorldX + 5 ||
                    labelMaxY < startWorldY - 5 || labelMinY > endWorldY + 5) {
                    continue; // Skip labels outside viewport
                }

                // Type-based rendering
                switch (type) {
                    case 'task': {
                        const taskColor = color || engine.textColor;
                        const { completed } = labelData;

                        if (!completed) {
                            // Render task highlight (skip when monogram is enabled)
                            if (!monogram.options.enabled) {
                                for (let y = startY; y <= endY; y += GRID_CELL_SPAN) {
                                    for (let x = startX; x <= endX; x++) {
                                        const bottomScreenPos = engine.worldToScreen(x, y, currentZoom, currentOffset);
                                        const topScreenPos = engine.worldToScreen(x, y - 1, currentZoom, currentOffset);
                                        if (bottomScreenPos.x > -effectiveCharWidth * 2 && bottomScreenPos.x < cssWidth + effectiveCharWidth &&
                                            topScreenPos.y > -effectiveCharHeight * 2 && bottomScreenPos.y < cssHeight + effectiveCharHeight) {
                                            ctx.fillStyle = taskColor;
                                            ctx.fillRect(topScreenPos.x, topScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                                        }
                                    }
                                }
                            }
                        } else {
                            // Render strikethrough if completed
                            for (let y = startY; y <= endY; y += GRID_CELL_SPAN) {
                                const leftScreenPos = engine.worldToScreen(startX, y, currentZoom, currentOffset);
                                const rightScreenPos = engine.worldToScreen(endX + 1, y, currentZoom, currentOffset);

                                if (leftScreenPos.x < cssWidth + effectiveCharWidth && rightScreenPos.x > -effectiveCharWidth) {
                                    ctx.strokeStyle = engine.textColor;
                                    ctx.lineWidth = 2;
                                    ctx.beginPath();
                                    ctx.moveTo(Math.max(0, leftScreenPos.x), leftScreenPos.y);
                                    ctx.lineTo(Math.min(cssWidth, rightScreenPos.x), leftScreenPos.y);
                                    ctx.stroke();
                                }
                            }
                        }
                        break;
                    }

                    case 'link': {
                        const linkColor = color || engine.textColor;

                        // Render underline for each row
                        for (let y = startY; y <= endY; y++) {
                            const leftScreenPos = engine.worldToScreen(startX, y, currentZoom, currentOffset);
                            const rightScreenPos = engine.worldToScreen(endX + 1, y, currentZoom, currentOffset);

                            if (leftScreenPos.x < cssWidth + effectiveCharWidth && rightScreenPos.x > -effectiveCharWidth) {
                                ctx.strokeStyle = linkColor;
                                ctx.lineWidth = Math.max(1, effectiveCharHeight * 0.08);
                                const underlineY = leftScreenPos.y + effectiveCharHeight - ctx.lineWidth;
                                ctx.beginPath();
                                ctx.moveTo(Math.max(0, leftScreenPos.x), underlineY);
                                ctx.lineTo(Math.min(cssWidth, rightScreenPos.x), underlineY);
                                ctx.stroke();
                            }
                        }
                        break;
                    }

                    case 'landmark':
                        // Landmarks rendered separately in waypoint arrow section
                        break;
                }
            } catch (e) {
                // Skip invalid label data
            }
        }

        // === Render Mail Send Links ===
        // Render "send" text with link-style underline at bottom-right of mail regions
        const visibleMail = engine.queryVisibleEntities(startWorldX - 5, startWorldY - 5, endWorldX + 5, endWorldY + 5);
        for (const key of visibleMail) {
            if (key.startsWith('mail_')) {
                try {
                    const mailData = JSON.parse(engine.worldData[key] as string);
                    const { startX, endX, startY, endY } = mailData;

                    // Position "send" at bottom-right corner (endX-3 to endX for 4 chars: "send")
                    const sendText = 'send';
                    const sendStartX = endX - sendText.length + 1;
                    const sendY = endY;

                    // Only render if visible in viewport
                    if (sendY >= startWorldY - 5 && sendY <= endWorldY + 5) {
                        // Render "send" text
                        for (let i = 0; i < sendText.length; i++) {
                            const charX = sendStartX + i;
                            if (charX >= startWorldX - 5 && charX <= endWorldX + 5) {
                                const screenPos = engine.worldToScreen(charX, sendY, currentZoom, currentOffset);
                                if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth &&
                                    screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                                    ctx.fillStyle = engine.textColor;
                                    ctx.fillText(sendText[i], screenPos.x, screenPos.y + verticalTextOffset);
                                }
                            }
                        }

                        // Render underline (link style)
                        const leftScreenPos = engine.worldToScreen(sendStartX, sendY, currentZoom, currentOffset);
                        const rightScreenPos = engine.worldToScreen(sendStartX + sendText.length, sendY, currentZoom, currentOffset);

                        if (leftScreenPos.x < cssWidth + effectiveCharWidth && rightScreenPos.x > -effectiveCharWidth) {
                            ctx.strokeStyle = engine.textColor;
                            ctx.lineWidth = Math.max(1, effectiveCharHeight * 0.08);
                            const underlineY = leftScreenPos.y + effectiveCharHeight - ctx.lineWidth;
                            ctx.beginPath();
                            ctx.moveTo(Math.max(0, leftScreenPos.x), underlineY);
                            ctx.lineTo(Math.min(cssWidth, rightScreenPos.x), underlineY);
                            ctx.stroke();
                        }
                    }
                } catch (e) {
                    // Skip invalid mail data
                }
            }
        }

        // === Render List Content (No borders - just content + scrollbar) ===
        const visibleLists = engine.queryVisibleEntities(startWorldX - 5, startWorldY - 5, endWorldX + 5, endWorldY + 5);
        for (const key of visibleLists) {
            if (key.startsWith('list_')) {
                try {
                    const listData = JSON.parse(engine.worldData[key] as string);
                    const { startX, endX, startY, visibleHeight, scrollOffset, color } = listData;

                    // Render list content from virtual storage
                    const contentKey = `${key}_content`;
                    const contentData = engine.worldData[contentKey];
                    if (contentData) {
                        try {
                            const content = JSON.parse(contentData as string);

                            // Render visible lines (no title bar, start directly at startY)
                            for (let viewportRow = 0; viewportRow < visibleHeight; viewportRow++) {
                                const contentLineIndex = scrollOffset + viewportRow;
                                const lineContent = content[contentLineIndex] || '';
                                const renderY = startY + viewportRow;

                                // Check if this row is in visible viewport
                                if (renderY >= startWorldY - 5 && renderY <= endWorldY + 5) {
                                    // Render each character in the line
                                    for (let charIndex = 0; charIndex < lineContent.length && charIndex <= (endX - startX); charIndex++) {
                                        const renderX = startX + charIndex;
                                        if (renderX >= startWorldX - 5 && renderX <= endWorldX + 5) {
                                            const screenPos = engine.worldToScreen(renderX, renderY, currentZoom, currentOffset);
                                            if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth &&
                                                screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                                                ctx.fillStyle = engine.textColor;
                                                ctx.fillText(lineContent[charIndex], screenPos.x, screenPos.y + verticalTextOffset);
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (e) {
                            // Skip invalid content data
                        }
                    }

                    // Always render scrollbar track as visual indicator (even when no scroll needed)
                    const scrollbarX = endX + 1;
                    const scrollbarStartY = startY;
                    const scrollbarHeight = visibleHeight;

                    // Render scrollbar track (full height, always visible)
                    for (let y = scrollbarStartY; y < scrollbarStartY + scrollbarHeight; y++) {
                        if (y >= startWorldY - 5 && y <= endWorldY + 5 && scrollbarX >= startWorldX - 5 && scrollbarX <= endWorldX + 5) {
                            const screenPos = engine.worldToScreen(scrollbarX, y, currentZoom, currentOffset);
                            if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth &&
                                screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                                ctx.fillStyle = `${engine.textColor}33`; // 20% opacity - visible track
                                ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                            }
                        }
                    }

                    // Only render scrollbar thumb if content exceeds visible area
                    const totalLines = contentData ? Object.keys(JSON.parse(contentData as string)).length : 0;
                    if (totalLines > visibleHeight) {
                        const scrollProgress = scrollOffset / (totalLines - visibleHeight);
                        const thumbHeight = Math.max(1, Math.floor(scrollbarHeight * (visibleHeight / totalLines)));
                        const thumbY = scrollbarStartY + Math.floor((scrollbarHeight - thumbHeight) * scrollProgress);

                        // Render scrollbar thumb (only when scrollable)
                        for (let y = thumbY; y < thumbY + thumbHeight; y++) {
                            if (y >= startWorldY - 5 && y <= endWorldY + 5 && scrollbarX >= startWorldX - 5 && scrollbarX <= endWorldX + 5) {
                                const screenPos = engine.worldToScreen(scrollbarX, y, currentZoom, currentOffset);
                                if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth &&
                                    screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                                    ctx.fillStyle = `${engine.textColor}CC`; // 80% opacity - prominent thumb
                                    ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                                }
                            }
                        }
                    }

                    // Render border around list (same style as scrollbar track for seamless look)
                    const borderColor = `${engine.textColor}33`; // 20% opacity - same as scrollbar track

                    // Top border - thin 1px line
                    for (let x = startX; x <= scrollbarX; x++) {
                        if (x >= startWorldX - 5 && x <= endWorldX + 5 && startY >= startWorldY - 5 && startY <= endWorldY + 5) {
                            const screenPos = engine.worldToScreen(x, startY, currentZoom, currentOffset);
                            if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth &&
                                screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                                ctx.fillStyle = borderColor;
                                ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, 1);
                            }
                        }
                    }

                    // Bottom border - thin 1px line
                    const bottomY = startY + visibleHeight - 1;
                    for (let x = startX; x <= scrollbarX; x++) {
                        if (x >= startWorldX - 5 && x <= endWorldX + 5 && bottomY >= startWorldY - 5 && bottomY <= endWorldY + 5) {
                            const screenPos = engine.worldToScreen(x, bottomY, currentZoom, currentOffset);
                            if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth &&
                                screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                                ctx.fillStyle = borderColor;
                                ctx.fillRect(screenPos.x, screenPos.y + effectiveCharHeight - 1, effectiveCharWidth, 1);
                            }
                        }
                    }

                    // Left border - thin 1px line
                    for (let y = startY; y < startY + visibleHeight; y++) {
                        if (startX >= startWorldX - 5 && startX <= endWorldX + 5 && y >= startWorldY - 5 && y <= endWorldY + 5) {
                            const screenPos = engine.worldToScreen(startX, y, currentZoom, currentOffset);
                            if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth &&
                                screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                                ctx.fillStyle = borderColor;
                                ctx.fillRect(screenPos.x, screenPos.y, 1, effectiveCharHeight);
                            }
                        }
                    }

                    // Right border - use same full-width style as scrollbar track for seamless appearance
                    // Don't render separate right border - scrollbar track serves as the right border
                } catch (e) {
                    // Skip invalid list data
                }
            }
        }

        // === Setup Note Rendering Context ===
        const noteRenderCtx: NoteRenderContext = {
            ctx,
            engine,
            currentZoom,
            currentOffset,
            effectiveCharWidth,
            effectiveCharHeight,
            cssWidth,
            cssHeight,
            imageCache: imageCache.current,
            gifFrameCache: gifFrameCache.current,
            hexToRgb
        };

        ctx.fillStyle = engine.textColor;
        for (const key in engine.worldData) {
            // Skip block, label, bound, glitched, and image data - we render those separately
            if (key.startsWith('block_') || key.startsWith('label_') || key.startsWith('image_')) continue;

            const [xStr, yStr] = key.split(',');
            const worldX = parseInt(xStr, 10);
            const worldY = parseInt(yStr, 10);

            // Skip positions that are currently being used for IME composition preview
            if (engine.isComposing && engine.compositionStartPos && engine.compositionText) {
                const compStartX = engine.compositionStartPos.x;
                const compEndX = compStartX + engine.compositionText.length - 1;
                const compY = engine.compositionStartPos.y;
                if (worldY === compY && worldX >= compStartX && worldX <= compEndX) {
                    continue;
                }
            }

            if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                const charData = engine.worldData[key];
                const char = charData && !engine.isImageData(charData) ? engine.getCharacter(charData) : '';
                const charStyle = charData && !engine.isImageData(charData) ? engine.getCharacterStyle(charData) : undefined;

                // Characters span 2 cells: bottom cell at worldY and top cell at worldY-1
                const bottomScreenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                const topScreenPos = engine.worldToScreen(worldX, worldY - 1, currentZoom, currentOffset);

                if (bottomScreenPos.x > -effectiveCharWidth * 2 && bottomScreenPos.x < cssWidth + effectiveCharWidth &&
                    topScreenPos.y > -effectiveCharHeight * 2 && bottomScreenPos.y < cssHeight + effectiveCharHeight) {
                    // Apply text background: use charStyle.background if set
                    // Skip text backgrounds when monogram is enabled (monogram provides the glow layer)
                    if (!monogram.options.enabled) {
                        const textBackground = (charStyle && charStyle.background)
                            ? charStyle.background
                            : undefined;

                        if (textBackground) {
                            ctx.fillStyle = textBackground;
                            ctx.fillRect(topScreenPos.x, topScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                        }
                    }

                    // Render text only if there's actual content
                    if (char && char.trim() !== '') {
                        const posKey = `${worldX},${worldY}`;

                        // O(1) lookup for active task using spatial index
                        const isInActiveTask = tasksIndexRef.current?.get(posKey) || false;
                        const isInCompletedTask = completedTasksIndexRef.current?.get(posKey) || false;

                        // Apply text color based on context
                        if (isInCompletedTask) {
                            // Text within completed task uses text color
                            ctx.fillStyle = engine.textColor;
                        } else if (isInActiveTask) {
                            // Text within task highlight uses background color for contrast
                            ctx.fillStyle = engine.backgroundColor || '#FFFFFF';
                        } else {
                            ctx.fillStyle = (charStyle && charStyle.color) || engine.textColor;
                        }

                        // Add subtle text shadow
                        ctx.shadowColor = ctx.fillStyle as string;
                        ctx.shadowBlur = 0;
                        ctx.shadowOffsetX = 0;
                        ctx.shadowOffsetY = 0;
                        // Render character with baseline at top cell position
                        renderText(ctx, char, topScreenPos.x, topScreenPos.y + verticalTextOffset);
                        ctx.shadowBlur = 0;
                    }
                }
            }
        }

        // === Render Host Data (Centered at Initial Position) ===
        if (engine.hostData) {
            const fadeDuration = 800; // ms

            // Background dim fade-in (only once when host mode first activates)
            if (hostDimBackground) {
                // Initialize dim fade timer on first appearance
                if (!hasHostDimFadedInRef.current && hostDimFadeStartRef.current === null) {
                    hostDimFadeStartRef.current = Date.now();
                }

                let dimProgress = 1.0; // Default to fully dimmed
                if (hostDimFadeStartRef.current !== null && !hasHostDimFadedInRef.current) {
                    const dimElapsed = Date.now() - hostDimFadeStartRef.current;
                    dimProgress = Math.min(1, dimElapsed / fadeDuration);
                    // Smooth easing (ease-in-out)
                    dimProgress = dimProgress * dimProgress * (3 - 2 * dimProgress);

                    // Mark as faded in once complete
                    if (dimProgress >= 1.0) {
                        hasHostDimFadedInRef.current = true;
                    }
                }

                ctx.fillStyle = `rgba(0, 0, 0, ${0.4 * dimProgress})`;
                ctx.fillRect(0, 0, cssWidth, cssHeight);
            }

            // Text fade-in (happens on each new message)
            const textElapsed = engine.hostData.timestamp ? Date.now() - engine.hostData.timestamp : fadeDuration;
            let fadeProgress = Math.min(1, textElapsed / fadeDuration);
            // Smooth easing (ease-in-out)
            fadeProgress = fadeProgress * fadeProgress * (3 - 2 * fadeProgress);

            const hostText = engine.hostData.text;
            const hostColor = engine.hostData.color || engine.textColor;

            // Intelligent wrap width based on viewport (same logic as addInstantAIResponse)
            const BASE_FONT_SIZE = 16;
            const BASE_CHAR_WIDTH = BASE_FONT_SIZE * 0.6;
            const charWidth = effectiveCharWidth || BASE_CHAR_WIDTH;
            const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 800;
            const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 600;
            const availableWidthChars = Math.floor(viewportWidth / charWidth);
            const isPortrait = viewportHeight > viewportWidth;
            const MARGIN_CHARS = isPortrait ? 2 : 8; // Smaller margins on mobile
            const MAX_WIDTH_CHARS = 60;
            const wrapWidth = Math.min(MAX_WIDTH_CHARS, availableWidthChars - (2 * MARGIN_CHARS));

            // Text wrapping
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
            };

            const wrappedLines = wrapText(hostText, wrapWidth);
            const maxLineWidth = Math.max(...wrappedLines.map(line => line.length));
            const totalHeight = wrappedLines.length;

            // Position text: left-aligned on mobile (portrait), centered on desktop
            let textStartX: number;
            let textStartY: number;

            if (isPortrait) {
                // Left-aligned with margin on mobile
                textStartX = Math.floor(engine.hostData.centerPos.x - (availableWidthChars / 2) + MARGIN_CHARS);
                textStartY = Math.floor(engine.hostData.centerPos.y - totalHeight / 2);
            } else {
                // Centered on desktop
                textStartX = Math.floor(engine.hostData.centerPos.x - maxLineWidth / 2);
                textStartY = Math.floor(engine.hostData.centerPos.y - totalHeight / 2);
            }

            // First pass: Render glow effect with gentle pulse + violent flicker perturbation
            const GLOW_RADIUS = 2; // How many cells away the glow extends

            // Base: Gentle sine wave pulse
            const pulseSpeed = 0.001; // Slow, gentle pulse
            const pulsePhase = (Date.now() * pulseSpeed) % (Math.PI * 2);
            const basePulse = 0.6 + Math.sin(pulsePhase) * 0.2; // Oscillates 0.4 to 0.8

            // Perturbation: Violent flickering noise (smaller but noticeable)
            const flickerSpeed = 0.05; // Fast flicker
            const time = Date.now() * flickerSpeed;
            const flicker1 = Math.sin(time * 2.3) * 0.5 + 0.5; // Fast variation
            const flicker2 = Math.sin(time * 4.7) * 0.5 + 0.5; // Rapid jitter
            const randomNoise = Math.random(); // Random component

            // Combine: base pulse with small violent perturbation layered on top
            const flickerPerturbation = (flicker1 * 0.08 + flicker2 * 0.05 + randomNoise * 0.07);
            const pulseIntensity = basePulse + flickerPerturbation;

            // Apply fade-in to glow intensity
            const glowAlphas = [0.6 * pulseIntensity * fadeProgress, 0.3 * pulseIntensity * fadeProgress]; // Alpha values for distance 1, 2

            // Parse background color for alpha manipulation
            const bgHex = (engine.backgroundColor || '#FFFFFF').replace('#', '');
            const bgR = parseInt(bgHex.substring(0, 2), 16);
            const bgG = parseInt(bgHex.substring(2, 4), 16);
            const bgB = parseInt(bgHex.substring(4, 6), 16);

            // Collect all text cell positions
            const textCells = new Set<string>();
            let y = textStartY;
            wrappedLines.forEach(line => {
                for (let x = 0; x < line.length; x++) {
                    const char = line[x];
                    if (char && char.trim() !== '') {
                        textCells.add(`${textStartX + x},${y}`);
                    }
                }
                y++;
            });

            // Render glow for each text cell
            textCells.forEach(cellKey => {
                const [cx, cy] = cellKey.split(',').map(Number);

                // Extended radius for cardinal directions (up, down, left, right)
                const CARDINAL_EXTENSION = 1; // Extra cell in cardinal directions
                const maxRadius = GLOW_RADIUS + CARDINAL_EXTENSION;

                // Render glow in surrounding cells
                for (let dy = -maxRadius; dy <= maxRadius; dy++) {
                    for (let dx = -maxRadius; dx <= maxRadius; dx++) {
                        if (dx === 0 && dy === 0) continue; // Skip the text cell itself

                        const glowX = cx + dx;
                        const glowY = cy + dy;

                        // Skip if this is also a text cell
                        if (textCells.has(`${glowX},${glowY}`)) continue;

                        // Check if on cardinal direction (straight up/down/left/right)
                        const isCardinal = (dx === 0 || dy === 0);

                        // Use extended radius for cardinals, normal for diagonals
                        const effectiveRadius = isCardinal ? maxRadius : GLOW_RADIUS;

                        const distance = Math.max(Math.abs(dx), Math.abs(dy)); // Chebyshev distance
                        if (distance > effectiveRadius) continue;

                        // Map distance to alpha (use standard glow values, fade for extended)
                        let alpha;
                        if (distance <= GLOW_RADIUS) {
                            alpha = glowAlphas[distance - 1];
                        } else {
                            // Extended glow (only happens on cardinals) - very faint
                            alpha = glowAlphas[GLOW_RADIUS - 1] * 0.3;
                        }
                        if (!alpha) continue;

                        if (glowX >= startWorldX - 5 && glowX <= endWorldX + 5 && glowY >= startWorldY - 5 && glowY <= endWorldY + 5) {
                            const topScreenPos = engine.worldToScreen(glowX, glowY, currentZoom, currentOffset);
                            if (topScreenPos.x > -effectiveCharWidth * 2 && topScreenPos.x < cssWidth + effectiveCharWidth &&
                                topScreenPos.y > -effectiveCharHeight * 2 && topScreenPos.y < cssHeight + effectiveCharHeight) {

                                ctx.fillStyle = `rgba(${bgR}, ${bgG}, ${bgB}, ${alpha})`;
                                ctx.fillRect(topScreenPos.x, topScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                            }
                        }
                    }
                }
            });

            // Second pass: Render actual text with full background
            y = textStartY;
            wrappedLines.forEach(line => {
                for (let x = 0; x < line.length; x++) {
                    const char = line[x];
                    const worldX = textStartX + x;
                    const worldY = y;

                    if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                        const topScreenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                        if (topScreenPos.x > -effectiveCharWidth * 2 && topScreenPos.x < cssWidth + effectiveCharWidth &&
                            topScreenPos.y > -effectiveCharHeight * 2 && topScreenPos.y < cssHeight + effectiveCharHeight) {

                            if (char && char.trim() !== '') {
                                // Apply background highlight for host text with fade-in
                                const bgColorWithAlpha = (() => {
                                    const color = engine.backgroundColor || '#000000'; // Fallback to black
                                    if (color.startsWith('#')) {
                                        const hex = color.replace('#', '');
                                        const r = parseInt(hex.substring(0, 2), 16);
                                        const g = parseInt(hex.substring(2, 4), 16);
                                        const b = parseInt(hex.substring(4, 6), 16);
                                        return `rgba(${r}, ${g}, ${b}, ${fadeProgress})`;
                                    } else if (color.startsWith('rgb')) {
                                        return color.replace(/rgba?\(([^)]+)\)/, (match, values) => {
                                            const parts = values.split(',').map((v: string) => v.trim());
                                            return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${fadeProgress})`;
                                        });
                                    }
                                    return color;
                                })();
                                ctx.fillStyle = bgColorWithAlpha;
                                ctx.fillRect(topScreenPos.x, topScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);

                                // Render the character with host color and fade-in
                                const hostColorWithAlpha = (() => {
                                    if (hostColor.startsWith('#')) {
                                        const hex = hostColor.replace('#', '');
                                        const r = parseInt(hex.substring(0, 2), 16);
                                        const g = parseInt(hex.substring(2, 4), 16);
                                        const b = parseInt(hex.substring(4, 6), 16);
                                        return `rgba(${r}, ${g}, ${b}, ${fadeProgress})`;
                                    } else if (hostColor.startsWith('rgb')) {
                                        return hostColor.replace(/rgba?\(([^)]+)\)/, (match, values) => {
                                            const parts = values.split(',').map((v: string) => v.trim());
                                            return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${fadeProgress})`;
                                        });
                                    }
                                    return hostColor;
                                })();
                                ctx.fillStyle = hostColorWithAlpha;
                                renderText(ctx, char, topScreenPos.x, topScreenPos.y + verticalTextOffset);
                            }
                        }
                    }
                }
                y++;
            });

            // Render context-specific hints for certain messages
            const currentMessage = hostDialogue.getCurrentMessage();
            const isMobile = typeof window !== 'undefined' && 'ontouchstart' in window;

            let hintText: string | null = null;

            // Show hint only for specific message IDs
            if (currentMessage && !isMobile) {
                if (currentMessage.id === 'welcome_message' && !currentMessage.expectsInput) {
                    hintText = 'press any key to continue';
                } else if (currentMessage.id === 'collect_password' && currentMessage.expectsInput) {
                    hintText = 'press Tab to unhide password';
                }
            }

            if (hintText) {
                // Position hint at bottom of viewport, centered horizontally
                const bottomScreenY = cssHeight - (4 * effectiveCharHeight); // 4 lines from bottom
                const bottomWorldPos = engine.screenToWorld(cssWidth / 2, bottomScreenY, currentZoom, currentOffset);
                const hintY = Math.floor(bottomWorldPos.y);
                const hintStartX = Math.floor(engine.getViewportCenter().x - hintText.length / 2);

                for (let x = 0; x < hintText.length; x++) {
                    const char = hintText[x];
                    const worldX = hintStartX + x;
                    const worldY = hintY;

                    if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                        const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                        if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth &&
                            screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {

                            if (char && char.trim() !== '') {
                                // Render the hint character in backgroundColor with fade-in
                                const hintColorWithAlpha = (() => {
                                    const color = engine.backgroundColor || '#000000'; // Fallback to black
                                    if (color.startsWith('#')) {
                                        const hex = color.replace('#', '');
                                        const r = parseInt(hex.substring(0, 2), 16);
                                        const g = parseInt(hex.substring(2, 4), 16);
                                        const b = parseInt(hex.substring(4, 6), 16);
                                        return `rgba(${r}, ${g}, ${b}, ${fadeProgress})`;
                                    } else if (color.startsWith('rgb')) {
                                        return color.replace(/rgba?\(([^)]+)\)/, (match, values) => {
                                            const parts = values.split(',').map((v: string) => v.trim());
                                            return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${fadeProgress})`;
                                        });
                                    }
                                    return color;
                                })();
                                ctx.fillStyle = hintColorWithAlpha;
                                renderText(ctx, char, screenPos.x, screenPos.y + verticalTextOffset);
                            }
                        }
                    }
                }
            }

            // Check if host dialogue is off-screen and render arrow if needed
            const hostCenterScreenPos = engine.worldToScreen(engine.hostData.centerPos.x, engine.hostData.centerPos.y, currentZoom, currentOffset);
            const isHostVisible = hostCenterScreenPos.x >= 0 && hostCenterScreenPos.x <= cssWidth &&
                                  hostCenterScreenPos.y >= 0 && hostCenterScreenPos.y <= cssHeight;

            if (!isHostVisible) {
                // Host dialogue is off-screen, draw arrow pointing to it
                const viewportCenterScreen = {
                    x: cssWidth / 2,
                    y: cssHeight / 2
                };

                const intersection = getViewportEdgeIntersection(
                    viewportCenterScreen.x, viewportCenterScreen.y,
                    hostCenterScreenPos.x, hostCenterScreenPos.y,
                    cssWidth, cssHeight
                );

                if (intersection) {
                    const edgeBuffer = ARROW_MARGIN;
                    let adjustedX = intersection.x;
                    let adjustedY = intersection.y;

                    // Clamp to viewport bounds with margin
                    adjustedX = Math.max(edgeBuffer, Math.min(cssWidth - edgeBuffer, adjustedX));
                    adjustedY = Math.max(edgeBuffer, Math.min(cssHeight - edgeBuffer, adjustedY));

                    // Draw arrow with flickering glow effect (same flicker as text)
                    const glowAlpha = pulseIntensity;

                    // Render glow layers for arrow (larger to smaller) - only glow pulses
                    const glowLayers = [
                        { scale: 2.5, alpha: 0.15 * glowAlpha },
                        { scale: 2.0, alpha: 0.25 * glowAlpha },
                        { scale: 1.5, alpha: 0.35 * glowAlpha }
                    ];

                    glowLayers.forEach(layer => {
                        const glowColor = `rgba(${bgR}, ${bgG}, ${bgB}, ${layer.alpha})`;
                        ctx.save();
                        ctx.translate(adjustedX, adjustedY);
                        ctx.scale(layer.scale, layer.scale);
                        ctx.translate(-adjustedX, -adjustedY);
                        drawArrow(ctx, adjustedX, adjustedY, intersection.angle, glowColor);
                        ctx.restore();
                    });

                    // Draw main arrow in solid backgroundColor (no pulsing)
                    drawArrow(ctx, adjustedX, adjustedY, intersection.angle, engine.backgroundColor || '#FFFFFF');
                }
            }
        } else {
            // Reset dim fade tracking when host mode exits
            if (hasHostDimFadedInRef.current || hostDimFadeStartRef.current !== null) {
                hostDimFadeStartRef.current = null;
                hasHostDimFadedInRef.current = false;
            }
        }

        // === Render Chat Data (Black Background, White Text) ===
        // Check if we need to mask passwords in host mode (only if not toggled to visible)
        const shouldMaskPassword = engine.hostMode?.isActive && engine.hostMode?.currentInputType === 'password' && !isPasswordVisible;

        for (const key in engine.chatData) {
            const [xStr, yStr] = key.split(',');
            const worldX = parseInt(xStr, 10);
            const worldY = parseInt(yStr, 10);

            // Skip positions that are currently being used for IME composition preview in chat mode
            if (engine.isComposing && engine.compositionStartPos && engine.compositionText && engine.chatMode.isActive) {
                const compStartX = engine.compositionStartPos.x;
                const compEndX = compStartX + engine.compositionText.length - 1;
                const compY = engine.compositionStartPos.y;
                if (worldY === compY && worldX >= compStartX && worldX <= compEndX) {
                    continue;
                }
            }

            if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                const charData = engine.chatData[key];

                // Skip image data - only process text characters
                if (engine.isImageData(charData)) {
                    continue;
                }

                let char = typeof charData === 'string' ? charData : charData.char;

                // Mask password characters with bullets in host mode
                if (shouldMaskPassword && char && char.trim() !== '') {
                    char = '•';
                }

                const bottomScreenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                const topScreenPos = engine.worldToScreen(worldX, worldY - 1, currentZoom, currentOffset);
                if (bottomScreenPos.x > -effectiveCharWidth * 2 && bottomScreenPos.x < cssWidth + effectiveCharWidth && topScreenPos.y > -effectiveCharHeight * 2 && bottomScreenPos.y < cssHeight + effectiveCharHeight) {
                    if (char) {
                        // Draw background spanning GRID_CELL_SPAN cells using accent color (skip when monogram is enabled)
                        if (!monogram.options.enabled) {
                            ctx.fillStyle = engine.textColor;
                            ctx.fillRect(topScreenPos.x, topScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                        }

                        // Draw text using background color (inverse of accent)
                        if (char.trim() !== '') {
                            ctx.fillStyle = monogram.options.enabled ? engine.textColor : (engine.backgroundColor || '#FFFFFF');
                            renderText(ctx, char, topScreenPos.x, topScreenPos.y + verticalTextOffset);
                        }
                    }
                }
            }
        }

        // === Render IME Composition Preview for Chat Mode ===
        if (engine.isComposing && engine.compositionText && engine.compositionStartPos && engine.chatMode.isActive) {
            const startPos = engine.compositionStartPos;

            for (let i = 0; i < engine.compositionText.length; i++) {
                const char = engine.compositionText[i];
                const worldX = startPos.x + i;
                const worldY = startPos.y;

                if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                    const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);

                    if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth &&
                        screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {

                        if (char && char.trim() !== '') {
                            // Draw background using accent color (engine.textColor)
                            ctx.fillStyle = engine.textColor;
                            ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);

                            // Draw text using background color (inverse of accent)
                            ctx.fillStyle = engine.backgroundColor || '#FFFFFF';
                            renderText(ctx, char, screenPos.x, screenPos.y + verticalTextOffset);

                            // Draw underline to indicate composition state
                            ctx.fillStyle = engine.backgroundColor || '#FFFFFF';
                            ctx.fillRect(
                                screenPos.x,
                                screenPos.y + effectiveCharHeight - 2,
                                effectiveCharWidth,
                                2
                            );
                        }
                    }
                }
            }
        }

        // === Render Suggestion Data (Gray Ghost Text) ===
        for (const key in engine.suggestionData) {
            const [xStr, yStr] = key.split(',');
            const worldX = parseInt(xStr, 10);
            const worldY = parseInt(yStr, 10);

            if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                const charData = engine.suggestionData[key];

                // Skip image data - only process text characters
                if (engine.isImageData(charData)) {
                    continue;
                }

                const char = typeof charData === 'string' ? charData : charData.char;

                const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                    if (char && char.trim() !== '') {
                        // Draw suggestion text in gray (50% opacity)
                        ctx.fillStyle = engine.textColor;
                        ctx.globalAlpha = 0.3;
                        renderText(ctx, char, screenPos.x, screenPos.y + verticalTextOffset);
                        ctx.globalAlpha = 1.0;
                    }
                }
            }
        }


        // === Render Search Data (Purple Background, White Text) ===
        for (const key in engine.searchData) {
            const [xStr, yStr] = key.split(',');
            const worldX = parseInt(xStr, 10);
            const worldY = parseInt(yStr, 10);

            if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                const charData = engine.searchData[key];

                // Skip image data - only process text characters
                if (engine.isImageData(charData)) {
                    continue;
                }

                const char = typeof charData === 'string' ? charData : charData.char;
                const bottomScreenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                const topScreenPos = engine.worldToScreen(worldX, worldY - 1, currentZoom, currentOffset);
                if (bottomScreenPos.x > -effectiveCharWidth * 2 && bottomScreenPos.x < cssWidth + effectiveCharWidth && topScreenPos.y > -effectiveCharHeight * 2 && bottomScreenPos.y < cssHeight + effectiveCharHeight) {
                    if (char && char.trim() !== '') {
                        // Draw purple background spanning GRID_CELL_SPAN cells (skip when monogram is enabled)
                        if (!monogram.options.enabled) {
                            ctx.fillStyle = '#800080';
                            ctx.fillRect(topScreenPos.x, topScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                        }

                        // Draw white text (or textColor when monogram is enabled)
                        ctx.fillStyle = monogram.options.enabled ? engine.textColor : '#FFFFFF';
                        renderText(ctx, char, topScreenPos.x, topScreenPos.y + verticalTextOffset);
                    }
                }
            }
        }

        // === Render Command Data ===
        if (engine.commandState.isActive) {
            // First, draw background for selected command (only if user has navigated)
            if (engine.commandState.hasNavigated) {
                const selectedCommandY = engine.commandState.commandStartPos.y + GRID_CELL_SPAN + (engine.commandState.selectedIndex * GRID_CELL_SPAN);
                const selectedCommand = engine.commandState.matchedCommands[engine.commandState.selectedIndex];
                if (selectedCommand) {
                    const selectedBottomScreenPos = engine.worldToScreen(engine.commandState.commandStartPos.x, selectedCommandY, currentZoom, currentOffset);
                    const selectedTopScreenPos = engine.worldToScreen(engine.commandState.commandStartPos.x, selectedCommandY - 1, currentZoom, currentOffset);
                    if (selectedBottomScreenPos.x > -effectiveCharWidth * 2 && selectedBottomScreenPos.x < cssWidth + effectiveCharWidth && selectedTopScreenPos.y > -effectiveCharHeight * 2 && selectedBottomScreenPos.y < cssHeight + effectiveCharHeight) {
                        ctx.fillStyle = 'rgba(255, 107, 53, 0.3)'; // Highlight background
                        ctx.fillRect(selectedTopScreenPos.x, selectedTopScreenPos.y, selectedCommand.length * effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                    }
                }
            }
        }

        for (const key in engine.commandData) {
            const [xStr, yStr] = key.split(',');
            const worldX = parseInt(xStr, 10); const worldY = parseInt(yStr, 10);

            // Skip positions that are currently being used for IME composition preview in command mode
            if (engine.isComposing && engine.compositionStartPos && engine.compositionText && engine.commandState.isActive) {
                const compStartX = engine.compositionStartPos.x;
                const compEndX = compStartX + engine.compositionText.length - 1;
                const compY = engine.compositionStartPos.y;
                if (worldY === compY && worldX >= compStartX && worldX <= compEndX) {
                    continue;
                }
            }

            if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                const charData = engine.commandData[key];
                
                // Skip image data - only process text characters
                if (engine.isImageData(charData)) {
                    continue;
                }
                
                const char = typeof charData === 'string' ? charData : charData.char;
                const charStyle = typeof charData === 'object' && 'style' in charData ? charData.style : undefined;
                const bottomScreenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                const topScreenPos = engine.worldToScreen(worldX, worldY - 1, currentZoom, currentOffset);
                if (bottomScreenPos.x > -effectiveCharWidth * 2 && bottomScreenPos.x < cssWidth + effectiveCharWidth && topScreenPos.y > -effectiveCharHeight * 2 && bottomScreenPos.y < cssHeight + effectiveCharHeight) {
                    // Check if this is a category label (special background marker)
                    const isCategoryLabel = charStyle?.background === 'category-label';

                    // Get command text and check if it's a color command
                    const suggestionIndex = (worldY - engine.commandState.commandStartPos.y - GRID_CELL_SPAN) / GRID_CELL_SPAN;
                    let highlightColor: string | null = null;
                    let commandText = '';

                    if (suggestionIndex >= 0 && suggestionIndex < engine.commandState.matchedCommands.length) {
                        commandText = engine.commandState.matchedCommands[suggestionIndex] || '';

                        // Extract color from bg/text commands
                        if (commandText.startsWith('bg ')) {
                            const parts = commandText.split(' ');
                            const colorArg = parts[1];
                            if (colorArg && !['clear', 'live', 'web'].includes(colorArg)) {
                                highlightColor = COLOR_MAP[colorArg.toLowerCase()] || (colorArg.startsWith('#') ? colorArg : null);
                            }
                        } else if (commandText.startsWith('text ')) {
                            const parts = commandText.split(' ');
                            const colorArg = parts[parts[1] === '--g' ? 2 : 1];
                            if (colorArg && colorArg !== '--g') {
                                highlightColor = COLOR_MAP[colorArg.toLowerCase()] || (colorArg.startsWith('#') ? colorArg : null);
                            }
                        }
                    }

                    // Check if mouse is hovering over this command line
                    let isHovered = false;
                    if (mouseWorldPos && worldY > engine.commandState.commandStartPos.y) {
                        if (isCategoryLabel) {
                            // For category labels, highlight if hovering over any command in this category
                            const categoryName = charStyle?.color; // Category name is stored in style.color
                            const hoveredIndex = Math.floor(mouseWorldPos.y) - engine.commandState.commandStartPos.y - 1;
                            if (hoveredIndex >= 0 && hoveredIndex < engine.commandState.matchedCommands.length) {
                                const hoveredCommand = engine.commandState.matchedCommands[hoveredIndex];
                                // Check if hovered command belongs to this category
                                isHovered = (categoryName && COMMAND_CATEGORIES[categoryName as keyof typeof COMMAND_CATEGORIES]?.includes(hoveredCommand)) || false;
                            }
                        } else {
                            // For regular commands, just check Y coordinate
                            isHovered = Math.floor(mouseWorldPos.y) === worldY;
                        }
                    }

                    // Draw background for command data
                    if (isCategoryLabel) {
                        // Category label - flip colors with alpha matching command suggestions
                        // Special handling for stream mode
                        const useStreamMode = engine.backgroundMode === 'stream' && !engine.backgroundColor;

                        const bgHex = useStreamMode ? '000000' : (engine.backgroundColor || '#FFFFFF').replace('#', '');
                        const bgR = parseInt(bgHex.substring(0, 2), 16);
                        const bgG = parseInt(bgHex.substring(2, 4), 16);
                        const bgB = parseInt(bgHex.substring(4, 6), 16);

                        const textHex = useStreamMode ? 'FFFFFF' : engine.textColor.replace('#', '');
                        const textR = parseInt(textHex.substring(0, 2), 16);
                        const textG = parseInt(textHex.substring(2, 4), 16);
                        const textB = parseInt(textHex.substring(4, 6), 16);

                        // Check if this category label should be highlighted based on selected command
                        let isSelected = false;
                        if (engine.commandState.isActive && engine.commandState.hasNavigated && engine.commandState.selectedIndex >= 0) {
                            const categoryName = charStyle?.color; // Category name is stored in style.color
                            const selectedCommand = engine.commandState.matchedCommands[engine.commandState.selectedIndex];
                            if (selectedCommand && categoryName) {
                                // Check if selected command belongs to this category
                                isSelected = COMMAND_CATEGORIES[categoryName]?.includes(selectedCommand) || false;
                            }
                        }

                        if (isHovered) {
                            // Hovered category label
                            if (useStreamMode) {
                                // Stream mode - no background, just white text
                                ctx.fillStyle = '#FFFFFF';
                            } else {
                                // Normal mode - use background
                                ctx.fillStyle = `rgba(${bgR}, ${bgG}, ${bgB}, 0.9)`;
                                ctx.fillRect(topScreenPos.x, topScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                                ctx.fillStyle = engine.textColor;
                            }
                        } else if (isSelected) {
                            // Selected category label
                            if (useStreamMode) {
                                // Stream mode - no background, just white text
                                ctx.fillStyle = '#FFFFFF';
                            } else {
                                // Normal mode - use background
                                ctx.fillStyle = `rgba(${bgR}, ${bgG}, ${bgB}, 0.8)`;
                                ctx.fillRect(topScreenPos.x, topScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                                ctx.fillStyle = engine.textColor;
                            }
                        } else {
                            // Other category labels
                            if (useStreamMode) {
                                // Stream mode - no background, just white text with opacity
                                ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
                            } else {
                                // Normal mode - use background
                                ctx.fillStyle = `rgba(${bgR}, ${bgG}, ${bgB}, 0.6)`;
                                ctx.fillRect(topScreenPos.x, topScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                                ctx.fillStyle = `rgba(${textR}, ${textG}, ${textB}, 0.6)`;
                            }
                        }
                    } else if (worldY === engine.commandState.commandStartPos.y) {
                        // Command line (typed command) - use text color at full opacity
                        // Special case: for stream/webcam mode with no background color, don't draw background box
                        if (engine.backgroundMode === 'stream' && !engine.backgroundColor) {
                            // No background - just white text
                            ctx.fillStyle = '#FFFFFF';
                        } else {
                            ctx.fillStyle = engine.textColor;
                            ctx.fillRect(topScreenPos.x, topScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                            // Text uses background color
                            ctx.fillStyle = engine.backgroundColor || '#FFFFFF';
                        }
                    } else if (isHovered) {
                        // Hovered suggestion - use swatch color if available, otherwise text color
                        if (highlightColor) {
                            ctx.fillStyle = highlightColor;
                            ctx.fillRect(topScreenPos.x, topScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                            // Text uses contrasting color (white or black based on luminance)
                            const hex = highlightColor.replace('#', '');
                            const r = parseInt(hex.substring(0, 2), 16);
                            const g = parseInt(hex.substring(2, 4), 16);
                            const b = parseInt(hex.substring(4, 6), 16);
                            const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                            ctx.fillStyle = luminance > 0.5 ? '#000000' : '#FFFFFF';
                        } else if (engine.backgroundMode === 'stream' && !engine.backgroundColor) {
                            // Stream mode - no background, just white text
                            ctx.fillStyle = '#FFFFFF';
                        } else {
                            const hex = engine.textColor.replace('#', '');
                            const r = parseInt(hex.substring(0, 2), 16);
                            const g = parseInt(hex.substring(2, 4), 16);
                            const b = parseInt(hex.substring(4, 6), 16);
                            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.9)`;
                            ctx.fillRect(topScreenPos.x, topScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                            ctx.fillStyle = engine.backgroundColor || '#FFFFFF';
                        }
                    } else if (engine.commandState.isActive && engine.commandState.hasNavigated && worldY === engine.commandState.commandStartPos.y + GRID_CELL_SPAN + (engine.commandState.selectedIndex * GRID_CELL_SPAN)) {
                        // Selected suggestion - use swatch color at 80% opacity if available
                        if (highlightColor) {
                            const hex = highlightColor.replace('#', '');
                            const r = parseInt(hex.substring(0, 2), 16);
                            const g = parseInt(hex.substring(2, 4), 16);
                            const b = parseInt(hex.substring(4, 6), 16);
                            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.8)`;
                            ctx.fillRect(topScreenPos.x, topScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                            const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                            ctx.fillStyle = luminance > 0.5 ? '#000000' : '#FFFFFF';
                        } else if (engine.backgroundMode === 'stream' && !engine.backgroundColor) {
                            // Stream mode - no background, just white text
                            ctx.fillStyle = '#FFFFFF';
                        } else {
                            const hex = engine.textColor.replace('#', '');
                            const r = parseInt(hex.substring(0, 2), 16);
                            const g = parseInt(hex.substring(2, 4), 16);
                            const b = parseInt(hex.substring(4, 6), 16);
                            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.8)`;
                            ctx.fillRect(topScreenPos.x, topScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                            ctx.fillStyle = engine.backgroundColor || '#FFFFFF';
                        }
                    } else {
                        // Other suggestions - use text color at 60% opacity
                        if (engine.backgroundMode === 'stream' && !engine.backgroundColor) {
                            // Stream mode - no background, just white text with opacity
                            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                        } else {
                            const hex = engine.textColor.replace('#', '');
                            const r = parseInt(hex.substring(0, 2), 16);
                            const g = parseInt(hex.substring(2, 4), 16);
                            const b = parseInt(hex.substring(4, 6), 16);
                            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.6)`;
                            ctx.fillRect(topScreenPos.x, topScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                            // Text uses background color at higher opacity for readability
                            const bgHex = (engine.backgroundColor || '#FFFFFF').replace('#', '');
                            const bgR = parseInt(bgHex.substring(0, 2), 16);
                            const bgG = parseInt(bgHex.substring(2, 4), 16);
                            const bgB = parseInt(bgHex.substring(4, 6), 16);
                            ctx.fillStyle = `rgba(${bgR}, ${bgG}, ${bgB}, 0.9)`;
                        }
                    }

                    // Draw text (only if not a space)
                    if (char && char.trim() !== '') {
                        renderText(ctx, char, topScreenPos.x, topScreenPos.y + verticalTextOffset);
                    }

                    // Draw color swatch for color-related commands (only on first character of suggestion line)
                    if (worldX === engine.commandState.commandStartPos.x && worldY > engine.commandState.commandStartPos.y) {
                        // Get the full command text for this line
                        const suggestionIndex = (worldY - engine.commandState.commandStartPos.y - GRID_CELL_SPAN) / GRID_CELL_SPAN;
                        if (suggestionIndex >= 0 && suggestionIndex < engine.commandState.matchedCommands.length) {
                            const commandText = engine.commandState.matchedCommands[suggestionIndex] || '';


                            let swatchColor: string | null = null;

                            // Check if this is a bg command with a color
                            if (commandText.startsWith('bg ')) {
                                const parts = commandText.split(' ');
                                const colorArg = parts[1];

                                // Skip 'clear', 'live', 'web'
                                if (colorArg && !['clear', 'live', 'web'].includes(colorArg)) {
                                    swatchColor = COLOR_MAP[colorArg.toLowerCase()] || (colorArg.startsWith('#') ? colorArg : null);
                                }
                            }
                            // Check if this is a text command with a color
                            else if (commandText.startsWith('text ')) {
                                const parts = commandText.split(' ');
                                let colorArg: string | undefined;

                                // Handle both /text [color] and /text --g [color]
                                if (parts[1] === '--g' && parts.length > 2) {
                                    colorArg = parts[2];
                                } else if (parts[1] && parts[1] !== '--g') {
                                    colorArg = parts[1];
                                }

                                if (colorArg) {
                                    swatchColor = COLOR_MAP[colorArg.toLowerCase()] || (colorArg.startsWith('#') ? colorArg : null);
                                }
                            }

                            if (swatchColor) {
                                // Draw full-sized color cell to the left of the command
                                const cellX = topScreenPos.x - effectiveCharWidth;
                                const cellY = topScreenPos.y;

                                ctx.fillStyle = swatchColor;
                                ctx.fillRect(cellX, cellY, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                            }

                            // In help mode, show help text on hover (styled like category labels)
                            if (engine.commandState.helpMode && isHovered) {
                                const baseCommand = commandText.split(' ')[0];
                                const helpText = COMMAND_HELP[baseCommand];
                                if (helpText) {
                                    // Find the longest command to determine consistent help text start position
                                    const longestCommandLength = Math.max(...engine.commandState.matchedCommands.map(cmd => cmd.length));
                                    const helpStartX = engine.commandState.commandStartPos.x + longestCommandLength + 1; // +3 for 2 spaces gap
                                    const maxWrapWidth = 60; // Maximum width for help text

                                    // Get background and text colors for category-label style
                                    const bgHex = (engine.backgroundColor || '#FFFFFF').replace('#', '');
                                    const bgR = parseInt(bgHex.substring(0, 2), 16);
                                    const bgG = parseInt(bgHex.substring(2, 4), 16);
                                    const bgB = parseInt(bgHex.substring(4, 6), 16);

                                    // Word wrap the help text
                                    const wrapText = (text: string, maxWidth: number): string[] => {
                                        const words = text.split(' ');
                                        const lines: string[] = [];
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
                                        return lines;
                                    };

                                    const wrappedLines = wrapText(helpText, maxWrapWidth);

                                    // Draw wrapped help text with category-label styling
                                    wrappedLines.forEach((line, lineIndex) => {
                                        const helpY = worldY + lineIndex;
                                        for (let i = 0; i < line.length; i++) {
                                            const helpWorldX = helpStartX + i;
                                            const helpBottomScreenPos = engine.worldToScreen(helpWorldX, helpY, currentZoom, currentOffset);
                                            const helpTopScreenPos = engine.worldToScreen(helpWorldX, helpY - 1, currentZoom, currentOffset);

                                            if (helpBottomScreenPos.x > -effectiveCharWidth * 2 && helpBottomScreenPos.x < cssWidth + effectiveCharWidth &&
                                                helpTopScreenPos.y > -effectiveCharHeight * 2 && helpBottomScreenPos.y < cssHeight + effectiveCharHeight) {
                                                // Draw background (90% opacity like hovered category labels)
                                                ctx.fillStyle = `rgba(${bgR}, ${bgG}, ${bgB}, 0.9)`;
                                                ctx.fillRect(helpTopScreenPos.x, helpTopScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);

                                                // Draw text in text color
                                                ctx.fillStyle = engine.textColor;
                                                if (line[i] && line[i].trim() !== '') {
                                                    renderText(ctx, line[i], helpTopScreenPos.x, helpTopScreenPos.y + verticalTextOffset);
                                                }
                                            }
                                        }
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        // === Render IME Composition Preview for Command Mode ===
        if (engine.isComposing && engine.compositionText && engine.compositionStartPos && engine.commandState.isActive) {
            const startPos = engine.compositionStartPos;

            for (let i = 0; i < engine.compositionText.length; i++) {
                const char = engine.compositionText[i];
                const worldX = startPos.x + i;
                const worldY = startPos.y;

                if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                    const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);

                    if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth &&
                        screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {

                        if (char && char.trim() !== '') {
                            // Draw background using text color (command line style)
                            ctx.fillStyle = engine.textColor;
                            ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);

                            // Draw text using background color
                            ctx.fillStyle = engine.backgroundColor || '#FFFFFF';
                            renderText(ctx, char, screenPos.x, screenPos.y + verticalTextOffset);

                            // Draw underline to indicate composition state
                            ctx.fillStyle = engine.backgroundColor || '#FFFFFF';
                            ctx.fillRect(
                                screenPos.x,
                                screenPos.y + effectiveCharHeight - 2,
                                effectiveCharWidth,
                                2
                            );
                        }
                    }
                }
            }
        }

        ctx.fillStyle = engine.textColor; // Reset to normal text color


        // === Debug Scaffolds === (Green dot removed)



        // === Render Labels or Search Match Arrows ===
        const viewBounds = {
            minX: Math.floor(startWorldX),
            maxX: Math.ceil(endWorldX),
            minY: Math.floor(startWorldY),
            maxY: Math.ceil(endWorldY)
        };
        const viewportCenterScreen = { x: cssWidth / 2, y: cssHeight / 2 };

        if (engine.isSearchActive && engine.searchPattern) {
            // When search is active, show arrows to search matches instead of labels
            const searchMatches = new Map<string, {x: number, y: number, text: string}>();
            
            // Collect search match positions (one per match, not per character)
            for (const key in engine.searchData) {
                const [xStr, yStr] = key.split(',');
                const worldX = parseInt(xStr, 10);
                const worldY = parseInt(yStr, 10);
                const matchKey = `${worldY}`; // Group by line
                
                if (!searchMatches.has(matchKey) || searchMatches.get(matchKey)!.x > worldX) {
                    // Build the full matched text
                    let matchText = '';
                    for (let i = 0; i < engine.searchPattern.length; i++) {
                        const checkKey = `${worldX + i},${worldY}`;
                        if (engine.searchData[checkKey]) {
                            const charData = engine.searchData[checkKey];
                            if (!engine.isImageData(charData)) {
                                const char = typeof charData === 'string' ? charData : charData.char;
                                matchText += char;
                            }
                        }
                    }
                    searchMatches.set(matchKey, { x: worldX, y: worldY, text: matchText });
                }
            }

            // Draw arrows to off-screen search matches
            for (const match of searchMatches.values()) {
                const isVisible = match.x <= viewBounds.maxX && (match.x + engine.searchPattern.length) >= viewBounds.minX &&
                                  match.y >= viewBounds.minY && match.y <= viewBounds.maxY;

                if (!isVisible) {
                    const matchScreenPos = engine.worldToScreen(match.x, match.y, currentZoom, currentOffset);
                    const intersection = getViewportEdgeIntersection(
                        viewportCenterScreen.x, viewportCenterScreen.y,
                        matchScreenPos.x, matchScreenPos.y,
                        cssWidth, cssHeight
                    );

                    if (intersection) {
                        const edgeBuffer = ARROW_MARGIN;
                        let adjustedX = intersection.x;
                        let adjustedY = intersection.y;
                        
                        adjustedX = Math.max(edgeBuffer, Math.min(cssWidth - edgeBuffer, adjustedX));
                        adjustedY = Math.max(edgeBuffer, Math.min(cssHeight - edgeBuffer, adjustedY));
                        
                        // Use purple color for search match arrows
                        drawArrow(ctx, adjustedX, adjustedY, intersection.angle, '#800080');

                        // Draw the search match text next to the arrow
                        // Calculate distance from viewport center to search match
                        const viewportCenter = engine.getViewportCenter();
                        const deltaX = match.x - viewportCenter.x;
                        const deltaY = match.y - viewportCenter.y;
                        const distance = Math.round(Math.sqrt(deltaX * deltaX + deltaY * deltaY));
                        
                        ctx.fillStyle = '#800080';
                        ctx.font = `${effectiveFontSize}px ${fontFamily}`;
                        const textOffset = ARROW_SIZE * 1.5;
                        
                        let textX = adjustedX - Math.cos(intersection.angle) * textOffset;
                        let textY = adjustedY - Math.sin(intersection.angle) * textOffset;

                        // Adjust alignment to keep text inside the screen bounds
                        if (Math.abs(intersection.angle) < Math.PI / 2) {
                            ctx.textAlign = 'right';
                        } else {
                            ctx.textAlign = 'left';
                        }

                        if (intersection.angle > Math.PI / 4 && intersection.angle < 3 * Math.PI / 4) {
                            ctx.textBaseline = 'bottom';
                        } else if (intersection.angle < -Math.PI / 4 && intersection.angle > -3 * Math.PI / 4) {
                            ctx.textBaseline = 'top';
                        } else {
                            ctx.textBaseline = 'middle';
                        }

                        // Add distance indicator only if proximity threshold is not disabled
                        const distanceText = engine.settings.labelProximityThreshold >= 999999 ? '' : ` [${distance}]`;
                        ctx.fillText(match.text + distanceText, textX, textY);

                        // Reset to defaults
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'top';
                    }
                }
            }
        } else {
            // Normal label rendering when search is not active
            for (const key in engine.worldData) {
                if (key.startsWith('label_')) {
                    const coordsStr = key.substring('label_'.length);
                    const [xStr, yStr] = coordsStr.split(',');
                    const worldX = parseInt(xStr, 10);
                    const worldY = parseInt(yStr, 10);

                    try {
                        const charData = engine.worldData[key];
                        const charString = engine.isImageData(charData) ? '' : engine.getCharacter(charData);
                        const labelData = JSON.parse(charString);
                        const text = labelData.text || '';
                        const labelColor = labelData.color || engine.textColor; // Default to text color (accent)
                        const labelWidthInChars = text.length;

                        const isVisible = worldX <= viewBounds.maxX && (worldX + labelWidthInChars) >= viewBounds.minX &&
                                          worldY >= viewBounds.minY && worldY <= viewBounds.maxY;

                        if (isVisible) {
                            // Ensure consistent font settings for labels (same as regular text)
                            ctx.font = `${effectiveFontSize}px ${fontFamily}`;
                            ctx.textBaseline = 'top';

                            // Render each character of the label individually across cells
                            for (let charIndex = 0; charIndex < text.length; charIndex++) {
                                const charWorldX = worldX + charIndex;
                                const bottomScreenPos = engine.worldToScreen(charWorldX, worldY, currentZoom, currentOffset);
                                const topScreenPos = engine.worldToScreen(charWorldX, worldY - 1, currentZoom, currentOffset);

                                // Fill background with accent color (spanning GRID_CELL_SPAN cells)
                                ctx.fillStyle = labelColor;
                                ctx.fillRect(topScreenPos.x, topScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);

                                // Render text with background color (cutout effect)
                                ctx.fillStyle = engine.backgroundColor || '#FFFFFF';
                                ctx.fillText(text[charIndex], topScreenPos.x, topScreenPos.y + verticalTextOffset);
                            }
                        } else {
                            // Calculate distance from viewport center to label
                            const viewportCenter = engine.getViewportCenter();
                            const deltaX = worldX - viewportCenter.x;
                            const deltaY = worldY - viewportCenter.y;
                            const distance = Math.round(Math.sqrt(deltaX * deltaX + deltaY * deltaY));
                            
                            // Only show waypoint arrow if within proximity threshold
                            if (distance <= engine.settings.labelProximityThreshold) {
                                const labelScreenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                                const intersection = getViewportEdgeIntersection(
                                    viewportCenterScreen.x, viewportCenterScreen.y,
                                    labelScreenPos.x, labelScreenPos.y,
                                    cssWidth, cssHeight
                                );

                                if (intersection) {
                                const edgeBuffer = ARROW_MARGIN;
                                let adjustedX = intersection.x;
                                let adjustedY = intersection.y;
                                
                                adjustedX = Math.max(edgeBuffer, Math.min(cssWidth - edgeBuffer, adjustedX));
                                adjustedY = Math.max(edgeBuffer, Math.min(cssHeight - edgeBuffer, adjustedY));

                                drawArrow(ctx, adjustedX, adjustedY, intersection.angle, labelColor);

                                // Draw the label text next to the arrow
                                if (text) {

                                ctx.fillStyle = labelColor;
                                ctx.font = `${effectiveFontSize}px ${fontFamily}`;
                                const textOffset = ARROW_SIZE * 1.5;
                                
                                let textX = adjustedX - Math.cos(intersection.angle) * textOffset;
                                let textY = adjustedY - Math.sin(intersection.angle) * textOffset;

                                // Adjust alignment to keep text inside the screen bounds
                                if (Math.abs(intersection.angle) < Math.PI / 2) {
                                    ctx.textAlign = 'right';
                                } else {
                                    ctx.textAlign = 'left';
                                }

                                if (intersection.angle > Math.PI / 4 && intersection.angle < 3 * Math.PI / 4) {
                                    ctx.textBaseline = 'bottom';
                                } else if (intersection.angle < -Math.PI / 4 && intersection.angle > -3 * Math.PI / 4) {
                                    ctx.textBaseline = 'top';
                                } else {
                                    ctx.textBaseline = 'middle';
                                }

                                // Add distance indicator only if proximity threshold is not disabled
                                const distanceText = engine.settings.labelProximityThreshold >= 999999 ? '' : ` [${distance}]`;
                                ctx.fillText(text + distanceText, textX, textY);

                                // Reset to defaults
                                ctx.textAlign = 'left';
                                ctx.textBaseline = 'top';
                                }
                            }
                            }
                        }
                    } catch (e) {
                        console.error(`Error parsing label data for key ${key}:`, e);
                    }
                }
            }
        }

        // === Render Waypoint Arrows for Ephemeral Labels (lightModeData) ===
        // Skip if lightModeData is substantial (likely from staged template, not ephemeral labels)
        const lightModeDataSize = Object.keys(engine.lightModeData).length;
        if (lightModeDataSize < 100) {
            // Check lightModeData for label patterns (ephemeral labels from host mode)
            const ephemeralLabels: Map<string, { x: number, y: number, text: string, color: string }> = new Map();

            for (const key in engine.lightModeData) {
                const [xStr, yStr] = key.split(',');
                const x = parseInt(xStr, 10);
                const y = parseInt(yStr, 10);

                if (!isNaN(x) && !isNaN(y)) {
                    const charData = engine.lightModeData[key];
                    if (!engine.isImageData(charData)) {
                        const char = engine.getCharacter(charData);
                        const style = engine.getCharacterStyle(charData);

                        // Group consecutive characters by y-coordinate to detect labels
                        const labelKey = `${y}`;
                        if (!ephemeralLabels.has(labelKey)) {
                            ephemeralLabels.set(labelKey, {
                                x: x,
                                y: y,
                                text: char,
                                color: style?.color || '#FFFFFF'
                            });
                        } else {
                            const existing = ephemeralLabels.get(labelKey)!;
                            if (x === existing.x + existing.text.length) {
                                existing.text += char;
                            }
                        }
                    }
                }
            }

            // Render waypoint arrows for offscreen ephemeral labels
            ephemeralLabels.forEach((labelData) => {
                const worldX = labelData.x;
                const worldY = labelData.y;
                const text = labelData.text;
                const color = labelData.color;
                const labelWidthInChars = text.length;

                const isVisible = worldX <= viewBounds.maxX && (worldX + labelWidthInChars) >= viewBounds.minX &&
                                  worldY >= viewBounds.minY && worldY <= viewBounds.maxY;

                if (!isVisible) {
                    // Calculate distance from viewport center
                    const viewportCenter = engine.getViewportCenter();
                    const deltaX = worldX - viewportCenter.x;
                    const deltaY = worldY - viewportCenter.y;
                    const distance = Math.round(Math.sqrt(deltaX * deltaX + deltaY * deltaY));

                    // Show waypoint arrow (using large threshold for ephemeral labels)
                    if (distance <= 200) { // Fixed threshold for ephemeral labels
                        const labelScreenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                        const intersection = getViewportEdgeIntersection(
                            viewportCenterScreen.x, viewportCenterScreen.y,
                            labelScreenPos.x, labelScreenPos.y,
                            cssWidth, cssHeight
                        );

                        if (intersection) {
                            const edgeBuffer = ARROW_MARGIN;
                            let adjustedX = intersection.x;
                            let adjustedY = intersection.y;

                            adjustedX = Math.max(edgeBuffer, Math.min(cssWidth - edgeBuffer, adjustedX));
                            adjustedY = Math.max(edgeBuffer, Math.min(cssHeight - edgeBuffer, adjustedY));

                            drawArrow(ctx, adjustedX, adjustedY, intersection.angle, color);

                            // Draw label text next to arrow
                            if (text) {
                                ctx.fillStyle = color;
                                ctx.font = `${effectiveFontSize}px ${fontFamily}`;
                                const textOffset = ARROW_SIZE * 1.5;

                                let textX = adjustedX - Math.cos(intersection.angle) * textOffset;
                                let textY = adjustedY - Math.sin(intersection.angle) * textOffset;

                                ctx.textAlign = intersection.angle > -Math.PI/2 && intersection.angle < Math.PI/2 ? 'left' : 'right';

                                if (intersection.angle > Math.PI / 4 && intersection.angle < 3 * Math.PI / 4) {
                                    ctx.textBaseline = 'bottom';
                                } else if (intersection.angle < -Math.PI / 4 && intersection.angle > -3 * Math.PI / 4) {
                                    ctx.textBaseline = 'top';
                                } else {
                                    ctx.textBaseline = 'middle';
                                }

                                ctx.fillText(text + ` [${distance}]`, textX, textY);

                                ctx.textAlign = 'left';
                                ctx.textBaseline = 'top';
                            }
                        }
                    }
                }
            });
        } // Close lightModeData check

        // === Render Waypoint Arrows for Off-Screen Bounds ===
        if (!engine.isNavVisible) {
            for (const key in engine.worldData) {
                if (key.startsWith('bound_')) {
                    try {
                        const boundData = JSON.parse(engine.worldData[key] as string);
                        const { startX, endX, startY, endY, maxY } = boundData;

                        // Use the center of the top bar as reference point
                        const boundCenterX = Math.floor((startX + endX) / 2);
                        const boundY = startY;

                        // Check if bound is visible in viewport
                        const isVisible = startX <= viewBounds.maxX && endX >= viewBounds.minX &&
                                        startY >= viewBounds.minY && startY <= viewBounds.maxY;

                        if (!isVisible) {
                            // Calculate distance from viewport center to bound
                            const viewportCenter = engine.getViewportCenter();
                            const deltaX = boundCenterX - viewportCenter.x;
                            const deltaY = boundY - viewportCenter.y;
                            const distance = Math.round(Math.sqrt(deltaX * deltaX + deltaY * deltaY));

                            // Only show waypoint arrow if within proximity threshold
                            if (distance <= engine.settings.labelProximityThreshold) {
                                const boundScreenPos = engine.worldToScreen(boundCenterX, boundY, currentZoom, currentOffset);
                                const intersection = getViewportEdgeIntersection(
                                    viewportCenterScreen.x, viewportCenterScreen.y,
                                    boundScreenPos.x, boundScreenPos.y,
                                    cssWidth, cssHeight
                                );

                                if (intersection) {
                                    const edgeBuffer = ARROW_MARGIN;
                                    let adjustedX = intersection.x;
                                    let adjustedY = intersection.y;

                                    adjustedX = Math.max(edgeBuffer, Math.min(cssWidth - edgeBuffer, adjustedX));
                                    adjustedY = Math.max(edgeBuffer, Math.min(cssHeight - edgeBuffer, adjustedY));

                                    // Use text color for arrow (programmatic - matches current theme)
                                    const isFocused = engine.focusedBoundKey === key;
                                    const arrowColor = isFocused ? engine.textColor : `${engine.textColor}CC`;

                                    drawArrow(ctx, adjustedX, adjustedY, intersection.angle, arrowColor);

                                    // Draw bound identifier text next to arrow
                                    const boundWidth = endX - startX + 1;
                                    // Use title from boundData if available, otherwise default to bound[width]
                                    const boundLabel = boundData.title || `bound[${boundWidth}]`;

                                    ctx.fillStyle = arrowColor;
                                    ctx.font = `${effectiveFontSize}px ${fontFamily}`;
                                    const textOffset = ARROW_SIZE * 1.5;

                                    let textX = adjustedX - Math.cos(intersection.angle) * textOffset;
                                    let textY = adjustedY - Math.sin(intersection.angle) * textOffset;

                                    // Adjust alignment to keep text inside the screen bounds
                                    if (Math.abs(intersection.angle) < Math.PI / 2) {
                                        ctx.textAlign = 'right';
                                    } else {
                                        ctx.textAlign = 'left';
                                    }

                                    if (intersection.angle > Math.PI / 4 && intersection.angle < 3 * Math.PI / 4) {
                                        ctx.textBaseline = 'bottom';
                                    } else if (intersection.angle < -Math.PI / 4 && intersection.angle > -3 * Math.PI / 4) {
                                        ctx.textBaseline = 'top';
                                    } else {
                                        ctx.textBaseline = 'middle';
                                    }

                                    // Add distance indicator only if proximity threshold is not disabled
                                    const distanceText = engine.settings.labelProximityThreshold >= 999999 ? '' : ` [${distance}]`;
                                    ctx.fillText(boundLabel + distanceText, textX, textY);

                                    // Reset to defaults
                                    ctx.textAlign = 'left';
                                    ctx.textBaseline = 'top';
                                }
                            }
                        }
                    } catch (e) {
                        // Skip invalid bound data
                    }
                }
            }
        }

        // === Render Blocks ===
        const visibleBlocks = engine.queryVisibleEntities(startWorldX - 5, startWorldY - 5, endWorldX + 5, endWorldY + 5);
        for (const key of visibleBlocks) {
            if (key.startsWith('block_')) {
                const coords = key.substring('block_'.length);
                const [xStr, yStr] = coords.split(',');
                const worldX = parseInt(xStr, 10);
                const worldY = parseInt(yStr, 10);
                
                if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                    const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                    if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                        // Calculate distance from cursor to this block
                        const deltaX = worldX - engine.cursorPos.x;
                        const deltaY = worldY - engine.cursorPos.y;
                        const distanceFromCursor = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                        
                        // Simple gray color for blocks
                        ctx.fillStyle = '#ADADAD';
                        
                        // Fill entire cell
                        ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                    }
                }
            }
        }
        

        // === Render Waypoint Arrows for Off-Screen Blocks ===
        for (const key in engine.worldData) {
            if (key.startsWith('block_')) {
                const coords = key.substring('block_'.length);
                const [xStr, yStr] = coords.split(',');
                const worldX = parseInt(xStr, 10);
                const worldY = parseInt(yStr, 10);
                
                // Check if block is outside viewport
                if (!isBlockInViewport(worldX, worldY, viewBounds)) {
                    // Convert world position to screen coordinates for direction calculation
                    const blockScreenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                    
                    // Find intersection point on viewport edge
                    const intersection = getViewportEdgeIntersection(
                        viewportCenterScreen.x, 
                        viewportCenterScreen.y,
                        blockScreenPos.x, 
                        blockScreenPos.y,
                        cssWidth, 
                        cssHeight
                    );
                    
                    if (intersection) {
                        // Simple gray color for off-screen blocks
                        const blockColor = '#ADADAD';
                        
                        // Adjust intersection point to be within margin from edge
                        const edgeBuffer = ARROW_MARGIN;
                        let adjustedX = intersection.x;
                        let adjustedY = intersection.y;
                        
                        // Clamp to viewport bounds with margin
                        adjustedX = Math.max(edgeBuffer, Math.min(cssWidth - edgeBuffer, adjustedX));
                        adjustedY = Math.max(edgeBuffer, Math.min(cssHeight - edgeBuffer, adjustedY));
                        
                        // Draw the waypoint arrow
                        drawArrow(ctx, adjustedX, adjustedY, intersection.angle, blockColor);
                        
                        // Add distance indicator for blocks
                        const viewportCenter = engine.getViewportCenter();
                        const deltaCenterX = worldX - viewportCenter.x;
                        const deltaCenterY = worldY - viewportCenter.y;
                        const distanceFromCenter = Math.round(Math.sqrt(deltaCenterX * deltaCenterX + deltaCenterY * deltaCenterY));
                        
                        ctx.fillStyle = blockColor;
                        ctx.font = `${effectiveFontSize}px ${fontFamily}`;
                        const textOffset = ARROW_SIZE * 1.5;
                        
                        let textX = adjustedX - Math.cos(intersection.angle) * textOffset;
                        let textY = adjustedY - Math.sin(intersection.angle) * textOffset;
                        
                        // Adjust alignment to keep text inside the screen bounds
                        if (Math.abs(intersection.angle) < Math.PI / 2) {
                            ctx.textAlign = 'right';
                        } else {
                            ctx.textAlign = 'left';
                        }
                        
                        if (intersection.angle > Math.PI / 4 && intersection.angle < 3 * Math.PI / 4) {
                            ctx.textBaseline = 'bottom';
                        } else if (intersection.angle < -Math.PI / 4 && intersection.angle > -3 * Math.PI / 4) {
                            ctx.textBaseline = 'top';
                        } else {
                            ctx.textBaseline = 'middle';
                        }
                        
                        // Draw distance only if proximity threshold is not disabled (no text for blocks)
                        if (engine.settings.labelProximityThreshold < 999999) {
                            ctx.fillText(`[${distanceFromCenter}]`, textX, textY);
                        }
                        
                        // Reset to defaults
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'top';
                    }
                }
            }
        }

        // === Render Text Frames (Simple Bounding Boxes or Hierarchical) ===
        if (engine.framesVisible) {
            if (engine.hierarchicalFrames && engine.useHierarchicalFrames) {
                // Render hierarchical frames with level-specific styling
                renderHierarchicalFrames(
                    ctx,
                    engine.hierarchicalFrames.activeFrames,
                    engine.worldToScreen,
                    viewBounds,
                    currentZoom,
                    currentOffset
                );
            } else if (engine.textFrames.length > 0) {
                // Render simple frames
                renderFrames(
                    ctx, 
                    engine.textFrames, 
                    engine.worldToScreen, 
                    viewBounds, 
                    currentZoom, 
                    currentOffset
                );
            }
        }

        // === Render Cluster Frames (AI Clusters) ===
        if (engine.clustersVisible && engine.clusterLabels.length > 0) {
            renderFrames(
                ctx, 
                engine.clusterLabels, 
                engine.worldToScreen, 
                viewBounds, 
                currentZoom, 
                currentOffset,
                { strokeStyle: '#FF69B4', lineWidth: 2, dashPattern: [3, 3] } // Pink style for L2 clusters
            );
        }

        // === Render Cluster Waypoint Arrows ===
        if (engine.clustersVisible && engine.clusterLabels.length > 0) {
            for (const clusterLabel of engine.clusterLabels) {
            const { position, text } = clusterLabel;
            
            // Check if cluster is outside current viewport
            const isClusterVisible = position.x >= viewBounds.minX && 
                                   position.x <= viewBounds.maxX &&
                                   position.y >= viewBounds.minY && 
                                   position.y <= viewBounds.maxY;
            
            if (!isClusterVisible) {
                // Convert cluster position to screen coordinates for direction calculation
                const clusterScreenPos = engine.worldToScreen(position.x, position.y, currentZoom, currentOffset);
                
                // Find intersection point on viewport edge
                const intersection = getViewportEdgeIntersection(
                    viewportCenterScreen.x,
                    viewportCenterScreen.y,
                    clusterScreenPos.x,
                    clusterScreenPos.y,
                    cssWidth,
                    cssHeight
                );
                
                if (intersection) {
                    // Adjust intersection point to be within margin from edge
                    const edgeBuffer = ARROW_MARGIN;
                    let adjustedX = intersection.x;
                    let adjustedY = intersection.y;
                    
                    // Clamp to viewport bounds with margin
                    adjustedX = Math.max(edgeBuffer, Math.min(cssWidth - edgeBuffer, adjustedX));
                    adjustedY = Math.max(edgeBuffer, Math.min(cssHeight - edgeBuffer, adjustedY));
                    
                    // Draw the green waypoint arrow for cluster
                    drawArrow(ctx, adjustedX, adjustedY, intersection.angle, '#00FF00');
                    
                    // Draw the cluster label text next to the arrow
                    const viewportCenter = engine.getViewportCenter();
                    const deltaCenterX = position.x - viewportCenter.x;
                    const deltaCenterY = position.y - viewportCenter.y;
                    const distanceFromCenter = Math.round(Math.sqrt(deltaCenterX * deltaCenterX + deltaCenterY * deltaCenterY));
                    
                    ctx.fillStyle = '#00FF00'; // Green color for cluster labels
                    ctx.font = `${effectiveFontSize}px ${fontFamily}`;
                    const textOffset = ARROW_SIZE * 1.5;
                    
                    let textX = adjustedX - Math.cos(intersection.angle) * textOffset;
                    let textY = adjustedY - Math.sin(intersection.angle) * textOffset;
                    
                    // Adjust alignment to keep text inside the screen bounds
                    if (Math.abs(intersection.angle) < Math.PI / 2) {
                        ctx.textAlign = 'right';
                    } else {
                        ctx.textAlign = 'left';
                    }
                    
                    if (intersection.angle > Math.PI / 4 && intersection.angle < 3 * Math.PI / 4) {
                        ctx.textBaseline = 'bottom';
                    } else if (intersection.angle < -Math.PI / 4 && intersection.angle > -3 * Math.PI / 4) {
                        ctx.textBaseline = 'top';
                    } else {
                        ctx.textBaseline = 'middle';
                    }
                    
                    // Draw cluster label with distance (if enabled)
                    if (engine.settings.labelProximityThreshold < 999999) {
                        ctx.fillText(`${text} [${distanceFromCenter}]`, textX, textY);
                    } else {
                        ctx.fillText(text, textX, textY);
                    }
                    
                    // Reset to defaults
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'top';
                }
            }
        }
        }

        // === Render Text and Mail Notes ===
        // Render all text notes and mail notes
        const visibleNotes = engine.queryVisibleEntities(startWorldX - 5, startWorldY - 5, endWorldX + 5, endWorldY + 5);
        for (const key of visibleNotes) {
            if (key.startsWith('note_') || key.startsWith('mail_')) {
                const note = parseNoteFromWorldData(key, engine.worldData[key]);
                if (note) {
                    renderNote(note, noteRenderCtx);
                }
            }
        }


        // === Render Pattern Townscapes ===
        const visiblePatterns = engine.queryVisibleEntities(startWorldX - 100, startWorldY - 100, endWorldX + 100, endWorldY + 100);
        for (const key of visiblePatterns) {
            if (key.startsWith('pattern_')) {
                try {
                    const patternData = JSON.parse(engine.worldData[key] as string);
                    const { centerX, centerY, timestamp, width = 120, height = 60, noteKeys = [], rooms = [], style: styleName } = patternData;

                    // Look up note objects from noteKeys (new format) or use inline rooms (legacy format)
                    const roomsFromNotes: Array<{ x: number; y: number; width: number; height: number }> = noteKeys.length > 0
                        ? noteKeys.map((noteKey: string) => {
                            try {
                                const noteData = JSON.parse(engine.worldData[noteKey] as string);
                                return {
                                    x: noteData.startX,
                                    y: noteData.startY,
                                    width: noteData.endX - noteData.startX + 1,
                                    height: noteData.endY - noteData.startY + 1
                                };
                            } catch (e) {
                                return null;
                            }
                        }).filter((room: any) => room !== null)
                        : rooms;  // Fallback to inline rooms for backward compatibility

                    // Random function for corridor generation (still uses timestamp seed for consistency)
                    const seed = timestamp;
                    const random = (n: number) => {
                        const x = Math.sin(seed + n) * 10000;
                        return x - Math.floor(x);
                    };

                    // Create a grid to mark filled cells
                    const gridCells = new Set<string>();
                    const corridorCells = new Set<string>(); // Track corridors separately

                    // Add all room cells to grid
                    for (const room of roomsFromNotes) {
                        for (let x = room.x; x < room.x + room.width; x++) {
                            for (let y = room.y; y < room.y + room.height; y++) {
                                gridCells.add(`${x},${y}`);
                            }
                        }
                    }

                    // Minimum Spanning Tree for guaranteed connectivity, then add extra corridors
                    const drawCorridor = (room1: typeof roomsFromNotes[0], room2: typeof roomsFromNotes[0], rngSeed: number) => {
                        const startX = room1.x + Math.floor(room1.width / 2);
                        const startY = room1.y + Math.floor(room1.height / 2);
                        const endX = room2.x + Math.floor(room2.width / 2);
                        const endY = room2.y + Math.floor(room2.height / 2);

                        // 3 cells wide for both directions (1:1 aspect ratio for 1x1 cell regime)
                        const corridorWidth = 3;
                        const corridorHeight = 3;

                        // L-shaped corridor - randomly choose horizontal-first or vertical-first
                        if (random(rngSeed) > 0.5) {
                            // Horizontal segment first
                            const minX = Math.min(startX, endX);
                            const maxX = Math.max(startX, endX);
                            for (let x = minX; x <= maxX; x++) {
                                for (let w = 0; w < corridorWidth; w++) {
                                    const cellKey = `${x},${startY + w - Math.floor(corridorWidth / 2)}`;
                                    gridCells.add(cellKey);
                                    corridorCells.add(cellKey); // Mark as corridor
                                }
                            }
                            // Vertical segment
                            const minY = Math.min(startY, endY);
                            const maxY = Math.max(startY, endY);
                            for (let y = minY; y <= maxY; y++) {
                                for (let h = 0; h < corridorHeight; h++) {
                                    const cellKey = `${endX + h - Math.floor(corridorHeight / 2)},${y}`;
                                    gridCells.add(cellKey);
                                    corridorCells.add(cellKey); // Mark as corridor
                                }
                            }
                        } else {
                            // Vertical segment first
                            const minY = Math.min(startY, endY);
                            const maxY = Math.max(startY, endY);
                            for (let y = minY; y <= maxY; y++) {
                                for (let h = 0; h < corridorHeight; h++) {
                                    const cellKey = `${startX + h - Math.floor(corridorHeight / 2)},${y}`;
                                    gridCells.add(cellKey);
                                    corridorCells.add(cellKey); // Mark as corridor
                                }
                            }
                            // Horizontal segment
                            const minX = Math.min(startX, endX);
                            const maxX = Math.max(startX, endX);
                            for (let x = minX; x <= maxX; x++) {
                                for (let w = 0; w < corridorWidth; w++) {
                                    const cellKey = `${x},${endY + w - Math.floor(corridorWidth / 2)}`;
                                    gridCells.add(cellKey);
                                    corridorCells.add(cellKey); // Mark as corridor
                                }
                            }
                        }
                    };

                    // Simple MST using Prim's algorithm
                    if (roomsFromNotes.length > 0) {
                        const connected = new Set<number>([0]); // Start with first room
                        const edges: Array<{ from: number; to: number; dist: number }> = [];

                        // Build MST
                        while (connected.size < roomsFromNotes.length) {
                            let bestEdge: { from: number; to: number; dist: number } | null = null;

                            // Find shortest edge from connected to unconnected room
                            for (const i of connected) {
                                for (let j = 0; j < roomsFromNotes.length; j++) {
                                    if (!connected.has(j)) {
                                        const dx = Math.abs(roomsFromNotes[j].x - roomsFromNotes[i].x);
                                        const dy = Math.abs(roomsFromNotes[j].y - roomsFromNotes[i].y);
                                        const dist = dx + dy;

                                        if (!bestEdge || dist < bestEdge.dist) {
                                            bestEdge = { from: i, to: j, dist };
                                        }
                                    }
                                }
                            }

                            if (bestEdge) {
                                edges.push(bestEdge);
                                connected.add(bestEdge.to);
                                drawCorridor(roomsFromNotes[bestEdge.from], roomsFromNotes[bestEdge.to], bestEdge.from * 7 + bestEdge.to);
                            } else {
                                break; // No more rooms to connect
                            }
                        }

                        // Add 1-2 extra corridors for loops/cycles (makes exploration more interesting)
                        const extraCorridors = Math.floor(random(200) * 2) + 1;
                        for (let e = 0; e < extraCorridors && roomsFromNotes.length > 2; e++) {
                            const i = Math.floor(random(300 + e) * roomsFromNotes.length);
                            const j = Math.floor(random(400 + e) * roomsFromNotes.length);
                            if (i !== j) {
                                drawCorridor(roomsFromNotes[i], roomsFromNotes[j], i * 13 + j);
                            }
                        }
                    }

                    // Get style if pattern has one
                    const patternStyle = styleName ? getRectStyle(styleName) : null;

                    // Render glow border if style has glow
                    if (patternStyle?.border.type === 'glow' && patternStyle.border.color) {
                        const { color, glowRadius = 2, glowIntensity = 0.6, pulse = true, flicker = true, cardinalExtension = 1 } = patternStyle.border;

                        // Calculate dynamic intensity with pulsing/flicker
                        let intensity = glowIntensity;
                        if (pulse) {
                            const pulseSpeed = 0.001;
                            const pulsePhase = (Date.now() * pulseSpeed) % (Math.PI * 2);
                            const basePulse = 0.6 + Math.sin(pulsePhase) * 0.2;
                            intensity *= basePulse;
                        }
                        if (flicker) {
                            const flickerSpeed = 0.05;
                            const time = Date.now() * flickerSpeed;
                            const flicker1 = Math.sin(time * 2.3) * 0.5 + 0.5;
                            const flicker2 = Math.sin(time * 4.7) * 0.5 + 0.5;
                            const randomNoise = Math.random();
                            const flickerPerturbation = (flicker1 * 0.08 + flicker2 * 0.05 + randomNoise * 0.07);
                            intensity += flickerPerturbation;
                        }
                        intensity = Math.max(0, Math.min(1, intensity));

                        // Parse color (local hexToRgb returns "r, g, b" string)
                        const rgbString = hexToRgb(color);
                        const glowAlphas = [0.6 * intensity, 0.3 * intensity];
                        const maxRadius = glowRadius + cardinalExtension;

                        // Render glow cells around pattern border
                        for (const cellKey of gridCells) {
                            const [x, y] = cellKey.split(',').map(Number);

                            // Check neighbors to find border cells
                            const isBorder = !gridCells.has(`${x},${y-1}`) ||
                                           !gridCells.has(`${x+1},${y}`) ||
                                           !gridCells.has(`${x},${y+1}`) ||
                                           !gridCells.has(`${x-1},${y}`);

                            if (isBorder) {
                                // Render glow around this border cell
                                for (let dy = -maxRadius; dy <= maxRadius; dy++) {
                                    for (let dx = -maxRadius; dx <= maxRadius; dx++) {
                                        const glowX = x + dx;
                                        const glowY = y + dy;

                                        // Skip if inside pattern
                                        if (gridCells.has(`${glowX},${glowY}`)) continue;

                                        const distance = Math.max(Math.abs(dx), Math.abs(dy));
                                        if (distance === 0 || distance > maxRadius) continue;

                                        const isCardinal = (dx === 0 || dy === 0);
                                        const effectiveRadius = isCardinal ? maxRadius : glowRadius;
                                        if (distance > effectiveRadius) continue;

                                        let alpha;
                                        if (distance <= glowRadius) {
                                            alpha = glowAlphas[distance - 1];
                                        } else {
                                            alpha = glowAlphas[glowRadius - 1] * 0.3;
                                        }
                                        if (!alpha) continue;

                                        const topLeft = engine.worldToScreen(glowX, glowY, currentZoom, currentOffset);
                                        const bottomRight = engine.worldToScreen(glowX + 1, glowY + 1, currentZoom, currentOffset);
                                        const w = bottomRight.x - topLeft.x;
                                        const h = bottomRight.y - topLeft.y;

                                        ctx.fillStyle = `rgba(${rgbString}, ${alpha})`;
                                        ctx.fillRect(topLeft.x, topLeft.y, w, h);
                                    }
                                }
                            }
                        }
                    }

                    // Draw the unified shape with a single outer border
                    // Default pattern styling (independent of styles.ts)
                    const defaultRoomFillColor = `rgba(${hexToRgb(engine.textColor)}, 0.25)`;
                    const defaultCorridorFillColor = `rgba(${hexToRgb(engine.textColor)}, 0.12)`;

                    // Use style overrides if present
                    const fillColor = patternStyle?.fill.type === 'solid' && patternStyle.fill.color
                        ? patternStyle.fill.color
                        : null;
                    const fillAlpha = patternStyle?.fill.alpha ?? (patternStyle?.fill.type === 'solid' ? 1.0 : null);

                    if (patternStyle?.fill.type !== 'none') {
                        // Render rooms with distinct styling
                        ctx.globalAlpha = fillAlpha ?? 0.25;
                        ctx.fillStyle = fillColor ?? defaultRoomFillColor;
                        for (const cellKey of gridCells) {
                            if (!corridorCells.has(cellKey)) { // Only render room cells
                                const [x, y] = cellKey.split(',').map(Number);
                                const topLeft = engine.worldToScreen(x, y, currentZoom, currentOffset);
                                const bottomRight = engine.worldToScreen(x + 1, y + 1, currentZoom, currentOffset);
                                const w = bottomRight.x - topLeft.x;
                                const h = bottomRight.y - topLeft.y;
                                ctx.fillRect(topLeft.x, topLeft.y, w, h);
                            }
                        }

                        // Render corridors with lighter styling
                        ctx.globalAlpha = fillAlpha ? fillAlpha * 0.5 : 0.12;
                        ctx.fillStyle = fillColor ?? defaultCorridorFillColor;
                        for (const cellKey of corridorCells) {
                            const [x, y] = cellKey.split(',').map(Number);
                            const topLeft = engine.worldToScreen(x, y, currentZoom, currentOffset);
                            const bottomRight = engine.worldToScreen(x + 1, y + 1, currentZoom, currentOffset);
                            const w = bottomRight.x - topLeft.x;
                            const h = bottomRight.y - topLeft.y;
                            ctx.fillRect(topLeft.x, topLeft.y, w, h);
                        }

                        ctx.globalAlpha = 1.0;
                    }

                    // Draw outer border only if not glow (glow already rendered above)
                    // Default border is more opaque for better visibility
                    if (!patternStyle || patternStyle.border.type !== 'glow') {
                        const defaultBorderColor = `rgba(${hexToRgb(engine.textColor)}, 0.8)`;
                        const borderColor = patternStyle?.border.type === 'solid' && patternStyle.border.color
                            ? patternStyle.border.color
                            : defaultBorderColor;
                        const borderWidth = patternStyle?.border.type === 'solid' && patternStyle.border.thickness
                            ? patternStyle.border.thickness * 2
                            : 2;

                        ctx.strokeStyle = borderColor;
                        ctx.lineWidth = borderWidth;

                        for (const cellKey of gridCells) {
                        const [x, y] = cellKey.split(',').map(Number);
                        const topLeft = engine.worldToScreen(x, y, currentZoom, currentOffset);
                        const bottomRight = engine.worldToScreen(x + 1, y + 1, currentZoom, currentOffset);

                        // Check each edge and draw if it's a border
                        ctx.beginPath();

                        // Top edge
                        if (!gridCells.has(`${x},${y - 1}`)) {
                            ctx.moveTo(topLeft.x, topLeft.y);
                            ctx.lineTo(bottomRight.x, topLeft.y);
                        }
                        // Right edge
                        if (!gridCells.has(`${x + 1},${y}`)) {
                            ctx.moveTo(bottomRight.x, topLeft.y);
                            ctx.lineTo(bottomRight.x, bottomRight.y);
                        }
                        // Bottom edge
                        if (!gridCells.has(`${x},${y + 1}`)) {
                            ctx.moveTo(topLeft.x, bottomRight.y);
                            ctx.lineTo(bottomRight.x, bottomRight.y);
                        }
                        // Left edge
                        if (!gridCells.has(`${x - 1},${y}`)) {
                            ctx.moveTo(topLeft.x, topLeft.y);
                            ctx.lineTo(topLeft.x, bottomRight.y);
                        }

                        ctx.stroke();
                        }
                    }
                } catch (e) {
                    // Skip invalid pattern data
                }
            }
        }

        // === Render Selected Pattern Rooms ===
        if (selectedPatternKey) {
            try {
                const patternData = JSON.parse(engine.worldData[selectedPatternKey] as string);
                const { rooms = [] } = patternData;

                // Draw corner thumbs for each individual room
                for (const room of rooms) {
                    const roomTopLeft = engine.worldToScreen(room.x, room.y, currentZoom, currentOffset);
                    const roomBottomRight = engine.worldToScreen(room.x + room.width, room.y + room.height, currentZoom, currentOffset);

                    const roomLeft = roomTopLeft.x;
                    const roomRight = roomBottomRight.x;
                    const roomTop = roomTopLeft.y;
                    const roomBottom = roomBottomRight.y;

                    // Room corner thumbs
                    const roomThumbSize = 8;
                    ctx.fillStyle = `rgba(${hexToRgb(engine.textColor)}, 0.8)`;
                    ctx.fillRect(roomLeft - roomThumbSize / 2, roomTop - roomThumbSize / 2, roomThumbSize, roomThumbSize);
                    ctx.fillRect(roomRight - roomThumbSize / 2, roomTop - roomThumbSize / 2, roomThumbSize, roomThumbSize);
                    ctx.fillRect(roomLeft - roomThumbSize / 2, roomBottom - roomThumbSize / 2, roomThumbSize, roomThumbSize);
                    ctx.fillRect(roomRight - roomThumbSize / 2, roomBottom - roomThumbSize / 2, roomThumbSize, roomThumbSize);
                }
            } catch (e) {
                // Skip invalid pattern data
            }
        }

        // === Render AI Processing Region ===
        if (engine.aiProcessingRegion) {
            const { startX, endX, startY, endY } = engine.aiProcessingRegion;

            // Pulse effect using time
            const pulseAlpha = 0.15 + 0.1 * Math.sin(Date.now() / 400);
            const generatingColor = `rgba(${hexToRgb(engine.textColor)}, ${pulseAlpha})`;
            ctx.fillStyle = generatingColor;

            // Fill each cell in the generating region
            for (let worldY = startY; worldY <= endY; worldY++) {
                for (let worldX = startX; worldX <= endX; worldX++) {
                    const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);

                    // Only draw if cell is visible on screen
                    if (screenPos.x >= -effectiveCharWidth && screenPos.x <= cssWidth &&
                        screenPos.y >= -effectiveCharHeight && screenPos.y <= cssHeight) {
                        ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                    }
                }
            }
        }

        // === Render Selection Area ===
        if (engine.selectionStart && engine.selectionEnd) {
            const start = engine.selectionStart;
            const end = engine.selectionEnd;

            // Calculate selection bounds
            const minX = Math.min(start.x, end.x);
            const maxX = Math.max(start.x, end.x);
            const minY = Math.min(start.y, end.y);
            const maxY = Math.max(start.y, end.y);

            // Use light transparent version of text accent color
            const selectionColor = `rgba(${hexToRgb(engine.textColor)}, 0.3)`;
            ctx.fillStyle = selectionColor;

            // Check if selection started on a character (including spaces - text-aware selection mode)
            const startKey = `${Math.floor(start.x)},${Math.floor(start.y)}`;
            const startData = engine.worldData[startKey];
            // Include spaces - any character data triggers text-aware mode
            const startedOnChar = startData && !engine.isImageData(startData) && engine.getCharacter(startData) !== '';

            // Only check for label/task overlap if we started on a character (optimization)
            let overlapsLabelOrTask = false;
            if (startedOnChar) {
                // Check if selection actually overlaps with any label or task bounds
                for (const key in engine.worldData) {
                    if (key.startsWith('label_')) {
                        try {
                            const labelData = JSON.parse(engine.worldData[key] as string);
                            const coordsStr = key.substring('label_'.length);
                            const [lxStr, lyStr] = coordsStr.split(',');
                            const lx = parseInt(lxStr, 10);
                            const ly = parseInt(lyStr, 10);
                            const labelWidth = labelData.text?.length || 0;
                            const labelEndX = lx + labelWidth - 1;
                            // Check for actual 2D overlap (both X and Y)
                            const xOverlap = !(maxX < lx || minX > labelEndX);
                            const yOverlap = !(maxY < ly || minY > ly);
                            if (xOverlap && yOverlap) {
                                overlapsLabelOrTask = true;
                                break;
                            }
                        } catch (e) {}
                    } else if (key.startsWith('label_')) {
                        const labelData = JSON.parse(engine.worldData[key] as string);
                        if (labelData.type !== 'task') continue;
                        try {
                            const taskData = JSON.parse(engine.worldData[key] as string);
                            // Check for actual 2D overlap (both X and Y)
                            const xOverlap = !(maxX < taskData.startX || minX > taskData.endX);
                            const yOverlap = !(maxY < taskData.startY || minY > taskData.endY);
                            if (xOverlap && yOverlap) {
                                overlapsLabelOrTask = true;
                                break;
                            }
                        } catch (e) {}
                    }
                }
            }

            // Use text-aware selection ONLY if:
            // 1. Selection doesn't overlap with any label/task
            // 2. Started on an actual character
            // This ensures clicking near labels/tasks falls through to box selection
            if (!overlapsLabelOrTask && startedOnChar) {
                // Text-editor-style selection: highlight only cells with characters, line by line
                // First, find the text block that contains the selection
                const textBlock = findTextBlockForSelection(
                    { startX: minX, endX: maxX, startY: minY, endY: maxY },
                    engine.worldData
                );

                // Use text block boundaries to constrain the selection horizontally
                const blockMinX = textBlock ? textBlock.minX : minX;
                const blockMaxX = textBlock ? textBlock.maxX : maxX;

                for (let worldY = minY; worldY <= maxY; worldY += GRID_CELL_SPAN) {
                    const isFirstLine = worldY === Math.floor(start.y);
                    const isLastLine = worldY === Math.floor(end.y);

                    // Only scan within the text block's horizontal boundaries
                    let contentStartX = Number.MAX_SAFE_INTEGER;
                    let contentEndX = Number.MIN_SAFE_INTEGER;

                    // Scan within the text block boundaries (or selection if no block found)
                    for (let worldX = blockMinX; worldX <= blockMaxX; worldX++) {
                        const key = `${worldX},${worldY}`;
                        const data = engine.worldData[key];
                        const hasChar = data && !engine.isImageData(data) && engine.getCharacter(data).trim() !== '';

                        if (hasChar) {
                            if (worldX < contentStartX) contentStartX = worldX;
                            if (worldX > contentEndX) contentEndX = worldX;
                        }
                    }

                    // Only draw if there's content on this line
                    if (contentStartX <= contentEndX) {
                        // Constrain to actual start/end positions (not min/max)
                        let drawStartX = contentStartX;
                        let drawEndX = contentEndX;

                        if (isFirstLine) {
                            // On the line where selection started, constrain to start.x
                            drawStartX = Math.max(contentStartX, Math.floor(start.x));
                        }
                        if (isLastLine) {
                            // On the line where selection ended, constrain to end.x
                            drawEndX = Math.min(contentEndX, Math.floor(end.x));
                        }

                        // Draw a continuous rectangle for this line segment
                        // Get top cell position (worldY - 1) to span full character height
                        const startScreenPos = engine.worldToScreen(drawStartX, worldY, currentZoom, currentOffset);
                        const topScreenPos = engine.worldToScreen(drawStartX, worldY - 1, currentZoom, currentOffset);
                        const endScreenPos = engine.worldToScreen(drawEndX + 1, worldY, currentZoom, currentOffset);

                        if (startScreenPos.x < cssWidth && endScreenPos.x >= 0 &&
                            topScreenPos.y >= -effectiveCharHeight && startScreenPos.y <= cssHeight) {
                            ctx.fillRect(
                                startScreenPos.x,
                                topScreenPos.y,
                                endScreenPos.x - startScreenPos.x,
                                effectiveCharHeight * GRID_CELL_SPAN
                            );
                        }
                    }
                }
            } else {
                // Square/block selection mode: fill all cells in the rectangular area
                for (let worldY = minY; worldY <= maxY; worldY += GRID_CELL_SPAN) {
                    for (let worldX = minX; worldX <= maxX; worldX++) {
                        // Get both bottom and top positions to span full character height
                        const bottomScreenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                        const topScreenPos = engine.worldToScreen(worldX, worldY - 1, currentZoom, currentOffset);

                        // Only draw if cell is visible on screen
                        if (bottomScreenPos.x >= -effectiveCharWidth && bottomScreenPos.x <= cssWidth &&
                            topScreenPos.y >= -effectiveCharHeight && bottomScreenPos.y <= cssHeight) {
                            ctx.fillRect(topScreenPos.x, topScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                        }
                    }
                }
            }
        }

        // === Render Selected Image Border ===
        if (selectedImageKey) {
            const selectedImageData = engine.worldData[selectedImageKey];
            if (engine.isImageData(selectedImageData)) {
                // Draw selection border around the selected image
                const topLeftScreen = engine.worldToScreen(selectedImageData.startX, selectedImageData.startY, currentZoom, currentOffset);
                const bottomRightScreen = engine.worldToScreen(selectedImageData.endX + 1, selectedImageData.endY + 1, currentZoom, currentOffset);
                
                // Use text accent color for selection border
                ctx.strokeStyle = `rgba(${hexToRgb(engine.textColor)}, 0.8)`;
                const lineWidth = 3; // Slightly thicker to indicate selection
                ctx.lineWidth = lineWidth;
                const halfWidth = lineWidth / 2;
                ctx.strokeRect(
                    topLeftScreen.x + halfWidth,
                    topLeftScreen.y + halfWidth,
                    bottomRightScreen.x - topLeftScreen.x - lineWidth,
                    bottomRightScreen.y - topLeftScreen.y - lineWidth
                );

                // Draw resize thumbs (handles) at corners only
                const thumbSize = 8;
                const thumbColor = `rgba(${hexToRgb(engine.textColor)}, 1)`;
                ctx.fillStyle = thumbColor;

                const left = topLeftScreen.x;
                const right = bottomRightScreen.x;
                const top = topLeftScreen.y;
                const bottom = bottomRightScreen.y;

                // Corner thumbs
                ctx.fillRect(left - thumbSize / 2, top - thumbSize / 2, thumbSize, thumbSize); // Top-left
                ctx.fillRect(right - thumbSize / 2, top - thumbSize / 2, thumbSize, thumbSize); // Top-right
                ctx.fillRect(left - thumbSize / 2, bottom - thumbSize / 2, thumbSize, thumbSize); // Bottom-left
                ctx.fillRect(right - thumbSize / 2, bottom - thumbSize / 2, thumbSize, thumbSize); // Bottom-right
            }
        }

        // === Render Selected Note Border ===
        if (selectedNoteKey) {
            try {
                const selectedPlanData = JSON.parse(engine.worldData[selectedNoteKey] as string);
                const topLeftScreen = engine.worldToScreen(selectedPlanData.startX, selectedPlanData.startY, currentZoom, currentOffset);
                const bottomRightScreen = engine.worldToScreen(selectedPlanData.endX + 1, selectedPlanData.endY + 1, currentZoom, currentOffset);

                // Draw resize thumbs (handles) at corners only (no border)
                const thumbSize = 8;
                const thumbColor = `rgba(${hexToRgb(engine.textColor)}, 1)`;
                ctx.fillStyle = thumbColor;

                const left = topLeftScreen.x;
                const right = bottomRightScreen.x;
                const top = topLeftScreen.y;
                const bottom = bottomRightScreen.y;

                // Corner thumbs
                ctx.fillRect(left - thumbSize / 2, top - thumbSize / 2, thumbSize, thumbSize); // Top-left
                ctx.fillRect(right - thumbSize / 2, top - thumbSize / 2, thumbSize, thumbSize); // Top-right
                ctx.fillRect(left - thumbSize / 2, bottom - thumbSize / 2, thumbSize, thumbSize); // Bottom-left
                ctx.fillRect(right - thumbSize / 2, bottom - thumbSize / 2, thumbSize, thumbSize); // Bottom-right
            } catch (e) {
                // Skip invalid note data
            }
        }

        // === Render Selected Iframe Border ===
        if (selectedIframeKey) {
            try {
                const selectedIframeData = JSON.parse(engine.worldData[selectedIframeKey] as string);
                // Draw selection border around the selected iframe
                const topLeftScreen = engine.worldToScreen(selectedIframeData.startX, selectedIframeData.startY, currentZoom, currentOffset);
                const bottomRightScreen = engine.worldToScreen(selectedIframeData.endX + 1, selectedIframeData.endY + 1, currentZoom, currentOffset);

                // Use text accent color for selection border
                ctx.strokeStyle = `rgba(${hexToRgb(engine.textColor)}, 0.8)`;
                const lineWidth = 3; // Slightly thicker to indicate selection
                ctx.lineWidth = lineWidth;
                const halfWidth = lineWidth / 2;
                ctx.strokeRect(
                    topLeftScreen.x + halfWidth,
                    topLeftScreen.y + halfWidth,
                    bottomRightScreen.x - topLeftScreen.x - lineWidth,
                    bottomRightScreen.y - topLeftScreen.y - lineWidth
                );

                // Draw resize thumbs (handles) at corners only
                const thumbSize = 8;
                const thumbColor = `rgba(${hexToRgb(engine.textColor)}, 1)`;
                ctx.fillStyle = thumbColor;

                const left = topLeftScreen.x;
                const right = bottomRightScreen.x;
                const top = topLeftScreen.y;
                const bottom = bottomRightScreen.y;

                // Corner thumbs
                ctx.fillRect(left - thumbSize / 2, top - thumbSize / 2, thumbSize, thumbSize); // Top-left
                ctx.fillRect(right - thumbSize / 2, top - thumbSize / 2, thumbSize, thumbSize); // Top-right
                ctx.fillRect(left - thumbSize / 2, bottom - thumbSize / 2, thumbSize, thumbSize); // Bottom-left
                ctx.fillRect(right - thumbSize / 2, bottom - thumbSize / 2, thumbSize, thumbSize); // Bottom-right
            } catch (e) {
                // Skip invalid iframe data
            }
        }

        // === Render Selected Mail Border ===
        if (selectedMailKey) {
            try {
                const selectedMailData = JSON.parse(engine.worldData[selectedMailKey] as string);
                // Draw selection border around the selected mail region
                const topLeftScreen = engine.worldToScreen(selectedMailData.startX, selectedMailData.startY, currentZoom, currentOffset);
                const bottomRightScreen = engine.worldToScreen(selectedMailData.endX + 1, selectedMailData.endY + 1, currentZoom, currentOffset);

                // Use amber color for mail selection border
                ctx.strokeStyle = 'rgba(255, 193, 7, 0.8)';
                const lineWidth = 3; // Slightly thicker to indicate selection
                ctx.lineWidth = lineWidth;
                const halfWidth = lineWidth / 2;
                ctx.strokeRect(
                    topLeftScreen.x + halfWidth,
                    topLeftScreen.y + halfWidth,
                    bottomRightScreen.x - topLeftScreen.x - lineWidth,
                    bottomRightScreen.y - topLeftScreen.y - lineWidth
                );

                // Draw resize thumbs (handles) at corners only
                const thumbSize = 8;
                const thumbColor = 'rgba(255, 193, 7, 1)';
                ctx.fillStyle = thumbColor;

                const left = topLeftScreen.x;
                const right = bottomRightScreen.x;
                const top = topLeftScreen.y;
                const bottom = bottomRightScreen.y;

                // Corner thumbs
                ctx.fillRect(left - thumbSize / 2, top - thumbSize / 2, thumbSize, thumbSize); // Top-left
                ctx.fillRect(right - thumbSize / 2, top - thumbSize / 2, thumbSize, thumbSize); // Top-right
                ctx.fillRect(left - thumbSize / 2, bottom - thumbSize / 2, thumbSize, thumbSize); // Bottom-left
                ctx.fillRect(right - thumbSize / 2, bottom - thumbSize / 2, thumbSize, thumbSize); // Bottom-right
            } catch (e) {
                // Skip invalid mail data
            }
        }

        // === Render Clipboard Flash ===
        if (clipboardFlashBounds.size > 0) {
            const recentItem = engine.clipboardItems[0];
            if (recentItem) {
                const flashKey = `flash_${recentItem.startX},${recentItem.startY}`;
                if (clipboardFlashBounds.has(flashKey)) {
                    const { startX, endX, startY, endY } = recentItem;

                    // Draw cyan flash box
                    const topLeft = engine.worldToScreen(startX, startY, currentZoom, currentOffset);
                    const bottomRight = engine.worldToScreen(endX + 1, endY + 1, currentZoom, currentOffset);

                    // Fill only
                    ctx.fillStyle = 'rgba(0, 128, 128, 0.4)';
                    ctx.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
                }
            }
        }

        // === Render Mouse Hover Preview ===
        if (mouseWorldPos && showCursor && !shiftDragStartPos) {
            drawHoverPreview(ctx, mouseWorldPos, currentZoom, currentOffset, effectiveCharWidth, effectiveCharHeight, cssWidth, cssHeight, isShiftPressed);
            drawModeSpecificPreview(ctx, mouseWorldPos, currentZoom, currentOffset, effectiveCharWidth, effectiveCharHeight, effectiveFontSize);
            // drawPositionInfo(ctx, mouseWorldPos, currentZoom, currentOffset, effectiveCharWidth, effectiveCharHeight, effectiveFontSize, cssWidth, cssHeight);
        }


        // === Render Blue Preview Region During Shift+Drag ===
        if (shiftDragStartPos && mouseWorldPos && isShiftPressed) {
            const distanceX = mouseWorldPos.x - shiftDragStartPos.x;
            const distanceY = mouseWorldPos.y - shiftDragStartPos.y;
            
            if (distanceX !== 0 || distanceY !== 0) {
                // First check if we're moving an image
                const imageAtPosition = findImageAtPosition(shiftDragStartPos);
                
                if (imageAtPosition) {
                    // Draw preview for image destination
                    ctx.fillStyle = `rgba(${hexToRgb(engine.textColor)}, 0.3)`; // Preview matching text accent color
                    
                    // Create all positions within the image bounds at the new location
                    for (let y = imageAtPosition.startY; y <= imageAtPosition.endY; y++) {
                        for (let x = imageAtPosition.startX; x <= imageAtPosition.endX; x++) {
                            const destX = x + distanceX;
                            const destY = y + distanceY;
                            const destScreenPos = engine.worldToScreen(destX, destY, currentZoom, currentOffset);
                            
                            // Only draw if visible on screen
                            if (destScreenPos.x >= -effectiveCharWidth && destScreenPos.x <= cssWidth && 
                                destScreenPos.y >= -effectiveCharHeight && destScreenPos.y <= cssHeight) {
                                ctx.fillRect(destScreenPos.x, destScreenPos.y, effectiveCharWidth, effectiveCharHeight);
                            }
                        }
                    }
                } else if (selectedNoteKey) {
                    // Draw preview for note region destination
                    try {
                        const noteData = JSON.parse(engine.worldData[selectedNoteKey] as string);
                        ctx.fillStyle = `rgba(${hexToRgb(engine.textColor)}, 0.3)`;

                        for (let y = noteData.startY; y <= noteData.endY; y++) {
                            for (let x = noteData.startX; x <= noteData.endX; x++) {
                                const destX = x + distanceX;
                                const destY = y + distanceY;
                                const destScreenPos = engine.worldToScreen(destX, destY, currentZoom, currentOffset);

                                if (destScreenPos.x >= -effectiveCharWidth && destScreenPos.x <= cssWidth &&
                                    destScreenPos.y >= -effectiveCharHeight && destScreenPos.y <= cssHeight) {
                                    ctx.fillRect(destScreenPos.x, destScreenPos.y, effectiveCharWidth, effectiveCharHeight);
                                }
                            }
                        }
                    } catch (e) {
                        // Invalid note data, skip preview
                    }
                } else if (selectedIframeKey) {
                    // Draw preview for iframe region destination
                    try {
                        const iframeData = JSON.parse(engine.worldData[selectedIframeKey] as string);
                        ctx.fillStyle = `rgba(${hexToRgb(engine.textColor)}, 0.3)`;

                        for (let y = iframeData.startY; y <= iframeData.endY; y++) {
                            for (let x = iframeData.startX; x <= iframeData.endX; x++) {
                                const destX = x + distanceX;
                                const destY = y + distanceY;
                                const destScreenPos = engine.worldToScreen(destX, destY, currentZoom, currentOffset);

                                if (destScreenPos.x >= -effectiveCharWidth && destScreenPos.x <= cssWidth &&
                                    destScreenPos.y >= -effectiveCharHeight && destScreenPos.y <= cssHeight) {
                                    ctx.fillRect(destScreenPos.x, destScreenPos.y, effectiveCharWidth, effectiveCharHeight);
                                }
                            }
                        }
                    } catch (e) {
                        // Invalid iframe data, skip preview
                    }
                } else if (selectedMailKey) {
                    // Draw preview for mail region destination
                    try {
                        const mailData = JSON.parse(engine.worldData[selectedMailKey] as string);
                        ctx.fillStyle = 'rgba(255, 193, 7, 0.3)'; // Amber color for mail

                        for (let y = mailData.startY; y <= mailData.endY; y++) {
                            for (let x = mailData.startX; x <= mailData.endX; x++) {
                                const destX = x + distanceX;
                                const destY = y + distanceY;
                                const destScreenPos = engine.worldToScreen(destX, destY, currentZoom, currentOffset);

                                if (destScreenPos.x >= -effectiveCharWidth && destScreenPos.x <= cssWidth &&
                                    destScreenPos.y >= -effectiveCharHeight && destScreenPos.y <= cssHeight) {
                                    ctx.fillRect(destScreenPos.x, destScreenPos.y, effectiveCharWidth, effectiveCharHeight);
                                }
                            }
                        }
                    } catch (e) {
                        // Invalid mail data, skip preview
                    }
                } else {
                    // Check if we have an active selection
                    if (engine.selectionStart && engine.selectionEnd) {
                        // Draw preview for selection bounds
                        const minX = Math.floor(Math.min(engine.selectionStart.x, engine.selectionEnd.x));
                        const maxX = Math.floor(Math.max(engine.selectionStart.x, engine.selectionEnd.x));
                        const minY = Math.floor(Math.min(engine.selectionStart.y, engine.selectionEnd.y));
                        const maxY = Math.floor(Math.max(engine.selectionStart.y, engine.selectionEnd.y));

                        ctx.fillStyle = `rgba(${hexToRgb(engine.textColor)}, 0.3)`;

                        for (let y = minY; y <= maxY; y++) {
                            for (let x = minX; x <= maxX; x++) {
                                const destX = x + distanceX;
                                const destY = y + distanceY;
                                const destScreenPos = engine.worldToScreen(destX, destY, currentZoom, currentOffset);

                                if (destScreenPos.x >= -effectiveCharWidth && destScreenPos.x <= cssWidth &&
                                    destScreenPos.y >= -effectiveCharHeight && destScreenPos.y <= cssHeight) {
                                    ctx.fillRect(destScreenPos.x, destScreenPos.y, effectiveCharWidth, effectiveCharHeight);
                                }
                            }
                        }
                    } else {
                        // No selection - use text block detection (original behavior)
                        const textBlock = findTextBlock(shiftDragStartPos, engine.worldData, engine);

                        if (textBlock.length > 0) {
                            ctx.fillStyle = `rgba(${hexToRgb(engine.textColor)}, 0.3)`;

                            for (const pos of textBlock) {
                                const destX = pos.x + distanceX;
                                const destY = pos.y + distanceY;
                                const destScreenPos = engine.worldToScreen(destX, destY, currentZoom, currentOffset);

                                if (destScreenPos.x >= -effectiveCharWidth && destScreenPos.x <= cssWidth &&
                                    destScreenPos.y >= -effectiveCharHeight && destScreenPos.y <= cssHeight) {
                                    ctx.fillRect(destScreenPos.x, destScreenPos.y, effectiveCharWidth, effectiveCharHeight);
                                }
                            }
                        }
                    }
                }
            }
        }

        if (showCursor) {
            // Draw cursor trail (older positions first, for proper layering)
            const now = Date.now();
            for (let i = cursorTrail.length - 1; i >= 0; i--) {
                const trailPos = cursorTrail[i];
                const age = now - trailPos.timestamp;
                
                // Skip positions that are too old
                if (age > CURSOR_TRAIL_FADE_MS) continue;
                
                // Skip the current position only if it perfectly matches the cursor
                // (avoid duplicate rendering at exact same spot)
                if (age < 20 && 
                    trailPos.x === engine.cursorPos.x && 
                    trailPos.y === engine.cursorPos.y) continue;
                
                // Skip positions that have chat data (chat data has its own styling)
                const trailKey = `${trailPos.x},${trailPos.y}`;
                if (engine.chatData[trailKey]) continue;
                
                // Calculate opacity based on age (1.0 to 0.0)
                const opacity = 1 - (age / CURSOR_TRAIL_FADE_MS);
                
                const trailBottomScreenPos = engine.worldToScreen(
                    trailPos.x, trailPos.y,
                    currentZoom, currentOffset
                );
                const trailTopScreenPos = engine.worldToScreen(
                    trailPos.x, trailPos.y - 1,
                    currentZoom, currentOffset
                );

                // Only draw if visible on screen
                if (trailBottomScreenPos.x >= -effectiveCharWidth &&
                    trailBottomScreenPos.x <= cssWidth &&
                    trailTopScreenPos.y >= -effectiveCharHeight &&
                    trailBottomScreenPos.y <= cssHeight) {

                    // Draw faded cursor rectangle spanning GRID_CELL_SPAN cells
                    ctx.fillStyle = `rgba(${hexToRgb(engine.textColor)}, ${opacity})`;
                    ctx.fillRect(
                        trailTopScreenPos.x,
                        trailTopScreenPos.y,
                        effectiveCharWidth,
                        effectiveCharHeight * GRID_CELL_SPAN
                    );
                }
            }

            // Cursor spans 2 cells: bottom cell at cursorPos.y and top cell at cursorPos.y-1
            const cursorBottomScreenPos = engine.worldToScreen(engine.cursorPos.x, engine.cursorPos.y, currentZoom, currentOffset);
            const cursorTopScreenPos = engine.worldToScreen(engine.cursorPos.x, engine.cursorPos.y - 1, currentZoom, currentOffset);

            if (cursorBottomScreenPos.x >= -effectiveCharWidth && cursorBottomScreenPos.x <= cssWidth &&
                cursorTopScreenPos.y >= -effectiveCharHeight && cursorBottomScreenPos.y <= cssHeight) {
                const key = `${engine.cursorPos.x},${engine.cursorPos.y}`;

                // Don't render cursor if in chat mode or if there's chat/command data at this position
                if (!engine.chatMode.isActive && !engine.chatData[key] && !engine.commandData[key]) {
                    // Determine cursor color based on engine state
                    if (engine.worldPersistenceError) {
                        ctx.fillStyle = CURSOR_COLOR_ERROR;
                    } else if (engine.isSavingWorld) {
                        ctx.fillStyle = CURSOR_COLOR_SAVE;
                    } else {
                        ctx.fillStyle = engine.textColor;
                    }

                    // Add glowy effect to cursor
                    ctx.shadowColor = ctx.fillStyle as string;
                    ctx.shadowBlur = 0;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                    // Render cursor spanning GRID_CELL_SPAN cells vertically (from top cell down to bottom cell)
                    ctx.fillRect(cursorTopScreenPos.x, cursorTopScreenPos.y, effectiveCharWidth, effectiveCharHeight * GRID_CELL_SPAN);
                    ctx.shadowBlur = 0;

                    const charData = engine.worldData[key];
                    if (charData && !engine.isComposing) {
                        // Don't render the character at cursor position when composing - show preview instead
                        const char = engine.isImageData(charData) ? '' : engine.getCharacter(charData);
                        ctx.fillStyle = CURSOR_TEXT_COLOR;
                        // Render character with baseline at top cell position
                        renderText(ctx, char, cursorTopScreenPos.x, cursorTopScreenPos.y + verticalTextOffset);
                    }

                    // === Render IME Composition Preview (on cursor) ===
                    if (engine.isComposing && engine.compositionText && engine.compositionStartPos) {
                        const startPos = engine.compositionStartPos;

                        for (let i = 0; i < engine.compositionText.length; i++) {
                            const char = engine.compositionText[i];
                            const worldX = startPos.x + i;
                            const worldY = startPos.y;

                            if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                                const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);

                                if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth &&
                                    screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {

                                    if (char && char.trim() !== '') {
                                        // Render character with cursor text color (so it shows on cursor background)
                                        ctx.fillStyle = CURSOR_TEXT_COLOR;
                                        renderText(ctx, char, screenPos.x, screenPos.y + verticalTextOffset);

                                        // Draw underline to indicate composition state
                                        ctx.strokeStyle = CURSOR_TEXT_COLOR;
                                        ctx.lineWidth = 2;
                                        ctx.beginPath();
                                        ctx.moveTo(screenPos.x, screenPos.y + effectiveCharHeight - 2);
                                        ctx.lineTo(screenPos.x + effectiveCharWidth, screenPos.y + effectiveCharHeight - 2);
                                        ctx.stroke();
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // === Render Agent ===
        if (engine.agentEnabled) {
            // Draw agent selection (if active)
            if (engine.agentSelectionStart && engine.agentSelectionEnd) {
                const minX = Math.min(engine.agentSelectionStart.x, engine.agentSelectionEnd.x);
                const maxX = Math.max(engine.agentSelectionStart.x, engine.agentSelectionEnd.x);
                const minY = Math.min(engine.agentSelectionStart.y, engine.agentSelectionEnd.y);
                const maxY = Math.max(engine.agentSelectionStart.y, engine.agentSelectionEnd.y);

                // Fill selected region with semi-transparent pink (no border - just like user selection)
                for (let y = minY; y <= maxY; y++) {
                    for (let x = minX; x <= maxX; x++) {
                        const screenPos = engine.worldToScreen(x, y, currentZoom, currentOffset);

                        // Only draw if visible on screen
                        if (screenPos.x >= -effectiveCharWidth &&
                            screenPos.x <= cssWidth &&
                            screenPos.y >= -effectiveCharHeight &&
                            screenPos.y <= cssHeight) {

                            ctx.fillStyle = 'rgba(255, 105, 180, 0.3)'; // Semi-transparent pink
                            ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                        }
                    }
                }
            }

            // Draw agent trail (older positions first, for proper layering)
            const now = Date.now();
            for (let i = agentTrail.length - 1; i >= 0; i--) {
                const trailPos = agentTrail[i];
                const age = now - trailPos.timestamp;

                // Skip positions that are too old
                if (age > CURSOR_TRAIL_FADE_MS) continue;

                // Skip the current position only if it perfectly matches the agent
                if (age < 20 &&
                    trailPos.x === engine.agentPos.x &&
                    trailPos.y === engine.agentPos.y) continue;

                // Calculate opacity based on age (1.0 to 0.0)
                const opacity = 1 - (age / CURSOR_TRAIL_FADE_MS);

                const trailScreenPos = engine.worldToScreen(
                    trailPos.x, trailPos.y,
                    currentZoom, currentOffset
                );

                // Only draw if visible on screen
                if (trailScreenPos.x >= -effectiveCharWidth &&
                    trailScreenPos.x <= cssWidth &&
                    trailScreenPos.y >= -effectiveCharHeight &&
                    trailScreenPos.y <= cssHeight) {

                    // Draw faded pink cursor rectangle
                    ctx.fillStyle = `rgba(255, 105, 180, ${opacity})`; // Pink with fade
                    ctx.fillRect(
                        trailScreenPos.x,
                        trailScreenPos.y,
                        effectiveCharWidth,
                        effectiveCharHeight
                    );
                }
            }

            // Draw current agent position
            const agentScreenPos = engine.worldToScreen(engine.agentPos.x, engine.agentPos.y, currentZoom, currentOffset);

            // Only draw if visible on screen
            if (agentScreenPos.x >= -effectiveCharWidth &&
                agentScreenPos.x <= cssWidth &&
                agentScreenPos.y >= -effectiveCharHeight &&
                agentScreenPos.y <= cssHeight) {

                // Draw pink cursor for agent
                ctx.fillStyle = '#FF69B4'; // Hot pink
                ctx.fillRect(agentScreenPos.x, agentScreenPos.y, effectiveCharWidth, effectiveCharHeight);

                // Check if there's a character at agent position and render it in white
                const agentKey = `${engine.agentPos.x},${engine.agentPos.y}`;
                const charData = engine.worldData[agentKey];
                if (charData) {
                    const char = engine.isImageData(charData) ? '' : engine.getCharacter(charData);
                    ctx.fillStyle = '#FFFFFF'; // White text on pink background
                    renderText(ctx, char, agentScreenPos.x, agentScreenPos.y + verticalTextOffset);
                }
            }
        }

        // === Render Multiplayer Cursors ===
        if (engine.multiplayerCursors && engine.multiplayerCursors.length > 0) {
            for (const cursor of engine.multiplayerCursors) {
                const cursorScreenPos = engine.worldToScreen(cursor.x, cursor.y, currentZoom, currentOffset);

                // Only draw if visible on screen
                if (cursorScreenPos.x >= -effectiveCharWidth &&
                    cursorScreenPos.x <= cssWidth &&
                    cursorScreenPos.y >= -effectiveCharHeight &&
                    cursorScreenPos.y <= cssHeight) {

                    // Draw cursor rectangle with user's color
                    ctx.fillStyle = cursor.color;
                    ctx.globalAlpha = 0.7; // Slight transparency
                    ctx.fillRect(cursorScreenPos.x, cursorScreenPos.y, effectiveCharWidth, effectiveCharHeight);
                    ctx.globalAlpha = 1.0;

                    // Check if there's a character at cursor position and render it
                    const cursorKey = `${cursor.x},${cursor.y}`;
                    const charData = engine.worldData[cursorKey];
                    if (charData) {
                        const char = engine.isImageData(charData) ? '' : engine.getCharacter(charData);
                        if (char && char.trim() !== '') {
                            ctx.fillStyle = '#FFFFFF'; // White text on colored background
                            renderText(ctx, char, cursorScreenPos.x, cursorScreenPos.y + verticalTextOffset);
                        }
                    }

                    // Draw username label above cursor
                    if (cursor.username && cursor.username !== 'Anonymous') {
                        ctx.save();
                        ctx.font = `${Math.max(10, effectiveFontSize * 0.7)}px ${fontFamily}`;
                        ctx.fillStyle = cursor.color;
                        ctx.textBaseline = 'bottom';
                        const labelY = cursorScreenPos.y - 2;
                        ctx.fillText(cursor.username, cursorScreenPos.x, labelY);
                        ctx.restore();
                    }
                }
            }
        }

        // === Render Offscreen Multiplayer Cursor Arrows ===
        if (engine.multiplayerCursors && engine.multiplayerCursors.length > 0) {
            const viewportCenterScreen = { x: cssWidth / 2, y: cssHeight / 2 };
            const edgeBuffer = 20; // Buffer from viewport edge

            for (const cursor of engine.multiplayerCursors) {
                const cursorScreenPos = engine.worldToScreen(cursor.x, cursor.y, currentZoom, currentOffset);

                // Check if cursor is offscreen
                const isOffscreen = cursorScreenPos.x < -effectiveCharWidth ||
                                    cursorScreenPos.x > cssWidth ||
                                    cursorScreenPos.y < -effectiveCharHeight ||
                                    cursorScreenPos.y > cssHeight;

                if (isOffscreen) {
                    // Find intersection point on viewport edge
                    const intersection = getViewportEdgeIntersection(
                        viewportCenterScreen.x,
                        viewportCenterScreen.y,
                        cursorScreenPos.x,
                        cursorScreenPos.y,
                        cssWidth,
                        cssHeight
                    );

                    if (!intersection) continue; // Skip if no valid intersection

                    // Adjust arrow position with buffer from edge
                    let adjustedX = intersection.x;
                    let adjustedY = intersection.y;
                    adjustedX = Math.max(edgeBuffer, Math.min(cssWidth - edgeBuffer, adjustedX));
                    adjustedY = Math.max(edgeBuffer, Math.min(cssHeight - edgeBuffer, adjustedY));

                    // Draw arrow pointing to offscreen cursor
                    drawArrow(ctx, adjustedX, adjustedY, intersection.angle, cursor.color);

                    // Draw username label next to arrow (using angle-based positioning like labels)
                    if (cursor.username && cursor.username !== 'Anonymous') {
                        ctx.fillStyle = cursor.color;
                        ctx.font = `${Math.max(10, effectiveFontSize * 0.8)}px ${fontFamily}`;
                        const textOffset = ARROW_SIZE * 1.5;
                        
                        // Position text inward from arrow using angle
                        let textX = adjustedX - Math.cos(intersection.angle) * textOffset;
                        let textY = adjustedY - Math.sin(intersection.angle) * textOffset;

                        // Adjust alignment based on angle quadrants
                        if (Math.abs(intersection.angle) < Math.PI / 2) {
                            ctx.textAlign = 'right';
                        } else {
                            ctx.textAlign = 'left';
                        }

                        if (intersection.angle > Math.PI / 4 && intersection.angle < 3 * Math.PI / 4) {
                            ctx.textBaseline = 'bottom';
                        } else if (intersection.angle < -Math.PI / 4 && intersection.angle > -3 * Math.PI / 4) {
                            ctx.textBaseline = 'top';
                        } else {
                            ctx.textBaseline = 'middle';
                        }

                        ctx.fillText(cursor.username, textX, textY);
                        
                        // Reset to defaults
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'top';
                    }
                }
            }
        }

        // === Capture frame for tape recorder (before UI overlays) ===
        if (recorderRef.current) {
            recorderRef.current.captureFrame();
        }

        // === Render Nav Dialogue ===
        if (engine.isNavVisible) {
            renderNavDialogue({
                canvasWidth: cssWidth,
                canvasHeight: cssHeight,
                ctx,
                labels: engine.getSortedLabels(engine.navSortMode, engine.navOriginPosition),
                originPosition: engine.navOriginPosition,
                uniqueColors: engine.getUniqueColors(),
                activeFilters: engine.navColorFilters,
                sortMode: engine.navSortMode,
                onCoordinateClick: handleCoordinateClick,
                onColorFilterClick: handleColorFilterClick,
                onSortModeClick: handleSortModeClick,
                availableStates: engine.availableStates,
                username: engine.username,
                onStateClick: handleStateClick,
                navMode: engine.navMode,
                onIndexClick: handleIndexClick,
                onPublishClick: handlePublishClick,
                onNavigateClick: handleNavigateClick,
                getStatePublishStatus: getStatePublishStatus,
                bounds: engine.getAllBounds()
            });
        }

        // === Render Dialogue ===
        if (dialogueEnabled && engine.dialogueText) {
            renderDialogue({
                canvasWidth: cssWidth,
                canvasHeight: cssHeight,
                ctx,
                dialogueText: engine.dialogueText,
                displayName: 'host', // Use host display for AI responses
                textColor: engine.textColor,
                backgroundColor: engine.backgroundColor || '#FFFFFF',
                timestamp: engine.dialogueTimestamp
            });
        }

        // === Render Pan Distance Monitor ===
        // Only show in non-read-only mode
        if (isPanning && panDistance > 0 && !engine.isReadOnly) {
            ctx.save();
            ctx.font = `14px ${fontFamily}`;
            ctx.fillStyle = '#808080';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            const panText = `Pan: ${panDistance} cells`;
            ctx.fillText(panText, cssWidth / 2, 40); // Top center
            ctx.restore();
        }

        // === Render Debug Dialogue ===
        if (engine.settings.isDebugVisible) {
            renderDebugDialogue({
                canvasWidth: cssWidth,
                canvasHeight: cssHeight,
                ctx,
                debugText: enhancedDebugText
            });
        }

        ctx.restore();
        // --- End Drawing ---
    }, [engine, engine.backgroundMode, engine.backgroundImage, engine.commandData, engine.commandState, engine.lightModeData, engine.chatData, engine.searchData, engine.isSearchActive, engine.searchPattern, engine.faceOrientation, engine.isFaceDetectionEnabled, canvasSize, cursorColorAlternate, isMiddleMouseDownRef.current, intermediatePanOffsetRef.current, cursorTrail, mouseWorldPos, isShiftPressed, shiftDragStartPos, selectedImageKey, selectedNoteKey, selectedIframeKey, selectedMailKey, clipboardFlashBounds, renderDialogue, renderDebugDialogue, enhancedDebugText, showCursor, dialogueEnabled, drawArrow, getViewportEdgeIntersection, isBlockInViewport, updateTasksIndex, drawHoverPreview, drawModeSpecificPreview, drawPositionInfo, findTextBlock, findImageAtPosition]);


    // --- Drawing Loop Effect ---
    useEffect(() => {
        let animationFrameId: number;
        const renderLoop = () => {
            draw();
            animationFrameId = requestAnimationFrame(renderLoop);
        };
        renderLoop();
        return () => cancelAnimationFrame(animationFrameId);
    }, [draw]); // Rerun if draw changes

    // Add this effect to handle wheel events with non-passive option
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const wheelHandler = (e: WheelEvent) => {
            const rect = canvas.getBoundingClientRect();
            engine.handleCanvasWheel(
                e.deltaX, e.deltaY,
                e.clientX - rect.left, e.clientY - rect.top,
                e.ctrlKey || e.metaKey
            );
            
            // Prevent default if we're handling this ourselves
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
            }
        };
        
        // Add wheel listener with non-passive option
        canvas.addEventListener('wheel', wheelHandler, { passive: false });
        
        // Cleanup function
        return () => {
            canvas.removeEventListener('wheel', wheelHandler);
        };
    }, [engine]);

    // --- Event Handlers (Attached to Canvas) ---
    const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (e.button !== 0) return; // Only left clicks

        // Don't process click if it was the end of a pan
        if (panStartInfoRef.current) {
            panStartInfoRef.current = null;
            if (isMiddleMouseDownRef.current) return;
        }

        // Get canvas-relative coordinates
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        // Host mode: tap/click to advance to next message (if not expecting input)
        if (engine.hostMode.isActive && hostDialogue.isHostActive) {
            const currentMessage = hostDialogue.getCurrentMessage();
            if (currentMessage && !currentMessage.expectsInput) {
                hostDialogue.advanceToNextMessage();
                return; // Don't process further
            }
        }

        // Check for nav coordinate clicks first
        if (engine.isNavVisible && canvasRef.current) {
            if (handleNavClick(canvasRef.current, clickX, clickY, handleCoordinateClick, handleColorFilterClick, handleSortModeClick, handleStateClick, handleIndexClick, handlePublishClick, handleNavigateClick)) {
                return; // Click was handled by nav, don't process further
            }
        }
        
        // Check for command dropdown clicks
        if (engine.commandState.isActive && Object.keys(engine.commandData).length > 0) {
            const worldPos = engine.screenToWorld(clickX, clickY, engine.zoomLevel, engine.viewOffset);
            const clickedWorldX = Math.floor(worldPos.x);
            const clickedWorldY = Math.floor(worldPos.y);

            // Check if click is on a command suggestion (not the typed command line)
            if (clickedWorldY > engine.commandState.commandStartPos.y &&
                clickedWorldY < engine.commandState.commandStartPos.y + GRID_CELL_SPAN + (engine.commandState.matchedCommands.length * GRID_CELL_SPAN)) {

                const suggestionIndex = Math.floor((clickedWorldY - engine.commandState.commandStartPos.y + 1) / GRID_CELL_SPAN) - 1;
                if (suggestionIndex >= 0 && suggestionIndex < engine.commandState.matchedCommands.length) {
                    const selectedCommand = engine.commandState.matchedCommands[suggestionIndex];

                    // Use the command system to populate the input with the selected command
                    if (engine.commandSystem && typeof engine.commandSystem.selectCommand === 'function') {
                        engine.commandSystem.selectCommand(selectedCommand);
                    }

                    // Focus hidden input to keep keyboard visible for text-driven command menu
                    if (hiddenInputRef.current) {
                        hiddenInputRef.current.focus();
                    }

                    return; // Command was selected, don't process as regular click
                }
            }

            // If command menu is active but click wasn't on a command suggestion,
            // still return early to preserve selection and maintain keyboard focus
            // Focus hidden input to keep keyboard visible since command menu is text-driven
            if (hiddenInputRef.current) {
                hiddenInputRef.current.focus();
            }
            return;
        }

        // Set flag to prevent trail creation from click movement
        isClickMovementRef.current = true;

        // Check if clicking outside selected mail region - if so, clear it
        if (selectedMailKey) {
            const worldPos = engine.screenToWorld(clickX, clickY, engine.zoomLevel, engine.viewOffset);
            const snappedWorldPos = {
                x: Math.floor(worldPos.x),
                y: Math.floor(worldPos.y)
            };
            const mailAtClick = findMailAtPosition(snappedWorldPos);
            
            // If clicking outside any mail region, or on a different mail region, clear selection
            if (!mailAtClick || mailAtClick.key !== selectedMailKey) {
                setSelectedMailKey(null);
            }
        }

        // Pass to engine's regular click handler
        engine.handleCanvasClick(clickX, clickY, false, e.shiftKey, e.metaKey, e.ctrlKey);

        // Focus hidden input to capture IME composition events (all platforms) and trigger keyboard (mobile)
        // - When host dialogue is active: only if expecting input
        // - When host dialogue is NOT active: always focus for regular typing
        if (hiddenInputRef.current) {
            if (hostDialogue.isHostActive) {
                if (hostDialogue.isExpectingInput()) {
                    hiddenInputRef.current.focus();
                }
            } else {
                // Not in host mode - focus for regular typing and IME
                hiddenInputRef.current.focus();
            }
        }
    }, [engine, canvasSize, router, handleNavClick, handleCoordinateClick, handleColorFilterClick, handleSortModeClick, handleStateClick, handleIndexClick, hostDialogue]);

    const handleCanvasDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (e.button !== 0) return; // Only left clicks

        // Get canvas-relative coordinates
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        // Convert to world coordinates
        const worldPos = engine.screenToWorld(clickX, clickY, engine.zoomLevel, engine.viewOffset);
        const snappedWorldPos = {
            x: Math.floor(worldPos.x),
            y: Math.floor(worldPos.y)
        };

        // Find the text block at this position (prioritize text)
        const textBlock = findTextBlock(snappedWorldPos, engine.worldData, engine);
        
        if (textBlock.length > 0) {
            // Clear any selected image when selecting text
            setSelectedImageKey(null);
            
            // Calculate bounding rectangle of the text block
            const minX = Math.min(...textBlock.map(p => p.x));
            const maxX = Math.max(...textBlock.map(p => p.x));
            const minY = Math.min(...textBlock.map(p => p.y));
            const maxY = Math.max(...textBlock.map(p => p.y));
            
            // Convert world coordinates back to canvas coordinates for the selection API
            const startScreen = engine.worldToScreen(minX, minY, engine.zoomLevel, engine.viewOffset);
            const endScreen = engine.worldToScreen(maxX, maxY, engine.zoomLevel, engine.viewOffset);
            
            // Use the proper selection API methods
            engine.handleSelectionStart(startScreen.x, startScreen.y);
            engine.handleSelectionMove(endScreen.x, endScreen.y);
            engine.handleSelectionEnd();
            
            // Set flag to prevent trail creation
            isClickMovementRef.current = true;
        } else {
            // If no text block found, check for image
            const imageAtPosition = findImageAtPosition(snappedWorldPos);
            
            if (imageAtPosition) {
                // Find the image key
                let imageKey = null;
                for (const key in engine.worldData) {
                    if (key.startsWith('image_')) {
                        const data = engine.worldData[key];
                        if (engine.isImageData(data) && data === imageAtPosition) {
                            imageKey = key;
                            break;
                        }
                    }
                }
                
                if (imageKey) {
                    // Clear any text selection and select the image
                    engine.handleSelectionStart(0, 0);
                    engine.handleSelectionEnd(); // This clears the text selection
                    setSelectedImageKey(imageKey);
                    
                    // Set flag to prevent trail creation
                    isClickMovementRef.current = true;
                }
            } else {
                // If no text block or image found, check for note region
                const planAtPosition = findPlanAtPosition(snappedWorldPos);

                if (planAtPosition) {
                    // Clear any text selection and image selection, select the note region
                    engine.handleSelectionStart(0, 0);
                    engine.handleSelectionEnd();
                    setSelectedImageKey(null);
                    setSelectedNoteKey(planAtPosition.key);
                    setSelectedIframeKey(null);

                    // Set flag to prevent trail creation
                    isClickMovementRef.current = true;
                } else {
                    // If no text block, image, or note found, check for iframe
                    const iframeAtPosition = findIframeAtPosition(snappedWorldPos);

                    if (iframeAtPosition) {
                        // Double-click on iframe activates it for interaction
                        setActiveIframeKey(iframeAtPosition.key);
                        setSelectedIframeKey(iframeAtPosition.key);
                        setSelectedImageKey(null);
                        setSelectedNoteKey(null);
                        setSelectedMailKey(null);
                        engine.handleSelectionStart(0, 0);
                        engine.handleSelectionEnd();

                        // Set flag to prevent trail creation
                        isClickMovementRef.current = true;
                    } else {
                        // If no text block, image, note, or iframe found, check for mail
                        const mailAtPosition = findMailAtPosition(snappedWorldPos);

                        if (mailAtPosition) {
                            // Double-click on mail selects it
                            setSelectedMailKey(mailAtPosition.key);
                            setSelectedImageKey(null);
                            setSelectedNoteKey(null);
                            setSelectedIframeKey(null);
                            setActiveIframeKey(null);
                            engine.handleSelectionStart(0, 0);
                            engine.handleSelectionEnd();

                            // Set flag to prevent trail creation
                            isClickMovementRef.current = true;
                        } else {
                            // Clear any selections if clicking on empty space
                            setSelectedImageKey(null);
                            setSelectedNoteKey(null);
                            setSelectedIframeKey(null);
                            setActiveIframeKey(null);
                            setSelectedMailKey(null);
                        }
                    }
                }
            }
        }

        canvasRef.current?.focus(); // Ensure focus for keyboard
    }, [engine, findTextBlock, findImageAtPosition, findPlanAtPosition, findIframeAtPosition, findMailAtPosition]);
    
    const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        if (e.button === 1) { // Middle mouse button - panning
            e.preventDefault(); // Prevent default scrolling behavior
            isMiddleMouseDownRef.current = true;
            const info = engine.handlePanStart(e.clientX, e.clientY);
            panStartInfoRef.current = info;
            intermediatePanOffsetRef.current = { ...engine.viewOffset }; // Clone to avoid reference issues
            panStartPosRef.current = { ...engine.viewOffset }; // Track starting position for distance
            setIsPanning(true);
            setPanDistance(0);
            lastPanMilestoneRef.current = 0; // Reset milestone tracker
            if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
        } else if (e.button === 0) { // Left mouse button
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Check if clicking on a resize handle first
            const thumbSize = 8;
            const thumbHitArea = thumbSize + 6; // Add padding for easier clicking (14px total)

            // Helper function to check if point is within a thumb
            const isWithinThumb = (px: number, py: number, tx: number, ty: number): boolean => {
                return Math.abs(px - tx) <= thumbHitArea / 2 && Math.abs(py - ty) <= thumbHitArea / 2;
            };

            // Check image resize handles
            if (selectedImageKey) {
                const selectedImageData = engine.worldData[selectedImageKey];
                if (engine.isImageData(selectedImageData)) {
                    const topLeftScreen = engine.worldToScreen(selectedImageData.startX, selectedImageData.startY, engine.zoomLevel, engine.viewOffset);
                    const bottomRightScreen = engine.worldToScreen(selectedImageData.endX + 1, selectedImageData.endY + 1, engine.zoomLevel, engine.viewOffset);

                    const left = topLeftScreen.x;
                    const right = bottomRightScreen.x;
                    const top = topLeftScreen.y;
                    const bottom = bottomRightScreen.y;

                    // Check each corner handle
                    let handle: ResizeHandle | null = null;
                    if (isWithinThumb(x, y, left, top)) handle = 'top-left';
                    else if (isWithinThumb(x, y, right, top)) handle = 'top-right';
                    else if (isWithinThumb(x, y, right, bottom)) handle = 'bottom-right';
                    else if (isWithinThumb(x, y, left, bottom)) handle = 'bottom-left';

                    if (handle) {
                        setResizeState({
                            active: true,
                            type: 'image',
                            key: selectedImageKey,
                            handle,
                            originalBounds: {
                                startX: selectedImageData.startX,
                                startY: selectedImageData.startY,
                                endX: selectedImageData.endX,
                                endY: selectedImageData.endY
                            },
                            roomIndex: null
                        });
                        return; // Early return, don't process other mouse events
                    }
                }
            }

            // Check note resize handles
            if (selectedNoteKey) {
                try {
                    const selectedNoteData = JSON.parse(engine.worldData[selectedNoteKey] as string);
                    const topLeftScreen = engine.worldToScreen(selectedNoteData.startX, selectedNoteData.startY, engine.zoomLevel, engine.viewOffset);
                    const bottomRightScreen = engine.worldToScreen(selectedNoteData.endX + 1, selectedNoteData.endY + 1, engine.zoomLevel, engine.viewOffset);

                    const left = topLeftScreen.x;
                    const right = bottomRightScreen.x;
                    const top = topLeftScreen.y;
                    const bottom = bottomRightScreen.y;

                    // Check each corner handle
                    let handle: ResizeHandle | null = null;
                    if (isWithinThumb(x, y, left, top)) handle = 'top-left';
                    else if (isWithinThumb(x, y, right, top)) handle = 'top-right';
                    else if (isWithinThumb(x, y, right, bottom)) handle = 'bottom-right';
                    else if (isWithinThumb(x, y, left, bottom)) handle = 'bottom-left';

                    if (handle) {
                        setResizeState({
                            active: true,
                            type: 'note',
                            key: selectedNoteKey,
                            handle,
                            originalBounds: {
                                startX: selectedNoteData.startX,
                                startY: selectedNoteData.startY,
                                endX: selectedNoteData.endX,
                                endY: selectedNoteData.endY
                            },
                            roomIndex: null
                        });
                        return; // Early return, don't process other mouse events
                    }
                } catch (e) {
                    // Skip invalid note data
                }
            }

            // Check iframe resize handles
            if (selectedIframeKey) {
                try {
                    const selectedIframeData = JSON.parse(engine.worldData[selectedIframeKey] as string);
                    const topLeftScreen = engine.worldToScreen(selectedIframeData.startX, selectedIframeData.startY, engine.zoomLevel, engine.viewOffset);
                    const bottomRightScreen = engine.worldToScreen(selectedIframeData.endX + 1, selectedIframeData.endY + 1, engine.zoomLevel, engine.viewOffset);

                    const left = topLeftScreen.x;
                    const right = bottomRightScreen.x;
                    const top = topLeftScreen.y;
                    const bottom = bottomRightScreen.y;

                    // Check each corner handle
                    let handle: ResizeHandle | null = null;
                    if (isWithinThumb(x, y, left, top)) handle = 'top-left';
                    else if (isWithinThumb(x, y, right, top)) handle = 'top-right';
                    else if (isWithinThumb(x, y, right, bottom)) handle = 'bottom-right';
                    else if (isWithinThumb(x, y, left, bottom)) handle = 'bottom-left';

                    if (handle) {
                        setResizeState({
                            active: true,
                            type: 'iframe',
                            key: selectedIframeKey,
                            handle,
                            originalBounds: {
                                startX: selectedIframeData.startX,
                                startY: selectedIframeData.startY,
                                endX: selectedIframeData.endX,
                                endY: selectedIframeData.endY
                            },
                            roomIndex: null
                        });
                        return; // Early return, don't process other mouse events
                    }
                } catch (e) {
                    // Skip invalid iframe data
                }
            }

            // Check mail resize handles
            if (selectedMailKey) {
                try {
                    const selectedMailData = JSON.parse(engine.worldData[selectedMailKey] as string);
                    const topLeftScreen = engine.worldToScreen(selectedMailData.startX, selectedMailData.startY, engine.zoomLevel, engine.viewOffset);
                    const bottomRightScreen = engine.worldToScreen(selectedMailData.endX + 1, selectedMailData.endY + 1, engine.zoomLevel, engine.viewOffset);

                    const left = topLeftScreen.x;
                    const right = bottomRightScreen.x;
                    const top = topLeftScreen.y;
                    const bottom = bottomRightScreen.y;

                    // Check each corner handle
                    let handle: ResizeHandle | null = null;
                    if (isWithinThumb(x, y, left, top)) handle = 'top-left';
                    else if (isWithinThumb(x, y, right, top)) handle = 'top-right';
                    else if (isWithinThumb(x, y, right, bottom)) handle = 'bottom-right';
                    else if (isWithinThumb(x, y, left, bottom)) handle = 'bottom-left';

                    if (handle) {
                        setResizeState({
                            active: true,
                            type: 'mail',
                            key: selectedMailKey,
                            handle,
                            originalBounds: {
                                startX: selectedMailData.startX,
                                startY: selectedMailData.startY,
                                endX: selectedMailData.endX,
                                endY: selectedMailData.endY
                            },
                            roomIndex: null
                        });
                        return; // Early return, don't process other mouse events
                    }
                } catch (e) {
                    // Skip invalid mail data
                }
            }

            // Check pattern room resize handles (check rooms first, they're inside the pattern)
            if (selectedPatternKey) {
                try {
                    const patternData = JSON.parse(engine.worldData[selectedPatternKey] as string);
                    const { centerX, centerY, width = 120, height = 60, noteKeys = [], rooms = [] } = patternData;

                    // Get notes from noteKeys (new format) or use inline rooms (legacy)
                    const noteKeysToUse = noteKeys.length > 0 ? noteKeys : [];
                    const roomsToUse = noteKeys.length > 0 ? [] : rooms;

                    // Check individual note/room corners first (smaller hit area for precision)
                    const roomThumbHitArea = 10; // 6px thumb + 4px padding

                    // Check notes (new format)
                    for (let noteIndex = 0; noteIndex < noteKeysToUse.length; noteIndex++) {
                        const noteKey = noteKeysToUse[noteIndex];
                        try {
                            const noteData = JSON.parse(engine.worldData[noteKey] as string);
                            const roomTopLeft = engine.worldToScreen(noteData.startX, noteData.startY, engine.zoomLevel, engine.viewOffset);
                            const roomBottomRight = engine.worldToScreen(noteData.endX, noteData.endY, engine.zoomLevel, engine.viewOffset);

                            const roomLeft = roomTopLeft.x;
                            const roomRight = roomBottomRight.x;
                            const roomTop = roomTopLeft.y;
                            const roomBottom = roomBottomRight.y;

                            // Check if clicking on any room corner thumb
                            let handle: ResizeHandle | null = null;
                            if (Math.abs(x - roomLeft) <= roomThumbHitArea / 2 && Math.abs(y - roomTop) <= roomThumbHitArea / 2) handle = 'top-left';
                            else if (Math.abs(x - roomRight) <= roomThumbHitArea / 2 && Math.abs(y - roomTop) <= roomThumbHitArea / 2) handle = 'top-right';
                            else if (Math.abs(x - roomRight) <= roomThumbHitArea / 2 && Math.abs(y - roomBottom) <= roomThumbHitArea / 2) handle = 'bottom-right';
                            else if (Math.abs(x - roomLeft) <= roomThumbHitArea / 2 && Math.abs(y - roomBottom) <= roomThumbHitArea / 2) handle = 'bottom-left';

                            if (handle) {
                                setResizeState({
                                    active: true,
                                    type: 'note',  // Resize as note, not pattern room
                                    key: noteKey,  // Use note key directly
                                    handle,
                                    originalBounds: {
                                        startX: noteData.startX,
                                        startY: noteData.startY,
                                        endX: noteData.endX,
                                        endY: noteData.endY
                                    },
                                    roomIndex: null
                                });
                                return; // Early return, don't process other mouse events
                            }
                        } catch (e) {
                            // Skip invalid note data
                        }
                    }

                    // Check legacy inline rooms
                    for (let roomIndex = 0; roomIndex < roomsToUse.length; roomIndex++) {
                        const room = roomsToUse[roomIndex];
                        const roomTopLeft = engine.worldToScreen(room.x, room.y, engine.zoomLevel, engine.viewOffset);
                        const roomBottomRight = engine.worldToScreen(room.x + room.width, room.y + room.height, engine.zoomLevel, engine.viewOffset);

                        const roomLeft = roomTopLeft.x;
                        const roomRight = roomBottomRight.x;
                        const roomTop = roomTopLeft.y;
                        const roomBottom = roomBottomRight.y;

                        // Check if clicking on any room corner thumb
                        let handle: ResizeHandle | null = null;
                        if (Math.abs(x - roomLeft) <= roomThumbHitArea / 2 && Math.abs(y - roomTop) <= roomThumbHitArea / 2) handle = 'top-left';
                        else if (Math.abs(x - roomRight) <= roomThumbHitArea / 2 && Math.abs(y - roomTop) <= roomThumbHitArea / 2) handle = 'top-right';
                        else if (Math.abs(x - roomRight) <= roomThumbHitArea / 2 && Math.abs(y - roomBottom) <= roomThumbHitArea / 2) handle = 'bottom-right';
                        else if (Math.abs(x - roomLeft) <= roomThumbHitArea / 2 && Math.abs(y - roomBottom) <= roomThumbHitArea / 2) handle = 'bottom-left';

                        if (handle) {
                            setResizeState({
                                active: true,
                                type: 'pattern',
                                key: selectedPatternKey,
                                handle,
                                originalBounds: {
                                    startX: room.x,
                                    startY: room.y,
                                    endX: room.x + room.width,
                                    endY: room.y + room.height
                                },
                                roomIndex: roomIndex
                            });
                            return; // Early return, don't process other mouse events
                        }
                    }
                } catch (e) {
                    // Skip invalid pattern data
                }
            }

            if (e.shiftKey) {
                // Shift+drag: prioritize selection, fallback to text block
                isSelectingMouseDownRef.current = false;

                const worldPos = engine.screenToWorld(x, y, engine.zoomLevel, engine.viewOffset);
                setShiftDragStartPos({
                    x: Math.floor(worldPos.x),
                    y: Math.floor(worldPos.y)
                });

                // Check if we have a selection and clicking inside it
                if (engine.selectionStart && engine.selectionEnd) {
                    const minX = Math.floor(Math.min(engine.selectionStart.x, engine.selectionEnd.x));
                    const maxX = Math.floor(Math.max(engine.selectionStart.x, engine.selectionEnd.x));
                    const minY = Math.floor(Math.min(engine.selectionStart.y, engine.selectionEnd.y));
                    const maxY = Math.floor(Math.max(engine.selectionStart.y, engine.selectionEnd.y));

                    // Check if click is inside selection bounds
                    if (worldPos.x >= minX && worldPos.x <= maxX && worldPos.y >= minY && worldPos.y <= maxY) {
                        // Inside selection - don't call handleCanvasClick, just prepare to move
                        // Selection will be preserved for the move operation
                    } else {
                        // Outside selection - clear it and prepare to move text block at click position
                        // Don't pass shiftKey to avoid extending selection
                        engine.handleCanvasClick(x, y, true, false, e.metaKey, e.ctrlKey);
                    }
                } else {
                    // No selection - don't pass shiftKey to avoid any selection behavior
                    engine.handleCanvasClick(x, y, true, false, e.metaKey, e.ctrlKey);
                }
            } else {
                // Check if clicking on an iframe (single click selects it)
                const worldPos = engine.screenToWorld(x, y, engine.zoomLevel, engine.viewOffset);
                const snappedWorldPos = {
                    x: Math.floor(worldPos.x),
                    y: Math.floor(worldPos.y)
                };
                const iframeAtPosition = findIframeAtPosition(snappedWorldPos);

                // Check for pattern first
                const patternAtPosition = findPatternAtPosition(snappedWorldPos);

                if (patternAtPosition) {
                    // Single click on pattern selects it (shows resize handles)
                    setSelectedPatternKey(patternAtPosition.key);
                    setSelectedIframeKey(null);
                    setSelectedImageKey(null);
                    setSelectedNoteKey(null);
                    setSelectedMailKey(null);
                    if (activeIframeKey) {
                        setActiveIframeKey(null);
                    }
                    isSelectingMouseDownRef.current = false;
                } else if (iframeAtPosition) {
                    // Single click on iframe selects it (shows resize handles)
                    setSelectedIframeKey(iframeAtPosition.key);
                    setSelectedImageKey(null);
                    setSelectedNoteKey(null);
                    setSelectedPatternKey(null);
                    // Deactivate if clicking outside the currently active iframe
                    if (activeIframeKey && activeIframeKey !== iframeAtPosition.key) {
                        setActiveIframeKey(null);
                    }
                    isSelectingMouseDownRef.current = false;
                } else {
                    // Clear all selections when starting regular selection
                    setSelectedImageKey(null);
                    setSelectedNoteKey(null);
                    setSelectedIframeKey(null);
                    setSelectedPatternKey(null);
                    setSelectedMailKey(null);
                    // Deactivate any active iframe when clicking outside
                    if (activeIframeKey) {
                        setActiveIframeKey(null);
                    }

                    // Regular selection start
                    isSelectingMouseDownRef.current = true; // Track mouse down state
                    engine.handleSelectionStart(x, y); // Let the engine manage selection state
                }
            }

            canvasRef.current?.focus();
        }
    }, [engine, selectedImageKey, selectedNoteKey, selectedIframeKey, activeIframeKey, selectedMailKey, findIframeAtPosition]);

    const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Handle trail tracking - only in normal mode (not during pan or selection)
        if (!isMiddleMouseDownRef.current && !isSelectingMouseDownRef.current) {
            const worldPos = engine.screenToWorld(x, y, engine.zoomLevel, engine.viewOffset);
            monogram.updateMousePosition(worldPos);
        }

        // Always track mouse position for preview (when not actively dragging selection)
        if (!isMiddleMouseDownRef.current && !isSelectingMouseDownRef.current) {
            const worldPos = engine.screenToWorld(x, y, engine.zoomLevel, engine.viewOffset);

            // Check if we're in a glitched region - if so, snap to half-cells (vertical subdivision)
            const baseX = Math.floor(worldPos.x);
            const baseY = Math.floor(worldPos.y);

            // Check if this base cell is in a glitched region
            let isInGlitch = false;
            for (const key in engine.worldData) {
                if (key.startsWith('glitched_')) {
                    try {
                        const glitchData = JSON.parse(engine.worldData[key] as string);
                        if (baseX >= glitchData.startX && baseX <= glitchData.endX &&
                            baseY >= glitchData.startY && baseY <= glitchData.endY) {
                            isInGlitch = true;
                            break;
                        }
                    } catch (e) {
                        // Skip invalid glitch data
                    }
                }
            }

            // Calculate which half of the cell we're in (only for glitched regions)
            const snappedWorldPos: any = {
                x: baseX,
                y: baseY
            };

            if (isInGlitch) {
                const fractionalY = worldPos.y - baseY;
                snappedWorldPos.subY = fractionalY >= 0.5 ? 0.5 : 0;
            }
            setMouseWorldPos(snappedWorldPos);

            // Check if hovering over a link or task and update cursor
            let isOverLink = false;
            let isOverTask = false;

            for (const key in engine.worldData) {
                if (key.startsWith('link_')) {
                    try {
                        const linkData = JSON.parse(engine.worldData[key] as string);
                        if (baseX >= linkData.startX && baseX <= linkData.endX &&
                            baseY >= linkData.startY && baseY <= linkData.endY) {
                            isOverLink = true;
                            break;
                        }
                    } catch (e) {
                        // Skip invalid link data
                    }
                } else if (key.startsWith('label_')) {
                    const labelData = JSON.parse(engine.worldData[key] as string);
                    if (labelData.type !== 'task') continue;
                    try {
                        const taskData = JSON.parse(engine.worldData[key] as string);
                        if (baseX >= taskData.startX && baseX <= taskData.endX &&
                            baseY >= taskData.startY && baseY <= taskData.endY) {
                            isOverTask = true;
                            break;
                        }
                    } catch (e) {
                        // Skip invalid task data
                    }
                }
            }

            // Update cursor style
            if (canvasRef.current) {
                canvasRef.current.style.cursor = (isOverLink || isOverTask) ? 'pointer' : 'text';
            }
        }

        // Handle resize drag
        if (resizeState.active && resizeState.handle && resizeState.originalBounds) {
            const worldPos = engine.screenToWorld(x, y, engine.zoomLevel, engine.viewOffset);
            const snappedX = Math.floor(worldPos.x);
            const snappedY = Math.floor(worldPos.y);

            const { originalBounds, handle } = resizeState;
            let newBounds = { ...originalBounds };

            // Update bounds based on which corner handle is being dragged
            switch (handle) {
                case 'top-left':
                    newBounds.startX = Math.min(snappedX, originalBounds.endX - 1);
                    newBounds.startY = Math.min(snappedY, originalBounds.endY - 1);
                    break;
                case 'top-right':
                    newBounds.endX = Math.max(snappedX, originalBounds.startX + 1);
                    newBounds.startY = Math.min(snappedY, originalBounds.endY - 1);
                    break;
                case 'bottom-right':
                    newBounds.endX = Math.max(snappedX, originalBounds.startX + 1);
                    newBounds.endY = Math.max(snappedY, originalBounds.startY + 1);
                    break;
                case 'bottom-left':
                    newBounds.startX = Math.min(snappedX, originalBounds.endX - 1);
                    newBounds.endY = Math.max(snappedY, originalBounds.startY + 1);
                    break;
            }

            // Apply the resize to the appropriate object type
            if (resizeState.type === 'image' && resizeState.key) {
                const imageData = engine.worldData[resizeState.key];
                if (engine.isImageData(imageData)) {
                    engine.setWorldData(prev => ({
                        ...prev,
                        [resizeState.key!]: {
                            ...imageData,
                            startX: newBounds.startX,
                            startY: newBounds.startY,
                            endX: newBounds.endX,
                            endY: newBounds.endY
                        }
                    }));
                }
            } else if (resizeState.type === 'note' && resizeState.key) {
                try {
                    const noteData = JSON.parse(engine.worldData[resizeState.key] as string);

                    // Update the note
                    const updatedNoteData = {
                        ...noteData,
                        startX: newBounds.startX,
                        startY: newBounds.startY,
                        endX: newBounds.endX,
                        endY: newBounds.endY
                    };

                    // If this note is part of a pattern, recalculate pattern boundary
                    if (noteData.patternKey) {
                        try {
                            const patternData = JSON.parse(engine.worldData[noteData.patternKey] as string);
                            const noteKeys = patternData.noteKeys || [];

                            // Calculate boundary from all notes in pattern
                            const corridorPadding = 3;
                            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

                            for (const noteKey of noteKeys) {
                                try {
                                    // Use updated data for the note being resized, otherwise fetch from worldData
                                    const currentNoteData = noteKey === resizeState.key
                                        ? updatedNoteData
                                        : JSON.parse(engine.worldData[noteKey] as string);

                                    const noteMinX = currentNoteData.startX;
                                    const noteMinY = currentNoteData.startY;
                                    // endX/endY are inclusive, add 1 to get exclusive boundary (like legacy rooms)
                                    const noteMaxX = currentNoteData.endX + 1;
                                    const noteMaxY = currentNoteData.endY + 1;
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

                            // Update both note and pattern
                            engine.setWorldData(prev => ({
                                ...prev,
                                [resizeState.key!]: JSON.stringify(updatedNoteData),
                                [noteData.patternKey]: JSON.stringify({
                                    ...patternData,
                                    centerX: actualCenterX,
                                    centerY: actualCenterY,
                                    width: actualWidth,
                                    height: actualHeight
                                })
                            }));
                        } catch (e) {
                            // Pattern data invalid, just update note
                            engine.setWorldData(prev => ({
                                ...prev,
                                [resizeState.key!]: JSON.stringify(updatedNoteData)
                            }));
                        }
                    } else {
                        // Note not part of pattern, just update note
                        engine.setWorldData(prev => ({
                            ...prev,
                            [resizeState.key!]: JSON.stringify(updatedNoteData)
                        }));
                    }
                } catch (e) {
                    // Invalid note data
                }
            } else if (resizeState.type === 'iframe' && resizeState.key) {
                try {
                    const iframeData = JSON.parse(engine.worldData[resizeState.key] as string);
                    engine.setWorldData(prev => ({
                        ...prev,
                        [resizeState.key!]: JSON.stringify({
                            ...iframeData,
                            startX: newBounds.startX,
                            startY: newBounds.startY,
                            endX: newBounds.endX,
                            endY: newBounds.endY
                        })
                    }));
                } catch (e) {
                    // Invalid iframe data
                }
            } else if (resizeState.type === 'mail' && resizeState.key) {
                try {
                    const mailData = JSON.parse(engine.worldData[resizeState.key] as string);
                    const buttonKey = `mailbutton_${resizeState.key}`;
                    const buttonData = engine.worldData[buttonKey] ? JSON.parse(engine.worldData[buttonKey] as string) : null;

                    engine.setWorldData(prev => {
                        const updated = {
                            ...prev,
                            [resizeState.key!]: JSON.stringify({
                                ...mailData,
                                startX: newBounds.startX,
                                startY: newBounds.startY,
                                endX: newBounds.endX,
                                endY: newBounds.endY
                            })
                        };

                        // Update button position to stay at bottom-right corner
                        if (buttonData) {
                            updated[buttonKey] = JSON.stringify({
                                ...buttonData,
                                x: newBounds.endX,
                                y: newBounds.endY
                            });
                        }

                        return updated;
                    });
                } catch (e) {
                    // Invalid mail data
                }
            } else if (resizeState.type === 'pattern' && resizeState.key) {
                try {
                    const patternData = JSON.parse(engine.worldData[resizeState.key] as string);

                    if (resizeState.roomIndex !== null && resizeState.roomIndex !== undefined) {
                        // Resizing a specific room
                        const rooms = patternData.rooms || [];

                        // Bounds check for safety
                        if (resizeState.roomIndex < 0 || resizeState.roomIndex >= rooms.length) {
                            return;
                        }

                        const updatedRooms = [...rooms];

                        // Update the specific room
                        updatedRooms[resizeState.roomIndex] = {
                            x: newBounds.startX,
                            y: newBounds.startY,
                            width: newBounds.endX - newBounds.startX,
                            height: newBounds.endY - newBounds.startY
                        };

                        // Recalculate pattern boundary to enclose all rooms + corridors
                        const corridorPadding = 3;
                        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

                        for (const room of updatedRooms) {
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

                        engine.setWorldData(prev => ({
                            ...prev,
                            [resizeState.key!]: JSON.stringify({
                                ...patternData,
                                centerX: actualCenterX,
                                centerY: actualCenterY,
                                width: actualWidth,
                                height: actualHeight,
                                rooms: updatedRooms
                            })
                        }));
                    }
                } catch (e) {
                    // Invalid pattern data
                }
            }

            return; // Don't process other mouse move events during resize
        }

        if (isMiddleMouseDownRef.current && panStartInfoRef.current) {
            // Handle panning move
            intermediatePanOffsetRef.current = engine.handlePanMove(e.clientX, e.clientY, panStartInfoRef.current);

            // Calculate pan distance (for display only)
            if (panStartPosRef.current) {
                const dx = intermediatePanOffsetRef.current.x - panStartPosRef.current.x;
                const dy = intermediatePanOffsetRef.current.y - panStartPosRef.current.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const roundedDistance = Math.round(distance);
                setPanDistance(roundedDistance);
            }
        } else if (isSelectingMouseDownRef.current && !shiftDragStartPos) { // Check mouse down ref and not shift+dragging
            // Handle selection move
            engine.handleSelectionMove(x, y); // Update engine's selection end
        }
    }, [engine, shiftDragStartPos, resizeState]);

    const handleCanvasMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (isMiddleMouseDownRef.current && e.button === 1) { // Middle mouse button - panning end
            isMiddleMouseDownRef.current = false;
            engine.handlePanEnd(intermediatePanOffsetRef.current); // Commit final offset
            panStartInfoRef.current = null;
            panStartPosRef.current = null;
            if (canvasRef.current) canvasRef.current.style.cursor = 'text';

            // Clear pan distance after a delay
            setTimeout(() => {
                setIsPanning(false);
                setPanDistance(0);
            }, 1000);
        }

        if (e.button === 0) { // Left mouse button
            // Reset resize state if active
            if (resizeState.active) {
                setResizeState({
                    active: false,
                    type: null,
                    key: null,
                    handle: null,
                    originalBounds: null,
                    roomIndex: null
                });
                return; // Early return after resize complete
            }

            if (e.shiftKey && shiftDragStartPos) {
                // Calculate distance from shift+drag start to current position
                const rect = canvasRef.current?.getBoundingClientRect();
                if (rect) {
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    const worldPos = engine.screenToWorld(x, y, engine.zoomLevel, engine.viewOffset);
                    const endPos = {
                        x: Math.floor(worldPos.x),
                        y: Math.floor(worldPos.y)
                    };
                    
                    // Calculate distance vector
                    const distanceX = endPos.x - shiftDragStartPos.x;
                    const distanceY = endPos.y - shiftDragStartPos.y;
                    
                    // Only move if there's actual distance
                    if (distanceX !== 0 || distanceY !== 0) {
                        // First, check if we're moving an image
                        const imageAtPosition = findImageAtPosition(shiftDragStartPos);

                        if (imageAtPosition) {
                            // Find the original image key in worldData
                            let imageKey = null;
                            for (const key in engine.worldData) {
                                if (key.startsWith('image_')) {
                                    const data = engine.worldData[key];
                                    if (engine.isImageData(data) && data === imageAtPosition) {
                                        imageKey = key;
                                        break;
                                    }
                                }
                            }

                            if (imageKey) {
                                // Use the engine's moveImage method
                                engine.moveImage(imageKey, distanceX, distanceY);
                            }
                        } else if (selectedNoteKey) {
                            // Check if we're moving a selected note region
                            try {
                                const noteData = JSON.parse(engine.worldData[selectedNoteKey] as string);

                                // Create new note region with shifted coordinates, preserving patternKey
                                const newPlanData = {
                                    startX: noteData.startX + distanceX,
                                    endX: noteData.endX + distanceX,
                                    startY: noteData.startY + distanceY,
                                    endY: noteData.endY + distanceY,
                                    timestamp: Date.now(),
                                    ...(noteData.patternKey && { patternKey: noteData.patternKey })
                                };

                                // Delete old note and create new one with shifted position
                                const newPlanKey = `note_${newPlanData.startX},${newPlanData.startY}_${Date.now()}`;

                                engine.setWorldData(prev => {
                                    const newData = { ...prev };
                                    delete newData[selectedNoteKey];
                                    newData[newPlanKey] = JSON.stringify(newPlanData);

                                    // If note is part of a pattern, update pattern's noteKeys array and recalculate boundary
                                    if (noteData.patternKey) {
                                        try {
                                            const patternData = JSON.parse(newData[noteData.patternKey] as string);
                                            const noteKeys = patternData.noteKeys || [];

                                            // Replace old note key with new note key
                                            const updatedNoteKeys = noteKeys.map((key: string) =>
                                                key === selectedNoteKey ? newPlanKey : key
                                            );

                                            // Recalculate pattern boundary from all notes
                                            const corridorPadding = 3;
                                            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

                                            for (const noteKey of updatedNoteKeys) {
                                                try {
                                                    const currentNoteData = JSON.parse(newData[noteKey] as string);
                                                    const noteMinX = currentNoteData.startX;
                                                    const noteMinY = currentNoteData.startY;
                                                    // endX/endY are inclusive, add 1 to get exclusive boundary
                                                    const noteMaxX = currentNoteData.endX + 1;
                                                    const noteMaxY = currentNoteData.endY + 1;
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

                                            // Update pattern with new noteKeys and boundary
                                            newData[noteData.patternKey] = JSON.stringify({
                                                ...patternData,
                                                noteKeys: updatedNoteKeys,
                                                centerX: actualCenterX,
                                                centerY: actualCenterY,
                                                width: actualWidth,
                                                height: actualHeight
                                            });
                                        } catch (e) {
                                            // Pattern update failed, but note move still succeeds
                                        }
                                    }

                                    return newData;
                                });

                                // Update selected key to the new note region
                                setSelectedNoteKey(newPlanKey);
                            } catch (e) {
                                // Invalid note data, skip move
                            }
                        } else if (selectedIframeKey) {
                            // Check if we're moving a selected iframe region
                            try {
                                const iframeData = JSON.parse(engine.worldData[selectedIframeKey] as string);

                                // Create new iframe region with shifted coordinates
                                const newIframeData = {
                                    startX: iframeData.startX + distanceX,
                                    endX: iframeData.endX + distanceX,
                                    startY: iframeData.startY + distanceY,
                                    endY: iframeData.endY + distanceY,
                                    url: iframeData.url,
                                    timestamp: Date.now()
                                };

                                // Delete old iframe and create new one with shifted position
                                const newIframeKey = `iframe_${newIframeData.startX},${newIframeData.startY}_${Date.now()}`;

                                engine.setWorldData(prev => {
                                    const newData = { ...prev };
                                    delete newData[selectedIframeKey];
                                    newData[newIframeKey] = JSON.stringify(newIframeData);
                                    return newData;
                                });

                                // Update selected key to the new iframe region
                                setSelectedIframeKey(newIframeKey);
                            } catch (e) {
                                // Invalid iframe data, skip move
                            }
                        } else if (selectedMailKey) {
                            // Check if we're moving a selected mail region
                            try {
                                const mailData = JSON.parse(engine.worldData[selectedMailKey] as string);
                                const oldButtonKey = `mailbutton_${selectedMailKey}`;
                                const buttonData = engine.worldData[oldButtonKey] ? JSON.parse(engine.worldData[oldButtonKey] as string) : null;

                                // Create new mail region with shifted coordinates
                                const newMailData = {
                                    startX: mailData.startX + distanceX,
                                    endX: mailData.endX + distanceX,
                                    startY: mailData.startY + distanceY,
                                    endY: mailData.endY + distanceY,
                                    timestamp: Date.now()
                                };

                                // Delete old mail and create new one with shifted position
                                const newMailKey = `mail_${newMailData.startX},${newMailData.startY}_${Date.now()}`;
                                const newButtonKey = `mailbutton_${newMailKey}`;

                                engine.setWorldData(prev => {
                                    const newData = { ...prev };
                                    delete newData[selectedMailKey];
                                    delete newData[oldButtonKey];
                                    newData[newMailKey] = JSON.stringify(newMailData);

                                    // Move button with the mail region
                                    if (buttonData) {
                                        newData[newButtonKey] = JSON.stringify({
                                            ...buttonData,
                                            mailKey: newMailKey,
                                            x: newMailData.endX,
                                            y: newMailData.endY
                                        });
                                    }

                                    return newData;
                                });

                                // Update selected key to the new mail region
                                setSelectedMailKey(newMailKey);
                            } catch (e) {
                                // Invalid mail data, skip move
                            }
                        } else {
                            // Check if we have an active selection to move
                            if (engine.selectionStart && engine.selectionEnd) {
                                // Move all characters in selection bounds
                                const minX = Math.floor(Math.min(engine.selectionStart.x, engine.selectionEnd.x));
                                const maxX = Math.floor(Math.max(engine.selectionStart.x, engine.selectionEnd.x));
                                const minY = Math.floor(Math.min(engine.selectionStart.y, engine.selectionEnd.y));
                                const maxY = Math.floor(Math.max(engine.selectionStart.y, engine.selectionEnd.y));

                                const capturedChars: Array<{x: number, y: number, char: string}> = [];

                                // Iterate through all cells in selection bounds
                                for (let y = minY; y <= maxY; y++) {
                                    for (let x = minX; x <= maxX; x++) {
                                        const key = `${x},${y}`;
                                        const data = engine.worldData[key];
                                        if (data && !engine.isImageData(data)) {
                                            const char = engine.getCharacter(data);
                                            if (char) {
                                                capturedChars.push({ x, y, char });
                                            }
                                        }
                                    }
                                }

                                if (capturedChars.length > 0) {
                                    const moves = capturedChars.map(({ x, y, char }) => ({
                                        fromX: x,
                                        fromY: y,
                                        toX: x + distanceX,
                                        toY: y + distanceY,
                                        char
                                    }));

                                    engine.batchMoveCharacters(moves);

                                    // Clear selection after successful move by clicking at the new position
                                    const rect = canvasRef.current?.getBoundingClientRect();
                                    if (rect) {
                                        const newCenterScreenPos = engine.worldToScreen(
                                            minX + distanceX,
                                            minY + distanceY,
                                            engine.zoomLevel,
                                            engine.viewOffset
                                        );
                                        engine.handleCanvasClick(newCenterScreenPos.x, newCenterScreenPos.y, true, false, false, false);
                                    }
                                }
                            } else {
                                // No selection - use text block detection (original behavior)
                                const textBlock = findTextBlock(shiftDragStartPos, engine.worldData, engine);

                                if (textBlock.length > 0) {
                                    const capturedChars: Array<{x: number, y: number, char: string}> = [];

                                    for (const pos of textBlock) {
                                        const key = `${pos.x},${pos.y}`;
                                        const data = engine.worldData[key];
                                        if (data) {
                                            const char = engine.isImageData(data) ? '' : engine.getCharacter(data);
                                            if (char) {
                                                capturedChars.push({ x: pos.x, y: pos.y, char });
                                            }
                                        }
                                    }

                                    if (capturedChars.length > 0) {
                                        const moves = capturedChars.map(({ x, y, char }) => ({
                                            fromX: x,
                                            fromY: y,
                                            toX: x + distanceX,
                                            toY: y + distanceY,
                                            char
                                        }));

                                        engine.batchMoveCharacters(moves);
                                    }
                                }
                            }
                        }
                    }
                }
                
                // Clear shift drag state
                setShiftDragStartPos(null);
            } else if (isSelectingMouseDownRef.current) {
                // Regular selection end (only if not shift+dragging)
                isSelectingMouseDownRef.current = false;
                if (!shiftDragStartPos) {
                    engine.handleSelectionEnd();
                }
            }
        }
    }, [engine, shiftDragStartPos, findTextBlock, findImageAtPosition, resizeState]);

    const handleCanvasMouseLeave = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        // Clear hover position when mouse leaves canvas
        setMouseWorldPos(null);

        // End panning if mouse leaves canvas
        if (isMiddleMouseDownRef.current) {
            isMiddleMouseDownRef.current = false;
            engine.handlePanEnd(intermediatePanOffsetRef.current);
            panStartInfoRef.current = null;
            if (canvasRef.current) canvasRef.current.style.cursor = 'text';
        }

        // End selection if mouse leaves canvas during selection drag
        if (isSelectingMouseDownRef.current) { // Use the ref tracking mouse down state
             isSelectingMouseDownRef.current = false; // Stop tracking internally
             engine.handleSelectionEnd(); // Finalize selection in engine
        }
    }, [engine]);

    // Touch interaction state
    const touchStartRef = useRef<{ touches: Array<{ id: number; x: number; y: number }> } | null>(null);
    const lastPinchDistanceRef = useRef<number | null>(null);
    const isTouchPanningRef = useRef<boolean>(false);
    const isTouchSelectingRef = useRef<boolean>(false);
    const touchHasMovedRef = useRef<boolean>(false);

    // Double-tap and triple-tap detection state
    const lastTapTimeRef = useRef<number>(0);
    const lastTapPosRef = useRef<{ x: number; y: number } | null>(null);
    const tapCountRef = useRef<number>(0);
    const DOUBLE_TAP_THRESHOLD = 300; // ms - time window for double-tap
    const TRIPLE_TAP_THRESHOLD = 400; // ms - time window for triple-tap
    const DOUBLE_TAP_DISTANCE = 30; // px - max distance between taps
    const isDoubleTapModeRef = useRef<boolean>(false);

    // Long press detection for command menu and move operations
    const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
    const LONG_PRESS_DURATION = 500; // ms
    const commandMenuJustOpenedRef = useRef<boolean>(false); // Prevent immediate command selection after long press
    const longPressActivatedRef = useRef<boolean>(false); // Track if long press activated (for move vs command menu)
    const touchMoveStartPosRef = useRef<Point | null>(null); // Starting world position for move operation
    const MOVE_THRESHOLD = 10; // px - movement threshold to trigger move instead of command menu

    const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const touches = Array.from(e.touches).map(touch => ({
            id: touch.identifier,
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top,
            clientX: touch.clientX,
            clientY: touch.clientY
        }));

        touchStartRef.current = { touches };
        touchHasMovedRef.current = false;

        // Clear the command menu just opened flag on new touch
        commandMenuJustOpenedRef.current = false;
        longPressActivatedRef.current = false;
        touchMoveStartPosRef.current = null;

        if (touches.length === 2) {
            // Two-finger gesture - prepare for pan or pinch
            e.preventDefault();
            isTouchPanningRef.current = true;
            const centerClientX = (touches[0].clientX + touches[1].clientX) / 2;
            const centerClientY = (touches[0].clientY + touches[1].clientY) / 2;
            const info = engine.handlePanStart(centerClientX, centerClientY);
            panStartInfoRef.current = info;
            intermediatePanOffsetRef.current = { ...engine.viewOffset };
            panStartPosRef.current = { ...engine.viewOffset }; // Track starting position for distance
            setIsPanning(true);
            setPanDistance(0);
            lastPanMilestoneRef.current = 0; // Reset milestone tracker

            // Calculate initial pinch distance
            const dx = touches[1].x - touches[0].x;
            const dy = touches[1].y - touches[0].y;
            lastPinchDistanceRef.current = Math.sqrt(dx * dx + dy * dy);
        } else if (touches.length === 1) {
            // Single touch - detect double-tap/triple-tap or prepare for pan
            const now = Date.now();
            const currentPos = { x: touches[0].x, y: touches[0].y };

            // Check if this is a sequential tap (within time and distance threshold)
            const timeSinceLastTap = now - lastTapTimeRef.current;
            const isSequentialTap = lastTapPosRef.current &&
                timeSinceLastTap < TRIPLE_TAP_THRESHOLD &&
                Math.sqrt(
                    Math.pow(currentPos.x - lastTapPosRef.current.x, 2) +
                    Math.pow(currentPos.y - lastTapPosRef.current.y, 2)
                ) < DOUBLE_TAP_DISTANCE;

            // Update tap count
            if (isSequentialTap) {
                tapCountRef.current += 1;
            } else {
                tapCountRef.current = 1;
            }

            const isDoubleTap = tapCountRef.current === 2 && timeSinceLastTap < DOUBLE_TAP_THRESHOLD;
            const isTripleTap = tapCountRef.current === 3;

            if (isTripleTap) {
                // Triple-tap detected - acts as ESC key
                e.preventDefault();

                // Reset tap count
                tapCountRef.current = 0;

                // Simulate ESC key press
                engine.handleKeyDown('Escape', false, false, false, false);

                return;
            } else if (isDoubleTap) {
                // Double-tap detected
                e.preventDefault(); // Prevent iOS Safari double-tap-to-zoom

                // If command menu is active, dismiss it (mobile alternative to ESC key)
                if (engine.commandState.isActive) {
                    // Dismiss command menu by simulating ESC key press through engine
                    engine.handleKeyDown('Escape', false, false, false, false);
                    // Don't enter selection mode, just dismiss the menu
                } else {
                    // Normal double-tap behavior - enter selection/click mode
                    isDoubleTapModeRef.current = true;
                    isTouchSelectingRef.current = true;
                }
            }

            // Check for resize thumb touches (highest priority - before pan setup)
            // This must happen before pan is initialized to prevent pan interference
            const x = touches[0].x;
            const y = touches[0].y;
            const thumbSize = 8;
            const thumbHitArea = thumbSize + 10; // Larger hit area for touch (18px total)

            const isWithinThumb = (px: number, py: number, tx: number, ty: number): boolean => {
                return Math.abs(px - tx) <= thumbHitArea / 2 && Math.abs(py - ty) <= thumbHitArea / 2;
            };

            // Check image resize handles
            if (selectedImageKey) {
                const selectedImageData = engine.worldData[selectedImageKey];
                if (engine.isImageData(selectedImageData)) {
                    const topLeftScreen = engine.worldToScreen(selectedImageData.startX, selectedImageData.startY, engine.zoomLevel, engine.viewOffset);
                    const bottomRightScreen = engine.worldToScreen(selectedImageData.endX + 1, selectedImageData.endY + 1, engine.zoomLevel, engine.viewOffset);

                    const left = topLeftScreen.x;
                    const right = bottomRightScreen.x;
                    const top = topLeftScreen.y;
                    const bottom = bottomRightScreen.y;

                    let handle: ResizeHandle | null = null;
                    if (isWithinThumb(x, y, left, top)) handle = 'top-left';
                    else if (isWithinThumb(x, y, right, top)) handle = 'top-right';
                    else if (isWithinThumb(x, y, right, bottom)) handle = 'bottom-right';
                    else if (isWithinThumb(x, y, left, bottom)) handle = 'bottom-left';

                    if (handle) {
                        setResizeState({
                            active: true,
                            type: 'image',
                            key: selectedImageKey,
                            handle,
                            originalBounds: {
                                startX: selectedImageData.startX,
                                startY: selectedImageData.startY,
                                endX: selectedImageData.endX,
                                endY: selectedImageData.endY
                            },
                            roomIndex: null
                        });
                        return; // Early return - don't process other touch events
                    }
                }
            }

            // Check note resize handles
            if (selectedNoteKey) {
                try {
                    const selectedNoteData = JSON.parse(engine.worldData[selectedNoteKey] as string);
                    const topLeftScreen = engine.worldToScreen(selectedNoteData.startX, selectedNoteData.startY, engine.zoomLevel, engine.viewOffset);
                    const bottomRightScreen = engine.worldToScreen(selectedNoteData.endX + 1, selectedNoteData.endY + 1, engine.zoomLevel, engine.viewOffset);

                    const left = topLeftScreen.x;
                    const right = bottomRightScreen.x;
                    const top = topLeftScreen.y;
                    const bottom = bottomRightScreen.y;

                    let handle: ResizeHandle | null = null;
                    if (isWithinThumb(x, y, left, top)) handle = 'top-left';
                    else if (isWithinThumb(x, y, right, top)) handle = 'top-right';
                    else if (isWithinThumb(x, y, right, bottom)) handle = 'bottom-right';
                    else if (isWithinThumb(x, y, left, bottom)) handle = 'bottom-left';

                    if (handle) {
                        setResizeState({
                            active: true,
                            type: 'note',
                            key: selectedNoteKey,
                            handle,
                            originalBounds: {
                                startX: selectedNoteData.startX,
                                startY: selectedNoteData.startY,
                                endX: selectedNoteData.endX,
                                endY: selectedNoteData.endY
                            },
                            roomIndex: null
                        });
                        return; // Early return - don't process other touch events
                    }
                } catch (e) {
                    // Skip invalid note data
                }
            }

            // Check pattern room resize handles (check rooms first, they're inside the pattern)
            if (selectedPatternKey) {
                try {
                    const patternData = JSON.parse(engine.worldData[selectedPatternKey] as string);
                    const { centerX, centerY, width = 120, height = 60, rooms = [] } = patternData;

                    // Check individual room corners first (larger hit area for touch)
                    const roomThumbHitArea = 14; // 6px thumb + 8px padding for touch
                    for (let roomIndex = 0; roomIndex < rooms.length; roomIndex++) {
                        const room = rooms[roomIndex];
                        const roomTopLeft = engine.worldToScreen(room.x, room.y, engine.zoomLevel, engine.viewOffset);
                        const roomBottomRight = engine.worldToScreen(room.x + room.width, room.y + room.height, engine.zoomLevel, engine.viewOffset);

                        const roomLeft = roomTopLeft.x;
                        const roomRight = roomBottomRight.x;
                        const roomTop = roomTopLeft.y;
                        const roomBottom = roomBottomRight.y;

                        // Check if tapping on any room corner thumb
                        let handle: ResizeHandle | null = null;
                        if (Math.abs(x - roomLeft) <= roomThumbHitArea / 2 && Math.abs(y - roomTop) <= roomThumbHitArea / 2) handle = 'top-left';
                        else if (Math.abs(x - roomRight) <= roomThumbHitArea / 2 && Math.abs(y - roomTop) <= roomThumbHitArea / 2) handle = 'top-right';
                        else if (Math.abs(x - roomRight) <= roomThumbHitArea / 2 && Math.abs(y - roomBottom) <= roomThumbHitArea / 2) handle = 'bottom-right';
                        else if (Math.abs(x - roomLeft) <= roomThumbHitArea / 2 && Math.abs(y - roomBottom) <= roomThumbHitArea / 2) handle = 'bottom-left';

                        if (handle) {
                            setResizeState({
                                active: true,
                                type: 'pattern',
                                key: selectedPatternKey,
                                handle,
                                originalBounds: {
                                    startX: room.x,
                                    startY: room.y,
                                    endX: room.x + room.width,
                                    endY: room.y + room.height
                                },
                                roomIndex: roomIndex
                            });
                            return; // Early return - don't process other touch events
                        }
                    }

                    // If no room thumb hit, check pattern boundary
                    // Convert center/dimensions to bounds
                    // width/height are spans (maxCoord - minCoord)
                    const startX = Math.floor(centerX - width / 2);
                    const startY = Math.floor(centerY - height / 2);
                    const endX = startX + width;
                    const endY = startY + height;

                    const topLeftScreen = engine.worldToScreen(startX, startY, engine.zoomLevel, engine.viewOffset);
                    const bottomRightScreen = engine.worldToScreen(endX, endY, engine.zoomLevel, engine.viewOffset);

                    const left = topLeftScreen.x;
                    const right = bottomRightScreen.x;
                    const top = topLeftScreen.y;
                    const bottom = bottomRightScreen.y;

                    let handle: ResizeHandle | null = null;
                    if (isWithinThumb(x, y, left, top)) handle = 'top-left';
                    else if (isWithinThumb(x, y, right, top)) handle = 'top-right';
                    else if (isWithinThumb(x, y, right, bottom)) handle = 'bottom-right';
                    else if (isWithinThumb(x, y, left, bottom)) handle = 'bottom-left';

                    if (handle) {
                        setResizeState({
                            active: true,
                            type: 'pattern',
                            key: selectedPatternKey,
                            handle,
                            originalBounds: {
                                startX,
                                startY,
                                endX,
                                endY
                            },
                            roomIndex: null // null means resizing pattern boundary
                        });
                        return; // Early return - don't process other touch events
                    }
                } catch (e) {
                    // Skip invalid pattern data
                }
            }

            // If no double-tap and no resize handle, prepare for pan (single tap primary gesture)
            if (!isDoubleTap) {
                isDoubleTapModeRef.current = false;
                isTouchPanningRef.current = true;
                const info = engine.handlePanStart(touches[0].clientX, touches[0].clientY);
                panStartInfoRef.current = info;
                intermediatePanOffsetRef.current = { ...engine.viewOffset };
                panStartPosRef.current = { ...engine.viewOffset };
                setIsPanning(true);
                setPanDistance(0);
                lastPanMilestoneRef.current = 0;
            }

            // Update last tap tracking
            lastTapTimeRef.current = now;
            lastTapPosRef.current = currentPos;

            // Long press detection for move operations and command menu
            // Clear any existing timer
            if (longPressTimerRef.current) {
                clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
            }

            const worldPos = engine.screenToWorld(touches[0].x, touches[0].y, engine.zoomLevel, engine.viewOffset);
            const touchWorldX = Math.floor(worldPos.x);
            const touchWorldY = Math.floor(worldPos.y);
            const touchWorldPos = { x: touchWorldX, y: touchWorldY };

            // Check if touch is over a moveable object (selection, image, note, iframe, mail)
            let isOverMoveableObject = false;
            let foundNoteKey: string | null = null;
            let foundIframeKey: string | null = null;
            let foundMailKey: string | null = null;

            // Check for active selection
            if (engine.selectionStart && engine.selectionEnd) {
                const minX = Math.floor(Math.min(engine.selectionStart.x, engine.selectionEnd.x));
                const maxX = Math.floor(Math.max(engine.selectionStart.x, engine.selectionEnd.x));
                const minY = Math.floor(Math.min(engine.selectionStart.y, engine.selectionEnd.y));
                const maxY = Math.floor(Math.max(engine.selectionStart.y, engine.selectionEnd.y));

                if (touchWorldX >= minX && touchWorldX <= maxX &&
                    touchWorldY >= minY && touchWorldY <= maxY) {
                    isOverMoveableObject = true;
                }
            }

            // Check for images
            if (!isOverMoveableObject && findImageAtPosition(touchWorldPos)) {
                isOverMoveableObject = true;
            }

            // Check for ANY note at this position (not just selected one)
            if (!isOverMoveableObject) {
                for (const key in engine.worldData) {
                    if (key.startsWith('note_')) {
                        try {
                            const noteData = JSON.parse(engine.worldData[key] as string);
                            if (touchWorldX >= noteData.startX && touchWorldX <= noteData.endX &&
                                touchWorldY >= noteData.startY && touchWorldY <= noteData.endY) {
                                isOverMoveableObject = true;
                                foundNoteKey = key;
                                break;
                            }
                        } catch (e) {
                            // Invalid note data
                        }
                    }
                }
            }

            // Check for ANY iframe at this position
            if (!isOverMoveableObject) {
                for (const key in engine.worldData) {
                    if (key.startsWith('iframe_')) {
                        try {
                            const iframeData = JSON.parse(engine.worldData[key] as string);
                            if (touchWorldX >= iframeData.startX && touchWorldX <= iframeData.endX &&
                                touchWorldY >= iframeData.startY && touchWorldY <= iframeData.endY) {
                                isOverMoveableObject = true;
                                foundIframeKey = key;
                                break;
                            }
                        } catch (e) {
                            // Invalid iframe data
                        }
                    }
                }
            }

            // Check for ANY mail at this position
            if (!isOverMoveableObject) {
                for (const key in engine.worldData) {
                    if (key.startsWith('mail_')) {
                        try {
                            const mailData = JSON.parse(engine.worldData[key] as string);
                            if (touchWorldX >= mailData.startX && touchWorldX <= mailData.endX &&
                                touchWorldY >= mailData.startY && touchWorldY <= mailData.endY) {
                                isOverMoveableObject = true;
                                foundMailKey = key;
                                break;
                            }
                        } catch (e) {
                            // Invalid mail data
                        }
                    }
                }
            }

            // If touch is over a moveable object, start long press timer
            if (isOverMoveableObject) {
                longPressTimerRef.current = setTimeout(() => {
                    // Auto-select the object under the touch
                    if (foundNoteKey) {
                        setSelectedNoteKey(foundNoteKey);
                        setSelectedIframeKey(null);
                        setSelectedMailKey(null);
                        setSelectedPatternKey(null);
                    } else if (foundIframeKey) {
                        setSelectedIframeKey(foundIframeKey);
                        setSelectedNoteKey(null);
                        setSelectedMailKey(null);
                        setSelectedPatternKey(null);
                    } else if (foundMailKey) {
                        setSelectedMailKey(foundMailKey);
                        setSelectedNoteKey(null);
                        setSelectedIframeKey(null);
                        setSelectedPatternKey(null);
                    }

                    // Activate long press mode (ready to move or open command menu)
                    longPressActivatedRef.current = true;
                    touchMoveStartPosRef.current = touchWorldPos;

                    // Cancel panning since we're in long press mode
                    isTouchPanningRef.current = false;
                    panStartInfoRef.current = null;
                    setIsPanning(false);

                    // Haptic feedback if available
                    if ('vibrate' in navigator) {
                        navigator.vibrate(50);
                    }
                }, LONG_PRESS_DURATION);
            }
        }

        canvasRef.current?.focus();
    }, [engine, findImageAtPosition]);

    const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const touches = Array.from(e.touches).map(touch => ({
            id: touch.identifier,
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top,
            clientX: touch.clientX,
            clientY: touch.clientY
        }));

        // Cancel long press timer on any movement (before timer fires)
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }

        // Handle resize drag (highest priority)
        if (resizeState.active && resizeState.handle && resizeState.originalBounds && touches.length === 1) {
            const x = touches[0].x;
            const y = touches[0].y;
            const worldPos = engine.screenToWorld(x, y, engine.zoomLevel, engine.viewOffset);
            const snappedX = Math.floor(worldPos.x);
            const snappedY = Math.floor(worldPos.y);

            const { originalBounds, handle } = resizeState;
            let newBounds = { ...originalBounds };

            // Update bounds based on which corner handle is being dragged
            switch (handle) {
                case 'top-left':
                    newBounds.startX = Math.min(snappedX, originalBounds.endX - 1);
                    newBounds.startY = Math.min(snappedY, originalBounds.endY - 1);
                    break;
                case 'top-right':
                    newBounds.endX = Math.max(snappedX, originalBounds.startX + 1);
                    newBounds.startY = Math.min(snappedY, originalBounds.endY - 1);
                    break;
                case 'bottom-right':
                    newBounds.endX = Math.max(snappedX, originalBounds.startX + 1);
                    newBounds.endY = Math.max(snappedY, originalBounds.startY + 1);
                    break;
                case 'bottom-left':
                    newBounds.startX = Math.min(snappedX, originalBounds.endX - 1);
                    newBounds.endY = Math.max(snappedY, originalBounds.startY + 1);
                    break;
            }

            // Apply the resize to the appropriate object type
            if (resizeState.type === 'image' && resizeState.key) {
                const imageData = engine.worldData[resizeState.key];
                if (engine.isImageData(imageData)) {
                    engine.setWorldData(prev => ({
                        ...prev,
                        [resizeState.key!]: {
                            ...imageData,
                            startX: newBounds.startX,
                            startY: newBounds.startY,
                            endX: newBounds.endX,
                            endY: newBounds.endY
                        }
                    }));
                }
            } else if (resizeState.type === 'note' && resizeState.key) {
                try {
                    const noteData = JSON.parse(engine.worldData[resizeState.key] as string);

                    // Update the note
                    const updatedNoteData = {
                        ...noteData,
                        startX: newBounds.startX,
                        startY: newBounds.startY,
                        endX: newBounds.endX,
                        endY: newBounds.endY
                    };

                    // If this note is part of a pattern, recalculate pattern boundary
                    if (noteData.patternKey) {
                        try {
                            const patternData = JSON.parse(engine.worldData[noteData.patternKey] as string);
                            const noteKeys = patternData.noteKeys || [];

                            // Calculate boundary from all notes in pattern
                            const corridorPadding = 3;
                            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

                            for (const noteKey of noteKeys) {
                                try {
                                    // Use updated data for the note being resized, otherwise fetch from worldData
                                    const currentNoteData = noteKey === resizeState.key
                                        ? updatedNoteData
                                        : JSON.parse(engine.worldData[noteKey] as string);

                                    const noteMinX = currentNoteData.startX;
                                    const noteMinY = currentNoteData.startY;
                                    // endX/endY are inclusive, add 1 to get exclusive boundary (like legacy rooms)
                                    const noteMaxX = currentNoteData.endX + 1;
                                    const noteMaxY = currentNoteData.endY + 1;
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

                            // Update both note and pattern
                            engine.setWorldData(prev => ({
                                ...prev,
                                [resizeState.key!]: JSON.stringify(updatedNoteData),
                                [noteData.patternKey]: JSON.stringify({
                                    ...patternData,
                                    centerX: actualCenterX,
                                    centerY: actualCenterY,
                                    width: actualWidth,
                                    height: actualHeight
                                })
                            }));
                        } catch (e) {
                            // Pattern data invalid, just update note
                            engine.setWorldData(prev => ({
                                ...prev,
                                [resizeState.key!]: JSON.stringify(updatedNoteData)
                            }));
                        }
                    } else {
                        // Note not part of pattern, just update note
                        engine.setWorldData(prev => ({
                            ...prev,
                            [resizeState.key!]: JSON.stringify(updatedNoteData)
                        }));
                    }
                } catch (e) {
                    // Invalid note data
                }
            } else if (resizeState.type === 'iframe' && resizeState.key) {
                try {
                    const iframeData = JSON.parse(engine.worldData[resizeState.key] as string);
                    engine.setWorldData(prev => ({
                        ...prev,
                        [resizeState.key!]: JSON.stringify({
                            ...iframeData,
                            startX: newBounds.startX,
                            startY: newBounds.startY,
                            endX: newBounds.endX,
                            endY: newBounds.endY
                        })
                    }));
                } catch (e) {
                    // Invalid iframe data
                }
            } else if (resizeState.type === 'mail' && resizeState.key) {
                try {
                    const mailData = JSON.parse(engine.worldData[resizeState.key] as string);
                    const buttonKey = `mailbutton_${resizeState.key}`;
                    const buttonData = engine.worldData[buttonKey] ? JSON.parse(engine.worldData[buttonKey] as string) : null;

                    engine.setWorldData(prev => {
                        const updated = {
                            ...prev,
                            [resizeState.key!]: JSON.stringify({
                                ...mailData,
                                startX: newBounds.startX,
                                startY: newBounds.startY,
                                endX: newBounds.endX,
                                endY: newBounds.endY
                            })
                        };

                        // Update button position to stay at bottom-right corner
                        if (buttonData) {
                            updated[buttonKey] = JSON.stringify({
                                ...buttonData,
                                x: newBounds.endX,
                                y: newBounds.endY
                            });
                        }

                        return updated;
                    });
                } catch (e) {
                    // Invalid mail data
                }
            } else if (resizeState.type === 'pattern' && resizeState.key) {
                try {
                    const patternData = JSON.parse(engine.worldData[resizeState.key] as string);

                    if (resizeState.roomIndex !== null && resizeState.roomIndex !== undefined) {
                        // Resizing a specific room
                        const rooms = patternData.rooms || [];

                        // Bounds check for safety
                        if (resizeState.roomIndex < 0 || resizeState.roomIndex >= rooms.length) {
                            return;
                        }

                        const updatedRooms = [...rooms];

                        // Update the specific room
                        updatedRooms[resizeState.roomIndex] = {
                            x: newBounds.startX,
                            y: newBounds.startY,
                            width: newBounds.endX - newBounds.startX,
                            height: newBounds.endY - newBounds.startY
                        };

                        // Recalculate pattern boundary to enclose all rooms + corridors
                        const corridorPadding = 3;
                        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

                        for (const room of updatedRooms) {
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

                        engine.setWorldData(prev => ({
                            ...prev,
                            [resizeState.key!]: JSON.stringify({
                                ...patternData,
                                centerX: actualCenterX,
                                centerY: actualCenterY,
                                width: actualWidth,
                                height: actualHeight,
                                rooms: updatedRooms
                            })
                        }));
                    }
                } catch (e) {
                    // Invalid pattern data
                }
            }

            return; // Don't process other touch move events during resize
        }

        // If long press is activated, we're in move mode - don't do pan/zoom/selection
        // Just track that movement occurred for touch end
        if (longPressActivatedRef.current && touches.length === 1) {
            touchHasMovedRef.current = true;
            return; // Don't process other gestures while in move mode
        }

        if (touches.length === 2 && isTouchPanningRef.current && panStartInfoRef.current) {
            e.preventDefault();

            // Two-finger pan - use clientX/clientY for absolute viewport coordinates
            const centerClientX = (touches[0].clientX + touches[1].clientX) / 2;
            const centerClientY = (touches[0].clientY + touches[1].clientY) / 2;
            const newOffset = engine.handlePanMove(centerClientX, centerClientY, panStartInfoRef.current);
            intermediatePanOffsetRef.current = newOffset;

            // Calculate pan distance (for display only)
            if (panStartPosRef.current) {
                const dx = newOffset.x - panStartPosRef.current.x;
                const dy = newOffset.y - panStartPosRef.current.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const roundedDistance = Math.round(distance);
                setPanDistance(roundedDistance);
            }

            // Pinch-to-zoom - use canvas-relative coordinates
            const dx = touches[1].x - touches[0].x;
            const dy = touches[1].y - touches[0].y;
            const currentDistance = Math.sqrt(dx * dx + dy * dy);

            if (lastPinchDistanceRef.current) {
                const scale = currentDistance / lastPinchDistanceRef.current;
                const delta = (scale - 1) * 100; // Convert to wheel delta equivalent

                // Use canvas-relative center point for zoom
                const centerX = (touches[0].x + touches[1].x) / 2;
                const centerY = (touches[0].y + touches[1].y) / 2;
                engine.handleCanvasWheel(0, -delta, centerX, centerY, true);
            }

            lastPinchDistanceRef.current = currentDistance;
        } else if (touches.length === 1 && isTouchPanningRef.current && !isDoubleTapModeRef.current && panStartInfoRef.current) {
            // Single-finger pan (primary gesture)
            e.preventDefault();

            const newOffset = engine.handlePanMove(touches[0].clientX, touches[0].clientY, panStartInfoRef.current);
            intermediatePanOffsetRef.current = newOffset;

            // Calculate pan distance (for display only)
            if (panStartPosRef.current) {
                const dx = newOffset.x - panStartPosRef.current.x;
                const dy = newOffset.y - panStartPosRef.current.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const roundedDistance = Math.round(distance);
                setPanDistance(roundedDistance);
            }

            // Mark as moved to prevent double-tap from triggering click
            if (!touchHasMovedRef.current) {
                const startTouch = touchStartRef.current?.touches[0];
                if (startTouch) {
                    const dx = touches[0].x - startTouch.x;
                    const dy = touches[0].y - startTouch.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance > 5) {
                        touchHasMovedRef.current = true;
                    }
                }
            }
        } else if (touches.length === 1 && isTouchSelectingRef.current && isDoubleTapModeRef.current && touchStartRef.current) {
            // Double-tap drag for selection
            const startTouch = touchStartRef.current.touches[0];
            const dx = touches[0].x - startTouch.x;
            const dy = touches[0].y - startTouch.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Only start selection if moved more than 5px
            if (!touchHasMovedRef.current && distance > 5) {
                touchHasMovedRef.current = true;
                engine.handleSelectionStart(startTouch.x, startTouch.y);
            }

            // Continue selection if already started
            if (touchHasMovedRef.current) {
                engine.handleSelectionMove(touches[0].x, touches[0].y);

                // Update mouse world position for preview
                const worldPos = engine.screenToWorld(touches[0].x, touches[0].y, engine.zoomLevel, engine.viewOffset);
                setMouseWorldPos({
                    x: Math.floor(worldPos.x),
                    y: Math.floor(worldPos.y)
                });
            }
        }
    }, [engine]);

    const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        // Cancel long press timer on touch end
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }

        // Reset resize state if active
        if (resizeState.active) {
            setResizeState({
                active: false,
                type: null,
                key: null,
                handle: null,
                originalBounds: null,
                roomIndex: null
            });
            return; // Early return after resize complete
        }

        // Handle long press activated mode (move operation or command menu)
        if (longPressActivatedRef.current && touchMoveStartPosRef.current) {
            const endTouches = Array.from(e.changedTouches);

            if (endTouches.length > 0) {
                const endTouch = endTouches[0];
                const endWorldPos = engine.screenToWorld(
                    endTouch.clientX - rect.left,
                    endTouch.clientY - rect.top,
                    engine.zoomLevel,
                    engine.viewOffset
                );
                const endPos = {
                    x: Math.floor(endWorldPos.x),
                    y: Math.floor(endWorldPos.y)
                };

                // Calculate distance vector
                const distanceX = endPos.x - touchMoveStartPosRef.current.x;
                const distanceY = endPos.y - touchMoveStartPosRef.current.y;

                // Check if user dragged (movement beyond threshold)
                if (touchHasMovedRef.current && (distanceX !== 0 || distanceY !== 0)) {
                    // Execute move operation
                    const imageAtPosition = findImageAtPosition(touchMoveStartPosRef.current);

                    if (imageAtPosition) {
                        // Find and move persisted image
                        let imageKey = null;
                        for (const key in engine.worldData) {
                            if (key.startsWith('image_')) {
                                const data = engine.worldData[key];
                                if (engine.isImageData(data) && data === imageAtPosition) {
                                    imageKey = key;
                                    break;
                                }
                            }
                        }

                        if (imageKey) {
                            engine.moveImage(imageKey, distanceX, distanceY);
                        }
                    } else if (selectedNoteKey) {
                        // Move note
                        try {
                            const noteData = JSON.parse(engine.worldData[selectedNoteKey] as string);
                            const newNoteData = {
                                startX: noteData.startX + distanceX,
                                endX: noteData.endX + distanceX,
                                startY: noteData.startY + distanceY,
                                endY: noteData.endY + distanceY,
                                timestamp: Date.now(),
                                ...(noteData.patternKey && { patternKey: noteData.patternKey }),
                                ...(noteData.style && { style: noteData.style })
                            };

                            const newNoteKey = `note_${newNoteData.startX},${newNoteData.startY}_${Date.now()}`;
                            engine.setWorldData(prev => {
                                const newData = { ...prev };
                                delete newData[selectedNoteKey];
                                newData[newNoteKey] = JSON.stringify(newNoteData);

                                // If note is part of a pattern, update pattern's noteKeys array and recalculate boundary
                                if (noteData.patternKey) {
                                    try {
                                        const patternData = JSON.parse(newData[noteData.patternKey] as string);
                                        const noteKeys = patternData.noteKeys || [];

                                        // Replace old note key with new note key
                                        const updatedNoteKeys = noteKeys.map((key: string) =>
                                            key === selectedNoteKey ? newNoteKey : key
                                        );

                                        // Recalculate pattern boundary from all notes
                                        const corridorPadding = 3;
                                        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

                                        for (const noteKey of updatedNoteKeys) {
                                            try {
                                                const currentNoteData = JSON.parse(newData[noteKey] as string);
                                                const noteMinX = currentNoteData.startX;
                                                const noteMinY = currentNoteData.startY;
                                                // endX/endY are inclusive, add 1 to get exclusive boundary
                                                const noteMaxX = currentNoteData.endX + 1;
                                                const noteMaxY = currentNoteData.endY + 1;
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

                                        // Update pattern with new noteKeys and boundary
                                        newData[noteData.patternKey] = JSON.stringify({
                                            ...patternData,
                                            noteKeys: updatedNoteKeys,
                                            centerX: actualCenterX,
                                            centerY: actualCenterY,
                                            width: actualWidth,
                                            height: actualHeight
                                        });
                                    } catch (e) {
                                        // Pattern update failed, but note move still succeeds
                                    }
                                }

                                return newData;
                            });

                            setSelectedNoteKey(newNoteKey);
                        } catch (e) {
                            // Invalid note data
                        }
                    } else if (selectedIframeKey) {
                        // Move iframe
                        try {
                            const iframeData = JSON.parse(engine.worldData[selectedIframeKey] as string);
                            const newIframeData = {
                                startX: iframeData.startX + distanceX,
                                endX: iframeData.endX + distanceX,
                                startY: iframeData.startY + distanceY,
                                endY: iframeData.endY + distanceY,
                                url: iframeData.url,
                                timestamp: Date.now()
                            };

                            const newIframeKey = `iframe_${newIframeData.startX},${newIframeData.startY}_${Date.now()}`;
                            engine.setWorldData(prev => {
                                const newData = { ...prev };
                                delete newData[selectedIframeKey];
                                newData[newIframeKey] = JSON.stringify(newIframeData);
                                return newData;
                            });

                            setSelectedIframeKey(newIframeKey);
                        } catch (e) {
                            // Invalid iframe data
                        }
                    } else if (selectedMailKey) {
                        // Move mail
                        try {
                            const mailData = JSON.parse(engine.worldData[selectedMailKey] as string);
                            const oldButtonKey = `mailbutton_${selectedMailKey}`;
                            const buttonData = engine.worldData[oldButtonKey] ? JSON.parse(engine.worldData[oldButtonKey] as string) : null;

                            const newMailData = {
                                startX: mailData.startX + distanceX,
                                endX: mailData.endX + distanceX,
                                startY: mailData.startY + distanceY,
                                endY: mailData.endY + distanceY,
                                timestamp: Date.now()
                            };

                            const newMailKey = `mail_${newMailData.startX},${newMailData.startY}_${Date.now()}`;
                            const newButtonKey = `mailbutton_${newMailKey}`;

                            engine.setWorldData(prev => {
                                const newData = { ...prev };
                                delete newData[selectedMailKey];
                                delete newData[oldButtonKey];
                                newData[newMailKey] = JSON.stringify(newMailData);

                                if (buttonData) {
                                    newData[newButtonKey] = JSON.stringify({
                                        ...buttonData,
                                        mailKey: newMailKey,
                                        x: newMailData.endX,
                                        y: newMailData.endY
                                    });
                                }

                                return newData;
                            });

                            setSelectedMailKey(newMailKey);
                        } catch (e) {
                            // Invalid mail data
                        }
                    } else if (engine.selectionStart && engine.selectionEnd) {
                        // Move text selection
                        const minX = Math.floor(Math.min(engine.selectionStart.x, engine.selectionEnd.x));
                        const maxX = Math.floor(Math.max(engine.selectionStart.x, engine.selectionEnd.x));
                        const minY = Math.floor(Math.min(engine.selectionStart.y, engine.selectionEnd.y));
                        const maxY = Math.floor(Math.max(engine.selectionStart.y, engine.selectionEnd.y));

                        const capturedChars: Array<{x: number, y: number, char: string}> = [];

                        for (let y = minY; y <= maxY; y++) {
                            for (let x = minX; x <= maxX; x++) {
                                const key = `${x},${y}`;
                                const data = engine.worldData[key];
                                if (data && !engine.isImageData(data)) {
                                    const char = engine.getCharacter(data);
                                    if (char) {
                                        capturedChars.push({ x, y, char });
                                    }
                                }
                            }
                        }

                        if (capturedChars.length > 0) {
                            const moves = capturedChars.map(({ x, y, char }) => ({
                                fromX: x,
                                fromY: y,
                                toX: x + distanceX,
                                toY: y + distanceY,
                                char
                            }));

                            engine.batchMoveCharacters(moves);

                            // Clear selection after successful move by clicking at the new position
                            const newCenterScreenPos = engine.worldToScreen(
                                minX + distanceX,
                                minY + distanceY,
                                engine.zoomLevel,
                                engine.viewOffset
                            );
                            engine.handleCanvasClick(newCenterScreenPos.x, newCenterScreenPos.y, true, false, false, false);
                        }
                    }
                } else {
                    // No movement or minimal movement after long press
                    if (engine.selectionStart && engine.selectionEnd) {
                        // Selection: open command menu
                        e.preventDefault();

                        engine.commandSystem.startCommand(engine.cursorPos);
                        commandMenuJustOpenedRef.current = true;

                        // Focus hidden input to bring up keyboard (use setTimeout to ensure selection is preserved)
                        setTimeout(() => {
                            if (hiddenInputRef.current) {
                                hiddenInputRef.current.focus();
                            }
                        }, 10);
                    } else {
                        // Image/Note/Iframe/Mail: just focus keyboard for deletion via backspace
                        e.preventDefault();

                        // Focus hidden input to bring up keyboard
                        setTimeout(() => {
                            if (hiddenInputRef.current) {
                                hiddenInputRef.current.focus();
                            }
                        }, 10);
                    }
                }
            }

            // Clear long press flags
            longPressActivatedRef.current = false;
            touchMoveStartPosRef.current = null;
            touchStartRef.current = null;
            touchHasMovedRef.current = false;
            return; // Don't process other touch end events
        }

        if (isTouchPanningRef.current) {
            // End two-finger pan (or single-touch pan/tap)
            isTouchPanningRef.current = false;

            // If there's a selection and command menu is active, check if this was a tap on a command
            // This handles single taps on commands (which go through the pan path)
            const hasActiveSelection = engine.selectionStart !== null && engine.selectionEnd !== null;
            if (hasActiveSelection && engine.commandState.isActive && !touchHasMovedRef.current && !commandMenuJustOpenedRef.current && e.changedTouches.length === 1) {
                // Single tap with no movement while command menu is active - route through handleCanvasClick
                const endTouches = Array.from(e.changedTouches).map(touch => ({
                    x: touch.clientX - rect.left,
                    y: touch.clientY - rect.top
                }));

                if (endTouches.length > 0) {
                    // Create synthetic event for handleCanvasClick
                    const syntheticEvent = {
                        button: 0,
                        clientX: endTouches[0].x + rect.left,
                        clientY: endTouches[0].y + rect.top,
                        shiftKey: false,
                        preventDefault: () => {},
                        stopPropagation: () => {}
                    } as React.MouseEvent<HTMLCanvasElement>;
                    handleCanvasClick(syntheticEvent);

                    // Don't call handlePanEnd since we're treating this as a click
                    panStartInfoRef.current = null;
                    panStartPosRef.current = null;
                    lastPinchDistanceRef.current = null;
                    return;
                }
            }

            // Normal pan end
            engine.handlePanEnd(intermediatePanOffsetRef.current);
            panStartInfoRef.current = null;
            panStartPosRef.current = null;
            lastPinchDistanceRef.current = null;

            // Clear pan distance after a delay
            setTimeout(() => {
                setIsPanning(false);
                setPanDistance(0);
            }, 1000);
        } else if (isTouchSelectingRef.current) {
            // End single-touch selection
            isTouchSelectingRef.current = false;

            if (e.touches.length === 0) {
                // All touches ended - finalize selection or click
                if (touchHasMovedRef.current) {
                    // User dragged - finalize the selection
                    engine.handleSelectionEnd();
                } else if (touchStartRef.current && touchStartRef.current.touches.length === 1) {
                    // User tapped (didn't drag)
                    // If there's already an active selection, just focus the input to bring up keyboard
                    // Don't treat as click to avoid clearing the selection
                    const hasActiveSelection = engine.selectionStart !== null && engine.selectionEnd !== null;

                    if (hasActiveSelection) {
                        // Don't handle touch end if command menu was just opened
                        // This prevents accidental command selection when releasing after long press
                        if (commandMenuJustOpenedRef.current) {
                            return;
                        }

                        // If command menu is active, route through handleCanvasClick to detect command taps
                        // This allows clicking commands without clearing the selection
                        if (engine.commandState.isActive) {
                            const startTouch = touchStartRef.current.touches[0];
                            const endTouches = Array.from(e.changedTouches).map(touch => ({
                                x: touch.clientX - rect.left,
                                y: touch.clientY - rect.top
                            }));

                            if (endTouches.length > 0) {
                                // Create synthetic event for handleCanvasClick
                                const syntheticEvent = {
                                    button: 0,
                                    clientX: endTouches[0].x + rect.left,
                                    clientY: endTouches[0].y + rect.top,
                                    shiftKey: false,
                                    preventDefault: () => {},
                                    stopPropagation: () => {}
                                } as React.MouseEvent<HTMLCanvasElement>;
                                handleCanvasClick(syntheticEvent);
                            }
                        } else {
                            // No command menu - just focus the hidden input to trigger keyboard, preserve selection
                            if (hiddenInputRef.current) {
                                if (hostDialogue.isHostActive) {
                                    if (hostDialogue.isExpectingInput()) {
                                        hiddenInputRef.current.focus();
                                    }
                                } else {
                                    // Not in host mode - focus for regular typing
                                    hiddenInputRef.current.focus();
                                }
                            }
                        }
                    } else {
                        // Don't create click if command menu was just opened
                        // This prevents accidental command selection when releasing after long press
                        if (commandMenuJustOpenedRef.current) {
                            return;
                        }

                        // No selection - treat as regular click
                        const startTouch = touchStartRef.current.touches[0];
                        const endTouches = Array.from(e.changedTouches).map(touch => ({
                            x: touch.clientX - rect.left,
                            y: touch.clientY - rect.top
                        }));

                        if (endTouches.length > 0) {
                            // Create synthetic event for handleCanvasClick
                            const syntheticEvent = {
                                button: 0,
                                clientX: endTouches[0].x + rect.left,
                                clientY: endTouches[0].y + rect.top,
                                shiftKey: false,
                                preventDefault: () => {},
                                stopPropagation: () => {}
                            } as React.MouseEvent<HTMLCanvasElement>;
                            handleCanvasClick(syntheticEvent);

                            // Focus hidden input for iOS keyboard
                            if (hiddenInputRef.current) {
                                if (hostDialogue.isHostActive) {
                                    if (hostDialogue.isExpectingInput()) {
                                        hiddenInputRef.current.focus();
                                    }
                                } else {
                                    // Not in host mode - focus for regular typing
                                    hiddenInputRef.current.focus();
                                }
                            }
                        }
                    }
                }
            }
        }

        touchStartRef.current = null;
        touchHasMovedRef.current = false;
    }, [engine, handleCanvasClick, findImageAtPosition, selectedNoteKey, setSelectedNoteKey, selectedIframeKey, setSelectedIframeKey, selectedMailKey, setSelectedMailKey]);

    // === IME Composition Handlers ===
    const handleCompositionStart = useCallback((e: React.CompositionEvent<HTMLCanvasElement>) => {
        engine.handleCompositionStart();
    }, [engine]);

    const handleCompositionUpdate = useCallback((e: React.CompositionEvent<HTMLCanvasElement>) => {
        engine.handleCompositionUpdate(e.data || '');
    }, [engine]);

    const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLCanvasElement>) => {
        engine.handleCompositionEnd(e.data || '');
    }, [engine]);

    const handleCanvasKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLCanvasElement>) => {
        // Host mode: check if we're on a non-input message that needs manual advancement
        if (hostDialogue.isHostActive) {
            const currentMessage = hostDialogue.getCurrentMessage();

            // If message doesn't expect input (display-only), allow navigation
            if (currentMessage && !currentMessage.expectsInput) {
                // Right arrow or any other key advances forward (if next exists)
                if (currentMessage.nextMessageId && (e.key === 'ArrowRight' || (e.key !== 'ArrowLeft' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown'))) {
                    hostDialogue.advanceToNextMessage();
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                // Left arrow goes back to previous message
                if (e.key === 'ArrowLeft' && currentMessage.previousMessageId) {
                    hostDialogue.goBackToPreviousMessage();
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
            }

            // Tab key toggles password visibility ONLY in password input mode during host dialogue
            if (e.key === 'Tab' &&
                hostDialogue.isHostActive &&
                hostDialogue.isExpectingInput() &&
                engine.hostMode.currentInputType === 'password' &&
                engine.chatMode.isActive) {
                setIsPasswordVisible(prev => !prev);
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            // Intercept Enter in host mode for chat input processing
            // Only intercept if we're actively expecting input from the user
            if (engine.chatMode.isActive && e.key === 'Enter' && !e.shiftKey && hostDialogue.isHostActive && hostDialogue.isExpectingInput()) {
                // Debounce: prevent rapid Enter presses
                const now = Date.now();
                if (now - lastEnterPressRef.current < 500) return; // 500ms debounce

                const userInput = engine.chatMode.currentInput.trim();
                if (userInput && !hostDialogue.isHostProcessing) {
                    lastEnterPressRef.current = now;

                    // Process through host dialogue
                    hostDialogue.processInput(userInput);

                    // Clear chat input and visual data
                    engine.clearChatData();
                    engine.setChatMode({
                        isActive: true,
                        currentInput: '',
                        inputPositions: [],
                        isProcessing: false
                    });

                    // Keep canvas focused for next input
                    setTimeout(() => {
                        if (canvasRef.current) {
                            canvasRef.current.focus();
                        }
                    }, 100);

                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
            }
        }

        // Try controller system first
        const handled = handleKeyDownFromController(e);
        if (handled) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // Handle image-specific keys before passing to engine
        if (selectedImageKey && e.key === 'Backspace') {
            // Delete the selected image
            engine.deleteImage(selectedImageKey);
            setSelectedImageKey(null); // Clear selection
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // Handle note region-specific keys before passing to engine
        if (selectedNoteKey && e.key === 'Backspace') {
            // Check if user is actively typing (has text content at or before cursor)
            // If so, let backspace delete text instead of the note
            const cursorKey = `${engine.cursorPos.x},${engine.cursorPos.y}`;
            const beforeCursorKey = `${engine.cursorPos.x - 1},${engine.cursorPos.y}`;
            const hasTextAtCursor = engine.worldData[cursorKey] && typeof engine.worldData[cursorKey] === 'string';
            const hasTextBeforeCursor = engine.worldData[beforeCursorKey] && typeof engine.worldData[beforeCursorKey] === 'string';

            if (hasTextAtCursor || hasTextBeforeCursor) {
                // User is typing, let engine handle backspace normally
                return;
            }

            // No text content - safe to delete the note
            // Delete the selected note region
            engine.setWorldData(prev => {
                const newData = { ...prev };

                // Check if note is part of a pattern
                try {
                    const noteData = JSON.parse(newData[selectedNoteKey] as string);
                    if (noteData.patternKey) {
                        // Remove note from pattern's noteKeys array
                        try {
                            const patternData = JSON.parse(newData[noteData.patternKey] as string);
                            const noteKeys = patternData.noteKeys || [];
                            const updatedNoteKeys = noteKeys.filter((key: string) => key !== selectedNoteKey);

                            if (updatedNoteKeys.length === 0) {
                                // No notes left, delete the pattern entirely
                                delete newData[noteData.patternKey];
                            } else {
                                // Recalculate pattern boundary from remaining notes
                                const corridorPadding = 3;
                                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

                                for (const noteKey of updatedNoteKeys) {
                                    try {
                                        const currentNoteData = JSON.parse(newData[noteKey] as string);
                                        const noteMinX = currentNoteData.startX;
                                        const noteMinY = currentNoteData.startY;
                                        const noteMaxX = currentNoteData.endX;
                                        const noteMaxY = currentNoteData.endY;
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

                                // Update pattern with remaining notes
                                newData[noteData.patternKey] = JSON.stringify({
                                    ...patternData,
                                    noteKeys: updatedNoteKeys,
                                    centerX: actualCenterX,
                                    centerY: actualCenterY,
                                    width: actualWidth,
                                    height: actualHeight
                                });
                            }
                        } catch (e) {
                            // Pattern data invalid, just delete note
                        }
                    }
                } catch (e) {
                    // Note data invalid, just delete
                }

                delete newData[selectedNoteKey];
                return newData;
            });
            setSelectedNoteKey(null); // Clear selection
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // Patterns cannot be deleted directly with backspace
        // They are deleted automatically when all their notes are removed

        // Handle iframe region-specific keys before passing to engine
        if (selectedIframeKey && e.key === 'Backspace') {
            // Check if user is actively typing (has text content at or before cursor)
            // If so, let backspace delete text instead of the iframe
            const cursorKey = `${engine.cursorPos.x},${engine.cursorPos.y}`;
            const beforeCursorKey = `${engine.cursorPos.x - 1},${engine.cursorPos.y}`;
            const hasTextAtCursor = engine.worldData[cursorKey] && typeof engine.worldData[cursorKey] === 'string';
            const hasTextBeforeCursor = engine.worldData[beforeCursorKey] && typeof engine.worldData[beforeCursorKey] === 'string';

            if (hasTextAtCursor || hasTextBeforeCursor) {
                // User is typing, let engine handle backspace normally
                return;
            }

            // No text content - safe to delete the iframe
            // Delete the selected iframe region
            engine.setWorldData(prev => {
                const newData = { ...prev };
                delete newData[selectedIframeKey];
                return newData;
            });
            setSelectedIframeKey(null); // Clear selection
            setActiveIframeKey(null); // Clear active state as well
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // Handle mail region-specific keys before passing to engine
        if (selectedMailKey && e.key === 'Backspace') {
            // Check if user is actively typing (has text content at or before cursor)
            // If so, let backspace delete text instead of the mail
            const cursorKey = `${engine.cursorPos.x},${engine.cursorPos.y}`;
            const beforeCursorKey = `${engine.cursorPos.x - 1},${engine.cursorPos.y}`;
            const hasTextAtCursor = engine.worldData[cursorKey] && typeof engine.worldData[cursorKey] === 'string';
            const hasTextBeforeCursor = engine.worldData[beforeCursorKey] && typeof engine.worldData[beforeCursorKey] === 'string';

            if (hasTextAtCursor || hasTextBeforeCursor) {
                // User is typing, let engine handle backspace normally
                return;
            }

            // No text content - safe to delete the mail
            // Delete the selected mail region and its button
            engine.setWorldData(prev => {
                const newData = { ...prev };
                delete newData[selectedMailKey];
                // Also delete associated send button
                const buttonKey = `mailbutton_${selectedMailKey}`;
                delete newData[buttonKey];
                return newData;
            });
            setSelectedMailKey(null); // Clear selection
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // Let engine handle all key input (including regular typing)
        const preventDefault = await engine.handleKeyDown(e.key, e.ctrlKey, e.metaKey, e.shiftKey, e.altKey);
        if (preventDefault) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, [engine, handleKeyDownFromController, selectedImageKey, selectedNoteKey, selectedPatternKey, selectedIframeKey, selectedMailKey, hostDialogue]);

    const hiddenInputRef = useRef<HTMLInputElement>(null);

    return (
        <>
            <canvas
                ref={canvasRef}
                className={className}
                onClick={handleCanvasClick}
                onDoubleClick={handleCanvasDoubleClick}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseLeave}
                onKeyDown={handleCanvasKeyDown}
                onCompositionStart={handleCompositionStart}
                onCompositionUpdate={handleCompositionUpdate}
                onCompositionEnd={handleCompositionEnd}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                tabIndex={0}
                style={{
                    display: 'block',
                    outline: 'none',
                    width: '100%',
                    height: '100%',
                    cursor: hostModeEnabled && hostDialogue.isHostActive && !hostDialogue.isExpectingInput() && hostDialogue.getCurrentMessage()?.id !== 'validate_user' ? 'pointer' : 'text',
                    position: 'relative',
                    zIndex: 1
                }}
            />
            {/* Screenshot overlay for Open Graph crawlers */}
            {showScreenshot && screenshotUrl && (
                <div
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        zIndex: 1000,
                        pointerEvents: 'none',
                        transition: 'opacity 300ms ease-out',
                        opacity: showScreenshot ? 1 : 0,
                    }}
                >
                    <img
                        src={screenshotUrl}
                        alt="Canvas preview"
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                        }}
                    />
                </div>
            )}
            {/* Chronological tracker for text blocks and note regions - HIDDEN */}
            {/* {(() => {
                const items = getChronologicalItems();
                if (items.length === 0) return null;

                return (
                    <div
                        style={{
                            position: 'absolute',
                            top: '20px',
                            right: '20px',
                            maxWidth: '300px',
                            maxHeight: '80vh',
                            overflowY: 'auto',
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            color: '#ffffff',
                            padding: '12px',
                            borderRadius: '8px',
                            fontSize: '12px',
                            fontFamily: 'monospace',
                            zIndex: 100,
                            pointerEvents: 'auto',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px'
                        }}
                    >
                        <div style={{
                            fontWeight: 'bold',
                            marginBottom: '4px',
                            fontSize: '13px',
                            borderBottom: '1px solid rgba(255, 255, 255, 0.3)',
                            paddingBottom: '4px'
                        }}>
                            Content Tracker
                        </div>
                        {items.map((item, index) => (
                            <div
                                key={index}
                                style={{
                                    padding: '8px',
                                    backgroundColor: item.type === 'note'
                                        ? 'rgba(100, 150, 255, 0.2)'
                                        : 'rgba(150, 150, 150, 0.1)',
                                    borderRadius: '4px',
                                    borderLeft: item.type === 'note'
                                        ? '3px solid rgba(100, 150, 255, 0.8)'
                                        : '3px solid rgba(150, 150, 150, 0.5)',
                                    wordBreak: 'break-word'
                                }}
                            >
                                <div style={{
                                    fontSize: '10px',
                                    opacity: 0.7,
                                    marginBottom: '4px',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center'
                                }}>
                                    <span>{item.type === 'note' ? '📋 NOTE' : '📝 TEXT'}</span>
                                    <span>({item.bounds.endX - item.bounds.startX + 1}×{item.bounds.endY - item.bounds.startY + 1})</span>
                                </div>
                                <div style={{
                                    whiteSpace: 'pre-wrap',
                                    fontSize: '11px',
                                    lineHeight: '1.4',
                                    maxHeight: '100px',
                                    overflowY: 'auto'
                                }}>
                                    {item.content.length > 200
                                        ? item.content.substring(0, 200) + '...'
                                        : item.content}
                                </div>
                            </div>
                        ))}
                    </div>
                );
            })()} */}
            {/* Render iframes for iframe regions (Unified) */}
            {(() => {
                const iframes: React.JSX.Element[] = [];

                for (const key in engine.worldData) {
                    if (key.startsWith('iframe_')) {
                        const note = parseNoteFromWorldData(key, engine.worldData[key]);
                        if (note && note.iframeUrl) {
                            const { startX, endX, startY, endY } = note;
                            const url = note.iframeUrl;

                            // Convert world coordinates to screen coordinates
                            const topLeft = engine.worldToScreen(startX, startY, engine.zoomLevel, engine.viewOffset);
                            const bottomRight = engine.worldToScreen(endX + 1, endY + 1, engine.zoomLevel, engine.viewOffset);

                            const left = topLeft.x;
                            const top = topLeft.y;
                            const width = bottomRight.x - topLeft.x;
                            const height = bottomRight.y - topLeft.y;

                            // Only render if visible on screen
                            const rect = canvasRef.current?.getBoundingClientRect();
                            if (rect &&
                                left < rect.width &&
                                top < rect.height &&
                                left + width > 0 &&
                                top + height > 0) {

                                const isActive = activeIframeKey === key;
                                const isSelected = selectedIframeKey === key;

                                iframes.push(
                                    <iframe
                                        key={key}
                                        src={url}
                                        style={{
                                            position: 'absolute',
                                            left: `${left}px`,
                                            top: `${top}px`,
                                            width: `${width}px`,
                                            height: `${height}px`,
                                            // border: isSelected
                                            //     ? '5px solid rgba(100, 150, 255, 0.8)'
                                            //     : '5px solid rgba(100, 100, 100, 0.3)',
                                            borderRadius: '2px',
                                            backgroundColor: '#fff',
                                            zIndex: 10,
                                            pointerEvents: isActive ? 'auto' : 'none'
                                        }}
                                        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
                                        referrerPolicy="no-referrer"
                                    />
                                );
                            }
                        }
                    }
                }

                return iframes.length > 0 ? <>{iframes}</> : null;
            })()}
            {/* Hidden input for IME composition and mobile keyboard - only in write mode OR host mode */}
            {(!engine.isReadOnly || hostDialogue.isHostActive) && (
                <input
                    ref={hiddenInputRef}
                    type="text"
                    value=""
                    readOnly={false}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                    lang="en"
                    inputMode="text"
                    enterKeyHint="done"
                    onChange={(e) => {
                        // Prevent controlled input warnings
                        // Actual input is handled via onKeyDown
                        if (hiddenInputRef.current) {
                            hiddenInputRef.current.value = '';
                        }
                    }}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100vw',
                        height: '50px',
                        opacity: 0,
                        pointerEvents: 'none',
                        zIndex: -1,
                        fontSize: '16px' // Prevents iOS auto-zoom
                    }}
                    onKeyDown={(e) => {
                        // Forward key events to canvas handler
                        const syntheticEvent = {
                            ...e,
                            preventDefault: () => e.preventDefault(),
                            stopPropagation: () => e.stopPropagation(),
                            key: e.key,
                            shiftKey: e.shiftKey,
                            ctrlKey: e.ctrlKey,
                            metaKey: e.metaKey,
                            altKey: e.altKey
                        } as any;
                        handleCanvasKeyDown(syntheticEvent);
                    }}
                    onCompositionStart={(e) => {
                        handleCompositionStart(e as any);
                    }}
                    onCompositionUpdate={(e) => {
                        handleCompositionUpdate(e as any);
                    }}
                    onCompositionEnd={(e) => {
                        handleCompositionEnd(e as any);
                        // Clear the input after composition
                        if (hiddenInputRef.current) {
                            hiddenInputRef.current.value = '';
                        }
                    }}
                />
            )}
        </>
    );
}

// Helper function to convert hex color to RGB components
function hexToRgb(hex: string): string {
    // Remove # if present
    hex = hex.replace(/^#/, '');
    
    // Parse hex values
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    return `${r}, ${g}, ${b}`;
}