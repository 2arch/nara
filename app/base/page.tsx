"use client";
import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useWorldEngine } from '../bitworld/world.engine';
import { BitCanvas } from '../bitworld/bit.canvas';
import { useMonogram } from '../bitworld/monogram.gpu';
import { auth, database, getUserProfile } from '../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { ref, set, serverTimestamp, get } from 'firebase/database';

// Lazy load Grid3DBackground (Three.js) - only loads when backgroundMode === 'space'
const Grid3DBackground = dynamic(
  () => import('../bitworld/canvas.grid3d'),
  { ssr: false }
);

// Component that uses useSearchParams - needs to be wrapped in Suspense
function BasePageContent() {
  const [cursorAlternate, setCursorAlternate] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [username, setUsername] = useState<string>('base'); // Default to 'base' for unauthenticated
  const [panDistance, setPanDistance] = useState(0);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Parse URL coordinate parameters (supports both new and legacy formats)
  const viewParam = searchParams.get('v'); // New format: v=x.y.zoom
  const patternParam = searchParams.get('p'); // Pattern ID: p=1a2b3c
  const urlX = searchParams.get('x'); // Legacy format
  const urlY = searchParams.get('y'); // Legacy format
  const urlZoom = searchParams.get('zoom'); // Legacy format

  // Parse view parameter (dot-separated: x.y.zoom)
  let initialViewOffset: { x: number; y: number } | undefined;
  let initialZoomLevel: number | undefined;
  let initialPatternId: string | undefined;
  let isSharedLink = false;

  if (viewParam) {
    const parts = viewParam.split('.');
    if (parts.length >= 2) {
      const x = parseFloat(parts[0]);
      const y = parseFloat(parts[1]);
      if (!isNaN(x) && !isNaN(y)) {
        initialViewOffset = { x, y };
        isSharedLink = true; // Mark as shared link visit
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
      isSharedLink = true; // Mark as shared link visit
    }
    if (urlZoom) {
      const zoom = parseFloat(urlZoom);
      if (!isNaN(zoom)) {
        initialZoomLevel = zoom;
      }
    }
  }

  // Parse pattern parameter
  if (patternParam) {
    initialPatternId = patternParam;
  }

  // Log all visits to Firebase for analysis (non-blocking, after canvas loads)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Delay logging until after initial render
    const timeoutId = setTimeout(() => {
      fetch(`/api/log-visit?url=${encodeURIComponent(window.location.href)}`).catch(() => {});
    }, 1000);
    return () => clearTimeout(timeoutId);
  }, []);

  // Log shared link visits (when someone arrives via ?v= parameter)
  useEffect(() => {
    if (!isSharedLink || !initialViewOffset) return;

    // Log this visit to Firebase for share analytics
    const visitPath = `worlds/public/base/shares/visits/${Date.now()}`;
    const visitData = {
      position: initialViewOffset,
      zoom: initialZoomLevel || 1.0,
      timestamp: serverTimestamp(),
      url: window.location.href,
      referrer: document.referrer || null
    };

    set(ref(database, visitPath), visitData).catch((error: any) => {
      console.error('Failed to log share visit:', error);
    });
  }, [isSharedLink, initialViewOffset, initialZoomLevel]);

  // Auth state management
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      setAuthLoading(false);
      
      if (user) {
        // Fetch username from Firebase
        try {
          const usernameRef = ref(database, `users/${user.uid}/username`);
          const snapshot = await get(usernameRef);
          if (snapshot.exists()) {
            setUsername(snapshot.val());
          } else {
            // Fallback to displayName or email
            setUsername(user.displayName || user.email?.split('@')[0] || 'anonymous');
          }
        } catch (error) {
          console.error('Failed to fetch username:', error);
          setUsername(user.displayName || user.email?.split('@')[0] || 'anonymous');
        }
      } else {
        setUsername('base'); // Reset to default when logged out
      }
    });

    return () => unsubscribe();
  }, []);

  // Monogram system - create once and pass to both engine and canvas
  const monogram = useMonogram({ enabled: true, speed: 0.5, complexity: 1.0, mode: 'perlin' });

  // World Engine - using 'public' userUid so it saves to /worlds/public/base/data
  const engine = useWorldEngine({
    worldId: 'base',
    userUid: 'public', // 'public' userUid groups all public collaborative spaces
    username, // Use actual user's username from Firebase
    initialStateName: null, // No state name for base
    initialViewOffset,
    initialZoomLevel,
    initialPatternId,
    isReadOnly: !user, // Read-only if not authenticated
    monogramSystem: monogram // Pass monogram to engine for command system
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
        dialogueEnabled={true}
        fontFamily={engine.fontFamily}
        hostModeEnabled={!user} // Enable host mode when not authenticated
        monogram={monogram} // Pass monogram for rendering
        onAuthSuccess={handleAuthSuccess}
        onPanDistanceChange={setPanDistance}
        isPublicWorld={true} // Enable public world sign-up flow
      />
    </div>
  );
}

export default function BasePage() {
  return (
    <Suspense fallback={<div className="w-screen h-screen bg-black" />}>
      <BasePageContent />
    </Suspense>
  );
}