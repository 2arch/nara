'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';

interface Grid3DBackgroundProps {
  chunkSize?: number;
  renderDistance?: number;
  voxelSize?: number;
  viewOffset?: { x: number; y: number }; // Sync with BitCanvas view offset
  zoomLevel?: number; // Sync with BitCanvas zoom
}

const Grid3DBackground: React.FC<Grid3DBackgroundProps> = ({ 
  chunkSize = 10, 
  renderDistance = 2, 
  voxelSize = 0.1,
  viewOffset = { x: 0, y: 0 },
  zoomLevel = 1
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const chunksRef = useRef<Map<string, THREE.Group>>(new Map());
  const animationFrameRef = useRef<number | null>(null);

  // Navigation state
  const isPanningRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });

  const generateChunk = useCallback((chunkX: number, chunkY: number, chunkZ: number): THREE.Group => {
    const chunk = new THREE.Group();
    chunk.name = `chunk_${chunkX}_${chunkY}_${chunkZ}`;

    // Create instanced geometry for better performance
    const dotGeometry = new THREE.SphereGeometry(voxelSize, 4, 4);
    const material = new THREE.MeshBasicMaterial({
      color: '#4A90E2',
      opacity: 0.6,
      transparent: true
    });

    // Generate grid points within chunk
    for (let x = 0; x < chunkSize; x++) {
      for (let y = 0; y < chunkSize; y++) {
        for (let z = 0; z < chunkSize; z++) {
          // Only show grid intersection points (not every voxel)
          if (x % 2 === 0 && y % 2 === 0 && z % 2 === 0) {
            const dot = new THREE.Mesh(dotGeometry, material);
            dot.position.set(
              chunkX * chunkSize + x,
              chunkY * chunkSize + y,
              chunkZ * chunkSize + z
            );
            chunk.add(dot);
          }
        }
      }
    }

    return chunk;
  }, [chunkSize, voxelSize]);

  const updateVisibleChunks = useCallback(() => {
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    if (!camera || !scene) return;

    const cameraChunkX = Math.floor(camera.position.x / chunkSize);
    const cameraChunkY = Math.floor(camera.position.y / chunkSize);
    const cameraChunkZ = Math.floor(camera.position.z / chunkSize);

    const activeChunks = new Set<string>();

    // Generate chunks in render distance
    for (let x = -renderDistance; x <= renderDistance; x++) {
      for (let y = -renderDistance; y <= renderDistance; y++) {
        for (let z = -renderDistance; z <= renderDistance; z++) {
          const chunkX = cameraChunkX + x;
          const chunkY = cameraChunkY + y;
          const chunkZ = cameraChunkZ + z;
          const chunkName = `chunk_${chunkX}_${chunkY}_${chunkZ}`;
          
          activeChunks.add(chunkName);

          // Only create if doesn't exist
          if (!chunksRef.current.has(chunkName)) {
            const chunk = generateChunk(chunkX, chunkY, chunkZ);
            scene.add(chunk);
            chunksRef.current.set(chunkName, chunk);
          }
        }
      }
    }

    // Remove chunks outside render distance
    const chunksToRemove: string[] = [];
    chunksRef.current.forEach((chunk, chunkName) => {
      if (!activeChunks.has(chunkName)) {
        scene.remove(chunk);
        // Dispose of geometry/materials to prevent memory leaks
        chunk.traverse((object) => {
          if ((object as THREE.Mesh).geometry) {
            (object as THREE.Mesh).geometry.dispose();
          }
          if ((object as THREE.Mesh).material) {
            const material = (object as THREE.Mesh).material;
            if (Array.isArray(material)) {
              material.forEach(mat => mat.dispose());
            } else {
              material.dispose();
            }
          }
        });
        chunksToRemove.push(chunkName);
      }
    });

    chunksToRemove.forEach(chunkName => {
      chunksRef.current.delete(chunkName);
    });
  }, [chunkSize, renderDistance, generateChunk]);

  // Sync camera position with BitCanvas navigation
  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;

    // Map 2D BitCanvas position to 3D camera position
    // Scale factors to make movement feel natural
    const scaleX = 2.0;
    const scaleY = 2.0;
    const scaleZ = 10.0; // Zoom affects Z position

    camera.position.x = viewOffset.x * scaleX;
    camera.position.y = -viewOffset.y * scaleY; // Invert Y to match coordinate systems
    camera.position.z = 10 + (1 / zoomLevel) * scaleZ; // Higher zoom = closer to grid
  }, [viewOffset, zoomLevel]);

  const animate = useCallback(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;

    if (renderer && scene && camera) {
      updateVisibleChunks();
      renderer.render(scene, camera);
    }
    
    animationFrameRef.current = requestAnimationFrame(animate);
  }, [updateVisibleChunks]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Setup scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Add fog for depth perception
    const fogColor = new THREE.Color(0x000000);
    scene.fog = new THREE.Fog(fogColor, 5, 50);

    // Setup camera
    const camera = new THREE.PerspectiveCamera(
      75, 
      window.innerWidth / window.innerHeight, 
      0.1, 
      1000
    );
    camera.position.set(0, 5, 10);
    cameraRef.current = camera;

    // Setup renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0.8); // Slightly transparent black
    
    // Style the canvas element
    renderer.domElement.style.pointerEvents = 'none';
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Start animation loop
    animate();

    // Handle window resize
    const handleResize = () => {
      if (!camera || !renderer) return;
      
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    
    window.addEventListener('resize', handleResize);

    // No need for wheel event listener - we sync with BitCanvas navigation

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      if (containerRef.current && renderer) {
        containerRef.current.removeChild(renderer.domElement);
      }
      
      // Dispose of all chunks
      chunksRef.current.forEach((chunk) => {
        scene.remove(chunk);
        chunk.traverse((object) => {
          if ((object as THREE.Mesh).geometry) {
            (object as THREE.Mesh).geometry.dispose();
          }
          if ((object as THREE.Mesh).material) {
            const material = (object as THREE.Mesh).material;
            if (Array.isArray(material)) {
              material.forEach(mat => mat.dispose());
            } else {
              material.dispose();
            }
          }
        });
      });
      chunksRef.current.clear();
      
      renderer?.dispose();
    };
  }, [animate]);

  return (
    <div 
      ref={containerRef} 
      style={{ 
        position: 'fixed', 
        top: 0, 
        left: 0, 
        width: '100%', 
        height: '100%', 
        zIndex: 0
      }}
    />
  );
};

export default Grid3DBackground;