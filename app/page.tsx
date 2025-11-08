"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useWorldEngine } from './bitworld/world.engine';
import { BitCanvas } from './bitworld/bit.canvas';
import { auth } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { getUsernameByUid, completeSignInWithEmailLink } from './firebase';

export default function Home() {
  const [cursorAlternate, setCursorAlternate] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isVerifyingEmail, setIsVerifyingEmail] = useState(false);
  const [showBanner, setShowBanner] = useState(true);
  const [bannerFadedOut, setBannerFadedOut] = useState(false);
  const router = useRouter();

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

  // Banner intro animation
  useEffect(() => {
    // Show banner for 1.5 seconds, then fade out
    const bannerTimer = setTimeout(() => {
      setBannerFadedOut(true);
      // After fade animation completes (0.5s), hide banner
      setTimeout(() => setShowBanner(false), 500);
    }, 1500);

    return () => clearTimeout(bannerTimer);
  }, []);

  // Listen for authentication state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      setAuthLoading(false);

      // If user is already authenticated, redirect to their homepage
      if (user && !showBanner) {
        const username = await getUsernameByUid(user.uid);
        if (username) {
          router.push(`/@${username}`);
        }
      }
    });

    return () => unsubscribe();
  }, [router, showBanner]);

  // Dynamic colors based on time of day
  const [hostColors, setHostColors] = useState(() => {
    const hour = new Date().getHours();
    const isDaytime = hour >= 6 && hour < 18;
    return isDaytime
      ? { background: '#F0FF6A', text: '#FFA500' } // sulfur bg, orange text
      : { background: '#69AED6', text: '#000000' }; // chalk bg, black text
  });

  const engine = useWorldEngine({
    worldId: null, // Always null for home page (anonymous users)
    initialBackgroundColor: showBanner ? '#000000' : hostColors.background,
    userUid: null, // Always null for home page
    initialZoomLevel: 1.6 // Zoomed in for host mode onboarding
  });

  // Set monogram mode to 'nara' for banner
  useEffect(() => {
    if (showBanner) {
      engine.updateSettings({
        monogramMode: 'nara',
        monogramEnabled: true
      });
    }
  }, [showBanner, engine]);

  const handleAuthSuccess = useCallback((username: string) => {
    // Navigate to user's homepage (background color already saved to Firebase)
    router.push(`/@${username}`);
  }, [router]);

  // Simple cursor blink effect
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorAlternate(prev => !prev);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Determine what to show based on state
  const shouldShowWelcomeFlow = !showBanner && !user && !isVerifyingEmail;
  const initialFlow = isVerifyingEmail ? undefined : (shouldShowWelcomeFlow ? "welcome" : undefined);

  return (
    <div
      className="w-screen relative"
      style={{
        backgroundColor: showBanner ? '#000000' : '#F8F8F0',
        height: '100dvh',
        transition: 'background-color 0.5s ease',
        opacity: showBanner && bannerFadedOut ? 0 : 1,
        transitionProperty: 'background-color, opacity'
      }}
    >
      <BitCanvas
        engine={engine}
        cursorColorAlternate={cursorAlternate}
        className="w-full h-full"
        monogramEnabled={showBanner}
        dialogueEnabled={false}
        hostModeEnabled={!showBanner}
        hostMonogramMode={showBanner ? 'user-settings' : 'off'}
        initialHostFlow={initialFlow}
        onAuthSuccess={handleAuthSuccess}
        fontFamily={engine.fontFamily}
        isVerifyingEmail={isVerifyingEmail}
        hostTextColor={hostColors.text}
        hostBackgroundColor={hostColors.background}
        hostDimBackground={false}
      />
    </div>
  );
}