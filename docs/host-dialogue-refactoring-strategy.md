# Host Dialogue System Refactoring Strategy

## Executive Summary

The host dialogue system (`host.dialogue.ts`, `host.flows.ts`) has become the primary dialogue engine for Nara, replacing the older `dialogue.tsx` system for most use cases. However, its architecture mixes dialogue flow logic with screen-level UI control, creating maintenance complexity and unclear separation of concerns. This document outlines a refactoring strategy to generalize the system while maintaining its unique capabilities.

## Current State

### System Overview

**host.dialogue.ts** (1,310 lines)
- Custom React hook: `useHostDialogue()`
- Multi-step flow state machine
- Input collection and validation
- Firebase auth integration
- Flow progression logic

**host.flows.ts** (676 lines)
- Flow and message definitions
- Already declarative: messages specify `monogramMode`, `backgroundColor`, `backgroundImage`, etc.
- Input validators and branch logic
- Content spawning functions

**dialogue.tsx** (842 lines)
- **Separate system** for subtitles and navigation
- Not being replaced - handles different use cases
- Navigation window (index/labels/states/bounds)
- Debug dialogue rendering

### The Problem: Mixed Concerns

The host dialogue system currently conflates three distinct concerns:

#### 1. Dialogue Flow Logic (Core Competency ✅)
```typescript
// What the system should own
- Message sequencing and state machine
- Input validation and collection
- Branch logic and flow control
- Auth integration
```

#### 2. Screen-Level UI Control (Currently Mixed ❌)
```typescript
// Currently passed as 14+ callbacks
setBackgroundColor, setBackgroundMode, setBackgroundImage,
setMonogramMode, setHostMode, setChatMode, setWorldData,
addEphemeralText, onTriggerZoom, ...
```

#### 3. Rendering (Currently Split 🤔)
```typescript
// Host dialogue has custom rendering in bit.canvas.tsx
// Doesn't use the modular dialogue.display.ts system
// Grid alignment, glow effects, fade-in hardcoded in canvas loop
```

### Specific Issues

1. **Callback Hell** (host.dialogue.ts:17-32)
   - 14+ callbacks in `UseHostDialogueProps` interface
   - Difficult to understand dependencies
   - Hard to test in isolation
   - Props drilling through multiple layers

2. **Duplicate Effect Logic** (host.dialogue.ts:83-103, 172-216, 200-216)
   - Screen effect application code repeated 3+ times
   - Same pattern: check if callback exists, call it with message property
   - No single source of truth for effect application

3. **Missing Implementation** (bit.canvas.tsx:762, host.dialogue.ts:29)
   - `setMonogramMode` declared in interface but never wired up
   - Flow definitions specify `monogramMode` but it has no effect
   - Lost in the callback complexity

4. **Unclear Boundaries**
   - Hard to see what's dialogue logic vs screen control
   - No clear interface between systems
   - Callbacks interleave dialogue, screen, and auth concerns

5. **Flow Definitions Mix Concerns** (host.flows.ts:4-35)
   - Messages contain both dialogue data AND screen state
   - `backgroundColor`, `backgroundMode`, `backgroundImage` feel "independent to our system"
   - Not obvious what's dialogue content vs UI orchestration

## Proposed Solution

### Core Principle

**Keep the declarative structure in flow definitions, but consolidate effect application into a single, clear boundary layer.**

The host dialogue system's "unique capacities" are:
- Press-through multi-step flows
- Full-screen centered text delivery
- Input collection state machine
- Screen orchestration capabilities

We want to preserve these while clarifying the separation between dialogue logic and screen effects.

### Architecture Changes

#### 1. Consolidate Effect Application (host.dialogue.ts)

Add a single effect handler function at the top of the file:

```typescript
// NEW: Single source of truth for screen effect application
function applyMessageEffects(
  message: HostMessage,
  centerPos: Point,
  callbacks: UseHostDialogueProps
): void {
  // Monogram control
  if (message.monogramMode && callbacks.screenEffects?.setMonogramMode) {
    callbacks.screenEffects.setMonogramMode(message.monogramMode);
  }

  // Background control
  if (message.backgroundColor && callbacks.screenEffects?.setBackgroundColor) {
    callbacks.screenEffects.setBackgroundColor(message.backgroundColor);
  }

  if (message.backgroundImage && callbacks.screenEffects?.setBackgroundImage) {
    callbacks.screenEffects.setBackgroundImage(message.backgroundImage);
  } else if (message.backgroundMode && callbacks.screenEffects?.setBackgroundMode) {
    callbacks.screenEffects.setBackgroundMode(message.backgroundMode);
  }

  // World content spawning
  if (message.spawnContent && callbacks.screenEffects?.setWorldData) {
    const content = message.spawnContent(centerPos);
    const labelKeys = Object.keys(content).filter(k => k.startsWith('label_'));

    callbacks.screenEffects.setWorldData(prev => {
      const labelsExist = labelKeys.some(key => key in prev);
      if (labelsExist) return prev;
      return { ...prev, ...content };
    });
  }

  // World content cleanup
  if (message.despawnLabels && callbacks.screenEffects?.setWorldData) {
    callbacks.screenEffects.setWorldData(prev => {
      const newData = { ...prev };
      Object.keys(newData).forEach(key => {
        if (key.startsWith('label_')) delete newData[key];
      });
      return newData;
    });
  }
}
```

**Benefits:**
- Single place to modify effect logic
- Easy to add new effect types
- Clear boundary between dialogue and screen
- Testable in isolation

#### 2. Restructure Props Interface (host.dialogue.ts:17-32)

```typescript
export interface UseHostDialogueProps {
  // === Dialogue UI (what makes this system unique) ===
  setHostData: (data: { text: string; color?: string; centerPos: Point; timestamp?: number } | null) => void;
  getViewportCenter: () => Point;
  setDialogueText: (text: string) => void;
  setHostMode?: (mode: { isActive: boolean; currentInputType: any }) => void;
  setChatMode?: (mode: { isActive: boolean; currentInput: string; inputPositions: any[]; isProcessing: boolean }) => void;

  // === App Navigation/Auth ===
  onAuthSuccess?: (username: string) => void;
  onTriggerZoom?: (targetZoom: number, centerPos: Point) => void;

  // === Screen Effects (consolidated) ===
  screenEffects?: {
    setBackgroundColor?: (color: string) => void;
    setBackgroundMode?: (mode: 'color' | 'image' | 'video' | 'transparent') => void;
    setBackgroundImage?: (imageUrl: string) => void;
    setMonogramMode?: (mode: string) => void;
    setWorldData?: (updater: (prev: Record<string, any>) => Record<string, any>) => void;
    addEphemeralText?: (pos: Point, char: string, options?: { animationDelay?: number; color?: string; background?: string }) => void;
  };

  // === Context ===
  hostBackgroundColor?: string;
  isPublicWorld?: boolean;
}
```

**Benefits:**
- Clear grouping by concern
- Optional `screenEffects` object makes screen control explicit
- Easier to see what's required vs optional
- Self-documenting interface

#### 3. Update Effect Call Sites (host.dialogue.ts)

Replace all duplicated effect code with single function call:

**Before:**
```typescript
// Lines 83-103, 172-216, 200-216 (repeated 3x)
if (startMessage.monogramMode && setMonogramMode) {
  console.log('[HostDialogue] startFlow - Setting monogram mode to:', startMessage.monogramMode);
  setMonogramMode(startMessage.monogramMode);
}

if (startMessage.backgroundColor && setBackgroundColor) {
  console.log('[HostDialogue] startFlow - Setting background color to:', startMessage.backgroundColor);
  setBackgroundColor(startMessage.backgroundColor);
}
// ... etc
```

**After:**
```typescript
// Single line at each call site
applyMessageEffects(startMessage, centerPos, props);
```

Call sites to update:
- `startFlow()` - line 83-103
- `advanceToNextMessage()` - lines 172-216, 200-216
- Any other message transitions

#### 4. Cleaner Canvas Wiring (bit.canvas.tsx:742-782)

**Before:**
```typescript
const hostDialogue = useHostDialogue({
  setHostData: engine.setHostData,
  getViewportCenter: engine.getViewportCenter,
  setDialogueText: engine.setDialogueText,
  onAuthSuccess,
  onTriggerZoom: handleZoom,
  setHostMode: engine.setHostMode,
  setChatMode: engine.setChatMode,
  addEphemeralText: engine.addInstantAIResponse ? ... : undefined,
  setWorldData: engine.setWorldData,
  hostBackgroundColor: hostBackgroundColor,
  isPublicWorld: isPublicWorld,
  setBackgroundColor: (color: string) => {
    console.log('[BitCanvas] setBackgroundColor called with:', color);
    engine.updateSettings({ backgroundColor: color });
  },
  setBackgroundMode: (mode: ...) => {
    console.log('[BitCanvas] setBackgroundMode called with:', mode);
    engine.switchBackgroundMode(mode as any, engine.backgroundImage || '', engine.textColor);
  },
  setBackgroundImage: (imageUrl: string) => {
    console.log('[BitCanvas] setBackgroundImage called with:', imageUrl);
    engine.switchBackgroundMode('image' as any, imageUrl, engine.textColor);
  }
  // Missing: setMonogramMode!
});
```

**After:**
```typescript
const hostDialogue = useHostDialogue({
  // === Dialogue UI ===
  setHostData: engine.setHostData,
  getViewportCenter: engine.getViewportCenter,
  setDialogueText: engine.setDialogueText,
  setHostMode: engine.setHostMode,
  setChatMode: engine.setChatMode,

  // === App Navigation/Auth ===
  onAuthSuccess,
  onTriggerZoom: handleZoom,

  // === Screen Effects ===
  screenEffects: {
    setBackgroundColor: (color) => {
      console.log('[BitCanvas] setBackgroundColor:', color);
      engine.updateSettings({ backgroundColor: color });
    },
    setBackgroundMode: (mode) => {
      console.log('[BitCanvas] setBackgroundMode:', mode);
      engine.switchBackgroundMode(mode, engine.backgroundImage || '', engine.textColor);
    },
    setBackgroundImage: (url) => {
      console.log('[BitCanvas] setBackgroundImage:', url);
      engine.switchBackgroundMode('image', url, engine.textColor);
    },
    setMonogramMode: (mode) => {
      console.log('[BitCanvas] setMonogramMode:', mode);
      // TODO: Wire up to monogram system
      // engine.setMonogramMode(mode);
    },
    setWorldData: engine.setWorldData,
    addEphemeralText: engine.addInstantAIResponse ?
      (pos, char, options) => engine.addInstantAIResponse(pos, char, {
        fadeDelay: options?.animationDelay || 1500,
        color: options?.color,
        wrapWidth: 1
      }) : undefined
  },

  // === Context ===
  hostBackgroundColor,
  isPublicWorld
});
```

**Benefits:**
- Clear visual grouping at call site
- Missing implementation (monogramMode) is now obvious
- Easy to add new screen effects
- Self-documenting what each callback does

## Implementation Plan

### Phase 1: Consolidate Effect Logic ✅

**Files:** `host.dialogue.ts`

1. Add `applyMessageEffects()` function at top of file
2. Update `startFlow()` to use `applyMessageEffects()` (replace lines 83-103)
3. Update `advanceToNextMessage()` to use `applyMessageEffects()` (replace lines 172-216)
4. Test that all flows still work correctly

**Testing:**
- Intro flow (NARA banner → welcome)
- Welcome flow (email/password/username)
- Background/monogram transitions
- Label spawning/despawning

### Phase 2: Restructure Interface ✅

**Files:** `host.dialogue.ts`

1. Update `UseHostDialogueProps` interface to group callbacks
2. Update `useHostDialogue()` function signature to destructure new structure
3. Update `applyMessageEffects()` to access `callbacks.screenEffects.*`
4. Update all internal usages

**Testing:**
- TypeScript compilation
- No runtime errors
- All callbacks still fire correctly

### Phase 3: Update Canvas Wiring ✅

**Files:** `bit.canvas.tsx`

1. Refactor `useHostDialogue()` call to use `screenEffects` grouping
2. Wire up missing `setMonogramMode` callback
3. Remove verbose inline implementations
4. Add TODO comments for unimplemented features

**Testing:**
- Onboarding flow works end-to-end
- Background changes apply correctly
- Monogram mode logs fire (even if not fully implemented)
- No regression in existing functionality

### Phase 4: Documentation & Cleanup 📝

**Files:** Various

1. Add JSDoc comments to `applyMessageEffects()`
2. Document the screen effects interface
3. Remove old debug `console.log` statements
4. Update this strategy doc with "Completed" status

## Benefits

### Immediate Wins

1. **Clarity** - Clear separation between dialogue logic and screen effects
2. **Discoverability** - Missing implementations obvious (monogramMode now wired up!)
3. **Maintainability** - Single place to modify effect logic
4. **Type Safety** - Grouped interface makes TypeScript inference better
5. **Testability** - Can test `applyMessageEffects()` in isolation

### Long-term Gains

1. **Extensibility** - Easy to add new screen effect types
2. **Reusability** - Screen effects interface could be shared with other systems
3. **Documentation** - Self-documenting code structure
4. **Debugging** - Easier to trace effect application
5. **Refactoring** - Clear boundaries enable future changes

## Non-Goals

This refactoring explicitly does NOT:

1. ❌ Create new files - all changes within existing files
2. ❌ Change flow definition structure - keeps declarative message properties
3. ❌ Replace dialogue.tsx - that's a separate system for different use cases
4. ❌ Modify rendering approach - host dialogue rendering stays in bit.canvas.tsx
5. ❌ Change external API - flows still triggered the same way

## Future Considerations

### Potential Follow-ups (Not in Scope)

1. **Unified Rendering** - Consider using `dialogue.display.ts` for host dialogue rendering
2. **Effect System** - More sophisticated effect scheduling/queuing
3. **Effect Composition** - Combine multiple effects with transitions
4. **Effect Persistence** - Save/restore screen effect state
5. **Effect Validation** - Type-safe effect definitions in flow messages

### Open Questions

1. Should monogram mode be fully wired up in this refactor, or just stubbed?
2. Are there other screen effects we should add to the interface?
3. Should `screenEffects` be required or optional in the interface?
4. Do we need an effect rollback/undo system for navigation?

## Success Metrics

This refactoring is successful if:

1. ✅ All existing dialogue flows work identically
2. ✅ Monogram mode is wired up (even if stubbed)
3. ✅ Code is more readable (subjective but clear grouping)
4. ✅ Adding new screen effects takes <5 minutes
5. ✅ No new files created
6. ✅ TypeScript compilation has no new errors
7. ✅ No runtime regressions in production

## Conclusion

The host dialogue system has proven to be Nara's primary dialogue engine, surpassing the older `dialogue.tsx` for most use cases. This refactoring preserves its unique capabilities (press-through flows, screen orchestration, input collection) while clarifying the boundary between dialogue logic and screen-level effects.

By consolidating effect application into a single function and grouping callbacks by concern, we make the system easier to understand, maintain, and extend—without creating new files or changing the fundamental architecture.

The declarative message structure in `host.flows.ts` remains unchanged, maintaining the clean separation between "what" (flow definitions) and "how" (effect application).
