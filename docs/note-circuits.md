# Note Circuits: From Spatial Patterns to Functional Flows

## Overview

Currently, the `/connect` command creates **spatial patterns** - notes linked by corridors using Prim's MST algorithm. These serve visual/navigational purposes but carry no semantic meaning about data flow.

This document proposes **Note Circuits**: a system where connected notes form functional computation graphs, with data flowing through corridors like signals through wires.

---

## The Deeper Question: Agents Already Have Circuits

An agent's behavior chain *is* a circuit:

```
perceive → context → think → decide → act → observe → loop
```

This is programmatic and conversational - the "wiring" lives in the agent's mind, not in the spatial substrate. The agent can rewire itself each think cycle based on goals and context.

### What's the difference?

| Aspect | Agent's Internal Circuit | Substrate Circuit |
|--------|-------------------------|-------------------|
| **Topology** | Fluid, goal-dependent | Fixed, spatial |
| **Wiring** | Implicit in reasoning | Explicit on canvas |
| **Visibility** | Opaque (in agent's head) | Visible infrastructure |
| **Modification** | Agent rewires itself | User/builder rewires |
| **Execution** | Conversational turns | Dataflow propagation |
| **Who controls** | Agent's autonomy | External structure |

### The Real Question

If agents can already do reactive processing through their think loops, why bake circuits into the substrate?

**Possible answers:**

1. **Legibility** - Substrate circuits are *visible*. You can see the data flow, debug it, understand it without reading an agent's mind.

2. **Persistence** - Agent circuits exist only while the agent thinks. Substrate circuits persist, run without agents, survive agent death.

3. **Composition** - Multiple agents can *use* the same substrate circuit. It becomes shared infrastructure rather than private cognition.

4. **Non-agent automation** - Not everything needs a mind. Some things should just... flow. Like plumbing.

5. **Performance** - Dataflow execution can be optimized, parallelized, cached. Agent reasoning is expensive.

But maybe the answer is: **we don't need substrate circuits at all**. Maybe the right move is to make agent reasoning more visible/inspectable, rather than creating a parallel system.

### Alternative: Agent Traces as Emergent Circuits

Instead of pre-wiring circuits, let agents leave **traces** of their data flow:

```
Agent visits Note A → reads data → walks to Note B → writes result
                   ↓
         Trail shows the "wire" that emerged
```

The circuit isn't designed - it's *discovered* through agent behavior. The substrate records what happened, and patterns emerge.

---

## Current Affordances

### Note Types & Their Capabilities

| Type | Can Produce | Can Consume | Reactive? |
|------|-------------|-------------|-----------|
| **Text** | String content | Manual input | No |
| **Data (Table)** | Named datasets | Cell references | No |
| **Script (JS/Py)** | Output, table updates | `nara.read_table()` | On `/run` |
| **Terminal** | stdout stream | stdin | Yes (websocket) |
| **Image** | Pixel data | Generation prompts | No |

### Existing Cross-Note Communication

Python scripts can already read/write named tables:
```python
# Script A creates data
df = pd.DataFrame({'x': [1,2,3], 'y': [4,5,6]})
nara.output_table(df)  # Creates new data note

# Script B (after naming the table "source")
data = nara.read_table('source')  # Reads from named note
data['z'] = data['x'] + data['y']
nara.write_table('source', data)  # Updates in place
```

This is **pull-based** - consumers explicitly request data.

---

## The Circuit Paradigm

### Agents vs Circuits

| Aspect | Agents | Circuits |
|--------|--------|----------|
| **Model** | Autonomous actors | Reactive data flow |
| **Movement** | Roam freely, decide where to go | Fixed topology, data moves |
| **State** | Internal memory + goals | Stateless transforms (mostly) |
| **Trigger** | `think()` cycles, external stimuli | Upstream data changes |
| **Tools** | Full tool access, can modify world | Scoped to inputs → outputs |
| **Metaphor** | NPCs with agency | Spreadsheet formulas + pipes |

Agents are **beings**. Circuits are **infrastructure**.

They complement each other: an agent might *use* a circuit to process data, or a circuit might *summon* an agent when certain conditions are met.

---

## Circuit Primitives

### 1. Ports: Input/Output Declarations

Notes declare their interface:

```
┌─────────────────────────┐
│ [in: numbers]  SCRIPT   │
│                         │
│ sum = 0                 │
│ for n in numbers:       │
│   sum += n              │
│ return sum        [out] │
└─────────────────────────┘
```

- **Input ports** (`[in: name]`): Data this note expects
- **Output ports** (`[out]` or `[out: name]`): Data this note produces
- Ports are edge attachment points for corridors

### 2. Wires: Typed Corridors

When you `/connect` two notes, the corridor becomes a **wire**:

```
┌──────────┐          ┌──────────┐
│  Source  │──[wire]──│   Sink   │
│   [out]  │          │  [in]    │
└──────────┘          └──────────┘
```

Wire properties:
- **Direction**: Source → Sink (one-way data flow)
- **Type**: Inferred from source output (`string`, `table`, `number`, `any`)
- **Buffer**: Optional - hold last N values, or stream through

### 3. Triggers: When Data Flows

| Trigger Mode | Description |
|--------------|-------------|
| **Manual** | User runs `/pulse` or clicks play |
| **On Change** | Source output changes → downstream fires |
| **Interval** | Every N seconds |
| **On Event** | External event (agent arrives, time of day, etc.) |

---

## Note Types as Circuit Components

### Text Notes → Display / Input

```
┌─────────────────────────┐
│ Current temperature:    │
│ {upstream.value}°C      │  ← Template interpolation
└─────────────────────────┘
```

- **As sink**: Display upstream values via `{path.to.value}` templates
- **As source**: Emit text content when edited (debounced)
- **Reactive mode**: Enable with `/reactive` - updates propagate downstream

### Data Notes → State / Buffers

```
┌─────────────────────────┐
│ sensor_log              │
│ ─────────────────────── │
│ time     | temp | humid │
│ 10:01    | 23.4 | 45%   │
│ 10:02    | 23.5 | 44%   │  ← Append-only log from upstream
└─────────────────────────┘
```

- **As sink**: Append rows, update cells, or replace entirely
- **As source**: Emit on any cell change, or batch on row complete
- **Modes**:
  - `append` - new data adds rows
  - `window(N)` - keep last N rows
  - `replace` - overwrite on each update

### Script Notes → Transform / Compute

```python
# [in: raw_data]
# [out: processed]

import pandas as pd

df = nara.input('raw_data')  # Reads from input port
df['normalized'] = (df['value'] - df['value'].mean()) / df['value'].std()

nara.output(df)  # Sends to output port
```

- **Transform mode**: Pure function, runs when inputs change
- **Generator mode**: Produces data on interval (sensors, clocks)
- **Filter mode**: Passes through or blocks based on condition

### Terminal Notes → External I/O

```
┌─────────────────────────┐
│ $ tail -f /var/log/app  │
│ [2024-01-15] INFO ...   │
│ [2024-01-15] WARN ...   │  → Each line emits downstream
└─────────────────────────┘
```

- **As source**: stdout lines become data events
- **As sink**: stdin receives upstream strings
- Bridge to external world (APIs, files, processes)

### Image Notes → Visual Compute

```
┌─────────────────────────┐
│ [in: prompt]            │
│                         │
│     🖼️ Generated        │
│        Image            │
│                         │
│              [out: img] │
└─────────────────────────┘
```

- **As sink**: Regenerate when prompt input changes
- **As source**: Emit image data (for analysis, storage)

---

## Circuit Topology

### Linear Pipeline

```
[Sensor] ──→ [Filter] ──→ [Transform] ──→ [Display]
```

Simple ETL: Extract → Transform → Load

### Fan-Out (Broadcast)

```
              ┌──→ [Logger]
[Source] ────┼──→ [Display]
              └──→ [Alert Check]
```

One source feeds multiple consumers

### Fan-In (Merge)

```
[Temp Sensor] ──┐
                ├──→ [Aggregator] ──→ [Dashboard]
[Humid Sensor] ─┘
```

Multiple sources combine into one processor

### Feedback Loop

```
[State] ──→ [Compute] ──→ [Update]
   ↑                         │
   └─────────────────────────┘
```

Output feeds back as input (with cycle detection/breaking)

---

## Implementation Sketch

### 1. Port Metadata on Notes

Extend the note data model:

```typescript
interface NoteCircuitData {
  ports?: {
    inputs?: Array<{ name: string; type?: string }>;
    outputs?: Array<{ name: string; type?: string }>;
  };
  circuitMode?: 'transform' | 'generator' | 'sink' | 'source';
  triggerMode?: 'manual' | 'onChange' | 'interval';
  intervalMs?: number;
}
```

### 2. Wire Data on Corridors

Corridors gain semantic meaning:

```typescript
interface WireData {
  sourceNoteKey: string;
  sourcePort: string;
  sinkNoteKey: string;
  sinkPort: string;
  bufferSize?: number;
  lastValue?: any;
}
```

### 3. Circuit Executor

New module that orchestrates execution:

```typescript
class CircuitExecutor {
  // Build dependency graph from pattern
  buildGraph(patternKey: string): CircuitGraph;

  // Topological sort for execution order
  getExecutionOrder(): string[];

  // Run one node, propagate outputs
  executeNode(noteKey: string, inputs: Record<string, any>): any;

  // Full circuit pulse
  pulse(patternKey: string): void;

  // Set up reactive listeners
  enableReactive(patternKey: string): void;
}
```

### 4. Commands

| Command | Description |
|---------|-------------|
| `/circuit` | Convert selected pattern to circuit mode |
| `/port in:name` | Add input port to current note |
| `/port out:name` | Add output port to current note |
| `/wire` | Connect selected ports (when 2 notes selected) |
| `/pulse` | Execute circuit once |
| `/reactive` | Enable auto-execution on changes |

---

## Example: Weather Dashboard Circuit

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   API       │     │  Transform  │     │  Display    │
│  Fetcher    │────→│   Script    │────→│    Note     │
│             │     │             │     │             │
│ /interval   │     │ Parse JSON  │     │ Temp: {t}°  │
│ 60000ms     │     │ Extract     │     │ Humid: {h}% │
└─────────────┘     └─────────────┘     └─────────────┘
      │
      │
      ↓
┌─────────────┐
│   History   │
│   Table     │
│             │
│ append mode │
│ window(100) │
└─────────────┘
```

Setup:
1. Create terminal note running `curl` on interval
2. Create script note that parses JSON response
3. Create text note with template placeholders
4. Create data note in append mode
5. `/connect` them all, then `/circuit` to enable flow
6. `/reactive` to start auto-updates

---

## Contrast with Agents

### When to Use Circuits

- **Deterministic pipelines**: Same input → same output
- **Data transformation**: ETL, aggregation, formatting
- **Monitoring**: Dashboards, logs, alerts
- **Automation**: Scheduled tasks, webhooks

### When to Use Agents

- **Exploration**: Agent decides where to look
- **Creative tasks**: Agent uses judgment
- **Multi-step reasoning**: Agent plans and adapts
- **World modification**: Agent creates/deletes/moves things

### Hybrid: Agents + Circuits

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Anomaly    │     │   Agent     │     │  Response   │
│  Detector   │────→│  Summoner   │────→│   Logger    │
│  (circuit)  │     │             │     │  (circuit)  │
└─────────────┘     └─────────────┘     └─────────────┘
                          │
                          ↓
                    ┌───────────┐
                    │  🧙 Agent │
                    │  spawns,  │
                    │  investigates
                    └───────────┘
```

Circuit detects anomaly → spawns agent → agent investigates → reports back to circuit

---

## Open Questions

1. **Cycle handling**: Allow cycles with explicit delay/buffer? Or forbid?
2. **Error propagation**: How do errors flow through the circuit?
3. **Debugging**: Visual indicators for data flow, breakpoints?
4. **Persistence**: Should wire state survive reload?
5. **Composition**: Can circuits contain sub-circuits (nested patterns)?
6. **Types**: Runtime type checking on wires? Or duck typing?

---

## Next Steps

1. **Prototype port declarations** - Parse `[in:name]` / `[out]` in note content
2. **Wire metadata on corridors** - Extend corridor data structure
3. **Simple executor** - Manual `/pulse` that runs connected scripts in order
4. **Reactive mode** - Hook into worldData changes for auto-propagation
5. **Visual feedback** - Show data flowing through corridors (animation?)

---

## Summary

| Concept | Spatial Patterns | Note Circuits |
|---------|------------------|---------------|
| **Purpose** | Visual organization | Functional computation |
| **Corridors** | Navigation paths | Data wires |
| **Notes** | Containers | Components with I/O |
| **Connection** | Spatial adjacency | Data dependency |
| **Execution** | None | Topological flow |

Circuits turn the canvas from a **map** into a **machine**.
