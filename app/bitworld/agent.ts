import { Point } from './world.engine';
import type { FrameData, ContentChange, Action } from './recorder';

// ============================================================================
// AGENT SYSTEM
// ============================================================================
// The agent is a visual cursor that can be controlled programmatically.
// It's separate from the user's cursor and used primarily for playback.
// The agent can be positioned, given a state, and can show selections.

export type AgentState = 'idle' | 'typing' | 'moving' | 'walking' | 'selecting';

export interface AgentVisualState {
    enabled: boolean;
    pos: Point;
    state: AgentState;
    selectionStart: Point | null;
    selectionEnd: Point | null;
}

// ============================================================================
// AGENT CONTROLLER
// ============================================================================
// Controls the agent during playback, translating recording frames into
// agent state and coordinating with the engine.

export class AgentController {
    private visualState: AgentVisualState = {
        enabled: false,
        pos: { x: 0, y: 0 },
        state: 'idle',
        selectionStart: null,
        selectionEnd: null,
    };

    private onStateChange?: (state: AgentVisualState) => void;
    private commandSystem?: {
        executeCommandString: (command: string) => void;
        startCommand: (pos: Point) => void;
        startCommandWithInput: (pos: Point, input: string) => void;
        addCharacter: (char: string) => void;
    };
    private executeCommandCallback?: () => Promise<any>;

    constructor(onStateChange?: (state: AgentVisualState) => void) {
        this.onStateChange = onStateChange;
    }

    // Set command system reference for executing commands during playback
    setCommandSystem(commandSystem: {
        executeCommandString: (command: string) => void;
        startCommand: (pos: Point) => void;
        startCommandWithInput: (pos: Point, input: string) => void;
        addCharacter: (char: string) => void;
    }, executeCommandCallback?: () => Promise<any>) {
        this.commandSystem = commandSystem;
        this.executeCommandCallback = executeCommandCallback;
    }

    // Enable/disable agent visibility
    setEnabled(enabled: boolean) {
        this.visualState.enabled = enabled;
        this.notifyStateChange();
    }

    // Update agent from a playback frame
    updateFromFrame(frame: FrameData) {
        // Update position
        this.visualState.pos = { ...frame.cursor };

        // Infer state from frame data (can be enhanced later)
        this.visualState.state = 'moving';

        this.notifyStateChange();
    }

    // Set agent state during content changes
    setTyping() {
        this.visualState.state = 'typing';
        this.notifyStateChange();
    }

    setIdle() {
        this.visualState.state = 'idle';
        this.notifyStateChange();
    }

    setSelecting() {
        this.visualState.state = 'selecting';
        this.notifyStateChange();
    }

    // Update agent selection
    setSelection(start: Point | null, end: Point | null) {
        this.visualState.selectionStart = start;
        this.visualState.selectionEnd = end;
        if (start && end) {
            this.visualState.state = 'selecting';
        }
        this.notifyStateChange();
    }

    // Process recorded actions during playback
    processAction(action: Action) {
        switch (action.type) {
            case 'selection_start':
                this.visualState.pos = action.data.pos;
                this.visualState.selectionStart = action.data.pos;
                this.visualState.selectionEnd = action.data.pos;
                this.visualState.state = 'selecting';
                break;

            case 'selection_update':
                this.visualState.pos = action.data.pos;
                this.visualState.selectionEnd = action.data.pos;
                break;

            case 'selection_end':
                this.visualState.selectionStart = action.data.start;
                this.visualState.selectionEnd = action.data.end;
                this.visualState.state = 'idle';
                break;

            case 'selection_clear':
                this.visualState.selectionStart = null;
                this.visualState.selectionEnd = null;
                this.visualState.state = 'idle';
                break;

            case 'command_start':
                // Legacy: no longer recorded, but handle for old recordings
                if (action.data.pos) {
                    this.visualState.pos = action.data.pos;
                }
                this.visualState.state = 'typing';
                break;

            case 'command_input':
                // Legacy: no longer recorded, but handle for old recordings
                this.visualState.state = 'typing';
                break;

            case 'command_enter':
                // Execute command via palette - this is the main command action for playback
                this.visualState.state = 'typing';
                if (this.commandSystem && action.data.command && action.data.pos) {
                    console.log('[Agent] Executing command via palette:', action.data.command);
                    this.visualState.pos = action.data.pos;
                    // Show palette with full command, then execute
                    this.commandSystem.startCommandWithInput(action.data.pos, action.data.command);
                    // Execute after small delay to allow UI to update
                    setTimeout(() => {
                        if (this.executeCommandCallback) {
                            this.executeCommandCallback();
                        }
                    }, 100);
                }
                break;

            case 'command_execute':
                // Direct command execution (keyboard shortcuts that bypass palette)
                this.visualState.state = 'typing';
                if (this.commandSystem && action.data.command) {
                    console.log('[Agent] Direct command execution:', action.data.command);
                    this.commandSystem.executeCommandString(action.data.command);
                }
                break;
        }

        this.notifyStateChange();
    }

    // Get current visual state
    getState(): AgentVisualState {
        return { ...this.visualState };
    }

    // Reset agent state
    reset() {
        this.visualState = {
            enabled: false,
            pos: { x: 0, y: 0 },
            state: 'idle',
            selectionStart: null,
            selectionEnd: null,
        };
        this.notifyStateChange();
    }

    private notifyStateChange() {
        if (this.onStateChange) {
            this.onStateChange(this.getState());
        }
    }
}
