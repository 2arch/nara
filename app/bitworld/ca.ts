// Cellular Automata utilities
// Pure functions for running CA simulations on cell grids

export type Cell = { x: number; y: number };
type CellSet = Set<string>; // "x,y" format

function toKey(x: number, y: number): string {
    return `${x},${y}`;
}

function fromKey(key: string): { x: number; y: number } {
    const [x, y] = key.split(',').map(Number);
    return { x, y };
}

function countNeighbors(cells: CellSet, x: number, y: number): number {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (cells.has(toKey(x + dx, y + dy))) count++;
        }
    }
    return count;
}

// Get all candidate cells (live cells + their neighbors)
function getCandidates(cells: CellSet): CellSet {
    const candidates = new Set<string>();
    for (const key of cells) {
        const { x, y } = fromKey(key);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                candidates.add(toKey(x + dx, y + dy));
            }
        }
    }
    return candidates;
}

// Game of Life: B3/S23
// Classic - creates gliders, oscillators, stable structures
function stepLife(cells: CellSet): CellSet {
    const next = new Set<string>();
    const candidates = getCandidates(cells);

    for (const key of candidates) {
        const { x, y } = fromKey(key);
        const neighbors = countNeighbors(cells, x, y);
        const alive = cells.has(key);

        if (alive && (neighbors === 2 || neighbors === 3)) {
            next.add(key);
        } else if (!alive && neighbors === 3) {
            next.add(key);
        }
    }

    return next;
}

// Grow: B12345678/S12345678
// Any cell with at least 1 neighbor comes alive and stays alive
// Creates expanding blobs from seed points
function stepGrow(cells: CellSet): CellSet {
    const next = new Set<string>();
    const candidates = getCandidates(cells);

    for (const key of candidates) {
        const { x, y } = fromKey(key);
        const neighbors = countNeighbors(cells, x, y);
        const alive = cells.has(key);

        if (alive || neighbors >= 1) {
            next.add(key);
        }
    }

    return next;
}

// Maze: B3/S12345
// Generates maze-like corridors
function stepMaze(cells: CellSet): CellSet {
    const next = new Set<string>();
    const candidates = getCandidates(cells);

    for (const key of candidates) {
        const { x, y } = fromKey(key);
        const neighbors = countNeighbors(cells, x, y);
        const alive = cells.has(key);

        if (alive && neighbors >= 1 && neighbors <= 5) {
            next.add(key);
        } else if (!alive && neighbors === 3) {
            next.add(key);
        }
    }

    return next;
}

// Seeds: B2/S (no survival)
// Explosive growth, creates interesting chaotic patterns
function stepSeeds(cells: CellSet): CellSet {
    const next = new Set<string>();
    const candidates = getCandidates(cells);

    for (const key of candidates) {
        const { x, y } = fromKey(key);
        const neighbors = countNeighbors(cells, x, y);

        // Only birth rule, no survival
        if (neighbors === 2) {
            next.add(key);
        }
    }

    return next;
}

// Coral: B3/S45678
// Organic coral-like growth that stabilizes
function stepCoral(cells: CellSet): CellSet {
    const next = new Set<string>();
    const candidates = getCandidates(cells);

    for (const key of candidates) {
        const { x, y } = fromKey(key);
        const neighbors = countNeighbors(cells, x, y);
        const alive = cells.has(key);

        if (alive && neighbors >= 4 && neighbors <= 8) {
            next.add(key);
        } else if (!alive && neighbors === 3) {
            next.add(key);
        }
    }

    return next;
}

export type CARule = 'life' | 'grow' | 'maze' | 'seeds' | 'coral';

const stepFunctions: Record<CARule, (cells: CellSet) => CellSet> = {
    life: stepLife,
    grow: stepGrow,
    maze: stepMaze,
    seeds: stepSeeds,
    coral: stepCoral,
};

/**
 * Run cellular automata simulation
 * @param startCells - Initial live cells
 * @param steps - Number of iterations to run (default: 5)
 * @param rule - CA ruleset to use (default: 'life')
 * @returns Array of cells after simulation
 */
export function runCA(
    startCells: Cell[],
    steps: number = 5,
    rule: CARule = 'life'
): Cell[] {
    if (startCells.length === 0) return [];

    let cells = new Set(startCells.map(c => toKey(c.x, c.y)));
    const stepFn = stepFunctions[rule] || stepLife;

    for (let i = 0; i < steps; i++) {
        cells = stepFn(cells);
        // Safety: cap at 10000 cells to prevent runaway
        if (cells.size > 10000) break;
    }

    return Array.from(cells).map(fromKey);
}

/**
 * Get cells within a bounding box (useful for limiting growth)
 */
export function boundCells(
    cells: Cell[],
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
): Cell[] {
    return cells.filter(c =>
        c.x >= minX && c.x <= maxX &&
        c.y >= minY && c.y <= maxY
    );
}
