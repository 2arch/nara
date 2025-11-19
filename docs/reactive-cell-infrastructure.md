# Reactive Cell Infrastructure
## The Parsing, Execution, and Rendering Pipeline

**Date:** 2025-01-18
**Question:** How does Observable-style code on canvas actually execute?

---

## The Full Pipeline

```
User types on canvas: "> data = [1, 2, 3]"
         ↓
Text stored in worldData at coordinates
         ↓
Cell parser detects "> " prefix
         ↓
JavaScript parser (Acorn) parses code
         ↓
Dependency analyzer extracts variable references
         ↓
Runtime executes code in sandboxed context
         ↓
Result stored in cell registry
         ↓
Canvas render loop draws output
         ↓
User sees: → [1, 2, 3]
```

Let's break down each step.

---

## Step 1: Text Storage (Already Exists)

Your existing worldData already stores text at coordinates:

```typescript
// worldData (existing)
{
  "100,50": "Some regular text",
  "100,51": "> data = [1, 2, 3]",  // Cell code
  "100,52": "More text",
  "100,53": "> sum = data.reduce((a,b) => a + b)"  // Another cell
}
```

**No change needed here.** Cells are just text with `> ` prefix.

---

## Step 2: Cell Detection During Render

During canvas rendering, detect cell syntax:

```typescript
// In bit.canvas.tsx render loop
function renderTextLayer(ctx: CanvasRenderingContext2D) {
    for (const [key, value] of Object.entries(engine.worldData)) {
        // Parse coordinate key
        const [x, y] = key.split(',').map(Number);

        if (typeof value === 'string') {
            // Check if this is a cell
            if (value.startsWith('> ')) {
                // This is a reactive cell!
                renderCell(ctx, x, y, value);
            } else {
                // Regular text
                renderText(ctx, x, y, value);
            }
        }
    }
}
```

---

## Step 3: Cell Parser

Extract cell code and metadata:

```typescript
interface ParsedCell {
    code: string;          // The actual JavaScript
    name?: string;         // Variable name (if assignment)
    isAsync: boolean;      // Does it use await?
    isGenerator: boolean;  // Does it use yield?
}

function parseCell(rawText: string): ParsedCell {
    // Remove "> " prefix
    const code = rawText.slice(2).trim();

    // Use Acorn to parse JavaScript
    const ast = acorn.parse(code, {
        ecmaVersion: 2022,
        sourceType: 'module'
    });

    // Analyze AST
    const isAsync = hasAwait(ast);
    const isGenerator = hasYield(ast);
    const name = extractAssignmentName(ast);

    return { code, name, isAsync, isGenerator };
}

function extractAssignmentName(ast: any): string | undefined {
    // Check if this is an assignment: x = ...
    if (ast.body.length === 1) {
        const statement = ast.body[0];

        if (statement.type === 'ExpressionStatement' &&
            statement.expression.type === 'AssignmentExpression' &&
            statement.expression.left.type === 'Identifier') {
            return statement.expression.left.name;
        }
    }

    return undefined;
}

function hasAwait(ast: any): boolean {
    let found = false;

    walk.simple(ast, {
        AwaitExpression() {
            found = true;
        }
    });

    return found;
}

function hasYield(ast: any): boolean {
    let found = false;

    walk.simple(ast, {
        YieldExpression() {
            found = true;
        }
    });

    return found;
}
```

**Dependencies:** Install `acorn` and `acorn-walk`:
```bash
npm install acorn acorn-walk
```

---

## Step 4: Dependency Analysis

Extract which variables this cell depends on:

```typescript
function extractDependencies(code: string, scope: Map<string, any>): Set<string> {
    const ast = acorn.parse(code, {
        ecmaVersion: 2022,
        sourceType: 'module'
    });

    const dependencies = new Set<string>();

    // Walk AST and find identifiers
    walk.ancestor(ast, {
        Identifier(node: any, ancestors: any[]) {
            const name = node.name;

            // Skip if this is a declaration (left side of assignment)
            const parent = ancestors[ancestors.length - 2];
            if (parent?.type === 'AssignmentExpression' && parent.left === node) {
                return;
            }

            // Skip function parameters
            if (isParameter(node, ancestors)) {
                return;
            }

            // If this variable exists in scope, it's a dependency
            if (scope.has(name)) {
                dependencies.add(name);
            }
        }
    });

    return dependencies;
}

function isParameter(node: any, ancestors: any[]): boolean {
    for (let i = ancestors.length - 1; i >= 0; i--) {
        const ancestor = ancestors[i];

        if (ancestor.type === 'FunctionExpression' ||
            ancestor.type === 'ArrowFunctionExpression') {
            return ancestor.params.includes(node);
        }
    }

    return false;
}
```

**Example:**
```javascript
// Input: sum = data.reduce((a, b) => a + b)
// Dependencies: ['data']
// (a, b are parameters, not dependencies)
```

---

## Step 5: Runtime Execution

Execute the code in a controlled environment:

```typescript
class ReactiveCellRuntime {
    private cells = new Map<string, CellData>();
    private scope = new Map<string, any>();  // Reactive variables

    async executeCell(cellId: string, code: string) {
        const parsed = parseCell(code);
        const dependencies = extractDependencies(code, this.scope);

        // Create cell data
        const cell: CellData = {
            id: cellId,
            code,
            name: parsed.name,
            dependencies,
            status: 'running',
            value: undefined,
            error: undefined
        };

        this.cells.set(cellId, cell);

        try {
            // Build execution context
            const context = this.createContext();

            // Execute code
            if (parsed.isGenerator) {
                // Generator function - create async generator
                const result = await this.evaluateGenerator(code, context);
                cell.value = result;  // First yielded value
                this.scheduleLiveUpdates(cell, result);
            } else if (parsed.isAsync) {
                // Async expression
                cell.value = await this.evaluateAsync(code, context);
            } else {
                // Sync expression
                cell.value = this.evaluateSync(code, context);
            }

            // Store in scope if named
            if (cell.name) {
                this.scope.set(cell.name, cell.value);
            }

            cell.status = 'fulfilled';

            // Update dependent cells
            await this.updateDependents(cell);

        } catch (error) {
            cell.error = error as Error;
            cell.status = 'rejected';
        }

        return cell;
    }

    createContext(): any {
        // Create execution context with:
        // 1. Reactive scope (all named variables)
        // 2. Built-in functions
        // 3. Canvas component factories

        return {
            // Spread reactive scope
            ...Object.fromEntries(this.scope),

            // Canvas components
            calendar: (props: any) => new CanvasCalendar(props),
            chart: (data: any) => new CanvasChart(data),
            ticker: (symbols: string[]) => new CanvasTicker(symbols),
            table: (data: any[]) => new CanvasTable(data),

            // Interactive inputs
            slider: (config: any) => new CanvasSlider(config),
            input: (config: any) => new CanvasInput(config),
            select: (options: string[]) => new CanvasSelect(options),

            // Utilities
            fetch: fetch,
            console: console,
            Math: Math,
            Date: Date,
            Object: Object,
            Array: Array,

            // Observable-style helpers
            html: (strings: TemplateStringsArray, ...values: any[]) => {
                return renderHTML(strings, values);
            },
            md: (strings: TemplateStringsArray, ...values: any[]) => {
                return renderMarkdown(strings, values);
            },

            // Helper for delays
            sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
        };
    }

    evaluateSync(code: string, context: any): any {
        // Create function from code
        const fn = new Function(...Object.keys(context), `return (${code})`);

        // Execute with context
        return fn(...Object.values(context));
    }

    async evaluateAsync(code: string, context: any): Promise<any> {
        // Create async function from code
        const fn = new Function(...Object.keys(context), `return (async () => { return (${code}) })()`);

        // Execute with context
        return await fn(...Object.values(context));
    }

    async evaluateGenerator(code: string, context: any): Promise<AsyncGenerator> {
        // Wrap code in async generator function
        const generatorCode = `
            (async function* () {
                ${code}
            })()
        `;

        const fn = new Function(...Object.keys(context), `return ${generatorCode}`);

        return fn(...Object.values(context));
    }

    async updateDependents(cell: CellData) {
        if (!cell.name) return;

        // Find cells that depend on this variable
        const dependents = Array.from(this.cells.values())
            .filter(c => c.dependencies.has(cell.name!));

        // Sort by dependency order (topological sort)
        const sorted = this.topologicalSort(dependents);

        // Re-execute each dependent
        for (const dependent of sorted) {
            await this.executeCell(dependent.id, dependent.code);
        }
    }

    topologicalSort(cells: CellData[]): CellData[] {
        // Simple topological sort
        const sorted: CellData[] = [];
        const visited = new Set<string>();

        const visit = (cell: CellData) => {
            if (visited.has(cell.id)) return;
            visited.add(cell.id);

            // Visit dependencies first
            for (const depName of cell.dependencies) {
                const depCell = Array.from(this.cells.values())
                    .find(c => c.name === depName);
                if (depCell) {
                    visit(depCell);
                }
            }

            sorted.push(cell);
        };

        cells.forEach(visit);
        return sorted;
    }

    async scheduleLiveUpdates(cell: CellData, generator: AsyncGenerator) {
        const update = async () => {
            try {
                const result = await generator.next();

                if (!result.done) {
                    cell.value = result.value;

                    // Update scope
                    if (cell.name) {
                        this.scope.set(cell.name, cell.value);
                    }

                    // Update dependents
                    await this.updateDependents(cell);

                    // Trigger canvas re-render
                    this.invalidateCell(cell);

                    // Schedule next update
                    setTimeout(update, 100);  // Continue pulling
                }
            } catch (error) {
                cell.error = error as Error;
                cell.status = 'rejected';
            }
        };

        update();
    }

    invalidateCell(cell: CellData) {
        // Trigger canvas re-render
        // This would call requestAnimationFrame or similar
        if (typeof window !== 'undefined' && (window as any).__requestCanvasRender) {
            (window as any).__requestCanvasRender();
        }
    }
}

interface CellData {
    id: string;
    code: string;
    name?: string;
    dependencies: Set<string>;
    status: 'pending' | 'running' | 'fulfilled' | 'rejected';
    value: any;
    error?: Error;
}
```

---

## Step 6: Integration with worldData

Link cells to canvas coordinates:

```typescript
// Cell registry maps coordinates to cell IDs
class CellRegistry {
    private positionToCell = new Map<string, string>();  // "x,y" -> cellId
    private cellToPosition = new Map<string, Point>();   // cellId -> {x, y}

    registerCell(x: number, y: number, cellId: string) {
        const key = `${x},${y}`;
        this.positionToCell.set(key, cellId);
        this.cellToPosition.set(cellId, { x, y });
    }

    getCellAt(x: number, y: number): string | undefined {
        return this.positionToCell.get(`${x},${y}`);
    }

    getPositionOf(cellId: string): Point | undefined {
        return this.cellToPosition.get(cellId);
    }
}

const cellRegistry = new CellRegistry();
```

---

## Step 7: Text Input Handling

When user types `> ` on canvas:

```typescript
// In world.engine.ts handleKeyPress
function handleKeyPress(key: string) {
    if (key === 'Enter') {
        // Get current line
        const currentLine = getCurrentLineText(cursorPos);

        // Check if this is a cell
        if (currentLine.startsWith('> ')) {
            // Execute the cell!
            const cellId = `cell_${cursorPos.x},${cursorPos.y}_${Date.now()}`;

            // Register cell
            cellRegistry.registerCell(cursorPos.x, cursorPos.y, cellId);

            // Execute
            reactiveCellRuntime.executeCell(cellId, currentLine);

            // Move cursor down to output line
            moveCursor(cursorPos.x, cursorPos.y + 1);

            return;
        }
    }

    // Regular text input...
}

function getCurrentLineText(pos: Point): string {
    let text = '';
    let x = pos.x;

    // Scan backwards to start of line
    while (x >= 0) {
        const char = worldData[`${x},${pos.y}`];
        if (!char) break;
        text = char + text;
        x--;
    }

    // Scan forwards to end of line
    x = pos.x + 1;
    while (true) {
        const char = worldData[`${x},${pos.y}`];
        if (!char) break;
        text += char;
        x++;
    }

    return text;
}
```

---

## Step 8: Rendering Cell Output

During canvas render loop, draw cell results:

```typescript
function renderCell(ctx: CanvasRenderingContext2D, x: number, y: number, rawText: string) {
    // Get cell ID from registry
    const cellId = cellRegistry.getCellAt(x, y);
    if (!cellId) return;

    // Get cell data from runtime
    const cell = reactiveCellRuntime.getCell(cellId);
    if (!cell) return;

    // Convert world to screen coordinates
    const screenPos = engine.worldToScreen(x, y, zoomLevel, viewOffset);

    // Render input (the code)
    ctx.fillStyle = '#666';
    ctx.fillText('> ', screenPos.x, screenPos.y);

    ctx.fillStyle = cell.status === 'running' ? '#00f' : '#000';
    ctx.fillText(cell.code, screenPos.x + 10, screenPos.y);

    // Render status indicator
    if (cell.status === 'running') {
        renderSpinner(ctx, screenPos.x - 5, screenPos.y);
    } else if (cell.status === 'rejected') {
        ctx.fillStyle = '#f00';
        ctx.fillText('✗', screenPos.x - 5, screenPos.y);
    }

    // Render output (the result)
    if (cell.status === 'fulfilled') {
        const outputY = screenPos.y + charHeight * 1.5;  // Below input

        ctx.fillStyle = '#666';
        ctx.fillText('→ ', screenPos.x, outputY);

        // Render value
        renderCellValue(ctx, cell.value, screenPos.x + 15, outputY);
    } else if (cell.status === 'rejected') {
        const outputY = screenPos.y + charHeight * 1.5;

        ctx.fillStyle = '#f00';
        ctx.fillText(`→ Error: ${cell.error?.message}`, screenPos.x, outputY);
    }
}

function renderCellValue(ctx: CanvasRenderingContext2D, value: any, x: number, y: number) {
    if (value instanceof CanvasComponent) {
        // Render canvas component
        value.render(ctx, { x, y });
    } else if (Array.isArray(value)) {
        // Render array
        ctx.fillStyle = '#000';
        ctx.fillText(JSON.stringify(value), x, y);
    } else if (typeof value === 'object') {
        // Render object
        ctx.fillStyle = '#000';
        ctx.fillText(JSON.stringify(value), x, y);
    } else {
        // Render primitive
        ctx.fillStyle = '#000';
        ctx.fillText(String(value), x, y);
    }
}
```

---

## Step 9: Cell Editing

When user clicks on existing cell:

```typescript
function handleCellClick(x: number, y: number) {
    const cellId = cellRegistry.getCellAt(x, y);
    if (!cellId) return;

    const cell = reactiveCellRuntime.getCell(cellId);
    if (!cell) return;

    // Enter edit mode
    enterCellEditMode(x, y, cell.code);
}

function enterCellEditMode(x: number, y: number, code: string) {
    // Set cursor to start of cell code
    setCursor(x + 2, y);  // After "> "

    // Select all cell code
    setSelection({
        startX: x + 2,
        startY: y,
        endX: x + 2 + code.length,
        endY: y
    });

    // On next Enter, re-execute cell
    cellEditMode = true;
}

function handleCellEdit(cellId: string, newCode: string) {
    // Re-execute cell with new code
    reactiveCellRuntime.executeCell(cellId, newCode);

    // Update worldData
    const pos = cellRegistry.getPositionOf(cellId);
    if (pos) {
        // Update text in worldData
        updateCellText(pos.x, pos.y, `> ${newCode}`);
    }
}
```

---

## Complete Example Flow

### User types a cell:

```
1. User at position (100, 50)
2. Types: "> data = [1, 2, 3]"
3. Hits Enter

worldData:
{
  "100,50": ">",
  "101,50": " ",
  "102,50": "d",
  "103,50": "a",
  "104,50": "t",
  "105,50": "a",
  ...
}

4. handleKeyPress detects Enter after ">"
5. Extracts line: "> data = [1, 2, 3]"
6. Creates cellId: "cell_100,50_1705555200000"
7. Registers cell: cellRegistry.registerCell(100, 50, cellId)
8. Executes: reactiveCellRuntime.executeCell(cellId, "data = [1, 2, 3]")

Inside executeCell:
  a. Parse: code = "data = [1, 2, 3]", name = "data"
  b. Dependencies: [] (no deps)
  c. Execute: evaluateSync("data = [1, 2, 3]", context)
  d. Result: [1, 2, 3]
  e. Store in scope: scope.set("data", [1, 2, 3])
  f. Cell status: 'fulfilled'

9. Canvas re-renders
10. renderCell called for (100, 50)
11. Draws:
    > data = [1, 2, 3]
    → [1, 2, 3]
```

### User types dependent cell:

```
1. User at position (100, 52)
2. Types: "> sum = data.reduce((a,b) => a + b)"
3. Hits Enter

4. Creates cellId: "cell_100,52_1705555205000"
5. Registers: cellRegistry.registerCell(100, 52, cellId)
6. Executes: reactiveCellRuntime.executeCell(cellId, "sum = data.reduce((a,b) => a + b)")

Inside executeCell:
  a. Parse: code = "sum = data.reduce((a,b) => a + b)", name = "sum"
  b. Extract dependencies: ["data"]
  c. Create context with scope: { data: [1, 2, 3], ... }
  d. Execute: evaluateSync("sum = data.reduce((a,b) => a + b)", context)
  e. Result: 6
  f. Store: scope.set("sum", 6)
  g. Cell status: 'fulfilled'

7. Canvas re-renders
8. Draws:
    > sum = data.reduce((a,b) => a + b)
    → 6
```

### User edits first cell:

```
1. User clicks on "> data = [1, 2, 3]"
2. Enters edit mode
3. Changes to: "> data = [1, 2, 3, 4, 5]"
4. Hits Enter

5. Re-executes first cell:
   a. Result: [1, 2, 3, 4, 5]
   b. scope.set("data", [1, 2, 3, 4, 5])

6. updateDependents finds "sum" depends on "data"
7. Re-executes sum cell:
   a. Result: 15 (1+2+3+4+5)
   b. scope.set("sum", 15)

8. Canvas re-renders both cells:
   > data = [1, 2, 3, 4, 5]
   → [1, 2, 3, 4, 5]

   > sum = data.reduce((a,b) => a + b)
   → 15
```

**All automatic. No "Run All" button.**

---

## File Structure

```
app/bitworld/
├── reactive-runtime.ts          # ReactiveCellRuntime class
├── cell-parser.ts               # parseCell, extractDependencies
├── cell-registry.ts             # CellRegistry class
├── canvas-components/
│   ├── CanvasCalendar.ts
│   ├── CanvasChart.ts
│   ├── CanvasTicker.ts
│   ├── CanvasTable.ts
│   └── CanvasSlider.ts
├── bit.canvas.tsx               # Modified to detect/render cells
└── world.engine.ts              # Modified to handle cell input
```

---

## Dependencies

```json
{
  "dependencies": {
    "acorn": "^8.11.3",           // JavaScript parser
    "acorn-walk": "^8.3.2"        // AST traversal
  }
}
```

---

## Security Considerations

### Sandboxing

```typescript
// Execute in restricted context
const context = {
  // Whitelist safe APIs only
  Math, Date, Array, Object,
  fetch,  // Already sandboxed by browser
  console,

  // Custom canvas APIs
  calendar, chart, ticker,

  // NO access to:
  // - window
  // - document
  // - eval
  // - Function (except our controlled version)
  // - localStorage
};

// Execute with new Function (safer than eval)
const fn = new Function(...Object.keys(context), code);
fn(...Object.values(context));
```

### Rate Limiting

```typescript
// Limit execution frequency
class ReactiveCellRuntime {
    private executionCount = 0;
    private executionWindow = Date.now();

    async executeCell(cellId: string, code: string) {
        // Reset counter every second
        if (Date.now() - this.executionWindow > 1000) {
            this.executionCount = 0;
            this.executionWindow = Date.now();
        }

        // Limit to 100 executions/second
        if (this.executionCount > 100) {
            throw new Error('Execution rate limit exceeded');
        }

        this.executionCount++;

        // ... execute
    }
}
```

---

## This Is The Infrastructure

**Text on canvas → Parser → Runtime → Canvas rendering**

All the pieces:
- ✅ **Acorn** parses JavaScript
- ✅ **AST traversal** extracts dependencies
- ✅ **Runtime** executes in controlled context
- ✅ **Dependency graph** triggers cascading updates
- ✅ **Canvas rendering** shows inputs and outputs

**It's Observable's reactive engine, adapted for spatial canvas.**

Want me to implement this? I can build:
1. Cell parser with Acorn
2. Basic reactive runtime
3. Simple rendering (text outputs)
4. Edit and re-execute flow

This would prove the architecture works before adding canvas components.

---

*Last updated: 2025-01-18*
*Version: 1.0 - Reactive Cell Infrastructure*
