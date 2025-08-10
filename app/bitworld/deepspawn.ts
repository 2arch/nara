import { useState, useCallback } from 'react';
import type { Point, WorldData } from './world.engine';
import { generateDeepspawnQuestions } from './ai';

// --- Deepspawn System Constants ---
const MIN_BLOCK_DISTANCE = 6;  // Minimum cells between blocks

// --- Deepspawn System Hook ---
export function useDeepspawnSystem() {
    const [deepspawnData, setDeepspawnData] = useState<WorldData>({});
    
    // Simple two-point tracking for direction calculation
    const [directionPoints, setDirectionPoints] = useState<{
        current: {x: number, y: number, timestamp: number} | null;
        previous: {x: number, y: number, timestamp: number} | null;
    }>({ current: null, previous: null });
    
    const [lastKnownDirection, setLastKnownDirection] = useState<number | null>(null);
    
    // Direction tracking constants
    const MIN_DISTANCE_THRESHOLD = 2; // Minimum distance to update direction
    const MAX_TIME_INTERVAL = 3000; // 3 seconds max between updates
    const MIN_MOVEMENT_THRESHOLD = 0.5; // Minimum movement to count as significant
    
    // Cursor spawning constants
    const CURSOR_SPAWN_DISTANCE = 8; // Distance from center to spawn cursors
    const CURSOR_BOUNDARY_RADIUS = MIN_BLOCK_DISTANCE; // Use the same radius as the visual boundary circles
    
    // Dynamic deepspawn questions state
    const [deepspawnQuestions, setDeepspawnQuestions] = useState<string[]>([
        "Why not?",
        "What if...",
        "How else?",
        "But what about...",
        "Consider..."
    ]);
    
    // Calculate deepspawn object dimensions dynamically
    const DEEPSPAWN_WIDTH = Math.max(...deepspawnQuestions.map(row => row.length));
    const DEEPSPAWN_HEIGHT = deepspawnQuestions.length;
    
    // Helper function to place a single deepspawn question at given center position
    const placeDeepspawnObject = useCallback((newData: WorldData, centerX: number, centerY: number, question: string) => {
        // Calculate dimensions for this single question
        const width = question.length;
        
        // Calculate starting position (centered horizontally)
        const startX = centerX - Math.floor(width / 2);
        const startY = centerY; // Single line, so no vertical centering needed
        
        // Place each character of the deepspawn question
        for (let colIndex = 0; colIndex < question.length; colIndex++) {
            const char = question[colIndex];
            const worldX = startX + colIndex;
            const worldY = startY;
            const key = `deepspawn_${worldX},${worldY}`;
            newData[key] = char;
        }
    }, []);

    // Helper function to check if a deepspawn's boundary circle collides with existing deepspawns
    const isPositionValidForDeepspawn = useCallback((x: number, y: number, existingDeepspawns: Point[]) => {
        for (const deepspawn of existingDeepspawns) {
            const centerDistance = Math.sqrt((x - deepspawn.x) ** 2 + (y - deepspawn.y) ** 2);
            
            // Calculate effective radius based on deepspawn object dimensions
            const effectiveRadius = Math.max(DEEPSPAWN_WIDTH, DEEPSPAWN_HEIGHT) / 2;
            const totalBoundaryDistance = 2 * effectiveRadius + CURSOR_BOUNDARY_RADIUS; // Add buffer
            
            if (centerDistance < totalBoundaryDistance) {
                return false;
            }
        }
        return true;
    }, [CURSOR_BOUNDARY_RADIUS]);

    // Function to find a valid position by trying nearby alternatives
    const findValidPosition = useCallback((baseX: number, baseY: number, existingCursors: Point[], maxAttempts = 12) => {
        // First try the base position
        if (isPositionValidForDeepspawn(baseX, baseY, existingCursors)) {
            return { x: baseX, y: baseY };
        }

        // Try positions in a spiral pattern around the base position
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const radius = attempt;
            const angleStep = (2 * Math.PI) / (6 * attempt); // More positions for larger radii
            
            for (let i = 0; i < 6 * attempt; i++) {
                const angle = i * angleStep;
                const testX = Math.round(baseX + radius * Math.cos(angle));
                const testY = Math.round(baseY + radius * Math.sin(angle));
                
                if (isPositionValidForDeepspawn(testX, testY, existingCursors)) {
                    return { x: testX, y: testY };
                }
            }
        }
        
        // If no valid position found, return the base position anyway
        return { x: baseX, y: baseY };
    }, [isPositionValidForDeepspawn]);

    // Function to generate new deepspawn questions based on recent text
    const generateNewQuestions = useCallback(async (recentText: string) => {
        try {
            console.log('Generating new deepspawn questions based on:', recentText);
            const newQuestions = await generateDeepspawnQuestions(recentText);
            setDeepspawnQuestions(newQuestions);
            return newQuestions;
        } catch (error) {
            console.error('Failed to generate deepspawn questions:', error);
            // Keep existing questions on error
            return deepspawnQuestions;
        }
    }, [deepspawnQuestions]);

    // Function to spawn 5 cursors: 3 ahead using phyllotactic arrangement + 2 orthogonal
    const spawnThreeCursors = useCallback(async (centerX: number, centerY: number, newDirection?: number | null, recentText?: string) => {
        // Generate new questions if recent text is provided
        let questionsToUse = deepspawnQuestions;
        if (recentText && recentText.trim().length > 10) {
            try {
                questionsToUse = await generateNewQuestions(recentText);
            } catch (error) {
                console.warn('Using default questions due to generation error:', error);
            }
        }

        // Use provided direction or calculate from current direction points
        let direction: number | null = newDirection || null;
        
        // If no direction provided, try to get it from current direction points
        if (direction === null && directionPoints.current && directionPoints.previous) {
            const dx = directionPoints.current.x - directionPoints.previous.x;
            const dy = directionPoints.current.y - directionPoints.previous.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Only calculate direction if movement is significant
            if (distance >= MIN_MOVEMENT_THRESHOLD) {
                direction = Math.atan2(dy, dx);
            }
        }
        
        // If still no direction, use last known direction
        if (direction === null) {
            direction = lastKnownDirection;
        }

        if (direction === null) {
            // If no direction, spawn in default forward pattern
            const angles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]; // 0°, 120°, 240°
            
            const newDeepspawnData: WorldData = {};
            angles.forEach((angle, index) => {
                const deepspawnX = Math.round(centerX + CURSOR_SPAWN_DISTANCE * Math.cos(angle));
                const deepspawnY = Math.round(centerY + CURSOR_SPAWN_DISTANCE * Math.sin(angle));
                placeDeepspawnObject(newDeepspawnData, deepspawnX, deepspawnY, questionsToUse);
            });
            setDeepspawnData(newDeepspawnData);
            return;
        }

        // Spawn cursors ahead using phyllotactic arrangement + orthogonal cursors
        const GOLDEN_ANGLE_RAD = 137.5 * Math.PI / 180; // Golden angle in radians
        const FORWARD_OFFSET = CURSOR_SPAWN_DISTANCE; // Base distance ahead
        const SPREAD_ANGLE = 30 * Math.PI / 180; // 30-degree spread for variety
        
        const newDeepspawnData: WorldData = {};
        const placedDeepspawns: Point[] = []; // Track placed deepspawns for collision detection
        
        // Spawn 3 cursors ahead using phyllotactic arrangement
        for (let i = 0; i < 3; i++) {
            // Pure phyllotactic spiral calculation
            const phyllotacticAngle = i * GOLDEN_ANGLE_RAD;
            const spiralRadius = Math.sqrt(i + 1) * 3; // Phyllotactic radius scaling
            
            // Calculate the forward direction with phyllotactic offset
            const spreadOffset = (Math.sin(phyllotacticAngle) * SPREAD_ANGLE);
            const forwardAngle = direction + spreadOffset;
            
            // Make the first cursor (i === 0) spawn farther ahead when it's most aligned with direction
            let totalDistance = FORWARD_OFFSET + spiralRadius;
            if (i === 0) {
                // The first cursor in phyllotactic arrangement - make it spawn farther ahead
                totalDistance = FORWARD_OFFSET + spiralRadius + 4; // Extra 4 cells ahead
            }
            
            const baseX = Math.round(centerX + totalDistance * Math.cos(forwardAngle));
            const baseY = Math.round(centerY + totalDistance * Math.sin(forwardAngle));
            
            // Find a valid position that doesn't collide
            const validPos = findValidPosition(baseX, baseY, placedDeepspawns);
            
            placeDeepspawnObject(newDeepspawnData, validPos.x, validPos.y, questionsToUse);
            placedDeepspawns.push(validPos); // Add to collision tracking
            
            console.log(`Spawning forward cursor ${i} at (${validPos.x}, ${validPos.y}) - Direction: ${(direction * 180/Math.PI).toFixed(1)}°${i === 0 ? ' (lead cursor)' : ''} ${validPos.x !== baseX || validPos.y !== baseY ? '(adjusted for collision)' : ''}`);
        }
        
        // Spawn 2 orthogonal cursors (left and right perpendicular to movement direction)
        const orthogonalAngles = [
            direction + Math.PI / 2,  // 90° counterclockwise (left)
            direction - Math.PI / 2   // 90° clockwise (right)
        ];
        
        orthogonalAngles.forEach((angle, index) => {
            const baseX = Math.round(centerX + CURSOR_SPAWN_DISTANCE * Math.cos(angle));
            const baseY = Math.round(centerY + CURSOR_SPAWN_DISTANCE * Math.sin(angle));
            
            // Find a valid position that doesn't collide
            const validPos = findValidPosition(baseX, baseY, placedDeepspawns);
            
            placeDeepspawnObject(newDeepspawnData, validPos.x, validPos.y, questionsToUse);
            placedDeepspawns.push(validPos); // Add to collision tracking
            
            console.log(`Spawning orthogonal cursor ${index} at (${validPos.x}, ${validPos.y}) - Angle: ${(angle * 180/Math.PI).toFixed(1)}° ${validPos.x !== baseX || validPos.y !== baseY ? '(adjusted for collision)' : ''}`);
        });
        
        setDeepspawnData(newDeepspawnData);
    }, [CURSOR_SPAWN_DISTANCE, directionPoints, MIN_MOVEMENT_THRESHOLD, lastKnownDirection, findValidPosition, placeDeepspawnObject]);

    // Function to update direction tracking points
    const updateDirectionPoint = useCallback((x: number, y: number, recentText?: string) => {
        if (typeof window === 'undefined') return;
        
        const now = Date.now();
        
        setDirectionPoints(prev => {
            // If no current point, set as current and spawn cursors
            if (!prev.current) {
                spawnThreeCursors(x, y, null, recentText);
                
                return {
                    current: { x, y, timestamp: now },
                    previous: null
                };
            }
            
            // Calculate distance from current point
            const dx = x - prev.current.x;
            const dy = y - prev.current.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Check if we should update based on distance or time
            const timeSinceUpdate = now - prev.current.timestamp;
            const shouldUpdateByDistance = distance >= MIN_DISTANCE_THRESHOLD;
            const shouldUpdateByTime = timeSinceUpdate >= MAX_TIME_INTERVAL;
            
            if (shouldUpdateByDistance || shouldUpdateByTime) {
                // Determine direction to use for spawning
                let directionToUse: number | null = null;
                
                if (distance >= MIN_MOVEMENT_THRESHOLD) {
                    // Significant movement - calculate and store new direction
                    directionToUse = Math.atan2(dy, dx);
                    setLastKnownDirection(directionToUse);
                } else {
                    // No significant movement - use last known direction
                    directionToUse = lastKnownDirection;
                    
                    // If no last known direction, try to get it from previous points
                    if (directionToUse === null && prev.previous) {
                        const prevDx = prev.current.x - prev.previous.x;
                        const prevDy = prev.current.y - prev.previous.y;
                        const prevDistance = Math.sqrt(prevDx * prevDx + prevDy * prevDy);
                        if (prevDistance >= MIN_MOVEMENT_THRESHOLD) {
                            directionToUse = Math.atan2(prevDy, prevDx);
                            setLastKnownDirection(directionToUse);
                        }
                    }
                }
                
                // Always spawn cursors with the determined direction
                spawnThreeCursors(x, y, directionToUse, recentText);
                
                return {
                    current: { x, y, timestamp: now },
                    previous: prev.current
                };
            }
            
            return prev; // No update needed
        });
    }, [MIN_DISTANCE_THRESHOLD, MAX_TIME_INTERVAL, spawnThreeCursors, lastKnownDirection]);

    // Calculate panning direction from two-point tracking
    const getPanningDirection = useCallback((): number | null => {
        if (typeof window === 'undefined') return null;
        
        // Need both current and previous points
        if (!directionPoints.current || !directionPoints.previous) return null;
        
        const dx = directionPoints.current.x - directionPoints.previous.x;
        const dy = directionPoints.current.y - directionPoints.previous.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Skip if movement is too small
        if (distance < MIN_MOVEMENT_THRESHOLD) return null;
        
        return Math.atan2(dy, dx);
    }, [directionPoints, MIN_MOVEMENT_THRESHOLD]);

    // Helper function to get angle calculation data for debug
    const getAngleDebugData = useCallback(() => {
        if (typeof window === 'undefined') return null;
        
        // Need both current and previous points
        if (!directionPoints.current || !directionPoints.previous) return null;
        
        const dx = directionPoints.current.x - directionPoints.previous.x;
        const dy = directionPoints.current.y - directionPoints.previous.y;
        const angle = Math.atan2(dy, dx);
        const degrees = (angle * 180 / Math.PI + 360) % 360;
        
        return {
            firstPoint: directionPoints.current,
            lastPoint: directionPoints.previous,
            angle,
            degrees,
            pointCount: 2
        };
    }, [directionPoints]);

    return {
        deepspawnData,
        setDeepspawnData,
        directionPoints,
        updateDirectionPoint,
        getPanningDirection,
        getAngleDebugData,
        spawnThreeCursors,
        generateNewQuestions,
        deepspawnQuestions
    };
}