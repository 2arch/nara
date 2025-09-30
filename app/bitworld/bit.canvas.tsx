// components/BitCanvas.tsx
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { WorldData, Point, WorldEngine, PanStartInfo } from './world.engine'; // Adjust path as needed
import { useDialogue, useDebugDialogue } from './dialogue';
import { useMonogramSystem } from './monogram';
import { useControllerSystem, createMonogramController, createCameraController, createGridController } from './controllers';
import { detectTextBlocks, extractLineCharacters, renderFrames, renderHierarchicalFrames, HierarchicalFrame, HierarchyLevel } from './bit.blocks';
import { COLOR_MAP } from './commands';

// --- Constants --- (Copied and relevant ones kept)
const GRID_COLOR = '#F2F2F233';
const CURSOR_COLOR_PRIMARY = '#D3D3D355';
const CURSOR_COLOR_SECONDARY = '#B8B8B855';
const CURSOR_COLOR_SAVE = '#F2F2F2'; // Green color for saving state
const CURSOR_COLOR_ERROR = '#FF0000'; // Red color for error state
const CURSOR_TEXT_COLOR = '#FFFFFF';
const BACKGROUND_COLOR = '#FFFFFF55';
const DRAW_GRID = true;
const GRID_LINE_WIDTH = 1;
const CURSOR_TRAIL_FADE_MS = 200; // Time in ms for trail to fully fade



// --- Waypoint Arrow Constants ---
const ARROW_SIZE = 12; // Size of waypoint arrows
const ARROW_MARGIN = 20; // Distance from viewport edge



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
    monogramEnabled?: boolean;
    dialogueEnabled?: boolean;
    fontFamily?: string; // Font family for text rendering
}

export function BitCanvas({ engine, cursorColorAlternate, className, showCursor = true, monogramEnabled = false, dialogueEnabled = true, fontFamily = 'IBM Plex Mono' }: BitCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const devicePixelRatioRef = useRef(1);
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
    const [cursorTrail, setCursorTrail] = useState<CursorTrailPosition[]>([]);
    const [statePublishStatuses, setStatePublishStatuses] = useState<Record<string, boolean>>({});
    const [mouseWorldPos, setMouseWorldPos] = useState<Point | null>(null);
    const [isShiftPressed, setIsShiftPressed] = useState<boolean>(false);
    const [shiftDragStartPos, setShiftDragStartPos] = useState<Point | null>(null);
    const [selectedImageKey, setSelectedImageKey] = useState<string | null>(null);
    const lastCursorPosRef = useRef<Point | null>(null);

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
    const router = useRouter();
    
    // Cache for background images to avoid reloading
    const backgroundImageRef = useRef<HTMLImageElement | null>(null);
    const backgroundImageUrlRef = useRef<string | null>(null);
    
    // Cache for uploaded images to avoid reloading
    const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
    
    // Dialogue system
    const { renderDialogue, renderDebugDialogue, renderNavDialogue, renderMonogramControls, handleNavClick } = useDialogue();
    
    // Debug dialogue system
    const { debugText } = useDebugDialogue(engine);
    
    // Monogram system for psychedelic patterns - load from settings and sync changes
    const monogramSystem = useMonogramSystem(
        {
            mode: engine.settings.monogramMode || 'clear',
            speed: 0.5,
            complexity: 1.0,
            colorShift: 0,
            enabled: engine.settings.monogramEnabled || false,
            geometryType: 'octahedron',
            interactiveTrails: true,
            trailIntensity: 1.0,
            trailFadeMs: 2000
        },
        (options) => {
            // Save monogram mode and enabled state to settings when changed
            engine.updateSettings({
                monogramMode: options.mode,
                monogramEnabled: options.enabled
            });
        }
    );


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
        engine.setDialogueText(`${action} state...`);
        
        try {
            // Use the same Firebase logic as the /publish command
            const { database } = await import('@/app/firebase');
            const { ref, set } = await import('firebase/database');
            const userUid = engine.userUid || 'anonymous';
            const stateRef = ref(database, `worlds/${userUid}/${state}/public`);
            await set(stateRef, !isCurrentlyPublished); // Toggle publish status
            
            const statusText = isCurrentlyPublished ? 'private' : 'public';
            engine.setDialogueText(`State "${state}" is now ${statusText}`);
            
            // Update cached status
            setStatePublishStatuses(prev => ({
                ...prev,
                [state]: !isCurrentlyPublished
            }));
        } catch (error: any) {
            engine.setDialogueText(`Error ${action.toLowerCase()} state: ${error.message}`);
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
        registerGroup(createMonogramController(monogramSystem));
        registerGroup(createCameraController(engine));
        registerGroup(createGridController({ cycleGridMode: engine.cycleGridMode }));
    }, [registerGroup, engine.cycleGridMode]);
    
    // Enhanced debug text without monogram info - only calculate if debug is visible
    const enhancedDebugText = engine.settings.isDebugVisible ? `${debugText}
Camera & Viewport Controls:
  Home: Return to origin
  Ctrl+H: Reset zoom level` : '';
    
    // Monogram controls text - only show if debug is visible
    const monogramControlsText = engine.settings.isDebugVisible ? `Monogram Controls:
  Ctrl+M: Toggle monogram on/off
  Ctrl+N: Cycle pattern mode
  Ctrl+=: Increase animation speed
  Ctrl++: Increase animation speed
  Ctrl+-: Decrease animation speed
  Ctrl+]: Increase complexity
  Ctrl+[: Decrease complexity
  Ctrl+Shift+R: Randomize color shift
  
Monogram: ${monogramSystem.options.enabled ? 'ON' : 'OFF'} | Mode: ${monogramSystem.options.mode}
Speed: ${monogramSystem.options.speed.toFixed(1)} | Complexity: ${monogramSystem.options.complexity.toFixed(1)}` : '';
    





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



    // --- Bounds Spatial Index Cache ---
    const boundsIndexRef = useRef<Map<string, {isFocused: boolean, textColor: string}> | null>(null);
    const lastBoundsDataRef = useRef<string>('');
    
    const updateBoundsIndex = useCallback(() => {
        // Create a spatial index of all bound top bars for O(1) lookup
        const boundsIndex = new Map<string, {isFocused: boolean, textColor: string}>();

        // Bound title text should match the background color (creating cutout effect)
        // The bound bar accent is the inverse of background (via engine.textColor)
        // So the text on the bound bar should be the same as the background
        const bgColor = engine.backgroundColor || '#FFFFFF';
        const textColor = bgColor; // Text matches background for cutout effect

        for (const boundKey in engine.worldData) {
            if (boundKey.startsWith('bound_')) {
                try {
                    const boundData = JSON.parse(engine.worldData[boundKey] as string);
                    const { startX, endX, startY } = boundData;
                    const isFocused = engine.focusedBoundKey === boundKey;

                    // Index every position on the top bar
                    for (let x = startX; x <= endX; x++) {
                        const key = `${x},${startY}`;
                        boundsIndex.set(key, { isFocused, textColor });
                    }
                } catch (e) {
                    // Skip invalid bound data
                }
            }
        }

        boundsIndexRef.current = boundsIndex;
    }, [engine.worldData, engine.focusedBoundKey, engine.backgroundColor]);
    // Helper function to find image at a specific position
    
    const findImageAtPosition = useCallback((pos: Point): any => {
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


    // --- Cursor Preview Functions ---
    const drawHoverPreview = useCallback((ctx: CanvasRenderingContext2D, worldPos: Point, currentZoom: number, currentOffset: Point, effectiveCharWidth: number, effectiveCharHeight: number, cssWidth: number, cssHeight: number, shiftPressed: boolean = false) => {
        // Only show preview if different from current cursor position
        if (worldPos.x === engine.cursorPos.x && worldPos.y === engine.cursorPos.y) return;
        
        const screenPos = engine.worldToScreen(worldPos.x, worldPos.y, currentZoom, currentOffset);
        
        // Only draw if visible on screen
        if (screenPos.x < -effectiveCharWidth || screenPos.x > cssWidth || 
            screenPos.y < -effectiveCharHeight || screenPos.y > cssHeight) return;
        
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
                // When shift is pressed, draw gray border around the entire image
                const topLeftScreen = engine.worldToScreen(imageAtPosition.startX, imageAtPosition.startY, currentZoom, currentOffset);
                const bottomRightScreen = engine.worldToScreen(imageAtPosition.endX + 1, imageAtPosition.endY + 1, currentZoom, currentOffset);
                
                ctx.strokeStyle = 'rgba(211, 211, 211, 0.7)'; // Light gray border matching cursor preview
                ctx.lineWidth = 2;
                ctx.strokeRect(
                    topLeftScreen.x, 
                    topLeftScreen.y, 
                    bottomRightScreen.x - topLeftScreen.x, 
                    bottomRightScreen.y - topLeftScreen.y
                );
            }
            // For normal hover over images: no visual feedback (no gray overlay, no border)
        } else if (hasDirectText || isWithinTextBlock) {
            
            // Draw heather gray overlay for the entire text block
            ctx.fillStyle = 'rgba(176, 176, 176, 0.3)'; // Heather gray overlay
            
            for (const blockPos of textBlock) {
                const blockScreenPos = engine.worldToScreen(blockPos.x, blockPos.y, currentZoom, currentOffset);
                
                // Only draw if visible on screen
                if (blockScreenPos.x >= -effectiveCharWidth && blockScreenPos.x <= cssWidth && 
                    blockScreenPos.y >= -effectiveCharHeight && blockScreenPos.y <= cssHeight) {
                    ctx.fillRect(blockScreenPos.x, blockScreenPos.y, effectiveCharWidth, effectiveCharHeight);
                }
            }
            
            if (shiftPressed) {
                // When shift is pressed, draw gray border around the entire text block
                const minX = Math.min(...textBlock.map(p => p.x));
                const maxX = Math.max(...textBlock.map(p => p.x));
                const minY = Math.min(...textBlock.map(p => p.y));
                const maxY = Math.max(...textBlock.map(p => p.y));
                
                const topLeftScreen = engine.worldToScreen(minX, minY, currentZoom, currentOffset);
                const bottomRightScreen = engine.worldToScreen(maxX + 1, maxY + 1, currentZoom, currentOffset);
                
                ctx.strokeStyle = 'rgba(211, 211, 211, 0.7)'; // Light gray border matching cursor preview
                ctx.lineWidth = 2;
                ctx.strokeRect(
                    topLeftScreen.x, 
                    topLeftScreen.y, 
                    bottomRightScreen.x - topLeftScreen.x, 
                    bottomRightScreen.y - topLeftScreen.y
                );
            } else {
                // Draw outline around the hovered cell
                ctx.strokeStyle = 'rgba(176, 176, 176, 0.8)';
                ctx.lineWidth = 2;
                ctx.strokeRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
            }
        } else {
            if (shiftPressed) {
                // When shift is pressed over empty cell, draw gray border
                ctx.strokeStyle = 'rgba(211, 211, 211, 0.7)'; // Light gray matching cursor preview
                ctx.lineWidth = 2;
                ctx.strokeRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                
                ctx.fillStyle = 'rgba(211, 211, 211, 0.2)'; // Match preview cursor fill
                ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
            } else {
                // Regular light gray preview for empty cells
                ctx.strokeStyle = 'rgba(211, 211, 211, 0.7)';
                ctx.lineWidth = 2;
                ctx.strokeRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                
                ctx.fillStyle = 'rgba(211, 211, 211, 0.2)';
                ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
            }
        }
    }, [engine, findImageAtPosition]);

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
        
        // Update bounds index if world data changed or focus changed
        const currentBoundsData = JSON.stringify(Object.keys(engine.worldData).filter(k => k.startsWith('bound_'))) + '|' + engine.focusedBoundKey;
        if (currentBoundsData !== lastBoundsDataRef.current) {
            updateBoundsIndex();
            lastBoundsDataRef.current = currentBoundsData;
        }

        // Use intermediate offset if panning, otherwise use engine's state
        const currentOffset = isMiddleMouseDownRef.current ? intermediatePanOffsetRef.current : engine.viewOffset;
        const verticalTextOffset = 0;

        // --- Actual Drawing (Copied from previous `draw` function) ---
        ctx.save();
        ctx.scale(dpr, dpr);
        
        if (engine.backgroundMode === 'color') {
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
            
            // Draw the cached image if it's loaded
            if (backgroundImageRef.current && backgroundImageRef.current.complete) {
                ctx.drawImage(backgroundImageRef.current, 0, 0, cssWidth, cssHeight);
            }
        } else if (engine.backgroundMode === 'space') {
            // Clear canvas for space background (handled by SpaceBackground component)
            ctx.clearRect(0, 0, cssWidth, cssHeight);
        } else if (engine.backgroundMode === 'stream') {
            // Clear canvas for stream background (handled by video element in parent)
            ctx.clearRect(0, 0, cssWidth, cssHeight);
        } else {
            // Default transparent mode
            ctx.clearRect(0, 0, cssWidth, cssHeight);
        }

        
        ctx.imageSmoothingEnabled = false;
        ctx.font = `${effectiveFontSize}px ${fontFamily}`;
        ctx.textBaseline = 'top';

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

        // === Render Monogram Patterns ===
        if (monogramEnabled) {
            const monogramPattern = monogramSystem.generateMonogramPattern(
                startWorldX, startWorldY, endWorldX, endWorldY, engine.textColor
            );
            
            for (const key in monogramPattern) {
                const [xStr, yStr] = key.split(',');
                const worldX = parseInt(xStr, 10);
                const worldY = parseInt(yStr, 10);
                
                if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                    const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                    if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && 
                        screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                        
                        const cell = monogramPattern[key];
                        
                        // Only render if there's no regular text at this position
                        const textKey = `${worldX},${worldY}`;
                        const charData = engine.worldData[textKey];
                        const char = charData && !engine.isImageData(charData) ? engine.getCharacter(charData) : '';
                        if ((!char || char.trim() === '') && !engine.commandData[textKey]) {
                            // Set color and render character
                            ctx.fillStyle = cell.color;
                            // No transparency for monogram patterns - render at full opacity
                            ctx.fillText(cell.char, screenPos.x, screenPos.y + verticalTextOffset);
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
                const color = typeof charData === 'object' && charData.style?.color ? charData.style.color : '#808080';
                
                // Calculate opacity if fadeStart is set
                let opacity = 1.0;
                if (typeof charData === 'object' && charData.fadeStart) {
                    const fadeProgress = (Date.now() - charData.fadeStart) / 1000; // Fade over 1 second
                    opacity = Math.max(0, 1 - fadeProgress);
                }
                
                const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                    if (char && char.trim() !== '') {
                        // Apply opacity to color
                        if (opacity < 1.0) {
                            ctx.globalAlpha = opacity;
                        }
                        ctx.fillStyle = color; // Use character's color or default
                        ctx.fillText(char, screenPos.x, screenPos.y + verticalTextOffset);
                        if (opacity < 1.0) {
                            ctx.globalAlpha = 1.0; // Reset alpha
                        }
                    }
                }
            }
        }

        // === Render Bounded Region Backgrounds ===
        for (const key in engine.worldData) {
            if (key.startsWith('bound_')) {
                try {
                    const boundData = JSON.parse(engine.worldData[key] as string);
                    const { startX, endX, startY, endY, maxY, color } = boundData;
                    
                    // Determine the actual end Y for rendering based on maxY
                    // If maxY is set, use it as the render boundary (it extends beyond endY)
                    const renderEndY = (maxY !== null && maxY !== undefined) ? maxY : endY;
                    
                    // Check if this is a finite height bound (has maxY)
                    const isFiniteHeight = (maxY !== null && maxY !== undefined);
                    
                    // Always render just bars, never full fill
                    // Use text color for bounds bars (programmatic - matches current theme)
                    const isFocused = engine.focusedBoundKey === key;

                    // Use the engine's text color with higher opacity when focused
                    const baseColor = engine.textColor;
                    const topBarColor = isFocused ? baseColor : `${baseColor}99`; // Full opacity if focused, 60% if not
                    
                    for (let x = startX; x <= endX; x++) {
                        // Always render top bar 
                        if (x >= startWorldX - 5 && x <= endWorldX + 5 && startY >= startWorldY - 5 && startY <= endWorldY + 5) {
                            const topScreenPos = engine.worldToScreen(x, startY, currentZoom, currentOffset);
                            if (topScreenPos.x > -effectiveCharWidth * 2 && topScreenPos.x < cssWidth + effectiveCharWidth && 
                                topScreenPos.y > -effectiveCharHeight * 2 && topScreenPos.y < cssHeight + effectiveCharHeight) {
                                ctx.fillStyle = topBarColor;
                                ctx.fillRect(topScreenPos.x, topScreenPos.y, effectiveCharWidth, effectiveCharHeight);
                            }
                        }
                        
                        // Only render bottom bar if this is a finite height bound
                        if (isFiniteHeight && x >= startWorldX - 5 && x <= endWorldX + 5 && renderEndY >= startWorldY - 5 && renderEndY <= endWorldY + 5) {
                            const bottomScreenPos = engine.worldToScreen(x, renderEndY, currentZoom, currentOffset);
                            if (bottomScreenPos.x > -effectiveCharWidth * 2 && bottomScreenPos.x < cssWidth + effectiveCharWidth &&
                                bottomScreenPos.y > -effectiveCharHeight * 2 && bottomScreenPos.y < cssHeight + effectiveCharHeight) {
                                ctx.fillStyle = `${baseColor}99`; // Same as unfocused - 60% opacity
                                ctx.fillRect(bottomScreenPos.x, bottomScreenPos.y, effectiveCharWidth, effectiveCharHeight);
                            }
                        }
                    }
                } catch (e) {
                    // Skip invalid bound data
                }
            }
        }

        // === Render Images ===
        const renderedImages = new Set<string>(); // Track which images we've already rendered
        for (const key in engine.worldData) {
            if (key.startsWith('image_') && !renderedImages.has(key)) {
                const imageData = engine.worldData[key];
                if (engine.isImageData(imageData)) {
                    renderedImages.add(key);
                    
                    // Check if image is visible in current viewport
                    const imageVisible = imageData.startX <= endWorldX && imageData.endX >= startWorldX &&
                                        imageData.startY <= endWorldY && imageData.endY >= startWorldY;
                    
                    if (imageVisible) {
                        // Calculate screen positions
                        const startScreenPos = engine.worldToScreen(imageData.startX, imageData.startY, currentZoom, currentOffset);
                        const endScreenPos = engine.worldToScreen(imageData.endX + 1, imageData.endY + 1, currentZoom, currentOffset);
                        
                        // Calculate target dimensions based on grid cells
                        const targetWidth = endScreenPos.x - startScreenPos.x;
                        const targetHeight = endScreenPos.y - startScreenPos.y;
                        
                        // Check if image is already cached
                        let img = imageCache.current.get(imageData.src);
                        if (!img) {
                            // Create and cache new image
                            img = new Image();
                            img.onload = () => {
                                // Image loaded, next frame will render it
                            };
                            img.src = imageData.src;
                            imageCache.current.set(imageData.src, img);
                        }
                        
                        // Only draw if image is fully loaded
                        if (img.complete && img.naturalWidth > 0) {
                            // Calculate crop and fit dimensions
                            const aspectRatio = img.width / img.height;
                            const targetAspectRatio = targetWidth / targetHeight;
                            
                            let drawWidth = targetWidth;
                            let drawHeight = targetHeight;
                            let offsetX = 0;
                            let offsetY = 0;
                            
                            // Crop to fit - fill the entire target area
                            if (aspectRatio > targetAspectRatio) {
                                // Image is wider than target - crop sides
                                const scaledWidth = targetHeight * aspectRatio;
                                offsetX = (targetWidth - scaledWidth) / 2;
                                drawWidth = scaledWidth;
                            } else {
                                // Image is taller than target - crop top/bottom
                                const scaledHeight = targetWidth / aspectRatio;
                                offsetY = (targetHeight - scaledHeight) / 2;
                                drawHeight = scaledHeight;
                            }
                            
                            // Use clipping to ensure image doesn't exceed target bounds
                            ctx.save();
                            ctx.beginPath();
                            ctx.rect(startScreenPos.x, startScreenPos.y, targetWidth, targetHeight);
                            ctx.clip();
                            
                            // Draw the image
                            ctx.drawImage(
                                img,
                                startScreenPos.x + offsetX,
                                startScreenPos.y + offsetY,
                                drawWidth,
                                drawHeight
                            );
                            
                            ctx.restore();
                        }
                    }
                }
            }
        }

        ctx.fillStyle = engine.textColor;
        for (const key in engine.worldData) {
            // Skip block, label, bound, and image data - we render those separately
            if (key.startsWith('block_') || key.startsWith('label_') || key.startsWith('bound_') || key.startsWith('image_')) continue;
            
            const [xStr, yStr] = key.split(',');
            const worldX = parseInt(xStr, 10); const worldY = parseInt(yStr, 10);
            if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                const charData = engine.worldData[key];
                const char = charData && !engine.isImageData(charData) ? engine.getCharacter(charData) : '';
                const charStyle = charData && !engine.isImageData(charData) ? engine.getCharacterStyle(charData) : undefined;
                const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                    // Apply text background if specified (even for empty spaces)
                    if (charStyle && charStyle.background) {
                        ctx.fillStyle = charStyle.background;
                        ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                    }
                    
                    // Render text only if there's actual content
                    if (char && char.trim() !== '') {
                        // O(1) lookup for bound text color using spatial index
                        const posKey = `${worldX},${worldY}`;
                        const boundInfo = boundsIndexRef.current?.get(posKey);
                        
                        // Apply text color based on background
                        if (boundInfo) {
                            ctx.fillStyle = boundInfo.textColor;
                        } else {
                            ctx.fillStyle = (charStyle && charStyle.color) || engine.textColor;
                        }
                        ctx.fillText(char, screenPos.x, screenPos.y + verticalTextOffset);
                    }
                }
            }
        }

        // === Render Chat Data (Black Background, White Text) ===
        for (const key in engine.chatData) {
            const [xStr, yStr] = key.split(',');
            const worldX = parseInt(xStr, 10); const worldY = parseInt(yStr, 10);
            if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                const charData = engine.chatData[key];
                
                // Skip image data - only process text characters
                if (engine.isImageData(charData)) {
                    continue;
                }
                
                const char = typeof charData === 'string' ? charData : charData.char;
                const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                    if (char) {
                        // Draw black background for all characters including spaces
                        ctx.fillStyle = '#000000';
                        ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                        
                        // Draw white text (only if not a space)
                        if (char.trim() !== '') {
                            ctx.fillStyle = '#FFFFFF';
                            ctx.fillText(char, screenPos.x, screenPos.y + verticalTextOffset);
                        }
                    }
                }
            }
        }

        // === Render Search Data (Purple Background, White Text) ===
        for (const key in engine.searchData) {
            const [xStr, yStr] = key.split(',');
            const worldX = parseInt(xStr, 10); const worldY = parseInt(yStr, 10);
            if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                const charData = engine.searchData[key];
                
                // Skip image data - only process text characters
                if (engine.isImageData(charData)) {
                    continue;
                }
                
                const char = typeof charData === 'string' ? charData : charData.char;
                const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                    if (char && char.trim() !== '') {
                        // Draw purple background
                        ctx.fillStyle = '#800080';
                        ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                        
                        // Draw white text
                        ctx.fillStyle = '#FFFFFF';
                        ctx.fillText(char, screenPos.x, screenPos.y + verticalTextOffset);
                    }
                }
            }
        }

        // === Render Command Data ===
        if (engine.commandState.isActive) {
            // First, draw background for selected command
            const selectedCommandY = engine.commandState.commandStartPos.y + 1 + engine.commandState.selectedIndex;
            const selectedCommand = engine.commandState.matchedCommands[engine.commandState.selectedIndex];
            if (selectedCommand) {
                const selectedScreenPos = engine.worldToScreen(engine.commandState.commandStartPos.x, selectedCommandY, currentZoom, currentOffset);
                if (selectedScreenPos.x > -effectiveCharWidth * 2 && selectedScreenPos.x < cssWidth + effectiveCharWidth && selectedScreenPos.y > -effectiveCharHeight * 2 && selectedScreenPos.y < cssHeight + effectiveCharHeight) {
                    ctx.fillStyle = 'rgba(255, 107, 53, 0.3)'; // Highlight background
                    ctx.fillRect(selectedScreenPos.x, selectedScreenPos.y, selectedCommand.length * effectiveCharWidth, effectiveCharHeight);
                }
            }
        }
        
        for (const key in engine.commandData) {
            const [xStr, yStr] = key.split(',');
            const worldX = parseInt(xStr, 10); const worldY = parseInt(yStr, 10);
            if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                const charData = engine.commandData[key];
                
                // Skip image data - only process text characters
                if (engine.isImageData(charData)) {
                    continue;
                }
                
                const char = typeof charData === 'string' ? charData : charData.char;
                const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                    // Check if mouse is hovering over this command line
                    const isHovered = mouseWorldPos && Math.floor(mouseWorldPos.y) === worldY && worldY > engine.commandState.commandStartPos.y;

                    // Draw background for command data using text color with varying opacity
                    if (worldY === engine.commandState.commandStartPos.y) {
                        // Command line (typed command) - use text color at full opacity
                        ctx.fillStyle = engine.textColor;
                        ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                        // Text uses background color
                        ctx.fillStyle = engine.backgroundColor || '#FFFFFF';
                    } else if (isHovered) {
                        // Hovered suggestion - use text color at 90% opacity (brighter than selected)
                        const hex = engine.textColor.replace('#', '');
                        const r = parseInt(hex.substring(0, 2), 16);
                        const g = parseInt(hex.substring(2, 4), 16);
                        const b = parseInt(hex.substring(4, 6), 16);
                        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.9)`;
                        ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                        // Text uses background color
                        ctx.fillStyle = engine.backgroundColor || '#FFFFFF';
                    } else if (engine.commandState.isActive && worldY === engine.commandState.commandStartPos.y + 1 + engine.commandState.selectedIndex) {
                        // Selected suggestion - use text color at 80% opacity
                        const hex = engine.textColor.replace('#', '');
                        const r = parseInt(hex.substring(0, 2), 16);
                        const g = parseInt(hex.substring(2, 4), 16);
                        const b = parseInt(hex.substring(4, 6), 16);
                        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.8)`;
                        ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                        // Text uses background color
                        ctx.fillStyle = engine.backgroundColor || '#FFFFFF';
                    } else {
                        // Other suggestions - use text color at 60% opacity
                        const hex = engine.textColor.replace('#', '');
                        const r = parseInt(hex.substring(0, 2), 16);
                        const g = parseInt(hex.substring(2, 4), 16);
                        const b = parseInt(hex.substring(4, 6), 16);
                        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.6)`;
                        ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                        // Text uses background color at higher opacity for readability
                        const bgHex = (engine.backgroundColor || '#FFFFFF').replace('#', '');
                        const bgR = parseInt(bgHex.substring(0, 2), 16);
                        const bgG = parseInt(bgHex.substring(2, 4), 16);
                        const bgB = parseInt(bgHex.substring(4, 6), 16);
                        ctx.fillStyle = `rgba(${bgR}, ${bgG}, ${bgB}, 0.9)`;
                    }

                    // Draw text (only if not a space)
                    if (char && char.trim() !== '') {
                        ctx.fillText(char, screenPos.x, screenPos.y + verticalTextOffset);
                    }

                    // Draw color swatch for color-related commands (only on first character of suggestion line)
                    if (worldX === engine.commandState.commandStartPos.x && worldY > engine.commandState.commandStartPos.y) {
                        // Get the full command text for this line
                        const suggestionIndex = worldY - engine.commandState.commandStartPos.y - 1;
                        if (suggestionIndex >= 0 && suggestionIndex < engine.commandState.matchedCommands.length) {
                            const commandText = engine.commandState.matchedCommands[suggestionIndex];


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
                                const colorArg = parts[1];

                                // Skip flags and non-color arguments
                                if (colorArg && colorArg !== '--g') {
                                    swatchColor = COLOR_MAP[colorArg.toLowerCase()] || (colorArg.startsWith('#') ? colorArg : null);
                                }
                            }

                            if (swatchColor) {
                                // Draw full-sized color cell to the left of the command
                                const cellX = screenPos.x - effectiveCharWidth;
                                const cellY = screenPos.y;

                                ctx.fillStyle = swatchColor;
                                ctx.fillRect(cellX, cellY, effectiveCharWidth, effectiveCharHeight);
                            }
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
                        const color = labelData.color || '#000000';
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
                                const charScreenPos = engine.worldToScreen(charWorldX, worldY, currentZoom, currentOffset);
                                
                                // Fill background for this character cell
                                ctx.fillStyle = color;
                                ctx.fillRect(charScreenPos.x, charScreenPos.y, effectiveCharWidth, effectiveCharHeight);

                                // Render the character with contrasting color
                                const textColor = color === '#000000' || color === 'black' ? '#FFFFFF' : '#000000';
                                ctx.fillStyle = textColor;
                                ctx.fillText(text[charIndex], charScreenPos.x, charScreenPos.y + verticalTextOffset);
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
                                
                                drawArrow(ctx, adjustedX, adjustedY, intersection.angle, color);

                                // Draw the label text next to the arrow
                                if (text) {
                                
                                ctx.fillStyle = color;
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
        for (const key in engine.worldData) {
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


        // === Render Selection Area ===
        if (engine.selectionStart && engine.selectionEnd) {
            const start = engine.selectionStart;
            const end = engine.selectionEnd;
            
            // Calculate selection bounds
            const minX = Math.min(start.x, end.x);
            const maxX = Math.max(start.x, end.x);
            const minY = Math.min(start.y, end.y);
            const maxY = Math.max(start.y, end.y);
            
            // Use light transparent version of cursor primary color
            const selectionColor = `rgba(${hexToRgb(CURSOR_COLOR_PRIMARY)}, 0.3)`;
            ctx.fillStyle = selectionColor;
            
            // Fill each cell in the selection area
            for (let worldY = minY; worldY <= maxY; worldY++) {
                for (let worldX = minX; worldX <= maxX; worldX++) {
                    const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                    
                    // Only draw if cell is visible on screen
                    if (screenPos.x >= -effectiveCharWidth && screenPos.x <= cssWidth && 
                        screenPos.y >= -effectiveCharHeight && screenPos.y <= cssHeight) {
                        ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
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
                
                // Use the same color as text selection border
                ctx.strokeStyle = `rgba(${hexToRgb(CURSOR_COLOR_PRIMARY)}, 0.8)`;
                ctx.lineWidth = 3; // Slightly thicker to indicate selection
                ctx.strokeRect(
                    topLeftScreen.x, 
                    topLeftScreen.y, 
                    bottomRightScreen.x - topLeftScreen.x, 
                    bottomRightScreen.y - topLeftScreen.y
                );
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
                    // Draw blue preview for image destination
                    ctx.fillStyle = 'rgba(0, 100, 255, 0.3)'; // Blue with transparency
                    
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
                } else {
                    // If no image, check for text block at start position
                    const textBlock = findTextBlock(shiftDragStartPos, engine.worldData, engine);
                    
                    if (textBlock.length > 0) {
                        // Draw blue preview rectangles for each destination position
                        ctx.fillStyle = 'rgba(0, 100, 255, 0.3)'; // Blue with transparency
                        
                        for (const pos of textBlock) {
                            const destX = pos.x + distanceX;
                            const destY = pos.y + distanceY;
                            const destScreenPos = engine.worldToScreen(destX, destY, currentZoom, currentOffset);
                            
                            // Only draw if visible on screen
                            if (destScreenPos.x >= -effectiveCharWidth && destScreenPos.x <= cssWidth && 
                                destScreenPos.y >= -effectiveCharHeight && destScreenPos.y <= cssHeight) {
                                ctx.fillRect(destScreenPos.x, destScreenPos.y, effectiveCharWidth, effectiveCharHeight);
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
                
                const trailScreenPos = engine.worldToScreen(
                    trailPos.x, trailPos.y, 
                    currentZoom, currentOffset
                );
                
                // Only draw if visible on screen
                if (trailScreenPos.x >= -effectiveCharWidth && 
                    trailScreenPos.x <= cssWidth && 
                    trailScreenPos.y >= -effectiveCharHeight && 
                    trailScreenPos.y <= cssHeight) {
                    
                    // Draw faded cursor rectangle
                    const baseColor = cursorColorAlternate ? 
                        CURSOR_COLOR_SECONDARY : CURSOR_COLOR_PRIMARY;
                    ctx.fillStyle = `rgba(${hexToRgb(baseColor)}, ${opacity})`;
                    ctx.fillRect(
                        trailScreenPos.x, 
                        trailScreenPos.y, 
                        effectiveCharWidth, 
                        effectiveCharHeight
                    );
                }
            }

            const cursorScreenPos = engine.worldToScreen(engine.cursorPos.x, engine.cursorPos.y, currentZoom, currentOffset);
            if (cursorScreenPos.x >= -effectiveCharWidth && cursorScreenPos.x <= cssWidth && cursorScreenPos.y >= -effectiveCharHeight && cursorScreenPos.y <= cssHeight) {
                const key = `${engine.cursorPos.x},${engine.cursorPos.y}`;
                
                // Don't render cursor if in chat mode or if there's chat/command data at this position
                if (!engine.chatMode.isActive && !engine.chatData[key] && !engine.commandData[key]) {
                    // Determine cursor color based on engine state
                    if (engine.worldPersistenceError) {
                        ctx.fillStyle = CURSOR_COLOR_ERROR;
                    } else if (engine.isSavingWorld) {
                        ctx.fillStyle = CURSOR_COLOR_SAVE;
                    } else {
                        ctx.fillStyle = cursorColorAlternate ? CURSOR_COLOR_SECONDARY : CURSOR_COLOR_PRIMARY;
                    }
                    
                    ctx.fillRect(cursorScreenPos.x, cursorScreenPos.y, effectiveCharWidth, effectiveCharHeight);
                    const charData = engine.worldData[key];
                    if (charData) {
                        const char = engine.isImageData(charData) ? '' : engine.getCharacter(charData);
                        ctx.fillStyle = CURSOR_TEXT_COLOR;
                        ctx.fillText(char, cursorScreenPos.x, cursorScreenPos.y + verticalTextOffset);
                    }
                }
            }
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
        if (dialogueEnabled) {
            renderDialogue({
                canvasWidth: cssWidth,
                canvasHeight: cssHeight,
                ctx,
                dialogueText: engine.dialogueText
            });
        }

        // === Render Debug Dialogue ===
        if (engine.settings.isDebugVisible) {
            renderDebugDialogue({
                canvasWidth: cssWidth,
                canvasHeight: cssHeight,
                ctx,
                debugText: enhancedDebugText
            });
            
            // === Render Monogram Controls ===
            renderMonogramControls({
                canvasWidth: cssWidth,
                canvasHeight: cssHeight,
                ctx,
                monogramText: monogramControlsText
            });
        }


        ctx.restore();
        // --- End Drawing ---
    }, [engine, engine.backgroundMode, engine.backgroundImage, engine.commandData, engine.commandState, engine.lightModeData, engine.chatData, engine.searchData, engine.isSearchActive, engine.searchPattern, canvasSize, cursorColorAlternate, isMiddleMouseDownRef.current, intermediatePanOffsetRef.current, cursorTrail, mouseWorldPos, isShiftPressed, shiftDragStartPos, selectedImageKey, renderDialogue, renderDebugDialogue, renderMonogramControls, enhancedDebugText, monogramControlsText, monogramSystem, showCursor, monogramEnabled, dialogueEnabled, drawArrow, getViewportEdgeIntersection, isBlockInViewport, updateBoundsIndex, drawHoverPreview, drawModeSpecificPreview, drawPositionInfo, findTextBlock, findImageAtPosition]);


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
                clickedWorldY <= engine.commandState.commandStartPos.y + engine.commandState.matchedCommands.length) {
                
                const suggestionIndex = clickedWorldY - engine.commandState.commandStartPos.y - 1;
                if (suggestionIndex >= 0 && suggestionIndex < engine.commandState.matchedCommands.length) {
                    const selectedCommand = engine.commandState.matchedCommands[suggestionIndex];
                    
                    // Use the command system to populate the input with the selected command
                    if (engine.commandSystem && typeof engine.commandSystem.selectCommand === 'function') {
                        engine.commandSystem.selectCommand(selectedCommand);
                    }
                    return; // Command was selected, don't process as regular click
                }
            }
        }
        
        // Set flag to prevent trail creation from click movement
        isClickMovementRef.current = true;
        
        // Pass to engine's regular click handler
        engine.handleCanvasClick(clickX, clickY, false, e.shiftKey);
        
        canvasRef.current?.focus(); // Ensure focus for keyboard
    }, [engine, canvasSize, router, handleNavClick, handleCoordinateClick, handleColorFilterClick, handleSortModeClick, handleStateClick, handleIndexClick]);

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
                // Clear any image selection if clicking on empty space
                setSelectedImageKey(null);
            }
        }
        
        canvasRef.current?.focus(); // Ensure focus for keyboard
    }, [engine, findTextBlock, findImageAtPosition]);
    
    const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        if (e.button === 1) { // Middle mouse button - panning
            e.preventDefault(); // Prevent default scrolling behavior
            isMiddleMouseDownRef.current = true;
            const info = engine.handlePanStart(e.clientX, e.clientY);
            panStartInfoRef.current = info;
            intermediatePanOffsetRef.current = { ...engine.viewOffset }; // Clone to avoid reference issues
            if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
        } else if (e.button === 0) { // Left mouse button
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            if (e.shiftKey) {
                // Track shift+drag start position and clear any existing selection
                isSelectingMouseDownRef.current = false; // Ensure selection is disabled
                // Clear any existing selection by using the engine's click handler with clearSelection=true
                engine.handleCanvasClick(x, y, true);
                const worldPos = engine.screenToWorld(x, y, engine.zoomLevel, engine.viewOffset);
                setShiftDragStartPos({
                    x: Math.floor(worldPos.x),
                    y: Math.floor(worldPos.y)
                });
            } else {
                // Clear image selection when starting regular selection
                setSelectedImageKey(null);
                
                // Regular selection start
                isSelectingMouseDownRef.current = true; // Track mouse down state
                engine.handleSelectionStart(x, y); // Let the engine manage selection state
            }
            
            canvasRef.current?.focus();
        }
    }, [engine]);

    const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Always track mouse position for preview (when not actively dragging)
        if (!isMiddleMouseDownRef.current && !isSelectingMouseDownRef.current) {
            const worldPos = engine.screenToWorld(x, y, engine.zoomLevel, engine.viewOffset);
            const snappedWorldPos = {
                x: Math.floor(worldPos.x),
                y: Math.floor(worldPos.y)
            };
            setMouseWorldPos(snappedWorldPos);
            
            // Update monogram trail with mouse position
            if (monogramEnabled && monogramSystem.options.interactiveTrails) {
                monogramSystem.updateMousePosition(worldPos);
            }
        }

        if (isMiddleMouseDownRef.current && panStartInfoRef.current) {
            // Handle panning move
            intermediatePanOffsetRef.current = engine.handlePanMove(e.clientX, e.clientY, panStartInfoRef.current);
        } else if (isSelectingMouseDownRef.current && !shiftDragStartPos) { // Check mouse down ref and not shift+dragging
            // Handle selection move
            engine.handleSelectionMove(x, y); // Update engine's selection end
        }
    }, [engine, shiftDragStartPos]);

    const handleCanvasMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (isMiddleMouseDownRef.current && e.button === 1) { // Middle mouse button - panning end
            isMiddleMouseDownRef.current = false;
            engine.handlePanEnd(intermediatePanOffsetRef.current); // Commit final offset
            panStartInfoRef.current = null;
            if (canvasRef.current) canvasRef.current.style.cursor = 'text';
        }

        if (e.button === 0) { // Left mouse button
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
                            
                            // Find the original image key
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
                        } else {
                            // If no image, check for text block at start position
                            const textBlock = findTextBlock(shiftDragStartPos, engine.worldData, engine);
                            
                            if (textBlock.length > 0) {
                            
                            
                            // Capture all character data from the text block
                            const capturedChars: Array<{x: number, y: number, char: string}> = [];
                            
                            for (const pos of textBlock) {
                                const key = `${pos.x},${pos.y}`;
                                const data = engine.worldData[key];
                                if (data) {
                                    const char = engine.isImageData(data) ? '' : engine.getCharacter(data);
                                    if (char) {
                                        capturedChars.push({ x: pos.x, y: pos.y, char });
                                    } else {
                                    }
                                } else {
                                }
                            }
                            
                            
                            if (capturedChars.length > 0) {
                                // Prepare batch move data
                                const moves = capturedChars.map(({ x, y, char }) => ({
                                    fromX: x,
                                    fromY: y,
                                    toX: x + distanceX,
                                    toY: y + distanceY,
                                    char
                                }));
                                
                                
                                // Execute batch move
                                engine.batchMoveCharacters(moves);
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
    }, [engine, shiftDragStartPos, findTextBlock, findImageAtPosition]);

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


    const handleCanvasKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
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
        
        // Let engine handle all key input (including regular typing)
        const preventDefault = engine.handleKeyDown(e.key, e.ctrlKey, e.metaKey, e.shiftKey);
        if (preventDefault) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, [engine, handleKeyDownFromController, selectedImageKey]);

    return (
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
            tabIndex={0}
            style={{ 
                display: 'block', 
                outline: 'none', 
                width: '100%', 
                height: '100%', 
                cursor: 'text',
                position: 'relative',
                zIndex: 1
            }}
        />
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