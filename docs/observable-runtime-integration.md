# Observable Runtime Integration
## Using @observablehq/runtime Directly in bit.canvas

**Date:** 2025-01-18
**Insight:** Observable's runtime is pure JavaScript - we can use it directly!

---

## The Discovery

```javascript
// Observable Runtime is just a library!
import { Runtime, Inspector } from "@observablehq/runtime";

const runtime = new Runtime();
const module = runtime.module();

// Define reactive variables (like Observable cells)
module.variable().define("x", 10);
module.variable().define("y", ["x"], x => x * 2);

// Get value
const y = await module.value("y");  // → 20

// Update
module.redefine("x", 15);
// y automatically recalculates to 30
```

**This is Observable's actual reactive engine. It's portable!**

---

## Observable Runtime Architecture

### Core Components

```typescript
// 1. Runtime - The execution environment
const runtime = new Runtime(builtins, global);

// 2. Module - Namespace for variables (like a notebook)
const module = runtime.module();

// 3. Variable - Reactive cell
const variable = module.variable(observer);

// 4. Observer - Watches variable changes
const observer = {
  pending() { console.log("Computing..."); },
  fulfilled(value) { console.log("Result:", value); },
  rejected(error) { console.error("Error:", error); }
};
```

### How Reactivity Works

```javascript
// Define variables with dependencies
module.variable().define("data", [1, 2, 3, 4, 5]);

module.variable().define("sum", ["data"], (data) => {
  return data.reduce((a, b) => a + b, 0);
});

module.variable().define("average", ["sum", "data"], (sum, data) => {
  return sum / data.length;
});

// Dependency graph:
//   data
//    ↓
//   sum ──→ average
//    ↓
```

**When `data` changes → `sum` recomputes → `average` recomputes**

---

## Integration Strategy

### Approach 1: Use Observable Runtime Directly

```typescript
// In reactive-runtime.ts
import { Runtime } from "@observablehq/runtime";

class CanvasNotebookRuntime {
  private runtime: Runtime;
  private module: any;
  private observers = new Map<string, any>();

  constructor() {
    // Create Observable runtime with canvas-specific builtins
    this.runtime = new Runtime(this.createBuiltins());
    this.module = this.runtime.module();
  }

  createBuiltins() {
    return {
      // Canvas rendering helpers
      chart: (data, config) => new CanvasChart(data, config),
      calendar: (config) => new CanvasCalendar(config),
      ticker: (symbols) => new CanvasTicker(symbols),

      // Data libraries
      d3: d3,
      aq: arquero,

      // Utilities
      html: (strings, ...values) => renderHTML(strings, values),
      md: (strings, ...values) => renderMarkdown(strings, values),
    };
  }

  // Define a cell
  defineCell(name: string, inputs: string[], definition: Function) {
    const observer = this.createObserver(name);

    this.module.variable(observer).define(name, inputs, definition);
  }

  createObserver(name: string) {
    return {
      pending: () => {
        // Cell is computing
        this.updateCellStatus(name, 'running');
      },

      fulfilled: (value) => {
        // Cell computed successfully
        this.updateCellStatus(name, 'fulfilled');
        this.updateCellValue(name, value);

        // Trigger canvas re-render
        this.invalidateCanvas();
      },

      rejected: (error) => {
        // Cell error
        this.updateCellStatus(name, 'rejected');
        this.updateCellError(name, error);

        // Trigger canvas re-render
        this.invalidateCanvas();
      }
    };
  }

  // Redefine cell (user edited it)
  redefineCell(name: string, inputs: string[], definition: Function) {
    this.module.redefine(name, inputs, definition);
    // Observable runtime handles cascade automatically!
  }

  // Get cell value
  async getCellValue(name: string): Promise<any> {
    return await this.module.value(name);
  }
}
```

---

## Example: Observable Runtime on Canvas

### User Types Cells

```javascript
// Cell 1
> data = [1, 2, 3, 4, 5]

// Cell 2
> sum = data.reduce((a, b) => a + b)

// Cell 3
> average = sum / data.length
```

### Behind the Scenes

```typescript
// Parse "> data = [1, 2, 3, 4, 5]"
const parsed = parseCell("> data = [1, 2, 3, 4, 5]");
// → { name: "data", code: "[1, 2, 3, 4, 5]", dependencies: [] }

// Define with Observable runtime
runtime.defineCell("data", [], () => [1, 2, 3, 4, 5]);

// Parse "> sum = data.reduce((a, b) => a + b)"
const parsed2 = parseCell("> sum = data.reduce((a, b) => a + b)");
// → { name: "sum", code: "data.reduce((a, b) => a + b)", dependencies: ["data"] }

// Define with dependencies
runtime.defineCell("sum", ["data"], (data) => {
  return data.reduce((a, b) => a + b);
});

// Parse "> average = sum / data.length"
const parsed3 = parseCell("> average = sum / data.length");
// → { name: "average", dependencies: ["sum", "data"] }

runtime.defineCell("average", ["sum", "data"], (sum, data) => {
  return sum / data.length;
});
```

### User Edits Cell 1

```javascript
// User changes: > data = [1, 2, 3, 4, 5, 6]

// Redefine in Observable runtime
runtime.redefineCell("data", [], () => [1, 2, 3, 4, 5, 6]);

// Observable runtime automatically:
// 1. Recomputes "sum" (because it depends on "data")
// 2. Recomputes "average" (because it depends on "sum" and "data")
// 3. Calls observers for each (triggers canvas re-render)
```

**We don't manage dependencies manually. Observable does it!**

---

## Integration with Canvas

### Cell Rendering with Observable Runtime

```typescript
function renderCell(ctx: CanvasRenderingContext2D, cellId: string, x: number, y: number) {
  // Get cell data from Observable runtime
  const cellName = getCellName(cellId);

  runtime.module.value(cellName).then(value => {
    // Render cell input (code)
    ctx.fillStyle = '#666';
    ctx.fillText('> ' + getCellCode(cellId), x, y);

    // Render cell output (value)
    const outputY = y + charHeight * 1.5;
    ctx.fillStyle = '#000';

    if (value instanceof CanvasComponent) {
      // Render canvas component
      value.render(ctx, x, outputY);
    } else {
      // Render primitive value
      ctx.fillText('→ ' + JSON.stringify(value), x, outputY);
    }
  }).catch(error => {
    // Render error
    ctx.fillStyle = '#f00';
    ctx.fillText('→ Error: ' + error.message, x, y + charHeight * 1.5);
  });
}
```

---

## Advanced: Observable Standard Library

Observable provides a standard library with useful functions:

```bash
npm install @observablehq/stdlib
```

```javascript
import { Library } from "@observablehq/stdlib";

const library = new Library();

// Create runtime with stdlib
const runtime = new Runtime(library);

// Now cells have access to:
// - html`<b>Bold</b>`
// - md`# Markdown`
// - svg`<circle r="10" />`
// - tex`E = mc^2`
// - require("d3")
// - FileAttachment("data.csv")
// - width (reactive width)
// - Generators.input()
// - etc.
```

### Using stdlib in Canvas

```typescript
class CanvasNotebookRuntime {
  constructor() {
    // Use Observable's standard library
    const library = new Library({
      // Override resolvers for canvas context
      resolve: (name) => {
        // Resolve imports for canvas environment
        if (name === 'd3') return d3;
        if (name === 'arquero') return arquero;
        // etc.
      }
    });

    this.runtime = new Runtime(library);
    this.module = this.runtime.module();
  }
}
```

---

## Complete Example: Observable Runtime + Canvas

### Setup

```bash
npm install @observablehq/runtime @observablehq/stdlib
```

### Implementation

```typescript
// canvas-notebook.ts
import { Runtime, Library } from "@observablehq/runtime";

export class CanvasNotebook {
  private runtime: Runtime;
  private module: any;
  private cells = new Map<string, CellData>();

  constructor() {
    // Create library with canvas-specific functions
    const library = new Library();
    library.chart = (data, config) => new CanvasChart(data, config);
    library.calendar = (config) => new CanvasCalendar(config);

    this.runtime = new Runtime(library);
    this.module = this.runtime.module();
  }

  // Execute cell code
  executeCell(cellId: string, code: string, position: Point) {
    // Parse cell
    const parsed = this.parseCell(code);

    // Create observer for this cell
    const observer = {
      pending: () => {
        this.cells.get(cellId)!.status = 'running';
        this.requestCanvasRender();
      },

      fulfilled: (value) => {
        const cell = this.cells.get(cellId)!;
        cell.status = 'fulfilled';
        cell.value = value;
        this.requestCanvasRender();
      },

      rejected: (error) => {
        const cell = this.cells.get(cellId)!;
        cell.status = 'rejected';
        cell.error = error;
        this.requestCanvasRender();
      }
    };

    // Define variable in Observable runtime
    this.module.variable(observer).define(
      parsed.name,
      parsed.dependencies,
      parsed.definition
    );

    // Store cell metadata
    this.cells.set(cellId, {
      id: cellId,
      name: parsed.name,
      code: code,
      position: position,
      status: 'pending',
      dependencies: parsed.dependencies
    });
  }

  // Parse cell code into Observable format
  parseCell(code: string): ParsedCell {
    // Remove "> " prefix
    const cleanCode = code.replace(/^>\s*/, '');

    // Use Acorn to parse
    const ast = acorn.parse(cleanCode, { ecmaVersion: 2022 });

    // Extract variable name (if assignment)
    let name: string | undefined;
    let expression = cleanCode;

    if (ast.body[0]?.type === 'ExpressionStatement' &&
        ast.body[0].expression.type === 'AssignmentExpression') {
      name = ast.body[0].expression.left.name;
      expression = cleanCode.split('=')[1].trim();
    }

    // Extract dependencies (variables referenced)
    const dependencies = this.extractDependencies(cleanCode);

    // Create definition function
    const definition = new Function(...dependencies, `return (${expression})`);

    return { name, dependencies, definition };
  }

  extractDependencies(code: string): string[] {
    const ast = acorn.parse(code, { ecmaVersion: 2022 });
    const deps = new Set<string>();

    walk.simple(ast, {
      Identifier(node: any) {
        // Check if this identifier is a cell name we know about
        for (const [_, cell] of this.cells) {
          if (cell.name === node.name) {
            deps.add(node.name);
          }
        }
      }
    });

    return Array.from(deps);
  }

  // Get cell value (async)
  async getCellValue(cellName: string): Promise<any> {
    return await this.module.value(cellName);
  }

  // Redefine cell (when user edits)
  redefineCell(cellId: string, newCode: string) {
    const parsed = this.parseCell(newCode);

    this.module.redefine(
      parsed.name,
      parsed.dependencies,
      parsed.definition
    );

    // Update cell metadata
    const cell = this.cells.get(cellId)!;
    cell.code = newCode;
    cell.dependencies = parsed.dependencies;
  }

  requestCanvasRender() {
    if (typeof window !== 'undefined' && (window as any).__requestCanvasRender) {
      (window as any).__requestCanvasRender();
    }
  }
}

interface CellData {
  id: string;
  name?: string;
  code: string;
  position: Point;
  status: 'pending' | 'running' | 'fulfilled' | 'rejected';
  value?: any;
  error?: Error;
  dependencies: string[];
}

interface ParsedCell {
  name?: string;
  dependencies: string[];
  definition: Function;
}
```

---

## Usage Example

```typescript
// Create canvas notebook
const notebook = new CanvasNotebook();

// User types "> data = [1, 2, 3]"
notebook.executeCell('cell_1', '> data = [1, 2, 3]', { x: 100, y: 50 });

// User types "> sum = data.reduce((a,b) => a + b)"
notebook.executeCell('cell_2', '> sum = data.reduce((a,b) => a + b)', { x: 100, y: 53 });

// User types "> chart(data)"
notebook.executeCell('cell_3', '> chart(data)', { x: 100, y: 56 });

// Later, user edits cell_1 to "> data = [1, 2, 3, 4, 5]"
notebook.redefineCell('cell_1', '> data = [1, 2, 3, 4, 5]');

// Observable runtime automatically:
// - Recomputes cell_2 (sum)
// - Recomputes cell_3 (chart)
// - Calls observers (triggers canvas re-render)
```

---

## Benefits of Using Observable Runtime

### ✅ Proven Reactive System
- Battle-tested in thousands of Observable notebooks
- Handles edge cases (circular deps, async, errors)
- Well-documented behavior

### ✅ Automatic Dependency Tracking
```javascript
// We just define inputs
module.variable().define("y", ["x"], x => x * 2);

// Observable tracks that y depends on x
// When x changes, y recomputes automatically
```

### ✅ Built-in Standard Library
```javascript
// html, md, svg, tex, require, etc.
module.variable().define("content", html`<b>Bold</b>`);
```

### ✅ Observable Notebooks Compatible
```javascript
// Can even import published Observable notebooks!
import notebook from "@username/my-notebook";
const module = runtime.module(notebook);
```

### ✅ Lazy Evaluation
- Only computes cells that have observers
- Only computes dependencies when needed
- Efficient for large notebooks

---

## Recommended Architecture

```
User types: "> data = [1, 2, 3]"
     ↓
Parse with Acorn (extract name, deps, code)
     ↓
Define in Observable Runtime
     ↓
Observable handles reactivity
     ↓
Observer callbacks trigger canvas render
     ↓
Canvas shows: → [1, 2, 3]
```

**We handle:**
- Parsing (Acorn)
- Canvas rendering
- User input

**Observable handles:**
- Reactivity
- Dependency tracking
- Execution order
- Error handling
- Async/generators

---

## Next Steps

### Week 1: Basic Integration
```bash
npm install @observablehq/runtime @observablehq/stdlib acorn acorn-walk
```

```typescript
// Implement CanvasNotebook class
// Parse cells with Acorn
// Define in Observable runtime
// Render outputs to canvas
```

### Week 2: Standard Library
```typescript
// Add Observable stdlib
// Support html, md, tex
// Support require()
// Support Generators
```

### Week 3: Canvas Components
```typescript
// Custom canvas components
// chart(), calendar(), ticker()
// Integrate with Observable runtime
```

### Week 4: Advanced Features
```typescript
// Import published notebooks
// viewof for interactive inputs
// Generators for live data
```

---

## Conclusion

**Observable Runtime is just JavaScript. Use it!**

```javascript
import { Runtime } from "@observablehq/runtime";

// That's it. You have Observable's full power.
// No need to reimplement reactivity.
// Just parse cells and let Observable handle the rest.
```

**Architecture:**
```
Your code: Parse cells → Canvas rendering
Observable: Reactivity → Dependency tracking
```

**This is the pragmatic approach. Don't reinvent Observable's runtime - use it!**

---

*Last updated: 2025-01-18*
*Version: 1.0 - Observable Runtime Integration*
