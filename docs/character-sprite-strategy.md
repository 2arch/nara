# Character Sprite Cursor Strategy

## Overview

The `/be` command transforms the standard block cursor into an animated character sprite that responds to user movement. This document covers the current implementation and the planned integration with Pixellab's MCP server for dynamic sprite generation.

---

## Phase 1: Static Sprite System (Current)

### Implementation

The current system uses pre-made sprite sheets (Mudkip) with the following architecture:

```
User types /be
    ↓
Toggle isCharacterEnabled in ModeState
    ↓
Canvas renders sprite instead of rectangle cursor
    ↓
Movement detection updates direction + triggers walk animation
    ↓
Idle timeout (300ms) transitions to idle animation
```

### Files Modified

| File | Changes |
|------|---------|
| `commands.ts` | Added `isCharacterEnabled` to ModeState, `/be` command handler |
| `world.engine.ts` | Added `isCharacterEnabled` to WorldEngine interface |
| `bit.canvas.tsx` | Sprite loading, direction detection, animation intervals, rendering |
| `public/` | `mudkip_walk.png`, `mudkip_idle.png` sprite sheets |

### Sprite Sheet Format

**Walk Sprite (`mudkip_walk.png`):**
- Dimensions: 192×320 pixels
- Frame size: 32×40 pixels
- Layout: 6 columns (frames) × 8 rows (directions)
- Directions: 0=down, 2=right, 4=up, 6=left (even numbers = cardinal, odd = diagonal)

**Idle Sprite (`mudkip_idle.png`):**
- Dimensions: 168×320 pixels
- Frame size: 24×40 pixels
- Layout: 7 columns (frames) × 8 rows (directions)

### Animation State Machine

```
                    ┌─────────────┐
                    │   IDLE      │
                    │ (7 frames)  │
                    └──────┬──────┘
                           │
            cursor moves   │   no movement for 300ms
            ───────────────┼───────────────────────
                           │   (waits for walk cycle to complete)
                           ↓
                    ┌─────────────┐
                    │  WALKING    │
                    │ (6 frames)  │
                    └─────────────┘
```

### Direction Detection

```typescript
// Maps cursor delta to 8 directions
dx > 0, dy = 0  → direction 2 (right)
dx < 0, dy = 0  → direction 6 (left)
dx = 0, dy > 0  → direction 0 (down)
dx = 0, dy < 0  → direction 4 (up)
diagonal        → prefer axis with larger delta
```

### Rendering Integration

The sprite scales to fit the cursor's current dimensions (`cursorScale.w × cursorScale.h`), maintaining aspect ratio. When character mode is enabled:
- Cursor trail is hidden
- Rectangle cursor replaced with `ctx.drawImage()` call
- Sprite centered within cursor bounds

---

## Phase 2: Dynamic Sprite Generation (Planned)

### Concept

Extend `/be` to accept a prompt parameter:

```
/be wizard        → generates wizard sprite via Pixellab
/be robot         → generates robot sprite via Pixellab
/be               → toggles current sprite on/off (existing behavior)
```

### Pixellab MCP Integration

**Setup (completed):**
```bash
claude mcp add pixellab https://api.pixellab.ai/mcp -t http -H "Authorization: Bearer <API_KEY>"
```

**Relevant Pixellab Tools:**

| Tool | Purpose |
|------|---------|
| `create_character` | Generate character with 4/8 directional views |
| `animate_character` | Add walk/run/idle animations |

**Example Flow:**
```
User: /be knight

1. Parse command → extract "knight" as prompt
2. Call Pixellab MCP:
   - create_character(description="knight", n_directions=8)
   - animate_character(character_id, animation="walk")
   - animate_character(character_id, animation="idle")
3. Download generated sprite sheets
4. Store in memory or cache
5. Update current character sprite
6. Enable character mode
```

### Architecture Changes Required

```typescript
// commands.ts - Extended command parsing
if (commandToExecute.startsWith('be')) {
    const prompt = commandToExecute.slice(3).trim();
    if (prompt) {
        // Phase 2: Generate sprite via Pixellab
        return executeCharacterGeneration(prompt);
    } else {
        // Phase 1: Toggle existing sprite
        return executeToggleModeCommand('isCharacterEnabled', ...);
    }
}

// New state for dynamic sprites
interface ModeState {
    isCharacterEnabled: boolean;
    currentCharacterSprite?: {
        walkSheet: HTMLImageElement;
        idleSheet: HTMLImageElement;
        frameWidth: number;
        idleFrameWidth: number;
        frameHeight: number;
        framesPerDirection: number;
        idleFramesPerDirection: number;
    };
}
```

### Sprite Caching Strategy

```
/nara
├── public/
│   ├── sprites/
│   │   ├── default/           # Built-in sprites (mudkip)
│   │   │   ├── walk.png
│   │   │   └── idle.png
│   │   └── generated/         # Pixellab-generated (cached)
│   │       ├── wizard_walk.png
│   │       ├── wizard_idle.png
│   │       └── manifest.json  # Maps prompts → sprite files
```

### API Route (if needed)

For server-side Pixellab calls:

```typescript
// app/api/generate-sprite/route.ts
export async function POST(req: Request) {
    const { prompt } = await req.json();

    // Call Pixellab API
    const character = await pixellab.createCharacter({
        description: prompt,
        n_directions: 8
    });

    const walkAnim = await pixellab.animateCharacter({
        character_id: character.id,
        animation: 'walk'
    });

    const idleAnim = await pixellab.animateCharacter({
        character_id: character.id,
        animation: 'idle'
    });

    return Response.json({
        walkSheet: walkAnim.sprite_url,
        idleSheet: idleAnim.sprite_url
    });
}
```

---

## Phase 3: Sprite Library (Future)

### Concept

Build a library of generated sprites that users can browse and select:

```
/be library      → opens sprite picker UI
/be save wizard  → saves current generated sprite permanently
/be list         → shows saved sprites
```

### Persistence

Store sprite metadata in Firebase alongside world data:

```typescript
interface UserSprites {
    [spriteId: string]: {
        name: string;
        prompt: string;
        walkSheetUrl: string;
        idleSheetUrl: string;
        createdAt: number;
    }
}
```

---

## Technical Considerations

### Performance

- Sprite sheets loaded once, cached in component state
- Animation uses `setInterval` (100ms) - consider `requestAnimationFrame` for smoother animation
- Direction detection runs on every cursor position change

### Pixellab Constraints

- Assets auto-delete after 8 hours (need to cache/persist)
- API rate limits may apply
- Generation time ~2-5 seconds per sprite

### Sprite Format Compatibility

Pixellab generates sprites that may differ from Mudkip format:
- Different frame dimensions
- Different frame counts
- Need to normalize or store metadata per sprite

---

## Environment Variables

```bash
# .env.local
PIXELLAB_API_KEY=9bb378e0-6b46-442d-9019-96216f8e8ba7
```

---

## References

- Pixellab MCP Docs: https://api.pixellab.ai/mcp/docs
- Pixellab Setup: https://www.pixellab.ai/mcp
- Original implementation commit: `71ad996`
