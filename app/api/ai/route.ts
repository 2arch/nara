import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Content, FunctionCall } from '@google/genai';
import { canvasTools, toGeminiFunctionDeclarations, ToolContext } from '@/app/bitworld/ai.tools';
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

// Get tool declarations
const toolDeclarations = toGeminiFunctionDeclarations();

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
        description: 'Generate or edit an image. Use this when the user wants to create visual content.',
        parametersJsonSchema: {
            type: 'object' as const,
            properties: {
                prompt: { type: 'string', description: 'Description of the image to generate' },
                editExisting: { type: 'boolean', description: 'Whether to edit the existing reference image' }
            },
            required: ['prompt']
        }
    }
];

const allTools = [...toolDeclarations, ...responseTools];

// System instruction
const SYSTEM_INSTRUCTION = `You are an AI assistant integrated into Nara, an infinite canvas application.
You have access to tools for:
- Canvas manipulation (paint, draw shapes, create notes/chips, move agents)
- Text responses (for questions, explanations, conversations)
- Image generation (for creating visual content)

Based on the user's prompt and context, choose the most appropriate action:
- For canvas actions like "paint", "draw", "create note", "move" → use canvas tools
- For questions, explanations, conversations → use respond_text
- For image creation requests → use generate_image

Be precise with coordinates and colors. Use hex colors (e.g., #ff0000 for red).
The canvas uses integer cell coordinates. Positive X is right, positive Y is down.
If the user provides selected text, consider whether they want you to transform, explain, or work with that text.`;

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
        notes: Array<{ id: string; x: number; y: number; width: number; height: number; content: string }>;
        chips: Array<{ id: string; x: number; y: number; text: string; color?: string }>;
    };
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
        }
        if (referenceImage) {
            fullPrompt += `\n\n[Reference image provided for editing]`;
        }

        // Build mock tool context for collecting actions
        const collectedActions: Array<{ tool: string; args: Record<string, any> }> = [];
        const state = {
            cursorPosition: canvasState?.cursorPosition || { x: 0, y: 0 },
            viewport: canvasState?.viewport || { offset: { x: 0, y: 0 }, zoomLevel: 1 },
            selection: canvasState?.selection || { start: null, end: null },
            agents: canvasState?.agents || [],
            notes: canvasState?.notes || [],
            chips: canvasState?.chips || [],
        };

        const toolContext: ToolContext = {
            paintCells: (cells) => collectedActions.push({ tool: 'paint_cells', args: { cells } }),
            eraseCells: (cells) => collectedActions.push({ tool: 'erase_cells', args: { cells } }),
            getCursorPosition: () => state.cursorPosition,
            setCursorPosition: (x, y) => {
                state.cursorPosition = { x, y };
                collectedActions.push({ tool: 'set_cursor_position', args: { x, y } });
            },
            getViewport: () => state.viewport,
            setViewport: (x, y, zoomLevel) => {
                state.viewport = { offset: { x, y }, zoomLevel: zoomLevel || state.viewport.zoomLevel };
                collectedActions.push({ tool: 'set_viewport', args: { x, y, zoomLevel } });
            },
            getSelection: () => state.selection,
            setSelection: (startX, startY, endX, endY) => {
                state.selection = { start: { x: startX, y: startY }, end: { x: endX, y: endY } };
                collectedActions.push({ tool: 'set_selection', args: { startX, startY, endX, endY } });
            },
            clearSelection: () => {
                state.selection = { start: null, end: null };
                collectedActions.push({ tool: 'clear_selection', args: {} });
            },
            getAgents: () => state.agents,
            createAgent: (x, y, spriteName) => {
                const agentId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                collectedActions.push({ tool: 'create_agent', args: { x, y, spriteName, agentId } });
                return agentId;
            },
            moveAgents: (agentIds, destination) => {
                collectedActions.push({ tool: 'move_agents', args: { agentIds, destination } });
            },
            moveAgentsPath: (agentIds, path) => {
                collectedActions.push({ tool: 'move_agents_path', args: { agentIds, path } });
            },
            moveAgentsExpr: (agentIds, xExpr, yExpr, vars, duration) => {
                collectedActions.push({ tool: 'move_agents_expr', args: { agentIds, xExpr, yExpr, vars, duration } });
            },
            stopAgentsExpr: (agentIds) => {
                collectedActions.push({ tool: 'stop_agents_expr', args: { agentIds } });
            },
            getNotes: () => state.notes,
            createNote: (x, y, width, height, content) => {
                collectedActions.push({ tool: 'create_note', args: { x, y, width, height, content } });
            },
            getChips: () => state.chips,
            createChip: (x, y, text, color) => {
                collectedActions.push({ tool: 'create_chip', args: { x, y, text, color } });
            },
            writeText: (x, y, text) => {
                collectedActions.push({ tool: 'write_text', args: { x, y, text } });
            },
            runCommand: (command) => {
                collectedActions.push({ tool: 'run_command', args: { command } });
            },
        };

        // Multi-turn tool calling loop
        const history: Content[] = [
            { role: 'user', parts: [{ text: fullPrompt }] }
        ];

        let textResponse = '';
        let imageRequest: { prompt: string; editExisting?: boolean } | null = null;
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
                    // AI chose to generate image
                    imageRequest = { prompt: args.prompt, editExisting: args.editExisting };
                    functionResponses.push({
                        functionResponse: { name, response: { success: true, message: 'Image generation queued' } }
                    });
                } else {
                    // Canvas tool - execute via toolContext
                    const { executeTool } = await import('@/app/bitworld/ai.tools');
                    const result = executeTool(name, args, toolContext);
                    functionResponses.push({
                        functionResponse: { name, response: result }
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

        // Handle image generation if requested
        let imageResult = null;
        if (imageRequest) {
            const { generateImage } = await import('@/app/bitworld/ai');
            imageResult = await generateImage(
                imageRequest.prompt,
                imageRequest.editExisting ? referenceImage : undefined,
                userId,
                body.aspectRatio
            );
        }

        // Build response
        return NextResponse.json({
            text: textResponse || undefined,
            actions: collectedActions.length > 0 ? collectedActions : undefined,
            image: imageResult || undefined,
            error: undefined,
        });

    } catch (error) {
        console.error('AI API error:', error);
        return NextResponse.json({ error: 'AI request failed' }, { status: 500 });
    }
}
