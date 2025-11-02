"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useWorldEngine } from '../../bitworld/world.engine';
import { BitCanvas } from '../../bitworld/bit.canvas';

export default function ResetPasswordPage() {
  const [cursorAlternate, setCursorAlternate] = useState(false);
  const router = useRouter();

  const engine = useWorldEngine({
    worldId: null,
    initialBackgroundColor: '#69AED6',
    userUid: null,
    initialZoomLevel: 1.6
  });

  const handleAuthSuccess = useCallback((username: string) => {
    router.push(`/@${username}`);
  }, [router]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCursorAlternate(prev => !prev);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ backgroundColor: '#F8F8F0', height: '100vh', width: '100vw' }}>
      <BitCanvas
        engine={engine}
        cursorColorAlternate={cursorAlternate}
        hostModeEnabled={true}
        initialHostFlow="password_reset"
        onAuthSuccess={handleAuthSuccess}
        fontFamily="IBM Plex Mono"
        hostTextColor="#000000"
        hostBackgroundColor="#69AED6"
      />
    </div>
  );
}