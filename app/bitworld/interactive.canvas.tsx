"use client";
import React, { useState, useEffect } from 'react';
import { useWorldEngine } from './world.engine';
import { BitCanvas } from './bit.canvas';

interface InteractiveBitCanvasProps {
  initialBackgroundColor?: string;
}

const InteractiveBitCanvas: React.FC<InteractiveBitCanvasProps> = ({ initialBackgroundColor = '#FFFFFF' }) => {
  const [cursorAlternate, setCursorAlternate] = useState(false);
  
  // Use the custom hook to get the world engine instance
  const engine = useWorldEngine({ worldId: 'main', initialBackgroundColor });

  useEffect(() => {
    const interval = setInterval(() => {
      setCursorAlternate(prev => !prev);
    }, 500);

    return () => {
      clearInterval(interval);
    };
  }, []);

  if (engine.isLoadingWorld) {
    return <div>Loading World...</div>;
  }

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative' }}>
      <BitCanvas
        engine={engine}
        cursorColorAlternate={cursorAlternate}
        className="w-full h-full"
        showCursor={false}
      />
    </div>
  );
};

export default InteractiveBitCanvas;
