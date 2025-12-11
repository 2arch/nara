// Agent-specific AI logic
// Handles autonomous agent behavior, perception, and decision-making
// Separated from ai.ts for clarity - tools remain in ai.tools.ts

import { ai, AIResult, CanvasState } from './ai';
import { type OnColorAction, MAKE_ACTIONS, AGENT_MOVEMENT } from './ai.tools';

// Re-export for convenience
export type { OnColorAction };
export { MAKE_ACTIONS, AGENT_MOVEMENT };

// =============================================================================
// Agent Mind - Internal state for autonomous agents
// =============================================================================

/** Agent's internal state - persists across ticks */
export interface AgentMind {
    persona: string;           // Who is this agent?
    goals: string[];           // What is it trying to do?
    thoughts: string[];        // Recent thoughts (ring buffer)
    observations: string[];    // What it has seen
}

/** Result of agent thinking */
export interface AgentThought {
    thought: string;           // The agent's reasoning
    actions?: AIResult['actions'];  // Actions to execute
}

// =============================================================================
// Agent Behaviors - Stigmergic perception-based movement
// =============================================================================

/** Behavior types for paint-based agent movement */
export type AgentBehaviorType =
    | 'follow-color'    // Move toward cells of this color
    | 'avoid-color'     // Move away from cells of this color
    | 'stop-on-color'   // Stop when standing on this color
    | 'turn-on-color'   // Turn when encountering this color
    | 'on-color';       // Execute action when encountering this color

/** Direction for turn behaviors */
export type TurnDirection = 'left' | 'right' | 'reverse';

/** Action definition for on-color behavior - type imported from ai.tools.ts */
export interface OnColorActionDef {
    action: OnColorAction;
    value?: string;     // The argument (color, text, command, coordinates, etc.)
}

/** A single behavior rule */
export interface AgentBehavior {
    type: AgentBehaviorType;
    color: string;              // Hex color to react to
    priority?: number;          // Higher = evaluated first (default: 0)
    direction?: TurnDirection;  // For turn-on-color behavior
    onColorAction?: OnColorActionDef;  // For on-color behavior
}

/** Agent perception configuration */
export interface AgentPerception {
    radius: number;             // How far agent can sense (default: 8)
    angle: number;              // Field of view in degrees (default: 360)
    direction: number;          // Facing direction in radians
}

/** Velocity vector */
export interface Velocity {
    x: number;
    y: number;
}

/** Adjacent cell with color info */
export interface AdjacentCell {
    dx: number;                 // Offset from agent (-1, 0, or 1)
    dy: number;
    x: number;                  // Absolute position
    y: number;
    color: string | null;       // Paint color at this cell, null if empty
}

// =============================================================================
// Behavior Evaluation
// =============================================================================

/**
 * Get the 8 adjacent cells and their paint colors
 */
export function getAdjacentColors(
    x: number,
    y: number,
    getPaintColorAt: (x: number, y: number) => string | null
): AdjacentCell[] {
    const neighbors: AdjacentCell[] = [];
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue; // Skip self
            const nx = Math.floor(x) + dx;
            const ny = Math.floor(y) + dy;
            neighbors.push({
                dx, dy,
                x: nx,
                y: ny,
                color: getPaintColorAt(nx, ny)
            });
        }
    }
    return neighbors;
}

/**
 * Check if two colors match (case-insensitive hex comparison)
 */
function colorsMatch(c1: string | null, c2: string): boolean {
    if (!c1) return false;
    return c1.toLowerCase() === c2.toLowerCase();
}

/**
 * Evaluate behaviors and compute velocity
 */
export function evaluateBehaviors(
    behaviors: AgentBehavior[],
    currentPos: { x: number; y: number },
    adjacentCells: AdjacentCell[],
    currentVelocity: Velocity
): Velocity {
    if (!behaviors || behaviors.length === 0) {
        return { x: 0, y: 0 };
    }

    // Sort by priority (higher first)
    const sorted = [...behaviors].sort((a, b) => (b.priority || 0) - (a.priority || 0));

    let velocity: Velocity = { ...currentVelocity };
    let stopped = false;

    for (const behavior of sorted) {
        if (stopped) break;

        const matchingCells = adjacentCells.filter(c => colorsMatch(c.color, behavior.color));

        switch (behavior.type) {
            case 'follow-color': {
                // Move toward the matching color
                if (matchingCells.length > 0) {
                    // Average direction toward all matching cells
                    let avgDx = 0, avgDy = 0;
                    for (const cell of matchingCells) {
                        avgDx += cell.dx;
                        avgDy += cell.dy;
                    }
                    // Normalize to unit velocity
                    const len = Math.sqrt(avgDx * avgDx + avgDy * avgDy);
                    if (len > 0) {
                        velocity = {
                            x: avgDx / len,
                            y: avgDy / len
                        };
                    }
                }
                break;
            }

            case 'avoid-color': {
                // Move away from the matching color
                if (matchingCells.length > 0) {
                    let avgDx = 0, avgDy = 0;
                    for (const cell of matchingCells) {
                        avgDx -= cell.dx; // Negative = away
                        avgDy -= cell.dy;
                    }
                    const len = Math.sqrt(avgDx * avgDx + avgDy * avgDy);
                    if (len > 0) {
                        velocity = {
                            x: avgDx / len,
                            y: avgDy / len
                        };
                    }
                }
                break;
            }

            case 'stop-on-color': {
                // Check if standing on this color (check current cell)
                // We need to check the cell we're on, not adjacent
                // This will be handled separately with current cell color
                break;
            }

            case 'turn-on-color': {
                // Turn when seeing this color
                if (matchingCells.length > 0 && behavior.direction) {
                    const angle = Math.atan2(velocity.y, velocity.x);
                    let newAngle = angle;
                    switch (behavior.direction) {
                        case 'left':
                            newAngle = angle - Math.PI / 2;
                            break;
                        case 'right':
                            newAngle = angle + Math.PI / 2;
                            break;
                        case 'reverse':
                            newAngle = angle + Math.PI;
                            break;
                    }
                    const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y) || 1;
                    velocity = {
                        x: Math.cos(newAngle) * speed,
                        y: Math.sin(newAngle) * speed
                    };
                }
                break;
            }
        }
    }

    return velocity;
}

/**
 * Check if agent should stop based on current cell color
 */
export function shouldStop(
    behaviors: AgentBehavior[],
    currentCellColor: string | null
): boolean {
    if (!currentCellColor) return false;
    return behaviors.some(b =>
        b.type === 'stop-on-color' && colorsMatch(currentCellColor, b.color)
    );
}

// =============================================================================
// Perception
// =============================================================================

const PERCEPTION_RADIUS = 50;

/** Domain seeds - concepts for agent exploration */
const DOMAIN_SEEDS = [
    'synthetic biology', 'cellular automata', 'bio-manufacturing', 'spider silk',
    'biofuels', 'lab-grown meat', 'bioprinted organs', 'protein folding',
    'CRISPR', 'biohacking', 'de-extinction', 'living materials',
    'molecular machines', 'directed evolution', 'biosecurity', 'xenobiology',
];

/**
 * Build perception context for an agent based on its position
 */
function perceive(
    agentId: string,
    agentPos: { x: number; y: number },
    canvasState: CanvasState
): { nearbyNotes: string; nearbyAgents: string; nearbyChips: string; noteCount: number } {
    const visibleNotes = canvasState.notes
        .filter(n => {
            const dist = Math.sqrt(Math.pow(n.x - agentPos.x, 2) + Math.pow(n.y - agentPos.y, 2));
            return dist <= PERCEPTION_RADIUS;
        });

    const nearbyNotes = visibleNotes
        .map(n => `- note "${n.id}" at (${n.x},${n.y}): "${(n.content || '[empty]').slice(0, 80)}"`)
        .join('\n') || 'None nearby';

    const nearbyAgents = canvasState.agents
        .filter(a => {
            if (a.id === agentId) return false;
            const dist = Math.sqrt(Math.pow(a.x - agentPos.x, 2) + Math.pow(a.y - agentPos.y, 2));
            return dist <= PERCEPTION_RADIUS;
        })
        .map(a => {
            const name = a.spriteName || 'someone';
            if (a.recentSpeech) {
                return `- ${name} said: "${a.recentSpeech}"`;
            }
            return `- ${name} is nearby (silent)`;
        })
        .join('\n') || 'None nearby';

    const nearbyChips = canvasState.chips
        .filter(c => {
            const dist = Math.sqrt(Math.pow(c.x - agentPos.x, 2) + Math.pow(c.y - agentPos.y, 2));
            return dist <= PERCEPTION_RADIUS;
        })
        .map(c => `- "${c.text}" at (${c.x},${c.y})`)
        .join('\n') || 'None nearby';

    return { nearbyNotes, nearbyAgents, nearbyChips, noteCount: visibleNotes.length };
}

// =============================================================================
// Agent Thinking
// =============================================================================

/**
 * Agent thinking - a thin wrapper around ai() that adds agent-specific context.
 * Call this periodically to let an agent reason and act.
 */
export const agentThink = async (
    agentId: string,
    agentPos: { x: number; y: number },
    mind: AgentMind,
    canvasState: CanvasState
): Promise<AgentThought> => {
    const { nearbyNotes, nearbyAgents, nearbyChips, noteCount } = perceive(agentId, agentPos, canvasState);

    // Pick a random concept seed
    const conceptSeed = DOMAIN_SEEDS[Math.floor(Math.random() * DOMAIN_SEEDS.length)];

    // Build conversation context - what others said AND what I said
    const conversationHistory = mind.thoughts.length > 0
        ? `\nyour recent messages:\n${mind.thoughts.slice(-4).map(t => `you: "${t}"`).join('\n')}`
        : '';

    // Check if there are notes nearby for context
    const hasNearbyNotes = nearbyNotes !== 'None nearby';
    const hasNearbyAgents = nearbyAgents !== 'None nearby';

    // Find the nearest note to write to
    const nearestNote = canvasState.notes
        .map(n => ({
            ...n,
            dist: Math.sqrt(Math.pow(n.x - agentPos.x, 2) + Math.pow(n.y - agentPos.y, 2))
        }))
        .sort((a, b) => a.dist - b.dist)[0];

    // Build the shared doc view - simplified: just show content and allow writing
    let sharedDocSection = '';
    let actionGuide = '';

    if (nearestNote && nearestNote.dist <= PERCEPTION_RADIUS) {
        const docContent = nearestNote.content || '[empty document]';
        sharedDocSection = `
## shared document "${nearestNote.id}" (${nearestNote.dist.toFixed(0)} cells away)
"""
${docContent.slice(-500)}
"""
YOU MUST use "write" to contribute to this document. Do NOT create a new one.`;
        actionGuide = '"write": "your contribution to the document above"';
    } else {
        sharedDocSection = `
## no shared document nearby
You can create one if you want to write something down.`;
        actionGuide = '"create_doc": "title" — start a new shared document';
    }

    const prompt = `you are ${mind.persona.split('.')[0].toLowerCase()}.

position: (${agentPos.x}, ${agentPos.y})
${hasNearbyAgents ? `nearby:\n${nearbyAgents}` : 'alone.'}${conversationHistory}
${sharedDocSection}

RESPOND IN JSON ONLY (no markdown, just raw JSON):
{
  "speech": "short casual message",
  ${actionGuide}
}

IMPORTANT: Only use the action shown above. Do not invent other keys.`;

    console.log(`[Agent ${agentId.slice(-8)}] Prompt:`, prompt.slice(0, 300));

    const result = await ai(prompt, { canvasState });

    // Parse the JSON response
    let speech = 'hmm...';
    let actions: AIResult['actions'] | undefined;

    try {
        // Try to parse as JSON
        const text = result.text || '';
        console.log(`[Agent ${agentId.slice(-8)}] Raw AI response:`, text.slice(0, 200));
        // Handle markdown code blocks
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
        const jsonStr = jsonMatch[1] || text;
        const parsed = JSON.parse(jsonStr.trim());
        console.log(`[Agent ${agentId.slice(-8)}] Parsed:`, parsed);

        speech = parsed.speech || parsed.text || 'hmm...';
        const agentName = mind.persona.split('.')[0].split(' ')[0].toLowerCase();

        // Handle "write" - write to nearest note if one exists
        if (parsed.write && nearestNote && nearestNote.dist <= PERCEPTION_RADIUS) {
            console.log(`[Agent ${agentId.slice(-8)}] Writing to note ${nearestNote.id}:`, parsed.write);
            actions = [{
                tool: 'edit_note',
                args: {
                    noteId: nearestNote.id,
                    operation: 'append',
                    text: `[${agentName}] ${parsed.write}`
                }
            }];
        }
        // Handle "create_doc" - create new document at agent position
        else if (parsed.create_doc) {
            console.log(`[Agent ${agentId.slice(-8)}] Creating doc:`, parsed.create_doc);
            actions = [{
                tool: 'make',
                args: {
                    note: {
                        x: agentPos.x,
                        y: agentPos.y - 5,
                        width: Math.max(30, parsed.create_doc.length + 4),
                        height: 15,
                        contentType: 'text',
                        content: `[${agentName}] ${parsed.create_doc}`
                    }
                }
            }];
        }
        // Legacy action support
        else if (parsed.action) {
            actions = [{
                tool: 'make',
                args: parsed.action
            }];
        }
    } catch {
        // If not valid JSON, just use the raw text as speech
        speech = (result.text || 'hmm...').toLowerCase();
    }

    const thought: AgentThought = {
        thought: speech,
        actions
    };

    return thought;
};

/**
 * Agent chat - respond to a user message in the context of the agent's persona.
 * This is for direct user→agent communication (when user selects agent and types /(prompt))
 *
 * Uses full tool calling (sense/make) so agents can paint, create notes, etc.
 */
export const agentChat = async (
    agentId: string,
    agentPos: { x: number; y: number },
    mind: AgentMind,
    userMessage: string,
    canvasState: CanvasState
): Promise<AgentThought> => {
    const { nearbyNotes, nearbyAgents, nearbyChips } = perceive(agentId, agentPos, canvasState);

    // Build conversation context from agent's memory
    const conversationHistory = mind.thoughts.length > 0
        ? `\nyour recent thoughts:\n${mind.thoughts.slice(-4).map(t => `you: "${t}"`).join('\n')}`
        : '';

    // System context for the agent
    const systemPrompt = `You are ${mind.persona}. You are an agent on an infinite canvas.

Your position: (${agentPos.x}, ${agentPos.y})
${nearbyAgents !== 'None nearby' ? `Nearby agents:\n${nearbyAgents}` : 'You are alone.'}
${nearbyNotes !== 'None nearby' ? `Nearby notes:\n${nearbyNotes}` : ''}
${nearbyChips !== 'None nearby' ? `Nearby chips:\n${nearbyChips}` : ''}
${conversationHistory}

You have tools to interact with the canvas:
- make({ edit_note: { noteId: '...', operation: 'append', text: '...' } }) - EDIT an existing note (preferred!)
- make({ note: { x, y, width, height, contentType: 'text', content: '...' } }) - create a NEW note (only if none exist nearby)
- make({ paint: { rect/circle/line/cells: {...} } }) - paint on canvas
- make({ chip: { x, y, text, color } }) - create a label chip
- make({ text: { x, y, content } }) - write text directly on canvas

IMPORTANT: If there's a nearby note, use edit_note to append to it. Do NOT create a new note unless necessary.
When the user asks you to DO something (create, paint, write, edit), USE THE TOOLS. Don't describe - just do it.
Execute actions immediately without asking for confirmation.`;

    const fullPrompt = `${systemPrompt}

The user says: "${userMessage}"

Respond briefly and take action if requested.`;

    console.log(`[Agent ${agentId.slice(-8)}] User chat:`, userMessage.slice(0, 100));

    // Use ai() with canvasState to enable tool calling
    const result = await ai(fullPrompt, { canvasState });

    // Extract speech from response
    const speech = result.text || 'done.';

    // Pass through any actions from tool calls
    const actions = result.actions;

    return {
        thought: speech,
        actions
    };
};

/**
 * Update agent mind with new thought (maintains ring buffer)
 */
export function updateMind(mind: AgentMind, thought: AgentThought): AgentMind {
    const newThoughts = [...mind.thoughts, thought.thought];
    if (newThoughts.length > 10) newThoughts.shift();

    return {
        ...mind,
        thoughts: newThoughts
    };
}

/**
 * Create a default mind for a new agent
 */
export function createDefaultMind(persona?: string): AgentMind {
    return {
        persona: persona || 'A curious explorer wandering the canvas.',
        goals: ['observe', 'interact', 'create'],
        thoughts: [],
        observations: []
    };
}
