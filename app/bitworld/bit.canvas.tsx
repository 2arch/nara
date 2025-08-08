// components/BitCanvas.tsx
import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { WorldData, Point, WorldEngine, PanStartInfo } from './world.engine'; // Adjust path as needed
import { useDialogue, useDebugDialogue } from './dialogue';

// --- Constants --- (Copied and relevant ones kept)
const FONT_FAMILY = 'IBM Plex Mono';
const GRID_COLOR = '#F2F2F2';
const TEXT_COLOR = '#161616';
const CURSOR_COLOR_PRIMARY = '#FF6B35';
const CURSOR_COLOR_SECONDARY = '#FFA500';
const CURSOR_COLOR_SAVE = '#FFFF00'; // Green color for saving state
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
}

export function BitCanvas({ engine, cursorColorAlternate, className }: BitCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const devicePixelRatioRef = useRef(1);
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
    const [cursorTrail, setCursorTrail] = useState<CursorTrailPosition[]>([]);
    const lastCursorPosRef = useRef<Point | null>(null);
    
    // Dialogue system
    const { renderDialogue } = useDialogue();
    
    // Debug dialogue system
    const { debugText } = useDebugDialogue(engine);
    const { renderDebugDialogue } = useDialogue();
    
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
        
        // Draw arrow shape (pointing right, will be rotated)
        ctx.beginPath();
        ctx.moveTo(ARROW_SIZE, 0);
        ctx.lineTo(-ARROW_SIZE/2, -ARROW_SIZE/2);
        ctx.lineTo(-ARROW_SIZE/4, 0);
        ctx.lineTo(-ARROW_SIZE/2, ARROW_SIZE/2);
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

        // --- Actual Drawing (Copied from previous `draw` function) ---
        ctx.save();
        ctx.scale(dpr, dpr);
        
        // Replace fillRect with clearRect for transparency
        // ctx.clearRect(0, 0, cssWidth, cssHeight);
        ctx.fillStyle = BACKGROUND_COLOR;
        ctx.fillRect(0, 0, cssWidth, cssHeight);
        
        ctx.imageSmoothingEnabled = false;
        ctx.font = `${effectiveFontSize}px ${FONT_FAMILY}`;
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

        ctx.fillStyle = TEXT_COLOR;
        const verticalTextOffset = (effectiveCharHeight - effectiveFontSize) / 2 + (effectiveFontSize * 0.1);
        for (const key in engine.worldData) {
            // Skip block and deepspawn data - we render those separately
            if (key.startsWith('block_') || key.startsWith('deepspawn_')) continue;
            
            const [xStr, yStr] = key.split(',');
            const worldX = parseInt(xStr, 10); const worldY = parseInt(yStr, 10);
            if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                const char = engine.worldData[key];
                const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                    ctx.fillText(char, screenPos.x, screenPos.y + verticalTextOffset);
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
                const char = engine.commandData[key];
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
        ctx.fillStyle = TEXT_COLOR; // Reset to normal text color

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
                        
                        // Get heat map color based on distance
                        const heatColor = getHeatMapColor(distanceFromCursor);
                        ctx.fillStyle = heatColor;
                        
                        // Fill entire cell with heat-mapped color
                        ctx.fillRect(screenPos.x, screenPos.y, effectiveCharWidth, effectiveCharHeight);
                        
                        // Render the deepspawn character on top
                        const char = engine.deepspawnData[key];
                        ctx.fillStyle = '#000000'; // Black text on colored background
                        ctx.fillText(char, screenPos.x, screenPos.y + verticalTextOffset);
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
        const viewBounds = {
            minX: Math.floor(startWorldX),
            maxX: Math.ceil(endWorldX),
            minY: Math.floor(startWorldY),
            maxY: Math.ceil(endWorldY)
        };
        
        const viewportCenterScreen = { x: cssWidth / 2, y: cssHeight / 2 };
        
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
            // Determine cursor color based on engine state
            if (engine.worldPersistenceError) {
                ctx.fillStyle = CURSOR_COLOR_ERROR;
            } else if (engine.isSavingWorld) {
                ctx.fillStyle = CURSOR_COLOR_SAVE;
            } else {
                ctx.fillStyle = cursorColorAlternate ? CURSOR_COLOR_SECONDARY : CURSOR_COLOR_PRIMARY;
            }
            
            ctx.fillRect(cursorScreenPos.x, cursorScreenPos.y, effectiveCharWidth, effectiveCharHeight);
            const key = `${engine.cursorPos.x},${engine.cursorPos.y}`;
            if (engine.worldData[key]) {
                ctx.fillStyle = CURSOR_TEXT_COLOR;
                ctx.fillText(engine.worldData[key], cursorScreenPos.x, cursorScreenPos.y + verticalTextOffset);
            }
        }

        // === Render Dialogue ===
        renderDialogue({
            canvasWidth: cssWidth,
            canvasHeight: cssHeight,
            effectiveCharWidth,
            effectiveCharHeight,
            verticalTextOffset,
            ctx
        });

        // === Render Debug Dialogue ===
        renderDebugDialogue({
            canvasWidth: cssWidth,
            canvasHeight: cssHeight,
            effectiveCharWidth,
            effectiveCharHeight,
            verticalTextOffset,
            ctx,
            debugText
        });


        ctx.restore();
        // --- End Drawing ---
    }, [engine, engine.deepspawnData, engine.commandData, engine.commandState, canvasSize, cursorColorAlternate, isMiddleMouseDownRef.current, intermediatePanOffsetRef.current, cursorTrail, panTrail, drawStraightSpline, drawCurvedSpline, renderDialogue, renderDebugDialogue, debugText]);


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
        
        // Pass false for clearSelection - let the engine decide
        engine.handleCanvasClick(e.clientX - rect.left, e.clientY - rect.top, false, e.shiftKey);
        canvasRef.current?.focus(); // Ensure focus for keyboard
    }, [engine]);
    
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
        // Pass shift key status to the engine's handler
        const preventDefault = engine.handleKeyDown(e.key, e.ctrlKey, e.metaKey, e.shiftKey);
        if (preventDefault) {
            e.preventDefault();
        }
    }, [engine]);

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