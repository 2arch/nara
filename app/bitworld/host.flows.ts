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

  // Tutorial-specific: command validation
  requiresChatMode?: boolean; // If false, user executes commands directly on canvas
  expectedCommand?: string; // The command the user should execute (e.g., "bg")
  commandValidator?: (executedCommand: string, args: string[], worldState?: any) => boolean; // Validate command was executed correctly
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
      text: 'Type your email and hit enter to begin your journey.',
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
    },

    // Public world navigation choice
    'ask_navigation': {
      id: 'ask_navigation',
      text: 'would you like to navigate to your home world? \n \n (yes / no)',
      expectsInput: true,
      inputType: 'choice',
      choices: ['yes', 'no'],
      branchLogic: (input: string) => {
        const normalized = input.toLowerCase().trim();
        if (normalized === 'yes' || normalized === 'y') return 'navigate_home';
        if (normalized === 'no' || normalized === 'n') return 'stay_in_public';
        return 'ask_navigation'; // Invalid input, ask again
      },
      previousMessageId: 'account_created'
    },

    'navigate_home': {
      id: 'navigate_home',
      text: 'taking you to your world...',
      expectsInput: false
    },

    'stay_in_public': {
      id: 'stay_in_public',
      text: 'sounds good! you can always navigate to your home world using the /state command. \n \n enjoy! (press enter to continue)',
      expectsInput: true,
      inputType: 'text',
      inputValidator: () => ({ valid: true }), // Accept any input including empty
      nextMessageId: 'dismiss_flow'
    },

    'dismiss_flow': {
      id: 'dismiss_flow',
      text: '',
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

// Tutorial flow - interactive command learning
export const tutorialFlow: HostFlow = {
  flowId: 'tutorial',
  startMessageId: 'tutorial_welcome',
  messages: {
    'tutorial_welcome': {
      id: 'tutorial_welcome',
      text: 'Welcome to the Nara tutorial! \n \n I\'ll teach you the basics of spatial writing.',
      expectsInput: false,
      requiresChatMode: false,
      nextMessageId: 'learn_background'
    },

    'learn_background': {
      id: 'learn_background',
      text: 'Let\'s start by changing the background color. \n \n Type: /bg chalk',
      expectsInput: true,
      requiresChatMode: false,
      expectedCommand: 'bg',
      commandValidator: (cmd, args) => {
        return cmd === 'bg' && args.length > 0 && args[0].toLowerCase() === 'chalk';
      },
      nextMessageId: 'background_success',
      previousMessageId: 'tutorial_welcome'
    },

    'background_success': {
      id: 'background_success',
      text: 'Perfect! You changed the background to red. \n \n Next, let\'s learn about text colors.',
      expectsInput: false,
      requiresChatMode: false,
      nextMessageId: 'learn_color',
      previousMessageId: 'learn_background'
    },

    'learn_color': {
      id: 'learn_color',
      text: 'Now change your text color. \n \n Type: /text garden',
      expectsInput: true,
      requiresChatMode: false,
      expectedCommand: 'text',
      commandValidator: (cmd, args) => {
        return cmd === 'text' && args.length > 0 && args[0].toLowerCase() === 'garden';
      },
      nextMessageId: 'color_success',
      previousMessageId: 'background_success'
    },

    'color_success': {
      id: 'color_success',
      text: 'Great! Your text is now garden green. \n \n Let\'s create a label to organize your thoughts.',
      expectsInput: false,
      requiresChatMode: false,
      nextMessageId: 'learn_label',
      previousMessageId: 'learn_color'
    },

    'learn_label': {
      id: 'learn_label',
      text: 'Labels help you mark important points in space. \n \n First, select a location by clicking and dragging on the canvas. \n \n Then, type: /label ',
      expectsInput: true,
      requiresChatMode: false,
      expectedCommand: 'label',
      commandValidator: (cmd, args) => {
        return cmd === 'label' && args.length > 0;
      },
      nextMessageId: 'label_success',
      previousMessageId: 'color_success'
    },

    'label_success': {
      id: 'label_success',
      text: 'Excellent! You created a label. \n \n Labels appear as arrows pointing to that location.',
      expectsInput: false,
      requiresChatMode: false,
      nextMessageId: 'tutorial_complete',
      previousMessageId: 'learn_label'
    },

    'tutorial_complete': {
      id: 'tutorial_complete',
      text: 'You\'ve completed the basics! \n \n Type /help anytime to see all commands. Happy writing!',
      expectsInput: false,
      requiresChatMode: false,
      previousMessageId: 'label_success'
    }
  }
};

// Password reset flow for existing users
export const passwordResetFlow: HostFlow = {
  flowId: 'password_reset',
  startMessageId: 'reset_welcome',
  messages: {
    'reset_welcome': {
      id: 'reset_welcome',
      text: 'Welcome back! Let\'s reset your password.',
      expectsInput: false,
      nextMessageId: 'collect_email'
    },

    'collect_email': {
      id: 'collect_email',
      text: 'Enter your email address:',
      expectsInput: true,
      inputType: 'email',
      inputValidator: (input: string) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(input)) return { valid: false, error: 'that doesn\'t look like a valid email' };
        return { valid: true };
      },
      nextMessageId: 'collect_new_password',
      previousMessageId: 'reset_welcome'
    },

    'collect_new_password': {
      id: 'collect_new_password',
      text: 'Choose a new password (at least 6 characters):',
      expectsInput: true,
      inputType: 'password',
      inputValidator: (input: string) => {
        if (input.length < 6) return { valid: false, error: 'password must be at least 6 characters' };
        return { valid: true };
      },
      onResponse: async (input: string, collectedData: Record<string, any>) => {
        return 'resetting_password';
      },
      previousMessageId: 'collect_email'
    },

    'resetting_password': {
      id: 'resetting_password',
      text: 'resetting your password...',
      expectsInput: false
    },

    'reset_complete': {
      id: 'reset_complete',
      text: 'Password reset! Signing you in...',
      expectsInput: false
    }
  }
};

// Export all flows
export const HOST_FLOWS: Record<string, HostFlow> = {
  'welcome': welcomeFlow,
  'verification': verificationFlow,
  'upgrade': upgradeFlow,
  'tutorial': tutorialFlow,
  'password_reset': passwordResetFlow
};
