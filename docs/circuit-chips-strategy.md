# Circuit Chips Strategy: Reliable Execution Infrastructure

**December 2024**

---

## Overview

This document outlines the architecture for **action chips** and **circuits** - a deterministic execution layer built on top of the existing `sense/make` agent infrastructure. The goal is to enable high-throughput, reliable execution of user will without AI interpretation overhead.

---

## Problem Statement

Current agent interactions involve:
1. User prompt → AI interpretation → AI decides → action (maybe)
2. Wiggle room, variation, non-deterministic outcomes
3. Lack of debuggability - hard to verify what happened
4. No orchestration - can't plan sequences or routines

The `sense/make` interface in ai.tools.ts is reliable and well-structured, but it's wrapped in AI decision-making. We need direct access to this execution layer.

---

## Core Insight

**The agent command structure is the most reliable mechanism we have.**

Build orchestration on top of it, not parallel to it. The same execution path used by MCP tools should be available to users directly through chips.

---

## Architecture

### Hierarchy

```
PRIMITIVE:     Chip (single sense/make call)
                 │
                 │ rails connect
                 ↓
COMPOSITION:   Circuit (chips wired together)
                 │
                 │ pack serializes
                 ↓
STORAGE:       Circuit Pack (lives in data table, toggleable)
```

### Chip Definition

A chip is a stored `sense()` or `make()` call with no AI interpretation:

```typescript
interface ActionChip {
  id: string;
  type: 'sense' | 'make';
  label: string;

  // Position on canvas
  x: number;
  y: number;

  // The actual action - same types as ai.tools.ts
  senseArgs?: SenseArgs;  // { find: 'notes', region?: {...} }
  makeArgs?: MakeArgs;    // { paint: {...} } | { note: {...} } | etc.

  // Execution config
  trigger?: 'click' | 'interval' | 'chain' | 'manual';
  intervalMs?: number;

  // Wiring
  inputFrom?: string[];   // chip IDs that feed into this
  outputTo?: string[];    // chip IDs this feeds into
}
```

### Execution Semantics

When a chip triggers:

```typescript
// No AI, no prompt, no thinking - direct execution
if (chip.type === 'sense') {
  const result = executeSense(chip.senseArgs);
  passToOutputs(chip.outputTo, result);
} else {
  executeMake(chip.makeArgs);
  signalOutputs(chip.outputTo);
}
```

Same code path as MCP tool calls. Deterministic. Reliable.

---

## Rails: Connective Infrastructure

Rails are the wiring between chips that enable:

### Sequencing
```
[Chip A] ──rail──→ [Chip B] ──rail──→ [Chip C]
```
Chip A completes → triggers Chip B → triggers Chip C

### Parallelization
```
         ┌──→ [Chip B]
[Chip A] ┤
         └──→ [Chip C]
```
Chip A completes → triggers B and C simultaneously

### Joining
```
[Chip B] ──┐
           ├──→ [Chip D]
[Chip C] ──┘
```
Chip D waits for both B and C before executing

### Data Flow
```
[sense: find notes] ──data──→ [make: process each]
```
Output of sense becomes input context for make

### Visual Representation

Rails could be rendered as:
- Corridors between chips (reuse vascular system)
- Special "wire" paint color
- Or implicit via chip metadata (inputFrom/outputTo)

---

## Circuit Packs

A circuit is a graph of chips. A circuit pack serializes this for storage and reuse.

```typescript
interface CircuitPack {
  id: string;
  name: string;

  // The chip graph
  chips: ActionChip[];

  // Entry points - which chips can be triggered externally
  entryPoints: string[];  // chip IDs

  // Metadata
  created: number;
  description?: string;
}
```

### Special Behavior

Circuit packs differ from regular packs:

| Regular Pack | Circuit Pack |
|--------------|--------------|
| Unpacks to canvas content | Unpacks to executable graph |
| Static data | Active program |
| View/edit | Toggle/execute |
| Passive | Reactive |

### Storage in Data Tables

Circuit packs can live in data table cells:

```
| Name          | Circuit              | Last Run    |
|---------------|----------------------|-------------|
| Daily backup  | [circuit:backup_01]  | 2024-12-10  |
| Paint grid    | [circuit:grid_03]    | 2024-12-09  |
```

Clicking the circuit cell toggles/executes it.

---

## Chip Construction Methods

### 1. Direct Creation (UI)
- Place chip on canvas via command: `/chip sense find:notes`
- Opens property panel to configure
- Position determines canvas location

### 2. Recording Agent Actions
- Agent performs action via `make()`
- User can "capture" that action as a chip
- Chip replays exact same action

### 3. Script Emission
- Script note can output chip definitions
- `nara.create_chip({ type: 'make', makeArgs: {...} })`
- Programmatic circuit construction

### 4. Circuit Editor
- Visual editor for wiring chips
- Drag to connect, define flow
- Export as circuit pack

---

## Execution Layer Requirements

For this to work, the sense/make execution layer must be:

| Requirement | Description |
|-------------|-------------|
| **Deterministic** | Same input → same output, always |
| **High throughput** | Many chips firing rapidly |
| **No dropped actions** | Every trigger executes |
| **Observable** | Log of what happened, when |
| **Atomic** | Actions complete fully or not at all |

### Logging/Debuggability

Every chip execution logs:
```typescript
interface ChipLog {
  chipId: string;
  timestamp: number;
  type: 'sense' | 'make';
  args: SenseArgs | MakeArgs;
  result?: any;        // for sense
  success: boolean;
  error?: string;
  durationMs: number;
}
```

Visible log stream for debugging. Users can see exactly what happened.

---

## Implementation Phases

### Phase 1: Chip Primitive
- [ ] Define ActionChip type
- [ ] Chip rendering on canvas (like existing chips but with action metadata)
- [ ] Click-to-execute for single chips
- [ ] Direct wiring to sense/make execution

### Phase 2: Rails
- [ ] Define rail connections between chips
- [ ] Sequential execution (A → B → C)
- [ ] Parallel execution (A → B, C)
- [ ] Visual representation of rails

### Phase 3: Circuit Packs
- [ ] Circuit serialization format
- [ ] Pack/unpack for circuits
- [ ] Circuit pack in data table cells
- [ ] Toggle execution from table

### Phase 4: Orchestration
- [ ] Timer triggers (interval execution)
- [ ] Conditional execution (if sense returns X, do Y)
- [ ] Loop constructs
- [ ] External triggers (webhook, event)

### Phase 5: Tooling
- [ ] Chip creation UI
- [ ] Action recording (agent → chip)
- [ ] Circuit editor
- [ ] Execution log viewer

---

## Relationship to Existing Layers

| Layer | Role in Circuit System |
|-------|------------------------|
| **Nucleic** | Chips rendered as cell groups |
| **Composit** | Circuit packs stored in data tables |
| **Dermic** | Chip labels, descriptions |
| **Vesic** | Circuit pack serialization |
| **Perceptive** | Bounded execution context |
| **Agentic** | sense/make execution engine |
| **Aesthetic** | Chip visual styling |
| **Vascular** | Rails connecting chips |

The circuit system doesn't replace layers - it orchestrates across them.

---

## Open Questions

1. **Rail visualization** - Reuse corridors? New primitive? Implicit via metadata?

2. **Data passing** - How does sense output flow to make input? JSON? References?

3. **Error handling** - What happens when a chip fails mid-circuit?

4. **Scoping** - Can circuits access any canvas state or only local context?

5. **Permissions** - Should some chips require confirmation before executing?

6. **Versioning** - How to handle circuit packs when chip definitions change?

---

## Summary

Action chips provide direct, deterministic access to the reliable sense/make execution layer. Rails wire chips into circuits. Circuit packs serialize circuits for storage and reuse.

This creates a visual programming substrate where:
- Chips are buttons wired to actions
- Rails are the control flow
- Circuits are programs
- The canvas is the IDE

User will → chip → execution. No AI interpretation. High throughput. Reliable.

---

*December 2024. Nara Project.*
