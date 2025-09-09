// components/BitCanvas.tsx
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { WorldData, Point, WorldEngine, PanStartInfo } from './world.engine'; // Adjust path as needed
import { useDialogue, useDebugDialogue } from './dialogue';
import { useMonogramSystem } from './monogram';
import { useControllerSystem, createMonogramController, createCameraController } from './controllers';
import { detectTextBlocks, extractLineCharacters } from './bit.blocks';

// --- Constants --- (Copied and relevant ones kept)
const GRID_COLOR = '#F2F2F233';
const CURSOR_COLOR_PRIMARY = '#003DFF55';
const CURSOR_COLOR_SECONDARY = '#0022DD55';
const CURSOR_COLOR_SAVE = '#F2F2F2'; // Green color for saving state
const CURSOR_COLOR_ERROR = '#FF0000'; // Red color for error state
const CURSOR_TEXT_COLOR = '#FFFFFF';
const BACKGROUND_COLOR = '#FFFFFF55';
const DRAW_GRID = true;
const GRID_LINE_WIDTH = 1;
const CURSOR_TRAIL_FADE_MS = 200; // Time in ms for trail to fully fade

// --- Block & Debug Constants ---
const BLOCK_COLOR = '#FFA500'; // Orange color for blocks (fallback)
const DEBUG_SCAFFOLD_COLOR = '#00FF00'; // Green for debug scaffolds
const DEBUG_BOUNDARY_COLOR = '#FF00FF'; // Magenta for boundaries
const SHOW_DEBUG_SCAFFOLDS = true;

// --- Heat Map Color Gradient ---
const HEAT_MAP_COLORS = [
    { r: 173, g: 173, b: 173 },   // Orange (closest)
    // { r: 255, g: 255, b: 0 },   // Yellow
    // { r: 0, g: 255, b: 0 },     // Green
    // { r: 0, g: 0, b: 255 }      // Blue (farthest)
];
const MAX_HEAT_DISTANCE = 40; // Distance at which blocks become fully "cold" (blue)

// --- Waypoint Arrow Constants ---
const ARROW_SIZE = 12; // Size of waypoint arrows
const ARROW_MARGIN = 20; // Distance from viewport edge

// --- Pan Trail Constants ---
const MAX_TRAIL_POINTS = 50; // Maximum points to track
const TRAIL_FADE_DURATION = 3000; // 3 seconds for trail to fade
const SPLINE_COLOR = '#FFFFFF'; // White for straight spline
const CURVE_COLOR = '#0066FF'; // Blue for curved spline
const TRAIL_LINE_WIDTH = 2;


interface CursorTrailPosition {
    x: number;
    y: number;
    timestamp: number;
}

interface PanTrailPoint {
    worldX: number;
    worldY: number;
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
    const lastCursorPosRef = useRef<Point | null>(null);
    const router = useRouter();
    
    // Cache for background images to avoid reloading
    const backgroundImageRef = useRef<HTMLImageElement | null>(null);
    const backgroundImageUrlRef = useRef<string | null>(null);
    
    // Dialogue system
    const { renderDialogue, renderDebugDialogue, renderNavDialogue, renderMonogramControls, handleNavClick } = useDialogue();
    
    // Debug dialogue system
    const { debugText } = useDebugDialogue(engine);
    
    // Monogram system for psychedelic patterns
    const monogramSystem = useMonogramSystem();


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
        console.log(`${action} state: ${state}`);
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
        console.log(`Navigate clicked for state: ${state}`);
        if (engine.username) {
            router.push(`/@${engine.username}/${state}`);
        }
        engine.setIsNavVisible(false);
    }, [engine, router]);
    
    // Load publish statuses when nav opens or states change
    useEffect(() => {
        if (engine.isNavVisible && engine.navMode === 'states') {
            loadStatePublishStatuses();
        }
    }, [engine.isNavVisible, engine.navMode, engine.availableStates, loadStatePublishStatuses]);

    

    useEffect(() => {
        registerGroup(createMonogramController(monogramSystem));
        registerGroup(createCameraController(engine));
    }, [registerGroup]);
    
    // Enhanced debug text without monogram info - only calculate if debug is visible
    const enhancedDebugText = engine.settings.isDebugVisible ? `${debugText}
Camera & Viewport Controls:
  Home: Return to origin
  Ctrl+H: Reset zoom level` : '';
    
    // Monogram controls text - only show if debug is visible
    const monogramControlsText = engine.settings.isDebugVisible ? `Psychedelic Pattern Controls:
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
    
    // Pan trail tracking
    const [panTrail, setPanTrail] = useState<PanTrailPoint[]>([]);
    const lastViewOffsetRef = useRef<Point | null>(null);

    // --- Heat Map Color Functions ---
    const interpolateColor = useCallback((color1: {r: number, g: number, b: number}, color2: {r: number, g: number, b: number}, factor: number) => {
        return {
            r: Math.round(color1.r + factor * (color2.r - color1.r)),
            g: Math.round(color1.g + factor * (color2.g - color1.g)),
            b: Math.round(color1.b + factor * (color2.b - color1.b))
        };
    }, []);

    const getHeatMapColor = useCallback((distance: number): string => {
        // Normalize distance to 0-1 range
        const normalizedDistance = Math.min(distance / MAX_HEAT_DISTANCE, 1);
        
        // Calculate which color segment we're in
        const segmentSize = 1 / (HEAT_MAP_COLORS.length - 1);
        const segmentIndex = Math.floor(normalizedDistance / segmentSize);
        const segmentProgress = (normalizedDistance % segmentSize) / segmentSize;
        
        // Handle edge case for maximum distance
        if (segmentIndex >= HEAT_MAP_COLORS.length - 1) {
            const color = HEAT_MAP_COLORS[HEAT_MAP_COLORS.length - 1];
            return `rgb(${color.r}, ${color.g}, ${color.b})`;
        }
        
        // Interpolate between two adjacent colors
        const color1 = HEAT_MAP_COLORS[segmentIndex];
        const color2 = HEAT_MAP_COLORS[segmentIndex + 1];
        const interpolated = interpolateColor(color1, color2, segmentProgress);
        
        return `rgb(${interpolated.r}, ${interpolated.g}, ${interpolated.b})`;
    }, [interpolateColor]);

    // --- Waypoint Arrow Functions ---
    const isBlockInViewport = useCallback((worldX: number, worldY: number, viewBounds: {minX: number, maxX: number, minY: number, maxY: number}): boolean => {
        return worldX >= viewBounds.minX && worldX <= viewBounds.maxX && 
               worldY >= viewBounds.minY && worldY <= viewBounds.maxY;
    }, []);

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

    // --- Pan Trail Drawing Functions ---
    const drawStraightSpline = useCallback((ctx: CanvasRenderingContext2D, points: PanTrailPoint[], currentZoom: number, currentOffset: Point) => {
        if (points.length < 2) return;
        
        const now = Date.now();
        ctx.strokeStyle = SPLINE_COLOR;
        ctx.lineWidth = TRAIL_LINE_WIDTH;
        ctx.setLineDash([]);
        
        // Convert trail points to screen coordinates
        const screenPoints = points.map(point => ({
            ...engine.worldToScreen(point.worldX, point.worldY, currentZoom, currentOffset),
            timestamp: point.timestamp
        }));
        
        // Draw straight line segments between points
        ctx.beginPath();
        ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
        
        for (let i = 1; i < screenPoints.length; i++) {
            const age = now - screenPoints[i].timestamp;
            const opacity = Math.max(0, 1 - (age / TRAIL_FADE_DURATION));
            
            if (opacity > 0) {
                ctx.globalAlpha = opacity;
                ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
            }
        }
        
        ctx.stroke();
        ctx.globalAlpha = 1; // Reset opacity
    }, [engine]);


    const drawCurvedSpline = useCallback((ctx: CanvasRenderingContext2D, points: PanTrailPoint[], currentZoom: number, currentOffset: Point) => {
        if (points.length < 3) return;
        
        const now = Date.now();
        ctx.strokeStyle = CURVE_COLOR;
        ctx.lineWidth = TRAIL_LINE_WIDTH;
        ctx.setLineDash([]);
        
        // Convert trail points to screen coordinates
        const screenPoints = points.map(point => ({
            ...engine.worldToScreen(point.worldX, point.worldY, currentZoom, currentOffset),
            timestamp: point.timestamp
        }));
        
        // Draw smooth curves using quadratic Bezier curves
        for (let i = 0; i < screenPoints.length - 2; i++) {
            const age = now - screenPoints[i + 1].timestamp;
            const opacity = Math.max(0, 1 - (age / TRAIL_FADE_DURATION));
            
            if (opacity > 0) {
                ctx.globalAlpha = opacity;
                ctx.beginPath();
                
                const p0 = screenPoints[i];
                const p1 = screenPoints[i + 1];
                const p2 = screenPoints[i + 2];
                
                // Calculate control points for smooth curve
                const cp1x = p0.x + (p1.x - p0.x) * 0.5;
                const cp1y = p0.y + (p1.y - p0.y) * 0.5;
                const cp2x = p1.x + (p2.x - p1.x) * 0.5;
                const cp2y = p1.y + (p2.y - p1.y) * 0.5;
                
                ctx.moveTo(cp1x, cp1y);
                ctx.quadraticCurveTo(p1.x, p1.y, cp2x, cp2y);
                ctx.stroke();
            }
        }
        
        ctx.globalAlpha = 1; // Reset opacity
    }, [engine]);

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


    // Track pan movement for trail effect
    useEffect(() => {
        if (typeof window === 'undefined') return; // Skip during SSR
        
        // Get viewport center in world coordinates (like the debug circles)
        const viewportCenter = engine.getViewportCenter ? engine.getViewportCenter() : null;
        if (!viewportCenter) return;
        
        
        // Only add to trail if viewport center has actually changed
        if (!lastViewOffsetRef.current || 
            viewportCenter.x !== lastViewOffsetRef.current.x || 
            viewportCenter.y !== lastViewOffsetRef.current.y) {
            
            const now = Date.now();
            const newTrailPoint = {
                worldX: viewportCenter.x,
                worldY: viewportCenter.y,
                timestamp: now
            };
            
            setPanTrail(prev => {
                // Add new point and filter out old ones
                const cutoffTime = now - TRAIL_FADE_DURATION;
                const updated = [newTrailPoint, ...prev.filter(point => point.timestamp >= cutoffTime)];
                
                // Limit to maximum trail points
                return updated.slice(0, MAX_TRAIL_POINTS);
            });
            
            lastViewOffsetRef.current = {...viewportCenter};
        }
    }, [engine.viewOffset, engine.zoomLevel, engine.getViewportCenter]); // Include zoom since it affects viewport center

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
            for (let worldX = Math.floor(startWorldX); worldX <= Math.ceil(endWorldX); worldX++) {
                const screenX = Math.floor((worldX - currentOffset.x) * effectiveCharWidth) + 0.5 / dpr;
                if (screenX >= -effectiveCharWidth && screenX <= cssWidth + effectiveCharWidth) { ctx.moveTo(screenX, 0); ctx.lineTo(screenX, cssHeight); }
            }
            for (let worldY = Math.floor(startWorldY); worldY <= Math.ceil(endWorldY); worldY++) {
                const screenY = Math.floor((worldY - currentOffset.y) * effectiveCharHeight) + 0.5 / dpr;
                if (screenY >= -effectiveCharHeight && screenY <= cssHeight + effectiveCharHeight) { ctx.moveTo(0, screenY); ctx.lineTo(cssWidth, screenY); }
            }
            ctx.stroke();
        }

        // === Render Monogram Patterns ===
        if (monogramEnabled) {
            const monogramPattern = monogramSystem.generateMonogramPattern(
                startWorldX, startWorldY, endWorldX, endWorldY
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
                        const char = charData ? engine.getCharacter(charData) : '';
                        if ((!char || char.trim() === '') && !engine.commandData[textKey] && !(engine.settings.isDeepspawnVisible && engine.deepspawnData[`deepspawn_${textKey}`])) {
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
                const char = typeof charData === 'string' ? charData : charData.char;
                const color = typeof charData === 'object' && charData.style?.color ? charData.style.color : '#808080';
                const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                    if (char && char.trim() !== '') {
                        ctx.fillStyle = color; // Use character's color or default
                        ctx.fillText(char, screenPos.x, screenPos.y + verticalTextOffset);
                    }
                }
            }
        }

        ctx.fillStyle = engine.textColor;
        for (const key in engine.worldData) {
            // Skip block, deepspawn, and label data - we render those separately
            if (key.startsWith('block_') || key.startsWith('deepspawn_') || key.startsWith('label_')) continue;
            
            const [xStr, yStr] = key.split(',');
            const worldX = parseInt(xStr, 10); const worldY = parseInt(yStr, 10);
            if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                const charData = engine.worldData[key];
                const char = charData ? engine.getCharacter(charData) : '';
                const charStyle = charData ? engine.getCharacterStyle(charData) : undefined;
                const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                    if (char && char.trim() !== '') {
                        // Apply text background if specified
                        if (charStyle && charStyle.background) {
                            ctx.fillStyle = charStyle.background;
                            ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                        }
                        // Apply text color
                        ctx.fillStyle = (charStyle && charStyle.color) || engine.textColor;
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
                const char = typeof charData === 'string' ? charData : charData.char;
                const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                    // Use different colors: orange for command line, gray for suggestions, white for selected
                    if (worldY === engine.commandState.commandStartPos.y) {
                        ctx.fillStyle = '#FF6B35'; // Orange for command line
                    } else if (engine.commandState.isActive && worldY === engine.commandState.commandStartPos.y + 1 + engine.commandState.selectedIndex) {
                        ctx.fillStyle = '#FFFFFF'; // White for selected suggestion
                    } else {
                        ctx.fillStyle = '#888888'; // Gray for other suggestions
                    }
                    ctx.fillText(char, screenPos.x, screenPos.y + verticalTextOffset);
                }
            }
        }
        ctx.fillStyle = engine.textColor; // Reset to normal text color


        // === Debug Scaffolds === (Green dot removed)

        // // === Render Pan Trails ===
        // if (panTrail.length > 0) {
        //     // Draw only straight spline (removed blue curved spline)
        //     drawStraightSpline(ctx, panTrail, currentZoom, currentOffset);
        // }
        
        // // === Render Angle Calculation Points ===
        // const debugData = engine.getAngleDebugData();
        // if (debugData) {
        //     // Draw current point (most recent) as filled cell
        //     const currentScreen = engine.worldToScreen(debugData.firstPoint.x, debugData.firstPoint.y, currentZoom, currentOffset);
        //     ctx.fillStyle = '#000000';
        //     ctx.fillRect(currentScreen.x, currentScreen.y, effectiveCharWidth, effectiveCharHeight);
            
        //     // Draw previous point as filled cell
        //     const previousScreen = engine.worldToScreen(debugData.lastPoint.x, debugData.lastPoint.y, currentZoom, currentOffset);
        //     ctx.fillStyle = '#000000';
        //     ctx.fillRect(previousScreen.x, previousScreen.y, effectiveCharWidth, effectiveCharHeight);
            
        //     // Draw line between center of cells
        //     ctx.strokeStyle = '#000000';
        //     ctx.lineWidth = 1;
        //     ctx.setLineDash([5, 5]); // Dashed line
        //     ctx.beginPath();
        //     ctx.moveTo(currentScreen.x + effectiveCharWidth/2, currentScreen.y + effectiveCharHeight/2);
        //     ctx.lineTo(previousScreen.x + effectiveCharWidth/2, previousScreen.y + effectiveCharHeight/2);
        //     ctx.stroke();
        //     ctx.setLineDash([]); // Reset dash
        // }

        // === Render Deepspawn Objects with Heat Map Colors ===
        if (engine.settings.isDeepspawnVisible) {
            for (const key in engine.deepspawnData) {
                if (key.startsWith('deepspawn_')) {
                    const coords = key.substring('deepspawn_'.length);
                    const [xStr, yStr] = coords.split(',');
                    const worldX = parseInt(xStr, 10);
                    const worldY = parseInt(yStr, 10);
                    
                    if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                        const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                        if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                            // Calculate distance from cursor to this deepspawn character
                            const deltaX = worldX - engine.cursorPos.x;
                            const deltaY = worldY - engine.cursorPos.y;
                            const distanceFromCursor = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                            
                            // Get heat map color based on distance, but make it translucent
                            const heatColor = getHeatMapColor(distanceFromCursor);
                            
                            // Render the deepspawn character
                            const charData = engine.deepspawnData[key];
                            const char = engine.getCharacter(charData);
                            ctx.fillStyle = 'rgba(136, 136, 136, 0.7)'; // Translucent gray, similar to command suggestions
                            ctx.fillText(char, screenPos.x, screenPos.y + verticalTextOffset);
                        }
                    }
                }
            }
        }

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
                            const char = typeof charData === 'string' ? charData : charData.char;
                            matchText += char;
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
                        const charString = engine.getCharacter(charData);
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

        // === Render Blocks with Heat Map Colors ===
        const blocksToDebug = []; // Store block positions for debug lines
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
                        
                        // Get heat map color based on distance
                        const heatColor = getHeatMapColor(distanceFromCursor);
                        ctx.fillStyle = heatColor;
                        
                        // Fill entire cell with heat-mapped color
                        ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                        
                        // Store for debug lines
                        blocksToDebug.push({
                            worldX, worldY, screenPos, heatColor
                        });
                    }
                }
            }
        }
        
        // // === Debug Connection Lines ===
        // if (SHOW_DEBUG_SCAFFOLDS && engine.getViewportCenter && blocksToDebug.length > 0) {
        //     const center = engine.getViewportCenter();
        //     const centerScreen = engine.worldToScreen(center.x, center.y, currentZoom, currentOffset);
            
        //     // Draw lines from center to each block
        //     for (const block of blocksToDebug) {
        //         ctx.strokeStyle = block.heatColor;
        //         ctx.lineWidth = 1 / dpr;
        //         ctx.setLineDash([2, 2]); // Dashed lines
        //         ctx.globalAlpha = 0.6; // Semi-transparent
                
        //         ctx.beginPath();
        //         ctx.moveTo(
        //             centerScreen.x + effectiveCharWidth/2, 
        //             centerScreen.y + effectiveCharHeight/2
        //         );
        //         ctx.lineTo(
        //             block.screenPos.x + effectiveCharWidth/2, 
        //             block.screenPos.y + effectiveCharHeight/2
        //         );
        //         ctx.stroke();
        //     }
            
        //     // Draw individual boundary circles around each block
        //     for (const block of blocksToDebug) {
        //         const blockCenter = {
        //             x: block.screenPos.x + effectiveCharWidth/2,
        //             y: block.screenPos.y + effectiveCharHeight/2
        //         };
                
        //         // Small spawn boundary around block (lighter color)
        //         ctx.strokeStyle = block.heatColor;
        //         ctx.globalAlpha = 0.3;
        //         ctx.lineWidth = 1 / dpr;
        //         ctx.setLineDash([1, 1]);
        //         ctx.beginPath();
        //         const blockSpawnRadius = 6 * effectiveCharWidth; // MIN_BLOCK_DISTANCE
        //         ctx.arc(blockCenter.x, blockCenter.y, blockSpawnRadius, 0, 2 * Math.PI);
        //         ctx.stroke();
                
        //         // Tiny center dot for block
        //         ctx.fillStyle = block.heatColor;
        //         ctx.globalAlpha = 0.8;
        //         ctx.beginPath();
        //         ctx.arc(blockCenter.x, blockCenter.y, 2, 0, 2 * Math.PI);
        //         ctx.fill();
        //     }
            
        //     ctx.globalAlpha = 1; // Reset
        //     ctx.setLineDash([]); // Reset
        // }

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
                        // Calculate distance from cursor for heat map color
                        const deltaX = worldX - engine.cursorPos.x;
                        const deltaY = worldY - engine.cursorPos.y;
                        const distanceFromCursor = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                        
                        // Get heat map color
                        const heatColor = getHeatMapColor(distanceFromCursor);
                        
                        // Adjust intersection point to be within margin from edge
                        const edgeBuffer = ARROW_MARGIN;
                        let adjustedX = intersection.x;
                        let adjustedY = intersection.y;
                        
                        // Clamp to viewport bounds with margin
                        adjustedX = Math.max(edgeBuffer, Math.min(cssWidth - edgeBuffer, adjustedX));
                        adjustedY = Math.max(edgeBuffer, Math.min(cssHeight - edgeBuffer, adjustedY));
                        
                        // Draw the waypoint arrow
                        drawArrow(ctx, adjustedX, adjustedY, intersection.angle, heatColor);
                        
                        // Add distance indicator for blocks
                        const viewportCenter = engine.getViewportCenter();
                        const deltaCenterX = worldX - viewportCenter.x;
                        const deltaCenterY = worldY - viewportCenter.y;
                        const distanceFromCenter = Math.round(Math.sqrt(deltaCenterX * deltaCenterX + deltaCenterY * deltaCenterY));
                        
                        ctx.fillStyle = heatColor;
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

        // === Render Cluster Waypoint Arrows ===
        if (engine.clustersVisible && engine.clusterLabels.length > 0) {
            console.log('Rendering cluster waypoints. Total clusters:', engine.clusterLabels.length);
            console.log('View bounds:', viewBounds);
            
            for (const clusterLabel of engine.clusterLabels) {
            const { position, text } = clusterLabel;
            console.log('Checking cluster:', { text, position });
            
            // Check if cluster is outside current viewport
            const isClusterVisible = position.x >= viewBounds.minX && 
                                   position.x <= viewBounds.maxX &&
                                   position.y >= viewBounds.minY && 
                                   position.y <= viewBounds.maxY;
            
            console.log('Cluster visible:', isClusterVisible);
            
            if (!isClusterVisible) {
                console.log('Drawing green arrow for off-screen cluster:', text);
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

        // // === Render Panning Direction ===
        // if (engine.panningDirection !== null && engine.getViewportCenter) {
        //     const center = engine.getViewportCenter();
        //     const centerScreen = engine.worldToScreen(center.x, center.y, currentZoom, currentOffset);
            
        //     const lineLength = 50; // Length of the direction indicator line in pixels
        //     const angle = engine.panningDirection;

        //     const startX = centerScreen.x + (effectiveCharWidth / 2);
        //     const startY = centerScreen.y + (effectiveCharHeight / 2);
        //     const endX = startX + lineLength * Math.cos(angle);
        //     const endY = startY + lineLength * Math.sin(angle);

        //     ctx.beginPath();
        //     ctx.moveTo(startX, startY);
        //     ctx.lineTo(endX, endY);
        //     ctx.strokeStyle = 'rgba(0, 102, 255, 0.8)'; // Blue color for the line
        //     ctx.lineWidth = 2;
        //     ctx.stroke();
        // }

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

        // === Render Text Block Borders === (DISABLED FOR PERFORMANCE)
        // Commented out - was causing performance issues
        // if (currentZoom >= 0.5) {
        //     const combinedWorldData: WorldData = { ...engine.worldData, ...engine.lightModeData };
        //     
        //     // Limit viewport scanning to reasonable range
        //     const maxLines = Math.min(50, endWorldY - startWorldY + 5);
        //     let linesProcessed = 0;
        //     
        //     for (let y = startWorldY; y <= endWorldY && linesProcessed < maxLines; y++, linesProcessed++) {
        //         const lineChars = extractLineCharacters(combinedWorldData, y, false);
        //         if (lineChars.length === 0) continue;
        //         
        //         const textBlocks = detectTextBlocks(lineChars);
        //         
        //         for (const block of textBlocks) {
        //             // Quick bounds check before expensive screen conversion
        //             if (block.start > endWorldX + 5 || block.end < startWorldX - 5) continue;
        //             
        //             const startScreenPos = engine.worldToScreen(block.start, y, currentZoom, currentOffset);
        //             const endScreenPos = engine.worldToScreen(block.end + 1, y + 1, currentZoom, currentOffset);
        //             
        //             // Simple visibility check
        //             if (startScreenPos.x < cssWidth + 50 && endScreenPos.x > -50) {
        //                 ctx.strokeStyle = '#00000020'; // Semi-transparent to reduce visual noise
        //                 ctx.lineWidth = 1;
        //                 ctx.strokeRect(
        //                     startScreenPos.x - 1, 
        //                     startScreenPos.y - 1, 
        //                     (endScreenPos.x - startScreenPos.x) + 1, 
        //                     effectiveCharHeight + 1
        //                 );
        //             }
        //         }
        //     }
        // }

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
                
                // Don't render cursor if there's chat data at this position (chat data already has its own styling)
                if (!engine.chatData[key]) {
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
                        const char = engine.getCharacter(charData);
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
                getStatePublishStatus: getStatePublishStatus
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
    }, [engine, engine.backgroundMode, engine.backgroundImage, engine.deepspawnData, engine.commandData, engine.commandState, engine.lightModeData, engine.chatData, engine.searchData, engine.isSearchActive, engine.searchPattern, canvasSize, cursorColorAlternate, isMiddleMouseDownRef.current, intermediatePanOffsetRef.current, cursorTrail, panTrail, drawStraightSpline, drawCurvedSpline, renderDialogue, renderDebugDialogue, renderMonogramControls, enhancedDebugText, monogramControlsText, monogramSystem, showCursor, monogramEnabled, dialogueEnabled]);


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
        
        // Set flag to prevent trail creation from click movement
        isClickMovementRef.current = true;
        
        // Pass to engine's regular click handler
        engine.handleCanvasClick(clickX, clickY, false, e.shiftKey);
        
        canvasRef.current?.focus(); // Ensure focus for keyboard
    }, [engine, canvasSize, router, handleNavClick, handleCoordinateClick, handleColorFilterClick, handleSortModeClick, handleStateClick, handleIndexClick]);
    
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
        } else if (e.button === 0) { // Left mouse button - selection start
            isSelectingMouseDownRef.current = true; // Track mouse down state
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            engine.handleSelectionStart(x, y); // Let the engine manage selection state
            canvasRef.current?.focus();
        }
    }, [engine]);

    const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        if (isMiddleMouseDownRef.current && panStartInfoRef.current) {
            // Handle panning move
            intermediatePanOffsetRef.current = engine.handlePanMove(e.clientX, e.clientY, panStartInfoRef.current);
        } else if (isSelectingMouseDownRef.current) { // Check mouse down ref
            // Handle selection move
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            engine.handleSelectionMove(x, y); // Update engine's selection end
        }
    }, [engine]);

    const handleCanvasMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (isMiddleMouseDownRef.current && e.button === 1) { // Middle mouse button - panning end
            isMiddleMouseDownRef.current = false;
            engine.handlePanEnd(intermediatePanOffsetRef.current); // Commit final offset
            panStartInfoRef.current = null;
            if (canvasRef.current) canvasRef.current.style.cursor = 'text';
        }

        if (isSelectingMouseDownRef.current && e.button === 0) { // Left mouse button - selection end
            isSelectingMouseDownRef.current = false; // Stop tracking mouse down state
            engine.handleSelectionEnd(); // Finalize selection state in engine
        }
    }, [engine]);

    const handleCanvasMouseLeave = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
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
            // Controller handled it, ensure prevention
            e.preventDefault();
            e.stopPropagation();
        } else {
            // Pass to engine's handler for regular controls if not handled by controller system
            const preventDefault = engine.handleKeyDown(e.key, e.ctrlKey, e.metaKey, e.shiftKey);
            if (preventDefault) {
                e.preventDefault();
                e.stopPropagation();
            }
        }
    }, [engine, handleKeyDownFromController]);

    return (
        <canvas
            ref={canvasRef}
            className={className}
            onClick={handleCanvasClick}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseLeave}
            onKeyDown={handleCanvasKeyDown}
            tabIndex={0}
            style={{ display: 'block', outline: 'none', width: '100%', height: '100%', cursor: 'text' /* Default cursor */ }}
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