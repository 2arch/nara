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
}

// Helper to map message IDs to field names
function getFieldNameFromMessageId(messageId: string): string {
  const fieldMap: Record<string, string> = {
    'signup_start': 'firstName',
    'collect_lastname': 'lastName',
    'collect_email': 'email',
    'collect_password': 'password',
    'collect_username': 'username',
    'welcome': 'email' // For magic link flow
  };
  return fieldMap[messageId] || 'username'; // Default to username for verification flow
}

export function useHostDialogue({ setHostData, getViewportCenter, setDialogueText, onAuthSuccess, onTriggerZoom, setHostMode, setChatMode }: UseHostDialogueProps) {
  const [state, setState] = useState<HostDialogueState>({
    isActive: false,
    currentFlowId: null,
    currentMessageId: null,
    collectedData: {},
    isProcessing: false
  });

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
    setHostData({
      text: startMessage.text,
      color: undefined, // Will use engine.textColor
      centerPos: getViewportCenter(),
      timestamp: Date.now()
    });

    setState({
      isActive: true,
      currentFlowId: flowId,
      currentMessageId: flow.startMessageId,
      collectedData: {},
      isProcessing: false
    });
  }, [setHostData]);

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
        color: '#FF0000',
        centerPos: getViewportCenter(),
        timestamp: Date.now()
      });
      setState(prev => ({ ...prev, isProcessing: false }));
      return false;
    }

    // Store collected data based on message ID (more precise than inputType)
    const fieldName = getFieldNameFromMessageId(currentMessage.id);
    const newCollectedData = { ...state.collectedData, [fieldName]: input };

    // Determine next message
    let nextMessageId: string | null = null;

    if (currentMessage.branchLogic) {
      nextMessageId = currentMessage.branchLogic(input);
    } else if (currentMessage.onResponse) {
      nextMessageId = await currentMessage.onResponse(input, newCollectedData);
    } else if (currentMessage.nextMessageId) {
      nextMessageId = currentMessage.nextMessageId;
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
            color: '#FF0000',
            centerPos: getViewportCenter(),
            timestamp: Date.now()
          });

          setState(prev => ({ ...prev, isProcessing: false }));
          return false;
        }
      } catch (error: any) {
        setHostData({
          text: 'something went wrong. please try again.',
          color: '#FF0000',
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
          // Create new profile
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
        } else {
          // Update existing profile with username
          await set(ref(database, `users/${user.uid}/username`), username);
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

        // Disable host mode and chat mode to prevent restart
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
          color: '#FF0000',
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
        const result = await signUpUser(
          newCollectedData.email,
          newCollectedData.password,
          newCollectedData.firstName,
          newCollectedData.lastName,
          newCollectedData.username
        );

        if (result.success) {
          // Show success message
          const successMessage = flow.messages['account_created'];
          setHostData({
            text: successMessage.text,
            color: '#00AA00',
            centerPos: getViewportCenter(),
            timestamp: Date.now()
          });

          // Navigate to user's world
          if (onAuthSuccess) {
            setTimeout(() => {
              onAuthSuccess(newCollectedData.username);
            }, 2000);
          }

          setState(prev => ({
            ...prev,
            currentMessageId: 'account_created',
            isProcessing: false,
            isActive: false // End flow
          }));

          return true;
        } else {
          // Show error
          setHostData({
            text: result.error || 'failed to create account',
            color: '#FF0000',
            centerPos: getViewportCenter(),
            timestamp: Date.now()
          });

          setState(prev => ({ ...prev, isProcessing: false }));
          return false;
        }
      } catch (error: any) {
        setHostData({
          text: 'something went wrong. please try again.',
          color: '#FF0000',
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
    isHostProcessing: state.isProcessing
  };
}
