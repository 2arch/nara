# Text Rendering Architecture Analysis
## Deep Dive into Variable-Scale Text Support

---

## 1. CURRENT ARCHITECTURE OVERVIEW

### 1.1 Grid System Fundamentals

Your text rendering operates on a **dual-grid system**:

1. **Physical Grid**: 1x1 cells at base size (9.6px × 9.6px at zoom 1.0)
   - Each cell is perfectly square (`effectiveHeight = effectiveWidth * 1.0`)
   - Calculated in `getEffectiveCharDims()` at world.engine.ts:1079-1091

2. **Character Grid**: 1x2 cells (`GRID_CELL_SPAN = 2`)
   - Characters **always** occupy 2 vertically-stacked physical cells
   - This creates a 9.6px × 19.2px character cell (aspect ratio ~1:2)
   - Font size is 1.5× the width: `fontSize = effectiveWidth * 1.5`

**Key Constants:**
```typescript
// world.engine.ts:77-85
const BASE_FONT_SIZE = 16;
const BASE_CHAR_WIDTH = 16 * 0.6 = 9.6px;
const GRID_CELL_SPAN = 2;  // ← THE CORE ASSUMPTION
```

### 1.2 Coordinate System

**World Coordinates** (infinite grid):
- Stored as string keys: `"x,y"` in `WorldData` object
- Y-coordinates are **always even numbers** (multiples of GRID_CELL_SPAN)
- Enforced in `screenToWorld()` at world.engine.ts:1100:
  ```typescript
  const roundedY = Math.round(worldY / GRID_CELL_SPAN) * GRID_CELL_SPAN;
  ```

**Screen Coordinates** (viewport pixels):
- Calculated via `worldToScreen()` at world.engine.ts:2873-2878:
  ```typescript
  screenX = (worldX - offset.x) * effectiveCharWidth
  screenY = (worldY - offset.y) * effectiveCharHeight  // Uses 1x1 cell height
  ```

**Critical Observation**:
- World coordinates use physical 1x1 cells
- Character rendering uses 1x2 cells
- This creates an offset pattern: characters at `worldY` render at `worldY-1` (top cell)

---

## 2. RENDERING PIPELINE

### 2.1 Main Character Rendering Loop

Location: `bit.canvas.tsx:3652-3724`

```typescript
for (const key in engine.worldData) {
    const [xStr, yStr] = key.split(',');
    const worldX = parseInt(xStr, 10);
    const worldY = parseInt(yStr, 10);  // Always even (0, 2, 4, 6...)

    // Calculate both cells that the character spans:
    const bottomScreenPos = engine.worldToScreen(worldX, worldY);      // Bottom cell
    const topScreenPos = engine.worldToScreen(worldX, worldY - 1);     // Top cell (worldY-1)

    // Render background spanning GRID_CELL_SPAN cells:
    ctx.fillRect(
        topScreenPos.x,
        topScreenPos.y,
        effectiveCharWidth,
        effectiveCharHeight * GRID_CELL_SPAN  // ← 2× height
    );

    // Render character at top cell position:
    renderText(ctx, char, topScreenPos.x, topScreenPos.y + verticalTextOffset);
}
```

**Key Pattern**: Every character renders in **two steps**:
1. Convert world `(x, y)` to bottom cell screen position
2. Convert world `(x, y-1)` to top cell screen position
3. Draw background from top to bottom (spanning 2 cells)
4. Draw text at top cell position

### 2.2 Text Rendering Function

Location: `bit.canvas.tsx:2961-2972`

```typescript
const renderText = (ctx, char, x, y) => {
    if (isKoreanChar(char)) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(0.8, 1);  // Compress Korean chars to fit monospace
        ctx.fillText(char, 0, 0);
        ctx.restore();
    } else {
        ctx.fillText(char, x, y);
    }
};
```

**Vertical Text Offset**: `const verticalTextOffset = 2;`
- Applied to center text visually within the 2-cell height
- Hardcoded for 16px font size

---

## 3. PLACES WHERE 1×2 IS DEEPLY EMBEDDED

### 3.1 Cursor System

Location: `bit.canvas.tsx:5184-5199`

```typescript
// Cursor spans 2 cells: bottom at cursorPos.y, top at cursorPos.y-1
const cursorBottomScreenPos = engine.worldToScreen(cursorPos.x, cursorPos.y);
const cursorTopScreenPos = engine.worldToScreen(cursorPos.x, cursorPos.y - 1);

ctx.fillRect(
    cursorTopScreenPos.x,
    cursorTopScreenPos.y,
    effectiveCharWidth,
    effectiveCharHeight * GRID_CELL_SPAN  // ← Hardcoded 2× height
);
```

**Cursor Trails**: Same pattern (bit.canvas.tsx:5173-5180)
- Each trail position stores `{x, y, timestamp}`
- Rendered with same 2-cell spanning logic

### 3.2 Movement and Navigation

Location: `world.engine.ts:7429, 7637, 7194`

```typescript
// Move down
nextCursorPos.y = cursorPos.y + GRID_CELL_SPAN;  // +2

// Enter key
nextCursorPos.y = cursorPos.y + GRID_CELL_SPAN;  // +2

// Arrow keys (up/down)
nextCursorPos.y += direction * GRID_CELL_SPAN;  // ±2
```

**Smart Indentation**: Also assumes GRID_CELL_SPAN spacing

### 3.3 Command Menu

Location: `commands.ts:9, 503, 1486, 3372`

```typescript
const GRID_CELL_SPAN = 2;  // ← Duplicated constant

// Command suggestions positioned below command:
const suggestionY = cursorPos.y + GRID_CELL_SPAN + (index * GRID_CELL_SPAN);
```

### 3.4 Chat and Dialogue

Location: `bit.canvas.tsx:3784-3792`

```typescript
// Chat data background
ctx.fillRect(
    topScreenPos.x,
    topScreenPos.y,
    effectiveCharWidth,
    effectiveCharHeight * GRID_CELL_SPAN  // ← Hardcoded 2× height
);
```

**Dialogue System** (`dialogue.tsx`, `dialogue.display.ts`):
- Uses character dimensions from render context
- Assumes 1:2 aspect ratio for wrapping calculations

### 3.5 Chip Rendering (Tasks, Links, Waypoints)

Location: `bit.canvas.tsx:3266-3349`

```typescript
// Task text rendering with cutout effect
for (const [relativeKey, cellData] of Object.entries(chipData.data)) {
    const worldY = startY + relativeY;
    const topScreenPos = engine.worldToScreen(worldX, worldY - 1);

    ctx.fillRect(
        topScreenPos.x,
        topScreenPos.y,
        effectiveCharWidth,
        effectiveCharHeight * GRID_CELL_SPAN  // ← 2× height
    );
}

// Strikethrough for completed tasks (loops with GRID_CELL_SPAN):
for (let y = startY; y <= endY; y += GRID_CELL_SPAN) { ... }
```

### 3.6 Spatial Indexing

The spatial index system stores entities by their world coordinates:
- Chunks are 32×32 **physical cells** (1×1)
- Characters stored at even Y-coordinates only
- Query functions assume vertical spacing of GRID_CELL_SPAN

---

## 4. CHALLENGES FOR VARIABLE SCALING

### 4.1 Fundamental Architectural Challenges

#### Challenge 1: **Y-Coordinate Quantization**
```typescript
// screenToWorld() enforces even Y-coordinates:
const roundedY = Math.round(worldY / GRID_CELL_SPAN) * GRID_CELL_SPAN;
```

**Problem**: This hardcodes the assumption that all characters are 2 cells tall.
- A 1×6 character would need to snap to multiples of 6
- A 4×4 character would need multiples of 4
- **Mixing scales would create conflicting quantization rules**

**Example Conflict**:
- User types 1×2 text at Y=10
- User types 1×6 text at Y=12 (would snap to Y=12, but overlaps with 1×2 text)

#### Challenge 2: **Dual-Position Rendering Pattern**
Every character requires calculating two screen positions:
```typescript
const topScreenPos = engine.worldToScreen(worldX, worldY - 1);
const bottomScreenPos = engine.worldToScreen(worldX, worldY);
```

**Problem**: The offset (`worldY - 1`) assumes height=2.
- 1×6 text would need `worldY - 5` for top cell
- 4×4 text would need `worldY - 3` for top cell
- **Each character needs to know its own scale to calculate rendering position**

#### Challenge 3: **Data Storage Model**
```typescript
WorldData { [key: string]: string | StyledCharacter | ImageData; }
// Keys are "x,y" where y is the BOTTOM cell
```

**Problem**: Characters don't store their scale information.
- Current: `"5,10": "A"` means character A at position (5, 10)
- Needed: `"5,10": {char: "A", scaleX: 1, scaleY: 6}` (or similar)
- **All existing data structures need to change**

#### Challenge 4: **Cursor Positioning**
```typescript
// Cursor is always positioned at character boundaries
setCursorPos({ x: 5, y: 10 });  // y must be multiple of GRID_CELL_SPAN
```

**Problem**: Where does cursor go when mixing scales?
- After 1×2 char at Y=10, cursor moves to Y=12 ✓
- After 1×6 char at Y=12, cursor moves to Y=18 (skips Y=14, Y=16)
- Cursor navigation becomes non-uniform (some positions unreachable)

#### Challenge 5: **Text Selection and Editing**
Selection bounds are rectangular:
```typescript
{ startX, endX, startY, endY }
```

**Problem**: Selecting mixed-scale text is ambiguous.
- User selects from Y=10 to Y=18
- Includes: 1×2 chars at Y=10,12,14,16, OR 1×6 char at Y=12, OR 4×4 char at Y=14
- **How to determine which characters are selected?**

### 4.2 Rendering-Specific Challenges

#### Challenge 6: **Background Rendering**
```typescript
ctx.fillRect(topPos.x, topPos.y, width, height * GRID_CELL_SPAN);
```

**Problem**: Background height is calculated per-character during render loop.
- Need to query each character's scale before rendering
- Current loop assumes uniform height: `for (let y = start; y <= end; y += GRID_CELL_SPAN)`
- **Non-uniform scales break the iteration pattern**

#### Challenge 7: **Font Size Scaling**
```typescript
const effectiveFontSize = effectiveWidth * 1.5;  // Assumes 1:2 ratio
```

**Problem**: Font size is calculated globally for the zoom level.
- 1×6 text needs smaller font to fit in narrow cell
- 4×4 text needs larger font to fill square cell
- **Font size becomes per-character, not per-zoom-level**

**Vertical Text Offset** also needs recalculation:
```typescript
const verticalTextOffset = 2;  // Hardcoded for 16px font in 19.2px height
```

For 1×6: `verticalTextOffset = (cellHeight - fontSize) / 2` (dynamic)

#### Challenge 8: **Korean Character Scaling**
```typescript
if (isKoreanChar(char)) {
    ctx.scale(0.8, 1);  // Compress to 80% width
}
```

**Problem**: The 0.8× factor assumes 1:2 aspect ratio.
- 1×6 text might need 0.4× width compression
- 4×4 text might need 1.0× (no compression)
- **Per-character scale factor needs to account for text scale**

#### Challenge 9: **Viewport Culling**
```typescript
if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 &&
    worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
    // Render character
}
```

**Problem**: Culling checks assume all characters fit within ±5 cell buffer.
- 1×6 tall character needs ±6 cell buffer vertically
- **Culling bounds become scale-dependent**

### 4.3 UI/UX Challenges

#### Challenge 10: **Command Menu Positioning**
```typescript
const suggestionY = cursorPos.y + GRID_CELL_SPAN;
```

**Problem**: Menu appears 2 cells below cursor.
- For 1×6 cursor, should appear 6 cells below
- For 4×4 cursor, should appear 4 cells below
- **UI positioning depends on cursor's current scale**

#### Challenge 11: **Host Dialogue and Chat**
Chat data has inverted rendering (background = text color):
```typescript
ctx.fillStyle = engine.textColor;  // Background
ctx.fillRect(topPos.x, topPos.y, width, height * GRID_CELL_SPAN);

ctx.fillStyle = engine.backgroundColor;  // Text
renderText(ctx, char, topPos.x, topPos.y + verticalTextOffset);
```

**Problem**: Chat bubbles assume uniform 1×2 height.
- Mixed scales would create inconsistent chat bubble sizes
- **Need to decide: uniform chat style vs. variable chat style**

#### Challenge 12: **Chip Data (Tasks, Waypoints)**
Chips store their own internal character data:
```typescript
chipData = {
    type: 'task',
    startX, endX, startY, endY,
    data: {
        "0,0": "T", "1,0": "a", "2,0": "s", "3,0": "k"
    }
}
```

**Problem**: Chip coordinates are relative, assume 1×2 spacing.
- Task text wraps at `endX - startX` width
- **Chips need to store their text scale**

---

## 5. PROPOSED REARCHITECTURE

### 5.1 Core Architectural Changes

#### Change 1: **Variable Cell Span**

Replace global constant with per-character metadata:

**Current**:
```typescript
const GRID_CELL_SPAN = 2;  // Global
WorldData["5,10"] = "A";   // No scale info
```

**Proposed**:
```typescript
interface StyledCharacter {
    char: string;
    style?: { color?: string; background?: string };
    scale?: { w: number; h: number };  // ← NEW: width/height in cells
    fadeStart?: number;
}

WorldData["5,10"] = {
    char: "A",
    scale: { w: 1, h: 2 }  // Default 1×2
};

WorldData["7,12"] = {
    char: "B",
    scale: { w: 1, h: 6 }  // Narrow 1×6
};

WorldData["10,20"] = {
    char: "C",
    scale: { w: 4, h: 4 }  // Square 4×4
};
```

**Backward Compatibility**:
```typescript
const getCharScale = (data: string | StyledCharacter): {w: number, h: number} => {
    if (typeof data === 'string') return { w: 1, h: 2 };  // Default
    return data.scale || { w: 1, h: 2 };  // Default if not specified
};
```

#### Change 2: **Dynamic Y-Quantization**

Replace hardcoded GRID_CELL_SPAN rounding with context-aware rounding:

**Current**:
```typescript
const roundedY = Math.round(worldY / GRID_CELL_SPAN) * GRID_CELL_SPAN;
```

**Proposed**:
```typescript
const screenToWorld = (screenX, screenY, currentScale: {w: number, h: number}) => {
    const worldX = Math.floor(screenX / effectiveCharWidth);
    const rawY = screenY / effectiveCharHeight;

    // Round to nearest multiple of current scale height
    const roundedY = Math.round(rawY / currentScale.h) * currentScale.h;

    return { x: worldX, y: roundedY };
};
```

**Context**: Track "current scale mode" in engine state:
```typescript
interface WorldEngine {
    // ... existing fields
    currentScale: { w: number; h: number };  // Current text scale (for new input)
    setCurrentScale: (w: number, h: number) => void;
}
```

**UI**: Allow user to change scale mode (command menu, keyboard shortcut):
```typescript
// /scale 1x6 → set currentScale = {w:1, h:6}
// /scale 4x4 → set currentScale = {w:4, h:4}
// /scale normal → set currentScale = {w:1, h:2}
```

#### Change 3: **Scale-Aware Rendering**

Update main render loop to query scale per-character:

**Current**:
```typescript
const topScreenPos = engine.worldToScreen(worldX, worldY - 1);
const bottomScreenPos = engine.worldToScreen(worldX, worldY);

ctx.fillRect(
    topScreenPos.x, topScreenPos.y,
    effectiveCharWidth,
    effectiveCharHeight * GRID_CELL_SPAN
);
```

**Proposed**:
```typescript
for (const key in engine.worldData) {
    const charData = engine.worldData[key];
    const char = engine.getCharacter(charData);
    const scale = getCharScale(charData);  // ← Query scale

    const [xStr, yStr] = key.split(',');
    const worldX = parseInt(xStr, 10);
    const worldY = parseInt(yStr, 10);  // Bottom cell

    // Calculate top cell based on character's height
    const topWorldY = worldY - (scale.h - 1);

    const topScreenPos = engine.worldToScreen(worldX, topWorldY);
    const bottomScreenPos = engine.worldToScreen(worldX, worldY);

    // Render background with scale-dependent dimensions
    ctx.fillRect(
        topScreenPos.x,
        topScreenPos.y,
        effectiveCharWidth * scale.w,  // ← Scale width
        effectiveCharHeight * scale.h  // ← Scale height
    );

    // Calculate font size based on cell dimensions
    const cellWidth = effectiveCharWidth * scale.w;
    const cellHeight = effectiveCharHeight * scale.h;
    const fontSize = calculateFontSize(cellWidth, cellHeight);
    ctx.font = `${fontSize}px ${engine.fontFamily}`;

    // Calculate vertical centering offset
    const verticalOffset = (cellHeight - fontSize) / 2 + (fontSize * 0.1);

    // Render character centered in cell
    renderText(ctx, char, topScreenPos.x, topScreenPos.y + verticalOffset);
}
```

#### Change 4: **Dynamic Font Size Calculation**

Replace global font size with per-character calculation:

**Proposed**:
```typescript
const calculateFontSize = (cellWidth: number, cellHeight: number): number => {
    // Target: font should fit comfortably in cell
    // Use 70% of smallest dimension to ensure fit
    const targetSize = Math.min(cellWidth * 0.7, cellHeight * 0.7);

    // For very narrow cells (1×6), prioritize height
    const aspectRatio = cellWidth / cellHeight;
    if (aspectRatio < 0.3) {  // Narrow (1×6 = 0.167 ratio)
        return cellHeight * 0.6;
    }

    // For square cells (4×4), use balanced approach
    if (aspectRatio >= 0.8 && aspectRatio <= 1.2) {  // Square
        return Math.min(cellWidth, cellHeight) * 0.7;
    }

    // Default (1×2 = 0.5 ratio): current behavior
    return cellWidth * 1.5;
};
```

**Korean Character Scaling**:
```typescript
const calculateKoreanScale = (cellWidth: number, cellHeight: number): number => {
    const aspectRatio = cellWidth / cellHeight;

    if (aspectRatio < 0.3) return 0.5;  // 1×6: compress more
    if (aspectRatio >= 0.8) return 1.0;  // 4×4: no compression
    return 0.8;  // 1×2: current behavior
};
```

#### Change 5: **Scale-Aware Cursor**

Update cursor positioning to use character scale:

**Proposed**:
```typescript
const setCursorPos = (newPos: Point) => {
    // Query the character at or before the cursor position to determine scale
    const charAtPos = worldData[`${newPos.x},${newPos.y}`];
    const scale = charAtPos ? getCharScale(charAtPos) : currentScale;

    // Snap to grid aligned with the scale
    const alignedY = Math.round(newPos.y / scale.h) * scale.h;

    cursorPos = { x: newPos.x, y: alignedY };
};
```

**Cursor Rendering**:
```typescript
// Cursor adopts current scale mode
const cursorScale = engine.currentScale;
const topWorldY = cursorPos.y - (cursorScale.h - 1);

const topScreenPos = engine.worldToScreen(cursorPos.x, topWorldY);

ctx.fillRect(
    topScreenPos.x,
    topScreenPos.y,
    effectiveCharWidth * cursorScale.w,
    effectiveCharHeight * cursorScale.h
);
```

#### Change 6: **Smart Movement**

Update movement to detect scale at current position:

**Proposed**:
```typescript
const handleArrowKey = (direction: 'up' | 'down' | 'left' | 'right') => {
    let nextPos = { ...cursorPos };

    if (direction === 'down') {
        // Look ahead to find next character's scale
        let searchY = cursorPos.y + 1;
        let foundChar = null;

        // Search next 10 cells for a character
        for (let offset = 1; offset <= 10; offset++) {
            const testKey = `${cursorPos.x},${cursorPos.y + offset}`;
            if (worldData[testKey]) {
                foundChar = worldData[testKey];
                searchY = cursorPos.y + offset;
                break;
            }
        }

        if (foundChar) {
            // Move to the found character's position
            const scale = getCharScale(foundChar);
            nextPos.y = searchY;
        } else {
            // No character found, move by current scale
            nextPos.y += currentScale.h;
        }
    }

    if (direction === 'up') {
        // Similar logic searching backwards
        // ...
    }

    setCursorPos(nextPos);
};
```

**Alternative: Uniform Movement**
```typescript
// Always move by current scale, regardless of characters
nextPos.y += currentScale.h * direction;  // direction = ±1
```

This is simpler but might skip over characters with different scales.

### 5.2 Data Migration Strategy

#### Option A: **Transparent Migration (Recommended)**

1. Existing data without `scale` property defaults to `{w: 1, h: 2}`
2. New characters created in different scale modes store explicit scale
3. Old and new characters coexist seamlessly

```typescript
const getCharScale = (data: string | StyledCharacter): {w: number, h: number} => {
    if (typeof data === 'string') return DEFAULT_SCALE;  // {w:1, h:2}
    return data.scale ?? DEFAULT_SCALE;
};
```

#### Option B: **Explicit Migration**

Run migration on world data to add explicit scale to all characters:

```typescript
const migrateWorldData = (worldData: WorldData): WorldData => {
    const migrated: WorldData = {};

    for (const [key, value] of Object.entries(worldData)) {
        if (typeof value === 'string') {
            migrated[key] = {
                char: value,
                scale: { w: 1, h: 2 }
            };
        } else if (!value.scale && !isImageData(value)) {
            migrated[key] = {
                ...value,
                scale: { w: 1, h: 2 }
            };
        } else {
            migrated[key] = value;
        }
    }

    return migrated;
};
```

### 5.3 Viewport Culling Update

Update culling to account for variable scales:

**Current**:
```typescript
const buffer = 5;
if (worldX >= startWorldX - buffer && worldX <= endWorldX + buffer &&
    worldY >= startWorldY - buffer && worldY <= endWorldY + buffer) {
    // Render
}
```

**Proposed**:
```typescript
const renderCharacter = (worldX: number, worldY: number, charData: any) => {
    const scale = getCharScale(charData);

    // Calculate character's actual bounds
    const charMinX = worldX;
    const charMaxX = worldX + scale.w - 1;
    const charMinY = worldY - (scale.h - 1);  // Top cell
    const charMaxY = worldY;  // Bottom cell

    // Check if character intersects viewport (with buffer)
    const buffer = Math.max(5, scale.h);  // Dynamic buffer

    if (charMaxX >= startWorldX - buffer && charMinX <= endWorldX + buffer &&
        charMaxY >= startWorldY - buffer && charMinY <= endWorldY + buffer) {
        // Render character
    }
};
```

### 5.4 Selection System Update

Update selection to handle multi-cell characters:

**Current**:
```typescript
interface Selection {
    startX: number;
    endX: number;
    startY: number;
    endY: number;
}
```

**Proposed**:
```typescript
const getCharactersInSelection = (selection: Selection): Array<{x: number, y: number, data: any}> => {
    const selected: Array<{x: number, y: number, data: any}> = [];

    for (const [key, data] of Object.entries(worldData)) {
        const [xStr, yStr] = key.split(',');
        const x = parseInt(xStr, 10);
        const y = parseInt(yStr, 10);
        const scale = getCharScale(data);

        // Calculate character bounds
        const charMinX = x;
        const charMaxX = x + scale.w - 1;
        const charMinY = y - (scale.h - 1);
        const charMaxY = y;

        // Check if character intersects selection rectangle
        const intersects = !(
            charMaxX < selection.startX ||
            charMinX > selection.endX ||
            charMaxY < selection.startY ||
            charMinY > selection.endY
        );

        if (intersects) {
            selected.push({ x, y, data });
        }
    }

    return selected;
};
```

### 5.5 Command Menu Update

Update command menu positioning:

**Current**:
```typescript
const suggestionY = cursorPos.y + GRID_CELL_SPAN;
```

**Proposed**:
```typescript
const suggestionY = cursorPos.y + engine.currentScale.h;
```

Command rendering also needs to use current scale for its own text.

### 5.6 Chip System Update

Update chips to store and render with scale:

**Current**:
```typescript
interface ChipData {
    type: 'task' | 'link' | 'waypoint';
    x: number;
    y: number;
    startX: number;
    endX: number;
    startY: number;
    endY: number;
    data: { [relativeKey: string]: string };
    color: string;
}
```

**Proposed**:
```typescript
interface ChipData {
    type: 'task' | 'link' | 'waypoint';
    x: number;
    y: number;
    startX: number;
    endX: number;
    startY: number;
    endY: number;
    data: { [relativeKey: string]: string | StyledCharacter };  // ← Can include scale
    color: string;
    textScale?: { w: number; h: number };  // ← Chip's text scale
}
```

Chip rendering loops need to query scale from chip data:

```typescript
const renderChip = (chipData: ChipData) => {
    const textScale = chipData.textScale || { w: 1, h: 2 };

    for (const [relativeKey, cellData] of Object.entries(chipData.data)) {
        const [relXStr, relYStr] = relativeKey.split(',');
        const relativeX = parseInt(relXStr, 10);
        const relativeY = parseInt(relYStr, 10);

        const scale = getCharScale(cellData);

        // Calculate actual position with scale offset
        const worldX = chipData.startX + relativeX;
        const worldY = chipData.startY + relativeY;
        const topWorldY = worldY - (scale.h - 1);

        // Render with scale
        const topScreenPos = engine.worldToScreen(worldX, topWorldY);

        ctx.fillRect(
            topScreenPos.x,
            topScreenPos.y,
            effectiveCharWidth * scale.w,
            effectiveCharHeight * scale.h
        );

        // ... render text
    }
};
```

---

## 6. IMPLEMENTATION ROADMAP

### Phase 1: **Core Infrastructure** (Foundation)

**Goal**: Add scale support to data structures without breaking existing code.

**Tasks**:
1. ✅ Add `scale?: {w: number, h: number}` to `StyledCharacter` interface
2. ✅ Create `getCharScale()` helper with default `{w:1, h:2}`
3. ✅ Add `currentScale` to `WorldEngine` state
4. ✅ Add `/scale` command to change current scale mode
5. ✅ Test: Existing world data still renders correctly

**Files to Modify**:
- `world.engine.ts`: Update `StyledCharacter`, add `currentScale` state
- `commands.ts`: Add `/scale` command

**Estimated Effort**: 2-3 hours

### Phase 2: **Rendering Updates** (Critical Path)

**Goal**: Update rendering pipeline to use per-character scales.

**Tasks**:
1. ✅ Update main character rendering loop in `bit.canvas.tsx:3652-3724`
   - Replace `worldY - 1` with `worldY - (scale.h - 1)`
   - Replace `GRID_CELL_SPAN` with `scale.h`
   - Add dynamic font size calculation
   - Add dynamic vertical offset calculation
2. ✅ Update cursor rendering in `bit.canvas.tsx:5184-5199`
   - Use `currentScale` for cursor dimensions
3. ✅ Update cursor trails rendering
4. ✅ Update chat data rendering
5. ✅ Update light mode data rendering
6. ✅ Update chip rendering (tasks, links, waypoints)
7. ✅ Test: Render characters with different scales (manually add to worldData)

**Files to Modify**:
- `bit.canvas.tsx`: All rendering sections

**Estimated Effort**: 8-12 hours

### Phase 3: **Input and Movement** (UX Critical)

**Goal**: Make text input and cursor movement work with variable scales.

**Tasks**:
1. ✅ Update `screenToWorld()` to use `currentScale` for Y-quantization
2. ✅ Update cursor movement (arrow keys, mouse clicks)
   - Use `currentScale` for vertical movement
   - Implement smart movement or uniform movement (decide which)
3. ✅ Update text input to create characters with `currentScale`
4. ✅ Update Enter key to move by `currentScale.h`
5. ✅ Update Backspace/Delete to handle multi-cell characters
6. ✅ Test: Type text in different scale modes, move cursor, edit text

**Files to Modify**:
- `world.engine.ts`: `screenToWorld()`, movement handlers, input handlers

**Estimated Effort**: 6-8 hours

### Phase 4: **Selection and Editing** (Data Integrity)

**Goal**: Make selection, copy/paste, and deletion work with variable scales.

**Tasks**:
1. ✅ Update selection rendering to show character bounds (not just grid cells)
2. ✅ Update `getCharactersInSelection()` to detect multi-cell characters
3. ✅ Update `deleteSelectedCharacters()` to remove entire characters (all cells)
4. ✅ Update copy/paste to preserve scale information
5. ✅ Test: Select mixed-scale text, copy/paste, delete

**Files to Modify**:
- `world.engine.ts`: Selection functions, copy/paste, delete

**Estimated Effort**: 4-6 hours

### Phase 5: **Command and UI Systems** (Polish)

**Goal**: Update all UI systems to work with variable scales.

**Tasks**:
1. ✅ Update command menu positioning and rendering
2. ✅ Update dialogue system (`dialogue.tsx`, `dialogue.display.ts`)
3. ✅ Update host dialogue rendering
4. ✅ Update note rendering (if notes should support variable scales)
5. ✅ Test: Open command menu, type commands, view dialogues

**Files to Modify**:
- `commands.ts`: Command menu rendering
- `dialogue.tsx`, `dialogue.display.ts`: Dialogue rendering
- `host.dialogue.ts`: Host flow

**Estimated Effort**: 4-6 hours

### Phase 6: **Advanced Features** (Optional Enhancements)

**Goal**: Add quality-of-life features for variable scales.

**Tasks**:
1. ⚠️ Add visual indicator showing current scale mode (status bar, cursor style)
2. ⚠️ Add keyboard shortcut to cycle scales (e.g., `Ctrl+Shift+S`)
3. ⚠️ Add scale picker UI (visual menu showing 1×2, 1×6, 4×4 options)
4. ⚠️ Add "normalize scale" command to convert selected text to 1×2
5. ⚠️ Add "auto-scale" mode (e.g., narrow for comments, square for titles)
6. ⚠️ Update spatial index to optimize queries for multi-cell characters
7. ⚠️ Test: User workflow for creating mixed-scale documents

**Files to Modify**:
- `bit.canvas.tsx`: Visual indicators
- `commands.ts`: New commands
- `world.engine.ts`: Auto-scale logic, spatial index

**Estimated Effort**: 6-10 hours

### Phase 7: **Testing and Refinement** (Quality Assurance)

**Goal**: Ensure stability and performance.

**Tasks**:
1. ✅ Test all existing features with default 1×2 scale (regression testing)
2. ✅ Test mixed-scale documents (1×2 + 1×6 + 4×4)
3. ✅ Test edge cases:
   - Deleting multi-cell character
   - Selecting across scale boundaries
   - Cursor movement at scale transitions
   - Zoom in/out with variable scales
   - Copy/paste between different scale modes
4. ✅ Performance testing: Large documents with mixed scales
5. ✅ Fix any bugs discovered
6. ✅ Update documentation

**Estimated Effort**: 4-8 hours

**Total Estimated Effort**: 34-53 hours

---

## 7. ALTERNATIVE ARCHITECTURES

### Alternative 1: **Scale as Separate Layer**

Instead of storing scale per-character, store it in a separate map:

```typescript
interface WorldEngine {
    worldData: WorldData;  // Characters (no scale)
    scaleData: { [key: string]: {w: number, h: number} };  // Scales
}
```

**Pros**:
- Cleaner separation of concerns
- Existing worldData unchanged
- Easy to toggle scale system on/off

**Cons**:
- Two lookups per character (data + scale)
- Synchronization issues (deleting char must delete scale)
- More complex data management

### Alternative 2: **Fixed Scale Layers**

Instead of arbitrary scales, use predefined layers:

```typescript
interface WorldEngine {
    worldData: WorldData;        // 1×2 characters (default)
    narrowData: WorldData;       // 1×6 characters (narrow layer)
    squareData: WorldData;       // 4×4 characters (square layer)
}
```

**Pros**:
- Simple layering system
- Each layer can have optimized rendering
- Easy to toggle layers on/off

**Cons**:
- Limited to predefined scales
- Cannot mix scales within same layer
- More complex state management

### Alternative 3: **Glyph-Based Rendering**

Treat characters as vector glyphs that can be arbitrarily scaled:

```typescript
interface Glyph {
    char: string;
    x: number;
    y: number;
    width: number;   // In pixels
    height: number;  // In pixels
    fontSize: number;
}
```

**Pros**:
- Ultimate flexibility (arbitrary sizes)
- More like traditional graphics editors
- Could support rotation, skewing, etc.

**Cons**:
- Breaks grid-based paradigm completely
- Much more complex rendering
- Cursor positioning becomes very complex
- Loses monospace aesthetic

### Alternative 4: **Cell Merging**

Keep 1×1 physical cells, but allow characters to "merge" adjacent cells:

```typescript
interface MergedCell {
    char: string;
    anchorX: number;
    anchorY: number;
    mergedCells: Array<{x: number, y: number}>;  // List of cells this char occupies
}
```

**Pros**:
- Grid stays uniform (all 1×1 cells)
- Flexible shapes (not just rectangles)
- Easy to visualize in code

**Cons**:
- Complex data structure
- Need to track which cells are merged
- Selection becomes complex

**Recommendation**: **Proposed Architecture** (per-character scale metadata) is the best balance of flexibility, simplicity, and compatibility with existing code.

---

## 8. KEY DECISIONS TO MAKE

Before implementing, decide:

### Decision 1: **Default Scale**
- Keep 1×2 as default? (Maintains existing aesthetic)
- Switch to 1×1 as default? (More traditional, simpler)
- Allow user to configure default scale?

**Recommendation**: Keep 1×2 as default for backward compatibility.

### Decision 2: **Movement Behavior**
When cursor encounters character with different scale:
- **Smart Movement**: Jump to character's actual position (may skip Y-coordinates)
- **Uniform Movement**: Always move by `currentScale`, may skip characters
- **Hybrid**: Smart movement with Ctrl held, uniform without

**Recommendation**: Smart movement (easier to navigate mixed-scale text).

### Decision 3: **Scale Quantization**
Should Y-coordinates be:
- **Unrestricted**: Any Y value allowed (cursor snaps to character boundaries)
- **LCM Grid**: Round to least common multiple of all scales (e.g., multiples of 6 for 1×2 and 1×6)
- **Current Scale Grid**: Round to `currentScale.h` multiples

**Recommendation**: Current Scale Grid (simplest, most intuitive).

### Decision 4: **Chat and Dialogue Scales**
Should chat/dialogue use:
- **Fixed 1×2**: Keep existing behavior (simplest)
- **Variable Scale**: Chat adopts current scale mode (more flexible)
- **Separate Scale**: Chat has its own scale setting

**Recommendation**: Fixed 1×2 (chat should be consistent).

### Decision 5: **Chip Scale Inheritance**
When creating chips (tasks, waypoints):
- **Fixed 1×2**: All chip text is 1×2
- **Current Scale**: Chip inherits `currentScale` at creation time
- **Per-Character**: Chip preserves each character's individual scale

**Recommendation**: Current Scale (chips should be uniform internally).

### Decision 6: **Selection Rendering**
When selection includes mixed scales:
- **Rectangular Bounds**: Draw rectangle from min to max coordinates
- **Per-Character Bounds**: Outline each character individually
- **Unified Highlight**: Highlight all cells within selection

**Recommendation**: Rectangular Bounds (simplest, most familiar).

### Decision 7: **Width Scaling**
Should width scaling be supported initially?
- **Yes**: Full 2D scaling (1×6, 4×4, 2×1, 8×2, etc.)
- **No**: Height-only scaling first (1×2, 1×4, 1×6, etc.)
- **Limited**: Height + special squares (1×2, 1×6, 2×2, 4×4)

**Recommendation**: Limited (easier to implement, covers main use cases).

### Decision 8: **Migration Strategy**
How to handle existing worlds:
- **Transparent**: Auto-default to 1×2 (no migration needed)
- **Explicit**: Run migration script to add scale metadata
- **Lazy**: Add scale on first edit of each character

**Recommendation**: Transparent (seamless for users).

---

## 9. PERFORMANCE CONSIDERATIONS

### Potential Performance Issues

1. **Per-Character Scale Lookup**
   - Current: `GRID_CELL_SPAN` is constant (fast)
   - Proposed: `getCharScale(data)` per character (slightly slower)
   - **Impact**: Minimal (simple property access)

2. **Dynamic Font Size Calculation**
   - Current: One font size per zoom level (cached)
   - Proposed: Font size per character scale (more calculations)
   - **Mitigation**: Cache font sizes by scale: `fontSizeCache[scale.w][scale.h][zoom]`

3. **Viewport Culling**
   - Current: Simple bounds check
   - Proposed: Character bounds calculation per character
   - **Mitigation**: Spatial index could store character bounds

4. **Rendering Loop Complexity**
   - Current: ~10 operations per character
   - Proposed: ~15 operations per character
   - **Impact**: 50% more work per character
   - **Mitigation**: Only visible characters are rendered (culled viewport)

### Optimization Strategies

1. **Scale Caching**
```typescript
const scaleCache = new Map<string, {w: number, h: number}>();

const getCharScale = (key: string, data: any) => {
    if (scaleCache.has(key)) return scaleCache.get(key)!;

    const scale = (typeof data === 'string' || !data.scale)
        ? { w: 1, h: 2 }
        : data.scale;

    scaleCache.set(key, scale);
    return scale;
};
```

2. **Font Size Cache**
```typescript
const fontSizeCache: {
    [scaleKey: string]: {  // "1x2", "1x6", "4x4"
        [zoom: number]: number
    }
} = {};

const getFontSize = (scale: {w: number, h: number}, zoom: number) => {
    const scaleKey = `${scale.w}x${scale.h}`;
    if (!fontSizeCache[scaleKey]) fontSizeCache[scaleKey] = {};
    if (fontSizeCache[scaleKey][zoom]) return fontSizeCache[scaleKey][zoom];

    const { width, height } = getEffectiveCharDims(zoom);
    const cellWidth = width * scale.w;
    const cellHeight = height * scale.h;
    const fontSize = calculateFontSize(cellWidth, cellHeight);

    fontSizeCache[scaleKey][zoom] = fontSize;
    return fontSize;
};
```

3. **Batch Rendering by Scale**
Instead of random iteration, group characters by scale:

```typescript
const renderByScale = () => {
    // Group characters by scale
    const charactersByScale = new Map<string, Array<{key: string, data: any}>>();

    for (const key in worldData) {
        const data = worldData[key];
        const scale = getCharScale(key, data);
        const scaleKey = `${scale.w}x${scale.h}`;

        if (!charactersByScale.has(scaleKey)) {
            charactersByScale.set(scaleKey, []);
        }
        charactersByScale.get(scaleKey)!.push({ key, data });
    }

    // Render each scale group (allows font size to be set once per group)
    for (const [scaleKey, characters] of charactersByScale) {
        const scale = parseScale(scaleKey);  // "1x2" → {w:1, h:2}
        const fontSize = getFontSize(scale, zoom);
        ctx.font = `${fontSize}px ${fontFamily}`;

        for (const { key, data } of characters) {
            // Render character (font already set)
            // ...
        }
    }
};
```

**Note**: May break z-order (characters no longer rendered in consistent order).

4. **Spatial Index Enhancement**
Store character bounds in spatial index:

```typescript
interface SpatialChunk {
    characters: Array<{
        key: string;
        x: number;
        y: number;
        scale: {w: number, h: number};
        bounds: {minX: number, maxX: number, minY: number, maxY: number};
    }>;
}
```

Allows fast culling without recalculating bounds each frame.

---

## 10. SUMMARY

### Current System
- **Grid**: 1×1 physical cells, 1×2 character cells (hardcoded)
- **Rendering**: Manual 2D canvas, character-by-character
- **Coordinates**: String keys `"x,y"`, Y always even
- **Assumptions**: `GRID_CELL_SPAN = 2` throughout codebase
- **Files**: ~15 files with embedded 1×2 assumptions

### Challenges for Variable Scales
- **Data Storage**: No scale metadata in characters
- **Y-Quantization**: Hardcoded rounding to multiples of 2
- **Rendering**: Hardcoded `worldY - 1` offset, `height * 2` backgrounds
- **Cursor**: Fixed 2-cell height, movement by ±2
- **Selection**: Rectangular bounds don't account for multi-cell characters
- **UI**: Command menu, dialogue, chat all assume 1×2

### Recommended Architecture
- **Per-Character Scale**: Add `scale: {w, h}` to `StyledCharacter`
- **Current Scale Mode**: Track user's active scale setting
- **Dynamic Rendering**: Query scale per-character, calculate dimensions
- **Smart Movement**: Cursor navigates to character boundaries
- **Backward Compatible**: Default scale {1, 2} for existing data

### Implementation Phases
1. **Core Infrastructure**: Add scale support (~3 hours)
2. **Rendering Updates**: Update all render loops (~10 hours)
3. **Input and Movement**: Cursor, typing, navigation (~7 hours)
4. **Selection and Editing**: Copy/paste, delete (~5 hours)
5. **Command and UI**: Menus, dialogues (~5 hours)
6. **Advanced Features**: Scale picker, indicators (~8 hours)
7. **Testing**: Regression, edge cases (~6 hours)

**Total**: ~44 hours (roughly 1 week of focused work)

### Key Decisions Needed
1. Default scale (keep 1×2?)
2. Movement behavior (smart vs uniform?)
3. Y-coordinate quantization (current scale grid?)
4. Chat/dialogue scales (fixed 1×2?)
5. Width scaling support (yes/no/limited?)

### Performance Impact
- **Minimal**: Mostly property lookups and cached calculations
- **Mitigations**: Scale cache, font size cache, batch rendering
- **Viewport culling**: Already limits rendering to visible characters

---

## NEXT STEPS

1. **Review this analysis** with your team/stakeholders
2. **Make key decisions** (defaults, movement, scales to support)
3. **Prototype Phase 1** (add scale to data structures, test backward compatibility)
4. **Validate approach** with small-scale test (render a few scaled characters manually)
5. **Proceed with full implementation** if prototype succeeds

This is a **significant architectural change** but very achievable. The modular structure of your codebase (separate rendering, input, and data layers) makes this refactor cleaner than it could be.

Good luck! Let me know if you need clarification on any section.
