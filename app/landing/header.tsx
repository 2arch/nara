"use client"

// app/landing/Header.tsx
import React from 'react';

const Header = () => {
  return (
    <header className="fixed top-0 left-0 w-full z-50 transition-all duration-300">
      <div className="container mx-auto px-6 py-4 flex justify-between items-center">
        {/* Left Side: Brand/Logo */}
        <div>
          <a href="/" className="text-white text-xl font-bold">
            NARA
          </a>
        </div>

        {/* Right Side: Navigation / Call to Action */}
        <nav>
          <ul className="flex items-center gap-x-6">
            <li>
              <a href="#features" className="text-gray-300 hover:text-white transition-colors text-sm">
                Features
              </a>
            </li>
            <li>
              <a href="#" className="bg-white text-black font-semibold py-2 px-4 rounded-md hover:bg-gray-200 transition-colors text-sm">
                Try Today
              </a>
            </li>
          </ul>
        </nav>
      </div>
       {/* Optional: Add a subtle background blur for modern look */}
       <style jsx>{`
        header {
          background-color: rgba(0, 0, 0, 0.5);
          backdrop-filter: saturate(180%) blur(10px);
        }
      `}</style>
    </header>
  );
};

export default Header;