# Pattern System Consolidation Strategy

**Date:** 2025-11-17
**Status:** Planning
**Context:** Consolidate pattern generation system similar to Note and Label consolidations

---

## Executive Summary

The pattern system currently lacks type discrimination, making it impossible to distinguish between BSP-generated patterns and manually-connected patterns. This document outlines a consolidation strategy that:

1. **Adds `generationType` field** to pattern data ('bsp' | 'manual' | 'grafted')
2. **Preserves pattern lineage** via `originPatternKey` in notes
3. **Eliminates duplicate BSP code** between world.engine.ts and commands.ts
4. **Follows existing consolidation patterns** (Note contentType, Label type)

---

## Current State Analysis

### Pattern Data Structure (No Type Discriminator)

```typescript
// world.engine.ts:577 & commands.ts:3007
{
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  timestamp: number,
  noteKeys: string[],
  style?: string
}
```

### Two Generation Methods

1. **`/pattern` command** (commands.ts:2881)
   - Auto-generates rooms using BSP algorithm
   - Creates `pattern_${timestamp}` with generated notes

2. **`/connect` command** (commands.ts:3040)
   - Connects selected notes into pattern
   - Merges multiple existing patterns if notes span patterns

### Pattern Grafting (Already Implemented!)

```typescript
// commands.ts:3131 - Pattern merge logic
if (existingPatternKeys.size > 1) {
    // Keeps first pattern, deletes rest
    // Updates all notes to reference merged pattern
    // Recalculates MST corridors across all notes
    setDialogueWithRevert(`Merged ${existingPatternKeys.size} patterns...`);
}
```

**Problem:** No way to track which notes came from which original pattern!

---

## Consolidation Model: Following Note/Label Pattern

### Note Consolidation (Commit 8f1a838)
```typescript
// BEFORE: Separate types
image_, bound_, glitched_, list_ → separate handling

// AFTER: Unified with contentType
Note {
  contentType: 'text' | 'image' | 'bound' | 'glitch' | 'list',
  // ... unified fields
}
```

### Label Consolidation (Commit f417834)
```typescript
// BEFORE: Separate schemas
bound_*, glitched_*, task_*, link_* → separate loops

// AFTER: Unified with type field
Label {
  type: 'landmark' | 'task' | 'link',
  // ... unified fields
}
```

### Pattern Consolidation (This Document)
```typescript
// BEFORE: No discriminator
pattern_${id} → { centerX, centerY, noteKeys... }

// AFTER: Unified with generationType
Pattern {
  generationType: 'bsp' | 'manual' | 'grafted',
  originPatterns?: string[],  // For grafted patterns
  // ... existing fields
}
```

---

## Implementation Strategy

### Phase 1: Add Pattern Type Fields (In-Place)

**File: `world.engine.ts:577`** - `generatePatternFromId()`

```typescript
const patternData = {
    centerX: actualCenterX,
    centerY: actualCenterY,
    width: actualWidth,
    height: actualHeight,
    timestamp: numericSeed,
    noteKeys: noteKeys,

    // NEW: Add generation metadata
    generationType: 'bsp' as const,
    generationParams: {
        depth: 3,
        width: width,
        height: height,
        seed: numericSeed
    }
};
```

**File: `commands.ts:3007`** - `/pattern` command

```typescript
const patternData = {
    centerX: actualCenterX,
    centerY: actualCenterY,
    width: actualWidth,
    height: actualHeight,
    timestamp: timestamp,
    noteKeys: noteKeys,

    // NEW: Add generation metadata
    generationType: 'bsp' as const,
    generationParams: {
        depth: 3,
        width: width,
        height: height,
        seed: timestamp
    }
};
```

### Phase 2: Track Pattern Grafting

**File: `commands.ts:3196`** - `/connect` command pattern creation

```typescript
// Detect if this is a graft (merging multiple patterns)
const isGraft = existingPatternKeys.size > 1;

const patternData = {
    centerX: actualCenterX,
    centerY: actualCenterY,
    width: actualWidth,
    height: actualHeight,
    timestamp: timestamp,
    noteKeys: allNoteKeys,

    // NEW: Add generation type
    generationType: isGraft ? 'grafted' as const : 'manual' as const,

    // NEW: Track graft history
    ...(isGraft && {
        originPatterns: Array.from(existingPatternKeys),
        graftTimestamp: timestamp
    })
};
```

### Phase 3: Preserve Note Origin (Most Important!)

**File: `bit.canvas.tsx:66`** - Note interface

```typescript
interface Note {
    startX: number;
    endX: number;
    startY: number;
    endY: number;
    timestamp: number;
    contentType?: 'text' | 'image' | 'iframe' | 'mail' | 'bound' | 'glitch' | 'list';
    style?: string;
    patternKey?: string;

    // NEW: Remember original pattern before grafting
    originPatternKey?: string;

    // ... rest of fields
}
```

**File: `commands.ts:3210`** - Update notes during grafting

```typescript
// When updating notes to reference merged pattern
for (const noteKey of allNoteKeys) {
    const noteData = JSON.parse(worldData[noteKey] as string);
    updatedNotes[noteKey] = JSON.stringify({
        ...noteData,
        patternKey: patternKey,

        // NEW: Preserve original pattern (or set it now)
        originPatternKey: noteData.originPatternKey || noteData.patternKey
    });
}
```

**File: `world.engine.ts:537`** - Set origin when creating notes

```typescript
const noteData = {
    startX: room.x,
    startY: room.y,
    endX: room.x + room.width - 1,
    endY: room.y + room.height - 1,
    timestamp: numericSeed,
    contentType: 'text',
    patternKey: patternKey,

    // NEW: Set origin to self for new notes
    originPatternKey: patternKey
};
```

### Phase 4: Extract Duplicate BSP Code (Optional but Recommended)

**Problem:** BSP algorithm duplicated in:
- `world.engine.ts:476` - `bspSplit()` and `collectRooms()`
- `commands.ts:2905` - Identical implementation

**Solution:** Extract to shared utility function at top of `world.engine.ts`:

```typescript
// Add at top of world.engine.ts after imports

/**
 * Shared BSP generation utilities
 */
type BSPNode = {
    x: number;
    y: number;
    width: number;
    height: number;
    leftChild?: BSPNode;
    rightChild?: BSPNode;
    room?: { x: number; y: number; width: number; height: number };
};

function bspSplit(
    node: BSPNode,
    depth: number,
    maxDepth: number,
    rng: (n: number) => number,
    rngOffset: number
): void {
    // ... current implementation from line 476
}

function collectRooms(node: BSPNode): Array<{ x: number; y: number; width: number; height: number }> {
    // ... current implementation from line 511
}
```

Then update both usages:
- `world.engine.ts:476` - Keep implementation here
- `commands.ts:2905` - Remove duplicate, import from world.engine

---

## Benefits of Consolidation

✅ **Pattern Type Tracking** - Know how each pattern was created
✅ **Graft History** - Track which patterns were merged together
✅ **Origin Preservation** - Notes remember their original pattern (enables future "ungrafting")
✅ **Code Deduplication** - Single BSP implementation
✅ **Consistency** - Matches Note/Label consolidation patterns
✅ **Future-Proof** - Easy to add new generation algorithms (WFC, cellular automata, L-systems)
✅ **Debugging** - Can diagnose pattern issues by checking generationType

---

## Implementation Checklist

### Minimal Changes (High Value)
- [ ] Add `generationType` field to pattern data in `world.engine.ts:577`
- [ ] Add `generationType` field to pattern data in `commands.ts:3007`
- [ ] Add `generationType: 'grafted'` when merging in `commands.ts:3196`
- [ ] Add `originPatternKey` field to Note interface in `bit.canvas.tsx:66`
- [ ] Preserve `originPatternKey` during grafting in `commands.ts:3210`
- [ ] Set `originPatternKey` when creating notes in `world.engine.ts:537`

### Optional Improvements
- [ ] Extract BSP code to shared utility
- [ ] Add `graftTimestamp` tracking
- [ ] Add `originPatterns` array to grafted patterns
- [ ] Add pattern lineage visualization
- [ ] Add `/ungraft` command to separate patterns by origin

---

## Migration Strategy

**Backward Compatibility:** Existing patterns without `generationType` should:
1. Default to `'bsp'` if they have timestamp-based IDs
2. Default to `'manual'` if created recently
3. Handle missing `originPatternKey` gracefully (treat as null)

**Migration Code Example:**
```typescript
// When reading pattern data
function parsePatternData(data: string): Pattern {
    const parsed = JSON.parse(data);
    return {
        ...parsed,
        // Default to 'bsp' for legacy patterns
        generationType: parsed.generationType || 'bsp'
    };
}

// When reading note data
function parseNoteData(data: string): Note {
    const parsed = JSON.parse(data);
    return {
        ...parsed,
        // originPatternKey is optional, defaults to undefined
        originPatternKey: parsed.originPatternKey
    };
}
```

---

## Future Enhancements

Once the basic consolidation is complete, these become possible:

### 1. Pattern Ungrafting
```typescript
// /ungraft command - separate patterns by origin
function ungraftPattern(patternKey: string) {
    const pattern = getPattern(patternKey);
    const notesByOrigin = groupBy(pattern.noteKeys, note => note.originPatternKey);
    // Create separate patterns for each origin group
}
```

### 2. Visual Graft Seams
```typescript
// Render corridors differently based on note origins
if (note1.originPatternKey !== note2.originPatternKey) {
    // This corridor crosses a graft seam
    renderCorridorWithStyle('graft-seam');
}
```

### 3. New Generation Algorithms
```typescript
// Easy to add new types
generationType: 'bsp' | 'manual' | 'grafted' | 'wfc' | 'cellular' | 'lsystem'

// Each type can have specific params
generationParams: {
    wfcTileset?: string;
    cellularIterations?: number;
    lsystemRules?: string;
}
```

### 4. Pattern Regeneration
```typescript
// Regenerate with different parameters
function regeneratePattern(patternKey: string, newParams: Partial<PatternGenerationParams>) {
    const pattern = getPattern(patternKey);
    if (pattern.generationType === 'bsp') {
        // Re-run BSP with new params
        return generateBSPPattern({ ...pattern.generationParams, ...newParams });
    }
}
```

---

## Conclusion

This consolidation strategy provides:

1. **Minimal changes** to existing code (mostly adding fields)
2. **High value** from pattern origin tracking
3. **Consistency** with existing Note/Label patterns
4. **Foundation** for future pattern system enhancements

The key insight: **Notes should remember their `originPatternKey`** so grafted patterns maintain their genealogy. This enables future ungrafting, visual distinction, and better understanding of pattern evolution.

---

## References

- Note Consolidation: Commit 8f1a838
- Label Consolidation: Commit f417834
- Pattern Generation: `world.engine.ts:445`
- Pattern Connection: `commands.ts:3040`
- Pattern Grafting: `commands.ts:3131`
