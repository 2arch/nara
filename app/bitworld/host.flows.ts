// Host flow definitions for conversational onboarding
export type InputType = 'text' | 'email' | 'password' | 'username' | 'choice';

export interface HostMessage {
  id: string;
  text: string;
  expectsInput: boolean;
  inputType?: InputType;
  inputValidator?: (input: string) => Promise<{ valid: boolean; error?: string }> | { valid: boolean; error?: string };

  // For choice-based responses
  choices?: string[];

  // Flow control
  onResponse?: (input: string, collectedData: Record<string, any>) => Promise<string>;
  nextMessageId?: string;
  branchLogic?: (input: string) => string;
}

export interface HostFlow {
  flowId: string;
  startMessageId: string;
  messages: Record<string, HostMessage>;
}

import { checkUsernameAvailability } from '../firebase';

// Simplified welcome flow - just collect email for magic link
export const welcomeFlow: HostFlow = {
  flowId: 'welcome',
  startMessageId: 'welcome',
  messages: {
    'welcome': {
      id: 'welcome',
      text: 'type your email to get access',
      expectsInput: true,
      inputType: 'email',
      inputValidator: (input: string) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(input)) return { valid: false, error: 'that doesn\'t look like a valid email' };
        return { valid: true };
      },
      nextMessageId: 'link_sent'
    },

    'link_sent': {
      id: 'link_sent',
      text: 'check your email! click the link to sign in.',
      expectsInput: false
    }
  }
};

// Verification flow - collect username after email verification
export const verificationFlow: HostFlow = {
  flowId: 'verification',
  startMessageId: 'collect_username',
  messages: {
    'collect_username': {
      id: 'collect_username',
      text: 'choose a username',
      expectsInput: true,
      inputType: 'username',
      inputValidator: async (input: string) => {
        // Username validation
        if (input.length < 3) return { valid: false, error: 'username must be at least 3 characters' };
        if (input.length > 20) return { valid: false, error: 'username must be 20 characters or less' };
        if (!/^[a-zA-Z0-9_]+$/.test(input)) return { valid: false, error: 'username can only contain letters, numbers, and underscores' };

        // Check availability
        const isAvailable = await checkUsernameAvailability(input);
        if (!isAvailable) return { valid: false, error: 'username already taken' };

        return { valid: true };
      },
      onResponse: async (input: string, collectedData: Record<string, any>) => {
        // Trigger profile creation
        return 'creating_profile';
      }
    },

    'creating_profile': {
      id: 'creating_profile',
      text: 'creating your profile...',
      expectsInput: false
    },

    'profile_created': {
      id: 'profile_created',
      text: 'welcome to nara!',
      expectsInput: false
    }
  }
};

// Export all flows
export const HOST_FLOWS: Record<string, HostFlow> = {
  'welcome': welcomeFlow,
  'verification': verificationFlow
};
