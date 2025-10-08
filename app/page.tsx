"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useWorldEngine } from './bitworld/world.engine';
import { BitHomeCanvas } from './bitworld/bit.home';
import { BitCanvas } from './bitworld/bit.canvas';
import { auth } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { getUsernameByUid, completeSignInWithEmailLink } from './firebase';

export default function Home() {
  const [cursorAlternate, setCursorAlternate] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isVerifyingEmail, setIsVerifyingEmail] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Control form display based on route
  const showForm = pathname === '/signup' || pathname === '/login';
  const isSignup = pathname === '/signup';
  const isLogin = pathname === '/login';

  // Always use host mode on home page (both authenticated and anonymous)
  const shouldUseHostMode = pathname === '/' && !authLoading;

  // Check for email link sign-in on mount
  useEffect(() => {
    const handleEmailLink = async () => {
      // Check if URL contains email link parameters
      if (typeof window !== 'undefined' && window.location.href.includes('apiKey=')) {
        setIsVerifyingEmail(true);
        try {
          const result = await completeSignInWithEmailLink();
          if (result.success && result.user) {
            // Auth state listener will handle the rest
            console.log('Email link verification successful');
            // Keep isVerifyingEmail true so we can show success message
          } else {
            setIsVerifyingEmail(false);
          }
        } catch (error) {
          setIsVerifyingEmail(false);
          console.log('Email link verification failed:', error);
        }
      }
    };

    handleEmailLink();
  }, []);

  // Listen for authentication state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      setAuthLoading(false);

      // If user is authenticated and on home page, redirect to their world
      if (user && pathname === '/') {
        const username = await getUsernameByUid(user.uid);
        if (username) {
          router.push(`/@${username}`);
        }
      }
    });

    return () => unsubscribe();
  }, [pathname, router]);

  // Dynamic colors based on time of day
  const [hostColors, setHostColors] = useState(() => {
    const hour = new Date().getHours();
    const isDaytime = hour >= 6 && hour < 18;
    return isDaytime
      ? { background: '#F0FF6A', text: '#FFA500' } // sulfur bg, orange text
      : { background: '#69AED6', text: '#000000' }; // chalk bg, black text
  });

  const engine = useWorldEngine({
    worldId: null,
    initialBackgroundColor: pathname === '/' ? hostColors.background : undefined,
    userUid: user?.uid || null,
    initialZoomLevel: pathname === '/' ? 1.6 : 1.0 // Zoomed in for host mode onboarding
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

  const handleVisitClick = useCallback(async () => {
    if (user) {
      const username = await getUsernameByUid(user.uid);
      if (username) {
        router.push(`/@${username}`);
      }
    }
  }, [router, user]);

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
      <div className="w-screen h-screen flex items-center justify-center" style={{backgroundColor: '#F8F8F0'}}>
        <div style={{ fontFamily: 'monospace', fontSize: '14px', color: '#000' }}>
          {authLoading ? 'loading...' : 'redirecting...'}
        </div>
      </div>
    );
  }

  // Use host mode for anonymous users on home page
  if (shouldUseHostMode) {
    // If coming from email verification, don't start normal flow
    const initialFlow = isVerifyingEmail ? undefined : "welcome";

    return (
      <div className="w-screen h-screen relative" style={{backgroundColor: '#F8F8F0'}}>
        <BitCanvas
          engine={engine}
          cursorColorAlternate={cursorAlternate}
          className="w-full h-full"
          monogramEnabled={true}
          dialogueEnabled={false}
          hostModeEnabled={true}
          initialHostFlow={initialFlow}
          onAuthSuccess={handleAuthSuccess}
          fontFamily={engine.fontFamily}
          isVerifyingEmail={isVerifyingEmail}
          hostTextColor={hostColors.text}
        />
      </div>
    );
  }

  // Use old form-based UI for /login and /signup routes
  return (
    <div className="w-screen h-screen relative" style={{backgroundColor: '#F8F8F0'}}>
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
        navButtons={!showForm ? (user ? {
          onVisitClick: handleVisitClick,
          isAuthenticated: true
        } : {
          onLoginClick: handleLoginClick,
          onSignupClick: handleSignupClick,
          isAuthenticated: false
        }) : undefined}
        onBackClick={showForm ? handleBackToHome : undefined}
        onAuthSuccess={handleAuthSuccess}
        fontFamily={engine.fontFamily}
      />
    </div>
  );
}