import { Point } from './world.engine';

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
