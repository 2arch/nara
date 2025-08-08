// app/debug.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Point, WorldEngine } from '@/app/bitworld/world.engine';

interface DebugProps {
    engine: WorldEngine;
}

export default function Debug({ engine }: DebugProps) {
    const [isClient, setIsClient] = useState(false);
    const [distance, setDistance] = useState(0);
    const [angleData, setAngleData] = useState<any>(null);
    
    useEffect(() => {
        setIsClient(true);
    }, []);
    
    useEffect(() => {
        if (isClient && engine.getCursorDistanceFromCenter) {
            setDistance(engine.getCursorDistanceFromCenter());
        }
        if (isClient && engine.getAngleDebugData) {
            setAngleData(engine.getAngleDebugData());
        }
    }, [isClient, engine.cursorPos, engine.viewOffset, engine.getCursorDistanceFromCenter, engine.getAngleDebugData]);
    
    if (!isClient) {
        return (
            <div style={{
                position: 'fixed',
                bottom: '10px',
                right: '10px',
                color: 'black',
                fontFamily: 'monospace',
                fontSize: '12px',
                zIndex: 1000,
                pointerEvents: 'none',
                userSelect: 'none'
            }}>
                Cursor: ({engine.cursorPos.x}, {engine.cursorPos.y})<br/>
                Distance: 0.00<br/>
                Points: 0<br/>
                Angle: --°<br/>
                Current: (---, ---)<br/>
                Previous: (---, ---)
            </div>
        );
    }
    
    return (
        <div style={{
            position: 'fixed',
            bottom: '10px',
            right: '10px',
            color: 'black',
            fontFamily: 'monospace',
            fontSize: '12px',
            zIndex: 1000,
            pointerEvents: 'none',
            userSelect: 'none'
        }}>
            Cursor: ({engine.cursorPos.x}, {engine.cursorPos.y})<br/>
            Distance: {distance.toFixed(2)}<br/>
            Points: {angleData ? 2 : 0}<br/>
            {angleData ? (
                <>
                    Angle: {angleData.degrees.toFixed(1)}°<br/>
                    Current: ({angleData.firstPoint.x.toFixed(1)}, {angleData.firstPoint.y.toFixed(1)})<br/>
                    Previous: ({angleData.lastPoint.x.toFixed(1)}, {angleData.lastPoint.y.toFixed(1)})
                </>
            ) : (
                <>
                    Angle: --°<br/>
                    Current: (---, ---)<br/>
                    Previous: (---, ---)
                </>
            )}
        </div>
    );
}