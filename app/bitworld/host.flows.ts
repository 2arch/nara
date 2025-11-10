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

  // Monogram control
  monogramMode?: 'nara' | 'perlin' | 'clear' | 'geometry3d' | 'macintosh' | 'loading' | 'road' | 'terrain'; // Control monogram display
  backgroundColor?: string; // Override background color for this message
  backgroundMode?: 'color' | 'image' | 'video' | 'transparent'; // Background mode
  backgroundImage?: string; // Background image URL
}

export interface HostFlow {
  flowId: string;
  startMessageId: string;
  messages: Record<string, HostMessage>;
}

import { checkUsernameAvailability } from '../firebase';

// Intro flow - shows NARA banner before welcome flow
export const introFlow: HostFlow = {
  flowId: 'intro',
  startMessageId: 'nara_banner',
  messages: {
    'nara_banner': {
      id: 'nara_banner',
      text: '', // Empty text - just show the monogram
      expectsInput: false,
      monogramMode: 'nara',
      backgroundMode: 'image', // Show image from the start (not solid black)
      backgroundImage: 'https://d2w9rnfcy7mm78.cloudfront.net/40525619/original_8f6196d0fda2a540ef8e380980921d25.jpg?1761186290?bc=0',
      nextMessageId: 'transition_to_welcome'
    },
    'transition_to_welcome': {
      id: 'transition_to_welcome',
      text: '', // Silent transition
      expectsInput: false,
      monogramMode: 'perlin', // Perlin monogram over image background
      backgroundMode: 'image',
      backgroundImage: 'https://d2w9rnfcy7mm78.cloudfront.net/40525619/original_8f6196d0fda2a540ef8e380980921d25.jpg?1761186290?bc=0',
      // This will be handled by host.dialogue.ts to switch to welcome flow
    }
  }
};

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
      text: 'No worries! Your quota resets tomorrow. \n \n You can always upgrade later by typing /upgrade.',
      expectsInput: false
    }
  }
};

// Tutorial flow - interactive command learning with AI showcase
export const tutorialFlow: HostFlow = {
  flowId: 'tutorial',
  startMessageId: 'tutorial_welcome',
  messages: {
    // === INTRO ===
    'tutorial_welcome': {
      id: 'tutorial_welcome',
      text: 'Welcome to Nara! \n \n The infinite canvas for spatial thinking.',
      expectsInput: false,
      requiresChatMode: false,
      nextMessageId: 'learn_background'
    },

    // === BASIC STYLING ===
    'learn_background': {
      id: 'learn_background',
      text: 'Let\'s personalize your space. \n \n Type: /bg chalk',
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
      text: 'Perfect! You changed the background to chalk blue. \n \n Next, let\'s style your text.',
      expectsInput: false,
      requiresChatMode: false,
      nextMessageId: 'learn_color',
      previousMessageId: 'learn_background'
    },

    'learn_color': {
      id: 'learn_color',
      text: 'Change your text color. \n \n Type: /text garden',
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
      text: 'Great! Your text is now garden green.',
      expectsInput: false,
      requiresChatMode: false,
      nextMessageId: 'learn_label',
      previousMessageId: 'learn_color'
    },

    // === SPATIAL ORGANIZATION ===
    'learn_label': {
      id: 'learn_label',
      text: 'Labels help you mark important points. \n \n Type: /label my first idea',
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
      text: 'Excellent! Labels appear as arrows in space. \n \n Now for the fun part...',
      expectsInput: false,
      requiresChatMode: false,
      nextMessageId: 'introduce_ai',
      previousMessageId: 'learn_label'
    },

    // === AI INTRODUCTION ===
    'introduce_ai': {
      id: 'introduce_ai',
      text: 'Nara has AI built in. \n \n You can generate text, transform ideas, and even create images.',
      expectsInput: false,
      requiresChatMode: false,
      nextMessageId: 'learn_chat',
      previousMessageId: 'label_success'
    },

    'learn_chat': {
      id: 'learn_chat',
      text: 'Let\'s enter chat mode to talk with AI. \n \n Type: /chat',
      expectsInput: true,
      requiresChatMode: false,
      expectedCommand: 'chat',
      commandValidator: (cmd) => cmd === 'chat',
      nextMessageId: 'chat_activated',
      previousMessageId: 'introduce_ai'
    },

    'chat_activated': {
      id: 'chat_activated',
      text: 'You\'re in chat mode! The blue cursor shows you\'re talking to AI.',
      expectsInput: false,
      requiresChatMode: true,
      nextMessageId: 'explain_image_generation',
      previousMessageId: 'learn_chat'
    },

    'explain_image_generation': {
      id: 'explain_image_generation',
      text: 'Here\'s something cool: AI can generate images. \n \n Just describe what you want to see.',
      expectsInput: false,
      requiresChatMode: true,
      nextMessageId: 'prompt_for_image',
      previousMessageId: 'chat_activated'
    },

    'prompt_for_image': {
      id: 'prompt_for_image',
      text: 'Try it! Type something like: \n \n "draw a sunset over mountains"',
      expectsInput: false,
      requiresChatMode: true,
      nextMessageId: 'image_wait',
      previousMessageId: 'explain_image_generation'
    },

    'image_wait': {
      id: 'image_wait',
      text: 'Watch as AI creates your image! \n \n (Press ESC to exit chat mode when you see the image)',
      expectsInput: false,
      requiresChatMode: false,
      nextMessageId: 'image_complete',
      previousMessageId: 'prompt_for_image'
    },

    'image_complete': {
      id: 'image_complete',
      text: 'Pretty cool, right? Images, text, ideas - all in one infinite space.',
      expectsInput: false,
      requiresChatMode: false,
      nextMessageId: 'learn_state',
      previousMessageId: 'image_wait'
    },

    // === STATE MANAGEMENT ===
    'learn_state': {
      id: 'learn_state',
      text: 'Save your work with states. \n \n Type: /state save tutorial',
      expectsInput: true,
      requiresChatMode: false,
      expectedCommand: 'state',
      commandValidator: (cmd, args) => {
        return cmd === 'state' && args.length >= 2 && args[0] === 'save';
      },
      nextMessageId: 'state_saved',
      previousMessageId: 'image_complete'
    },

    'state_saved': {
      id: 'state_saved',
      text: 'Saved! You can load it anytime with /state load tutorial',
      expectsInput: false,
      requiresChatMode: false,
      nextMessageId: 'tutorial_almost_done',
      previousMessageId: 'learn_state'
    },

    // === CALL TO ACTION ===
    'tutorial_almost_done': {
      id: 'tutorial_almost_done',
      text: 'You\'ve learned the basics! \n \n But there\'s so much more...',
      expectsInput: false,
      requiresChatMode: false,
      nextMessageId: 'showcase_features',
      previousMessageId: 'state_saved'
    },

    'showcase_features': {
      id: 'showcase_features',
      text: 'With Nara, you can: \n \n → Transform text with AI \n → Upload and edit images \n → Create spatial links \n → Generate patterns and structures',
      expectsInput: false,
      requiresChatMode: false,
      nextMessageId: 'mention_limits',
      previousMessageId: 'tutorial_almost_done'
    },

    'mention_limits': {
      id: 'mention_limits',
      text: 'On the free tier, you get 5 AI interactions per day. \n \n Perfect for exploring what\'s possible.',
      expectsInput: false,
      requiresChatMode: false,
      nextMessageId: 'introduce_pro',
      previousMessageId: 'showcase_features'
    },

    'introduce_pro': {
      id: 'introduce_pro',
      text: 'Want unlimited AI? Nara Pro gives you: \n \n → Unlimited image generation \n → Unlimited text transformation \n → Priority support',
      expectsInput: false,
      requiresChatMode: false,
      nextMessageId: 'cta_upgrade',
      previousMessageId: 'mention_limits'
    },

    'cta_upgrade': {
      id: 'cta_upgrade',
      text: 'Ready to unlock unlimited creativity? \n \n Type /upgrade now to see Pro pricing!',
      expectsInput: false,
      requiresChatMode: false,
      nextMessageId: 'tutorial_complete',
      previousMessageId: 'introduce_pro'
    },

    'tutorial_complete': {
      id: 'tutorial_complete',
      text: 'Happy creating! Type /help anytime to see all commands. \n \n Your infinite canvas awaits.',
      expectsInput: false,
      requiresChatMode: false,
      previousMessageId: 'cta_upgrade'
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
  'intro': introFlow,
  'welcome': welcomeFlow,
  'verification': verificationFlow,
  'upgrade': upgradeFlow,
  'tutorial': tutorialFlow,
  'password_reset': passwordResetFlow
};
