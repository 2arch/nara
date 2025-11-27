# Reflections: Text Wrapping in Notes (Display Wrap Mode)

**Date**: 2025-11-27
**Status**: Disabled (needs rework)

## Goal

Implement automatic text wrapping for notes with three behaviors:
1. **Typing-based wrapping**: When typing past the right edge, wrap to next line
2. **Mode-based wrapping**: `/display wrap` mode for autonomous wrapping
3. **Dynamic rewrapping**: When resizing a note, text should re-flow to fit new width

## What We Built

### 1. Typing-Based Wrapping (✅ Working)
- Location: `app/bitworld/world.engine.ts:9249-9360`
- Triggers when `proposedCursorPos.x > noteRegion.endX`
- Finds last space before edge for word-boundary wrapping
- Different behaviors per display mode:
  - **Expand**: Grows note downward when wrapping exceeds bounds
  - **Scroll/Paint**: Auto-scrolls down when wrapping exceeds bounds
  - **Wrap**: Keeps fixed size, no auto-scroll

### 2. Static Rewrapping on Mode Switch (⚠️ Partially Working)
- Location: `app/bitworld/commands.ts:4398-4408`
- When switching to wrap mode via `/display wrap`, calls `rewrapNoteText()`
- Physically repositions characters in `note.data` to fit within note bounds
- Respects explicit line breaks (different Y coordinates)

### 3. Dynamic Rewrapping on Resize (❌ Broken)
- Location: `app/bitworld/bit.canvas.tsx:7462-7468, 8640-8646`
- When resizing a note in wrap mode, should automatically rewrap
- **Current bug**: Each character gets pushed to its own line

## The Core Problem

The `rewrapNoteText()` function (world.engine.ts:114-205) processes each original Y coordinate as an independent line. This creates two issues:

### Issue 1: Over-wrapping on Narrow Resize
When resizing narrower:
- Original: `"asd fasdfasdf"` (one line)
- After rewrap: Each character on its own line instead of:
  ```
  asd
  fasdfasdf
  ```

**Why**: The function wraps character-by-character instead of word-by-word when processing already-wrapped lines.

### Issue 2: No Unwrapping on Wide Resize
When resizing wider:
- Original (already wrapped):
  ```
  asd
  fasdfasdf
  ```
- After rewrap: Still wrapped (no change)
- **Expected**: Should merge back to `"asd fasdfasdf"`

**Why**: The function treats each original Y coordinate as a "real" line break, even if it was a wrapped line from previous typing.

## Root Cause Analysis

The fundamental issue is **distinguishing between explicit line breaks and wrapped lines**:

1. **Explicit line breaks**: User pressed Enter, or there's an empty line
2. **Wrapped lines**: Created by typing past edge or previous rewrap

Currently, `rewrapNoteText()` has no way to tell the difference. All lines are treated as explicit breaks.

## What Needs to Change

### Approach 1: Continuous Text Stream (Recommended)
Treat all consecutive lines as one continuous stream of text, only preserving explicit line breaks:

```typescript
export const rewrapNoteText = (noteData: any): any => {
  // 1. Group characters into paragraphs (separated by empty lines or significant gaps)
  // 2. For each paragraph, merge all text into continuous stream
  // 3. Re-wrap based on noteWidth
  // 4. Preserve empty lines between paragraphs
}
```

**Explicit line break detection**:
- Empty line (no characters at Y coordinate)
- Line ends significantly before endX (e.g., more than 3 cells early)
- Explicit marker in note data (future: `note.lineBreaks: Set<number>`)

### Approach 2: Track Explicit Breaks
Store which line breaks are "real" vs "wrapped":

```typescript
interface NoteData {
  // ... existing fields
  explicitLineBreaks?: Set<number>; // Y coordinates of explicit breaks
}
```

When user presses Enter, add Y to `explicitLineBreaks`. When rewrapping, only preserve those breaks.

### Approach 3: Hybrid
- Use Approach 1 for simplicity
- Add Approach 2 later for precision

## Implementation Checklist (For Future)

- [ ] Rewrite `rewrapNoteText()` to handle continuous text streams
- [ ] Detect explicit line breaks (empty lines, early-ending lines)
- [ ] Handle wrapping (long lines → multiple lines)
- [ ] Handle unwrapping (multiple lines → fewer lines when width increases)
- [ ] Preserve empty lines between paragraphs
- [ ] Test with:
  - [ ] Narrow resize (should wrap at word boundaries)
  - [ ] Wide resize (should unwrap/merge lines)
  - [ ] Mixed content (paragraphs with explicit breaks)
  - [ ] Edge cases (single-word-per-line, very narrow notes)

## Current State

- ✅ Typing-based wrapping works in all display modes
- ❌ `/display wrap` mode disabled (removed from cycle)
- ❌ `rewrapNoteText()` function exists but broken
- ❌ Resize-based rewrapping disabled

## Files Modified

- `app/bitworld/world.engine.ts` - Added `rewrapNoteText()` (lines 114-205)
- `app/bitworld/commands.ts` - Removed wrap mode from `/display` cycle
- `app/bitworld/bit.canvas.tsx` - Removed rewrap calls on resize
- `app/bitworld/bit.canvas.tsx` - Updated Note interface to support `displayMode: 'wrap'`

## Lessons Learned

1. **Text wrapping is harder than it looks**: Need to distinguish between explicit and implicit line breaks
2. **Two-way re-flow**: Wrapping isn't just about making things narrower; widening should unwrap
3. **Word boundaries matter**: Character-by-character wrapping is never right
4. **Test incrementally**: Should have tested rewrap function in isolation before integrating

## Next Steps

When ready to revisit:
1. Write comprehensive tests for `rewrapNoteText()`
2. Implement continuous text stream approach
3. Test with real content (paragraphs, mixed breaks)
4. Re-enable `/display wrap` mode
5. Add visual indicators for wrap mode (status bar, etc.)
