# Paint as Stigmergic Substrate: Emergent Agent Coordination

**December 2024**

---

## Overview

This document proposes an alternative to explicit circuit/rail definitions: using **paint itself** as the coordination medium for agent behavior. Rather than defining connections programmatically, agents perceive and respond to colored pixels, enabling emergent coordination through stigmergy.

---

## Core Insight

**Paint is not just decoration—it's the language and memory of the system.**

Instead of:
```
[Chip A] ──{rail object}──→ [Chip B]
         (explicit connection)
```

We have:
```
[Agent] ░░░░░░░░░░░░░░░░░ [Destination]
        (painted trail)
              │
        ░░░░░█████░░░░░░░░
             (green = turn)
```

Agents don't need to know graph topology. They perceive what's around them and react according to their behavioral rules.

---

## Stigmergy: Why It Works

Stigmergy is indirect coordination through environment modification. Examples:

| System | Medium | Emergent Behavior |
|--------|--------|-------------------|
| Ant colonies | Pheromones | Shortest path finding, dynamic rerouting |
| Termite mounds | Mud + pheromones | Architecture without blueprints |
| Wikipedia | Text + edit history | Knowledge organization |
| Desire paths | Worn grass | Optimal pedestrian routes |
| **Nara canvas** | **Paint** | **?** |

### Properties

1. **No coordination bottleneck** — scales with agents
2. **Memory is externalized** — the paint remembers
3. **Feedback loops** — reinforcement/decay shapes behavior over time
4. **Multi-use** — same paint means different things to different agents
5. **Human-readable** — you can *see* the coordination happening
6. **High ceiling** — simple rules, complex emergent behavior

---

## Agent Behavior Model

### Perception Geometry

| Type | Parameters | Description |
|------|------------|-------------|
| `sense-radius` | `r: number` | How far agent can perceive |
| `sense-angle` | `θ: degrees` | Field of view (360 = omnidirectional) |
| `sense-direction` | `forward \| backward \| left \| right` | Cone orientation |
| `sense-colors` | `colors: string[]` | Which colors register |
| `sense-density` | `threshold: 0-1` | Minimum pixel density to notice |
| `sense-agents` | `boolean` | Detect other agents |
| `sense-notes` | `boolean` | Detect note boundaries |

### Movement Operations

| Operation | Parameters | Description |
|-----------|------------|-------------|
| `move-speed` | `cells/tick` | Base movement rate |
| `move-toward` | `target` | Direct movement to point/color/agent |
| `move-away` | `target` | Flee from target |
| `move-wander` | `variance: degrees` | Random drift |
| `move-orbit` | `center, radius` | Circle around point |
| `move-patrol` | `waypoints[]` | Cycle through positions |

### Path-Following Operations

| Operation | Parameters | Description |
|-----------|------------|-------------|
| `follow-color` | `color: string` | Follow contiguous pixels of color |
| `follow-gradient` | `ascending \| descending` | Move along intensity gradient |
| `follow-density` | `toward \| away` | Move toward/from dense regions |
| `follow-edge` | `left \| right` | Trace boundary of painted region |

### Decision Rules (L-system style)

| Operation | Parameters | Description |
|-----------|------------|-------------|
| `priority` | `colors: string[]` | When multiple paths, rank preference |
| `threshold` | `color, density, action` | If density > N, do action |
| `branch` | `color → action` | Map colors to behaviors |
| `default` | `action` | Fallback when no rules match |
| `random` | `weight: 0-1` | Probability of random choice |

### Trail Operations (Depositor behaviors)

| Operation | Parameters | Description |
|-----------|------------|-------------|
| `deposit-color` | `color: string` | Leave trail of this color |
| `deposit-rate` | `every: n ticks` | How often to drop paint |
| `deposit-decay` | `ticks: number` | Trail fades after N ticks |
| `deposit-conditional` | `condition` | Only deposit if condition met |

### Interaction Operations

| Operation | Parameters | Description |
|-----------|------------|-------------|
| `on-meet-agent` | `action` | Behavior when encountering agent |
| `on-reach-chip` | `action` | Behavior at chip |
| `on-enter-note` | `action` | Behavior entering note boundary |
| `on-color-seen` | `color, action` | React to specific color |
| `on-stuck` | `action` | Behavior when no valid path |

### State Operations

| Operation | Parameters | Description |
|-----------|------------|-------------|
| `memory-trail` | `length: number` | Remember last N positions |
| `memory-visited` | `boolean` | Track visited cells |
| `energy` | `max, decay, recharge` | Fuel system |
| `goal` | `target` | Current objective |
| `mode` | `string` | Named behavior state |

---

## Example Agent Definitions

### Scout
```yaml
perception:
  sense-radius: 8
  sense-angle: 90
  sense-colors: [black, green]

movement:
  move-speed: 2

rules:
  follow-color: black
  branch:
    green: turn-left
  priority: [green, black]
  on-stuck: move-wander
```

### Gradient Climber
```yaml
perception:
  sense-radius: 12
  sense-angle: 360

movement:
  move-speed: 1

rules:
  follow-gradient: ascending
  on-stuck: move-random
```

### Trail Layer
```yaml
perception:
  sense-radius: 5
  sense-angle: 180
  sense-colors: [black]

movement:
  move-speed: 1
  follow-color: black

deposit:
  deposit-color: blue
  deposit-rate: 2
  deposit-decay: 100
```

---

## The Paint Language

What can paint express?

| Color/Pattern | Meaning |
|---------------|---------|
| Black trail | Primary path (follow me) |
| Green marker | Turn signal / junction logic |
| Red region | Avoidance zone |
| Blue gradient | Attraction field |
| Fading intensity | Recency / priority decay |
| Dense cluster | Important location |
| Boundary edge | Containment / region definition |

The vocabulary is extensible. Different agents can interpret the same paint differently based on their behavior rules.

---

## The Billiards Inversion

Key insight: once agent rules are known, path generation can be inverted.

**Forward mode:**
```
Agent rules + Paint → observe emergent behavior
```

**Inverse mode:**
```
Agent rules + Desired path → generate paint
```

Like trajectory prediction in pool games: given the physics, compute what input produces the desired output.

### Implementation

```
/paint path --agent scout_01 --from (10,10) --to (50,30)
```

The system knows scout_01's rules (follows black, turns on green), so it generates:
```
░░░░░░░░░░░░░░░
   ░░░░░░░████░
        ░░░░░░░░
```

A path the agent *will* follow, computed from its behavioral model.

---

## Connection to Existing Systems

### Monogram Layer (monogram.ts)

The current monogram system computes visual patterns (Perlin noise, Voronoi, trails). In the stigmergic model, these **emerge from agent behavior** rather than being explicitly computed:

- Agent trails become the "comet" effect
- Density of agent activity creates intensity gradients
- Path reinforcement produces the organic flow patterns

The aesthetic is a **side effect** of coordination, not a separate system.

### Agent Infrastructure (ai.agents.ts)

The existing sense/make infrastructure provides the execution layer. Stigmergic behaviors are a **perception mode** layered on top:

```typescript
// Current: AI interprets and decides
sense({ find: 'notes' }) → AI thinks → make({ ... })

// Stigmergic: Direct perception-action loop
perceive(paint in cone) → apply rules → move/deposit
```

Same execution path, different decision mechanism.

### Vascular Layer (placemaking model)

From the placemaking document: "The vascular system carries signals, not just connects endpoints."

Paint-as-substrate realizes this. The vascular layer isn't infrastructure you build—it's **traces left by activity**. Corridors emerge from use, not from explicit construction.

---

## Comparison: Amazon Kiva vs. Stigmergy

| Aspect | Amazon Kiva | Paint-Stigmergy |
|--------|-------------|-----------------|
| Control | Central assigns paths | Agents perceive paths |
| Reservations | Explicit cell booking | Implicit (color = state) |
| Collision | Prevented by design | Interaction opportunity |
| Optimization | Throughput | Emergence |
| Debugging | Query central state | Observe paint patterns |
| Scaling | Central bottleneck | Distributed |

Amazon's model is engineered for efficiency. Paint-stigmergy is optimized for **emergence and expressiveness**.

---

## Agent Control Panel

Behaviors become first-class objects that can be inspected, toggled, and transferred:

```
┌─────────────────────────────────────┐
│ Agent: scout_01                     │
├─────────────────────────────────────┤
│ Behaviors:                          │
│  ◉ follow-black    (path following) │
│  ◉ turn-on-green   (junction logic) │
│  ○ avoid-red       (inactive)       │
│  ○ deposit-blue    (trail laying)   │
├─────────────────────────────────────┤
│ Perception: radius=5, forward-cone  │
│ Speed: 2 cells/tick                 │
└─────────────────────────────────────┘
```

### Behavior Exchange

- Agent A meets Agent B → shares behavior
- User observes useful emergent behavior → captures as named behavior
- Behavior packs applied to any agent

---

## Open Questions

1. **Color vocabulary** — Fixed semantics vs. agent-specific interpretation?

2. **Decay model** — How does paint fade? Time-based? Use-based? Both?

3. **Multi-agent conflict** — What happens when agents want the same cell?

4. **Paint persistence** — Which paint is saved vs. ephemeral?

5. **Behavior composition** — How do multiple rules combine? Priority? Blending?

6. **Performance** — How many agents before perception becomes expensive?

7. **Debugging** — How to visualize what an agent "sees"?

---

## Implementation Phases

### Phase 1: Perception Infrastructure
- [ ] Agent perception cone (radius, angle, direction)
- [ ] Color detection in perception region
- [ ] Density/gradient computation

### Phase 2: Basic Behaviors
- [ ] follow-color (path following)
- [ ] priority rules (color ranking)
- [ ] on-stuck fallback

### Phase 3: Trail System
- [ ] deposit-color (trail laying)
- [ ] deposit-decay (fading trails)
- [ ] Trail visualization

### Phase 4: Control Panel
- [ ] Behavior registry
- [ ] Per-agent behavior toggle UI
- [ ] Behavior inspection

### Phase 5: Path Generation
- [ ] Inverse mode: rules + destination → paint
- [ ] `/paint path` command
- [ ] Path preview before agent execution

---

## Summary

Paint-as-substrate transforms the canvas from a drawing surface into a **communication medium**. Agents perceive and deposit paint according to behavioral rules. Coordination emerges from local interactions rather than central planning.

The aesthetic layer (visual patterns, trails, flow) becomes a **side effect** of agent activity rather than a separate computed system.

The ceiling is high because:
- Simple local rules produce complex global behavior
- The environment accumulates intelligence
- Humans can read and modify the coordination directly
- New behaviors emerge from rule combinations

The canvas becomes a living system where paint is memory, agents are actors, and patterns are the traces of coordination.

---

*December 2024. Nara Project.*
