# Nara System Survey
**Ethnographic survey of available methods, commands, and contexts**

Generated: 2025-11-11

---

## File Structure

### Core Engine Files
- **world.engine.ts** - Main world engine hook, command processing, state management
- **world.save.ts** - Firebase persistence layer, autosave, multiplayer cursors
- **bit.canvas.tsx** - Main rendering canvas, note rendering, visual effects

### Command & Interaction
- **commands.ts** - Command system, execution logic, command categories
- **controllers.ts** - Input controllers (keyboard, mouse, touch)
- **canvas.inputs.tsx** - Canvas input handling components
- **canvas.buttons.tsx** - Button regions and interactions

### AI & Generation
- **ai.ts** - AI client integration (Google GenAI)
- **ai.utils.ts** - AI utilities (abort control, dialogue helpers)
- **host.dialogue.ts** - Conversational host system
- **host.flows.ts** - Flow definitions (welcome, tutorial, upgrade, etc.)
- **dialogue.tsx** - Dialogue component wrapper
- **dialogue.display.ts** - Dialogue rendering styles (subtitle, host)

### Visual Systems
- **monogram.ts** - Monogram rendering modes (nara, perlin, geometry3d, face3d, road)
- **face.ts** - Face detection via MediaPipe
- **face.debug.tsx** - Face detection debug overlay
- **mask.ts** - Face mask definitions (Macintosh, Chibi, Robot, Kawaii)
- **canvas.bg.tsx** - Background rendering component
- **canvas.grid3d.tsx** - 3D grid rendering
- **shaders.ts** - WebGL shader utilities

### Content Processing
- **bit.blocks.ts** - Text block detection, clustering, smart indentation
- **image.bitmap.ts** - Image to bitmap conversion, SVG generation
- **gif.parser.ts** - GIF parsing and frame extraction
- **utils.latex.ts** - LaTeX rendering
- **utils.SMILES.ts** - Chemical structure rendering

### UI & Display
- **bit.home.tsx** - Home canvas component
- **intro.ts** - Intro configuration (backgrounds, monograms)
- **settings.ts** - User settings management
- **styles.ts** - Style utilities
- **tape.ts** - Recording/replay system

### Utilities
- **logger.ts** - Logging utilities

---

## Commands

### Navigation & View
- **nav** - Toggle navigation overlay (minimap)
- **zoom** - Zoom in by 30%
- **spawn** - Set spawn point at cursor
- **full** - Toggle fullscreen mode for bounds/lists at cursor

### Content Creation
- **label** - Create labeled region
- **bound** - Create bounded region (note with contentType='bound')
- **unbound** - Remove bound at cursor
- **list** - Create list region (note with contentType='list')
- **unlist** - Remove list at cursor
- **glitch** - Create glitch effect region (note with contentType='glitch')
- **task** - Create task region
- **link** - Create link
- **upload** - Upload image to note region or create new image note

### AI & Chat
- **chat** - Enter chat mode for AI conversation
- **ai-chat** - Direct AI chat without mode switch
- **explain** - AI explains selected text
- **summarize** - AI summarizes selected text
- **latex** - Toggle LaTeX rendering mode
- **smiles** - Toggle SMILES chemical structure mode

### Visual & Background
- **bg** - Change background color/mode
- **margin** - Toggle margin mode
- **cam** - Toggle camera/webcam background
- **monogram** - Control monogram display

### Organization
- **cluster** - Auto-label text clusters
- **frames** - Toggle hierarchical frames
- **map** - Toggle map mode

### State & Persistence
- **state --rm <key>** - Remove state snapshot
- **state --mv <old> <new>** - Rename state snapshot
- **publish** - Publish current state
- **unpublish** - Unpublish state
- **share** - Share current state

### Utilities
- **clear** - Clear entire canvas
- **replay** - Replay command history
- **clip** - Clipboard operations
- **signin** - Sign in
- **signout** - Sign out
- **agent** - Toggle AI agent

---

## Content Types (Note Architecture)

All region-spanning objects now use `note_*` keys with a `contentType` field:

### Available ContentTypes
- **text** - Plain text note (default for pattern generation)
- **image** - Image container note
- **iframe** - Embedded iframe content
- **mail** - Mail/message content
- **bound** - Bounded region (replaces legacy `bound_*`)
- **glitch** - Glitch effect region (replaces legacy `glitched_*`)
- **list** - List container with scrolling

### Note Data Structure
```typescript
{
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  timestamp: number;
  contentType: 'text' | 'image' | 'iframe' | 'mail' | 'bound' | 'glitch' | 'list';
  patternKey?: string; // For pattern-generated notes
  imageData?: ImageData; // For image notes
  content?: any; // Type-specific content
}
```

---

## Host Flows

Conversational onboarding flows defined in `host.flows.ts`:

### Available Flows
1. **introFlow** - Shows NARA banner animation
2. **welcomeFlow** - Greets user, explains Nara, collects email
3. **verificationFlow** - Email verification process
4. **upgradeFlow** - Membership upgrade prompt
5. **tutorialFlow** - Interactive tutorial teaching commands
6. **passwordResetFlow** - Password reset flow

### Flow Features
- Sequential message progression
- Input validation (email, username, password)
- Choice-based branching
- Command validation for tutorial
- Monogram and background control per message
- Spawned content for exploration

---

## Monogram Modes

Visual patterns rendered in the background:

- **nara** - NARA text pattern
- **perlin** - Perlin noise
- **geometry3d** - 3D geometry (cube, tetrahedron, octahedron, sphere, torus)
- **face3d** - 3D face rendering with mask
- **road** - Procedural road pattern
- **clear** - Clear monogram
- **macintosh** - Retro Mac pattern
- **loading** - Loading pattern
- **terrain** - Terrain pattern

---

## Background Modes

- **transparent** - Transparent background
- **color** - Solid color background
- **image** - Static image background
- **video** - Video background
- **space** - Space/starfield background
- **stream** - Camera/webcam stream background

---

## Face Detection System

### Masks
- **MacintoshMask** - Retro Mac style
- **ChibiMask** - Chibi anime style
- **RobotMask** - Robot/mechanical style
- **KawaiiMask** - Kawaii cute style

### Features
- MediaPipe face landmark detection
- Face orientation tracking
- Smooth interpolation
- 3D rotation mapping
- Expression data (smile, eyebrow raise, etc.)

---

## Rendering Contexts

### Text Rendering Layers
1. **worldData** - Persistent world text/characters
2. **commandData** - Command input text
3. **chatData** - AI chat responses
4. **suggestionData** - Autocomplete suggestions
5. **lightModeData** - Ephemeral/staged text (cleared with Escape)
6. **searchData** - Search result highlights
7. **hostData** - Host dialogue messages

### Note Rendering
- Unified rendering through `note_*` keys
- Content-aware rendering based on `contentType`
- Image notes render with GIF animation support
- List notes render with scrolling
- Bound notes render with top/bottom bars
- Glitch notes render with visual distortion

### Special Rendering
- **Blocks** - Detected text blocks for smart operations
- **Labels** - Cluster labels for organization
- **Frames** - Hierarchical frame borders
- **Selection** - Visual selection highlighting
- **Cursor** - Local and multiplayer cursors
- **Clipboard** - Clipboard item indicators
- **Navigation** - Minimap overlay

---

## Key Interfaces

### WorldEngine
Main engine interface exposing:
- State (worldData, cursorPos, viewOffset, zoomLevel)
- Commands (commandSystem, commandState)
- Rendering layers (chatData, lightModeData, etc.)
- Settings (backgroundColor, textColor, fontFamily)
- Utilities (screenToWorld, worldToScreen)
- Event handlers (handleCanvasClick, handleCanvasWheel, handleKeyPress)

### CommandState
Command system state:
- currentCommand
- commandArgs
- commandInput
- suggestions
- commandHistory
- isExecuting

### WorldSettings
User preferences:
- fontFamily
- autoSave
- spawnPoint
- membership
- etc.

---

## Data Flow

### Input Processing
1. **Raw Input** → controllers.ts
2. **Key Events** → world.engine.ts handleKeyPress
3. **Command Parsing** → commands.ts
4. **Command Execution** → world.engine.ts command handlers
5. **State Update** → React setState
6. **Render** → bit.canvas.tsx

### Persistence
1. **State Changes** → world.engine.ts
2. **Debounced Save** → world.save.ts
3. **Firebase Write** → Firebase Realtime Database
4. **Cloud Storage** → Firebase Storage (for images)

### Multiplayer
1. **Cursor Updates** → Firebase /cursors/<worldId>/<userId>
2. **Listener** → world.save.ts onValue
3. **State Update** → multiplayerCursors
4. **Render** → bit.canvas.tsx

---

## Pattern Generation (BSP)

Pattern command generates rectangular note regions using Binary Space Partitioning:
- Creates `note_*` keys with `contentType: 'text'`
- Includes `patternKey` reference
- Stores pattern metadata in `pattern_*` key

---

## Image Handling

### Upload Flow
1. User calls `/upload` command
2. Check if cursor is inside existing note → update that note
3. Otherwise, create new note with selection bounds
4. Image uploaded to Firebase Storage
5. Note updated with `contentType: 'image'` and imageData

### GIF Support
- GIF parsing via gifuct-js
- Frame extraction to individual images
- Animation timing stored in imageData
- Frame cycling in render loop

---

## Smart Features

### Block Detection
- Horizontal gap analysis
- Text cluster grouping
- Distance-based clustering
- Hierarchical frame generation

### Smart Indentation
- Detects indentation level of previous lines
- Auto-indents on Enter key

### Word Deletion
- Ctrl+Backspace deletes entire words
- Block-aware deletion

---

## Architecture Decisions

### Note-Centric Design
All region-spanning objects now unified under `note_*` keys with `contentType` field. This provides:
- Single rendering pipeline
- Consistent data structure
- Easy extensibility
- Simplified codebase

### Legacy Systems Removed
- Staged image system (stagedImageData)
- Stage command and template parser
- Glitched region blocking
- Separate bound/glitched rendering

**The note block reigns true.**

---

## Future Considerations

Areas for potential exploration or expansion:
1. Additional contentTypes for notes
2. More mask styles for face detection
3. Additional monogram modes
4. Command aliases and shortcuts
5. Collaborative editing features
6. Export/import formats
7. Plugin/extension system
