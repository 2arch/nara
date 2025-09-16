# HandleWheel Implementation for Infinite Grid Navigation

## Overview
The infinite grid component uses a sophisticated handleWheel implementation that enables seamless navigation through an infinite 3D space using trackpad gestures. The system combines chunk-based rendering with intelligent gesture detection to create a fluid, infinite navigation experience.

## Core Architecture

### 1. Chunk-Based Infinite Grid System
The grid is constructed using a chunk-based approach where each chunk represents a 5x5x5 section of voxels:

```javascript
const chunkSize = 5; // Size of each chunk
const renderDistance = 1; // Number of chunks to render in each direction

const generateChunk = (chunkX, chunkY, chunkZ) => {
  const chunk = new THREE.Group();
  chunk.name = `chunk_${chunkX}_${chunkY}_${chunkZ}`;
  
  for (let x = 0; x < chunkSize; x++) {
    for (let y = 0; y < chunkSize; y++) {
      for (let z = 0; z < chunkSize; z++) {
        // Create dots at each grid position
        const dot = new THREE.Mesh(dotGeometry, material);
        dot.position.set(x, y, z);
        chunk.add(dot);
      }
    }
  }
  
  chunk.position.set(chunkX * chunkSize, chunkY * chunkSize, chunkZ * chunkSize);
  return chunk;
};
```

### 2. HandleWheel Implementation
The handleWheel function differentiates between trackpad gestures and mouse wheel events:

```javascript
const handleWheel = (event) => {
  event.preventDefault();
  const panSpeed = 0.1;    // Controls pan sensitivity
  const zoomSpeed = 0.02;  // Controls zoom sensitivity
  
  // Trackpad detection: trackpads typically have lower deltaY values
  if (Math.abs(event.deltaY) < 50) {
    if (event.ctrlKey) {
      // Pinch-to-zoom gesture (Ctrl + wheel or trackpad pinch)
      const zoomDelta = -event.deltaY * zoomSpeed;
      const moveVector = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(camera.quaternion);
      moveVector.multiplyScalar(zoomDelta);
      camera.position.add(moveVector);
    } else {
      // Two-finger swipe for panning
      camera.position.x -= event.deltaX * panSpeed;
      camera.position.y += event.deltaY * panSpeed;
    }
  }
};

// Event listener registration
window.addEventListener('wheel', handleWheel, { passive: false });
```

### 3. Dynamic Chunk Management
The system continuously updates visible chunks based on camera position:

```javascript
const updateVisibleChunks = () => {
  // Calculate which chunk the camera is currently in
  const cameraChunkX = Math.floor(camera.position.x / chunkSize);
  const cameraChunkY = Math.floor(camera.position.y / chunkSize);
  const cameraChunkZ = Math.floor(camera.position.z / chunkSize);
  
  // Load chunks within render distance
  for (let x = -renderDistance; x <= renderDistance; x++) {
    for (let y = -renderDistance; y <= renderDistance; y++) {
      for (let z = -renderDistance; z <= renderDistance; z++) {
        const chunkX = cameraChunkX + x;
        const chunkY = cameraChunkY + y;
        const chunkZ = cameraChunkZ + z;
        const chunkName = `chunk_${chunkX}_${chunkY}_${chunkZ}`;
        
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
      if (Math.abs(x - cameraChunkX) > renderDistance ||
          Math.abs(y - cameraChunkY) > renderDistance ||
          Math.abs(z - cameraChunkZ) > renderDistance) {
        scene.remove(child);
      }
    }
  });
};
```

## How Infinite Navigation Works

### 1. **Gesture Detection**
- The system detects trackpad input by checking `deltaY` magnitude (< 50)
- Higher values typically indicate mouse wheel scrolling
- Lower values indicate trackpad gestures

### 2. **Pan Navigation** (Two-finger swipe)
- Horizontal swipe (`deltaX`) moves camera along X-axis
- Vertical swipe (`deltaY`) moves camera along Y-axis
- Pan speed is adjustable via `panSpeed` parameter

### 3. **Zoom Navigation** (Pinch gesture)
- Detected when `ctrlKey` is pressed with wheel event
- Zoom moves camera along its forward vector
- Maintains proper orientation during zoom

### 4. **Infinite Grid Illusion**
- As camera moves, `updateVisibleChunks()` runs each frame
- New chunks load seamlessly at grid boundaries
- Old chunks unload to maintain performance
- Creates illusion of infinite space

## Key Features

1. **Performance Optimization**
   - Only renders chunks within `renderDistance`
   - Automatically garbage collects distant chunks
   - Efficient chunk naming for fast lookup

2. **Smooth Navigation**
   - Configurable pan and zoom speeds
   - Natural trackpad gesture support
   - Prevents default browser scrolling

3. **Coordinate System**
   - Each chunk has world coordinates
   - Dots within chunks have local positions
   - Camera position determines visible chunks

## Usage Tips

1. **Two-finger swipe**: Pan across the infinite grid
2. **Pinch gesture**: Zoom in/out while maintaining orientation
3. **Adjust sensitivity**: Modify `panSpeed` and `zoomSpeed` for different devices
4. **Render distance**: Increase for more visible chunks (impacts performance)

## Technical Considerations

- The `passive: false` option on the wheel event listener is crucial for preventing default browser behavior
- Chunk size and render distance can be adjusted based on performance requirements
- The system scales well for large coordinate spaces due to dynamic loading
- Memory usage remains constant as chunks are loaded/unloaded dynamically