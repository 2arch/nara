import { GoogleGenAI } from '@google/genai';

// Initialize the Google GenAI client
const ai = new GoogleGenAI({
    apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY
});

const LOREM_IPSUM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';

// Helper function to set dialogue text with automatic revert to lorem ipsum
export function setDialogueWithRevert(text: string, setDialogueText: (text: string) => void, timeout: number = 2500) {
    setDialogueText(text);
    setTimeout(() => {
        setDialogueText(LOREM_IPSUM);
    }, timeout);
}

// Function to cycle through subtitle-style text
export function createSubtitleCycler(text: string, setDialogueText: (text: string) => void) {
    const MAX_SUBTITLE_LENGTH = 120; // Allow for 2 lines (~60 chars per line)
    
    if (text.length <= MAX_SUBTITLE_LENGTH) {
        setDialogueText(text);
        // Revert to lorem ipsum after 2.5 seconds for short messages
        setTimeout(() => {
            setDialogueText(LOREM_IPSUM);
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
            // Revert to lorem ipsum after all chunks have been shown
            setTimeout(() => {
                setDialogueText(LOREM_IPSUM);
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
            model: 'gemini-2.0-flash-001',
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
            model: 'gemini-2.0-flash-001',
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
            model: 'gemini-2.0-flash-001',
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

/**
 * Chat with AI maintaining conversation history
 */
export async function chatWithAI(message: string): Promise<string> {
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

        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash-001',
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
        while (!operation.done) {
            console.log("Waiting for video generation to complete...");
            await new Promise((resolve) => setTimeout(resolve, 5000)); // Poll every 5 seconds
            operation = await ai.operations.getVideosOperation({
                operation: operation,
            });
        }

        // Get the generated video from the completed operation
        const generatedVideo = operation.response?.generatedVideos?.[0];
        if (generatedVideo?.video?.videoBytes) {
            // Convert base64 video bytes to data URL
            const mimeType = generatedVideo.video.mimeType || 'video/mp4';
            const dataUrl = `data:${mimeType};base64,${generatedVideo.video.videoBytes}`;
            return dataUrl;
        }

        console.warn('No video data received from generation');
        return null;
    } catch (error) {
        console.error('Error generating video:', error);
        return null;
    }
}

/**
 * Generate deepspawn questions/suggestions based on recent text
 */
export async function generateDeepspawnQuestions(recentText: string): Promise<string[]> {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash-001',
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