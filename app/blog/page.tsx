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
    worldId: 'blog',
    userUid: null, // No userUid to save directly to worlds/blog/data
    username: 'blog', // Use 'blog' as username for blog content
    // Start at the top of the blog
    initialViewOffset: { x: 0, y: 0 },
    initialCursorPos: { x: 0, y: 0 }, // Will be adjusted to text area boundary by the component
    enableCommands: false, // Disable commands for clean blog experience
  });

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

  // Canvas button configuration - sidebar buttons only
  const canvasButtons: CanvasButton[] = [
    // Sidebar buttons positioned in the left 23% area
    {
      id: 'button1',
      text: 'button1',
      onClick: () => console.log('Button 1 clicked'),
      position: 'sidebar-left',
      style: 'primary'
    },
    {
      id: 'button2', 
      text: 'button2',
      onClick: () => console.log('Button 2 clicked'),
      position: 'sidebar-left',
      style: 'primary'
    },
    {
      id: 'button3',
      text: 'button3', 
      onClick: () => console.log('Button 3 clicked'),
      position: 'sidebar-left',
      style: 'primary'
    },
    {
      id: 'button4',
      text: 'button4',
      onClick: () => console.log('Button 4 clicked'), 
      position: 'sidebar-left',
      style: 'primary'
    },
    {
      id: 'button5',
      text: 'button5',
      onClick: () => console.log('Button 5 clicked'),
      position: 'sidebar-left', 
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