# Reactive Canvas Cells
## Observable-Style Notebooks Native to bit.canvas

**Date:** 2025-01-18
**Inspiration:** Observable notebooks - reactive, visual, canvas-native

---

## The Observable Model

### How Observable Works

```javascript
// Cell 1
data = [1, 2, 3, 4, 5]

// Cell 2 (depends on data)
sum = data.reduce((a, b) => a + b, 0)

// Cell 3 (depends on sum)
md`The sum is ${sum}`
```

**Key properties:**
1. **Reactive** - When `data` changes, `sum` recalculates automatically
2. **Visual** - Each cell shows its output immediately
3. **Named** - Cells bind to variable names (`data`, `sum`)
4. **Dependency graph** - Runtime tracks what depends on what
5. **No explicit "run"** - Edit a cell, dependencies update automatically

---

## Reactive Cells in bit.canvas

### Visual Syntax (On Canvas)

```
Regular text on canvas...

> data = [10, 20, 30, 40, 50]
→ [10, 20, 30, 40, 50]                    ← Output appears below

> sum = data.reduce((a, b) => a + b)
→ 150

> average = sum / data.length
→ 30

More text here...

> chart(data)
→ ┌────────────┐
  │ 50│     █   │                         ← Chart renders to canvas
  │ 40│   █ █   │
  │ 30│ █ █ █   │
  │ 20│ █ █ █   │
  │ 10│ █ █ █ █ │
  └────────────┘
```

**Everything is just text on the canvas.** The `>` prefix makes it executable.

---

## Cell Types

### 1. Expression Cells

```
> 2 + 2
→ 4

> Math.random()
→ 0.7234...

> new Date()
→ Sat Jan 18 2025 14:32:00 GMT-0800
```

### 2. Assignment Cells (Named)

```
> width = 20
→ 20

> height = 15
→ 15

> area = width * height
→ 300
```

**These create reactive variables** available to other cells.

### 3. Block Cells (Multi-line)

```
> {
    const data = await fetch('/api/stocks/AAPL');
    const json = await data.json();
    return json.price;
  }
→ 178.32
```

Or with implicit return:

```
> {
    const response = await fetch('/api/stocks/AAPL');
    response.json()
  }
→ { symbol: "AAPL", price: 178.32, change: 2.15 }
```

### 4. Component Cells (Render to Canvas)

```
> calendar({
    date: new Date(),
    theme: 'light'
  })
→ ┌──────────────────┐
  │   January 2025   │
  │ Su Mo Tu We Th Fr│  ← Canvas-rendered calendar
  │  1  2  3  4  5  6│
  │  7  8  9 10 11 12│
  └──────────────────┘
```

### 5. Import Cells

```
> d3 = require('d3@7')
→ {version: "7.8.5", select: ƒ, ...}

> Plot = import('https://cdn.observablehq.com/@observablehq/plot')
→ {plot: ƒ, ...}
```

---

## Reactivity: The Core Feature

### Simple Dependency

```
> x = 10
→ 10

> y = x * 2
→ 20

> z = y + 5
→ 25
```

**User edits first cell:**
```
> x = 15         ← Changed
→ 15

> y = x * 2      ← Auto-recalculates
→ 30             ← Updated

> z = y + 5      ← Auto-recalculates
→ 35             ← Updated
```

**No "Run All" button needed. Dependencies update automatically.**

### Live Data Cells

```
> stock = {
    while (true) {
      const data = await fetch('/api/stocks/AAPL');
      yield data.json();
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
→ { symbol: "AAPL", price: 178.32, change: 2.15 }
  ↻ Updates every 5s

> price = stock.price
→ 178.32
  ↻ Updates when stock updates

> priceDisplay = `AAPL: $${price.toFixed(2)}`
→ "AAPL: $178.32"
  ↻ Updates when price updates
```

**Generators create live cells** that update continuously.

### Viewof (Interactive Inputs)

```
> viewof count = slider({ min: 0, max: 100, value: 50 })
→ [========●========] 50        ← Interactive slider on canvas

> doubled = count * 2
→ 100

> display = `Count: ${count}, Doubled: ${doubled}`
→ "Count: 50, Doubled: 100"
```

**User drags slider → `count` updates → `doubled` recalculates → `display` updates**

All reactive, all on canvas.

---

## Canvas-Native Rendering

### Text Output (Default)

```
> "Hello, world!"
→ Hello, world!

> 42
→ 42

> [1, 2, 3]
→ [1, 2, 3]

> { name: "Alice", age: 30 }
→ {name: "Alice", age: 30}
```

### Rich Display

```
> html`<strong>Bold text</strong>`
→ Bold text                              ← Rendered with canvas text styling

> md`# Heading
     This is **markdown**`
→ Heading                                ← Rendered as styled text
  This is markdown
```

### Canvas Components

```
> calendar()
→ ┌──────────────────┐
  │   January 2025   │                  ← Rendered to canvas pixels
  │ Su Mo Tu We Th Fr│
  │  1  2  3  4  5  6│
  └──────────────────┘

> chart([10, 20, 30])
→ ┌────────────┐
  │ 30│       █ │
  │ 20│     █ █ │                        ← Canvas-rendered chart
  │ 10│   █ █ █ │
  └────────────┘

> ticker(['AAPL', 'GOOGL'])
→ ┌──────────────────┐
  │ AAPL  $178.32 ↑  │
  │ GOOGL $141.23 ↓  │                  ← Live-updating widget
  └──────────────────┘
```

### Data Tables

```
> data = [
    { name: "Alice", age: 30 },
    { name: "Bob", age: 25 },
    { name: "Charlie", age: 35 }
  ]
→ ┌─────────┬─────┐
  │ name    │ age │
  ├─────────┼─────┤
  │ Alice   │ 30  │                      ← Canvas table
  │ Bob     │ 25  │
  │ Charlie │ 35  │
  └─────────┴─────┘

> table(data)  // or explicit
```

---

## Implementation Architecture

### Cell Structure

```typescript
interface CanvasCell {
    id: string;
    position: { x: number; y: number };

    // Source code
    code: string;

    // Execution state
    status: 'pending' | 'running' | 'fulfilled' | 'rejected';
    value: any;              // Last computed value
    error?: Error;

    // Reactivity
    name?: string;           // Variable name (if assignment)
    dependencies: Set<string>;  // Variables this cell depends on
    dependents: Set<string>;    // Cells that depend on this

    // Display
    outputType: 'text' | 'component' | 'table' | 'error';
    outputBounds?: { startX: number; startY: number; endX: number; endY: number };

    // Live cells
    generator?: AsyncGenerator;
    updateInterval?: number;
}
```

### Runtime Engine

```typescript
class ReactiveCellRuntime {
    private cells: Map<string, CanvasCell> = new Map();
    private scope: Map<string, any> = new Map();  // Global reactive scope

    // Add or update a cell
    async defineCell(cellId: string, code: string, position: Point) {
        const cell = this.parseCell(code);
        cell.id = cellId;
        cell.position = position;

        // Analyze dependencies
        cell.dependencies = this.extractDependencies(code);

        // Execute cell
        await this.executeCell(cell);

        // Update dependent cells
        await this.updateDependents(cell);

        this.cells.set(cellId, cell);
    }

    // Execute a single cell
    async executeCell(cell: CanvasCell) {
        cell.status = 'running';

        try {
            // Create execution context with reactive scope
            const context = this.createContext(cell);

            // Execute code
            const result = await this.evaluate(cell.code, context);

            // Handle different result types
            if (this.isGenerator(result)) {
                cell.generator = result;
                cell.value = await result.next();  // Get first value
                this.scheduleLiveUpdate(cell);
            } else {
                cell.value = result;
            }

            // If this is an assignment, add to scope
            if (cell.name) {
                this.scope.set(cell.name, cell.value);
            }

            cell.status = 'fulfilled';
        } catch (error) {
            cell.error = error;
            cell.status = 'rejected';
        }

        // Trigger canvas re-render
        this.invalidateCell(cell);
    }

    // Extract variable dependencies from code
    extractDependencies(code: string): Set<string> {
        const deps = new Set<string>();

        // Parse code to find variable references
        const ast = parseJavaScript(code);

        traverse(ast, {
            Identifier(node) {
                if (this.scope.has(node.name)) {
                    deps.add(node.name);
                }
            }
        });

        return deps;
    }

    // When a cell updates, recompute dependents
    async updateDependents(cell: CanvasCell) {
        if (!cell.name) return;

        // Find all cells that depend on this cell's variable
        const dependents = Array.from(this.cells.values())
            .filter(c => c.dependencies.has(cell.name!));

        // Recompute in topological order
        for (const dependent of dependents) {
            await this.executeCell(dependent);
            await this.updateDependents(dependent);  // Cascade
        }
    }

    // Create execution context
    createContext(cell: CanvasCell): any {
        return {
            // Reactive scope (all named cell values)
            ...Object.fromEntries(this.scope),

            // Canvas APIs
            calendar: (props) => new CanvasCalendar(props),
            chart: (data) => new CanvasChart(data),
            ticker: (symbols) => new CanvasTicker(symbols),
            table: (data) => new CanvasTable(data),

            // Utilities
            html: (strings, ...values) => renderHTML(strings, values),
            md: (strings, ...values) => renderMarkdown(strings, values),

            // Data fetching
            fetch: fetch,
            require: (module) => importModule(module),

            // Observable helpers
            viewof: (component) => createInteractive(component),
            slider: (config) => new CanvasSlider(config),
        };
    }

    // Live cell updates (for generators)
    async scheduleLiveUpdate(cell: CanvasCell) {
        if (!cell.generator) return;

        // Pull next value periodically
        const update = async () => {
            const result = await cell.generator!.next();

            if (!result.done) {
                cell.value = result.value;

                // Update scope
                if (cell.name) {
                    this.scope.set(cell.name, cell.value);
                }

                // Trigger dependents
                await this.updateDependents(cell);

                // Invalidate for re-render
                this.invalidateCell(cell);

                // Schedule next update
                setTimeout(update, cell.updateInterval || 1000);
            }
        };

        update();
    }
}
```

### Canvas Rendering Integration

```typescript
// In bit.canvas.tsx render loop
function renderCellLayer(ctx: CanvasRenderingContext2D) {
    const cells = reactiveCellRuntime.getCells();

    for (const cell of cells) {
        // Render cell code (input)
        renderCellInput(ctx, cell);

        // Render cell output
        renderCellOutput(ctx, cell);
    }
}

function renderCellInput(ctx: CanvasRenderingContext2D, cell: CanvasCell) {
    const { x, y } = worldToScreen(cell.position.x, cell.position.y);

    // Cell prefix
    ctx.fillStyle = '#666';
    ctx.fillText('>', x, y);

    // Cell code
    ctx.fillStyle = cell.status === 'running' ? '#00f' : '#000';
    ctx.fillText(cell.code, x + 10, y);

    // Status indicator
    if (cell.status === 'running') {
        // Spinner
        renderSpinner(ctx, x - 5, y);
    } else if (cell.status === 'rejected') {
        // Error indicator
        ctx.fillStyle = '#f00';
        ctx.fillText('✗', x - 5, y);
    } else if (cell.generator) {
        // Live cell indicator
        ctx.fillStyle = '#0f0';
        ctx.fillText('↻', x - 5, y);
    }
}

function renderCellOutput(ctx: CanvasRenderingContext2D, cell: CanvasCell) {
    const outputY = cell.position.y + 2;  // 2 lines below input
    const { x, y } = worldToScreen(cell.position.x, outputY);

    if (cell.status === 'rejected') {
        // Render error
        ctx.fillStyle = '#f00';
        ctx.fillText(`→ Error: ${cell.error?.message}`, x, y);
        return;
    }

    if (cell.status !== 'fulfilled') {
        return;  // Not ready yet
    }

    // Render based on value type
    if (cell.value instanceof CanvasComponent) {
        // Render component to canvas
        cell.value.render(ctx, { x, y });
    } else if (Array.isArray(cell.value) && cell.value.length > 0 && typeof cell.value[0] === 'object') {
        // Render as table
        renderTable(ctx, cell.value, { x, y });
    } else {
        // Render as text
        const valueStr = JSON.stringify(cell.value);
        ctx.fillStyle = '#666';
        ctx.fillText('→ ', x, y);
        ctx.fillStyle = '#000';
        ctx.fillText(valueStr, x + 15, y);
    }
}
```

---

## User Interaction Flow

### Creating a Cell

```
1. User types on canvas: ">█"

2. System recognizes cell prefix
   → Switches to cell mode
   → Shows syntax highlighting
   → Enables autocomplete

3. User types: "> data = [1, 2, 3]█"

4. User hits Enter
   → Cell executes immediately
   → Output appears below:

> data = [1, 2, 3]
→ [1, 2, 3]

5. Cursor moves to next line (ready for new cell or text)
```

### Editing a Cell

```
1. User clicks on existing cell:
   > data = [1, 2, 3]
   → [1, 2, 3]

2. Cell enters edit mode:
   > data = [1, 2, 3, 4, 5]█
   → [1, 2, 3]  (old output, grayed)

3. User hits Enter
   → Cell re-executes
   → Output updates:

   > data = [1, 2, 3, 4, 5]
   → [1, 2, 3, 4, 5]

   → All dependent cells recalculate automatically
```

### Cell Dependencies Update

```
> x = 10
→ 10

> y = x * 2
→ 20

> z = y + 5
→ 25

User edits x:
> x = 15█

Hits Enter:
> x = 15
→ 15

> y = x * 2      ← Automatically recalculates
→ 30             ← Updated (no user action)

> z = y + 5      ← Automatically recalculates
→ 35             ← Updated (no user action)
```

---

## Advanced Examples

### Stock Dashboard

```
> stocks = {
    while (true) {
      const data = await fetch('/api/stocks');
      yield data.json();
      await sleep(5000);
    }
  }
→ {AAPL: 178.32, GOOGL: 141.23, MSFT: 420.50}
  ↻

> prices = stocks
→ {AAPL: 178.32, GOOGL: 141.23, MSFT: 420.50}
  ↻

> ticker(prices)
→ ┌────────────────────────┐
  │ AAPL  $178.32 ↑ +2.5%  │
  │ GOOGL $141.23 ↓ -1.2%  │
  │ MSFT  $420.50 ↑ +0.8%  │
  └────────────────────────┘
  ↻

> chart(Object.values(prices))
→ [Chart updates live as prices change]
  ↻
```

### Interactive Filter

```
> data = [
    { name: "Alice", age: 30, city: "SF" },
    { name: "Bob", age: 25, city: "NYC" },
    { name: "Charlie", age: 35, city: "SF" }
  ]
→ [3 items]

> viewof city = select(['All', 'SF', 'NYC'])
→ [All ▼]  SF  NYC        ← Interactive dropdown

> filtered = city === 'All'
    ? data
    : data.filter(d => d.city === city)
→ [3 items]

> table(filtered)
→ ┌─────────┬─────┬──────┐
  │ name    │ age │ city │
  ├─────────┼─────┼──────┤
  │ Alice   │ 30  │ SF   │
  │ Bob     │ 25  │ NYC  │
  │ Charlie │ 35  │ SF   │
  └─────────┴─────┴──────┘

// User selects "SF" from dropdown
// → filtered recalculates
// → table updates to show only SF entries
```

### Data Pipeline

```
> raw = await fetch('/api/sales-data')
→ [1000 items]

> cleaned = raw.filter(d => d.revenue > 0)
→ [987 items]

> byRegion = d3.group(cleaned, d => d.region)
→ Map(4) {"West" => [...], "East" => [...], ...}

> regionSummary = Array.from(byRegion, ([region, items]) => ({
    region,
    total: d3.sum(items, d => d.revenue),
    count: items.length
  }))
→ [{region: "West", total: 1500000, count: 245}, ...]

> chart(regionSummary.map(d => d.total))
→ [Bar chart showing revenue by region]
```

---

## Differences from Observable

### Observable HQ (Web)
- Runs in browser
- Each cell is a `<div>`
- Uses DOM for rendering
- JavaScript only

### bit.canvas (Canvas-Native)
- Runs in canvas
- Each cell is text + canvas rendering
- Uses Canvas 2D for all output
- JavaScript + canvas components

### Similarities
- Reactive dependencies
- Live generators
- Named cells
- Implicit returns
- Rich outputs

---

## Built-in Canvas Components

```typescript
// Calendar
> calendar({ date: new Date(), theme: 'light' })

// Stock ticker
> ticker(['AAPL', 'GOOGL', 'MSFT'])

// Chart
> chart([10, 20, 30, 40], { type: 'line' })

// Table
> table([{a: 1, b: 2}, {a: 3, b: 4}])

// Kanban
> kanban({
    columns: ['Todo', 'Doing', 'Done'],
    tasks: [...]
  })

// Input widgets
> viewof value = slider({ min: 0, max: 100 })
> viewof text = input({ placeholder: 'Enter text' })
> viewof choice = select(['A', 'B', 'C'])
> viewof checked = checkbox({ label: 'Enable' })
```

All render to canvas pixels.

---

## Persistence

### Cells Save to worldData

```typescript
// worldData structure
{
  "cell_100,50_data": {
    "type": "reactive-cell",
    "startX": 100,
    "startY": 50,
    "code": "data = [1, 2, 3, 4, 5]",
    "name": "data",
    "timestamp": 1705555200000
  },

  "cell_100,53_sum": {
    "type": "reactive-cell",
    "startX": 100,
    "startY": 53,
    "code": "sum = data.reduce((a, b) => a + b)",
    "name": "sum",
    "dependencies": ["data"],
    "timestamp": 1705555205000
  }
}
```

### Restoration on Load

```typescript
// On page load, restore cells in dependency order
async function restoreCells(worldData: WorldData) {
    const cells = extractCells(worldData);
    const sorted = topologicalSort(cells);  // Dependency order

    for (const cell of sorted) {
        await reactiveCellRuntime.defineCell(
            cell.id,
            cell.code,
            cell.position
        );
    }
}
```

---

## Command Integration

```typescript
// /cell - Create new cell at cursor
if (commandToExecute.startsWith('cell')) {
    const cellCode = args.rest;  // Code after "cell"

    await reactiveCellRuntime.defineCell(
        `cell_${cursorPos.x},${cursorPos.y}_${Date.now()}`,
        cellCode,
        cursorPos
    );
}

// Usage:
// /cell data = [1, 2, 3]
// → Creates cell at cursor
```

---

## This Is It

**Observable-style reactive cells, native to canvas.**

Type `> code` anywhere on the infinite canvas:
- Executes immediately
- Output renders to canvas pixels
- Dependencies update automatically
- Live generators for real-time data
- Canvas components for rich visualization

**It's spatial Observable.**

---

*Last updated: 2025-01-18*
*Version: 1.0 - Reactive Canvas Cells*
