"use client";
import React, { useState, useEffect } from 'react';
import InteractiveBitCanvas from '../bitworld/interactive.canvas';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { processGifFrame, PixelatedFrame } from '../bitworld/gif.utils';

const StagingPage: React.FC = () => {
  const [gifFrames, setGifFrames] = useState<PixelatedFrame[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadMainGif = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        const response = await fetch('/main.gif');
        if (!response.ok) {
          throw new Error(`Failed to load main.gif: ${response.status} ${response.statusText}`);
        }
        
        const buffer = await response.arrayBuffer();
        const gif = parseGIF(buffer);
        const frames = decompressFrames(gif, true);
        
        const processedFrames = frames.map(frame => processGifFrame(frame));
        setGifFrames(processedFrames);
      } catch (err) {
        console.error('Error loading main.gif:', err);
        setError(err instanceof Error ? err.message : 'Failed to load GIF');
      } finally {
        setIsLoading(false);
      }
    };

    loadMainGif();
  }, []);

  if (isLoading) {
    return (
      <div className="relative w-screen h-screen flex items-center justify-center">
        <div className="text-white">Loading main.gif...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="relative w-screen h-screen flex items-center justify-center">
        <div className="text-red-500">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen">
      <InteractiveBitCanvas gifFrames={gifFrames} monogramEnabled={false} dialogueEnabled={false} />
    </div>
  );
};

export default StagingPage;
