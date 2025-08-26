// app/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { useWorldEngine } from '@/app/bitworld/world.engine';
import { BitCanvas } from '@/app/bitworld/bit.canvas';
import SpaceBackground from '@/app/bitworld/canvas.bg';
import DialogueHeader, { DialogueHeaderType } from '@/app/landing/dialogue-header';

// --- Constants ---
const CURSOR_BLINK_RATE = 200;
const BACKGROUND_COLOR = '#000000';

export default function CorbuType() {
    const worldId = "defaultWorld"; // Provide a default or dynamic ID

    // Pass an object containing the worldId to the hook - start with empty data
    const engine = useWorldEngine({ 
        worldId,
        initialWorldData: {} // Explicitly start with empty world data
    });

    // Keep cursor blink state here, as it's purely visual
    const [cursorColorAlternate, setCursorColorAlternate] = useState(false);

    // --- Effect for Cursor Blinking ---
    useEffect(() => {
        const blinkInterval = setInterval(() => {
            setCursorColorAlternate(prev => !prev);
        }, CURSOR_BLINK_RATE);
        return () => clearInterval(blinkInterval);
    }, []);

    // --- Block Management Effect ---
    const dialogueType: DialogueHeaderType = {
        type: 'header',
        leftText: 'nara web services',
        rightButtons: {
            features: 'v 1.0.0',
            tryToday: ''
        },
        interactive: {
            features: false,
            tryToday: false
        }
    };

    return (
        <div style={{
            overflow: 'hidden',
            width: '100vw',
            height: '100vh',
            cursor: 'text', // Default cursor style
            backgroundColor: (engine.backgroundMode === 'image' || engine.backgroundMode === 'video' || engine.backgroundMode === 'stream') ? 'transparent' : BACKGROUND_COLOR,
            backgroundImage: engine.backgroundMode === 'image' && engine.backgroundImage 
                ? `url(${engine.backgroundImage})` 
                : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            position: 'relative'
        }}>
            {/* Conditional background effects */}
            {engine.backgroundMode === 'space' && <SpaceBackground />}
            
            {/* Video background */}
            {engine.backgroundMode === 'video' && engine.backgroundVideo && (
                <video
                    autoPlay
                    loop
                    muted
                    playsInline
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        zIndex: 0,
                    }}
                    src={engine.backgroundVideo}
                />
            )}
            
            {/* Stream background (screen share) */}
            {engine.backgroundMode === 'stream' && engine.backgroundStream && (
                <video
                    key="screen-share-video"
                    autoPlay
                    muted
                    playsInline
                    ref={(videoElement) => {
                        if (videoElement && engine.backgroundStream) {
                            // Only set srcObject if it's different to avoid re-renders
                            if (videoElement.srcObject !== engine.backgroundStream) {
                                videoElement.srcObject = engine.backgroundStream;
                            }
                        }
                    }}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        zIndex: 0,
                    }}
                />
            )}
            
            {/* Main content - positioned above the background */}
            <div style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%' }}>
                <DialogueHeader dialogueType={dialogueType} />
                
                <BitCanvas
                    engine={engine}
                    cursorColorAlternate={cursorColorAlternate}
                    monogramEnabled={true}
                />
            </div>
        </div>
    );
}
