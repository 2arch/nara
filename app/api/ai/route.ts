import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Content, FunctionCall } from '@google/genai';
import { tools } from '@/app/bitworld/ai.tools';
import { checkUserQuota, incrementUserUsage } from '@/app/firebase';

// Lazy client initialization
let genaiClient: GoogleGenAI | null = null;

// =============================================================================
// CONVERSATION HISTORY MANAGEMENT
// =============================================================================

interface ConversationEntry {
    history: Content[];
    lastAccess: number;
}

// In-memory conversation history per user (userId -> history)
const conversationStore = new Map<string, ConversationEntry>();

// Configuration
const MAX_HISTORY_TURNS = 10; // Keep last N exchanges (user + model pairs)
const HISTORY_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Get or create conversation history for user
function getConversationHistory(userId: string): Content[] {
    const entry = conversationStore.get(userId);
    if (entry) {
        entry.lastAccess = Date.now();
        return entry.history;
    }
    return [];
}

// Add messages to conversation history
function addToHistory(userId: string, userMessage: Content, modelResponse: Content) {
    let entry = conversationStore.get(userId);
    if (!entry) {
        entry = { history: [], lastAccess: Date.now() };
        conversationStore.set(userId, entry);
    }

    entry.history.push(userMessage, modelResponse);
    entry.lastAccess = Date.now();

    // Trim to max turns (each turn = 2 messages: user + model)
    while (entry.history.length > MAX_HISTORY_TURNS * 2) {
        entry.history.shift();
        entry.history.shift();
    }
}

// Clear conversation history for user
function clearHistory(userId: string) {
    conversationStore.delete(userId);
}

// Cleanup old conversations periodically
setInterval(() => {
    const now = Date.now();
    for (const [userId, entry] of conversationStore.entries()) {
        if (now - entry.lastAccess > HISTORY_TTL_MS) {
            conversationStore.delete(userId);
        }
    }
}, 5 * 60 * 1000); // Check every 5 minutes

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
- generate_image({ prompt }) - For creating visual content with AI image generation

IMPORTANT: When user asks to "generate", "create", "draw", or "make" an image, picture, or visual content, IMMEDIATELY use generate_image() tool. Do NOT ask for clarification - just generate it. The cursor position will be used automatically.

EXAMPLES:
- "generate an image of a cat" → generate_image({ prompt: "a cat" })
- "create a picture of a sunset" → generate_image({ prompt: "a beautiful sunset" })
- "draw a dragon" → generate_image({ prompt: "a dragon" })
- "move the agent to the right" → sense({ find: 'agents' }) then make({ agent: { target: { all: true }, move: { to: { x: 100, y: 50 } } } })
- "paint a red circle" → make({ paint: { circle: { x: 50, y: 50, radius: 10, color: '#ff0000' } } })
- "what agents are there?" → sense({ find: 'agents' }) then respond_text with the info

Be precise with coordinates and colors. Use hex colors (e.g., #ff0000 for red).
The canvas uses integer cell coordinates. Positive X is right, positive Y is down.`;

const MAX_ITERATIONS = 10;

interface SelectedNote {
    key: string;
    contentType: 'text' | 'image' | 'data' | 'script';
    bounds: { startX: number; startY: number; endX: number; endY: number };
    textContent?: string;
    imageData?: string;
    tableData?: {
        columns: Array<{ width: number; header?: string }>;
        rows: Array<{ height: number }>;
        cells: Record<string, string>;
    };
}

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
    clearHistory?: boolean; // Clear conversation history before this request
    forceImage?: boolean; // Skip Gemini tool selection and directly generate image
    selectedNote?: SelectedNote; // Note to edit in-place
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

// Server-side image intent detection (mirrors ai.utils.ts)
// NOTE: These patterns should only match explicit image generation requests.
// Do NOT match generic "write", "create", "draw" - only when combined with image/picture/etc.
const IMAGE_PATTERNS = [
    /^generate\s+(an?\s+)?(image|picture|photo|illustration|drawing|art)/i,
    /^create\s+(an?\s+)?(image|picture|photo|illustration|drawing|art)/i,
    /^draw\s+(me\s+)?(an?\s+)?(image|picture|photo|illustration|art)/i,
    /^make\s+(me\s+)?(an?\s+)?(image|picture|photo|illustration|drawing|art)/i,
    /^paint\s+(me\s+)?(an?\s+)?(image|picture|photo|illustration|drawing|art)/i,
    /\b(generate|create|make)\s+(me\s+)?(an?\s+)?(image|picture|photo)\b/i,
];

function detectImageIntent(input: string): boolean {
    const text = input.toLowerCase();
    return IMAGE_PATTERNS.some(pattern => pattern.test(text));
}

export async function POST(request: NextRequest) {
    try {
        const body: AIRequest = await request.json();
        const { prompt, userId, selection, worldContext, referenceImage, canvasState, clearHistory: shouldClearHistory, selectedNote } = body;

        if (!prompt) {
            return NextResponse.json({ error: 'prompt required' }, { status: 400 });
        }

        // Handle note editing - route based on contentType
        if (selectedNote) {
            const { key, contentType, textContent, imageData, tableData } = selectedNote;

            if (contentType === 'image' && imageData) {
                // Image note editing
                const { generateImage } = await import('@/app/bitworld/ai');
                const imageResult = await generateImage(prompt, imageData, userId);

                if (userId) {
                    await incrementUserUsage(userId);
                }

                return NextResponse.json({
                    noteUpdate: {
                        key,
                        contentType: 'image',
                        imageData: imageResult.imageData
                    },
                    text: imageResult.text || undefined,
                    image: imageResult
                });
            } else if ((contentType === 'text' || contentType === 'script') && textContent !== undefined) {
                // Text/script note editing
                const { editTextContent } = await import('@/app/bitworld/ai');
                const result = await editTextContent(prompt, textContent, userId);

                return NextResponse.json({
                    noteUpdate: {
                        key,
                        contentType,
                        textContent: result.textContent
                    },
                    text: result.message
                });
            } else if (contentType === 'data' && tableData) {
                // Table/data note editing
                const { editTableContent } = await import('@/app/bitworld/ai');
                const result = await editTableContent(prompt, tableData, userId);

                return NextResponse.json({
                    noteUpdate: {
                        key,
                        contentType: 'data',
                        tableData: result.tableData
                    },
                    text: result.message
                });
            }
        }

        // Detect image intent - if detected, bypass Gemini and generate directly
        const hasImageIntent = referenceImage || detectImageIntent(prompt);

        if (hasImageIntent) {
            // Direct image generation - skip Gemini tool selection
            const { generateImage } = await import('@/app/bitworld/ai');
            const imageResult = await generateImage(prompt, referenceImage, userId);

            if (userId) {
                await incrementUserUsage(userId);
            }

            return NextResponse.json({
                image: imageResult,
                text: imageResult.text || undefined,
            });
        }

        // Clear history if requested
        if (shouldClearHistory && userId) {
            clearHistory(userId);
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

        // Build the user message with context (only include dynamic context, not full state)
        let userMessageText = prompt;
        if (selection) {
            userMessageText += `\n\nSelected text:\n"${selection}"`;
        }
        // Only include compact canvas context (cursor + counts, not full lists)
        if (canvasState) {
            const contextSummary = [
                `Cursor: (${canvasState.cursorPosition.x}, ${canvasState.cursorPosition.y})`,
                `Agents: ${canvasState.agents.length}`,
                `Notes: ${canvasState.notes.length}`,
                `Chips: ${canvasState.chips.length}`,
            ];
            if (canvasState.selection.start && canvasState.selection.end) {
                contextSummary.push(`Selection: (${canvasState.selection.start.x},${canvasState.selection.start.y}) to (${canvasState.selection.end.x},${canvasState.selection.end.y})`);
            }
            userMessageText += `\n\n[Canvas: ${contextSummary.join(', ')}]`;
        }
        if (referenceImage) {
            userMessageText += `\n\n[Reference image provided for editing]`;
        }

        // Create the user message content
        const userMessage: Content = { role: 'user', parts: [{ text: userMessageText }] };

        // Collect make() actions to return to client
        const collectedActions: Array<{ tool: string; args: Record<string, any> }> = [];

        // Build history: previous conversation + current message
        const previousHistory = userId ? getConversationHistory(userId) : [];
        const history: Content[] = [...previousHistory, userMessage];

        let textResponse = '';
        let imageRequest: { prompt: string; editExisting?: boolean; x?: number; y?: number; width?: number; height?: number } | null = null;
        let iterations = 0;

        while (iterations < MAX_ITERATIONS) {
            iterations++;

            const response = await getClient().models.generateContent({
                model: 'gemini-3-flash-preview',
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
                    // Deep validation of make operations
                    const validateMake = (makeArgs: Record<string, any>): string | null => {
                        // Check paint has actual sub-operation
                        if (makeArgs.paint) {
                            const p = makeArgs.paint;
                            if (!p.cells && !p.rect && !p.circle && !p.line && !p.erase) {
                                return 'paint requires: cells, rect, circle, line, or erase';
                            }
                        }
                        // Check note has required fields
                        if (makeArgs.note) {
                            if (makeArgs.note.x === undefined || makeArgs.note.y === undefined) {
                                return 'note requires x and y position';
                            }
                        }
                        // Check text has required fields
                        if (makeArgs.text) {
                            if (!makeArgs.text.content) {
                                return 'text requires content';
                            }
                        }
                        // Check chip has required fields
                        if (makeArgs.chip) {
                            if (!makeArgs.chip.text) {
                                return 'chip requires text';
                            }
                        }
                        // Check agent has valid operation
                        if (makeArgs.agent) {
                            const a = makeArgs.agent;
                            // Must have either create OR (target + move/action)
                            if (a.create) {
                                // Create requires x and y
                                if (a.create.x === undefined || a.create.y === undefined) {
                                    return 'agent create requires x and y position';
                                }
                            } else if (a.target) {
                                // Target must be combined with move or action
                                if (!a.move && !a.action) {
                                    return 'agent target requires move or action';
                                }
                                // Target must have a selector
                                if (!a.target.id && !a.target.all && !a.target.near && !a.target.name) {
                                    return 'agent target requires id, all, near, or name';
                                }
                            } else if (a.move || a.action) {
                                // Has move/action but no target
                                return 'agent move/action requires target (id, all, near, or name)';
                            } else {
                                return 'agent requires create or (target + move/action)';
                            }
                        }
                        // Check delete has required fields
                        if (makeArgs.delete) {
                            if (!makeArgs.delete.type || !makeArgs.delete.id) {
                                return 'delete requires type and id';
                            }
                        }
                        // Check at least one operation is specified
                        if (!makeArgs.paint && !makeArgs.note && !makeArgs.text &&
                            !makeArgs.chip && !makeArgs.agent && !makeArgs.delete && !makeArgs.command) {
                            return 'make() requires at least one operation: paint, note, text, chip, agent, delete, or command';
                        }
                        return null; // Valid
                    };

                    // Log make calls for debugging (can be removed in production)
                    console.log('[AI] make() called with args:', JSON.stringify(args));

                    const validationError = validateMake(args);
                    if (validationError) {
                        console.error('[AI] Invalid make call:', validationError);
                        functionResponses.push({
                            functionResponse: { name, response: { success: false, error: validationError } }
                        });
                    } else {
                        console.log('[AI] make() validation passed, queuing action');
                        // Collect make actions to send to client
                        collectedActions.push({ tool: 'make', args });
                        functionResponses.push({
                            functionResponse: { name, response: { success: true, message: 'Action queued for execution' } }
                        });
                    }
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

        // Save to conversation history (only save user message + summarized model response)
        if (userId) {
            // Build a concise model response for history (not the full tool call chain)
            const modelSummary: string[] = [];
            if (textResponse) {
                modelSummary.push(textResponse);
            }
            if (collectedActions.length > 0) {
                const actionSummary = collectedActions.map(a => {
                    if (a.args.paint) return 'painted on canvas';
                    if (a.args.note) return 'created note';
                    if (a.args.chip) return 'created chip';
                    if (a.args.agent?.create) return 'created agent';
                    if (a.args.agent?.move) return 'moved agent(s)';
                    if (a.args.text) return 'wrote text';
                    if (a.args.delete) return 'deleted item';
                    if (a.args.command) return `ran ${a.args.command}`;
                    return 'performed action';
                }).join(', ');
                modelSummary.push(`[Actions: ${actionSummary}]`);
            }
            const modelResponse: Content = {
                role: 'model',
                parts: [{ text: modelSummary.join(' ') || 'Done.' }]
            };
            addToHistory(userId, userMessage, modelResponse);
        }

        // Build response - include image data if generated
        let imageResponse: { imageData: string | null; text: string } | undefined;

        // Check if we have an image in the actions
        for (const action of collectedActions) {
            if (action.args.note?.contentType === 'image' && action.args.note?.imageData?.src) {
                imageResponse = {
                    imageData: action.args.note.imageData.src,
                    text: textResponse || ''
                };
                break;
            }
        }

        return NextResponse.json({
            text: textResponse || undefined,
            actions: collectedActions.length > 0 ? collectedActions : undefined,
            image: imageResponse,
            error: undefined,
        });

    } catch (error) {
        console.error('AI API error:', error);
        return NextResponse.json({ error: 'AI request failed' }, { status: 500 });
    }
}
