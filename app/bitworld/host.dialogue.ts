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

export function useHostDialogue({ setHostData, getViewportCenter, setDialogueText, onAuthSuccess, onTriggerZoom, setHostMode, setChatMode, addEphemeralText, setWorldData, hostBackgroundColor }: UseHostDialogueProps) {
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

    setState({
      isActive: true,
      currentFlowId: flowId,
      currentMessageId: flow.startMessageId,
      collectedData: {},
      isProcessing: false
    });
  }, [setHostData, getViewportCenter, setWorldData]);

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
            text: 'checkout failed. please try /pro command instead.',
            centerPos: getViewportCenter(),
            timestamp: Date.now()
          });
          setState(prev => ({ ...prev, isProcessing: false, isActive: false }));
          return false;
        }
      } catch (error) {
        setHostData({
          text: 'something went wrong. please try /pro command instead.',
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
          // This is a new user, continue to username collection
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
            },
            worlds: {
              home: {
                settings: {
                  backgroundColor: hostBackgroundColor || '#FFFFFF',
                  textColor: textColor
                }
              }
            }
          };

          await set(ref(database, `users/${user.uid}`), userProfileData);
        } else {
          // Update existing profile with username and initial world settings
          await set(ref(database, `users/${user.uid}/username`), username);

          if (hostBackgroundColor) {
            const textColor = hostBackgroundColor === '#F0FF6A' ? '#000000' : '#FFFFFF';
            await set(ref(database, `users/${user.uid}/worlds/home/settings`), {
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
        const { auth, database } = await import('../firebase');
        const { createUserWithEmailAndPassword, updateProfile } = await import('firebase/auth');
        const { ref, set } = await import('firebase/database');

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

        console.log('Creating account with:', {
          email: newCollectedData.email,
          username: newCollectedData.username,
          hasPassword: !!newCollectedData.password
        });

        // Create user with email and password
        const userCredential = await createUserWithEmailAndPassword(auth, newCollectedData.email, newCollectedData.password);
        const user = userCredential.user;

        // Update display name
        await updateProfile(user, {
          displayName: newCollectedData.username
        });

        // Create user profile in database
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
          },
          worlds: {
            home: {
              settings: {
                backgroundColor: hostBackgroundColor || '#FFFFFF',
                textColor: hostBackgroundColor === '#F0FF6A' ? '#000000' : '#FFFFFF'
              }
            }
          }
        };

        await set(ref(database, `users/${user.uid}`), userProfileData);

        // Show success message
        const successMessage = flow.messages['account_created'];
        setHostData({
          text: successMessage.text,
          centerPos: getViewportCenter(),
          timestamp: Date.now()
        });

        // End flow immediately
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
    goBackToPreviousMessage
  };
}
