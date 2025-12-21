"use client";
import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useWorldEngine } from './bitworld/world.engine';
import { BitCanvas } from './bitworld/bit.canvas';
import { useMonogram } from './bitworld/monogram';
import { auth } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { getUsernameByUid, completeSignInWithEmailLink } from './firebase';
import { DEFAULT_VISUAL_CONFIG, DEFAULT_EXPERIENCE_ID } from './bitworld/experiences';

function HomeContent() {
  const [cursorAlternate, setCursorAlternate] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isVerifyingEmail, setIsVerifyingEmail] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Experience link system: ?exp=[id]
  const experienceId = searchParams.get('exp');

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
      // Don't auto-redirect here - let intro flow check auth after banner
    });

    return () => unsubscribe();
  }, [router]);

  // Log experience link for analytics/debugging
  useEffect(() => {
    if (experienceId) {
      console.log(`[Experience] User arrived via: ${experienceId}`);
    }
  }, [experienceId]);

  // Monogram system - create once and pass to both engine and canvas
  const monogram = useMonogram({ enabled: true, speed: 0.5, complexity: 1.0 });

  const engine = useWorldEngine({
    worldId: null, // Always null for home page (anonymous users)
    initialBackgroundColor: DEFAULT_VISUAL_CONFIG.backgroundColor,
    userUid: null, // Always null for home page
    initialZoomLevel: 1.6, // Zoomed in for host mode onboarding
    skipInitialBackground: !isVerifyingEmail, // Skip initial bg when intro flow is active
    monogramSystem: monogram // Pass monogram to engine for command system
  });

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

  return (
    <div className="w-screen relative" style={{backgroundColor: '#F8F8F0', height: '100dvh'}}>
      <BitCanvas
        engine={engine}
        cursorColorAlternate={cursorAlternate}
        className="w-full h-full"
        dialogueEnabled={false}
        hostModeEnabled={true}
        onAuthSuccess={handleAuthSuccess}
        fontFamily={engine.fontFamily}
        isVerifyingEmail={isVerifyingEmail}
        hostTextColor={DEFAULT_VISUAL_CONFIG.hostTextColor}
        monogram={monogram}
        hostBackgroundColor={DEFAULT_VISUAL_CONFIG.backgroundColor}
        hostDimBackground={false}
        experienceId={experienceId || DEFAULT_EXPERIENCE_ID}
      />
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="w-screen h-screen" style={{backgroundColor: '#F8F8F0'}} />}>
      <HomeContent />
    </Suspense>
  );
}