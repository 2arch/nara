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
  previousMessageId?: string;
  branchLogic?: (input: string) => string;

  // Staged content for exploration
  spawnContent?: (centerPos: { x: number; y: number }) => Record<string, string>;
  // Cleanup flag to remove previously spawned labels
  despawnLabels?: boolean;
}

export interface HostFlow {
  flowId: string;
  startMessageId: string;
  messages: Record<string, HostMessage>;
}

import { checkUsernameAvailability } from '../firebase';

// Simplified welcome flow - greet then collect email for magic link
export const welcomeFlow: HostFlow = {
  flowId: 'welcome',
  startMessageId: 'welcome_message',
  messages: {
    'welcome_message': {
      id: 'welcome_message',
      text: 'Hey! Welcome to Nara.',
      expectsInput: false,
      nextMessageId: 'explain_nara'
    },

    'explain_nara': {
      id: 'explain_nara',
      text: 'Nara is a new medium where you can express your thoughts non-linearly.',
      expectsInput: false,
      nextMessageId: 'explain_function',
      previousMessageId: 'welcome_message'
    },

    'explain_function': {
      id: 'explain_function',
      text: 'Functionally, it\'s like any word processor. \n \n The only limit is your ability to harness the space to connect the dots.',
      expectsInput: false,
      nextMessageId: 'explain_user',
      previousMessageId: 'explain_nara'
    },

    'explain_user': {
      id: 'explain_user',
      text: 'Feel free to explore around (use two fingers to pan).',
      expectsInput: false,
      nextMessageId: 'validate_user',
      previousMessageId: 'explain_function',
      spawnContent: (centerPos) => {
        // Calculate viewport width in world coords (rough estimate)
        const viewportWidth = 100; // Cells
        const viewportHeight = 40; // Cells

        // Spawn labels offscreen so guidance arrows appear
        const content: Record<string, string> = {};

        // Label 1: Top-right (offscreen)
        const label1X = centerPos.x + viewportWidth;
        const label1Y = centerPos.y - viewportHeight * 0.5;
        content[`label_${label1X},${label1Y}`] = JSON.stringify({
          text: 'non-linear thinking',
          color: '#F0FF6A',
          background: undefined
        });

        // Label 2: Bottom-left (offscreen)
        const label2X = centerPos.x - viewportWidth * 0.8;
        const label2Y = centerPos.y + viewportHeight * 0.6;
        content[`label_${label2X},${label2Y}`] = JSON.stringify({
          text: 'spatial canvas',
          color: '#69AED6',
          background: undefined
        });

        // Label 3: Far right (offscreen)
        const label3X = centerPos.x + viewportWidth * 1.2;
        const label3Y = centerPos.y + viewportHeight * 0.3;
        content[`label_${label3X},${label3Y}`] = JSON.stringify({
          text: 'connect ideas',
          color: '#FFA500',
          background: undefined
        });

        return content;
      }
    },
    'validate_user': {
      id: 'validate_user',
      text:  'You can also access the commands menu that can be toggled with the "/" key.',
      expectsInput: false,
      nextMessageId: 'welcome',
      previousMessageId: 'explain_user'
    },
    'welcome': {
      id: 'welcome',
      text: 'Type your email and confirm for an official invite to the space.',
      expectsInput: true,
      inputType: 'email',
      inputValidator: (input: string) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(input)) return { valid: false, error: 'that doesn\'t look like a valid email' };
        return { valid: true };
      },
      nextMessageId: 'link_sent',
      previousMessageId: 'validate_user',
      despawnLabels: true // Remove exploration labels when user reaches email step
    },

    'link_sent': {
      id: 'link_sent',
      text: 'Email sent. Please check your email and click the link to get started!',
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
