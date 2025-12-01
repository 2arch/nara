/**
 * Pathfinding system for cursor movement
 * Uses A* algorithm with obstacle avoidance and path smoothing
 */

import { getAllPaintBlobs } from './world.engine';

export interface Point {
    x: number;
    y: number;
}

interface PathNode {
    x: number;
    y: number;
    g: number; // Cost from start
    h: number; // Heuristic cost to end
    f: number; // Total cost (g + h)
    parent: PathNode | null;
}

// Simplified WorldData type for pathfinding (accepts any value type)
export interface WorldData {
    [key: string]: any;
}

/**
 * Check if a position contains an obstacle (note, image, etc.)
 */
function isObstacle(x: number, y: number, worldData: WorldData): boolean {
    const key = `${x},${y}`;
    const data = worldData[key];

    if (!data) return false;

    try {
        const parsed = JSON.parse(data);

        // Check if it's a note region
        if (parsed.startX !== undefined && parsed.endX !== undefined &&
            parsed.startY !== undefined && parsed.endY !== undefined) {
            // It's a region - check if point is inside
            return x >= parsed.startX && x <= parsed.endX &&
                   y >= parsed.startY && y <= parsed.endY;
        }

        // Check if it's an image or other blocking entity
        if (parsed.contentType === 'image' || parsed.imageData) {
            return true;
        }

        // Check if it's a selection or other blocking region
        if (parsed.isSelection) {
            return true;
        }

    } catch (e) {
        // Not JSON or parsing failed
    }

    return false;
}

/**
 * Check if any note region overlaps with this position
 */
function isInsideNoteRegion(x: number, y: number, worldData: WorldData): boolean {
    for (const key in worldData) {
        if (!key.startsWith('note_') && !key.startsWith('image_')) continue;

        try {
            const parsed = JSON.parse(worldData[key]);
            if (parsed.startX !== undefined && parsed.endX !== undefined &&
                parsed.startY !== undefined && parsed.endY !== undefined) {
                if (x >= parsed.startX && x <= parsed.endX &&
                    y >= parsed.startY && y <= parsed.endY) {
                    return true;
                }
            }
        } catch (e) {
            // Skip invalid data
        }
    }
    return false;
}

/**
 * Check if position contains obstacle paint
 */
function isObstaclePaint(x: number, y: number, worldData: WorldData): boolean {
    // Round to integer cell coordinates
    const roundedX = Math.round(x);
    const roundedY = Math.round(y);
    const cellKey = `${roundedX},${roundedY}`;
    const blobs = getAllPaintBlobs(worldData);

    for (const blob of blobs) {
        // Only check blobs marked as obstacles
        if (blob.paintType !== 'obstacle') continue;

        // Quick bounds check first
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
}

/**
 * Manhattan distance heuristic
 */
function heuristic(a: Point, b: Point): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Euclidean distance for more natural diagonal movement
 */
function euclideanDistance(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * A* pathfinding algorithm
 * Returns array of points from start to end, avoiding obstacles
 */
export function findPath(
    start: Point,
    end: Point,
    worldData: WorldData,
    maxSearchDistance: number = 100
): Point[] {
    // If start and end are the same, return empty path
    if (start.x === end.x && start.y === end.y) {
        return [start];
    }

    // Note: We no longer skip A* for short distances - need to check for obstacles even for short paths

    const openSet: PathNode[] = [];
    const closedSet = new Set<string>();

    const startNode: PathNode = {
        x: Math.round(start.x),
        y: Math.round(start.y),
        g: 0,
        h: heuristic(start, end),
        f: heuristic(start, end),
        parent: null
    };

    openSet.push(startNode);

    // 8-directional movement
    const directions = [
        { x: 0, y: 1 },   // South
        { x: -1, y: 1 },  // South-West
        { x: -1, y: 0 },  // West
        { x: -1, y: -1 }, // North-West
        { x: 0, y: -1 },  // North
        { x: 1, y: -1 },  // North-East
        { x: 1, y: 0 },   // East
        { x: 1, y: 1 }    // South-East
    ];

    let iterations = 0;
    const maxIterations = 1000; // Prevent infinite loops

    while (openSet.length > 0 && iterations < maxIterations) {
        iterations++;

        // Find node with lowest f score
        openSet.sort((a, b) => a.f - b.f);
        const current = openSet.shift()!;

        const currentKey = `${current.x},${current.y}`;

        // Check if we reached the goal
        if (Math.abs(current.x - end.x) < 1 && Math.abs(current.y - end.y) < 1) {
            // Reconstruct path
            const path: Point[] = [];
            let node: PathNode | null = current;
            while (node) {
                path.unshift({ x: node.x, y: node.y });
                node = node.parent;
            }
            return path;
        }

        closedSet.add(currentKey);

        // Check neighbors
        for (const dir of directions) {
            const nx = current.x + dir.x;
            const ny = current.y + dir.y;
            const neighborKey = `${nx},${ny}`;

            // Skip if already visited
            if (closedSet.has(neighborKey)) continue;

            // Skip if too far from start (prevent excessive search)
            if (Math.abs(nx - start.x) > maxSearchDistance ||
                Math.abs(ny - start.y) > maxSearchDistance) {
                continue;
            }

            // Skip if obstacle (but allow target position)
            const isTarget = Math.abs(nx - end.x) < 1 && Math.abs(ny - end.y) < 1;
            if (!isTarget && (isInsideNoteRegion(nx, ny, worldData) || isObstaclePaint(nx, ny, worldData))) {
                continue;
            }

            // Calculate costs - check if diagonal movement
            const isDiagonal = dir.x !== 0 && dir.y !== 0;

            // For diagonal movement, check that we're not squeezing through corner-connected obstacles
            if (isDiagonal) {
                // Check both orthogonal neighbors - if either is blocked, can't move diagonally
                const side1X = current.x + dir.x;
                const side1Y = current.y;
                const side2X = current.x;
                const side2Y = current.y + dir.y;

                const side1Blocked = isInsideNoteRegion(side1X, side1Y, worldData) || isObstaclePaint(side1X, side1Y, worldData);
                const side2Blocked = isInsideNoteRegion(side2X, side2Y, worldData) || isObstaclePaint(side2X, side2Y, worldData);

                // If either orthogonal side is blocked, can't squeeze through diagonally
                if (side1Blocked || side2Blocked) {
                    continue;
                }
            }
            const moveCost = isDiagonal ? 1.414 : 1.0; // Diagonal movement costs more
            const g = current.g + moveCost;
            const h = heuristic({ x: nx, y: ny }, end);
            const f = g + h;

            // Check if this neighbor is already in open set with better cost
            const existingIdx = openSet.findIndex(n => n.x === nx && n.y === ny);
            if (existingIdx !== -1) {
                if (g < openSet[existingIdx].g) {
                    openSet[existingIdx].g = g;
                    openSet[existingIdx].f = f;
                    openSet[existingIdx].parent = current;
                }
                continue;
            }

            // Add to open set
            openSet.push({
                x: nx,
                y: ny,
                g,
                h,
                f,
                parent: current
            });
        }
    }

    // No path found - return direct line
    return [start, end];
}

/**
 * Smooth path using Catmull-Rom spline
 * Creates natural-looking curves through waypoints
 */
export function smoothPath(path: Point[], segmentsPerPoint: number = 4): Point[] {
    if (path.length < 2) return path;
    if (path.length === 2) return path;

    const smoothed: Point[] = [];

    // Add first point
    smoothed.push(path[0]);

    // For each segment between points
    for (let i = 0; i < path.length - 1; i++) {
        const p0 = path[Math.max(0, i - 1)];
        const p1 = path[i];
        const p2 = path[i + 1];
        const p3 = path[Math.min(path.length - 1, i + 2)];

        // Generate intermediate points using Catmull-Rom
        for (let t = 0; t < segmentsPerPoint; t++) {
            const u = t / segmentsPerPoint;
            const point = catmullRom(p0, p1, p2, p3, u);
            smoothed.push(point);
        }
    }

    // Add last point
    smoothed.push(path[path.length - 1]);

    return smoothed;
}

/**
 * Catmull-Rom spline interpolation
 */
function catmullRom(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
    const t2 = t * t;
    const t3 = t2 * t;

    const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
    );

    const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    );

    return { x, y };
}

/**
 * Simplify path by removing unnecessary waypoints
 * Uses Ramer-Douglas-Peucker algorithm
 */
export function simplifyPath(path: Point[], epsilon: number = 0.5): Point[] {
    if (path.length < 3) return path;

    // Find point with maximum distance from line between first and last
    let maxDistance = 0;
    let maxIndex = 0;

    const start = path[0];
    const end = path[path.length - 1];

    for (let i = 1; i < path.length - 1; i++) {
        const distance = perpendicularDistance(path[i], start, end);
        if (distance > maxDistance) {
            maxDistance = distance;
            maxIndex = i;
        }
    }

    // If max distance is greater than epsilon, recursively simplify
    if (maxDistance > epsilon) {
        const left = simplifyPath(path.slice(0, maxIndex + 1), epsilon);
        const right = simplifyPath(path.slice(maxIndex), epsilon);

        // Combine results (remove duplicate middle point)
        return [...left.slice(0, -1), ...right];
    } else {
        // All points are close to line - return endpoints
        return [start, end];
    }
}

/**
 * Calculate perpendicular distance from point to line
 */
function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;

    const numerator = Math.abs(
        dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x
    );
    const denominator = Math.sqrt(dx * dx + dy * dy);

    return numerator / denominator;
}

/**
 * Main function: Find and smooth path
 */
export function findSmoothPath(
    start: Point,
    end: Point,
    worldData: WorldData
): Point[] {
    // Find path with A*
    const rawPath = findPath(start, end, worldData);

    // If path is very short, don't smooth
    if (rawPath.length < 3) return rawPath;

    // Check if there are any obstacles - if so, don't smooth (smoothing can cut through obstacles)
    const hasObstacles = getAllPaintBlobs(worldData).some(blob => blob.paintType === 'obstacle');
    if (hasObstacles) {
        // Return raw A* path without smoothing to avoid cutting through obstacles
        return rawPath;
    }

    // Simplify to remove unnecessary waypoints
    const simplified = simplifyPath(rawPath, 1.0);

    // Smooth the path
    const smoothed = smoothPath(simplified, 3);

    return smoothed;
}

// ============================================================================
// EXPRESSION-BASED MOVEMENT SYSTEM
// ============================================================================
// Allows agents to move based on mathematical expressions evaluated each frame.
// Supports variables like x, y, t, vx, vy, and swarm variables like avgX, avgY.

export interface AgentExpressionState {
    id: string;
    xExpr: string;          // Expression for new x position
    yExpr: string;          // Expression for new y position
    vars: Record<string, number>;  // Custom variables
    startTime: number;      // When the expression started (for t)
    active: boolean;        // Whether expression is running
    duration?: number;      // Optional max duration in seconds
}

export interface ExpressionContext {
    x: number;              // Current x position
    y: number;              // Current y position
    t: number;              // Time since expression started (seconds)
    vx: number;             // Current velocity x
    vy: number;             // Current velocity y
    startX: number;         // Starting x position
    startY: number;         // Starting y position
    // Swarm variables (set externally for multi-agent coordination)
    avgX?: number;          // Average x of all agents
    avgY?: number;          // Average y of all agents
    nearestX?: number;      // Nearest other agent x
    nearestY?: number;      // Nearest other agent y
    nearestDist?: number;   // Distance to nearest agent
    [key: string]: number | undefined;  // Custom variables
}

/**
 * Simple math expression evaluator
 * Supports: +, -, *, /, ^, (, ), sin, cos, tan, sqrt, abs, min, max, pow, exp, log
 * Variables: x, y, t, vx, vy, startX, startY, avgX, avgY, etc.
 */
export function evaluateExpression(expr: string, context: ExpressionContext): number {
    // Create a safe evaluation context with math functions
    const mathFns: Record<string, (...args: number[]) => number> = {
        sin: Math.sin,
        cos: Math.cos,
        tan: Math.tan,
        asin: Math.asin,
        acos: Math.acos,
        atan: Math.atan,
        atan2: Math.atan2,
        sqrt: Math.sqrt,
        abs: Math.abs,
        floor: Math.floor,
        ceil: Math.ceil,
        round: Math.round,
        min: Math.min,
        max: Math.max,
        pow: Math.pow,
        exp: Math.exp,
        log: Math.log,
        sign: Math.sign,
        random: Math.random,
    };

    // Replace variable names with their values
    let processedExpr = expr;

    // Sort keys by length (longest first) to avoid partial replacements
    const sortedKeys = Object.keys(context).sort((a, b) => b.length - a.length);

    for (const key of sortedKeys) {
        const value = context[key];
        if (value !== undefined) {
            // Use word boundary to avoid partial matches
            const regex = new RegExp(`\\b${key}\\b`, 'g');
            processedExpr = processedExpr.replace(regex, `(${value})`);
        }
    }

    // Replace PI and E
    processedExpr = processedExpr.replace(/\bPI\b/g, `(${Math.PI})`);
    processedExpr = processedExpr.replace(/\bE\b/g, `(${Math.E})`);

    // Replace ^ with ** for exponentiation
    processedExpr = processedExpr.replace(/\^/g, '**');

    // Build function string with math functions in scope
    const fnNames = Object.keys(mathFns);
    const fnValues = Object.values(mathFns);

    try {
        // Create function with math functions as parameters
        const fn = new Function(...fnNames, `return (${processedExpr});`);
        const result = fn(...fnValues);

        // Validate result
        if (typeof result !== 'number' || isNaN(result) || !isFinite(result)) {
            console.warn(`Expression "${expr}" returned invalid value:`, result);
            return context.x; // Return current position as fallback
        }

        return result;
    } catch (e) {
        console.error(`Error evaluating expression "${expr}":`, e);
        return context.x; // Return current position as fallback
    }
}

/**
 * Evaluate an agent's movement expression and return new position
 */
export function evaluateAgentMovement(
    state: AgentExpressionState,
    currentPos: Point,
    velocity: Point,
    startPos: Point,
    swarmContext?: Partial<ExpressionContext>
): Point {
    const now = Date.now();
    const t = (now - state.startTime) / 1000; // Time in seconds

    // Check if duration exceeded
    if (state.duration && t > state.duration) {
        return currentPos; // Stop moving
    }

    // Build evaluation context
    const context: ExpressionContext = {
        x: currentPos.x,
        y: currentPos.y,
        t,
        vx: velocity.x,
        vy: velocity.y,
        startX: startPos.x,
        startY: startPos.y,
        ...swarmContext,
        ...state.vars,
    };

    // Evaluate expressions
    const newX = evaluateExpression(state.xExpr, context);
    const newY = evaluateExpression(state.yExpr, context);

    return { x: newX, y: newY };
}

/**
 * Create an expression state for an agent
 */
export function createAgentExpression(
    id: string,
    xExpr: string,
    yExpr: string,
    vars: Record<string, number> = {},
    duration?: number
): AgentExpressionState {
    return {
        id,
        xExpr,
        yExpr,
        vars,
        startTime: Date.now(),
        active: true,
        duration,
    };
}
