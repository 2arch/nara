"use client";
import React, { useState, useEffect } from 'react';
import InteractiveBitCanvas from '../bitworld/interactive.canvas';
import { PixelatedFrame } from '../bitworld/gif.utils';

const StagingPage: React.FC = () => {
  const [pngFrame, setPngFrame] = useState<PixelatedFrame | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [optimalZoom, setOptimalZoom] = useState(1);

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
          // Calculate target dimensions to fit viewport
          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;
          
          // Base cell dimensions (1:2 aspect ratio)
          const CELL_ASPECT_RATIO = 0.5; // width/height = 1/2
          
          // Calculate how many cells we can fit in viewport
          // Assuming each cell is roughly 10px wide and 20px tall
          const TARGET_CELL_WIDTH = 10;
          const TARGET_CELL_HEIGHT = 20;
          
          const maxCellsX = Math.floor(viewportWidth / TARGET_CELL_WIDTH);
          const maxCellsY = Math.floor(viewportHeight / TARGET_CELL_HEIGHT);
          
          // Calculate the image's aspect ratio
          const imageAspectRatio = img.width / img.height;
          
          // Correct for cell aspect ratio distortion
          const correctedAspectRatio = imageAspectRatio / CELL_ASPECT_RATIO;
          
          // Calculate character grid dimensions that preserve the image's aspect ratio
          let targetWidth, targetHeight;
          if (correctedAspectRatio > (maxCellsX / maxCellsY)) {
            // Wider than viewport - constrain by width
            targetWidth = maxCellsX;
            targetHeight = Math.round(maxCellsX / correctedAspectRatio);
          } else {
            // Taller than viewport - constrain by height
            targetHeight = maxCellsY;
            targetWidth = Math.round(maxCellsY * correctedAspectRatio);
          }
          
          // Ensure we don't exceed viewport bounds
          targetWidth = Math.min(targetWidth, maxCellsX);
          targetHeight = Math.min(targetHeight, maxCellsY);
          
          // Create a canvas to resize and process the image
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Failed to get canvas context');
          }
          
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          
          // Draw scaled image
          ctx.imageSmoothingEnabled = false; // Keep pixelated look
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
          
          // Get image data
          const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
          
          // Convert to pixelated frame format
          const pixelatedFrame: PixelatedFrame = {
            width: targetWidth,
            height: targetHeight,
            data: []
          };
          
          // Process pixels
          for (let y = 0; y < targetHeight; y++) {
            for (let x = 0; x < targetWidth; x++) {
              const index = (y * targetWidth + x) * 4;
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
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      <InteractiveBitCanvas 
        gifFrames={[pngFrame]} 
        monogramEnabled={false} 
        dialogueEnabled={false}
        initialBackgroundColor="#000000"
      />
    </div>
  );
};

export default StagingPage;
