"use client";

import React, { useRef, useEffect } from 'react';

interface Line {
  pos: number;
  opacity: number;
}

const InfiniteGridAnimation = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameId: number;
    const speed = 0.3;
    const gridSize = 30;
    const fadeDuration = 15;

    let verticalLines: Line[] = [];
    let horizontalLines: Line[] = [];
    let lastVLine = 0;
    let lastHLine = 0;

    const resizeCanvas = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      
      verticalLines = [];
      horizontalLines = [];
      const width = canvas.width;
      const height = canvas.height;
      const horizonY = height * 0.4;

      for (let i = 0; i < width / 2; i += gridSize) {
        verticalLines.push({ pos: i, opacity: 1 });
      }
      for (let i = 0; i < height - horizonY; i += gridSize) {
        horizontalLines.push({ pos: i, opacity: 1 });
      }
    };

    const draw = () => {
      if (!ctx) return;
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const horizonY = height * 0.4;

      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 1;

      // --- Horizontal Lines ---
      lastHLine += speed;
      if (lastHLine > gridSize) {
        lastHLine = 0;
        horizontalLines.push({ pos: 0, opacity: 0 });
      }

      const horizonWidthFactor = 0.3; // Must match the vertical line calculation

      horizontalLines = horizontalLines.filter(line => {
        const perspectivePos = Math.pow(line.pos / (height - horizonY), 1.5) * (height - horizonY);
        const y = horizonY + perspectivePos;
        
        line.pos += speed;
        line.opacity = Math.min(1, line.pos / fadeDuration);

        // Calculate the perspective factor (0 at horizon, 1 at bottom)
        const p = perspectivePos / (height - horizonY);

        // Determine the start and end points of the outermost vertical lines
        const startX = centerX - (centerX * horizonWidthFactor);
        const endX = 0; // Left edge of the canvas
        
        // Interpolate to find the correct x-coordinate for this y-level
        const x1 = startX + p * (endX - startX);
        const x2 = width - x1; // Symmetrical on the other side

        ctx.strokeStyle = `rgba(136, 136, 136, ${line.opacity})`;
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
        
        return y < height;
      });

      // --- Vertical Lines ---
      lastVLine += speed;
      if (lastVLine > gridSize) {
        lastVLine = 0;
        verticalLines.push({ pos: 0, opacity: 0 });
      }

      verticalLines = verticalLines.filter(line => {
        line.pos += speed;
        line.opacity = Math.min(1, line.pos / fadeDuration);
        
        ctx.strokeStyle = `rgba(136, 136, 136, ${line.opacity})`;
        
        // Define how wide the grid is at the horizon
        const horizonWidthFactor = 0.3; 
        const horizonXOffset = line.pos * horizonWidthFactor;

        // Right line
        ctx.beginPath();
        ctx.moveTo(centerX + horizonXOffset, horizonY); // Start on the flat horizon
        ctx.lineTo(centerX + line.pos, height);
        ctx.stroke();
        
        // Left line
        ctx.beginPath();
        ctx.moveTo(centerX - horizonXOffset, horizonY); // Start on the flat horizon
        ctx.lineTo(centerX - line.pos, height);
        ctx.stroke();

        return (centerX - line.pos) > 0;
      });

      frameId = requestAnimationFrame(draw);
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    draw();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full z-0" />;
};

export default InfiniteGridAnimation;