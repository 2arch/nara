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
      text: 'Nara is a new medium for spatial writing. \n \n ',
      expectsInput: false,
      nextMessageId: 'explain_function',
      previousMessageId: 'welcome_message'
    },

    'explain_function': {
      id: 'explain_function',
      text: 'It\'s meant to provide a unique, and intuitve writing experience.',
      expectsInput: false,
      nextMessageId: 'explain_user',
      previousMessageId: 'explain_nara'
    },

    'explain_user': {
      id: 'explain_user',
      text: 'I\'ve added some markers to get you started. Take a look around! \n \n (use two fingers to pan)',
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
      text:  'As you spend more time here, you\'ll find that the real limit is your ability to harness the space to connect the dots. \n \n We created a medium that helps you think better.',
      expectsInput: false,
      nextMessageId: 'welcome',
      previousMessageId: 'explain_user'
    },
    'welcome': {
      id: 'welcome',
      text: 'Type your email and hit enter to begin your journey. \n \n Welcome to Nara. It\'s great to see you.',
      expectsInput: true,
      inputType: 'email',
      inputValidator: (input: string) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(input)) return { valid: false, error: 'that doesn\'t look like a valid email' };
        return { valid: true };
      },
      nextMessageId: 'collect_password',
      previousMessageId: 'validate_user',
      despawnLabels: true // Remove exploration labels when user reaches email step
    },

    'collect_password': {
      id: 'collect_password',
      text: 'choose a password (at least 6 characters)',
      expectsInput: true,
      inputType: 'password',
      inputValidator: (input: string) => {
        if (input.length < 6) return { valid: false, error: 'password must be at least 6 characters' };
        return { valid: true };
      },
      onResponse: async (input: string, collectedData: Record<string, any>) => {
        // Check if this is an existing user by trying to sign in
        return 'checking_user';
      },
      previousMessageId: 'welcome'
    },

    'checking_user': {
      id: 'checking_user',
      text: 'checking credentials...',
      expectsInput: false
    },

    'collect_username_welcome': {
      id: 'collect_username_welcome',
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
        // Trigger account creation with email/password/username
        return 'creating_account';
      },
      previousMessageId: 'collect_password'
    },

    'creating_account': {
      id: 'creating_account',
      text: 'creating your account...',
      expectsInput: false
    },

    'account_created': {
      id: 'account_created',
      text: 'welcome to nara!',
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

// Upgrade flow - for when users hit AI limits
export const upgradeFlow: HostFlow = {
  flowId: 'upgrade',
  startMessageId: 'limit_reached',
  messages: {
    'limit_reached': {
      id: 'limit_reached',
      text: 'You\'ve hit your daily AI limit.',
      expectsInput: false,
      nextMessageId: 'explain_limit'
    },

    'explain_limit': {
      id: 'explain_limit',
      text: 'On the fresh tier, you get 5 AI interactions per day. \n \n This helps us keep Nara sustainable while you explore.',
      expectsInput: false,
      nextMessageId: 'introduce_pro',
      previousMessageId: 'limit_reached'
    },

    'introduce_pro': {
      id: 'introduce_pro',
      text: 'But if you\'re ready to go deeper, Nara Pro gives you unlimited AI.',
      expectsInput: false,
      nextMessageId: 'show_benefits',
      previousMessageId: 'explain_limit'
    },

    'show_benefits': {
      id: 'show_benefits',
      text: 'With Pro, you can: \n \n → Generate unlimited images \n → Transform text without limits \n → Chat with AI as much as you need \n → Push your thinking further',
      expectsInput: false,
      nextMessageId: 'show_pricing',
      previousMessageId: 'introduce_pro'
    },

    'show_pricing': {
      id: 'show_pricing',
      text: 'Nara Pro is $10/month. \n \n Think of it as the cost of two coffees for unlimited creative space.',
      expectsInput: false,
      nextMessageId: 'upgrade_prompt',
      previousMessageId: 'show_benefits'
    },

    'upgrade_prompt': {
      id: 'upgrade_prompt',
      text: 'Ready to upgrade? \n \n Type "yes" to continue, or "no" if you\'d like to stay on the fresh tier.',
      expectsInput: true,
      inputType: 'choice',
      choices: ['yes', 'no'],
      inputValidator: (input: string) => {
        const lowercased = input.toLowerCase().trim();
        if (lowercased === 'yes' || lowercased === 'no') {
          return { valid: true };
        }
        return { valid: false, error: 'please type "yes" or "no"' };
      },
      onResponse: async (input: string, collectedData: Record<string, any>) => {
        if (input.toLowerCase().trim() === 'yes') {
          return 'redirecting_to_checkout';
        } else {
          return 'upgrade_declined';
        }
      },
      previousMessageId: 'show_pricing'
    },

    'redirecting_to_checkout': {
      id: 'redirecting_to_checkout',
      text: 'taking you to checkout...',
      expectsInput: false
    },

    'upgrade_declined': {
      id: 'upgrade_declined',
      text: 'No worries! Your quota resets tomorrow. \n \n You can always upgrade later by typing /pro.',
      expectsInput: false
    }
  }
};

// Tutorial flow - interactive onboarding with agent demonstrations
export const tutorialFlow: HostFlow = {
  flowId: 'tutorial',
  startMessageId: 'tutorial_welcome',
  messages: {
    'tutorial_welcome': {
      id: 'tutorial_welcome',
      text: 'Hey! I\'m your guide. I\'ll show you around Nara.',
      expectsInput: false,
      nextMessageId: 'tutorial_background_intro'
    },

    'tutorial_background_intro': {
      id: 'tutorial_background_intro',
      text: 'Let\'s start with something simple. \n \n Type /bg followed by any color to change the background.',
      expectsInput: false,
      nextMessageId: 'tutorial_typing_intro',
      previousMessageId: 'tutorial_welcome'
    },

    'tutorial_typing_intro': {
      id: 'tutorial_typing_intro',
      text: 'To write text, just click anywhere on the canvas and start typing. \n \n The canvas is infinite - your thoughts can go anywhere.',
      expectsInput: false,
      nextMessageId: 'tutorial_label_intro',
      previousMessageId: 'tutorial_background_intro'
    },

    'tutorial_label_intro': {
      id: 'tutorial_label_intro',
      text: 'Want to mark something important? \n \n Use /label to create markers that help organize your space.',
      expectsInput: false,
      nextMessageId: 'tutorial_selection_intro',
      previousMessageId: 'tutorial_typing_intro'
    },

    'tutorial_selection_intro': {
      id: 'tutorial_selection_intro',
      text: 'Select regions by holding Shift and dragging. \n \n Then use /bound to create a bounded area.',
      expectsInput: false,
      nextMessageId: 'tutorial_ai_intro',
      previousMessageId: 'tutorial_label_intro'
    },

    'tutorial_ai_intro': {
      id: 'tutorial_ai_intro',
      text: 'Here\'s where it gets interesting. \n \n Nara has AI built in.',
      expectsInput: false,
      nextMessageId: 'tutorial_ai_explain',
      previousMessageId: 'tutorial_selection_intro'
    },

    'tutorial_ai_explain': {
      id: 'tutorial_ai_explain',
      text: 'Type / to see AI commands. \n \n /write, /transform, /explain - they\'re all here.',
      expectsInput: false,
      nextMessageId: 'tutorial_navigation',
      previousMessageId: 'tutorial_ai_intro'
    },

    'tutorial_navigation': {
      id: 'tutorial_navigation',
      text: 'Use two fingers to pan around. \n \n Your canvas is infinite in all directions.',
      expectsInput: false,
      nextMessageId: 'tutorial_complete',
      previousMessageId: 'tutorial_ai_explain'
    },

    'tutorial_complete': {
      id: 'tutorial_complete',
      text: 'That\'s it! You\'re ready to explore. \n \n Press Escape to exit this tutorial.',
      expectsInput: false,
      previousMessageId: 'tutorial_navigation'
    }
  }
};

// Export all flows
export const HOST_FLOWS: Record<string, HostFlow> = {
  'welcome': welcomeFlow,
  'verification': verificationFlow,
  'upgrade': upgradeFlow,
  'tutorial': tutorialFlow
};
