# Building a 3D Infinite Grid Interface with Natural Navigation

A comprehensive guide to implementing a smooth, infinite 3D voxel grid with trackpad panning and command+scroll depth navigation.

## Core Concept

The interface creates an illusion of infinite space by dynamically generating and removing "chunks" of 3D content around the user's camera position. Users navigate naturally using trackpad gestures for 2D panning and Cmd+scroll for forward/backward movement.

## Architecture Overview

### 1. Chunk-Based Infinite Grid System

**Principle**: Instead of rendering an actually infinite grid, maintain only a small number of chunks around the camera.

```typescript
interface ChunkSystem {
  chunkSize: number;      // Size of each chunk (e.g., 5x5x5 voxels)
  renderDistance: number; // How many chunks to render in each direction
  camera: THREE.Camera;   // Current camera position
}

// Key function: Update visible chunks based on camera position
function updateVisibleChunks(camera: THREE.Camera, scene: THREE.Scene) {
  const cameraChunkX = Math.floor(camera.position.x / chunkSize);
  const cameraChunkY = Math.floor(camera.position.y / chunkSize);
  const cameraChunkZ = Math.floor(camera.position.z / chunkSize);

  // Generate chunks in render distance
  for (let x = -renderDistance; x <= renderDistance; x++) {
    for (let y = -renderDistance; y <= renderDistance; y++) {
      for (let z = -renderDistance; z <= renderDistance; z++) {
        const chunkX = cameraChunkX + x;
        const chunkY = cameraChunkY + y;
        const chunkZ = cameraChunkZ + z;
        const chunkName = `chunk_${chunkX}_${chunkY}_${chunkZ}`;

        // Only create if doesn't exist
        if (!scene.getObjectByName(chunkName)) {
          const chunk = generateChunk(chunkX, chunkY, chunkZ);
          scene.add(chunk);
        }
      }
    }
  }

  // Remove chunks outside render distance
  scene.children.forEach(child => {
    if (child.name.startsWith('chunk_')) {
      const [, x, y, z] = child.name.split('_').map(Number);
      if (
        Math.abs(x - cameraChunkX) > renderDistance ||
        Math.abs(y - cameraChunkY) > renderDistance ||
        Math.abs(z - cameraChunkZ) > renderDistance
      ) {
        scene.remove(child);
        // Dispose of geometry/materials to prevent memory leaks
        child.traverse((object) => {
          if (object.geometry) object.geometry.dispose();
          if (object.material) object.material.dispose();
        });
      }
    }
  });
}
```

### 2. Chunk Generation

```typescript
function generateChunk(chunkX: number, chunkY: number, chunkZ: number): THREE.Group {
  const chunk = new THREE.Group();
  chunk.name = `chunk_${chunkX}_${chunkY}_${chunkZ}`;

  const dotGeometry = new THREE.SphereGeometry(0.15, 8, 8);
  const material = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    opacity: 1.0,
    transparent: true
  });

  // Generate voxels within chunk
  for (let x = 0; x < chunkSize; x++) {
    for (let y = 0; y < chunkSize; y++) {
      for (let z = 0; z < chunkSize; z++) {
        const dot = new THREE.Mesh(dotGeometry, material);
        dot.position.set(x, y, z);
        chunk.add(dot);
      }
    }
  }

  // Position chunk in world space
  chunk.position.set(
    chunkX * chunkSize, 
    chunkY * chunkSize, 
    chunkZ * chunkSize
  );

  return chunk;
}
```

## Natural Navigation Implementation

### 3. Trackpad-Optimized Wheel Event Handler

**Key Insight**: Trackpad gestures have different characteristics than mouse wheel events - smaller `deltaY` values and provide `deltaX` for horizontal scrolling.

```typescript
function handleWheel(event: WheelEvent, camera: THREE.Camera) {
  event.preventDefault();

  const panSpeed = 0.1;
  const zoomSpeed = 0.02;

  // Distinguish trackpad from mouse wheel
  const isTrackpadGesture = Math.abs(event.deltaY) < 50;

  if (isTrackpadGesture) {
    if (event.ctrlKey || event.metaKey) {
      // Cmd+scroll or pinch: Forward/backward movement
      handleDepthMovement(event, camera, zoomSpeed);
    } else {
      // Natural 2D panning
      handleTrackpadPan(event, camera, panSpeed);
    }
  } else {
    // Mouse wheel: Only depth movement with modifier
    if (event.ctrlKey || event.metaKey) {
      handleDepthMovement(event, camera, zoomSpeed);
    }
  }
}

function handleTrackpadPan(event: WheelEvent, camera: THREE.Camera, panSpeed: number) {
  // Get camera's local coordinate system
  const rightVector = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const upVector = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

  // Calculate movement in camera space
  const movement = new THREE.Vector3()
    .addScaledVector(rightVector, -event.deltaX * panSpeed)
    .addScaledVector(upVector, event.deltaY * panSpeed);

  camera.position.add(movement);
}

function handleDepthMovement(event: WheelEvent, camera: THREE.Camera, zoomSpeed: number) {
  const zoomDelta = -event.deltaY * zoomSpeed;
  const forwardVector = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  forwardVector.multiplyScalar(zoomDelta);
  camera.position.add(forwardVector);
}
```

### 4. Event Listener Setup

```typescript
useEffect(() => {
  const wheelHandler = (event: WheelEvent) => handleWheel(event, camera);
  
  // Important: passive: false allows preventDefault()
  window.addEventListener('wheel', wheelHandler, { passive: false });

  return () => {
    window.removeEventListener('wheel', wheelHandler);
  };
}, [camera]);
```

## Performance Optimizations

### 5. Dynamic Grid Opacity

```typescript
function updateGridOpacity(targetOpacity: number, material: THREE.Material) {
  // Use GSAP or similar for smooth transitions
  gsap.to(material, {
    opacity: targetOpacity,
    duration: 0.9
  });
}

// Show grid during movement, hide when static
const handleMouseDown = () => {
  updateGridOpacity(1.0, gridMaterial);
};

const handleMouseUp = () => {
  updateGridOpacity(0.00075, gridMaterial);
};
```

### 6. Memory Management

```typescript
function disposeChunk(chunk: THREE.Group) {
  chunk.traverse((object) => {
    if (object.geometry) {
      object.geometry.dispose();
    }
    if (object.material) {
      if (Array.isArray(object.material)) {
        object.material.forEach(material => material.dispose());
      } else {
        object.material.dispose();
      }
    }
  });
}
```

## React/TypeScript Implementation Pattern

### 7. Component Structure

```typescript
interface InfiniteGridProps {
  chunkSize?: number;
  renderDistance?: number;
  voxelSize?: number;
}

const InfiniteGrid: React.FC<InfiniteGridProps> = ({ 
  chunkSize = 5, 
  renderDistance = 1, 
  voxelSize = 0.15 
}) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene>();
  const cameraRef = useRef<THREE.Camera>();
  const rendererRef = useRef<THREE.WebGLRenderer>();

  useEffect(() => {
    // Scene initialization
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2500);
    const renderer = new THREE.WebGLRenderer({ antialias: true });

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;

    // Setup and animation loop
    setupScene(scene, camera, renderer);
    startAnimationLoop(scene, camera, renderer);

    return () => {
      cleanup(scene, renderer);
    };
  }, []);

  return <div ref={canvasRef} className="infinite-grid-container" />;
};
```

## Key Implementation Details

### 8. Animation Loop Integration

```typescript
function animate(scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
  // Update chunks every frame
  updateVisibleChunks(camera, scene);
  
  // Render
  renderer.render(scene, camera);
  
  requestAnimationFrame(() => animate(scene, camera, renderer));
}
```

### 9. Camera Configuration

```typescript
function setupCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2500);
  camera.position.set(0, 2.5, 1);
  
  // Optional: Add fog for depth perception
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 1, 7);
  
  return camera;
}
```

## Result

This architecture provides:
- **Infinite navigation** through chunked content generation
- **Natural trackpad controls** with horizontal/vertical panning
- **Intuitive depth control** via Cmd+scroll
- **Smooth performance** through dynamic chunk management
- **Memory efficiency** via proper disposal of out-of-range chunks

The system scales efficiently and provides a seamless navigation experience that feels natural on modern trackpads while maintaining high performance through intelligent rendering distance management.