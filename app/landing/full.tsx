// app/components/FullScreenAnimation.tsx
"use client";

import React from 'react';

type FullScreenAnimationProps = {
  blurb: string;
  animation: React.ReactNode;
};

const FullScreenAnimation: React.FC<FullScreenAnimationProps> = ({ blurb, animation }) => {
  return (
    <div className="h-screen w-full relative flex items-center justify-center">
      {/* Canvas for the background animation */}
      {animation}
      
      {/* Centered content on top of the canvas */}
      <div className="relative z-10 flex flex-col items-center text-white">
        {/* Dialogue-styled blurb */}
        <div 
          className="inline-block mt-96 mb-6"
          style={{
            backgroundColor: 'rgba(0, 0, 0, 1)',
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: '24px',
            color: '#FFFFFF',
            border: 'none',
            lineHeight: '1'
          }}
        >
          {blurb}
        </div>
        <button 
          style={{
            backgroundColor: '#003DFF',
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: '24px',
            color: '#FFFFFF',
            border: 'none',
            lineHeight: '1'
          }}
        >
          try today
        </button>
      </div>
    </div>
  );
};

export default FullScreenAnimation;