"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { useWorldEngine } from './world.engine';
import { BitCanvas } from './bit.canvas';

interface InteractiveBitCanvasProps {
  initialBackgroundColor?: string;
}

const InteractiveBitCanvas: React.FC<InteractiveBitCanvasProps> = ({ initialBackgroundColor = '#FFFFFF' }) => {
  const [cursorAlternate, setCursorAlternate] = useState(false);
  const [overlapRects, setOverlapRects] = useState<DOMRect[]>([]);
  
  const engine = useWorldEngine({ worldId: 'main', initialBackgroundColor });

  const updateOverlapRects = useCallback(() => {
    const elements = document.querySelectorAll('[id="animate"]');
    const rects = Array.from(elements).map(el => el.getBoundingClientRect());
    setOverlapRects(rects);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setCursorAlternate(prev => !prev);
    }, 500);

    window.addEventListener('scroll', updateOverlapRects, true);
    window.addEventListener('resize', updateOverlapRects);
    updateOverlapRects();

    const observer = new MutationObserver(updateOverlapRects);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      clearInterval(interval);
      window.removeEventListener('scroll', updateOverlapRects, true);
      window.removeEventListener('resize', updateOverlapRects);
      observer.disconnect();
    };
  }, [updateOverlapRects]);

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
        overlapRects={overlapRects}
      />
    </div>
  );
};

export default InteractiveBitCanvas;
