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

  // Parse URL coordinate parameters
  const urlX = searchParams.get('x');
  const urlY = searchParams.get('y');
  const urlZoom = searchParams.get('zoom');

  // Calculate initial view offset and zoom from URL params
  const initialViewOffset = (urlX && urlY && typeof window !== 'undefined') ? {
    x: parseInt(urlX),
    y: parseInt(urlY)
  } : undefined;

  const initialZoomLevel = urlZoom ? parseFloat(urlZoom) : undefined;

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

  const engine = useWorldEngine({
    worldId: stateName,
    // initialBackgroundColor: '#000',
    userUid: targetUserUid, // Use the target user's UID, not the authenticated user's UID
    username: username,
    initialStateName: stateName,
    initialViewOffset: initialViewOffset,
    initialZoomLevel: initialZoomLevel
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
      <div className="w-screen flex items-center justify-center" style={{height: '100dvh'}}>
        <div>Loading...</div>
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