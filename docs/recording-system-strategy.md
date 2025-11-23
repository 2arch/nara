# Recording System Strategy

## Overview

The recording system in Nara captures and replays user sessions including cursor movement, viewport changes, face tracking data, and content modifications (character placement/deletion). This enables users to record their creative process and play it back in real-time.

## Architecture

### Core Components

1. **DataRecorder** (`app/bitworld/recorder.ts`)
   - Central recording/playback engine
   - Manages recording sessions and frame capture
   - Handles content change tracking

2. **Command Interface** (`app/bitworld/commands.ts`)
   - User-facing commands: `/record start`, `/record stop`, `/record play`, `/record save`, `/record load`
   - Bridges user actions to recorder functionality

3. **Integration Points**
   - **Render Loop** (`bit.canvas.tsx:6278`) - Captures frames during recording, applies frames during playback
   - **Input Handler** (`world.engine.ts:9434, 9443, 10578, 10614`) - Records content changes on keydown/delete

## Data Model

### FrameData
Captures visual state at each frame:
```typescript
{
    timestamp: number;           // ms since recording start
    face?: {                     // Optional face tracking data
        rotX, rotY, rotZ: number;
        mouthOpen?: number;
        leftEyeBlink?: number;
        rightEyeBlink?: number;
        isTracked?: boolean;
    };
    cursor: Point;               // Cursor position
    viewOffset: Point;           // Camera pan position
    zoomLevel: number;           // Camera zoom level
}
```

### ContentChange
Tracks world data modifications:
```typescript
{
    timestamp: number;           // ms since recording start
    key: string;                 // Grid coordinate (e.g., "100,200")
    value: any;                  // Character data or null for deletion
}
```

### RecordingSession
Complete recording package:
```typescript
{
    name: string;                // Recording identifier
    startTime: number;           // Unix timestamp
    duration: number;            // Total duration in ms
    frames: FrameData[];         // Visual state frames
    contentChanges: ContentChange[];  // World data modifications
}
```

## Command Flow

### `/record start`
**File**: `commands.ts:2276-2278`

1. User types `/record start`
2. Command parser extracts action: `'start'`
3. Calls `recorder.start()`
4. Initializes empty frame/contentChange arrays
5. Sets `startTime = Date.now()`
6. Sets `isRecording = true`
7. Dialogue confirms: "Recording started..."

**Capture Loop** (runs every frame while recording):
- **Visual State**: Render loop calls `recorder.capture(engine)` → captures frame data
- **Content Changes**: Input handlers call `recorder.recordContentChange(key, value)` → captures world modifications

### `/record stop`
**File**: `commands.ts:2279-2285`

1. User types `/record stop`
2. Calls `recorder.stop()`
3. Calculates total duration
4. Creates RecordingSession object
5. Stores as `currentRecording`
6. Sets `isRecording = false`
7. Logs captured frame/content counts
8. Dialogue confirms: "Recording stopped. Type /record play to replay."

### `/record play`
**File**: `commands.ts:2305-2316`

1. User types `/record play`
2. Checks if already playing → toggle off if true
3. Clears canvas: `setWorldData({})`
4. Calls `recorder.startPlayback()`
5. Sets `isPlaying = true`, `playbackStart = Date.now()`
6. Resets playback indices to 0
7. Dialogue confirms: "Playback started..."

**Playback Loop** (runs every frame while playing):
- **Visual State**:
  - Render loop calls `recorder.getPlaybackFrame()`
  - Calculates elapsed time since playback start
  - Finds latest frame matching elapsed time using while loop
  - Returns frame data (cursor, viewOffset, zoomLevel, face)
  - Render loop applies frame data to engine/agent cursor

- **Content Changes**:
  - Render loop calls `recorder.getPlaybackContentChanges()`
  - Returns all content changes due up to current time
  - Render loop applies changes to worldData
  - Characters appear/disappear synchronized with cursor position

### `/record save`
**File**: `commands.ts:2286-2304`

1. User types `/record save`
2. Calls `recorder.exportRecording()` → JSON.stringify(currentRecording)
3. Creates Blob from JSON string
4. Creates download link with `recording_[timestamp].json` filename
5. Triggers browser download
6. Dialogue confirms: "Recording saved to file."

### `/record load`
**File**: `commands.ts:2317-2340`

1. User types `/record load`
2. Creates hidden file input accepting `.json` files
3. User selects file via browser dialog
4. FileReader reads file as text
5. Calls `recorder.importRecording(json)` → JSON.parse into RecordingSession
6. Validates structure (frames array exists)
7. Backwards compatibility: adds empty contentChanges array if missing
8. Calls `recorder.loadRecording(session)`
9. Sets as currentRecording, resets playback indices
10. Dialogue confirms: "Loaded recording: [filename]"

## Recording Capture Implementation

### Frame Capture
**Location**: `bit.canvas.tsx:6278`

Called every animation frame when `isRecording = true`:
```typescript
if (engine.recorder.isRecording) {
    engine.recorder.capture(engine);
}
```

Captures:
- Current timestamp relative to recording start
- Face orientation data (if face tracking enabled)
- Cursor position
- View offset (camera pan)
- Zoom level

### Content Change Capture
**Locations**: `world.engine.ts:9434, 9443, 10578, 10614`

Called immediately when user modifies world data:

**Character Placement** (handleKeyDown):
```typescript
if (recorder.isRecording) {
    recorder.recordContentChange(currentKey, charData);
}
```

**Character Deletion** (deleteCharacter):
```typescript
if (recorder.isRecording) {
    recorder.recordContentChange(key, null);  // null = deletion
}
```

Records:
- Timestamp relative to recording start
- Grid key (x,y coordinates)
- Character data object or null (for deletions)

## Playback Implementation

### Frame Playback Algorithm
**Location**: `recorder.ts:121-138`

```typescript
getPlaybackFrame(): FrameData | null {
    const elapsed = Date.now() - this.playbackStart;

    // Check if playback finished
    if (elapsed > this.currentRecording.duration) {
        this.stopPlayback();
        return null;
    }

    // Advance to latest frame matching current time
    while(this.playbackIndex < frames.length - 1 &&
          frames[this.playbackIndex + 1].timestamp <= elapsed) {
        this.playbackIndex++;
    }

    return frames[this.playbackIndex];
}
```

**Strategy**: Skip-ahead algorithm that finds the most recent frame for current playback time. This ensures playback stays synchronized even if rendering is slow.

### Content Change Playback Algorithm
**Location**: `recorder.ts:140-155`

```typescript
getPlaybackContentChanges(): ContentChange[] {
    const elapsed = Date.now() - this.playbackStart;
    const changes: ContentChange[] = [];

    // Apply all due content changes up to current time
    while (this.contentChangeIndex < contentChanges.length &&
           contentChanges[this.contentChangeIndex].timestamp <= elapsed) {
        changes.push(contentChanges[this.contentChangeIndex]);
        this.contentChangeIndex++;
    }

    return changes;
}
```

**Strategy**: Catch-up algorithm that returns ALL content changes due up to current time. This prevents text from lagging behind cursor during fast typing sequences.

### Playback Rendering
**Location**: `bit.canvas.tsx:6279-6327`

Each frame when `isPlaying = true`:

1. **Get Frame Data**: Call `getPlaybackFrame()`
2. **Apply Visual State**:
   - Enable agent cursor (visually distinct from user cursor)
   - Set agent position to frame.cursor
   - Update view offset and zoom level
   - Apply face orientation if present
   - Update agent cursor trail for smooth movement visualization

3. **Get Content Changes**: Call `getPlaybackContentChanges()`
4. **Apply Content Changes**:
   - Iterate through returned changes
   - For each change:
     - If `value === null`: delete character at key
     - Otherwise: add/update character at key with value
   - Update worldData state
   - Log changes for debugging

## Key Design Decisions

### 1. Dual Data Streams
**Rationale**: Separate frame data (cursor/camera) from content changes (text modifications) for flexibility.

**Benefits**:
- Frame data can be sampled at any rate without affecting content accuracy
- Content changes are precise, timestamped events
- Easy to add new data types to either stream independently

### 2. Skip-Ahead Frame Playback
**Rationale**: Always show the most recent frame matching current time, skipping intermediate frames if needed.

**Benefits**:
- Playback stays synchronized with recording even if rendering is slow
- Smooth playback at various frame rates
- Cursor movement appears fluid

**Trade-offs**:
- Some frames may be skipped if playback lags

### 3. Catch-Up Content Changes
**Rationale**: Apply ALL content changes up to current time, never skip any.

**Benefits**:
- Every character placement/deletion is replayed accurately
- Text content perfectly matches original recording
- Fast typing sequences replay correctly

**Trade-offs**:
- May cause burst of changes if playback lags significantly

### 4. Agent Cursor for Playback
**Rationale**: Use separate agent cursor during playback instead of user cursor.

**Benefits**:
- Visually distinct - user knows they're watching a recording
- Doesn't interfere with actual user cursor position
- Can show different styling (trail effects, typing animation)
- Maintains user's current view/position

### 5. Content Change Recording in Input Handlers
**Rationale**: Record content changes immediately when they occur, not in render loop.

**Benefits**:
- Precise timing - records actual keystroke moment
- Catches all modifications regardless of frame rate
- Works with IME composition and complex input methods
- Synchronizes perfectly with user intent

### 6. JSON Export/Import Format
**Rationale**: Use JSON for recording serialization instead of binary format.

**Benefits**:
- Human-readable for debugging
- Easy to share/version control
- Cross-platform compatible
- Can be edited manually if needed
- Simple import/export with native browser APIs

**Trade-offs**:
- Larger file size than binary format
- Slower parse time for very long recordings

## Future Enhancements

### Potential Improvements

1. **Frame-by-Frame Playback**
   - Return each frame sequentially instead of skip-ahead
   - Better for slow-motion replay or detailed analysis
   - Issue: Current skip-ahead causes characters to not appear during fast typing

2. **Embed Content Changes in Frames**
   - Include contentChange directly in FrameData for that timestamp
   - Ensures perfect sync between cursor and text appearance
   - Simplifies playback logic (single loop instead of two)

3. **Playback Speed Control**
   - Add speed multiplier (0.5x, 1x, 2x, etc.)
   - Scale elapsed time calculation in playback algorithms
   - Allows for slow-motion or time-lapse replay

4. **Recording Trimming/Editing**
   - UI to cut recording start/end
   - Remove frames/changes in specific time ranges
   - Merge multiple recordings

5. **Audio Recording**
   - Capture microphone audio during recording
   - Add audio track to RecordingSession
   - Sync audio playback with visual replay

6. **Compression**
   - Delta encoding for frames (only store changes)
   - Reduce redundant cursor positions
   - Smaller file sizes for long recordings

7. **Cloud Storage**
   - Save recordings to user's Nara account
   - Share recordings via URL
   - Gallery of community recordings

## File References

- **Core Recorder**: `app/bitworld/recorder.ts`
- **Command Handlers**: `app/bitworld/commands.ts:2265-2343`
- **Render Integration**: `app/bitworld/bit.canvas.tsx:6273-6327`
- **Content Capture**: `app/bitworld/world.engine.ts:9431-9445, 10575-10616`
- **Command Help**: `app/bitworld/commands.ts:220`

## Related Systems

- **Agent Cursor System**: Used to display playback cursor separately from user cursor
- **Face Tracking System**: Integrated with recording to capture/replay face orientation
- **World Data System**: Content changes modify the shared worldData state
- **Command System**: Provides user interface to recording functionality
