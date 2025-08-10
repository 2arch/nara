"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { useWorldEngine } from './world.engine';
import { BitCanvas } from './bit.canvas';
import { PixelatedFrame } from './gif.utils';

interface InteractiveBitCanvasProps {
  initialBackgroundColor?: string;
  gifFrames?: PixelatedFrame[];
  monogramEnabled?: boolean;
  dialogueEnabled?: boolean;
  overlayGifFrames?: PixelatedFrame[]; // Keep for backward compatibility
  gifLibrary?: {[key: string]: PixelatedFrame[]}; // New multi-GIF system
}

const InteractiveBitCanvas: React.FC<InteractiveBitCanvasProps> = ({ initialBackgroundColor = '#FFFFFF', gifFrames = [], monogramEnabled = true, dialogueEnabled = true, overlayGifFrames = [], gifLibrary = {} }) => {
  const [cursorAlternate, setCursorAlternate] = useState(false);
  const [overlapRects, setOverlapRects] = useState<{rect: DOMRect, gifName: string}[]>([]);
  
  const engine = useWorldEngine({ worldId: 'main', initialBackgroundColor });

  const updateOverlapRects = useCallback(() => {
    // Look for both old 'animate' ID and new 'animation-{gifName}' pattern
    const animateElements = document.querySelectorAll('[id="animate"]');
    const animationElements = document.querySelectorAll('[id^="animation-"]');
    
    const rects: {rect: DOMRect, gifName: string}[] = [];
    
    // Handle backward compatibility with old 'animate' ID
    Array.from(animateElements).forEach(el => {
      rects.push({
        rect: el.getBoundingClientRect(),
        gifName: 'main' // Default to main.gif for backward compatibility
      });
    });
    
    // Handle new animation-{gifName} pattern
    Array.from(animationElements).forEach(el => {
      const id = el.getAttribute('id');
      if (id && id.startsWith('animation-')) {
        const gifName = id.replace('animation-', '');
        rects.push({
          rect: el.getBoundingClientRect(),
          gifName: gifName
        });
      }
    });
    
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
        gifFrames={gifFrames}
        overlayGifFrames={overlayGifFrames}
        gifLibrary={gifLibrary}
        monogramEnabled={monogramEnabled}
        dialogueEnabled={dialogueEnabled}
      />
    </div>
  );
};

export default InteractiveBitCanvas;
