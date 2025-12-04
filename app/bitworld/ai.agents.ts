// Agent-specific AI logic
// Handles autonomous agent behavior, perception, and decision-making
// Separated from ai.ts for clarity - tools remain in ai.tools.ts

import { ai, AIResult, CanvasState } from './ai';

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
