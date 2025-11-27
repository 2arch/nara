# Reflections: Paint Blob Storage, Resize & Note Integration

**Date**: 2025-11-27
**Status**: Working but inefficient

## Summary

Implemented paint blob selection and bounding-box resize functionality. Paint blobs can now be selected (double-click) and resized by dragging corner handles, similar to notes and images. Additionally, paint interacts with note display modes to create masked viewports and shape-aware text wrapping. However, the underlying storage architecture is inefficient compared to industry standards.

## Current Implementation

### Storage Model: Individual Cells

Paint is stored as **individual cells** scattered throughout `worldData`:

```typescript
worldData = {
  "paint_10_20": '{"type":"paint","color":"#ff0000"}',
  "paint_11_20": '{"type":"paint","color":"#ff0000"}',
  "paint_12_20": '{"type":"paint","color":"#ff0000"}',
  // ... potentially hundreds more cells
}
```

**Key characteristics:**
- No discrete "blob" object exists in storage
- Each cell is a separate key-value pair
- Paint blobs are identified dynamically via flood-fill algorithm
- Every cell redundantly stores `type: "paint"` and color data

### Blob Detection: Flood-Fill Algorithm

Location: `app/bitworld/world.engine.ts:114-190`

```typescript
export const findConnectedPaintRegion = (worldData: WorldData, x: number, y: number) => {
  // BFS flood-fill to find all connected cells of same color
  // Returns: { points: [], minX, maxX, minY, maxY, color }
}
```

**Process:**
1. Start at clicked cell
2. Queue-based BFS to find all connected cells of same color
3. Track min/max bounds during scan
4. Return set of points + bounding box

**Performance:** O(n) where n = number of cells in blob (must visit every cell)

### Resize Implementation

Location: `app/bitworld/bit.canvas.tsx:7764-7820`

**Algorithm:**
1. Calculate scale factors: `scaleX = newWidth/oldWidth`, `scaleY = newHeight/oldHeight`
2. For each cell in original blob:
   - Calculate relative position from top-left: `relX = x - minX`, `relY = y - minY`
   - Scale: `newRelX = round(relX * scaleX)`, `newRelY = round(relY * scaleY)`
   - Place at new absolute position: `newX = newMinX + newRelX`
3. Delete all old cells (set to `null`)
4. Create all new cells (set to paint data)
5. Apply updates atomically

**Performance:** O(n) where n = number of cells (must delete and recreate every cell)

## Paint & Note Display Mode Interactions

Paint objects have a dual role in the system: they can exist as **standalone visual elements** (selected/resized independently) or as **modifiers for note display behavior**. This creates unique interaction patterns.

### Display Mode Overview

Notes have four display modes that control scrolling and boundary behavior:
1. **Expand** - Note grows automatically when typing exceeds bounds
2. **Scroll** - Fixed size, content scrolls within viewport
3. **Wrap** - Fixed size, text wraps to fit width (with paint-aware variant)
4. **Paint** - Paint blob acts as viewport mask

### Interaction Pattern 1: Paint Mode (Viewport Masking)

**Behavior**: Paint blob defines the visible region of a note.

**Implementation**: `app/bitworld/commands.ts:4598-4628`

```typescript
if (newMode === 'paint') {
  // Check if paint exists within note bounds
  let hasPaint = false;
  for (let y = note.startY; y <= note.endY; y++) {
    for (let x = note.startX; x <= note.endX; x++) {
      if (worldData[`paint_${x}_${y}`]) {
        hasPaint = true;
      }
    }
  }

  if (hasPaint) {
    message = "Paint mode: paint acts as viewport";
  } else {
    message = "Paint mode: no paint detected (draw to create viewport)";
  }
}
```

**Rendering**: `app/bitworld/bit.canvas.tsx:580-607`
- Background is fully transparent (no semi-transparent overlay)
- Content only visible where paint cells exist
- Paint color defines the visible shape

**Use cases**:
- Irregular note shapes (speech bubbles, thought clouds)
- Custom-shaped windows/panels
- Masked content areas

### Interaction Pattern 2: Wrap Mode with Paint (Shape-Aware Text Flow)

**Behavior**: Text wraps to fit within paint blob boundaries instead of rectangular note bounds.

**Implementation**: `app/bitworld/world.engine.ts:234-420`

When a note is in wrap mode AND has paint:
1. `rewrapNoteText()` detects paint via `worldData` parameter
2. Calls `getPaintBoundsAtY()` for each Y coordinate to find paint boundaries
3. Text starts at top-left paint cell (`getTopLeftPaintCell()`)
4. Each line wraps to fit the paint blob's width at that Y level
5. Background becomes transparent (paint acts as background)

```typescript
// Paint-aware wrapping logic
if (usePaintBounds) {
  const paintBounds = getPaintBoundsAtY(noteData, relativeY, worldData);
  if (paintBounds) {
    lineStartX = paintBounds.startX;  // Start from left paint edge
    lineEndX = paintBounds.endX + 1;  // End at right paint edge
  }
}
```

**Rendering**: `app/bitworld/bit.canvas.tsx:608-640`
- Checks for paint existence in wrap mode
- Skips semi-transparent overlay if paint detected
- Paint provides the background, text flows within

**Use cases**:
- Text conforming to organic shapes
- Custom text boundaries (circular text, irregular panels)
- Paint-defined text columns

### Interaction Pattern 3: Paint as Independent Object

**Behavior**: Paint blobs exist independently and can be selected/resized separately from notes.

**Selection**: `app/bitworld/bit.canvas.tsx:7004-7038`
- Double-click paint cell → selects entire connected blob
- Uses flood-fill to find all connected cells of same color
- Shows border + corner resize handles

**Resize**: `app/bitworld/bit.canvas.tsx:7180-7217` (detection), `7764-7820` (logic)
- Drag corner handles to scale blob
- All cells transformed via bounding-box scale factors
- Independent of any notes

**Use cases**:
- Standalone art/decoration
- Visual markers/highlights
- Drawing separate from text

### Interaction Summary Table

| Scenario | Paint Role | Note Display | Text Behavior | Background |
|----------|-----------|--------------|---------------|------------|
| **Note in paint mode** | Viewport mask | Only visible in painted area | Normal (rectangular wrapping) | Transparent |
| **Note in wrap mode + paint** | Text boundary | Full note visible | Wraps to paint shape | Transparent (paint is background) |
| **Note in expand/scroll + paint** | Visual only | Normal note display | Normal (rectangular) | Semi-transparent overlay |
| **No note (standalone)** | Independent object | N/A | N/A | Paint color fills cells |

### Edge Cases & Interactions

1. **Multiple paint blobs in one note**:
   - Paint mode: All painted areas act as viewports
   - Wrap mode: Text wraps to the top-left-most blob only (limitation)

2. **Paint extends beyond note bounds**:
   - Only paint within note bounds is considered
   - Paint outside note is ignored for that note's display

3. **Overlapping notes with paint**:
   - Each note's paint mode/wrap mode is independent
   - Same paint cells can affect multiple notes differently

4. **Resizing paint while note is in paint/wrap mode**:
   - Paint resize updates cells immediately
   - Note text doesn't automatically rewrap (only on note resize or mode toggle)
   - **Potential improvement**: Auto-rewrap when paint changes

5. **Paint color vs note display**:
   - Paint color is visual only in standalone mode
   - In paint/wrap mode, color determines which cells are included
   - Different colored blobs treated as separate regions

### Architecture Implications

The dual nature of paint (standalone object vs note modifier) creates complexity:

**Pros**:
- ✅ Flexible: Same paint serves multiple purposes
- ✅ Intuitive: Paint mode naturally uses painted areas
- ✅ Powerful: Enables complex layouts and text flow

**Cons**:
- ❌ Coupling: Paint storage affects note rendering
- ❌ Confusion: Not obvious that paint affects note behavior
- ❌ Performance: Note rendering must scan for paint cells
- ❌ Stale state: Resizing paint doesn't auto-update note text

### Future Considerations

1. **Paint layers**: Separate paint into layers (background, foreground, mask)
2. **Auto-rewrap on paint change**: Trigger `rewrapNoteText()` when paint cells change
3. **Paint-note binding**: Explicit association between note and its paint mask
4. **Multiple mask support**: Allow multiple independent paint regions per note
5. **Paint metadata**: Store which notes reference this paint blob

## Problems with Current Approach

### 1. Memory Inefficiency
- **Redundant data**: Every cell stores `{"type":"paint","color":"#ff0000"}` (~40 bytes JSON)
- **Key overhead**: Each `paint_${x}_${y}` key adds ~15 bytes
- **Example**: 100-cell blob = ~5.5KB when it could be <200 bytes

### 2. Computational Inefficiency
- **Flood-fill on every selection**: No cached blob boundaries
- **JSON parse/stringify per cell**: Expensive serialization for every access
- **No spatial indexing**: Must check every cell in bounding box to find painted cells
- **Expensive resize**: Delete + create hundreds of individual worldData entries

### 3. No Blob Identity
- Paint blobs don't have persistent IDs
- Can't track blob metadata (creation time, name, layer, etc.)
- Can't implement blob-level operations (move, copy, merge)

### 4. Scaling Issues
- **Large blobs** (>1000 cells): Slow flood-fill, slow resize
- **Many blobs**: No way to enumerate all blobs efficiently
- **Undo/redo**: Would need to track hundreds of individual cell changes

## Industry Standards: How Real Game Engines Do It

### Tile-Based Games (Terraria, Stardew Valley, Celeste)

**Storage:**
```typescript
// 2D array of tile IDs (integers)
tilemap: number[][] = [
  [0, 0, 1, 1, 2, 2],  // 0=air, 1=dirt, 2=stone
  [0, 1, 1, 2, 2, 2],
  [1, 1, 2, 2, 2, 2]
]

// Separate tileset maps IDs to textures
tileset = {
  1: dirtTexture,   // GPU texture reference
  2: stoneTexture
}
```

**Memory:** ~1-4 bytes per tile (just an integer)
**Performance:** Instant access `tilemap[y][x]`, GPU renders from texture atlas

### Sprite-Based Games (Most 2D games)

**Storage:**
```typescript
entity = {
  sprite: textureRef,    // Reference to GPU texture
  transform: {           // Transformation matrix
    position: {x, y},
    scale: {x, y},
    rotation: angle
  }
}
```

**Memory:** ~32 bytes per entity (tiny!)
**Performance:** GPU handles scaling/rotation, zero CPU work for transform

### Bitmap Editors (Aseprite, Photoshop, MS Paint)

**Storage:**
```typescript
layer = {
  width: 100,
  height: 100,
  pixels: Uint8Array(100 * 100 * 4)  // RGBA, 40KB for 100×100 image
}
```

**Memory:** 4 bytes per pixel (RGBA)
**Performance:** Direct pixel access `pixels[y * width + x]`, can use Canvas API

### Vector Graphics (Flash, modern 2D engines)

**Storage:**
```typescript
shape = {
  type: 'polygon',
  points: [{x: 0, y: 0}, {x: 10, y: 5}, ...],
  fill: '#ff0000',
  stroke: '#000000'
}
```

**Memory:** ~8 bytes per vertex (two floats)
**Performance:** Infinite scaling, GPU rasterization, very compact

### Chunked Systems (Minecraft, Terraria)

**Storage:**
```typescript
world = {
  chunks: Map<ChunkCoord, Chunk>  // Only loaded chunks in memory
}

chunk = {
  blocks: number[16][16][16],  // 16³ blocks per chunk
  position: {x, y, z}
}
```

**Memory:** Only active chunks loaded (~4-16KB per chunk)
**Performance:** Spatial locality, only process nearby chunks, easy streaming

## Better Approaches for This System

### Option 1: Blob Objects (Minimal Refactor)

**Storage:**
```typescript
worldData = {
  "paintblob_uuid1": {
    type: 'paint-blob',
    color: '#ff0000',
    bounds: {minX: 10, maxX: 50, minY: 20, maxY: 30},
    cells: Set<string>(['10,20', '11,20', '12,20', ...])  // or compact encoding
  }
}
```

**Pros:**
- ✅ Single lookup per blob (no flood-fill)
- ✅ No redundant data
- ✅ Persistent blob identity
- ✅ Easy metadata (name, layer, opacity)
- ✅ Resize = transform single object

**Cons:**
- ❌ Still storing coordinates as strings
- ❌ Set may use more memory than bitmap
- ❌ Needs migration code for existing data

**Memory:** ~20 bytes + (8 bytes × cell count)

### Option 2: Bitmap Storage (Best Balance)

**Storage:**
```typescript
worldData = {
  "paintblob_uuid1": {
    type: 'paint-blob',
    color: '#ff0000',
    startX: 10,
    startY: 20,
    width: 40,
    height: 10,
    bitmap: boolean[][] // or bit-packed array for 8x less memory
  }
}
```

**Pros:**
- ✅ Most compact (1 bit per cell if bit-packed)
- ✅ Fast iteration (linear scan)
- ✅ Standard image operations (scale, rotate, flip)
- ✅ Easy collision detection
- ✅ Can use established algorithms (bresenham, flood-fill, etc.)

**Cons:**
- ❌ Stores empty space (sparse blobs waste memory)
- ❌ Needs bitmap manipulation code

**Memory:** 1 bit per cell (bit-packed) or 1 byte per cell (boolean array)

### Option 3: ImageData/Canvas (Industry Standard)

**Storage:**
```typescript
worldData = {
  "paintblob_uuid1": {
    type: 'paint-blob',
    startX: 10,
    startY: 20,
    imageData: ImageData  // Native browser format (Uint8ClampedArray)
    // OR store base64 PNG for serialization:
    // pngData: "data:image/png;base64,..."
  }
}
```

**Pros:**
- ✅ Native browser support
- ✅ Can use Canvas 2D API directly
- ✅ GPU-accelerated rendering
- ✅ Supports alpha/transparency
- ✅ Export to image formats (PNG, JPEG) trivial

**Cons:**
- ❌ Fixed to 4 bytes per pixel (RGBA)
- ❌ More memory than bitmap for single-color blobs
- ❌ Serialization more complex (need base64 or binary)

**Memory:** 4 bytes per pixel (RGBA)

### Option 4: Hybrid (Sparse Representation)

**Storage:**
```typescript
worldData = {
  "paintblob_uuid1": {
    type: 'paint-blob',
    color: '#ff0000',
    bounds: {minX: 10, maxX: 50, minY: 20, maxY: 30},
    // Run-length encoding: each row stores runs of painted cells
    rows: {
      20: [[10, 15], [20, 25]],  // Row 20: cells 10-15 and 20-25 painted
      21: [[10, 30]],             // Row 21: cells 10-30 painted
      // ...
    }
  }
}
```

**Pros:**
- ✅ Efficient for sparse blobs
- ✅ Efficient for filled blobs
- ✅ Compact encoding

**Cons:**
- ❌ More complex algorithms
- ❌ Not a standard format

**Memory:** ~16 bytes per run (varies by blob shape)

## Migration Strategy: Ensuring No Adverse Changes

### Critical Requirement: Zero Behavioral Changes

The refactor must be **completely transparent** to the user. All existing functionality must work identically:

1. **Visual appearance**: Paint must look pixel-perfect identical
2. **Note interactions**: Paint mode, wrap mode must behave exactly the same
3. **Paint tools**: Brush, eraser, lasso produce same results
4. **Selection/resize**: Same interaction patterns
5. **Backward compatibility**: Old saves must load correctly
6. **Forward compatibility**: New saves should degrade gracefully in old versions

### Compatibility Matrix

| Operation | Individual Cells (Current) | Blob Objects (New) | Must Preserve |
|-----------|---------------------------|-------------------|---------------|
| **Rendering** | Iterate cells, draw each | Iterate blob.cells, draw each | ✅ Identical visual output |
| **Paint mode (note)** | Scan for `paint_${x}_${y}` | Check blob.cells.has(`${x},${y}`) | ✅ Same viewport masking |
| **Wrap mode (note)** | `getPaintBoundsAtY()` scans cells | Same function, check blob.cells | ✅ Same text wrapping |
| **Selection** | Flood-fill from clicked cell | Return blob directly | ✅ Same selection behavior |
| **Resize** | Scale each cell individually | Scale blob.cells en masse | ✅ Same visual result |
| **Paint tool** | Create individual `paint_${x}_${y}` | Add to blob.cells | ✅ Same painting behavior |
| **Serialization** | Each cell in JSON | Single blob in JSON | ⚠️ Different format (migration needed) |

### Dual-Format Support Strategy

To ensure zero adverse changes, implement **dual-format read/write** during migration:

#### Phase 1: Read Both Formats (Backward Compatible)

```typescript
// On world load: Check for both formats
function loadPaint(worldData: WorldData): PaintBlob[] {
  const blobs: PaintBlob[] = [];

  // 1. Load new format (blob objects)
  for (const [key, value] of Object.entries(worldData)) {
    if (key.startsWith('paintblob_')) {
      blobs.push(JSON.parse(value as string));
    }
  }

  // 2. Load old format (individual cells) - AUTO-MIGRATE
  const orphanedCells = findOrphanedPaintCells(worldData); // Cells not in any blob
  if (orphanedCells.length > 0) {
    const migratedBlobs = groupCellsIntoBlobs(orphanedCells); // Flood-fill grouping
    blobs.push(...migratedBlobs);

    // Optional: Write migrated blobs back to worldData immediately
    for (const blob of migratedBlobs) {
      worldData[`paintblob_${blob.id}`] = JSON.stringify(blob);
    }
  }

  return blobs;
}
```

#### Phase 2: Write Only New Format (But Keep Read Support)

```typescript
// Paint tool writes to blob format
function paintCell(x: number, y: number, color: string) {
  // Find existing blob at this location or adjacent
  const adjacentBlob = findAdjacentBlob(x, y, color);

  if (adjacentBlob) {
    // Add to existing blob
    adjacentBlob.cells.add(`${x},${y}`);
    updateBlobBounds(adjacentBlob, x, y);
    worldData[`paintblob_${adjacentBlob.id}`] = JSON.stringify(adjacentBlob);
  } else {
    // Create new blob
    const newBlob = createBlob(x, y, color);
    worldData[`paintblob_${newBlob.id}`] = JSON.stringify(newBlob);
  }

  // DO NOT write individual paint_${x}_${y} cells anymore
}
```

#### Phase 3: Deprecate Old Format (After Sufficient Migration Period)

```typescript
// Remove old cell support after e.g. 6 months
function loadPaint(worldData: WorldData): PaintBlob[] {
  const blobs: PaintBlob[] = [];

  for (const [key, value] of Object.entries(worldData)) {
    if (key.startsWith('paintblob_')) {
      blobs.push(JSON.parse(value as string));
    }
  }

  // No longer check for individual cells - assume all migrated
  return blobs;
}
```

### Testing Strategy: Ensuring Identical Behavior

Before deploying blob format, create **comprehensive test suite**:

#### 1. Visual Regression Tests
```typescript
test('Paint rendering: individual cells vs blob format', () => {
  // Render same paint data in both formats
  const cellBasedCanvas = renderPaintCells(oldFormatData);
  const blobBasedCanvas = renderPaintBlobs(newFormatData);

  // Pixel-perfect comparison
  expect(cellBasedCanvas.toDataURL()).toBe(blobBasedCanvas.toDataURL());
});
```

#### 2. Interaction Tests
```typescript
test('Paint mode viewport masking: identical behavior', () => {
  const oldResult = renderNoteWithPaintMode(oldFormatData);
  const newResult = renderNoteWithPaintMode(newFormatData);

  expect(oldResult).toEqual(newResult);
});

test('Wrap mode text flow: identical behavior', () => {
  const oldWrapped = rewrapNoteText(noteData, oldFormatWorldData);
  const newWrapped = rewrapNoteText(noteData, newFormatWorldData);

  expect(oldWrapped).toEqual(newWrapped);
});
```

#### 3. Migration Tests
```typescript
test('Old saves load correctly and auto-migrate', () => {
  // Load old format save file
  const worldData = loadSaveFile('old-format-save.json');

  // Should auto-detect individual cells and convert to blobs
  const blobs = loadPaint(worldData);

  // Verify blobs match original cells
  for (const blob of blobs) {
    for (const cellKey of blob.cells) {
      const [x, y] = cellKey.split(',').map(Number);
      const oldCellKey = `paint_${x}_${y}`;
      expect(worldData[oldCellKey]).toBeDefined(); // Original cell exists
    }
  }
});
```

#### 4. Round-Trip Tests
```typescript
test('Save → Load → Save produces identical data', () => {
  const originalData = createTestPaintBlobs();
  const savedData = serialize(originalData);
  const loadedData = deserialize(savedData);
  const resavedData = serialize(loadedData);

  expect(resavedData).toBe(savedData); // Bit-identical
});
```

### Abstraction Layer: Isolate Paint Access

Create **abstraction functions** that work with both formats internally:

```typescript
// Abstraction layer hides format details
class PaintStorage {
  // Check if cell is painted (works with both formats)
  static isPainted(worldData: WorldData, x: number, y: number): boolean {
    // Check new format first (faster)
    for (const [key, value] of Object.entries(worldData)) {
      if (key.startsWith('paintblob_')) {
        const blob = JSON.parse(value as string);
        if (blob.cells.has(`${x},${y}`)) return true;
      }
    }

    // Fallback: check old format
    return !!worldData[`paint_${x}_${y}`];
  }

  // Get paint color at cell (works with both formats)
  static getColorAt(worldData: WorldData, x: number, y: number): string | null {
    // Check new format
    for (const [key, value] of Object.entries(worldData)) {
      if (key.startsWith('paintblob_')) {
        const blob = JSON.parse(value as string);
        if (blob.cells.has(`${x},${y}`)) return blob.color;
      }
    }

    // Fallback: check old format
    const oldCell = worldData[`paint_${x}_${y}`];
    if (oldCell) {
      const data = JSON.parse(oldCell as string);
      return data.color;
    }

    return null;
  }
}

// Usage in note rendering code
if (PaintStorage.isPainted(worldData, x, y)) {
  // Render paint (identical behavior regardless of format)
}
```

### Rollback Plan

If issues are discovered after deployment:

1. **Immediate rollback**: Revert to individual cells format
2. **Hybrid mode**: Keep both formats in parallel (write to both)
3. **Gradual migration**: Only migrate blobs on user action (paint, resize)
4. **Manual migration**: Provide `/migrate-paint` command for opt-in

### Validation Checklist Before Deployment

- [ ] All existing paint renders identically (pixel-perfect comparison)
- [ ] Paint mode viewport masking works exactly the same
- [ ] Wrap mode text flow unchanged
- [ ] Paint tools (brush, eraser, lasso) produce same results
- [ ] Selection behavior identical
- [ ] Resize behavior identical
- [ ] Old saves load correctly and auto-migrate
- [ ] New saves can be loaded (forward compatibility)
- [ ] Performance same or better (measure render time, memory)
- [ ] No console errors or warnings
- [ ] Comprehensive test suite passes (100% coverage)
- [ ] Deployed to staging for 1 week of testing
- [ ] Rollback plan tested and documented

## Recommended Refactor Path

### Phase 1: Blob Objects (Low Risk)
1. Implement abstraction layer (`PaintStorage` class)
2. Add dual-format read support (both cells and blobs)
3. Add auto-migration on load (cells → blobs)
4. Update paint tool to write blob format (but keep cell format for 1 version)
5. Deploy with extensive logging and monitoring
6. Verify no adverse changes in production

### Phase 2: Bitmap Storage (Medium Risk)
1. Change blob internal storage from Set to bitmap
2. Implement bitmap scaling algorithms (nearest-neighbor, bilinear)
3. Add bitmap-based flood-fill, collision detection
4. Keep abstraction layer API identical

### Phase 3: Optimization (Optional)
1. Spatial indexing (quadtree) for fast blob lookup
2. Chunk-based system for large worlds
3. Lazy blob reconstruction (only when needed)

## Performance Comparison

| Operation | Current | Blob Object | Bitmap | ImageData |
|-----------|---------|-------------|--------|-----------|
| **Select blob** | O(n) flood-fill | O(1) lookup | O(1) lookup | O(1) lookup |
| **Resize 100 cells** | ~100ms (delete+create) | ~10ms (transform) | ~5ms (bitmap scale) | ~2ms (GPU) |
| **Memory (100 cells)** | ~5.5KB | ~1KB | ~13 bytes (bit-packed) | ~400 bytes (RGBA) |
| **Render blob** | O(n) cell iteration | O(n) cell iteration | O(w×h) bitmap scan | O(1) drawImage |

## Lessons Learned

1. **Cell-based storage is convenient but inefficient**: Easy to implement initially, but doesn't scale
2. **Flood-fill every selection is wasteful**: Should cache blob boundaries or store as objects
3. **Industry uses bitmaps or textures**: For good reason - compact, fast, well-understood algorithms
4. **Refactoring data structures is hard**: Need migration path, backwards compatibility
5. **Prototyping vs Production**: Current approach fine for prototyping, would need refactor for real game

## Open Questions

1. **Migration strategy**: How to convert existing individual cells to blobs without breaking saves?
2. **Blob merging**: If two blobs touch, should they auto-merge? Or stay separate?
3. **Layers**: Should paint blobs support layers (like Photoshop)?
4. **Compression**: For large bitmaps, should we use PNG compression for serialization?
5. **Undo/redo**: How to efficiently track blob changes for undo system?

## Next Steps (If We Refactor)

- [ ] Design blob object schema
- [ ] Implement blob creation/deletion
- [ ] Migrate paint tool to use blobs
- [ ] Add blob-to-bitmap conversion
- [ ] Implement bitmap scaling algorithms
- [ ] Add spatial indexing for blob lookup
- [ ] Write migration code for existing data
- [ ] Performance benchmarks (before/after)

## References

- [Terraria world file format](https://terraria.wiki.gg/wiki/World_file_format) - RLE encoding for tiles
- [Aseprite file format](https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md) - Cel/layer architecture
- [Minecraft chunk format](https://minecraft.fandom.com/wiki/Chunk_format) - 16×16×384 chunk storage
- [Canvas ImageData API](https://developer.mozilla.org/en-US/docs/Web/API/ImageData) - Browser-native pixel manipulation
- [Run-length encoding](https://en.wikipedia.org/wiki/Run-length_encoding) - Compression for sparse/repetitive data

---

**Status**: Paint resize works, but storage inefficiency noted for future optimization.
