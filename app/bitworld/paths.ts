/**
 * Pathfinding system for cursor movement
 * Uses A* algorithm with path smoothing
 *
 * Note: Agents are unconstrained - they can move through any cell.
 * Pathfinding provides smooth waypoint generation, not obstacle avoidance.
 */

export interface Point {
    x: number;
    y: number;
}

// Simplified WorldData type for pathfinding (accepts any value type)
export interface WorldData {
    [key: string]: any;
}

/**
 * Direct pathfinding - returns straight line path
 * Agents are unconstrained and can move through any cell.
 * This function generates waypoints for smooth movement.
 */
export function findPath(
    start: Point,
    end: Point,
    _worldData: WorldData,
    _maxSearchDistance: number = 100
): Point[] {
    // If start and end are the same, return single point
    if (start.x === end.x && start.y === end.y) {
        return [start];
    }

    // Direct path - no obstacles to avoid
    // Generate intermediate waypoints using Bresenham's line for smooth movement
    const path: Point[] = [];
    const x0 = Math.round(start.x);
    const y0 = Math.round(start.y);
    const x1 = Math.round(end.x);
    const y1 = Math.round(end.y);

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let cx = x0;
    let cy = y0;

    while (true) {
        path.push({ x: cx, y: cy });
        if (cx === x1 && cy === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; cx += sx; }
        if (e2 < dx) { err += dx; cy += sy; }
    }

    return path;
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
