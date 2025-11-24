import { Point } from './world.engine';
import type { FrameData, ContentChange } from './recorder';

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

    constructor(onStateChange?: (state: AgentVisualState) => void) {
        this.onStateChange = onStateChange;
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
