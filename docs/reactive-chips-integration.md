# Reactive Chips Integration
## Making Labels, Tasks, and Links Work Like Observable Cells

**Date:** 2025-01-18
**Goal:** Bridge existing smart chips (labels, tasks, links) with reactive cell system

---

## Current Smart Chips

Your existing chips from the codebase:

```typescript
// Labels
label_100,50 = {
  type: 'landmark',
  text: 'Revenue Data',
  color: '#00ff00',
  startX: 100,
  endX: 115,
  startY: 50,
  endY: 52
}

// Tasks
task_200,60 = {
  type: 'task',
  text: 'Complete Q1 report',
  completed: false,
  startX: 200,
  endX: 225,
  startY: 60,
  endY: 62
}

// Links
link_300,70 = {
  type: 'link',
  url: 'https://example.com',
  text: 'Source',
  startX: 300,
  endX: 310,
  startY: 70,
  endY: 72
}
```

---

## Making Chips Reactive

### Concept: Chips as Named Values

```javascript
// In Observable:
viewof count = slider({ min: 0, max: 100, value: 50 })

// In bit.canvas with chips:
> viewof revenue = label('Revenue Data', { color: 'green' })
→ Revenue Data  ← Label appears on canvas

// Now `revenue` is a reactive variable
> total = revenue * 1.2
→ [updates when label is edited]
```

**The label becomes a reactive cell that other cells can depend on.**

---

## Implementation Strategy

### 1. Extend Label Creation to Support Binding

```typescript
// Current label creation (via /label command)
/label Revenue Data

// NEW: Create reactive label
> viewof revenue = label('Revenue Data', {
    color: 'green',
    editable: true,
    type: 'number',
    initialValue: 10000
  })
→ Revenue Data: 10000  ← Label with editable value
```

### 2. Label as Cell Output

When you execute `> viewof revenue = label(...)`:

```typescript
class ReactiveCellRuntime {
  async executeCell(cellId: string, code: string) {
    // Parse code
    const parsed = parseCell(code);

    // Check if this is a viewof assignment
    if (code.includes('viewof')) {
      // Extract: viewof revenue = label(...)
      const match = code.match(/viewof\s+(\w+)\s*=\s*(.+)/);
      const varName = match[1];  // 'revenue'
      const expression = match[2];  // label(...)

      // Execute to create component
      const component = this.evaluateSync(expression, this.createContext());

      // Component is a label/chip with interactive value
      if (component instanceof CanvasLabel) {
        // Store component
        cell.value = component;
        cell.name = varName;

        // Store initial value in scope
        this.scope.set(varName, component.getValue());

        // Set up listener for changes
        component.onChange((newValue) => {
          // Update scope
          this.scope.set(varName, newValue);

          // Trigger dependent cells
          this.updateDependents(cell);
        });
      }
    }

    // ... normal execution
  }
}
```

### 3. Interactive Label Component

```typescript
class CanvasLabel implements CanvasComponent {
  private value: any;
  private listeners: ((value: any) => void)[] = [];

  constructor(
    text: string,
    config: {
      editable?: boolean;
      type?: 'text' | 'number' | 'boolean';
      initialValue?: any;
      color?: string;
    }
  ) {
    this.text = text;
    this.value = config.initialValue;
    this.editable = config.editable ?? true;
    this.type = config.type ?? 'text';
    this.color = config.color ?? '#00ff00';
  }

  getValue(): any {
    return this.value;
  }

  setValue(newValue: any) {
    this.value = newValue;

    // Notify listeners (reactive system)
    this.listeners.forEach(fn => fn(newValue));
  }

  onChange(callback: (value: any) => void) {
    this.listeners.push(callback);
  }

  render(ctx: CanvasRenderingContext2D, viewport: Viewport) {
    // Render label chip
    const screenPos = worldToScreen(this.bounds.startX, this.bounds.startY);

    // Background
    ctx.fillStyle = this.color;
    ctx.fillRect(screenPos.x, screenPos.y, width, height);

    // Text
    ctx.fillStyle = '#000';
    ctx.fillText(`${this.text}: ${this.value}`, screenPos.x + 5, screenPos.y + 15);
  }

  handleClick(worldX: number, worldY: number) {
    if (!this.editable) return;

    // Enter edit mode
    this.enterEditMode();
  }

  enterEditMode() {
    // Show input overlay (or inline editing)
    const newValue = prompt(`Edit ${this.text}:`, String(this.value));

    if (newValue !== null) {
      // Parse based on type
      const parsed = this.type === 'number'
        ? parseFloat(newValue)
        : newValue;

      this.setValue(parsed);
    }
  }
}
```

---

## Example Use Cases

### Use Case 1: Editable Revenue Label

```javascript
// Create interactive label
> viewof revenue = label('Revenue', {
    type: 'number',
    initialValue: 10000,
    color: 'green'
  })
→ Revenue: 10000  ← Editable label chip

// Use in calculations
> tax = revenue * 0.3
→ 3000

> profit = revenue - tax
→ 7000

// User clicks label, edits to 15000
// → tax recalculates to 4500
// → profit recalculates to 10500
```

**The label is both visual AND a reactive variable.**

### Use Case 2: Task Completion Triggers

```javascript
// Create task chip
> viewof taskDone = task('Complete Q1 report')
→ ☐ Complete Q1 report  ← Checkbox task

// React to completion
> status = taskDone ? 'Report is done!' : 'Still working...'
→ "Still working..."

// User clicks checkbox
// → taskDone becomes true
// → status recalculates to "Report is done!"
```

### Use Case 3: Slider for Parameters

```javascript
// Create slider chip
> viewof count = slider({ min: 0, max: 100, value: 50 })
→ [========●========] 50  ← Interactive slider

// Use in calculations
> doubled = count * 2
→ 100

> display = `Count: ${count}, Doubled: ${doubled}`
→ "Count: 50, Doubled: 100"

// User drags slider to 75
// → count becomes 75
// → doubled recalculates to 150
// → display recalculates to "Count: 75, Doubled: 150"
```

---

## Integration with Existing Label System

### Current Label Creation (commands.ts)

```typescript
// Existing /label command
if (commandToExecute.startsWith('label')) {
  const labelText = args.rest;
  const labelColor = args.arg2 || '#00ff00';

  const labelKey = `label_${cursorPos.x},${cursorPos.y}`;
  const labelData = {
    type: 'landmark',
    text: labelText,
    color: labelColor,
    startX: cursorPos.x,
    endX: cursorPos.x + labelText.length,
    startY: cursorPos.y,
    endY: cursorPos.y + 2
  };

  setWorldData({ ...worldData, [labelKey]: JSON.stringify(labelData) });
}
```

### NEW: Reactive Label via Cell

```typescript
// Cell-based label creation
// User types: > viewof revenue = label('Revenue', { type: 'number', value: 10000 })

class ReactiveCellRuntime {
  createContext() {
    return {
      // Existing context...

      // NEW: Component factories
      label: (text: string, config: any = {}) => {
        return new CanvasLabel(text, config);
      },

      task: (text: string) => {
        return new CanvasTask(text);
      },

      slider: (config: any) => {
        return new CanvasSlider(config);
      },

      select: (options: string[]) => {
        return new CanvasSelect(options);
      }
    };
  }

  async executeCell(cellId: string, code: string) {
    // Detect viewof pattern
    const viewofMatch = code.match(/viewof\s+(\w+)\s*=\s*(.+)/);

    if (viewofMatch) {
      const varName = viewofMatch[1];
      const expression = viewofMatch[2];

      // Execute expression to create component
      const component = await this.evaluate(expression, this.createContext());

      // Store component as cell value
      cell.value = component;
      cell.name = varName;

      // Register component in canvas
      const componentId = `component_${cellId}`;
      canvasComponentRegistry.register(component);

      // Get initial value from component
      const initialValue = component.getValue();
      this.scope.set(varName, initialValue);

      // Listen for changes
      component.onChange((newValue) => {
        // Update scope
        this.scope.set(varName, newValue);

        // Mark cell as changed
        this.invalidateCell(cell);

        // Update dependents
        this.updateDependents(cell);
      });

      // Persist to worldData
      this.persistComponent(component, cellId);

      cell.status = 'fulfilled';
    } else {
      // Regular cell execution
      // ... normal flow
    }
  }

  persistComponent(component: CanvasComponent, cellId: string) {
    // Create note for component
    const noteKey = `note_${component.bounds.startX},${component.bounds.startY}_${cellId}`;
    const noteData = {
      startX: component.bounds.startX,
      endX: component.bounds.endX,
      startY: component.bounds.startY,
      endY: component.bounds.endY,
      timestamp: Date.now(),
      contentType: 'component',
      componentData: {
        type: component.type,
        props: component.props,
        state: { value: component.getValue() }
      }
    };

    // Save to worldData
    setWorldData(prev => ({
      ...prev,
      [noteKey]: JSON.stringify(noteData)
    }));
  }
}
```

---

## Canvas Task Component

```typescript
class CanvasTask implements CanvasComponent {
  type = 'task';
  private completed = false;
  private listeners: ((value: boolean) => void)[] = [];

  constructor(text: string) {
    this.text = text;
  }

  getValue(): boolean {
    return this.completed;
  }

  setValue(completed: boolean) {
    this.completed = completed;
    this.listeners.forEach(fn => fn(completed));
  }

  onChange(callback: (value: boolean) => void) {
    this.listeners.push(callback);
  }

  render(ctx: CanvasRenderingContext2D, viewport: Viewport) {
    const screenPos = worldToScreen(this.bounds.startX, this.bounds.startY);

    // Checkbox
    const checkboxSize = 16;
    ctx.strokeStyle = '#000';
    ctx.strokeRect(screenPos.x, screenPos.y, checkboxSize, checkboxSize);

    if (this.completed) {
      // Checkmark
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(screenPos.x + 2, screenPos.y + 2, checkboxSize - 4, checkboxSize - 4);
    }

    // Text
    ctx.fillStyle = this.completed ? '#999' : '#000';
    ctx.fillText(this.text, screenPos.x + checkboxSize + 5, screenPos.y + 12);

    // Strikethrough if completed
    if (this.completed) {
      ctx.strokeStyle = '#999';
      ctx.beginPath();
      ctx.moveTo(screenPos.x + checkboxSize + 5, screenPos.y + 8);
      ctx.lineTo(screenPos.x + checkboxSize + 5 + this.text.length * 8, screenPos.y + 8);
      ctx.stroke();
    }
  }

  handleClick(worldX: number, worldY: number) {
    // Toggle completion
    this.setValue(!this.completed);
  }
}
```

---

## Canvas Slider Component

```typescript
class CanvasSlider implements CanvasComponent {
  type = 'slider';
  private value: number;
  private listeners: ((value: number) => void)[] = [];

  constructor(config: {
    min?: number;
    max?: number;
    value?: number;
    step?: number;
  }) {
    this.min = config.min ?? 0;
    this.max = config.max ?? 100;
    this.value = config.value ?? 50;
    this.step = config.step ?? 1;
  }

  getValue(): number {
    return this.value;
  }

  setValue(newValue: number) {
    this.value = Math.max(this.min, Math.min(this.max, newValue));
    this.listeners.forEach(fn => fn(this.value));
  }

  onChange(callback: (value: number) => void) {
    this.listeners.push(callback);
  }

  render(ctx: CanvasRenderingContext2D, viewport: Viewport) {
    const screenPos = worldToScreen(this.bounds.startX, this.bounds.startY);
    const width = 200;
    const height = 20;

    // Track
    ctx.fillStyle = '#ddd';
    ctx.fillRect(screenPos.x, screenPos.y + 8, width, 4);

    // Progress
    const progress = (this.value - this.min) / (this.max - this.min);
    ctx.fillStyle = '#007aff';
    ctx.fillRect(screenPos.x, screenPos.y + 8, width * progress, 4);

    // Thumb
    const thumbX = screenPos.x + width * progress;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#007aff';
    ctx.beginPath();
    ctx.arc(thumbX, screenPos.y + 10, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Value label
    ctx.fillStyle = '#000';
    ctx.fillText(this.value.toString(), thumbX - 10, screenPos.y - 5);
  }

  handleMouseDown(worldX: number, worldY: number) {
    // Start dragging
    this.dragging = true;
  }

  handleMouseMove(worldX: number, worldY: number) {
    if (!this.dragging) return;

    // Calculate new value based on mouse position
    const relativeX = worldX - this.bounds.startX;
    const width = this.bounds.endX - this.bounds.startX;
    const progress = Math.max(0, Math.min(1, relativeX / width));
    const newValue = this.min + (this.max - this.min) * progress;

    // Snap to step
    const snapped = Math.round(newValue / this.step) * this.step;

    this.setValue(snapped);
  }

  handleMouseUp() {
    this.dragging = false;
  }
}
```

---

## Complete Example: Revenue Dashboard

```javascript
// Revenue input (editable label)
> viewof revenue = label('Q1 Revenue', {
    type: 'number',
    value: 100000,
    color: 'green'
  })
→ Q1 Revenue: 100000  ← Click to edit

// Tax rate slider
> viewof taxRate = slider({ min: 0, max: 50, value: 30 })
→ [============●======] 30  ← Drag to adjust

// Calculations (automatic)
> tax = revenue * (taxRate / 100)
→ 30000

> profit = revenue - tax
→ 70000

// Display
> summary = `Revenue: $${revenue.toLocaleString()}
              Tax (${taxRate}%): $${tax.toLocaleString()}
              Profit: $${profit.toLocaleString()}`
→ Revenue: $100,000
  Tax (30%): $30,000
  Profit: $70,000

// Chart (visual)
> chart([revenue, tax, profit], { labels: ['Revenue', 'Tax', 'Profit'] })
→ ┌────────────────────────┐
  │ 100k│ █                 │
  │  75k│ █                 │
  │  50k│ █       █         │
  │  25k│ █   █   █         │
  │    0│ ─────────────────│
  │     Revenue Tax Profit  │
  └────────────────────────┘

// User interactions:
// 1. Click "Q1 Revenue: 100000", edit to 150000
//    → tax recalculates to 45000
//    → profit recalculates to 105000
//    → summary updates
//    → chart updates

// 2. Drag tax slider from 30 to 25
//    → tax recalculates to 37500
//    → profit recalculates to 112500
//    → summary updates
//    → chart updates
```

**All reactive. All on canvas.**

---

## Migration Path

### Phase 1: Basic Reactive Labels
```typescript
// Support viewof in cells
> viewof x = label('Value', { type: 'number', value: 10 })

// Use in calculations
> y = x * 2
```

### Phase 2: Tasks as Boolean Cells
```typescript
> viewof done = task('Finish report')
> status = done ? 'Complete!' : 'Pending...'
```

### Phase 3: Interactive Inputs
```typescript
> viewof count = slider({ min: 0, max: 100 })
> viewof name = input({ placeholder: 'Enter name' })
> viewof choice = select(['A', 'B', 'C'])
```

### Phase 4: Complex Components
```typescript
> viewof selectedDate = calendar()
> viewof selectedStock = ticker(['AAPL', 'GOOGL'])
```

---

## Key Insight

**Your smart chips (labels, tasks, links) become reactive variables when created via `viewof`.**

```javascript
// Traditional label (static)
/label Revenue Data

// Reactive label (cell)
> viewof revenue = label('Revenue Data', { value: 10000 })

// Now `revenue` is a variable:
> tax = revenue * 0.3  ← Depends on revenue
```

**The chip is both:**
- Visual element on canvas (rendered as note/component)
- Reactive variable in cell scope (triggers dependencies)

---

## This Unifies Everything

```
User creates chip via cell:
> viewof revenue = label('Revenue', { value: 10000 })
         ↓
Cell executes → Creates CanvasLabel component
         ↓
Component registers onChange listener
         ↓
scope.set('revenue', 10000)
         ↓
Component renders to canvas
         ↓
User clicks label → edits value to 15000
         ↓
component.setValue(15000) → triggers onChange
         ↓
scope.set('revenue', 15000)
         ↓
updateDependents() → recalculates cells that use revenue
         ↓
Canvas re-renders with new values
```

**Observable reactivity + Canvas chips = Spatial reactive notebook.**

---

*Last updated: 2025-01-18*
*Version: 1.0 - Reactive Chips Integration*
