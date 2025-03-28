// app/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { useWorldEngine } from '@/app/hooks/world.engine';
import { BitCanvas } from '@/app/components/bit.canvas';

// --- Constants ---
const CURSOR_BLINK_RATE = 200;
const BACKGROUND_COLOR = '#ffffff';

export default function CorbuType() {
    const worldId = "defaultWorld"; // Provide a default or dynamic ID

    // Pass an object containing the worldId to the hook
    const engine = useWorldEngine({ worldId });

    // Keep cursor blink state here, as it's purely visual
    const [cursorColorAlternate, setCursorColorAlternate] = useState(false);

    // --- Effect for Cursor Blinking ---
    useEffect(() => {
        const blinkInterval = setInterval(() => {
            setCursorColorAlternate(prev => !prev);
        }, CURSOR_BLINK_RATE);
        return () => clearInterval(blinkInterval);
    }, []);

    // Optional: Display loading/saving status
    if (engine.isLoadingWorld) {
        return <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>Loading world data...</div>;
    }

    return (
        <div style={{
            overflow: 'hidden',
            width: '100vw',
            height: '100vh',
            cursor: 'text', // Default cursor style
            background: BACKGROUND_COLOR
        }}>
            {/* Display Persistence Status */}
            {engine.worldPersistenceError && (
                <div style={{ position: 'absolute', top: 5, left: 5, background: 'rgba(255,0,0,0.7)', color: 'white', padding: '2px 5px', fontSize: '10px', zIndex: 10 }}>
                    Error: {engine.worldPersistenceError}
                </div>
            )}
            {engine.isSavingWorld && (
                <div style={{ position: 'absolute', top: 20, left: 5, background: 'rgba(0,255,0,0.7)', color: 'black', padding: '2px 5px', fontSize: '10px', zIndex: 10 }}>
                    Saving...
                </div>
            )}

            <BitCanvas
                engine={engine}
                cursorColorAlternate={cursorColorAlternate}
                // className="bit-canvas" // Add className if needed for styling
            />
            {/* Optional Debug Info */}
            {/* <div style={{ position: 'absolute', bottom: 5, left: 5, background: 'rgba(0,0,0,0.6)', color: 'white', padding: '2px 5px', fontSize: '10px', pointerEvents: 'none'}}>
                Zoom: {engine.zoomLevel.toFixed(2)} | Offset: ({engine.viewOffset.x.toFixed(0)}, {engine.viewOffset.y.toFixed(0)}) | Cursor: ({engine.cursorPos.x}, {engine.cursorPos.y}) | Sel: {engine.selectionStart ? `(${engine.selectionStart.x},${engine.selectionStart.y})->(${engine.selectionEnd?.x},${engine.selectionEnd?.y})` : 'None'}
            </div> */}
        </div>
    );
}