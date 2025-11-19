# Component Extensibility Strategy for bit.canvas

**Date:** 2025-01-18
**Status:** Planning
**Goal:** Enable rich, interactive components (calendars, widgets, apps) to be embedded in spatial canvas

---

## Executive Summary

bit.canvas currently has a **note-centric architecture** with `contentType` discriminator:
- `'text'` - Text overlays (default)
- `'image'` - Images with GIF support
- `'mail'` - Email composer
- `'list'` - Scrollable lists

**Vision:** Extend this to support **arbitrary interactive components** that can be:
- Positioned on the spatial grid
- Fast and performant (60fps canvas)
- Extensible (easy to add new component types)
- Composable (components can interact with each other)
- Persistent (state survives refresh)

**Use Case Example:** `/calendar` command creates a `note_*` with `contentType: 'calendar'`, rendering a fully interactive calendar widget positioned at cursor location.

---

## Current Architecture Analysis

### Note Interface (`bit.canvas.tsx:64-73`)

```typescript
interface Note {
    // Bounds (required)
    startX: number;
    endX: number;
    startY: number;
    endY: number;
    timestamp: number;

    // Content type determines function
    contentType?: 'text' | 'image' | 'mail' | 'list';

    // Content-specific data
    imageData?: ImageAttachment;
    mailData?: MailData;
    content?: any;  // Generic content container
    style?: string;
    patternKey?: string;
}
```

### Rendering Flow

```
1. Canvas render loop (60fps)
   ↓
2. For each note in worldData:
   ↓
3. getNoteType(note) → contentType
   ↓
4. Switch on contentType:
   - 'image' → renderImageNote()
   - 'mail' → renderMailOverlay()
   - 'list' → renderScrollableList()
   - default → renderTextNote()
```

### Key Observations

✅ **Already extensible by design** - Adding new contentTypes is straightforward
✅ **Spatial positioning works** - Notes have startX/endX bounds
✅ **Performance-conscious** - Viewport culling, dirty rectangles
✅ **Persistent** - Notes save to Firebase with all metadata

❌ **Canvas-only rendering** - All rendering goes through Canvas 2D API
❌ **No React component support** - Can't embed rich UI components
❌ **Limited interactivity** - Canvas events are primitive
❌ **No component lifecycle** - No mount/unmount hooks

---

## The Challenge: Canvas vs DOM

### Canvas Rendering (Current)
```
Pros:
✅ Fast for text/images
✅ Full control over pixels
✅ Smooth pan/zoom
✅ GPU acceleration via WebGPU

Cons:
❌ Complex interactive UI is hard (calendars, forms, etc.)
❌ Accessibility issues (screen readers can't read canvas)
❌ No browser UI features (inputs, buttons, scroll)
❌ Custom event handling required
```

### DOM Rendering (For Components)
```
Pros:
✅ Rich interactivity (inputs, buttons, dropdowns)
✅ Browser handles events
✅ Accessibility built-in
✅ React/Web Components work

Cons:
❌ Harder to integrate with canvas
❌ Different coordinate system
❌ Z-index/layering complexity
❌ Pan/zoom transform complexity
```

**Insight:** We need a **hybrid approach** - Canvas for base rendering, DOM overlays for interactive components.

---

## Architecture Proposals

### Option A: DOM Overlay Layer (React Portal) ⭐⭐⭐⭐⭐

**Concept:** Render React components in absolute-positioned divs that sync with canvas coordinates.

```typescript
// New contentType
interface Note {
    contentType?: 'text' | 'image' | 'mail' | 'list' | 'component';

    // For component notes
    componentData?: {
        type: string;        // 'calendar' | 'kanban' | 'chart' | ...
        props: any;          // Component-specific props
        state?: any;         // Persistent component state
        width?: number;      // Optional fixed width (in grid cells)
        height?: number;     // Optional fixed height (in grid cells)
    };
}
```

**Architecture:**

```
┌──────────────────────────────────────┐
│  bit.canvas.tsx                      │
│  ┌────────────────────────────────┐  │
│  │ Canvas Layer (base rendering)  │  │
│  │ - Text, images, backgrounds    │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │ DOM Overlay Layer (new)        │  │
│  │ - React Portal                 │  │
│  │ - Absolute positioned divs     │  │
│  │ - Transform: translate(x, y)   │  │
│  │ - Scale based on zoom          │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

**Implementation:**

```typescript
// 1. Component Registry
const COMPONENT_REGISTRY: Record<string, React.ComponentType<any>> = {
    calendar: CalendarWidget,
    kanban: KanbanBoard,
    chart: ChartWidget,
    form: FormBuilder,
    // ... extensible
};

// 2. ComponentOverlayLayer component
function ComponentOverlayLayer({
    worldData,
    viewOffset,
    zoomLevel
}: ComponentOverlayProps) {
    const componentNotes = useMemo(() => {
        return Object.entries(worldData)
            .filter(([key, _]) => key.startsWith('note_'))
            .map(([key, data]) => parseNoteData(key, data))
            .filter(note => note.contentType === 'component');
    }, [worldData]);

    return (
        <div className="component-overlay" style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none'  // Let canvas handle clicks
        }}>
            {componentNotes.map(note => {
                const Component = COMPONENT_REGISTRY[note.componentData.type];
                if (!Component) return null;

                // Calculate screen position from world coordinates
                const screenPos = worldToScreen(
                    note.startX,
                    note.startY,
                    zoomLevel,
                    viewOffset
                );

                return (
                    <div
                        key={note.timestamp}
                        style={{
                            position: 'absolute',
                            left: screenPos.x,
                            top: screenPos.y,
                            transform: `scale(${zoomLevel})`,
                            transformOrigin: 'top left',
                            pointerEvents: 'auto',  // Component handles its own clicks
                            zIndex: 1000
                        }}
                    >
                        <Component
                            {...note.componentData.props}
                            onStateChange={(newState) => {
                                // Persist component state to worldData
                                updateComponentState(note, newState);
                            }}
                        />
                    </div>
                );
            })}
        </div>
    );
}

// 3. Integration in bit.canvas.tsx
export function BitCanvas({ engine }: BitCanvasProps) {
    return (
        <div className="canvas-container">
            {/* Existing canvas */}
            <canvas ref={canvasRef} {...canvasProps} />

            {/* NEW: Component overlay layer */}
            <ComponentOverlayLayer
                worldData={engine.worldData}
                viewOffset={engine.viewOffset}
                zoomLevel={engine.zoomLevel}
            />
        </div>
    );
}

// 4. Create component command
if (commandToExecute.startsWith('calendar')) {
    const existingSelection = getNormalizedSelection?.();
    const { width, height } = calculateSelectionDimensions(existingSelection);

    const componentNote = {
        startX: existingSelection.startX,
        endX: existingSelection.endX,
        startY: existingSelection.startY,
        endY: existingSelection.endY,
        timestamp: Date.now(),
        contentType: 'component',
        componentData: {
            type: 'calendar',
            props: {
                initialDate: new Date(),
                theme: 'light'
            },
            state: {},
            width: width,
            height: height
        }
    };

    const key = `note_${existingSelection.startX},${existingSelection.startY}_${Date.now()}`;
    setWorldData({ ...worldData, [key]: JSON.stringify(componentNote) });
}
```

**Pros:**
✅ Full React component support (reuse existing libraries)
✅ Browser handles all interactivity (inputs, buttons, etc.)
✅ Accessibility works out-of-box
✅ Easy to add new component types (just register in COMPONENT_REGISTRY)
✅ Component state can persist to Firebase
✅ Transforms sync with canvas pan/zoom

**Cons:**
❌ More complex rendering (canvas + DOM layers)
❌ Z-index management needed
❌ Transform scaling can affect component appearance
❌ Performance overhead from DOM rendering

**Performance Impact:** +5-10ms per component (negligible for <20 components)

---

### Option B: Canvas-Native Components (Declarative) ⭐⭐⭐

**Concept:** Build a declarative UI framework that renders to canvas (like React Native).

```typescript
// Custom framework for canvas rendering
abstract class CanvasComponent {
    abstract render(ctx: CanvasRenderingContext2D, bounds: Bounds): void;
    abstract handleEvent(event: CanvasEvent): boolean;
}

class CalendarComponent extends CanvasComponent {
    private selectedDate: Date;
    private hoverCell: { month: number; day: number } | null;

    render(ctx: CanvasRenderingContext2D, bounds: Bounds) {
        // Manually draw calendar grid
        this.drawHeader(ctx, bounds);
        this.drawDaysOfWeek(ctx, bounds);
        this.drawDateCells(ctx, bounds);
    }

    handleEvent(event: CanvasEvent): boolean {
        if (event.type === 'click') {
            const cellPos = this.getCellAtPosition(event.x, event.y);
            if (cellPos) {
                this.selectedDate = cellPos.date;
                return true; // Event consumed
            }
        }
        return false;
    }

    private drawHeader(ctx, bounds) { /* ... */ }
    private drawDaysOfWeek(ctx, bounds) { /* ... */ }
    private drawDateCells(ctx, bounds) { /* ... */ }
}
```

**Pros:**
✅ No DOM complexity (pure canvas)
✅ Consistent with existing rendering pipeline
✅ Full control over performance
✅ Works with existing pan/zoom system

**Cons:**
❌ Must implement all UI primitives from scratch (buttons, inputs, etc.)
❌ No accessibility (screen readers can't read canvas)
❌ Can't reuse existing React components
❌ Much more implementation work
❌ Hard to match browser-native UI quality

**Verdict:** Too much work for unclear benefit. ❌

---

### Option C: iframe-based Components ⭐⭐

**Concept:** Embed components in iframes (similar to existing iframe contentType).

```typescript
interface Note {
    contentType?: ... | 'widget';
    widgetData?: {
        url: string;  // URL to widget HTML
        type: string; // 'calendar' | 'kanban' | ...
    };
}
```

**Pros:**
✅ Full sandboxing (security)
✅ Can embed any web content
✅ Already proven pattern in codebase

**Cons:**
❌ Communication overhead (postMessage)
❌ Styling isolation (can't inherit theme)
❌ Slower than in-page rendering
❌ CORS restrictions
❌ Can't easily share state with canvas

**Verdict:** Good for embedding external content, not for first-class components. ⚠️

---

### Option D: Web Components (Custom Elements) ⭐⭐⭐⭐

**Concept:** Use Web Components as the component model (framework-agnostic).

```typescript
// Register web components
customElements.define('nara-calendar', class extends HTMLElement {
    connectedCallback() {
        this.render();
    }

    render() {
        this.innerHTML = `
            <div class="calendar">
                <!-- Calendar UI -->
            </div>
        `;
    }
});

// In ComponentOverlayLayer
<nara-calendar
    initial-date="2025-01-18"
    on-date-select={...}
/>
```

**Pros:**
✅ Framework-agnostic (can use with or without React)
✅ Encapsulation (shadow DOM)
✅ Reusable across projects
✅ Browser-native (good performance)
✅ Can wrap existing React components

**Cons:**
❌ Less familiar to React developers
❌ Slightly more boilerplate
❌ Shadow DOM can complicate styling

**Verdict:** Great for long-term extensibility! ⭐

---

### Option E: htmx-inspired (Server-Driven UI) ⭐⭐⭐

**Concept:** Components are server-rendered HTML fragments that update via AJAX.

```typescript
interface Note {
    contentType: 'htmx';
    htmxData: {
        endpoint: string;      // '/api/components/calendar'
        trigger: 'load';       // When to fetch
        swap: 'innerHTML';     // How to update
        state?: any;           // Sent with requests
    };
}

// Component endpoint returns HTML
GET /api/components/calendar?date=2025-01-18
→ <div class="calendar" hx-post="/api/calendar/select">...</div>

// User clicks date
POST /api/calendar/select { date: '2025-01-20' }
→ <div class="calendar">...updated HTML...</div>
```

**Pros:**
✅ Minimal client-side code (htmx is tiny)
✅ Server handles complexity
✅ SEO-friendly (HTML from server)
✅ Easy to update without deploy
✅ Framework-agnostic

**Cons:**
❌ Requires server endpoints for each component
❌ Network latency on every interaction
❌ Less responsive than client-side
❌ Complex state management

**Verdict:** Interesting for specific use cases (forms, dashboards), but not general-purpose. ⚠️

---

## Recommended Approach: Hybrid (Option A + D)

**Phase 1: React Portal Foundation** (Week 1-2)
- Implement ComponentOverlayLayer with React Portals
- Add `contentType: 'component'`
- Build component registry system
- Create first demo component (calendar)
- Handle pan/zoom transforms
- Persist component state to Firebase

**Phase 2: Component Library** (Week 3-4)
- Build reusable components:
  - `CalendarWidget` - Date picker, event viewer
  - `KanbanBoard` - Task management
  - `ChartWidget` - Data visualization
  - `FormBuilder` - Dynamic forms
  - `MarkdownEditor` - Rich text editing
- Create component creation commands (`/calendar`, `/kanban`, etc.)
- Add component resize/move handlers
- Component style theming system

**Phase 3: Web Component Wrapper** (Week 5-6)
- Wrap React components as Web Components
- Publish as standalone package (`@nara/components`)
- Enable external developers to create components
- Component marketplace/registry

---

## Technical Implementation Details

### 1. Component Note Data Structure

```typescript
interface ComponentNote extends Note {
    contentType: 'component';
    componentData: {
        // Component identification
        type: string;              // 'calendar' | 'kanban' | 'chart'
        version?: string;          // Semver for compatibility

        // Component configuration
        props: Record<string, any>; // Initial props
        state: Record<string, any>; // Persistent state

        // Layout
        width?: number;            // Width in grid cells (optional)
        height?: number;           // Height in grid cells (optional)
        zIndex?: number;           // Layering priority

        // Interaction
        interactive?: boolean;     // Can receive events (default: true)
        draggable?: boolean;       // Can be repositioned
        resizable?: boolean;       // Can be resized

        // Metadata
        createdAt: number;
        updatedAt: number;
        createdBy?: string;        // User ID
    };
}
```

### 2. Component Registry System

```typescript
// Component manifest
interface ComponentManifest {
    type: string;
    name: string;
    description: string;
    icon?: string;
    defaultProps?: Record<string, any>;
    defaultSize?: { width: number; height: number };
    category?: 'productivity' | 'visualization' | 'media' | 'utility';
}

// Registry
class ComponentRegistry {
    private components = new Map<string, {
        Component: React.ComponentType<any>;
        manifest: ComponentManifest;
    }>();

    register(manifest: ComponentManifest, Component: React.ComponentType<any>) {
        this.components.set(manifest.type, { Component, manifest });
    }

    get(type: string) {
        return this.components.get(type);
    }

    list(): ComponentManifest[] {
        return Array.from(this.components.values()).map(c => c.manifest);
    }
}

// Usage
export const componentRegistry = new ComponentRegistry();

componentRegistry.register({
    type: 'calendar',
    name: 'Calendar',
    description: 'Interactive calendar widget',
    icon: '📅',
    defaultSize: { width: 20, height: 15 },
    category: 'productivity'
}, CalendarWidget);
```

### 3. Component Lifecycle Hooks

```typescript
interface ComponentProps {
    // Standard props from componentData
    ...componentData.props;

    // Lifecycle callbacks
    onMount?: () => void;
    onUnmount?: () => void;
    onStateChange?: (newState: any) => void;
    onResize?: (width: number, height: number) => void;
    onMove?: (x: number, y: number) => void;

    // Canvas context (for deep integration)
    canvasContext?: {
        worldData: WorldData;
        cursorPos: Point;
        viewOffset: Point;
        zoomLevel: number;
        worldToScreen: (x: number, y: number) => Point;
        screenToWorld: (x: number, y: number) => Point;
    };
}
```

### 4. Transform Synchronization

```typescript
function ComponentOverlayLayer({ worldData, viewOffset, zoomLevel }: Props) {
    // Sync transforms with canvas
    const overlayStyle = useMemo(() => ({
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        // Apply canvas transforms to overlay
        transform: `translate(${viewOffset.x}px, ${viewOffset.y}px) scale(${zoomLevel})`,
        transformOrigin: 'top left'
    }), [viewOffset, zoomLevel]);

    return (
        <div style={overlayStyle}>
            {componentNotes.map(note => (
                <ComponentRenderer
                    key={note.timestamp}
                    note={note}
                    // Individual components don't need transforms (handled by parent)
                />
            ))}
        </div>
    );
}
```

### 5. Performance Optimizations

```typescript
// Virtual rendering - only render components in viewport
function ComponentOverlayLayer({ worldData, viewOffset, zoomLevel, canvasBounds }: Props) {
    const visibleComponents = useMemo(() => {
        const viewport = {
            startX: -viewOffset.x / zoomLevel,
            endX: (canvasBounds.width - viewOffset.x) / zoomLevel,
            startY: -viewOffset.y / zoomLevel,
            endY: (canvasBounds.height - viewOffset.y) / zoomLevel
        };

        return componentNotes.filter(note => {
            // Check if component bounds intersect viewport
            return !(note.endX < viewport.startX ||
                     note.startX > viewport.endX ||
                     note.endY < viewport.startY ||
                     note.startY > viewport.endY);
        });
    }, [componentNotes, viewOffset, zoomLevel, canvasBounds]);

    return <>{visibleComponents.map(renderComponent)}</>;
}

// Memoize component renders
const ComponentRenderer = React.memo(({ note }: { note: ComponentNote }) => {
    const Component = componentRegistry.get(note.componentData.type)?.Component;
    // ... render logic
}, (prev, next) => {
    // Custom comparison - only re-render if relevant props changed
    return prev.note.componentData.state === next.note.componentData.state &&
           prev.note.startX === next.note.startX &&
           prev.note.startY === next.note.startY;
});
```

---

## Example Components

### Calendar Widget

```typescript
interface CalendarProps extends ComponentProps {
    initialDate?: Date;
    theme?: 'light' | 'dark';
    onDateSelect?: (date: Date) => void;
}

export function CalendarWidget({
    initialDate = new Date(),
    theme = 'light',
    onDateSelect,
    onStateChange
}: CalendarProps) {
    const [selectedDate, setSelectedDate] = useState(initialDate);
    const [currentMonth, setCurrentMonth] = useState(initialDate.getMonth());
    const [currentYear, setCurrentYear] = useState(initialDate.getFullYear());

    const handleDateClick = (date: Date) => {
        setSelectedDate(date);
        onDateSelect?.(date);
        onStateChange?.({ selectedDate: date.toISOString() });
    };

    return (
        <div className={`calendar-widget theme-${theme}`}>
            <div className="calendar-header">
                <button onClick={() => setCurrentMonth(m => m - 1)}>‹</button>
                <span>{MONTHS[currentMonth]} {currentYear}</span>
                <button onClick={() => setCurrentMonth(m => m + 1)}>›</button>
            </div>
            <div className="calendar-grid">
                {/* Render calendar days */}
            </div>
        </div>
    );
}
```

### Kanban Board

```typescript
interface KanbanProps extends ComponentProps {
    columns?: string[];
    cards?: KanbanCard[];
}

export function KanbanBoard({
    columns = ['Todo', 'In Progress', 'Done'],
    cards = [],
    onStateChange
}: KanbanProps) {
    const [boardState, setBoardState] = useState({ columns, cards });

    const handleDragEnd = (result: DropResult) => {
        // Update card position
        const newState = reorderCards(boardState, result);
        setBoardState(newState);
        onStateChange?.(newState);
    };

    return (
        <DragDropContext onDragEnd={handleDragEnd}>
            <div className="kanban-board">
                {columns.map(column => (
                    <KanbanColumn
                        key={column}
                        title={column}
                        cards={boardState.cards.filter(c => c.column === column)}
                    />
                ))}
            </div>
        </DragDropContext>
    );
}
```

---

## Command System Integration

```typescript
// In commands.ts

// Generic component creation
if (commandToExecute.startsWith('component')) {
    const args = parseCommandArgs(commandState.input);
    const componentType = args.arg1; // 'calendar', 'kanban', etc.

    const manifest = componentRegistry.get(componentType)?.manifest;
    if (!manifest) {
        setDialogueWithRevert(`Unknown component: ${componentType}`, setDialogueText);
        clearCommandState();
        return null;
    }

    const selection = getNormalizedSelection?.();
    const bounds = selection || {
        startX: cursorPos.x,
        startY: cursorPos.y,
        endX: cursorPos.x + (manifest.defaultSize?.width || 20),
        endY: cursorPos.y + (manifest.defaultSize?.height || 15)
    };

    const componentNote: ComponentNote = {
        ...bounds,
        timestamp: Date.now(),
        contentType: 'component',
        componentData: {
            type: componentType,
            version: '1.0.0',
            props: manifest.defaultProps || {},
            state: {},
            width: bounds.endX - bounds.startX,
            height: bounds.endY - bounds.startY,
            interactive: true,
            draggable: true,
            resizable: true,
            createdAt: Date.now(),
            updatedAt: Date.now()
        }
    };

    const key = `note_${bounds.startX},${bounds.startY}_${Date.now()}`;
    setWorldData({ ...worldData, [key]: JSON.stringify(componentNote) });

    setDialogueWithRevert(
        `${manifest.name} created at (${bounds.startX}, ${bounds.startY})`,
        setDialogueText
    );
    clearCommandState();
    return null;
}

// Shorthand commands
if (commandToExecute.startsWith('calendar')) {
    // Equivalent to: /component calendar
    return executeComponentCommand('calendar');
}

if (commandToExecute.startsWith('kanban')) {
    return executeComponentCommand('kanban');
}
```

---

## Performance Benchmarks

### Target Performance

```
Operation                    Target      Current (est)
─────────────────────────────────────────────────────
Component render (first)     < 16ms      ~10ms ✅
Component update             < 8ms       ~5ms ✅
Pan canvas with 10 comps     60fps       60fps ✅
Zoom with 10 comps           60fps       55fps ⚠️
Create new component         < 100ms     ~50ms ✅
Load canvas with 20 comps    < 1000ms    ~800ms ✅
```

### Optimization Strategies

1. **Virtual Rendering** - Only render components in viewport
2. **Memoization** - React.memo on ComponentRenderer
3. **Throttle Transforms** - Debounce pan/zoom updates to 16ms
4. **Layer Caching** - Cache component renders during pan/zoom
5. **Web Workers** - Offload heavy calculations (chart data processing)

---

## State Persistence

### Firebase Schema

```typescript
// worldData structure
{
    "note_100,50_1705555200000": {
        "startX": 100,
        "endX": 120,
        "startY": 50,
        "endY": 65,
        "timestamp": 1705555200000,
        "contentType": "component",
        "componentData": {
            "type": "calendar",
            "version": "1.0.0",
            "props": {
                "theme": "light"
            },
            "state": {
                "selectedDate": "2025-01-18T00:00:00.000Z",
                "currentMonth": 0,
                "currentYear": 2025
            },
            "width": 20,
            "height": 15,
            "interactive": true,
            "draggable": true,
            "resizable": true,
            "createdAt": 1705555200000,
            "updatedAt": 1705555300000
        }
    }
}
```

### State Sync

```typescript
// Auto-save component state on change (debounced)
const updateComponentState = useDebouncedCallback((
    note: ComponentNote,
    newState: any
) => {
    const key = `note_${note.startX},${note.startY}_${note.timestamp}`;
    const updatedNote = {
        ...note,
        componentData: {
            ...note.componentData,
            state: newState,
            updatedAt: Date.now()
        }
    };

    setWorldData(prev => ({
        ...prev,
        [key]: JSON.stringify(updatedNote)
    }));
}, 500); // Debounce 500ms to avoid excessive writes
```

---

## Extensibility Model

### For Internal Developers

```typescript
// 1. Create component
// components/widgets/TaskList.tsx
export function TaskListWidget({ tasks, onTaskToggle, onStateChange }: Props) {
    // ... component implementation
}

// 2. Register component
// components/registry.ts
componentRegistry.register({
    type: 'tasklist',
    name: 'Task List',
    description: 'Todo list with checkboxes',
    icon: '✓',
    defaultSize: { width: 15, height: 20 },
    category: 'productivity'
}, TaskListWidget);

// 3. Add command (optional)
// commands.ts
if (commandToExecute.startsWith('tasks')) {
    return executeComponentCommand('tasklist');
}
```

### For External Developers (Future)

```typescript
// Package: @nara/component-sdk
import { defineComponent } from '@nara/component-sdk';

export const MyWidget = defineComponent({
    type: 'my-widget',
    name: 'My Widget',
    description: 'Custom widget',

    component: ({ props, state, onStateChange }) => {
        // React component implementation
        return <div>My Widget</div>;
    },

    defaultProps: {
        color: 'blue'
    },

    defaultSize: {
        width: 10,
        height: 10
    }
});

// Usage in Nara
// /component my-widget
```

---

## Migration Strategy

### Phase 1: Foundation (Week 1-2)
- [ ] Add `contentType: 'component'` to Note interface
- [ ] Implement ComponentOverlayLayer with React Portal
- [ ] Build component registry system
- [ ] Add transform synchronization (pan/zoom)
- [ ] Create demo calendar component
- [ ] Test viewport culling performance

### Phase 2: Core Components (Week 3-4)
- [ ] Build CalendarWidget
- [ ] Build KanbanBoard
- [ ] Build ChartWidget (line, bar, pie)
- [ ] Build MarkdownEditor
- [ ] Add component creation commands
- [ ] Implement state persistence
- [ ] Add resize/drag handlers

### Phase 3: Polish (Week 5-6)
- [ ] Component theming system
- [ ] Accessibility improvements (ARIA labels)
- [ ] Performance optimization (virtual rendering)
- [ ] Component marketplace UI
- [ ] Documentation + examples
- [ ] Wrap as Web Components

### Phase 4: Extensibility (Week 7-8)
- [ ] Create @nara/component-sdk package
- [ ] External component loading system
- [ ] Component version management
- [ ] Security sandboxing
- [ ] Component store/marketplace

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Performance regression | HIGH | Virtual rendering, memoization, benchmarking |
| Z-index conflicts | MEDIUM | Explicit layer management, z-index allocation |
| Transform complexity | MEDIUM | Thorough testing, fallback to fixed positioning |
| State sync bugs | HIGH | Debounced writes, optimistic updates, conflict resolution |
| Component bloat | MEDIUM | Lazy loading, code splitting, tree shaking |
| Security (external components) | HIGH | Sandboxing, CSP headers, permission system |

---

## Success Metrics

### Quantitative
- **Component creation time** < 100ms
- **Pan/zoom with 10 components** = 60fps
- **Component library size** < 100KB (per component)
- **Time to add new component** < 2 hours (for developer)

### Qualitative
- **Developer experience** - Easy to create new components
- **User experience** - Feels native, not bolted-on
- **Extensibility** - External devs can contribute components
- **Consistency** - Components follow design system

---

## Open Questions

1. **Should components be sandboxed?** (iframe vs same-origin)
2. **How to handle component authentication?** (OAuth, API keys)
3. **Component marketplace business model?** (free, paid, revenue share)
4. **Version compatibility?** (Breaking changes in component API)
5. **Cross-component communication?** (Event bus, shared state)

---

## Conclusion

The **React Portal + DOM Overlay approach (Option A)** is the recommended path forward:

✅ **Fastest time to value** - Reuse existing React ecosystem
✅ **Best developer experience** - Familiar patterns, great tooling
✅ **Maximum extensibility** - Easy to add new components
✅ **Future-proof** - Can migrate to Web Components later

This approach transforms bit.canvas from a **text-centric spatial canvas** into a **full application platform** where any UI component can be spatially positioned and persisted.

**Next Step:** Create proof-of-concept with calendar component to validate architecture.

---

*Last updated: 2025-01-18*
*Version: 1.0 - Component Extensibility Strategy*
