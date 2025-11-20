# Focus Mode Implementation Strategy

## Overview

Focus mode is a viewport-constraining system that locks the camera to a specific region (note or selection), ensuring reliable rendering within defined bounds. It provides strict panning/zoom constraints while maintaining a smooth user experience.

## Design Philosophy

`/focus` works in **two contexts**:
1. **Note mode**: User positions cursor in note → `/focus` constrains to note bounds (dynamic)
2. **Selection mode**: User makes rectangular selection → `/focus` constrains to selection bounds (static)

This dual-mode approach provides maximum flexibility while keeping the UX simple.

---

## Architecture Overview

### Comparison with Fullscreen Mode

Focus mode is similar to the existing fullscreen mode but with key differences:

| Feature | Fullscreen Mode | Focus Mode |
|---------|----------------|------------|
| **Activation** | Cursor in list + `/full` | Cursor in note OR selection + `/focus` |
| **Target** | Lists only | Any note OR any selection |
| **Margins** | 20% horizontal, 50% top | None (strict bounds) |
| **Vertical Bounds** | Infinite below | Strict all sides |
| **Zoom Fit** | Width only | Width AND height (smaller of both) |
| **Zoom Range** | 50%-200% of fit | 50%-300% of fit |
| **Dynamic Update** | No | Yes (for notes in expand/scroll mode) |
| **Use Case** | Reading long content | Reliable rendering of region |

---

## Implementation Details

### 1. State Structure

**File**: `app/bitworld/commands.ts:45-72`

Add focus mode state alongside existing fullscreen mode:

```typescript
export interface ModeState {
    // ... existing properties ...

    // Fullscreen mode (existing)
    isFullscreenMode: boolean;
    fullscreenRegion?: {
        type: 'bound' | 'list';
        key: string;
        startX: number;
        endX: number;
        startY: number;
        endY?: number;
    };

    // NEW: Focus mode
    isFocusMode: boolean;
    focusRegion?: {
        type: 'selection' | 'note';  // Track which type of focus
        key?: string;                 // Optional: note key if focusing on note
        startX: number;
        endX: number;
        startY: number;
        endY: number;
    };
}
```

**Initialization** (`app/bitworld/commands.ts:288-292`):

```typescript
const [modeState, setModeState] = useState<ModeState>({
    // ... existing ...
    isFocusMode: false,
    focusRegion: undefined,
});
```

---

### 2. Command Implementation

**File**: `app/bitworld/commands.ts` (in `executeCommand` function)

The command tries **note first, then selection**:

```typescript
if (commandToExecute.startsWith('focus')) {
    const cursorPos = commandState.commandStartPos;

    // OPTION 1: Try to find note at cursor position
    let foundRegion = false;

    for (const key in worldData) {
        if (key.startsWith('note_')) {
            try {
                const noteData = JSON.parse(worldData[key]);
                const { startX, endX, startY, endY } = noteData;

                // Check if cursor is within note bounds
                if (cursorPos.x >= startX && cursorPos.x <= endX &&
                    cursorPos.y >= startY && cursorPos.y <= endY) {

                    // Focus on this note
                    setModeState(prev => ({
                        ...prev,
                        isFocusMode: true,
                        focusRegion: {
                            type: 'note',
                            key: key,
                            startX,
                            endX,
                            startY,
                            endY
                        }
                    }));

                    setDialogueWithRevert("Focus mode: note - press Esc to exit", setDialogueText);
                    foundRegion = true;
                    break;
                }
            } catch (e) {
                // Skip invalid note data
            }
        }
    }

    // OPTION 2: If no note found, try selection
    if (!foundRegion) {
        if (!selectionStart || !selectionEnd) {
            setDialogueWithRevert("Position cursor in a note or make a selection first", setDialogueText);
            clearCommandState();
            return null;
        }

        const hasSelection = selectionStart.x !== selectionEnd.x ||
                            selectionStart.y !== selectionEnd.y;

        if (!hasSelection) {
            setDialogueWithRevert("Selection must span more than one cell", setDialogueText);
            clearCommandState();
            return null;
        }

        const normalized = getNormalizedSelection();
        if (!normalized) {
            clearCommandState();
            return null;
        }

        // Focus on selection
        setModeState(prev => ({
            ...prev,
            isFocusMode: true,
            focusRegion: {
                type: 'selection',
                startX: normalized.startX,
                endX: normalized.endX,
                startY: normalized.startY,
                endY: normalized.endY
            }
        }));

        setDialogueWithRevert("Focus mode: selection - press Esc to exit", setDialogueText);
    }

    clearCommandState();
    return null;
}
```

**Key Points**:
- Note detection has priority over selection
- Clear error messages guide user to proper usage
- Validates selection spans multiple cells

---

### 3. Auto Zoom & Center

**File**: `app/bitworld/world.engine.ts` (add new useEffect after fullscreen auto-fit at line ~1560)

Automatically fits and centers the viewport when focus mode is activated:

```typescript
// Focus Mode Auto-Fit
useEffect(() => {
    if (isFocusMode && focusRegion) {
        // Calculate zoom to fit region width and height
        const regionWidth = focusRegion.endX - focusRegion.startX + 1;
        const regionHeight = focusRegion.endY - focusRegion.startY + 1;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const { width: baseCharWidth, height: baseCharHeight } = getEffectiveCharDims(1.0);

        // Calculate zoom to fit width OR height (whichever is more constraining)
        const zoomForWidth = viewportWidth / (regionWidth * baseCharWidth);
        const zoomForHeight = viewportHeight / (regionHeight * baseCharHeight);

        // Use the smaller zoom (ensures entire region fits)
        const requiredZoom = Math.min(zoomForWidth, zoomForHeight);

        // Clamp zoom to reasonable bounds (0.1 to 5.0)
        const constrainedZoom = Math.max(0.1, Math.min(5.0, requiredZoom));
        setZoomLevel(constrainedZoom);

        // Center viewport on region
        const centerX = (focusRegion.startX + focusRegion.endX) / 2;
        const centerY = (focusRegion.startY + focusRegion.endY) / 2;

        setViewOffset({
            x: centerX - (viewportWidth / (2 * baseCharWidth * constrainedZoom)),
            y: centerY - (viewportHeight / (2 * baseCharHeight * constrainedZoom))
        });
    }
}, [isFocusMode, focusRegion, getEffectiveCharDims]);
```

**Behavior**:
- Fits both width AND height (unlike fullscreen which only fits width)
- Uses the more constraining dimension to ensure entire region is visible
- Centers viewport on region center point

---

### 4. Pan Constraints

**File**: `app/bitworld/world.engine.ts:9978-10008` (update `handlePanMove`)

Add focus mode constraints after fullscreen constraints:

```typescript
const handlePanMove = useCallback((clientX, clientY, panStartInfo) => {
    // ... existing delta calculation ...

    let newOffset = {
        x: panStartInfo.startOffset.x - deltaWorldX,
        y: panStartInfo.startOffset.y - deltaWorldY,
    };

    // Apply fullscreen constraints (existing)
    if (isFullscreenMode && fullscreenRegion) {
        // ... existing fullscreen logic ...
    }
    // NEW: Apply focus mode constraints
    else if (isFocusMode && focusRegion) {
        const { width: effectiveCharWidth, height: effectiveCharHeight } =
            getEffectiveCharDims(zoomLevel);
        const viewportWidth = window.innerWidth / effectiveCharWidth;
        const viewportHeight = window.innerHeight / effectiveCharHeight;

        const regionWidth = focusRegion.endX - focusRegion.startX + 1;
        const regionHeight = focusRegion.endY - focusRegion.startY + 1;

        // No margins for focus mode - strict bounds

        // Constrain X
        if (regionWidth <= viewportWidth) {
            // Region fits - center it and lock
            newOffset.x = focusRegion.startX - (viewportWidth - regionWidth) / 2;
        } else {
            // Region larger - allow panning within bounds
            const minX = focusRegion.startX;
            const maxX = focusRegion.endX - viewportWidth + 1;
            newOffset.x = Math.max(minX, Math.min(maxX, newOffset.x));
        }

        // Constrain Y
        if (regionHeight <= viewportHeight) {
            // Region fits - center it and lock
            newOffset.y = focusRegion.startY - (viewportHeight - regionHeight) / 2;
        } else {
            // Region larger - allow panning within bounds
            const minY = focusRegion.startY;
            const maxY = focusRegion.endY - viewportHeight + 1;
            newOffset.y = Math.max(minY, Math.min(maxY, newOffset.y));
        }
    }

    return newOffset;
}, [/* add isFocusMode, focusRegion to deps */]);
```

**Key Differences from Fullscreen**:
- No margins (strict bounds on all sides)
- Vertical bounds on both top AND bottom
- Centers region when it fits in viewport

---

### 5. Zoom Constraints

**File**: `app/bitworld/world.engine.ts:9867-9895` (update `handleCanvasWheel`)

Add focus mode zoom handling:

```typescript
const handleCanvasWheel = useCallback((deltaX, deltaY, canvasRelativeX, canvasRelativeY, ctrlOrMetaKey) => {
    // ... list scrolling logic ...

    if (ctrlOrMetaKey) {
        // Fullscreen zoom (existing)
        if (isFullscreenMode && fullscreenRegion) {
            // ... existing fullscreen zoom ...
        }
        // NEW: Focus mode zoom
        else if (isFocusMode && focusRegion) {
            const worldPointBeforeZoom = screenToWorld(canvasRelativeX, canvasRelativeY, zoomLevel, viewOffset);
            const delta = deltaY * ZOOM_SENSITIVITY;
            let newZoom = zoomLevel * (1 - delta);

            // Calculate smart zoom bounds
            const regionWidth = focusRegion.endX - focusRegion.startX + 1;
            const regionHeight = focusRegion.endY - focusRegion.startY + 1;
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const { width: baseCharWidth, height: baseCharHeight } = getEffectiveCharDims(1.0);

            // Fit zoom based on most constraining dimension
            const fitZoomWidth = viewportWidth / (regionWidth * baseCharWidth);
            const fitZoomHeight = viewportHeight / (regionHeight * baseCharHeight);
            const fitZoom = Math.min(fitZoomWidth, fitZoomHeight);

            // Allow zoom from 50% to 300% of fit (more range than fullscreen)
            const minZoom = Math.max(MIN_ZOOM, fitZoom * 0.5);
            const maxZoom = Math.min(MAX_ZOOM, fitZoom * 3.0);
            newZoom = Math.min(Math.max(newZoom, minZoom), maxZoom);

            const { width: effectiveWidthAfter, height: effectiveHeightAfter } = getEffectiveCharDims(newZoom);

            // Keep mouse point fixed during zoom
            const newViewOffsetX = worldPointBeforeZoom.x - (canvasRelativeX / effectiveWidthAfter);
            const newViewOffsetY = worldPointBeforeZoom.y - (canvasRelativeY / effectiveHeightAfter);

            setZoomLevel(newZoom);
            setViewOffset({ x: newViewOffsetX, y: newViewOffsetY });
            return;
        }
        // Normal zoom
        else {
            // ... existing normal zoom ...
        }
    } else {
        // NEW: Focus mode scrolling (without Ctrl/Meta)
        if (isFocusMode && focusRegion) {
            // Apply same constraints as panning
            const { width: effectiveCharWidth, height: effectiveCharHeight } = getEffectiveCharDims(zoomLevel);
            const viewportWidth = window.innerWidth / effectiveCharWidth;
            const viewportHeight = window.innerHeight / effectiveCharHeight;

            const regionWidth = focusRegion.endX - focusRegion.startX + 1;
            const regionHeight = focusRegion.endY - focusRegion.startY + 1;

            const deltaWorldX = deltaX / effectiveCharWidth;
            const deltaWorldY = deltaY / effectiveCharHeight;

            setViewOffset(prev => {
                let newX = prev.x + deltaWorldX;
                let newY = prev.y + deltaWorldY;

                // Apply same constraints as handlePanMove
                if (regionWidth <= viewportWidth) {
                    newX = focusRegion.startX - (viewportWidth - regionWidth) / 2;
                } else {
                    const minX = focusRegion.startX;
                    const maxX = focusRegion.endX - viewportWidth + 1;
                    newX = Math.max(minX, Math.min(maxX, newX));
                }

                if (regionHeight <= viewportHeight) {
                    newY = focusRegion.startY - (viewportHeight - regionHeight) / 2;
                } else {
                    const minY = focusRegion.startY;
                    const maxY = focusRegion.endY - viewportHeight + 1;
                    newY = Math.max(minY, Math.min(maxY, newY));
                }

                return { x: newX, y: newY };
            });
            return;
        }

        // ... existing normal scrolling ...
    }
}, [/* add isFocusMode, focusRegion to deps */]);
```

**Features**:
- Zoom range: 50%-300% of fit (more flexible than fullscreen's 50%-200%)
- Mouse-point-fixed zooming (natural zoom behavior)
- Scroll wheel panning with same constraints as mouse drag

---

### 6. Dynamic Note Tracking

**File**: `app/bitworld/world.engine.ts` (add new useEffect)

For note-based focus, automatically update bounds when note changes:

```typescript
// Dynamic Note Tracking for Focus Mode
useEffect(() => {
    if (isFocusMode && focusRegion?.type === 'note' && focusRegion.key) {
        // Check if the focused note still exists and update bounds
        const noteData = worldData[focusRegion.key];
        if (noteData) {
            try {
                const parsed = JSON.parse(noteData as string);
                const { startX, endX, startY, endY } = parsed;

                // Update focus region if note bounds changed
                if (startX !== focusRegion.startX ||
                    endX !== focusRegion.endX ||
                    startY !== focusRegion.startY ||
                    endY !== focusRegion.endY) {

                    setFocusMode(true, {
                        type: 'note',
                        key: focusRegion.key,
                        startX,
                        endX,
                        startY,
                        endY
                    });
                }
            } catch (e) {
                // Note data invalid - exit focus mode
                exitFocusMode();
                setDialogueWithRevert("Note deleted - exited focus mode", setDialogueText);
            }
        } else {
            // Note deleted - exit focus mode
            exitFocusMode();
            setDialogueWithRevert("Note deleted - exited focus mode", setDialogueText);
        }
    }
}, [worldData, isFocusMode, focusRegion]);
```

**Behavior**:
- Monitors note bounds for changes (e.g., expand mode grows note)
- Updates focus region in real-time
- Automatically exits if note is deleted
- Only applies to note-based focus (not selections)

---

### 7. Exit Focus Mode

**File**: `app/bitworld/world.engine.ts:~3476` (add before fullscreen escape handler)

```typescript
// Focus Mode Exit (add before fullscreen handler)
if (key === 'Escape' && isFocusMode) {
    exitFocusMode();
    setDialogueWithRevert("Exited focus mode", setDialogueText);
    return true;
}

// Fullscreen Mode Exit (existing)
if (key === 'Escape' && isFullscreenMode) {
    exitFullscreenMode();
    setDialogueWithRevert("Exited fullscreen mode", setDialogueText);
    return true;
}
```

**Exit Methods**:
1. Press `Escape` key
2. Note deletion (automatic for note-based focus)

---

### 8. Helper Functions & Exports

**File**: `app/bitworld/commands.ts:3583-3593`

Export focus mode state and helpers:

```typescript
return {
    // ... existing exports ...

    // NEW: Focus mode exports
    isFocusMode: modeState.isFocusMode,
    focusRegion: modeState.focusRegion,
    setFocusMode: (enabled: boolean, region?: ModeState['focusRegion']) =>
        setModeState(prev => ({ ...prev, isFocusMode: enabled, focusRegion: region })),
    exitFocusMode: () =>
        setModeState(prev => ({ ...prev, isFocusMode: false, focusRegion: undefined })),
};
```

**File**: `app/bitworld/world.engine.ts` (import section)

Import focus mode from command system:

```typescript
const {
    // ... existing imports ...
    isFocusMode,
    focusRegion,
    setFocusMode,
    exitFocusMode,
} = useCommandSystem({ /* ... */ });
```

---

## User Experience

### Scenario 1: Focus on Note

```
1. User creates note and types text
2. Note grows with word wrap (expand mode)
3. User runs /focus inside note
4. Viewport auto-fits to current note bounds
5. User types more → note grows → focus region updates automatically
6. User can zoom in/out, pan within note bounds
7. Press Escape to exit
```

### Scenario 2: Focus on Selection

```
1. User makes rectangular selection (e.g., 20×10 region)
2. User runs /focus
3. Viewport auto-fits to show entire selection
4. User can zoom in to see details, pan within selection
5. Selection bounds are fixed (won't change)
6. Press Escape to exit
```

### Scenario 3: Priority (Note vs Selection)

```
1. User has active selection AND cursor is in note
2. User runs /focus
3. Note takes priority (cursor position wins)
4. To focus on selection instead: move cursor outside note, then /focus
```

---

## Implementation Checklist

### Phase 1: State & Command
- [ ] `commands.ts:45-72` - Add `isFocusMode` and `focusRegion` to ModeState interface
- [ ] `commands.ts:288-292` - Initialize focus mode state to false/undefined
- [ ] `commands.ts` - Implement `/focus` command in executeCommand (note priority, then selection)
- [ ] `commands.ts` - Add `/focus` to AVAILABLE_COMMANDS array
- [ ] `commands.ts` - Add `/focus` to COMMAND_CATEGORIES (viewport or notes category)
- [ ] `commands.ts:3583-3593` - Export focus mode state and helper functions

### Phase 2: Engine Integration
- [ ] `world.engine.ts` - Import `isFocusMode`, `focusRegion`, `setFocusMode`, `exitFocusMode`
- [ ] `world.engine.ts` - Add auto-fit useEffect (after line ~1560)
- [ ] `world.engine.ts` - Add dynamic note tracking useEffect
- [ ] `world.engine.ts:9978-10008` - Add focus mode pan constraints in handlePanMove
- [ ] `world.engine.ts:9867-9945` - Add focus mode zoom constraints in handleCanvasWheel
- [ ] `world.engine.ts:9867-9945` - Add focus mode scroll constraints in handleCanvasWheel
- [ ] `world.engine.ts:~3476` - Add Escape key handler for focus mode (before fullscreen)

### Phase 3: Testing
- [ ] Test focus on notes (all content types: text, image, mail, list)
- [ ] Test focus on selections (various sizes)
- [ ] Test dynamic note bounds update (expand mode, word wrap)
- [ ] Test note deletion while in focus mode
- [ ] Test zoom constraints (min/max bounds)
- [ ] Test pan constraints (region fits vs larger than viewport)
- [ ] Test priority (note vs selection when both present)
- [ ] Test Escape exit behavior
- [ ] Test interaction with fullscreen mode (should be mutually exclusive)

---

## Edge Cases

1. **Selection cleared before command**: Show error message
2. **Single-cell selection**: Show error message
3. **Note deleted while focused**: Auto-exit with notification
4. **Note bounds change (expand mode)**: Auto-update focus region
5. **Zoom out past region**: Center region and lock panning
6. **Focus + Fullscreen conflict**: Focus mode takes precedence (or make mutually exclusive)
7. **Viewport resize**: Recalculate constraints dynamically
8. **Very small regions**: Allow zoom up to 300% of fit for detail viewing
9. **Very large regions**: Allow zoom down to 50% of fit for overview

---

## Future Enhancements

- **Toggle behavior**: `/focus` while in focus mode could toggle off (like `/full`)
- **Focus on other objects**: Extend to chips, tasks, links, patterns
- **Saved focus regions**: Store focus regions with state persistence
- **Animated transitions**: Smooth camera animation when entering focus mode
- **Focus overlay**: Visual border around focused region
- **Multi-region focus**: Focus on multiple non-contiguous regions (advanced)

---

## References

- **Fullscreen mode implementation**: `world.engine.ts:5353-5402` (entry), `world.engine.ts:1534-1560` (auto-fit), `world.engine.ts:9867-10008` (constraints)
- **Selection validation pattern**: Used by `/chip`, `/task`, `/link` commands
- **Display mode implementation**: `commands.ts` (display command for note modes)
- **Note interface**: `bit.canvas.tsx:64-107`
