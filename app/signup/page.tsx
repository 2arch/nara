"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { useWorldEngine } from '../bitworld/world.engine';
import { BitHomeCanvas } from '../bitworld/bit.home';

const SignupPage: React.FC = () => {
  const [cursorAlternate, setCursorAlternate] = useState(false);
  const [formInitialized, setFormInitialized] = useState(false);
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });
  
  const engine = useWorldEngine({ 
    worldId: 'signupWorld', 
    initialBackgroundColor: '#FFFFFF' 
  });

  // Calculate responsive zoom level based on screen size (reduced for better monogram alignment)
  const calculateZoomLevel = useCallback(() => {
    if (windowSize.width === 0) return 1.0; // Default zoom level
    
    // Mobile: smaller screens get moderate zoom
    if (windowSize.width < 768) {
      return 1.2;
    }
    // Tablet: medium screens
    else if (windowSize.width < 1024) {
      return 1.1;
    }
    // Desktop: larger screens get minimal zoom
    else {
      return 1.0;
    }
  }, [windowSize]);

  // Handle window resize - update zoom and trigger form repositioning
  const handleResize = useCallback(() => {
    const newSize = {
      width: window.innerWidth,
      height: window.innerHeight
    };
    setWindowSize(newSize);
  }, []);
  
  // Don't reposition form on resize - just update zoom
  // Form stays in place, only zoom changes for responsiveness

  // Initialize window size and resize listener
  useEffect(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  // Update zoom level when window size changes
  useEffect(() => {
    if (windowSize.width > 0) {
      const newZoom = calculateZoomLevel();
      engine.setZoomLevel(newZoom);
    }
  }, [windowSize, calculateZoomLevel, engine.setZoomLevel]);

  // Setup form when needed
  useEffect(() => {
    if (engine.isLoadingWorld || windowSize.width === 0 || formInitialized) return;
    
    console.log('Setting up form:', { windowSize: windowSize.width });
    
    // Clear ALL existing data first
    Object.keys(engine.worldData).forEach(key => {
      delete engine.worldData[key];
    });
    
    // Clear other data stores
    Object.keys(engine.lightModeData || {}).forEach(key => {
      delete engine.lightModeData[key];
    });
    Object.keys(engine.chatData || {}).forEach(key => {
      delete engine.chatData[key];
    });
    Object.keys(engine.searchData || {}).forEach(key => {
      delete engine.searchData[key];
    });
    
    // Clear compiled text cache
    if (engine.setCompiledTextCache) {
      engine.setCompiledTextCache([]);
    }
    
    // Calculate responsive form dimensions
    let inputWidth: number;
    let buttonWidth: number;
    let spacing: number;
    
    if (windowSize.width < 768) {
      inputWidth = 20;
      buttonWidth = 10;
      spacing = 2;
    } else if (windowSize.width < 1024) {
      inputWidth = 25;
      buttonWidth = 12;
      spacing = 3;
    } else {
      inputWidth = 30;
      buttonWidth = 15;
      spacing = 3;
    }
    
    // Get viewport center
    const viewportCenter = engine.getViewportCenter();
    
    // Calculate positions (no title text)
    const emailInputX = Math.floor(viewportCenter.x - inputWidth / 2);
    const emailY = Math.floor(viewportCenter.y - 1); // Move up since no title
    
    const passwordInputX = Math.floor(viewportCenter.x - inputWidth / 2);
    const passwordY = emailY + spacing;
    
    const buttonX = Math.floor(viewportCenter.x - buttonWidth / 2);
    const buttonY = passwordY + spacing;
    
    // Create form elements
    const signupFormData: { [key: string]: string } = {
      [`input_${emailInputX},${emailY}`]: JSON.stringify({
        type: 'email',
        placeholder: windowSize.width < 768 ? 'Email' : 'Enter your email',
        value: '',
        width: inputWidth,
        viewOffset: 0,
        cursorPos: 0,
        focused: false
      }),
      
      [`input_${passwordInputX},${passwordY}`]: JSON.stringify({
        type: 'password',
        placeholder: windowSize.width < 768 ? 'Password' : 'Enter your password',
        value: '',
        width: inputWidth,
        viewOffset: 0,
        cursorPos: 0,
        focused: false
      }),
      
      [`button_${buttonX},${buttonY}`]: JSON.stringify({
        text: 'Sign Up',
        action: 'signup',
        width: buttonWidth,
        style: 'primary'
      })
    };
    
    // Place form elements (no title text)
    Object.entries(signupFormData).forEach(([key, value]) => {
      engine.worldData[key] = value;
    });
    
    setFormInitialized(true);
  }, [engine.isLoadingWorld, windowSize.width, formInitialized, engine.worldData, engine.lightModeData, engine.chatData, engine.searchData, engine.setCompiledTextCache, engine.getViewportCenter]);

  // Cursor blink effect
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorAlternate(prev => !prev);
    }, 500);

    return () => {
      clearInterval(interval);
    };
  }, []);

  // Center viewport on form when form is first initialized
  useEffect(() => {
    if (formInitialized && windowSize.width > 0) {
      const viewportCenter = engine.getViewportCenter();
      engine.setViewOffset({
        x: viewportCenter.x - windowSize.width / (2 * engine.getEffectiveCharDims(engine.zoomLevel).width),
        y: viewportCenter.y - windowSize.height / (2 * engine.getEffectiveCharDims(engine.zoomLevel).height)
      });
    }
  }, [formInitialized, windowSize.width, engine.getViewportCenter, engine.setViewOffset, engine.getEffectiveCharDims, engine.zoomLevel]);

  if (engine.isLoadingWorld) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-white">
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-white relative">
      {/* Main signup canvas with form elements and integrated monogram */}
      <BitHomeCanvas
        engine={engine}
        cursorColorAlternate={cursorAlternate}
        className="w-full h-full"
        monogramEnabled={true} // Enable integrated monogram rendering
      />
    </div>
  );
};

export default SignupPage;