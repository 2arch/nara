"use client";
import React, { useState, useEffect } from 'react';
import { useWorldEngine } from './bitworld/world.engine';
import { BitHomeCanvas } from './bitworld/bit.home';

export default function Home() {
  const [cursorAlternate, setCursorAlternate] = useState(false);
  
  const engine = useWorldEngine({ 
    worldId: 'homeWorld', 
    initialBackgroundColor: '#FFFFFF' 
  });

  // Simple cursor blink effect (like BitCanvas)
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorAlternate(prev => !prev);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Set welcome content once (engine manages everything else)
  useEffect(() => {
    if (!engine.isLoadingWorld) {
      // Add welcome text to world data - engine handles positioning
      const welcomeText = "nara web services";
      const subtitleText = "intelligence, simplified.";
      
      // Clear existing data
      Object.keys(engine.worldData).forEach(key => {
        delete engine.worldData[key];
      });
      
      // Add centered text (engine will handle display)
      for (let i = 0; i < welcomeText.length; i++) {
        engine.worldData[`${i - Math.floor(welcomeText.length/2)},${-1}`] = welcomeText[i];
      }
      
      for (let i = 0; i < subtitleText.length; i++) {
        engine.worldData[`${i - Math.floor(subtitleText.length/2)},${1}`] = subtitleText[i];
      }
    }
  }, [engine.isLoadingWorld]);

  if (engine.isLoadingWorld) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-white">
        <div className="text-black">Loading...</div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-white relative">
      <BitHomeCanvas
        engine={engine}
        cursorColorAlternate={cursorAlternate}
        className="w-full h-full"
        monogramEnabled={true}
      />
    </div>
  );
}