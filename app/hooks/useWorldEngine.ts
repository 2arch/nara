// hooks/useWorldEngine.ts
import { useState, useEffect, useRef, useCallback } from 'react';

// --- Constants --- (Copied and relevant ones kept)
const BASE_FONT_SIZE = 16;
const LINE_HEIGHT_MULTIPLIER = 1.2;
const BASE_CHAR_WIDTH = BASE_FONT_SIZE * 0.6;
const BASE_CHAR_HEIGHT = BASE_FONT_SIZE * LINE_HEIGHT_MULTIPLIER;
const LOCAL_STORAGE_KEY = 'j72n';
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5.0;
const ZOOM_SENSITIVITY = 0.002;

// --- Interfaces ---
export interface WorldData { [key: string]: string; }
export interface Point { x: number; y: number; }

export interface PanStartInfo {
    startX: number;
    startY: number;
    startViewOffsetX: number;
    startViewOffsetY: number;
}

export interface WorldEngine {
    worldData: WorldData;
    viewOffset: Point;
    cursorPos: Point;
    zoomLevel: number;
    getEffectiveCharDims: (zoom: number) => { width: number; height: number; fontSize: number; };
    screenToWorld: (screenX: number, screenY: number, currentZoom: number, currentOffset: Point) => Point;
    worldToScreen: (worldX: number, worldY: number, currentZoom: number, currentOffset: Point) => Point;
    handleCanvasClick: (canvasRelativeX: number, canvasRelativeY: number, clearSelection?: boolean, shiftKey?: boolean) => void;
    handleCanvasWheel: (deltaX: number, deltaY: number, canvasRelativeX: number, canvasRelativeY: number, ctrlOrMetaKey: boolean) => void;
    handlePanStart: (clientX: number, clientY: number) => PanStartInfo | null;
    handlePanMove: (clientX: number, clientY: number, panStartInfo: PanStartInfo) => Point;
    handlePanEnd: (newOffset: Point) => void;
    handleKeyDown: (key: string, ctrlKey: boolean, metaKey: boolean) => boolean; // Returns true if state changed
    setViewOffset: React.Dispatch<React.SetStateAction<Point>>; // Expose for direct setting if needed
    selectionStart: Point | null;
    selectionEnd: Point | null;
    isSelecting: boolean;
    handleSelectionStart: (canvasRelativeX: number, canvasRelativeY: number) => void;
    handleSelectionMove: (canvasRelativeX: number, canvasRelativeY: number) => void;
    handleSelectionEnd: () => void;
    deleteCharacter: (x: number, y: number) => void;
    placeCharacter: (char: string, x: number, y: number) => void;
    deleteSelection: () => boolean;
    copySelection: () => boolean;
    cutSelection: () => boolean;
    paste: () => boolean;
}

export function useWorldEngine(): WorldEngine {
    // --- State ---
    const [worldData, setWorldData] = useState<WorldData>({});
    const [viewOffset, setViewOffset] = useState<Point>({ x: 0, y: 0 });
    const [cursorPos, setCursorPos] = useState<Point>({ x: 0, y: 0 });
    const [zoomLevel, setZoomLevel] = useState(1);
    const isPanningRef = useRef(false);
    const [selectionStart, setSelectionStart] = useState<Point | null>(null);
    const [selectionEnd, setSelectionEnd] = useState<Point | null>(null);
    const [isSelecting, setIsSelecting] = useState(false);
    const clipboardRef = useRef<{ text: string, width: number, height: number } | null>(null);

    // --- Utility Functions ---
    const getEffectiveCharDims = useCallback((zoom: number) => ({
        width: BASE_CHAR_WIDTH * zoom,
        height: BASE_CHAR_HEIGHT * zoom,
        fontSize: BASE_FONT_SIZE * zoom,
    }), []);

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

    // --- New Selection Helpers ---
    const getNormalizedSelection = useCallback(() => {
        if (!selectionStart || !selectionEnd) return null;
        const startX = Math.min(selectionStart.x, selectionEnd.x);
        const startY = Math.min(selectionStart.y, selectionEnd.y);
        const endX = Math.max(selectionStart.x, selectionEnd.x);
        const endY = Math.max(selectionStart.y, selectionEnd.y);
        return { startX, startY, endX, endY };
    }, [selectionStart, selectionEnd]);

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
            setIsSelecting(false); // Ensure this is false
        }
        return deleted;
    }, [worldData, getNormalizedSelection]);

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
            clipboardRef.current = { text: copiedText, width: selectionWidth, height: selectionHeight };
            // Use system clipboard as well
            navigator.clipboard.writeText(copiedText).catch(err => console.warn('Could not copy to system clipboard:', err));
            return true;
        }
        return false;
    }, [worldData, getNormalizedSelection]);

    const pasteText = useCallback(() => {
        // Try reading from system clipboard first
        navigator.clipboard.readText()
            .then(clipText => {
                if (clipText) {
                    // Simulate clipboard structure if only text is available
                    const lines = clipText.split('\n');
                    const height = lines.length;
                    const width = Math.max(...lines.map(line => line.length));
                    clipboardRef.current = { text: clipText, width, height };
                }
                // Proceed with pasting from clipboardRef (either system or internal)
                if (!clipboardRef.current) return false;

                // Delete current selection before pasting
                const selectionDeleted = deleteSelectedCharacters();

                // Use cursor position *after* potential deletion
                const pasteStartX = cursorPos.x;
                const pasteStartY = cursorPos.y;
                const { text } = clipboardRef.current;

                let newWorldData = { ...worldData };
                const linesToPaste = text.split('\n');
                let currentY = pasteStartY;
                let finalCursorX = pasteStartX;
                let finalCursorY = pasteStartY;

                for (let i = 0; i < linesToPaste.length; i++) {
                    const line = linesToPaste[i];
                    let currentX = pasteStartX;
                    for (let j = 0; j < line.length; j++) {
                        const char = line[j];
                        // Allow pasting spaces if they came from clipboard
                        const key = `${currentX},${currentY}`;
                        newWorldData[key] = char;
                        currentX++;
                    }
                    // If it's the last line, cursor X is end of line
                    if (i === linesToPaste.length - 1) {
                        finalCursorX = currentX;
                        finalCursorY = currentY;
                    }
                    currentY++; // Move to next line for pasting
                }

                setWorldData(newWorldData);
                // Place cursor at the end of the pasted content
                setCursorPos({ x: finalCursorX, y: finalCursorY });

                // Clear selection state if it wasn't already cleared by deleteSelectedCharacters
                if (!selectionDeleted) {
                    setSelectionStart(null);
                    setSelectionEnd(null);
                    setIsSelecting(false);
                }
                return true;

            })
            .catch(err => {
                console.warn('Could not read from system clipboard:', err);
                // Fallback to internal clipboard if system access fails or is denied
                if (!clipboardRef.current) return false;

                const selectionDeleted = deleteSelectedCharacters();
                const pasteStartX = cursorPos.x;
                const pasteStartY = cursorPos.y;
                const { text } = clipboardRef.current;
                let newWorldData = { ...worldData };
                const linesToPaste = text.split('\n');
                let currentY = pasteStartY;
                let finalCursorX = pasteStartX;
                let finalCursorY = pasteStartY;

                for (let i = 0; i < linesToPaste.length; i++) {
                    const line = linesToPaste[i];
                    let currentX = pasteStartX;
                    for (let j = 0; j < line.length; j++) {
                        const char = line[j];
                        const key = `${currentX},${currentY}`;
                        newWorldData[key] = char;
                        currentX++;
                    }
                    if (i === linesToPaste.length - 1) {
                        finalCursorX = currentX;
                        finalCursorY = currentY;
                    }
                    currentY++;
                }
                setWorldData(newWorldData);
                setCursorPos({ x: finalCursorX, y: finalCursorY });
                if (!selectionDeleted) {
                    setSelectionStart(null);
                    setSelectionEnd(null);
                    setIsSelecting(false);
                }
                return true;
            });

        return true; // Indicate paste was attempted (async)

    }, [worldData, cursorPos, deleteSelectedCharacters]); // Added deleteSelectedCharacters dependency

    // --- Data Persistence ---
    const saveData = useCallback((data: WorldData) => {
        try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
        } catch (error) { console.error("Error saving data:", error); }
    }, []);

    // Load data on mount
    useEffect(() => {
        try {
            const savedData = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (savedData) setWorldData(JSON.parse(savedData));
        } catch (error) { console.error("Error loading data:", error); setWorldData({}); }
    }, []);

    // Save data on change
    useEffect(() => {
        if (Object.keys(worldData).length > 0) { // Avoid saving initial empty state unnecessarily
            saveData(worldData);
        }
    }, [worldData, saveData]);

    // --- Action Handlers ---

    const handleCanvasClick = useCallback((canvasRelativeX: number, canvasRelativeY: number, clearSelection: boolean = true, shiftKey: boolean = false): void => {
        // Only clear selection if explicitly requested
        if (clearSelection) {
            setSelectionStart(null);
            setSelectionEnd(null);
            setIsSelecting(false);
        }

        const newCursorPos = screenToWorld(canvasRelativeX, canvasRelativeY, zoomLevel, viewOffset);
        
        // Log the character if one exists at the clicked position
        const key = `${newCursorPos.x},${newCursorPos.y}`;
        if (worldData[key]) {
            if (shiftKey) {
                console.log(`Shift click character "${worldData[key]}" at position (${newCursorPos.x}, ${newCursorPos.y})`);
            } else {
                console.log(`Clicked on character: "${worldData[key]}" at position (${newCursorPos.x}, ${newCursorPos.y})`);
            }
        }
        
        setCursorPos(newCursorPos);

    }, [zoomLevel, viewOffset, screenToWorld, worldData]);

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
            startViewOffsetX: viewOffset.x,
            startViewOffsetY: viewOffset.y,
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

        // Return the calculated offset, don't set state here
        return {
            x: panStartInfo.startViewOffsetX - deltaWorldX,
            y: panStartInfo.startViewOffsetY - deltaWorldY,
        };
    }, [zoomLevel, getEffectiveCharDims, viewOffset]); // Include viewOffset just in case

    const handlePanEnd = useCallback((newOffset: Point): void => {
        if (isPanningRef.current) {
            isPanningRef.current = false;
            setViewOffset(newOffset); // Set final state
        }
    }, []);

    const handleKeyDown = useCallback((key: string, ctrlKey: boolean, metaKey: boolean): boolean => {
        const isCtrl = ctrlKey || metaKey;
        const hasSelection = selectionStart !== null && selectionEnd !== null;
        let stateChanged = false;
        let preventDefault = false; // Flag to indicate if default browser action should be prevented

        // --- Selection-based Actions ---
        if (hasSelection) {
            if (isCtrl && key.toLowerCase() === 'c') {
                copySelectedCharacters();
                // Keep selection after copy, don't mark stateChanged as we didn't change world/cursor
                preventDefault = true; // Prevent browser default copy
            } else if (isCtrl && key.toLowerCase() === 'x') {
                if (copySelectedCharacters()) { // Only delete if copy succeeded
                   deleteSelectedCharacters(); // This clears selection, moves cursor, sets worldData
                   stateChanged = true;
                }
                preventDefault = true; // Prevent browser default cut
            } else if (key === 'Backspace' || key === 'Delete') {
                deleteSelectedCharacters(); // This clears selection, moves cursor, sets worldData
                stateChanged = true;
                preventDefault = true; // Prevent browser default delete/backspace
            } else if (key.length === 1 && !isCtrl && !metaKey) { // Typing a character over a selection
                deleteSelectedCharacters(); // Delete selection first (moves cursor, clears selection)
                // Now, let the normal character insertion logic handle it below, using the updated cursor pos
                stateChanged = true; // Mark that state *will* change
                // Fall through to the non-selection character handling
                preventDefault = true; // Prevent default char input since we handle it
            }

            // If a selection action that modified state occurred (cut, delete, type-over),
            // we don't need further processing for this key event.
            if (stateChanged) {
                // The actual state update (setWorldData, setCursorPos) happens within deleteSelectedCharacters or later
                return preventDefault; // Return true to prevent default browser behavior
            }
            // If only copy occurred, allow other actions like cursor movement, but still prevent default copy
            if (preventDefault) {
                 return preventDefault;
            }
        }

        // --- Non-Selection / Post-Selection Actions ---

        // Paste (works with or without prior selection)
        if (isCtrl && key.toLowerCase() === 'v') {
            pasteText(); // pasteText handles deleting selection internally if needed
            // pasteText is async due to clipboard API, but we assume it will change state
            stateChanged = true;
            preventDefault = true; // Prevent browser default paste
            return preventDefault; // Paste is a terminating action for this key press
        }

        // Allow native browser behavior for certain Ctrl combinations (like reload, find, etc.)
        if (isCtrl && ['a', 'z', 'y', 'r', 'f', 'p'].includes(key.toLowerCase())) {
             return false; // Allow native browser behavior, don't prevent default
        }
        // If we handled Ctrl+C/X/V above, preventDefault is already true.

        // --- Original Cursor Movement and Character Input/Deletion (No Selection OR fell through from type-over) ---
        let newCursorPos = { ...cursorPos }; // Start with current cursor pos
        let newWorldData = { ...worldData };
        let needsSave = false;
        const currentDataKey = `${cursorPos.x},${cursorPos.y}`;

        // If stateChanged is true here, it means we deleted a selection before typing a character.
        // The cursor position was already updated by deleteSelectedCharacters. Use that position.
        const effectiveCursorPos = stateChanged ? cursorPos : newCursorPos;

        if (key.length === 1 && !isCtrl && !metaKey) {
            const placeKey = `${effectiveCursorPos.x},${effectiveCursorPos.y}`;
            newWorldData[placeKey] = key;
            newCursorPos = { x: effectiveCursorPos.x + 1, y: effectiveCursorPos.y }; // Move cursor *after* placing char
            needsSave = true;
            stateChanged = true; // Mark state as changed
            preventDefault = true;
        } else if (key === 'Backspace') {
            // This block only runs if there was NO selection initially
            if (effectiveCursorPos.x > 0 || effectiveCursorPos.y > 0) { // Allow backspace to (0,0)
                newCursorPos.x = effectiveCursorPos.x - 1;
                newCursorPos.y = effectiveCursorPos.y; // Stay on the same line
                // If backspace moves to negative X, wrap to end of previous line (complex, skip for now)
                if (newCursorPos.x < 0) {
                   // TODO: Implement line wrap logic if desired
                   // For now, just stop at 0
                   newCursorPos.x = 0;
                }

                const keyToDelete = `${newCursorPos.x},${newCursorPos.y}`;
                if (newWorldData[keyToDelete]) {
                    delete newWorldData[keyToDelete];
                    needsSave = true;
                }
                stateChanged = true;
            } else if (effectiveCursorPos.x === 0 && effectiveCursorPos.y === 0) {
                 // If at (0,0), check if char exists there to delete
                 const keyToDelete = `0,0`;
                 if (newWorldData[keyToDelete]) {
                    delete newWorldData[keyToDelete];
                    needsSave = true;
                 }
                 // Cursor stays at (0,0)
                 stateChanged = true;
            }
            preventDefault = true;
        } else if (key === 'Delete') {
            // This block only runs if there was NO selection initially
            const keyToDelete = `${effectiveCursorPos.x},${effectiveCursorPos.y}`;
            if (newWorldData[keyToDelete]) {
                delete newWorldData[keyToDelete];
                needsSave = true;
            }
            // Cursor doesn't move on delete
            newCursorPos = effectiveCursorPos; // Ensure cursor pos is correctly set if stateChanged was false initially
            stateChanged = true;
            preventDefault = true;
        } else if (key === 'Enter') {
            // Find the starting x position of the current line
            const currentY = effectiveCursorPos.y;
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
            
            newCursorPos.y = effectiveCursorPos.y + 1;
            // Use the same indentation as the current line
            newCursorPos.x = lineStartX;
            stateChanged = true;
            preventDefault = true;
        } else if (key === 'ArrowUp') { newCursorPos.y = Math.max(0, effectiveCursorPos.y - 1); newCursorPos.x = effectiveCursorPos.x; stateChanged = true; preventDefault = true; }
        else if (key === 'ArrowDown') { newCursorPos.y = effectiveCursorPos.y + 1; newCursorPos.x = effectiveCursorPos.x; stateChanged = true; preventDefault = true; }
        else if (key === 'ArrowLeft') {
             newCursorPos.y = effectiveCursorPos.y;
             newCursorPos.x = Math.max(0, effectiveCursorPos.x - 1);
             // TODO: Add wrap to previous line end?
             stateChanged = true;
             preventDefault = true;
        } else if (key === 'ArrowRight') {
            newCursorPos.y = effectiveCursorPos.y;
            newCursorPos.x = effectiveCursorPos.x + 1;
            // TODO: Add wrap to next line start?
            stateChanged = true;
            preventDefault = true;
        }
        else if (key === 'Home') { newCursorPos.x = 0; newCursorPos.y = effectiveCursorPos.y; stateChanged = true; preventDefault = true; }
        else if (key === 'End') {
            let maxX = 0;
            const currentY = effectiveCursorPos.y;
            let lineHasChars = false;
            for (const k in newWorldData) {
                const [xStr, yStr] = k.split(',');
                const y = parseInt(yStr, 10);
                if (y === currentY) {
                    const x = parseInt(xStr, 10);
                    maxX = Math.max(maxX, x);
                    lineHasChars = true;
                }
            }
            newCursorPos.x = lineHasChars ? maxX + 1 : 0;
            newCursorPos.y = currentY;
            stateChanged = true;
            preventDefault = true;
        }
        // else: Unhandled key, stateChanged remains false, preventDefault remains false

        // --- Update State ---
        if (stateChanged) {
            setCursorPos(newCursorPos);
            if (needsSave) {
                setWorldData(newWorldData); // This will trigger the save effect
            }
        }

        // Clear selection if cursor moved via arrows/home/end etc. and there *was* a selection
        // (This check is outside the main hasSelection block because arrows should clear selection)
        if (hasSelection && !isCtrl && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) {
            setSelectionStart(null);
            setSelectionEnd(null);
            setIsSelecting(false);
            // stateChanged should already be true from the movement itself
        }

        return preventDefault; // Return whether to prevent default browser behavior

    }, [cursorPos, worldData, selectionStart, selectionEnd, getNormalizedSelection, copySelectedCharacters, deleteSelectedCharacters, pasteText]); // Added dependencies

    const handleSelectionStart = useCallback((canvasRelativeX: number, canvasRelativeY: number): void => {
        const worldPos = screenToWorld(canvasRelativeX, canvasRelativeY, zoomLevel, viewOffset);
        setSelectionStart(worldPos);
        setSelectionEnd(worldPos);
        setIsSelecting(true); // Mark that selection process is active
        setCursorPos(worldPos); // Move cursor to selection start
    }, [zoomLevel, viewOffset, screenToWorld]);

    const handleSelectionMove = useCallback((canvasRelativeX: number, canvasRelativeY: number): void => {
        if (isSelecting) { // Use state variable
            const worldPos = screenToWorld(canvasRelativeX, canvasRelativeY, zoomLevel, viewOffset);
            setSelectionEnd(worldPos);
        }
    }, [isSelecting, zoomLevel, viewOffset, screenToWorld]);

    const handleSelectionEnd = useCallback((): void => {
        setIsSelecting(false); // Mark selection process as ended
        // If selection start and end are the same, it was effectively a click, clear selection
        if (selectionStart && selectionEnd && selectionStart.x === selectionEnd.x && selectionStart.y === selectionEnd.y) {
            setSelectionStart(null);
            setSelectionEnd(null);
        }
        // Otherwise, keep the selection range stored in selectionStart/End
    }, [selectionStart, selectionEnd]); // Add dependencies

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

    // --- New combined Cut function ---
    const cutSelection = useCallback(() => {
        if (copySelectedCharacters()) {
            return deleteSelectedCharacters();
        }
        return false;
    }, [copySelectedCharacters, deleteSelectedCharacters]);

    return {
        worldData,
        viewOffset,
        cursorPos,
        zoomLevel,
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
        isSelecting, // Expose isSelecting state
        handleSelectionStart,
        handleSelectionMove,
        handleSelectionEnd,
        deleteCharacter,
        placeCharacter,
        deleteSelection: deleteSelectedCharacters,
        copySelection: copySelectedCharacters,
        cutSelection: cutSelection,
        paste: pasteText,
    };
}