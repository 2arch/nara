"use client";
import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useWorldEngine } from '../../bitworld/world.engine';
import { BitCanvas } from '../../bitworld/bit.canvas';
import { useMonogram } from '../../bitworld/monogram.gpu';
import { auth, getUidByUsername } from '../../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

// Lazy load Grid3DBackground (Three.js) - only loads when backgroundMode === 'space'
const Grid3DBackground = dynamic(
  () => import('../../bitworld/canvas.grid3d'),
  { ssr: false }
);

function UserStateContent() {
  const [cursorAlternate, setCursorAlternate] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [targetUserUid, setTargetUserUid] = useState<string | null>(null);
  const [uidLookupLoading, setUidLookupLoading] = useState(true);
  const [panDistance, setPanDistance] = useState(0);
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const username = decodeURIComponent(params.username as string).replace('@', '');
  const slug = params.slug as string[];
  const stateName = slug?.[0] || 'default';

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
  const patternParam = searchParams.get('p'); // Pattern ID: p=1a2b3c
  const urlX = searchParams.get('x'); // Legacy format
  const urlY = searchParams.get('y'); // Legacy format
  const urlZoom = searchParams.get('zoom'); // Legacy format

  // Parse view parameter (dot-separated: x.y.zoom)
  let initialViewOffset: { x: number; y: number } | undefined;
  let initialZoomLevel: number | undefined;
  let initialPatternId: string | undefined;

  if (viewParam) {
    const parts = viewParam.split('.');
    if (parts.length >= 2) {
      const x = parseInt(parts[0]);
      const y = parseInt(parts[1]);
      const zoom = parts.length >= 3 ? parseFloat(parts.slice(2).join('.')) : undefined; // Handle zoom like 1.00

      if (!isNaN(x) && !isNaN(y)) {
        initialViewOffset = { x, y };
        if (zoom && !isNaN(zoom)) {
          initialZoomLevel = zoom;
        }
      }
    }
  }
  // Fallback to legacy format
  else if (urlX && urlY && typeof window !== 'undefined') {
    initialViewOffset = {
      x: parseInt(urlX),
      y: parseInt(urlY)
    };
    initialZoomLevel = urlZoom ? parseFloat(urlZoom) : undefined;
  }

  // Parse pattern parameter
  if (patternParam) {
    initialPatternId = patternParam;
  }

  // Listen for authentication state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Look up the target user's UID from their username
  useEffect(() => {
    const lookupUid = async () => {
      try {
        const uid = await getUidByUsername(username);
        setTargetUserUid(uid);
      } catch (error) {
        setTargetUserUid(null);
      } finally {
        setUidLookupLoading(false);
      }
    };

    if (username) {
      lookupUid();
    } else {
      setUidLookupLoading(false);
    }
  }, [username]);

  // Detect if current user is the owner
  const isOwner = user && targetUserUid && user.uid === targetUserUid;

  // Monogram system - create once and pass to both engine and canvas
  const monogram = useMonogram({ enabled: true, speed: 0.5, complexity: 1.0, mode: 'perlin' });

  const engine = useWorldEngine({
    worldId: stateName,
    // initialBackgroundColor: '#000',
    userUid: targetUserUid, // Use the target user's UID, not the authenticated user's UID
    username: username,
    initialStateName: stateName,
    initialViewOffset: initialViewOffset,
    initialZoomLevel: initialZoomLevel,
    initialPatternId: initialPatternId,
    isReadOnly: !isOwner, // Pass read-only flag
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

  const SIGNUP_THRESHOLD = 100;
  const progress = Math.min((panDistance / SIGNUP_THRESHOLD) * 100, 100);

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
        hostModeEnabled={!isOwner}
        onAuthSuccess={handleAuthSuccess}
        onPanDistanceChange={setPanDistance}
        monogram={monogram}
      />

      {/* Pan distance indicator removed - no longer shown in read-only mode */}
    </div>
  );
}

export default function UserState() {
  return (
    <Suspense fallback={<div className="w-screen h-screen bg-black" />}>
      <UserStateContent />
    </Suspense>
  );
}