# Data Clearing Issue - Debug Log

## Problem Description
When refreshing a page or navigating to the same URL (e.g., `/@username/state`), the Firebase data gets cleared while the compiled content remains. The 'data' node in Firebase gets deleted, but the 'content' node persists.

## Root Cause Analysis

### Issue 1: Component Remounting on Navigation
When using `router.push()` to navigate between states, Next.js unmounts the current component and mounts a new one. This causes:

1. Current `useWorldEngine` with existing data gets unmounted
2. New `useWorldEngine` gets mounted with empty initial state (`initialWorldData = {}`)
3. The new hook initializes with empty data and potentially overwrites Firebase

### Issue 2: Listener vs Saver Path Mismatch
The original `useWorldSave` hook had conflicting behaviors:
- **Listener**: Listening to entire world object at `worlds/{userUid}/{worldId}`
- **Saver**: Writing to specific data path at `worlds/{userUid}/{worldId}/data`

This created duplicate data structures in Firebase and confusion about which data was authoritative.

### Issue 3: Empty Data Overwrite Race Condition
The `useWorldEngine` initializes with empty state, and even with `autoLoadData: false`, there was a timing issue where:

1. Component mounts with `worldData = {}`
2. `useWorldSave` hook runs with empty `worldData`
3. If Firebase data loading is slow, the empty state could overwrite existing data

## Firebase Structure (Before Fix)
```
worlds/
  az3fZl5MXaURpcOwHLpfDVQjZte2/
    home/
      data/          <- Duplicate 1 (from listener)
        39,17: "a"
        40,17: "d"
      content/
        0: "adfa"
      data/          <- Duplicate 2 (from saver) - THIS GETS CLEARED
        39,17: "a"
        40,17: "d"
```

## Solutions Implemented

### Fix 1: Route Component Loading Guards
**Files**: `/app/[username]/page.tsx`, `/app/[username]/[...slug]/page.tsx`

Added user authentication check to prevent engine initialization until user is loaded:

```typescript
// Before
if (authLoading || engine.isLoadingWorld) {

// After  
if (authLoading || !user || engine.isLoadingWorld) {
```

This prevents the engine from initializing with `userUid: null` and then re-initializing when auth loads.

### Fix 2: Consistent Listener/Saver Paths
**File**: `/app/bitworld/world.save.ts`

Changed from listening to parent objects to listening directly to specific data paths:

```typescript
// Before - Mixed parent/child listening
if (currentStateName) {
    const stateRef = ref(database, getWorldPath(`${worldId}/states/${currentStateName}`));
    unsubscribe = onValue(stateRef, (snapshot) => {
        handleData(snapshot.child('data'));
        handleSettings(snapshot.child('settings'));
    });
} else {
    const worldRef = ref(database, getWorldPath(`${worldId}`));
    unsubscribe = onValue(worldRef, (snapshot) => {
        handleData(snapshot.child('data'));  
        handleSettings(snapshot.child('settings'));
    });
}

// After - Direct path listening
const dataRef = ref(database, dataPath);
const settingsRef = ref(database, settingsPath);

dataUnsubscribe = onValue(dataRef, (snapshot) => {
    handleData(snapshot);
    setIsLoading(false);
}, handleError);

settingsUnsubscribe = onValue(settingsRef, (snapshot) => {
    handleSettings(snapshot);
}, handleError);
```

### Fix 3: Empty Data Overwrite Prevention
**File**: `/app/bitworld/world.save.ts`

Added guard to prevent saving when both local and synced data are empty:

```typescript
// Prevent saving empty data on initial mount - only save if data has meaningful content
const hasContent = Object.keys(localWorldData || {}).length > 0;
const lastSyncedHasContent = Object.keys(lastSyncedDataRef.current || {}).length > 0;

if (!hasContent && !lastSyncedHasContent) {
    // Both current and last synced are empty - don't save empty state
    return;
}
```

### Fix 4: UserUID Guard
**File**: `/app/bitworld/world.save.ts`

Added check to wait for valid userUid before attempting data operations:

```typescript
if (!userUid) {
    // Don't load data yet, but don't show error - just wait for userUid
    setIsLoading(false);
    return;
}
```

## Expected Behavior After Fixes

1. **Page Refresh**: Should load existing data from Firebase, not clear it
2. **State Navigation**: Should transition between states without data loss
3. **Firebase Structure**: Clean single data/settings nodes, no duplicates
4. **Initial Mount**: Should wait for auth and load data before attempting any saves

## Testing
- Navigate to `/@username/state` 
- Refresh the page
- Check Firebase console - should see data persist, not get cleared
- Navigate between different states
- Verify no duplicate data nodes in Firebase

## Files Modified
1. `/app/[username]/page.tsx` - Added user loading guard
2. `/app/[username]/[...slug]/page.tsx` - Added user loading guard  
3. `/app/bitworld/world.save.ts` - Fixed listener paths, added empty data guards, added userUID guard

### Fix 5: State Navigation Path Alignment
**Files**: `/app/[username]/[...slug]/page.tsx`, `/app/bitworld/world.engine.ts`

The core issue was a conceptual mismatch in how states are stored vs accessed:

**Problem**: 
- State pages were using the state name as the `worldId` (e.g., `worldId='mystate'`)
- This looked for data at `worlds/{uid}/mystate/data`
- But states are actually stored under `worlds/{uid}/home/states/mystate/data`

**Solution**:
```typescript
// Before - Incorrect path structure
const engine = useWorldEngine({ 
    worldId: stateName,  // This creates wrong Firebase path
    userUid: user?.uid || null,
});

// After - Correct path structure  
const engine = useWorldEngine({ 
    worldId: 'home',  // Always use 'home' as base world
    currentStateName: stateName,  // Pass state name separately
    userUid: user?.uid || null,
});
```

This ensures state data is loaded from the correct Firebase path.

## Status
✅ **Fixed** - Data clearing issue resolved with multiple defensive measures in place, including proper state path alignment.