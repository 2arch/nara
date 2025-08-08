// app/components/Half.tsx
import React from 'react';

type HalfProps = {
  children: React.ReactNode;
};

const Half: React.FC<HalfProps> = ({ children }) => {
  return (
    <div className="h-[60vh] w-full flex text-white border border-white">
      {/* Left side for animation */}
      <div className="w-1/2 h-full flex items-center justify-center">
        <p>Animation Placeholder</p>
      </div>
      {/* Right side for content */}
      <div className="w-1/2 h-full flex items-center justify-center p-4">
        {children}
      </div>
    </div>
  );
};

export default Half;