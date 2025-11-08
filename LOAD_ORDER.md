# Nara Home Page Load Order

This document outlines the initialization sequence when a user first visits the home page (`/`).

## 1. Page Component Initialization (`app/page.tsx`)

### Immediate (Synchronous)
1. **State initialization**
   - `cursorAlternate`: false
   - `user`: null
   - `authLoading`: true
   - `isVerifyingEmail`: false

2. **Host color calculation** (lines 54-60)
   - Checks current time (hour)
   - If daytime (6am-6pm): `{ background: '#F0FF6A', text: '#FFA500' }` (sulfur/orange)
   - If nighttime: `{ background: '#69AED6', text: '#000000' }` (chalk/black)

3. **World Engine initialization** (lines 62-67)
   - `worldId`: null (no Firebase connection for home page)
   - `initialBackgroundColor`: hostColors.background (from step 2)
   - `userUid`: null
   - `initialZoomLevel`: 1.6

### Async (useEffect hooks)
4. **Email link verification check** (lines 18-40)
   - Checks if URL contains `apiKey=` parameter
   - If yes: calls `completeSignInWithEmailLink()`

5. **Auth state listener** (lines 43-51)
   - Sets up Firebase `onAuthStateChanged` listener
   - Updates `user` and `authLoading` states
   - Does NOT auto-redirect (lets intro flow handle it)

6. **Cursor blink interval** (lines 75-80)
   - Toggles `cursorAlternate` every 500ms

7. **Initial flow determination** (line 84)
   - If `isVerifyingEmail`: undefined (no flow)
   - Otherwise: "intro"

---

## 2. World Engine Initialization (`app/bitworld/world.engine.ts`)

### Synchronous (Component Level)
1. **Router initialization** (line 585)

2. **Centered offset calculation** (lines 587-612)
   - Calculates viewport-centered offset based on zoom level

3. **State initialization** (lines 617-767)
   - `worldData`: {}
   - `cursorPos`: {0, 0}
   - `viewOffset`: calculated centered offset
   - `zoomLevel`: 1.6
   - `dialogueText`: ''
   - `chatMode`: inactive
   - `hostMode`: inactive
   - Many other states...

4. **Settings hook** (after state init)
   - `useWorldSettings()` initializes with defaults
   - No Firebase load for home page (worldId is null)

### Async (useEffect hooks)
5. **Cursor position ref sync** (lines 665-667)
   - Keeps `cursorPosRef` in sync with `cursorPos`

6. **Membership level fetch** (lines 670-685)
   - **SKIPPED on home page** (userUid is null)

7. **Pattern generation from URL** (lines 688-707)
   - **SKIPPED on home page** (no initialPatternId)

8. **Bound detection** (lines 710-753)
   - Watches cursor position for bounded regions

---

## 3. BitCanvas Component Initialization (`app/bitworld/bit.canvas.tsx`)

### Synchronous (Component Level)
1. **Refs and state initialization** (lines 59-121)
   - Canvas ref, device pixel ratio, canvas size
   - Cursor trails, state publish statuses
   - Selection states, resize states

2. **Monogram config calculation** (lines 686-712)
   - Checks `hostModeEnabled` (true on home page)
   - Checks `initialHostFlow === 'intro'` → **YES**
   - Returns: `{ mode: 'nara', enabled: true }`

3. **Monogram system initialization** (line 717)
   - `useMonogramSystem()` with config from step 2
   - **Monogram starts with mode: 'nara', enabled: true**

4. **Host dialogue initialization** (line 322)
   - `useHostDialogue()` with callbacks:
     - `setMonogramMode`: Updates monogram mode and enables it
     - `setBackgroundColor`: Updates engine background color
   - Initial state: inactive

### Async (useEffect hooks)
5. **Canvas recorder setup** (lines 124-129)

6. **Email verification flow** (lines 358-408)
   - **SKIPPED on home page** (isVerifyingEmail is false initially)

7. **Initial host flow start** (lines 462-499) ⭐ **KEY STEP**
   - Checks: `hostModeEnabled && initialHostFlow && !isHostActive`
   - Sets host text color
   - Switches camera to 'focus' mode
   - Activates host mode in engine
   - Activates chat mode in engine
   - **Calls `hostDialogue.startFlow('intro')`** 👈 This triggers the intro flow

8. **Camera mode restoration** (lines 503-515)
   - Watches for host mode exit

9. **Pan distance tracking** (lines 516-532)

10. **World readiness tracking** (lines 533-540)

11. **Settings sync** (lines 542-577)
    - **SKIPPED on home page** (no Firebase settings)

---

## 4. Host Dialogue Flow Start (`app/bitworld/host.dialogue.ts`)

### When `startFlow('intro')` is called (line 57-138)

1. **Flow lookup** (lines 58-62)
   - Finds 'intro' flow in HOST_FLOWS

2. **Start message lookup** (lines 64-68)
   - Gets 'nara_banner' message

3. **Viewport center calculation** (line 71)

4. **Display first message** (lines 73-78)
   - Sets host data with empty text

5. **Monogram mode handling** (lines 81-84) ⭐
   - Checks `startMessage.monogramMode` → 'nara'
   - **Calls `setMonogramMode('nara')`**
   - Logs: "[HostDialogue] startFlow - Setting monogram mode to: nara"

6. **Background color handling** (lines 87-90) ⭐
   - Checks `startMessage.backgroundColor` → '#000000'
   - **Calls `setBackgroundColor('#000000')`**
   - Logs: "[HostDialogue] startFlow - Setting background color to: #000000"

7. **Host mode activation** (lines 113-118)

8. **Chat mode activation** (lines 121-129)

9. **State update** (lines 131-137)
   - Sets flow active with 'intro' flow and 'nara_banner' message

10. **Auto-advance timer** (lines 254-261)
    - Sets 1.5 second timer to advance from 'nara_banner'

---

## 5. Monogram Mode Update (`app/bitworld/bit.canvas.tsx`)

### When `setMonogramMode('nara')` is called (lines 342-348)

1. **Logging** (line 343)
   - Logs: "[BitCanvas] setMonogramMode called with: nara"

2. **Pre-update logging** (line 344)
   - Logs current monogram options

3. **Update mode** (line 345)
   - `monogramSystem.updateOption('mode', 'nara')`

4. **Enable monogram** (line 346)
   - `monogramSystem.updateOption('enabled', true)`

5. **Post-update logging** (line 347)
   - Logs updated monogram options

---

## 6. Background Color Update (`app/bitworld/bit.canvas.tsx`)

### When `setBackgroundColor('#000000')` is called (lines 349-354)

1. **Logging** (line 350)
   - Logs: "[BitCanvas] setBackgroundColor called with: #000000"

2. **Pre-update logging** (line 351)
   - Logs current engine backgroundColor

3. **Update background** (line 352)
   - `engine.updateSettings({ backgroundColor: '#000000' })`

4. **Post-update logging** (line 353)
   - Logs updated backgroundColor

---

## 7. Rendering Loop

### Canvas render cycle (continuous)
1. **Clear canvas**
2. **Render background** (solid color)
3. **Render monogram pattern** (if enabled)
   - Checks `monogramEnabled` prop (true)
   - Generates monogram pattern for viewport
   - Renders NARA text characters at calculated positions
4. **Render world data** (text, images, etc.)
5. **Render cursor**
6. **Render UI overlays**

---

## Summary: Timing and Order

```
TIME | COMPONENT        | ACTION
-----|------------------|------------------------------------------
0ms  | page.tsx         | Calculate host colors (sulfur or chalk)
0ms  | page.tsx         | Initialize world engine with background color
0ms  | world.engine.ts  | Initialize state (empty world, cursor at 0,0)
0ms  | bit.canvas.tsx   | Calculate monogram config → { mode: 'nara', enabled: true }
0ms  | bit.canvas.tsx   | Initialize monogram system (NARA mode)
0ms  | bit.canvas.tsx   | Initialize host dialogue system
~5ms | bit.canvas.tsx   | useEffect: Start intro flow
~5ms | host.dialogue.ts | startFlow('intro') called
~5ms | host.dialogue.ts | Set monogram mode to 'nara' (redundant but safe)
~5ms | host.dialogue.ts | Set background color to '#000000' ⭐ NARA BANNER VISIBLE
~5ms | bit.canvas.tsx   | Monogram system updates to mode: nara, enabled: true
~5ms | bit.canvas.tsx   | Engine background updates to black
~10ms| Canvas render     | First frame rendered with NARA monogram on black
1.5s | host.dialogue.ts | Auto-advance timer fires
1.5s | host.dialogue.ts | Advance to 'transition_to_welcome'
1.5s | host.dialogue.ts | Set monogram mode to 'perlin'
1.5s | host.dialogue.ts | Restore background to host color (sulfur/chalk)
1.5s | host.dialogue.ts | Switch to 'welcome' flow
1.5s | Canvas render     | Perlin monogram visible on host color background
```

---

## Firebase Interactions (Home Page)

### Auth
- **Listener set up**: onAuthStateChanged (passive, doesn't block render)
- **No initial fetch**: No user profile fetch on load

### Database
- **No reads**: worldId is null, no settings loaded
- **No writes**: No world data saved on home page

---

## Key Observations

1. **No Firebase blocking**: Auth listener is passive, no database reads
2. **Monogram initializes correctly**: Set to 'nara' mode before flow starts
3. **Background color changes**: sulfur/chalk → black → back to sulfur/chalk
4. **Double monogram update**: Flow calls setMonogramMode even though already set (safe redundancy)
5. **Rendering is immediate**: No waiting for network requests

---

## Performance Bottlenecks (Potential)

1. **None identified** - Everything is synchronous except:
   - Auth state listener (non-blocking)
   - Auto-advance timer (1.5s intentional delay)

The load is extremely fast because:
- No Firebase reads on home page
- No network requests required
- Monogram pattern is calculated client-side
- All initialization is synchronous
