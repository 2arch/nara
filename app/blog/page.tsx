"use client";
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWorldEngine } from '../bitworld/world.engine';
import { BitPageCanvas } from '../bitworld/bit.page';
import { auth } from '../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import type { CanvasButton } from '../bitworld/canvas.buttons';

export default function BlogPage() {
  const [cursorAlternate, setCursorAlternate] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [statesVersion, setStatesVersion] = useState(0); // Force re-render when states change
  const router = useRouter();
  
  // Listen for authentication state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setAuthLoading(false);
    });
    
    return () => unsubscribe();
  }, []);

  const engine = useWorldEngine({ 
    worldId: 'posts',
    userUid: 'blog', // Use 'blog' as userUid to save under worlds/blog/{post}/data
    username: 'blog', // Use 'blog' as username for blog content
    // Start at the top of the blog
    initialViewOffset: { x: 0, y: 0 },
    initialCursorPos: { x: 0, y: 0 }, // Will be adjusted to text area boundary by the component
    enableCommands: false, // Disable commands for clean blog experience
  });

  // Load available blog posts when engine is ready
  useEffect(() => {
    if (engine && !authLoading) {
      engine.loadAvailableStates();
    }
  }, [engine, authLoading]);

  // Simple cursor blink effect
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorAlternate(prev => !prev);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  if (authLoading || engine.isLoadingWorld) {
    return (
      <div className="w-screen h-screen flex items-center justify-center" style={{backgroundColor: '#f8f9fa'}}>
        <div className="text-black">Loading blog...</div>
      </div>
    );
  }

  // Dynamic canvas button configuration for blog posts
  const canvasButtons: CanvasButton[] = [
    // Back to Home button - always first
    {
      id: 'back-to-home',
      text: 'back to home',
      onClick: () => {
        router.push('/');
      },
      position: 'sidebar-left',
      color: '#39FF14',
      style: 'primary'
    },
    // Dynamic buttons for existing blog posts
    ...engine.availableStates.map((stateName) => ({
      id: `post-${stateName}`,
      text: stateName,
      onClick: () => {
        router.push(`/blog/${stateName}`);
      },
      position: 'sidebar-left' as const,
      style: 'primary' as const
    })),
    // New Post button - always last
    {
      id: 'new-post',
      text: 'new post',
      onClick: () => {
        const postName = prompt('Enter new post name:');
        if (postName && postName.trim()) {
          engine.saveState(postName.trim()).then((success) => {
            if (success) {
              // Refresh available states to update button display
              engine.loadAvailableStates().then(() => {
                // Force component re-render when states change
                setStatesVersion(prev => prev + 1);
              });
              console.log(`Created new post: ${postName}`);
            }
          });
        }
      },
      position: 'sidebar-left',
      color: '#003DFF',
      style: 'primary'
    }
  ];

  return (
    <div className="w-screen h-screen relative" style={{backgroundColor: '#ffffff'}}>
      <BitPageCanvas
        engine={engine}
        cursorColorAlternate={cursorAlternate}
        className="w-full h-full"
        showCursor={true}
        monogramEnabled={false} // Keep it clean for blog content
        topBoundary={0} // Distinct top boundary
        // No fixedWidth - let text use full remaining space after sidebar
        buttons={canvasButtons} // Canvas-based navigation and sidebar buttons
      />
    </div>
  );
}