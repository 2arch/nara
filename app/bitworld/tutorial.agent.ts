// Tutorial agent system - scripted agent actions for onboarding
import { Point } from './world.engine';

export type TutorialStep =
  | 'welcome'
  | 'background'
  | 'typing'
  | 'label'
  | 'selection'
  | 'ai'
  | 'navigation'
  | 'complete';

export interface TutorialAction {
  type: 'move' | 'type' | 'command' | 'select' | 'wait' | 'spawn';
  duration?: number;
  target?: Point;
  text?: string;
  command?: string;
  selection?: { start: Point; end: Point };
  spawnData?: any;
}

// Tutorial script - each step has a sequence of agent actions
export const TUTORIAL_SCRIPT: Record<TutorialStep, TutorialAction[]> = {
  'welcome': [
    { type: 'wait', duration: 1000 },
  ],

  'background': [
    { type: 'type', text: '/bg ocean blue' },
    { type: 'wait', duration: 1500 },
    { type: 'command', command: '/bg sunset' },
    { type: 'wait', duration: 1000 },
  ],

  'typing': [
    { type: 'move', target: { x: 0, y: 0 } },
    { type: 'type', text: 'Welcome to Nara!' },
    { type: 'wait', duration: 2000 },
  ],

  'label': [
    { type: 'move', target: { x: 20, y: -10 } },
    { type: 'spawn', spawnData: { type: 'label', text: 'my first label', color: '#F0FF6A' } },
    { type: 'wait', duration: 2000 },
  ],

  'selection': [
    { type: 'move', target: { x: 0, y: 5 } },
    { type: 'select', selection: { start: { x: 0, y: 5 }, end: { x: 20, y: 10 } } },
    { type: 'wait', duration: 2000 },
  ],

  'ai': [
    { type: 'type', text: '/write a haiku about spatial thinking' },
    { type: 'wait', duration: 1000 },
  ],

  'navigation': [
    { type: 'move', target: { x: 100, y: 100 } },
    { type: 'wait', duration: 1500 },
    { type: 'move', target: { x: 0, y: 0 } },
    { type: 'wait', duration: 1000 },
  ],

  'complete': [
    { type: 'type', text: 'You\'re ready to explore!' },
    { type: 'wait', duration: 2000 },
  ],
};

export interface TutorialAgentState {
  isActive: boolean;
  currentStep: TutorialStep;
  currentActionIndex: number;
  isPaused: boolean;
}

// Execute a tutorial action (called from world.engine.ts)
export async function executeTutorialAction(
  action: TutorialAction,
  callbacks: {
    moveAgent: (pos: Point) => void;
    typeText: (text: string, pos: Point) => void;
    executeCommand: (cmd: string) => void;
    setSelection: (start: Point, end: Point) => void;
    clearSelection: () => void;
    spawnContent: (data: any) => void;
  }
): Promise<void> {
  return new Promise((resolve) => {
    switch (action.type) {
      case 'move':
        if (action.target) {
          callbacks.moveAgent(action.target);
        }
        setTimeout(resolve, action.duration || 500);
        break;

      case 'type':
        if (action.text) {
          // Type character by character
          let charIndex = 0;
          const typeInterval = setInterval(() => {
            if (charIndex < action.text!.length) {
              // Callback handles ephemeral text rendering
              charIndex++;
            } else {
              clearInterval(typeInterval);
              setTimeout(resolve, action.duration || 1000);
            }
          }, 100);
        }
        break;

      case 'command':
        if (action.command) {
          callbacks.executeCommand(action.command);
        }
        setTimeout(resolve, action.duration || 500);
        break;

      case 'select':
        if (action.selection) {
          callbacks.setSelection(action.selection.start, action.selection.end);
        }
        setTimeout(resolve, action.duration || 1000);
        break;

      case 'spawn':
        if (action.spawnData) {
          callbacks.spawnContent(action.spawnData);
        }
        setTimeout(resolve, action.duration || 500);
        break;

      case 'wait':
        setTimeout(resolve, action.duration || 1000);
        break;

      default:
        resolve();
    }
  });
}

// Get next step in tutorial sequence
export function getNextTutorialStep(currentStep: TutorialStep): TutorialStep | null {
  const steps: TutorialStep[] = [
    'welcome',
    'background',
    'typing',
    'label',
    'selection',
    'ai',
    'navigation',
    'complete'
  ];

  const currentIndex = steps.indexOf(currentStep);
  if (currentIndex >= 0 && currentIndex < steps.length - 1) {
    return steps[currentIndex + 1];
  }

  return null;
}
