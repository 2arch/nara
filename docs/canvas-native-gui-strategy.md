# Canvas-Native GUI Strategy
## Building Interactive Components Purely in Canvas (No DOM Overlay)

**Date:** 2025-01-18
**Philosophy:** Stay true to pixel canvas architecture. Everything renders to canvas pixels. No DOM overlay.

---

## Vision: Pure Canvas GUI Framework

```
User types: /calendar

→ Renders calendar DIRECTLY to canvas pixels
→ Manual event handling (hit testing on canvas)
→ Custom rendering for buttons, grids, text
→ Stateful interaction (hover, click, selection)
→ GPU-accelerated where possible
→ Composites with existing text/monogram layers
```

**Not this:** `<CalendarWidget />` in DOM
**But this:** `ctx.fillRect()`, `ctx.fillText()`, manual layout, custom hit testing

---

## Architecture: Canvas-Native Rendering

```
┌─────────────────────────────────────────────┐
│ User Input (Mouse/Touch)                    │
└─────────────┬───────────────────────────────┘
              ↓
┌─────────────────────────────────────────────┐
│ Hit Testing Layer (NEW)                     │
│ - Detect which component was clicked        │
│ - Route events to component handlers        │
│ - Track hover state                         │
└─────────────┬───────────────────────────────┘
              ↓
┌─────────────────────────────────────────────┐
│ Component State Manager (NEW)               │
│ - Track component state (selectedDate, etc) │
│ - Trigger re-renders on state change        │
│ - Persist to worldData                      │
└─────────────┬───────────────────────────────┘
              ↓
┌─────────────────────────────────────────────┐
│ Canvas Rendering Pipeline                   │
│ ┌─────────────────────────────────────────┐ │
│ │ Layer 1: WebGPU Compute Shaders         │ │
│ │ - Monogram patterns (Perlin, NARA)      │ │
│ │ - Background effects                    │ │
│ └─────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────┐ │
│ │ Layer 2: Text & Images (Canvas 2D)      │ │
│ │ - Text characters                       │ │
│ │ - Images, notes                         │ │
│ └─────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────┐ │
│ │ Layer 3: GUI Components (Canvas 2D) NEW │ │
│ │ - Calendar grids                        │ │
│ │ - Buttons, inputs                       │ │
│ │ - Charts, graphs                        │ │
│ │ - Custom widgets                        │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

---

## Core Primitives: Canvas GUI Toolkit

### 1. Base Component Interface

```typescript
// Canvas-native component abstraction
interface CanvasComponent {
    // Identification
    id: string;
    type: string;  // 'calendar' | 'button' | 'input' | 'chart'

    // Layout (world coordinates)
    bounds: {
        startX: number;
        startY: number;
        endX: number;
        endY: number;
    };

    // State
    state: any;
    props: any;

    // Rendering
    render(ctx: CanvasRenderingContext2D, viewport: Viewport): void;

    // Interaction
    hitTest(worldX: number, worldY: number): HitTestResult | null;
    handleClick(worldX: number, worldY: number): void;
    handleHover(worldX: number, worldY: number): void;
    handleKeyPress(key: string): void;

    // Lifecycle
    mount(): void;
    unmount(): void;
    update(newProps: any): void;
}

interface HitTestResult {
    component: CanvasComponent;
    region?: string;  // 'header' | 'cell-1' | 'button-next'
    cursor?: string;  // 'pointer' | 'text' | 'default'
    data?: any;       // Region-specific data
}

interface Viewport {
    viewOffset: { x: number; y: number };
    zoomLevel: number;
    canvasWidth: number;
    canvasHeight: number;
}
```

### 2. Component Registry

```typescript
// Registry for canvas-native components
class CanvasComponentRegistry {
    private components = new Map<string, CanvasComponent>();

    register(component: CanvasComponent) {
        this.components.set(component.id, component);
    }

    unregister(id: string) {
        const component = this.components.get(id);
        component?.unmount();
        this.components.delete(id);
    }

    get(id: string): CanvasComponent | undefined {
        return this.components.get(id);
    }

    // Get all components in render order
    getAll(): CanvasComponent[] {
        return Array.from(this.components.values());
    }

    // Find component at world coordinates (for hit testing)
    findAt(worldX: number, worldY: number): HitTestResult | null {
        // Iterate in reverse (top-most first)
        const components = this.getAll().reverse();

        for (const component of components) {
            const hit = component.hitTest(worldX, worldY);
            if (hit) return hit;
        }

        return null;
    }
}

const canvasComponentRegistry = new CanvasComponentRegistry();
```

### 3. Rendering Integration

```typescript
// In bit.canvas.tsx render loop
function renderFrame() {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

    // Layer 1: WebGPU-computed monogram patterns
    renderMonogramLayer(ctx);

    // Layer 2: Text and images
    renderTextLayer(ctx);
    renderImageLayer(ctx);
    renderNoteLayer(ctx);

    // Layer 3: Canvas GUI components (NEW)
    renderComponentLayer(ctx);

    // Layer 4: Cursor, selection, overlays
    renderCursorLayer(ctx);
}

function renderComponentLayer(ctx: CanvasRenderingContext2D) {
    const viewport: Viewport = {
        viewOffset: engine.viewOffset,
        zoomLevel: engine.zoomLevel,
        canvasWidth: canvasSize.width,
        canvasHeight: canvasSize.height
    };

    // Render all registered components
    for (const component of canvasComponentRegistry.getAll()) {
        // Viewport culling
        if (!isComponentVisible(component, viewport)) {
            continue;
        }

        // Save context state
        ctx.save();

        // Render component
        component.render(ctx, viewport);

        // Restore context
        ctx.restore();
    }
}

function isComponentVisible(component: CanvasComponent, viewport: Viewport): boolean {
    const { startX, endX, startY, endY } = component.bounds;
    const { viewOffset, zoomLevel, canvasWidth, canvasHeight } = viewport;

    // Convert bounds to screen coordinates
    const screenStartX = startX * zoomLevel + viewOffset.x;
    const screenEndX = endX * zoomLevel + viewOffset.x;
    const screenStartY = startY * zoomLevel + viewOffset.y;
    const screenEndY = endY * zoomLevel + viewOffset.y;

    // Check intersection with viewport
    return !(screenEndX < 0 || screenStartX > canvasWidth ||
             screenEndY < 0 || screenStartY > canvasHeight);
}
```

### 4. Event Handling

```typescript
// In bit.canvas.tsx event handlers
function handleCanvasClick(e: React.MouseEvent) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Screen coordinates
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Convert to world coordinates
    const worldPos = engine.screenToWorld(screenX, screenY, engine.zoomLevel, engine.viewOffset);

    // Hit test components (check components first, before text layer)
    const hitResult = canvasComponentRegistry.findAt(worldPos.x, worldPos.y);

    if (hitResult) {
        // Component handles the click
        hitResult.component.handleClick(worldPos.x, worldPos.y);

        // Mark as handled (don't propagate to text layer)
        e.preventDefault();
        e.stopPropagation();
        return;
    }

    // Fall through to existing canvas click logic (cursor placement, text input)
    handleTextLayerClick(worldPos);
}

function handleCanvasMouseMove(e: React.MouseEvent) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPos = engine.screenToWorld(screenX, screenY, engine.zoomLevel, engine.viewOffset);

    // Hit test components
    const hitResult = canvasComponentRegistry.findAt(worldPos.x, worldPos.y);

    if (hitResult) {
        // Update cursor style
        if (canvasRef.current && hitResult.cursor) {
            canvasRef.current.style.cursor = hitResult.cursor;
        }

        // Notify component of hover
        hitResult.component.handleHover(worldPos.x, worldPos.y);

        // Track for re-render (hover effects)
        setHoveredComponent(hitResult.component.id);
    } else {
        // Reset cursor
        if (canvasRef.current) {
            canvasRef.current.style.cursor = 'default';
        }
        setHoveredComponent(null);
    }
}
```

---

## Example: Calendar Component

### Calendar Component Implementation

```typescript
// components/CanvasCalendar.ts
class CanvasCalendar implements CanvasComponent {
    id: string;
    type = 'calendar';
    bounds: { startX: number; startY: number; endX: number; endY: number };
    state: CalendarState;
    props: CalendarProps;

    private cellSize = 2;  // Grid cells (2x2 for each day cell)
    private headerHeight = 3;
    private weekdayHeight = 2;

    constructor(id: string, bounds: any, props: CalendarProps) {
        this.id = id;
        this.bounds = bounds;
        this.props = props;
        this.state = {
            selectedDate: props.initialDate || new Date(),
            currentMonth: new Date().getMonth(),
            currentYear: new Date().getFullYear(),
            hoveredDay: null
        };
    }

    render(ctx: CanvasRenderingContext2D, viewport: Viewport) {
        const { viewOffset, zoomLevel } = viewport;

        // Convert world bounds to screen coordinates
        const screenX = this.bounds.startX * zoomLevel + viewOffset.x;
        const screenY = this.bounds.startY * zoomLevel + viewOffset.y;
        const screenWidth = (this.bounds.endX - this.bounds.startX) * zoomLevel;
        const screenHeight = (this.bounds.endY - this.bounds.startY) * zoomLevel;

        // Background
        ctx.fillStyle = this.props.theme === 'dark' ? '#1a1a1a' : '#ffffff';
        ctx.fillRect(screenX, screenY, screenWidth, screenHeight);

        // Border
        ctx.strokeStyle = this.props.theme === 'dark' ? '#333' : '#ddd';
        ctx.lineWidth = 1;
        ctx.strokeRect(screenX, screenY, screenWidth, screenHeight);

        // Render layers
        this.renderHeader(ctx, screenX, screenY, screenWidth, zoomLevel);
        this.renderWeekdays(ctx, screenX, screenY, screenWidth, zoomLevel);
        this.renderDateGrid(ctx, screenX, screenY, screenWidth, zoomLevel);
    }

    private renderHeader(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, zoom: number) {
        const headerHeight = this.headerHeight * zoom;

        // Month/Year text
        const monthYear = `${MONTHS[this.state.currentMonth]} ${this.state.currentYear}`;
        ctx.fillStyle = this.props.theme === 'dark' ? '#fff' : '#000';
        ctx.font = `${14 * zoom}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(monthYear, x + width / 2, y + headerHeight / 2);

        // Previous month button
        const prevBtnX = x + 10 * zoom;
        const prevBtnY = y + headerHeight / 2;
        ctx.fillText('‹', prevBtnX, prevBtnY);

        // Next month button
        const nextBtnX = x + width - 10 * zoom;
        const nextBtnY = y + headerHeight / 2;
        ctx.fillText('›', nextBtnX, nextBtnY);
    }

    private renderWeekdays(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, zoom: number) {
        const weekdayY = y + this.headerHeight * zoom;
        const weekdayHeight = this.weekdayHeight * zoom;
        const cellWidth = width / 7;

        ctx.fillStyle = this.props.theme === 'dark' ? '#666' : '#999';
        ctx.font = `${10 * zoom}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        weekdays.forEach((day, i) => {
            const cellX = x + i * cellWidth;
            ctx.fillText(day, cellX + cellWidth / 2, weekdayY + weekdayHeight / 2);
        });
    }

    private renderDateGrid(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, zoom: number) {
        const gridY = y + (this.headerHeight + this.weekdayHeight) * zoom;
        const cellWidth = width / 7;
        const cellHeight = this.cellSize * zoom;

        const daysInMonth = new Date(this.state.currentYear, this.state.currentMonth + 1, 0).getDate();
        const firstDayOfMonth = new Date(this.state.currentYear, this.state.currentMonth, 1).getDay();

        ctx.font = `${12 * zoom}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Render day cells
        for (let day = 1; day <= daysInMonth; day++) {
            const totalIndex = firstDayOfMonth + day - 1;
            const row = Math.floor(totalIndex / 7);
            const col = totalIndex % 7;

            const cellX = x + col * cellWidth;
            const cellY = gridY + row * cellHeight;

            // Check if this day is selected
            const isSelected =
                this.state.selectedDate.getDate() === day &&
                this.state.selectedDate.getMonth() === this.state.currentMonth &&
                this.state.selectedDate.getFullYear() === this.state.currentYear;

            // Check if this day is hovered
            const isHovered = this.state.hoveredDay === day;

            // Background
            if (isSelected) {
                ctx.fillStyle = '#007aff';
                ctx.fillRect(cellX + 2, cellY + 2, cellWidth - 4, cellHeight - 4);
            } else if (isHovered) {
                ctx.fillStyle = this.props.theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)';
                ctx.fillRect(cellX + 2, cellY + 2, cellWidth - 4, cellHeight - 4);
            }

            // Text
            ctx.fillStyle = isSelected ? '#fff' : (this.props.theme === 'dark' ? '#fff' : '#000');
            ctx.fillText(day.toString(), cellX + cellWidth / 2, cellY + cellHeight / 2);
        }
    }

    hitTest(worldX: number, worldY: number): HitTestResult | null {
        // Check if click is within bounds
        if (worldX < this.bounds.startX || worldX > this.bounds.endX ||
            worldY < this.bounds.startY || worldY > this.bounds.endY) {
            return null;
        }

        // Relative coordinates within component
        const relX = worldX - this.bounds.startX;
        const relY = worldY - this.bounds.startY;

        // Check header region (prev/next buttons)
        if (relY < this.headerHeight) {
            if (relX < 5) {
                return { component: this, region: 'prev-button', cursor: 'pointer' };
            } else if (relX > (this.bounds.endX - this.bounds.startX) - 5) {
                return { component: this, region: 'next-button', cursor: 'pointer' };
            }
            return { component: this, region: 'header', cursor: 'default' };
        }

        // Check date grid region
        if (relY > this.headerHeight + this.weekdayHeight) {
            const gridRelY = relY - (this.headerHeight + this.weekdayHeight);
            const row = Math.floor(gridRelY / this.cellSize);
            const col = Math.floor(relX / this.cellSize);

            const daysInMonth = new Date(this.state.currentYear, this.state.currentMonth + 1, 0).getDate();
            const firstDayOfMonth = new Date(this.state.currentYear, this.state.currentMonth, 1).getDay();

            const totalIndex = row * 7 + col;
            const day = totalIndex - firstDayOfMonth + 1;

            if (day >= 1 && day <= daysInMonth) {
                return {
                    component: this,
                    region: `day-${day}`,
                    cursor: 'pointer',
                    data: { day, row, col }
                };
            }
        }

        return { component: this, region: 'body', cursor: 'default' };
    }

    handleClick(worldX: number, worldY: number) {
        const hit = this.hitTest(worldX, worldY);
        if (!hit) return;

        if (hit.region === 'prev-button') {
            this.navigateToPreviousMonth();
        } else if (hit.region === 'next-button') {
            this.navigateToNextMonth();
        } else if (hit.region?.startsWith('day-')) {
            const day = hit.data?.day;
            if (day) {
                this.selectDate(day);
            }
        }
    }

    handleHover(worldX: number, worldY: number) {
        const hit = this.hitTest(worldX, worldY);

        if (hit?.region?.startsWith('day-')) {
            const day = hit.data?.day;
            if (this.state.hoveredDay !== day) {
                this.state.hoveredDay = day;
                this.requestRender();
            }
        } else if (this.state.hoveredDay !== null) {
            this.state.hoveredDay = null;
            this.requestRender();
        }
    }

    handleKeyPress(key: string) {
        // Arrow key navigation
        if (key === 'ArrowLeft') {
            this.navigateToPreviousDay();
        } else if (key === 'ArrowRight') {
            this.navigateToNextDay();
        } else if (key === 'ArrowUp') {
            this.navigateDays(-7);
        } else if (key === 'ArrowDown') {
            this.navigateDays(7);
        }
    }

    private selectDate(day: number) {
        this.state.selectedDate = new Date(this.state.currentYear, this.state.currentMonth, day);
        this.persistState();
        this.requestRender();

        // Notify callback
        this.props.onDateSelect?.(this.state.selectedDate);
    }

    private navigateToPreviousMonth() {
        if (this.state.currentMonth === 0) {
            this.state.currentMonth = 11;
            this.state.currentYear--;
        } else {
            this.state.currentMonth--;
        }
        this.persistState();
        this.requestRender();
    }

    private navigateToNextMonth() {
        if (this.state.currentMonth === 11) {
            this.state.currentMonth = 0;
            this.state.currentYear++;
        } else {
            this.state.currentMonth++;
        }
        this.persistState();
        this.requestRender();
    }

    private navigateToPreviousDay() {
        const newDate = new Date(this.state.selectedDate);
        newDate.setDate(newDate.getDate() - 1);
        this.state.selectedDate = newDate;

        // Update month/year if crossed boundary
        if (newDate.getMonth() !== this.state.currentMonth) {
            this.state.currentMonth = newDate.getMonth();
            this.state.currentYear = newDate.getFullYear();
        }

        this.persistState();
        this.requestRender();
    }

    private navigateToNextDay() {
        const newDate = new Date(this.state.selectedDate);
        newDate.setDate(newDate.getDate() + 1);
        this.state.selectedDate = newDate;

        if (newDate.getMonth() !== this.state.currentMonth) {
            this.state.currentMonth = newDate.getMonth();
            this.state.currentYear = newDate.getFullYear();
        }

        this.persistState();
        this.requestRender();
    }

    private navigateDays(days: number) {
        const newDate = new Date(this.state.selectedDate);
        newDate.setDate(newDate.getDate() + days);
        this.state.selectedDate = newDate;

        if (newDate.getMonth() !== this.state.currentMonth) {
            this.state.currentMonth = newDate.getMonth();
            this.state.currentYear = newDate.getFullYear();
        }

        this.persistState();
        this.requestRender();
    }

    private persistState() {
        // Update worldData with new state
        const componentNote = {
            ...this.bounds,
            timestamp: Date.now(),
            contentType: 'component',
            componentData: {
                type: 'calendar',
                props: this.props,
                state: {
                    selectedDate: this.state.selectedDate.toISOString(),
                    currentMonth: this.state.currentMonth,
                    currentYear: this.state.currentYear
                }
            }
        };

        const key = `note_${this.bounds.startX},${this.bounds.startY}_${this.id}`;

        // Trigger worldData update (this will sync to Firebase)
        if (typeof window !== 'undefined' && (window as any).__updateWorldData) {
            (window as any).__updateWorldData(key, JSON.stringify(componentNote));
        }
    }

    private requestRender() {
        // Trigger canvas re-render
        if (typeof window !== 'undefined' && (window as any).__requestCanvasRender) {
            (window as any).__requestCanvasRender();
        }
    }

    mount() {
        // Component lifecycle hook
    }

    unmount() {
        // Cleanup
    }

    update(newProps: CalendarProps) {
        this.props = { ...this.props, ...newProps };
        this.requestRender();
    }
}

interface CalendarState {
    selectedDate: Date;
    currentMonth: number;
    currentYear: number;
    hoveredDay: number | null;
}

interface CalendarProps {
    theme?: 'light' | 'dark';
    initialDate?: Date;
    onDateSelect?: (date: Date) => void;
}

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];
```

---

## Command Integration

```typescript
// commands.ts
if (commandToExecute.startsWith('calendar')) {
    const selection = getNormalizedSelection?.();

    const bounds = selection || {
        startX: cursorPos.x,
        startY: cursorPos.y,
        endX: cursorPos.x + 20,
        endY: cursorPos.y + 15
    };

    // Create canvas calendar component
    const calendarId = `calendar_${Date.now()}`;
    const calendar = new CanvasCalendar(
        calendarId,
        bounds,
        {
            theme: hostBackgroundColor === '#000000' ? 'dark' : 'light',
            initialDate: new Date(),
            onDateSelect: (date) => {
                console.log('Date selected:', date);
            }
        }
    );

    // Register component
    canvasComponentRegistry.register(calendar);

    // Persist to worldData
    const componentNote = {
        startX: bounds.startX,
        endX: bounds.endX,
        startY: bounds.startY,
        endY: bounds.endY,
        timestamp: Date.now(),
        contentType: 'component',
        componentData: {
            type: 'calendar',
            id: calendarId,
            props: calendar.props,
            state: {
                selectedDate: calendar.state.selectedDate.toISOString(),
                currentMonth: calendar.state.currentMonth,
                currentYear: calendar.state.currentYear
            }
        }
    };

    const key = `note_${bounds.startX},${bounds.startY}_${calendarId}`;
    setWorldData({ ...worldData, [key]: JSON.stringify(componentNote) });

    setDialogueWithRevert(`Calendar created at (${bounds.startX}, ${bounds.startY})`, setDialogueText);
    clearCommandState();
    return null;
}
```

---

## Component Restoration (from worldData)

```typescript
// In bit.canvas.tsx useEffect (restore components from worldData)
useEffect(() => {
    // Find all component notes in worldData
    const componentNotes = Object.entries(engine.worldData)
        .filter(([key]) => key.startsWith('note_'))
        .map(([key, data]) => {
            try {
                const parsed = JSON.parse(data as string);
                return { key, ...parsed };
            } catch {
                return null;
            }
        })
        .filter(note => note?.contentType === 'component');

    // Restore components
    for (const note of componentNotes) {
        const componentId = note.componentData.id;

        // Skip if already registered
        if (canvasComponentRegistry.get(componentId)) {
            continue;
        }

        // Create component based on type
        let component: CanvasComponent | null = null;

        switch (note.componentData.type) {
            case 'calendar':
                component = new CanvasCalendar(
                    componentId,
                    {
                        startX: note.startX,
                        endX: note.endX,
                        startY: note.startY,
                        endY: note.endY
                    },
                    note.componentData.props
                );

                // Restore state
                if (note.componentData.state) {
                    component.state = {
                        selectedDate: new Date(note.componentData.state.selectedDate),
                        currentMonth: note.componentData.state.currentMonth,
                        currentYear: note.componentData.state.currentYear,
                        hoveredDay: null
                    };
                }
                break;

            // Add more component types here
        }

        if (component) {
            canvasComponentRegistry.register(component);
            component.mount();
        }
    }
}, [engine.worldData]);
```

---

## Performance Optimizations

### 1. Dirty Rectangle Tracking

```typescript
class CanvasComponentRegistry {
    private dirtyComponents = new Set<string>();

    markDirty(componentId: string) {
        this.dirtyComponents.add(componentId);
    }

    getDirtyComponents(): CanvasComponent[] {
        const dirty = Array.from(this.dirtyComponents)
            .map(id => this.components.get(id))
            .filter(Boolean) as CanvasComponent[];

        this.dirtyComponents.clear();
        return dirty;
    }
}

// Only re-render dirty components
function renderComponentLayer(ctx: CanvasRenderingContext2D) {
    const dirtyComponents = canvasComponentRegistry.getDirtyComponents();

    if (dirtyComponents.length === 0) {
        return; // No components changed, skip render
    }

    for (const component of dirtyComponents) {
        component.render(ctx, viewport);
    }
}
```

### 2. Offscreen Canvas for Complex Components

```typescript
class CanvasCalendar implements CanvasComponent {
    private offscreenCanvas: OffscreenCanvas | null = null;
    private cacheValid = false;

    render(ctx: CanvasRenderingContext2D, viewport: Viewport) {
        // Use cached offscreen render if valid
        if (this.cacheValid && this.offscreenCanvas) {
            const screenX = this.bounds.startX * viewport.zoomLevel + viewport.viewOffset.x;
            const screenY = this.bounds.startY * viewport.zoomLevel + viewport.viewOffset.y;

            ctx.drawImage(this.offscreenCanvas, screenX, screenY);
            return;
        }

        // Render to offscreen canvas
        const width = (this.bounds.endX - this.bounds.startX) * viewport.zoomLevel;
        const height = (this.bounds.endY - this.bounds.startY) * viewport.zoomLevel;

        this.offscreenCanvas = new OffscreenCanvas(width, height);
        const offCtx = this.offscreenCanvas.getContext('2d')!;

        // Render calendar to offscreen canvas
        this.renderToContext(offCtx, viewport);

        // Draw offscreen canvas to main canvas
        const screenX = this.bounds.startX * viewport.zoomLevel + viewport.viewOffset.x;
        const screenY = this.bounds.startY * viewport.zoomLevel + viewport.viewOffset.y;
        ctx.drawImage(this.offscreenCanvas, screenX, screenY);

        this.cacheValid = true;
    }

    private invalidateCache() {
        this.cacheValid = false;
    }
}
```

### 3. Component-Level Viewport Culling

```typescript
function renderComponentLayer(ctx: CanvasRenderingContext2D) {
    const viewport = getViewport();

    // Only render components visible in viewport
    const visibleComponents = canvasComponentRegistry.getAll().filter(component => {
        return isComponentVisible(component, viewport);
    });

    for (const component of visibleComponents) {
        component.render(ctx, viewport);
    }
}
```

---

## Advanced: WebGPU-Accelerated Components

You can use WebGPU compute shaders to generate component backgrounds!

```typescript
class CanvasCalendar implements CanvasComponent {
    private backgroundTexture: Float32Array | null = null;

    async generateBackground(monogramSystem: MonogramSystem) {
        // Use WebGPU to generate Perlin noise background
        const chunkX = Math.floor(this.bounds.startX / 32) * 32;
        const chunkY = Math.floor(this.bounds.startY / 32) * 32;

        // Request chunk computation from GPU
        const intensities = await monogramSystem.computeChunk(chunkX, chunkY);

        this.backgroundTexture = intensities;
        this.invalidateCache();
    }

    private renderToContext(ctx: CanvasRenderingContext2D, viewport: Viewport) {
        // Render GPU-computed background
        if (this.backgroundTexture) {
            this.renderPerlinBackground(ctx, viewport);
        }

        // Render calendar UI on top
        this.renderHeader(ctx, viewport);
        this.renderDateGrid(ctx, viewport);
    }

    private renderPerlinBackground(ctx: CanvasRenderingContext2D, viewport: Viewport) {
        const imageData = ctx.createImageData(32, 32);

        for (let i = 0; i < this.backgroundTexture!.length; i++) {
            const intensity = this.backgroundTexture![i];
            imageData.data[i * 4 + 0] = intensity * 255; // R
            imageData.data[i * 4 + 1] = intensity * 255; // G
            imageData.data[i * 4 + 2] = intensity * 255; // B
            imageData.data[i * 4 + 3] = 50;              // A (subtle)
        }

        ctx.putImageData(imageData, 0, 0);
    }
}
```

---

## Comparison: Canvas-Native vs DOM Overlay

| Feature | Canvas-Native | DOM Overlay |
|---------|---------------|-------------|
| **Rendering** | Manual (ctx.fillRect) | Automatic (browser) |
| **Complexity** | HIGH (build everything) | LOW (use React) |
| **Performance** | Can be faster (fewer layers) | Very fast (GPU compositing) |
| **Accessibility** | None (must build custom) | Built-in (ARIA, screen readers) |
| **Event Handling** | Manual hit testing | Automatic (browser) |
| **Consistency** | Pure canvas aesthetic | Mixes canvas + DOM |
| **Extensibility** | Custom toolkit | React ecosystem |
| **Dev Time** | Weeks per component | Hours per component |

---

## Migration Roadmap

### Phase 1: Foundation (Week 1-2)
- [ ] Implement CanvasComponent interface
- [ ] Build CanvasComponentRegistry
- [ ] Add component rendering layer to canvas loop
- [ ] Implement hit testing in click handlers
- [ ] Test with simple rectangle component

### Phase 2: Calendar Component (Week 2-4)
- [ ] Build CanvasCalendar class
- [ ] Implement rendering (header, weekdays, grid)
- [ ] Implement hit testing (prev/next, date cells)
- [ ] Add hover states
- [ ] Add keyboard navigation
- [ ] Persist state to worldData

### Phase 3: Optimization (Week 4-5)
- [ ] Dirty rectangle tracking
- [ ] Offscreen canvas caching
- [ ] Viewport culling
- [ ] WebGPU background generation

### Phase 4: More Components (Week 5-8)
- [ ] Button component
- [ ] Input component
- [ ] Select/Dropdown component
- [ ] Chart component (line, bar, pie)
- [ ] Form builder component

---

## Conclusion

**Canvas-native GUI is ambitious but achievable:**

✅ **Full pixel control** - Consistent with bit.canvas philosophy
✅ **No DOM/React dependencies** - Pure canvas rendering
✅ **WebGPU integration** - Can use shaders for backgrounds
✅ **Spatial positioning** - Components are world entities
✅ **Persistent** - State saved to worldData/Firebase

❌ **High complexity** - Must build every UI primitive
❌ **No accessibility** - Screen readers can't read canvas
❌ **Slow development** - Weeks per component vs hours
❌ **Browser features lost** - No native inputs, buttons, hover

**Recommendation:** Start with calendar as proof-of-concept. If it feels natural and performant, expand to more components. If it's too tedious, reconsider DOM overlay approach.

**Core insight:** You're building a mini UI framework from scratch. This is what game engines do (Unity, Unreal). It's powerful but requires significant engineering investment.

---

*Last updated: 2025-01-18*
*Version: 1.0 - Canvas-Native GUI Strategy*
