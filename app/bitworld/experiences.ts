// experiences.ts
// Keyframe-based experience renderer
// Consumes experiences from Firebase and renders them progressively
// This replaces the old host.flows.ts + host.dialogue.ts system

import { useState, useCallback, useEffect, useRef } from 'react';
import { ref, get, query, orderByChild, equalTo } from 'firebase/database';
import { database, signUpUser, signInUser, getUserProfile, checkUsernameAvailability, auth } from '../firebase';
import { set } from 'firebase/database';
import { updateProfile, updatePassword, EmailAuthProvider, linkWithCredential, createUserWithEmailAndPassword } from 'firebase/auth';
import type { Point } from './world.engine';

// ============================================================================
// TYPES
// ============================================================================

export type InputType = 'text' | 'email' | 'password' | 'username' | 'choice';

export interface Keyframe {
  id?: string;
  dialogue?: string;

  // Visual effects
  bg?: string;
  monogram?: string;
  monogramSpeed?: number;
  monogramComplexity?: number;
  backgroundMode?: 'color' | 'image' | 'video' | 'transparent';
  backgroundImage?: string;

  // Input handling
  input?: InputType;
  choices?: string[];  // For choice-based input

  // Flow control
  handler?: string;
  nextKeyframeId?: string;  // Named jump (for non-linear flows)
  previousKeyframeId?: string;  // For backwards navigation
  branchLogic?: Record<string, string>;  // input -> keyframeId mapping

  // Auto-advance
  autoAdvanceMs?: number;  // Auto-advance after N milliseconds

  // Spatial content
  spawnContent?: {
    labels?: Array<{
      offsetX: number;
      offsetY: number;
      text: string;
      color: string;
    }>;
  };
  despawnLabels?: boolean;

  // Tutorial mode
  requiresChatMode?: boolean;
  expectedCommand?: string;
  commandArgs?: string[];  // Expected args for command validation
}

export interface Experience {
  id: string;
  name: string;
  campaignId?: string;
  keyframes: Keyframe[];
  keyframeMap?: Record<string, number>;  // id -> index for named jumps
  createdAt: string;
}

export interface KeyframeState {
  // Visual state (persists across keyframes)
  bg: string;
  monogram: string;
  monogramSpeed: number;
  monogramComplexity: number;
  backgroundMode: 'color' | 'image' | 'video' | 'transparent';
  backgroundImage: string | null;

  // Current keyframe
  dialogue: string;
  input: InputType | null;
  handler: string | null;
  choices: string[] | null;

  // Collected data
  collected: Record<string, string>;

  // Progress
  keyframeIndex: number;
  isComplete: boolean;
  isProcessing: boolean;

  // For backwards navigation
  history: number[];
}

export interface UseKeyframeExperienceProps {
  experienceId: string | undefined;

  // Rendering
  setHostData: (data: { text: string; color?: string; centerPos: Point; timestamp?: number } | null) => void;
  getViewportCenter: () => Point;

  // Input mode
  setHostMode?: (mode: { isActive: boolean; currentInputType: InputType | null }) => void;
  setChatMode?: (mode: { isActive: boolean; currentInput: string; inputPositions: any[]; isProcessing: boolean }) => void;

  // Screen effects
  screenEffects?: {
    setBackgroundColor?: (color: string) => void;
    setBackgroundMode?: (mode: 'color' | 'image' | 'video' | 'transparent') => void;
    setBackgroundImage?: (imageUrl: string) => void;
    setMonogramMode?: (mode: string) => void;
    setMonogramSpeed?: (speed: number) => void;
    setMonogramComplexity?: (complexity: number) => void;
    setWorldData?: (updater: (prev: Record<string, any>) => Record<string, any>) => void;
  };

  // Auth callback
  onAuthSuccess?: (username: string) => void;

  // Context
  hostBackgroundColor?: string;
  isPublicWorld?: boolean;
}

// ============================================================================
// DEFAULT EXPERIENCE
// ============================================================================

// Default experience ID - used when no experienceId is provided
export const DEFAULT_EXPERIENCE_ID = 'default';

// Default visual settings for the landing experience
export const DEFAULT_VISUAL_CONFIG = {
  backgroundColor: '#FFFFFF',
  hostTextColor: '#10B981',
  monogram: 'perlin',
  monogramSpeed: 0.5,
  monogramComplexity: 1.0,
  backgroundMode: 'color' as const,
  backgroundImage: null as string | null,
};

// Fallback experience when Firebase doesn't have one
// This ensures the app works even without Firebase data
const DEFAULT_EXPERIENCE: Experience = {
  id: DEFAULT_EXPERIENCE_ID,
  name: 'Default Welcome',
  keyframes: [
    {
      id: 'welcome',
      bg: DEFAULT_VISUAL_CONFIG.backgroundColor,
      monogram: DEFAULT_VISUAL_CONFIG.monogram,
      monogramSpeed: DEFAULT_VISUAL_CONFIG.monogramSpeed,
      monogramComplexity: DEFAULT_VISUAL_CONFIG.monogramComplexity,
      backgroundMode: DEFAULT_VISUAL_CONFIG.backgroundMode,
      dialogue: "Hey! Welcome to Nara.",
      autoAdvanceMs: 2000,
    },
    {
      id: 'collect_email',
      dialogue: "What's your email?",
      input: 'email',
    },
    {
      id: 'collect_password',
      dialogue: "Create a password (6+ characters)",
      input: 'password',
    },
    {
      id: 'check_credentials',
      dialogue: "Checking...",
      handler: 'checkCredentials',
    },
    {
      id: 'collect_username',
      dialogue: "Pick a username",
      input: 'username',
    },
    {
      id: 'create_account',
      dialogue: "Setting up your space...",
      handler: 'createAccount',
    },
    {
      id: 'complete',
      dialogue: "Welcome aboard! Taking you to your canvas...",
      handler: 'redirect',
    }
  ],
  createdAt: new Date().toISOString(),
};

// ============================================================================
// VALIDATORS
// ============================================================================

const VALIDATORS: Record<string, (input: string) => Promise<{ valid: boolean; error?: string }> | { valid: boolean; error?: string }> = {
  email: (input) => {
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
    return { valid, error: valid ? undefined : 'that doesn\'t look like a valid email' };
  },
  password: (input) => {
    const valid = input.length >= 6;
    return { valid, error: valid ? undefined : 'password must be at least 6 characters' };
  },
  username: async (input) => {
    if (input.length < 3) return { valid: false, error: 'username must be at least 3 characters' };
    if (input.length > 20) return { valid: false, error: 'username must be 20 characters or less' };
    if (!/^[a-zA-Z0-9_]+$/.test(input)) return { valid: false, error: 'username can only contain letters, numbers, and underscores' };

    // Check availability
    const isAvailable = await checkUsernameAvailability(input);
    if (!isAvailable) return { valid: false, error: 'username already taken' };

    return { valid: true };
  },
  choice: (input) => {
    // Choice validation happens at runtime based on available choices
    return { valid: true };
  },
  text: () => ({ valid: true })
};

// ============================================================================
// HOOK
// ============================================================================

export function useKeyframeExperience({
  experienceId,
  setHostData,
  getViewportCenter,
  setHostMode,
  setChatMode,
  screenEffects,
  onAuthSuccess,
  hostBackgroundColor,
  isPublicWorld
}: UseKeyframeExperienceProps) {

  const [experience, setExperience] = useState<Experience | null>(null);
  const [state, setState] = useState<KeyframeState>({
    bg: hostBackgroundColor || '#000000',
    monogram: 'perlin',
    monogramSpeed: 0.5,
    monogramComplexity: 1.0,
    backgroundMode: 'color',
    backgroundImage: null,
    dialogue: '',
    input: null,
    handler: null,
    choices: null,
    collected: {},
    keyframeIndex: 0,
    isComplete: false,
    isProcessing: false,
    history: []
  });

  const experienceIdRef = useRef(experienceId);
  const autoAdvanceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup auto-advance timer
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, []);

  // Track if we've applied the first keyframe
  const hasAppliedFirstKeyframeRef = useRef(false);

  // Fetch experience from Firebase (only when explicitly requested)
  useEffect(() => {
    // IMPORTANT: Only activate experiences when one is explicitly requested
    // This prevents [username]/ pages from triggering sign-up flows
    if (!experienceId) {
      setExperience(null);
      return;
    }

    experienceIdRef.current = experienceId;
    hasAppliedFirstKeyframeRef.current = false;

    const fetchExperience = async () => {
      console.log('[keyframe] Fetching experience:', experienceId);
      try {
        const snapshot = await get(ref(database, `experiences/${experienceId}`));
        if (snapshot.exists()) {
          const exp = snapshot.val() as Experience;
          console.log('[keyframe] Experience loaded:', exp.name, 'with', exp.keyframes?.length, 'keyframes');

          // Build keyframe map for named jumps
          const keyframeMap: Record<string, number> = {};
          exp.keyframes.forEach((kf, idx) => {
            if (kf.id) keyframeMap[kf.id] = idx;
          });
          exp.keyframeMap = keyframeMap;

          setExperience(exp);
        } else if (experienceId === DEFAULT_EXPERIENCE_ID) {
          // Only use fallback for explicit 'default' experience request
          console.log('[keyframe] Using fallback default experience');
          const fallback = { ...DEFAULT_EXPERIENCE };
          const keyframeMap: Record<string, number> = {};
          fallback.keyframes.forEach((kf, idx) => {
            if (kf.id) keyframeMap[kf.id] = idx;
          });
          fallback.keyframeMap = keyframeMap;
          setExperience(fallback);
        } else {
          console.warn(`[experience] Experience not found: ${experienceId}`);
          setExperience(null);
        }
      } catch (error) {
        console.error('[experience] Failed to fetch experience:', error);
        // Only use fallback for explicit 'default' experience request
        if (experienceId === DEFAULT_EXPERIENCE_ID) {
          console.log('[keyframe] Using fallback default experience (after error)');
          const fallback = { ...DEFAULT_EXPERIENCE };
          const keyframeMap: Record<string, number> = {};
          fallback.keyframes.forEach((kf, idx) => {
            if (kf.id) keyframeMap[kf.id] = idx;
          });
          fallback.keyframeMap = keyframeMap;
          setExperience(fallback);
        } else {
          setExperience(null);
        }
      }
    };

    fetchExperience();
  }, [experienceId]);

  // Apply a keyframe to current state
  const applyKeyframe = useCallback((keyframe: Keyframe, index: number, exp?: Experience) => {
    const currentExp = exp || experience;

    setState(prev => {
      const next: KeyframeState = {
        ...prev,
        keyframeIndex: index,
        // Only update what's defined in the keyframe
        bg: keyframe.bg ?? prev.bg,
        monogram: keyframe.monogram ?? prev.monogram,
        monogramSpeed: keyframe.monogramSpeed ?? prev.monogramSpeed,
        monogramComplexity: keyframe.monogramComplexity ?? prev.monogramComplexity,
        backgroundMode: keyframe.backgroundMode ?? prev.backgroundMode,
        backgroundImage: keyframe.backgroundImage ?? prev.backgroundImage,
        dialogue: keyframe.dialogue ?? '',
        input: keyframe.input ?? null,
        handler: keyframe.handler ?? null,
        choices: keyframe.choices ?? null
      };
      return next;
    });

    const centerPos = getViewportCenter();

    // Apply screen effects
    if (keyframe.bg && screenEffects?.setBackgroundColor) {
      screenEffects.setBackgroundColor(keyframe.bg);
    }
    if (keyframe.backgroundMode && screenEffects?.setBackgroundMode) {
      screenEffects.setBackgroundMode(keyframe.backgroundMode);
    }
    if (keyframe.backgroundImage && screenEffects?.setBackgroundImage) {
      screenEffects.setBackgroundImage(keyframe.backgroundImage);
    }
    if (keyframe.monogram && screenEffects?.setMonogramMode) {
      screenEffects.setMonogramMode(keyframe.monogram);
    }
    if (keyframe.monogramSpeed !== undefined && screenEffects?.setMonogramSpeed) {
      screenEffects.setMonogramSpeed(keyframe.monogramSpeed);
    }
    if (keyframe.monogramComplexity !== undefined && screenEffects?.setMonogramComplexity) {
      screenEffects.setMonogramComplexity(keyframe.monogramComplexity);
    }

    // Spawn content
    if (keyframe.spawnContent?.labels && screenEffects?.setWorldData) {
      const content: Record<string, string> = {};
      keyframe.spawnContent.labels.forEach((label, i) => {
        const x = centerPos.x + label.offsetX;
        const y = centerPos.y + label.offsetY;
        content[`label_${x},${y}`] = JSON.stringify({
          text: label.text,
          color: label.color,
          background: undefined
        });
      });

      screenEffects.setWorldData(prev => {
        const labelsExist = Object.keys(content).some(key => key in prev);
        if (labelsExist) return prev;
        return { ...prev, ...content };
      });
    }

    // Despawn labels
    if (keyframe.despawnLabels && screenEffects?.setWorldData) {
      screenEffects.setWorldData(prev => {
        const newData = { ...prev };
        Object.keys(newData).forEach(key => {
          if (key.startsWith('label_')) delete newData[key];
        });
        return newData;
      });
    }

    // Update host mode for input
    if (setHostMode) {
      setHostMode({
        isActive: true,
        currentInputType: keyframe.input || null
      });
    }

    // Chat mode control
    const requiresChatMode = keyframe.requiresChatMode !== false;
    if (setChatMode && requiresChatMode && keyframe.input) {
      setChatMode({
        isActive: true,
        currentInput: '',
        inputPositions: [],
        isProcessing: false
      });
    }

    // Display dialogue
    if (keyframe.dialogue) {
      console.log('[keyframe] Setting host data:', keyframe.dialogue.slice(0, 50) + '...');
      setHostData({
        text: keyframe.dialogue,
        centerPos: centerPos,
        timestamp: Date.now()
      });
    } else {
      console.log('[keyframe] No dialogue for keyframe:', keyframe.id);
    }

    // Auto-advance timer
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }

    if (keyframe.autoAdvanceMs && !keyframe.input) {
      autoAdvanceTimerRef.current = setTimeout(() => {
        advance();
      }, keyframe.autoAdvanceMs);
    }
  }, [experience, screenEffects, setHostMode, setChatMode, setHostData, getViewportCenter]);

  // Apply first keyframe when experience loads (separate effect to ensure applyKeyframe is fresh)
  useEffect(() => {
    console.log('[keyframe] Effect check:', {
      hasExperience: !!experience,
      keyframeCount: experience?.keyframes?.length,
      hasAppliedFirst: hasAppliedFirstKeyframeRef.current
    });
    if (experience && experience.keyframes.length > 0 && !hasAppliedFirstKeyframeRef.current) {
      console.log('[keyframe] Applying first keyframe:', experience.keyframes[0]);
      hasAppliedFirstKeyframeRef.current = true;
      applyKeyframe(experience.keyframes[0], 0, experience);
    }
  }, [experience, applyKeyframe]);

  // Clean up and exit flow
  const exitFlow = useCallback(() => {
    setHostData(null);

    // Clean up labels
    if (screenEffects?.setWorldData) {
      screenEffects.setWorldData(prev => {
        const newData = { ...prev };
        Object.keys(newData).forEach(key => {
          if (key.startsWith('label_')) delete newData[key];
        });
        return newData;
      });
    }

    if (setHostMode) {
      setHostMode({ isActive: false, currentInputType: null });
    }
    if (setChatMode) {
      setChatMode({
        isActive: false,
        currentInput: '',
        inputPositions: [],
        isProcessing: false
      });
    }

    setState(prev => ({ ...prev, isComplete: true, isActive: false }));
  }, [setHostData, setHostMode, setChatMode, screenEffects]);

  // Execute a handler
  const executeHandler = useCallback(async (
    handlerId: string,
    collected: Record<string, string>
  ): Promise<{ success: boolean; nextKeyframeId?: string }> => {
    try {
      switch (handlerId) {
        // ================================================================
        // SIGN IN EXISTING USER
        // ================================================================
        case 'checkCredentials': {
          const { email, password } = collected;

          if (!email || !password) {
            setHostData({
              text: 'missing email or password',
              color: '#FF6B6B',
              centerPos: getViewportCenter(),
              timestamp: Date.now()
            });
            return { success: false };
          }

          const result = await signInUser(email, password);

          if (result.success && result.user) {
            // Existing user - get their profile and redirect
            const profile = await getUserProfile(result.user.uid);

            if (profile && profile.username) {
              exitFlow();
              if (onAuthSuccess) {
                onAuthSuccess(profile.username);
              }
              return { success: true };
            }
          }

          // Sign in failed - check if it's wrong password or new user
          if (result.error && result.error.includes('invalid-credential')) {
            // Check if user exists in database
            const usersQuery = query(ref(database, 'users'), orderByChild('email'), equalTo(email));
            const snapshot = await get(usersQuery);

            if (snapshot.exists()) {
              // User exists - wrong password
              setHostData({
                text: 'incorrect password. please try again.',
                color: '#FF6B6B',
                centerPos: getViewportCenter(),
                timestamp: Date.now()
              });
              return { success: false, nextKeyframeId: 'collect_password' };
            } else {
              // New user - continue to username collection
              return { success: true, nextKeyframeId: 'collect_username' };
            }
          }

          setHostData({
            text: result.error || 'sign in failed. please try again.',
            color: '#FF6B6B',
            centerPos: getViewportCenter(),
            timestamp: Date.now()
          });
          return { success: false };
        }

        // ================================================================
        // CREATE ACCOUNT
        // ================================================================
        case 'createAccount': {
          const { email, password, username } = collected;

          if (!email || !password || !username) {
            setHostData({
              text: 'missing required information',
              color: '#FF6B6B',
              centerPos: getViewportCenter(),
              timestamp: Date.now()
            });
            return { success: false };
          }

          let user;
          let isLinkingToExisting = false;

          try {
            // Try to create user with email and password
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            user = userCredential.user;
          } catch (createError: any) {
            if (createError.code === 'auth/email-already-in-use') {
              // Link password to existing account
              isLinkingToExisting = true;
              if (auth.currentUser) {
                const credential = EmailAuthProvider.credential(email, password);
                try {
                  await linkWithCredential(auth.currentUser, credential);
                  user = auth.currentUser;
                } catch (linkError: any) {
                  setHostData({
                    text: 'unable to link password. please try signing in instead.',
                    color: '#FF6B6B',
                    centerPos: getViewportCenter(),
                    timestamp: Date.now()
                  });
                  return { success: false };
                }
              } else {
                setHostData({
                  text: 'please sign in with your email link first.',
                  color: '#FF6B6B',
                  centerPos: getViewportCenter(),
                  timestamp: Date.now()
                });
                return { success: false };
              }
            } else {
              throw createError;
            }
          }

          if (!user) {
            setHostData({
              text: 'failed to create account',
              color: '#FF6B6B',
              centerPos: getViewportCenter(),
              timestamp: Date.now()
            });
            return { success: false };
          }

          // Update display name
          await updateProfile(user, { displayName: username });

          // Check if profile already exists
          const existingProfile = await get(ref(database, `users/${user.uid}`));
          const textColor = state.bg === '#F0FF6A' ? '#000000' : '#FFFFFF';

          if (!existingProfile.exists()) {
            // Create new profile
            const userProfileData = {
              firstName: '',
              lastName: '',
              username,
              email: user.email || '',
              uid: user.uid,
              createdAt: new Date().toISOString(),
              membership: 'fresh',
              seed: experienceIdRef.current || null,
              aiUsage: {
                daily: {},
                monthly: {},
                total: 0,
                lastReset: new Date().toISOString()
              }
            };

            await set(ref(database, `users/${user.uid}`), userProfileData);

            // Track conversion
            if (experienceIdRef.current) {
              await set(ref(database, `outreach/conversions/${user.uid}`), {
                experienceId: experienceIdRef.current,
                userId: user.uid,
                username,
                timestamp: new Date().toISOString()
              });
            }
          } else {
            // Update existing profile with username
            await set(ref(database, `users/${user.uid}/username`), username);
          }

          // World settings
          await set(ref(database, `worlds/${user.uid}/home/settings`), {
            backgroundColor: state.bg || '#FFFFFF',
            textColor
          });

          // Store username for redirect
          setState(prev => ({
            ...prev,
            collected: { ...prev.collected, username }
          }));

          // Check if in public world - ask navigation choice
          if (isPublicWorld) {
            return { success: true, nextKeyframeId: 'ask_navigation' };
          }

          return { success: true };
        }

        // ================================================================
        // CREATE PROFILE (for email link verification flow)
        // ================================================================
        case 'createProfile': {
          const { username } = collected;
          const user = auth.currentUser;

          if (!user) {
            setHostData({
              text: 'no authenticated user found',
              color: '#FF6B6B',
              centerPos: getViewportCenter(),
              timestamp: Date.now()
            });
            return { success: false };
          }

          const existingProfile = await getUserProfile(user.uid);
          const textColor = hostBackgroundColor === '#F0FF6A' ? '#000000' : '#FFFFFF';

          if (!existingProfile) {
            const userProfileData = {
              firstName: '',
              lastName: '',
              username,
              email: user.email || '',
              uid: user.uid,
              createdAt: new Date().toISOString(),
              membership: 'fresh',
              seed: experienceIdRef.current || null,
              aiUsage: {
                daily: {},
                monthly: {},
                total: 0,
                lastReset: new Date().toISOString()
              }
            };

            await set(ref(database, `users/${user.uid}`), userProfileData);

            // Track conversion
            if (experienceIdRef.current) {
              await set(ref(database, `outreach/conversions/${user.uid}`), {
                experienceId: experienceIdRef.current,
                userId: user.uid,
                username,
                timestamp: new Date().toISOString()
              });
            }

            await set(ref(database, `worlds/${user.uid}/home/settings`), {
              backgroundColor: hostBackgroundColor || '#FFFFFF',
              textColor
            });
          } else {
            await set(ref(database, `users/${user.uid}/username`), username);
            if (hostBackgroundColor) {
              await set(ref(database, `worlds/${user.uid}/home/settings`), {
                backgroundColor: hostBackgroundColor,
                textColor
              });
            }
          }

          await updateProfile(user, { displayName: username });

          setState(prev => ({
            ...prev,
            collected: { ...prev.collected, username }
          }));

          return { success: true };
        }

        // ================================================================
        // PASSWORD RESET
        // ================================================================
        case 'resetPassword': {
          const { email, password } = collected;

          // Check if user exists
          const usersQuery = query(ref(database, 'users'), orderByChild('email'), equalTo(email));
          const snapshot = await get(usersQuery);

          if (!snapshot.exists()) {
            setHostData({
              text: 'no account found with this email.',
              color: '#FF6B6B',
              centerPos: getViewportCenter(),
              timestamp: Date.now()
            });
            return { success: false };
          }

          // User must be signed in via email link
          if (auth.currentUser && auth.currentUser.email === email) {
            await updatePassword(auth.currentUser, password);

            const userData = snapshot.val();
            const uid = Object.keys(userData)[0];
            const profile = userData[uid];

            exitFlow();

            if (onAuthSuccess && profile.username) {
              setTimeout(() => {
                onAuthSuccess(profile.username);
              }, 1500);
            }

            return { success: true };
          } else {
            setHostData({
              text: 'please use the password reset link from your email.',
              color: '#FF6B6B',
              centerPos: getViewportCenter(),
              timestamp: Date.now()
            });
            return { success: false };
          }
        }

        // ================================================================
        // STRIPE CHECKOUT
        // ================================================================
        case 'stripeCheckout': {
          const user = auth.currentUser;
          if (!user) {
            setHostData({
              text: 'please sign in first to upgrade',
              color: '#FF6B6B',
              centerPos: getViewportCenter(),
              timestamp: Date.now()
            });
            return { success: false };
          }

          try {
            const response = await fetch('/api/stripe/checkout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                plan: 'pro',
                interval: 'monthly',
                userId: user.uid,
              }),
            });

            const data = await response.json();

            if (data.url) {
              window.location.href = data.url;
              return { success: true };
            } else {
              setHostData({
                text: 'checkout failed. please try /upgrade command instead.',
                color: '#FF6B6B',
                centerPos: getViewportCenter(),
                timestamp: Date.now()
              });
              return { success: false };
            }
          } catch (error) {
            setHostData({
              text: 'something went wrong. please try /upgrade command instead.',
              color: '#FF6B6B',
              centerPos: getViewportCenter(),
              timestamp: Date.now()
            });
            return { success: false };
          }
        }

        // ================================================================
        // NAVIGATION - GO HOME
        // ================================================================
        case 'navigateHome': {
          const username = collected.username;
          exitFlow();
          if (onAuthSuccess && username) {
            setTimeout(() => {
              onAuthSuccess(username);
            }, 1000);
          }
          return { success: true };
        }

        // ================================================================
        // NAVIGATION - STAY IN PUBLIC
        // ================================================================
        case 'stayInPublic': {
          // Just continue to next keyframe (dismiss message)
          return { success: true };
        }

        // ================================================================
        // DISMISS / EXIT
        // ================================================================
        case 'dismiss':
        case 'exit': {
          exitFlow();
          return { success: true };
        }

        // ================================================================
        // REDIRECT
        // ================================================================
        case 'redirect': {
          const username = collected.username;
          exitFlow();
          if (onAuthSuccess && username) {
            setTimeout(() => {
              onAuthSuccess(username);
            }, 1500);
          }
          return { success: true };
        }

        default:
          console.warn(`[experience] Unknown handler: ${handlerId}`);
          return { success: true };
      }
    } catch (error: any) {
      console.error(`[experience] Handler failed: ${handlerId}`, error);
      setHostData({
        text: error.message || 'something went wrong. please try again.',
        color: '#FF6B6B',
        centerPos: getViewportCenter(),
        timestamp: Date.now()
      });
      return { success: false };
    }
  }, [state.bg, hostBackgroundColor, isPublicWorld, onAuthSuccess, exitFlow, setHostData, getViewportCenter]);

  // Go to a specific keyframe by id or index
  const goToKeyframe = useCallback((target: string | number) => {
    if (!experience) return;

    let targetIndex: number;
    if (typeof target === 'string') {
      targetIndex = experience.keyframeMap?.[target] ?? -1;
      if (targetIndex === -1) {
        console.warn(`[experience] Keyframe not found: ${target}`);
        return;
      }
    } else {
      targetIndex = target;
    }

    if (targetIndex >= 0 && targetIndex < experience.keyframes.length) {
      // Save current index to history for backwards navigation
      setState(prev => ({
        ...prev,
        history: [...prev.history, prev.keyframeIndex]
      }));
      applyKeyframe(experience.keyframes[targetIndex], targetIndex);
    }
  }, [experience, applyKeyframe]);

  // Go back to previous keyframe
  const goBack = useCallback(() => {
    if (!experience) return;

    const currentKeyframe = experience.keyframes[state.keyframeIndex];

    // Check for explicit previous keyframe
    if (currentKeyframe.previousKeyframeId && experience.keyframeMap) {
      const prevIndex = experience.keyframeMap[currentKeyframe.previousKeyframeId];
      if (prevIndex !== undefined) {
        applyKeyframe(experience.keyframes[prevIndex], prevIndex);
        return;
      }
    }

    // Use history stack
    if (state.history.length > 0) {
      const prevIndex = state.history[state.history.length - 1];
      setState(prev => ({
        ...prev,
        history: prev.history.slice(0, -1)
      }));
      applyKeyframe(experience.keyframes[prevIndex], prevIndex);
    }
  }, [experience, state.keyframeIndex, state.history, applyKeyframe]);

  // Process user input
  const processInput = useCallback(async (input: string): Promise<boolean> => {
    if (!experience || state.isComplete || state.isProcessing) return false;

    const currentKeyframe = experience.keyframes[state.keyframeIndex];

    // Validate input if required
    if (currentKeyframe.input) {
      // Choice validation
      if (currentKeyframe.input === 'choice' && currentKeyframe.choices) {
        const normalized = input.toLowerCase().trim();
        const validChoice = currentKeyframe.choices.some(c =>
          c.toLowerCase() === normalized ||
          (normalized === 'y' && c.toLowerCase() === 'yes') ||
          (normalized === 'n' && c.toLowerCase() === 'no')
        );

        if (!validChoice) {
          setHostData({
            text: `please choose: ${currentKeyframe.choices.join(' / ')}`,
            color: '#FF6B6B',
            centerPos: getViewportCenter(),
            timestamp: Date.now()
          });
          return false;
        }
      } else {
        const validator = VALIDATORS[currentKeyframe.input];
        const result = await validator(input);

        if (!result.valid) {
          setHostData({
            text: result.error || 'invalid input',
            color: '#FF6B6B',
            centerPos: getViewportCenter(),
            timestamp: Date.now()
          });
          return false;
        }
      }

      // Store collected data
      const fieldName = currentKeyframe.id || currentKeyframe.input;
      setState(prev => ({
        ...prev,
        collected: {
          ...prev.collected,
          [fieldName]: input
        }
      }));
    }

    // Check for branch logic first
    if (currentKeyframe.branchLogic) {
      const normalized = input.toLowerCase().trim();
      // Check exact match first, then y/n shortcuts
      let targetId = currentKeyframe.branchLogic[normalized];
      if (!targetId && normalized === 'y') targetId = currentKeyframe.branchLogic['yes'];
      if (!targetId && normalized === 'n') targetId = currentKeyframe.branchLogic['no'];

      if (targetId) {
        goToKeyframe(targetId);
        return true;
      }
    }

    // Determine next keyframe
    let nextIndex = state.keyframeIndex + 1;
    let nextKeyframeId = currentKeyframe.nextKeyframeId;

    // If past end, experience complete
    if (nextIndex >= experience.keyframes.length && !nextKeyframeId) {
      setState(prev => ({ ...prev, isComplete: true }));
      exitFlow();
      return true;
    }

    const nextKeyframe = nextKeyframeId
      ? experience.keyframes[experience.keyframeMap?.[nextKeyframeId] ?? nextIndex]
      : experience.keyframes[nextIndex];

    if (!nextKeyframe) {
      setState(prev => ({ ...prev, isComplete: true }));
      exitFlow();
      return true;
    }

    // Check if next keyframe has a handler
    if (nextKeyframe.handler) {
      setState(prev => ({ ...prev, isProcessing: true }));

      // Show handler message
      if (nextKeyframe.dialogue) {
        setHostData({
          text: nextKeyframe.dialogue,
          centerPos: getViewportCenter(),
          timestamp: Date.now()
        });
      }

      // Build collected data including current input
      const allCollected = {
        ...state.collected,
        ...(currentKeyframe.input ? { [currentKeyframe.id || currentKeyframe.input]: input } : {})
      };

      // Execute handler
      const handlerResult = await executeHandler(nextKeyframe.handler, allCollected);

      if (!handlerResult.success) {
        setState(prev => ({ ...prev, isProcessing: false }));
        return false;
      }

      // Handler can redirect to specific keyframe
      if (handlerResult.nextKeyframeId) {
        setState(prev => ({ ...prev, isProcessing: false }));
        goToKeyframe(handlerResult.nextKeyframeId);
        return true;
      }

      // Continue to keyframe after handler
      const afterHandlerIndex = (experience.keyframeMap?.[nextKeyframeId!] ?? nextIndex) + 1;
      if (afterHandlerIndex < experience.keyframes.length) {
        applyKeyframe(experience.keyframes[afterHandlerIndex], afterHandlerIndex);
      } else {
        exitFlow();
      }

      setState(prev => ({ ...prev, isProcessing: false }));
    } else {
      // No handler - just advance
      const targetIndex = experience.keyframeMap?.[nextKeyframeId!] ?? nextIndex;
      applyKeyframe(experience.keyframes[targetIndex], targetIndex);
    }

    return true;
  }, [experience, state, applyKeyframe, executeHandler, goToKeyframe, exitFlow, setHostData, getViewportCenter]);

  // Advance without input (for non-input keyframes)
  const advance = useCallback(() => {
    if (!experience || state.isComplete || state.isProcessing) return;

    const currentKeyframe = experience.keyframes[state.keyframeIndex];

    // Only advance if current keyframe doesn't expect input
    if (currentKeyframe.input) return;

    // Check for named next keyframe
    if (currentKeyframe.nextKeyframeId && experience.keyframeMap) {
      const nextIndex = experience.keyframeMap[currentKeyframe.nextKeyframeId];
      if (nextIndex !== undefined) {
        applyKeyframe(experience.keyframes[nextIndex], nextIndex);
        return;
      }
    }

    const nextIndex = state.keyframeIndex + 1;
    if (nextIndex < experience.keyframes.length) {
      applyKeyframe(experience.keyframes[nextIndex], nextIndex);
    } else {
      exitFlow();
    }
  }, [experience, state, applyKeyframe, exitFlow]);

  // Validate command execution (for tutorial flows)
  const validateCommand = useCallback((executedCommand: string, args: string[]): boolean => {
    if (!experience) return false;

    const currentKeyframe = experience.keyframes[state.keyframeIndex];
    if (!currentKeyframe.expectedCommand) return false;

    if (executedCommand !== currentKeyframe.expectedCommand) return false;

    // Check args if specified
    if (currentKeyframe.commandArgs) {
      const argsMatch = currentKeyframe.commandArgs.every((expected, i) =>
        args[i]?.toLowerCase() === expected.toLowerCase()
      );
      if (!argsMatch) return false;
    }

    // Valid command - advance to next keyframe
    advance();
    return true;
  }, [experience, state.keyframeIndex, advance]);

  // Get current input type
  const getCurrentInputType = useCallback((): InputType | null => {
    if (!experience) return null;
    return experience.keyframes[state.keyframeIndex]?.input || null;
  }, [experience, state.keyframeIndex]);

  return {
    isActive: !!experience && !state.isComplete,
    isProcessing: state.isProcessing,
    currentState: state,
    processInput,
    advance,
    goBack,
    goToKeyframe,
    validateCommand,
    getCurrentInputType,
    exitFlow,
    experience
  };
}
