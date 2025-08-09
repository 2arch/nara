"use client";

import React, { useRef, useEffect } from 'react';
import { createNoise2D } from 'simplex-noise';

interface Block {
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
}

const BouncingBallAnimation = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const noise2D = createNoise2D();
    let frameId: number;
    
    // Wave properties
    let waveTime = 0;
    
    // Noise properties for pushback effect
    let noiseTime = 0;
    let currentPush = 0;
    let targetPush = 0;
    
    // Blocks array
    const blocks: Block[] = [];
    const maxBlocks = 8;
    
    // Create initial blocks with width > height
    const createBlock = (): Block => {
      const height = 10 + Math.random() * 20; // Random height between 10 and 30
      const width = height + 20 + Math.random() * 30; // Width is always at least 20px > height
      return {
        x: canvas.width + 50 + Math.random() * 200,
        y: Math.random() * canvas.height,
        width,
        height,
        speed: 3 + Math.random() * 8
      };
    };
    
    for (let i = 0; i < maxBlocks; i++) {
      blocks.push(createBlock());
    }

    const resizeCanvas = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    };

    const draw = () => {
      if (!ctx) return;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // --- Update animation state ---
      waveTime += 0.1; // Faster wave animation
      noiseTime += 0.002; // Slow, sparse noise updates

      // --- Calculate Perlin noise pushback ---
      const noiseValue = noise2D(noiseTime, 0);
      targetPush = noiseValue * 20;
      currentPush += (targetPush - currentPush) * 0.05;

      // --- Draw the sine wave ---
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const waveLength = 200;
      const amplitude = 10;
      const frequency = 0.04;

      ctx.beginPath();
      const startX = centerX - waveLength / 2 + currentPush;
      const startY = centerY + Math.sin(waveTime) * amplitude; 
      ctx.moveTo(startX, startY);

      for (let x = 1; x <= waveLength; x++) {
          const y = centerY + Math.sin((x * frequency) + waveTime) * amplitude;
          ctx.lineTo(startX + x, y);
      }

      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      
      // --- Update and draw blocks ---
      blocks.forEach((block) => {
        block.x -= block.speed;
        if (block.x < -block.width - 50) {
          Object.assign(block, createBlock(), { x: canvas.width + 50 });
        }
        
        ctx.strokeStyle = '#888888';
        ctx.lineWidth = 2;
        ctx.fillStyle = 'transparent';
        ctx.beginPath();
        ctx.rect(block.x, block.y, block.width, block.height);
        ctx.stroke();
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

export default BouncingBallAnimation;