import { GoogleGenAI } from '@google/genai';
import { logger } from './logger';
import { checkUserQuota, incrementUserUsage } from '../firebase';

// Initialize the Google GenAI client
const ai = new GoogleGenAI({
    apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY
});

const DEFAULT_TEXT = '';

// Global abort controller for interrupting AI operations
let globalAbortController: AbortController | null = null;

// Global cache management
let currentCachedContent: string | null = null;
let cacheExpiration: number | null = null;

/**
 * Create a new abort controller for AI operations
 */
export function createAIAbortController(): AbortController {
    // Cancel any existing operation
    if (globalAbortController && !globalAbortController.signal.aborted) {
        globalAbortController.abort('New AI operation started');
    }
    
    globalAbortController = new AbortController();
    return globalAbortController;
}

/**
 * Abort the current AI operation
 */
export function abortCurrentAI(): boolean {
    if (globalAbortController && !globalAbortController.signal.aborted) {
        globalAbortController.abort('User interrupted');
        return true;
    }
    return false;
}

/**
 * Check if there's an active AI operation
 */
export function isAIActive(): boolean {
    return globalAbortController !== null && !globalAbortController.signal.aborted;
}

// Helper function to set dialogue text with automatic revert to default
export function setDialogueWithRevert(text: string, setDialogueText: (text: string) => void, timeout: number = 2500) {
    setDialogueText(text);
    setTimeout(() => {
        setDialogueText(DEFAULT_TEXT);
    }, timeout);
}

// Function to cycle through subtitle-style text
export function createSubtitleCycler(text: string, setDialogueText: (text: string) => void) {
    const MAX_SUBTITLE_LENGTH = 120; // Allow for 2 lines (~60 chars per line)
    
    if (text.length <= MAX_SUBTITLE_LENGTH) {
        setDialogueText(text);
        // Revert to default after 2.5 seconds for short messages
        setTimeout(() => {
            setDialogueText(DEFAULT_TEXT);
        }, 2500);
        return;
    }
    
    // Split text into subtitle-length chunks at word boundaries
    const words = text.split(' ');
    const chunks: string[] = [];
    let currentChunk = '';
    
    for (const word of words) {
        if (currentChunk.length + word.length + 1 <= MAX_SUBTITLE_LENGTH) {
            currentChunk += (currentChunk ? ' ' : '') + word;
        } else {
            if (currentChunk) chunks.push(currentChunk);
            currentChunk = word;
        }
    }
    if (currentChunk) chunks.push(currentChunk);
    
    // Cycle through chunks
    let chunkIndex = 0;
    const showNextChunk = () => {
        if (chunkIndex < chunks.length) {
            setDialogueText(chunks[chunkIndex]);
            chunkIndex++;
            setTimeout(showNextChunk, 2500); // Show each chunk for 2.5 seconds
        } else {
            // Revert to default after all chunks have been shown
            setTimeout(() => {
                setDialogueText(DEFAULT_TEXT);
            }, 2500); // Wait another 2.5 seconds before reverting
        }
    };
    
    showNextChunk();
}

/**
 * Transform text according to given instructions
 */
export async function transformText(text: string, instructions: string, userId?: string): Promise<string> {
    const abortController = createAIAbortController();
    
    try {
        // Check user quota before proceeding
        if (userId) {
            const quota = await checkUserQuota(userId);
            if (!quota.canUseAI) {
                return `AI limit reached (${quota.dailyUsed}/${quota.dailyLimit} today). Upgrade for more: /upgrade`;
            }
        }

        if (abortController.signal.aborted) {
            throw new Error('AI operation was interrupted');
        }

        const response = await Promise.race([
            ai.models.generateContent({
                model: 'gemini-2.5-flash-lite',
                contents: `Transform: "${instructions}"

Text: "${text}"

Output only the result.`,
                config: {
                    maxOutputTokens: 75,
                    temperature: 0.9,
                    systemInstruction: 'Transform text. Output result only. Be brutally concise.'
                }
            }),
            new Promise((_, reject) => {
                abortController.signal.addEventListener('abort', () => {
                    reject(new Error('AI operation was interrupted'));
                });
            })
        ]);

        return (response as any).text?.trim() || text;
    } catch (error) {
        if (error instanceof Error && error.message === 'AI operation was interrupted') {
            logger.debug('AI transform operation was interrupted by user');
            return '[Interrupted]';
        }
        logger.error('Error transforming text:', error);
        return `Could not transform text`;
    }
}

/**
 * Explain text according to given analysis type or general analysis
 */
export async function explainText(text: string, analysisType: string = 'analysis'): Promise<string> {
    const abortController = createAIAbortController();
    
    try {
        if (abortController.signal.aborted) {
            throw new Error('AI operation was interrupted');
        }

        const prompt = analysisType === 'analysis' 
            ? `What's the core insight here?

"${text}"`
            : `What's the ${analysisType} pattern here?

"${text}"`;

        const response = await Promise.race([
            ai.models.generateContent({
                model: 'gemini-2.5-flash-lite',
                contents: prompt,
                config: {
                    maxOutputTokens: 60,
                    temperature: 0.9,
                    systemInstruction: 'Get to the core insight. Be brutally concise. Maximum 2 sentences.'
                }
            }),
            new Promise((_, reject) => {
                abortController.signal.addEventListener('abort', () => {
                    reject(new Error('AI operation was interrupted'));
                });
            })
        ]);

        return (response as any).text?.trim() || `Could not analyze the text`;
    } catch (error) {
        if (error instanceof Error && error.message === 'AI operation was interrupted') {
            logger.debug('AI explain operation was interrupted by user');
            return '[Interrupted]';
        }
        logger.error('Error explaining text:', error);
        return `Could not explain text`;
    }
}

/**
 * Summarize the given text
 */
export async function summarizeText(text: string, focus?: string): Promise<string> {
    const abortController = createAIAbortController();
    
    try {
        if (abortController.signal.aborted) {
            throw new Error('AI operation was interrupted');
        }

        const prompt = focus 
            ? `What's the essence of "${focus}" here?

"${text}"`
            : `What's the essence here?

"${text}"`;

        const response = await Promise.race([
            ai.models.generateContent({
                model: 'gemini-2.5-flash-lite',
                contents: prompt,
                config: {
                    maxOutputTokens: 50,
                    temperature: 0.9,
                    systemInstruction: 'Distill to essence. Be brutally concise. Maximum 2 sentences.'
                }
            }),
            new Promise((_, reject) => {
                abortController.signal.addEventListener('abort', () => {
                    reject(new Error('AI operation was interrupted'));
                });
            })
        ]);

        return (response as any).text?.trim() || `Could not summarize the text`;
    } catch (error) {
        if (error instanceof Error && error.message === 'AI operation was interrupted') {
            logger.debug('AI summarize operation was interrupted by user');
            return '[Interrupted]';
        }
        logger.error('Error summarizing text:', error);
        return `Could not summarize text`;
    }
}

// Chat history interface
export interface ChatMessage {
    role: 'user' | 'model';
    content: string;
    timestamp: number;
}

// Chat session state
let chatHistory: ChatMessage[] = [];

// Context for ambient navigation
let currentWorldContext: {
    compiledText: string;
    labels: Array<{ text: string; x: number; y: number; }>;
    metadata?: string;
} | null = null;

/**
 * Update the world context for ambient navigation
 */
export function updateWorldContext(worldContext: {
    compiledText: string;
    labels: Array<{ text: string; x: number; y: number; }>;
    metadata?: string;
}): void {
    currentWorldContext = worldContext;
}

/**
 * Get the current world context
 */
export function getCurrentWorldContext() {
    return currentWorldContext;
}

/**
 * Chat with AI maintaining conversation history
 */
export async function chatWithAI(message: string, useCache: boolean = true): Promise<string> {
    const abortController = createAIAbortController();
    
    try {
        // Add user message to history
        chatHistory.push({
            role: 'user',
            content: message,
            timestamp: Date.now()
        });

        // Prepare conversation context
        const conversationContext = chatHistory
            .slice(-10) // Keep last 10 messages for context
            .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
            .join('\n');

        let response;
        
        // Check for abort before making requests
        if (abortController.signal.aborted) {
            throw new Error('AI operation was interrupted');
        }
        
        // Use world context cache if available and enabled
        if (useCache && currentWorldContext) {
            try {
                // Create or get cached content for world context
                const cachedContentName = await createWorldContextCache();
                
                if (cachedContentName) {
                    // Use cached content with user message
                    response = await Promise.race([
                        ai.models.generateContent({
                            model: 'gemini-2.5-flash-lite',
                            contents: message,
                            config: {
                                cachedContent: cachedContentName,
                                maxOutputTokens: 50,
                                temperature: 0.9,
                                systemInstruction: 'Be brutally concise. Maximum 2 sentences total.'
                            }
                        }),
                        new Promise((_, reject) => {
                            abortController.signal.addEventListener('abort', () => {
                                reject(new Error('AI operation was interrupted'));
                            });
                        })
                    ]);
                } else {
                    // Fallback to old method if caching fails
                    const contextContent = `Canvas context: ${currentWorldContext.compiledText}\nLabels: ${currentWorldContext.labels.map(l => l.text).join(', ')}\n\nUser: ${message}\n\nLead with a sharp question. Be brutally concise.`;
                    
                    response = await Promise.race([
                        ai.models.generateContent({
                            model: 'gemini-2.5-flash-lite',
                            contents: contextContent,
                            config: {
                                maxOutputTokens: 50,
                                temperature: 0.9,
                                systemInstruction: 'Be brutally concise. Maximum 2 sentences total.'
                            }
                        }),
                        new Promise((_, reject) => {
                            abortController.signal.addEventListener('abort', () => {
                                reject(new Error('AI operation was interrupted'));
                            });
                        })
                    ]);
                }
            } catch (error) {
                if (error instanceof Error && error.message === 'AI operation was interrupted') {
                    throw error;
                }
                logger.error('Error using world context cache, falling back:', error);
                // Fall back to non-cached request
                useCache = false;
            }
        }
        
        // If not using cache or cache failed
        if (!useCache || !response) {
            // Check for abort again
            if (abortController.signal.aborted) {
                throw new Error('AI operation was interrupted');
            }
            
            response = await Promise.race([
                ai.models.generateContent({
                    model: 'gemini-2.5-flash-lite',
                    contents: `Previous conversation:
${conversationContext}

User: ${message}

Be brutally concise. Maximum 2 sentences total.`,
                    config: {
                        maxOutputTokens: 75,
                        temperature: 0.9,
                        systemInstruction: 'Be brutally concise. Maximum 2 sentences total.'
                    }
                }),
                new Promise((_, reject) => {
                    abortController.signal.addEventListener('abort', () => {
                        reject(new Error('AI operation was interrupted'));
                    });
                })
            ]);
        }

        const aiResponse = (response as any).text?.trim() || 'I could not process that message.';

        // Add AI response to history
        chatHistory.push({
            role: 'model',
            content: aiResponse,
            timestamp: Date.now()
        });

        return aiResponse;
    } catch (error) {
        if (error instanceof Error && error.message === 'AI operation was interrupted') {
            logger.debug('AI chat operation was interrupted by user');
            return '[Interrupted]';
        }
        logger.error('Error in chat:', error);
        return 'Sorry, I encountered an error. Could you try again?';
    }
}

/**
 * Clear chat history
 */
export function clearChatHistory(): void {
    chatHistory = [];
}

/**
 * Clear world context
 */
export function clearWorldContext(): void {
    currentWorldContext = null;
}

/**
 * Create or update cached content for world context
 */
export async function createWorldContextCache(): Promise<string | null> {
    if (!currentWorldContext) {
        return null;
    }

    try {
        // Check if current cache is still valid
        if (currentCachedContent && cacheExpiration && Date.now() < cacheExpiration) {
            return currentCachedContent;
        }

        // Create comprehensive world context content
        const worldContextContent = [
            {
                role: 'user',
                parts: [
                    {
                        text: `Canvas World Context:

Compiled Text Content:
${currentWorldContext.compiledText}

Labels and Positions:
${currentWorldContext.labels.map(l => `- "${l.text}" at (${l.x}, ${l.y})`).join('\n')}

Metadata:
${currentWorldContext.metadata || 'No additional metadata'}

This context represents the current state of the canvas/world that the user is working with. Use this information to provide contextually relevant responses about the canvas content, spatial relationships, and connections between elements.`
                    }
                ]
            }
        ];

        // Create cached content with 1 hour TTL
        const cachedContent = await ai.caches.create({
            model: 'gemini-2.5-flash-lite',
            config: {
                contents: worldContextContent,
                systemInstruction: {
                    role: 'system',
                    parts: [{ text: 'You are a concise ambient navigator. Be brutally concise. No explanations.' }]
                },
                ttl: '3600s', // 1 hour cache
                displayName: 'World Context Cache'
            }
        });

        // Store cache reference and expiration
        currentCachedContent = cachedContent.name || null;
        cacheExpiration = Date.now() + (60 * 60 * 1000); // 1 hour from now

        return currentCachedContent;
    } catch (error) {
        logger.error('Error creating world context cache:', error);
        return null;
    }
}

/**
 * Clear cached content
 */
export async function clearWorldContextCache(): Promise<void> {
    if (currentCachedContent) {
        try {
            await ai.caches.delete({ name: currentCachedContent });
        } catch (error) {
            logger.error('Error deleting cache:', error);
        }
        currentCachedContent = null;
        cacheExpiration = null;
    }
}

/**
 * Get current chat history
 */
export function getChatHistory(): ChatMessage[] {
    return [...chatHistory];
}

/**
 * Generate an image from a text prompt using Google GenAI Imagen
 */
export async function generateImage(prompt: string): Promise<string | null> {
    try {
        const response = await ai.models.generateImages({
            model: 'imagen-3.0-generate-002',
            prompt: prompt,
            config: {
                numberOfImages: 1,
                includeRaiReason: true,
            }
        });

        // Get the first generated image
        const generatedImage = response.generatedImages?.[0];
        if (generatedImage?.image?.imageBytes) {
            // Convert base64 image bytes to data URL
            const mimeType = generatedImage.image.mimeType || 'image/png';
            const dataUrl = `data:${mimeType};base64,${generatedImage.image.imageBytes}`;
            return dataUrl;
        }

        logger.warn('No image data received from generation');
        return null;
    } catch (error) {
        logger.error('Error generating image:', error);
        return null;
    }
}

/**
 * Generate a video from a text prompt using Google GenAI Veo
 */
export async function generateVideo(prompt: string): Promise<string | null> {
    try {
        
        // Start the video generation operation
        let operation = await ai.models.generateVideos({
            model: 'veo-3.0-generate-preview',
            prompt: prompt,
        });


        // Poll the operation status until the video is ready
        let pollCount = 0;
        let maxPolls = 60; // Maximum 5 minutes of polling (60 * 5 seconds)
        
        while (!operation.done && pollCount < maxPolls) {
            pollCount++;
            await new Promise((resolve) => setTimeout(resolve, 5000)); // Poll every 5 seconds
            
            try {
                // The getVideosOperation expects an object with the operation
                operation = await ai.operations.getVideosOperation({
                    operation: operation
                });
            } catch (pollError) {
                logger.error(`Error polling operation (attempt ${pollCount}):`, pollError);
                // If the operation is not responding properly, we might have a stale operation
                // Continue with the existing operation object
            }
            
        }
        
        if (pollCount >= maxPolls) {
            logger.error('Video generation timed out after 5 minutes');
            return null;
        }


        // Get the generated video from the completed operation
        const generatedVideo = operation.response?.generatedVideos?.[0];
        
        // Check if we have video bytes directly
        if (generatedVideo?.video?.videoBytes) {
            // Convert base64 video bytes to data URL
            const mimeType = generatedVideo.video.mimeType || 'video/mp4';
            const dataUrl = `data:${mimeType};base64,${generatedVideo.video.videoBytes}`;
            return dataUrl;
        }
        
        // Check if we have a URI to download the video from
        if (generatedVideo?.video?.uri) {
            
            try {
                // Fetch the video from the URI
                const response = await fetch(generatedVideo.video.uri);
                if (!response.ok) {
                    logger.error('Failed to fetch video from URI:', response.status, response.statusText);
                    return null;
                }
                
                // Get the video as a blob
                const blob = await response.blob();
                
                // Convert blob to data URL
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const dataUrl = reader.result as string;
                        resolve(dataUrl);
                    };
                    reader.onerror = () => {
                        logger.error('Failed to convert video blob to data URL');
                        resolve(null);
                    };
                    reader.readAsDataURL(blob);
                });
            } catch (fetchError) {
                logger.error('Error fetching video from URI:', fetchError);
                // As a fallback, just return the URI directly
                return generatedVideo.video.uri;
            }
        }

        // Check for RAI (Responsible AI) filtering
        if (generatedVideo && 'raiReason' in generatedVideo) {
            logger.warn('Video generation blocked by RAI:', (generatedVideo as any).raiReason);
        }

        logger.warn('No video data received from generation. Full response structure:', JSON.stringify(operation, null, 2));
        return null;
    } catch (error) {
        logger.error('Error generating video:', error);
        // Log more details about the error
        if (error instanceof Error) {
            logger.error('Error details:', {
                message: error.message,
                stack: error.stack,
                name: error.name
            });
        }
        return null;
    }
}


/**
 * Generate a concise label for a text cluster using AI
 * @param clusterContent Full text content of the cluster
 * @returns Promise<string> Concise label or null if generation fails
 */
export async function generateClusterLabel(clusterContent: string): Promise<string | null> {
    try {
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents: `Create a very short, descriptive label (2-4 words max) for this text cluster:

"${clusterContent}"

The label should:
- Capture the main topic/theme
- Be concise and clear
- Work as a navigation waypoint
- Avoid generic words like "text" or "content"

Respond with ONLY the label, no explanation.`,
            config: {
                maxOutputTokens: 20,
                temperature: 0.3,
                systemInstruction: 'You create concise, descriptive labels for text clusters. Respond only with the label.'
            }
        });

        const label = response.text?.trim();
        
        // Validate the label is reasonably short and meaningful
        if (label && label.length >= 3 && label.length <= 30 && !label.includes('"')) {
            return label;
        }
        
        return null;
    } catch (error) {
        logger.error('Error generating cluster label:', error);
        return null;
    }
}