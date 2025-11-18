# Commands.ts Refactoring: Phase 3 Strategy

**Date:** 2025-01-18
**Status:** Planning
**Context:** Continue low-hanging fruit refactoring after Phase 1 & 2 success

---

## Executive Summary

Following successful Phase 1 (-566 lines) and Phase 2 (-55 lines) refactoring, this document outlines Phase 3 opportunities to further compact commands.ts through extraction of remaining duplication patterns.

**Target Impact:** 305-385 additional line reduction (8.7-11% from current 3,515 lines)

**Constraints:**
- ✅ All work in single commands.ts file (NO new files)
- ✅ Extract helper functions using useCallback
- ✅ Focus on low-to-medium complexity patterns
- ✅ Verify with TypeScript + production build after each extraction

**Strategy:** Extract 5 remaining duplication patterns in order of impact and risk

---

## Previous Phase Recap

### Phase 1: Helper Function Extraction (Completed)
**Result:** 4,136 → 3,570 lines (-566 lines / 13.7% reduction)

**Helpers Created:**
1. `clearCommandState()` - unified command cleanup (52+ uses)
2. `validateColor()` - color validation (5 uses)
3. `wrapText()` - text wrapping (2 uses)
4. `renderCommandDisplay()` - command text rendering (7 uses)
5. `parseCommandArgs()` - argument parsing (created, partially used)
6. `calculateSelectionDimensions()` - selection calc (3 uses)
7. `createPendingCommand()` - pending command creation (2 uses)

### Phase 2: Simple Command Passthrough (Completed)
**Result:** 3,570 → 3,515 lines (-55 lines / 1.5% reduction)

**Helpers Created:**
8. `executeSimpleCommand()` - simple passthrough commands (10 uses)

**Combined Phase 1 + 2:** 4,136 → 3,515 lines (-621 lines / 15% reduction)

---

## Phase 3: Top 5 Duplication Patterns

### Pattern 1: Command Data Drawing (Text Rendering to Grid) ⭐⭐⭐⭐⭐

**Impact:** HIGH | **Complexity:** LOW-MEDIUM | **LOC Reduction:** 80-100 lines

**Occurrences:** 8+ instances across commands.ts

**Current Duplication:**

```typescript
// Repeated 8+ times with minor variations
const newCommandData: WorldData = {};
const commandText = `/${selectedCommand}`;

// Draw command text character-by-character
for (let i = 0; i < commandText.length; i++) {
    const key = `${commandStartPos.x + i},${commandStartPos.y}`;
    newCommandData[key] = commandText[i];
}

// Draw suggestions below with GRID_CELL_SPAN offset
matchedCommands.forEach((command, index) => {
    const suggestionY = commandStartPos.y + GRID_CELL_SPAN + (index * GRID_CELL_SPAN);
    for (let i = 0; i < command.length; i++) {
        const key = `${commandStartPos.x + i},${suggestionY}`;
        newCommandData[key] = command[i];
    }
});
```

**Proposed Solution:**

```typescript
/**
 * Render text string to WorldData grid at specified position
 */
const drawTextToGrid = useCallback((
    text: string,
    startX: number,
    startY: number,
    existingData: WorldData = {}
): WorldData => {
    const result = { ...existingData };
    for (let i = 0; i < text.length; i++) {
        result[`${startX + i},${startY}`] = text[i];
    }
    return result;
}, []);

/**
 * Render command text with vertical suggestion list
 */
const drawCommandWithSuggestions = useCallback((
    commandText: string,
    suggestions: string[],
    startPos: Point
): WorldData => {
    let data: WorldData = {};

    // Draw main command text
    data = drawTextToGrid(commandText, startPos.x, startPos.y, data);

    // Draw suggestions vertically below
    suggestions.forEach((suggestion, index) => {
        const suggestionY = startPos.y + GRID_CELL_SPAN + (index * GRID_CELL_SPAN);
        data = drawTextToGrid(suggestion, startPos.x, suggestionY, data);
    });

    return data;
}, [drawTextToGrid]);
```

**Usage Examples:**

```typescript
// BEFORE (15+ lines):
const newCommandData: WorldData = {};
const commandText = `/${input}`;
for (let i = 0; i < commandText.length; i++) {
    const key = `${commandStartPos.x + i},${commandStartPos.y}`;
    newCommandData[key] = commandText[i];
}
matchedCommands.forEach((command, index) => {
    const suggestionY = commandStartPos.y + GRID_CELL_SPAN + (index * GRID_CELL_SPAN);
    for (let i = 0; i < command.length; i++) {
        const key = `${commandStartPos.x + i},${suggestionY}`;
        newCommandData[key] = command[i];
    }
});

// AFTER (1 line):
const newCommandData = drawCommandWithSuggestions(`/${input}`, matchedCommands, commandStartPos);
```

**Locations to Replace:**
- Tab completion logic (lines ~3107-3119)
- Command input handlers (lines ~475-487, ~1306-1323)
- Selection display rendering (lines ~2296-2310)
- Pattern connect feedback (lines ~3219-3230)
- Multiple other command display blocks

**Value:**
- Eliminates 80-100 lines of character loop boilerplate
- Single source of truth for grid text rendering
- Makes future text rendering features easier (color, styling, etc.)

---

### Pattern 2: Selection-Based Region Creation ⭐⭐⭐⭐

**Impact:** HIGH | **Complexity:** MEDIUM | **LOC Reduction:** 120-150 lines

**Occurrences:** 4 instances (mail, note commands)

**Current Duplication:**

```typescript
// Repeated 4 times with minor variations
const existingSelection = getNormalizedSelection?.();
if (existingSelection) {
    const hasMeaningfulSelection =
        existingSelection.startX !== existingSelection.endX ||
        existingSelection.startY !== existingSelection.endY;

    if (!hasMeaningfulSelection) {
        setDialogueWithRevert("Selection must span more than one cell", setDialogueText);
    } else if (setWorldData && worldData && setSelectionStart && setSelectionEnd) {
        const region = {
            startX: existingSelection.startX,
            endX: existingSelection.endX,
            startY: existingSelection.startY,
            endY: existingSelection.endY,
            timestamp: Date.now()
        };
        const key = `mail_${existingSelection.startX},${existingSelection.startY}_${Date.now()}`;
        const newWorldData = { ...worldData };
        newWorldData[key] = JSON.stringify(region);
        setWorldData(newWorldData);

        const { width, height } = calculateSelectionDimensions(existingSelection);
        setDialogueWithRevert(`Mail region created (${width}×${height})...`, setDialogueText);

        setSelectionStart(null);
        setSelectionEnd(null);
    }
} else {
    createPendingCommand('mail', "Make a selection, then press Enter to create mail region");
}
```

**Proposed Solution:**

```typescript
/**
 * Create a region entity from current selection
 * Handles validation, creation, and feedback
 */
const createRegionFromSelection = useCallback((
    regionType: 'mail' | 'note',
    options: {
        successMessage?: (dims: { width: number; height: number }) => string;
        additionalData?: Record<string, any>;
        pendingMessage?: string;
    } = {}
): boolean => {
    const existingSelection = getNormalizedSelection?.();

    if (!existingSelection) {
        const defaultPendingMsg = `Make a selection, then press Enter to create ${regionType} region`;
        createPendingCommand(regionType, options.pendingMessage || defaultPendingMsg);
        return false;
    }

    const hasMeaningfulSelection =
        existingSelection.startX !== existingSelection.endX ||
        existingSelection.startY !== existingSelection.endY;

    if (!hasMeaningfulSelection) {
        setDialogueWithRevert("Selection must span more than one cell", setDialogueText);
        return false;
    }

    if (!setWorldData || !worldData || !setSelectionStart || !setSelectionEnd) {
        return false;
    }

    const timestamp = Date.now();
    const regionData = {
        startX: existingSelection.startX,
        endX: existingSelection.endX,
        startY: existingSelection.startY,
        endY: existingSelection.endY,
        timestamp,
        ...options.additionalData
    };

    const key = `${regionType}_${existingSelection.startX},${existingSelection.startY}_${timestamp}`;
    const newWorldData = { ...worldData };
    newWorldData[key] = JSON.stringify(regionData);
    setWorldData(newWorldData);

    const { width, height } = calculateSelectionDimensions(existingSelection);
    const defaultSuccessMsg = (dims: { width: number; height: number }) =>
        `${regionType.charAt(0).toUpperCase() + regionType.slice(1)} region created (${dims.width}×${dims.height})...`;
    const successMsg = options.successMessage || defaultSuccessMsg;
    setDialogueWithRevert(successMsg({ width, height }), setDialogueText);

    setSelectionStart(null);
    setSelectionEnd(null);

    return true;
}, [
    getNormalizedSelection,
    setWorldData,
    worldData,
    setSelectionStart,
    setSelectionEnd,
    setDialogueText,
    calculateSelectionDimensions,
    createPendingCommand
]);
```

**Usage Examples:**

```typescript
// BEFORE (35+ lines for /mail command):
const existingSelection = getNormalizedSelection?.();
if (existingSelection) {
    const hasMeaningfulSelection = /* ... */;
    if (!hasMeaningfulSelection) {
        setDialogueWithRevert(/* ... */);
    } else if (setWorldData && worldData /* ... */) {
        const mailRegion = { /* ... */ };
        const mailKey = /* ... */;
        /* 20 more lines ... */
    }
} else {
    createPendingCommand(/* ... */);
}

// AFTER (1-2 lines):
createRegionFromSelection('mail');

// With custom message:
createRegionFromSelection('note', {
    successMessage: (dims) => `Note created: ${dims.width}×${dims.height}`,
    pendingMessage: "Select area for note"
});
```

**Locations to Replace:**
- `/mail` command (lines ~2099-2146)
- `/note` command in executeCommand (lines ~2087-2211)
- `/note` command in executeCommandString (lines ~3253-3286)
- `/label` similar pattern (lines ~3288-3348)

**Value:**
- Reduces 120-150 lines of repetitive validation/creation logic
- Consistent error handling across all region creation commands
- Easy to add new region types in future (e.g., `/bound`, `/task`)

---

### Pattern 3: Toggle Mode Commands ⭐⭐⭐

**Impact:** MEDIUM | **Complexity:** LOW | **LOC Reduction:** 50-60 lines

**Occurrences:** 5 instances (indent, move, monogram toggle, etc.)

**Current Duplication:**

```typescript
// Repeated 5 times with minor variations
if (commandToExecute.startsWith('indent')) {
    setModeState(prev => ({
        ...prev,
        isIndentEnabled: !prev.isIndentEnabled
    }));

    const newState = !modeState.isIndentEnabled;
    setDialogueWithRevert(
        newState ? "Smart indentation enabled" : "Smart indentation disabled",
        setDialogueText
    );

    clearCommandState();
    return null;
}
```

**Proposed Solution:**

```typescript
/**
 * Toggle a boolean mode state and show feedback
 */
const executeToggleModeCommand = useCallback(<K extends keyof ModeState>(
    modeKey: K,
    enabledMessage: string,
    disabledMessage: string
): null => {
    setModeState(prev => ({
        ...prev,
        [modeKey]: !(prev[modeKey] as boolean)
    }));

    const newState = !(modeState[modeKey] as boolean);
    setDialogueWithRevert(
        newState ? enabledMessage : disabledMessage,
        setDialogueText
    );

    clearCommandState();
    return null;
}, [modeState, setModeState, setDialogueText, clearCommandState]);
```

**Usage Examples:**

```typescript
// BEFORE (10-12 lines per command):
if (commandToExecute.startsWith('indent')) {
    setModeState(prev => ({ ...prev, isIndentEnabled: !prev.isIndentEnabled }));
    const newState = !modeState.isIndentEnabled;
    setDialogueWithRevert(
        newState ? "Smart indentation enabled" : "Smart indentation disabled",
        setDialogueText
    );
    clearCommandState();
    return null;
}

// AFTER (3 lines):
if (commandToExecute.startsWith('indent')) {
    return executeToggleModeCommand('isIndentEnabled',
        "Smart indentation enabled", "Smart indentation disabled");
}
```

**Locations to Replace:**
- `/indent` command (lines ~2063-2076)
- `/move` command (lines ~2240-2253)
- `/tab` completion mode (lines ~1449-1464)
- Monogram toggle commands
- Other boolean mode toggles

**Value:**
- Eliminates 50-60 lines of boilerplate
- Type-safe mode toggling
- Consistent toggle behavior across all mode commands

---

### Pattern 4: Input Parsing with Arguments ⭐⭐⭐

**Impact:** MEDIUM | **Complexity:** LOW | **LOC Reduction:** 30-40 lines

**Occurrences:** 6 instances (talk, bg, text, search, monogram, etc.)

**Current Duplication:**

```typescript
// Repeated 6+ times with variations
const inputParts = commandState.input.trim().split(/\s+/);
const firstArg = inputParts.length > 1 ? inputParts[1] : undefined;
const secondArg = inputParts.length > 2 ? inputParts[2] : undefined;
const restAsString = inputParts.slice(1).join(' ');
```

**Note:** We already created `parseCommandArgs()` in Phase 1, but it's underutilized. Phase 3 should **fully utilize the existing helper** rather than create a new one.

**Proposed Enhancement:**

```typescript
// EXISTING helper from Phase 1 (enhance documentation):
const parseCommandArgs = useCallback((commandString: string): {
    command: string;
    args: string[];
    firstArg?: string;
} => {
    const parts = commandString.split(/\s+/);
    return {
        command: parts[0],
        args: parts.slice(1),
        firstArg: parts[1]
    };
}, []);

// ADD convenience helper for current input:
const parseCurrentInput = useCallback(() => {
    const parts = commandState.input.trim().split(/\s+/);
    return {
        parts,
        arg1: parts[1],
        arg2: parts[2],
        arg3: parts[3],
        restAsString: parts.slice(1).join(' '),
        argsArray: parts.slice(1)
    };
}, [commandState.input]);
```

**Usage Examples:**

```typescript
// BEFORE (4-5 lines each time):
const inputParts = commandState.input.trim().split(/\s+/);
const faceName = inputParts.length > 1 ? inputParts[1].toLowerCase() : 'macintosh';

// AFTER (1-2 lines):
const { arg1: faceName = 'macintosh' } = parseCurrentInput();

// BEFORE (search command):
const inputParts = commandState.input.trim().split(/\s+/);
const searchTerm = inputParts.slice(1).join(' ');

// AFTER:
const { restAsString: searchTerm } = parseCurrentInput();
```

**Locations to Replace:**
- `/talk` command (line ~1469)
- `/bg` command (lines ~1523-1529)
- `/text` command (line ~1657)
- `/search` command (lines ~1848-1849)
- `/monogram` command (line ~2330)
- Other commands with argument parsing

**Value:**
- Reduces 30-40 lines of repetitive splitting/indexing
- More readable command implementations
- Leverages existing Phase 1 helper

---

### Pattern 5: Conditional Callback Invocation ⭐⭐

**Impact:** LOW-MEDIUM | **Complexity:** LOW | **LOC Reduction:** 25-35 lines

**Occurrences:** 4 instances (upgrade, tutorial, other flow triggers)

**Current Duplication:**

```typescript
// Repeated 4 times
if (commandToExecute.startsWith('upgrade')) {
    if (triggerUpgradeFlow) {
        triggerUpgradeFlow();
    }
    clearCommandState();
    return null;
}

if (commandToExecute.startsWith('tutorial')) {
    if (triggerTutorialFlow) {
        triggerTutorialFlow();
    }
    clearCommandState();
    return null;
}
```

**Proposed Solution:**

```typescript
/**
 * Execute command that triggers optional callback
 */
const executeCallbackCommand = useCallback((
    callback: (() => void) | undefined,
    fallbackMessage?: string
): null => {
    if (callback) {
        callback();
    } else if (fallbackMessage) {
        setDialogueWithRevert(fallbackMessage, setDialogueText);
    }

    clearCommandState();
    return null;
}, [setDialogueText, clearCommandState]);
```

**Usage Examples:**

```typescript
// BEFORE (6-7 lines each):
if (commandToExecute.startsWith('upgrade')) {
    if (triggerUpgradeFlow) {
        triggerUpgradeFlow();
    }
    clearCommandState();
    return null;
}

// AFTER (3 lines):
if (commandToExecute.startsWith('upgrade')) {
    return executeCallbackCommand(triggerUpgradeFlow, "Upgrade flow not available");
}
```

**Locations to Replace:**
- `/upgrade` command (lines ~2256-2265)
- `/tutorial` command (lines ~2268-2277)
- Other optional callback triggers

**Value:**
- Reduces 25-35 lines of conditional callback boilerplate
- Consistent fallback message handling
- Easy to add new callback-based commands

---

## Implementation Strategy

### Recommended Order (By Risk/Reward)

1. **Pattern 1: Command Data Drawing** (LOW risk, HIGH reward: 80-100 lines)
   - Add `drawTextToGrid()` and `drawCommandWithSuggestions()`
   - Replace 8+ text rendering blocks
   - Verify command display still works

2. **Pattern 4: Input Parsing** (LOW risk, MEDIUM reward: 30-40 lines)
   - Add `parseCurrentInput()` helper
   - Replace 6+ input splitting blocks
   - Verify commands parse arguments correctly

3. **Pattern 5: Conditional Callbacks** (LOW risk, LOW reward: 25-35 lines)
   - Add `executeCallbackCommand()`
   - Replace 4 callback trigger blocks
   - Verify upgrade/tutorial flows work

4. **Pattern 3: Toggle Mode Commands** (LOW risk, MEDIUM reward: 50-60 lines)
   - Add `executeToggleModeCommand()`
   - Replace 5 toggle blocks
   - Verify mode toggles work (indent, move, etc.)

5. **Pattern 2: Selection Region Creation** (MEDIUM risk, HIGH reward: 120-150 lines)
   - Add `createRegionFromSelection()`
   - Replace 4 region creation blocks
   - **CAREFUL:** This affects note/mail creation - test thoroughly
   - Verify mail/note regions create correctly

### Testing Checklist (After Each Pattern)

```bash
# 1. TypeScript compilation
npx tsc --noEmit

# 2. Production build
npm run build

# 3. Manual verification (for risky changes)
# - Test the specific commands affected
# - Verify dialogue messages
# - Check worldData updates
```

### Git Commit Strategy

Commit after each pattern extraction (5 commits total):

```
Pattern 1: refactor(commands): extract text-to-grid rendering helpers
Pattern 2: refactor(commands): fully utilize input parsing helpers
Pattern 3: refactor(commands): extract callback invocation helper
Pattern 4: refactor(commands): extract toggle mode command helper
Pattern 5: refactor(commands): extract selection region creation helper
```

---

## Benefits of Phase 3

✅ **Additional 305-385 line reduction** (8.7-11% from current)

✅ **Cumulative reduction** (Phases 1+2+3): ~926-1,006 lines (22-24% from original 4,136)

✅ **Improved maintainability**: Fewer places to update command behavior

✅ **Better code reuse**: More shared utilities for common patterns

✅ **Easier debugging**: Centralized logic for text rendering, region creation, etc.

✅ **Type safety**: Helpers enforce consistent types across commands

✅ **Future-proof**: Easy to add new commands using existing patterns

---

## Phase 3 Implementation Checklist

### Pattern 1: Command Data Drawing (80-100 lines)
- [ ] Add `drawTextToGrid()` helper (~lines 520)
- [ ] Add `drawCommandWithSuggestions()` helper (~lines 530)
- [ ] Replace Tab completion text rendering (~line 3107)
- [ ] Replace command input handlers (~lines 475, 1306)
- [ ] Replace selection display rendering (~line 2296)
- [ ] Replace pattern connect feedback (~line 3219)
- [ ] Find and replace remaining instances
- [ ] TypeScript compile + build verification

### Pattern 2: Input Parsing (30-40 lines)
- [ ] Add `parseCurrentInput()` helper (~line 545)
- [ ] Replace `/talk` input parsing (~line 1469)
- [ ] Replace `/bg` input parsing (~lines 1523-1529)
- [ ] Replace `/text` input parsing (~line 1657)
- [ ] Replace `/search` input parsing (~lines 1848-1849)
- [ ] Replace `/monogram` input parsing (~line 2330)
- [ ] Find and replace remaining instances
- [ ] TypeScript compile + build verification

### Pattern 3: Conditional Callbacks (25-35 lines)
- [ ] Add `executeCallbackCommand()` helper (~line 555)
- [ ] Replace `/upgrade` command (~lines 2256-2265)
- [ ] Replace `/tutorial` command (~lines 2268-2277)
- [ ] Find and replace remaining callback triggers
- [ ] TypeScript compile + build verification
- [ ] Manual test: upgrade and tutorial flows

### Pattern 4: Toggle Mode Commands (50-60 lines)
- [ ] Add `executeToggleModeCommand()` helper (~line 565)
- [ ] Replace `/indent` command (~lines 2063-2076)
- [ ] Replace `/move` command (~lines 2240-2253)
- [ ] Replace tab completion mode (~lines 1449-1464)
- [ ] Find and replace remaining toggle commands
- [ ] TypeScript compile + build verification
- [ ] Manual test: indent, move mode toggles

### Pattern 5: Selection Region Creation (120-150 lines) ⚠️ RISKY
- [ ] Add `createRegionFromSelection()` helper (~line 580)
- [ ] Replace `/mail` command (~lines 2099-2146)
- [ ] Replace `/note` in executeCommand (~lines 2087-2211)
- [ ] Replace `/note` in executeCommandString (~lines 3253-3286)
- [ ] Consider `/label` pattern (~lines 3288-3348)
- [ ] TypeScript compile + build verification
- [ ] **IMPORTANT:** Manual test mail/note region creation
- [ ] Verify selection clearing works
- [ ] Verify pending command messages

---

## Risk Assessment

### Low Risk Patterns (Safe to extract)
- ✅ Pattern 1: Command Data Drawing (text rendering is isolated)
- ✅ Pattern 3: Toggle Mode Commands (simple boolean flips)
- ✅ Pattern 4: Input Parsing (pure utility function)
- ✅ Pattern 5: Conditional Callbacks (simple invocation)

### Medium Risk Patterns (Requires careful testing)
- ⚠️ Pattern 2: Selection Region Creation
  - **Why risky**: Touches core note/mail creation logic
  - **Mitigation**: Commit separately, test thoroughly
  - **Rollback plan**: Easy to revert if issues found

---

## Future Phase 4 Opportunities (Out of Scope)

Once Phase 3 is complete, consider these advanced refactorings:

1. **Command Registry Pattern** - Replace giant if/else chain with command map
2. **Selection Border Rendering** - Extract to bit.canvas.tsx helpers (from deepscan report #3)
3. **Position-Based Finders** - Consolidate findXAtPosition functions (from deepscan report #2)
4. **Command Validation Layer** - Centralized argument validation
5. **Dialogue Message Templates** - Standardized success/error messages

**Note:** These would require more significant architectural changes and potentially new files.

---

## Conclusion

Phase 3 focuses on **incremental, low-risk extractions** that deliver:

- **305-385 line reduction** (additional 8.7-11%)
- **5 new helper functions** (total 13 helpers across all phases)
- **No new files** (all in-place refactoring)
- **Better code organization** without architectural changes

Following the same proven pattern from Phase 1 & 2:
1. Extract one pattern at a time
2. Verify with builds
3. Commit incrementally
4. Keep risk low, value high

**Combined Result (Phases 1+2+3):**
- From 4,136 lines → ~3,130-3,210 lines
- **Total reduction: 926-1,006 lines (22-24%)**
- **13 reusable helper functions**
- **Same single-file architecture**

---

## References

- Phase 1 Completion: Commit 9cc2851
- Phase 2 Completion: Commit e8d690c
- Deepscan Report: `docs/codebase-deepscan-report.md`
- Pattern Consolidation Strategy: `docs/pattern-consolidation-strategy.md`
- Commands.ts Current State: 3,515 lines (as of Phase 2 completion)
