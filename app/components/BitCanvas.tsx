// components/BitCanvas.tsx
import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { WorldData, Point, WorldEngine, PanStartInfo } from '@/app/hooks/useWorldEngine'; // Adjust path as needed

// --- Constants --- (Copied and relevant ones kept)
const FONT_FAMILY = 'monospace';
const GRID_COLOR = '#f2f2f2';
const TEXT_COLOR = '#000000';
const CURSOR_COLOR_PRIMARY = '#FF6B35';
const CURSOR_COLOR_SECONDARY = '#FFA500';
const CURSOR_TEXT_COLOR = '#FFFFFF';
const BACKGROUND_COLOR = '#ffffff';
const DRAW_GRID = true;
const GRID_LINE_WIDTH = 1;

interface BitCanvasProps {
    engine: WorldEngine;
    cursorColorAlternate: boolean;
    className?: string;
}

export function BitCanvas({ engine, cursorColorAlternate, className }: BitCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const devicePixelRatioRef = useRef(1);
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

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

        const cursorScreenPos = engine.worldToScreen(engine.cursorPos.x, engine.cursorPos.y, currentZoom, currentOffset);
        if (cursorScreenPos.x >= -effectiveCharWidth && cursorScreenPos.x <= cssWidth && cursorScreenPos.y >= -effectiveCharHeight && cursorScreenPos.y <= cssHeight) {
            ctx.fillStyle = cursorColorAlternate ? CURSOR_COLOR_SECONDARY : CURSOR_COLOR_PRIMARY;
            ctx.fillRect(cursorScreenPos.x, cursorScreenPos.y, effectiveCharWidth, effectiveCharHeight);
            const key = `${engine.cursorPos.x},${engine.cursorPos.y}`;
            if (engine.worldData[key]) {
                ctx.fillStyle = CURSOR_TEXT_COLOR;
                ctx.fillText(engine.worldData[key], cursorScreenPos.x, cursorScreenPos.y + verticalTextOffset);
            }
        }

        // Draw selection rectangle if engine has a selection
        if (engine.selectionStart && engine.selectionEnd) {
            const { width: effectiveCharWidth, height: effectiveCharHeight } = engine.getEffectiveCharDims(currentZoom);

            // Ensure start is top-left and end is bottom-right for screen coordinates
            const screenStart = engine.worldToScreen(engine.selectionStart.x, engine.selectionStart.y, currentZoom, currentOffset);
            const screenEnd = engine.worldToScreen(engine.selectionEnd.x, engine.selectionEnd.y, currentZoom, currentOffset);

            // Calculate screen rectangle coordinates, ensuring start is top-left
            const rectX = Math.min(screenStart.x, screenEnd.x);
            const rectY = Math.min(screenStart.y, screenEnd.y);
            // Width/Height calculation needs to account for the character dimensions
            const selStartXWorld = Math.min(engine.selectionStart.x, engine.selectionEnd.x);
            const selStartYWorld = Math.min(engine.selectionStart.y, engine.selectionEnd.y);
            const selEndXWorld = Math.max(engine.selectionStart.x, engine.selectionEnd.x);
            const selEndYWorld = Math.max(engine.selectionStart.y, engine.selectionEnd.y);

            const rectWidth = (selEndXWorld - selStartXWorld + 1) * effectiveCharWidth;
            const rectHeight = (selEndYWorld - selStartYWorld + 1) * effectiveCharHeight;


            // Draw semi-transparent selection
            ctx.fillStyle = 'rgba(255, 165, 0, 0.3)';
            ctx.fillRect(rectX, rectY, rectWidth, rectHeight);
        }

        ctx.restore();
        // --- End Drawing ---
    }, [engine, canvasSize, cursorColorAlternate, isMiddleMouseDownRef.current, intermediatePanOffsetRef.current]);


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

    // --- Event Handlers (Attached to Canvas) ---
    const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (e.button !== 0) return; // Only left clicks
    
        // Prevent click action if it was the end of a pan
        const wasPanning = panStartInfoRef.current !== null;
        panStartInfoRef.current = null; // Clear pan info on any click up
        if (wasPanning && isMiddleMouseDownRef.current) { // Specifically check if middle mouse was down
             // Don't treat the end of a middle-mouse pan as a regular click
             return;
        }
    
        // Pass false to not clear the selection by default
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        engine.handleCanvasClick(e.clientX - rect.left, e.clientY - rect.top, true);
        canvasRef.current?.focus(); // Ensure focus for keyboard
    }, [engine]);
    
    const handleCanvasWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
        e.preventDefault(); // Prevent page scroll
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        engine.handleCanvasWheel(
            e.deltaX, e.deltaY,
            e.clientX - rect.left, e.clientY - rect.top,
            e.ctrlKey || e.metaKey
        );
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
            // No need to process selection here, engine handles it
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
        // Pass shiftKey status to the engine's handler
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
            onWheel={handleCanvasWheel}
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