// hooks/useWorldEngine.ts
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useWorldSave } from './world.save'; // Import the new hook
import { useCommandSystem, CommandState, CommandExecution, BackgroundMode, COLOR_MAP } from './commands'; // Import command system
import { getSmartIndentation, extractLineCharacters, detectTextBlocks, findClosestBlock, findBlockForDeletion } from './bit.blocks'; // Import block detection utilities
import { useWorldSettings, WorldSettings } from './settings';
import { set, ref, increment, runTransaction, serverTimestamp, onValue } from 'firebase/database';
import { database, auth, storage, getUserProfile } from '@/app/firebase';
import { ref as storageRef, uploadString, getDownloadURL } from 'firebase/storage';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
// Import lightweight AI utilities (no GenAI dependency)
import { createSubtitleCycler, setDialogueWithRevert, abortCurrentAI, isAIActive, detectImageIntent } from './ai.utils';
import { executeTool, ToolContext } from './ai.tools';
import { logger } from './logger';
import { useAutoDialogue } from './dialogue';
import { get } from 'firebase/database';
import { DataRecorder } from './recorder';
import { parseGIFFromArrayBuffer, getCurrentFrame, isGIFUrl } from './gif.parser';
import type { AgentState } from './agent';
import { AgentController } from './agent';
import { findSmoothPath, type Point as PathPoint } from './paths';
import { runCA, type CARule } from './ca';
import { runPython, isPyodideLoaded } from './pyodide';
import { BubbleState, createInitialBubbleState, showBubble, hideBubble, isBubbleExpired } from './bubble';

import { ai, CanvasState } from './ai';

// --- Constants --- (Copied and relevant ones kept)
const BASE_FONT_SIZE = 16;
const BASE_CHAR_WIDTH = BASE_FONT_SIZE * 0.6;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5.0;
const ZOOM_SENSITIVITY = 0.002;

// Grid system: Characters span multiple cells vertically
// This determines vertical movement increment and coordinate alignment
const GRID_CELL_SPAN = 2; // Characters occupy 2 vertically-stacked cells (default scale=1)

// --- Block Management Constants ---
const BLOCK_PREFIX = 'block_';// Circle packing constants
const MIN_BLOCK_DISTANCE = 6;  // Minimum cells between blocks

// --- Interfaces ---

// World bounds for constrained/bounded canvas mode
export interface WorldBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export interface StyledCharacter {
    char: string;
    style?: {
        color?: string;
        background?: string;
    };
    scale?: { w: number; h: number }; // Character scale in cells (defaults to {w:1, h:2})
    fadeStart?: number; // Timestamp for fade animation
}

// Helper to get character scale with default fallback
export const getCharScale = (data: string | StyledCharacter | ImageData): { w: number, h: number } => {
    if (typeof data === 'string') return { w: 1, h: 2 };
    if ('scale' in data && data.scale) return data.scale;
    return { w: 1, h: 2 };
};

// --- Paint Blob Storage System ---
// Efficient blob-based storage replacing cell-by-cell approach
// OLD: worldData["paint_10_20"] = '{"type":"paint","color":"#ff0000"}' (~55 bytes per cell)
// NEW: worldData["paintblob_id"] = '{"type":"paint-blob",...,cells:["10,20",...]}' (~6 bytes per cell)

export interface PaintBlob {
    type: 'paint-blob';
    id: string;
    paintType?: 'color' | 'obstacle'; // Type of paint: color (default) or obstacle (blocks pathfinding)
    patternKey?: string; // Link to pattern - paint will regenerate when pattern changes
    color: string;
    bounds: {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
    };
    cells: string[]; // Array of "x,y" coordinate strings
}

// Get all paint blobs from worldData
export const getAllPaintBlobs = (worldData: Record<string, any>): PaintBlob[] => {
    const blobs: PaintBlob[] = [];
    for (const key in worldData) {
        if (key.startsWith('paintblob_')) {
            try {
                const blob = JSON.parse(worldData[key] as string);
                if (blob.type === 'paint-blob') {
                    blobs.push(blob);
                }
            } catch (e) {
                console.error(`Failed to parse paint blob ${key}:`, e);
            }
        }
    }
    return blobs;
};

// Check if a specific cell is painted (used by rendering, note modes, etc.)
export const isPaintedCell = (worldData: Record<string, any>, x: number, y: number): boolean => {
    const cellKey = `${x},${y}`;
    const blobs = getAllPaintBlobs(worldData);
    for (const blob of blobs) {
        // Quick bounds check first (fast rejection)
        if (x < blob.bounds.minX || x > blob.bounds.maxX ||
            y < blob.bounds.minY || y > blob.bounds.maxY) {
            continue;
        }
        if (blob.cells.includes(cellKey)) {
            return true;
        }
    }
    return false;
};

// Get paint color at a specific cell
export const getPaintColorAt = (worldData: Record<string, any>, x: number, y: number): string | null => {
    const cellKey = `${x},${y}`;
    const blobs = getAllPaintBlobs(worldData);
    for (const blob of blobs) {
        if (x < blob.bounds.minX || x > blob.bounds.maxX ||
            y < blob.bounds.minY || y > blob.bounds.maxY) {
            continue;
        }
        if (blob.cells.includes(cellKey)) {
            return blob.color;
        }
    }
    return null;
};

// Check if a position contains an obstacle that blocks character movement
export const isObstacleAt = (worldData: Record<string, any>, x: number, y: number): boolean => {
    const cellKey = `${Math.round(x)},${Math.round(y)}`;
    const blobs = getAllPaintBlobs(worldData);

    for (const blob of blobs) {
        // Only check obstacle blobs
        if (blob.paintType !== 'obstacle') continue;

        // Quick bounds check
        const roundedX = Math.round(x);
        const roundedY = Math.round(y);
        if (roundedX < blob.bounds.minX || roundedX > blob.bounds.maxX ||
            roundedY < blob.bounds.minY || roundedY > blob.bounds.maxY) {
            continue;
        }

        // Check if cell is in this obstacle blob
        if (blob.cells.includes(cellKey)) {
            return true;
        }
    }

    return false;
};

// Find the blob that contains a specific cell
export const findBlobAt = (worldData: Record<string, any>, x: number, y: number): PaintBlob | null => {
    const cellKey = `${x},${y}`;
    const blobs = getAllPaintBlobs(worldData);
    for (const blob of blobs) {
        if (x < blob.bounds.minX || x > blob.bounds.maxX ||
            y < blob.bounds.minY || y > blob.bounds.maxY) {
            continue;
        }
        if (blob.cells.includes(cellKey)) {
            return blob;
        }
    }
    return null;
};

// Create a new paint blob
export const createPaintBlob = (
    color: string,
    initialCells: Array<{x: number, y: number}>,
    paintType?: 'color' | 'obstacle',
    patternKey?: string
): PaintBlob => {
    if (initialCells.length === 0) {
        throw new Error('Cannot create empty blob');
    }
    const id = `blob_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let minX = initialCells[0].x, maxX = initialCells[0].x;
    let minY = initialCells[0].y, maxY = initialCells[0].y;
    for (const cell of initialCells) {
        minX = Math.min(minX, cell.x);
        maxX = Math.max(maxX, cell.x);
        minY = Math.min(minY, cell.y);
        maxY = Math.max(maxY, cell.y);
    }
    return {
        type: 'paint-blob',
        id,
        paintType,
        patternKey,
        color,
        bounds: { minX, maxX, minY, maxY },
        cells: initialCells.map(p => `${p.x},${p.y}`)
    };
};

// Add cells to an existing blob and return updated blob
export const addCellsToBlob = (blob: PaintBlob, newCells: Array<{x: number, y: number}>): PaintBlob => {
    const existingSet = new Set(blob.cells);
    let { minX, maxX, minY, maxY } = blob.bounds;
    const addedCells: string[] = [];

    for (const cell of newCells) {
        const cellKey = `${cell.x},${cell.y}`;
        if (!existingSet.has(cellKey)) {
            addedCells.push(cellKey);
            existingSet.add(cellKey);
            minX = Math.min(minX, cell.x);
            maxX = Math.max(maxX, cell.x);
            minY = Math.min(minY, cell.y);
            maxY = Math.max(maxY, cell.y);
        }
    }

    if (addedCells.length === 0) return blob;

    return {
        ...blob,
        bounds: { minX, maxX, minY, maxY },
        cells: [...blob.cells, ...addedCells]
    };
};

// Remove cells from a blob, returns null if blob becomes empty
export const removeCellsFromBlob = (blob: PaintBlob, cellsToRemove: Array<{x: number, y: number}>): PaintBlob | null => {
    const removeSet = new Set(cellsToRemove.map(c => `${c.x},${c.y}`));
    const remainingCells = blob.cells.filter(c => !removeSet.has(c));

    if (remainingCells.length === 0) return null;

    // Recalculate bounds
    const firstCell = remainingCells[0].split(',').map(Number);
    let minX = firstCell[0], maxX = firstCell[0];
    let minY = firstCell[1], maxY = firstCell[1];

    for (const cellKey of remainingCells) {
        const [x, y] = cellKey.split(',').map(Number);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    }

    return {
        ...blob,
        bounds: { minX, maxX, minY, maxY },
        cells: remainingCells
    };
};

// Room type for pattern boundary calculation
interface PatternRoom {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Calculate outer border cells for a pattern (rooms + corridors)
 * Uses same MST algorithm as rendering for consistent corridors
 */
export const calculatePatternBorderCells = (
    rooms: PatternRoom[],
    seed: number
): Array<{x: number, y: number}> => {
    if (rooms.length === 0) return [];

    // Seeded random function (same as rendering)
    const random = (n: number) => {
        const x = Math.sin(seed + n) * 10000;
        return x - Math.floor(x);
    };

    // Build grid of all filled cells (rooms + corridors)
    const gridCells = new Set<string>();

    // Add all room cells
    for (const room of rooms) {
        for (let x = room.x; x < room.x + room.width; x++) {
            for (let y = room.y; y < room.y + room.height; y++) {
                gridCells.add(`${x},${y}`);
            }
        }
    }

    // Draw corridors using MST (same algorithm as rendering)
    const corridorWidth = 3;
    const corridorHeight = 3;

    const drawCorridor = (room1: PatternRoom, room2: PatternRoom, rngSeed: number) => {
        const startX = room1.x + Math.floor(room1.width / 2);
        const startY = room1.y + Math.floor(room1.height / 2);
        const endX = room2.x + Math.floor(room2.width / 2);
        const endY = room2.y + Math.floor(room2.height / 2);

        // L-shaped corridor
        if (random(rngSeed) > 0.5) {
            // Horizontal first
            const minX = Math.min(startX, endX);
            const maxX = Math.max(startX, endX);
            for (let x = minX; x <= maxX; x++) {
                for (let w = 0; w < corridorWidth; w++) {
                    gridCells.add(`${x},${startY + w - Math.floor(corridorWidth / 2)}`);
                }
            }
            // Then vertical
            const minY = Math.min(startY, endY);
            const maxY = Math.max(startY, endY);
            for (let y = minY; y <= maxY; y++) {
                for (let h = 0; h < corridorHeight; h++) {
                    gridCells.add(`${endX + h - Math.floor(corridorHeight / 2)},${y}`);
                }
            }
        } else {
            // Vertical first
            const minY = Math.min(startY, endY);
            const maxY = Math.max(startY, endY);
            for (let y = minY; y <= maxY; y++) {
                for (let h = 0; h < corridorHeight; h++) {
                    gridCells.add(`${startX + h - Math.floor(corridorHeight / 2)},${y}`);
                }
            }
            // Then horizontal
            const minX = Math.min(startX, endX);
            const maxX = Math.max(startX, endX);
            for (let x = minX; x <= maxX; x++) {
                for (let w = 0; w < corridorWidth; w++) {
                    gridCells.add(`${x},${endY + w - Math.floor(corridorWidth / 2)}`);
                }
            }
        }
    };

    // MST using Prim's algorithm (same as rendering)
    if (rooms.length > 1) {
        const connected = new Set<number>([0]);

        while (connected.size < rooms.length) {
            let bestEdge: { from: number; to: number; dist: number } | null = null;

            for (const i of connected) {
                for (let j = 0; j < rooms.length; j++) {
                    if (!connected.has(j)) {
                        const dx = Math.abs(rooms[j].x - rooms[i].x);
                        const dy = Math.abs(rooms[j].y - rooms[i].y);
                        const dist = dx + dy;

                        if (!bestEdge || dist < bestEdge.dist) {
                            bestEdge = { from: i, to: j, dist };
                        }
                    }
                }
            }

            if (bestEdge) {
                connected.add(bestEdge.to);
                drawCorridor(rooms[bestEdge.from], rooms[bestEdge.to], bestEdge.from * 7 + bestEdge.to);
            } else {
                break;
            }
        }

        // Add 1-2 extra corridors for loops
        const extraCorridors = Math.floor(random(200) * 2) + 1;
        for (let e = 0; e < extraCorridors && rooms.length > 2; e++) {
            const i = Math.floor(random(300 + e) * rooms.length);
            const j = Math.floor(random(400 + e) * rooms.length);
            if (i !== j) {
                drawCorridor(rooms[i], rooms[j], i * 13 + j);
            }
        }
    }

    // Find outer border cells (adjacent to grid but not in grid)
    const borderCells: Array<{x: number, y: number}> = [];
    const borderSet = new Set<string>();

    for (const cellKey of gridCells) {
        const [x, y] = cellKey.split(',').map(Number);

        // Check all 8 neighbors
        const neighbors = [
            { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
            { dx: -1, dy: 0 },                      { dx: 1, dy: 0 },
            { dx: -1, dy: 1 },  { dx: 0, dy: 1 },  { dx: 1, dy: 1 }
        ];

        for (const { dx, dy } of neighbors) {
            const nx = x + dx;
            const ny = y + dy;
            const neighborKey = `${nx},${ny}`;

            // If neighbor is not in grid and not already in border
            if (!gridCells.has(neighborKey) && !borderSet.has(neighborKey)) {
                borderSet.add(neighborKey);
                borderCells.push({ x: nx, y: ny });
            }
        }
    }

    return borderCells;
};

/**
 * Get paint blob linked to a pattern
 */
export const getPatternPaintBlob = (worldData: Record<string, any>, patternKey: string): { blob: PaintBlob; key: string } | null => {
    for (const key in worldData) {
        if (key.startsWith('paintblob_')) {
            try {
                const blob = JSON.parse(worldData[key] as string);
                if (blob.type === 'paint-blob' && blob.patternKey === patternKey) {
                    return { blob, key };
                }
            } catch (e) {
                // Skip invalid blobs
            }
        }
    }
    return null;
};

/**
 * Regenerate paint blob for a pattern based on current note positions
 */
export const regeneratePatternPaint = (
    worldData: Record<string, any>,
    patternKey: string
): { updatedBlob: PaintBlob; blobKey: string } | null => {
    // Get pattern data
    const patternData = worldData[patternKey];
    if (!patternData) return null;

    let pattern;
    try {
        pattern = JSON.parse(patternData);
    } catch (e) {
        return null;
    }

    if (!pattern.noteKeys || pattern.noteKeys.length === 0) return null;

    // Get rooms from notes
    const rooms: PatternRoom[] = [];
    for (const noteKey of pattern.noteKeys) {
        const noteData = worldData[noteKey];
        if (!noteData) continue;

        try {
            const note = JSON.parse(noteData);
            if (note.startX !== undefined && note.startY !== undefined &&
                note.endX !== undefined && note.endY !== undefined) {
                rooms.push({
                    x: note.startX,
                    y: note.startY,
                    width: note.endX - note.startX,
                    height: note.endY - note.startY
                });
            }
        } catch (e) {
            // Skip invalid notes
        }
    }

    if (rooms.length === 0) return null;

    // Calculate border cells
    const seed = pattern.timestamp || Date.now();
    const borderCells = calculatePatternBorderCells(rooms, seed);

    if (borderCells.length === 0) return null;

    // Find existing paint blob for this pattern
    const existingPaint = getPatternPaintBlob(worldData, patternKey);

    if (existingPaint) {
        // Update existing blob's cells and bounds
        let minX = borderCells[0].x, maxX = borderCells[0].x;
        let minY = borderCells[0].y, maxY = borderCells[0].y;
        for (const cell of borderCells) {
            minX = Math.min(minX, cell.x);
            maxX = Math.max(maxX, cell.x);
            minY = Math.min(minY, cell.y);
            maxY = Math.max(maxY, cell.y);
        }

        const updatedBlob: PaintBlob = {
            ...existingPaint.blob,
            bounds: { minX, maxX, minY, maxY },
            cells: borderCells.map(c => `${c.x},${c.y}`)
        };

        return { updatedBlob, blobKey: existingPaint.key };
    } else {
        // Create new paint blob
        const newBlob = createPaintBlob('#000000', borderCells, 'obstacle', patternKey);
        return { updatedBlob: newBlob, blobKey: `paintblob_${newBlob.id}` };
    }
};

// Find or create a blob for painting at a specific cell
export const findOrCreateBlobForCell = (
    worldData: Record<string, any>,
    x: number,
    y: number,
    color: string,
    paintType?: 'color' | 'obstacle'
): { blob: PaintBlob; isNew: boolean; existingBlobKey?: string } => {
    // Check if already painted in a blob of same color and type
    const existingBlob = findBlobAt(worldData, x, y);
    if (existingBlob && existingBlob.color === color && existingBlob.paintType === paintType) {
        return { blob: existingBlob, isNew: false, existingBlobKey: `paintblob_${existingBlob.id}` };
    }

    // Check for adjacent blob of same color and type to merge into
    const directions = [
        { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
        { dx: -1, dy: 0 }, { dx: 1, dy: 0 }
    ];
    for (const dir of directions) {
        const adjBlob = findBlobAt(worldData, x + dir.dx, y + dir.dy);
        if (adjBlob && adjBlob.color === color && adjBlob.paintType === paintType) {
            return { blob: adjBlob, isNew: false, existingBlobKey: `paintblob_${adjBlob.id}` };
        }
    }

    // No adjacent blob - create new one
    const newBlob = createPaintBlob(color, [{ x, y }], paintType);
    return { blob: newBlob, isNew: true };
};

// Resize a blob to new bounds
export const resizePaintBlob = (
    blob: PaintBlob,
    newBounds: { minX: number; maxX: number; minY: number; maxY: number }
): PaintBlob => {
    const oldWidth = blob.bounds.maxX - blob.bounds.minX;
    const oldHeight = blob.bounds.maxY - blob.bounds.minY;
    const newWidth = newBounds.maxX - newBounds.minX;
    const newHeight = newBounds.maxY - newBounds.minY;

    if (oldWidth === 0 || oldHeight === 0) return blob;

    const scaleX = newWidth / oldWidth;
    const scaleY = newHeight / oldHeight;

    const newCells: string[] = [];
    const cellSet = new Set<string>();

    for (const cellKey of blob.cells) {
        const [x, y] = cellKey.split(',').map(Number);
        const relX = x - blob.bounds.minX;
        const relY = y - blob.bounds.minY;
        const newRelX = Math.round(relX * scaleX);
        const newRelY = Math.round(relY * scaleY);
        const newX = newBounds.minX + newRelX;
        const newY = newBounds.minY + newRelY;
        const newCellKey = `${newX},${newY}`;
        if (!cellSet.has(newCellKey)) {
            cellSet.add(newCellKey);
            newCells.push(newCellKey);
        }
    }

    return { ...blob, bounds: newBounds, cells: newCells };
};

// Helper to find connected paint region (used by /make command, selection, etc.)
// Now reads from blob storage instead of individual cells
export const findConnectedPaintRegion = (worldData: Record<string, any>, x: number, y: number): { points: Array<{x: number, y: number}>, minX: number, maxX: number, minY: number, maxY: number, color: string, blobId?: string } | null => {
    const startX = Math.floor(x);
    const startY = Math.floor(y);

    // Find blob at this position
    const blob = findBlobAt(worldData, startX, startY);
    if (!blob) return null;

    // Convert blob cells to points array
    const points = blob.cells.map(cellKey => {
        const [px, py] = cellKey.split(',').map(Number);
        return { x: px, y: py };
    });

    return {
        points,
        minX: blob.bounds.minX,
        maxX: blob.bounds.maxX,
        minY: blob.bounds.minY,
        maxY: blob.bounds.maxY,
        color: blob.color,
        blobId: blob.id
    };
};

// Helper function to find paint bounds at a given Y coordinate within note bounds
// Returns {startX, endX} in relative coordinates, or null if no paint at this Y
export const getPaintBoundsAtY = (noteData: any, relativeY: number, worldData: Record<string, any>): { startX: number; endX: number } | null => {
    const noteStartX = noteData.startX;
    const noteStartY = noteData.startY;
    const noteWidth = noteData.endX - noteData.startX;
    const worldY = noteStartY + relativeY;

    let minPaintX = -1;
    let maxPaintX = -1;

    // Find leftmost and rightmost paint cells at this Y
    for (let relativeX = 0; relativeX < noteWidth; relativeX++) {
        const worldX = noteStartX + relativeX;
        if (isPaintedCell(worldData, worldX, worldY)) {
            if (minPaintX === -1) minPaintX = relativeX;
            maxPaintX = relativeX;
        }
    }

    if (minPaintX === -1) return null;
    return { startX: minPaintX, endX: maxPaintX };
};

// Helper function to find the top-left-most paint cell
// Returns {x, y} in relative coordinates, or null if no paint
export const getTopLeftPaintCell = (noteData: any, worldData: Record<string, any>): { x: number; y: number } | null => {
    const noteHeight = noteData.endY - noteData.startY;

    for (let relativeY = 0; relativeY < noteHeight; relativeY++) {
        const bounds = getPaintBoundsAtY(noteData, relativeY, worldData);
        if (bounds) {
            return { x: bounds.startX, y: relativeY };
        }
    }

    return null;
};

// Helper function to rewrap text within a note
export const rewrapNoteText = (noteData: any, worldData?: Record<string, any>): any => {
    if (!noteData.data || Object.keys(noteData.data).length === 0) {
        return noteData; // No text to rewrap
    }

    const noteWidth = noteData.endX - noteData.startX;

    // If note is too narrow (< 5 cells), don't rewrap - just use viewport culling
    // This prevents character-by-character breaking on very narrow notes
    if (noteWidth < 5) {
        return noteData;
    }

    // Group characters by their Y coordinate (lines)
    const lineMap: Map<number, Array<{ relativeX: number; char: string; style?: any }>> = new Map();

    for (const coordKey in noteData.data) {
        const [xStr, yStr] = coordKey.split(',');
        const relativeX = parseInt(xStr);
        const relativeY = parseInt(yStr);

        const charData = noteData.data[coordKey];
        const char = typeof charData === 'string' ? charData :
                    (charData && typeof charData === 'object' && 'char' in charData) ? charData.char : '';
        const style = typeof charData === 'object' && 'style' in charData ? charData.style : undefined;

        if (!lineMap.has(relativeY)) {
            lineMap.set(relativeY, []);
        }
        lineMap.get(relativeY)!.push({ relativeX, char, style });
    }

    // Sort lines by Y coordinate
    const sortedLines = Array.from(lineMap.entries()).sort((a, b) => a[0] - b[0]);

    // Group lines into paragraphs (separated by explicit breaks)
    // A paragraph is a continuous stream of text
    const paragraphs: Array<Array<{ char: string; style?: any }>> = [];
    let currentParagraph: Array<{ char: string; style?: any }> = [];

    for (let i = 0; i < sortedLines.length; i++) {
        const [y, characters] = sortedLines[i];

        // Sort characters by X coordinate
        characters.sort((a, b) => a.relativeX - b.relativeX);

        // Detect if this is an explicit line break
        let isExplicitBreak = false;

        // Check 1: Empty line (no characters) = explicit break
        if (characters.length === 0) {
            isExplicitBreak = true;
        }

        // Check 2: Gap in Y coordinates = explicit break (skipped lines)
        if (i > 0) {
            const prevY = sortedLines[i - 1][0];
            if (y - prevY > GRID_CELL_SPAN) {
                // Start new paragraph due to Y gap
                if (currentParagraph.length > 0) {
                    paragraphs.push(currentParagraph);
                    currentParagraph = [];
                }
            }
        }

        // Add characters from this line to current paragraph
        // If merging with previous line content (not first line of paragraph), add a space
        if (currentParagraph.length > 0 && characters.length > 0) {
            // Check if previous line already ends with space or current line starts with space
            const lastChar = currentParagraph[currentParagraph.length - 1];
            const firstChar = characters[0];
            if (lastChar.char !== ' ' && firstChar.char !== ' ') {
                // Add space between merged lines
                currentParagraph.push({ char: ' ' });
            }
        }

        for (const { char, style } of characters) {
            currentParagraph.push({ char, style });
        }

        // If explicit break, finalize current paragraph
        if (isExplicitBreak) {
            if (currentParagraph.length > 0) {
                paragraphs.push(currentParagraph);
                currentParagraph = [];
            }
            // Empty line creates empty paragraph (preserves blank lines)
            if (characters.length === 0) {
                paragraphs.push([]);
            }
        }
    }

    // Don't forget the last paragraph if it wasn't finalized
    if (currentParagraph.length > 0) {
        paragraphs.push(currentParagraph);
    }

    // Rewrap each paragraph based on new width
    const newData: any = {};

    // Check if we should use paint-aware wrapping
    const usePaintBounds = worldData && noteData.displayMode === 'wrap';
    const paintStart = usePaintBounds ? getTopLeftPaintCell(noteData, worldData) : null;

    // Cache paint bounds for all Y coordinates to avoid recalculating
    const paintBoundsCache: Map<number, { startX: number; endX: number } | null> = new Map();
    if (usePaintBounds) {
        const noteHeight = noteData.endY - noteData.startY;
        for (let y = 0; y < noteHeight; y++) {
            paintBoundsCache.set(y, getPaintBoundsAtY(noteData, y, worldData!));
        }
    }

    // Start from top-left paint cell if paint exists, otherwise start from 0,0
    let currentY = paintStart ? paintStart.y : 0;

    for (const paragraph of paragraphs) {
        if (paragraph.length === 0) {
            // Empty paragraph - preserve blank line
            currentY += GRID_CELL_SPAN;
            continue;
        }

        // Wrap this paragraph as a continuous stream
        let currentX = 0;
        let lineStartIndex = 0; // Track where current line started in paragraph

        for (let i = 0; i < paragraph.length; i++) {
            const { char, style } = paragraph[i];

            // Get paint bounds for current line if using paint-aware wrapping
            let lineStartX = 0;
            let lineEndX = noteWidth;

            if (usePaintBounds) {
                const paintBounds = paintBoundsCache.get(currentY);
                if (paintBounds) {
                    lineStartX = paintBounds.startX;
                    lineEndX = paintBounds.endX + 1; // +1 because endX is inclusive
                } else {
                    // No paint on this line - skip to next line with paint
                    currentY += GRID_CELL_SPAN;
                    const nextBounds = paintBoundsCache.get(currentY);
                    if (nextBounds) {
                        lineStartX = nextBounds.startX;
                        lineEndX = nextBounds.endX + 1;
                        currentX = 0; // Reset X for new line
                    } else {
                        // No more paint - stop placing text
                        break;
                    }
                }
            }

            // Check if this is the first character on a new line
            if (currentX === 0) {
                currentX = lineStartX; // Start from left-most paint cell
            }

            // Check if placing this character would exceed the line's paint boundary
            if (currentX >= lineEndX) {
                // Need to wrap - find last space on current line
                let wrapIndex = -1;

                // Search backwards from current position to find a space
                for (let j = i - 1; j >= lineStartIndex; j--) {
                    if (paragraph[j].char === ' ') {
                        wrapIndex = j;
                        break;
                    }
                }

                if (wrapIndex >= lineStartIndex) {
                    // Found a space to wrap at - remove characters back to the space
                    // and move them to next line

                    // Remove characters from space onwards on current line
                    for (let k = wrapIndex; k < i; k++) {
                        const removeX = currentX - (i - k);
                        const removeKey = `${removeX},${currentY}`;
                        delete newData[removeKey];
                    }

                    // Move to next line
                    currentY += GRID_CELL_SPAN;
                    lineStartIndex = wrapIndex + 1; // New line starts after the space

                    // Get paint bounds for new line (if using paint-aware wrapping)
                    let newLineStartX = 0;
                    if (usePaintBounds) {
                        const nextBounds = paintBoundsCache.get(currentY);
                        if (nextBounds) {
                            newLineStartX = nextBounds.startX;
                        }
                    }
                    currentX = newLineStartX;

                    // Re-add characters (except the space) starting from new line's left-most paint cell
                    for (let k = wrapIndex + 1; k < i; k++) {
                        const coordKey = `${currentX},${currentY}`;
                        const { char: c, style: s } = paragraph[k];
                        newData[coordKey] = s ? { char: c, style: s } : c;
                        currentX++;
                    }
                } else {
                    // No space found = long word that doesn't fit
                    // Don't hard-wrap! Just let it overflow and viewport cull
                    // This preserves word structure
                }
            }

            // Place current character (may overflow if long word)
            const coordKey = `${currentX},${currentY}`;
            newData[coordKey] = style ? { char, style } : char;
            currentX++;
        }

        // Move to next line for next paragraph (explicit line break)
        currentY += GRID_CELL_SPAN;
    }

    return {
        ...noteData,
        data: newData
    };
};

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
    // Canvas state: 0 = infinite (synced), 1 = bounded (ephemeral)
    canvasState: 0 | 1;
    setCanvasState: (state: 0 | 1) => void;
    boundedWorldData: WorldData; // Ephemeral data for bounded state
    setBoundedWorldData: React.Dispatch<React.SetStateAction<WorldData>>;
    boundedSource: { type: 'note' | 'selection' | 'empty'; noteKey?: string; originalBounds: { minX: number; minY: number; maxX: number; maxY: number }; boundedMinX: number; boundedMinY: number } | null;
    setBoundedSource: React.Dispatch<React.SetStateAction<{ type: 'note' | 'selection' | 'empty'; noteKey?: string; originalBounds: { minX: number; minY: number; maxX: number; maxY: number }; boundedMinX: number; boundedMinY: number } | null>>;
    bounds?: WorldBounds; // Optional bounds for constrained canvas mode
    setBounds: (bounds: WorldBounds | undefined) => void; // Set bounds dynamically (undefined = unbounded)
    isWithinBounds: (x: number, y: number) => boolean; // Check if coordinates are within bounds
    commandSystem: {
        selectCommand: (command: string) => void;
        executeCommandString: (command: string) => void;
        startCommand: (cursorPos: Point) => void;
        startCommandWithInput: (cursorPos: Point, input: string) => void;
        addCharacter: (char: string) => void;
    };
    chatData: WorldData;
    suggestionData: WorldData;
    lightModeData: WorldData;
    hostData: { text: string; color?: string; centerPos: Point; timestamp?: number } | null; // Host messages rendered at fixed position with streaming
    clipboardItems: ClipboardItem[]; // Clipboard items from Cmd+click on bounds
    searchData: WorldData;
    viewOffset: Point;
    effectiveViewOffset: Point;
    cursorPos: Point;
    setCursorPos: (pos: Point) => void;
    visualCursorPos: Point;
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
    currentScale: { w: number; h: number }; // Current text scale for new input
    setCurrentScale: (scale: { w: number; h: number }) => void;
    getEffectiveCharDims: (zoom: number) => { width: number; height: number; fontSize: number; };
    screenToWorld: (screenX: number, screenY: number, currentZoom: number, currentOffset: Point) => Point;
    screenToWorldPixel: (screenX: number, screenY: number, currentZoom: number, currentOffset: Point) => Point;
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
    setSelectionStart: React.Dispatch<React.SetStateAction<Point | null>>;
    setSelectionEnd: React.Dispatch<React.SetStateAction<Point | null>>;
    processingRegion: { startX: number, endX: number, startY: number, endY: number } | null;
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
    clearChatData: () => void;
    clearLightModeData: () => void;
    // Agent system
    agentEnabled: boolean;
    setAgentEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    agentPos: Point;
    setAgentPos: React.Dispatch<React.SetStateAction<Point>>;
    agentState: AgentState;
    setAgentState: React.Dispatch<React.SetStateAction<AgentState>>;
    agentSelectionStart: Point | null;
    agentSelectionEnd: Point | null;
    agentController: AgentController; // Agent controller for playback
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
    // Ephemeral text rendering for host dialogue
    addInstantAIResponse: (startPos: Point, text: string, options?: {
        wrapWidth?: number;
        fadeDelay?: number;
        fadeInterval?: number;
        color?: string;
        queryText?: string;
    }) => { width: number; height: number };
    setWorldData: React.Dispatch<React.SetStateAction<WorldData>>;
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
    navMode: 'chips' | 'states' | 'bounds';
    toggleNavMode: () => void;
    getAllChips: () => Array<{text: string, x: number, y: number, color: string}>;
    getSortedChips: (sortMode: 'chronological' | 'closest' | 'farthest', originPos: Point) => Array<{text: string, x: number, y: number, color: string}>;
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
    isMoveMode: boolean;
    isPaintMode: boolean;
    paintTool: 'brush' | 'fill' | 'lasso' | 'eraser';
    paintColor: string;
    paintBrushSize: number;
    paintType: 'color' | 'obstacle'; // Type of paint being applied
    exitPaintMode: () => void;
    paintCell: (x: number, y: number, prevX?: number, prevY?: number) => void;
    eraseCell: (x: number, y: number, prevX?: number, prevY?: number) => void;
    fillPolygon: (points: Point[]) => void;
    // MCP direct paint methods (bypasses paint mode check, allows custom color)
    mcpPaintCells: (cells: Array<{ x: number; y: number; color: string }>) => void;
    mcpEraseCells: (cells: Array<{ x: number; y: number }>) => void;
    setTiles: (tiles: Record<string, string>) => void;
    getConnectedPaintRegion: (x: number, y: number) => { points: Point[], minX: number, maxX: number, minY: number, maxY: number, color: string } | null;
    floodFill: (x: number, y: number) => void;
    lassoPoints: Point[];
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
        leftEyeBlink?: number; // Left eye blink (0=open, 1=closed)
        rightEyeBlink?: number; // Right eye blink (0=open, 1=closed)
        isTracked?: boolean; // True if from MediaPipe tracking, false if autonomous
    };
    setFaceDetectionEnabled: (enabled: boolean) => void;
    setFaceOrientation: (orientation: any) => void;
    // Character sprite cursor
    isCharacterEnabled: boolean;
    characterSprite?: {
        walkSheet: string;
        idleSheet: string;
        name: string;
    };
    isGeneratingSprite?: boolean;
    spriteProgress?: number;
    spritePreview?: string;
    spriteDebugLog?: string[];
    // Chat bubble attached to character
    bubbleState: BubbleState;
    showBubbleMessage: (text: string, duration?: number) => void;
    hideBubbleMessage: () => void;
    // Spatial indexing for efficient viewport-based rendering
    spatialIndex: React.MutableRefObject<Map<string, Set<string>>>;
    queryVisibleEntities: (startWorldX: number, startWorldY: number, endWorldX: number, endWorldY: number) => Set<string>;
    recorder: DataRecorder;
    // Note text wrapping
    rewrapNoteText: (noteData: any) => any;
    // View overlay for fullscreen note viewing
    viewOverlay?: {
        noteKey: string;
        content: string;
        scrollOffset: number;
        maxScroll: number;
    };
    exitViewOverlay: () => void;
    setViewOverlayScroll: (scrollOffset: number) => void;
    // Agent spawning mode
    isAgentMode: boolean;
    agentSpriteName?: string;
    isAgentAttached: boolean;
    setAgentAttached: (attached: boolean) => void;
    // Agent movement handlers (registered by BitCanvas which has animation state)
    agentHandlers?: {
        moveAgents: (agentIds: string[], destination: { x: number; y: number }) => { moved: string[]; errors: string[] };
        moveAgentsPath: (agentIds: string[], path: { x: number; y: number }[]) => { moved: string[]; errors: string[] };
        moveAgentsExpr: (agentIds: string[], xExpr: string, yExpr: string, vars?: Record<string, number>, duration?: number) => { moved: string[]; errors: string[] };
        stopAgentsExpr: (agentIds: string[]) => { stopped: string[] };
        agentThink: (agentId: string) => Promise<{ thought: string; actions?: any[] } | null>;
    };
    registerAgentHandlers: (handlers: WorldEngine['agentHandlers']) => void;
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
    userUid?: string | null; // World owner's UID for world-specific persistence
    authenticatedUserUid?: string | null; // Authenticated user's UID for user-specific data (sprites, etc)
    username?: string; // Add username for routing
    enableCommands?: boolean; // Enable/disable command system (default: true)
    initialStateName?: string | null; // Initial state name from URL
    initialPatternId?: string; // Pattern ID from URL for deterministic pattern generation
    isReadOnly?: boolean; // Read-only mode (observer/viewer)
    skipInitialBackground?: boolean; // Skip applying initialBackgroundColor (let host flow control it)
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
    bounds?: WorldBounds; // Optional bounds for constrained canvas mode (e.g., { minX: 0, minY: 0, maxX: 1000, maxY: 1000 } for 1M cells)
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
    noteObjects: Record<string, string>;
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
    const height = 120;

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
        x: Math.floor(centerPos.x - width / 2),
        y: Math.floor(centerPos.y - height / 2),
        width: width,
        height: height
    };

    bspSplit(rootNode, 0, 3, random, 100);
    const rooms = collectRooms(rootNode);

    // Create note objects for each room
    const patternKey = `pattern_${patternId}`;
    const noteKeys: string[] = [];
    const noteObjects: Record<string, string> = {};

    for (let i = 0; i < rooms.length; i++) {
        const room = rooms[i];
        const noteKey = `note_${room.x},${room.y}_${numericSeed}_${i}`;
        const noteData = {
            startX: room.x,
            startY: room.y,
            // Notes use inclusive coordinates, so endX should be the last cell included
            // room.width is a span, so room.x + room.width would be one past the end
            endX: room.x + room.width - 1,
            endY: room.y + room.height - 1,
            timestamp: numericSeed,
            contentType: 'text',  // Default to text content type
            patternKey: patternKey,  // Reference back to parent pattern
            originPatternKey: patternKey  // Track original pattern for grafting
        };
        noteKeys.push(noteKey);
        noteObjects[noteKey] = JSON.stringify(noteData);
    }

    // Calculate actual bounding box from generated notes
    const corridorPadding = 3;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const noteKey of noteKeys) {
        const currentNoteData = JSON.parse(noteObjects[noteKey]);
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
    }

    const actualWidth = maxX - minX;
    const actualHeight = maxY - minY;
    const actualCenterX = minX + actualWidth / 2;
    const actualCenterY = minY + actualHeight / 2;

    const patternData = {
        centerX: actualCenterX,
        centerY: actualCenterY,
        width: actualWidth,
        height: actualHeight,
        timestamp: numericSeed,
        noteKeys: noteKeys,  // Store note keys instead of inline rooms

        // Pattern generation metadata
        generationType: 'bsp',
        generationParams: {
            depth: 3,
            width: width,
            height: height,
            seed: numericSeed
        }
    };

    return { patternData, patternKey, noteObjects };
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
    userUid = null,      // World owner's UID
    authenticatedUserUid = null, // Authenticated user's UID for user-specific data
    enableCommands = true, // Default to enabled
    username,            // Username for routing
    initialStateName = null, // Initial state name from URL
    initialPatternId,    // Pattern ID from URL for deterministic generation
    isReadOnly = false,  // Read-only mode (default to writeable)
    skipInitialBackground = false, // Skip applying initialBackgroundColor
    monogramSystem,      // WebGPU monogram system
    bounds,              // Optional bounds for constrained canvas mode
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
    const [processingRegion, setProcessingRegion] = useState<{ startX: number, endX: number, startY: number, endY: number } | null>(null);
    const [selectedNoteKey, setSelectedNoteKey] = useState<string | null>(null); // Track selected note region from canvas

    // === State ===
    const [worldData, setWorldData] = useState<WorldData>(initialWorldData);

    // === Canvas State Enumeration ===
    // 0 = infinite (default, synced to Firebase)
    // 1 = bounded (ephemeral, not synced)
    const [canvasState, setCanvasState] = useState<0 | 1>(0);

    // Ephemeral world data for bounded state (not synced to Firebase)
    const [boundedWorldData, setBoundedWorldData] = useState<WorldData>({});

    // Track source for bounded editing (to sync changes back when exiting)
    // Unified interface for notes, selections, or empty bounds
    const [boundedSource, setBoundedSource] = useState<{
        type: 'note' | 'selection' | 'empty';
        noteKey?: string; // For notes - key to sync back to
        originalBounds: { minX: number; minY: number; maxX: number; maxY: number }; // Original source bounds
        boundedMinX: number; // Translation offset for coordinate mapping
        boundedMinY: number;
    } | null>(null);

    // === Bounds State (can be changed dynamically via /bound command) ===
    const [currentBounds, setCurrentBounds] = useState<WorldBounds | undefined>(bounds);

    // Active world data depends on canvas state
    const activeWorldData = canvasState === 0 ? worldData : boundedWorldData;
    const setActiveWorldData = canvasState === 0 ? setWorldData : setBoundedWorldData;

    // === Bounds Helpers ===
    // Check if coordinates are within bounds (always true if unbounded)
    const isWithinBounds = useCallback((x: number, y: number): boolean => {
        if (!currentBounds) return true; // Unbounded canvas
        return x >= currentBounds.minX && x < currentBounds.maxX && y >= currentBounds.minY && y < currentBounds.maxY;
    }, [currentBounds]);

    // Clamp coordinates to bounds
    // Note: minY should be grid-aligned (even number for GRID_CELL_SPAN=2) so cursor and text align
    // Cursor visual top may extend above minY by 1 cell, but this ensures coordinate alignment
    const clampToBounds = useCallback((x: number, y: number): Point => {
        if (!currentBounds) return { x, y }; // Unbounded canvas
        return {
            x: Math.max(currentBounds.minX, Math.min(currentBounds.maxX - 1, x)),
            y: Math.max(currentBounds.minY, Math.min(currentBounds.maxY - 1, y)),
        };
    }, [currentBounds]);

    // Clamp viewport offset to keep it within bounds
    const clampViewportToBounds = useCallback((offset: Point, viewportWidthInCells: number, viewportHeightInCells: number): Point => {
        if (!currentBounds) return offset; // Unbounded canvas

        const boundsWidth = currentBounds.maxX - currentBounds.minX;
        const boundsHeight = currentBounds.maxY - currentBounds.minY;

        // If viewport is larger than bounds, center it
        let clampedX = offset.x;
        let clampedY = offset.y;

        if (viewportWidthInCells >= boundsWidth) {
            clampedX = currentBounds.minX - (viewportWidthInCells - boundsWidth) / 2;
        } else {
            clampedX = Math.max(currentBounds.minX, Math.min(currentBounds.maxX - viewportWidthInCells, offset.x));
        }

        if (viewportHeightInCells >= boundsHeight) {
            // Center viewport, but account for visual -1 offset (characters at Y render from Y-1)
            clampedY = currentBounds.minY - 1 - (viewportHeightInCells - boundsHeight) / 2;
        } else {
            // Allow panning to minY - 1 to show visual top of characters at minY
            clampedY = Math.max(currentBounds.minY - 1, Math.min(currentBounds.maxY - viewportHeightInCells, offset.y));
        }

        return { x: clampedX, y: clampedY };
    }, [currentBounds]);

    // === Spatial Index for Viewport-Based Rendering ===
    const CHUNK_SIZE = 32; // 32x32 cells per chunk
    const spatialIndexRef = useRef<Map<string, Set<string>>>(new Map());

    // Helper: Convert world coordinates to chunk coordinates
    const worldToChunk = useCallback((worldX: number, worldY: number): string => {
        const chunkX = Math.floor(worldX / CHUNK_SIZE);
        const chunkY = Math.floor(worldY / CHUNK_SIZE);
        return `${chunkX},${chunkY}`;
    }, []);

    // Helper: Extract coordinates from entity key
    const extractCoordinates = useCallback((key: string, data: string | StyledCharacter | ImageData): Point | null => {
        // Character data: "x,y"
        if (key.match(/^-?\d+,-?\d+$/)) {
            const [xStr, yStr] = key.split(',');
            return { x: parseInt(xStr, 10), y: parseInt(yStr, 10) };
        }

        // Label data: "label_x,y_timestamp"
        if (key.startsWith('label_')) {
            const coordsStr = key.substring('label_'.length);
            const [xStr, yStr] = coordsStr.split(',');
            const x = parseInt(xStr, 10);
            const y = parseInt(yStr, 10);
            if (!isNaN(x) && !isNaN(y)) {
                return { x, y };
            }
        }

        // Image data: stored in value
        if (typeof data === 'object' && 'type' in data && data.type === 'image') {
            return { x: data.startX, y: data.startY };
        }

        // Note/List/Mail/Chip data with coordinates in value - try to parse
        if (key.startsWith('note_') || key.startsWith('list_') || key.startsWith('mail_') || key.startsWith('chip_')) {
            try {
                const parsed = JSON.parse(data as string);
                if (parsed.startX !== undefined && parsed.startY !== undefined) {
                    return { x: parsed.startX, y: parsed.startY };
                }
                if (parsed.x !== undefined && parsed.y !== undefined) {
                    return { x: parsed.x, y: parsed.y };
                }
            } catch (e) {
                // Skip invalid JSON
            }
        }

        return null;
    }, []);

    // Query: Get all entity keys visible in viewport
    const queryVisibleEntities = useCallback((startWorldX: number, startWorldY: number, endWorldX: number, endWorldY: number): Set<string> => {
        const result = new Set<string>();

        const startChunkX = Math.floor(startWorldX / CHUNK_SIZE);
        const endChunkX = Math.floor(endWorldX / CHUNK_SIZE);
        const startChunkY = Math.floor(startWorldY / CHUNK_SIZE);
        const endChunkY = Math.floor(endWorldY / CHUNK_SIZE);

        for (let cy = startChunkY; cy <= endChunkY; cy++) {
            for (let cx = startChunkX; cx <= endChunkX; cx++) {
                const chunkKey = `${cx},${cy}`;
                const entityKeys = spatialIndexRef.current.get(chunkKey);
                if (entityKeys) {
                    entityKeys.forEach(key => result.add(key));
                }
            }
        }

        return result;
    }, []);

    // Build spatial index when worldData changes
    useEffect(() => {
        const newIndex = new Map<string, Set<string>>();

        for (const key in worldData) {
            const coords = extractCoordinates(key, worldData[key]);
            if (coords) {
                const chunkKey = worldToChunk(coords.x, coords.y);
                if (!newIndex.has(chunkKey)) {
                    newIndex.set(chunkKey, new Set());
                }
                newIndex.get(chunkKey)!.add(key);
            }
        }

        spatialIndexRef.current = newIndex;
    }, [worldData, extractCoordinates, worldToChunk]);

    const [cursorPosInternal, setCursorPosInternal] = useState<Point>(initialCursorPos);
    const [currentScale, setCurrentScale] = useState<{ w: number; h: number }>({ w: 1, h: 2 }); // Default scale 1x2
    const lassoPointsRef = useRef<Point[]>([]); // Track lasso outline points

    // Wrapper to constrain cursor to grid-aligned y-coordinates
    const setCursorPos = useCallback((pos: Point | ((prev: Point) => Point)) => {
        setCursorPosInternal(prevPos => {
            const newPos = typeof pos === 'function' ? pos(prevPos) : pos;
            // Constrain y to grid-aligned positions based on current scale
            // But also check if we are landing on an existing character with different scale?
            // For now, respect currentScale as per plan
            const constrainedY = Math.round(newPos.y / currentScale.h) * currentScale.h;
            // Apply bounds clamping if bounded canvas
            const clamped = clampToBounds(newPos.x, constrainedY);
            return clamped;
        });
    }, [currentScale, clampToBounds]);

    const cursorPos = cursorPosInternal;
    const cursorPosRef = useRef<Point>(initialCursorPos); // Ref for synchronous cursor position access

    // Visual cursor position for smooth animation
    const [visualCursorPos, setVisualCursorPos] = useState<Point>(initialCursorPos);
    const visualCursorPosRef = useRef<Point>(initialCursorPos);
    const animationFrameRef = useRef<number | null>(null);

    // Pathfinding state
    const currentPathRef = useRef<PathPoint[]>([]);
    const pathIndexRef = useRef<number>(0);
    const pathDistanceTraveledRef = useRef<number>(0);
    const lastAnimationTimeRef = useRef<number>(0);

    const [viewOffset, setViewOffset] = useState<Point>(initialCenteredOffset);
    const [zoomLevel, setZoomLevel] = useState<number>(initialZoomLevel); // Store zoom *level*, not index

    const [dialogueText, setDialogueTextState] = useState('');
    const [dialogueTimestamp, setDialogueTimestamp] = useState<number | undefined>(undefined);
    const tapeRecordingCallbackRef = useRef<(() => Promise<void> | void) | null>(null);

    // Wrapper for setDialogueText that also updates timestamp
    const setDialogueText = useCallback((text: string) => {
        setDialogueTextState(prevText => {
            const wasEmpty = !prevText || prevText === '';
            const isNowNonEmpty = text && text !== '';

            // Only update timestamp when dialogue STARTS (empty -> has content)
            // Don't update when cycling through chunks (content -> different content)
            if (wasEmpty && isNowNonEmpty) {
                setDialogueTimestamp(Date.now());
            } else if (!text || text === '') {
                setDialogueTimestamp(undefined);
            }
            // If prevText had content and text has content, keep existing timestamp

            return text;
        });
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

    // Host dialogue handler ref
    const hostDialogueHandlerRef = useRef<(() => void) | null>(null);

    // Upgrade flow handler ref
    const upgradeFlowHandlerRef = useRef<(() => void) | null>(null);

    // Tutorial flow handler ref
    const tutorialFlowHandlerRef = useRef<(() => void) | null>(null);

    // Command validation handler ref (for tutorial flow)
    const commandValidationHandlerRef = useRef<((command: string, args: string[], worldState?: any) => boolean) | null>(null);

    // Agent movement handlers (registered by BitCanvas which has animation state)
    const agentHandlersRef = useRef<WorldEngine['agentHandlers']>(undefined);

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
                const { patternData, patternKey: generatedKey, noteObjects } = generatePatternFromId(initialPatternId, { x: 0, y: 0 });

                // Add pattern and note objects to world data
                setWorldData((prev: WorldData) => ({
                    ...prev,
                    [generatedKey]: JSON.stringify(patternData),
                    ...noteObjects  // Add all note objects
                }));

            }
        }
    }, [initialPatternId]); // Only run once on mount when initialPatternId exists

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


    // === Host Mode State (for onboarding) ===
    const [hostMode, setHostMode] = useState<{
        isActive: boolean;
        currentInputType: import('./host.flows').InputType | null;
    }>({
        isActive: false,
        currentInputType: null
    });

    const [chatData, setChatData] = useState<WorldData>({});
    const [searchData, setSearchData] = useState<WorldData>({});
    const [hostData, setHostData] = useState<{ text: string; color?: string; centerPos: Point; timestamp?: number } | null>(null);
    const [clipboardItems, setClipboardItems] = useState<ClipboardItem[]>([]); // Clipboard items from Cmd+click on bounds

    // === Chat Bubble State ===
    const [bubbleState, setBubbleState] = useState<BubbleState>(createInitialBubbleState());

    const showBubbleMessage = useCallback((text: string, duration?: number) => {
        setBubbleState(showBubble(text, duration));
    }, []);

    const hideBubbleMessage = useCallback(() => {
        setBubbleState(hideBubble());
    }, []);

    // Auto-hide bubble when duration expires
    useEffect(() => {
        if (!bubbleState.isVisible || bubbleState.duration === 0) return;

        const remainingTime = bubbleState.duration - (Date.now() - bubbleState.timestamp);
        if (remainingTime <= 0) {
            setBubbleState(hideBubble());
            return;
        }

        const timeout = setTimeout(() => {
            setBubbleState(hideBubble());
        }, remainingTime);

        return () => clearTimeout(timeout);
    }, [bubbleState]);

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
    const [agentState, setAgentState] = useState<AgentState>('idle');
    const [agentSelectionStart, setAgentSelectionStart] = useState<Point | null>(null);
    const [agentSelectionEnd, setAgentSelectionEnd] = useState<Point | null>(null);

    // Agent Controller - bridges playback system with engine state
    const agentController = useMemo(() => new AgentController((state) => {
        // Sync agent controller state with React state
        setAgentEnabled(state.enabled);
        setAgentPos(state.pos);
        setAgentState(state.state);
        setAgentSelectionStart(state.selectionStart);
        setAgentSelectionEnd(state.selectionEnd);
    }), []);

    // === State Management System ===
    const [statePrompt, setStatePrompt] = useState<{
        type: 'load_confirm' | 'save_before_load_confirm' | 'save_before_load_name' | 'delete_confirm' | null;
        stateName?: string;
        loadStateName?: string; // The state we want to load after saving
        inputBuffer?: string;
    }>({ type: null });
    const [availableStates, setAvailableStates] = useState<string[]>([]);
    const [currentStateName, setCurrentStateName] = useState<string | null>(initialStateName); // Track which state we're currently in

    const getAllChips = useCallback(() => {
        const chips: Array<{text: string, x: number, y: number, color: string}> = [];
        for (const key in worldData) {
            if (key.startsWith('chip_')) {
                const coordsStr = key.substring('chip_'.length);
                const [xStr, yStr] = coordsStr.split(',');
                const x = parseInt(xStr, 10);
                const y = parseInt(yStr, 10);
                if (!isNaN(x) && !isNaN(y)) {
                    try {
                        const chipData = JSON.parse(worldData[key] as string);
                        const text = chipData.text || '';
                        const color = chipData.color || '#000000';
                        if (text.trim()) {
                            chips.push({ text, x, y, color });
                        }
                    } catch (e) {
                        // Skip invalid chip data
                    }
                }
            }
        }
        return chips;
    }, [worldData]);

    // Helper to extract text from a selection region
    const extractTextFromSelection = useCallback((bounds: { startX: number, endX: number, startY: number, endY: number }) => {
        let selectedText = '';
        for (let y = bounds.startY; y <= bounds.endY; y++) {
            let line = '';
            for (let x = bounds.startX; x <= bounds.endX; x++) {
                const cellKey = `${x},${y}`;
                const cellData = worldData[cellKey];
                // Extract character from cell data
                if (!cellData) {
                    line += '';
                } else if (typeof cellData === 'string') {
                    line += cellData;
                } else if (typeof cellData === 'object' && 'char' in cellData) {
                    line += cellData.char;
                }
            }
            selectedText += line.trimEnd() + ' ';
        }
        return selectedText.trim();
    }, [worldData]);

    // Helper to create a note region with consistent structure
    const createNote = useCallback((options: {
        bounds: { startX: number; endX: number; startY: number; endY: number };
        contentType?: 'text' | 'image' | 'mail' | 'list';
        imageData?: { src: string; originalWidth: number; originalHeight: number; isAnimated?: boolean; frameTiming?: any; totalDuration?: number };
        style?: 'ephemeral';
        data?: Record<string, any>;
        patternKey?: string;
        originPatternKey?: string;
        visibleHeight?: number;
        scrollOffset?: number;
        additionalData?: Record<string, any>;
    }) => {
        const { bounds } = options;
        const timestamp = Date.now();
        const noteKey = `note_${bounds.startX},${bounds.startY}_${timestamp}`;

        const noteData = {
            startX: bounds.startX,
            endX: bounds.endX,
            startY: bounds.startY,
            endY: bounds.endY,
            timestamp,
            contentType: options.contentType || 'text',
            data: options.data || {},
            ...(options.imageData && { imageData: options.imageData }),
            ...(options.style && { style: options.style }),
            ...(options.patternKey && { patternKey: options.patternKey }),
            ...(options.originPatternKey && { originPatternKey: options.originPatternKey }),
            ...(options.visibleHeight !== undefined && { visibleHeight: options.visibleHeight }),
            ...(options.scrollOffset !== undefined && { scrollOffset: options.scrollOffset }),
            ...options.additionalData
        };

        return { noteKey, noteData };
    }, []);

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
        const effectiveHeight = Math.max(1, Math.round(effectiveWidth * 1.0)); // Perfect 1:1 ratio (square cells)
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
        // Round y to nearest grid-aligned position based on current scale
        const roundedY = Math.round(worldY / currentScale.h) * currentScale.h;
        return { x: Math.floor(worldX), y: roundedY };
    }, [getEffectiveCharDims, currentScale]);

    // Pixel-perfect screen-to-world conversion (no Y snapping to text scale)
    // Used for paint mode to enable continuous 1x1 strokes
    const screenToWorldPixel = useCallback((screenX: number, screenY: number, currentZoom: number, currentOffset: Point): Point => {
        const { width: effectiveCharWidth, height: effectiveCharHeight } = getEffectiveCharDims(currentZoom);
        if (effectiveCharWidth === 0 || effectiveCharHeight === 0) return currentOffset;
        const worldX = screenX / effectiveCharWidth + currentOffset.x;
        const worldY = screenY / effectiveCharHeight + currentOffset.y;
        // No Y snapping - paint works independently of text scale
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

    const recorder = useMemo(() => new DataRecorder(), []);

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
        isPaintMode,
        paintTool,
        paintColor,
        paintBrushSize,
        paintType,
        exitPaintMode,
        gridMode,
        cycleGridMode,
        artefactsEnabled,
        artifactType,
        isFullscreenMode,
        fullscreenRegion,
        setFullscreenMode,
        exitFullscreenMode,
        restorePreviousBackground,
        executeCommand,
        executeCommandString,
        startCommand,
        startCommandWithInput,
        addCharacter,
        addComposedText,
        removeCompositionTrigger,
        isFaceDetectionEnabled,
        faceOrientation,
        setFaceDetectionEnabled,
        setFaceOrientation,
        isCharacterEnabled,
        characterSprite,
        isGeneratingSprite,
        spriteProgress,
        spriteDebugLog,
        viewOverlay,
        exitViewOverlay,
        setViewOverlayScroll,
        isAgentMode,
        agentSpriteName,
        isAgentAttached,
        setAgentAttached,
    } = useCommandSystem({ setDialogueText, initialBackgroundColor, initialTextColor, skipInitialBackground, getAllChips, availableStates, username, userUid: authenticatedUserUid, membershipLevel, updateSettings, settings, getEffectiveCharDims, zoomLevel, clipboardItems, toggleRecording: tapeRecordingCallbackRef.current || undefined, isReadOnly, getNormalizedSelection, setWorldData, worldData, setSelectionStart, setSelectionEnd, uploadImageToStorage, cancelComposition, monogramSystem, currentScale, setCurrentScale, recorder, setBounds: setCurrentBounds, canvasState, setCanvasState, setBoundedWorldData, boundedSource, setBoundedSource, boundedWorldData, setZoomLevel, setViewOffset, selectionStart, selectionEnd, triggerUpgradeFlow: () => {
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

    // Compute effective view offset - currently just returns viewOffset
    // View overlay centering is handled in bit.canvas.tsx
    const effectiveViewOffset = useMemo(() => {
        return viewOffset;
    }, [viewOffset]);

    // Calculate path when cursor target changes (placed after isCharacterEnabled is available)
    useEffect(() => {
        const target = cursorPosRef.current;
        const current = visualCursorPosRef.current;

        // Only use smooth pathfinding when character sprite is enabled
        if (isCharacterEnabled) {
            // Calculate new path using A* with obstacle avoidance
            const path = findSmoothPath(current, target, worldData);
            currentPathRef.current = path;
            pathIndexRef.current = 0;
            pathDistanceTraveledRef.current = 0;
            lastAnimationTimeRef.current = 0;
        } else {
            // Instant movement - snap cursor directly to target
            setVisualCursorPos(target);
            visualCursorPosRef.current = target;
            currentPathRef.current = [];
        }
    }, [cursorPos, worldData, isCharacterEnabled]);

    // Animate visual cursor position following the path at constant speed
    useEffect(() => {
        // Only animate when character sprite is enabled
        if (!isCharacterEnabled) {
            // Cancel any running animation
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
            return;
        }

        const animate = (currentTime: number) => {
            const path = currentPathRef.current;

            // No path or already at end
            if (path.length === 0 || pathIndexRef.current >= path.length - 1) {
                animationFrameRef.current = null;
                return;
            }

            // Initialize time on first frame
            if (lastAnimationTimeRef.current === 0) {
                lastAnimationTimeRef.current = currentTime;
                animationFrameRef.current = requestAnimationFrame(animate);
                return;
            }

            // Calculate time delta
            const deltaTime = (currentTime - lastAnimationTimeRef.current) / 1000; // Convert to seconds
            lastAnimationTimeRef.current = currentTime;

            // Constant speed (cells per second) - adjust this value to change speed
            const speed = 15; // 15 cells per second
            const distanceToMove = speed * deltaTime;

            // Move along the path
            let remainingDistance = distanceToMove;
            let currentPos = visualCursorPosRef.current;

            while (remainingDistance > 0 && pathIndexRef.current < path.length - 1) {
                const currentWaypoint = path[pathIndexRef.current];
                const nextWaypoint = path[pathIndexRef.current + 1];

                // Distance to next waypoint
                const dx = nextWaypoint.x - currentPos.x;
                const dy = nextWaypoint.y - currentPos.y;
                const distanceToNext = Math.sqrt(dx * dx + dy * dy);

                if (distanceToNext <= remainingDistance) {
                    // Check if next waypoint is an obstacle
                    if (isObstacleAt(worldData, nextWaypoint.x, nextWaypoint.y)) {
                        // Stop movement - can't enter obstacle
                        remainingDistance = 0;
                        break;
                    }

                    // Move to next waypoint
                    currentPos = { x: nextWaypoint.x, y: nextWaypoint.y };
                    remainingDistance -= distanceToNext;
                    pathIndexRef.current++;
                } else {
                    // Move partway to next waypoint
                    const ratio = remainingDistance / distanceToNext;
                    const newPos = {
                        x: currentPos.x + dx * ratio,
                        y: currentPos.y + dy * ratio
                    };

                    // Check if new position would be in an obstacle
                    if (isObstacleAt(worldData, newPos.x, newPos.y)) {
                        // Stop movement - can't enter obstacle
                        remainingDistance = 0;
                        break;
                    }

                    currentPos = newPos;
                    remainingDistance = 0;
                }
            }

            // Update position
            setVisualCursorPos(currentPos);
            visualCursorPosRef.current = currentPos;

            // Check if we've reached the end
            if (pathIndexRef.current >= path.length - 1) {
                const finalPos = path[path.length - 1];
                setVisualCursorPos(finalPos);
                visualCursorPosRef.current = finalPos;
                animationFrameRef.current = null;
                return;
            }

            // Continue animation
            animationFrameRef.current = requestAnimationFrame(animate);
        };

        // Start animation if not already running
        if (!animationFrameRef.current && currentPathRef.current.length > 0) {
            animationFrameRef.current = requestAnimationFrame(animate);
        }

        // Cleanup
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        };
    }, [cursorPos, isCharacterEnabled, worldData]);

    // Wire up agent controller with command system for playback
    useEffect(() => {
        agentController.setCommandSystem({
            executeCommandString,
            startCommand,
            startCommandWithInput,
            addCharacter
        }, executeCommand);
    }, [executeCommandString, startCommand, startCommandWithInput, addCharacter, executeCommand]);

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
            if (key.startsWith('block_') || key.startsWith('label_')) {
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
            if (key.startsWith('block_') || key.startsWith('label_')) {
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
                zoomLevel
            };

            await set(stateRef, stateData);
            setCurrentStateName(stateName); // Track that we're now in this state
            return true;
        } catch (error) {
            logger.error('Error saving state:', error);
            return false;
        }
    }, [worldId, worldData, settings, cursorPos, viewOffset, zoomLevel, getUserPath, userUid]);

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
    const [navMode, setNavMode] = useState<'chips' | 'states' | 'bounds'>('chips');

    const toggleNavMode = useCallback(() => {
        setNavMode(prev => {
            if (prev === 'chips') return 'states';
            if (prev === 'states') return 'bounds';
            return 'chips';
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
        setClipboardItems, // Clipboard setter
        recorder // Pass recorder for content change tracking
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

    // === Agent System ===
    // Agent is now controlled externally (by playback system)
    // No autonomous behaviors - agent is passive until driven by recording playback
    // Agent position, state, and selections are set directly by playback

    // === Bounded Region Detection ===
    // bound_ keys are legacy - always return null
    const getBoundedRegion = useCallback((_worldData: WorldData, _cursorPos: Point): { startX: number; endX: number; y: number } | null => {
        return null;
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
            if (key.startsWith('note_')) {
                try {
                    const noteData = JSON.parse(worldData[key] as string);
                    if (noteData.contentType === 'list') {
                        const listData = noteData as ListData;
                        const { startX, endX, startY, visibleHeight } = listData;

                        // Check if position is within list viewport (no title bar)
                        if (x >= startX && x <= endX &&
                            y >= startY && y < startY + visibleHeight) {
                            return { key, data: listData };
                        }
                    }
                } catch (e) {
                    // Skip invalid note data
                }
            }
        }
        return null;
    }, [worldData]);

    // === Find Note at Selection Region ===
    // Helper function to find note at exact bounds (not a hook to avoid stale closures in async callbacks)
    const findNoteAtSelection = (startX: number, startY: number, endX: number, endY: number, currentWorldData: WorldData): { key: string; data: any } | null => {
        for (const key in currentWorldData) {
            if (key.startsWith('note_') || key.startsWith('image_') ||
                key.startsWith('mail_') ||
                key.startsWith('list_')) {
                try {
                    const noteData = typeof currentWorldData[key] === 'string'
                        ? JSON.parse(currentWorldData[key] as string)
                        : currentWorldData[key];

                    // Check if the selection overlaps with this note
                    if (noteData.startX === startX && noteData.startY === startY &&
                        noteData.endX === endX && noteData.endY === endY) {
                        return { key, data: noteData };
                    }
                } catch (e) {
                    // Skip invalid note data
                }
            }
        }
        return null;
    };

    // Helper function to find note containing a point
    const findNoteContainingPoint = (x: number, y: number, currentWorldData: WorldData): { key: string; data: any } | null => {
        for (const key in currentWorldData) {
            if (key.startsWith('note_') || key.startsWith('image_') ||
                key.startsWith('mail_') ||
                key.startsWith('list_')) {
                try {
                    const noteData = typeof currentWorldData[key] === 'string'
                        ? JSON.parse(currentWorldData[key] as string)
                        : currentWorldData[key];

                    // Check if point is inside this note
                    if (x >= noteData.startX && x <= noteData.endX &&
                        y >= noteData.startY && y <= noteData.endY) {
                        return { key, data: noteData };
                    }
                } catch (e) {
                    // Skip invalid note data
                }
            }
        }
        return null;
    };

    // Helper to find specifically text-type notes (not image/mail/list)
    // Includes 'data' (table) and 'script' notes which use note.data for text storage
    const findTextNoteContainingPoint = (x: number, y: number, currentWorldData: WorldData): { key: string; data: any } | null => {
        for (const key in currentWorldData) {
            if (key.startsWith('note_')) {
                try {
                    const noteData = typeof currentWorldData[key] === 'string'
                        ? JSON.parse(currentWorldData[key] as string)
                        : currentWorldData[key];

                    // Return text-type, data (table), and script notes which all use note.data
                    const isEditableNote = !noteData.contentType ||
                        noteData.contentType === 'text' ||
                        noteData.contentType === 'data' ||
                        noteData.contentType === 'script';

                    // Check if point is inside this note
                    if (isEditableNote && x >= noteData.startX && x <= noteData.endX &&
                        y >= noteData.startY && y <= noteData.endY) {
                        return { key, data: noteData };
                    }
                } catch (e) {
                    // Skip invalid note data
                }
            }
        }
        return null;
    };

    // Helper to get the cell (row, col) at a cursor position in a data note
    // Returns null if not in a data note or cursor is outside table bounds
    const getCellAtPosition = (cursorX: number, cursorY: number, noteData: any): { row: number; col: number; cellStartX: number; cellEndX: number; cellStartY: number; cellEndY: number } | null => {
        if (noteData.contentType !== 'data' || !noteData.tableData) return null;

        const { columns, rows } = noteData.tableData;
        if (!columns || !rows) return null;

        const { startX, startY } = noteData;

        // Find which row the cursor is in
        let rowStartY = startY - 1; // Grid starts at startY - 1 due to GRID_CELL_SPAN offset
        let foundRow = -1;
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            const rowHeight = rows[rowIndex].height * GRID_CELL_SPAN;
            const rowEndY = rowStartY + rowHeight;
            if (cursorY >= rowStartY && cursorY < rowEndY) {
                foundRow = rowIndex;
                break;
            }
            rowStartY = rowEndY;
        }

        if (foundRow === -1) return null;

        // Find which column the cursor is in
        let colStartX = startX;
        let foundCol = -1;
        for (let colIndex = 0; colIndex < columns.length; colIndex++) {
            const colWidth = columns[colIndex].width;
            const colEndX = colStartX + colWidth;
            if (cursorX >= colStartX && cursorX < colEndX) {
                foundCol = colIndex;
                break;
            }
            colStartX = colEndX;
        }

        if (foundCol === -1) return null;

        // Calculate cell bounds
        let cellStartX = startX;
        for (let c = 0; c < foundCol; c++) {
            cellStartX += columns[c].width;
        }
        const cellEndX = cellStartX + columns[foundCol].width;

        let cellStartY = startY - 1;
        for (let r = 0; r < foundRow; r++) {
            cellStartY += rows[r].height * GRID_CELL_SPAN;
        }
        const cellEndY = cellStartY + rows[foundRow].height * GRID_CELL_SPAN;

        return {
            row: foundRow,
            col: foundCol,
            cellStartX,
            cellEndX,
            cellStartY,
            cellEndY
        };
    };

    // Helper to rewrap text in a note when switching to wrap mode or resizing
    const rewrapNoteTextInternal = (noteData: any): any => {
        if (!noteData.data || Object.keys(noteData.data).length === 0) {
            return noteData; // No text to rewrap
        }

        const noteWidth = noteData.endX - noteData.startX;

        // Group characters by their Y coordinate (lines)
        const lineMap: Map<number, Array<{ relativeX: number; char: string; style?: any }>> = new Map();

        for (const coordKey in noteData.data) {
            const [xStr, yStr] = coordKey.split(',');
            const relativeX = parseInt(xStr);
            const relativeY = parseInt(yStr);

            const charData = noteData.data[coordKey];
            const char = typeof charData === 'string' ? charData :
                        (charData && typeof charData === 'object' && 'char' in charData) ? charData.char : '';
            const style = typeof charData === 'object' && 'style' in charData ? charData.style : undefined;

            if (!lineMap.has(relativeY)) {
                lineMap.set(relativeY, []);
            }
            lineMap.get(relativeY)!.push({ relativeX, char, style });
        }

        // Sort lines by Y coordinate
        const sortedLines = Array.from(lineMap.entries()).sort((a, b) => a[0] - b[0]);

        // Rewrap each line that exceeds the note width
        const newData: any = {};
        let currentY = 0;

        for (const [originalY, characters] of sortedLines) {
            // Sort characters by X coordinate
            characters.sort((a, b) => a.relativeX - b.relativeX);

            // Build array of characters for this line
            const lineChars: Array<{ char: string; style?: any }> = [];
            for (const { char, style } of characters) {
                lineChars.push({ char, style });
            }

            // Word-wrap this line
            let currentX = 0;
            let lineStart = 0; // Start index for current line being built

            for (let i = 0; i < lineChars.length; i++) {
                const { char, style } = lineChars[i];

                // Check if placing this character would exceed width
                if (currentX > noteWidth) {
                    // Find last space in the range [lineStart, i)
                    let wrapIndex = -1;
                    for (let j = i - 1; j >= lineStart; j--) {
                        if (lineChars[j].char === ' ') {
                            wrapIndex = j;
                            break;
                        }
                    }

                    // Wrap at space if found, otherwise wrap at current position
                    if (wrapIndex >= lineStart) {
                        // Wrap at space - move to next line and skip the space
                        currentY += GRID_CELL_SPAN;
                        currentX = 0;
                        lineStart = wrapIndex + 1; // Skip the space
                        i = wrapIndex; // Will increment to wrapIndex + 1 on next iteration
                        continue;
                    } else {
                        // No space found - hard wrap at current position
                        currentY += GRID_CELL_SPAN;
                        currentX = 0;
                        lineStart = i;
                    }
                }

                // Place character
                const coordKey = `${currentX},${currentY}`;
                newData[coordKey] = style ? { char, style } : char;
                currentX++;
            }

            // Move to next line after this original line (preserve line breaks)
            currentY += GRID_CELL_SPAN;
        }

        return {
            ...noteData,
            data: newData
        };
    };

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

        // Delete characters within selection (including multi-cell characters)
        // Scan selection range AND check below the selection for tall characters
        // Characters are bottom-anchored, so a char at Y=10 (1x6) spans Y=5..10.
        // If selection is Y=5..8, we need to check Y=8..8+MaxHeight for anchors.
        const SCAN_LOOKAHEAD = 20; // Reasonable max height for characters
        const effectiveMaxY = selection.endY + SCAN_LOOKAHEAD;

        for (let y = selection.startY; y <= effectiveMaxY; y++) {
            for (let x = selection.startX; x <= selection.endX; x++) {
                const key = `${x},${y}`;
                const data = newWorldData[key];
                
                if (data) {
                    // If within selection bounds, delete immediately
                    if (y <= selection.endY) {
                        delete newWorldData[key];
                        deleted = true;
                    } else if (!isImageData(data)) {
                        // If below selection, check if this character's height extends UP into the selection
                        const scale = getCharScale(data);
                        const topY = y - (scale.h - 1);
                        
                        // If the top of this character is inside the selection (or above the bottom of selection)
                        if (topY <= selection.endY) {
                             delete newWorldData[key];
                             deleted = true;
                        }
                    }
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

                                // Add image as note
                                const { noteKey, noteData } = createNote({
                                    bounds: {
                                        startX: minX,
                                        startY: minY,
                                        endX: minX + cellsWide - 1,
                                        endY: minY + cellsHigh - 1
                                    },
                                    contentType: 'image',
                                    imageData: {
                                        src: finalImageUrl,
                                        originalWidth: img.width,
                                        originalHeight: img.height
                                    }
                                });
                                newWorldData[noteKey] = JSON.stringify(noteData);

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
        let nextWorldData = { ...activeWorldData }; // Create mutable copy - uses boundedWorldData when canvasState === 1
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

        // === View Overlay Exit ===
        if (key === 'Escape' && viewOverlay) {
            exitViewOverlay();
            setDialogueWithRevert("Exited view mode", setDialogueText);
            return true;
        }

        // === Paint Mode Exit ===
        if (key === 'Escape' && isPaintMode) {
            exitPaintMode();
            setDialogueWithRevert("Paint mode disabled", setDialogueText);
            return true;
        }

        // === Fullscreen Mode Exit ===
        if (key === 'Escape' && isFullscreenMode) {
            exitFullscreenMode();
            setDialogueWithRevert("Exited fullscreen mode", setDialogueText);
            return true;
        }

        // === Staged Artifact Clearing ===
        if (key === 'Escape' && Object.keys(lightModeData).length > 0) {
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
                            setProcessingRegion({ startX: minX, endX: maxX, startY: minY, endY: maxY });

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
                                        setProcessingRegion(null); // Clear visual feedback
                                        setDialogueWithRevert("Could not load image for editing", setDialogueText);
                                        return true;
                                    }
                                } else {
                                    logger.error('Invalid image format:', selectedImageData);
                                    setProcessingRegion(null); // Clear visual feedback
                                    setDialogueWithRevert("Invalid image format", setDialogueText);
                                    return true;
                                }

                                ai(aiPrompt, { referenceImage: base64ImageData, userId: userUid || undefined }).then(async (result) => {
                                const imageResult = result.image || { imageData: null, text: result.text || '' };
                                // Check if quota exceeded
                                if (imageResult.text && imageResult.text.startsWith('AI limit reached')) {
                                    if (upgradeFlowHandlerRef.current) {
                                        upgradeFlowHandlerRef.current();
                                    }
                                    return true;
                                }

                                if (imageResult.imageData) {
                                    const newWorldData = { ...worldData };

                                    // Upload to storage if available
                                    let finalImageUrl = imageResult.imageData;
                                    if (uploadImageToStorage) {
                                        try {
                                            finalImageUrl = await uploadImageToStorage(imageResult.imageData);
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

                                        const { noteKey, noteData } = createNote({
                                            bounds: {
                                                startX: minX,
                                                startY: minY,
                                                endX: minX + cellsWide - 1,
                                                endY: minY + cellsHigh - 1
                                            },
                                            contentType: 'image',
                                            imageData: {
                                                src: finalImageUrl,
                                                originalWidth: img.width,
                                                originalHeight: img.height
                                            }
                                        });
                                        updatedWorldData[noteKey] = JSON.stringify(noteData);
                                        setWorldData(updatedWorldData);
                                        setProcessingRegion(null); // Clear visual feedback
                                        setDialogueWithRevert("Image transformed", setDialogueText);

                                        // Clear selection after processing
                                        setSelectionStart(null);
                                        setSelectionEnd(null);
                                    };
                                    img.src = imageResult.imageData;
                                } else {
                                    setProcessingRegion(null); // Clear visual feedback
                                    setDialogueWithRevert("Image generation failed", setDialogueText);
                                }
                                }).catch((error) => {
                                    setProcessingRegion(null); // Clear visual feedback
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
                            setProcessingRegion({ startX: minX, endX: maxX, startY: minY, endY: maxY });

                            ai(aiPrompt, { userId: userUid || undefined }).then(async (result) => {
                                const imageResult = result.image || { imageData: null, text: result.text || '' };
                                // Check if quota exceeded
                                if (imageResult.text && imageResult.text.startsWith('AI limit reached')) {
                                    if (upgradeFlowHandlerRef.current) {
                                        upgradeFlowHandlerRef.current();
                                    }
                                    return true;
                                }

                                if (imageResult.imageData) {
                                    const newWorldData = { ...worldData };

                                    // Upload to storage if available
                                    let finalImageUrl = imageResult.imageData;
                                    if (uploadImageToStorage) {
                                        try {
                                            finalImageUrl = await uploadImageToStorage(imageResult.imageData);
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

                                        const { noteKey, noteData } = createNote({
                                            bounds: {
                                                startX: minX,
                                                startY: minY,
                                                endX: minX + cellsWide - 1,
                                                endY: minY + cellsHigh - 1
                                            },
                                            contentType: 'image',
                                            imageData: {
                                                src: finalImageUrl,
                                                originalWidth: img.width,
                                                originalHeight: img.height
                                            }
                                        });
                                        updatedWorldData[noteKey] = JSON.stringify(noteData);

                                        setWorldData(updatedWorldData);
                                        setProcessingRegion(null); // Clear visual feedback
                                        setDialogueWithRevert("Image generated", setDialogueText);

                                        // Clear selection after processing
                                        setSelectionStart(null);
                                        setSelectionEnd(null);
                                    };
                                    img.src = finalImageUrl;
                                } else {
                                    setProcessingRegion(null); // Clear visual feedback
                                    setDialogueWithRevert("Could not generate image", setDialogueText);
                                }
                            }).catch((error) => {
                                setProcessingRegion(null); // Clear visual feedback
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
                        ai(fullPrompt, { userId: userUid || undefined }).then((result) => {
                            const response = result.text || result.error || '';
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
                            setProcessingRegion(imageRegion);

                            ai(aiPrompt, { referenceImage: base64ImageData, userId: userUid || undefined, aspectRatio }).then(async (result) => {
                            const imageResult = result.image || { imageData: null, text: result.text || '' };
                            // Check if quota exceeded
                            if (imageResult.text && imageResult.text.startsWith('AI limit reached')) {
                                if (upgradeFlowHandlerRef.current) {
                                    upgradeFlowHandlerRef.current();
                                }
                                return true;
                            }

                            if (imageResult.imageData) {
                                // Upload to storage if available
                                let finalImageUrl = imageResult.imageData;
                                if (uploadImageToStorage) {
                                    try {
                                        finalImageUrl = await uploadImageToStorage(imageResult.imageData);
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
                                    setProcessingRegion(null); // Clear visual feedback
                                    setDialogueWithRevert("Image transformed", setDialogueText);
                                };
                                img.src = imageResult.imageData;
                            } else {
                                setProcessingRegion(null); // Clear visual feedback
                                setDialogueWithRevert("Image generation failed", setDialogueText);
                            }
                            }).catch((error) => {
                                setProcessingRegion(null); // Clear visual feedback
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
                        ai(fullPrompt, { userId: userUid || undefined }).then((result) => {
                            const response = result.text || result.error || '';
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

                    // Priority 4: Try AI actions first (tool calling), fall back to chat
                    setDialogueWithRevert("Asking AI...", setDialogueText);

                    // Build tool context for executing AI actions
                    const toolContext: ToolContext = {
                        paintCells: (cells) => {
                            if (cells.length === 0) return;
                            // Group cells by color for efficient blob storage
                            const cellsByColor = new Map<string, Array<{x: number, y: number}>>();
                            for (const cell of cells) {
                                const color = cell.color || '#000000';
                                if (!cellsByColor.has(color)) {
                                    cellsByColor.set(color, []);
                                }
                                cellsByColor.get(color)!.push({ x: Math.floor(cell.x), y: Math.floor(cell.y) });
                            }

                            setWorldData(prev => {
                                let updated = { ...prev };
                                for (const [color, colorCells] of cellsByColor) {
                                    const { blob } = findOrCreateBlobForCell(updated, colorCells[0].x, colorCells[0].y, color, 'color');
                                    const updatedBlob = addCellsToBlob(blob, colorCells);
                                    updated[`paintblob_${updatedBlob.id}`] = JSON.stringify(updatedBlob);
                                }
                                return updated;
                            });
                        },
                        eraseCells: (cells) => {
                            if (cells.length === 0) return;
                            const cellsToErase = cells.map(c => ({ x: Math.floor(c.x), y: Math.floor(c.y) }));

                            setWorldData(prev => {
                                const newData = { ...prev };
                                const paintBlobs = getAllPaintBlobs(prev);

                                // Remove cells from any paintblobs they belong to
                                for (const blob of paintBlobs) {
                                    const cellsInThisBlob = cellsToErase.filter(cell =>
                                        blob.cells.includes(`${cell.x},${cell.y}`)
                                    );

                                    if (cellsInThisBlob.length > 0) {
                                        const updatedBlob = removeCellsFromBlob(blob, cellsInThisBlob);
                                        const blobKey = `paintblob_${blob.id}`;

                                        if (updatedBlob === null) {
                                            delete newData[blobKey];
                                        } else {
                                            newData[blobKey] = JSON.stringify(updatedBlob);
                                        }
                                    }
                                }

                                // Also delete any direct cell entries (legacy format)
                                for (const cell of cellsToErase) {
                                    const key = `${cell.x},${cell.y}`;
                                    delete newData[key];
                                }

                                return newData;
                            });
                        },
                        getCursorPosition: () => cursorPos,
                        setCursorPosition: (x, y) => setCursorPos({ x, y }),
                        getViewport: () => ({ offset: viewOffset, zoomLevel }),
                        setViewport: (x, y, zoom) => {
                            setViewOffset({ x, y });
                            if (zoom !== undefined) setZoomLevel(zoom);
                        },
                        getSelection: () => ({ start: selectionStart, end: selectionEnd }),
                        setSelection: (startX, startY, endX, endY) => {
                            setSelectionStart({ x: startX, y: startY });
                            setSelectionEnd({ x: endX, y: endY });
                        },
                        clearSelection: () => {
                            setSelectionStart(null);
                            setSelectionEnd(null);
                        },
                        getAgents: () => {
                            // Get agents from worldData (they're stored with agent_ prefix)
                            const agents: Array<{ id: string; x: number; y: number; spriteName?: string }> = [];
                            for (const key in worldData) {
                                if (key.startsWith('agent_')) {
                                    try {
                                        const agentDataStr = worldData[key];
                                        const agentData = typeof agentDataStr === 'string' ? JSON.parse(agentDataStr) : agentDataStr;
                                        if (agentData && typeof agentData.x === 'number' && typeof agentData.y === 'number') {
                                            agents.push({
                                                id: key,
                                                x: agentData.x,
                                                y: agentData.y,
                                                spriteName: agentData.name || agentData.spriteName,
                                            });
                                        }
                                    } catch {}
                                }
                            }
                            return agents;
                        },
                        createAgent: (x, y, spriteName) => {
                            const agentId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                            const agentData = {
                                x, y,
                                name: spriteName,
                                timestamp: Date.now(),
                            };
                            setWorldData(prev => ({ ...prev, [agentId]: JSON.stringify(agentData) }));
                            return agentId;
                        },
                        moveAgents: (agentIds, destination) => {
                            // Use agentHandlers if available for animated movement
                            if (agentHandlersRef.current?.moveAgents) {
                                agentHandlersRef.current.moveAgents(agentIds, destination);
                            } else {
                                // Fallback: Update agent positions directly in worldData
                                setWorldData(prev => {
                                    const newData = { ...prev };
                                    for (const agentId of agentIds) {
                                        const agentDataStr = prev[agentId];
                                        if (agentDataStr) {
                                            try {
                                                const agentData = typeof agentDataStr === 'string' ? JSON.parse(agentDataStr) : agentDataStr;
                                                agentData.x = destination.x;
                                                agentData.y = destination.y;
                                                newData[agentId] = JSON.stringify(agentData);
                                            } catch {}
                                        }
                                    }
                                    return newData;
                                });
                            }
                        },
                        moveAgentsPath: (agentIds, path) => {
                            if (agentHandlersRef.current?.moveAgentsPath) {
                                agentHandlersRef.current.moveAgentsPath(agentIds, path);
                            }
                        },
                        moveAgentsExpr: (agentIds, xExpr, yExpr, vars, duration) => {
                            if (agentHandlersRef.current?.moveAgentsExpr) {
                                agentHandlersRef.current.moveAgentsExpr(agentIds, xExpr, yExpr, vars, duration);
                            }
                        },
                        stopAgentsExpr: (agentIds) => {
                            if (agentHandlersRef.current?.stopAgentsExpr) {
                                agentHandlersRef.current.stopAgentsExpr(agentIds);
                            }
                        },
                        setAgentMind: (agentId, persona, goals) => {
                            // Update agent data with mind info
                            const agentDataStr = worldData[agentId];
                            if (!agentDataStr) return;
                            try {
                                const agentData = typeof agentDataStr === 'string' ? JSON.parse(agentDataStr) : agentDataStr;
                                agentData.mind = {
                                    persona: persona || agentData.mind?.persona || '',
                                    goals: goals || agentData.mind?.goals || [],
                                    thoughts: agentData.mind?.thoughts || []
                                };
                                setWorldData(prev => ({ ...prev, [agentId]: JSON.stringify(agentData) }));
                            } catch {}
                        },
                        agentThink: async (agentId) => {
                            // Trigger AI thinking for an agent
                            if (agentHandlersRef.current?.agentThink) {
                                return agentHandlersRef.current.agentThink(agentId);
                            }
                            return null;
                        },
                        getNotes: () => {
                            const notes: Array<{ id: string; x: number; y: number; width: number; height: number; contentType?: string; content?: string }> = [];
                            for (const key in worldData) {
                                if (key.startsWith('note_')) {
                                    try {
                                        const data = typeof worldData[key] === 'string' ? JSON.parse(worldData[key]) : worldData[key];
                                        if (data.type === 'note') {
                                            notes.push({
                                                id: key,
                                                x: data.x,
                                                y: data.y,
                                                width: data.width,
                                                height: data.height,
                                                contentType: data.contentType || 'text',
                                                content: data.content || '',
                                            });
                                        }
                                    } catch {}
                                }
                            }
                            return notes;
                        },
                        createNote: (x, y, width, height, contentType?, content?, imageData?, generateImage?, scriptData?, tableData?) => {
                            const noteKey = `note_${Date.now()}`;
                            const GRID_CELL_SPAN = 2;

                            // Convert text content to grid format
                            const contentToGrid = (text: string): Record<string, string> => {
                                const data: Record<string, string> = {};
                                const lines = text.split('\n');
                                for (let lineY = 0; lineY < lines.length; lineY++) {
                                    const line = lines[lineY];
                                    for (let charX = 0; charX < line.length; charX++) {
                                        data[`${charX},${lineY * GRID_CELL_SPAN}`] = line[charX];
                                    }
                                }
                                return data;
                            };

                            const noteData: Record<string, any> = {
                                startX: x,
                                startY: y,
                                endX: x + width,
                                endY: y + height,
                                contentType: contentType || 'text',
                                timestamp: Date.now(),
                            };

                            // Handle different content types
                            if (contentType === 'script') {
                                noteData.scriptData = { language: scriptData?.language || 'javascript', status: 'idle' };
                                if (content) noteData.data = contentToGrid(content);
                            } else if (contentType === 'data' && tableData) {
                                noteData.tableData = {
                                    ...tableData,
                                    frozenRows: tableData.frozenRows ?? 1,
                                    frozenCols: tableData.frozenCols ?? 0,
                                    activeCell: tableData.activeCell ?? { row: 0, col: 0 },
                                    cellScrollOffsets: tableData.cellScrollOffsets ?? {}
                                };
                                noteData.scrollOffset = 0;
                                noteData.scrollOffsetX = 0;
                            } else if (contentType === 'image' && imageData) {
                                noteData.imageData = imageData;
                            } else if (content) {
                                noteData.data = contentToGrid(content);
                            }

                            setWorldData(prev => ({ ...prev, [noteKey]: JSON.stringify(noteData) }));
                        },
                        getChips: () => {
                            const chips: Array<{ id: string; x: number; y: number; text: string; color?: string }> = [];
                            for (const key in worldData) {
                                if (key.startsWith('chip_')) {
                                    try {
                                        const data = typeof worldData[key] === 'string' ? JSON.parse(worldData[key]) : worldData[key];
                                        if (data.type === 'chip') {
                                            chips.push({
                                                id: key,
                                                x: data.x,
                                                y: data.y,
                                                text: data.text || '',
                                                color: data.color,
                                            });
                                        }
                                    } catch {}
                                }
                            }
                            return chips;
                        },
                        createChip: (x, y, text, color) => {
                            const chipKey = `chip_${x},${y}_${Date.now()}`;
                            const chipData = {
                                x, y, text,
                                color,
                                timestamp: Date.now(),
                            };
                            setWorldData(prev => ({ ...prev, [chipKey]: JSON.stringify(chipData) }));
                        },
                        writeText: (x, y, text) => {
                            setWorldData(prev => {
                                const newData = { ...prev };
                                for (let i = 0; i < text.length; i++) {
                                    const key = `${x + i},${y}`;
                                    newData[key] = text[i];
                                }
                                return newData;
                            });
                        },
                        runCommand: (command) => {
                            // Execute command through command system
                            logger.debug('runCommand called', { command });
                            // TODO: Could integrate with command system here
                        },
                        deleteEntity: (type, id) => {
                            setWorldData(prev => {
                                const newData = { ...prev };
                                delete newData[id];
                                return newData;
                            });
                        },
                    };

                    // Gather canvas state for multi-turn tool calling
                    const canvasState: CanvasState = {
                        cursorPosition: cursorPos,
                        viewport: { offset: viewOffset, zoomLevel },
                        selection: { start: selectionStart, end: selectionEnd },
                        agents: toolContext.getAgents(),
                        notes: toolContext.getNotes(),
                        chips: toolContext.getChips(),
                    };

                    // Try AI chat with tools (multi-turn)
                    ai(aiPrompt, { canvasState, userId: userUid || undefined }).then(async (result) => {
                        // Check for quota error
                        if (result.error?.includes('AI limit reached')) {
                            if (upgradeFlowHandlerRef.current) {
                                upgradeFlowHandlerRef.current();
                            }
                            return;
                        }

                        // If we got actions, execute them
                        if (result.actions && result.actions.length > 0) {
                            let executedCount = 0;
                            for (const action of result.actions) {
                                const execResult = await executeTool(action.tool, action.args, toolContext);
                                if (execResult.success) {
                                    executedCount++;
                                    logger.debug('Executed AI action:', action.tool, execResult.result);
                                } else {
                                    logger.error('AI action failed:', action.tool, execResult.error);
                                }
                            }
                            const message = result.text || `Executed ${executedCount} action${executedCount !== 1 ? 's' : ''}`;
                            setDialogueWithRevert(message, setDialogueText);
                            return;
                        }

                        // If AI responded with text but no actions, show the text
                        if (result.text) {
                            setDialogueWithRevert(result.text, setDialogueText);
                            return;
                        }

                        // No actions and no text - fall back to regular chat
                        return ai(aiPrompt, { userId: userUid || undefined }).then((fallbackResult) => {
                            const response = fallbackResult.text || fallbackResult.error || '';
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
                                const wrapWidth = 80;
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
                                setCursorPos({
                                    x: responseStartPos.x + wrappedLines[wrappedLines.length - 1].length,
                                    y: responseStartPos.y + wrappedLines.length - 1
                                });
                                setDialogueWithRevert("AI response written", setDialogueText);
                            } else {
                                createSubtitleCycler(response, setDialogueText);
                                addInstantAIResponse(responseStartPos, response, { queryText: aiPrompt, centered: false });
                            }
                        });
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

                } else if (exec.command === 'chip' || exec.command === 'task' || exec.command === 'link') {
                    // Unified chip creation - handles waypoint, task, link, and pack chips
                    if (!selectionStart || !selectionEnd) {
                        setDialogueWithRevert("Make a selection first", setDialogueText);
                        return true;
                    }

                    const hasSelection = selectionStart.x !== selectionEnd.x || selectionStart.y !== selectionEnd.y;
                    if (!hasSelection) {
                        setDialogueWithRevert("Selection must span more than one cell", setDialogueText);
                        return true;
                    }

                    const normalized = getNormalizedSelection();
                    if (!normalized) {
                        return true;
                    }

                    // Validate specific command requirements (removed - handled later in each chip type)

                    // Create base chip data
                    const chipKey = `chip_${normalized.startX},${normalized.startY}_${Date.now()}`;
                    const baseChipData = {
                        x: normalized.startX,
                        y: normalized.startY,
                        startX: normalized.startX,
                        endX: normalized.endX,
                        startY: normalized.startY,
                        endY: normalized.endY,
                        timestamp: Date.now()
                    };

                    let chipData: any = { ...baseChipData };
                    let successMessage = '';

                    // Helper: Capture and internalize data from selection
                    const captureData = () => {
                        const capturedData: Record<string, string> = {};
                        const cellsToRemove: string[] = [];

                        for (let y = normalized.startY; y <= normalized.endY; y++) {
                            for (let x = normalized.startX; x <= normalized.endX; x++) {
                                const cellKey = `${x},${y}`;
                                const cellData = worldData[cellKey];
                                if (cellData !== undefined) {
                                    const relativeX = x - normalized.startX;
                                    const relativeY = y - normalized.startY;
                                    const relativeKey = `${relativeX},${relativeY}`;
                                    capturedData[relativeKey] = typeof cellData === 'string' ? cellData : JSON.stringify(cellData);
                                    cellsToRemove.push(cellKey);
                                }
                            }
                        }

                        return { capturedData, cellsToRemove };
                    };

                    // Helper: Parse chip type from /chip command args
                    const parseChipType = () => {
                        if (exec.command !== 'chip' || exec.args.length === 0) return null;
                        const firstArg = exec.args[0].toLowerCase();
                        if (['pack', 'link', 'task'].includes(firstArg)) {
                            return firstArg as 'pack' | 'link' | 'task';
                        }
                        return null;
                    };

                    const chipType = parseChipType();
                    const actualCommand = chipType || exec.command;
                    const commandArgs = chipType ? exec.args.slice(1) : exec.args;

                    // Skip pack chips - handled by separate /pack command
                    if (actualCommand === 'pack') {
                        setDialogueWithRevert("Use /pack command instead of /chip pack", setDialogueText);
                        return true;
                    }

                    // Add type-specific data
                    if (actualCommand === 'chip') {
                        // Waypoint chip - capture and internalize selected data
                        const selectedText = extractTextFromSelection(normalized);

                        const { capturedData, cellsToRemove } = captureData();

                        chipData.text = selectedText || commandArgs[0] || 'chip';
                        chipData.data = capturedData;
                        chipData.color = textColor;
                        chipData.background = backgroundColor;

                        // Parse color argument
                        const colorArg = selectedText ? commandArgs[0] : commandArgs[1];
                        if (colorArg) {
                            const hexColor = (COLOR_MAP[colorArg.toLowerCase()] || colorArg).toUpperCase();
                            if (/^#[0-9A-F]{6}$/i.test(hexColor)) {
                                chipData.color = hexColor;
                            }
                        }

                        // Remove captured data from global worldData (internalize it)
                        setWorldData(prev => {
                            const newData = { ...prev };
                            cellsToRemove.forEach(key => delete newData[key]);
                            return newData;
                        });

                        const cellCount = Object.keys(capturedData).length;
                        successMessage = `Chip "${chipData.text}" created (${cellCount} cells captured)`;
                    } else if (actualCommand === 'task') {
                        // Task chip - capture and internalize data
                        chipData.type = 'task';
                        chipData.completed = false;

                        const selectedText = extractTextFromSelection(normalized);
                        const { capturedData, cellsToRemove } = captureData();

                        chipData.text = selectedText || commandArgs[0] || 'task';
                        chipData.data = capturedData;

                        // Parse color argument
                        const colorArg = selectedText ? commandArgs[0] : commandArgs[1];
                        if (colorArg) {
                            const hexColor = (COLOR_MAP[colorArg.toLowerCase()] || colorArg).toUpperCase();
                            if (/^#[0-9A-F]{6}$/i.test(hexColor)) {
                                chipData.color = hexColor;
                            }
                        }

                        // Remove captured data from global worldData (internalize it)
                        setWorldData(prev => {
                            const newData = { ...prev };
                            cellsToRemove.forEach(key => delete newData[key]);
                            return newData;
                        });

                        const cellCount = Object.keys(capturedData).length;
                        successMessage = `Task "${chipData.text}" created (${cellCount} cells). Click to toggle.`;
                    } else if (actualCommand === 'link') {
                        // Link chip - capture and internalize data
                        chipData.type = 'link';

                        const selectedText = extractTextFromSelection(normalized);
                        const { capturedData, cellsToRemove } = captureData();

                        chipData.text = selectedText || commandArgs[0] || 'link';
                        chipData.data = capturedData;

                        // Parse URL and color arguments
                        // If selection exists: /link [url] [color]
                        // If no selection: /link [text] [url] [color]
                        const urlArg = selectedText ? commandArgs[0] : commandArgs[1];
                        const colorArg = selectedText ? commandArgs[1] : commandArgs[2];

                        if (!urlArg) {
                            setDialogueWithRevert("Usage: /link [url] [color] or /link [text] [url] [color]", setDialogueText);
                            return true;
                        }

                        let validUrl = urlArg;
                        if (!urlArg.match(/^https?:\/\//i)) {
                            validUrl = 'https://' + urlArg;
                        }
                        chipData.url = validUrl;

                        if (colorArg) {
                            const hexColor = (COLOR_MAP[colorArg.toLowerCase()] || colorArg).toUpperCase();
                            if (/^#[0-9A-F]{6}$/i.test(hexColor)) {
                                chipData.color = hexColor;
                            }
                        }

                        // Remove captured data from global worldData (internalize it)
                        setWorldData(prev => {
                            const newData = { ...prev };
                            cellsToRemove.forEach(key => delete newData[key]);
                            return newData;
                        });

                        const cellCount = Object.keys(capturedData).length;
                        successMessage = `Link "${chipData.text}" created (${cellCount} cells). Click to open.`;
                    }

                    // Store chip in worldData
                    setWorldData(prev => ({
                        ...prev,
                        [chipKey]: JSON.stringify(chipData)
                    }));

                    setDialogueWithRevert(successMessage, setDialogueText);

                    // Clear selection
                    setSelectionStart(null);
                    setSelectionEnd(null);
                } else if (exec.command === 'pack') {
                    // /pack command - create a pack chip that collapses region into a labeled chip
                    if (!selectionStart || !selectionEnd) {
                        setDialogueWithRevert("Make a selection first", setDialogueText);
                        return true;
                    }

                    const hasSelection = selectionStart.x !== selectionEnd.x || selectionStart.y !== selectionEnd.y;
                    if (!hasSelection) {
                        setDialogueWithRevert("Selection must span more than one cell", setDialogueText);
                        return true;
                    }

                    const normalized = getNormalizedSelection();
                    if (!normalized) {
                        return true;
                    }

                    // Require text argument
                    if (exec.args.length === 0) {
                        setDialogueWithRevert("Usage: /pack [text] [color]", setDialogueText);
                        return true;
                    }

                    const packText = exec.args[0];
                    const colorArg = exec.args[1];

                    // Store the original selection bounds for expansion
                    const expandedBounds = {
                        startX: normalized.startX,
                        endX: normalized.endX,
                        startY: normalized.startY,
                        endY: normalized.endY
                    };

                    // Capture all world data within the selection bounds using relative coordinates
                    const packedData: Record<string, string> = {};
                    const cellsToRemove: string[] = [];
                    for (let y = normalized.startY; y <= normalized.endY; y++) {
                        for (let x = normalized.startX; x <= normalized.endX; x++) {
                            const cellKey = `${x},${y}`;
                            const cellData = worldData[cellKey];
                            if (cellData !== undefined) {
                                // Convert to relative coordinates (pack origin is 0,0)
                                const relativeX = x - normalized.startX;
                                const relativeY = y - normalized.startY;
                                const relativeKey = `${relativeX},${relativeY}`;
                                // Store the raw data (string or object)
                                packedData[relativeKey] = typeof cellData === 'string' ? cellData : JSON.stringify(cellData);
                                cellsToRemove.push(cellKey);
                            }
                        }
                    }

                    // Also capture any notes, chips, or other entities that overlap with this region
                    // Convert their coordinates to relative (pack origin at 0,0)
                    const overlappingEntities: Record<string, string> = {};
                    const entitiesToRemove: string[] = [];
                    for (const [key, value] of Object.entries(worldData)) {
                        // Check if this is a structured entity (note, chip, etc)
                        if (key.startsWith('note_') || key.startsWith('chip_') || key.startsWith('label_')) {
                            try {
                                const entityData = typeof value === 'string' ? JSON.parse(value) : value;
                                // Check if entity overlaps with pack region
                                if (entityData.startX !== undefined && entityData.endX !== undefined &&
                                    entityData.startY !== undefined && entityData.endY !== undefined) {
                                    const overlaps = !(
                                        entityData.endX < normalized.startX ||
                                        entityData.startX > normalized.endX ||
                                        entityData.endY < normalized.startY ||
                                        entityData.startY > normalized.endY
                                    );
                                    if (overlaps) {
                                        // Convert entity coordinates to relative (pack origin at 0,0)
                                        const relativeEntity = {
                                            ...entityData,
                                            startX: entityData.startX - normalized.startX,
                                            endX: entityData.endX - normalized.startX,
                                            startY: entityData.startY - normalized.startY,
                                            endY: entityData.endY - normalized.startY,
                                            x: entityData.x !== undefined ? entityData.x - normalized.startX : entityData.x,
                                            y: entityData.y !== undefined ? entityData.y - normalized.startY : entityData.y
                                        };
                                        overlappingEntities[key] = JSON.stringify(relativeEntity);
                                        entitiesToRemove.push(key);
                                    }
                                }
                            } catch (e) {
                                // Skip invalid JSON
                            }
                        }
                    }

                    // Create small pack chip at top-left corner (just big enough for text)
                    const chipStartX = normalized.startX;
                    const chipStartY = normalized.startY;
                    const chipEndX = chipStartX + packText.length - 1;
                    const chipEndY = chipStartY; // Single row

                    const chipKey = `chip_${chipStartX},${chipStartY}_${Date.now()}`;
                    const chipData: any = {
                        type: 'pack',
                        x: chipStartX,
                        y: chipStartY,
                        startX: chipStartX,
                        endX: chipEndX,
                        startY: chipStartY,
                        endY: chipEndY,
                        timestamp: Date.now(),
                        text: packText,
                        collapsed: true, // Start collapsed
                        expandedBounds, // Store original bounds for expansion
                        packedData,
                        packedEntities: overlappingEntities,
                        color: textColor,
                        background: backgroundColor
                    };

                    // Parse color argument
                    if (colorArg) {
                        const hexColor = (COLOR_MAP[colorArg.toLowerCase()] || colorArg).toUpperCase();
                        if (/^#[0-9A-F]{6}$/i.test(hexColor)) {
                            chipData.color = hexColor;
                        }
                    }

                    // Remove packed data and entities from worldData (internalize them)
                    setWorldData(prev => {
                        const newData = { ...prev };
                        cellsToRemove.forEach(key => delete newData[key]);
                        entitiesToRemove.forEach(key => delete newData[key]);
                        // Add the pack chip
                        newData[chipKey] = JSON.stringify(chipData);
                        return newData;
                    });

                    const width = expandedBounds.endX - expandedBounds.startX + 1;
                    const height = expandedBounds.endY - expandedBounds.startY + 1;
                    const cellCount = Object.keys(packedData).length;
                    const entityCount = Object.keys(overlappingEntities).length;
                    setDialogueWithRevert(`Pack "${packText}" created (${width}×${height}, ${cellCount} cells, ${entityCount} entities). Click to expand.`, setDialogueText);

                    // Clear selection
                    setSelectionStart(null);
                    setSelectionEnd(null);
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
                } else if (exec.command === 'spawn') {
                    // Set spawn point at current cursor position
                    const spawnPoint = { x: cursorPos.x, y: cursorPos.y };

                    // Update settings with spawn point
                    const newSettings = { spawnPoint };
                    updateSettings(newSettings);
                    setDialogueWithRevert(`Spawn point set at (${spawnPoint.x}, ${spawnPoint.y})`, setDialogueText);
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
                        setAgentState('idle');
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

                        // Check for list at cursor (bound_ is legacy - removed)
                        {
                            for (const key in worldData) {
                                if (key.startsWith('note_')) {
                                    try {
                                        const noteData = JSON.parse(worldData[key] as string);
                                        if (noteData.contentType === 'list') {
                                            const listData = noteData;
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
                                        }
                                    } catch (e) {
                                        // Skip invalid note data
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
                    setHostData(null);
                    // Reset cursor to origin
                    setCursorPos({ x: 0, y: 0 });
                    // Clear any selections
                    setSelectionStart(null);
                    setSelectionEnd(null);
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
                        const noteData = {
                            startX: selection.startX,
                            startY: selection.startY,
                            endX: selection.endX,
                            endY: selection.startY + visibleHeight - 1,
                            timestamp: Date.now(),
                            contentType: 'list',
                            visibleHeight: visibleHeight,
                            scrollOffset: 0,
                            color: color
                        };
                        const noteKey = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;


                        // Store list and content
                        let newWorldData = { ...worldData };
                        newWorldData[noteKey] = JSON.stringify(noteData);
                        newWorldData[`${noteKey}_content`] = JSON.stringify(initialContent);


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


                    // Look through all note_ entries to find one that contains the cursor
                    for (const key in worldData) {
                        if (key.startsWith('note_')) {
                            try {
                                const noteData = JSON.parse(worldData[key] as string);
                                if (noteData.contentType === 'list') {
                                    const listData = noteData;

                                    // Check if cursor is within the list viewport
                                    const withinList = cursorX >= listData.startX && cursorX <= listData.endX &&
                                                      cursorY >= listData.startY && cursorY < listData.startY + listData.visibleHeight;

                                    if (withinList) {
                                        // Remove this list and its content
                                        delete newWorldData[key];
                                        delete newWorldData[`${key}_content`];
                                        foundList = true;
                                    }
                                }
                            } catch (e) {
                                console.error('Error parsing note data:', key, e);
                            }
                        }
                    }

                    if (foundList) {
                        setWorldData(newWorldData);
                        setDialogueWithRevert(`List removed`, setDialogueText);
                    } else {
                        setDialogueWithRevert(`No list found at cursor position`, setDialogueText);
                    }
                } else if (exec.command === 'data') {
                    // Create a data table from selection
                    // Parses selected content as CSV or creates empty grid
                    const selection = getNormalizedSelection();

                    if (selection) {
                        const selectionWidth = selection.endX - selection.startX + 1;
                        const selectionHeight = selection.endY - selection.startY + 1;

                        // Capture existing content from selection
                        const lines: string[] = [];
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
                            lines.push(lineText.trimEnd());
                        }

                        // Parse as CSV (simple comma-separated, handles quoted fields)
                        const parseCSVLine = (line: string): string[] => {
                            const result: string[] = [];
                            let current = '';
                            let inQuotes = false;
                            for (let i = 0; i < line.length; i++) {
                                const char = line[i];
                                if (char === '"') {
                                    inQuotes = !inQuotes;
                                } else if (char === ',' && !inQuotes) {
                                    result.push(current.trim());
                                    current = '';
                                } else {
                                    current += char;
                                }
                            }
                            result.push(current.trim());
                            return result;
                        };

                        // Parse all lines
                        const parsedRows = lines.filter(l => l.length > 0).map(parseCSVLine);

                        // Determine column count (max columns across all rows)
                        const numCols = parsedRows.reduce((max, row) => Math.max(max, row.length), 0) || 3;
                        const numRows = parsedRows.length || 3;

                        // Calculate column widths (max content width + padding, min 4)
                        const columnWidths: number[] = [];
                        for (let col = 0; col < numCols; col++) {
                            let maxWidth = 4;
                            for (let row = 0; row < parsedRows.length; row++) {
                                const cellValue = parsedRows[row]?.[col] || '';
                                maxWidth = Math.max(maxWidth, cellValue.length + 2);
                            }
                            columnWidths.push(Math.min(maxWidth, 20)); // Cap at 20
                        }

                        // Build table data
                        const columns = columnWidths.map(width => ({ width }));
                        const rows = Array(numRows).fill(null).map(() => ({ height: 1 }));

                        // Calculate table bounds based on column widths
                        const totalWidth = columnWidths.reduce((sum, w) => sum + w, 0);
                        const totalHeight = numRows * 2; // Each row is 2 world units (GRID_CELL_SPAN)

                        // Build tableData.cells with "row,col" → full cell text
                        const cells: Record<string, string> = {};
                        for (let rowIdx = 0; rowIdx < parsedRows.length; rowIdx++) {
                            const row = parsedRows[rowIdx];
                            for (let colIdx = 0; colIdx < row.length; colIdx++) {
                                const cellValue = row[colIdx] || '';
                                if (cellValue) {
                                    cells[`${rowIdx},${colIdx}`] = cellValue;
                                }
                            }
                        }

                        // Create table note
                        const noteData = {
                            startX: selection.startX,
                            startY: selection.startY,
                            endX: selection.startX + totalWidth - 1,
                            endY: selection.startY + totalHeight - 1,
                            timestamp: Date.now(),
                            contentType: 'data',
                            tableData: {
                                columns,
                                rows,
                                cells, // "row,col" → full cell text
                                frozenRows: parsedRows.length > 0 ? 1 : 0,
                                frozenCols: 0,
                                activeCell: { row: 0, col: 0 }, // Start with first cell active
                                cellScrollOffsets: {} // "row,col" → horizontal scroll offset
                            },
                            scrollOffset: 0,
                            scrollOffsetX: 0
                        };
                        const noteKey = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                        // Store table
                        let newWorldData = { ...worldData };
                        newWorldData[noteKey] = JSON.stringify(noteData);

                        // Clear the selection area
                        for (let y = selection.startY; y <= selection.endY; y++) {
                            for (let x = selection.startX; x <= selection.endX; x++) {
                                delete newWorldData[`${x},${y}`];
                            }
                        }

                        setWorldData(newWorldData);
                        setDialogueWithRevert(`Data table created: ${numCols} columns × ${numRows} rows`, setDialogueText);

                        // Clear selection
                        setSelectionStart(null);
                        setSelectionEnd(null);
                    } else {
                        setDialogueWithRevert(`No region selected. Select text (CSV format) then use /data`, setDialogueText);
                    }
                } else if (exec.command === 'script') {
                    // Convert existing note at cursor into a script note
                    // Usage: /script [lang] where lang is js/javascript/py/python (optional)
                    // Use commandStartPos (where / was typed) not current cursor position
                    const cmdPos = exec.commandStartPos;
                    const noteAtCursor = findNoteContainingPoint(cmdPos.x, cmdPos.y, worldData);

                    if (!noteAtCursor) {
                        setDialogueWithRevert(`No note at cursor. Move cursor into a note first.`, setDialogueText);
                        return true;
                    }

                    // Check for explicit language argument
                    const langArg = exec.args[0]?.toLowerCase();

                    // If already a script, allow changing language with explicit arg
                    if (noteAtCursor.data.contentType === 'script') {
                        if (langArg === 'py' || langArg === 'python' || langArg === 'js' || langArg === 'javascript') {
                            const newLang = (langArg === 'py' || langArg === 'python') ? 'python' : 'javascript';
                            const currentLang = noteAtCursor.data.scriptData?.language || 'javascript';

                            if (newLang === currentLang) {
                                setDialogueWithRevert(`Already a ${currentLang} script.`, setDialogueText);
                                return true;
                            }

                            // Update language
                            const updatedNoteData = {
                                ...noteAtCursor.data,
                                scriptData: {
                                    ...noteAtCursor.data.scriptData,
                                    language: newLang,
                                    status: 'idle'
                                }
                            };
                            const newWorldData = { ...worldData };
                            newWorldData[noteAtCursor.key] = JSON.stringify(updatedNoteData);
                            setWorldData(newWorldData);
                            setDialogueWithRevert(`Changed to ${newLang}. Use /run to execute.`, setDialogueText);
                            return true;
                        } else {
                            const currentLang = noteAtCursor.data.scriptData?.language || 'javascript';
                            setDialogueWithRevert(`Already a ${currentLang} script. Use /script py or /script js to change language.`, setDialogueText);
                            return true;
                        }
                    }
                    let language: 'javascript' | 'python' = 'javascript';
                    let languageSource = 'default';

                    if (langArg === 'py' || langArg === 'python') {
                        language = 'python';
                        languageSource = 'argument';
                    } else if (langArg === 'js' || langArg === 'javascript') {
                        language = 'javascript';
                        languageSource = 'argument';
                    } else {
                        // Auto-detect language from content
                        const noteDataContent = noteAtCursor.data.data || {};
                        const dataKeys = Object.keys(noteDataContent);

                        // Helper to get first few lines of content
                        const getContentPreview = (): string => {
                            if (dataKeys.length === 0) return '';

                            const isLineBased = dataKeys.some(k => /^\d+$/.test(k));
                            if (isLineBased) {
                                const lineNumbers = dataKeys.filter(k => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
                                return lineNumbers.slice(0, 5).map(n => noteDataContent[n.toString()] || '').join('\n');
                            } else {
                                // Coordinate-based: reconstruct first few lines
                                const lines: string[] = [];
                                for (let y = 0; y < 5; y++) {
                                    let line = '';
                                    for (let x = 0; x < 100; x++) {
                                        const char = noteDataContent[`${x},${y}`];
                                        if (char) {
                                            line += typeof char === 'string' ? char : (char.char || '');
                                        }
                                    }
                                    if (line.trim()) lines.push(line.trimEnd());
                                }
                                return lines.join('\n');
                            }
                        };

                        const preview = getContentPreview();

                        // Python detection patterns
                        const pythonPatterns = [
                            /^#!.*py/m,           // Shebang
                            /^import\s+\w/m,      // import statement
                            /^from\s+\w+\s+import/m, // from x import
                            /^def\s+\w+\s*\(/m,   // def function():
                            /^class\s+\w+/m,      // class definition
                            /print\s*\(/,         // print() function
                            /:\s*$/m,             // Lines ending with :
                        ];

                        if (pythonPatterns.some(pattern => pattern.test(preview))) {
                            language = 'python';
                            languageSource = 'auto-detected';
                        } else {
                            languageSource = 'default';
                        }
                    }

                    // Update note to script type (keep all existing data intact)
                    const updatedNoteData = {
                        ...noteAtCursor.data,
                        contentType: 'script',
                        scriptData: {
                            language,
                            status: 'idle'
                        }
                    };

                    const newWorldData = { ...worldData };
                    newWorldData[noteAtCursor.key] = JSON.stringify(updatedNoteData);
                    setWorldData(newWorldData);

                    setDialogueWithRevert(`Script (${language}, ${languageSource}). Use /run to execute.`, setDialogueText);
                } else if (exec.command === 'run') {
                    // Execute script note at cursor position
                    // Use commandStartPos (where / was typed) not current cursor position
                    const cmdPos = exec.commandStartPos;
                    const noteAtCursor = findNoteContainingPoint(cmdPos.x, cmdPos.y, worldData);

                    if (!noteAtCursor) {
                        setDialogueWithRevert(`No note at cursor position. Move cursor into a script note.`, setDialogueText);
                        return true;
                    }

                    if (noteAtCursor.data.contentType !== 'script') {
                        setDialogueWithRevert(`Not a script note. Use /script to create one.`, setDialogueText);
                        return true;
                    }

                    const scriptData = noteAtCursor.data.scriptData || { language: 'javascript', status: 'idle' };
                    const { startX, startY, endX, endY } = noteAtCursor.data;

                    // Get note content - handle multiple formats
                    // It could be: object, string (JSON), or undefined
                    let noteDataObj: Record<string, any> = {};
                    const rawData = noteAtCursor.data.data;

                    if (typeof rawData === 'string') {
                        // Data stored as JSON string - parse it
                        try {
                            noteDataObj = JSON.parse(rawData);
                        } catch {
                            noteDataObj = {};
                        }
                    } else if (rawData && typeof rawData === 'object') {
                        noteDataObj = rawData;
                    }

                    // Reconstruct script content - handle both formats:
                    // 1. Line-based: {"0": "line1", "1": "line2"} (from /upload)
                    // 2. Coordinate-based: {"x,y": "char"} (from manual typing)
                    let scriptContent = '';
                    const keys = Object.keys(noteDataObj);

                    if (keys.length === 0) {
                        setDialogueWithRevert(`Script is empty. (rawData type: ${typeof rawData})`, setDialogueText);
                        return true;
                    }

                    // Check if first key looks like line-based (just a number) or coordinate-based (x,y)
                    const isLineBased = keys.some(k => /^\d+$/.test(k));

                    if (isLineBased) {
                        // Line-based format from /upload
                        const lineNumbers = keys.filter(k => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
                        scriptContent = lineNumbers.map(n => noteDataObj[n.toString()] || '').join('\n');
                    } else {
                        // Coordinate-based format from manual typing
                        const noteWidth = endX - startX + 1;
                        const lines: string[] = [];

                        // Determine max Y coordinate in the data
                        let maxY = 0;
                        for (const key of keys) {
                            const parts = key.split(',');
                            if (parts.length === 2) {
                                const y = parseInt(parts[1]);
                                if (!isNaN(y) && y > maxY) maxY = y;
                            }
                        }

                        // Build lines from coordinate data
                        // Y coordinates are spaced by GRID_CELL_SPAN (2)
                        const GRID_CELL_SPAN = 2;
                        for (let y = 0; y <= maxY; y += GRID_CELL_SPAN) {
                            let line = '';
                            for (let x = 0; x < noteWidth; x++) {
                                const coordKey = `${x},${y}`;
                                const charData = noteDataObj[coordKey];
                                if (charData) {
                                    line += typeof charData === 'string' ? charData : (charData.char || ' ');
                                } else {
                                    line += ' ';
                                }
                            }
                            lines.push(line.trimEnd());
                        }
                        scriptContent = lines.join('\n');
                    }

                    scriptContent = scriptContent.trim();

                    if (!scriptContent) {
                        setDialogueWithRevert(`Script is empty.`, setDialogueText);
                        return true;
                    }

                    // Update status to running
                    const updatedNoteData = {
                        ...noteAtCursor.data,
                        scriptData: { ...scriptData, status: 'running' }
                    };
                    const newWorldData = { ...worldData };
                    newWorldData[noteAtCursor.key] = JSON.stringify(updatedNoteData);
                    setWorldData(newWorldData);

                    // Execute based on language
                    if (scriptData.language === 'javascript') {
                        try {
                            // Collect output from print() calls
                            const outputs: string[] = [];

                            // Create helper functions available to scripts
                            const print = (...args: any[]) => {
                                const message = args.map(a =>
                                    typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
                                ).join(' ');
                                outputs.push(message);
                            };

                            const log = print; // Alias

                            // Execute script with helpers in scope
                            // Using Function constructor to provide clean scope with helpers
                            const scriptFunction = new Function('print', 'log', 'console', `
                                ${scriptContent}
                            `);

                            const result = scriptFunction(print, log, console);

                            if (result !== undefined) {
                                outputs.push(`→ ${typeof result === 'object' ? JSON.stringify(result) : result}`);
                            }

                            // Update status to success
                            const successNoteData = {
                                ...noteAtCursor.data,
                                scriptData: { ...scriptData, status: 'success' }
                            };
                            const successWorldData = { ...worldData };
                            successWorldData[noteAtCursor.key] = JSON.stringify(successNoteData);
                            setWorldData(successWorldData);

                            // Show output in dialogue if there is any
                            if (outputs.length > 0) {
                                const outputPreview = outputs.slice(0, 3).join(' | ');
                                const more = outputs.length > 3 ? ` (+${outputs.length - 3} more)` : '';
                                setDialogueWithRevert(`Output: ${outputPreview}${more}`, setDialogueText);
                            } else {
                                setDialogueWithRevert(`Script executed. Check console (F12) for output.`, setDialogueText);
                            }
                        } catch (error: any) {
                            console.error('Script Error:', error);

                            // Update status to error
                            const errorNoteData = {
                                ...noteAtCursor.data,
                                scriptData: { ...scriptData, status: 'error' }
                            };
                            const errorWorldData = { ...worldData };
                            errorWorldData[noteAtCursor.key] = JSON.stringify(errorNoteData);
                            setWorldData(errorWorldData);
                            setDialogueWithRevert(`Script error: ${error.message}`, setDialogueText);
                        }
                    } else if (scriptData.language === 'python') {
                        // Python execution via Pyodide
                        const executePython = async () => {
                            try {
                                // Show loading message if Pyodide isn't loaded yet
                                if (!isPyodideLoaded()) {
                                    setDialogueWithRevert(`Loading Python runtime (~10MB)...`, setDialogueText);
                                }

                                // Gather all named data tables from worldData
                                const namedTables: Record<string, string[][]> = {};
                                for (const key in worldData) {
                                    if (key.startsWith('note_')) {
                                        try {
                                            const noteData = JSON.parse(worldData[key] as string);
                                            if (noteData.contentType === 'data' && noteData.name && noteData.tableData) {
                                                const { columns, rows, cells } = noteData.tableData;
                                                // Convert tableData.cells to list-of-lists
                                                const tableRows: string[][] = [];
                                                for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
                                                    const rowData: string[] = [];
                                                    for (let colIdx = 0; colIdx < columns.length; colIdx++) {
                                                        const cellKey = `${rowIdx},${colIdx}`;
                                                        rowData.push(cells?.[cellKey] || '');
                                                    }
                                                    tableRows.push(rowData);
                                                }
                                                namedTables[noteData.name] = tableRows;
                                            }
                                        } catch (e) { /* ignore parse errors */ }
                                    }
                                }

                                const { result, stdout, stderr, error, tableOutput, tableUpdates } = await runPython(scriptContent, namedTables);

                                if (error) {
                                    console.error('Python Error:', error);

                                    // Update status to error
                                    const errorNoteData = {
                                        ...noteAtCursor.data,
                                        scriptData: { ...scriptData, status: 'error' }
                                    };
                                    setWorldData(prev => ({
                                        ...prev,
                                        [noteAtCursor.key]: JSON.stringify(errorNoteData)
                                    }));
                                    setDialogueWithRevert(`Python error: ${error}`, setDialogueText);
                                    return;
                                }

                                // If tableOutput exists, create a data note to the right of the script
                                let newWorldDataUpdates: Record<string, string> = {};
                                let dataTableCreated = false;

                                if (tableOutput) {
                                    // Parse CSV to create table data
                                    const parseCSVLine = (line: string): string[] => {
                                        const result: string[] = [];
                                        let current = '';
                                        let inQuotes = false;
                                        for (let i = 0; i < line.length; i++) {
                                            const char = line[i];
                                            if (char === '"') {
                                                inQuotes = !inQuotes;
                                            } else if (char === ',' && !inQuotes) {
                                                result.push(current.trim());
                                                current = '';
                                            } else {
                                                current += char;
                                            }
                                        }
                                        result.push(current.trim());
                                        return result;
                                    };

                                    const lines = tableOutput.split('\n').filter(l => l.trim().length > 0);
                                    const parsedRows = lines.map(parseCSVLine);

                                    const numCols = parsedRows.reduce((max, row) => Math.max(max, row.length), 0) || 3;
                                    const numRows = parsedRows.length || 3;

                                    // Calculate column widths
                                    const columnWidths: number[] = [];
                                    for (let col = 0; col < numCols; col++) {
                                        let maxWidth = 4;
                                        for (let row = 0; row < parsedRows.length; row++) {
                                            const cellValue = parsedRows[row]?.[col] || '';
                                            maxWidth = Math.max(maxWidth, cellValue.length + 2);
                                        }
                                        columnWidths.push(Math.min(maxWidth, 16)); // Cap at 16
                                    }

                                    // Build table data
                                    const columns = columnWidths.map(width => ({ width }));
                                    const rows = Array(numRows).fill(null).map(() => ({ height: 1 }));
                                    const totalWidth = columnWidths.reduce((sum, w) => sum + w, 0);
                                    const totalHeight = numRows * 2; // GRID_CELL_SPAN = 2

                                    // Build cells
                                    const cells: Record<string, string> = {};
                                    for (let rowIdx = 0; rowIdx < parsedRows.length; rowIdx++) {
                                        const row = parsedRows[rowIdx];
                                        for (let colIdx = 0; colIdx < row.length; colIdx++) {
                                            const cellValue = row[colIdx] || '';
                                            if (cellValue) {
                                                cells[`${rowIdx},${colIdx}`] = cellValue;
                                            }
                                        }
                                    }

                                    // Position: 3 cells to the right of script note's right edge
                                    const scriptRight = noteAtCursor.data.endX;
                                    const outputStartX = scriptRight + 4;
                                    const outputStartY = noteAtCursor.data.startY;

                                    const dataNote = {
                                        startX: outputStartX,
                                        startY: outputStartY,
                                        endX: outputStartX + totalWidth - 1,
                                        endY: outputStartY + totalHeight - 1,
                                        timestamp: Date.now(),
                                        contentType: 'data',
                                        tableData: {
                                            columns,
                                            rows,
                                            cells,
                                            frozenRows: parsedRows.length > 0 ? 1 : 0,
                                            frozenCols: 0,
                                            activeCell: { row: 0, col: 0 },
                                            cellScrollOffsets: {}
                                        },
                                        scrollOffset: 0,
                                        scrollOffsetX: 0
                                    };

                                    const dataKey = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                                    newWorldDataUpdates[dataKey] = JSON.stringify(dataNote);
                                    dataTableCreated = true;
                                }

                                // Handle in-place table updates from write_table()
                                let tablesUpdated = 0;
                                if (tableUpdates && Object.keys(tableUpdates).length > 0) {
                                    // Find and update each named table
                                    for (const [tableName, tableRows] of Object.entries(tableUpdates)) {
                                        // Find the note with this name
                                        for (const key in worldData) {
                                            if (key.startsWith('note_')) {
                                                try {
                                                    const noteData = JSON.parse(worldData[key] as string);
                                                    if (noteData.contentType === 'data' && noteData.name === tableName && noteData.tableData) {
                                                        // Update the table data
                                                        const numCols = tableRows.reduce((max: number, row: string[]) => Math.max(max, row.length), 0);
                                                        const numRows = tableRows.length;

                                                        // Rebuild cells
                                                        const cells: Record<string, string> = {};
                                                        for (let rowIdx = 0; rowIdx < tableRows.length; rowIdx++) {
                                                            const row = tableRows[rowIdx];
                                                            for (let colIdx = 0; colIdx < row.length; colIdx++) {
                                                                const cellValue = row[colIdx] || '';
                                                                if (cellValue) {
                                                                    cells[`${rowIdx},${colIdx}`] = cellValue;
                                                                }
                                                            }
                                                        }

                                                        // Calculate column widths
                                                        const columnWidths: number[] = [];
                                                        for (let col = 0; col < numCols; col++) {
                                                            let maxWidth = 4;
                                                            for (let row = 0; row < tableRows.length; row++) {
                                                                const cellValue = tableRows[row]?.[col] || '';
                                                                maxWidth = Math.max(maxWidth, cellValue.length + 2);
                                                            }
                                                            columnWidths.push(Math.min(maxWidth, 16));
                                                        }

                                                        const columns = columnWidths.map(width => ({ width }));
                                                        const rows = Array(numRows).fill(null).map(() => ({ height: 1 }));
                                                        const totalWidth = columnWidths.reduce((sum, w) => sum + w, 0);
                                                        const totalHeight = numRows * 2;

                                                        // Update note data
                                                        const updatedNoteData = {
                                                            ...noteData,
                                                            endX: noteData.startX + totalWidth - 1,
                                                            endY: noteData.startY + totalHeight - 1,
                                                            tableData: {
                                                                ...noteData.tableData,
                                                                columns,
                                                                rows,
                                                                cells,
                                                            }
                                                        };

                                                        newWorldDataUpdates[key] = JSON.stringify(updatedNoteData);
                                                        tablesUpdated++;
                                                        break;
                                                    }
                                                } catch (e) { /* ignore parse errors */ }
                                            }
                                        }
                                    }
                                }

                                // Update status to success and add any new notes
                                const successNoteData = {
                                    ...noteAtCursor.data,
                                    scriptData: { ...scriptData, status: 'success' }
                                };
                                setWorldData(prev => ({
                                    ...prev,
                                    [noteAtCursor.key]: JSON.stringify(successNoteData),
                                    ...newWorldDataUpdates
                                }));

                                // Collect outputs
                                const outputs: string[] = [...stdout];
                                if (stderr.length > 0) {
                                    outputs.push(...stderr.map(s => `⚠ ${s}`));
                                }
                                if (result !== undefined && result !== null) {
                                    outputs.push(`→ ${typeof result === 'object' ? JSON.stringify(result) : result}`);
                                }

                                // Show output in dialogue
                                const statusParts: string[] = [];
                                if (dataTableCreated) statusParts.push('data table created');
                                if (tablesUpdated > 0) statusParts.push(`${tablesUpdated} table${tablesUpdated > 1 ? 's' : ''} updated`);

                                if (statusParts.length > 0) {
                                    setDialogueWithRevert(`Script executed → ${statusParts.join(', ')}`, setDialogueText);
                                } else if (outputs.length > 0) {
                                    const outputPreview = outputs.slice(0, 3).join(' | ');
                                    const more = outputs.length > 3 ? ` (+${outputs.length - 3} more)` : '';
                                    setDialogueWithRevert(`Output: ${outputPreview}${more}`, setDialogueText);
                                } else {
                                    setDialogueWithRevert(`Python script executed. Check console (F12) for output.`, setDialogueText);
                                }
                            } catch (err: any) {
                                console.error('Pyodide Error:', err);

                                // Update status to error
                                const errorNoteData = {
                                    ...noteAtCursor.data,
                                    scriptData: { ...scriptData, status: 'error' }
                                };
                                setWorldData(prev => ({
                                    ...prev,
                                    [noteAtCursor.key]: JSON.stringify(errorNoteData)
                                }));
                                setDialogueWithRevert(`Pyodide error: ${err.message}`, setDialogueText);
                            }
                        };

                        // Execute async
                        executePython();
                    }
                } else if (exec.command === 'duplicate') {
                    // Duplicate the note at cursor position
                    // Creates an identical copy 3 cells to the right
                    const cmdPos = exec.commandStartPos;
                    const noteAtCursor = findNoteContainingPoint(cmdPos.x, cmdPos.y, worldData);

                    if (!noteAtCursor) {
                        setDialogueWithRevert(`No note at cursor. Move cursor into a note to duplicate.`, setDialogueText);
                        return true;
                    }

                    const originalData = noteAtCursor.data;
                    const noteWidth = originalData.endX - originalData.startX;
                    const noteHeight = originalData.endY - originalData.startY;

                    // Offset: 3 cells to the right of the original note's right edge
                    const offsetX = noteWidth + 4; // +1 for the width itself, +3 for gap

                    // Create new note data with offset positions
                    const newNoteData = {
                        ...originalData,
                        startX: originalData.startX + offsetX,
                        endX: originalData.endX + offsetX,
                        timestamp: Date.now(),
                    };

                    // Generate new key
                    const newKey = `note_${newNoteData.startX},${newNoteData.startY}_${newNoteData.timestamp}`;

                    // Add to world data
                    const newWorldData = { ...worldData };
                    newWorldData[newKey] = JSON.stringify(newNoteData);
                    setWorldData(newWorldData);

                    // Move cursor to the new note
                    setCursorPos({ x: newNoteData.startX, y: newNoteData.startY });

                    const noteType = originalData.contentType || 'text';
                    setDialogueWithRevert(`Duplicated ${noteType} note`, setDialogueText);
                } else if (exec.command === 'name') {
                    // Name a note for script references
                    // Usage: /name mydata
                    const cmdPos = exec.commandStartPos;
                    const noteAtCursor = findNoteContainingPoint(cmdPos.x, cmdPos.y, worldData);

                    if (!noteAtCursor) {
                        setDialogueWithRevert(`No note at cursor. Move cursor into a note to name it.`, setDialogueText);
                        return true;
                    }

                    const newName = exec.args[0];
                    if (!newName) {
                        // Show current name if no arg provided
                        const currentName = noteAtCursor.data.name;
                        if (currentName) {
                            setDialogueWithRevert(`This note is named: "${currentName}"`, setDialogueText);
                        } else {
                            setDialogueWithRevert(`Usage: /name <identifier>. Names can be letters, numbers, underscores.`, setDialogueText);
                        }
                        return true;
                    }

                    // Validate name: only alphanumeric and underscores
                    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(newName)) {
                        setDialogueWithRevert(`Invalid name. Use letters, numbers, underscores. Must start with letter or underscore.`, setDialogueText);
                        return true;
                    }

                    // Check for duplicate names
                    for (const key in worldData) {
                        if (key.startsWith('note_') && key !== noteAtCursor.key) {
                            try {
                                const otherNote = JSON.parse(worldData[key] as string);
                                if (otherNote.name === newName) {
                                    setDialogueWithRevert(`Name "${newName}" is already used by another note.`, setDialogueText);
                                    return true;
                                }
                            } catch (e) { /* ignore parse errors */ }
                        }
                    }

                    // Update note with name
                    const updatedNoteData = {
                        ...noteAtCursor.data,
                        name: newName
                    };
                    const newWorldData = { ...worldData };
                    newWorldData[noteAtCursor.key] = JSON.stringify(updatedNoteData);
                    setWorldData(newWorldData);

                    const noteType = noteAtCursor.data.contentType || 'text';
                    setDialogueWithRevert(`Named ${noteType} note: "${newName}"`, setDialogueText);
                } else if (exec.command === 'grow') {
                    // Run cellular automata - generative, animates step by step
                    // Parse args: /grow [steps] [rule] [color]
                    let steps = 5;
                    let rule: CARule = 'life';
                    let color = '#22c55e'; // Default green

                    for (const arg of exec.args) {
                        const numArg = parseInt(arg);
                        if (!isNaN(numArg) && numArg > 0 && numArg <= 100) {
                            steps = numArg;
                        } else if (['life', 'grow', 'maze', 'seeds', 'coral'].includes(arg)) {
                            rule = arg as CARule;
                        } else if (arg.startsWith('#') || COLOR_MAP[arg.toLowerCase()]) {
                            color = COLOR_MAP[arg.toLowerCase()] || arg;
                        }
                    }

                    // Get starting cells: use existing paint at cursor, or cursor position as seed
                    const blobAtCursor = findBlobAt(worldData, cursorPos.x, cursorPos.y);
                    let currentCells: Array<{x: number, y: number}>;
                    let existingBlobId: string | null = null;

                    if (blobAtCursor) {
                        // Use existing paint as seed
                        currentCells = blobAtCursor.cells.map((cellKey: string) => {
                            const [x, y] = cellKey.split(',').map(Number);
                            return { x, y };
                        });
                        existingBlobId = blobAtCursor.id;
                        color = blobAtCursor.color; // Inherit color
                    } else {
                        // Use cursor position as seed (small cross pattern for better CA dynamics)
                        const cx = cursorPos.x;
                        const cy = cursorPos.y;
                        currentCells = [
                            { x: cx, y: cy },
                            { x: cx - 1, y: cy },
                            { x: cx + 1, y: cy },
                            { x: cx, y: cy - 1 },
                            { x: cx, y: cy + 1 },
                        ];
                    }

                    // Animate CA step by step
                    let currentStep = 0;
                    const blobId = `blob_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                    const runStep = () => {
                        if (currentStep >= steps || currentCells.length === 0 || currentCells.length > 10000) {
                            setDialogueWithRevert(`CA (${rule}) complete: ${currentCells.length} cells after ${currentStep} steps`, setDialogueText);
                            return;
                        }

                        // Run one CA step
                        currentCells = runCA(currentCells, 1, rule);
                        currentStep++;

                        if (currentCells.length === 0) {
                            // CA died - remove blob
                            setWorldData(prev => {
                                const updated = { ...prev };
                                delete updated[`paintblob_${blobId}`];
                                if (existingBlobId) delete updated[`paintblob_${existingBlobId}`];
                                return updated;
                            });
                            setDialogueWithRevert(`CA died out after ${currentStep} steps`, setDialogueText);
                            return;
                        }

                        // Create/update blob with current state
                        const blob = createPaintBlob(color, currentCells);

                        setWorldData(prev => {
                            const updated = { ...prev };
                            // Remove old blob if transforming existing paint
                            if (existingBlobId && currentStep === 1) {
                                delete updated[`paintblob_${existingBlobId}`];
                            }
                            updated[`paintblob_${blobId}`] = JSON.stringify({ ...blob, id: blobId });
                            return updated;
                        });

                        setDialogueText(`CA (${rule}) step ${currentStep}/${steps}: ${currentCells.length} cells`);

                        // Schedule next step
                        setTimeout(runStep, 150); // 150ms between steps
                    };

                    // Start animation
                    runStep();
                } else if (exec.command === 'upload') {
                    // Determine target note and bounds for upload
                    // Priority: 1) cursor inside note region, 2) exact selection match, 3) use selection
                    let targetNote: { key: string; data: any } | null = null;
                    let uploadBounds: { startX: number; startY: number; endX: number; endY: number } | null = null;

                    // First check if cursor is inside a note region (no selection needed)
                    const noteAtCursor = findNoteContainingPoint(cursorPos.x, cursorPos.y, worldData);
                    if (noteAtCursor) {
                        targetNote = noteAtCursor;
                        uploadBounds = {
                            startX: noteAtCursor.data.startX,
                            startY: noteAtCursor.data.startY,
                            endX: noteAtCursor.data.endX,
                            endY: noteAtCursor.data.endY
                        };
                    } else {
                        // No note at cursor, require a selection
                        const selection = getNormalizedSelection();
                        if (!selection) {
                            setDialogueWithRevert("Please select a region or position cursor inside a note, then use /upload", setDialogueText);
                            return true;
                        }

                        // Check for 1x1 selection (single cell)
                        if (selection.startX === selection.endX && selection.startY === selection.endY) {
                            setDialogueWithRevert("Region too small. Please select a larger area for image upload.", setDialogueText);
                            return true;
                        }

                        // Check if selection exactly matches an existing note
                        targetNote = findNoteAtSelection(selection.startX, selection.startY, selection.endX, selection.endY, worldData);
                        uploadBounds = selection;
                    }

                    // Check if --bitmap flag is present
                    const isBitmapMode = exec.args.includes('--bitmap');

                    // Create and trigger file input
                    const fileInput = document.createElement('input');
                    fileInput.type = 'file';
                    fileInput.accept = 'image/*,.js,.ts,.py,.json,.txt,.md,.csv';
                    fileInput.style.display = 'none';

                    fileInput.onchange = async (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (!file) return;

                        // Check if file is a script (.js, .ts, .py)
                        const fileName = file.name.toLowerCase();
                        const isScript = fileName.endsWith('.js') || fileName.endsWith('.ts') || fileName.endsWith('.py');
                        const isCsv = fileName.endsWith('.csv');
                        const isTextFile = isScript || fileName.endsWith('.json') || fileName.endsWith('.txt') || fileName.endsWith('.md') || isCsv;

                        // Handle CSV files specially - convert to /data note
                        if (isCsv && uploadBounds) {
                            try {
                                const text = await file.text();

                                // Parse CSV (handle quoted fields with commas)
                                const parseCSVLine = (line: string): string[] => {
                                    const result: string[] = [];
                                    let current = '';
                                    let inQuotes = false;

                                    for (let i = 0; i < line.length; i++) {
                                        const char = line[i];
                                        if (char === '"') {
                                            if (inQuotes && line[i + 1] === '"') {
                                                // Escaped quote
                                                current += '"';
                                                i++;
                                            } else {
                                                inQuotes = !inQuotes;
                                            }
                                        } else if (char === ',' && !inQuotes) {
                                            result.push(current.trim());
                                            current = '';
                                        } else {
                                            current += char;
                                        }
                                    }
                                    result.push(current.trim());
                                    return result;
                                };

                                const lines = text.split('\n').filter(line => line.trim().length > 0);
                                const parsedRows = lines.map(parseCSVLine);

                                if (parsedRows.length === 0) {
                                    setDialogueWithRevert('CSV file is empty', setDialogueText);
                                    return;
                                }

                                // Determine number of columns (max across all rows)
                                const numCols = Math.max(...parsedRows.map(row => row.length));
                                const numRows = parsedRows.length;

                                // Calculate column widths based on content (min 4, max 20)
                                const columnWidths: number[] = [];
                                for (let col = 0; col < numCols; col++) {
                                    let maxLen = 4; // minimum width
                                    for (let row = 0; row < parsedRows.length; row++) {
                                        const cellLen = (parsedRows[row][col] || '').length;
                                        maxLen = Math.max(maxLen, cellLen);
                                    }
                                    columnWidths.push(Math.min(maxLen + 1, 20)); // +1 padding, max 20
                                }

                                // Build tableData structure
                                const columns = columnWidths.map(width => ({ width }));
                                const rows = Array(numRows).fill(null).map(() => ({ height: 1 }));

                                // Build cells Record<"row,col", string>
                                const cells: Record<string, string> = {};
                                for (let rowIdx = 0; rowIdx < parsedRows.length; rowIdx++) {
                                    const row = parsedRows[rowIdx];
                                    for (let colIdx = 0; colIdx < row.length; colIdx++) {
                                        const cellValue = row[colIdx] || '';
                                        if (cellValue) {
                                            cells[`${rowIdx},${colIdx}`] = cellValue;
                                        }
                                    }
                                }

                                // Calculate note dimensions
                                const totalWidth = columnWidths.reduce((sum, w) => sum + w, 0);
                                const totalHeight = numRows * 2; // GRID_CELL_SPAN = 2

                                const tableData = {
                                    columns,
                                    rows,
                                    cells,
                                    frozenRows: numRows > 0 ? 1 : 0,
                                    frozenCols: 0,
                                    activeCell: { row: 0, col: 0 },
                                    cellScrollOffsets: {}
                                };

                                if (targetNote) {
                                    // Update existing note to data type
                                    // Keep original note bounds - data outside will be viewport culled
                                    const updatedNoteData = {
                                        ...targetNote.data,
                                        contentType: 'data',
                                        tableData,
                                        // Keep original bounds, don't resize to fit all data
                                        scrollOffset: 0
                                    };
                                    // Remove old data field if present (text note character storage)
                                    delete updatedNoteData.data;

                                    setWorldData(prev => ({
                                        ...prev,
                                        [targetNote.key]: JSON.stringify(updatedNoteData)
                                    }));
                                } else {
                                    // Create new note from selection
                                    // Keep selection bounds - data outside will be viewport culled
                                    const noteData = {
                                        startX: uploadBounds.startX,
                                        startY: uploadBounds.startY,
                                        endX: uploadBounds.endX,
                                        endY: uploadBounds.endY,
                                        timestamp: Date.now(),
                                        contentType: 'data',
                                        tableData,
                                        scrollOffset: 0
                                    };
                                    const noteKey = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                                    setWorldData(prev => {
                                        const updated = { ...prev };
                                        // Clear any existing content in the region
                                        for (let y = uploadBounds.startY; y <= uploadBounds.endY; y++) {
                                            for (let x = uploadBounds.startX; x <= uploadBounds.endX; x++) {
                                                delete updated[`${x},${y}`];
                                            }
                                        }
                                        updated[noteKey] = JSON.stringify(noteData);
                                        return updated;
                                    });
                                }

                                setSelectionStart(null);
                                setSelectionEnd(null);
                                setDialogueWithRevert(
                                    `CSV loaded: ${file.name} (${numRows} rows × ${numCols} columns)`,
                                    setDialogueText
                                );
                                return;
                            } catch (err) {
                                console.error('Error parsing CSV:', err);
                                setDialogueWithRevert(`Error parsing CSV: ${file.name}`, setDialogueText);
                                return;
                            }
                        }

                        if (isTextFile && uploadBounds) {
                            // Handle script/text file upload
                            try {
                                const text = await file.text();
                                const lines = text.split('\n');

                                // Detect language for scripts
                                const language = fileName.endsWith('.py') ? 'python' : 'javascript';

                                // Build note data storage (line by line)
                                const data: Record<string, string> = {};
                                lines.forEach((line, idx) => {
                                    if (line.length > 0 || idx < lines.length - 1) {
                                        data[idx.toString()] = line;
                                    }
                                });

                                if (targetNote) {
                                    // Update existing note to script type
                                    const updatedNoteData = {
                                        ...targetNote.data,
                                        contentType: isScript ? 'script' : 'text',
                                        data,
                                        scrollOffset: 0,
                                        ...(isScript ? { scriptData: { language, status: 'idle' } } : {})
                                    };

                                    setWorldData(prev => ({
                                        ...prev,
                                        [targetNote.key]: JSON.stringify(updatedNoteData)
                                    }));
                                } else {
                                    // Create new note from selection
                                    const noteData = {
                                        startX: uploadBounds.startX,
                                        startY: uploadBounds.startY,
                                        endX: uploadBounds.endX,
                                        endY: uploadBounds.endY,
                                        timestamp: Date.now(),
                                        contentType: isScript ? 'script' : 'text',
                                        data,
                                        scrollOffset: 0,
                                        ...(isScript ? { scriptData: { language, status: 'idle' } } : {})
                                    };
                                    const noteKey = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                                    setWorldData(prev => {
                                        const updated = { ...prev };
                                        for (let y = uploadBounds.startY; y <= uploadBounds.endY; y++) {
                                            for (let x = uploadBounds.startX; x <= uploadBounds.endX; x++) {
                                                delete updated[`${x},${y}`];
                                            }
                                        }
                                        updated[noteKey] = JSON.stringify(noteData);
                                        return updated;
                                    });
                                }

                                setSelectionStart(null);
                                setSelectionEnd(null);
                                setDialogueWithRevert(
                                    isScript
                                        ? `Script loaded: ${file.name} (${language}, ${lines.length} lines). Use /run to execute.`
                                        : `File loaded: ${file.name} (${lines.length} lines)`,
                                    setDialogueText
                                );
                                return;
                            } catch (err) {
                                console.error('Error reading text file:', err);
                                setDialogueWithRevert(`Error reading file: ${file.name}`, setDialogueText);
                                return;
                            }
                        }

                        // Show pending visual effect on the target region
                        if (uploadBounds) {
                            setProcessingRegion(uploadBounds);
                        }

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
                                                    const selectionWidth = uploadBounds.endX - uploadBounds.startX + 1;
                                                    const selectionHeight = uploadBounds.endY - uploadBounds.startY + 1;
                                                    const storageUrl = await uploadImageToStorage(dataUrl);

                                                    // Use functional form of setWorldData to get current state
                                                    setWorldData(prev => {
                                                        // Use targetNote if found, otherwise check for exact match
                                                        const existingNote = targetNote || findNoteAtSelection(uploadBounds.startX, uploadBounds.startY, uploadBounds.endX, uploadBounds.endY, prev);

                                                        // Create note using helper
                                                        const { noteKey: generatedKey, noteData } = createNote({
                                                            bounds: {
                                                                startX: uploadBounds.startX,
                                                                startY: uploadBounds.startY,
                                                                endX: uploadBounds.endX,
                                                                endY: uploadBounds.endY
                                                            },
                                                            contentType: 'image',
                                                            imageData: {
                                                                src: storageUrl,
                                                                originalWidth: img.width,
                                                                originalHeight: img.height
                                                            }
                                                        });

                                                        // Use existing key or generated one
                                                        const noteKey = existingNote?.key || generatedKey;
                                                        const action = existingNote ? 'updated' : 'uploaded';
                                                        setDialogueWithRevert(`Image ${action} to region (${selectionWidth}x${selectionHeight} cells)`, setDialogueText);

                                                        return { ...prev, [noteKey]: JSON.stringify(noteData) };
                                                    });
                                                    setSelectionStart(null);
                                                    setSelectionEnd(null);
                                                };
                                                img.src = dataUrl;
                                            };
                                            reader.readAsDataURL(file);
                                            return true;
                                        }

                                        // Calculate selection dimensions
                                        const selectionWidth = uploadBounds.endX - uploadBounds.startX + 1;
                                        const selectionHeight = uploadBounds.endY - uploadBounds.startY + 1;

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

                                        // Use functional form to get current state and determine key
                                        let noteKey = '';
                                        setWorldData(prev => {
                                            // Use targetNote if found, otherwise check for exact match
                                            const existingNote = targetNote || findNoteAtSelection(uploadBounds.startX, uploadBounds.startY, uploadBounds.endX, uploadBounds.endY, prev);

                                            // Create note using helper
                                            const { noteKey: generatedKey, noteData: optimisticNoteData } = createNote({
                                                bounds: {
                                                    startX: uploadBounds.startX,
                                                    startY: uploadBounds.startY,
                                                    endX: uploadBounds.endX,
                                                    endY: uploadBounds.endY
                                                },
                                                contentType: 'image',
                                                imageData: {
                                                    src: localFrameTiming[0].url,
                                                    originalWidth: parsedGIF.width,
                                                    originalHeight: parsedGIF.height,
                                                    isAnimated: true,
                                                    frameTiming: localFrameTiming,
                                                    totalDuration: parsedGIF.totalDuration,
                                                    animationStartTime: Date.now()
                                                } as any
                                            });

                                            // Use existing key or generated one
                                            noteKey = existingNote?.key || generatedKey;

                                            const action = existingNote ? 'updated' : 'loaded';
                                            setDialogueWithRevert(`GIF ${action} (${localFrameTiming.length} frames)`, setDialogueText);

                                            return {
                                                ...prev,
                                                [noteKey]: JSON.stringify(optimisticNoteData)
                                            };
                                        });

                                        // Clear selection immediately
                                        setSelectionStart(null);
                                        setSelectionEnd(null);

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
                                                const existing = prev[noteKey];
                                                if (existing && typeof existing === 'string') {
                                                    try {
                                                        const parsedNote = JSON.parse(existing);
                                                        // Update fields inside imageData
                                                        const updatedNote = {
                                                            ...parsedNote,
                                                            imageData: {
                                                                ...parsedNote.imageData,
                                                                src: uploadedFrameTiming[0].url,
                                                                frameTiming: uploadedFrameTiming
                                                            }
                                                        };
                                                        return {
                                                            ...prev,
                                                            [noteKey]: JSON.stringify(updatedNote)
                                                        };
                                                    } catch (e) {
                                                        logger.error('Error parsing note data for GIF update:', e);
                                                    }
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
                                        const selectionWidth = uploadBounds.endX - uploadBounds.startX + 1;
                                        const selectionHeight = uploadBounds.endY - uploadBounds.startY + 1;

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

                                        // Use functional form of setWorldData to get current state
                                        setWorldData(prev => {
                                            // Use targetNote if found, otherwise check for exact match
                                            const existingNote = targetNote || findNoteAtSelection(uploadBounds.startX, uploadBounds.startY, uploadBounds.endX, uploadBounds.endY, prev);

                                            // Create note using helper
                                            const { noteKey: generatedKey, noteData } = createNote({
                                                bounds: {
                                                    startX: uploadBounds.startX,
                                                    startY: uploadBounds.startY,
                                                    endX: uploadBounds.endX,
                                                    endY: uploadBounds.endY
                                                },
                                                contentType: 'image',
                                                imageData: {
                                                    src: storageUrl,
                                                    originalWidth: img.width,
                                                    originalHeight: img.height
                                                }
                                            });

                                            // Use existing key or generated one
                                            const noteKey = existingNote?.key || generatedKey;

                                            const modeText = isBitmapMode ? "Bitmap" : "Image";
                                            const action = existingNote ? 'updated' : 'uploaded';
                                            setDialogueWithRevert(`${modeText} ${action} to region (${selectionWidth}x${selectionHeight} cells)`, setDialogueText);

                                            return {
                                                ...prev,
                                                [noteKey]: JSON.stringify(noteData)
                                            };
                                        });

                                        // Clear selection
                                        setSelectionStart(null);
                                        setSelectionEnd(null);
                                    };
                                    img.src = dataUrl;
                                };
                                reader.readAsDataURL(file);
                            }
                        } catch (error) {
                            logger.error('Error uploading image:', error);
                            setDialogueWithRevert("Error uploading image", setDialogueText);
                        } finally {
                            setProcessingRegion(null); // Clear visual feedback
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

                    // Move cursor to next line at start position (using scale height)
                    setCursorPos({ x: startX, y: cursorPos.y + currentScale.h });
                    return true;
                } else if (metaKey || ctrlKey) {
                    // Cmd+Enter (or Ctrl+Enter): Send chat message and write response directly to canvas
                    if (chatMode.currentInput.trim() && !chatMode.isProcessing) {
                        const userMessage = chatMode.currentInput.trim();
                        setChatMode(prev => ({ ...prev, isProcessing: true }));
                        setDialogueWithRevert("Processing...", setDialogueText);

                        // Show user message in bubble when character sprite is enabled
                        if (isCharacterEnabled) {
                            showBubbleMessage(userMessage, 3000); // Show for 3 seconds initially
                        }

                        ai(userMessage, { userId: userUid || undefined }).then((result) => {
                            const response = result.text || result.error || '';
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
                                y: (chatMode.inputPositions[chatMode.inputPositions.length - 1]?.y || cursorPos.y) + currentScale.h // Start one character height below last input line
                            };

                            // Calculate dynamic wrap width based on input
                            const inputLines = userMessage.split('\n');
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

                            // Write each character permanently to worldData with scale support
                            const newWorldData = { ...worldData };
                            const hasCustomScale = currentScale.w !== 1 || currentScale.h !== 2;

                            for (let lineIndex = 0; lineIndex < wrappedLines.length; lineIndex++) {
                                const line = wrappedLines[lineIndex];
                                for (let charIndex = 0; charIndex < line.length; charIndex++) {
                                    const char = line[charIndex];
                                    const x = responseStartPos.x + (charIndex * currentScale.w);
                                    const y = responseStartPos.y + (lineIndex * currentScale.h);
                                    const key = `${x},${y}`;

                                    if (hasCustomScale) {
                                        newWorldData[key] = {
                                            char,
                                            scale: { ...currentScale }
                                        };
                                    } else {
                                        newWorldData[key] = char;
                                    }
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
                        const userMessage = chatMode.currentInput.trim();
                        setChatMode(prev => ({ ...prev, isProcessing: true }));
                        setDialogueWithRevert("Processing...", setDialogueText);

                        // Show user message in bubble when character sprite is enabled
                        if (isCharacterEnabled) {
                            showBubbleMessage(userMessage, 3000); // Show for 3 seconds initially
                        }

                        ai(userMessage, { userId: userUid || undefined }).then((result) => {
                            const response = result.text || result.error || '';
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
                                y: (chatMode.inputPositions[chatMode.inputPositions.length - 1]?.y || cursorPos.y) + currentScale.h // Start one character height below last input line
                            };
                            addInstantAIResponse(responseStartPos, response, { queryText: chatMode.currentInput.trim(), centered: false });
                            
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

                // Add to chatData with scale and style support
                const hasCustomStyle = currentTextStyle.color !== textColor || !!currentTextStyle.background;
                const hasCustomScale = currentScale.w !== 1 || currentScale.h !== 2;

                let charData: string | StyledCharacter = key;
                if (hasCustomStyle || hasCustomScale) {
                    const styledChar: StyledCharacter = { char: key };
                    if (hasCustomStyle) {
                        styledChar.style = { color: currentTextStyle.color };
                        if (currentTextStyle.background) styledChar.style.background = currentTextStyle.background;
                    }
                    if (hasCustomScale) {
                        styledChar.scale = { ...currentScale };
                    }
                    charData = styledChar;
                }

                setChatData(prev => ({
                    ...prev,
                    [currentKey]: charData
                }));

                // Move cursor by character width for chat mode
                setCursorPos({ x: cursorPos.x + currentScale.w, y: cursorPos.y });

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
        } else if (isMod && key.toLowerCase() === 'd') {
            // Duplicate note at cursor (Cmd+D / Ctrl+D)
            const noteAtCursor = findNoteContainingPoint(cursorPos.x, cursorPos.y, worldData);

            if (noteAtCursor) {
                const originalData = noteAtCursor.data;
                const noteWidth = originalData.endX - originalData.startX;

                // Offset: 3 cells to the right of the original note's right edge
                const offsetX = noteWidth + 4;

                // Create new note data with offset positions
                const newNoteData = {
                    ...originalData,
                    startX: originalData.startX + offsetX,
                    endX: originalData.endX + offsetX,
                    timestamp: Date.now(),
                };

                // Generate new key
                const newKey = `note_${newNoteData.startX},${newNoteData.startY}_${newNoteData.timestamp}`;

                // Add to world data
                nextWorldData[newKey] = JSON.stringify(newNoteData);
                worldDataChanged = true;

                // Move cursor to the new note
                nextCursorPos = { x: newNoteData.startX, y: newNoteData.startY };
                moved = true;

                const noteType = originalData.contentType || 'text';
                setDialogueWithRevert(`Duplicated ${noteType} note`, setDialogueText);
            }
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
                            ai(instructions, { selection: selectedText, userId: userUid || undefined }).then((aiResult) => {
                                const textResult = aiResult.text || aiResult.error || '';
                                // Check if quota exceeded
                                if (textResult.startsWith('AI limit reached')) {
                                    if (upgradeFlowHandlerRef.current) {
                                        upgradeFlowHandlerRef.current();
                                    }
                                    return true;
                                }

                                createSubtitleCycler(textResult, setDialogueText);
                            }).catch(() => {
                                setDialogueWithRevert(`Could not transform text`, setDialogueText);
                            });
                        }
                    } else if (exec.command === 'explain') {
                        const selectedText = exec.args[0];
                        const instructions = exec.args.length > 1 ? exec.args.slice(1).join(' ') : 'explain this';

                        setDialogueWithRevert("Processing explanation...", setDialogueText);
                        ai(instructions, { selection: selectedText, userId: userUid || undefined }).then((aiResult) => {
                            const textResult = aiResult.text || aiResult.error || '';
                            // Check if quota exceeded
                            if (textResult.startsWith('AI limit reached')) {
                                if (upgradeFlowHandlerRef.current) {
                                    upgradeFlowHandlerRef.current();
                                }
                                return true;
                            }

                            createSubtitleCycler(textResult, setDialogueText);
                        }).catch(() => {
                            setDialogueWithRevert(`Could not explain text`, setDialogueText);
                        });
                    } else if (exec.command === 'summarize') {
                        const selectedText = exec.args[0];
                        const focus = exec.args.length > 1 ? `summarize, focusing on ${exec.args.slice(1).join(' ')}` : 'summarize this';

                        setDialogueWithRevert("Processing summary...", setDialogueText);
                        ai(focus, { selection: selectedText, userId: userUid || undefined }).then((aiResult) => {
                            const textResult = aiResult.text || aiResult.error || '';
                            // Check if quota exceeded
                            if (textResult.startsWith('AI limit reached')) {
                                if (upgradeFlowHandlerRef.current) {
                                    upgradeFlowHandlerRef.current();
                                }
                                return true;
                            }

                            createSubtitleCycler(textResult, setDialogueText);
                        }).catch(() => {
                            setDialogueWithRevert(`Could not summarize text`, setDialogueText);
                        });
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

                            // Create list metadata using helper
                            const { noteKey, noteData } = createNote({
                                bounds: {
                                    startX: selection.startX,
                                    startY: selection.startY,
                                    endX: selection.endX,
                                    endY: selection.startY + visibleHeight - 1
                                },
                                contentType: 'list',
                                visibleHeight: visibleHeight,
                                scrollOffset: 0,
                                additionalData: {
                                    color: color,
                                    title: title || undefined
                                }
                            });

                            // Store list and content
                            let newWorldData = { ...worldData };
                            newWorldData[noteKey] = JSON.stringify(noteData);
                            newWorldData[`${noteKey}_content`] = JSON.stringify(initialContent);

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

            // Create note region using helper
            const height = maxY - minY + 1;
            const { noteKey, noteData } = createNote({
                bounds: {
                    startX: minX,
                    endX: maxX,
                    startY: minY,
                    endY: maxY
                },
                visibleHeight: height,  // Default to showing all lines
                scrollOffset: 0         // Start at top
            });

            // Store note region in worldData with unique key
            setWorldData(prev => ({
                ...prev,
                [noteKey]: JSON.stringify(noteData)
            }));

            // Clear the selection after saving
            setSelectionStart(null);
            setSelectionEnd(null);

            const width = maxX - minX + 1;
            // height already calculated above for visibleHeight
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
                                targetRegion = { ...noteData, _noteKey: key }; // Track the note key for cleanup
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
                // Check for existing note in the region (any type: text, script, data, image)
                let existingImageData: string | null = null;
                let existingImageKey: string | null = null;
                let selectedNoteForAI: {
                    key: string;
                    contentType: 'text' | 'image' | 'data' | 'script';
                    bounds: { startX: number; startY: number; endX: number; endY: number };
                    textContent?: string;
                    imageData?: string;
                    tableData?: {
                        columns: Array<{ width: number; header?: string }>;
                        rows: Array<{ height: number }>;
                        cells: Record<string, string>;
                    };
                } | null = null;

                for (const key in worldData) {
                    // Check old image_ format
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
                    // Check new note_ format - all content types
                    if (key.startsWith('note_')) {
                        try {
                            const noteData = typeof worldData[key] === 'string' ? JSON.parse(worldData[key] as string) : worldData[key];
                            if (noteData && noteData.startX !== undefined) {
                                // Check if note overlaps with target region
                                if (noteData.startX <= targetRegion.endX && noteData.endX >= targetRegion.startX &&
                                    noteData.startY <= targetRegion.endY && noteData.endY >= targetRegion.startY) {

                                    const contentType = noteData.contentType || 'text';

                                    if (contentType === 'image' && noteData.src) {
                                        existingImageData = noteData.src;
                                        existingImageKey = key;
                                        selectedNoteForAI = {
                                            key,
                                            contentType: 'image',
                                            bounds: { startX: noteData.startX, startY: noteData.startY, endX: noteData.endX, endY: noteData.endY },
                                            imageData: noteData.src
                                        };
                                    } else if (contentType === 'data' && noteData.tableData) {
                                        selectedNoteForAI = {
                                            key,
                                            contentType: 'data',
                                            bounds: { startX: noteData.startX, startY: noteData.startY, endX: noteData.endX, endY: noteData.endY },
                                            tableData: noteData.tableData
                                        };
                                    } else if ((contentType === 'text' || contentType === 'script') && noteData.data) {
                                        // Extract text from note.data grid
                                        const noteHeight = noteData.endY - noteData.startY + 1;
                                        const noteWidth = noteData.endX - noteData.startX + 1;
                                        let textContent = '';
                                        for (let relY = 0; relY < noteHeight; relY++) {
                                            let lineText = '';
                                            for (let relX = 0; relX < noteWidth; relX++) {
                                                const cellKey = `${relX},${relY}`;
                                                const charData = noteData.data[cellKey];
                                                if (charData) {
                                                    const char = typeof charData === 'string' ? charData :
                                                        (charData && typeof charData === 'object' && 'char' in charData) ? charData.char : ' ';
                                                    lineText += char;
                                                } else {
                                                    lineText += ' ';
                                                }
                                            }
                                            textContent += lineText.trimEnd();
                                            if (relY < noteHeight - 1) textContent += '\n';
                                        }
                                        selectedNoteForAI = {
                                            key,
                                            contentType: contentType as 'text' | 'script',
                                            bounds: { startX: noteData.startX, startY: noteData.startY, endX: noteData.endX, endY: noteData.endY },
                                            textContent: textContent.trim()
                                        };
                                    }
                                    break;
                                }
                            }
                        } catch (e) {
                            // Skip invalid note data
                        }
                    }
                }

                // Extract text from target region
                let textToSend = '';

                // Check if targetRegion has embedded note data (from note_ key)
                const noteData = (targetRegion as any).data;

                if (noteData && typeof noteData === 'object') {
                    // Extract text from note's embedded data (relative coordinates)
                    const noteHeight = targetRegion.endY - targetRegion.startY + 1;
                    const noteWidth = targetRegion.endX - targetRegion.startX + 1;

                    for (let relY = 0; relY < noteHeight; relY++) {
                        let lineText = '';
                        for (let relX = 0; relX < noteWidth; relX++) {
                            const key = `${relX},${relY}`;
                            const charData = noteData[key];
                            if (charData) {
                                const char = typeof charData === 'string' ? charData :
                                    (charData && typeof charData === 'object' && 'char' in charData) ? charData.char : ' ';
                                lineText += char;
                            } else {
                                lineText += ' ';
                            }
                        }
                        textToSend += lineText.trimEnd();
                        if (relY < noteHeight - 1) textToSend += '\n';
                    }
                } else {
                    // Fall back to extracting from worldData (absolute coordinates)
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
                }

                if (textToSend.trim() || existingImageData || selectedNoteForAI) {
                    // Check if we have a non-image note to edit
                    if (selectedNoteForAI && selectedNoteForAI.contentType !== 'image') {
                        // Non-image note editing path (text, script, data)
                        const dialogueMessage = selectedNoteForAI.contentType === 'data'
                            ? "Updating table..."
                            : "Updating text...";
                        setDialogueWithRevert(dialogueMessage, setDialogueText);
                        setProcessingRegion(targetRegion);

                        ai(textToSend.trim(), { selectedNote: selectedNoteForAI, userId: userUid || undefined }).then(async (result) => {
                            // Check for quota exceeded
                            if (result.text && result.text.startsWith('AI limit reached')) {
                                setProcessingRegion(null);
                                if (upgradeFlowHandlerRef.current) {
                                    upgradeFlowHandlerRef.current();
                                }
                                return;
                            }

                            // Handle note update
                            if (result.noteUpdate) {
                                const { key, contentType, textContent, tableData, imageData: newImageData } = result.noteUpdate;

                                try {
                                    const existingNoteData = typeof worldData[key] === 'string'
                                        ? JSON.parse(worldData[key] as string)
                                        : worldData[key];

                                    if (contentType === 'text' || contentType === 'script') {
                                        // Convert textContent back to grid format
                                        const newData: Record<string, string> = {};
                                        if (textContent) {
                                            const lines = textContent.split('\n');
                                            for (let y = 0; y < lines.length; y++) {
                                                for (let x = 0; x < lines[y].length; x++) {
                                                    newData[`${x},${y}`] = lines[y][x];
                                                }
                                            }
                                        }

                                        const updatedNoteData = {
                                            ...existingNoteData,
                                            data: newData
                                        };

                                        setWorldData({
                                            ...worldData,
                                            [key]: JSON.stringify(updatedNoteData)
                                        });
                                        setDialogueWithRevert("Text updated", setDialogueText);
                                    } else if (contentType === 'data' && tableData) {
                                        const updatedNoteData = {
                                            ...existingNoteData,
                                            tableData: {
                                                ...existingNoteData.tableData,
                                                ...tableData
                                            }
                                        };

                                        setWorldData({
                                            ...worldData,
                                            [key]: JSON.stringify(updatedNoteData)
                                        });
                                        setDialogueWithRevert("Table updated", setDialogueText);
                                    }
                                } catch (e) {
                                    logger.error('Failed to update note:', e);
                                    setDialogueWithRevert("Failed to update note", setDialogueText);
                                }
                            } else {
                                setDialogueWithRevert(result.text || "Update failed", setDialogueText);
                            }

                            setProcessingRegion(null);
                        }).catch((error) => {
                            logger.error('Note editing failed:', error);
                            setProcessingRegion(null);
                            setDialogueWithRevert("Failed to update note", setDialogueText);
                        });

                        return true;
                    }

                    // Detect intent: image-to-image or text-to-image or text-to-text
                    const hasImageIntent = existingImageData ||
                        detectImageIntent(textToSend).intent === 'image';

                    if (hasImageIntent) {
                        // Image generation/editing path
                        setDialogueWithRevert("Generating image...", setDialogueText);
                        setProcessingRegion(targetRegion);

                        // Convert URL to base64 if needed
                        (async () => {
                            let base64ImageData: string | undefined = undefined;

                            if (existingImageData) {
                                if (existingImageData.startsWith('data:')) {
                                    base64ImageData = existingImageData;
                                } else if (existingImageData.startsWith('http://') || existingImageData.startsWith('https://')) {
                                    try {
                                        const response = await fetch(existingImageData, { mode: 'cors' });
                                        if (!response.ok) {
                                            throw new Error(`Failed to fetch: ${response.status}`);
                                        }
                                        const blob = await response.blob();
                                        base64ImageData = await new Promise<string>((resolve, reject) => {
                                            const reader = new FileReader();
                                            reader.onloadend = () => resolve(reader.result as string);
                                            reader.onerror = reject;
                                            reader.readAsDataURL(blob);
                                        });
                                    } catch (error) {
                                        logger.error('Failed to fetch image for conversion:', error);
                                        setProcessingRegion(null);
                                        setDialogueWithRevert("Could not load image for editing", setDialogueText);
                                        return;
                                    }
                                }

                                // Update selectedNoteForAI with base64 image data for in-place update
                                if (selectedNoteForAI && selectedNoteForAI.contentType === 'image') {
                                    selectedNoteForAI.imageData = base64ImageData;
                                }
                            }

                        // Use selectedNote for image-to-image editing (in-place), otherwise use referenceImage
                        const aiContext = selectedNoteForAI && selectedNoteForAI.contentType === 'image'
                            ? { selectedNote: selectedNoteForAI, userId: userUid || undefined }
                            : { referenceImage: base64ImageData, userId: userUid || undefined };

                        ai(textToSend.trim(), aiContext).then(async (result) => {
                            const imageResult = result.image || { imageData: null, text: result.text || '' };
                            // Check if quota exceeded
                            if (imageResult.text && imageResult.text.startsWith('AI limit reached')) {
                                setProcessingRegion(null);
                                if (upgradeFlowHandlerRef.current) {
                                    upgradeFlowHandlerRef.current();
                                }
                                return true;
                            }

                            if (!imageResult.imageData) {
                                setProcessingRegion(null);
                                setDialogueWithRevert("Image generation failed", setDialogueText);
                                return true;
                            }

                            setDialogueWithRevert("Image generated successfully", setDialogueText);

                            // Check if this is an in-place update via noteUpdate
                            if (result.noteUpdate && result.noteUpdate.imageData && selectedNoteForAI) {
                                // In-place update: just update the note's src
                                const img = new Image();
                                img.onload = async () => {
                                    const storageUrl = await uploadImageToStorage(result.noteUpdate!.imageData!);

                                    try {
                                        const existingNoteData = typeof worldData[selectedNoteForAI!.key] === 'string'
                                            ? JSON.parse(worldData[selectedNoteForAI!.key] as string)
                                            : worldData[selectedNoteForAI!.key];

                                        const updatedNoteData = {
                                            ...existingNoteData,
                                            src: storageUrl,
                                            originalWidth: img.width,
                                            originalHeight: img.height
                                        };

                                        setWorldData({
                                            ...worldData,
                                            [selectedNoteForAI!.key]: JSON.stringify(updatedNoteData)
                                        });
                                        setDialogueWithRevert("Image updated", setDialogueText);
                                    } catch (e) {
                                        logger.error('Failed to update image note:', e);
                                        setDialogueWithRevert("Failed to update image", setDialogueText);
                                    }

                                    setProcessingRegion(null);
                                };
                                img.onerror = () => {
                                    setProcessingRegion(null);
                                    setDialogueWithRevert("Failed to load generated image", setDialogueText);
                                };
                                img.src = result.noteUpdate.imageData;
                                return true;
                            }

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
                                const storageUrl = await uploadImageToStorage(imageResult.imageData!);

                                // Create note using helper
                                const { noteKey, noteData } = createNote({
                                    bounds: {
                                        startX: targetRegion.startX,
                                        startY: targetRegion.startY,
                                        endX: targetRegion.startX + cellsWide - 1,
                                        endY: targetRegion.startY + cellsHigh - 1
                                    },
                                    contentType: 'image',
                                    imageData: {
                                        src: storageUrl,
                                        originalWidth: img.width,
                                        originalHeight: img.height
                                    }
                                });

                                // Remove existing image if present
                                const newWorldData = { ...worldData };
                                if (existingImageKey) {
                                    delete newWorldData[existingImageKey];
                                }

                                // Remove source note if this came from a note
                                const sourceNoteKey = (targetRegion as any)._noteKey;
                                if (sourceNoteKey && newWorldData[sourceNoteKey]) {
                                    delete newWorldData[sourceNoteKey];
                                }

                                // Clear text in target region (for non-note text)
                                for (let y = targetRegion.startY; y <= targetRegion.endY; y++) {
                                    for (let x = targetRegion.startX; x <= targetRegion.endX; x++) {
                                        const key = `${x},${y}`;
                                        if (newWorldData[key] && !isImageData(newWorldData[key])) {
                                            delete newWorldData[key];
                                        }
                                    }
                                }

                                // Add new note
                                newWorldData[noteKey] = JSON.stringify(noteData);
                                setWorldData(newWorldData);
                                setProcessingRegion(null);

                                // Clear selection if we were using a selection (not a saved plan region)
                                if (currentSelectionActive) {
                                    setSelectionStart(null);
                                    setSelectionEnd(null);
                                }

                                // Keep cursor position
                                setCursorPos(cursorPos);
                            };

                            img.onerror = () => {
                                setProcessingRegion(null);
                                logger.error('Error loading generated image');
                                setDialogueWithRevert("Error loading generated image", setDialogueText);
                            };

                            img.src = imageResult.imageData!;
                        }).catch((error) => {
                            setProcessingRegion(null);
                            logger.error('Error in image generation:', error);
                            setDialogueWithRevert("Could not generate image", setDialogueText);
                        });
                        })();
                    } else {
                        // Text generation path (existing logic)
                        setDialogueWithRevert("Processing region...", setDialogueText);
                        setProcessingRegion(targetRegion);

                        // Calculate target region dimensions
                        const regionWidth = targetRegion.endX - targetRegion.startX + 1;
                        const regionHeight = targetRegion.endY - targetRegion.startY + 1;

                        // Calculate approximate target character count (80% fill to account for wrapping)
                        // Account for GRID_CELL_SPAN - each text line occupies multiple Y cells
                        const effectiveLines = Math.floor(regionHeight / GRID_CELL_SPAN);
                        const targetChars = Math.floor(regionWidth * effectiveLines * 0.8);

                        // Update world context
                        const currentChips = getAllChips();
                        const currentCompiledText = compiledTextCache;
                        const compiledTextString = Object.entries(currentCompiledText)
                            .sort(([aLine], [bLine]) => parseInt(aLine) - parseInt(bLine))
                            .map(([lineY, text]) => `Line ${lineY}: ${text}`)
                            .join('\n');

                        // Create enhanced prompt with character count target
                        const enhancedPrompt = `${textToSend.trim()}\n\n[Write a detailed response of approximately ${targetChars} characters to fill the available space. Be expansive and thorough.]`;

                        const worldContext = {
                            compiledText: compiledTextString,
                            labels: currentChips,
                            metadata: `Canvas viewport center: ${JSON.stringify(getViewportCenter())}, Current cursor: ${JSON.stringify(cursorPos)}`
                        };

                        ai(enhancedPrompt, { userId: userUid || undefined, worldContext }).then((result) => {
                            const response = result.text || result.error || '';
                            // Check if quota exceeded
                            if (response.startsWith('AI limit reached')) {
                                setProcessingRegion(null);
                                if (upgradeFlowHandlerRef.current) {
                                    upgradeFlowHandlerRef.current();
                                }
                                return true;
                            }

                            // Don't show response in dialogue - write directly to target region
                            setDialogueWithRevert("AI response filled", setDialogueText);
                            setProcessingRegion(null);

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

                            // Remove source note if this came from a note
                            const sourceNoteKey = (targetRegion as any)._noteKey;
                            if (sourceNoteKey && newWorldData[sourceNoteKey]) {
                                delete newWorldData[sourceNoteKey];
                            }

                            // Clear any standalone text in target region
                            for (let y = targetRegion.startY; y <= targetRegion.endY; y++) {
                                for (let x = targetRegion.startX; x <= targetRegion.endX; x++) {
                                    const key = `${x},${y}`;
                                    if (newWorldData[key] && !isImageData(newWorldData[key])) {
                                        delete newWorldData[key];
                                    }
                                }
                            }

                            // Write response into target region
                            // Each line occupies GRID_CELL_SPAN vertical cells
                            const maxLines = Math.floor(regionHeight / GRID_CELL_SPAN);
                            for (let lineIndex = 0; lineIndex < Math.min(wrappedLines.length, maxLines); lineIndex++) {
                                const line = wrappedLines[lineIndex];
                                for (let charIndex = 0; charIndex < Math.min(line.length, regionWidth); charIndex++) {
                                    const char = line[charIndex];
                                    const x = targetRegion.startX + charIndex;
                                    const y = targetRegion.startY + (lineIndex * GRID_CELL_SPAN);
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
                            setProcessingRegion(null);
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
                const currentChips = getAllChips();
                const currentCompiledText = compiledTextCache;
                
                // Convert compiled text cache to string format
                const compiledTextString = Object.entries(currentCompiledText)
                    .sort(([aLine], [bLine]) => parseInt(aLine) - parseInt(bLine))
                    .map(([lineY, text]) => `Line ${lineY}: ${text}`)
                    .join('\n');
                
                // Prepare world context and chat
                const worldContext = {
                    compiledText: compiledTextString,
                    labels: currentChips,
                    metadata: `Canvas viewport center: ${JSON.stringify(getViewportCenter())}, Current cursor: ${JSON.stringify(cursorPos)}`
                };

                // Use world context for AI chat
                ai(textToSend.trim(), { userId: userUid || undefined, worldContext }).then((result) => {
                    const response = result.text || result.error || '';
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
                                setCursorPos({ x: listData.startX, y: cursorPos.y + GRID_CELL_SPAN });
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

            nextCursorPos.y = cursorPos.y + currentScale.h; // Move down by current scale
            // Failsafe: if targetIndent is NaN, undefined, or null, use previous cursor X position
            if (targetIndent !== undefined && targetIndent !== null && !isNaN(targetIndent)) {
                nextCursorPos.x = targetIndent;
            } else {
                // Fallback to current cursor X if targetIndent is invalid
                nextCursorPos.x = cursorPos.x;
                logger.warn('targetIndent was invalid (NaN/null/undefined), using current cursor X:', cursorPos.x);
            }
            moved = true;
        } else if (key === 'ArrowUp' && !isMod && !altKey) {
            // Check if cursor is inside a scrollable note - if so, scroll at viewport edge
            const noteAtCursor = findTextNoteContainingPoint(cursorPos.x, cursorPos.y, worldData);
            if (noteAtCursor && noteAtCursor.data.data) {
                const noteData = noteAtCursor.data;
                const currentScrollOffset = noteData.scrollOffset || 0;

                // Check if cursor is at top edge of viewport
                const isAtTopEdge = cursorPos.y <= noteData.startY;

                // Only scroll if cursor is at top edge AND there's content above
                if (isAtTopEdge && currentScrollOffset > 0) {
                    // Scroll note up (decrement scrollOffsetY by GRID_CELL_SPAN)
                    const newScrollOffset = Math.max(0, currentScrollOffset - GRID_CELL_SPAN);
                    setWorldData(prev => ({
                        ...prev,
                        [noteAtCursor.key]: JSON.stringify({
                            ...noteData,
                            scrollOffset: newScrollOffset
                        })
                    }));
                    // Don't move cursor - we scrolled the note instead
                    return true;
                }
                // Otherwise fall through to normal cursor movement
            }

            // Normal ArrowUp handling (with modifiers or outside scrollable notes)
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
                    if (k.startsWith('block_') || k.startsWith('label_')) continue;
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
                            if (k.startsWith('block_') || k.startsWith('label_')) continue;
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
                                if (k.startsWith('block_') || k.startsWith('label_')) continue;
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
                // Smart movement: Check for character above to determine jump size
                let foundY = -1;
                // Look behind up to 10 cells or currentScale.h * 2
                const searchLimit = Math.max(10, currentScale.h * 2);
                for (let offset = 1; offset <= searchLimit; offset++) {
                    const checkY = cursorPos.y - offset;
                    const key = `${cursorPos.x},${checkY}`;
                    if (worldData[key] && !isImageData(worldData[key])) {
                        foundY = checkY;
                        break;
                    }
                }

                if (foundY !== -1) {
                    nextCursorPos.y = foundY;
                } else {
                    nextCursorPos.y -= currentScale.h;
                }
            }
            moved = true;
        } else if (key === 'ArrowDown' && !isMod && !altKey) {
            // Check if cursor is inside a scrollable note - if so, scroll at viewport edge
            const noteAtCursor = findTextNoteContainingPoint(cursorPos.x, cursorPos.y, worldData);
            if (noteAtCursor && noteAtCursor.data.data) {
                const noteData = noteAtCursor.data;
                const currentScrollOffset = noteData.scrollOffset || 0;

                // Viewport height is derived from note bounds (in GRID_CELL_SPAN units)
                const visibleHeight = Math.floor((noteData.endY - noteData.startY + 1) / GRID_CELL_SPAN);

                // Check if cursor is at bottom edge of viewport
                const cursorRelativeY = Math.floor((cursorPos.y - noteData.startY) / GRID_CELL_SPAN);
                const isAtBottomEdge = cursorRelativeY >= visibleHeight - 1;

                // Calculate total content height from note.data
                let maxRelativeY = 0;
                for (const coordKey in noteData.data) {
                    const commaIndex = coordKey.indexOf(',');
                    if (commaIndex !== -1) {
                        const relativeY = parseInt(coordKey.substring(commaIndex + 1), 10);
                        if (!isNaN(relativeY) && relativeY > maxRelativeY) {
                            maxRelativeY = relativeY;
                        }
                    }
                }
                // Convert maxRelativeY (world units) to line count
                const totalContentLines = Math.floor(maxRelativeY / GRID_CELL_SPAN) + 1;
                // Calculate max scroll in world units
                const maxScroll = Math.max(0, (totalContentLines - visibleHeight) * GRID_CELL_SPAN);

                // Only scroll if cursor is at bottom edge AND there's content below
                if (isAtBottomEdge && currentScrollOffset < maxScroll) {
                    // Scroll note down (increment scrollOffsetY by GRID_CELL_SPAN)
                    const newScrollOffset = Math.min(maxScroll, currentScrollOffset + GRID_CELL_SPAN);
                    setWorldData(prev => ({
                        ...prev,
                        [noteAtCursor.key]: JSON.stringify({
                            ...noteData,
                            scrollOffset: newScrollOffset
                        })
                    }));
                    // Don't move cursor - we scrolled the note instead
                    return true;
                }
                // Otherwise fall through to normal cursor movement
            }

            // Normal ArrowDown handling (with modifiers or outside scrollable notes)
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
                    if (k.startsWith('block_') || k.startsWith('label_')) continue;
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
                            if (k.startsWith('block_') || k.startsWith('label_')) continue;
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
                                if (k.startsWith('block_') || k.startsWith('label_')) continue;
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
                    // Not in a block, just move down by 2 cells (characters span 2 cells)
                    nextCursorPos.y = cursorPos.y + GRID_CELL_SPAN;
                }
            } else {
                // Smart movement: Check for character ahead to determine jump size
                let foundY = -1;
                // Look ahead up to 10 cells or currentScale.h * 2
                const searchLimit = Math.max(10, currentScale.h * 2);
                for (let offset = 1; offset <= searchLimit; offset++) {
                    const checkY = cursorPos.y + offset;
                    const key = `${cursorPos.x},${checkY}`;
                    if (worldData[key] && !isImageData(worldData[key])) {
                        foundY = checkY;
                        break;
                    }
                }
                
                if (foundY !== -1) {
                    nextCursorPos.y = foundY;
                } else {
                    nextCursorPos.y += currentScale.h; 
                }
            }
            moved = true;
        } else if (key === 'ArrowLeft') {
            // Check if cursor is inside a data note - move to previous cell
            const noteAtCursor = findTextNoteContainingPoint(cursorPos.x, cursorPos.y, worldData);
            if (noteAtCursor && noteAtCursor.data.contentType === 'data' && noteAtCursor.data.tableData && !isMod && !altKey) {
                const noteData = noteAtCursor.data;
                const { columns, rows, activeCell } = noteData.tableData;

                if (activeCell) {
                    let newCol = activeCell.col - 1;
                    let newRow = activeCell.row;

                    // Wrap to previous row if at first column
                    if (newCol < 0) {
                        newCol = columns.length - 1;
                        newRow = activeCell.row - 1;
                    }

                    if (newRow >= 0) {
                        noteData.tableData.activeCell = { row: newRow, col: newCol };
                        // Reset scroll offset for new cell
                        const newCellKey = `${newRow},${newCol}`;
                        if (!noteData.tableData.cellScrollOffsets) noteData.tableData.cellScrollOffsets = {};
                        noteData.tableData.cellScrollOffsets[newCellKey] = 0;

                        // Move cursor to new cell position
                        let cellStartX = noteData.startX;
                        for (let c = 0; c < newCol; c++) {
                            cellStartX += columns[c].width;
                        }
                        let cellStartY = noteData.startY;
                        for (let r = 0; r < newRow; r++) {
                            cellStartY += rows[r].height * GRID_CELL_SPAN;
                        }

                        setWorldData(prev => ({
                            ...prev,
                            [noteAtCursor.key]: JSON.stringify(noteData)
                        }));
                        setCursorPos({ x: cellStartX, y: cellStartY });
                        return true;
                    }
                }
            } else if (noteAtCursor && noteAtCursor.data.data && !isMod && !altKey) {
                const noteData = noteAtCursor.data;
                const currentScrollOffsetX = noteData.scrollOffsetX || 0;

                // Can we scroll left? (show earlier content horizontally)
                if (currentScrollOffsetX > 0) {
                    // Scroll note left (decrement scrollOffsetX)
                    const newScrollOffsetX = Math.max(0, currentScrollOffsetX - 1);
                    setWorldData(prev => ({
                        ...prev,
                        [noteAtCursor.key]: JSON.stringify({
                            ...noteData,
                            scrollOffsetX: newScrollOffsetX
                        })
                    }));
                    // Don't move cursor - we scrolled the note instead
                    return true;
                }
                // If we can't scroll left anymore, fall through to normal cursor movement
            }

            if (isMod) {
                // Cmd+Left: Move to beginning of line (leftmost character position)
                let leftmostX = 0;
                for (const k in worldData) {
                    if (k.startsWith('block_') || k.startsWith('label_')) continue;
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
                    if (k.startsWith('block_') || k.startsWith('label_')) continue;
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
            // Check if cursor is inside a data note - move to next cell
            const noteAtCursor = findTextNoteContainingPoint(cursorPos.x, cursorPos.y, worldData);
            if (noteAtCursor && noteAtCursor.data.contentType === 'data' && noteAtCursor.data.tableData && !isMod && !altKey) {
                const noteData = noteAtCursor.data;
                const { columns, rows, activeCell } = noteData.tableData;

                if (activeCell) {
                    let newCol = activeCell.col + 1;
                    let newRow = activeCell.row;

                    // Wrap to next row if past last column
                    if (newCol >= columns.length) {
                        newCol = 0;
                        newRow = activeCell.row + 1;
                    }

                    if (newRow < rows.length) {
                        noteData.tableData.activeCell = { row: newRow, col: newCol };
                        // Reset scroll offset for new cell
                        const newCellKey = `${newRow},${newCol}`;
                        if (!noteData.tableData.cellScrollOffsets) noteData.tableData.cellScrollOffsets = {};
                        noteData.tableData.cellScrollOffsets[newCellKey] = 0;

                        // Move cursor to new cell position
                        let cellStartX = noteData.startX;
                        for (let c = 0; c < newCol; c++) {
                            cellStartX += columns[c].width;
                        }
                        let cellStartY = noteData.startY;
                        for (let r = 0; r < newRow; r++) {
                            cellStartY += rows[r].height * GRID_CELL_SPAN;
                        }

                        setWorldData(prev => ({
                            ...prev,
                            [noteAtCursor.key]: JSON.stringify(noteData)
                        }));
                        setCursorPos({ x: cellStartX, y: cellStartY });
                        return true;
                    }
                }
            } else if (noteAtCursor && noteAtCursor.data.data && !isMod && !altKey) {
                const noteData = noteAtCursor.data;
                const currentScrollOffsetX = noteData.scrollOffsetX || 0;

                // Viewport width is derived from note bounds
                const visibleWidth = noteData.endX - noteData.startX + 1;

                // Calculate total content width from note.data
                let maxRelativeX = 0;
                for (const coordKey in noteData.data) {
                    const commaIndex = coordKey.indexOf(',');
                    if (commaIndex !== -1) {
                        const relativeX = parseInt(coordKey.substring(0, commaIndex), 10);
                        if (!isNaN(relativeX) && relativeX > maxRelativeX) {
                            maxRelativeX = relativeX;
                        }
                    }
                }
                const totalContentWidth = maxRelativeX + 1;
                const maxScrollX = Math.max(0, totalContentWidth - visibleWidth);

                // Can we scroll right? (show later content horizontally)
                if (currentScrollOffsetX < maxScrollX) {
                    // Scroll note right (increment scrollOffsetX)
                    const newScrollOffsetX = Math.min(maxScrollX, currentScrollOffsetX + 1);
                    setWorldData(prev => ({
                        ...prev,
                        [noteAtCursor.key]: JSON.stringify({
                            ...noteData,
                            scrollOffsetX: newScrollOffsetX
                        })
                    }));
                    // Don't move cursor - we scrolled the note instead
                    return true;
                }
                // If we can't scroll right anymore, fall through to normal cursor movement
            }

            if (isMod) {
                // Cmd+Right: Move to end of line (rightmost character position + 1)
                let rightmostX = cursorPos.x;
                for (const k in worldData) {
                    if (k.startsWith('block_') || k.startsWith('label_')) continue;
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
                    if (k.startsWith('block_') || k.startsWith('label_')) continue;
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
                nextWorldData = { ...activeWorldData }; // Create a copy before modifying

                // Use text block detection to find the current block
                // Don't include spaces - we want to detect gaps based on empty cells
                const lineChars = extractLineCharacters(activeWorldData, cursorPos.y, false);
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
                nextWorldData = { ...activeWorldData }; // Create a copy before modifying

                // Get text blocks on this line (don't include spaces to detect gaps)
                const lineChars = extractLineCharacters(activeWorldData, cursorPos.y, false);
                if (lineChars.length === 0) {
                    nextCursorPos.x = cursorPos.x;
                } else {
                    const blocks = detectTextBlocks(lineChars);
                    const currentBlock = findBlockForDeletion(blocks, cursorPos.x);

                    if (currentBlock) {
                        // Check what type of character we're starting on
                        let x = cursorPos.x - 1;
                        const startKey = `${x},${cursorPos.y}`;
                        const startCharData = activeWorldData[startKey];

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
                                const charData = activeWorldData[key];

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
                                if (activeWorldData[deleteKey]) {
                                    delete nextWorldData[deleteKey];
                                    worldDataChanged = true;
                                }
                                nextCursorPos.x -= 1;
                            }
                        }
                    } else {
                        // No block found, fallback to regular backspace
                        const deleteKey = `${cursorPos.x - 1},${cursorPos.y}`;
                        if (activeWorldData[deleteKey]) {
                            delete nextWorldData[deleteKey];
                            worldDataChanged = true;
                        }
                        nextCursorPos.x -= 1;
                    }
                }
            } else {
                // Regular Backspace: Check for task first, then link, then label
                // Note: tasks/links/labels only exist in worldData (not bounded mode)
                const taskToDelete = findTaskAt(cursorPos.x - 1, cursorPos.y);
                if (taskToDelete) {
                    nextWorldData = { ...activeWorldData };
                    delete nextWorldData[taskToDelete.key];
                    worldDataChanged = true;
                    // Move cursor to the start of where the task was
                    nextCursorPos.x = taskToDelete.data.startX;
                    nextCursorPos.y = taskToDelete.data.startY;
                } else {
                    const linkToDelete = findLinkAt(cursorPos.x - 1, cursorPos.y);
                    if (linkToDelete) {
                        nextWorldData = { ...activeWorldData };
                        delete nextWorldData[linkToDelete.key];
                        worldDataChanged = true;
                        // Move cursor to the start of where the link was
                        nextCursorPos.x = linkToDelete.data.startX;
                        nextCursorPos.y = linkToDelete.data.startY;
                    } else {
                        const labelToDelete = findLabelAt(cursorPos.x - 1, cursorPos.y);
                        if (labelToDelete) {
                            nextWorldData = { ...activeWorldData };
                            delete nextWorldData[labelToDelete.key];
                            worldDataChanged = true;
                            // Move cursor to the start of where the label was
                            const coordsStr = labelToDelete.key.substring('label_'.length);
                            const [lxStr, lyStr] = coordsStr.split(',');
                            nextCursorPos.x = parseInt(lxStr, 10);
                            nextCursorPos.y = parseInt(lyStr, 10);
                        } else {
                        // Check if we're within a note region first
                        // Use activeWorldData so bounded mode (with individual chars, no note_ keys) skips this
                        const noteRegion = getNoteRegion(activeWorldData, cursorPos);
                        if (noteRegion && cursorPos.x === noteRegion.startX) {
                            // We're at the start of a line within a note region
                            // Check if there's a previous line in content space (not just viewport space)
                            const containingNote = findTextNoteContainingPoint(cursorPos.x, cursorPos.y, activeWorldData);
                            if (containingNote && containingNote.data.data) {
                                const noteData = containingNote.data;
                                const currentScrollOffset = noteData.scrollOffset || 0;
                                // Calculate current line in content space
                                const currentRelativeY = (cursorPos.y - noteData.startY) + currentScrollOffset;

                                // Only do reverse wrap if there's content above (in content space)
                                if (currentRelativeY >= GRID_CELL_SPAN) {
                                    // Reverse wrap: delete last character of previous line and move cursor there
                                    const prevLineY = cursorPos.y - GRID_CELL_SPAN;
                                    const prevRelativeY = currentRelativeY - GRID_CELL_SPAN;

                                // Scan from right to left to find the last character on previous line
                                let lastCharX = -1;
                                for (let x = noteRegion.endX; x >= noteRegion.startX; x--) {
                                    const relativeKey = `${x - noteData.startX},${prevRelativeY}`;
                                    if (noteData.data[relativeKey]) {
                                        lastCharX = x;
                                        break;
                                    }
                                }

                                // If we found a character, delete it
                                if (lastCharX >= noteRegion.startX) {
                                    nextWorldData = { ...activeWorldData };
                                    const relativeDeleteKey = `${lastCharX - noteData.startX},${prevRelativeY}`;
                                    delete noteData.data[relativeDeleteKey];

                                    // Check if we need to scroll up (if cursor is at top of viewport in scroll mode)
                                    let cursorYAfterDelete = prevLineY;
                                    if (cursorPos.y === noteRegion.startY && currentScrollOffset > 0) {
                                        // Scroll up by one line
                                        noteData.scrollOffset = Math.max(0, currentScrollOffset - GRID_CELL_SPAN);
                                        // After scrolling, cursor stays at same world Y (now showing previous content line)
                                        cursorYAfterDelete = cursorPos.y;
                                    }

                                    nextWorldData[containingNote.key] = JSON.stringify(noteData);
                                    worldDataChanged = true;

                                    // Move cursor to where the deleted character was
                                    nextCursorPos.x = lastCharX;
                                    nextCursorPos.y = cursorYAfterDelete;
                                } else {
                                    // No character on previous line, just move cursor to start of previous line
                                    nextCursorPos.x = noteRegion.startX;
                                    nextCursorPos.y = prevLineY;
                                }
                                moved = true;
                                } // End of currentRelativeY >= GRID_CELL_SPAN check
                            } // End of containingNote check
                        } else if (noteRegion && cursorPos.x > noteRegion.startX) {
                            // We're within a note region but not at the start - do normal backspace
                            const deleteKey = `${cursorPos.x - 1},${cursorPos.y}`;

                            // Check if this is a text note with embedded data
                            const containingNote = findTextNoteContainingPoint(cursorPos.x - 1, cursorPos.y, activeWorldData);

                            if (containingNote) {
                                const noteData = containingNote.data;
                                nextWorldData = { ...activeWorldData };

                                // Check if this is a data note (table) - use cell-based storage
                                if (noteData.contentType === 'data' && noteData.tableData) {
                                    // Use active cell for backspace
                                    const activeCell = noteData.tableData.activeCell;
                                    if (activeCell) {
                                        const { row, col } = activeCell;
                                        const cellKey = `${row},${col}`;
                                        const { columns } = noteData.tableData;
                                        const cellWidth = columns[col]?.width || 4;

                                        const currentText = noteData.tableData.cells?.[cellKey] || '';

                                        if (currentText.length > 0) {
                                            // Delete last character from cell text
                                            const newText = currentText.slice(0, -1);
                                            if (!noteData.tableData.cells) noteData.tableData.cells = {};
                                            noteData.tableData.cells[cellKey] = newText;

                                            // Adjust scroll - scroll back if we can show all text now
                                            if (!noteData.tableData.cellScrollOffsets) noteData.tableData.cellScrollOffsets = {};
                                            const wasScrolling = noteData.tableData.cellScrollOffsets[cellKey] > 0;
                                            if (newText.length <= cellWidth) {
                                                noteData.tableData.cellScrollOffsets[cellKey] = 0;
                                            } else if (noteData.tableData.cellScrollOffsets[cellKey] > 0) {
                                                noteData.tableData.cellScrollOffsets[cellKey] = Math.max(0, newText.length - cellWidth);
                                            }
                                            const stillScrolling = noteData.tableData.cellScrollOffsets[cellKey] > 0;

                                            // Handle cursor position for data cells
                                            // Calculate cell start X position
                                            let cellStartX = noteData.startX;
                                            for (let c = 0; c < col; c++) {
                                                cellStartX += columns[c]?.width || 4;
                                            }

                                            if (stillScrolling) {
                                                // Still scrolling: cursor stays at right edge of cell
                                                nextCursorPos.x = cellStartX + cellWidth - 1;
                                            } else {
                                                // No longer scrolling: cursor moves with visible text
                                                nextCursorPos.x = cellStartX + newText.length;
                                            }

                                            // Update state directly and return (skip default cursor movement)
                                            setWorldData(prev => ({
                                                ...prev,
                                                [containingNote.key]: JSON.stringify(noteData)
                                            }));
                                            setCursorPos(nextCursorPos);
                                            cursorPosRef.current = nextCursorPos;
                                            return true;
                                        }
                                    }
                                    // No text to delete, but still skip default cursor movement for data cells
                                    return true;
                                } else if (noteData.data) {
                                    // Regular text note - delete from note's data field using relative coordinates
                                    const scrollOffset = noteData.scrollOffset || 0;
                                    const relativeDeleteKey = `${(cursorPos.x - 1) - noteData.startX},${(cursorPos.y - noteData.startY) + scrollOffset}`;
                                    if (noteData.data[relativeDeleteKey]) {
                                        delete noteData.data[relativeDeleteKey];
                                        nextWorldData[containingNote.key] = JSON.stringify(noteData);
                                        worldDataChanged = true;
                                    }
                                }
                            } else if (activeWorldData[deleteKey]) {
                                // Delete from activeWorldData (handles both bounded and unbounded mode)
                                nextWorldData = { ...activeWorldData };
                                delete nextWorldData[deleteKey];
                                worldDataChanged = true;
                            }
                            nextCursorPos.x -= 1;
                            moved = true;
                        } else {
                            // Check if we're within a mail region
                            // Use activeWorldData so bounded mode skips this
                            const mailRegion = getMailRegion(activeWorldData, cursorPos);
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
                                if (activeWorldData[deleteKey]) {
                                    nextWorldData = { ...activeWorldData };
                                    delete nextWorldData[deleteKey];
                                    worldDataChanged = true;
                                }
                                nextCursorPos.x -= 1;
                                moved = true;
                            } else {
                                // Check if we're at the beginning of a line (need to merge with previous line)
                                // Only merge if cursor is actually before any characters on this line, not at first character
                                const currentLineChars = extractLineCharacters(activeWorldData, cursorPos.y);
                                const isAtLineStart = currentLineChars.length > 0 ?
                                    cursorPos.x < currentLineChars[0].x :
                                    cursorPos.x === 0;

                                if (isAtLineStart && cursorPos.y > 0) {
                                    // Find the last character position on the previous line
                                    const prevLineChars = extractLineCharacters(activeWorldData, cursorPos.y - 1);
                                    let targetX = 0; // Default to start of line if no characters

                                    if (prevLineChars.length > 0) {
                                        // Find rightmost character on previous line
                                        targetX = Math.max(...prevLineChars.map(c => c.x)) + 1;
                                    }

                                    // Collect all text from current line to move it
                                    nextWorldData = { ...activeWorldData };
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
                                    if (activeWorldData[deleteKey]) {
                                        nextWorldData = { ...activeWorldData }; // Create copy before modifying
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
            // Always prevent default browser behavior (focusing address bar)
            preventDefault = true;

            // Check if cursor is inside a data note - Tab moves to next cell
            const noteAtCursor = findTextNoteContainingPoint(cursorPos.x, cursorPos.y, worldData);
            if (noteAtCursor && noteAtCursor.data.contentType === 'data' && noteAtCursor.data.tableData) {
                const noteData = noteAtCursor.data;
                const { columns, rows, activeCell } = noteData.tableData;

                if (activeCell) {
                    let newCol = shiftKey ? activeCell.col - 1 : activeCell.col + 1;
                    let newRow = activeCell.row;

                    // Wrap to next/previous row
                    if (newCol >= columns.length) {
                        newCol = 0;
                        newRow = activeCell.row + 1;
                    } else if (newCol < 0) {
                        newCol = columns.length - 1;
                        newRow = activeCell.row - 1;
                    }

                    if (newRow >= 0 && newRow < rows.length) {
                        noteData.tableData.activeCell = { row: newRow, col: newCol };
                        // Reset scroll offset for new cell
                        const newCellKey = `${newRow},${newCol}`;
                        if (!noteData.tableData.cellScrollOffsets) noteData.tableData.cellScrollOffsets = {};
                        noteData.tableData.cellScrollOffsets[newCellKey] = 0;

                        // Move cursor to new cell position
                        let cellStartX = noteData.startX;
                        for (let c = 0; c < newCol; c++) {
                            cellStartX += columns[c].width;
                        }
                        let cellStartY = noteData.startY;
                        for (let r = 0; r < newRow; r++) {
                            cellStartY += rows[r].height * GRID_CELL_SPAN;
                        }

                        setWorldData(prev => ({
                            ...prev,
                            [noteAtCursor.key]: JSON.stringify(noteData)
                        }));
                        setCursorPos({ x: cellStartX, y: cellStartY });
                        return true;
                    }
                }
            }

            // Tab key for accepting autocomplete suggestions (when not in data note)
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
                // Note: tasks/links/labels only exist in worldData (not bounded mode)
                const taskToDelete = findTaskAt(cursorPos.x, cursorPos.y);
                if (taskToDelete) {
                    nextWorldData = { ...activeWorldData };
                    delete nextWorldData[taskToDelete.key];
                    worldDataChanged = true;
                    // Cursor does not move
                } else {
                    const linkToDelete = findLinkAt(cursorPos.x, cursorPos.y);
                    if (linkToDelete) {
                        nextWorldData = { ...activeWorldData };
                        delete nextWorldData[linkToDelete.key];
                        worldDataChanged = true;
                        // Cursor does not move
                    } else {
                        const labelToDelete = findLabelAt(cursorPos.x, cursorPos.y);
                        if (labelToDelete) {
                            nextWorldData = { ...activeWorldData };
                            delete nextWorldData[labelToDelete.key];
                            worldDataChanged = true;
                            // Cursor does not move
                        } else {
                            const deleteKey = `${cursorPos.x},${cursorPos.y}`;
                            if (activeWorldData[deleteKey]) {
                                nextWorldData = { ...activeWorldData }; // Create copy before modifying
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

            let dataToDeleteFrom = activeWorldData;
            let cursorAfterDelete = cursorPos;

            if (currentSelectionActive) {
                // Inline deletion logic to avoid async issues and manage state batching
                const selection = getNormalizedSelection();
                if (selection) {
                    let tempWorldData = { ...activeWorldData };
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
            // Move cursor right by the width of the current scale
            let proposedCursorPos = { x: cursorAfterDelete.x + currentScale.w, y: cursorAfterDelete.y };

            // Check for note region word wrapping (if not already handled by bounded region)
            if (!worldDataChanged) {
                const noteRegion = getNoteRegion(dataToDeleteFrom, cursorAfterDelete);
                if (noteRegion && proposedCursorPos.x > noteRegion.endX) {
                    // Get the containing note to access its data and check wrapText setting
                    const noteAtCursor = findTextNoteContainingPoint(cursorAfterDelete.x, cursorAfterDelete.y, dataToDeleteFrom);
                    if (!noteAtCursor) return true;

                    const noteData = noteAtCursor.data;

                    // Skip word wrapping for data notes - they handle text in cells with horizontal scrolling
                    if (noteData.contentType === 'data') {
                        // Don't do word wrapping, fall through to data cell handling below
                    } else {
                    // We would type past the right edge - wrap to next line
                    // (All display modes support wrapping, but behavior differs)
                    const nextLineY = cursorAfterDelete.y + GRID_CELL_SPAN;
                    let updatedNoteData = { ...noteData };
                    let updatedWorldData = { ...dataToDeleteFrom };

                    // If wrapping would exceed bounds, expand or scroll based on display mode
                    const displayMode = noteData.displayMode || 'expand';
                    let shouldScroll = false;

                    if (nextLineY > noteRegion.endY) {
                        if (displayMode === 'expand') {
                            // Expand mode: grow note downward to accommodate new line
                            updatedNoteData.endY = nextLineY;
                        } else if (displayMode === 'scroll' || displayMode === 'paint') {
                            // Scroll/Paint mode: keep note size, auto-scroll down by GRID_CELL_SPAN
                            const currentScrollOffset = noteData.scrollOffset || 0;
                            updatedNoteData.scrollOffset = currentScrollOffset + GRID_CELL_SPAN;
                            shouldScroll = true;
                        } else if (displayMode === 'wrap') {
                            // Wrap mode: keep note size fixed, no auto-scroll (content wraps within bounds)
                            // User can manually scroll if needed
                        }
                    }

                    // Type the current character at cursorAfterDelete.x on this line first
                    if (!updatedNoteData.data) updatedNoteData.data = {};
                    // Calculate relative Y in content space (viewport position + scroll offset)
                    const currentScrollOffset = noteData.scrollOffset || 0;
                    const currentRelativeY = (cursorAfterDelete.y - noteData.startY) + currentScrollOffset;
                    const currentCharKey = `${cursorAfterDelete.x - noteData.startX},${currentRelativeY}`;
                    updatedNoteData.data[currentCharKey] = key;

                    // Calculate the relative Y for the next line (in content space)
                    const nextRelativeY = currentRelativeY + GRID_CELL_SPAN;

                    // Now proceed with word wrapping
                    const currentLineY = cursorAfterDelete.y;
                    let wrapPoint = noteRegion.startX;

                    // Scan backwards from the boundary to find the last space (including char we just typed)
                    for (let x = noteRegion.endX; x >= noteRegion.startX; x--) {
                        const relativeKey = `${x - noteData.startX},${currentRelativeY}`;
                        const charData = updatedNoteData.data?.[relativeKey];
                        const char = typeof charData === 'string' ? charData :
                                    (charData && typeof charData === 'object' && 'char' in charData) ? charData.char : '';

                        if (char === ' ') {
                            wrapPoint = x + 1;
                            break;
                        }
                    }

                    // Only do word wrapping if we found a space
                    if (wrapPoint > noteRegion.startX && wrapPoint <= noteRegion.endX) {
                        // Collect all characters from wrap point to endX (including char we just typed)
                        const textToWrap: Array<{x: number, char: string, style?: any}> = [];

                        for (let x = wrapPoint; x <= noteRegion.endX; x++) {
                            const relativeKey = `${x - noteData.startX},${currentRelativeY}`;
                            const charData = updatedNoteData.data?.[relativeKey];
                            if (charData) {
                                const char = typeof charData === 'string' ? charData :
                                           (charData && typeof charData === 'object' && 'char' in charData) ? charData.char : '';
                                const style = typeof charData === 'object' && 'style' in charData ? charData.style : undefined;
                                if (char) {
                                    textToWrap.push({x, char, style});
                                }
                            }
                        }

                        // Remove the wrapped text from current line in note.data
                        for (let x = wrapPoint; x <= noteRegion.endX; x++) {
                            const relativeKey = `${x - noteData.startX},${currentRelativeY}`;
                            delete updatedNoteData.data[relativeKey];
                        }

                        // Add the wrapped text to next line in note.data with relative coordinates
                        let newX = noteRegion.startX;
                        for (const {char, style} of textToWrap) {
                            if (char !== ' ') {
                                const relativeKey = `${newX - noteData.startX},${nextRelativeY}`;
                                updatedNoteData.data[relativeKey] = style ? {char, style} : char;
                                newX++;
                            }
                        }

                        // Update the note in worldData and move cursor
                        updatedWorldData[noteAtCursor.key] = JSON.stringify(updatedNoteData);
                        setWorldData(updatedWorldData);

                        // In scroll mode, cursor stays at bottom of note (not world nextLineY)
                        const cursorY = shouldScroll ? cursorAfterDelete.y : nextLineY;
                        setCursorPos({ x: newX, y: cursorY });
                        worldDataChanged = true;

                        return true;
                    } else {
                        // No good wrap point - leave char on current line, just move cursor to next
                        updatedWorldData[noteAtCursor.key] = JSON.stringify(updatedNoteData);
                        setWorldData(updatedWorldData);

                        // In scroll mode, cursor stays at bottom of note (not world nextLineY)
                        const cursorY = shouldScroll ? cursorAfterDelete.y : nextLineY;
                        setCursorPos({ x: noteRegion.startX, y: cursorY });
                        worldDataChanged = true;
                        return true;
                    }
                    } // end else (non-data note word wrapping)
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
            if (chatMode.isActive) {
                // Add to chat data with scale and style support
                const hasCustomStyle = currentTextStyle.color !== textColor || !!currentTextStyle.background;
                const hasCustomScale = currentScale.w !== 1 || currentScale.h !== 2;

                let charData: string | StyledCharacter = key;
                if (hasCustomStyle || hasCustomScale) {
                    const styledChar: StyledCharacter = { char: key };
                    if (hasCustomStyle) {
                        styledChar.style = { color: currentTextStyle.color };
                        if (currentTextStyle.background) styledChar.style.background = currentTextStyle.background;
                    }
                    if (hasCustomScale) {
                        styledChar.scale = { ...currentScale };
                    }
                    charData = styledChar;
                }

                setChatData(prev => ({
                    ...prev,
                    [`${cursorAfterDelete.x},${cursorAfterDelete.y}`]: charData
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
                // Chat mode but not active: activate it with scale and style support
                const hasCustomStyle = currentTextStyle.color !== textColor || !!currentTextStyle.background;
                const hasCustomScale = currentScale.w !== 1 || currentScale.h !== 2;

                let charData: string | StyledCharacter = key;
                if (hasCustomStyle || hasCustomScale) {
                    const styledChar: StyledCharacter = { char: key };
                    if (hasCustomStyle) {
                        styledChar.style = { color: currentTextStyle.color };
                        if (currentTextStyle.background) styledChar.style.background = currentTextStyle.background;
                    }
                    if (hasCustomScale) {
                        styledChar.scale = { ...currentScale };
                    }
                    charData = styledChar;
                }

                setChatMode({
                    isActive: true,
                    currentInput: key,
                    inputPositions: [cursorAfterDelete],
                    isProcessing: false
                });
                setChatData({
                    [`${cursorAfterDelete.x},${cursorAfterDelete.y}`]: charData
                });
                setDialogueWithRevert("Chat mode activated. Enter: ephemeral response, Cmd+Enter: permanent response, Shift+Enter: new line. Use /exit to leave.", setDialogueText);
            } else {
                // Air mode (default): Normal text input to worldData
                nextWorldData = { ...dataToDeleteFrom }; // Start with data after potential deletion
                const currentKey = `${cursorAfterDelete.x},${cursorAfterDelete.y}`;

                // Check if we're inside a text note
                const containingNote = findTextNoteContainingPoint(cursorAfterDelete.x, cursorAfterDelete.y, nextWorldData);

                // Check if current text style is different from global defaults
                const hasCustomStyle = currentTextStyle.color !== textColor || currentTextStyle.background !== undefined;
                const hasCustomScale = currentScale.w !== 1 || currentScale.h !== 2;

                // Prepare character data
                let charData: string | StyledCharacter;
                if (hasCustomStyle || hasCustomScale) {
                    // Store styled/scaled character (filter out undefined values for Firebase)
                    const styledChar: StyledCharacter = {
                        char: key
                    };

                    if (hasCustomStyle) {
                        styledChar.style = {
                            color: currentTextStyle.color
                        };
                        if (currentTextStyle.background !== undefined) {
                            styledChar.style.background = currentTextStyle.background;
                        }
                    }

                    if (hasCustomScale) {
                        styledChar.scale = { ...currentScale };
                    }

                    charData = styledChar;
                } else {
                    // Store plain character (backward compatibility)
                    charData = key;
                }

                // Write to note.data if inside a note, otherwise to global worldData
                if (containingNote) {
                    const noteData = containingNote.data;

                    // Check if this is a data note (table) - use cell-based storage
                    if (noteData.contentType === 'data' && noteData.tableData) {
                        // Initialize cells if needed
                        if (!noteData.tableData.cells) {
                            noteData.tableData.cells = {};
                        }
                        if (!noteData.tableData.cellScrollOffsets) {
                            noteData.tableData.cellScrollOffsets = {};
                        }

                        // Determine which cell to type into:
                        // - If we have an active cell and cursor is near it, keep typing there
                        // - Otherwise, find cell at cursor position and make it active
                        let targetCell = noteData.tableData.activeCell;
                        const cursorCellInfo = getCellAtPosition(cursorAfterDelete.x, cursorAfterDelete.y, noteData);

                        if (!targetCell && cursorCellInfo) {
                            // No active cell, use cursor position
                            targetCell = { row: cursorCellInfo.row, col: cursorCellInfo.col };
                        } else if (targetCell && cursorCellInfo) {
                            // Check if cursor moved to a different row - that means user wants different cell
                            if (cursorCellInfo.row !== targetCell.row) {
                                targetCell = { row: cursorCellInfo.row, col: cursorCellInfo.col };
                            }
                            // If same row but different column, keep typing in active cell (horizontal scroll)
                            // unless user explicitly clicked a different cell (handled by click events)
                        }
                        // If cursor is outside cell bounds but we have an activeCell, keep using it
                        // (this handles typing in rightmost column with horizontal scroll)

                        // For data notes, if we can't determine a target cell, skip writing
                        // (don't fall through to regular text note handling)
                        if (!targetCell) {
                            // No valid cell to type into - skip writing for data notes
                            return true;
                        }

                        if (targetCell) {
                            const { row, col } = targetCell;
                            const cellKey = `${row},${col}`;

                            // Get cell width from tableData
                            const { columns } = noteData.tableData;
                            const cellWidth = columns[col]?.width || 4;

                            // Get current cell text
                            const currentText = noteData.tableData.cells[cellKey] || '';

                            // Always append to end of cell text
                            const newText = currentText + key;
                            noteData.tableData.cells[cellKey] = newText;

                            // Update active cell
                            noteData.tableData.activeCell = targetCell;

                            // Calculate cell start X position
                            let cellStartX = noteData.startX;
                            for (let c = 0; c < col; c++) {
                                cellStartX += columns[c]?.width || 4;
                            }

                            // Auto-scroll to show the new character
                            if (newText.length > cellWidth) {
                                noteData.tableData.cellScrollOffsets[cellKey] = newText.length - cellWidth;
                                // Keep cursor at the right edge of the cell (like scroll display mode)
                                nextCursorPos.x = cellStartX + cellWidth - 1;
                            } else {
                                // No scrolling yet - cursor stays within cell at end of visible text
                                nextCursorPos.x = cellStartX + newText.length;
                                // But don't exceed cell bounds (important for rightmost column)
                                if (nextCursorPos.x >= cellStartX + cellWidth) {
                                    nextCursorPos.x = cellStartX + cellWidth - 1;
                                }
                            }

                            nextWorldData[containingNote.key] = JSON.stringify(noteData);

                            // Record for playback
                            if (recorder.isRecording) {
                                recorder.recordContentChange(containingNote.key, JSON.stringify(noteData));
                            }
                        }
                    } else {
                        // Regular text note - write to note.data field using relative coordinates
                        if (!noteData.data) {
                            noteData.data = {};
                        }
                        // Convert absolute world coordinates to relative content coordinates
                        const scrollOffset = noteData.scrollOffset || 0;
                        const relativeX = cursorAfterDelete.x - noteData.startX;
                        const relativeY = (cursorAfterDelete.y - noteData.startY) + scrollOffset;
                        const relativeKey = `${relativeX},${relativeY}`;
                        noteData.data[relativeKey] = charData;
                        nextWorldData[containingNote.key] = JSON.stringify(noteData);

                        // Record character placement for playback
                        if (recorder.isRecording) {
                            recorder.recordContentChange(containingNote.key, JSON.stringify(noteData));
                        }
                    }
                } else {
                    // Write to global worldData
                    nextWorldData[currentKey] = charData;

                    // Record character placement for playback
                    if (recorder.isRecording) {
                        recorder.recordContentChange(currentKey, charData);
                    }

                    // Move cursor right after typing (by character width)
                    nextCursorPos.x = cursorAfterDelete.x + currentScale.w;
                    nextCursorPos.y = cursorAfterDelete.y;
                    moved = true;
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
        // Use setActiveWorldData to correctly target boundedWorldData when canvasState === 1
        if (worldDataChanged) {
             setActiveWorldData(nextWorldData);
        }

        return preventDefault;
    }, [
        cursorPos, worldData, activeWorldData, setActiveWorldData, selectionStart, selectionEnd, commandState, chatMode, chatData, // State dependencies
        currentMode, addEphemeralText, cameraMode, viewOffset, zoomLevel, getEffectiveCharDims, // Mode system dependencies
        getNormalizedSelection, deleteSelectedCharacters, copySelectedCharacters, cutSelection, pasteText, getSelectedText, // Callback dependencies
        handleCommandKeyDown, textColor, currentTextStyle, findListAt, getNoteRegion, getMailRegion
        // Include setters used directly in the handler (if any, preferably avoid)
        // setCursorPos, setWorldData, setSelectionStart, setSelectionEnd // Setters are stable, no need to list
    ]);

    const handleCanvasClick = useCallback((canvasRelativeX: number, canvasRelativeY: number, clearSelection: boolean = false, shiftKey: boolean = false, metaKey: boolean = false, ctrlKey: boolean = false): void => {
        // Clear autocomplete on canvas click
        clearAutocompleteSuggestions();

        let newCursorPos = screenToWorld(canvasRelativeX, canvasRelativeY, zoomLevel, effectiveViewOffset);

        // View overlay cursor constraining handled by the overlay itself
        // (viewOverlay no longer has bounds, just noteKey and content)

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

        // === Click to Toggle/Interact with Chips ===
        // Handle task, link, and pack chips with unified chip_ prefix
        for (const key in worldData) {
            if (key.startsWith('chip_')) {
                try {
                    const chipData = JSON.parse(worldData[key] as string);
                    const { startX, endX, startY, endY, type } = chipData;

                    // Check if click is within chip bounds
                    if (newCursorPos.x >= startX && newCursorPos.x <= endX &&
                        newCursorPos.y >= startY && newCursorPos.y <= endY) {

                        // Handle task chips
                        if (type === 'task') {
                            const updatedChipData = {
                                ...chipData,
                                completed: !chipData.completed
                            };
                            setWorldData(prev => ({
                                ...prev,
                                [key]: JSON.stringify(updatedChipData)
                            }));
                            const status = updatedChipData.completed ? 'completed' : 'reopened';
                            setDialogueWithRevert(`Task ${status}`, setDialogueText);
                            return;
                        }

                        // Handle link chips
                        if (type === 'link' && chipData.url) {
                            window.open(chipData.url, '_blank', 'noopener,noreferrer');
                            setDialogueWithRevert(`Opening link...`, setDialogueText);
                            return;
                        }

                        // Handle pack chips
                        if (type === 'pack') {
                            const isCurrentlyCollapsed = chipData.collapsed || false;

                            // Calculate new bounds based on toggle state
                            let newBounds;
                            if (!isCurrentlyCollapsed) {
                                // Collapsing: shrink to text size
                                const textLength = chipData.text?.length || 4;
                                newBounds = {
                                    startX: chipData.startX,
                                    endX: chipData.startX + textLength - 1,
                                    startY: chipData.startY,
                                    endY: chipData.startY
                                };
                            } else {
                                // Expanding: grow to expanded bounds
                                newBounds = chipData.expandedBounds || {
                                    startX: chipData.startX,
                                    endX: chipData.endX,
                                    startY: chipData.startY,
                                    endY: chipData.endY
                                };
                            }

                            const updatedChipData = {
                                ...chipData,
                                collapsed: !isCurrentlyCollapsed,
                                startX: newBounds.startX,
                                endX: newBounds.endX,
                                startY: newBounds.startY,
                                endY: newBounds.endY
                            };

                            // Just toggle the state and bounds - data stays in the pack chip
                            // Rendering will handle displaying the packed content when expanded
                            setWorldData(prev => ({
                                ...prev,
                                [key]: JSON.stringify(updatedChipData)
                            }));

                            setDialogueWithRevert(
                                !isCurrentlyCollapsed ? `Pack collapsed` : `Pack expanded`,
                                setDialogueText
                            );
                            return;
                        }
                    }
                } catch (e) {
                    // Skip invalid chip data
                }
            }
        }

        // === Click Mail Send Link ===
        // Check if clicked on "send" link in mail regions
        for (const key in worldData) {
            if (key.startsWith('note_')) {
                try {
                    const noteData = JSON.parse(worldData[key] as string);
                    // Only handle mail notes
                    if (noteData.contentType !== 'mail') continue;

                    const { startX, endX, startY, endY } = noteData;

                    // "send" text is positioned at bottom-right (endX-3 to endX, at endY)
                    const sendText = 'send';
                    const sendStartX = endX - sendText.length + 1;
                    const sendEndX = endX;
                    const sendY = endY;

                    // Check if click is within "send" bounds
                    if (newCursorPos.x >= sendStartX && newCursorPos.x <= sendEndX &&
                        newCursorPos.y === sendY) {

                        // Parse mail content from internalized data
                        const internalData = noteData.data || {};
                        let toLine = '';
                        let subjectLine = '';

                        const width = endX - startX;
                        const height = endY - startY;

                        // Extract row 1 (to) - use relative coordinates
                        for (let relX = 0; relX <= width; relX++) {
                            const relKey = `${relX},0`;
                            const cellData = internalData[relKey];
                            if (cellData && !isImageData(cellData)) {
                                toLine += getCharacter(cellData) || '';
                            }
                        }

                        // Extract row 2 (subject) - use relative coordinates
                        if (height >= 1) {
                            for (let relX = 0; relX <= width; relX++) {
                                const relKey = `${relX},1`;
                                const cellData = internalData[relKey];
                                if (cellData && !isImageData(cellData)) {
                                    subjectLine += getCharacter(cellData) || '';
                                }
                            }
                        }

                        // Extract message (row 3+) - use relative coordinates
                        // Treat consecutive non-empty lines as continuous text (word-wrapped)
                        // Only break paragraphs on empty lines
                        let currentParagraph = '';
                        const paragraphs: string[] = [];

                        for (let relY = 2; relY <= height; relY++) {
                            let rowContent = '';
                            for (let relX = 0; relX <= width; relX++) {
                                const relKey = `${relX},${relY}`;
                                const cellData = internalData[relKey];
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
                        setProcessingRegion({ startX, endX, startY, endY });

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
                            setProcessingRegion(null);
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

        // Check if clicking inside a data note - set active cell
        const clickedNote = findTextNoteContainingPoint(newCursorPos.x, newCursorPos.y, worldData);
        if (clickedNote && clickedNote.data.contentType === 'data' && clickedNote.data.tableData) {
            const noteData = clickedNote.data;
            const cellInfo = getCellAtPosition(newCursorPos.x, newCursorPos.y, noteData);

            if (cellInfo) {
                const { row, col, cellStartX, cellStartY } = cellInfo;

                // Set active cell
                noteData.tableData.activeCell = { row, col };

                // Reset scroll offset for newly selected cell
                if (!noteData.tableData.cellScrollOffsets) noteData.tableData.cellScrollOffsets = {};
                const cellKey = `${row},${col}`;
                noteData.tableData.cellScrollOffsets[cellKey] = 0;

                // Update note and move cursor to cell start
                setWorldData(prev => ({
                    ...prev,
                    [clickedNote.key]: JSON.stringify(noteData)
                }));

                // Snap cursor to cell start position
                newCursorPos = { x: cellStartX, y: cellStartY + 1 }; // +1 for text baseline
            }
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
    }, [zoomLevel, effectiveViewOffset, screenToWorld, selectionStart, selectionEnd, chatMode, worldData, setDialogueText, clipboardItems, getCharacter, isImageData, viewOverlay]);

    const handleCanvasWheel = useCallback((deltaX: number, deltaY: number, canvasRelativeX: number, canvasRelativeY: number, ctrlOrMetaKey: boolean): void => {
        // In view overlay mode, disable scrolling (view is a zoomed viewport)
        if (viewOverlay) {
            return; // Don't process scroll actions in view mode
        }

        // First, check if mouse is over a list (unless zooming with ctrl/meta)
        if (!ctrlOrMetaKey) {
            const worldPos = screenToWorld(canvasRelativeX, canvasRelativeY, zoomLevel, effectiveViewOffset);
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

            // Check if mouse is over a data table note
            const dataTableAtPos = findTextNoteContainingPoint(worldPos.x, worldPos.y, worldData);
            if (dataTableAtPos && dataTableAtPos.data.contentType === 'data' && dataTableAtPos.data.tableData) {
                // Scroll the data table vertically through rows
                const noteData = dataTableAtPos.data;
                const { rows } = noteData.tableData;
                const scrollSpeed = 1; // Rows per scroll tick
                const scrollDelta = Math.sign(deltaY) * scrollSpeed;

                // Calculate visible rows based on note height
                const visibleHeight = noteData.endY - noteData.startY + 1;
                const visibleRows = Math.floor(visibleHeight / GRID_CELL_SPAN);

                // Total rows in the table
                const totalRows = rows.length;

                // Max scroll = total rows - visible rows (can't scroll past the end)
                const maxScroll = Math.max(0, totalRows - visibleRows);

                // Get current scroll offset (row index)
                const currentScrollOffset = noteData.tableData.tableScrollOffset || 0;
                const newScrollOffset = Math.max(0, Math.min(maxScroll, currentScrollOffset + scrollDelta));

                // Only update if scroll offset actually changed
                if (newScrollOffset !== currentScrollOffset) {
                    const updatedNoteData = {
                        ...noteData,
                        tableData: {
                            ...noteData.tableData,
                            tableScrollOffset: newScrollOffset
                        }
                    };
                    setWorldData(prev => ({
                        ...prev,
                        [dataTableAtPos.key]: JSON.stringify(updatedNoteData)
                    }));
                }

                return; // Don't pan world
            }

            // Check if mouse is over a note with scrolling enabled
            const noteAtPos = findTextNoteContainingPoint(worldPos.x, worldPos.y, worldData);
            if (noteAtPos && noteAtPos.data.data) {
                // Scroll the note content instead of panning world
                const noteData = noteAtPos.data;
                const scrollSpeed = GRID_CELL_SPAN; // Scroll by GRID_CELL_SPAN per tick
                const scrollDelta = Math.sign(deltaY) * scrollSpeed;

                // Viewport height is derived from note bounds (in world units)
                const visibleHeight = noteData.endY - noteData.startY + 1;
                const visibleHeightLines = Math.floor(visibleHeight / GRID_CELL_SPAN);

                // Calculate total content height from note.data (using relative coordinates)
                let maxRelativeY = 0;
                for (const coordKey in noteData.data) {
                    const commaIndex = coordKey.indexOf(',');
                    if (commaIndex !== -1) {
                        const relativeY = parseInt(coordKey.substring(commaIndex + 1), 10);
                        if (!isNaN(relativeY) && relativeY > maxRelativeY) {
                            maxRelativeY = relativeY;
                        }
                    }
                }
                // Convert maxRelativeY (world units) to line count
                const totalContentLines = Math.floor(maxRelativeY / GRID_CELL_SPAN) + 1;

                // Calculate max scroll offset in world units
                const maxScroll = Math.max(0, (totalContentLines - visibleHeightLines) * GRID_CELL_SPAN);

                // Update scroll offset with bounds checking
                const currentScrollOffset = noteData.scrollOffset || 0;
                const newScrollOffset = Math.max(0, Math.min(maxScroll, currentScrollOffset + scrollDelta));

                // Only update if scroll offset actually changed
                if (newScrollOffset !== currentScrollOffset) {
                    const updatedNoteData = { ...noteData, scrollOffset: newScrollOffset };
                    setWorldData(prev => ({
                        ...prev,
                        [noteAtPos.key]: JSON.stringify(updatedNoteData)
                    }));
                }

                return; // Don't pan world
            }
        }

        if (ctrlOrMetaKey) {
            // Zooming
            if (isFullscreenMode && fullscreenRegion) {
                // In fullscreen mode, allow zoom but constrain to keep region visible
                const worldPointBeforeZoom = screenToWorld(canvasRelativeX, canvasRelativeY, zoomLevel, effectiveViewOffset);
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

            const worldPointBeforeZoom = screenToWorld(canvasRelativeX, canvasRelativeY, zoomLevel, effectiveViewOffset);
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
    }, [zoomLevel, effectiveViewOffset, screenToWorld, getEffectiveCharDims, findListAt, worldData, isFullscreenMode, fullscreenRegion, viewOverlay, setViewOverlayScroll]);

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

        // Apply bounds constraints (if bounded canvas mode)
        if (currentBounds) {
            const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 800;
            const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 600;
            const viewportWidthInCells = viewportWidth / effectiveCharWidth;
            const viewportHeightInCells = viewportHeight / effectiveCharHeight;
            newOffset = clampViewportToBounds(newOffset, viewportWidthInCells, viewportHeightInCells);
        }

        // Track viewport history with throttling to prevent infinite loops
        if (typeof window !== 'undefined' && effectiveCharWidth > 0 && effectiveCharHeight > 0) {
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const centerX = newOffset.x + (viewportWidth / effectiveCharWidth) / 2;
            const centerY = newOffset.y + (viewportHeight / effectiveCharHeight) / 2;

        }

        return newOffset;
    }, [zoomLevel, getEffectiveCharDims, viewOffset, isFullscreenMode, fullscreenRegion, currentBounds, clampViewportToBounds]);

    const handlePanEnd = useCallback((newOffset: Point): void => {
        if (isPanningRef.current) {
            isPanningRef.current = false;
            setViewOffset(newOffset); // Set final state
        }
    }, []);

    const handleSelectionStart = useCallback((canvasRelativeX: number, canvasRelativeY: number): void => {
        const worldPos = screenToWorld(canvasRelativeX, canvasRelativeY, zoomLevel, effectiveViewOffset);
        setSelectionStart(worldPos);
        setSelectionEnd(worldPos);
        setCursorPos(worldPos); // Move cursor to selection start

        // Record action for playback
        recorder.recordAction('selection_start', { pos: worldPos });
    }, [zoomLevel, effectiveViewOffset, screenToWorld, recorder]);

    const handleSelectionMove = useCallback((canvasRelativeX: number, canvasRelativeY: number): void => {
        if (selectionStart) { // This is correct - we want to update only if a selection has started
            const worldPos = screenToWorld(canvasRelativeX, canvasRelativeY, zoomLevel, effectiveViewOffset);
            setSelectionEnd(worldPos);

            // Record action for playback
            recorder.recordAction('selection_update', { pos: worldPos });
        }
    }, [selectionStart, zoomLevel, effectiveViewOffset, screenToWorld, recorder]);

    const handleSelectionEnd = useCallback((): void => {
        // Simply mark selection process as ended
        setIsSelecting(false);

        // In note mode, show prompt to confirm region with Enter
        if (currentMode === 'note' && selectionStart && selectionEnd) {
            setDialogueWithRevert("Press Enter to confirm note region, or Escape to cancel", setDialogueText);
        }

        // Record action for playback
        if (selectionStart && selectionEnd) {
            recorder.recordAction('selection_end', { start: selectionStart, end: selectionEnd });
        }

        // We keep the selection intact regardless
        // The selection will be cleared in other functions if needed
        // This allows the selection to persist after mouse up
    }, [currentMode, selectionStart, selectionEnd, setDialogueText, recorder]);

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
        // Calculate final cursor position after placing all characters (accounting for scale)
        const finalCursorPos = { x: startPos.x + (text.length * currentScale.w), y: startPos.y };

        // Detect which mode is active and write to appropriate data store
        if (chatMode.isActive && !commandState.isActive) {
            // Chat mode: write to chatData with scale and style support
            const hasCustomStyle = currentTextStyle.color !== textColor || !!currentTextStyle.background;
            const hasCustomScale = currentScale.w !== 1 || currentScale.h !== 2;

            setChatData(prev => {
                const newChatData = { ...prev };
                let currentPos = { ...startPos };

                for (const char of text) {
                    const key = `${currentPos.x},${currentPos.y}`;

                    let charData: string | StyledCharacter = char;
                    if (hasCustomStyle || hasCustomScale) {
                        const styledChar: StyledCharacter = { char };
                        if (hasCustomStyle) {
                            styledChar.style = { color: currentTextStyle.color };
                            if (currentTextStyle.background) styledChar.style.background = currentTextStyle.background;
                        }
                        if (hasCustomScale) {
                            styledChar.scale = { ...currentScale };
                        }
                        charData = styledChar;
                    }

                    newChatData[key] = charData;
                    currentPos.x += currentScale.w;
                }

                return newChatData;
            });

            // Update chat mode input and positions
            setChatMode(prev => {
                const newPositions = [...prev.inputPositions];
                let currentPos = { ...startPos };

                for (const char of text) {
                    newPositions.push({ ...currentPos });
                    currentPos.x += currentScale.w;
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
        const newData = { ...activeWorldData };
        delete newData[key];
        setActiveWorldData(newData);

        // Record deletion immediately for accurate playback (only in unbounded mode)
        if (canvasState === 0 && recorder.isRecording) {
            recorder.recordContentChange(key, null);
        }
    }, [activeWorldData, setActiveWorldData, canvasState, recorder]);

    const placeCharacter = useCallback((char: string, x: number, y: number): void => {
        if (char.length !== 1) return; // Only handle single characters
        if (!isWithinBounds(x, y)) return; // Reject writes outside bounds
        const key = `${x},${y}`;

        // Check for custom scale/style
        const hasCustomStyle = currentTextStyle.color !== textColor || currentTextStyle.background !== undefined;
        const hasCustomScale = currentScale.w !== 1 || currentScale.h !== 2;

        let charData: string | StyledCharacter = char;

        if (hasCustomStyle || hasCustomScale) {
            const styledChar: StyledCharacter = { char };

            if (hasCustomStyle) {
                styledChar.style = { color: currentTextStyle.color };
                if (currentTextStyle.background) styledChar.style.background = currentTextStyle.background;
            }

            if (hasCustomScale) {
                styledChar.scale = { ...currentScale };
            }

            charData = styledChar;
        }

        // Use activeWorldData/setActiveWorldData to write to correct data source
        const newData = { ...activeWorldData };
        newData[key] = charData;
        setActiveWorldData(newData);

        // Record character placement immediately for accurate playback (only in unbounded mode)
        if (canvasState === 0 && recorder.isRecording) {
            recorder.recordContentChange(key, charData);
        }
    }, [activeWorldData, setActiveWorldData, canvasState, currentScale, currentTextStyle, textColor, recorder, isWithinBounds]);

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
        const imageDataOrNote = worldData[imageKey];
        if (!imageDataOrNote) {
            logger.error('Invalid image key or data:', imageKey);
            return;
        }

        // Handle both old ImageData format and new note format
        let noteData: any;
        if (typeof imageDataOrNote === 'string') {
            // New note format
            try {
                noteData = JSON.parse(imageDataOrNote);
            } catch (e) {
                logger.error('Failed to parse note data:', e);
                return;
            }
        } else if (isImageData(imageDataOrNote)) {
            // Old ImageData format - convert to note format
            noteData = {
                startX: imageDataOrNote.startX,
                startY: imageDataOrNote.startY,
                endX: imageDataOrNote.endX,
                endY: imageDataOrNote.endY,
                timestamp: Date.now(),
                contentType: 'image',
                src: imageDataOrNote.src,
                originalWidth: imageDataOrNote.originalWidth,
                originalHeight: imageDataOrNote.originalHeight,
                ...(imageDataOrNote.isAnimated && {
                    isAnimated: imageDataOrNote.isAnimated,
                    frameTiming: imageDataOrNote.frameTiming,
                    totalDuration: imageDataOrNote.totalDuration,
                    animationStartTime: imageDataOrNote.animationStartTime
                })
            };
        } else {
            logger.error('Invalid image data format:', imageDataOrNote);
            return;
        }

        // Create new note data with updated coordinates
        // Note: note.data uses relative coordinates, so we only update bounds
        const newNoteData = {
            ...noteData,
            startX: noteData.startX + deltaX,
            startY: noteData.startY + deltaY,
            endX: noteData.endX + deltaX,
            endY: noteData.endY + deltaY,
            timestamp: Date.now()
        };

        // Create new note key based on new position
        const newNoteKey = `note_${newNoteData.startX}_${newNoteData.startY}_${Date.now()}`;

        // Update world data - remove old image/note and add new note
        setWorldData(prev => {
            const newData = { ...prev };
            delete newData[imageKey]; // Remove old image/note
            newData[newNoteKey] = JSON.stringify(newNoteData); // Add moved note
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

    const getSortedChips = useCallback((sortMode: NavSortMode, originPos: Point) => {
        const chips: Array<{text: string, x: number, y: number, color: string, creationIndex: number}> = [];
        let creationIndex = 0;

        // Collect chips with creation order (based on key order in worldData)
        for (const key in worldData) {
            if (key.startsWith('chip_')) {
                const coordsStr = key.substring('chip_'.length);
                const [xStr, yStr] = coordsStr.split(',');
                const x = parseInt(xStr, 10);
                const y = parseInt(yStr, 10);
                if (!isNaN(x) && !isNaN(y)) {
                    try {
                        // Skip image data - only process text/chip characters
                        if (isImageData(worldData[key])) {
                            continue;
                        }
                        const chipData = JSON.parse(getCharacter(worldData[key]));
                        const text = chipData.text || '';
                        const color = chipData.color || '#000000';
                        if (text.trim()) {
                            chips.push({ text, x, y, color, creationIndex: creationIndex++ });
                        }
                    } catch (e) {
                        // Skip invalid chip data
                    }
                }
            }
        }

        // Sort based on mode
        switch (sortMode) {
            case 'chronological':
                return chips.sort((a, b) => a.creationIndex - b.creationIndex);

            case 'closest':
                return chips.sort((a, b) => {
                    const distA = Math.sqrt(Math.pow(a.x - originPos.x, 2) + Math.pow(a.y - originPos.y, 2));
                    const distB = Math.sqrt(Math.pow(b.x - originPos.x, 2) + Math.pow(b.y - originPos.y, 2));
                    return distA - distB;
                });

            case 'farthest':
                return chips.sort((a, b) => {
                    const distA = Math.sqrt(Math.pow(a.x - originPos.x, 2) + Math.pow(a.y - originPos.y, 2));
                    const distB = Math.sqrt(Math.pow(b.x - originPos.x, 2) + Math.pow(b.y - originPos.y, 2));
                    return distB - distA; // Reverse order for farthest first
                });

            default:
                return chips;
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
        worldData: activeWorldData, // Returns boundedWorldData when canvasState === 1
        commandData,
        commandState,
        canvasState,
        setCanvasState,
        boundedWorldData,
        setBoundedWorldData,
        boundedSource,
        setBoundedSource,
        bounds: currentBounds,
        setBounds: setCurrentBounds,
        isWithinBounds,
        commandSystem: { selectCommand, executeCommandString, startCommand, startCommandWithInput, addCharacter },
        chatData,
        suggestionData,
        lightModeData,
        searchData,
        viewOffset,
        effectiveViewOffset,
        cursorPos,
        setCursorPos,
        visualCursorPos,
        zoomLevel,
        currentScale,
        setCurrentScale,
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
        screenToWorldPixel,
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
        setSelectionStart,
        selectionEnd,
        setSelectionEnd,
        processingRegion,
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
        getAllChips,
        getSortedChips,
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
        clearLightModeData: clearLightModeData,
        hostMode,
        setHostMode,
        hostData,
        setHostData,
        clipboardItems, // Clipboard items from Cmd+click on bounds
        addInstantAIResponse,
        setWorldData,
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
        setAgentEnabled,
        agentPos,
        setAgentPos,
        agentState,
        setAgentState,
        agentSelectionStart,
        agentSelectionEnd,
        agentController, // Expose agent controller for playback system
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
        isMoveMode,
        isPaintMode,
        paintColor,
        paintBrushSize,
        paintType,
        exitPaintMode,
        paintCell: (x: number, y: number, prevX?: number, prevY?: number) => {
            if (!isPaintMode) return;
            const cellX = Math.floor(x);
            const cellY = Math.floor(y);

            // Collect all cells to paint
            const cellsToPaint: Array<{x: number, y: number}> = [];

            // Bresenham's line algorithm for interpolation
            const collectLine = (x0: number, y0: number, x1: number, y1: number) => {
                const dx = Math.abs(x1 - x0);
                const dy = Math.abs(y1 - y0);
                const sx = x0 < x1 ? 1 : -1;
                const sy = y0 < y1 ? 1 : -1;
                let err = dx - dy;
                let cx = x0;
                let cy = y0;

                while (true) {
                    cellsToPaint.push({ x: cx, y: cy });
                    if (cx === x1 && cy === y1) break;
                    const e2 = 2 * err;
                    if (e2 > -dy) { err -= dy; cx += sx; }
                    if (e2 < dx) { err += dx; cy += sy; }
                }
            };

            // Collect cells based on brush size
            if (paintBrushSize <= 1) {
                if (prevX !== undefined && prevY !== undefined) {
                    collectLine(Math.floor(prevX), Math.floor(prevY), cellX, cellY);
                } else {
                    cellsToPaint.push({ x: cellX, y: cellY });
                }
            } else {
                // Circular brush
                const radius = paintBrushSize;
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        if (dx * dx + dy * dy < radius * radius) {
                            cellsToPaint.push({ x: cellX + dx, y: cellY + dy });
                        }
                    }
                }
            }

            if (cellsToPaint.length === 0) return;

            // Update world data with blob-based storage
            setWorldData(prev => {
                // Find or create blob for the first cell
                const { blob, isNew, existingBlobKey } = findOrCreateBlobForCell(prev, cellsToPaint[0].x, cellsToPaint[0].y, paintColor, paintType);

                // Add all cells to the blob
                const updatedBlob = addCellsToBlob(blob, cellsToPaint);
                const blobKey = `paintblob_${updatedBlob.id}`;

                return {
                    ...prev,
                    [blobKey]: JSON.stringify(updatedBlob)
                };
            });
        },
        eraseCell: (x: number, y: number, prevX?: number, prevY?: number) => {
            if (!isPaintMode) return;
            const cellX = Math.floor(x);
            const cellY = Math.floor(y);

            // Collect all cells to erase
            const cellsToErase: Array<{x: number, y: number}> = [];

            // Bresenham's line algorithm for interpolation
            const collectLine = (x0: number, y0: number, x1: number, y1: number) => {
                const dx = Math.abs(x1 - x0);
                const dy = Math.abs(y1 - y0);
                const sx = x0 < x1 ? 1 : -1;
                const sy = y0 < y1 ? 1 : -1;
                let err = dx - dy;
                let cx = x0;
                let cy = y0;

                while (true) {
                    cellsToErase.push({ x: cx, y: cy });
                    if (cx === x1 && cy === y1) break;
                    const e2 = 2 * err;
                    if (e2 > -dy) { err -= dy; cx += sx; }
                    if (e2 < dx) { err += dx; cy += sy; }
                }
            };

            // Collect cells based on brush size
            if (paintBrushSize <= 1) {
                if (prevX !== undefined && prevY !== undefined) {
                    collectLine(Math.floor(prevX), Math.floor(prevY), cellX, cellY);
                } else {
                    cellsToErase.push({ x: cellX, y: cellY });
                }
            } else {
                // Circular eraser matching brush size
                const radius = paintBrushSize;
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        if (dx * dx + dy * dy < radius * radius) {
                            cellsToErase.push({ x: cellX + dx, y: cellY + dy });
                        }
                    }
                }
            }

            if (cellsToErase.length === 0) return;

            // Remove cells from blobs
            setWorldData(prev => {
                const updates: Record<string, any> = {};
                const blobs = getAllPaintBlobs(prev);

                // Group cells to erase by which blob they belong to
                for (const blob of blobs) {
                    const cellsInThisBlob: Array<{x: number, y: number}> = [];

                    for (const cell of cellsToErase) {
                        const cellKey = `${cell.x},${cell.y}`;
                        if (blob.cells.includes(cellKey)) {
                            cellsInThisBlob.push(cell);
                        }
                    }

                    if (cellsInThisBlob.length > 0) {
                        const updatedBlob = removeCellsFromBlob(blob, cellsInThisBlob);
                        const blobKey = `paintblob_${blob.id}`;

                        if (updatedBlob === null) {
                            // Blob is now empty, delete it
                            updates[blobKey] = null;
                        } else {
                            // Update blob with remaining cells
                            updates[blobKey] = JSON.stringify(updatedBlob);
                        }
                    }
                }

                return { ...prev, ...updates };
            });
        },
                            fillPolygon: (points: Point[]) => {
                                if (!isPaintMode || points.length < 3) return;

                                // Find bounding box
                                let minX = Infinity, maxX = -Infinity;
                                let minY = Infinity, maxY = -Infinity;

                                for (const p of points) {
                                    minX = Math.min(minX, Math.floor(p.x));
                                    maxX = Math.max(maxX, Math.floor(p.x));
                                    minY = Math.min(minY, Math.floor(p.y));
                                    maxY = Math.max(maxY, Math.floor(p.y));
                                }

                                // Point-in-polygon test using ray casting
                                const isInside = (px: number, py: number): boolean => {
                                    let inside = false;
                                    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
                                        const xi = Math.floor(points[i].x);
                                        const yi = Math.floor(points[i].y);
                                        const xj = Math.floor(points[j].x);
                                        const yj = Math.floor(points[j].y);

                                        const intersect = ((yi > py) !== (yj > py)) &&
                                            (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
                                        if (intersect) inside = !inside;
                                    }
                                    return inside;
                                };

                                // Collect all cells inside the polygon
                                const cellsToPaint: Array<{x: number, y: number}> = [];
                                for (let y = minY; y <= maxY; y++) {
                                    for (let x = minX; x <= maxX; x++) {
                                        if (isInside(x, y)) {
                                            cellsToPaint.push({ x, y });
                                        }
                                    }
                                }

                                if (cellsToPaint.length === 0) return;

                                // Update world data with blob-based storage
                                setWorldData(prev => {
                                    const { blob } = findOrCreateBlobForCell(prev, cellsToPaint[0].x, cellsToPaint[0].y, paintColor, paintType);
                                    const updatedBlob = addCellsToBlob(blob, cellsToPaint);
                                    return {
                                        ...prev,
                                        [`paintblob_${updatedBlob.id}`]: JSON.stringify(updatedBlob)
                                    };
                                });
                            },
                                      setTiles: (tiles: Record<string, string>) => {
                                          setWorldData(prev => ({
                                              ...prev,
                                              ...tiles
                                          }));
                                      },
                                      getConnectedPaintRegion: (x: number, y: number) => {
                                          return findConnectedPaintRegion(worldData, x, y);
                                      },
                                      floodFill: (x: number, y: number) => {
            if (!isPaintMode) return;
            const startX = Math.floor(x);
            const startY = Math.floor(y);

            // Get the color at the start point using blob storage
            const targetColor = getPaintColorAt(worldData, startX, startY);

            // If clicking on same color as paint color, do nothing
            if (targetColor === paintColor) return;

            // Flood fill algorithm using BFS
            // If targetColor is null, fill empty regions (stop at any painted boundary)
            // If targetColor is a color, fill only cells of that color
            const fillEmpty = targetColor === null;
            const queue: Array<{x: number, y: number}> = [{ x: startX, y: startY }];
            const visited = new Set<string>();
            const cellsToFill: Array<{x: number, y: number}> = [];
            const maxCells = 10000; // Safety limit

            while (queue.length > 0 && cellsToFill.length < maxCells) {
                const pos = queue.shift()!;
                const key = `${pos.x},${pos.y}`;

                if (visited.has(key)) continue;
                visited.add(key);

                const cellColor = getPaintColorAt(worldData, pos.x, pos.y);

                // Fill logic depends on whether we're filling empty or colored cells
                if (fillEmpty) {
                    // Filling empty region - stop at any painted boundary
                    if (cellColor !== null) continue;
                } else {
                    // Filling colored region - only fill matching color
                    if (cellColor !== targetColor) continue;
                }

                // Add this cell to fill list
                cellsToFill.push({ x: pos.x, y: pos.y });

                // Add neighbors to queue
                queue.push({ x: pos.x + 1, y: pos.y });
                queue.push({ x: pos.x - 1, y: pos.y });
                queue.push({ x: pos.x, y: pos.y + 1 });
                queue.push({ x: pos.x, y: pos.y - 1 });
            }

            if (cellsToFill.length === 0) return;

            // Update world data with blob-based storage
            setWorldData(prev => {
                const { blob } = findOrCreateBlobForCell(prev, cellsToFill[0].x, cellsToFill[0].y, paintColor, paintType);
                const updatedBlob = addCellsToBlob(blob, cellsToFill);
                return {
                    ...prev,
                    [`paintblob_${updatedBlob.id}`]: JSON.stringify(updatedBlob)
                };
            });
        },
        // MCP direct paint methods - bypasses paint mode, allows custom colors per cell
        mcpPaintCells: (cells: Array<{ x: number; y: number; color: string }>) => {
            if (cells.length === 0) return;

            // Group cells by color for efficient blob storage
            const cellsByColor = new Map<string, Array<{ x: number; y: number }>>();
            for (const cell of cells) {
                const existing = cellsByColor.get(cell.color) || [];
                existing.push({ x: Math.floor(cell.x), y: Math.floor(cell.y) });
                cellsByColor.set(cell.color, existing);
            }

            setWorldData(prev => {
                let updated = { ...prev };

                for (const [color, colorCells] of cellsByColor) {
                    const { blob } = findOrCreateBlobForCell(updated, colorCells[0].x, colorCells[0].y, color, 'color');
                    const updatedBlob = addCellsToBlob(blob, colorCells);
                    updated[`paintblob_${updatedBlob.id}`] = JSON.stringify(updatedBlob);
                }

                return updated;
            });
        },
        mcpEraseCells: (cells: Array<{ x: number; y: number }>) => {
            if (cells.length === 0) return;

            setWorldData(prev => {
                let updated = { ...prev };

                for (const cell of cells) {
                    const cellX = Math.floor(cell.x);
                    const cellY = Math.floor(cell.y);

                    // Find blob containing this cell and remove it
                    const blob = findBlobAt(updated, cellX, cellY);
                    if (blob) {
                        const cellKey = `${cellX},${cellY}`;
                        // cells is a string[], filter it
                        const newCells = blob.cells.filter(c => c !== cellKey);

                        if (newCells.length > 0) {
                            // Recalculate bounds
                            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                            for (const key of newCells) {
                                const [x, y] = key.split(',').map(Number);
                                minX = Math.min(minX, x);
                                minY = Math.min(minY, y);
                                maxX = Math.max(maxX, x);
                                maxY = Math.max(maxY, y);
                            }
                            const updatedBlob = {
                                ...blob,
                                cells: newCells,
                                bounds: { minX, minY, maxX, maxY }
                            };
                            updated[`paintblob_${blob.id}`] = JSON.stringify(updatedBlob);
                        } else {
                            // Blob is empty, remove it
                            delete updated[`paintblob_${blob.id}`];
                        }
                    }
                }

                return updated;
            });
        },
        paintTool,
        lassoPoints: lassoPointsRef.current,
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
        setFaceOrientation,
        // Character sprite cursor
        isCharacterEnabled,
        characterSprite,
        isGeneratingSprite,
        spriteProgress,
        spriteDebugLog,
        // Chat bubble
        bubbleState,
        showBubbleMessage,
        hideBubbleMessage,
        // Spatial indexing
        spatialIndex: spatialIndexRef,
        queryVisibleEntities,
        recorder,
        // Note text wrapping
        rewrapNoteText: rewrapNoteTextInternal,
        // View overlay
        viewOverlay,
        exitViewOverlay,
        setViewOverlayScroll,
        // Agent mode
        isAgentMode,
        agentSpriteName,
        isAgentAttached,
        setAgentAttached,
        // Agent movement handlers (registered by BitCanvas)
        agentHandlers: agentHandlersRef.current,
        registerAgentHandlers: (handlers: WorldEngine['agentHandlers']) => {
            agentHandlersRef.current = handlers;
        },
    };
}