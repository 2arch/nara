// Host dialogue system for conversational onboarding
import { useState, useCallback, useEffect } from 'react';
import { HOST_FLOWS, HostFlow, HostMessage, InputType } from './host.flows';
import { signUpUser, sendSignInLink, auth, database, getUserProfile } from '../firebase';
import { set, ref } from 'firebase/database';
import { updateProfile } from 'firebase/auth';
import type { Point } from './world.engine';

export interface HostDialogueState {
  isActive: boolean;
  currentFlowId: string | null;
  currentMessageId: string | null;
  collectedData: Record<string, any>;
  isProcessing: boolean; // For async operations like Firebase auth
}

export interface UseHostDialogueProps {
  setHostData: (data: { text: string; color?: string; centerPos: Point; timestamp?: number } | null) => void;
  getViewportCenter: () => Point;
  setDialogueText: (text: string) => void;
  onAuthSuccess?: (username: string) => void;
  onTriggerZoom?: (targetZoom: number, centerPos: Point) => void;
  setHostMode?: (mode: { isActive: boolean; currentInputType: any }) => void;
  setChatMode?: (mode: { isActive: boolean; currentInput: string; inputPositions: any[]; isProcessing: boolean }) => void;
  addEphemeralText?: (pos: Point, char: string, options?: { animationDelay?: number; color?: string; background?: string }) => void;
  setWorldData?: (updater: (prev: Record<string, any>) => Record<string, any>) => void;
  hostBackgroundColor?: string; // Host greeting background color to set as initial world bg
  isPublicWorld?: boolean; // Whether user is signing up in a public world (e.g., /base)
}

// Helper to map message IDs to field names
function getFieldNameFromMessageId(messageId: string): string {
  const fieldMap: Record<string, string> = {
    'signup_start': 'firstName',
    'collect_lastname': 'lastName',
    'collect_email': 'email',
    'collect_password': 'password',
    'collect_username': 'username',
    'collect_username_welcome': 'username',
    'welcome': 'email'
  };
  return fieldMap[messageId] || 'username'; // Default to username for verification flow
}

export function useHostDialogue({ setHostData, getViewportCenter, setDialogueText, onAuthSuccess, onTriggerZoom, setHostMode, setChatMode, addEphemeralText, setWorldData, hostBackgroundColor, isPublicWorld }: UseHostDialogueProps) {
  const [state, setState] = useState<HostDialogueState>({
    isActive: false,
    currentFlowId: null,
    currentMessageId: null,
    collectedData: {},
    isProcessing: false
  });

  // Manual advance through non-input messages (removed auto-advance)
  const advanceToNextMessage = useCallback(() => {
    if (!state.isActive || !state.currentFlowId || !state.currentMessageId || state.isProcessing) {
      return;
    }

    const flow = HOST_FLOWS[state.currentFlowId];
    if (!flow) return;

    const currentMessage = flow.messages[state.currentMessageId];
    if (!currentMessage) return;

    // If message doesn't expect input and has a nextMessageId, advance manually
    if (!currentMessage.expectsInput && currentMessage.nextMessageId) {
      const nextMessage = flow.messages[currentMessage.nextMessageId!];
      if (nextMessage) {
        const centerPos = getViewportCenter();

        setHostData({
          text: nextMessage.text,
          color: undefined,
          centerPos: centerPos,
          timestamp: Date.now()
        });

        // Despawn labels if requested
        if (nextMessage.despawnLabels && setWorldData) {
          setWorldData(prev => {
            const newData = { ...prev };
            // Remove all label_ keys
            Object.keys(newData).forEach(key => {
              if (key.startsWith('label_')) {
                delete newData[key];
              }
            });
            return newData;
          });
        }

        // Spawn staged content if defined (only if not already spawned)
        if (nextMessage.spawnContent && setWorldData) {
          const content = nextMessage.spawnContent(centerPos);

          // Check if labels already exist (don't duplicate)
          const labelKeys = Object.keys(content).filter(k => k.startsWith('label_'));

          setWorldData(prev => {
            const labelsExist = labelKeys.some(key => key in prev);
            if (labelsExist) {
              return prev;
            }

            return {
              ...prev,
              ...content
            };
          });
        }

        setState(prev => ({
          ...prev,
          currentMessageId: currentMessage.nextMessageId!
        }));
      }
    }
  }, [state, setHostData, getViewportCenter, setWorldData]);

  // Go back to previous message
  const goBackToPreviousMessage = useCallback(() => {
    if (!state.isActive || !state.currentFlowId || !state.currentMessageId || state.isProcessing) {
      return;
    }

    const flow = HOST_FLOWS[state.currentFlowId];
    if (!flow) return;

    const currentMessage = flow.messages[state.currentMessageId];
    if (!currentMessage) return;

    // If message has a previousMessageId, go back
    if (currentMessage.previousMessageId) {
      const previousMessage = flow.messages[currentMessage.previousMessageId];
      if (previousMessage) {
        setHostData({
          text: previousMessage.text,
          color: undefined,
          centerPos: getViewportCenter(),
          timestamp: Date.now()
        });
        setState(prev => ({
          ...prev,
          currentMessageId: currentMessage.previousMessageId!
        }));
      }
    }
  }, [state, setHostData, getViewportCenter]);

  // Start a flow
  const startFlow = useCallback((flowId: string, cursorPos?: Point) => {
    const flow = HOST_FLOWS[flowId];
    if (!flow) {
      console.error(`Flow ${flowId} not found`);
      return;
    }

    const startMessage = flow.messages[flow.startMessageId];
    if (!startMessage) {
      console.error(`Start message ${flow.startMessageId} not found in flow ${flowId}`);
      return;
    }

    // Display the first message (centered at current viewport)
    const centerPos = getViewportCenter();

    setHostData({
      text: startMessage.text,
      color: undefined, // Will use engine.textColor
      centerPos: centerPos,
      timestamp: Date.now()
    });

    // Spawn staged content if defined (only if not already spawned)
    if (startMessage.spawnContent && setWorldData) {
      const content = startMessage.spawnContent(centerPos);

      // Check if labels already exist (don't duplicate)
      const labelKeys = Object.keys(content).filter(k => k.startsWith('label_'));

      setWorldData(prev => {
        const labelsExist = labelKeys.some(key => key in prev);
        if (labelsExist) {
          return prev;
        }

        return {
          ...prev,
          ...content
        };
      });
    }

    // Activate host mode
    if (setHostMode) {
      setHostMode({
        isActive: true,
        currentInputType: startMessage.inputType || null
      });
    }

    // Only activate chat mode if required (default to true for backward compatibility)
    const requiresChatMode = startMessage.requiresChatMode !== false;
    if (setChatMode && requiresChatMode) {
      setChatMode({
        isActive: true,
        currentInput: '',
        inputPositions: [],
        isProcessing: false
      });
    }

    setState({
      isActive: true,
      currentFlowId: flowId,
      currentMessageId: flow.startMessageId,
      collectedData: {},
      isProcessing: false
    });
  }, [setHostData, getViewportCenter, setWorldData, setHostMode, setChatMode]);

  // Get current message
  const getCurrentMessage = useCallback((): HostMessage | null => {
    if (!state.currentFlowId || !state.currentMessageId) return null;
    const flow = HOST_FLOWS[state.currentFlowId];
    if (!flow) return null;
    return flow.messages[state.currentMessageId] || null;
  }, [state.currentFlowId, state.currentMessageId]);

  // Validate input against current message requirements
  const validateInput = useCallback(async (input: string): Promise<{ valid: boolean; error?: string }> => {
    const currentMessage = getCurrentMessage();
    if (!currentMessage || !currentMessage.inputValidator) {
      return { valid: true };
    }

    const result = await currentMessage.inputValidator(input);
    return result;
  }, [getCurrentMessage]);

  // Process user input and advance flow
  const processInput = useCallback(async (input: string): Promise<boolean> => {
    if (state.isProcessing) return false;

    const currentMessage = getCurrentMessage();
    if (!currentMessage || !currentMessage.expectsInput) {
      return false;
    }

    // Set processing state immediately to prevent race conditions
    setState(prev => ({ ...prev, isProcessing: true }));

    // Validate input
    const validation = await validateInput(input);
    if (!validation.valid) {
      // Show error message
      setHostData({
        text: validation.error || 'invalid input',
        centerPos: getViewportCenter(),
        timestamp: Date.now()
      });
      setState(prev => ({ ...prev, isProcessing: false }));
      return false;
    }

    // Store collected data based on message ID (more precise than inputType)
    const fieldName = getFieldNameFromMessageId(currentMessage.id);
    const newCollectedData = { ...state.collectedData, [fieldName]: input };

    // Update state with collected data immediately
    setState(prev => ({ ...prev, collectedData: newCollectedData }));

    // Determine next message
    let nextMessageId: string | null = null;

    if (currentMessage.branchLogic) {
      nextMessageId = currentMessage.branchLogic(input);
    } else if (currentMessage.onResponse) {
      nextMessageId = await currentMessage.onResponse(input, newCollectedData);
    } else if (currentMessage.nextMessageId) {
      nextMessageId = currentMessage.nextMessageId;
    }

    // Handle upgrade checkout redirect
    if (nextMessageId === 'redirecting_to_checkout') {
      const flow = HOST_FLOWS[state.currentFlowId!];
      const redirectingMessage = flow.messages['redirecting_to_checkout'];

      // Show redirecting message
      setHostData({
        text: redirectingMessage.text,
        centerPos: getViewportCenter(),
        timestamp: Date.now()
      });

      setState(prev => ({
        ...prev,
        currentMessageId: 'redirecting_to_checkout',
        isProcessing: true,
        isActive: false // Deactivate flow during redirect
      }));

      // Get current user and create checkout session
      const user = auth.currentUser;
      if (!user) {
        setHostData({
          text: 'please sign in first to upgrade',
          centerPos: getViewportCenter(),
          timestamp: Date.now()
        });
        setState(prev => ({ ...prev, isProcessing: false, isActive: false }));
        return false;
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
          // Redirect to Stripe checkout
          window.location.href = data.url;
          return true;
        } else {
          setHostData({
            text: 'checkout failed. please try /upgrade command instead.',
            centerPos: getViewportCenter(),
            timestamp: Date.now()
          });
          setState(prev => ({ ...prev, isProcessing: false, isActive: false }));
          return false;
        }
      } catch (error) {
        setHostData({
          text: 'something went wrong. please try /upgrade command instead.',
          centerPos: getViewportCenter(),
          timestamp: Date.now()
        });
        setState(prev => ({ ...prev, isProcessing: false, isActive: false }));
        return false;
      }
    }

    // Handle checking existing user credentials
    if (nextMessageId === 'checking_user') {
      const flow = HOST_FLOWS[state.currentFlowId!];
      const checkingMessage = flow.messages['checking_user'];

      // Show checking message and lock the flow
      setHostData({
        text: checkingMessage.text,
        centerPos: getViewportCenter(),
        timestamp: Date.now()
      });

      // Set a flag to prevent flow restart during auth
      setState(prev => ({
        ...prev,
        currentMessageId: 'checking_user',
        isProcessing: true,
        isActive: false // Deactivate flow to prevent restart
      }));

      // Try to sign in with existing credentials
      try {
        const { signInUser, getUserProfile } = await import('../firebase');

        if (!newCollectedData.email || !newCollectedData.password) {
          console.error('Missing email or password:', { email: !!newCollectedData.email, password: !!newCollectedData.password });
          throw new Error('Missing credentials');
        }

        const result = await signInUser(newCollectedData.email, newCollectedData.password);

        if (result.success && result.user) {
          // Existing user - get their profile and redirect
          const profile = await getUserProfile(result.user.uid);

          if (profile && profile.username) {

            // Clear host text and disable modes
            setHostData(null);

            // Clean up all labels spawned during dialogue
            if (setWorldData) {
              setWorldData(prev => {
                const newData = { ...prev };
                Object.keys(newData).forEach(key => {
                  if (key.startsWith('label_')) {
                    delete newData[key];
                  }
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

            // Redirect to their world immediately
            if (onAuthSuccess) {
              onAuthSuccess(profile.username);
            }

            return true;
          }
        }

        // Sign in failed - check if it's wrong password or new user
        if (result.error && result.error.includes('invalid-credential')) {
          // Check if user exists in database to distinguish between new user and wrong password
          try {
            const { ref, query, orderByChild, equalTo, get } = await import('firebase/database');
            const usersQuery = query(ref(database, 'users'), orderByChild('email'), equalTo(newCollectedData.email));
            const snapshot = await get(usersQuery);

            if (snapshot.exists()) {
              // User exists in database - this is a wrong password scenario
              setHostData({
                text: 'incorrect password. please try again.',
                centerPos: getViewportCenter(),
                timestamp: Date.now()
              });

              setState(prev => ({
                ...prev,
                currentMessageId: 'collect_password',
                isProcessing: false,
                isActive: true // Reactivate flow so user can try again
              }));
              return false;
            } else {
              // User doesn't exist - this is a new user, continue to username collection
              const flow = HOST_FLOWS[state.currentFlowId!];
              const usernameMessage = flow.messages['collect_username_welcome'];

              setHostData({
                text: usernameMessage.text,
                centerPos: getViewportCenter(),
                timestamp: Date.now()
              });

              setState(prev => ({
                ...prev,
                currentMessageId: 'collect_username_welcome',
                isProcessing: false,
                isActive: true, // Reactivate flow for username collection
                collectedData: newCollectedData // Explicitly preserve email and password
              }));

              return true;
            }
          } catch (dbError: any) {
            console.error('Database check error:', dbError);
            // Fallback to generic error if database check fails
            setHostData({
              text: 'something went wrong. please try again.',
              centerPos: getViewportCenter(),
              timestamp: Date.now()
            });

            setState(prev => ({
              ...prev,
              isProcessing: false,
              isActive: true
            }));
            return false;
          }
        } else {
          // Other error (wrong password, network issue, etc)
          setHostData({
            text: result.error || 'sign in failed. please try again.',
            centerPos: getViewportCenter(),
            timestamp: Date.now()
          });

          setState(prev => ({
            ...prev,
            isProcessing: false,
            isActive: true // Reactivate flow so user can try again
          }));
          return false;
        }
      } catch (error: any) {
        // Unexpected error
        console.error('Unexpected sign in error:', error);

        setHostData({
          text: 'something went wrong. please try again.',
          centerPos: getViewportCenter(),
          timestamp: Date.now()
        });

        setState(prev => ({
          ...prev,
          isProcessing: false,
          isActive: true // Reactivate flow so user can try again
        }));
        return false;
      }
    }

    // Handle magic link sending flow
    if (nextMessageId === 'link_sent') {
      const flow = HOST_FLOWS[state.currentFlowId!];

      // Update state immediately
      setState(prev => ({ ...prev, currentMessageId: 'link_sent', isProcessing: true }));

      // Actually send the magic link
      try {
        const result = await sendSignInLink(newCollectedData.email);

        if (result.success) {
          // Show success message
          const linkSentMessage = flow.messages['link_sent'];
          setHostData({
            text: linkSentMessage.text,
            centerPos: getViewportCenter(),
            timestamp: Date.now()
          });

          setState(prev => ({
            ...prev,
            currentMessageId: 'link_sent',
            isProcessing: false,
            isActive: true // Keep active - waiting for email verification
          }));

          return true;
        } else {
          // Show error with user-friendly message
          let errorMessage = result.error || 'failed to send magic link';

          // Handle quota exceeded error
          if (errorMessage.includes('quota-exceeded')) {
            errorMessage = 'daily email limit reached. please try again tomorrow or contact support.';
          }

          setHostData({
            text: errorMessage,
            centerPos: getViewportCenter(),
            timestamp: Date.now()
          });

          setState(prev => ({ ...prev, isProcessing: false }));
          return false;
        }
      } catch (error: any) {
        setHostData({
          text: 'something went wrong. please try again.',
          centerPos: getViewportCenter(),
          timestamp: Date.now()
        });

        setState(prev => ({ ...prev, isProcessing: false }));
        return false;
      }
    }

    // Handle profile creation flow (after email verification)
    if (nextMessageId === 'creating_profile') {
      const flow = HOST_FLOWS[state.currentFlowId!];
      const creatingMessage = flow.messages['creating_profile'];
      setHostData({
        text: creatingMessage.text,
        centerPos: getViewportCenter(),
        timestamp: Date.now()
      });

      setState(prev => ({ ...prev, currentMessageId: 'creating_profile' }));

      // Actually create/update the profile
      try {
        const user = auth.currentUser;
        if (!user) {
          throw new Error('No authenticated user found');
        }

        const username = newCollectedData.username;

        // Check if profile already exists
        const existingProfile = await getUserProfile(user.uid);

        if (!existingProfile) {
          // Create new profile with host background color as initial world setting
          const textColor = hostBackgroundColor === '#F0FF6A' ? '#000000' : '#FFFFFF';

          const userProfileData = {
            firstName: '',
            lastName: '',
            username,
            email: user.email || '',
            uid: user.uid,
            createdAt: new Date().toISOString(),
            membership: 'fresh',
            aiUsage: {
              daily: {},
              monthly: {},
              total: 0,
              lastReset: new Date().toISOString()
            }
          };

          await set(ref(database, `users/${user.uid}`), userProfileData);

          // Store world settings in separate worlds tree
          const worldSettings = {
            backgroundColor: hostBackgroundColor || '#FFFFFF',
            textColor: textColor
          };
          await set(ref(database, `worlds/${user.uid}/home/settings`), worldSettings);
        } else {
          // Update existing profile with username and initial world settings
          await set(ref(database, `users/${user.uid}/username`), username);

          if (hostBackgroundColor) {
            const textColor = hostBackgroundColor === '#F0FF6A' ? '#000000' : '#FFFFFF';
            await set(ref(database, `worlds/${user.uid}/home/settings`), {
              backgroundColor: hostBackgroundColor,
              textColor: textColor
            });
          }
        }

        // Update Firebase Auth display name
        await updateProfile(user, {
          displayName: username
        });

        // Show success message
        const successMessage = flow.messages['profile_created'];
        setHostData({
          text: successMessage.text,
          color: '#00AA00',
          centerPos: getViewportCenter(),
          timestamp: Date.now()
        });

        // End the flow immediately after showing success
        setState(prev => ({
          ...prev,
          currentMessageId: 'profile_created',
          isProcessing: false,
          isActive: false // End flow - don't restart
        }));

        // Clear host text and disable modes
        setHostData(null);

        // Clean up all labels spawned during dialogue
        if (setWorldData) {
          setWorldData(prev => {
            const newData = { ...prev };
            Object.keys(newData).forEach(key => {
              if (key.startsWith('label_')) {
                delete newData[key];
              }
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

        // Instantly navigate to user's world
        if (onAuthSuccess) {
          onAuthSuccess(username);
        }

        return true;
      } catch (error: any) {
        setHostData({
          text: 'something went wrong. please try again.',
          centerPos: getViewportCenter(),
          timestamp: Date.now()
        });

        setState(prev => ({ ...prev, isProcessing: false }));
        return false;
      }
    }

    // Handle account creation flow
    if (nextMessageId === 'creating_account') {
      // Show "creating account" message first
      const flow = HOST_FLOWS[state.currentFlowId!];
      const creatingMessage = flow.messages['creating_account'];
      setHostData({
        text: creatingMessage.text,
        centerPos: getViewportCenter(),
        timestamp: Date.now()
      });

      setState(prev => ({ ...prev, currentMessageId: 'creating_account' }));

      // Actually create the account
      try {
        const { auth, database, getUserProfile } = await import('../firebase');
        const { createUserWithEmailAndPassword, updateProfile, signInWithEmailAndPassword, EmailAuthProvider, linkWithCredential } = await import('firebase/auth');
        const { ref, set, get } = await import('firebase/database');

        // Use newCollectedData which has all accumulated data
        // Validate email and password before creating account
        if (!newCollectedData.email || !newCollectedData.password || !newCollectedData.username) {
          console.error('Missing required fields:', {
            email: !!newCollectedData.email,
            password: !!newCollectedData.password,
            username: !!newCollectedData.username,
            allData: newCollectedData
          });
          throw new Error('Missing required information. Please try again.');
        }

        let user;
        let isLinkingToExisting = false;

        try {
          // Try to create user with email and password
          const userCredential = await createUserWithEmailAndPassword(auth, newCollectedData.email, newCollectedData.password);
          user = userCredential.user;
        } catch (createError: any) {
          // If email already exists, link password to their existing account
          if (createError.code === 'auth/email-already-in-use') {
            console.log('Email already in use - linking password to existing account');
            isLinkingToExisting = true;
            
            // Current user should already be signed in from email link
            if (auth.currentUser) {
              const credential = EmailAuthProvider.credential(newCollectedData.email, newCollectedData.password);
              try {
                await linkWithCredential(auth.currentUser, credential);
                user = auth.currentUser;
                console.log('Successfully linked password to existing account');
              } catch (linkError: any) {
                console.error('Failed to link credential:', linkError);
                throw new Error('Unable to link password. Please try signing in instead.');
              }
            } else {
              // If not currently signed in, try signing in with the password
              // (shouldn't happen but defensive)
              throw new Error('Please sign in with your email link first.');
            }
          } else {
            throw createError;
          }
        }

        if (!user) {
          throw new Error('Failed to create or link account.');
        }

        // Update display name
        await updateProfile(user, {
          displayName: newCollectedData.username
        });

        // Check if profile already exists (for linked accounts)
        const existingProfile = await get(ref(database, `users/${user.uid}`));
        
        if (!existingProfile.exists()) {
          // Create new user profile in database
          const userProfileData = {
            firstName: '',
            lastName: '',
            username: newCollectedData.username,
            email: newCollectedData.email,
            uid: user.uid,
            createdAt: new Date().toISOString(),
            membership: 'fresh',
            aiUsage: {
              daily: {},
              monthly: {},
              total: 0,
              lastReset: new Date().toISOString()
            }
          };

          await set(ref(database, `users/${user.uid}`), userProfileData);
        } else {
          // Update existing profile with username
          await set(ref(database, `users/${user.uid}/username`), newCollectedData.username);
          console.log('Updated existing profile with username:', newCollectedData.username);
        }

        // Store world settings in separate worlds tree
        const worldSettings = {
          backgroundColor: hostBackgroundColor || '#FFFFFF',
          textColor: hostBackgroundColor === '#F0FF6A' ? '#000000' : '#FFFFFF'
        };
        await set(ref(database, `worlds/${user.uid}/home/settings`), worldSettings);

        // Show success message
        const successMessage = flow.messages['account_created'];
        setHostData({
          text: successMessage.text,
          centerPos: getViewportCenter(),
          timestamp: Date.now()
        });

        // Check if we're in a public world
        if (isPublicWorld) {
          // In public world: ask if they want to navigate to home
          const askNavMessage = flow.messages['ask_navigation'];
          
          // Small delay before asking navigation choice
          setTimeout(() => {
            setHostData({
              text: askNavMessage.text,
              centerPos: getViewportCenter(),
              timestamp: Date.now()
            });
          }, 1500);

          setState(prev => ({
            ...prev,
            currentMessageId: 'ask_navigation',
            isProcessing: false,
            isActive: true, // Keep flow active for navigation choice
            collectedData: newCollectedData // Preserve username
          }));

          return true;
        } else {
          // In personal world: redirect immediately (original behavior)
          setState(prev => ({
            ...prev,
            currentMessageId: 'account_created',
            isProcessing: false,
            isActive: false
          }));

          // Clear host text and disable modes
          setHostData(null);

          // Clean up all labels spawned during dialogue
          if (setWorldData) {
            setWorldData(prev => {
              const newData = { ...prev };
              Object.keys(newData).forEach(key => {
                if (key.startsWith('label_')) {
                  delete newData[key];
                }
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

          // Redirect immediately to user's world
          if (onAuthSuccess) {
            onAuthSuccess(newCollectedData.username);
          }

          return true;
        }
      } catch (error: any) {
        setHostData({
          text: error.message || 'failed to create account',
          centerPos: getViewportCenter(),
          timestamp: Date.now()
        });

        setState(prev => ({ ...prev, isProcessing: false }));
        return false;
      }
    }

    // Handle password reset flow
    if (nextMessageId === 'resetting_password') {
      const flow = HOST_FLOWS[state.currentFlowId!];
      const resettingMessage = flow.messages['resetting_password'];
      
      setHostData({
        text: resettingMessage.text,
        centerPos: getViewportCenter(),
        timestamp: Date.now()
      });
      
      setState(prev => ({ ...prev, currentMessageId: 'resetting_password', isProcessing: true }));
      
      try {
        const { auth, database } = await import('../firebase');
        const { signInWithEmailAndPassword, updatePassword } = await import('firebase/auth');
        const { ref, query, orderByChild, equalTo, get } = await import('firebase/database');
        
        // First check if user exists in database
        const usersQuery = query(ref(database, 'users'), orderByChild('email'), equalTo(newCollectedData.email));
        const snapshot = await get(usersQuery);
        
        if (!snapshot.exists()) {
          throw new Error('No account found with this email.');
        }
        
        // Check if user is currently signed in via email link
        if (auth.currentUser && auth.currentUser.email === newCollectedData.email) {
          // User is already signed in via email link - just update their password
          await updatePassword(auth.currentUser, newCollectedData.password);
          console.log('Password updated successfully');
          
          // Get username and redirect
          const userData = snapshot.val();
          const uid = Object.keys(userData)[0];
          const profile = userData[uid];
          
          setHostData({
            text: 'password reset! signing you in...',
            color: '#00AA00',
            centerPos: getViewportCenter(),
            timestamp: Date.now()
          });
          
          setState(prev => ({ ...prev, currentMessageId: 'reset_complete', isProcessing: false }));
          
          // Clean up and redirect
          setTimeout(() => {
            setHostData(null);
            
            if (setWorldData) {
              setWorldData(prev => {
                const newData = { ...prev };
                Object.keys(newData).forEach(key => {
                  if (key.startsWith('label_')) {
                    delete newData[key];
                  }
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
            
            if (onAuthSuccess && profile.username) {
              onAuthSuccess(profile.username);
            }
          }, 1500);
          
          return true;
        } else {
          // User not signed in - they need to come from password reset email
          throw new Error('Please use the password reset link from your email.');
        }
      } catch (error: any) {
        console.error('Password reset error:', error);
        setHostData({
          text: error.message || 'failed to reset password. please try again.',
          centerPos: getViewportCenter(),
          timestamp: Date.now()
        });
        
        setState(prev => ({ ...prev, isProcessing: false, isActive: true }));
        return false;
      }
    }

    // Handle flow dismissal (after stay_in_public - any key to continue)
    if (nextMessageId === 'dismiss_flow') {
      // Immediately cleanup and exit
      setHostData(null);

      // Clean up all labels spawned during dialogue
      if (setWorldData) {
        setWorldData(prev => {
          const newData = { ...prev };
          Object.keys(newData).forEach(key => {
            if (key.startsWith('label_')) {
              delete newData[key];
            }
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

      setState(prev => ({
        ...prev,
        currentMessageId: 'dismiss_flow',
        isProcessing: false,
        isActive: false
      }));

      return true;
    }

    // Handle navigation choice - redirect to home world
    if (nextMessageId === 'navigate_home') {
      const flow = HOST_FLOWS[state.currentFlowId!];
      const navigateMessage = flow.messages['navigate_home'];
      
      setHostData({
        text: navigateMessage.text,
        centerPos: getViewportCenter(),
        timestamp: Date.now()
      });

      setState(prev => ({
        ...prev,
        currentMessageId: 'navigate_home',
        isProcessing: false,
        isActive: false
      }));

      // Clear host text and disable modes
      setTimeout(() => {
        setHostData(null);

        // Clean up all labels spawned during dialogue
        if (setWorldData) {
          setWorldData(prev => {
            const newData = { ...prev };
            Object.keys(newData).forEach(key => {
              if (key.startsWith('label_')) {
                delete newData[key];
              }
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

        // Navigate to user's world
        if (onAuthSuccess && newCollectedData.username) {
          onAuthSuccess(newCollectedData.username);
        }
      }, 1000);

      return true;
    }

    // Handle navigation choice - stay in public world (shows message, waits for any key)
    if (nextMessageId === 'stay_in_public') {
      const flow = HOST_FLOWS[state.currentFlowId!];
      const stayMessage = flow.messages['stay_in_public'];
      
      setHostData({
        text: stayMessage.text,
        centerPos: getViewportCenter(),
        timestamp: Date.now()
      });

      setState(prev => ({
        ...prev,
        currentMessageId: 'stay_in_public',
        isProcessing: false,
        isActive: true // Keep active to wait for dismissal input
      }));

      return true;
    }

    // Regular flow progression
    if (nextMessageId) {
      const flow = HOST_FLOWS[state.currentFlowId!];
      const nextMessage = flow.messages[nextMessageId];

      if (nextMessage) {
        // Display next message (centered at current viewport)
        setHostData({
          text: nextMessage.text,
          centerPos: getViewportCenter(),
          timestamp: Date.now()
        });

        setState(prev => ({
          ...prev,
          currentMessageId: nextMessageId,
          isProcessing: false
        }));

        return true;
      }
    }

    // No next message - end flow
    setState(prev => ({
      ...prev,
      isActive: false,
      isProcessing: false
    }));

    return true;
  }, [state, getCurrentMessage, validateInput, setHostData, onAuthSuccess]);

  // Get current input type for rendering (e.g., password masking)
  const getCurrentInputType = useCallback((): InputType | null => {
    const currentMessage = getCurrentMessage();
    return currentMessage?.inputType || null;
  }, [getCurrentMessage]);

  // Check if currently expecting input
  const isExpectingInput = useCallback((): boolean => {
    const currentMessage = getCurrentMessage();
    return currentMessage?.expectsInput || false;
  }, [getCurrentMessage]);

  // Reset/exit flow
  const exitFlow = useCallback(() => {
    setState({
      isActive: false,
      currentFlowId: null,
      currentMessageId: null,
      collectedData: {},
      isProcessing: false
    });
  }, []);

  // Validate command execution for tutorial flows
  const validateCommand = useCallback((executedCommand: string, args: string[], worldState?: any): boolean => {
    const currentMessage = getCurrentMessage();
    if (!currentMessage) return false;

    // Check if this message expects a command
    if (!currentMessage.expectedCommand || !currentMessage.commandValidator) {
      return false;
    }

    // Check if the executed command matches the expected command
    if (executedCommand !== currentMessage.expectedCommand) {
      return false;
    }

    // Run the validator
    const isValid = currentMessage.commandValidator(executedCommand, args, worldState);

    // If valid, advance to next message
    if (isValid && currentMessage.nextMessageId) {
      const flow = HOST_FLOWS[state.currentFlowId!];
      const nextMessage = flow.messages[currentMessage.nextMessageId];

      if (nextMessage) {
        setHostData({
          text: nextMessage.text,
          centerPos: getViewportCenter(),
          timestamp: Date.now()
        });

        setState(prev => ({
          ...prev,
          currentMessageId: currentMessage.nextMessageId!
        }));
      }
    }

    return isValid;
  }, [getCurrentMessage, state.currentFlowId, setHostData, getViewportCenter]);

  return {
    hostState: state,
    startFlow,
    processInput,
    getCurrentMessage,
    getCurrentInputType,
    isExpectingInput,
    exitFlow,
    isHostActive: state.isActive,
    isHostProcessing: state.isProcessing,
    advanceToNextMessage,
    goBackToPreviousMessage,
    validateCommand
  };
}
