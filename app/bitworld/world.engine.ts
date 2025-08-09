// hooks/useWorldEngine.ts
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useWorldSave } from './world.save'; // Import the new hook
import { useCommandSystem, CommandState, CommandExecution } from './commands'; // Import command system
import { useDeepspawnSystem } from './deepspawn'; // Import deepspawn system
import { set } from 'firebase/database';

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
export interface WorldData { [key: string]: string; }
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
    viewOffset: Point;
    cursorPos: Point;
    zoomLevel: number;
    panningDirection: number | null;
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
    isDebugVisible: boolean;
    isDeepspawnVisible: boolean;
    dialogueText: string;
    setDialogueText: (text: string) => void;
}

// --- Hook Input ---
interface UseWorldEngineProps {
    initialWorldData?: WorldData; // Optional initial data (might be overridden by Firebase)
    initialCursorPos?: Point;
    initialViewOffset?: Point;
    initialZoomLevel?: number;
    worldId: string | null; // Add worldId for persistence
}

// --- The Hook ---
export function useWorldEngine({
    initialWorldData = {},
    initialCursorPos = { x: 0, y: 0 },
    initialViewOffset = { x: 0, y: 0 },
    initialZoomLevel = 1, // Default zoom level index
    worldId = null,      // Default to no persistence
}: UseWorldEngineProps): WorldEngine {
    // === State ===
    const [worldData, setWorldData] = useState<WorldData>(initialWorldData);
    const [cursorPos, setCursorPos] = useState<Point>(initialCursorPos);
    const [viewOffset, setViewOffset] = useState<Point>(initialViewOffset);
    const [zoomLevel, setZoomLevel] = useState<number>(initialZoomLevel); // Store zoom *level*, not index
    const [isDebugVisible, setIsDebugVisible] = useState(true);
    const [isDeepspawnVisible, setIsDeepspawnVisible] = useState(true);
    const [dialogueText, setDialogueText] = useState('Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.');
    
    // === Command System ===
    const { commandState, commandData, handleKeyDown: handleCommandKeyDown } = useCommandSystem();
    
    // === Deepspawn System ===
    const { 
        deepspawnData, 
        directionPoints, 
        updateDirectionPoint, 
        getPanningDirection, 
        getAngleDebugData 
    } = useDeepspawnSystem();
    
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
    } = useWorldSave(worldId, worldData, setWorldData); // Pass state and setter

    // === Refs === (Keep refs for things not directly tied to re-renders or persistence)
    const charSizeCacheRef = useRef<{ [key: number]: { width: number; height: number; fontSize: number } }>({});

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

    // Define deleteSelectedCharacters BEFORE cutSelection and pasteText
    const deleteSelectedCharacters = useCallback(() => {
        const selection = getNormalizedSelection();
        if (!selection) return false; // No selection to delete

        let newWorldData = { ...worldData };
        let deleted = false;
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
                line += worldData[key] || ' '; // Use space for empty cells
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

        // === Command Handling ===
        const commandResult = handleCommandKeyDown(key, cursorPos, setCursorPos);
        if (commandResult && typeof commandResult === 'object') {
            // It's a command execution object
            const exec = commandResult as CommandExecution;
            if (exec.command === 'debug') {
                if (exec.args[0] === 'on') {
                    setIsDebugVisible(true);
                } else if (exec.args[0] === 'off') {
                    setIsDebugVisible(false);
                }
            } else if (exec.command === 'deepspawn') {
                if (exec.args[0] === 'on') {
                    setIsDeepspawnVisible(true);
                } else if (exec.args[0] === 'off') {
                    setIsDeepspawnVisible(false);
                }
            } else if (exec.command === 'summarize') {
                setDialogueText("Here is a summary of what you've written so far.");
            }
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
        // --- Movement ---
        else if (key === 'Enter') {
            // Find the starting x position of the current line
            const currentY = cursorPos.y;
            let lineStartX = 0;
            let foundLineStart = false;
            
            // First, find the leftmost character in the current line
            for (const k in worldData) {
                const [xStr, yStr] = k.split(',');
                const y = parseInt(yStr, 10);
                if (y === currentY) {
                    const x = parseInt(xStr, 10);
                    if (!foundLineStart || x < lineStartX) {
                        lineStartX = x;
                        foundLineStart = true;
                    }
                }
            }
            
            nextCursorPos.y = cursorPos.y + 1;
            // Use the same indentation as the current line
            nextCursorPos.x = lineStartX;
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
                    const char = worldData[key];
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
                        const char = worldData[key];
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
                const startChar = worldData[startKey];
                let inWord = !!startChar && startChar !== ' ' && startChar !== '\t';
                
                // Find the end of current word or beginning of next word
                while (x <= rightmostX) {
                    const key = `${x},${currentLine}`;
                    const char = worldData[key];
                    
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
                    const char = worldData[key];
                    
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
            }
            else {
                // Regular Backspace: Delete one character to the left
                const deleteKey = `${cursorPos.x - 1},${cursorPos.y}`;
                if (worldData[deleteKey]) {
                    nextWorldData = { ...worldData }; // Create copy before modifying
                    delete nextWorldData[deleteKey]; // Remove char from world
                    worldDataChanged = true;
                }
                nextCursorPos.x -= 1; // Move cursor left regardless
            }
            moved = true; // Cursor position changed or selection was deleted
        } else if (key === 'Delete') {
            if (currentSelectionActive) {
                 if (deleteSelectedCharacters()) {
                    // State updates happen inside deleteSelectedCharacters
                    nextCursorPos = { x: selectionStart?.x ?? cursorPos.x, y: selectionStart?.y ?? cursorPos.y };
                 }
            }
            else {
                // Delete char at current cursor pos, cursor doesn't move
                const deleteKey = `${cursorPos.x},${cursorPos.y}`;
                if (worldData[deleteKey]) {
                    nextWorldData = { ...worldData }; // Create copy before modifying
                    delete nextWorldData[deleteKey];
                    worldDataChanged = true;
                }
                // Cursor doesn't move, so moved = false unless selection was active
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

            // Now type the character
            nextWorldData = { ...dataToDeleteFrom }; // Start with data after potential deletion
            const currentKey = `${cursorAfterDelete.x},${cursorAfterDelete.y}`;
            nextWorldData[currentKey] = key;
            nextCursorPos = { x: cursorAfterDelete.x + 1, y: cursorAfterDelete.y }; // Move cursor right
            moved = true;
            worldDataChanged = true; // Mark that synchronous data change occurred
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
        cursorPos, worldData, selectionStart, selectionEnd, commandState, // State dependencies
        getNormalizedSelection, deleteSelectedCharacters, copySelectedCharacters, cutSelection, pasteText, // Callback dependencies
        handleCommandKeyDown
        // Include setters used directly in the handler (if any, preferably avoid)
        // setCursorPos, setWorldData, setSelectionStart, setSelectionEnd // Setters are stable, no need to list
    ]);

    const handleCanvasClick = useCallback((canvasRelativeX: number, canvasRelativeY: number, clearSelection: boolean = false, shiftKey: boolean = false): void => {
        const newCursorPos = screenToWorld(canvasRelativeX, canvasRelativeY, zoomLevel, viewOffset);

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
    }, [zoomLevel, viewOffset, screenToWorld, selectionStart, selectionEnd]);

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
            updateDirectionPoint(centerX, centerY);
        }
        
        return newOffset;
    }, [zoomLevel, getEffectiveCharDims, viewOffset]);

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
                    updateDirectionPoint(centerX, centerY);
                }
            }
        }
    }, [zoomLevel, getEffectiveCharDims, updateDirectionPoint]);

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

    const isBlock = useCallback((x: number, y: number): boolean => {
        const key = `${BLOCK_PREFIX}${x},${y}`;
        return !!worldData[key];
    }, [worldData]);

    // Continuously track viewport center for direction calculation
    useEffect(() => {
        const interval = setInterval(() => {
            if (typeof window !== 'undefined') {
                const center = getViewportCenter();
                updateDirectionPoint(center.x, center.y);
            }
        }, 100); // Update every 100ms

        return () => clearInterval(interval);
    }, [getViewportCenter, updateDirectionPoint]);


    return {
        worldData,
        deepspawnData,
        commandData,
        commandState,
        viewOffset,
        cursorPos,
        zoomLevel,
        panningDirection,
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
        isBlock,
        directionPoints,
        getAngleDebugData,
        isDebugVisible,
        isDeepspawnVisible,
        dialogueText,
        setDialogueText,
    };
}