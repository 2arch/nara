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
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents: `Transform the following text according to these instructions: "${instructions}"

Original text: "${text}"

Respond with ONLY the transformed text. No explanation, no quotes.`,
            config: {
                maxOutputTokens: 150,
                temperature: 0.3,
                systemInstruction: 'You transform text according to user instructions. Respond only with the transformed result.'
            }
        });

        return response.text?.trim() || text;
    } catch (error) {
        console.error('Error transforming text:', error);
        return `Could not transform text`;
    }
}

/**
 * Explain text according to given analysis type or general analysis
 */
export async function explainText(text: string, analysisType: string = 'analysis'): Promise<string> {
    try {
        const prompt = analysisType === 'analysis' 
            ? `Explain this text: "${text}"`
            : `Explain this text focusing on "${analysisType}": "${text}"`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents: prompt,
            config: {
                maxOutputTokens: 200,
                temperature: 0.2,
                systemInstruction: 'You explain text clearly and concisely. Focus on the key meaning and context.'
            }
        });

        return response.text?.trim() || `Could not analyze the text`;
    } catch (error) {
        console.error('Error explaining text:', error);
        return `Could not explain text`;
    }
}

/**
 * Summarize the given text
 */
export async function summarizeText(text: string, focus?: string): Promise<string> {
    try {
        const prompt = focus 
            ? `Summarize this text focusing on "${focus}": "${text}"`
            : `Summarize this text: "${text}"`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents: prompt,
            config: {
                maxOutputTokens: 150,
                temperature: 0.1,
                systemInstruction: 'You summarize text concisely, capturing the main points in a clear and brief way.'
            }
        });

        return response.text?.trim() || `Could not summarize the text`;
    } catch (error) {
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
    console.log('World context updated for ambient navigation');
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
        
        // Use world context if available and enabled
        if (useCache && currentWorldContext) {
            try {
                const contextContent = `Canvas context: ${currentWorldContext.compiledText}\nLabels: ${currentWorldContext.labels.map(l => l.text).join(', ')}\n\nUser: ${message}\n\nRespond briefly and conversationally. Reference canvas content when relevant.`;
                
                response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash-lite',
                    contents: contextContent,
                    config: {
                        maxOutputTokens: 100,
                        temperature: 0.7,
                        systemInstruction: 'You are a concise ambient navigator. Give brief, helpful responses about canvas content connections. Be conversational, not academic.'
                    }
                });
            } catch (error) {
                console.error('Error using world context, falling back:', error);
                // Fall back to non-cached request
                useCache = false;
            }
        }
        
        // If not using cache or cache failed
        if (!useCache || !response) {
            response = await ai.models.generateContent({
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
            });
        }

        const aiResponse = response.text?.trim() || 'I could not process that message.';

        // Add AI response to history
        chatHistory.push({
            role: 'model',
            content: aiResponse,
            timestamp: Date.now()
        });

        return aiResponse;
    } catch (error) {
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
    console.log('World context cleared');
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
        console.log('Starting video generation with prompt:', prompt);
        
        // Start the video generation operation
        let operation = await ai.models.generateVideos({
            model: 'veo-3.0-generate-preview',
            prompt: prompt,
        });

        console.log('Initial operation response:', operation);

        // Poll the operation status until the video is ready
        let pollCount = 0;
        let maxPolls = 60; // Maximum 5 minutes of polling (60 * 5 seconds)
        
        while (!operation.done && pollCount < maxPolls) {
            pollCount++;
            console.log(`Waiting for video generation to complete... (poll ${pollCount})`);
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
            
            console.log(`Poll ${pollCount} response:`, operation);
            console.log(`Poll ${pollCount} details:`, {
                done: operation.done,
                hasResponse: !!operation.response,
                hasError: !!operation.error,
                hasMetadata: !!operation.metadata,
                operationName: operation.name,
                fullOperation: JSON.stringify(operation, null, 2)
            });
        }
        
        if (pollCount >= maxPolls) {
            console.error('Video generation timed out after 5 minutes');
            return null;
        }

        console.log('Operation completed. Full response:', operation);

        // Get the generated video from the completed operation
        const generatedVideo = operation.response?.generatedVideos?.[0];
        console.log('Generated video object:', generatedVideo);
        
        // Check if we have video bytes directly
        if (generatedVideo?.video?.videoBytes) {
            // Convert base64 video bytes to data URL
            const mimeType = generatedVideo.video.mimeType || 'video/mp4';
            const dataUrl = `data:${mimeType};base64,${generatedVideo.video.videoBytes}`;
            console.log('Video data URL created successfully from bytes');
            return dataUrl;
        }
        
        // Check if we have a URI to download the video from
        if (generatedVideo?.video?.uri) {
            console.log('Video URI received:', generatedVideo.video.uri);
            
            try {
                // Fetch the video from the URI
                const response = await fetch(generatedVideo.video.uri);
                if (!response.ok) {
                    console.error('Failed to fetch video from URI:', response.status, response.statusText);
                    return null;
                }
                
                // Get the video as a blob
                const blob = await response.blob();
                console.log('Video blob received, size:', blob.size, 'type:', blob.type);
                
                // Convert blob to data URL
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const dataUrl = reader.result as string;
                        console.log('Video data URL created successfully from URI');
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
                console.log('Returning URI directly as fallback');
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
 * Generate deepspawn questions/suggestions based on recent text
 * Note: This function should only be called when deepspawn is enabled
 */
export async function generateDeepspawnQuestions(recentText: string): Promise<string[]> {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents: `Based on this text: "${recentText}"

Generate exactly 5 very short writing prompts that encourage deeper thinking. Each must be:
- Under 20 characters total
- Single phrase or short question
- Thought-provoking
- Related to the content

Examples: "Why not?", "What if...", "How else?", "But what about...", "Consider..."

Format as a numbered list:
1. [prompt]
2. [prompt] 
3. [prompt]
4. [prompt]
5. [prompt]`,
            config: {
                maxOutputTokens: 300,
                temperature: 0.8,
                systemInstruction: 'You generate creative, thought-provoking questions and suggestions to inspire deeper thinking and writing exploration.'
            }
        });

        const responseText = response.text?.trim() || '';
        
        // Parse the numbered list into an array
        const questions = responseText
            .split('\n')
            .filter(line => line.match(/^\d+\./))
            .map(line => line.replace(/^\d+\.\s*/, '').trim())
            .filter(q => q.length > 0);

        // Filter questions to ensure they're under 20 characters
        const validQuestions = questions.filter(q => q.length <= 20);
        
        // If we don't get exactly 5 valid questions, fall back to defaults
        if (validQuestions.length !== 5) {
            console.warn('Deepspawn AI returned unexpected format, using fallbacks');
            return [
                "Why not?",
                "What if...",
                "How else?",
                "But what about...",
                "Consider..."
            ];
        }

        return validQuestions;
    } catch (error) {
        console.error('Error generating deepspawn questions:', error);
        // Return fallback questions on error
        return [
            "Why not?",
            "What if...",
            "How else?", 
            "But what about...",
            "Consider..."
        ];
    }
}

/**
 * Generate a concise label for a text cluster using AI
 * @param clusterContent Full text content of the cluster
 * @returns Promise<string> Concise label or null if generation fails
 */
export async function generateClusterLabel(clusterContent: string): Promise<string | null> {
    try {
        console.log('=== CLUSTER LABEL GENERATION ===');
        console.log('Input content:', clusterContent);
        
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
        console.log('AI response:', label);
        
        // Validate the label is reasonably short and meaningful
        if (label && label.length >= 3 && label.length <= 30 && !label.includes('"')) {
            console.log('Generated label:', label);
            return label;
        }
        
        console.log('Label validation failed:', { label, length: label?.length });
        return null;
    } catch (error) {
        console.error('Error generating cluster label:', error);
        return null;
    }
}