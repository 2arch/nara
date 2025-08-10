'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

// Constants from bitworld dialogue
const HEADER_FONT_SIZE = 14;
const FONT_FAMILY = 'IBM Plex Mono';
const CHAR_WIDTH_RATIO = 0.6;
const HEADER_MARGIN_CHARS = 2;
const DIALOGUE_BACKGROUND_COLOR = 'rgba(0, 0, 0, 1)';
const HEADER_TEXT_COLOR = '#FFFFFF';
const INTERACTIVE_TEXT_COLOR = '#FFFFFF'; // Orange for interactive elements

export interface DialogueHeaderType {
  type: 'header' | 'navigation' | 'custom';
  leftText?: string;
  rightButtons?: {
    features?: string;
    tryToday?: string;
  };
  centerText?: string;
  interactive?: {
    tryToday?: boolean;
    features?: boolean;
  };
  onTryTodayClick?: () => void;
}

interface DialogueHeaderProps {
  dialogueType: DialogueHeaderType;
  className?: string;
}

export default function DialogueHeader({ dialogueType, className }: DialogueHeaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const router = useRouter();
  
  const scrollToFeatures = useCallback(() => {
    const featuresSection = document.querySelector('#features') || document.querySelector('section h1');
    if (featuresSection) {
      featuresSection.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  const navigateToFunnel = useCallback(() => {
    router.push('/funnel');
  }, [router]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const charWidth = HEADER_FONT_SIZE * CHAR_WIDTH_RATIO;
    const charHeight = HEADER_FONT_SIZE;
    const topY = HEADER_MARGIN_CHARS * charHeight / 2;
    
    // Check if click is in header area
    if (y >= topY && y <= topY + charHeight) {
      if (dialogueType.rightButtons) {
        const featuresText = dialogueType.rightButtons.features || "features";
        const tryTodayText = dialogueType.rightButtons.tryToday || "try today";
        const buttonSpacing = 2; // Space between buttons
        
        // Calculate positions for right-aligned buttons
        const totalButtonWidth = featuresText.length + buttonSpacing + tryTodayText.length;
        const buttonsStartX = canvas.width - ((totalButtonWidth + HEADER_MARGIN_CHARS) * charWidth);
        
        const featuresX = buttonsStartX;
        const tryTodayX = buttonsStartX + (featuresText.length + buttonSpacing) * charWidth;
        
        // Check "features" button click
        if (dialogueType.interactive?.features && 
            x >= featuresX && x <= featuresX + featuresText.length * charWidth) {
          scrollToFeatures();
          return;
        }
        
        // Check "try today" button click
        if (dialogueType.interactive?.tryToday && 
            x >= tryTodayX && x <= tryTodayX + tryTodayText.length * charWidth) {
          if (dialogueType.onTryTodayClick) {
            dialogueType.onTryTodayClick();
          } else {
            navigateToFunnel();
          }
          return;
        }
      }
    }
  }, [dialogueType, navigateToFunnel, scrollToFeatures]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const charHeight = HEADER_FONT_SIZE;
    const charWidth = HEADER_FONT_SIZE * CHAR_WIDTH_RATIO;
    const topY = HEADER_MARGIN_CHARS * charHeight / 2;

    // Clear canvas
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    ctx.save();
    ctx.font = `${HEADER_FONT_SIZE}px "${FONT_FAMILY}"`;
    ctx.textBaseline = 'top';

    // Left text (nara web services)
    const leftText = dialogueType.leftText || "nara web services";
    const leftX = HEADER_MARGIN_CHARS * charWidth;
    ctx.fillStyle = DIALOGUE_BACKGROUND_COLOR;
    ctx.fillRect(leftX, topY, leftText.length * charWidth, charHeight);
    ctx.fillStyle = HEADER_TEXT_COLOR;
    ctx.fillText(leftText, leftX, topY);

    // Right buttons (features and try today)
    if (dialogueType.rightButtons) {
      const featuresText = dialogueType.rightButtons.features || "features";
      const tryTodayText = dialogueType.rightButtons.tryToday || "try today";
      const buttonSpacing = 2; // Space between buttons
      
      // Calculate positions for right-aligned buttons
      const totalButtonWidth = featuresText.length + buttonSpacing + tryTodayText.length;
      const buttonsStartX = canvasWidth - ((totalButtonWidth + HEADER_MARGIN_CHARS) * charWidth);
      
      const featuresX = buttonsStartX;
      const tryTodayX = buttonsStartX + (featuresText.length + buttonSpacing) * charWidth;
      
      // Draw "features" button
      ctx.fillStyle = DIALOGUE_BACKGROUND_COLOR;
      ctx.fillRect(featuresX, topY, featuresText.length * charWidth, charHeight);
      ctx.fillStyle = dialogueType.interactive?.features ? INTERACTIVE_TEXT_COLOR : HEADER_TEXT_COLOR;
      ctx.fillText(featuresText, featuresX, topY);
      
      // Draw "try today" button
      ctx.fillStyle = DIALOGUE_BACKGROUND_COLOR;
      ctx.fillRect(tryTodayX, topY, tryTodayText.length * charWidth, charHeight);
      ctx.fillStyle = dialogueType.interactive?.tryToday ? INTERACTIVE_TEXT_COLOR : HEADER_TEXT_COLOR;
      ctx.fillText(tryTodayText, tryTodayX, topY);
    }

    ctx.restore();
  }, [dialogueType]);

  // Handle resize
  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = window.innerWidth;
      canvas.height = 60; // Fixed height for header
      draw();
    }
  }, [draw]);

  useEffect(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className={`block ${className || ''}`}
      onClick={handleCanvasClick}
      style={{ 
        cursor: (dialogueType.interactive?.tryToday || dialogueType.interactive?.features) ? 'pointer' : 'default',
        width: '100%',
        height: '60px'
      }}
    />
  );
}