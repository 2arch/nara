# Phase 3: Structural Refactoring Strategy

**Date**: 2025-01-18
**Status**: Planning
**Prerequisites**: Phase 1 & 2 Complete
**Estimated Time**: 75 minutes
**Complexity**: MEDIUM-HIGH
**Risk**: MEDIUM

---

## Context

Following successful completion of Phase 1 (Pure Duplication) and Phase 2 (Helper Utilities), Phase 3 focuses on **structural refactoring** - unifying similar patterns through architectural changes rather than simple extraction.

### Phases Comparison

| Phase | What It Does | Complexity | Risk | Status |
|-------|-------------|------------|------|--------|
| **Phase 1** | Extract duplicate blocks | LOW | Very Low | ✅ Complete |
| **Phase 2** | Create utility helpers | LOW | Very Low | ✅ Complete |
| **Phase 3** | **Unify similar patterns** | **MEDIUM-HIGH** | **Medium** | 📋 Planning |

### What Makes Phase 3 Different

Phase 3 requires **design decisions** and **careful testing** because we're changing how the code is structured, not just where it lives.

**Phase 1 & 2**: "This code is duplicated, let's extract it"
**Phase 3**: "These functions are similar, let's unify the pattern"

---

## Task #1: Position Finder Consolidation

**Priority**: ⭐⭐⭐⭐
**Impact**: HIGH
**Complexity**: MEDIUM
**Time**: 45 minutes
**LOC Reduction**: ~95 → ~40 lines

### Current State

**Location**: `app/bitworld/bit.canvas.tsx:2179-2273`

Five nearly identical functions with subtle variations:

```typescript
const findImageAtPosition = useCallback((pos: Point): any => {
    for (const key in engine.worldData) {
        if (key.startsWith('image_')) {
            const imageData = engine.worldData[key];
            if (engine.isImageData(imageData)) {
                if (pos.x >= imageData.startX && pos.x <= imageData.endX &&
                    pos.y >= imageData.startY && pos.y <= imageData.endY) {
                    return imageData;
                }
            }
        }
    }
    return null;
}, [engine]);

const findPatternAtPosition = useCallback((pos: Point): { key: string; data: any } | null => {
    for (const key in engine.worldData) {
        if (key.startsWith('pattern_')) {
            try {
                const patternData = JSON.parse(engine.worldData[key] as string);
                const { centerX, centerY, width = 120, height = 60 } = patternData;

                const startX = Math.floor(centerX - width / 2);
                const startY = Math.floor(centerY - height / 2);
                const endX = startX + width;
                const endY = startY + height;

                if (pos.x >= startX && pos.x < endX && pos.y >= startY && pos.y < endY) {
                    return { key, data: patternData };
                }
            } catch (e) { continue; }
        }
    }
    return null;
}, [engine]);

const findIframeAtPosition = useCallback((pos: Point): { key: string, data: any } | null => {
    // ~20 lines - same pattern, 'iframe_' prefix
}, [engine]);

const findPlanAtPosition = useCallback((pos: Point): { key: string, data: any } | null => {
    // ~20 lines - same pattern, 'note_' prefix
}, [engine]);

const findMailAtPosition = useCallback((pos: Point): { key: string, data: any } | null => {
    // ~20 lines - same pattern, 'mail_' prefix
}, [engine]);
```

**Total**: ~95 lines of nearly identical code

---

### The Challenge: Subtle Differences

| Function | Prefix | Parse? | Bounds Calc | Return Type |
|----------|--------|--------|-------------|-------------|
| `findImageAtPosition` | `image_` | No (typed check) | Direct | data only |
| `findPatternAtPosition` | `pattern_` | Yes (JSON) | **From center+size** | {key, data} |
| `findIframeAtPosition` | `iframe_` | Yes (JSON) | Direct | {key, data} |
| `findPlanAtPosition` | `note_` | Yes (JSON) | Direct | {key, data} |
| `findMailAtPosition` | `mail_` | Yes (JSON) | Direct | {key, data} |

**Key Insight**: Pattern bounds calculation is unique - uses `centerX/centerY + width/height` instead of `startX/endX/startY/endY`.

---

### Solution Option A: Configuration Object (Most Flexible)

**Pros**: Maximum flexibility, easy to add new entity types
**Cons**: More abstraction, harder to debug

```typescript
interface EntityFinderConfig {
    prefix: string;
    parse: boolean;
    getBounds: (data: any) => { startX: number; endX: number; startY: number; endY: number };
    returnKey?: boolean;
}

const entityFinders: Record<string, EntityFinderConfig> = {
    image: {
        prefix: 'image_',
        parse: false,
        getBounds: (data) => ({
            startX: data.startX,
            endX: data.endX,
            startY: data.startY,
            endY: data.endY
        }),
        returnKey: false
    },
    pattern: {
        prefix: 'pattern_',
        parse: true,
        getBounds: (data) => {
            const { centerX, centerY, width = 120, height = 60 } = data;
            const startX = Math.floor(centerX - width / 2);
            const startY = Math.floor(centerY - height / 2);
            return {
                startX,
                endX: startX + width,
                startY,
                endY: startY + height
            };
        },
        returnKey: true
    },
    iframe: {
        prefix: 'iframe_',
        parse: true,
        getBounds: (data) => ({
            startX: data.startX,
            endX: data.endX,
            startY: data.startY,
            endY: data.endY
        }),
        returnKey: true
    },
    note: {
        prefix: 'note_',
        parse: true,
        getBounds: (data) => ({
            startX: data.startX,
            endX: data.endX,
            startY: data.startY,
            endY: data.endY
        }),
        returnKey: true
    },
    mail: {
        prefix: 'mail_',
        parse: true,
        getBounds: (data) => ({
            startX: data.startX,
            endX: data.endX,
            startY: data.startY,
            endY: data.endY
        }),
        returnKey: true
    }
};

const findEntityAtPosition = useCallback((
    pos: Point,
    entityType: string
): any => {
    const config = entityFinders[entityType];
    if (!config) return null;

    for (const key in engine.worldData) {
        if (key.startsWith(config.prefix)) {
            let data;

            if (config.parse) {
                data = safeParseEntityData(engine.worldData, key);
                if (!data) continue;
            } else {
                data = engine.worldData[key];
            }

            const bounds = config.getBounds(data);

            if (pos.x >= bounds.startX && pos.x <= bounds.endX &&
                pos.y >= bounds.startY && pos.y <= bounds.endY) {
                return config.returnKey ? { key, data } : data;
            }
        }
    }

    return null;
}, [engine]);

// Usage:
const image = findEntityAtPosition(cursorPos, 'image');
const pattern = findEntityAtPosition(cursorPos, 'pattern');
const iframe = findEntityAtPosition(cursorPos, 'iframe');
```

**Impact**: 95 lines → ~60 lines (config + function)

---

### Solution Option B: Extract Common Logic (More Conservative)

**Pros**: Lower risk, keeps familiar API
**Cons**: Less DRY, still some duplication

```typescript
/**
 * Generic entity finder by prefix and bounds
 * Encapsulates the common iteration + bounds check pattern
 */
function findEntityByPrefixAndBounds<T>(
    worldData: WorldData,
    prefix: string,
    pos: Point,
    getBounds: (data: any) => { startX: number; endX: number; startY: number; endY: number },
    parse: boolean = true
): { key: string; data: T } | null {
    for (const key in worldData) {
        if (key.startsWith(prefix)) {
            const data = parse ? safeParseEntityData<T>(worldData, key) : worldData[key];
            if (!data) continue;

            const bounds = getBounds(data);

            if (pos.x >= bounds.startX && pos.x <= bounds.endX &&
                pos.y >= bounds.startY && pos.y <= bounds.endY) {
                return { key, data };
            }
        }
    }
    return null;
}

// Keep separate functions but use helper:
const findImageAtPosition = useCallback((pos: Point) => {
    const result = findEntityByPrefixAndBounds(
        engine.worldData,
        'image_',
        pos,
        (data) => ({ startX: data.startX, endX: data.endX, startY: data.startY, endY: data.endY }),
        false // Don't parse, already typed
    );
    return result?.data; // Return data only for images
}, [engine]);

const findPatternAtPosition = useCallback((pos: Point) => {
    return findEntityByPrefixAndBounds(
        engine.worldData,
        'pattern_',
        pos,
        (data) => {
            const { centerX, centerY, width = 120, height = 60 } = data;
            const startX = Math.floor(centerX - width / 2);
            const startY = Math.floor(centerY - height / 2);
            return { startX, endX: startX + width, startY, endY: startY + height };
        }
    );
}, [engine]);

const findIframeAtPosition = useCallback((pos: Point) => {
    return findEntityByPrefixAndBounds(
        engine.worldData,
        'iframe_',
        pos,
        (data) => ({ startX: data.startX, endX: data.endX, startY: data.startY, endY: data.endY })
    );
}, [engine]);

// ... similar for note and mail
```

**Impact**: 95 lines → ~70 lines (shared function + wrappers)

---

### Recommendation for Task #1

**Start with Option B** (Conservative approach):
- Lower risk
- Easier to understand and debug
- Keeps existing function names (less refactoring needed)
- Can always move to Option A later

**Move to Option A if**:
- Option B works well
- You're adding more entity types frequently
- You want maximum DRY

---

## Task #2: WorldData Iteration Helpers

**Priority**: ⭐⭐⭐
**Impact**: MEDIUM
**Complexity**: LOW-MEDIUM
**Time**: 30 minutes
**LOC Reduction**: ~220 → ~100 lines

### Current Pattern

**Appears**: 22 times throughout `bit.canvas.tsx`

```typescript
// Pattern 1: Iteration with try/catch (most common)
for (const key in engine.worldData) {
    if (key.startsWith('note_')) {
        try {
            const noteData = JSON.parse(engine.worldData[key] as string);
            // Do something with noteData
        } catch (e) {
            continue;
        }
    }
}

// Pattern 2: Collection into array
const allNotes = [];
for (const key in engine.worldData) {
    if (key.startsWith('note_')) {
        try {
            const noteData = JSON.parse(engine.worldData[key] as string);
            allNotes.push({ key, data: noteData });
        } catch (e) {
            continue;
        }
    }
}

// Pattern 3: Counting
let count = 0;
for (const key in engine.worldData) {
    if (key.startsWith('pattern_')) {
        count++;
    }
}
```

**Total**: ~10 lines per usage × 22 uses = ~220 lines

---

### Proposed Solution: Generator Function

```typescript
/**
 * Iterate over entities by prefix with automatic parsing
 * Uses generator for memory efficiency and lazy evaluation
 */
function* getEntitiesByPrefix<T = any>(
    worldData: WorldData,
    prefix: string,
    parse: boolean = true
): Generator<{ key: string; data: T }> {
    for (const key in worldData) {
        if (key.startsWith(prefix)) {
            if (parse) {
                const data = safeParseEntityData<T>(worldData, key);
                if (data) yield { key, data };
            } else {
                yield { key, data: worldData[key] as T };
            }
        }
    }
}

/**
 * Count entities by prefix (common operation)
 */
function countEntitiesByPrefix(worldData: WorldData, prefix: string): number {
    let count = 0;
    for (const key in worldData) {
        if (key.startsWith(prefix)) count++;
    }
    return count;
}
```

---

### Usage Examples

**Before**:
```typescript
// Iterate and render
for (const key in engine.worldData) {
    if (key.startsWith('note_')) {
        try {
            const noteData = JSON.parse(engine.worldData[key] as string);
            renderNote(noteData);
        } catch (e) {
            continue;
        }
    }
}
```

**After**:
```typescript
// Iterate and render - cleaner!
for (const { key, data } of getEntitiesByPrefix(engine.worldData, 'note_')) {
    renderNote(data);
}
```

---

**Before**:
```typescript
// Collect all into array
const allNotes = [];
for (const key in engine.worldData) {
    if (key.startsWith('note_')) {
        try {
            const noteData = JSON.parse(engine.worldData[key] as string);
            allNotes.push({ key, data: noteData });
        } catch (e) {
            continue;
        }
    }
}
```

**After**:
```typescript
// Collect all into array - one line!
const allNotes = Array.from(getEntitiesByPrefix(engine.worldData, 'note_'));
```

---

**Before**:
```typescript
// Count patterns
let patternCount = 0;
for (const key in engine.worldData) {
    if (key.startsWith('pattern_')) {
        patternCount++;
    }
}
```

**After**:
```typescript
// Count patterns - one line!
const patternCount = countEntitiesByPrefix(engine.worldData, 'pattern_');
```

---

### Benefits

1. **No more try/catch blocks**: Error handling is internal
2. **Memory efficient**: Generator yields one at a time
3. **Composable**: Works with Array.from, for...of, etc.
4. **Type-safe**: Generic parameter for entity type
5. **Consistent**: Same pattern everywhere

### Considerations

- **Performance**: Generator overhead is minimal (<1% for most cases)
- **Debugging**: Stack traces go through generator
- **Migration**: Can coexist with old pattern (gradual migration)

---

## Risk Assessment

### Why Phase 3 Is Riskier Than Phase 1 & 2

| Risk | Description | Mitigation |
|------|-------------|------------|
| **Behavioral Changes** | Subtle differences might be important | Careful review of each function |
| **Performance** | Iterator/generator overhead | Profile before/after |
| **Type Safety** | Generic types need careful handling | Use TypeScript strict mode |
| **Testing** | Need to verify all use cases work | Comprehensive testing |

### Testing Strategy

1. **Unit Tests**: Test new helpers in isolation
2. **Integration Tests**: Verify entity finding still works
3. **Visual Tests**: Check rendering, selection, interaction
4. **Performance Tests**: Profile worldData iteration

---

## Implementation Plan

### Conservative Approach (Recommended)

```
Week 1:
✅ Phase 1 Complete - Pure duplication (60 min)
✅ Phase 2 Complete - Helper utilities (30 min)

Week 2:
📋 Phase 3A - Extract common logic (45 min)
    - Implement findEntityByPrefixAndBounds
    - Update one finder function as proof of concept
    - Test thoroughly
    - If successful, migrate remaining finders

📋 Phase 3B - Add iteration helpers (30 min)
    - Implement getEntitiesByPrefix generator
    - Implement countEntitiesByPrefix
    - Replace 2-3 instances as proof of concept
    - Gradual migration over time
```

### Aggressive Approach (Higher Risk/Reward)

```
Week 2:
📋 Phase 3 Complete Refactor (75 min + testing)
    - Implement Option A (configuration-based finders)
    - Implement all iteration helpers
    - Replace all instances
    - Comprehensive testing
    - Document new patterns
```

---

## Success Metrics

### Quantitative

- **Lines of Code**: -175 lines (estimated)
- **Duplication**: Further reduced
- **Functions**: 5 finders → 1-2 unified functions

### Qualitative

- **Maintainability**: Adding new entity types is trivial
- **Readability**: Iteration patterns are consistent
- **Type Safety**: Better generic types
- **Performance**: No measurable regression

---

## Decision Points

### Should You Do Phase 3?

**Do Phase 3 if**:
- ✅ You frequently add new entity types
- ✅ You want maximum code cleanliness
- ✅ You have time for thorough testing
- ✅ Team is comfortable with generators/config patterns

**Skip/Defer Phase 3 if**:
- ❌ Entity types are stable (rarely change)
- ❌ Phase 1 & 2 improvements are sufficient
- ❌ Team prefers explicit over abstract
- ❌ Time is limited

### Recommended Approach

**Start Conservative**:
1. Implement Task #2 (iteration helpers) first
   - Lower risk, clear benefit
   - Easy to test and verify
   - Can migrate gradually

2. Then evaluate Task #1 (position finders)
   - Use Option B first (extract common logic)
   - Test thoroughly
   - Move to Option A only if needed

**This gives you**:
- Lower risk
- Incremental value
- Easy rollback if issues arise
- Time to evaluate before going all-in

---

## Conclusion

Phase 3 represents the **final architectural improvement** opportunity from the deepscan. While riskier than Phases 1 & 2, it offers significant benefits for long-term maintainability.

**Key Insight**: You've already achieved ~80% of the value with Phases 1 & 2. Phase 3 is about going from "very good" to "excellent" - worthwhile, but not critical.

**Recommendation**: Start with the conservative approach for Task #2 (iteration helpers), evaluate success, then decide on Task #1 (position finders).

---

## Appendix: Before/After Comparison

### Complete Position Finder Example

**Before** (95 lines):
```typescript
const findImageAtPosition = useCallback((pos: Point): any => { /* 20 lines */ }, [engine]);
const findPatternAtPosition = useCallback((pos: Point): any => { /* 20 lines */ }, [engine]);
const findIframeAtPosition = useCallback((pos: Point): any => { /* 20 lines */ }, [engine]);
const findPlanAtPosition = useCallback((pos: Point): any => { /* 20 lines */ }, [engine]);
const findMailAtPosition = useCallback((pos: Point): any => { /* 15 lines */ }, [engine]);
```

**After - Option B** (70 lines):
```typescript
function findEntityByPrefixAndBounds<T>(...) { /* 20 lines */ }

const findImageAtPosition = useCallback((pos: Point) => { /* 10 lines */ }, [engine]);
const findPatternAtPosition = useCallback((pos: Point) => { /* 10 lines */ }, [engine]);
const findIframeAtPosition = useCallback((pos: Point) => { /* 10 lines */ }, [engine]);
const findPlanAtPosition = useCallback((pos: Point) => { /* 10 lines */ }, [engine]);
const findMailAtPosition = useCallback((pos: Point) => { /* 10 lines */ }, [engine]);
```

**After - Option A** (60 lines):
```typescript
const entityFinders = { /* 30 lines of config */ };
const findEntityAtPosition = useCallback((pos, type) => { /* 30 lines */ }, [engine]);

// Usage:
findEntityAtPosition(pos, 'image')
findEntityAtPosition(pos, 'pattern')
// etc.
```

---

**Next Steps**: Review this strategy, discuss with team, and decide on approach.
