'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

// Constants
const HEADER_FONT_SIZE = '14px';
const FONT_FAMILY = "'IBM Plex Mono', monospace";
const HEADER_TEXT_COLOR = '#FFFFFF';
const INTERACTIVE_TEXT_COLOR = '#F2F2F2'; // Orange for interactive elements

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

  const handleTryTodayClick = dialogueType.onTryTodayClick || navigateToFunnel;

  const buttonStyle: React.CSSProperties = {
    fontFamily: FONT_FAMILY,
    fontSize: HEADER_FONT_SIZE,
    color: HEADER_TEXT_COLOR,
    background: 'rgba(0, 0, 0, 1)',
    border: 'none',
    pointerEvents: 'auto',
    cursor: 'default',
    margin: '0 20px',
  };

  const interactiveButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    color: INTERACTIVE_TEXT_COLOR,
    cursor: 'pointer',
  };

  return (
    <div
      className={className}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '60px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontFamily: FONT_FAMILY,
        fontSize: HEADER_FONT_SIZE,
        color: HEADER_TEXT_COLOR,
        pointerEvents: 'none', // Let clicks pass through the container
        zIndex: 10,
      }}
    >
      <div style={{ pointerEvents: 'auto', lineHeight: 1, padding: '0 0' }}>
        <button
          onClick={() => router.push('/')}
          style={{ ...buttonStyle, cursor: 'pointer' }}
        >
          {dialogueType.leftText || "nara web services"}
        </button>
      </div>

      {dialogueType.rightButtons && (
        <div style={{ display: 'flex', lineHeight: 1, pointerEvents: 'auto' }}>
          {dialogueType.rightButtons.features && (
            <button
              onClick={dialogueType.interactive?.features ? scrollToFeatures : undefined}
              style={dialogueType.interactive?.features ? interactiveButtonStyle : buttonStyle}
            >
              {dialogueType.rightButtons.features}
            </button>
          )}
          {dialogueType.rightButtons.tryToday && (
            <button
              onClick={dialogueType.interactive?.tryToday ? handleTryTodayClick : undefined}
              style={dialogueType.interactive?.tryToday ? interactiveButtonStyle : buttonStyle}
            >
              {dialogueType.rightButtons.tryToday}
            </button>
          )}
        </div>
      )}
    </div>
  );
}