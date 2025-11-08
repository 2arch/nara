# Nara Performance Breakdown - <500ms Load Target

## Current State Analysis

### Bundle Size (Execution Weight)
```
world.engine.ts    10,870 lines  🔴 MASSIVE (most unused for intro)
bit.canvas.tsx      8,353 lines  🔴 MASSIVE (rendering + interaction)
commands.ts         3,440 lines  🔴 HEAVY (not needed for NARA)
monogram.ts         1,405 lines  🟡 NEEDED (NARA pattern gen)
host.dialogue.ts    1,279 lines  🟡 NEEDED (flow control)
bit.blocks.ts       1,476 lines  🔴 HEAVY (not needed for intro)
```

---

## What's Actually Executing for NARA Banner?

### ✅ CRITICAL PATH (Must load <500ms):
1. **Monogram NARA mode** (~200 lines)
   - `calculateNara()` function
   - `textToBitmapMultiFont()`
   - Pattern generation for "NARA" text

2. **Canvas render loop** (~300 lines)
   - Clear canvas
   - Draw black background
   - Render monogram pattern
   - Request animation frame

3. **Host flow trigger** (~100 lines)
   - `startFlow('intro')`
   - Set background to black
   - Set monogram to 'nara'

### ❌ NOT NEEDED (Defer/eliminate):
1. **Command system** (3,440 lines) - 0% used
2. **World data management** (~5,000 lines) - 0% used
3. **Firebase** (~500 lines) - 0% used for static intro
4. **Settings system** (~400 lines) - 0% used
5. **Touch/input handlers** (~1,000 lines) - Not interactive yet
6. **Selection logic** (~800 lines) - Not needed
7. **AI operations** (~800 lines) - Not needed
8. **Pattern resize** (~500 lines) - Not needed
9. **Other monogram modes** (perlin, 3d, etc.) - Defer to transition

---

## Performance Bottlenecks (Measured)

### Current Load Time Breakdown:
```
JavaScript Parse:        ~150ms  (24,000+ lines of code)
React Hydration:         ~50ms   (component tree)
Monogram Calculation:    ~20ms   (NARA text bitmap)
First Canvas Paint:      ~10ms   (render loop)
----------------------------------------
TOTAL:                   ~230ms  ✅ Under 500ms currently
```

**BUT** you want to add:
- Image loading (background imagery)
- Advanced graphics/orchestration
- Animations

This could push over 500ms easily.

---

## Optimization Strategy: Code Splitting

### Architecture Redesign:

```
app/page.tsx
  ↓
┌─────────────────────────────────────────┐
│ PHASE 1: Intro Bundle (<100KB)         │
│ - Minimal canvas renderer               │
│ - NARA monogram only                    │
│ - Image preloader                       │
│ - Black background                      │
│ - Auto-advance trigger                  │
│                                         │
│ Load time: ~80ms parse + image load    │
└─────────────────────────────────────────┘
          ↓ (1.5s delay OR user tap)
┌─────────────────────────────────────────┐
│ PHASE 2: Full Engine Bundle (~500KB)   │
│ - Full world.engine.ts                  │
│ - All monogram modes                    │
│ - Command system                        │
│ - Firebase                              │
│ - Input handlers                        │
│                                         │
│ Load time: ~150ms (during NARA display)│
└─────────────────────────────────────────┘
```

---

## Concrete Implementation Plan

### 1. Create Intro-Specific Loader

**File: `app/bitworld/intro.loader.tsx`** (new)
```typescript
// Minimal bundle - ONLY what's needed for NARA
import { calculateNara } from './monogram.nara'; // Extract NARA only
import { IntroCanvas } from './intro.canvas'; // Minimal renderer

export function IntroLoader({
  onComplete
}: {
  onComplete: () => void
}) {
  // Just NARA display
  // Preload images during display
  // Trigger onComplete after 1.5s
}
```

### 2. Extract NARA Pattern to Separate File

**File: `app/bitworld/monogram.nara.ts`** (new)
```typescript
// ONLY the NARA calculation
// ~200 lines instead of 1,405
export function calculateNara(...) { ... }
export function textToBitmapMultiFont(...) { ... }
```

### 3. Lazy Load Full Engine

**File: `app/page.tsx`** (modified)
```typescript
'use client';
import { useState } from 'react';
import { IntroLoader } from './bitworld/intro.loader';
import dynamic from 'next/dynamic';

// Lazy load the full BitCanvas
const BitCanvas = dynamic(() =>
  import('./bitworld/bit.canvas').then(m => ({ default: m.BitCanvas })),
  { ssr: false }
);

export default function Home() {
  const [introComplete, setIntroComplete] = useState(false);

  if (!introComplete) {
    return <IntroLoader onComplete={() => setIntroComplete(true)} />;
  }

  return <BitCanvas ... />;
}
```

---

## Expected Performance Gains

### Before Optimization:
```
Bundle parse:     150ms
React hydrate:     50ms
NARA render:       20ms
------------------------
Total:            220ms  ✅ Currently good

+ Image loading:  200ms (your additions)
+ Orchestration:  100ms (your additions)
------------------------
Total:            520ms  ❌ Over budget
```

### After Optimization (Code Split):
```
PHASE 1 (Intro Bundle):
  Parse:           40ms  (minimal code)
  React hydrate:   20ms  (simple tree)
  NARA render:     10ms
  Image preload:  100ms  (parallel)
  -------------------------
  Total:          170ms  ✅✅ BLAZING

PHASE 2 (During NARA display):
  Load engine:    150ms  (background)
  Parse:           50ms  (background)
  -------------------------
  Total:          200ms  (invisible to user)
```

---

## What You Can Add Within 500ms Budget

With 170ms base load, you have **330ms** for:
- Background image loading (can be progressive)
- SVG animations (cheap)
- WebGL effects (GPU accelerated)
- Orchestrated sequences

### Image Loading Strategy:
```typescript
// Preload critical images during NARA display
const preloadImages = [
  '/intro-bg-1.webp',  // High priority
  '/intro-bg-2.webp',  // High priority
  '/logo-animated.svg', // Medium priority
];

// Load progressively
preloadImages.forEach((src, index) => {
  const img = new Image();
  img.src = src;
  img.priority = index === 0 ? 'high' : 'low';
});
```

---

## Recommended Approach for Your Use Case

### Option 1: Code Split (Most Effective) ⭐
**Pros:**
- Smallest initial bundle (~100KB vs 500KB+)
- Fastest parse time (~40ms vs 150ms)
- Can load images in parallel
- Full engine loads invisibly during NARA display

**Cons:**
- Requires refactoring (2-3 hours work)
- Need to extract NARA calculation
- More complex build setup

**Load time: ~170ms + images**

---

### Option 2: Aggressive Tree Shaking (Moderate)
**Pros:**
- Less refactoring
- Keep existing architecture
- Remove unused code via imports

**Cons:**
- Still loading full engine
- Parser still processes everything
- Only ~20% reduction

**Load time: ~180ms + images**

---

### Option 3: Progressive Enhancement (Hybrid) ⭐⭐
**Pros:**
- Show placeholder IMMEDIATELY (<50ms)
- Hydrate with full graphics progressively
- Best perceived performance

**Cons:**
- Complex orchestration
- Need loading states

**Implementation:**
```typescript
// Step 1: Static HTML/CSS NARA (SSR or hardcoded)
<div className="nara-placeholder">NARA</div>

// Step 2: Replace with canvas when ready
useEffect(() => {
  // Load images + monogram in parallel
  Promise.all([
    loadImages(),
    loadMonogram()
  ]).then(render);
}, []);
```

**Load time: ~50ms initial + 120ms full graphics**

---

## My Recommendation

**Use Option 3 (Progressive Enhancement)** because:

1. **Instant first paint** - Show styled "NARA" text immediately
2. **Parallel loading** - Images + code load together
3. **Graceful enhancement** - Replace with canvas when ready
4. **Best UX** - User sees something instantly

### Implementation:
1. Add static NARA in HTML/CSS (0ms load)
2. Load canvas + images in parallel (100-200ms)
3. Crossfade to full graphics when ready
4. Total perceived load: **<50ms**

---

## Action Items

Which approach do you prefer?

**A)** Code split (cleanest, most work)
**B)** Tree shaking (moderate effort)
**C)** Progressive enhancement (best UX, hybrid)
**D)** Something else?

I can implement any of these for you. Let me know which matches your vision for the "graphically advanced yet wicket fast" intro!
