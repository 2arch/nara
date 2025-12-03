import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Content, FunctionCall } from '@google/genai';
import { tools } from '@/app/bitworld/ai.tools';
import { checkUserQuota, incrementUserUsage } from '@/app/firebase';

// Lazy client initialization
let genaiClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
    if (!genaiClient) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY not set');
        genaiClient = new GoogleGenAI({ apiKey });
    }
    return genaiClient;
}

// Get tool declarations (sense + make)
const canvasToolDeclarations = tools.map(t => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.parameters,
}));

// Add response tools - so AI can explicitly choose response type
const responseTools = [
    {
        name: 'respond_text',
        description: 'Respond with text to the user. Use this for answering questions, explanations, or any text-based response.',
        parametersJsonSchema: {
            type: 'object' as const,
            properties: {
                text: { type: 'string', description: 'The text response to show the user' }
            },
            required: ['text']
        }
    },
    {
        name: 'generate_image',
        description: 'Generate or edit an image. Use this when the user wants to create visual content that will be placed in a note.',
        parametersJsonSchema: {
            type: 'object' as const,
            properties: {
                prompt: { type: 'string', description: 'Description of the image to generate' },
                editExisting: { type: 'boolean', description: 'Whether to edit the existing reference image' },
                x: { type: 'number', description: 'X position for the image note' },
                y: { type: 'number', description: 'Y position for the image note' },
                width: { type: 'number', description: 'Width of the image note in cells' },
                height: { type: 'number', description: 'Height of the image note in cells' }
            },
            required: ['prompt']
        }
    }
];

const allTools = [...canvasToolDeclarations, ...responseTools];

// System instruction - updated for sense/make paradigm
const SYSTEM_INSTRUCTION = `You are an AI assistant integrated into Nara, an infinite canvas application.

You have two primary canvas tools:
- sense({ find, region?, near?, id? }) - Query the canvas to discover what exists
- make({ paint?, note?, text?, chip?, agent?, delete?, command? }) - Create or modify things

And two response tools:
- respond_text({ text }) - For answering questions or explanations
- generate_image({ prompt, x?, y?, width?, height? }) - For creating visual content

WORKFLOW:
1. Use sense() first to discover what's on the canvas (agents, notes, positions)
2. Use make() to create or modify based on what you discovered
3. Use respond_text() for conversational responses
4. Use generate_image() when user wants visual content created

EXAMPLES:
- "move the agent to the right" → sense({ find: 'agents' }) then make({ agent: { target: { all: true }, move: { to: { x: 100, y: 50 } } } })
- "paint a red circle" → make({ paint: { circle: { x: 50, y: 50, radius: 10, color: '#ff0000' } } })
- "create a note here" → make({ note: { x: 10, y: 10, width: 20, height: 10, contentType: 'text' } })
- "what agents are there?" → sense({ find: 'agents' }) then respond_text with the info

Be precise with coordinates and colors. Use hex colors (e.g., #ff0000 for red).
The canvas uses integer cell coordinates. Positive X is right, positive Y is down.`;

const MAX_ITERATIONS = 10;

interface AIRequest {
    prompt: string;
    userId?: string;
    selection?: string;
    worldContext?: {
        compiledText: string;
        labels: Array<{ text: string; x: number; y: number }>;
        metadata?: string;
    };
    referenceImage?: string;
    aspectRatio?: string;
    canvasState?: {
        cursorPosition: { x: number; y: number };
        viewport: { offset: { x: number; y: number }; zoomLevel: number };
        selection: { start: { x: number; y: number } | null; end: { x: number; y: number } | null };
        agents: Array<{ id: string; x: number; y: number; spriteName?: string }>;
        notes: Array<{ id: string; x: number; y: number; width: number; height: number; contentType?: string; content?: string }>;
        chips: Array<{ id: string; x: number; y: number; text: string; color?: string }>;
    };
}

// Handle sense() calls by returning data from canvasState
function handleSense(args: Record<string, any>, canvasState: AIRequest['canvasState']) {
    const { find, region, near, id } = args;
    const state = canvasState || {
        cursorPosition: { x: 0, y: 0 },
        viewport: { offset: { x: 0, y: 0 }, zoomLevel: 1 },
        selection: { start: null, end: null },
        agents: [],
        notes: [],
        chips: [],
    };

    // Helper to filter by region/near
    const filterByLocation = <T extends { x: number; y: number }>(entities: T[]): T[] => {
        let result = entities;
        if (region) {
            result = result.filter(e =>
                e.x >= region.x && e.x < region.x + region.width &&
                e.y >= region.y && e.y < region.y + region.height
            );
        }
        if (near) {
            const radius = near.radius || 10;
            result = result.filter(e => {
                const dist = Math.sqrt(Math.pow(e.x - near.x, 2) + Math.pow(e.y - near.y, 2));
                return dist <= radius;
            });
        }
        return result;
    };

    switch (find) {
        case 'viewport':
            return { success: true, result: state.viewport };
        case 'cursor':
            return { success: true, result: state.cursorPosition };
        case 'selection':
            return { success: true, result: state.selection };
        case 'agents': {
            let agents = state.agents;
            if (id) agents = agents.filter(a => a.id === id);
            else agents = filterByLocation(agents);
            return { success: true, result: agents };
        }
        case 'notes': {
            let notes = state.notes;
            if (id) notes = notes.filter(n => n.id === id);
            else notes = filterByLocation(notes);
            return { success: true, result: notes };
        }
        case 'chips': {
            let chips = state.chips;
            if (id) chips = chips.filter(c => c.id === id);
            else chips = filterByLocation(chips);
            return { success: true, result: chips };
        }
        case 'all':
            return {
                success: true,
                result: {
                    agents: filterByLocation(state.agents),
                    notes: filterByLocation(state.notes),
                    chips: filterByLocation(state.chips),
                    viewport: state.viewport,
                    cursor: state.cursorPosition,
                    selection: state.selection
                }
            };
        default:
            return { success: false, error: `Unknown find type: ${find}` };
    }
}

export async function POST(request: NextRequest) {
    try {
        const body: AIRequest = await request.json();
        const { prompt, userId, selection, worldContext, referenceImage, canvasState } = body;

        if (!prompt) {
            return NextResponse.json({ error: 'prompt required' }, { status: 400 });
        }

        // Check quota
        if (userId) {
            const quota = await checkUserQuota(userId);
            if (!quota.canUseAI) {
                return NextResponse.json({
                    error: `AI limit reached (${quota.dailyUsed}/${quota.dailyLimit} today)`
                });
            }
        }

        // Build the full prompt with context
        let fullPrompt = prompt;
        if (selection) {
            fullPrompt += `\n\nSelected text:\n"${selection}"`;
        }
        if (worldContext) {
            fullPrompt += `\n\nCanvas context:\n${worldContext.compiledText}`;
            if (worldContext.metadata) {
                fullPrompt += `\n${worldContext.metadata}`;
            }
        }
        if (canvasState) {
            fullPrompt += `\n\nCursor position: (${canvasState.cursorPosition.x}, ${canvasState.cursorPosition.y})`;
            if (canvasState.selection.start && canvasState.selection.end) {
                fullPrompt += `\nSelection: (${canvasState.selection.start.x}, ${canvasState.selection.start.y}) to (${canvasState.selection.end.x}, ${canvasState.selection.end.y})`;
            }
        }
        if (referenceImage) {
            fullPrompt += `\n\n[Reference image provided for editing]`;
        }

        // Collect make() actions to return to client
        const collectedActions: Array<{ tool: string; args: Record<string, any> }> = [];

        // Multi-turn tool calling loop
        const history: Content[] = [
            { role: 'user', parts: [{ text: fullPrompt }] }
        ];

        let textResponse = '';
        let imageRequest: { prompt: string; editExisting?: boolean; x?: number; y?: number; width?: number; height?: number } | null = null;
        let iterations = 0;

        while (iterations < MAX_ITERATIONS) {
            iterations++;

            const response = await getClient().models.generateContent({
                model: 'gemini-2.0-flash',
                contents: history,
                config: {
                    systemInstruction: SYSTEM_INSTRUCTION,
                    tools: [{ functionDeclarations: allTools }],
                },
            });

            const candidate = response.candidates?.[0];
            if (!candidate?.content?.parts) {
                break;
            }

            const parts = candidate.content.parts;
            const functionCalls: FunctionCall[] = [];

            // Extract function calls and text
            for (const part of parts) {
                if (part.functionCall) {
                    functionCalls.push(part.functionCall);
                }
                if (part.text) {
                    textResponse += part.text;
                }
            }

            // No function calls - we're done
            if (functionCalls.length === 0) {
                break;
            }

            // Process function calls
            const functionResponses: Array<{ functionResponse: { name: string; response: any } }> = [];

            for (const fc of functionCalls) {
                const name = fc.name || 'unknown';
                const args = (fc.args as Record<string, any>) || {};

                if (name === 'respond_text') {
                    // AI chose to respond with text
                    textResponse = args.text || '';
                    functionResponses.push({
                        functionResponse: { name, response: { success: true } }
                    });
                } else if (name === 'generate_image') {
                    // AI chose to generate image - will become a make() action with image note
                    imageRequest = {
                        prompt: args.prompt,
                        editExisting: args.editExisting,
                        x: args.x,
                        y: args.y,
                        width: args.width,
                        height: args.height
                    };
                    functionResponses.push({
                        functionResponse: { name, response: { success: true, message: 'Image generation queued' } }
                    });
                } else if (name === 'sense') {
                    // Handle sense locally - return data from canvasState
                    const result = handleSense(args, canvasState);
                    functionResponses.push({
                        functionResponse: { name, response: result }
                    });
                } else if (name === 'make') {
                    // Collect make actions to send to client
                    collectedActions.push({ tool: 'make', args });
                    functionResponses.push({
                        functionResponse: { name, response: { success: true, message: 'Action queued for execution' } }
                    });
                } else {
                    // Unknown tool
                    functionResponses.push({
                        functionResponse: { name, response: { success: false, error: `Unknown tool: ${name}` } }
                    });
                }
            }

            // Add to history for next iteration
            history.push({ role: 'model', parts });
            history.push({ role: 'user', parts: functionResponses as any });

            // If we got a text response or image request, we can stop
            if (textResponse || imageRequest) {
                break;
            }
        }

        // Increment usage
        if (userId) {
            await incrementUserUsage(userId);
        }

        // Handle image generation if requested - convert to make() action with image note
        if (imageRequest) {
            const { generateImage } = await import('@/app/bitworld/ai');
            const imageResult = await generateImage(
                imageRequest.prompt,
                imageRequest.editExisting ? referenceImage : undefined,
                userId,
                body.aspectRatio
            );

            if (imageResult.imageData) {
                // Get dimensions from the generated image
                // For now, use provided dimensions or defaults
                const x = imageRequest.x ?? canvasState?.cursorPosition.x ?? 0;
                const y = imageRequest.y ?? canvasState?.cursorPosition.y ?? 0;
                const width = imageRequest.width ?? 30;
                const height = imageRequest.height ?? 20;

                // Convert to make() action with image note
                collectedActions.push({
                    tool: 'make',
                    args: {
                        note: {
                            x,
                            y,
                            width,
                            height,
                            contentType: 'image',
                            imageData: {
                                src: imageResult.imageData,
                                originalWidth: width * 10, // Approximate, will be replaced by actual dims
                                originalHeight: height * 10
                            }
                        }
                    }
                });

                // Add any text response from image generation
                if (imageResult.text && !textResponse) {
                    textResponse = imageResult.text;
                }
            } else if (imageResult.text) {
                // Image generation failed, return error text
                textResponse = imageResult.text;
            }
        }

        // Build response
        return NextResponse.json({
            text: textResponse || undefined,
            actions: collectedActions.length > 0 ? collectedActions : undefined,
            error: undefined,
        });

    } catch (error) {
        console.error('AI API error:', error);
        return NextResponse.json({ error: 'AI request failed' }, { status: 500 });
    }
}
