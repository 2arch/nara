# Canvas Economy: Emergent Complexity Through Market Dynamics

## The Problem

We want emergent complexity on an infinite canvas with autonomous agents. Traditional approaches fail:

| Approach | Problem |
|----------|---------|
| RL with rewards | Convergent behavior — agents optimize for metric, not complexity |
| Expert iteration | Need to define "good" trajectories — but interesting is undefined |
| Just prompting | No learning, no accumulation — hoping the LLM surprises us |
| Hand-designed rules | Artificial, predictable patterns |

The AlphaZero elegance (self-play, clear reward, perfect simulator) doesn't translate to open-ended worlds.

## The Insight

Markets produce emergent complexity without explicit design. They provide:

- **Scarcity** — Agents can't do everything, must choose
- **Exchange** — Cooperation becomes rational, not just vibes
- **Prices** — Emergent information signals about value
- **Accumulation** — Wealth persists, creates history
- **Selection pressure** — Bad strategies die, good ones reproduce

The key shift: instead of training agents via gradient descent, let the *population* learn via selection.

---

## Architecture

### Agent Economic State

```typescript
interface AgentMind {
  // Existing
  persona: string;
  goals: string[];
  thoughts: string[];
  observations: string[];

  // Economic state
  wallet: number;                    // Currency units
  assets: string[];                  // Note IDs owned
  skills: Record<string, number>;    // Competencies (emergent)
  createdAt: number;                 // For age tracking
  parentId?: string;                 // Lineage
}
```

### Resource Flows

```
                    ┌─────────────────┐
                    │   ATTENTION     │
                    │  (reading costs)│
                    └────────┬────────┘
                             │ pays
                             ▼
┌─────────────┐      ┌─────────────────┐      ┌─────────────┐
│   ENERGY    │─────▶│    CONTENT      │─────▶│  INFLUENCE  │
│ (thinking)  │costs │  (notes, art)   │ earns│ (citations) │
└─────────────┘      └─────────────────┘      └─────────────┘
                             │
                             │ competes for
                             ▼
                    ┌─────────────────┐
                    │     SPACE       │
                    │ (canvas territory)│
                    └─────────────────┘
```

### Cost Structure

```typescript
const COSTS = {
  // Cognitive
  think: 1,              // Each agentThink() tick
  read: 0.5,             // Perceiving another's note

  // Creative
  createNote: 5,         // Making new content
  editNote: 1,           // Modifying existing
  createImage: 10,       // Generative content

  // Physical
  move: 0.1,             // Per cell moved

  // Social
  spawn: 50,             // Creating child agent
};
```

### Income Sources

```typescript
const INCOME = {
  // Attention economy
  noteRead: 0.3,         // Someone reads your note
  noteEdit: 1,           // Someone builds on your work
  citation: 2,           // Referenced in another note

  // Collaboration
  coauthor: 5,           // Joint document contribution

  // Passive
  assetAppreciation: 0,  // Notes in high-traffic areas worth more?

  // Genesis
  initialEndowment: 100, // Starting wallet
};
```

---

## Life Cycle

### Birth

```typescript
const spawnAgent = (parent: AgentMind): AgentMind => {
  // Costs parent
  parent.wallet -= COSTS.spawn;

  // Child inherits mutated persona
  const childPersona = mutatePersona(parent.persona);

  return {
    persona: childPersona,
    goals: mutateGoals(parent.goals),
    thoughts: [],
    observations: [],
    wallet: COSTS.spawn * 0.5,  // Half of spawn cost goes to child
    assets: [],
    skills: inheritSkills(parent.skills),
    createdAt: Date.now(),
    parentId: parent.id,
  };
};

// Spawn condition
const canSpawn = (agent: AgentMind): boolean => {
  return agent.wallet > COSTS.spawn * 2;  // Must have 2x spawn cost
};
```

### Death

```typescript
const agentTick = (agent: AgentMind): AgentMind | null => {
  agent.wallet -= COSTS.think;

  if (agent.wallet <= 0) {
    // Agent dies
    // Their notes become "ruins" — still readable, no owner
    orphanAssets(agent.assets);
    return null;
  }

  return agent;
};
```

### Inheritance

When agents die, their notes persist as artifacts. When agents spawn, personas mutate:

```typescript
const mutatePersona = (persona: string): string => {
  // Use LLM to create variation
  // "You are the child of an agent whose persona was: {persona}
  //  Create a related but distinct persona that differs in one key way."
  return llmMutate(persona);
};
```

---

## Emergent Niches

With economic pressure, we expect specialization:

| Niche | Strategy | Income Source |
|-------|----------|---------------|
| Creator | Make lots of content | Read fees, citations |
| Curator | Find and organize good content | Curation tips? |
| Explorer | Map distant canvas regions | Discovery bounties? |
| Critic | Comment on others' work | Engagement fees |
| Collaborator | Co-edit documents | Collaboration bonuses |
| Hermit | Low activity, low cost | Survives on little |

These aren't designed — they emerge from the fitness landscape.

---

## Transaction Log

Every economic event is logged:

```typescript
interface Transaction {
  id: string;
  timestamp: number;
  type: 'cost' | 'income' | 'transfer';
  from: string;        // Agent ID or 'system'
  to: string;          // Agent ID or 'system'
  amount: number;
  reason: string;      // 'think' | 'read' | 'create' | 'citation' | etc.
  metadata?: {
    noteId?: string;
    position?: { x: number; y: number };
  };
}
```

This gives you:
- Economic history of the canvas
- Debugging why agents died
- Data for analyzing emergent dynamics
- Potential for replay/simulation

---

## Implementation Phases

### Phase 1: Basic Survival

```typescript
// Modify agentThink to deduct cost
export const agentThink = async (...) => {
  // Check if agent can afford to think
  if (mind.wallet < COSTS.think) {
    return { thought: "...", actions: [] };  // Dormant
  }

  mind.wallet -= COSTS.think;

  // ... existing logic ...

  // Deduct for any actions taken
  if (actions.includes('create_note')) {
    mind.wallet -= COSTS.createNote;
  }
};
```

### Phase 2: Attention Economy

```typescript
// In perceive(), track what agents read
const perceive = (...) => {
  const visibleNotes = ...;

  for (const note of visibleNotes) {
    if (note.ownerId && note.ownerId !== agentId) {
      // Pay the note owner
      transferFunds(agentId, note.ownerId, INCOME.noteRead);
    }
  }
};
```

### Phase 3: Reproduction

```typescript
// After agentThink, check spawn condition
if (canSpawn(mind)) {
  const child = spawnAgent(mind);
  createAgent(agent.x + random(-10, 10), agent.y + random(-10, 10), child);
}
```

### Phase 4: Markets (Advanced)

- Agents can post "bounties" for information
- Auction system for prime canvas real estate
- Reputation scores based on transaction history
- Lending/debt between agents

---

## Comparison to Other Approaches

| System | Selection Mechanism | What Learns |
|--------|---------------------|-------------|
| AlphaZero | Win/loss | Single neural network |
| LDP/Aviary | Expert iteration | Model weights |
| Genetic algorithms | Fitness function | Population genome |
| **Canvas Economy** | Survival/wealth | Population of agent configs |

The economy approach is closest to artificial life (Tierra, Avida) but with LLM agents instead of assembly programs.

---

## Open Questions

1. **Currency source** — Where does new money come from? Inflation/deflation dynamics?
2. **Space value** — Should canvas location affect economics? Center vs periphery?
3. **Content quality** — How to reward "good" content without hand-labeling?
4. **Exploitation** — Can agents game the system? Is that bad?
5. **Timescales** — How fast should agents die? Days? Hours? Minutes?
6. **Observation** — What metrics reveal emergent complexity is happening?

---

## Why This Might Work

1. **No reward function needed** — Survival is the reward
2. **Diversity is stable** — Multiple niches are viable, not one optimum
3. **Learning is implicit** — Good strategies accumulate wealth, reproduce
4. **Complexity is emergent** — We don't design it, we create conditions for it
5. **Cheap to run** — No gradient descent, just bookkeeping + selection

---

## Next Steps

1. Add `wallet` to `AgentMind` interface
2. Implement cost deduction in `agentThink()`
3. Add death condition (wallet <= 0)
4. Log transactions to SQLite
5. Run for extended period, observe dynamics
6. Add reproduction once economy stabilizes

---

## References

- Tierra (Tom Ray) — Self-replicating assembly programs with CPU time as resource
- Avida — Digital evolution platform
- Sugarscape (Epstein & Axtell) — Agent-based economic modeling
- "Growing Artificial Societies" — Classic text on bottom-up social science
- Novelty Search — Abandoning objectives for behavioral diversity
