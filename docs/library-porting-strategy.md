# Library Porting Strategy
## Shopping for and Adapting Existing Libraries to Canvas

**Date:** 2025-01-18
**Goal:** Don't reinvent the wheel - port existing libraries to canvas rendering

---

## The Pragmatic Approach

**Instead of building from scratch:**
```
❌ Write our own chart library (months of work)
❌ Write our own reactive system (weeks of work)
❌ Write our own data processing (weeks of work)
```

**Shop for existing libraries and port:**
```
✅ Find libraries that already work
✅ Adapt their output to canvas
✅ Build thin wrappers
✅ Ship faster
```

---

## Library Categories & Candidates

### 1. Data Visualization (Charts, Graphs)

#### **Option A: D3.js** ⭐⭐⭐⭐⭐
**Status:** Industry standard, mature, powerful

```javascript
// D3 does the math, we do the rendering
import * as d3 from 'd3';

// D3 handles: scales, layouts, data binding
const xScale = d3.scaleBand()
  .domain(data.map(d => d.name))
  .range([0, width]);

const yScale = d3.scaleLinear()
  .domain([0, d3.max(data, d => d.value)])
  .range([height, 0]);

// We render to canvas (not SVG)
data.forEach(d => {
  ctx.fillRect(
    xScale(d.name),
    yScale(d.value),
    xScale.bandwidth(),
    height - yScale(d.value)
  );
});
```

**Porting Effort:** ⭐⭐⭐ (LOW)
- D3 is rendering-agnostic
- It computes positions, you draw them
- Already separates data transform from rendering

**Libraries to check:**
- `d3-scale` - Scales and axes
- `d3-shape` - Line generators, area generators
- `d3-hierarchy` - Tree layouts, treemaps
- `d3-force` - Force-directed graphs
- `d3-geo` - Geographic projections

---

#### **Option B: Chart.js** ⭐⭐⭐
**Status:** Popular, simple API, already uses canvas

```javascript
// Chart.js already renders to canvas!
import Chart from 'chart.js/auto';

// Problem: Expects DOM canvas element
const chart = new Chart(canvasElement, {
  type: 'bar',
  data: { ... }
});

// Solution: Adapt to our spatial canvas
```

**Porting Effort:** ⭐⭐⭐⭐ (MEDIUM)
- Already uses canvas (good!)
- Expects DOM element (need adapter)
- Can extract rendering logic

**Adapter approach:**
```typescript
class ChartJsAdapter {
  constructor(config: ChartConfiguration) {
    // Create offscreen canvas
    this.offscreen = new OffscreenCanvas(width, height);

    // Chart.js renders to offscreen
    this.chart = new Chart(this.offscreen, config);
  }

  render(ctx: CanvasRenderingContext2D, x: number, y: number) {
    // Draw offscreen canvas to our canvas
    ctx.drawImage(this.offscreen, x, y);
  }

  update(newData: any) {
    this.chart.data = newData;
    this.chart.update();
  }
}
```

---

#### **Option C: Apache ECharts** ⭐⭐⭐⭐
**Status:** Feature-rich, supports canvas renderer

```javascript
import * as echarts from 'echarts';

// ECharts has canvas renderer built-in
const chart = echarts.init(null, null, {
  renderer: 'canvas',  // Use canvas (not SVG)
  width: 400,
  height: 300
});

chart.setOption({
  xAxis: { type: 'category', data: ['A', 'B', 'C'] },
  yAxis: { type: 'value' },
  series: [{ data: [120, 200, 150], type: 'bar' }]
});

// Get rendered canvas
const canvas = chart.getDom();
```

**Porting Effort:** ⭐⭐ (LOW-MEDIUM)
- Already has canvas renderer
- Can render headless
- Just need to composite into our canvas

---

#### **Option D: Plotly.js** ⭐⭐
**Status:** Powerful, uses SVG/WebGL

**Porting Effort:** ⭐⭐⭐⭐⭐ (HIGH)
- Expects DOM
- Complex architecture
- Better to use alternatives

---

### 2. Reactive Runtime (Observable-style)

#### **Option A: Observable Runtime** ⭐⭐⭐⭐⭐
**Status:** The actual Observable notebook runtime

```javascript
import { Runtime, Inspector } from "@observablehq/runtime";
import notebook from "@username/my-notebook";

// Observable's runtime is library-agnostic!
const runtime = new Runtime();
const main = runtime.module(notebook);

// Observe cell values
main.value("myVariable").then(value => {
  console.log("Cell value:", value);
});

// Redefine cells
main.redefine("data", [1, 2, 3, 4, 5]);
```

**Porting Effort:** ⭐⭐⭐ (MEDIUM)
- Already handles reactivity
- Need to adapt rendering to canvas
- Can use as dependency engine

**Adapter:**
```typescript
class ObservableAdapter {
  private runtime: Runtime;
  private module: any;

  async loadNotebook(notebookUrl: string) {
    const notebook = await import(notebookUrl);
    this.module = this.runtime.module(notebook);
  }

  async getCellValue(cellName: string): Promise<any> {
    return await this.module.value(cellName);
  }

  redefineCell(cellName: string, value: any) {
    this.module.redefine(cellName, value);
  }

  // Render cell outputs to canvas
  async renderCell(cellName: string, ctx: CanvasRenderingContext2D, x: number, y: number) {
    const value = await this.getCellValue(cellName);

    if (value instanceof HTMLElement) {
      // Convert DOM to canvas (html2canvas)
      await this.domToCanvas(value, ctx, x, y);
    } else {
      // Render primitive value as text
      ctx.fillText(String(value), x, y);
    }
  }
}
```

---

#### **Option B: MobX** ⭐⭐⭐⭐
**Status:** Popular reactivity library

```javascript
import { observable, autorun, computed } from "mobx";

const store = observable({
  count: 0,
  doubled: computed(() => store.count * 2)
});

// Auto-run when dependencies change
autorun(() => {
  console.log("Count:", store.count);
  console.log("Doubled:", store.doubled);
});

store.count = 5;  // Triggers autorun
```

**Porting Effort:** ⭐⭐ (LOW)
- Pure reactivity (no rendering)
- Easy to integrate
- Lightweight

---

#### **Option C: Vue Reactivity** ⭐⭐⭐⭐
**Status:** Vue 3's reactivity system (standalone)

```javascript
import { reactive, computed, watch } from '@vue/reactivity';

const state = reactive({
  count: 0,
  doubled: computed(() => state.count * 2)
});

watch(() => state.count, (newVal) => {
  console.log("Count changed:", newVal);
});

state.count = 5;  // Triggers watcher
```

**Porting Effort:** ⭐⭐ (LOW)
- Standalone package
- No UI coupling
- Modern API

---

### 3. Data Processing

#### **Option A: Arquero** ⭐⭐⭐⭐⭐
**Status:** Observable's dataframe library (like pandas)

```javascript
import * as aq from 'arquero';

const dt = aq.table({
  name: ['Alice', 'Bob', 'Charlie'],
  age: [25, 30, 35],
  city: ['NYC', 'SF', 'LA']
});

// Filter
const filtered = dt.filter(d => d.age > 28);

// Group by
const grouped = dt.groupby('city').rollup({ avg_age: d => aq.mean(d.age) });

// Join, pivot, etc.
```

**Porting Effort:** ⭐ (VERY LOW)
- Zero rendering
- Pure data transformation
- Works out of the box

---

#### **Option B: DuckDB-WASM** ⭐⭐⭐⭐⭐
**Status:** SQL database in browser

```javascript
import * as duckdb from '@duckdb/duckdb-wasm';

const db = await duckdb.selectBundle().instantiate();
const conn = await db.connect();

// Load data
await conn.insertArrowFromIPCStream(arrowData);

// Query
const result = await conn.query(`
  SELECT city, AVG(age) as avg_age
  FROM users
  GROUP BY city
`);
```

**Porting Effort:** ⭐ (VERY LOW)
- No rendering
- Pure compute
- Perfect for large datasets

---

### 4. Layout & Positioning

#### **Option A: Dagre** ⭐⭐⭐⭐
**Status:** Graph layout algorithm

```javascript
import dagre from 'dagre';

const g = new dagre.graphlib.Graph();
g.setGraph({});
g.setDefaultEdgeLabel(() => ({}));

// Add nodes
g.setNode("a", { width: 50, height: 50 });
g.setNode("b", { width: 50, height: 50 });
g.setEdge("a", "b");

// Compute layout
dagre.layout(g);

// Get positions
const nodeA = g.node("a");
console.log(nodeA.x, nodeA.y);  // Computed position
```

**Porting Effort:** ⭐ (VERY LOW)
- Pure layout math
- Returns x,y coordinates
- You render the result

---

#### **Option B: force-graph** ⭐⭐⭐
**Status:** Force-directed graph library

```javascript
import ForceGraph from 'force-graph';

// Expects canvas element, but...
const graph = ForceGraph()(canvasElement)
  .graphData(data);

// Can extract node positions
graph.getGraphData().nodes.forEach(node => {
  // node.x, node.y available
});
```

**Porting Effort:** ⭐⭐⭐ (MEDIUM)
- Uses canvas (good)
- Manages own canvas (need adapter)

---

### 5. Text Rendering & Formatting

#### **Option A: markdown-it** ⭐⭐⭐⭐⭐
**Status:** Markdown parser

```javascript
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt();
const html = md.render('# Hello\n\nThis is **bold**');

// Convert to canvas
// (Need to parse HTML and render primitives)
```

**Porting Effort:** ⭐⭐⭐ (MEDIUM)
- Outputs HTML
- Need to render HTML to canvas
- Or parse AST and render directly

---

#### **Option B: KaTeX** ⭐⭐⭐⭐
**Status:** Math typesetting

```javascript
import katex from 'katex';

const html = katex.renderToString("c = \\pm\\sqrt{a^2 + b^2}");

// Renders to HTML/MathML
// Need canvas renderer
```

**Porting Effort:** ⭐⭐⭐⭐ (HIGH)
- Complex layout
- Better to render to offscreen, then draw

---

### 6. Specialized Components

#### **Option A: FullCalendar** ⭐⭐
**Status:** Feature-rich calendar

**Porting Effort:** ⭐⭐⭐⭐⭐ (VERY HIGH)
- Heavy DOM dependency
- Better to build simple canvas calendar

---

#### **Option B: Handsontable** ⭐⭐⭐
**Status:** Excel-like data grid

**Porting Effort:** ⭐⭐⭐⭐⭐ (VERY HIGH)
- Complex interactions
- Better alternatives exist

---

## Recommended Stack

### Tier 1: Immediate Use (No Porting)

```json
{
  "d3": "^7.8.5",           // Data transforms, scales
  "arquero": "^5.3.0",      // Dataframes
  "@duckdb/duckdb-wasm": "^1.28.0",  // SQL queries
  "@vue/reactivity": "^3.4.0",  // Reactive system
  "acorn": "^8.11.3"        // JavaScript parsing
}
```

**These work out of the box. Zero porting needed.**

### Tier 2: Light Adaptation (Wrapper Needed)

```json
{
  "chart.js": "^4.4.0",     // Charts (offscreen canvas adapter)
  "echarts": "^5.4.3",      // Rich charts (canvas mode)
  "@observablehq/runtime": "^5.9.0",  // Reactivity engine
  "dagre": "^0.8.5"         // Graph layout
}
```

**Need thin wrappers to integrate with spatial canvas.**

### Tier 3: Consider Alternatives

```json
{
  "plotly.js": "❌ Too DOM-heavy",
  "handsontable": "❌ Build simple table instead",
  "fullcalendar": "❌ Build simple calendar instead"
}
```

---

## Porting Patterns

### Pattern 1: Pure Computation Libraries (Easy)

```typescript
// Library does math, we render
import * as d3 from 'd3';

const yScale = d3.scaleLinear()
  .domain([0, 100])
  .range([0, 200]);

// Just use the result
const y = yScale(50);  // → 100
ctx.fillRect(x, y, width, height);
```

**Examples:** D3, Arquero, DuckDB, Dagre

---

### Pattern 2: Canvas Libraries (Medium)

```typescript
// Library already uses canvas, extract it
import Chart from 'chart.js/auto';

class ChartJsAdapter {
  private offscreen = new OffscreenCanvas(400, 300);
  private chart: Chart;

  constructor(config: any) {
    this.chart = new Chart(this.offscreen, config);
  }

  renderTo(ctx: CanvasRenderingContext2D, x: number, y: number) {
    // Draw offscreen to our canvas
    ctx.drawImage(this.offscreen, x, y);
  }

  update(newData: any) {
    this.chart.data = newData;
    this.chart.update();
  }
}
```

**Examples:** Chart.js, ECharts, force-graph

---

### Pattern 3: DOM Libraries (Hard - Use html2canvas)

```typescript
// Library expects DOM, render to image
import html2canvas from 'html2canvas';

async function domToCanvas(element: HTMLElement, ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Render DOM to canvas offscreen
  const canvas = await html2canvas(element, {
    backgroundColor: null,
    scale: window.devicePixelRatio
  });

  // Draw to our canvas
  ctx.drawImage(canvas, x, y);
}
```

**Examples:** Observable cells with DOM output, complex widgets

**Better alternative:** Build canvas-native version instead

---

## Implementation Strategy

### Phase 1: Core Data Stack (Week 1)

```bash
npm install d3 arquero @vue/reactivity acorn
```

```typescript
// Reactive cells with Vue reactivity
import { reactive, watch } from '@vue/reactivity';

const scope = reactive({
  data: [1, 2, 3],
  sum: 0
});

watch(() => scope.data, (newData) => {
  scope.sum = newData.reduce((a, b) => a + b, 0);
});

// D3 for visualization
import * as d3 from 'd3';

const yScale = d3.scaleLinear()
  .domain([0, d3.max(scope.data)])
  .range([0, 100]);

// Render to canvas
scope.data.forEach((value, i) => {
  const y = yScale(value);
  ctx.fillRect(i * 20, y, 15, 100 - y);
});
```

---

### Phase 2: Charts (Week 2)

```bash
npm install chart.js echarts
```

```typescript
// Chart.js adapter
import { ChartJsAdapter } from './adapters/chartjs';

const chart = new ChartJsAdapter({
  type: 'bar',
  data: {
    labels: ['A', 'B', 'C'],
    datasets: [{
      data: [10, 20, 30]
    }]
  }
});

// Render to spatial canvas
chart.renderTo(ctx, worldX, worldY);
```

---

### Phase 3: Observable Runtime (Week 3)

```bash
npm install @observablehq/runtime
```

```typescript
// Use Observable's reactivity engine
import { Runtime } from '@observablehq/runtime';

const runtime = new Runtime();
const module = runtime.module();

// Define reactive cells
module.variable().define("data", [1, 2, 3]);
module.variable().define("sum", ["data"], data =>
  data.reduce((a, b) => a + b)
);

// Get values
const sum = await module.value("sum");  // → 6

// Redefine triggers cascade
module.redefine("data", [1, 2, 3, 4, 5]);
// sum automatically recalculates to 15
```

---

### Phase 4: Advanced Features (Week 4+)

```bash
npm install @duckdb/duckdb-wasm dagre katex
```

---

## Example: Complete D3 Chart

```typescript
// Cell-based D3 chart
import * as d3 from 'd3';
import * as aq from 'arquero';

// Cell 1: Load and process data
> dt = aq.table({
    month: ['Jan', 'Feb', 'Mar'],
    revenue: [10000, 15000, 12000]
  })
→ Table (3 rows)

// Cell 2: D3 scales
> xScale = d3.scaleBand()
    .domain(dt.array('month'))
    .range([0, 300])
    .padding(0.1)
→ function xScale

> yScale = d3.scaleLinear()
    .domain([0, d3.max(dt.array('revenue'))])
    .range([200, 0])
→ function yScale

// Cell 3: Render to canvas
> chart = new CanvasChart({
    data: dt,
    xScale: xScale,
    yScale: yScale
  })
→ [Bar chart renders]

// Cell 4: Add interactivity
> viewof selectedBar = chart.addSelection()
→ [Click bars to select]

// Cell 5: React to selection
> selectedData = dt.filter(d => d.month === selectedBar)
→ [Updates when bar clicked]
```

---

## Shopping List Priority

### Buy Now (Essential)
1. **d3** - Industry standard, works immediately
2. **@vue/reactivity** - Lightweight reactive system
3. **arquero** - Data processing
4. **acorn** - JavaScript parsing (for cells)

### Buy Soon (High Value)
5. **chart.js** - Quick charts with adapter
6. **@observablehq/runtime** - Full Observable power
7. **@duckdb/duckdb-wasm** - SQL for big data

### Consider Later (Nice to Have)
8. **echarts** - Rich charting (if Chart.js insufficient)
9. **dagre** - Graph layouts
10. **katex** - Math rendering

### Don't Buy (Build Instead)
- ❌ DOM-heavy UI frameworks
- ❌ Complex data grids
- ❌ Calendar widgets

**Build simple canvas versions for these.**

---

## Conclusion

**Don't reinvent wheels. Port smartly:**

```
✅ Use D3 for computation (works today)
✅ Use Arquero for data (works today)
✅ Use Vue reactivity for state (works today)
✅ Wrap Chart.js for quick charts (1 day work)
✅ Consider Observable runtime (1 week work)

❌ Don't port DOM-heavy libraries
❌ Build simple canvas components instead
```

**Start with Tier 1 libraries (zero porting). Add Tier 2 as needed.**

---

*Last updated: 2025-01-18*
*Version: 1.0 - Library Porting Strategy*
