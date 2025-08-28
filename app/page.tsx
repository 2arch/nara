"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useWorldEngine } from './bitworld/world.engine';
import { BitHomeCanvas } from './bitworld/bit.home';

export default function Home() {
  const [cursorAlternate, setCursorAlternate] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  
  // Control form display based on route
  const showForm = pathname === '/signup';
  
  const engine = useWorldEngine({ 
    worldId: 'homeWorld', 
    initialBackgroundColor: '#FFFFFF' 
  });

  // Navigation handlers
  const handleLoginClick = useCallback(() => {
    console.log('Login clicked');
    // TODO: Navigate to login page or show login modal
  }, []);

  const handleSignupClick = useCallback(() => {
    // Update URL without unmounting component
    router.push('/signup');
  }, [router]);

  const handleBackToHome = useCallback(() => {
    // Return to home from signup mode
    router.push('/');
  }, [router]);

  // Simple cursor blink effect (like BitCanvas)
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorAlternate(prev => !prev);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Clear existing data when engine loads
  useEffect(() => {
    if (!engine.isLoadingWorld) {
      // Clear existing data
      Object.keys(engine.worldData).forEach(key => {
        delete engine.worldData[key];
      });
    }
  }, [engine.isLoadingWorld]);

  // Handle escape key to return to home from signup
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showForm) {
        handleBackToHome();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showForm, handleBackToHome]);

  if (engine.isLoadingWorld) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-white">
        <div className="text-black">Loading...</div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-white relative">
      <BitHomeCanvas
        engine={engine}
        cursorColorAlternate={cursorAlternate}
        className="w-full h-full"
        monogramEnabled={true}
        showForm={showForm}
        taglineText={!showForm ? {
          title: "nara web services",
          subtitle: "intelligence, simplified."
        } : undefined}
        navButtons={!showForm ? {
          onLoginClick: handleLoginClick,
          onSignupClick: handleSignupClick
        } : undefined}
      />
    </div>
  );
}