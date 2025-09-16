import { GoogleGenAI } from '@google/genai';

// Initialize the Google GenAI client
const ai = new GoogleGenAI({
    apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY
});

const DEFAULT_TEXT = '';

// Global abort controller for interrupting AI operations
let globalAbortController: AbortController | null = null;

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
export async function transformText(text: string, instructions: string): Promise<string> {
    const abortController = createAIAbortController();
    
    try {
        if (abortController.signal.aborted) {
            throw new Error('AI operation was interrupted');
        }

        const response = await Promise.race([
            ai.models.generateContent({
                model: 'gemini-2.5-flash-lite',
                contents: `Transform the following text according to these instructions: "${instructions}"

Original text: "${text}"

Respond with ONLY the transformed text. No explanation, no quotes.`,
                config: {
                    maxOutputTokens: 150,
                    temperature: 0.3,
                    systemInstruction: 'You transform text according to user instructions. Respond only with the transformed result.'
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
            console.log('AI transform operation was interrupted by user');
            return '[Interrupted]';
        }
        console.error('Error transforming text:', error);
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
            ? `Explain this text: "${text}"`
            : `Explain this text focusing on "${analysisType}": "${text}"`;

        const response = await Promise.race([
            ai.models.generateContent({
                model: 'gemini-2.5-flash-lite',
                contents: prompt,
                config: {
                    maxOutputTokens: 200,
                    temperature: 0.2,
                    systemInstruction: 'You explain text clearly and concisely. Focus on the key meaning and context.'
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
            console.log('AI explain operation was interrupted by user');
            return '[Interrupted]';
        }
        console.error('Error explaining text:', error);
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
            ? `Summarize this text focusing on "${focus}": "${text}"`
            : `Summarize this text: "${text}"`;

        const response = await Promise.race([
            ai.models.generateContent({
                model: 'gemini-2.5-flash-lite',
                contents: prompt,
                config: {
                    maxOutputTokens: 150,
                    temperature: 0.1,
                    systemInstruction: 'You summarize text concisely, capturing the main points in a clear and brief way.'
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
            console.log('AI summarize operation was interrupted by user');
            return '[Interrupted]';
        }
        console.error('Error summarizing text:', error);
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
        
        // Use world context if available and enabled
        if (useCache && currentWorldContext) {
            try {
                const contextContent = `Canvas context: ${currentWorldContext.compiledText}\nLabels: ${currentWorldContext.labels.map(l => l.text).join(', ')}\n\nUser: ${message}\n\nRespond briefly and conversationally. Reference canvas content when relevant.`;
                
                // Create a promise race with abort signal
                response = await Promise.race([
                    ai.models.generateContent({
                        model: 'gemini-2.5-flash-lite',
                        contents: contextContent,
                        config: {
                            maxOutputTokens: 100,
                            temperature: 0.7,
                            systemInstruction: 'You are a concise ambient navigator. Give brief, helpful responses about canvas content connections. Be conversational, not academic.'
                        }
                    }),
                    new Promise((_, reject) => {
                        abortController.signal.addEventListener('abort', () => {
                            reject(new Error('AI operation was interrupted'));
                        });
                    })
                ]);
            } catch (error) {
                if (error instanceof Error && error.message === 'AI operation was interrupted') {
                    throw error;
                }
                console.error('Error using world context, falling back:', error);
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

Respond naturally and conversationally. Keep responses concise but complete.`,
                    config: {
                        maxOutputTokens: 300,
                        temperature: 0.7,
                        systemInstruction: 'You are a helpful assistant engaged in a natural conversation. Be conversational, helpful, and concise. Remember the context of the conversation.'
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
            console.log('AI chat operation was interrupted by user');
            return '[Interrupted]';
        }
        console.error('Error in chat:', error);
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

        console.warn('No image data received from generation');
        return null;
    } catch (error) {
        console.error('Error generating image:', error);
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
                console.error(`Error polling operation (attempt ${pollCount}):`, pollError);
                // If the operation is not responding properly, we might have a stale operation
                // Continue with the existing operation object
            }
            
        }
        
        if (pollCount >= maxPolls) {
            console.error('Video generation timed out after 5 minutes');
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
                    console.error('Failed to fetch video from URI:', response.status, response.statusText);
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
                        console.error('Failed to convert video blob to data URL');
                        resolve(null);
                    };
                    reader.readAsDataURL(blob);
                });
            } catch (fetchError) {
                console.error('Error fetching video from URI:', fetchError);
                // As a fallback, just return the URI directly
                return generatedVideo.video.uri;
            }
        }

        // Check for RAI (Responsible AI) filtering
        if (generatedVideo && 'raiReason' in generatedVideo) {
            console.warn('Video generation blocked by RAI:', (generatedVideo as any).raiReason);
        }

        console.warn('No video data received from generation. Full response structure:', JSON.stringify(operation, null, 2));
        return null;
    } catch (error) {
        console.error('Error generating video:', error);
        // Log more details about the error
        if (error instanceof Error) {
            console.error('Error details:', {
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
        console.error('Error generating cluster label:', error);
        return null;
    }
}