// app/components/Half.tsx
import React from 'react';

type HalfProps = {
  children: React.ReactNode;
  animation: React.ReactNode;
};

const Half: React.FC<HalfProps> = ({ children, animation }) => {
  return (
    <div className="h-[30vh] w-full flex text-black">
      {/* Left side for animation */}
      <div id="animate" className="w-1/2 h-full relative">
        {animation}
      </div>
      {/* Right side for content */}
      <div  className="w-1/2 h-full flex items-center justify-center p-4">
        {children}
      </div>
    </div>
  );
};

export default Half;