// Host flow definitions for conversational onboarding
import { checkUsernameAvailability, signUpUser, signInUser, getUsernameByUid } from '../firebase';

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

// Main welcome flow
export const welcomeFlow: HostFlow = {
  flowId: 'welcome',
  startMessageId: 'welcome',
  messages: {
    'welcome': {
      id: 'welcome',
      text: 'hi! welcome to nara \n\nwhat brings you here today?\n',
      expectsInput: true,
      inputType: 'choice',
      choices: ['explore', 'create', 'learn'],
      branchLogic: (input: string) => {
        const cleaned = input.toLowerCase().trim();
        if (cleaned === 'explore') return 'explore_intro';
        if (cleaned === 'create') return 'create_gate';
        if (cleaned === 'learn') return 'learn_intro';
        return 'welcome_retry';
      }
    },

    'welcome_retry': {
      id: 'welcome_retry',
      text: 'hmm, i didn\'t quite catch that.\n\ntry typing one of these:\n\n  explore\n  create\n  learn',
      expectsInput: true,
      inputType: 'choice',
      choices: ['explore', 'create', 'learn'],
      branchLogic: (input: string) => {
        const cleaned = input.toLowerCase().trim();
        if (cleaned === 'explore') return 'explore_intro';
        if (cleaned === 'create') return 'create_gate';
        if (cleaned === 'learn') return 'learn_intro';
        return 'welcome_retry';
      }
    },

    'explore_intro': {
      id: 'explore_intro',
      text: 'great! nara is an infinite canvas.\n\nyou can type anywhere, move with arrow keys, and click to place your cursor.\n\ntry clicking around—feel the space.\n\ntype "next" when you\'re ready',
      expectsInput: true,
      inputType: 'choice',
      choices: ['next'],
      branchLogic: (input: string) => {
        if (input.toLowerCase().trim() === 'next') return 'explore_monogram';
        return 'explore_intro';
      }
    },

    'explore_monogram': {
      id: 'explore_monogram',
      text: 'the patterns you see in the background?\n\nthose are called monograms—they respond to you.\n\nmove your cursor and watch them react.\n\ntype "next" to continue',
      expectsInput: true,
      inputType: 'choice',
      choices: ['next'],
      branchLogic: (input: string) => {
        if (input.toLowerCase().trim() === 'next') return 'explore_commands';
        return 'explore_monogram';
      }
    },

    'explore_commands': {
      id: 'explore_commands',
      text: 'you can control nara with commands.\n\ntry typing "/" to see what\'s available.\n\nwant to create something now?\n\n  yes\n  keep exploring',
      expectsInput: true,
      inputType: 'choice',
      choices: ['yes', 'keep exploring'],
      branchLogic: (input: string) => {
        const cleaned = input.toLowerCase().trim();
        if (cleaned === 'yes') return 'create_gate';
        return 'explore_free';
      }
    },

    'explore_free': {
      id: 'explore_free',
      text: 'cool! take your time.\n\nwhen you\'re ready to save your work, just type:\n\n  ready',
      expectsInput: true,
      inputType: 'choice',
      choices: ['ready'],
      branchLogic: (input: string) => {
        if (input.toLowerCase().trim() === 'ready') return 'create_gate';
        return 'explore_free';
      }
    },

    'learn_intro': {
      id: 'learn_intro',
      text: 'nara is a space for thinking.\n\nit\'s an infinite canvas where you can:\n  • write and organize ideas\n  • create visual layouts\n  • build knowledge spaces\n\nwant to try it out?\n\n  yes\n  tell me more',
      expectsInput: true,
      inputType: 'choice',
      choices: ['yes', 'tell me more'],
      branchLogic: (input: string) => {
        const cleaned = input.toLowerCase().trim();
        if (cleaned === 'yes') return 'create_gate';
        return 'learn_more';
      }
    },

    'learn_more': {
      id: 'learn_more',
      text: 'everything in nara is spatial.\n\ninstead of documents or folders, you place things where they make sense to you.\n\nthink of it like having an infinite whiteboard that remembers everything.\n\nready to start?\n\n  yes',
      expectsInput: true,
      inputType: 'choice',
      choices: ['yes'],
      branchLogic: (input: string) => {
        if (input.toLowerCase().trim() === 'yes') return 'create_gate';
        return 'learn_more';
      }
    },

    'create_gate': {
      id: 'create_gate',
      text: 'to save your work, you\'ll need an account.\n\nit only takes a moment.\n\nshall we set you up?\n\n  yes\n  maybe later',
      expectsInput: true,
      inputType: 'choice',
      choices: ['yes', 'maybe later'],
      branchLogic: (input: string) => {
        const cleaned = input.toLowerCase().trim();
        if (cleaned === 'yes') return 'signup_start';
        return 'create_gate_later';
      }
    },

    'create_gate_later': {
      id: 'create_gate_later',
      text: 'no problem! you can explore without an account.\n\njust remember—anything you create won\'t be saved.\n\nwhen you\'re ready, type:\n\n  ready',
      expectsInput: true,
      inputType: 'choice',
      choices: ['ready'],
      branchLogic: (input: string) => {
        if (input.toLowerCase().trim() === 'ready') return 'signup_start';
        return 'create_gate_later';
      }
    },

    'signup_start': {
      id: 'signup_start',
      text: 'perfect! let\'s get started.\n\nfirst—what\'s your first name?',
      expectsInput: true,
      inputType: 'text',
      inputValidator: (input: string) => {
        if (!input.trim()) return { valid: false, error: 'name can\'t be empty' };
        if (input.length < 2) return { valid: false, error: 'name seems a bit short' };
        return { valid: true };
      },
      nextMessageId: 'collect_lastname'
    },

    'collect_lastname': {
      id: 'collect_lastname',
      text: 'nice to meet you!\n\nand your last name?',
      expectsInput: true,
      inputType: 'text',
      inputValidator: (input: string) => {
        if (!input.trim()) return { valid: false, error: 'last name can\'t be empty' };
        return { valid: true };
      },
      nextMessageId: 'collect_email'
    },

    'collect_email': {
      id: 'collect_email',
      text: 'perfect.\n\nwhat email should i use for your account?',
      expectsInput: true,
      inputType: 'email',
      inputValidator: (input: string) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(input)) return { valid: false, error: 'that doesn\'t look like a valid email' };
        return { valid: true };
      },
      nextMessageId: 'collect_password'
    },

    'collect_password': {
      id: 'collect_password',
      text: 'got it.\n\nnow, create a password (at least 6 characters).\n\ngo ahead and type—i won\'t look.',
      expectsInput: true,
      inputType: 'password',
      inputValidator: (input: string) => {
        if (input.length < 6) return { valid: false, error: 'password needs at least 6 characters' };
        return { valid: true };
      },
      nextMessageId: 'collect_username'
    },

    'collect_username': {
      id: 'collect_username',
      text: 'nice and secure.\n\nlast thing: pick a username.\n\nthis is how others will find you.\n\n(lowercase letters and numbers only)',
      expectsInput: true,
      inputType: 'username',
      inputValidator: async (input: string) => {
        const usernameRegex = /^[a-z0-9]+$/;
        if (!usernameRegex.test(input)) return { valid: false, error: 'lowercase letters and numbers only' };
        if (input.length < 3) return { valid: false, error: 'username must be at least 3 characters' };

        // Check availability
        const available = await checkUsernameAvailability(input);
        if (!available) return { valid: false, error: 'that username\'s taken. try another?' };

        return { valid: true };
      },
      nextMessageId: 'creating_account'
    },

    'creating_account': {
      id: 'creating_account',
      text: 'alright, creating your account...',
      expectsInput: false,
      nextMessageId: 'account_created'
    },

    'account_created': {
      id: 'account_created',
      text: 'you\'re all set! welcome to nara.\n\nlet me show you around...',
      expectsInput: false
    }
  }
};

// Export all flows
export const HOST_FLOWS: Record<string, HostFlow> = {
  'welcome': welcomeFlow
};
