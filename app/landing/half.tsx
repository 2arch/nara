// app/components/Half.tsx
import React from 'react';

type HalfProps = {
  children: React.ReactNode;
  animation?: React.ReactNode;
  gifName?: string; // Optional gif name for animation overlay
  image?: React.ReactNode; // Optional static image instead of animation
};

const Half: React.FC<HalfProps> = ({ children, animation, gifName, image }) => {
  // Generate the ID based on gifName, fallback to "animate" for backward compatibility
  const animationId = gifName ? `animation-${gifName}` : 'animate';
  
  return (
    <div className="h-[30vh] w-full px-4 flex text-black">
      {/* Left side for animation or image */}
      <div id={animationId} className="w-1/2 h-full relative">
        {image || animation}
      </div>
      {/* Right side for content */}
      <div  className="w-1/2 h-full flex items-center justify-center p-4">
        {children}
      </div>
    </div>
  );
};

export default Half;