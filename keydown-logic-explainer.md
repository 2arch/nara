# Bitworld Keyboard Input & Cursor Positioning Logic

## Overview
The keyboard input system is handled primarily in `@app/bitworld/hooks/world.input.ts` with the `handleKeyDown` function, which processes all keyboard events and manages cursor positioning, text editing, and navigation.

## Key Processing Flow

### 1. Special Mode Handling
- **Escape Key**: Cancels active modes (Rune Paint Mode, Move Tool, Meta Selection)
- **Meta Selection Mode**: When AI prompt overlay is active
  - `Cmd+Enter`: Triggers AI generation
  - `Enter`: Adds newline to prompt
  - `Backspace`: Smart deletion (word boundaries with Alt/Meta)
  - Other keys blocked to prevent world editing

### 2. AI Integration (Cmd+Enter)
**Outside Meta Selection Mode:**
- Analyzes context around cursor position
- Extracts text blocks using 3+ space gap rule
- Sends context to AI with character limits based on block size
- Places AI response with animated character-by-character typing
- Shows spinner during generation

### 3. Selection Management
**Selection Deletion Priority:**
- `Delete`/`Backspace` with active selection (no modifiers) → deletes entire selection
- Selection takes precedence over other backspace logic

**Selection Extension:**
- `Shift + Arrow Keys` → extends/creates selection from cursor position
- Selection start anchored on first Shift+Arrow press
- Selection end follows cursor movement

### 4. Cursor Movement

#### Basic Arrow Navigation
```typescript
// Plain arrows (no modifiers)
ArrowUp/Down/Left/Right → moves cursor 1 cell
// Respects world boundaries (fixedWorldWidth/Height if set)
// Clears any active selection
```

#### Modified Arrow Navigation
```typescript
// Cmd/Ctrl + Arrow Keys
Cmd+ArrowUp/Down → jumps 10 cells vertically  
Cmd+ArrowLeft/Right → jumps 10 cells horizontally
// Also respects world boundaries
```

#### Option + Arrow Navigation
**Currently Missing** - The code shows Alt key detection but no specific Alt+Arrow implementation for word-jumping navigation typically expected in text editors.

### 5. Text Deletion Logic

#### Plain Backspace
- Deletes character at `cursor.x - 1`
- Moves cursor left by 1
- Clears selection state

#### Alt + Backspace (Word Deletion)
- Scans leftward from cursor to find word/space boundaries
- Deletes entire "chunk" (either word or spaces) to the left
- Uses character type change detection (space vs non-space)
- Supports negative coordinates (unlimited leftward)

#### Cmd + Backspace (Block Deletion)
**Advanced block-aware deletion:**
1. Scans current line for text blocks using 3+ space gap rule
2. Finds closest block to the left of cursor
3. Deletes from block start to cursor position
4. Falls back to single character if no blocks found

### 6. Enter Key Behavior

#### Smart Indentation System
**Uses "2+ space gap rule" for block detection:**
1. Analyzes current line for text blocks
2. Finds the closest block to cursor position
3. Sets new line indentation to match block's start position
4. Moves cursor to next line at calculated indent

**Block Boundary Detection:**
- Groups characters with < 3 space gaps as single blocks
- 3+ space gaps create new block boundaries
- Used for both Enter indentation and Cmd+Backspace targeting

### 7. Layer Management
- `Tab` → cycle to next layer
- `Shift+Tab` → cycle to previous layer
- Layer system supports multiple text layers with independent content

### 8. Clipboard Operations
- `Cmd+C` → copy selection
- `Cmd+X` → cut selection  
- `Cmd+V` → paste (async operation)
- `Cmd+F` → toggle cursor following mode

### 9. Character Input
**Selection Replacement:**
- Typing with active selection → deletes selection, places character at selection start
- Cursor moves to position after new character

**Regular Typing:**
- Single characters (no modifiers) → place at cursor, advance cursor
- Blocked during Meta Selection mode

## Mobile/Touch Considerations
The canvas component includes a hidden input field for mobile keyboard support:
- Special keys mapped: `['Backspace', 'Enter', 'Return', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Delete', 'Home', 'End']`
- Text input processed character-by-character through `handleTextInput`

## Notable Implementation Details

### Coordinate System
- Supports negative coordinates (extends world leftward/upward)
- Optional fixed world boundaries via `fixedWorldWidth`/`fixedWorldHeight`
- World-to-screen coordinate conversion for display

### Block Detection Algorithm
Used by Enter and Cmd+Backspace:
```typescript
// Characters separated by 3+ spaces = different blocks
// < 3 spaces = same block
if (gap >= 3) {
  // Start new block
} else {
  // Extend current block
}
```

### AI Context Extraction
- Searches for text blocks around cursor
- Calculates max characters based on block size
- Includes above/below block context for AI prompts

## Current Gaps
1. **Option + Arrow**: No word-jumping navigation implemented
2. **Home/End**: Not specifically handled for line start/end navigation  
3. **Ctrl+A**: No select-all functionality visible
4. **Page Up/Down**: No page navigation

The system is sophisticated with block-aware editing, smart indentation, and integrated AI features, but could benefit from additional standard text editor navigation shortcuts.