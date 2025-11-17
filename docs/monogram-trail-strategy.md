# Monogram Trail Strategy

## Problem Statement

Mouse and touch inputs are fundamentally different interaction paradigms that require separate trail handling:

- **Mouse**: Has hover state, points at absolute world positions, used for precise interaction
- **Touch**: Always triggers pan, gesture-based, no hover state, used for navigation

Current implementation tries to handle both with the same world-space coordinate system, causing:
- Discontinuities when switching between modes
- Long/messy trails during pan operations
- Conflation of navigation (pan) with interaction (trails)

## Architectural Approach

### Separate Trail Systems

Create two independent trail subsystems within the monogram:

```
┌─────────────────────────────────────┐
│      Monogram System (GPU)          │
│                                     │
│  ┌─────────────┐  ┌──────────────┐ │
│  │ Mouse Trail │  │ Touch Trail  │ │
│  │ (World-space)│  │(Screen-space)│ │
│  └─────────────┘  └──────────────┘ │
│                                     │
│     Combined Sampling & Rendering   │
└─────────────────────────────────────┘
```

### Coordinate Space Handling

#### Mouse Trails (World-space)
```javascript
// Absolute world position via viewport transformation
const worldPos = engine.screenToWorld(
  mouseScreenX,
  mouseScreenY,
  engine.zoomLevel,
  engine.viewOffset  // Current viewport offset
);

mouseMonogram.updateMousePosition(worldPos);
```

**Characteristics:**
- Tracks absolute world coordinates
- Only active during hover (not during pan)
- Moves with viewport when panning
- Represents "where are you pointing?"

#### Touch Trails (Screen-space / Stationary)
```javascript
// Stationary grid coordinates (no viewport offset)
const stationaryPos = {
  x: touchScreenX / engine.zoomLevel,
  y: touchScreenY / engine.zoomLevel
};

touchMonogram.updateMousePosition(stationaryPos);
```

**Characteristics:**
- Tracks gesture motion in stationary coordinate system
- Active during touch drag/pan
- Stays pinned to screen while world moves underneath
- Represents "what gesture are you making?"

## Rendering Strategy

### Unified CPU Projection

Both trail systems feed into a single monogram pattern on the GPU:

1. **Mouse trails**: Already in world-space, pass through directly
2. **Touch trails**: In stationary screen-space, projected to world-space at render time

```javascript
// Pseudocode for unified rendering
function projectTrailsForRendering(mouseTrails, touchTrails, currentViewOffset) {
  const unifiedTrails = [];

  // Mouse trails: already in world-space
  unifiedTrails.push(...mouseTrails);

  // Touch trails: project from stationary to current world position
  for (const touchTrail of touchTrails) {
    const worldPos = {
      x: touchTrail.x + currentViewOffset.x,
      y: touchTrail.y + currentViewOffset.y
    };
    unifiedTrails.push(worldPos);
  }

  return unifiedTrails; // Flat projection for GPU
}
```

### Visual Behavior

**Mouse trails:**
- ✓ Visible during hover
- ✗ Not visible during middle-mouse pan
- Paint at absolute world locations
- Stay fixed in world as you pan away

**Touch trails:**
- ✓ Visible during touch drag/pan
- Paint in screen-space (gesture pattern)
- Stay fixed in screen position as world moves underneath
- Create "drawing on glass" effect over the moving world

## Implementation Plan

### Phase 1: Separate Trail Data Structures
- [ ] Add `mouseTrail` and `touchTrail` arrays to monogram state
- [ ] Add coordinate space metadata to trail points
- [ ] Update trail buffer to handle dual coordinate systems

### Phase 2: Input Handlers
- [ ] Mouse hover: feed world-space coords to mouse trail
- [ ] Mouse pan: disable mouse trail updates
- [ ] Touch drag: feed screen-space coords to touch trail
- [ ] Clear trails appropriately on mode transitions

### Phase 3: Unified Projection & Rendering
- [ ] Implement `projectTrailsForRendering()` function
- [ ] Update GPU trail buffer upload to handle projected coords
- [ ] Ensure proper blending of both trail types in shader

### Phase 4: Polish & Tuning
- [ ] Adjust fade times per trail type
- [ ] Tune movement thresholds
- [ ] Test visual consistency across zoom levels
- [ ] Optimize performance with many trail points

## Key Invariants

1. **Mouse trails** only update during hover (not pan)
2. **Touch trails** only update during touch drag/pan
3. **No mixing** of coordinate systems at input time
4. **Flat projection** on CPU before GPU sampling
5. **Single unified pattern** rendered by GPU

## Success Criteria

- [x] Mouse hover trails work smoothly (already achieved)
- [ ] Touch drag creates smooth gesture trails in screen-space
- [ ] No visual discontinuities when switching input modes
- [ ] Trails don't interfere with navigation (pan) operations
- [ ] Performance stays consistent with 60fps target

## Open Questions

1. Should touch trails fade faster than mouse trails?
2. How long should touch trails persist after gesture ends?
3. Should we visualize trail coordinate space boundaries for debugging?
4. Do we need a third mode for stylus/pen input?

## References

- Original working implementation: Mouse hover trails (bit.canvas.tsx:6330-6334)
- Previous failed approach: Pan trail with anchor/delta (removed in commit 8a63de7)
- Monogram system: app/bitworld/monogram.ts
