# Ambient Orchestration Synthesis
## Labels as Controllers, Ambient Scripts as Intelligence, Notes as Rendering Targets

**Date:** 2025-01-18
**Vision:** Combine ambient scripting + label system + note consolidation into unified orchestration layer

---

## The Synthesis: Three Systems, One Vision

```
┌─────────────────────────────────────────────────────────┐
│ LABELS (Controllers/Anchors)                            │
│ - Spatial markers with semantic meaning                 │
│ - "StockWatch", "CalendarRegion", "DataFeed"            │
│ - Trigger points for ambient scripts                    │
│ - Visual indicators of active automation                │
└──────────────────────┬──────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│ AMBIENT SCRIPTS (Intelligence/Automation)               │
│ - Watch for events (textChange, labelCreate, etc)       │
│ - Execute background logic (fetch data, compute, etc)   │
│ - Create/update rendering artifacts                     │
│ - Orchestrate multi-note interactions                   │
└──────────────────────┬──────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│ NOTES (Rendering Targets)                               │
│ - contentType-based rendering (text, image, component)  │
│ - Canvas-native GUI widgets                             │
│ - Data visualization surfaces                           │
│ - Controlled by labels + ambient scripts                │
└─────────────────────────────────────────────────────────┘
```

---

## Core Insight: Labels as Orchestration Anchors

### Current Label System

```typescript
// Existing label structure
interface Label {
    type: 'landmark' | 'task' | 'link';
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    text: string;
    color?: string;
    timestamp: number;
}
```

### Extended: Labels as Script Triggers

```typescript
// Enhanced label with ambient script binding
interface Label {
    // Existing fields
    type: 'landmark' | 'task' | 'link' | 'script-anchor';  // NEW type
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    text: string;
    color?: string;
    timestamp: number;

    // NEW: Ambient script orchestration
    scriptBindings?: {
        scriptId: string;           // Which ambient script controls this
        role: 'trigger' | 'target' | 'controller';
        config?: any;               // Script-specific configuration
    }[];

    // NEW: Rendering directive
    renderTarget?: {
        noteKey: string;            // Which note to control
        contentType: string;        // What to render there
        updateFrequency?: number;   // How often to update (ms)
    };
}
```

### Example: Stock Ticker Label

```typescript
// User creates label: "AAPL" at position (100, 50)
const stockLabel: Label = {
    type: 'script-anchor',
    startX: 100,
    startY: 50,
    endX: 115,
    endY: 52,
    text: 'AAPL',
    color: '#007aff',
    timestamp: Date.now(),

    // Binds to ambient stock price monitor
    scriptBindings: [{
        scriptId: 'stock-price-monitor',
        role: 'trigger',
        config: {
            symbol: 'AAPL',
            updateInterval: 5000  // 5 seconds
        }
    }],

    // Creates/updates note below label
    renderTarget: {
        noteKey: `note_${100},${53}_stock-display`,
        contentType: 'component',  // Canvas-native stock widget
        updateFrequency: 5000
    }
};
```

**Visual Result:**
```
┌──────────────┐
│  AAPL        │  ← Label (trigger)
└──────────────┘
┌──────────────┐
│ $178.32 ↑    │  ← Note (rendering target)
│ +2.5% today  │
└──────────────┘
```

---

## Architecture: Ambient Scripts + Labels + Notes

### Flow 1: Label Creates Component

```
1. User types: /label StockWatch

   ↓

2. Command creates label at cursor:
   - type: 'script-anchor'
   - text: 'StockWatch'
   - scriptBindings: ['stock-monitor']

   ↓

3. Ambient script engine detects new label:
   - scriptEngine.onLabelCreate(label)
   - Finds bound script: stock-monitor
   - Activates script with label config

   ↓

4. Ambient script creates note:
   - Position: below label
   - contentType: 'component'
   - componentData: { type: 'stock-ticker' }

   ↓

5. Canvas renders component:
   - CanvasStockTicker.render(ctx, viewport)
   - Displays live stock prices
   - Updates every 5 seconds

   ↓

6. User sees:
   ┌──────────────┐
   │ StockWatch   │  ← Label (orchestrator)
   ├──────────────┤
   │ AAPL $178.32 │
   │ GOOGL $141.23│  ← Component (target)
   │ MSFT $420.50 │
   └──────────────┘
```

### Flow 2: Label Triggers Data Visualization

```
User types: "Revenue Q1: $10,000, Q2: $15,000, Q3: $12,000"

   ↓

Ambient script "data-detector" monitors text:
   - Detects numeric pattern
   - Extracts: [10000, 15000, 12000]

   ↓

Creates label automatically:
   /label DataViz @ end of line
   - scriptBindings: ['chart-generator']
   - config: { dataPoints: [10000, 15000, 12000] }

   ↓

Chart-generator script creates note:
   - Position: below data
   - contentType: 'component'
   - componentData: {
       type: 'line-chart',
       data: [10000, 15000, 12000],
       labels: ['Q1', 'Q2', 'Q3']
     }

   ↓

User sees:
Revenue Q1: $10,000, Q2: $15,000, Q3: $12,000  [DataViz]

┌────────────────────┐
│   Revenue Trend    │
│        •           │
│      •   •         │
│    •       •       │  ← Canvas-rendered chart
│  •                 │
│ Q1   Q2   Q3   Q4  │
└────────────────────┘
```

---

## Ambient Script Types for Orchestration

### Type 1: Component Spawner

```typescript
// Ambient script that creates canvas components
~automate componentSpawner {
    trigger: 'labelCreate'
    condition: (label) => label.type === 'script-anchor'

    action: async (label) => {
        // Determine component type from label text
        const componentType = inferComponentType(label.text);

        // Create note below label
        const noteKey = `note_${label.startX},${label.endY + 2}_${Date.now()}`;
        const componentNote = {
            startX: label.startX,
            endX: label.endX,
            startY: label.endY + 2,
            endY: label.endY + 15,
            timestamp: Date.now(),
            contentType: 'component',
            componentData: {
                type: componentType,
                props: extractPropsFromLabel(label),
                state: {}
            }
        };

        // Add to worldData
        setWorldData(prev => ({
            ...prev,
            [noteKey]: JSON.stringify(componentNote)
        }));

        // Register canvas component
        const component = new componentRegistry.get(componentType)!.Component(
            noteKey,
            componentNote.bounds,
            componentNote.componentData.props
        );

        canvasComponentRegistry.register(component);
    }
}

function inferComponentType(labelText: string): string {
    if (labelText.match(/stock|ticker|price/i)) return 'stock-ticker';
    if (labelText.match(/calendar|date/i)) return 'calendar';
    if (labelText.match(/chart|graph|viz/i)) return 'chart';
    if (labelText.match(/kanban|tasks|todo/i)) return 'kanban';
    return 'generic-widget';
}
```

### Type 2: Live Data Feed

```typescript
// Ambient script that updates components with live data
~live stockPriceFeed {
    trigger: 'interval'
    interval: 5000  // 5 seconds

    action: async () => {
        // Find all stock-ticker components
        const stockComponents = canvasComponentRegistry.getAll()
            .filter(c => c.type === 'stock-ticker');

        for (const component of stockComponents) {
            // Fetch latest price
            const symbol = component.props.symbol;
            const price = await fetchStockPrice(symbol);

            // Update component state
            component.update({
                currentPrice: price.current,
                change: price.change,
                percentChange: price.percentChange
            });

            // Component re-renders automatically
        }
    }
}
```

### Type 3: Data Sync Between Components

```typescript
// Ambient script that keeps multiple components in sync
~monitor dataSyncOrchestrator {
    watch: 'componentStateChange'

    action: (change) => {
        // When one component's data changes, update related components
        const sourceComponent = change.component;

        // Find related components (same pattern, different visualizations)
        const relatedComponents = canvasComponentRegistry.getAll()
            .filter(c => c.props.dataSource === sourceComponent.props.dataSource);

        for (const component of relatedComponents) {
            // Sync data
            component.update({
                data: sourceComponent.state.data
            });
        }
    }
}
```

### Type 4: Smart Label Placement

```typescript
// Ambient script that auto-creates labels for significant content
~monitor smartLabeler {
    watch: 'textChange'

    action: async (change) => {
        const text = change.text;

        // Detect patterns worth labeling
        if (detectFinancialData(text)) {
            // Create "Revenue" label automatically
            const label = {
                type: 'script-anchor',
                startX: change.position.x - 10,
                startY: change.position.y,
                endX: change.position.x - 1,
                endY: change.position.y + 1,
                text: 'Revenue',
                color: '#00ff00',
                scriptBindings: [{
                    scriptId: 'financial-tracker',
                    role: 'trigger'
                }]
            };

            createLabel(label);
        }

        if (detectDatePattern(text)) {
            // Create "Timeline" label
            createLabel({
                text: 'Timeline',
                scriptBindings: [{ scriptId: 'calendar-visualizer' }]
            });
        }
    }
}
```

---

## Note Consolidation + Components

Your note consolidation strategy already supports this!

```typescript
// Existing note architecture (from SYSTEM_SURVEY.md)
interface Note {
    startX: number;
    endX: number;
    startY: number;
    endY: number;
    timestamp: number;

    contentType?: 'text' | 'image' | 'mail' | 'list' | 'component';  // ← component!

    // For component notes
    componentData?: {
        type: string;        // 'calendar' | 'stock-ticker' | 'chart'
        props: any;
        state: any;
    };
}
```

**The bridge:**
1. Label acts as controller (semantic anchor)
2. Ambient script acts as intelligence (automation logic)
3. Note acts as rendering target (canvas component)

---

## Example Use Cases

### Use Case 1: Financial Dashboard

```typescript
// User setup
/label StockWatch @ (100, 50)
/label PortfolioValue @ (100, 70)

// Ambient scripts activate
~live stockPriceFeed
~monitor portfolioCalculator

// Visual result:
┌───────────────────────────┐
│ StockWatch                │  ← Label (trigger)
├───────────────────────────┤
│ AAPL  $178.32 ↑ +2.5%     │
│ GOOGL $141.23 ↓ -1.2%     │  ← Stock ticker component
│ MSFT  $420.50 ↑ +0.8%     │
└───────────────────────────┘

┌───────────────────────────┐
│ PortfolioValue            │  ← Label (trigger)
├───────────────────────────┤
│ Total: $45,832.11         │
│ Change: +$523.15 (+1.2%)  │  ← Portfolio component
│                           │     (auto-calculated)
│ ┌─────────────────────┐   │
│ │ Chart: 30d trend    │   │
│ └─────────────────────┘   │
└───────────────────────────┘
```

### Use Case 2: Meeting Notes → Action Items

```
User types:
┌──────────────────────────────────┐
│ Meeting Notes - 2025-01-18       │
│                                  │
│ - Follow up with Sarah on Q1     │
│ - Review budget by Friday        │
│ - Send deck to stakeholders      │
└──────────────────────────────────┘

Ambient script detects task pattern:
~monitor taskDetector watches for "- action verb"

Automatically creates label:
[ActionItems]  ← Label appears at top-right

Creates Kanban component below:
┌──────────────────────────────────┐
│ ActionItems                      │  ← Label
├──────────────────────────────────┤
│ Todo        | In Progress | Done │
│ ─────────────────────────────────│
│ • Sarah Q1  |             |      │
│ • Budget    |             |      │  ← Kanban component
│ • Send deck |             |      │
└──────────────────────────────────┘
```

### Use Case 3: Research Paper → Citation Graph

```
User pastes bibliography:
┌──────────────────────────────────┐
│ References:                      │
│ 1. Smith et al. (2023)           │
│ 2. Johnson & Lee (2022)          │
│ 3. Brown (2024)                  │
└──────────────────────────────────┘

Ambient script:
~monitor citationDetector

Creates label + graph component:
[CitationGraph]

┌──────────────────────────────────┐
│ CitationGraph                    │
├──────────────────────────────────┤
│        Smith (2023)              │
│          ↓                       │
│    Johnson (2022)                │  ← Graph component
│          ↓                       │     (shows relationships)
│     Brown (2024)                 │
└──────────────────────────────────┘
```

---

## Implementation Architecture

### Ambient Script Engine + Component System

```typescript
class AmbientOrchestrator {
    private scriptEngine: AmbientScriptEngine;
    private componentRegistry: CanvasComponentRegistry;
    private labelRegistry: Map<string, Label>;

    constructor() {
        this.scriptEngine = new AmbientScriptEngine();
        this.componentRegistry = new CanvasComponentRegistry();
        this.labelRegistry = new Map();

        this.setupOrchestration();
    }

    setupOrchestration() {
        // When label created → trigger bound scripts
        this.scriptEngine.on('labelCreate', (label: Label) => {
            if (label.scriptBindings) {
                for (const binding of label.scriptBindings) {
                    this.activateScript(binding.scriptId, label);
                }
            }
        });

        // When script creates component → register it
        this.scriptEngine.on('componentCreate', (componentData: any) => {
            const component = this.instantiateComponent(componentData);
            this.componentRegistry.register(component);
        });

        // When component updates → trigger dependent scripts
        this.componentRegistry.on('stateChange', (component: CanvasComponent) => {
            const dependentScripts = this.findDependentScripts(component);
            for (const script of dependentScripts) {
                script.execute({ component });
            }
        });
    }

    activateScript(scriptId: string, context: any) {
        const script = this.scriptEngine.getScript(scriptId);
        if (script) {
            script.execute(context);
        }
    }

    instantiateComponent(componentData: any): CanvasComponent {
        const ComponentClass = this.getComponentClass(componentData.type);
        return new ComponentClass(
            componentData.id,
            componentData.bounds,
            componentData.props
        );
    }

    findDependentScripts(component: CanvasComponent): AmbientScript[] {
        // Find scripts that depend on this component
        return this.scriptEngine.getAllScripts()
            .filter(script => {
                return script.dependencies?.includes(component.id);
            });
    }
}
```

### Canvas Rendering Integration

```typescript
// In bit.canvas.tsx render loop
function renderFrame() {
    ctx.clearRect(0, 0, width, height);

    // Layer 1: WebGPU monogram
    renderMonogramLayer(ctx);

    // Layer 2: Text
    renderTextLayer(ctx);

    // Layer 3: Labels (with script indicators)
    renderLabelLayer(ctx);

    // Layer 4: Components (controlled by scripts)
    renderComponentLayer(ctx);

    // Layer 5: Overlays
    renderCursorLayer(ctx);
}

function renderLabelLayer(ctx: CanvasRenderingContext2D) {
    for (const label of labelRegistry.values()) {
        // Standard label rendering
        renderLabel(ctx, label);

        // NEW: Show active script indicator
        if (label.scriptBindings && label.scriptBindings.length > 0) {
            const isActive = ambientOrchestrator.isScriptActive(label.scriptBindings[0].scriptId);
            if (isActive) {
                // Subtle pulsing dot
                ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
                ctx.beginPath();
                ctx.arc(
                    labelScreenX - 5,
                    labelScreenY,
                    2,
                    0,
                    Math.PI * 2
                );
                ctx.fill();
            }
        }
    }
}
```

---

## Command System Integration

### New Commands

```typescript
// /label-script - Create script-bound label
if (commandToExecute.startsWith('label-script')) {
    const args = parseCommandArgs(input);  // "StockWatch stock-ticker"
    const labelText = args.arg1;
    const scriptType = args.arg2 || 'auto';  // Infer from text

    const label: Label = {
        type: 'script-anchor',
        startX: cursorPos.x,
        startY: cursorPos.y,
        endX: cursorPos.x + labelText.length,
        endY: cursorPos.y + 1,
        text: labelText,
        color: '#007aff',
        timestamp: Date.now(),
        scriptBindings: [{
            scriptId: scriptType === 'auto'
                ? inferScriptType(labelText)
                : scriptType,
            role: 'trigger',
            config: {}
        }]
    };

    createLabel(label);
    ambientOrchestrator.activateLabel(label);
}

// /ambient - Manage ambient scripts
if (commandToExecute.startsWith('ambient')) {
    const subcommand = args.arg1;  // "list" | "enable" | "disable"

    if (subcommand === 'list') {
        // Show all active ambient scripts
        const scripts = ambientOrchestrator.getAllScripts();
        showScriptPanel(scripts);
    }

    if (subcommand === 'enable') {
        const scriptId = args.arg2;
        ambientOrchestrator.enableScript(scriptId);
    }

    if (subcommand === 'disable') {
        const scriptId = args.arg2;
        ambientOrchestrator.disableScript(scriptId);
    }
}
```

---

## Migration Roadmap

### Phase 1: Foundation (Week 1-2)
- [ ] Implement AmbientOrchestrator class
- [ ] Extend Label interface with scriptBindings
- [ ] Create script activation/deactivation system
- [ ] Test with simple monitor script

### Phase 2: Component Integration (Week 2-3)
- [ ] Connect ambient scripts to component registry
- [ ] Implement component spawner script
- [ ] Test label → component creation flow
- [ ] Add visual indicators for active scripts

### Phase 3: Built-in Scripts (Week 3-4)
- [ ] Stock ticker live feed
- [ ] Data visualization generator
- [ ] Task detector → Kanban
- [ ] Citation detector → Graph

### Phase 4: User Scripts (Week 4-6)
- [ ] Script editor UI
- [ ] Script template system
- [ ] Script marketplace
- [ ] Documentation + examples

---

## The Vision: Intelligent Spatial Canvas

```
User types naturally on canvas
         ↓
Ambient scripts watch, detect patterns
         ↓
Labels created automatically as anchors
         ↓
Components spawned to visualize/interact
         ↓
Everything updates live, in background
         ↓
Canvas feels alive, intelligent, responsive
```

**Core insight:** Labels aren't just markers - they're **semantic anchors** that trigger ambient intelligence, which orchestrates canvas-native components.

This is the missing link between:
- Your WebGPU pixel control (visual substrate)
- Your note consolidation (rendering targets)
- Your label system (semantic layer)
- Ambient scripting (intelligence layer)

**All in pure canvas. No DOM overlay.**

---

*Last updated: 2025-01-18*
*Version: 1.0 - Ambient Orchestration Synthesis*
