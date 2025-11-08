# Fast Image Loading Strategy - <500ms Total Load

## Goal
Load NARA banner + background images in under 500ms total.

## Current State
- JS Bundle: 220ms
- Image Budget: 280ms remaining

## Image Optimization Checklist

### 1. Image Format & Compression
```bash
# Convert to WebP (50% smaller than JPEG)
cwebp -q 80 input.jpg -o output.webp

# Or use Next.js Image Optimization (automatic)
<Image src="/intro-bg.jpg" ... />  # Auto-converts to WebP
```

### 2. Image Sizing Guidelines
```
Mobile:  800x1200px @ 80% quality = ~60KB  (60ms load)
Tablet:  1200x1800px @ 80% quality = ~100KB (100ms load)
Desktop: 1920x1080px @ 75% quality = ~120KB (120ms load)
```

### 3. Preload Critical Images
```typescript
// In app/page.tsx
export default function Home() {
  return (
    <>
      <Head>
        <link
          rel="preload"
          as="image"
          href="/intro-bg.webp"
          type="image/webp"
        />
      </Head>
      {/* ... */}
    </>
  );
}
```

### 4. Use Next.js Image Component with Priority
```typescript
import Image from 'next/image';

<Image
  src="/intro-bg.webp"
  alt="NARA Intro"
  fill
  priority={true}  // Loads immediately, no lazy loading
  quality={80}
  placeholder="blur"
  blurDataURL="data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA="
/>
```

### 5. Serve from CDN
```
Vercel automatically uses CDN for:
- /public images
- next/image optimized images

First load:  ~200ms (from origin)
Cached:      ~20ms (from edge)
```

## Implementation Steps

### Option A: Next.js Image (Recommended)
```typescript
// app/page.tsx
import Image from 'next/image';

export default function Home() {
  return (
    <div className="relative w-screen h-screen">
      {/* Background image - loads in parallel with JS */}
      <Image
        src="/intro-bg.webp"
        alt=""
        fill
        priority
        quality={80}
        className="object-cover -z-10"
      />

      {/* NARA Canvas on top */}
      <BitCanvas ... />
    </div>
  );
}
```

### Option B: CSS Background (Simpler)
```typescript
// app/page.tsx
export default function Home() {
  return (
    <div
      className="w-screen h-screen"
      style={{
        backgroundImage: 'url(/intro-bg.webp)',
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}
    >
      <BitCanvas ... />
    </div>
  );
}
```

### Option C: Preload + Canvas (Most Control)
```typescript
// app/page.tsx
useEffect(() => {
  const img = new Image();
  img.src = '/intro-bg.webp';
  img.onload = () => {
    // Draw to canvas or set as background
    setImageLoaded(true);
  };
}, []);
```

## Expected Performance

### With Optimized WebP Images:
```
Timeline:
0ms    - HTML loads
0ms    - Image download starts (parallel with JS)
220ms  - JS loads, NARA renders
280ms  - Image fully loaded (100KB WebP)
-----
TOTAL: 280ms ✅ Under 500ms
```

### With CDN Caching (Subsequent Loads):
```
Timeline:
0ms    - HTML loads
0ms    - Image download starts
20ms   - Image loads from CDN edge
220ms  - JS loads, NARA renders
-----
TOTAL: 220ms ✅✅ Blazing
```

## Image Preparation Workflow

### 1. Create Optimized Assets
```bash
# Install WebP tools
brew install webp  # macOS
apt-get install webp  # Linux

# Convert and optimize
cwebp -q 80 -resize 1920 1080 original.jpg -o intro-bg.webp

# Check file size (should be <100KB)
ls -lh intro-bg.webp
```

### 2. Test Load Time
```bash
# Simulate slow 3G (should still be <500ms)
# Chrome DevTools -> Network -> Throttling -> Slow 3G
```

### 3. Place in /public Directory
```
/public
  /intro-bg.webp        (desktop)
  /intro-bg-mobile.webp (mobile, smaller)
```

## Recommended Image Sizes

```
Desktop (1920x1080):  ~80-100KB WebP
Tablet (1200x1800):   ~60-80KB WebP
Mobile (800x1200):    ~40-60KB WebP
```

## Fallback Strategy

If image takes >280ms:
1. Show NARA on black (always instant)
2. Fade in background when ready
3. User never sees "loading"

```typescript
const [bgLoaded, setBgLoaded] = useState(false);

<div
  className={`bg-black transition-opacity duration-300 ${bgLoaded ? 'opacity-100' : 'opacity-0'}`}
  style={{ backgroundImage: 'url(/intro-bg.webp)' }}
/>
```

## Testing Checklist

- [ ] Image size <100KB
- [ ] WebP format
- [ ] Preload link in <head>
- [ ] priority={true} on Next/Image
- [ ] Test on Slow 3G (DevTools)
- [ ] Verify <500ms total load
- [ ] Check CDN edge caching works

## Real-World Performance

On typical connections:
- Fast 4G:  ~50ms for 100KB
- Slow 4G:  ~200ms for 100KB
- 3G:       ~400ms for 100KB
- Wifi:     ~20ms for 100KB

With these optimizations, you'll hit <500ms on most connections.
