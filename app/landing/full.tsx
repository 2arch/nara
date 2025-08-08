// app/components/FullScreenAnimation.tsx
"use client";

import React, { useRef, useEffect } from 'react';

type FullScreenAnimationProps = {
  blurb: string;
};

const FullScreenAnimation: React.FC<FullScreenAnimationProps> = ({ blurb }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameId: number;
    let x = 50;
    let y = 50;
    let dx = 2;
    let dy = 2;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000'; // Black background
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Simple animation: a bouncing circle
      ctx.beginPath();
      ctx.arc(x, y, 20, 0, Math.PI * 2);
      ctx.fillStyle = '#4A90E2';
      ctx.fill();
      ctx.closePath();

      if (x + dx > canvas.width - 20 || x + dx < 20) {
        dx = -dx;
      }
      if (y + dy > canvas.height - 20 || y + dy < 20) {
        dy = -dy;
      }

      x += dx;
      y += dy;

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

  return (
    <div className="h-screen w-full relative flex items-center justify-center">
      {/* Canvas for the background animation */}
      <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full z-0" />
      
      {/* Centered content on top of the canvas */}
      <div className="relative z-10 flex flex-col items-center text-white">
        <p className="text-xl mb-10">{blurb}</p>
        <button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
          Try Today
        </button>
      </div>
    </div>
  );
};

export default FullScreenAnimation;