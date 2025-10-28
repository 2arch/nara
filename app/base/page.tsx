"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useWorldEngine } from '../bitworld/world.engine';
import { BitCanvas } from '../bitworld/bit.canvas';
import { auth } from '../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

// Lazy load Grid3DBackground (Three.js) - only loads when backgroundMode === 'space'
const Grid3DBackground = dynamic(
  () => import('../bitworld/canvas.grid3d'),
  { ssr: false }
);

export default function BasePage() {
  const [cursorAlternate, setCursorAlternate] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [panDistance, setPanDistance] = useState(0);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Log all visits to Firebase for analysis (non-blocking, after canvas loads)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Delay logging until after initial render
    const timeoutId = setTimeout(() => {
      fetch(`/api/log-visit?url=${encodeURIComponent(window.location.href)}`).catch(() => {});
    }, 1000);
    return () => clearTimeout(timeoutId);
  }, []);

  // Parse URL coordinate parameters (supports both new and legacy formats)
  const viewParam = searchParams.get('v'); // New format: v=x.y.zoom
  const urlX = searchParams.get('x'); // Legacy format
  const urlY = searchParams.get('y'); // Legacy format
  const urlZoom = searchParams.get('zoom'); // Legacy format

  // Parse view parameter (dot-separated: x.y.zoom)
  let initialViewOffset: { x: number; y: number } | undefined;
  let initialZoomLevel: number | undefined;

  if (viewParam) {
    const parts = viewParam.split('.');
    if (parts.length >= 2) {
      const x = parseFloat(parts[0]);
      const y = parseFloat(parts[1]);
      if (!isNaN(x) && !isNaN(y)) {
        initialViewOffset = { x, y };
      }
      if (parts.length >= 3) {
        const zoom = parseFloat(parts[2]);
        if (!isNaN(zoom)) {
          initialZoomLevel = zoom;
        }
      }
    }
  } else if (urlX && urlY) {
    // Legacy format support
    const x = parseFloat(urlX);
    const y = parseFloat(urlY);
    if (!isNaN(x) && !isNaN(y)) {
      initialViewOffset = { x, y };
    }
    if (urlZoom) {
      const zoom = parseFloat(urlZoom);
      if (!isNaN(zoom)) {
        initialZoomLevel = zoom;
      }
    }
  }

  // Auth state management
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // World Engine - using 'public' userUid so it saves to /worlds/public/base/data
  const engine = useWorldEngine({
    worldId: 'base',
    userUid: 'public', // 'public' userUid groups all public collaborative spaces
    username: 'base',
    initialStateName: null, // No state name for base
    initialViewOffset,
    initialZoomLevel,
    isReadOnly: !user // Read-only if not authenticated
  });

  // Handle authentication success for pan-triggered signup
  const handleAuthSuccess = useCallback((newUsername: string) => {
    router.push(`/@${newUsername}`);
  }, [router]);

  // Simple cursor blink effect
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorAlternate(prev => !prev);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-screen relative" style={{height: '100dvh'}}>
      {/* Render Grid3DBackground when space mode is active */}
      {engine.backgroundMode === 'space' && (
        <Grid3DBackground
          viewOffset={engine.viewOffset}
          zoomLevel={engine.zoomLevel}
          gridMode={engine.gridMode}
          artefactsEnabled={engine.artefactsEnabled}
          artifactType={engine.artifactType}
          getCompiledText={engine.getCompiledText}
          compiledTextCache={engine.compiledTextCache}
        />
      )}

      <BitCanvas
        engine={engine}
        cursorColorAlternate={cursorAlternate}
        className="w-full h-full"
        monogramEnabled={true}
        dialogueEnabled={true}
        fontFamily={engine.fontFamily}
        hostModeEnabled={!user} // Enable host mode when not authenticated
        onAuthSuccess={handleAuthSuccess}
        onPanDistanceChange={setPanDistance}
      />
    </div>
  );
}