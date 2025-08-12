"use client";
import React, { useState, useEffect } from 'react';
import InteractiveBitCanvas from '../bitworld/interactive.canvas';
import { PixelatedFrame } from '../bitworld/gif.utils';

const StagingPage: React.FC = () => {
  const [pngFrame, setPngFrame] = useState<PixelatedFrame | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadMainPng = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        const response = await fetch('/main.png');
        if (!response.ok) {
          throw new Error(`Failed to load main.png: ${response.status} ${response.statusText}`);
        }
        
        // Create an image element to load the PNG
        const img = new Image();
        img.onload = () => {
          // Create a canvas to process the image data
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Failed to get canvas context');
          }
          
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          
          // Get image data
          const imageData = ctx.getImageData(0, 0, img.width, img.height);
          
          // Convert to pixelated frame format
          const pixelatedFrame: PixelatedFrame = {
            width: img.width,
            height: img.height,
            data: []
          };
          
          // Process pixels (similar to GIF processing)
          for (let y = 0; y < img.height; y++) {
            for (let x = 0; x < img.width; x++) {
              const index = (y * img.width + x) * 4;
              const r = imageData.data[index];
              const g = imageData.data[index + 1];
              const b = imageData.data[index + 2];
              const a = imageData.data[index + 3];
              
              // Convert to hex color
              const color = a === 0 ? 'transparent' : 
                `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
              
              // Use block character for solid pixels, space for transparent
              const char = a === 0 ? ' ' : '█';
              
              pixelatedFrame.data.push({
                char,
                color
              });
            }
          }
          
          setPngFrame(pixelatedFrame);
          setIsLoading(false);
        };
        
        img.onerror = () => {
          throw new Error('Failed to load image');
        };
        
        img.src = response.url;
      } catch (err) {
        console.error('Error loading main.png:', err);
        setError(err instanceof Error ? err.message : 'Failed to load PNG');
        setIsLoading(false);
      }
    };

    loadMainPng();
  }, []);

  if (isLoading) {
    return (
      <div className="relative w-screen h-screen flex items-center justify-center">
        <div className="text-white">Loading main.png...</div>
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

  if (!pngFrame) {
    return (
      <div className="relative w-screen h-screen flex items-center justify-center">
        <div className="text-white">No image loaded</div>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen">
      <InteractiveBitCanvas gifFrames={[pngFrame]} monogramEnabled={false} dialogueEnabled={false} />
    </div>
  );
};

export default StagingPage;
