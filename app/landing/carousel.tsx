// app/components/Carousel.tsx
"use client";

import React, { useState, useRef, useEffect } from 'react';

type CarouselItem = {
  id: number;
  content: React.ReactNode;
};

type CarouselProps = {
  items: CarouselItem[];
};

const Carousel: React.FC<CarouselProps> = ({ items }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Drag-to-scroll logic
  const isDragging = useRef(false);
  const startX = useRef(0);
  const scrollLeft = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!trackRef.current) return;
    isDragging.current = true;
    startX.current = e.pageX - trackRef.current.offsetLeft;
    scrollLeft.current = trackRef.current.scrollLeft;
  };

  const handleMouseLeave = () => {
    isDragging.current = false;
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current || !trackRef.current) return;
    e.preventDefault();
    const x = e.pageX - trackRef.current.offsetLeft;
    const walk = (x - startX.current) * 2; // The multiplier increases drag speed
    trackRef.current.scrollLeft = scrollLeft.current - walk;
  };

  // Update dot indicator on scroll
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const handleScroll = () => {
      const itemWidth = track.scrollWidth / items.length;
      const newIndex = Math.round(track.scrollLeft / itemWidth);
      if (newIndex !== currentIndex) {
        setCurrentIndex(newIndex);
      }
    };

    track.addEventListener('scroll', handleScroll);
    return () => track.removeEventListener('scroll', handleScroll);
  }, [items.length, currentIndex]);

  return (
    <div className="h-[30vh] w-full flex flex-col">
      <div
        ref={trackRef}
        className="flex overflow-x-auto cursor-grab active:cursor-grabbing no-scrollbar h-full"
        onMouseDown={handleMouseDown}
        onMouseLeave={handleMouseLeave}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
      >
        {items.map((item, index) => (
          <div key={item.id} className="w-[50vw] flex-shrink-0 p-4 h-full">
            <div className="w-full h-full rounded-lg flex items-center justify-center text-black border border-white relative">
              {item.content}
              {index === items.length - 1 && (
                <button className="absolute bottom-4 right-4 bg-green-500 hover:bg-green-700 text-black font-bold py-2 px-3 rounded text-sm">
                  Learn More
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      
      {/* Dot Indicators */}
      <div className="flex justify-center items-center py-2">
        {items.map((_, index) => (
          <div
            key={index}
            className={`h-2 w-2 rounded-full mx-1 transition-colors duration-300 ${
              currentIndex === index ? 'bg-white' : 'bg-gray-500'
            }`}
          />
        ))}
      </div>
       {/* Simple CSS to hide the scrollbar */}
       <style jsx>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
};

export default Carousel;