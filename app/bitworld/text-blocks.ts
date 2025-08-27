// Text block detection utilities for bitworld canvas
// Uses the "2+ space gap rule" for intelligent text analysis

import type { WorldData, StyledCharacter } from './world.engine';

// Utility functions to handle both string and StyledCharacter
function getCharacter(data: string | StyledCharacter): string {
    if (typeof data === 'string') {
        return data;
    }
    return data.char;
}

export interface TextBlock {
    start: number;
    end: number;
    characters: Array<{x: number, char: string}>;
}

export interface LineCharacter {
    x: number;
    char: string;
}

/**
 * Detects text blocks on a line using the 2+ space gap rule
 * @param lineChars Array of characters with x positions, sorted by x
 * @param gapThreshold Minimum gap size to create new block (default: 2)
 * @returns Array of text blocks
 */
export function detectTextBlocks(lineChars: LineCharacter[], gapThreshold: number = 2): TextBlock[] {
    if (lineChars.length === 0) return [];
    
    const blocks: TextBlock[] = [];
    let currentBlockStart = lineChars[0].x;
    let currentBlockEnd = lineChars[0].x;
    let currentBlockChars = [lineChars[0]];
    
    for (let i = 1; i < lineChars.length; i++) {
        const gap = lineChars[i].x - lineChars[i-1].x - 1; // Gap between characters
        
        if (gap >= gapThreshold) {
            // 2+ space gap = new block boundary
            blocks.push({
                start: currentBlockStart,
                end: currentBlockEnd,
                characters: [...currentBlockChars]
            });
            
            // Start new block
            currentBlockStart = lineChars[i].x;
            currentBlockEnd = lineChars[i].x;
            currentBlockChars = [lineChars[i]];
        } else {
            // < 2 spaces = extend current block
            currentBlockEnd = lineChars[i].x;
            currentBlockChars.push(lineChars[i]);
        }
    }
    
    // Add final block
    blocks.push({
        start: currentBlockStart,
        end: currentBlockEnd,
        characters: [...currentBlockChars]
    });
    
    return blocks;
}

/**
 * Finds the closest text block to a cursor position
 * @param blocks Array of text blocks
 * @param cursorX Cursor x position
 * @returns Closest text block and distance to it
 */
export function findClosestBlock(blocks: TextBlock[], cursorX: number): {block: TextBlock, distance: number} | null {
    if (blocks.length === 0) return null;
    
    let closestBlock = blocks[0];
    let minDistance = calculateDistanceToBlock(blocks[0], cursorX);
    
    for (const block of blocks) {
        const distance = calculateDistanceToBlock(block, cursorX);
        if (distance < minDistance) {
            minDistance = distance;
            closestBlock = block;
        }
    }
    
    return {block: closestBlock, distance: minDistance};
}

/**
 * Calculates distance from cursor to a text block
 * @param block Text block
 * @param cursorX Cursor x position
 * @returns Distance (0 if cursor is within block)
 */
export function calculateDistanceToBlock(block: TextBlock, cursorX: number): number {
    if (cursorX < block.start) {
        return block.start - cursorX;
    } else if (cursorX > block.end) {
        return cursorX - block.end;
    } else {
        return 0; // Cursor is within this block
    }
}

/**
 * Extracts line characters from world data for a specific line
 * @param worldData Combined world data (persistent + ephemeral)
 * @param lineY Y coordinate of the line
 * @param includeSpaces Whether to include space characters (default: false)
 * @returns Sorted array of characters on the line
 */
export function extractLineCharacters(
    worldData: WorldData, 
    lineY: number, 
    includeSpaces: boolean = false
): LineCharacter[] {
    const lineChars: LineCharacter[] = [];
    
    for (const key in worldData) {
        const [xStr, yStr] = key.split(',');
        const y = parseInt(yStr, 10);
        if (y === lineY) {
            const x = parseInt(xStr, 10);
            const charData = worldData[key];
            const char = getCharacter(charData);
            
            // Include character if it's non-empty or we want spaces
            if (char && (includeSpaces || char.trim() !== '')) {
                lineChars.push({x, char});
            }
        }
    }
    
    // Sort by x position
    return lineChars.sort((a, b) => a.x - b.x);
}

/**
 * Gets smart indentation for Enter key based on closest block
 * @param worldData Combined world data
 * @param cursorPos Current cursor position
 * @returns X position for new line indentation
 */
export function getSmartIndentation(worldData: WorldData, cursorPos: {x: number, y: number}): number {
    const lineChars = extractLineCharacters(worldData, cursorPos.y);
    
    if (lineChars.length === 0) {
        return 0; // No text on line, use default indentation
    }
    
    const blocks = detectTextBlocks(lineChars);
    const closest = findClosestBlock(blocks, cursorPos.x);
    
    return closest ? closest.block.start : 0;
}

/**
 * Finds the block that contains or is closest to the left of cursor (for deletion operations)
 * @param blocks Array of text blocks
 * @param cursorX Cursor x position  
 * @returns Block for deletion or null if none found
 */
export function findBlockForDeletion(blocks: TextBlock[], cursorX: number): TextBlock | null {
    if (blocks.length === 0) return null;
    
    // Find block that cursor is within or immediately to the right of
    let targetBlock: TextBlock | null = null;
    
    for (const block of blocks) {
        if (cursorX >= block.start && cursorX <= block.end + 1) {
            // Cursor is within this block or immediately after it
            targetBlock = block;
        } else if (block.end < cursorX) {
            // Block is to the left of cursor - potential target
            if (!targetBlock || block.end > targetBlock.end) {
                targetBlock = block; // Use rightmost block to the left
            }
        }
    }
    
    return targetBlock;
}

/**
 * Performs word deletion using character type boundary detection
 * @param worldData Combined world data
 * @param cursorPos Current cursor position
 * @returns Object with deletion range and updated cursor position
 */
export function calculateWordDeletion(worldData: WorldData, cursorPos: {x: number, y: number}): {
    deleteFromX: number,
    deleteToX: number,
    newCursorX: number
} | null {
    if (cursorPos.x <= 0) return null; // Nothing to delete
    
    const lineY = cursorPos.y;
    let x = cursorPos.x - 1; // Start from character to the left of cursor
    
    // Find the character type at starting position
    const startKey = `${x},${lineY}`;
    const startCharData = worldData[startKey];
    
    if (!startCharData) {
        // No character at starting position - delete single position
        return {
            deleteFromX: x,
            deleteToX: x,
            newCursorX: cursorPos.x - 1
        };
    }
    
    const startChar = getCharacter(startCharData);
    const isStartSpace = startChar.trim() === '';
    let deletedAny = false;
    let rightmostDeleted = x;
    
    // Scan leftward deleting characters of the same type
    while (x >= 0) { // Support negative coordinates
        const key = `${x},${lineY}`;
        const charData = worldData[key];
        
        if (!charData) {
            // No character at this position
            if (deletedAny) {
                // We've deleted some characters, stop here
                break;
            } else {
                // Skip empty positions while looking for text
                x--;
                continue;
            }
        }
        
        const char = getCharacter(charData);
        const isSpace = char.trim() === '';
        
        // Stop if character type changes (space vs non-space)
        if (isSpace !== isStartSpace) {
            break;
        }
        
        // Mark for deletion
        deletedAny = true;
        x--;
    }
    
    if (!deletedAny) return null;
    
    return {
        deleteFromX: x + 1, // First position to delete
        deleteToX: rightmostDeleted, // Last position to delete
        newCursorX: x + 1 // New cursor position
    };
}