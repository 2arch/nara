/**
 * Pathfinding system for cursor movement
 * Uses A* algorithm with obstacle avoidance and path smoothing
 */

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

export interface WorldData {
    [key: string]: string;
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

    // If distance is very short, just return direct path
    const directDistance = euclideanDistance(start, end);
    if (directDistance < 3) {
        return [start, end];
    }

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
            if (!isTarget && isInsideNoteRegion(nx, ny, worldData)) {
                continue;
            }

            // Calculate costs
            const isDiagonal = dir.x !== 0 && dir.y !== 0;
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

    // Simplify to remove unnecessary waypoints
    const simplified = simplifyPath(rawPath, 1.0);

    // Smooth the path
    const smoothed = smoothPath(simplified, 3);

    return smoothed;
}
