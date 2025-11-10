# Face-Piloted Geometry Integration

This document explains how to integrate the face detection system with the 3D geometry monogram to create face-controlled visualizations.

## Architecture Overview

```
Webcam Stream → MediaPipe Face Detection → Face Orientation → Monogram Rotation → 3D Geometry
```

## Components

### 1. Face Detection (`app/bitworld/face.ts`)
- **`useFaceDetection`**: Main hook for face tracking
- **`useSmoothFaceOrientation`**: Smooths orientation data to reduce jitter
- **`faceOrientationToRotation`**: Converts face orientation to 3D rotation angles

### 2. Monogram System (`app/bitworld/monogram.ts`)
- **`externalRotation`**: New option to override time-based rotation
- **`setExternalRotation`**: Method to update rotation from external source
- **`calculate3DGeometry`**: Uses external rotation when available (lines 472-484)

## Integration Pattern

### Basic Setup in a Component

```typescript
import { useFaceDetection, useSmoothFaceOrientation, faceOrientationToRotation } from './face';
import { useMonogramSystem } from './monogram';

function FacePilotedMonogram({ videoStream }: { videoStream: MediaStream | null }) {
    // Initialize monogram system
    const monogram = useMonogramSystem({
        mode: 'geometry3d',
        geometryType: 'octahedron', // or 'cube', 'sphere', 'torus'
        enabled: true,
        speed: 0.5,
        complexity: 1.0,
        colorShift: 0,
        interactiveTrails: true,
        trailIntensity: 1.0,
        trailFadeMs: 2000
    });

    // Initialize face detection
    const { faceData, isReady, error, hasDetection } = useFaceDetection({
        enabled: true,
        videoStream,
        onFaceDetected: (data) => {
            console.log('Face detected:', data.orientation);
        }
    });

    // Smooth the face orientation to reduce jitter
    const smoothOrientation = useSmoothFaceOrientation(faceData, 0.3);

    // Update monogram rotation based on face orientation
    useEffect(() => {
        if (hasDetection && faceData) {
            const rotation = faceOrientationToRotation(smoothOrientation);
            monogram.setExternalRotation(rotation);
        } else {
            // Fall back to time-based rotation when no face detected
            monogram.setExternalRotation(undefined);
        }
    }, [smoothOrientation, hasDetection, faceData]);

    return (
        <div>
            {error && <div>Error: {error}</div>}
            {!isReady && <div>Loading face detection...</div>}
            {isReady && !hasDetection && <div>No face detected</div>}
            {/* Your monogram rendering here */}
        </div>
    );
}
```

## Integration with Existing Webcam System

The webcam system already exists in `commands.ts` (lines 1392-1433). Here's how to integrate:

### Step 1: Add Face Detection to Commands System

In `app/bitworld/commands.ts`, add face detection hook:

```typescript
import { useFaceDetection, useSmoothFaceOrientation, faceOrientationToRotation } from './face';

// Inside useCommandSystem hook:
const { faceData, isReady: faceReady, hasDetection } = useFaceDetection({
    enabled: modeState.backgroundMode === 'stream',
    videoStream: backgroundStreamRef.current,
});

const smoothOrientation = useSmoothFaceOrientation(faceData, 0.3);
```

### Step 2: Connect to Monogram System

The monogram system is used in `bit.canvas.tsx`. You'll need to pass the face orientation data:

```typescript
// In bit.canvas.tsx, add face orientation to engine interface
interface WorldEngine {
    // ... existing fields
    faceOrientation?: {
        rotX: number;
        rotY: number;
        rotZ: number;
    };
}

// Update monogram pattern generation to use face orientation
if (engine.faceOrientation) {
    monogramSystem.setExternalRotation(engine.faceOrientation);
}
```

### Step 3: Update Webcam Command

Modify the `/bg webcam` command to enable face-piloted mode:

```typescript
// In commands.ts, after webcam stream is set up:
if (bgArg.toLowerCase() === 'webcam') {
    // ... existing webcam setup code

    // Enable geometry3d monogram for face piloting
    updateOption('mode', 'geometry3d');
    updateOption('enabled', true);

    setDialogueWithRevert(
        `Face-piloted geometry active (${cameraLabel} camera)`,
        setDialogueText
    );
}
```

## Advanced Configuration

### Adjust Sensitivity

Control how responsive the geometry is to face movements:

```typescript
// More smoothing = less jitter, slower response
const smoothOrientation = useSmoothFaceOrientation(faceData, 0.5);

// Less smoothing = more responsive, more jitter
const smoothOrientation = useSmoothFaceOrientation(faceData, 0.1);
```

### Invert Axes

Make the controls feel more natural by inverting certain axes:

```typescript
const rotation = faceOrientationToRotation(
    smoothOrientation,
    true,  // invertYaw: turn head left → geometry rotates right
    false, // invertPitch: natural up/down
    false  // invertRoll: natural tilt
);
```

### Switch Geometry Types

```typescript
// Cube - simple and clear
monogram.updateOption('geometryType', 'cube');

// Octahedron - balanced complexity (default)
monogram.updateOption('geometryType', 'octahedron');

// Sphere - smooth and organic
monogram.updateOption('geometryType', 'sphere');

// Torus - complex and interesting
monogram.updateOption('geometryType', 'torus');
```

## Performance Considerations

1. **Frame Rate**: Face detection runs at ~30fps (throttled in `face.ts:154`)
2. **GPU Acceleration**: MediaPipe uses GPU when available
3. **Single Face**: Currently tracks 1 face for optimal performance
4. **CDN Loading**: MediaPipe models load from CDN (~3-5MB)

## Testing Commands

```bash
# Start webcam with front camera
/bg webcam front

# Start webcam with back camera (default)
/bg webcam back

# Switch to geometry3d monogram (if not automatic)
/mono geometry3d

# Adjust complexity
/mono complexity 1.5

# Disable face control (return to time-based)
# Just stop the webcam or disable face detection
```

## File Reference

- **Face System**: `app/bitworld/face.ts` (new)
- **Monogram System**: `app/bitworld/monogram.ts` (modified lines 58-77, 472-484, 1479-1494)
- **Webcam Command**: `app/bitworld/commands.ts` (lines 1392-1433)
- **Canvas Rendering**: `app/bitworld/bit.canvas.tsx` (monogram rendering)
- **World Engine**: `app/bitworld/world.engine.ts` (state management)

## Next Steps

1. Wire up face detection in `commands.ts` when webcam is active
2. Pass face orientation through `world.engine.ts` interface
3. Connect to monogram in `bit.canvas.tsx`
4. Test with different geometry types
5. Fine-tune smoothing and sensitivity
6. Add UI indicators for face detection status

## Future Enhancements

- **Expression Control**: Use blendshapes for geometry complexity/color
- **Multiple Geometries**: Spawn multiple geometries for each face detected
- **Recording**: Capture face-piloted geometry animations
- **Calibration**: Let users calibrate neutral position
- **Gesture Triggers**: Use expressions (smile, blink) to trigger effects
