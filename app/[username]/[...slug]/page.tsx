"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useWorldEngine } from '../../bitworld/world.engine';
import { BitCanvas } from '../../bitworld/bit.canvas';
import SpaceBackground from '../../bitworld/canvas.bg';
import { auth } from '../../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

export default function UserState() {
  const [cursorAlternate, setCursorAlternate] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const router = useRouter();
  const params = useParams();
  const username = decodeURIComponent(params.username as string).replace('@', '');
  const slug = params.slug as string[];
  const stateName = slug?.[0] || 'default';
  
  // Listen for authentication state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setAuthLoading(false);
    });
    
    return () => unsubscribe();
  }, []);
  
  const engine = useWorldEngine({ 
    worldId: stateName, 
    // initialBackgroundColor: '#000',
    userUid: user?.uid || null,
    username: username,
    initialStateName: stateName
  });

  // Simple cursor blink effect
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorAlternate(prev => !prev);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  if (authLoading || !user || engine.isLoadingWorld) {
    return (
      <div className="w-screen h-screen flex items-center justify-center" style={{}}>
        <div className="text-black">Loading...</div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen relative" style={{}}>
      {/* Render SpaceBackground when space mode is active */}
      {engine.backgroundMode === 'space' && <SpaceBackground />}
      
      <BitCanvas
        engine={engine}
        cursorColorAlternate={cursorAlternate}
        className="w-full h-full"
        monogramEnabled={true}
        dialogueEnabled={true}
        fontFamily={engine.fontFamily}
      />
    </div>
  );
}