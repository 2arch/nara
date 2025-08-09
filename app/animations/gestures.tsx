"use client";

import React, { useRef, useEffect } from 'react';

interface Point {
  x: number;
  y: number;
  life: number;
}

const GesturesAnimation = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameId: number;
    const trail: Point[] = [];
    let angle = 0;

    const resizeCanvas = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    };

    const draw = () => {
      if (!ctx) return;
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      // Add new point to the trail
      const radius = Math.min(width, height) * 0.4;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle * 1.2) * radius;
      trail.push({ x, y, life: 1 });
      angle += 0.08;

      // Draw and update trail
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < trail.length; i++) {
        const p = trail[i];
        p.life -= 0.01;
        if (p.life <= 0) {
          trail.splice(i, 1);
          i--;
          continue;
        }
        ctx.globalAlpha = p.life;
        if (i === 0) {
          ctx.moveTo(p.x, p.y);
        } else {
          ctx.lineTo(p.x, p.y);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

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

export default GesturesAnimation;
