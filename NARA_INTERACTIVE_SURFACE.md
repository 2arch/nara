# NARA - Complete Interactive Surface Map

## Overview
This document maps **every interaction point** in Nara - from canvas interactions to commands to engine capabilities.

---

# Part 1: Canvas Interactions (bit.canvas.tsx)

## Mouse/Touch Interactions

### **Primary Input Handlers:**
```typescript
onClick       - Single click (select, place cursor)
onMouseDown   - Start drag/selection
onMouseMove   - Pan canvas, resize objects, hover effects
onMouseUp     - End drag/selection, drop objects
onMouseLeave  - Clean up hover states
onKeyDown     - Text input, commands, shortcuts
onTouchStart  - Touch equivalent of mouseDown
onTouchMove   - Touch pan/drag
onTouchEnd    - Touch equivalent of mouseUp
```

### **Click Behaviors:**
1. **Single Click** - Place cursor at world position
2. **Click + Drag** - Create text selection
3. **Shift + Drag** - Create rectangular selection
4. **Double Click** - Select word/block
5. **Click on Image** - Select image for resize
6. **Click on Note** - Select note for resize
7. **Click on Pattern** - Select pattern for resize
8. **Click on Iframe** - Select iframe
9. **Double Click Iframe** - Activate iframe (fullscreen)
10. **Click on Task** - Toggle task completion
11. **Click on Link** - Open URL in new tab
12. **Click on Mail Button** - Send email

### **Drag Behaviors:**
1. **Drag Empty Space** - Pan canvas
2. **Drag with Text** - Create selection
3. **Drag Corner Handle** - Resize image/note/pattern/iframe
4. **Drag Pattern Room** - Resize individual room
5. **Two-Finger Drag (Mobile)** - Pan canvas

### **Scroll Behaviors:**
1. **Mouse Wheel** - Zoom in/out
2. **Pinch (Mobile)** - Zoom in/out
3. **Scroll in Iframe** - Scroll iframe content

---

# Part 2: Keyboard Interactions

## Text Input
```
a-z, 0-9, symbols  - Type characters at cursor
Space              - Insert space
Enter              - New line (with smart indent)
Backspace          - Delete character/selection
Delete             - Delete forward
Tab                - Accept AI suggestion (if enabled)
Shift+Tab          - Reject suggestion
```

## Navigation
```
Arrow Keys         - Move cursor
Cmd/Ctrl + Arrows  - Jump words/lines
Home/End           - Start/end of line
Page Up/Down       - Scroll viewport
```

## Selection
```
Shift + Arrows     - Extend selection
Cmd/Ctrl + A       - Select all
Cmd/Ctrl + C       - Copy selection
Cmd/Ctrl + V       - Paste
Cmd/Ctrl + X       - Cut selection
```

## Commands
```
/                  - Start command mode
Escape             - Exit command/chat/host mode
Enter (in command) - Execute command
Up/Down (command)  - Navigate suggestions
```

## Shortcuts
```
Cmd/Ctrl + E       - Toggle tape recording
Cmd/Ctrl + [       - Decrease monogram complexity
Cmd/Ctrl + ]       - Increase monogram complexity
Cmd/Ctrl + Shift+R - Randomize monogram color
```

---

# Part 3: Commands (47 Total)

## Navigation (6 commands)
```
/nav               Navigate to saved labels
/search [query]    Search canvas text
/cam [mode]        Camera control (default|focus)
/indent            Toggle smart indentation
/zoom [level]      Set zoom level
/map               Generate exploration map
```

## Create (5 commands)
```
/label [text] [color]    Create spatial label
/task [color]            Create toggleable task
/link [url]              Create clickable link
/clip                    Save selection to clipboard
/upload                  Upload image to canvas
```

## Special (6 commands)
```
/mode [type]       Switch modes (default|air|chat|note)
/note              Quick enter note mode
/mail              Create email region [SUPER ONLY]
/chat              Quick enter chat mode
/tutorial          Start interactive tutorial
/help              Show command help
```

## Style (3 commands)
```
/bg [color]        Change background color
/text [color]      Change text color
/font [name]       Change font family
```

## State (4 commands)
```
/state             Manage canvas states
/state save [name] Save current canvas
/state load [name] Load saved canvas
/random            Randomize text styling
/clear             Clear all canvas content
/replay            Replay canvas history
```

## Share (5 commands)
```
/publish           Publish canvas publicly
/unpublish         Make canvas private
/share             Get shareable link
/spawn             Set spawn point
/monogram          Add personal monogram
```

## Account (4 commands)
```
/signin            Sign in to account
/signout           Sign out
/account           Manage account
/upgrade           Upgrade to Pro
```

## Debug (1 command)
```
/debug             Toggle debug mode
```

---

# Part 4: Modes

## Canvas Modes (4 modes)

### **1. Default Mode**
```
Purpose: Standard spatial writing
Features:
  - Text persists to Firebase
  - Full command access
  - Selection enabled
  - All interactions active
```

### **2. Air Mode**
```
Purpose: Ephemeral writing (doesn't save)
Features:
  - Text fades after delay
  - Useful for brainstorming
  - No Firebase writes
  - Lighter performance
```

### **3. Chat Mode**
```
Purpose: AI conversation
Features:
  - Chat with AI assistant
  - Transform/expand text
  - Generate content
  - Context-aware responses
```

### **4. Note Mode**
```
Purpose: Focused note-taking
Features:
  - Isolated writing space
  - Auto-saves to notes
  - No canvas clutter
  - Quick capture
```

---

# Part 5: Background Modes (3 types)

### **1. Color Mode**
```
Solid background color
Colors: white, black, sulfur, chalk, cobalt, shamrock,
        spring, garden, crimson, orchid
```

### **2. Image Mode**
```
Static image background
Supports: JPG, PNG, WebP, GIF
Upload or AI-generated
```

### **3. Video Mode**
```
Video background (looping)
Supports: MP4, WebM
Auto-plays on loop
```

---

# Part 6: Camera Modes (2 types)

### **1. Default Mode**
```
Standard camera behavior
User controls pan/zoom
Static viewport
```

### **2. Focus Mode**
```
Camera follows cursor
Smooth tracking
Auto-centers on input
Useful for mobile keyboards
```

---

# Part 7: Engine Capabilities (world.engine.ts)

## Text Operations
```
writeCharacter()          Write char at position
deleteCharacter()         Delete char at position
deleteSelection()         Delete selected text
insertText()              Insert string at cursor
getCharacter()            Read char at position
extractText()             Get text from region
```

## Cursor & Selection
```
moveCursor()              Move cursor position
setSelection()            Set selection bounds
clearSelection()          Remove selection
getCursorPos()            Get current cursor
worldToScreen()           Convert coordinates
screenToWorld()           Convert coordinates
```

## Viewport & Camera
```
setViewOffset()           Pan viewport
setZoomLevel()            Zoom in/out
centerOnPosition()        Center camera on point
setCameraMode()           Set camera behavior
getViewportBounds()       Get visible area
```

## World Data
```
setWorldData()            Update world state
loadWorldData()           Load from Firebase
saveWorldData()           Save to Firebase
clearWorldData()          Delete all data
exportWorldData()         Export as JSON
```

## Images & Media
```
uploadImage()             Add image to canvas
resizeImage()             Change image size
deleteImage()             Remove image
playGIF()                 Animate GIF frames
```

## Labels & Markers
```
createLabel()             Create spatial label
updateLabel()             Edit label
deleteLabel()             Remove label
getAllLabels()            List all labels
navigateToLabel()         Jump to label
```

## Patterns & Shapes
```
generatePattern()         Create procedural pattern
resizePattern()           Scale pattern
resizePatternRoom()       Scale individual room
deletePattern()           Remove pattern
```

## Bounds & Regions
```
createBound()             Create rectangular bound
resizeBound()             Scale bound
deleteBound()             Remove bound
focusBound()              Navigate to bound
```

## Tasks & Links
```
createTask()              Create toggleable task
toggleTask()              Mark complete/incomplete
createLink()              Create clickable link
```

## Email (Super Only)
```
createMailRegion()        Create email composer
sendMail()                Send email via API
deleteMailRegion()        Remove mail region
```

## AI Operations
```
chatWithAI()              Converse with AI
transformText()           AI text transformation
explainText()             AI explanation
summarizeText()           AI summarization
generateImage()           AI image generation
autocomplete()            AI text suggestions
```

## State Management
```
saveState()               Save canvas snapshot
loadState()               Restore snapshot
listStates()              Get all saved states
deleteState()             Remove saved state
publishState()            Make public
unpublishState()          Make private
```

## Clipboard
```
copyToClipboard()         Save selection
pasteFromClipboard()      Insert clipboard
listClips()               Get all clips
deleteClip()              Remove clip
```

## User & Auth
```
signIn()                  Authenticate user
signOut()                 Log out
getUserProfile()          Get user data
updateUserProfile()       Edit profile
checkMembership()         Verify Pro status
```

## Multiplayer
```
updateCursorPosition()    Broadcast cursor
getCursors()              Get other users
syncWorldData()           Real-time sync
```

---

# Part 8: Host Flow System

## Available Flows (6 flows)

### **1. Intro Flow**
```
Purpose: NARA banner welcome
Steps: 2 messages
Auto-advance: 1.5s
Interactive: No
```

### **2. Welcome Flow**
```
Purpose: User onboarding
Steps: 13 messages
Collects: Email, password, username
Interactive: Yes (text input)
```

### **3. Verification Flow**
```
Purpose: Email verification
Steps: 3 messages
Collects: Username
Interactive: Yes
```

### **4. Upgrade Flow**
```
Purpose: Pro subscription
Steps: 7 messages
Interactive: Yes (choice input)
Payment: Stripe checkout
```

### **5. Tutorial Flow**
```
Purpose: Command learning
Steps: 8 messages
Teaches: /bg, /text, /label
Interactive: Yes (command validation)
```

### **6. Password Reset Flow**
```
Purpose: Reset password
Steps: 4 messages
Collects: Email, new password
Interactive: Yes
```

---

# Part 9: Object Types

## Persistent Objects
```
Text           Regular typed characters
Images         JPG, PNG, WebP, GIF
Labels         Spatial markers with text
Tasks          Toggleable checkboxes
Links          Clickable URLs
Patterns       Procedural room layouts
Notes          Bounded text regions
Iframes        Embedded web pages
Mail Regions   Email composers [SUPER]
Bounds         Rectangular containers
Clips          Saved text selections
```

## Ephemeral Objects
```
Air Mode Text  Fading temporary text
Cursors        Multiplayer indicators
Selections     Highlight rectangles
Suggestions    AI autocomplete
Map Labels     Temporary waypoints
```

---

# Part 10: Firebase Integration

## Database Paths
```
/users/{uid}                     User profile
/users/{uid}/worlds/{worldId}    World data
/users/{uid}/settings            User settings
/worlds/{worldId}/data           Shared world
/worlds/{worldId}/settings       World settings
/multiplayer/cursors/{worldId}   Live cursors
```

## Storage Paths
```
/users/{uid}/images/{imageId}    Uploaded images
/users/{uid}/backgrounds/{id}    Background images
```

## Real-time Listeners
```
onWorldDataChange()    Sync world updates
onCursorUpdate()       Track multiplayer
onSettingsChange()     Sync preferences
```

---

# Part 11: AI Features

## Text Operations
```
/chat [prompt]         Converse with AI
Transform Selection    Rewrite text
Explain Selection      Get explanation
Summarize Selection    Condense text
Autocomplete          Tab suggestions
```

## Image Operations
```
/upload then AI        Generate from prompt
Reference Image        Style transfer
Aspect Ratios         Square, portrait, landscape
```

## Membership Tiers
```
Fresh (Free):
  - 5 AI operations/day

Pro ($10/month):
  - Unlimited AI operations
  - Priority processing
  - Advanced features
```

---

# Part 12: Rendering System

## Layers (Z-Index Order)
```
1. Background (color/image/video)
2. Grid (optional dots/lines)
3. Monogram pattern (if enabled)
4. Text characters
5. Images
6. Patterns (room outlines)
7. Labels (colored blocks)
8. Tasks (highlights)
9. Links (underlines)
10. Iframes
11. Bounds (rectangles)
12. Mail regions (with buttons)
13. Selections (highlights)
14. Cursors (local + multiplayer)
15. Command overlay
16. Host dialogue
17. Debug info
```

## Animation Systems
```
Cursor blink          500ms interval
Text fade (air mode)  1500ms duration
GIF frames            Variable FPS
Monogram pattern      Continuous animation
Camera smooth pan     300ms ease
```

---

# Part 13: Performance Systems

## Optimization Techniques
```
Virtual viewport      Only render visible cells
Dirty rectangles      Only redraw changed areas
RAF batching          60fps animation loop
Canvas pooling        Reuse canvas contexts
WebGL acceleration    GPU-powered effects
```

## Caching
```
Character metrics     Font measurements
Pattern bitmaps       Pre-rendered text
Image textures        Decoded images
Firebase snapshots    Local state cache
```

---

# Part 14: Color System

## Named Colors (10)
```
white     #FFFFFF
black     #000000
sulfur    #F0FF6A  (bright yellow)
chalk     #69AED6  (soft blue)
cobalt    #0B109F  (deep blue)
shamrock  #10B981  (green)
spring    #D4FF00  (lime)
garden    #162400  (dark green)
crimson   #FF5200  (orange-red)
orchid    #FFC0CB  (pink)
```

## Dynamic Color Assignment
```
Labels auto-cycle through palette
Text can use any hex color
Backgrounds support custom colors
```

---

# Part 15: Monogram System

## Modes (8)
```
clear       No pattern, trails only
perlin      Flowing noise pattern
nara        NARA text display
geometry3d  Rotating 3D shapes
macintosh   Vintage Mac UI
loading     Loading animation
road        Path connections
terrain     Topographic contours
```

## Controls
```
/monogram [mode]     Switch mode
Ctrl+[               Decrease complexity
Ctrl+]               Increase complexity
Ctrl+Shift+R         Random color shift
Speed: 0.1 - 3.0     Animation speed
```

---

# Summary: Interaction Counts

## Input Methods
```
Mouse Events:      6
Touch Events:      3
Keyboard Events:   1 (with 50+ keybindings)
```

## Commands
```
Total Commands:    47
Navigation:        6
Creation:          5
Special:           6
Styling:           3
State:             4
Sharing:           5
Account:           4
Debug:             1
```

## Canvas Modes
```
Writing Modes:     4 (default, air, chat, note)
Background Modes:  3 (color, image, video)
Camera Modes:      2 (default, focus)
```

## Object Types
```
Persistent:        11 types
Ephemeral:         5 types
```

## AI Features
```
Text Operations:   5
Image Operations:  3
```

## Host Flows
```
Total Flows:       6
Interactive:       5
Auto-advance:      1
```

---

# Interactive Surface Visualization

```
USER INPUT
    ↓
┌─────────────────────────────────────┐
│  CANVAS INTERACTIONS                │
│  - Click/Drag (10 behaviors)       │
│  - Keyboard (50+ keys)              │
│  - Touch (3 gestures)               │
└──────────┬──────────────────────────┘
           ↓
┌─────────────────────────────────────┐
│  COMMAND SYSTEM (47 commands)       │
│  /nav /search /label /bg /text...  │
└──────────┬──────────────────────────┘
           ↓
┌─────────────────────────────────────┐
│  WORLD ENGINE (50+ operations)      │
│  Write, Delete, Move, Resize...    │
└──────────┬──────────────────────────┘
           ↓
┌─────────────────────────────────────┐
│  RENDERING SYSTEM (17 layers)       │
│  Background → Text → Objects → UI   │
└──────────┬──────────────────────────┘
           ↓
┌─────────────────────────────────────┐
│  FIREBASE SYNC (real-time)          │
│  Save, Load, Sync, Publish          │
└─────────────────────────────────────┘
```

---

# Conclusion

Nara's interactive surface is **massive**:

✅ **47 commands** spanning navigation, creation, styling, state, sharing, account
✅ **50+ engine operations** for text, images, patterns, AI, multiplayer
✅ **10+ canvas interactions** (click, drag, resize, select, pan, zoom)
✅ **6 host flows** for onboarding, verification, tutorial, upgrade
✅ **11 object types** (text, images, labels, tasks, links, patterns, notes, iframes, mail, bounds, clips)
✅ **8 monogram modes** with live customization
✅ **AI-powered** text and image generation
✅ **Real-time multiplayer** cursor sync
✅ **State management** with save/load/publish
✅ **Responsive** touch and keyboard support

This is a **full-featured spatial writing platform** with depth comparable to professional creative tools.
