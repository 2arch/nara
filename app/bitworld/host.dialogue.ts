// Host dialogue system for conversational onboarding
import { useState, useCallback } from 'react';
import { HOST_FLOWS, HostFlow, HostMessage, InputType } from './host.flows';
import { signUpUser } from '../firebase';
import type { Point } from './world.engine';

export interface HostDialogueState {
  isActive: boolean;
  currentFlowId: string | null;
  currentMessageId: string | null;
  collectedData: Record<string, any>;
  isProcessing: boolean; // For async operations like Firebase auth
}

export interface UseHostDialogueProps {
  addInstantAIResponse: (startPos: Point, text: string, options?: any) => { width: number; height: number };
  setDialogueText: (text: string) => void;
  onAuthSuccess?: (username: string) => void;
}

// Helper to map message IDs to field names
function getFieldNameFromMessageId(messageId: string): string {
  const fieldMap: Record<string, string> = {
    'signup_start': 'firstName',
    'collect_lastname': 'lastName',
    'collect_email': 'email',
    'collect_password': 'password',
    'collect_username': 'username'
  };
  return fieldMap[messageId] || messageId;
}

export function useHostDialogue({ addInstantAIResponse, setDialogueText, onAuthSuccess }: UseHostDialogueProps) {
  const [state, setState] = useState<HostDialogueState>({
    isActive: false,
    currentFlowId: null,
    currentMessageId: null,
    collectedData: {},
    isProcessing: false
  });

  // Start a flow
  const startFlow = useCallback((flowId: string, cursorPos: Point) => {
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

    // Display the first message (will be manually cleared when user responds)
    addInstantAIResponse(cursorPos, startMessage.text, {
      fadeDelay: 999999, // Don't auto-fade
      fadeInterval: 1 // Instant fade when it does fade
    });

    setState({
      isActive: true,
      currentFlowId: flowId,
      currentMessageId: flow.startMessageId,
      collectedData: {},
      isProcessing: false
    });
  }, [addInstantAIResponse]);

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
  const processInput = useCallback(async (input: string, cursorPos: Point): Promise<boolean> => {
    if (state.isProcessing) return false;

    const currentMessage = getCurrentMessage();
    if (!currentMessage || !currentMessage.expectsInput) {
      return false;
    }

    // Validate input
    const validation = await validateInput(input);
    if (!validation.valid) {
      // Show error message
      addInstantAIResponse(cursorPos, validation.error || 'invalid input', {
        color: '#FF0000',
        fadeDelay: 3000
      });
      return false;
    }

    // Store collected data based on message ID (more precise than inputType)
    const fieldName = getFieldNameFromMessageId(currentMessage.id);
    const newCollectedData = { ...state.collectedData, [fieldName]: input };

    setState(prev => ({ ...prev, collectedData: newCollectedData, isProcessing: true }));

    // Determine next message
    let nextMessageId: string | null = null;

    if (currentMessage.branchLogic) {
      nextMessageId = currentMessage.branchLogic(input);
    } else if (currentMessage.onResponse) {
      nextMessageId = await currentMessage.onResponse(input, newCollectedData);
    } else if (currentMessage.nextMessageId) {
      nextMessageId = currentMessage.nextMessageId;
    }

    // Handle account creation flow
    if (nextMessageId === 'creating_account') {
      // Show "creating account" message first
      const flow = HOST_FLOWS[state.currentFlowId!];
      const creatingMessage = flow.messages['creating_account'];
      addInstantAIResponse(cursorPos, creatingMessage.text, {
        fadeDelay: 999999
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
          addInstantAIResponse(cursorPos, successMessage.text, {
            color: '#00AA00',
            fadeDelay: 3000
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
          addInstantAIResponse(cursorPos, result.error || 'failed to create account', {
            color: '#FF0000',
            fadeDelay: 3000
          });

          setState(prev => ({ ...prev, isProcessing: false }));
          return false;
        }
      } catch (error: any) {
        addInstantAIResponse(cursorPos, 'something went wrong. please try again.', {
          color: '#FF0000',
          fadeDelay: 3000
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
        // Display next message (will be manually cleared when user responds)
        addInstantAIResponse(cursorPos, nextMessage.text, {
          fadeDelay: 999999, // Don't auto-fade
          fadeInterval: 1 // Instant fade when it does fade
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
  }, [state, getCurrentMessage, validateInput, addInstantAIResponse, onAuthSuccess]);

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
