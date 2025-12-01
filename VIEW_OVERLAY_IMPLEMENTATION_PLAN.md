# View Overlay Implementation Plan

## Current State Analysis

### Existing Infrastructure

#### 1. State Definition
- **ModeState Interface** (`commands.ts:376-381`)
  - `viewOverlay?: { noteKey, content, scrollOffset, maxScroll }`
  - Already integrated into command system

- **WorldEngine Interface** (`world.engine.ts:1254-1259`)
  - Exported as part of engine contract
  - Methods: `exitViewOverlay()`, `setViewOverlayScroll(scrollOffset)`

#### 2. View Command (`/view`)
- **Location**: `commands.ts:4948-5016`
- **Functionality**:
  - Detects note at cursor position using world bounds
  - Extracts text content from note.data dictionary
  - Creates viewOverlay state with extracted content
  - Extracts raw text (not wrapped) as `content` field

#### 3. Keyboard Exit
- **Location**: `world.engine.ts:4500-4504`
- **Functionality**:
  - Escape key exits view mode
  - Shows "Exited view mode" dialogue

#### 4. Rendering
- **Location**: `bit.canvas.tsx:1279-1412`
- **Functionality**:
  - Fullscreen dark overlay (85% opacity)
  - Content area with border and background
  - Text wrapping based on viewport width and effectiveCharWidth
  - Scroll indicator (visual only)
  - Escape hint at bottom
  - Character-by-character rendering within clipped region

#### 5. Scrolling State
- **Location**: `world.engine.ts:11083-11086`
- **Status**: Currently **disabled** - early return prevents scroll handling
- **Issue**: Scrolling not implemented, maxScroll never calculated

---

## Architecture Understanding

### The View Overlay as an Ephemeral Fullscreen Object

**Key Properties:**
1. **Independent of Canvas**: Not a note object with world coordinates
2. **Fullscreen Rendering**: Takes entire viewport, renders centered
3. **Data Sharing**: Direct reference to source note's `note.data` dictionary
4. **Ephemeral**: Exists only as UI state, not persisted in worldData
5. **Screen-Space Coordinates**: Operates in pixel/line coordinates, not world grid

### Data Flow

```
Note in World (noteKey, coordinates, note.data)
    ↓
/view command triggered
    ↓
Extract content from note.data
    ↓
Create viewOverlay state (noteKey, content, scrollOffset, maxScroll)
    ↓
Render fullscreen overlay
    ↓
User interacts (scroll, type, exit)
    ↓
Changes persist directly to note.data in worldData
```

---

## Implementation Plan

### Phase 1: Scrolling Support

**Goal**: Enable vertical scrolling in the view overlay

#### 1.1 Calculate maxScroll Value
- **File**: `commands.ts` (in /view command handler, around line 5008-5013)
- **Change**: After extracting `content`, calculate the maximum scroll value
  - Use similar logic to rendering: calculate wrapped lines
  - Formula: `maxScroll = (totalWrappedLines - visibleLines) * effectiveCharHeight`
  - Set `maxScroll` in viewOverlay state instead of hardcoded 0
- **Implementation**:
  - Reuse text wrapping logic from render function OR extract to utility
  - Calculate based on viewport dimensions (need to access from engine)

#### 1.2 Enable Scroll Handling in handleCanvasWheel
- **File**: `world.engine.ts:11083-11086`
- **Change**: Replace early return with actual scroll handling
- **Logic**:
  ```
  if (viewOverlay) {
      // Calculate scroll delta (pixels per scroll tick)
      const scrollDelta = Math.sign(deltaY) * (effectiveCharHeight * 2);

      // Calculate max scroll value at render time
      // (for now, read from viewOverlay.maxScroll)
      const maxScroll = viewOverlay.maxScroll;

      // Update scroll offset with bounds
      const newScroll = Math.max(0, Math.min(
          maxScroll,
          viewOverlay.scrollOffset + scrollDelta
      ));

      if (newScroll !== viewOverlay.scrollOffset) {
          setViewOverlayScroll(newScroll);
      }

      return; // Consume the event
  }
  ```

#### 1.3 Dynamic maxScroll Calculation
- **Note**: Current approach calculates maxScroll statically when entering view mode
- **Improvement**: Could recalculate dynamically during render if viewport changes
  - For now, static calculation is acceptable
  - Track if this becomes a problem with zoom/resize

---

### Phase 2: Text Editing Support

**Goal**: Allow users to type and edit text within the view overlay

#### 2.1 Keyboard Input Handling
- **File**: `world.engine.ts` (in main handleKeyDown, around line 4500)
- **Location**: Add handlers AFTER the Escape check (line 4504), BEFORE other mode exits
- **Logic**:
  ```
  // === View Overlay Text Input ===
  if (viewOverlay) {
      // Only handle printable characters and backspace/delete
      if (key === 'Backspace' || key === 'Delete') {
          // Call deleteViewOverlayChar(key)
          return true;
      } else if (key === 'ArrowUp' || key === 'ArrowDown') {
          // Call moveViewOverlayCursor(key)
          return true;
      } else if (key === 'Home' || key === 'End') {
          // Call moveViewOverlayCursor(key)
          return true;
      } else if (key.length === 1 && !isMod) {
          // Single character input
          addCharToViewOverlay(key);
          return true;
      }
  }
  ```

#### 2.2 Manage Edit Cursor in viewOverlay State
- **File**: `commands.ts` (extend viewOverlay type at line 376)
- **New Fields**:
  ```typescript
  viewOverlay?: {
      noteKey: string;
      content: string;          // Full text content
      scrollOffset: number;      // Scroll position (pixels)
      maxScroll: number;         // Maximum scroll value
      editCursorPos?: number;    // Absolute character position in content
      selectionStart?: number;   // For text selection (future)
      selectionEnd?: number;     // For text selection (future)
  }
  ```

#### 2.3 Add Edit Helper Methods to Engine
- **File**: `world.engine.ts` (export new functions around line 1260+)
- **Methods**:
  ```typescript
  addCharToViewOverlay: (char: string) => void
  deleteViewOverlayChar: (direction: 'forward' | 'backward') => void
  moveViewOverlayCursor: (direction: 'up' | 'down' | 'home' | 'end') => void
  ```

#### 2.4 Content String Manipulation
- **Challenge**: viewOverlay.content is wrapped text, but edits must affect the original note
- **Solution**:
  - Maintain unwrapped source content separately
  - Keep editCursorPos referencing unwrapped content
  - On render, convert unwrapped content → wrapped lines, but sync cursor position

- **Better Approach**:
  - Store both `rawContent` (unwrapped) and `displayContent` (wrapped) in viewOverlay
  - editCursorPos references rawContent position
  - When content changes, recalculate displayContent

#### 2.5 Persist Edits to Source Note
- **Trigger**: On character add/delete
- **Process**:
  1. Update viewOverlay.rawContent
  2. Convert rawContent back to note.data format
  3. Update worldData[viewOverlay.noteKey] with new note data
  4. Trigger save via setWorldData

- **Implementation**:
  ```typescript
  // After editing:
  const updatedNoteData = reconstructNoteDataFromContent(rawContent, sourceNote);
  setWorldData(prev => ({
      ...prev,
      [viewOverlay.noteKey]: JSON.stringify(updatedNoteData)
  }));
  ```

#### 2.6 Reconstruct Note Data from String
- **File**: Create utility function (maybe in `world.engine.ts` or new file)
- **Logic**:
  - Split rawContent into lines
  - Iterate through each character
  - Build note.data dictionary with coordinates as keys
  - Preserve note metadata (startX, endX, startY, endY, etc.)

---

### Phase 3: Rendering Updates

**Goal**: Render cursor/caret and selection in the view overlay

#### 3.1 Add Cursor Rendering
- **File**: `bit.canvas.tsx:1279-1412`
- **Location**: After line 1380 (after rendering character), before ctx.restore()
- **Logic**:
  ```
  // Draw cursor if visible
  if (editCursorPos is within visible lines) {
      const cursorChar = line[cursorCharIndexInLine];
      const cursorX = horizontalMargin + (cursorCharIndexInLine * effectiveCharWidth) + 8;
      const cursorY = lineY;

      // Draw blinking cursor
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(cursorX, cursorY, 2, effectiveCharHeight);
  }
  ```

#### 3.2 Add Selection Rendering
- **File**: `bit.canvas.tsx`
- **Location**: Same area as cursor rendering
- **Logic**:
  - Highlight selected text with semi-transparent color
  - Consider multi-line selections
  - Draw behind text

#### 3.3 Synchronize Cursor Visibility with Scroll
- **Goal**: Keep cursor visible when typing
- **Logic**: If cursor goes outside visible area, auto-scroll to show it

---

### Phase 4: Integration & Polish

#### 4.1 IME Composition Support
- Handle IME events (important for international keyboards)
- Consider reusing composition handlers from main canvas

#### 4.2 Copy/Paste in View Mode
- Support Cmd+C to copy selected text
- Support Cmd+V to paste text
- Consider if paste should be allowed (edit-dependent)

#### 4.3 Undo/Redo
- Consider implementing undo stack for view overlay edits
- May be out of scope for MVP

#### 4.4 Word Wrapping Consistency
- Ensure render-time wrapping matches calculations elsewhere
- Extract wrapping logic to shared utility if not already done

---

## Implementation Order (Recommended)

1. **Phase 1.1**: Calculate maxScroll in /view command
2. **Phase 1.2**: Implement scroll handling in handleCanvasWheel
3. **Phase 2.2**: Extend viewOverlay state type
4. **Phase 2.3**: Add edit helper methods to engine
5. **Phase 2.4**: Implement content/cursor tracking logic
6. **Phase 2.1**: Add keyboard input handling
7. **Phase 2.5**: Implement note.data reconstruction and persistence
8. **Phase 3.1-3.3**: Add cursor and selection rendering
9. **Phase 4**: Polish and integrate

---

## Testing Strategy

### Functional Tests
- [ ] Open note with /view, verify content displays correctly
- [ ] Scroll up/down in view mode, verify text moves
- [ ] Type characters, verify they appear in overlay
- [ ] Delete characters (backspace/delete), verify removal
- [ ] Exit with Escape, verify note updated with edits
- [ ] Re-open view, verify edits were saved
- [ ] Cursor stays visible while scrolling

### Edge Cases
- [ ] Notes with very long lines (word wrapping)
- [ ] Notes with special characters
- [ ] Very small viewport (mobile)
- [ ] Very large notes (performance)
- [ ] Cursor at line boundaries
- [ ] Multi-line selection

### Visual Tests
- [ ] Cursor blinks/appears at correct position
- [ ] Text wrapping matches viewport width
- [ ] Scroll indicator shows correct position
- [ ] Margins are responsive to viewport
- [ ] Selection highlighting is clear

---

## Notes & Considerations

1. **Coordinate System**: View overlay uses screen/text coordinates, not world grid
2. **Wrapping Invariant**: Text must wrap consistently between calculation and render
3. **Performance**: Large notes with lots of edits should still be responsive
4. **Data Persistence**: Changes should sync to worldData immediately
5. **IME Support**: Important for non-ASCII text input
6. **Mobile Support**: Touch scrolling and virtual keyboards

---

## Files to Modify

| File | Lines | Purpose |
|------|-------|---------|
| `commands.ts` | 376-381, 5008-5013, 6915-6920 | Extend type, calculate maxScroll, edit helpers |
| `world.engine.ts` | 1254-1261, 4500-4504, 11083-11086, 10620+ | Type def, keyboard handling, scroll handling, edit logic |
| `bit.canvas.tsx` | 1279-1412 | Cursor/selection rendering |

---

## Success Criteria

- [ ] View overlay scrolls smoothly with mouse wheel
- [ ] Users can type text into view overlay
- [ ] Edits persist when exiting and re-entering view mode
- [ ] Cursor position tracks correctly with text input
- [ ] No performance degradation with large notes
- [ ] All keyboard shortcuts work as expected
- [ ] UI is responsive and feels natural
