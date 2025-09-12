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

// === TEXT CLUSTER SYSTEM ===

export interface TextCluster {
    id: string;
    blocks: TextBlock[];
    lines: number[];
    boundingBox: {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
    };
    density: number;
    totalCharacters: number;
    estimatedWords: number;
    centroid: {x: number, y: number};
    leftMargin: number; // Track the consistent left margin of this cluster
}

export interface ClusteringConditions {
    maxVerticalGap: number;        // Max lines between blocks to be same cluster
    minBlocksPerCluster: number;   // Min blocks needed to form cluster  
    maxHorizontalOverlap: number;  // Max X overlap tolerance between lines
    minDensity: number;           // Min char density to qualify for labeling
    minWords: number;             // Min estimated words to create label
}

export const defaultClusteringConditions: ClusteringConditions = {
    maxVerticalGap: 5,           // Allow larger gaps between lines
    minBlocksPerCluster: 1,      // Allow single blocks to be "clusters"
    maxHorizontalOverlap: 8,     // Much stricter horizontal alignment - only ~1 word gap
    minDensity: 0.1,            // Lower density requirement
    minWords: 2                  // Only need 2+ words
};

/**
 * Extracts all text blocks from world data within a viewport region
 * @param worldData Combined world data
 * @param viewport Optional viewport bounds {minX, maxX, minY, maxY}
 * @returns Map of line numbers to their text blocks
 */
export function extractAllTextBlocks(
    worldData: WorldData, 
    viewport?: {minX: number, maxX: number, minY: number, maxY: number}
): Map<number, TextBlock[]> {
    const lineBlocks = new Map<number, TextBlock[]>();
    const lines = new Set<number>();
    
    // Find all lines with content
    for (const key in worldData) {
        const [, yStr] = key.split(',');
        const y = parseInt(yStr, 10);
        
        if (viewport) {
            if (y < viewport.minY || y > viewport.maxY) continue;
        }
        
        lines.add(y);
    }
    
    // Extract blocks for each line
    for (const lineY of lines) {
        const lineChars = extractLineCharacters(worldData, lineY, false);
        
        if (viewport) {
            // Filter characters within viewport X bounds
            const filteredChars = lineChars.filter(char => 
                char.x >= viewport.minX && char.x <= viewport.maxX
            );
            if (filteredChars.length > 0) {
                lineBlocks.set(lineY, detectTextBlocks(filteredChars));
            }
        } else {
            if (lineChars.length > 0) {
                lineBlocks.set(lineY, detectTextBlocks(lineChars));
            }
        }
    }
    
    return lineBlocks;
}

/**
 * Groups text blocks into semantic clusters based on proximity and alignment
 * @param lineBlocks Map of line numbers to their text blocks
 * @param conditions Clustering conditions and thresholds
 * @returns Array of text clusters
 */
export function groupTextBlocksIntoClusters(
    lineBlocks: Map<number, TextBlock[]>,
    conditions: ClusteringConditions = defaultClusteringConditions
): TextCluster[] {
    console.log('=== CLUSTERING DEBUG ===');
    console.log('Input line blocks:', Array.from(lineBlocks.entries()));
    console.log('Clustering conditions:', conditions);
    
    const clusters: TextCluster[] = [];
    const processedBlocks = new Set<string>();
    
    const sortedLines = Array.from(lineBlocks.keys()).sort((a, b) => a - b);
    console.log('Sorted lines:', sortedLines);
    
    for (const currentLine of sortedLines) {
        const currentBlocks = lineBlocks.get(currentLine) || [];
        
        for (let blockIndex = 0; blockIndex < currentBlocks.length; blockIndex++) {
            const blockId = `${currentLine}-${blockIndex}`;
            if (processedBlocks.has(blockId)) continue;
            
            // Start new cluster with this block
            const cluster: TextCluster = {
                id: `cluster-${clusters.length}`,
                blocks: [currentBlocks[blockIndex]],
                lines: [currentLine],
                boundingBox: {
                    minX: currentBlocks[blockIndex].start,
                    maxX: currentBlocks[blockIndex].end,
                    minY: currentLine,
                    maxY: currentLine
                },
                density: 0,
                totalCharacters: currentBlocks[blockIndex].characters.length,
                estimatedWords: estimateWordsInBlock(currentBlocks[blockIndex]),
                centroid: {x: 0, y: 0}
            };
            
            processedBlocks.add(blockId);
            
            // Expand cluster by finding nearby blocks
            expandCluster(cluster, lineBlocks, processedBlocks, currentLine, conditions);
            
            // Only keep clusters meeting minimum requirements
            console.log('Cluster created with', cluster.blocks.length, 'blocks, min required:', conditions.minBlocksPerCluster);
            if (cluster.blocks.length >= conditions.minBlocksPerCluster) {
                finalizecluster(cluster);
                clusters.push(cluster);
                console.log('Cluster added to list');
            } else {
                console.log('Cluster rejected - not enough blocks');
            }
        }
    }
    
    return clusters;
}

/**
 * Expands a cluster by adding nearby aligned blocks
 */
function expandCluster(
    cluster: TextCluster,
    lineBlocks: Map<number, TextBlock[]>,
    processedBlocks: Set<string>,
    startLine: number,
    conditions: ClusteringConditions
): void {
    const searchLines = Array.from(lineBlocks.keys())
        .filter(line => Math.abs(line - startLine) <= conditions.maxVerticalGap)
        .sort((a, b) => Math.abs(a - startLine) - Math.abs(b - startLine));
    
    let expandedInLastPass = true;
    
    while (expandedInLastPass) {
        expandedInLastPass = false;
        
        for (const line of searchLines) {
            if (cluster.lines.includes(line)) continue;
            
            const blocks = lineBlocks.get(line) || [];
            for (let i = 0; i < blocks.length; i++) {
                const blockId = `${line}-${i}`;
                if (processedBlocks.has(blockId)) continue;
                
                if (isBlockAlignedWithCluster(blocks[i], cluster, conditions)) {
                    // Add block to cluster
                    cluster.blocks.push(blocks[i]);
                    cluster.lines.push(line);
                    cluster.totalCharacters += blocks[i].characters.length;
                    cluster.estimatedWords += estimateWordsInBlock(blocks[i]);
                    
                    // Update bounding box
                    cluster.boundingBox.minX = Math.min(cluster.boundingBox.minX, blocks[i].start);
                    cluster.boundingBox.maxX = Math.max(cluster.boundingBox.maxX, blocks[i].end);
                    cluster.boundingBox.minY = Math.min(cluster.boundingBox.minY, line);
                    cluster.boundingBox.maxY = Math.max(cluster.boundingBox.maxY, line);
                    
                    processedBlocks.add(blockId);
                    expandedInLastPass = true;
                }
            }
        }
    }
}

/**
 * Checks if a block aligns with existing cluster (horizontal overlap tolerance)
 */
function isBlockAlignedWithCluster(
    block: TextBlock,
    cluster: TextCluster,
    conditions: ClusteringConditions
): boolean {
    const blockRange = {start: block.start, end: block.end};
    const clusterRange = {start: cluster.boundingBox.minX, end: cluster.boundingBox.maxX};
    
    // Check for horizontal overlap or close proximity
    const overlap = Math.max(0, Math.min(blockRange.end, clusterRange.end) - Math.max(blockRange.start, clusterRange.start));
    const gap = Math.max(0, Math.max(blockRange.start, clusterRange.start) - Math.min(blockRange.end, clusterRange.end));
    
    // Check if blocks share similar left margin (column alignment)
    const leftMarginDifference = Math.abs(blockRange.start - clusterRange.start);
    const sharesLeftMargin = leftMarginDifference <= 2; // Allow 2 char tolerance for left margin
    
    // Only cluster if there's overlap OR (small gap AND shares left margin)
    return overlap > 0 || (gap <= conditions.maxHorizontalOverlap && sharesLeftMargin);
}

/**
 * Finalizes cluster by calculating density and centroid
 */
function finalizecluster(cluster: TextCluster): void {
    const boundingArea = (cluster.boundingBox.maxX - cluster.boundingBox.minX + 1) * 
                        (cluster.boundingBox.maxY - cluster.boundingBox.minY + 1);
    cluster.density = cluster.totalCharacters / boundingArea;
    
    // Calculate centroid
    let totalX = 0, totalY = 0, totalChars = 0;
    
    for (let i = 0; i < cluster.blocks.length; i++) {
        const block = cluster.blocks[i];
        const blockY = cluster.lines[i];
        const blockCenterX = (block.start + block.end) / 2;
        const blockChars = block.characters.length;
        
        totalX += blockCenterX * blockChars;
        totalY += blockY * blockChars;
        totalChars += blockChars;
    }
    
    cluster.centroid = {
        x: totalX / totalChars,
        y: totalY / totalChars
    };
}

/**
 * Estimates word count in a text block
 */
function estimateWordsInBlock(block: TextBlock): number {
    const text = block.characters.map(c => c.char).join('');
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Filters clusters based on conditional rules for label creation
 * @param clusters Array of text clusters
 * @param conditions Clustering conditions
 * @returns Clusters that qualify for label creation
 */
export function filterClustersForLabeling(
    clusters: TextCluster[],
    conditions: ClusteringConditions = defaultClusteringConditions
): TextCluster[] {
    return clusters.filter(cluster => 
        cluster.density >= conditions.minDensity &&
        cluster.estimatedWords >= conditions.minWords &&
        cluster.blocks.length >= conditions.minBlocksPerCluster
    );
}

// === FRAME RENDERING UTILITIES ===

export interface FrameRenderOptions {
    strokeStyle?: string;
    lineWidth?: number;
    dashPattern?: number[];
}

export const defaultFrameOptions: FrameRenderOptions = {
    strokeStyle: '#00FF00',
    lineWidth: 2,
    dashPattern: [5, 5]
};

export interface TextBlockFrame {
    boundingBox: {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
    };
}

// === Hierarchical Clustering Interfaces ===

export enum HierarchyLevel {
    FINE_DETAIL = 1,    // Original clustering
    GROUPED = 2,        // Merged clusters  
}

export interface HierarchicalFrame {
    id: string;
    level: HierarchyLevel;
    boundingBox: {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
    };
    center: {
        x: number;
        y: number;
    };
    viewerDistance: number;
    mergeRadius: number;
    children?: HierarchicalFrame[];  // For tree structure
    clusters: TextCluster[];         // Source clusters
    style: FrameStyle;
}

export interface FrameStyle {
    strokeStyle: string;
    lineWidth: number;
    dashPattern: number[];
    fillStyle?: string;
    alpha?: number;
}

export interface HierarchicalFrameSystem {
    levels: Map<HierarchyLevel, HierarchicalFrame[]>;
    viewportCenter: { x: number; y: number };
    zoomLevel: number;
    activeFrames: HierarchicalFrame[];  // Frames to actually render
}

export interface DistanceBasedConfig {
    baseRadius: number;           // Base merge radius (default: 50)
    distanceScaling: number;      // Distance scaling factor (default: 1000)
    zoomScaling: boolean;         // Whether to scale with zoom
    levelThresholds: {
        [HierarchyLevel.FINE_DETAIL]: number;
        [HierarchyLevel.GROUPED]: number;
    };
}

// === Distance-Based Clustering Utilities ===

/**
 * Calculate Euclidean distance between two points
 */
export function calculateDistance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Get the center point of a cluster's bounding box
 */
export function getClusterCenter(cluster: TextCluster): { x: number; y: number } {
    const { boundingBox } = cluster;
    return {
        x: (boundingBox.minX + boundingBox.maxX) / 2,
        y: (boundingBox.minY + boundingBox.maxY) / 2
    };
}

/**
 * Calculate dynamic merge radius based on distance from viewer
 * Formula: baseRadius * (1 + viewerDistance / distanceScaling)
 */
export function getMergeRadius(
    viewerDistance: number, 
    config: DistanceBasedConfig
): number {
    const { baseRadius, distanceScaling } = config;
    return baseRadius * (1 + viewerDistance / distanceScaling);
}

/**
 * Calculate merge radius with zoom integration
 * More aggressive merging when zoomed out
 */
export function getEffectiveMergeRadius(
    viewerDistance: number,
    zoomLevel: number,
    config: DistanceBasedConfig
): number {
    const distanceFactor = 1 + viewerDistance / config.distanceScaling;
    const zoomFactor = config.zoomScaling ? (1 / Math.max(0.1, zoomLevel)) : 1;
    return config.baseRadius * distanceFactor * zoomFactor;
}

/**
 * Determine hierarchy level based on distance from viewport center
 */
export function getHierarchyLevel(
    viewerDistance: number,
    config: DistanceBasedConfig
): HierarchyLevel {
    const { levelThresholds } = config;
    
    if (viewerDistance < levelThresholds[HierarchyLevel.FINE_DETAIL]) {
        return HierarchyLevel.FINE_DETAIL;
    } else {
        return HierarchyLevel.GROUPED;
    }
}

/**
 * Default configuration for distance-based clustering
 */
export const defaultDistanceConfig: DistanceBasedConfig = {
    baseRadius: 50,
    distanceScaling: 1000,
    zoomScaling: true,
    levelThresholds: {
        [HierarchyLevel.FINE_DETAIL]: 100,
        [HierarchyLevel.GROUPED]: Infinity
    }
};

/**
 * Get visual style for a hierarchy level based on design document
 */
export function getHierarchyStyle(level: HierarchyLevel): FrameStyle {
    switch (level) {
        case HierarchyLevel.FINE_DETAIL:
            return {
                strokeStyle: '#00FF00',  // Green
                lineWidth: 1,
                dashPattern: [3, 3]
            };
        case HierarchyLevel.GROUPED:
            return {
                strokeStyle: '#0088FF',  // Blue
                lineWidth: 2,
                dashPattern: [5, 5]
            };
    }
}

/**
 * Merge two clusters into a single hierarchical frame
 */
function mergeClusters(cluster1: TextCluster, cluster2: TextCluster): TextCluster {
    return {
        id: `merged_${cluster1.id}_${cluster2.id}`,
        blocks: [...cluster1.blocks, ...cluster2.blocks],
        lines: [...cluster1.lines, ...cluster2.lines].sort((a, b) => a - b),
        boundingBox: {
            minX: Math.min(cluster1.boundingBox.minX, cluster2.boundingBox.minX),
            maxX: Math.max(cluster1.boundingBox.maxX, cluster2.boundingBox.maxX),
            minY: Math.min(cluster1.boundingBox.minY, cluster2.boundingBox.minY),
            maxY: Math.max(cluster1.boundingBox.maxY, cluster2.boundingBox.maxY)
        },
        density: (cluster1.density + cluster2.density) / 2  // Average density
    };
}

/**
 * Generate hierarchical frame system based on distance from viewport
 */
export function generateHierarchicalFrames(
    worldData: WorldData,
    viewportCenter: { x: number; y: number },
    zoomLevel: number,
    config: DistanceBasedConfig = defaultDistanceConfig,
    viewport?: {minX: number, maxX: number, minY: number, maxY: number},
    showAllLevels: boolean = true
): HierarchicalFrameSystem {
    // Start with base clusters
    const lineBlocks = extractAllTextBlocks(worldData, viewport);
    const baseClusters = groupTextBlocksIntoClusters(lineBlocks);
    
    console.log('=== HIERARCHICAL CLUSTERING ===');
    console.log('Base clusters:', baseClusters.length);
    console.log('Viewport center:', viewportCenter);
    console.log('Zoom level:', zoomLevel);
    
    const levels = new Map<HierarchyLevel, HierarchicalFrame[]>();
    
    // Process each hierarchy level - build hierarchically
    let previousClusters = baseClusters;
    
    for (const level of [HierarchyLevel.FINE_DETAIL, HierarchyLevel.GROUPED]) {
        const levelFrames: HierarchicalFrame[] = [];
        let currentClusters: TextCluster[];
        
        if (level === HierarchyLevel.FINE_DETAIL) {
            // Level 1: Use original clustering logic (no distance-based merging)
            currentClusters = [...baseClusters];
        } else {
            // Levels 2-4: Apply distance-based merging to the previous level's clusters
            currentClusters = applyDistanceBasedMerging([...previousClusters], viewportCenter, zoomLevel, level, config);
        }
        
        // Convert clusters to hierarchical frames
        for (let i = 0; i < currentClusters.length; i++) {
            const cluster = currentClusters[i];
            const center = getClusterCenter(cluster);
            const distance = calculateDistance(viewportCenter, center);
            const mergeRadius = getEffectiveMergeRadius(distance, zoomLevel, config);
            
            const frame: HierarchicalFrame = {
                id: `${level}_${cluster.id}_${i}`,
                level: level,
                boundingBox: cluster.boundingBox,
                center: center,
                viewerDistance: distance,
                mergeRadius: mergeRadius,
                clusters: [cluster],
                style: getHierarchyStyle(level)
            };
            
            levelFrames.push(frame);
        }
        
        levels.set(level, levelFrames);
        console.log(`Level ${level} frames:`, levelFrames.length);
        
        // Update previous clusters for the next level
        previousClusters = currentClusters;
    }
    
    // Determine which frames should be actively rendered
    const activeFrames = selectActiveFrames(levels, viewportCenter, config, showAllLevels);
    
    return {
        levels,
        viewportCenter,
        zoomLevel,
        activeFrames
    };
}

/**
 * Apply simple proximity-based merging for L2 level
 * Much more conservative than distance-based merging
 */
export function applySimpleProximityMerging(
    clusters: TextCluster[],
    maxMergeDistance: number = 5  // Very conservative merge distance
): TextCluster[] {
    if (clusters.length <= 1) return clusters;
    
    let currentClusters = [...clusters];
    let changed = true;
    
    // Only do a single pass to avoid over-merging
    const newClusters: TextCluster[] = [];
    const processed = new Set<number>();
    
    for (let i = 0; i < currentClusters.length; i++) {
        if (processed.has(i)) continue;
        
        let merged = currentClusters[i];
        
        // Only look at the next few clusters to avoid over-merging
        for (let j = i + 1; j < Math.min(i + 3, currentClusters.length); j++) {
            if (processed.has(j)) continue;
            
            const center1 = getClusterCenter(merged);
            const center2 = getClusterCenter(currentClusters[j]);
            const distance = calculateDistance(center1, center2);
            
            // Very conservative merge - only merge very close clusters
            if (distance < maxMergeDistance) {
                merged = mergeClusters(merged, currentClusters[j]);
                processed.add(j);
            }
        }
        
        newClusters.push(merged);
        processed.add(i);
    }
    
    return newClusters;
}

/**
 * Apply distance-based merging for a specific hierarchy level
 */
export function applyDistanceBasedMerging(
    clusters: TextCluster[],
    viewportCenter: { x: number; y: number },
    zoomLevel: number,
    targetLevel: HierarchyLevel,
    config: DistanceBasedConfig
): TextCluster[] {
    // For L2, use simple proximity merging instead of complex distance-based merging
    if (targetLevel === HierarchyLevel.GROUPED) {
        return applySimpleProximityMerging(clusters, 8); // Only merge clusters within 8 units
    }
    
    // Original complex logic for other levels (if we had them)
    let currentClusters = [...clusters];
    let changed = true;
    
    // Iterate until no more merges possible
    while (changed && currentClusters.length > 1) {
        changed = false;
        const newClusters: TextCluster[] = [];
        const processed = new Set<number>();
        
        for (let i = 0; i < currentClusters.length; i++) {
            if (processed.has(i)) continue;
            
            let merged = currentClusters[i];
            
            for (let j = i + 1; j < currentClusters.length; j++) {
                if (processed.has(j)) continue;
                
                if (shouldMergeClusters(merged, currentClusters[j], viewportCenter, zoomLevel, targetLevel, config)) {
                    merged = mergeClusters(merged, currentClusters[j]);
                    processed.add(j);
                    changed = true;
                }
            }
            
            newClusters.push(merged);
            processed.add(i);
        }
        
        currentClusters = newClusters;
    }
    
    return currentClusters;
}

/**
 * Determine if two clusters should be merged based on distance and level
 */
function shouldMergeClusters(
    cluster1: TextCluster,
    cluster2: TextCluster,
    viewportCenter: { x: number; y: number },
    zoomLevel: number,
    level: HierarchyLevel,
    config: DistanceBasedConfig
): boolean {
    const center1 = getClusterCenter(cluster1);
    const center2 = getClusterCenter(cluster2);
    const midpoint = {
        x: (center1.x + center2.x) / 2,
        y: (center1.y + center2.y) / 2
    };
    
    const viewerDistance = calculateDistance(viewportCenter, midpoint);
    const mergeRadius = getEffectiveMergeRadius(viewerDistance, zoomLevel, config);
    const clusterDistance = calculateDistance(center1, center2);
    
    // Apply level-specific merging thresholds
    let levelMultiplier = 1;
    switch (level) {
        case HierarchyLevel.FINE_DETAIL:
            levelMultiplier = 0.5;  // More conservative (not actually used since L1 doesn't merge)
            break;
        case HierarchyLevel.GROUPED:
            levelMultiplier = 0.3;  // Much more conservative - only merge very close clusters
            break;
    }
    
    return clusterDistance < (mergeRadius * levelMultiplier);
}

/**
 * Select which frames should be actively rendered based on distance
 */
function selectActiveFrames(
    levels: Map<HierarchyLevel, HierarchicalFrame[]>,
    viewportCenter: { x: number; y: number },
    config: DistanceBasedConfig,
    showAllLevels: boolean = true
): HierarchicalFrame[] {
    const activeFrames: HierarchicalFrame[] = [];
    
    if (showAllLevels) {
        // Show all levels simultaneously for debugging/visualization
        for (const [level, frames] of levels) {
            activeFrames.push(...frames);
        }
    } else {
        // Original logic: only show appropriate level based on distance
        for (const [level, frames] of levels) {
            for (const frame of frames) {
                const shouldRender = getHierarchyLevel(frame.viewerDistance, config) === level;
                if (shouldRender) {
                    activeFrames.push(frame);
                }
            }
        }
    }
    
    return activeFrames;
}

/**
 * Generates simple bounding frames around text clusters (no AI)
 * @param worldData Combined world data
 * @param viewport Optional viewport bounds
 * @returns Array of simple frames around text clusters
 */
export function generateTextBlockFrames(
    worldData: WorldData, 
    viewport?: {minX: number, maxX: number, minY: number, maxY: number}
): TextBlockFrame[] {
    const lineBlocks = extractAllTextBlocks(worldData, viewport);
    const clusters = groupTextBlocksIntoClusters(lineBlocks);
    
    return clusters.map(cluster => ({
        boundingBox: cluster.boundingBox
    }));
}

/**
 * Renders hierarchical frames with level-specific styling
 * @param ctx Canvas rendering context
 * @param frames Array of hierarchical frames
 * @param worldToScreen Function to convert world coordinates to screen coordinates
 * @param viewBounds Current viewport bounds for culling
 * @param currentZoom Current zoom level
 * @param currentOffset Current view offset
 */
export function renderHierarchicalFrames(
    ctx: CanvasRenderingContext2D,
    frames: HierarchicalFrame[],
    worldToScreen: (x: number, y: number, zoom: number, offset: {x: number, y: number}) => {x: number, y: number},
    viewBounds: {minX: number, maxX: number, minY: number, maxY: number},
    currentZoom: number,
    currentOffset: {x: number, y: number}
): void {
    // Save current canvas state
    ctx.save();
    
    for (const frame of frames) {
        const { boundingBox, style, level } = frame;
        
        // Check if frame bounding box intersects with viewport
        const frameVisible = !(
            boundingBox.maxX < viewBounds.minX || 
            boundingBox.minX > viewBounds.maxX ||
            boundingBox.maxY < viewBounds.minY || 
            boundingBox.minY > viewBounds.maxY
        );

        if (!frameVisible) continue;

        // Convert world coordinates to screen coordinates
        const topLeft = worldToScreen(boundingBox.minX, boundingBox.minY, currentZoom, currentOffset);
        const bottomRight = worldToScreen(boundingBox.maxX, boundingBox.maxY, currentZoom, currentOffset);
        
        const width = bottomRight.x - topLeft.x;
        const height = bottomRight.y - topLeft.y;
        
        // Skip frames that are too small or too large to avoid rendering issues
        if (width < 1 || height < 1 || width > 10000 || height > 10000) continue;

        // Apply frame-specific style
        ctx.strokeStyle = style.strokeStyle;
        ctx.lineWidth = style.lineWidth;
        
        // Set dash pattern
        if (style.dashPattern && style.dashPattern.length > 0) {
            ctx.setLineDash(style.dashPattern);
        } else {
            ctx.setLineDash([]);  // Solid line
        }
        
        // Apply alpha if specified
        if (style.alpha !== undefined) {
            ctx.globalAlpha = style.alpha;
        }
        
        // Apply fill if specified
        if (style.fillStyle) {
            ctx.fillStyle = style.fillStyle;
            ctx.fillRect(topLeft.x, topLeft.y, width, height);
        }
        
        // Draw frame border
        ctx.strokeRect(topLeft.x, topLeft.y, width, height);
        
        // Reset alpha for next frame
        if (style.alpha !== undefined) {
            ctx.globalAlpha = 1.0;
        }
        
        // Optional: Render level indicator in corner for debugging
        if (level && currentZoom > 0.5) {  // Only at reasonable zoom levels
            ctx.save();
            ctx.fillStyle = style.strokeStyle;
            ctx.font = `${Math.max(10, 12 * currentZoom)}px monospace`;
            ctx.fillText(
                `L${level}`, 
                topLeft.x + 2, 
                topLeft.y + Math.max(12, 14 * currentZoom)
            );
            ctx.restore();
        }
    }
    
    // Restore canvas state
    ctx.restore();
}

/**
 * Renders frames on canvas with proper grid alignment
 * @param ctx Canvas rendering context
 * @param frames Array of frames with bounding boxes
 * @param worldToScreen Function to convert world coordinates to screen coordinates
 * @param viewBounds Current viewport bounds for culling
 * @param currentZoom Current zoom level
 * @param currentOffset Current view offset
 * @param options Frame rendering options
 */
export function renderFrames(
    ctx: CanvasRenderingContext2D,
    frames: Array<{boundingBox: {minX: number, maxX: number, minY: number, maxY: number}}>,
    worldToScreen: (x: number, y: number, zoom: number, offset: {x: number, y: number}) => {x: number, y: number},
    viewBounds: {minX: number, maxX: number, minY: number, maxY: number},
    currentZoom: number,
    currentOffset: {x: number, y: number},
    options: FrameRenderOptions = defaultFrameOptions
): void {
    const {strokeStyle, lineWidth, dashPattern} = {...defaultFrameOptions, ...options};
    
    // Set frame style
    ctx.strokeStyle = strokeStyle!;
    ctx.lineWidth = lineWidth!;
    if (dashPattern && dashPattern.length > 0) {
        ctx.setLineDash(dashPattern);
    }
    
    for (const frame of frames) {
        const { boundingBox } = frame;
        
        // Check if frame bounding box intersects with viewport
        const frameVisible = !(
            boundingBox.maxX < viewBounds.minX || 
            boundingBox.minX > viewBounds.maxX ||
            boundingBox.maxY < viewBounds.minY || 
            boundingBox.minY > viewBounds.maxY
        );
        
        if (frameVisible) {
            // Calculate frame bounds that align to character cell boundaries
            const topLeft = worldToScreen(boundingBox.minX, boundingBox.minY, currentZoom, currentOffset);
            const bottomRight = worldToScreen(boundingBox.maxX + 1, boundingBox.maxY + 1, currentZoom, currentOffset);
            
            // Snap frame to exact cell boundaries (no sub-pixel positioning)
            const frameX = Math.floor(topLeft.x);
            const frameY = Math.floor(topLeft.y);
            const frameWidth = Math.ceil(bottomRight.x) - frameX;
            const frameHeight = Math.ceil(bottomRight.y) - frameY;
            
            // Draw frame aligned to character grid
            ctx.strokeRect(frameX + 0.5, frameY + 0.5, frameWidth - 1, frameHeight - 1);
        }
    }
    
    // Reset line dash
    ctx.setLineDash([]);
}

// === CLUSTER LABEL GENERATION ===

export interface ClusterLabel {
    clusterId: string;
    position: {x: number, y: number};
    text: string;
    type: 'summary' | 'title' | 'topic' | 'section';
    confidence: number;
    contentSample: string;
    boundingBox: {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
    };
}

/**
 * Extracts the complete text content from a text cluster
 * @param cluster Text cluster to extract content from
 * @returns Full text content with line breaks preserved
 */
export function extractClusterContent(cluster: TextCluster): string {
    const lineTexts: string[] = [];
    
    // Group blocks by line and sort
    const blocksByLine = new Map<number, TextBlock[]>();
    for (let i = 0; i < cluster.blocks.length; i++) {
        const line = cluster.lines[i];
        const block = cluster.blocks[i];
        
        if (!blocksByLine.has(line)) {
            blocksByLine.set(line, []);
        }
        blocksByLine.get(line)!.push(block);
    }
    
    // Sort lines and extract text
    const sortedLines = Array.from(blocksByLine.keys()).sort((a, b) => a - b);
    
    for (const line of sortedLines) {
        const blocks = blocksByLine.get(line)!.sort((a, b) => a.start - b.start);
        const lineText = blocks.map(block => 
            block.characters.map(c => c.char).join('')
        ).join(' ');
        
        if (lineText.trim()) {
            lineTexts.push(lineText.trim());
        }
    }
    
    return lineTexts.join('\n');
}

/**
 * Generates intelligent labels for text clusters using AI
 * @param clusters Array of filtered text clusters
 * @returns Promise<ClusterLabel[]> Array of cluster labels
 */
export async function generateClusterLabels(clusters: TextCluster[]): Promise<ClusterLabel[]> {
    // Import AI function dynamically to avoid circular dependencies
    const { generateClusterLabel } = await import('./ai');
    
    const labels: ClusterLabel[] = [];
    
    for (const cluster of clusters) {
        const content = extractClusterContent(cluster);
        const aiLabel = await generateClusterLabel(content);
        
        if (aiLabel) {
            labels.push({
                clusterId: cluster.id,
                position: cluster.centroid,
                text: aiLabel,
                type: 'summary', // AI-generated labels are summaries
                confidence: 0.8, // High confidence for AI labels
                contentSample: content.split('\n')[0]?.slice(0, 50) + 
                               (content.split('\n')[0]?.length > 50 ? '...' : '') || '',
                boundingBox: cluster.boundingBox
            });
        }
    }
    
    return labels;
}