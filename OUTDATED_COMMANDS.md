# Outdated Commands Survey
**Archaeological findings from the Nara codebase**

Generated: 2025-11-11

---

## Executive Summary

After the note-centric architecture migration, several command systems remain in the codebase that use legacy key patterns. This report identifies commands and features that should be evaluated for removal or migration.

---

## Legacy Key Patterns Still In Use

### 1. **label_*** Keys
**Status:** 🟡 Legacy Pattern, Still Active

**Implementation:**
- Command: `/label 'text' [color]`
- Creates: `label_x,y` keys with JSON `{text, color?}`
- Rendering: Special rendering in bit.canvas.tsx (lines 2586-2640)
- Usage: Spatial bookmarks/navigation

**Issues:**
- Uses old key pattern instead of `note_*` with contentType
- Has separate rendering pipeline
- Duplicates note functionality

**Recommendation:** Migrate to `note_*` keys with `contentType: 'label'`

---

### 2. **task_*** Keys
**Status:** 🟡 Legacy Pattern, Still Active

**Implementation:**
- Command: `/task [color]` on selection
- Creates: `task_x,y_timestamp` keys with JSON `{startX, endX, startY, endY, completed, color?, timestamp}`
- Rendering: Special rendering in bit.canvas.tsx (lines 2736-2787, 5064-5100)
- Features: Click to toggle completion, strikethrough when completed

**Issues:**
- Uses old key pattern instead of `note_*` with contentType
- Has separate rendering and interaction logic
- Could be contentType: 'task' on note_* keys

**Recommendation:** Migrate to `note_*` keys with `contentType: 'task'`

---

### 3. **link_*** Keys
**Status:** 🟡 Legacy Pattern, Still Active

**Implementation:**
- Command: `/link [url]` on selection
- Creates: `link_x,y_timestamp` keys with JSON `{startX, endX, startY, endY, url, timestamp}`
- Rendering: Underline effect in bit.canvas.tsx (lines 2788-2826, 6559-6580)
- Features: Click to open URL in new tab

**Issues:**
- Uses old key pattern instead of `note_*` with contentType
- Has separate rendering and interaction logic
- Could be contentType: 'link' on note_* keys

**Recommendation:** Migrate to `note_*` keys with `contentType: 'link'`

---

### 4. **agent** System
**Status:** 🟠 Experimental Feature, Uncertain Value

**Implementation:**
- Command: `/agent` toggle
- Features: AI agent that moves around viewport
- State: `agentEnabled`, `agentPos`, `agentState`, `agentIdleTimer`
- Rendering: Dedicated agent rendering logic

**Issues:**
- Unclear purpose or user value
- Adds complexity with state management
- No clear integration with note system
- May be prototype that was never completed

**Recommendation:** Remove unless there's a clear vision for this feature

---

### 5. **margin** Command
**Status:** 🟡 Niche Feature, Legacy Implementation

**Implementation:**
- Command: `/margin` on text selection
- Creates: `note_*` keys for margin regions
- Logic: Calculates margin placement (right, left, or bottom of text blocks)
- File: world.engine.ts (lines 4769-4847)

**Issues:**
- Creates basic note regions without contentType
- Complex logic for margin calculation (100+ lines)
- Unclear if this is actively used
- May overlap with manual note creation

**Recommendation:** Evaluate usage metrics, consider simplifying or removing

---

### 6. **map** Command
**Status:** 🟢 Working as Designed (Ephemeral)

**Implementation:**
- Command: `/map`
- Creates: Ephemeral labels in `lightModeData` (cleared with Escape)
- Features: Procedural label generation with Poisson-disk spacing
- Words: vista, ridge, valley, peak, grove, etc.

**Status:** This is actually well-designed - uses ephemeral rendering correctly
**Recommendation:** Keep as-is

---

### 7. **replay** Command
**Status:** 🔴 Likely Broken, Low Value

**Implementation:**
- Command: `/replay [speed]`
- Depends on: `fetchReplayLog()` function
- Features: Replays canvas creation sequence

**Issues:**
- `fetchReplayLog` may not be implemented
- Unclear data source (Firebase? Local?)
- May be broken since architecture changes
- Niche feature with maintenance burden

**Recommendation:** Remove unless critical for debugging

---

### 8. **clip** Command
**Status:** 🟡 Unclear Implementation

**Implementation:**
- Command: `/clip`
- Purpose: Clipboard operations
- Location: world.engine.ts line 5349

**Issues:**
- Implementation details unclear from grep
- May overlap with native clipboard
- Unclear user value

**Recommendation:** Review implementation, consider removing if redundant

---

## Commands Using Note Architecture Correctly

### ✅ **bound** Command
- Creates: `note_*` keys with `contentType: 'bound'`
- Status: Migrated correctly ✓

### ✅ **list** Command
- Creates: `note_*` keys with `contentType: 'list'`
- Status: Migrated correctly ✓

### ✅ **glitch** Command
- Creates: `note_*` keys with `contentType: 'glitch'`
- Status: Migrated correctly ✓

### ✅ **upload** Command
- Creates: `note_*` keys with `contentType: 'image'`
- Status: Migrated correctly ✓

---

## Rendering Code to Remove

### Already Removed ✅
- Staged image rendering (stagedImageData)
- Stage command and template parser
- Bounded region background rendering
- Glitched region subdivision rendering
- Standalone image rendering

### Still Exists ⚠️
1. **Label rendering** (bit.canvas.tsx ~2586-2640)
   - Cutout text effect for labels
   - Arrow indicators for off-screen labels
   - Should be migrated to note rendering

2. **Task rendering** (bit.canvas.tsx ~2736-2787, 5064-5100)
   - Highlight background
   - Strikethrough for completed
   - Click to toggle
   - Should be migrated to note rendering

3. **Link rendering** (bit.canvas.tsx ~2788-2826, 6559-6580)
   - Underline effect
   - Click to open URL
   - Should be migrated to note rendering

---

## Migration Path

### Phase 1: Migrate Key Patterns
1. **label_*** → `note_*` with `contentType: 'label'`
   - Update command to create note_* keys
   - Add label-specific rendering to unified note renderer
   - Migrate existing label_* keys in user data

2. **task_*** → `note_*` with `contentType: 'task'`
   - Update command to create note_* keys
   - Add task-specific rendering to unified note renderer
   - Preserve completion state and click handler
   - Migrate existing task_* keys

3. **link_*** → `note_*` with `contentType: 'link'`
   - Update command to create note_* keys
   - Add link-specific rendering to unified note renderer
   - Preserve URL and click handler
   - Migrate existing link_* keys

### Phase 2: Remove Experimental Features
1. Remove **agent** system (if no clear use case)
2. Remove **replay** command (if broken/unused)
3. Simplify or remove **margin** command
4. Review **clip** command necessity

### Phase 3: Consolidate Rendering
1. Remove separate label rendering
2. Remove separate task rendering
3. Remove separate link rendering
4. All rendering through unified note pipeline

---

## Benefits of Migration

### Code Reduction
- Remove ~300-500 lines of redundant rendering code
- Consolidate interaction handlers
- Simplify data model

### Consistency
- All spatial objects use `note_*` keys
- Single rendering pipeline
- Consistent selection/interaction behavior

### Extensibility
- Easy to add new content types
- Unified styling system
- Simplified state management

---

## Estimated Impact

### Lines of Code to Remove
- Agent system: ~150 lines
- Replay command: ~50 lines
- Margin command: ~100 lines (if removed)
- Clip command: ~30 lines (if removed)
- Label rendering: ~150 lines
- Task rendering: ~150 lines
- Link rendering: ~100 lines

**Total potential reduction: 730+ lines**

### Data Migration Required
- Yes, for users with existing label_*, task_*, link_* keys
- Migration script needed to convert to note_* format
- Should be backward compatible during transition

---

## Recommendations Summary

### High Priority 🔴
1. **Migrate label, task, link to note_* keys** - Achieves full architecture consistency
2. **Remove agent system** - Experimental feature with unclear value

### Medium Priority 🟡
3. **Remove or fix replay command** - Likely broken, low value
4. **Evaluate margin command** - Complex logic for niche feature

### Low Priority 🟢
5. **Keep map command** - Works well with ephemeral rendering
6. **Review clip command** - May be useful, needs investigation

---

## Next Steps

1. **Consensus:** Agree on which commands to migrate vs remove
2. **Migration script:** Build tool to convert legacy keys to note_* format
3. **Backward compatibility:** Ensure old keys still render during transition
4. **Cleanup:** Remove legacy rendering once migration complete
5. **Documentation:** Update user docs with new command behavior

---

**The note block reigns supreme. All hail the unified architecture.**
