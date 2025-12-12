# Placemaking on Programmable Substrate: A Layered Abstraction Model for Infinite Canvas Interaction

**December 2024 (revised December 2025)**

---

## Abstract

We present a conceptual framework for understanding user intervention on an infinite canvas substrate. Rather than treating the canvas as a tool with workflows, we propose a *placemaking* paradigm: the canvas is territory, and users construct places within it using layered primitives. We identify eight fundamental layers of abstraction—ranging from atomic cells to autonomous agents—and characterize the connective tissue that enables circulation between them. The canvas has evolved from primeval organism to living system: paint functions as signal, agents perceive and react to environmental marks, and stigmergic coordination emerges from simple behavioral rules. The nervous system is not a scripting layer imposed from above, but a perceptual layer grown from below.

---

## 1. Introduction

Traditional productivity software presents users with workflows: sequences of operations to accomplish tasks. The infinite canvas inverts this relationship. Users do not execute workflows *on* the canvas—they construct *places* where work can happen. The canvas is not a tool but a territory.

This shift demands a new vocabulary for understanding interaction. What are the materials available for placemaking? At what granularities can a user intervene? How do places afford different kinds of activity?

We propose a layered abstraction model that answers these questions, identifying the fundamental primitives and their compositional possibilities.

---

## 2. The Eight Layers

User intervention on the substrate occurs across eight distinct layers, ordered from finest to coarsest granularity:

### 2.1 Nucleic (Cells)

The atomic unit. A single cell holds a single character at a single position. All higher structures decompose to nucleic elements. The grain of the canvas.

**Intervention**: Typing, erasing, cursor placement.

### 2.2 Composit (Data, Tables)

Structured aggregation of cells into grids with semantic meaning. Rows, columns, named fields. The load-bearing structure that gives cells relational meaning.

**Intervention**: Table creation, cell editing, schema definition.

### 2.3 Dermic (Notes)

The sprawling text surface. Notes are bounded regions of nucleic material that form a coherent skin—readable, editable, movable as a unit. The interface between raw cells and meaningful content.

**Intervention**: Note creation, resizing, text editing, content authoring.

### 2.4 Vesic (Packs)

Compressed containers. Bundled state that can be stored, transmitted, and unpacked. Memory crystallized into portable form. What a place can hold and release.

**Intervention**: Pack saving, loading, sharing, versioning.

### 2.5 Perceptive (Bounds)

The focused attention regime. A bounded viewport that frames what is visible and manipulable. The threshold that separates here from elsewhere. Where attention concentrates.

**Intervention**: Entering bounded mode, zoom control, viewport navigation.

### 2.6 Agentic (Agents, Objects)

Autonomous actors inhabiting the canvas. Entities with behavior, goals, and the capacity for independent action. The life that moves through places.

Agents possess **perception**: a configurable radius and angle defining their sensory field. They read the vascular layer—detecting paint colors in their vicinity—and respond according to **behaviors**:

- `follow-color`: Move toward cells of a specified color
- `avoid-color`: Move away from cells of a specified color
- `stop-on-color`: Halt when standing on a specified color
- `turn-on-color`: Change direction when encountering a specified color
- `on-color`: Execute any canvas action when encountering a specified color

These behaviors compose. An agent might follow black paint while avoiding red, stop on green, and execute a command when touching blue. The substrate becomes a reactive environment where painted marks function as instructions.

Agents also possess **minds**: persona and goals that enable autonomous reasoning. When triggered to think, an agent perceives nearby notes, agents, and chips, then decides what to say or do.

**Intervention**: Agent spawning, perception tuning, behavior assignment, mind configuration, object placement.

### 2.7 Aesthetic (Monograms)

Visual identity marks. The signature that distinguishes one presence from another. Character and personality inscribed into the substrate.

**Intervention**: Monogram selection, color choice, visual customization.

### 2.8 Vascular (Paint, Paths, Corridors, Connects)

The connective tissue. Runs orthogonally through all other layers, enabling circulation and flow. How movement happens between places. The infrastructure of connection.

Paint serves dual purposes: **aesthetic marking** and **signal carrying**. A painted line can be a decorative border *and* a trail that agents follow. A colored region can be a visual zone *and* a trigger that causes agents to stop, turn, or act. The vascular layer is both skeleton and nervous system—structure and signal unified in a single medium.

This is **stigmergic coordination**: indirect communication through environmental modification. Agents do not message each other directly; they read and write the shared substrate. One agent paints a trail; another follows it. One agent marks a region red; others avoid it. The canvas becomes a medium for distributed computation through accumulated marks.

**Intervention**: Painting, path drawing, corridor creation, note connection, signal laying.

---

## 3. Placemaking as Primary Activity

These layers are not workflow steps but *building materials*. Users assemble them to construct places:

| Material | Contribution to Place |
|----------|----------------------|
| Nucleic | Texture, grain |
| Composit | Structure, load-bearing capacity |
| Dermic | Surface, skin, touchable interface |
| Vesic | Memory, stored potential |
| Perceptive | Threshold, attention boundary |
| Agentic | Inhabitants, life, activity |
| Aesthetic | Character, identity, recognizability |
| Vascular | Circulation, movement, connectivity |

A **laboratory** might emphasize composit (data tables) and agentic (processing agents) layers, connected by vascular paths that carry experimental results between analysis stages.

A **garden** might emphasize aesthetic (visual variety) and dermic (text surfaces for labeling and description), with vascular paths as walking trails.

A **library** might emphasize vesic (packed collections) and perceptive (bounded reading rooms), with dermic surfaces for annotation.

The same substrate affords radically different places depending on how materials are combined.

---

## 4. The Living Organism

The substrate has matured from primeval form to living system:

- **Cells** exist (nucleic)
- **Tissues** have differentiated (dermic, composit)
- **Organs** have formed (notes, tables, bounded regions)
- **Skeleton** provides structure (vascular corridors and paths)
- **Nervous system** enables signal propagation (paint-as-signal, agent perception)

The nervous system emerged not through explicit wiring but through stigmergic perception. Agents read the environment; paint carries meaning; behaviors translate perception into action. The organism exhibits coordinated behavior beyond the sum of its parts—not because components are connected by data pipes, but because they share a reactive medium.

---

## 5. Stigmergic Signaling

The nervous system arrived not as a scripting layer but as a perceptual one. The original vision imagined explicit data flow:

```
Note ──[data]──→ Note
     (wired connection)
```

What emerged instead is environmental signaling:

```
Agent ──perceives── Paint ──triggers── Action
       (stigmergic loop)
```

This is a different kind of programmability. Rather than wiring components together, users paint signals into the environment and configure agents to perceive and react. The substrate shifts from:

- **Drawable** → **Reactive**
- **Spatial** → **Perceptual**
- **Static connection** → **Behavioral response**

The key insight: signals need not flow through pipes. They can persist in the medium itself. An ant colony coordinates through pheromone trails, not telephone lines. The canvas coordinates through painted marks, not data wires.

This approach offers unexpected portability. The same painted trail can guide multiple agents. The same colored region can trigger different behaviors in different agents. Signals are not consumed by reading—they persist, accumulate, and can be overwritten. The environment becomes a shared blackboard for distributed coordination.

---

## 6. Interaction Chains as Desire Lines

Not every path through the layers is useful. We seek the *desire lines*: the chains that people actually walk, the traversals that constitute real activity.

**Authoring Chain**: nucleic → dermic → vesic
*Type, grow into note, save as pack. Capture and preserve.*

**Analysis Chain**: vesic → composit → agentic → dermic
*Load data, structure in table, agent transforms, text output. Scientific workflow.*

**Execution Chain**: vesic → perceptive → agentic
*Unpack context, bound attention, agent operates. Focused autonomous work.*

**Navigation Chain**: vascular → perceptive → dermic
*Follow path, arrive at region, read content. Exploration.*

**Composition Chain**: dermic → vascular → dermic
*Note, corridor, note. The circuit pattern.*

**Stigmergic Chain**: vascular → agentic → vascular
*Paint signal, agent perceives, agent acts (possibly painting more). The feedback loop.*

**Coordination Chain**: agentic → vascular → agentic
*Agent paints mark, another agent reads it, behavior changes. Indirect communication.*

These chains are not prescribed workflows but emergent patterns—the paths worn into the substrate by repeated use.

---

## 7. Design Implications

For the substrate to support robust placemaking:

1. **Primitives must be complete**: Each layer should be fully realized, not partially implemented.

2. **Primitives must be concrete**: Not abstract possibilities but actual, manipulable elements.

3. **Primitives must be undistracted**: Cruft removed, essential operations clear.

4. **Primitives must be selectable**: Users can recognize and choose the right material for their place.

5. **Connections must carry**: The vascular system carries signal through paint-as-medium, enabling stigmergic coordination between agents.

---

## 8. Conclusion

The infinite canvas is not a productivity tool but a territory for placemaking. Users intervene across eight layers of abstraction—from atomic cells to autonomous agents—using connective tissue to create circulation between them.

The substrate has evolved from primeval organism to living system. The nervous system emerged through stigmergic perception: agents that read painted signals and respond with configurable behaviors. Places are no longer static arrangements but reactive environments where marks carry meaning and inhabitants respond.

The design challenge remains ensuring that placemaking primitives are complete, concrete, undistracted, and selectable—so that users can construct the places they need, from gardens to laboratories, from libraries to workshops. But now, those places can come alive.

The canvas has its nervous system.

---

## References

- Alexander, C. (1977). *A Pattern Language*. Oxford University Press.
- Grassé, P.-P. (1959). La reconstruction du nid et les coordinations interindividuelles chez Bellicositermes natalensis et Cubitermes sp. *Insectes Sociaux*.
- Ray, T. (1991). An approach to the synthesis of life. *Artificial Life II*.
- Epstein, J. & Axtell, R. (1996). *Growing Artificial Societies*. MIT Press.
- Theraulaz, G. & Bonabeau, E. (1999). A brief history of stigmergy. *Artificial Life*.
- Victor, B. (2014). Humane representation of thought. *Talk at UIST*.

---

*December 2024, revised December 2025. Nara Project.*
