"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useWorldEngine } from '../bitworld/world.engine';
import { BitCanvas } from '../bitworld/bit.canvas';
import Grid3DBackground from '../bitworld/canvas.grid3d';
import { auth, getUidByUsername, getUserProfile } from '../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { useMonogram } from '../bitworld/monogram';

export default function UserHome() {
  const [cursorAlternate, setCursorAlternate] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [targetUserUid, setTargetUserUid] = useState<string | null>(null);
  const [uidLookupLoading, setUidLookupLoading] = useState(true);
  const [shouldShowTutorial, setShouldShowTutorial] = useState(false);
  const [tutorialChecked, setTutorialChecked] = useState(false);
  const router = useRouter();
  const params = useParams();
  const username = decodeURIComponent(params.username as string).replace('@', '');

  // Listen for authentication state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Look up the target user's UID from their username
  useEffect(() => {
    const lookupUid = async () => {
      try {
        const uid = await getUidByUsername(username);
        setTargetUserUid(uid);
      } catch (error) {
        setTargetUserUid(null);
      } finally {
        setUidLookupLoading(false);
      }
    };

    if (username) {
      lookupUid();
    } else {
      setUidLookupLoading(false);
    }
  }, [username]);

  // Check if user is fresh and should see tutorial
  useEffect(() => {
    const checkTutorialStatus = async () => {
      // Only check if:
      // 1. User is authenticated
      // 2. User is viewing their own world
      // 3. We haven't already checked
      if (!user || !targetUserUid || tutorialChecked) return;
      if (user.uid !== targetUserUid) {
        setTutorialChecked(true);
        return;
      }

      try {
        // Check if user has seen tutorial before
        const hasSeenTutorial = localStorage.getItem(`tutorial_completed_${user.uid}`);

        if (!hasSeenTutorial) {
          // Get user profile to check membership level
          const profile = await getUserProfile(user.uid);

          // Show tutorial for fresh users (new accounts)
          if (profile && profile.membership === 'fresh') {
            setShouldShowTutorial(true);
          }
        }
      } catch (error) {
        console.error('Error checking tutorial status:', error);
      } finally {
        setTutorialChecked(true);
      }
    };

    checkTutorialStatus();
  }, [user, targetUserUid, tutorialChecked]);

  // Initialize monogram system
  const monogram = useMonogram({ enabled: true, speed: 0.5, complexity: 1.0, mode: 'perlin' });

  const engine = useWorldEngine({
    worldId: 'home',
    userUid: targetUserUid, // Use the target user's UID, not the authenticated user's UID
    username: username,
    monogramSystem: monogram // Pass monogram to engine for command system
  });

  // Sync all character positions to monogram system whenever worldData changes
  useEffect(() => {
    if (!monogram.isInitialized) return;

    const artifacts: Array<{ startX: number, startY: number, endX: number, endY: number }> = [];

    // Scan worldData for all artifacts
    Object.keys(engine.worldData).forEach(key => {
      const data = engine.worldData[key];

      // 1. Labels (label_{x},{y})
      if (key.startsWith('label_')) {
        const coordsStr = key.substring('label_'.length);
        const [xStr, yStr] = coordsStr.split(',');
        const x = parseInt(xStr);
        const y = parseInt(yStr);
        if (!isNaN(x) && !isNaN(y)) {
          try {
            const labelData = JSON.parse(data as string);
            const width = labelData.text ? labelData.text.length : 1;
            artifacts.push({
              startX: x,
              startY: y,
              endX: x + width,
              endY: y
            });
          } catch (e) {
            // Skip malformed labels
          }
        }
      }

      // 2. Notes (unified note_ keys with contentType)
      // All region-spanning objects (images, mail, lists, bounds, etc.) use note_ keys
      else if (key.startsWith('note_')) {
        try {
          const noteData = JSON.parse(data as string);
          if (noteData.startX !== undefined && noteData.endX !== undefined &&
              noteData.startY !== undefined && noteData.endY !== undefined) {
            artifacts.push({
              startX: noteData.startX,
              startY: noteData.startY,
              endX: noteData.endX,
              endY: noteData.endY
            });
          }
        } catch (e) {
          // Skip malformed notes
        }
      }

      // 3. Single characters (simple text, not in labels/notes)
      else if (typeof data === 'string' && data.length === 1 && !engine.isImageData(data)) {
        const [xStr, yStr] = key.split(',');
        const x = parseInt(xStr);
        const y = parseInt(yStr);
        if (!isNaN(x) && !isNaN(y)) {
          artifacts.push({
            startX: x,
            startY: y,
            endX: x + 1,
            endY: y
          });
        }
      }
    });

    // Sync all artifacts to GPU for uniform glow effect
    const worldDataKeys = Object.keys(engine.worldData).length;
    console.log('[Artifact Sync] WorldData has', worldDataKeys, 'keys, found', artifacts.length, 'artifacts');
    if (artifacts.length > 0) {
      console.log('[Artifact Sync] Sample artifacts:', artifacts.slice(0, 5));
    } else {
      console.log('[Artifact Sync] WARNING: No artifacts found! Sample worldData keys:', Object.keys(engine.worldData).slice(0, 10));
    }
    monogram.syncArtifacts(artifacts);
  }, [engine.worldData, monogram.isInitialized, monogram, engine]);

  // Simple cursor blink effect
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorAlternate(prev => !prev);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Callback when tutorial is completed
  const handleTutorialComplete = useCallback(() => {
    if (user) {
      localStorage.setItem(`tutorial_completed_${user.uid}`, 'true');
      setShouldShowTutorial(false);
    }
  }, [user]);

  return (
    <div className="w-screen relative" style={{height: '100dvh'}}>
      {/* Render Grid3DBackground when space mode is active */}
      {engine.backgroundMode === 'space' && (
        <Grid3DBackground
          viewOffset={engine.viewOffset}
          zoomLevel={engine.zoomLevel}
          gridMode={engine.gridMode}
          artefactsEnabled={engine.artefactsEnabled}
          artifactType={engine.artifactType}
          getCompiledText={engine.getCompiledText}
          compiledTextCache={engine.compiledTextCache}
        />
      )}

      <BitCanvas
        engine={engine}
        cursorColorAlternate={cursorAlternate}
        className="w-full h-full"
        dialogueEnabled={true}
        fontFamily={engine.fontFamily}
        hostModeEnabled={shouldShowTutorial}
        initialHostFlow={shouldShowTutorial ? 'tutorial' : undefined}
        onTutorialComplete={handleTutorialComplete}
        monogram={monogram}
      />
    </div>
  );
}