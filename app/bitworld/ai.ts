import { GoogleGenAI } from '@google/genai';
import { logger } from './logger';
import { checkUserQuota, incrementUserUsage } from '../firebase';
import { createAIAbortController } from './ai.utils';

// Re-export utilities for backward compatibility
export { abortCurrentAI, isAIActive, setDialogueWithRevert, createSubtitleCycler } from './ai.utils';

// Initialize the Google GenAI client
const ai = new GoogleGenAI({
    apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY
});

// Global cache management
let currentCachedContent: string | null = null;
let cacheExpiration: number | null = null;

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
                return `AI limit reached (${quota.dailyUsed}/${quota.dailyLimit} today). Upgrade for more: /pro`;
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

        const result = (response as any).text?.trim() || text;

        // Increment usage after successful response
        if (userId) {
            await incrementUserUsage(userId);
        }

        return result;
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
export async function explainText(text: string, analysisType: string = 'analysis', userId?: string): Promise<string> {
    const abortController = createAIAbortController();

    try {
        // Check user quota before proceeding
        if (userId) {
            const quota = await checkUserQuota(userId);
            if (!quota.canUseAI) {
                return `AI limit reached (${quota.dailyUsed}/${quota.dailyLimit} today). Upgrade for more: /pro`;
            }
        }

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

        const result = (response as any).text?.trim() || `Could not analyze the text`;

        // Increment usage after successful response
        if (userId) {
            await incrementUserUsage(userId);
        }

        return result;
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
export async function summarizeText(text: string, focus?: string, userId?: string): Promise<string> {
    const abortController = createAIAbortController();

    try {
        // Check user quota before proceeding
        if (userId) {
            const quota = await checkUserQuota(userId);
            if (!quota.canUseAI) {
                return `AI limit reached (${quota.dailyUsed}/${quota.dailyLimit} today). Upgrade for more: /pro`;
            }
        }

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

        const result = (response as any).text?.trim() || `Could not summarize the text`;

        // Increment usage after successful response
        if (userId) {
            await incrementUserUsage(userId);
        }

        return result;
    } catch (error) {
        if (error instanceof Error && error.message === 'AI operation was interrupted') {
            logger.debug('AI summarize operation was interrupted by user');
            return '[Interrupted]';
        }
        logger.error('Error summarizing text:', error);
        return `Could not summarize text`;
    }
}

/**
 * Generate or edit an image using Gemini's image generation model
 * @param prompt - Text description for image generation or editing
 * @param existingImage - Optional existing image data URL for image-to-image editing
 * @param userId - Optional user ID for quota checking and usage tracking
 * @returns Object containing imageData (base64 data URL) and optional text response
 */
export async function generateImage(
    prompt: string,
    existingImage?: string,
    userId?: string
): Promise<{ imageData: string | null, text: string }> {
    const abortController = createAIAbortController();

    try {
        // Check user quota before proceeding
        if (userId) {
            const quota = await checkUserQuota(userId);
            if (!quota.canUseAI) {
                return {
                    imageData: null,
                    text: `AI limit reached (${quota.dailyUsed}/${quota.dailyLimit} today). Upgrade for more: /pro`
                };
            }
        }

        if (abortController.signal.aborted) {
            throw new Error('AI operation was interrupted');
        }

        // Prepare contents - either text-to-image or image-to-image
        const contents: any[] = existingImage
            ? [prompt, { inlineData: { data: existingImage.split(',')[1], mimeType: 'image/png' } }]
            : [prompt]; // Add explicit trigger for text-to-image

        const response = await Promise.race([
            ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents,
                config: {
                    responseModalities: ["IMAGE", "TEXT"]
                }
            }),
            new Promise((_, reject) => {
                abortController.signal.addEventListener('abort', () => {
                    reject(new Error('AI operation was interrupted'));
                });
            })
        ]) as any;

        // Extract image and text from response
        let imageData: string | null = null;
        let text = '';

        if (response.candidates && response.candidates[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    // Convert to data URL
                    const mimeType = part.inlineData.mimeType || 'image/png';
                    imageData = `data:${mimeType};base64,${part.inlineData.data}`;
                } else if (part.text) {
                    text += part.text;
                }
            }
        }

        if (!imageData) {
            throw new Error('No image generated in response');
        }

        // Increment usage after successful generation
        if (userId) {
            await incrementUserUsage(userId);
        }

        return { imageData, text: text.trim() };
    } catch (error) {
        if (error instanceof Error && error.message === 'AI operation was interrupted') {
            logger.debug('AI image generation was interrupted by user');
            return { imageData: null, text: '[Interrupted]' };
        }
        logger.error('Error generating image:', error);
        return { imageData: null, text: 'Could not generate image' };
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
export async function chatWithAI(message: string, useCache: boolean = true, userId?: string): Promise<string> {
    const abortController = createAIAbortController();

    try {
        // Check user quota before proceeding
        if (userId) {
            const quota = await checkUserQuota(userId);
            if (!quota.canUseAI) {
                return `AI limit reached (${quota.dailyUsed}/${quota.dailyLimit} today). Upgrade for more: /pro`;
            }
        }

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
                                systemInstruction: 'When responding, please respond without wasting words. Brevity is effective communication, responses should match the initial query in length without leaning into superfluous reflection to maximize focus, without any meta commentary on the personal preference. Respond in all lower case. when canvas context is provided, use it to inform your response but keep replies brief and conversational.'
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
                    const contextContent = `User query: ${message}\n\nCanvas context (for reference): ${currentWorldContext.compiledText}\nLabels: ${currentWorldContext.labels.map(l => l.text).join(', ')}`;

                    response = await Promise.race([
                        ai.models.generateContent({
                            model: 'gemini-2.5-flash-lite',
                            contents: contextContent,
                            config: {
                                maxOutputTokens: 50,
                                temperature: 0.9,
                                systemInstruction: 'When responding, please respond without wasting words. Brevity is effective communication, responses should match the initial query in length without leaning into superfluous reflection to maximize focus, without any meta commentary on the personal preference. Respond in all lower case. when canvas context is provided, use it to inform your response but keep replies brief and conversational.'
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

User: ${message}`,
                    config: {
                        maxOutputTokens: 75,
                        temperature: 0.9,
                        systemInstruction: 'When responding, please respond without wasting words. Brevity is effective communication, responses should match the initial query in length without leaning into superfluous reflection to maximize focus, without any meta commentary on the personal preference. Respond in all lower case. when canvas context is provided, use it to inform your response but keep replies brief and conversational.'
                    }
                }),
                new Promise((_, reject) => {
                    abortController.signal.addEventListener('abort', () => {
                        reject(new Error('AI operation was interrupted'));
                    });
                })
            ]);
        }

        const aiResponse = ((response as any).text?.trim() || 'I could not process that message.').toLowerCase();

        // Add AI response to history
        chatHistory.push({
            role: 'model',
            content: aiResponse,
            timestamp: Date.now()
        });

        // Increment usage after successful response
        if (userId) {
            console.log('[AI] Incrementing usage for user:', userId);
            const success = await incrementUserUsage(userId);
            console.log('[AI] Usage increment result:', success);
        } else {
            console.log('[AI] No userId provided, skipping usage increment');
        }

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
                    parts: [{ text: 'When responding, please respond without wasting words. Brevity is effective communication, responses should match the initial query in length without leaning into superfluous reflection to maximize focus, without any meta commentary on the personal preference. Respond in all lower case. when canvas context is provided, use it to inform your response but keep replies brief and conversational.' }]
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