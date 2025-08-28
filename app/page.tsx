"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useWorldEngine } from './bitworld/world.engine';
import { BitHomeCanvas } from './bitworld/bit.home';
import { auth } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { getUsernameByUid } from './firebase';

export default function Home() {
  const [cursorAlternate, setCursorAlternate] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  
  // Control form display based on route
  const showForm = pathname === '/signup' || pathname === '/login';
  const isSignup = pathname === '/signup';
  const isLogin = pathname === '/login';
  
  // Listen for authentication state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      setAuthLoading(false);
      
      // If user is already logged in and not on a form page, redirect to their homepage
      if (user && !showForm) {
        const username = await getUsernameByUid(user.uid);
        if (username) {
          router.push(`/@${username}`);
        }
      }
    });
    
    return () => unsubscribe();
  }, [showForm, router]);
  
  const engine = useWorldEngine({ 
    worldId: 'homeWorld', 
    // initialBackgroundColor: '#000',
    userUid: user?.uid || null
  });

  // Navigation handlers
  const handleLoginClick = useCallback(() => {
    // Navigate to login page
    router.push('/login');
  }, [router]);

  const handleSignupClick = useCallback(() => {
    // Update URL without unmounting component
    router.push('/signup');
  }, [router]);

  const handleBackToHome = useCallback(() => {
    // Return to home from signup mode
    router.push('/');
  }, [router]);

  const handleAuthSuccess = useCallback((username: string) => {
    // Navigate to user's homepage
    router.push(`/@${username}`);
  }, [router]);

  // Simple cursor blink effect (like BitCanvas)
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorAlternate(prev => !prev);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Clear existing data when engine loads (removed - this was causing infinite loops)

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

  if (authLoading || engine.isLoadingWorld) {
    return (
      <div className="w-screen h-screen flex items-center justify-center" style={{backgroundColor: '#39FF14'}}>
        <div className="text-black">Loading...</div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen relative" style={{backgroundColor: 'orange'}}>
      <BitHomeCanvas
        engine={engine}
        cursorColorAlternate={cursorAlternate}
        className="w-full h-full"
        monogramEnabled={true}
        showForm={showForm}
        isSignup={isSignup}
        taglineText={!showForm ? {
          title: "nara web services",
          subtitle: "intelligence, simplified."
        } : undefined}
        navButtons={!showForm ? {
          onLoginClick: handleLoginClick,
          onSignupClick: handleSignupClick
        } : undefined}
        onBackClick={showForm ? handleBackToHome : undefined}
        onAuthSuccess={handleAuthSuccess}
      />
    </div>
  );
}