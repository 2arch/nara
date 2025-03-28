// app/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { useWorldEngine } from '@/app/hooks/useWorldEngine';  
import { BitCanvas } from '@/app/components/BitCanvas'; 

// --- Constants ---
const CURSOR_BLINK_RATE = 200;
const BACKGROUND_COLOR = '#ffffff';

export default function CorbuType() {
    // Use the engine hook to manage state and logic
    const engine = useWorldEngine();

    // Keep cursor blink state here, as it's purely visual
    const [cursorColorAlternate, setCursorColorAlternate] = useState(false);

    // --- Effect for Cursor Blinking ---
    useEffect(() => {
        const blinkInterval = setInterval(() => {
            setCursorColorAlternate(prev => !prev);
        }, CURSOR_BLINK_RATE);
        return () => clearInterval(blinkInterval);
    }, []);

    // KeyDown listener on the window to potentially refocus canvas if needed (optional)
    // useEffect(() => {
    //     const handleWindowKeyDown = (e: KeyboardEvent) => {
    //         // Simple heuristic: if focus is on body/html, focus canvas
    //         if (document.activeElement === document.body || document.activeElement === document.documentElement) {
    //             // You might need a way to access the canvas ref here if you implement this
    //             // console.log("Refocusing canvas");
    //             // canvasRef.current?.focus(); // This requires passing the ref up or using context
    //         }
    //     };
    //     window.addEventListener('keydown', handleWindowKeyDown);
    //     return () => window.removeEventListener('keydown', handleWindowKeyDown);
    // }, []);


    return (
        <div style={{
            overflow: 'hidden',
            width: '100vw',
            height: '100vh',
            cursor: 'text',
            background: BACKGROUND_COLOR
        }}>
            <BitCanvas
                engine={engine}
                cursorColorAlternate={cursorColorAlternate}
            />
            {/* Optional Debug Info */}
            {/* <div style={{ position: 'absolute', top: 5, left: 5, background: 'rgba(0,0,0,0.6)', color: 'white', padding: '2px 5px', fontSize: '10px', pointerEvents: 'none'}}>
                Zoom: {engine.zoomLevel.toFixed(2)} | Offset: ({engine.viewOffset.x.toFixed(0)}, {engine.viewOffset.y.toFixed(0)}) | Cursor: ({engine.cursorPos.x}, {engine.cursorPos.y})
            </div> */}
        </div>
    );
}