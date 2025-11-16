'use client';

import { useState, useEffect } from 'react';
import { useWorldEngine } from './bitworld/world.engine';
import { BitCanvas } from './bitworld/bit.canvas';
import { useMonogram } from './bitworld/monogram.gpu';

export default function TestEnvironment() {
  const [cursorAlternate, setCursorAlternate] = useState(false);

  // Monogram system - Perlin WebGPU
  const monogram = useMonogram({
    enabled: true,
    speed: 0.5,
    complexity: 1.0
  });

  // World engine - NO auth, NO user context
  const engine = useWorldEngine({
    worldId: 'test', // Local test world (not saved to Firebase)
    initialBackgroundColor: '#000000', // Black background
    userUid: null, // No user
    initialZoomLevel: 1.0,
    skipInitialBackground: false, // Show background
    monogramSystem: monogram
  });

  // Cursor blink effect
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorAlternate(prev => !prev);
    }, 530);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-screen relative" style={{ backgroundColor: '#000000', height: '100dvh' }}>
      <BitCanvas
        engine={engine}
        cursorColorAlternate={cursorAlternate}
        className="w-full h-full"
        dialogueEnabled={false}
        hostModeEnabled={false}  // Disable host mode!
        fontFamily={engine.fontFamily}
        monogram={monogram}
      />
    </div>
  );
}
