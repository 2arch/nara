# Collaborative Editing Sync Status

## Problem Statement

We have a canvas-based text editor where multiple users can type simultaneously. When two users edit at the same time (e.g., one typing 'a' on mobile, another typing 'b' on laptop), we experience:

1. **Character loss**: Not all characters sync to Firebase
2. **Sparse syncing**: Characters appear with gaps when typing rapidly across devices
3. **Single-device issues**: Even typing on one device causes characters to "despawn"

## Data Model

### Current Structure
```javascript
WorldData = {
  "x,y": "character",           // Simple string
  "x,y": { /* CharData */ },    // Or object with metadata
  "block_id": { /* Block */ },  // Blocks
  "label_id": { /* Label */ },  // Labels
  // ... ~thousands of coordinates
}
```

### Firebase Storage
```
/worlds/{userUid}/{worldId}/data
  |- "10,5": "a"
  |- "11,5": "b"
  |- "block_123": {...}
```

## Approaches Tried

### 1. **Initial State-Based Sync** (FAILED)
```javascript
// Send entire world data
await set(dbRef, localWorldData);
```

**Problem**: Last-write-wins at document level. Whoever saves last overwrites everyone else's changes.

**Result**: Massive data loss in concurrent editing.

---

### 2. **Granular Updates** (PARTIAL SUCCESS)
```javascript
// Only send changed coordinates
const updates = {};
for (const key in localWorldData) {
  if (changed(key)) {
    updates[`${worldDataRefPath}/${key}`] = localWorldData[key];
  }
}
await update(ref(database), updates);
```

**Problem**: Still had race condition with `lastSyncedDataRef` being wholesale replaced after save.

**Result**: Better than #1, but still losing data.

---

### 3. **Granular Updates + Proper lastSyncedDataRef** (IMPROVED)
```javascript
// After save, only update synced state for keys we actually saved
for (const key of changedKeys) {
  lastSyncedDataRef.current[key] = localWorldData[key];
}
// Don't replace the entire object
```

**Problem**: Still some data loss, especially during rapid typing.

**Result**: Noticeable improvement but not perfect.

---

### 4. **Firebase Transactions + Timestamps** (MADE IT WORSE)
```javascript
// Each coordinate as separate transaction with timestamp
{
  "10,5": { char: "a", timestamp: 1234567890 }
}

runTransaction(coordinateRef, (currentValue) => {
  if (currentValue.timestamp > ourTimestamp) {
    return currentValue; // Keep newer
  }
  return newValue;
});
```

**Problems**:
- Debounce captures stale values in closure
- Transaction callback runs multiple times with stale data
- Timestamp resolution issues (same client, rapid keystrokes → identical timestamps)
- Characters started "despawning" even on single device

**Result**: Significantly worse. Reverted.

---

## Current Implementation (After Revert)

### Architecture
```javascript
// Save Hook (50ms debounce)
useEffect(() => {
  // Compute diff from lastSyncedDataRef
  const updates = computeChangedKeys();

  // Send granular updates
  await update(ref(database), updates);

  // Update only the keys we saved
  for (const key of changedKeys) {
    lastSyncedDataRef.current[key] = localWorldData[key];
  }
}, [localWorldData]);

// Load Hook (Real-time listeners)
onChildAdded(dataRef, (snapshot) => {
  const key = snapshot.key;
  const value = snapshot.val();
  setLocalWorldData(prev => ({ ...prev, [key]: value }));
  lastSyncedDataRef.current[key] = value;
});

onChildChanged(dataRef, (snapshot) => {
  // Same as above
});
```

### What Works
- ✅ Basic typing and saving
- ✅ Multiple users can see each other's changes
- ✅ Different coordinates don't conflict
- ✅ Granular updates reduce conflict surface area

### What Doesn't Work
- ❌ Characters still lost during rapid concurrent typing
- ❌ "Sparse" sync (e.g., "aaaaaa" becomes "a a aa a")
- ❌ Single-device reliability issues

---

## Why It's Hard

### The Core Race Condition

```
Time  Mobile                  Laptop                  Firebase
----  ------                  ------                  --------
T0    Type 'a' at (10,5)      Type 'b' at (11,5)
T1    Compute diff            Compute diff
      lastSynced: {}          lastSynced: {}
T2    Save {10,5: 'a'}        Save {11,5: 'b'}        Receives both
T3    Update lastSynced       Update lastSynced
      = {10,5: 'a'}           = {11,5: 'b'}           Data: {10,5:'a', 11,5:'b'}
T4    Type 'a' at (12,5)      Type 'b' at (13,5)
T5    Compute diff            Compute diff
      sees (11,5: 'b') NEW    sees (10,5: 'a') NEW
      sees (12,5: 'a') NEW    sees (13,5: 'b') NEW
T6    Save BOTH               Save BOTH
      {11,5:'b', 12,5:'a'}    {10,5:'a', 13,5:'b'}    Conflict!
```

The problem: **Firebase's real-time listeners update local state asynchronously**. Between computing the diff and saving, new data arrives, but we've already captured what needs to be saved.

---

## How Google Docs Solves This

### Operational Transformation (OT)

Instead of syncing **state**, sync **operations**:

```javascript
// Not this:
{ "10,5": "a" }

// But this:
{
  type: "insert",
  char: "a",
  position: 5,
  userId: "mobile",
  version: 142
}
```

### Key Techniques

1. **Operations are transformed** when they conflict
   ```javascript
   User A: insert "X" at position 5 (version 100)
   User B: insert "Y" at position 5 (version 100)

   Server:
   - Apply A first → position 5 = "X"
   - Transform B: position becomes 6
   - Apply B → position 6 = "Y"
   Result: "XY" (both preserved)
   ```

2. **Vector clocks** track causality
   ```javascript
   { mobile: 14, laptop: 22, server: 50 }
   ```

3. **Server as arbiter** - decides canonical order

4. **Client-side prediction** - immediate feedback, reconcile later

---

## Potential Solutions

### Option A: Operational Transformation
**Pros**: Industry standard, handles all edge cases
**Cons**: Complex to implement, requires server logic, major refactor

### Option B: CRDTs (Conflict-Free Replicated Data Types)
**Pros**: Eventually consistent, no server coordination needed
**Cons**: Still complex, requires data structure redesign

Examples: Yjs, Automerge, ShareDB

### Option C: Server-Side Sequencing
**Pros**: Simpler than OT, leverages Firebase
**Cons**: Requires Cloud Functions, adds latency

```javascript
// Client sends intent
{ type: "insert", char: "a", cursorPos: {x: 10, y: 5} }

// Cloud Function applies sequentially
exports.processEdit = functions.database.ref('/edits/{editId}')
  .onCreate((snapshot, context) => {
    const edit = snapshot.val();
    // Apply to canonical world state
    // Broadcast result
  });
```

### Option D: Character-Level Versioning
**Pros**: Simpler than full OT, works with current structure
**Cons**: Still has conflict scenarios

```javascript
{
  "10,5": {
    char: "a",
    version: 15,
    userId: "mobile",
    timestamp: 1234567890
  }
}

// On conflict, use vector clock or lamport timestamp
```

### Option E: Increase Debounce + Accept Some Loss
**Pros**: Minimal code change
**Cons**: Poor UX, doesn't actually solve the problem

---

## Questions for Research Engineers

1. **Is full OT overkill for our use case?**
   - We have independent coordinates, not a linear document
   - Most edits are at different positions

2. **Can we leverage Firebase's transaction API properly?**
   - Our attempt failed due to debounce/closure issues
   - Is there a pattern that works?

3. **Should we use a CRDT library?**
   - Yjs has great Firebase integration
   - But requires data model changes

4. **Hybrid approach?**
   - Use simple last-write-wins for single character
   - Use OT only for blocks/lists/complex structures

5. **Is server-side sequencing the pragmatic middle ground?**
   - Cloud Functions process edits in order
   - Clients just send operations and listen

---

## Current Code Location

- **Save logic**: `/app/bitworld/world.save.ts`
- **Engine**: `/app/bitworld/world.engine.ts`
- **Canvas**: `/app/bitworld/bit.canvas.tsx`

## Next Steps

1. Get expert feedback on architecture
2. Choose approach (OT vs CRDT vs server-side vs hybrid)
3. Implement POC
4. Test with real concurrent editing scenarios
