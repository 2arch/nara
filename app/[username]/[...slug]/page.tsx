"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useWorldEngine } from '../../bitworld/world.engine';
import { BitCanvas } from '../../bitworld/bit.canvas';
import Grid3DBackground from '../../bitworld/canvas.grid3d';
import { auth, getUidByUsername } from '../../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

export default function UserState() {
  const [cursorAlternate, setCursorAlternate] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [targetUserUid, setTargetUserUid] = useState<string | null>(null);
  const [uidLookupLoading, setUidLookupLoading] = useState(true);
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const username = decodeURIComponent(params.username as string).replace('@', '');
  const slug = params.slug as string[];
  const stateName = slug?.[0] || 'default';

  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const hasLoadedScreenshot = React.useRef<boolean>(false);
  const [isRubyBot, setIsRubyBot] = useState(false);

  // Detect Ruby bot (are.na scraper)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const userAgent = navigator.userAgent;
    const isRuby = userAgent === 'Ruby' || userAgent.startsWith('Ruby/');
    setIsRubyBot(isRuby);
    console.log('🔍 User agent:', userAgent, '| Is Ruby bot:', isRuby);
  }, []);

  // Load screenshot ONLY for Ruby bot (are.na scraper)
  useEffect(() => {
    if (hasLoadedScreenshot.current) return;
    if (!username || !stateName) return;
    if (!isRubyBot) return; // Only load for Ruby bot

    const loadScreenshot = async () => {
      try {
        hasLoadedScreenshot.current = true;
        const uid = await getUidByUsername(username);
        if (!uid) return;

        const { ref, get } = await import('firebase/database');
        const { database } = await import('../../firebase');

        const screenshotPath = `worlds/${uid}/${stateName}/screenshot`;
        const screenshotRef = ref(database, screenshotPath);
        const snapshot = await get(screenshotRef);

        if (snapshot.exists()) {
          console.log('✅ Screenshot loaded for Ruby bot');
          setScreenshotUrl(snapshot.val());
        }
      } catch (error) {
        console.error('Error loading screenshot:', error);
      }
    };

    loadScreenshot();
  }, [username, stateName, isRubyBot]);

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

  const engine = useWorldEngine({
    worldId: stateName,
    // initialBackgroundColor: '#000',
    userUid: targetUserUid, // Use the target user's UID, not the authenticated user's UID
    username: username,
    initialStateName: stateName,
    initialViewOffset: initialViewOffset,
    initialZoomLevel: initialZoomLevel,
    isReadOnly: !isOwner // Pass read-only flag
  });

  // Simple cursor blink effect
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorAlternate(prev => !prev);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  if (authLoading || uidLookupLoading || engine.isLoadingWorld) {
    return (
      <div
        className="w-screen"
        style={{
          height: '100dvh',
          position: 'relative',
          backgroundColor: (screenshotUrl && isRubyBot) ? 'transparent' : '#000'
        }}
      >
        {/* Only show screenshot to Ruby bot (are.na scraper) */}
        {screenshotUrl && isRubyBot && (
          <img
            src={screenshotUrl}
            alt="Preview"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              opacity: 1
            }}
          />
        )}
      </div>
    );
  }

  if (!targetUserUid) {
    return (
      <div className="w-screen flex items-center justify-center" style={{height: '100dvh'}}>
        <div>User not found</div>
      </div>
    );
  }

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
      />
    </div>
  );
}