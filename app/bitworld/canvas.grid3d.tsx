'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass';
import { SepiaShader, CoronaShader } from './shaders';

export type GridMode = 'dots' | 'lines';
export type ArtifactType = 'images' | 'questions';

interface Grid3DBackgroundProps {
  chunkSize?: number;
  renderDistance?: number;
  voxelSize?: number;
  viewOffset?: { x: number; y: number }; // Sync with BitCanvas view offset
  zoomLevel?: number; // Sync with BitCanvas zoom
  gridMode?: GridMode; // Grid rendering mode
  artefactsEnabled?: boolean; // Whether to show 3D artifacts
  artifactType?: ArtifactType; // Type of artifacts to show (images or questions)
  getCompiledText?: () => { [lineY: number]: string }; // Access to compiled text from world engine
  compiledTextCache?: { [lineY: number]: string }; // Direct access to compiled text cache for updates
}

const Grid3DBackground: React.FC<Grid3DBackgroundProps> = ({ 
  chunkSize = 10, 
  renderDistance = 2, 
  voxelSize = 0.1,
  viewOffset = { x: 0, y: 0 },
  zoomLevel = 1,
  gridMode = 'dots',
  artefactsEnabled = true,
  artifactType = 'images',
  getCompiledText,
  compiledTextCache
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const labelRendererRef = useRef<CSS2DRenderer | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const chunksRef = useRef<Map<string, THREE.Group>>(new Map());
  const artifactsRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const fadingArtifactsRef = useRef<Map<string, {mesh: THREE.Mesh, startTime: number, duration: number}>>(new Map());
  const fadingInArtifactsRef = useRef<Map<string, {mesh: THREE.Mesh, startTime: number, duration: number}>>(new Map());
  const animationFrameRef = useRef<number | null>(null);
  const arenaBlocksRef = useRef<any[]>([]);
  const preloadedImagesRef = useRef<Map<number, HTMLImageElement>>(new Map());
  const arenaLoadingRef = useRef<boolean>(false);
  const arenaLoadedRef = useRef<boolean>(false);
  const imagesPreloadedRef = useRef<boolean>(false);
  
  // Smooth camera animation
  const targetCameraPosition = useRef({ x: 0, y: 0, z: 10 });
  const currentCameraPosition = useRef({ x: 0, y: 0, z: 10 });
  
  // Track zoom changes to prevent X/Y drift
  const lastZoomLevel = useRef(zoomLevel);
  const isZooming = useRef(false);

  // Navigation state
  const isPanningRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  
  // Performance optimization refs
  const lastChunkUpdatePosition = useRef({ x: 0, y: 0, z: 0 });
  const lastArtifactUpdatePosition = useRef({ x: 0, y: 0, z: 0 });
  const lastChunkUpdateTime = useRef(0);
  const lastArtifactUpdateTime = useRef(0);
  const frameCount = useRef(0);
  
  // Artifact generation around camera
  const ARTIFACT_COUNT = 12;
  const ARTIFACT_SPAWN_RADIUS = 10; // Spawn closer to camera
  const ARTIFACT_DESPAWN_RADIUS = 25; // Despawn further away
  
  // Performance optimization constants
  const CHUNK_UPDATE_THRESHOLD = 2.0; // Only update chunks if camera moved > 2 units
  const ARTIFACT_UPDATE_THRESHOLD = 3.0; // Only update artifacts if camera moved > 3 units  
  const CHUNK_UPDATE_INTERVAL = 100; // Min 100ms between chunk updates
  const ARTIFACT_UPDATE_INTERVAL = 150; // Min 150ms between artifact updates
  const EXPENSIVE_OP_FRAME_INTERVAL = 3; // Only do expensive ops every 3rd frame
  const FADE_OUT_DURATION = 1200; // 1200ms fade out duration for smoother effect
  const FADE_IN_DURATION = 800; // 800ms fade in duration
  
  // Clear artifacts when artifact type changes
  const lastArtifactTypeRef = useRef<ArtifactType>(artifactType);
  const artifactCleanupTimeoutRef = useRef<number | null>(null);
  
  useEffect(() => {
    if (lastArtifactTypeRef.current !== artifactType) {
      lastArtifactTypeRef.current = artifactType;
      
      // Clear all existing artifacts when type changes
      const scene = sceneRef.current;
      if (scene) {
        // Clear active artifacts
        artifactsRef.current.forEach((artifact) => {
          scene.remove(artifact);
          artifact.traverse((child) => {
            if (child instanceof CSS2DObject) {
              if (child.element && child.element.parentNode) {
                child.element.parentNode.removeChild(child.element);
              }
            }
          });
          if (artifact.geometry) artifact.geometry.dispose();
          if (artifact.material) {
            if (Array.isArray(artifact.material)) {
              artifact.material.forEach(mat => mat.dispose());
            } else {
              (artifact.material as THREE.Material).dispose();
            }
          }
        });
        artifactsRef.current.clear();
        
        // Clear fading artifacts
        fadingArtifactsRef.current.forEach((fadingArtifact) => {
          scene.remove(fadingArtifact.mesh);
          fadingArtifact.mesh.traverse((child) => {
            if (child instanceof CSS2DObject) {
              if (child.element && child.element.parentNode) {
                child.element.parentNode.removeChild(child.element);
              }
            }
          });
          fadingArtifact.mesh.geometry.dispose();
          (fadingArtifact.mesh.material as THREE.Material).dispose();
        });
        fadingArtifactsRef.current.clear();
        
        // Clear fading-in artifacts
        fadingInArtifactsRef.current.forEach((fadingInArtifact) => {
          scene.remove(fadingInArtifact.mesh);
          fadingInArtifact.mesh.traverse((child) => {
            if (child instanceof CSS2DObject) {
              if (child.element && child.element.parentNode) {
                child.element.parentNode.removeChild(child.element);
              }
            }
          });
          fadingInArtifact.mesh.geometry.dispose();
          (fadingInArtifact.mesh.material as THREE.Material).dispose();
        });
        fadingInArtifactsRef.current.clear();
        
        
        // Clear any pending cleanup timeout
        if (artifactCleanupTimeoutRef.current) {
          clearTimeout(artifactCleanupTimeoutRef.current);
        }
        
        // Add a small delay before allowing new artifacts to be created
        artifactCleanupTimeoutRef.current = window.setTimeout(() => {
        }, 500);
      }
    }
  }, [artifactType]);

  // Update questions content when compiled text changes
  useEffect(() => {
    if (artifactType === 'questions' && compiledTextCache) {
      // Only update existing question artifacts, don't recreate them
      const contentLines = Object.values(compiledTextCache);
      let questionsText = 'A space for your biggest questions.';
      if (contentLines.length > 0) {
        // Get the latest/most recent line instead of joining all lines
        const latestLine = contentLines[contentLines.length - 1];
        questionsText = latestLine?.trim() || questionsText;
      }
      
      // Update text content for all existing question artifacts
      artifactsRef.current.forEach((artifact) => {
        artifact.traverse((child) => {
          if (child instanceof CSS2DObject) {
            // Only update if the text has actually changed to avoid unnecessary DOM manipulation
            if (child.element.textContent !== questionsText) {
              child.element.textContent = questionsText;
            }
          }
        });
      });
      
      // Also update fading-in artifacts
      fadingInArtifactsRef.current.forEach((fadingInArtifact) => {
        fadingInArtifact.mesh.traverse((child) => {
          if (child instanceof CSS2DObject) {
            if (child.element.textContent !== questionsText) {
              child.element.textContent = questionsText;
            }
          }
        });
      });
    }
  }, [artifactType, compiledTextCache]);

  
  // Easing functions for smooth animations
  const easeOutCubic = (t: number): number => {
    return 1 - Math.pow(1 - t, 3);
  };
  
  const easeInOutQuad = (t: number): number => {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  };
  
  // Track which blocks we've used to ensure variety
  const usedBlockIndices = useRef<Set<number>>(new Set());

  // Are.na API integration
  const ARENA_TOKEN = 'EPBnDW3mOGKx-IW9nRBX3ig7I-LrQKtWwod68r6Hre0';
  
  // Preload all arena images
  const preloadArenaImages = useCallback(async () => {
    if (imagesPreloadedRef.current || arenaBlocksRef.current.length === 0) return;
    
    
    const imagePromises = arenaBlocksRef.current.map(async (block, index) => {
      if (!block.image) return null;
      
      const imageUrl = block.image.display?.url || block.image.large?.url || block.image.original?.url || block.image.url || block.image.thumb?.url;
      if (!imageUrl) return null;
      
      return new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          preloadedImagesRef.current.set(index, img);
          resolve(img);
        };
        img.onerror = () => {
          resolve(null);
        };
        img.src = imageUrl;
      });
    });
    
    await Promise.all(imagePromises);
    imagesPreloadedRef.current = true;
  }, []);
  
  // Fetch Are.na channel blocks
  const fetchArenaBlocks = useCallback(async () => {
    if (arenaLoadingRef.current || arenaLoadedRef.current) return;
    
    arenaLoadingRef.current = true;
    try {
      // Use the correct API format for channel contents
      const response = await fetch('https://api.are.na/v2/channels/cool-yita1womc2m?per=50', {
        headers: {
          'Authorization': `Bearer ${ARENA_TOKEN}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Arena API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Handle search response structure
      let blocks = [];
      if (data.blocks && Array.isArray(data.blocks)) {
        blocks = data.blocks;
      } else if (data.contents && Array.isArray(data.contents)) {
        blocks = data.contents;
      } else if (Array.isArray(data)) {
        blocks = data;
      } else {
        blocks = [];
      }
      
      
      // Filter for image blocks only
      const imageBlocks = blocks.filter((block: any) => {
        if (block.class === 'Image') {
        }
        
        // Check for any available image URL
        const hasImage = block.class === 'Image' && (
          block.image?.url || 
          block.image?.display?.url || 
          block.image?.large?.url || 
          block.image?.original?.url ||
          block.image?.thumb?.url
        );
        
        return hasImage;
      });
      
      arenaBlocksRef.current = imageBlocks;
      arenaLoadedRef.current = true;
      
      // Start preloading images
      preloadArenaImages();
    } catch (error) {
      console.error('Failed to fetch Arena blocks:', error);
      arenaBlocksRef.current = [];
      arenaLoadedRef.current = true; // Mark as loaded even if failed to prevent infinite retries
    } finally {
      arenaLoadingRef.current = false;
    }
  }, [preloadArenaImages]);


  const generateChunk = useCallback((chunkX: number, chunkY: number, chunkZ: number): THREE.Group => {
    const chunk = new THREE.Group();
    chunk.name = `chunk_${chunkX}_${chunkY}_${chunkZ}`;

    if (gridMode === 'dots') {
      // Create grid point positions
      const positions: number[] = [];
      
      for (let x = 0; x < chunkSize; x++) {
        for (let y = 0; y < chunkSize; y++) {
          for (let z = 0; z < chunkSize; z++) {
            // Show fewer grid points - every 4th position
            if (x % 4 === 0 && y % 4 === 0 && z % 4 === 0) {
              positions.push(
                chunkX * chunkSize + x,
                chunkY * chunkSize + y,
                chunkZ * chunkSize + z
              );
            }
          }
        }
      }
      
      // Create points geometry for grid markers
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color: 0x999999, // Heather gray
        size: 3,
        sizeAttenuation: false
      });
      
      const points = new THREE.Points(geometry, material);
      chunk.add(points);
    } else if (gridMode === 'lines') {
      // Create line grid positions
      const linePositions: number[] = [];
      
      // Grid line spacing - every 4th position like dots
      const spacing = 4;
      
      // Create lines parallel to X axis
      for (let y = 0; y < chunkSize; y += spacing) {
        for (let z = 0; z < chunkSize; z += spacing) {
          linePositions.push(
            chunkX * chunkSize, chunkY * chunkSize + y, chunkZ * chunkSize + z,
            chunkX * chunkSize + chunkSize, chunkY * chunkSize + y, chunkZ * chunkSize + z
          );
        }
      }
      
      // Create lines parallel to Y axis
      for (let x = 0; x < chunkSize; x += spacing) {
        for (let z = 0; z < chunkSize; z += spacing) {
          linePositions.push(
            chunkX * chunkSize + x, chunkY * chunkSize, chunkZ * chunkSize + z,
            chunkX * chunkSize + x, chunkY * chunkSize + chunkSize, chunkZ * chunkSize + z
          );
        }
      }
      
      // Create lines parallel to Z axis
      for (let x = 0; x < chunkSize; x += spacing) {
        for (let y = 0; y < chunkSize; y += spacing) {
          linePositions.push(
            chunkX * chunkSize + x, chunkY * chunkSize + y, chunkZ * chunkSize,
            chunkX * chunkSize + x, chunkY * chunkSize + y, chunkZ * chunkSize + chunkSize
          );
        }
      }
      
      // Create line geometry
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
      const lineMaterial = new THREE.LineBasicMaterial({
        color: 0xc2c2c2, // Heather gray
        transparent: true,
        opacity: 0.6
      });
      
      const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
      chunk.add(lines);
    }

    return chunk;
  }, [chunkSize, voxelSize, gridMode]);
  
  
  
  const createArtifact = useCallback((position: {x: number, y: number, z: number, size: number, id: number}) => {
    let mesh: THREE.Object3D;
    
    // Use simple point geometry for all artifacts (including questions)
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    const material = new THREE.PointsMaterial({
      color: 0x999999, // Heather gray
      size: 0.5,
      sizeAttenuation: false
    });
    
    mesh = new THREE.Points(geometry, material);
    
    mesh.position.set(position.x, position.y, position.z);
    
    // Create CSS2D label
    const labelDiv = document.createElement('div');
    labelDiv.className = 'artifact-label';
    labelDiv.style.pointerEvents = 'none';
    labelDiv.style.borderRadius = '8px';
    labelDiv.style.overflow = 'hidden';
    labelDiv.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
    
    if (artifactType === 'questions') {
      labelDiv.style.cssText = `
        padding: 16px;
        background: transparent;
        font-family: 'Magpie', sans-serif;
        font-weight: regular;
        font-size: 54px;
        line-height: 1.4;
        color: #f2f2f2;
        text-align: center;
        pointer-events: none;
        white-space: pre-wrap;
        word-wrap: break-word;
      `;
      
      // Get compiled text content if available
      let questionsText = 'A space for your biggest questions.';
      if (compiledTextCache) {
        const contentLines = Object.values(compiledTextCache);
        if (contentLines.length > 0) {
          // Use the latest/most recent line instead of joining all lines
          const latestLine = contentLines[contentLines.length - 1];
          questionsText = latestLine?.trim() || questionsText;
        }
      }
      
      labelDiv.textContent = questionsText;
    } else {
      // Handle images artifact type (existing logic)
      // Use preloaded images for artifacts
      if (imagesPreloadedRef.current && preloadedImagesRef.current.size > 0) {
      let blockIndex: number;
      
      // If we haven't used all available blocks, pick the next unused one
      if (usedBlockIndices.current.size < arenaBlocksRef.current.length) {
        // Find next unused block index
        do {
          blockIndex = Math.floor(Math.random() * arenaBlocksRef.current.length);
        } while (usedBlockIndices.current.has(blockIndex));
        
        usedBlockIndices.current.add(blockIndex);
      } else {
        // All blocks used, start cycling through randomly
        blockIndex = Math.floor(Math.random() * arenaBlocksRef.current.length);
      }
      
      const preloadedImage = preloadedImagesRef.current.get(blockIndex);
      const block = arenaBlocksRef.current[blockIndex];
      
      if (preloadedImage && block) {
        // Use preloaded image dimensions
        const originalWidth = preloadedImage.naturalWidth || 400;
        const originalHeight = preloadedImage.naturalHeight || 400;
        
        
        const aspectRatio = originalWidth / originalHeight;
        const maxSize = 120;
        
        let width, height;
        if (aspectRatio > 1) {
          // Landscape
          width = maxSize;
          height = maxSize / aspectRatio;
        } else {
          // Portrait or square
          height = maxSize;
          width = maxSize * aspectRatio;
        }
        
        // Create img element from preloaded image
        const img = preloadedImage.cloneNode() as HTMLImageElement;
        img.style.cssText = `width: ${width}px; height: ${height}px; object-fit: cover; display: block; border-radius: 8px;`;
        img.alt = block.title || `Arena block ${block.id}`;
        
        labelDiv.innerHTML = '';
        labelDiv.appendChild(img);
      } else {
        // No preloaded image available - show placeholder or hide
        labelDiv.innerHTML = '';
        labelDiv.style.display = 'none';
        return null; // Return null instead of throwing error
      }
    } else {
      // Images not preloaded yet - show placeholder or hide  
      labelDiv.innerHTML = '';
      labelDiv.style.display = 'none';
      return null; // Return null instead of throwing error
    }
    }
    
    const label = new CSS2DObject(labelDiv);
    label.position.set(0, 0, 0);
    mesh.add(label);
    
    // Set initial opacity to 0 for fade-in animation
    mesh.userData.opacity = 0.0;
    
    // Set initial CSS opacity to 0
    labelDiv.style.opacity = '0';
    labelDiv.style.transition = 'opacity 16ms ease-out';
    
    
    return mesh;
  }, [artifactType]);

  // Update fading artifacts opacity
  const updateFadingArtifacts = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    
    const now = Date.now();
    const fadingToRemove: string[] = [];
    const fadingInToMove: string[] = [];
    
    fadingArtifactsRef.current.forEach((fadingArtifact, artifactId) => {
      const elapsed = now - fadingArtifact.startTime;
      const linearProgress = Math.min(elapsed / fadingArtifact.duration, 1);
      
      // Apply easing for smoother fade
      const easedProgress = easeInOutQuad(linearProgress);
      const opacity = 1 - easedProgress; // Fade from 1 to 0 with easing
      
      // Update artifact opacity
      fadingArtifact.mesh.userData.opacity = opacity;
      
      // Update label opacity with smoother CSS transition
      fadingArtifact.mesh.traverse((child) => {
        if (child instanceof CSS2DObject) {
          // Use CSS transition for even smoother opacity changes
          if (!child.element.style.transition) {
            child.element.style.transition = 'opacity 16ms ease-out';
          }
          child.element.style.opacity = opacity.toString();
        }
      });
      
      // If fade is complete, remove the artifact
      if (linearProgress >= 1) {
        scene.remove(fadingArtifact.mesh);
        
        // Dispose of CSS2D labels
        fadingArtifact.mesh.traverse((child) => {
          if (child instanceof CSS2DObject) {
            if (child.element && child.element.parentNode) {
              child.element.parentNode.removeChild(child.element);
            }
            child.removeFromParent();
          }
        });
        
        fadingArtifact.mesh.geometry.dispose();
        (fadingArtifact.mesh.material as THREE.Material).dispose();
        fadingToRemove.push(artifactId);
      }
    });
    
    fadingToRemove.forEach(artifactId => {
      fadingArtifactsRef.current.delete(artifactId);
    });
    
    // Handle fade-in animations
    fadingInArtifactsRef.current.forEach((fadingInArtifact, artifactId) => {
      const elapsed = now - fadingInArtifact.startTime;
      const linearProgress = Math.min(elapsed / fadingInArtifact.duration, 1);
      
      // Apply easing for smoother fade-in
      const easedProgress = easeOutCubic(linearProgress);
      const opacity = easedProgress; // Fade from 0 to 1 with easing
      
      // Update artifact opacity
      fadingInArtifact.mesh.userData.opacity = opacity;
      
      // Update label opacity with smooth CSS transition
      fadingInArtifact.mesh.traverse((child) => {
        if (child instanceof CSS2DObject) {
          if (!child.element.style.transition) {
            child.element.style.transition = 'opacity 16ms ease-out';
          }
          child.element.style.opacity = opacity.toString();
        }
      });
      
      // If fade-in is complete, move to active artifacts
      if (linearProgress >= 1) {
        fadingInArtifact.mesh.userData.opacity = 1.0;
        fadingInArtifact.mesh.traverse((child) => {
          if (child instanceof CSS2DObject) {
            child.element.style.opacity = '1';
          }
        });
        artifactsRef.current.set(artifactId, fadingInArtifact.mesh);
        fadingInToMove.push(artifactId);
      }
    });
    
    fadingInToMove.forEach(artifactId => {
      fadingInArtifactsRef.current.delete(artifactId);
    });
  }, []);

  // Separate timing for position updates vs creation logic
  const lastArtifactCreationRef = useRef<number>(0);
  const ARTIFACT_CREATION_COOLDOWN = 1000; // Only limit artifact creation, not position updates
  
  // Smooth position updates that run every frame
  const updateArtifactPositions = useCallback(() => {
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    if (!camera || !scene) return;

    // Update fading artifacts
    updateFadingArtifacts();

    // Update artifact positions with smooth animations
    const time = Date.now() * 0.001; // Convert to seconds for smoother animation
    
    artifactsRef.current.forEach((artifact, artifactId) => {
      if (artifactType === 'questions') {
        // Make questions follow the camera position with smooth lerping
        if (!artifact.userData.baseOffset) {
          // Store the initial offset from camera when artifact was created
          artifact.userData.baseOffset = {
            x: artifact.position.x - camera.position.x,
            y: artifact.position.y - camera.position.y,
            z: artifact.position.z - camera.position.z
          };
        }
        
        const baseOffset = artifact.userData.baseOffset;
        const artifactId_num = parseInt(artifactId.split('_')[1]) || 1;
        
        // Add subtle floating motion for questions
        const phaseOffset = artifactId_num * 0.3;
        const floatAmplitude = 0.1; // Very subtle motion
        const floatSpeed = 0.4; // Slower than images
        
        const floatY = Math.sin(time * floatSpeed + phaseOffset) * floatAmplitude;
        const floatZ = Math.cos(time * floatSpeed * 0.7 + phaseOffset) * floatAmplitude * 0.5;
        
        // Calculate target position relative to camera with floating motion
        const targetX = camera.position.x + baseOffset.x;
        const targetY = camera.position.y + baseOffset.y + floatY;
        const targetZ = camera.position.z + baseOffset.z + floatZ;
        
        // Smooth lerp towards target position with ease-in-out
        const lerpFactor = 0.08; // Smooth following factor (lower = more lag/smoothness)
        
        artifact.position.set(
          artifact.position.x + (targetX - artifact.position.x) * lerpFactor,
          artifact.position.y + (targetY - artifact.position.y) * lerpFactor,
          artifact.position.z + (targetZ - artifact.position.z) * lerpFactor
        );
        return;
      }
      
      // Add gentle wave motion to image artifacts too
      if (artifactType === 'images') {
        // Get the artifact's base position (where it was originally spawned)
        if (!artifact.userData.basePosition) {
          artifact.userData.basePosition = {
            x: artifact.position.x,
            y: artifact.position.y, 
            z: artifact.position.z
          };
        }
        
        const basePos = artifact.userData.basePosition;
        const artifactId_num = parseInt(artifactId.split('_')[1]) || 1;
        
        // Vary wave motion slightly per artifact for more natural look
        const phaseOffset = artifactId_num * 0.5; // Different phase per artifact
        const waveAmplitude = 0.15; // Smaller motion for images
        const waveSpeed = 0.6;
        
        const waveX = Math.sin(time * waveSpeed + phaseOffset) * waveAmplitude;
        const waveY = Math.sin(time * waveSpeed * 1.1 + phaseOffset) * waveAmplitude * 0.7;
        const waveZ = Math.cos(time * waveSpeed * 0.8 + phaseOffset) * waveAmplitude;
        
        artifact.position.set(
          basePos.x + waveX,
          basePos.y + waveY,
          basePos.z + waveZ
        );
      }
    });
  }, [artifactType, updateFadingArtifacts]);

  const updateArtifacts = useCallback(() => {
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    if (!camera || !scene) return;

    // For questions: aggressively clean up if we have more than 1 artifact
    if (artifactType === 'questions' && artifactsRef.current.size > 1) {
      const artifactsToRemove: string[] = [];
      let keepFirst = true;
      
      artifactsRef.current.forEach((artifact, artifactId) => {
        if (keepFirst) {
          keepFirst = false;
          return; // Keep the first one
        }
        
        // Remove excess artifacts
        scene.remove(artifact);
        artifact.traverse((child) => {
          if (child instanceof CSS2DObject) {
            if (child.element && child.element.parentNode) {
              child.element.parentNode.removeChild(child.element);
            }
            child.removeFromParent();
          }
        });
        artifact.geometry.dispose();
        (artifact.material as THREE.Material).dispose();
        artifactsToRemove.push(artifactId);
      });
      
      artifactsToRemove.forEach(artifactId => {
        artifactsRef.current.delete(artifactId);
      });
      
    }

    // Don't update artifacts if they're disabled
    if (!artefactsEnabled) {
      // Remove all existing artifacts when disabled
      artifactsRef.current.forEach((artifact, artifactId) => {
        scene.remove(artifact);
        
        // Dispose of CSS2D labels
        artifact.traverse((child) => {
          if (child instanceof CSS2DObject) {
            if (child.element && child.element.parentNode) {
              child.element.parentNode.removeChild(child.element);
            }
            child.removeFromParent();
          }
        });
        
        artifact.geometry.dispose();
        (artifact.material as THREE.Material).dispose();
      });
      artifactsRef.current.clear();
      
      // Clear fading artifacts too
      fadingArtifactsRef.current.clear();
      fadingInArtifactsRef.current.clear();
      
      return;
    }

    // Handle fade-out for artifacts too far from camera (images only)
    const artifactsToFade: string[] = [];
    artifactsRef.current.forEach((artifact, artifactId) => {
      if (artifactType === 'images') {
        const distance = camera.position.distanceTo(artifact.position);
        if (distance > ARTIFACT_DESPAWN_RADIUS && !fadingArtifactsRef.current.has(artifactId)) {
          // Start fade-out animation
          fadingArtifactsRef.current.set(artifactId, {
            mesh: artifact,
            startTime: Date.now(),
            duration: FADE_OUT_DURATION
          });
          artifactsToFade.push(artifactId);
        }
      }
    });

    // Remove artifacts from active list (they're now in fading list)
    artifactsToFade.forEach(artifactId => {
      artifactsRef.current.delete(artifactId);
    });

    
    // Only create full artifacts if images are preloaded (for image type only)
    if (artifactType === 'images' && !imagesPreloadedRef.current) {
      return;
    }
    

    // Replace any placeholder artifacts with real image artifacts
    const placeholdersToReplace: string[] = [];
    artifactsRef.current.forEach((artifact, artifactId) => {
      // Check if this is a placeholder (has loading-placeholder class)
      const hasPlaceholder = artifact.children.some(child => {
        if (child instanceof CSS2DObject) {
          return child.element.classList.contains('loading-placeholder');
        }
        return false;
      });
      
      if (hasPlaceholder) {
        placeholdersToReplace.push(artifactId);
      }
    });
    
    // Replace placeholders with real artifacts
    placeholdersToReplace.forEach(artifactId => {
      const placeholder = artifactsRef.current.get(artifactId);
      if (placeholder && scene) {
        const position = {
          x: placeholder.position.x,
          y: placeholder.position.y,
          z: placeholder.position.z,
          size: 3.0,
          id: parseInt(artifactId.split('_')[1])
        };
        
        // Remove placeholder
        scene.remove(placeholder);
        placeholder.traverse((child) => {
          if (child instanceof CSS2DObject) {
            if (child.element && child.element.parentNode) {
              child.element.parentNode.removeChild(child.element);
            }
            child.removeFromParent();
          }
        });
        placeholder.geometry.dispose();
        (placeholder.material as THREE.Material).dispose();
        artifactsRef.current.delete(artifactId);
        
        // Create real artifact with fade-in
        const artifact = createArtifact(position);
        if (artifact) {
          scene.add(artifact);
          
          // Start fade-in animation
          fadingInArtifactsRef.current.set(artifactId, {
            mesh: artifact,
            startTime: Date.now(),
            duration: FADE_IN_DURATION
          });
        }
      }
    });

    // Generate new artifacts if we have fewer than target count (rate limited)
    const now = Date.now();
    const shouldCreateArtifacts = now - lastArtifactCreationRef.current > ARTIFACT_CREATION_COOLDOWN;
    
    if (shouldCreateArtifacts) {
      lastArtifactCreationRef.current = now;
      
      // For questions: only show ONE artifact
      const targetCount = artifactType === 'questions' ? 1 : ARTIFACT_COUNT;
      
      // Hard limit for questions - never create more than 1
      if (artifactType === 'questions' && artifactsRef.current.size >= 1) {
        return;
      }
      
      let currentIndex = 1;
      while (artifactsRef.current.size < targetCount) {
      // Find next available index from 1-25
      while (artifactsRef.current.has(`artifact_${currentIndex}`) && currentIndex <= ARTIFACT_COUNT) {
        currentIndex++;
      }
      
      if (currentIndex > ARTIFACT_COUNT) break;
      
      let artifactPos;
      
      if (artifactType === 'questions') {
        // For questions: position relative to camera (will be updated to follow camera)
        artifactPos = {
          x: camera.position.x,
          y: camera.position.y - 3,
          z: camera.position.z - 8,
          size: 3.0,
          id: currentIndex
        };
      } else {
        // For images: spawn around camera as before
        const sphereCenterZ = camera.position.z - 10; // Closer to camera
        
        // Generate random point within the sphere
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * ARTIFACT_SPAWN_RADIUS; // 0 to 25 units from sphere center
        const height = (Math.random() - 0.5) * ARTIFACT_SPAWN_RADIUS * 2; // Within sphere bounds
        
        artifactPos = {
          x: camera.position.x + Math.cos(angle) * radius,
          y: camera.position.y + Math.sin(angle) * radius,
          z: sphereCenterZ + height, // Position within the sphere ahead of camera
          size: 3.0 + Math.random() * 2.0, // Random size between 3-5
          id: currentIndex
        };
      }
      
      // Create artifact synchronously and start fade-in animation
      const artifact = createArtifact(artifactPos);
      if (artifact && scene && !artifactsRef.current.has(`artifact_${currentIndex}`) && !fadingInArtifactsRef.current.has(`artifact_${currentIndex}`)) {
        scene.add(artifact);
        
        // Start fade-in animation
        fadingInArtifactsRef.current.set(`artifact_${currentIndex}`, {
          mesh: artifact,
          startTime: Date.now(),
          duration: FADE_IN_DURATION
        });
      } else if (!artifact) {
      }
      
      currentIndex++;
    }
    } // Close the shouldCreateArtifacts block
  }, [createArtifact, updateFadingArtifacts, artefactsEnabled, artifactType]);

  const updateVisibleChunks = useCallback(() => {
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    if (!camera || !scene) return;

    const now = Date.now();
    
    // Calculate camera movement since last update
    const lastPos = lastChunkUpdatePosition.current;
    const cameraMoved = Math.sqrt(
      Math.pow(camera.position.x - lastPos.x, 2) +
      Math.pow(camera.position.y - lastPos.y, 2) +
      Math.pow(camera.position.z - lastPos.z, 2)
    );
    
    // Check if we should update chunks (throttle based on movement and time)
    const timeSinceLastUpdate = now - lastChunkUpdateTime.current;
    const shouldUpdateChunks = cameraMoved > CHUNK_UPDATE_THRESHOLD || 
                              timeSinceLastUpdate > CHUNK_UPDATE_INTERVAL * 2;

    if (shouldUpdateChunks) {
      lastChunkUpdatePosition.current = { 
        x: camera.position.x, 
        y: camera.position.y, 
        z: camera.position.z 
      };
      lastChunkUpdateTime.current = now;

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
    }

    // Throttled artifact updates (separate from chunk updates)
    const artifactLastPos = lastArtifactUpdatePosition.current;
    const artifactCameraMoved = Math.sqrt(
      Math.pow(camera.position.x - artifactLastPos.x, 2) +
      Math.pow(camera.position.y - artifactLastPos.y, 2) +
      Math.pow(camera.position.z - artifactLastPos.z, 2)
    );
    
    const timeSinceLastArtifactUpdate = now - lastArtifactUpdateTime.current;
    const shouldUpdateArtifacts = artifactCameraMoved > ARTIFACT_UPDATE_THRESHOLD || 
                                 timeSinceLastArtifactUpdate > ARTIFACT_UPDATE_INTERVAL * 2;
                                 
    if (shouldUpdateArtifacts) {
      lastArtifactUpdatePosition.current = { 
        x: camera.position.x, 
        y: camera.position.y, 
        z: camera.position.z 
      };
      lastArtifactUpdateTime.current = now;
      updateArtifacts();
    }
    
  }, [chunkSize, renderDistance, generateChunk, updateArtifacts]);

  // Detect zoom changes
  useEffect(() => {
    if (zoomLevel !== lastZoomLevel.current) {
      isZooming.current = true;
      lastZoomLevel.current = zoomLevel;
      
      // Reset zoom flag after a short delay
      setTimeout(() => {
        isZooming.current = false;
      }, 100);
    }
  }, [zoomLevel]);

  // Update target camera position when BitCanvas navigation changes
  useEffect(() => {
    // Only update X/Y if we're not currently zooming
    if (!isZooming.current) {
      // Map 2D BitCanvas position to 3D camera position
      // Scale factors to make movement feel natural
      const scaleX = 0.5;
      const scaleY = 0.5;

      targetCameraPosition.current.x = viewOffset.x * scaleX;
      targetCameraPosition.current.y = -viewOffset.y * scaleY; // Invert Y to match coordinate systems
    }
  }, [viewOffset]);
  
  // Handle zoom separately
  useEffect(() => {
    const scaleZ = 20.0; // Zoom affects Z position
    targetCameraPosition.current.z = 10 + (1 / zoomLevel) * scaleZ; // Higher zoom = closer to grid
  }, [zoomLevel]);

  const animate = useCallback(() => {
    const renderer = rendererRef.current;
    const labelRenderer = labelRendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const composer = composerRef.current;

    if (renderer && scene && camera && composer) {
      frameCount.current++;
      
      // Adaptive camera interpolation based on distance and zoom state
      const distance = Math.sqrt(
        Math.pow(targetCameraPosition.current.x - currentCameraPosition.current.x, 2) +
        Math.pow(targetCameraPosition.current.y - currentCameraPosition.current.y, 2) +
        Math.pow(targetCameraPosition.current.z - currentCameraPosition.current.z, 2)
      );
      
      // Adjust lerp factor based on distance and zoom state
      let lerpFactor = 0.12; // Base smooth factor
      if (isZooming.current) {
        lerpFactor = 0.08; // Slower during zoom for stability
      } else if (distance > 5) {
        lerpFactor = 0.18; // Faster for large movements
      } else if (distance < 0.1) {
        lerpFactor = 0.25; // Snap to target when very close
      }
      
      currentCameraPosition.current.x += (targetCameraPosition.current.x - currentCameraPosition.current.x) * lerpFactor;
      currentCameraPosition.current.y += (targetCameraPosition.current.y - currentCameraPosition.current.y) * lerpFactor;
      currentCameraPosition.current.z += (targetCameraPosition.current.z - currentCameraPosition.current.z) * lerpFactor;
      
      camera.position.x = currentCameraPosition.current.x;
      camera.position.y = currentCameraPosition.current.y;
      camera.position.z = currentCameraPosition.current.z;
      
      // Update artifact positions every frame for smooth animation
      updateArtifactPositions();
      
      // Corona shader removed - no time updates needed
      
      // Only run expensive operations every few frames, but always run on first frame
      if (frameCount.current % EXPENSIVE_OP_FRAME_INTERVAL === 0 || frameCount.current === 1) {
        updateVisibleChunks();
      }
      
      composer.render();
      
      // Render labels
      if (labelRenderer) {
        labelRenderer.render(scene, camera);
      }
    }
    
    animationFrameRef.current = requestAnimationFrame(animate);
  }, [updateVisibleChunks, updateArtifactPositions]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Add CSS for loading animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0%, 100% { opacity: 0.6; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.05); }
      }
    `;
    document.head.appendChild(style);

    // Setup scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Add fog for depth perception - fade out before render distance
    const fogColor = new THREE.Color(0x000000);
    scene.fog = new THREE.Fog(fogColor, 5, 40);

    // Setup camera
    const camera = new THREE.PerspectiveCamera(
      75, 
      window.innerWidth / window.innerHeight, 
      0.1, 
      1000
    );
    camera.position.set(0, 5, 10);
    cameraRef.current = camera;
    
    // Initialize current camera position to match
    currentCameraPosition.current = { x: 0, y: 5, z: 10 };

    // Setup renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 1); // Black background for corona effect
    
    // Style the canvas element
    renderer.domElement.style.pointerEvents = 'none';
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    
    // Setup CSS2DRenderer for labels
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0px';
    labelRenderer.domElement.style.left = '0px';
    labelRenderer.domElement.style.pointerEvents = 'none';
    containerRef.current.appendChild(labelRenderer.domElement);
    labelRendererRef.current = labelRenderer;

    // Setup post-processing with sepia effect
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    
    // Disable sepia for corona effect
    // const sepiaPass = new ShaderPass(SepiaShader);
    // sepiaPass.uniforms['amount'].value = 0.5; // 50% sepia effect
    // composer.addPass(sepiaPass);
    
    composerRef.current = composer;

    // Fetch Are.na blocks
    fetchArenaBlocks();

    // Initial artifacts will be generated by updateArtifacts in the animation loop

    // Start animation loop
    animate();

    // Handle window resize
    const handleResize = () => {
      if (!camera || !renderer) return;
      
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      
      if (labelRenderer) {
        labelRenderer.setSize(window.innerWidth, window.innerHeight);
      }
      
      if (composer) {
        composer.setSize(window.innerWidth, window.innerHeight);
      }
    };
    
    window.addEventListener('resize', handleResize);

    // No need for wheel event listener - we sync with BitCanvas navigation

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      
      // Remove the style element
      if (style.parentNode) {
        style.parentNode.removeChild(style);
      }
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      if (containerRef.current && renderer) {
        containerRef.current.removeChild(renderer.domElement);
      }
      
      if (containerRef.current && labelRenderer) {
        containerRef.current.removeChild(labelRenderer.domElement);
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
      
      // Dispose of all artifacts
      artifactsRef.current.forEach((artifact) => {
        scene.remove(artifact);
        
        // Dispose of CSS2D labels
        artifact.traverse((child) => {
          if (child instanceof CSS2DObject) {
            if (child.element && child.element.parentNode) {
              child.element.parentNode.removeChild(child.element);
            }
            child.removeFromParent();
          }
        });
        
        artifact.geometry.dispose();
        (artifact.material as THREE.Material).dispose();
      });
      artifactsRef.current.clear();
      
      // Dispose of all fading artifacts
      fadingArtifactsRef.current.forEach((fadingArtifact) => {
        scene.remove(fadingArtifact.mesh);
        
        // Dispose of CSS2D labels
        fadingArtifact.mesh.traverse((child) => {
          if (child instanceof CSS2DObject) {
            if (child.element && child.element.parentNode) {
              child.element.parentNode.removeChild(child.element);
            }
            child.removeFromParent();
          }
        });
        
        fadingArtifact.mesh.geometry.dispose();
        (fadingArtifact.mesh.material as THREE.Material).dispose();
      });
      fadingArtifactsRef.current.clear();
      
      // Dispose of all fading-in artifacts
      fadingInArtifactsRef.current.forEach((fadingInArtifact) => {
        scene.remove(fadingInArtifact.mesh);
        
        // Dispose of CSS2D labels
        fadingInArtifact.mesh.traverse((child) => {
          if (child instanceof CSS2DObject) {
            if (child.element && child.element.parentNode) {
              child.element.parentNode.removeChild(child.element);
            }
            child.removeFromParent();
          }
        });
        
        fadingInArtifact.mesh.geometry.dispose();
        (fadingInArtifact.mesh.material as THREE.Material).dispose();
      });
      fadingInArtifactsRef.current.clear();
      
      
      renderer?.dispose();
    };
  }, [animate, fetchArenaBlocks]);

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