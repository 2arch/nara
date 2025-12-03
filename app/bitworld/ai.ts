import { GoogleGenAI } from '@google/genai';
import { logger } from './logger';
import { checkUserQuota, incrementUserUsage } from '../firebase';
import { createAIAbortController } from './ai.utils';

// Re-export utilities
export { abortCurrentAI, isAIActive, setDialogueWithRevert, createSubtitleCycler } from './ai.utils';

// Re-export tools for external use
export { canvasTools, executeTool } from './ai.tools';
export type { ToolContext } from './ai.tools';

// Lazy initialization of the Google GenAI client
let genaiClient: GoogleGenAI | null = null;

function getAIClient(): GoogleGenAI {
    if (!genaiClient) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY environment variable is not set');
        }
        genaiClient = new GoogleGenAI({ apiKey });
    }
    return genaiClient;
}

// =============================================================================
// Server-side functions (used by API routes)
// =============================================================================

/**
 * Generate or edit an image using Gemini's image generation model
 */
export async function generateImage(
    prompt: string,
    existingImage?: string,
    userId?: string,
    aspectRatio?: string
): Promise<{ imageData: string | null, text: string }> {
    const abortController = createAIAbortController();

    try {
        if (userId) {
            const quota = await checkUserQuota(userId);
            if (!quota.canUseAI) {
                return {
                    imageData: null,
                    text: `AI limit reached (${quota.dailyUsed}/${quota.dailyLimit} today). Upgrade for more: /upgrade`
                };
            }
        }

        if (abortController.signal.aborted) {
            throw new Error('AI operation was interrupted');
        }

        let contents: any[] = [prompt];

        if (existingImage) {
            const matches = existingImage.match(/^data:([^;]+);base64,(.+)$/);
            if (!matches) {
                throw new Error('Invalid image format - must be base64 data URL');
            }
            const mimeType = matches[1];
            const base64Data = matches[2];
            contents = [prompt, { inlineData: { data: base64Data, mimeType } }];
        }

        const response = await Promise.race([
            getAIClient().models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents,
                config: {
                    responseModalities: ["IMAGE", "TEXT"],
                    ...(aspectRatio && { aspectRatio })
                }
            }),
            new Promise((_, reject) => {
                abortController.signal.addEventListener('abort', () => {
                    reject(new Error('AI operation was interrupted'));
                });
            })
        ]) as any;

        let imageData: string | null = null;
        let text = '';

        if (response.candidates && response.candidates[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
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

/**
 * Generate a video from a text prompt using Google GenAI Veo
 */
export async function generateVideo(prompt: string): Promise<string | null> {
    try {
        let operation = await getAIClient().models.generateVideos({
            model: 'veo-3.0-generate-preview',
            prompt: prompt,
        });

        let pollCount = 0;
        let maxPolls = 60;

        while (!operation.done && pollCount < maxPolls) {
            pollCount++;
            await new Promise((resolve) => setTimeout(resolve, 5000));

            try {
                operation = await getAIClient().operations.getVideosOperation({
                    operation: operation
                });
            } catch (pollError) {
                logger.error(`Error polling operation (attempt ${pollCount}):`, pollError);
            }
        }

        if (pollCount >= maxPolls) {
            logger.error('Video generation timed out after 5 minutes');
            return null;
        }

        const generatedVideo = operation.response?.generatedVideos?.[0];

        if (generatedVideo?.video?.videoBytes) {
            const mimeType = generatedVideo.video.mimeType || 'video/mp4';
            return `data:${mimeType};base64,${generatedVideo.video.videoBytes}`;
        }

        if (generatedVideo?.video?.uri) {
            try {
                const response = await fetch(generatedVideo.video.uri);
                if (!response.ok) {
                    logger.error('Failed to fetch video from URI:', response.status, response.statusText);
                    return null;
                }

                const blob = await response.blob();

                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror = () => {
                        logger.error('Failed to convert video blob to data URL');
                        resolve(null);
                    };
                    reader.readAsDataURL(blob);
                });
            } catch (fetchError) {
                logger.error('Error fetching video from URI:', fetchError);
                return generatedVideo.video.uri;
            }
        }

        if (generatedVideo && 'raiReason' in generatedVideo) {
            logger.warn('Video generation blocked by RAI:', (generatedVideo as any).raiReason);
        }

        logger.warn('No video data received from generation.');
        return null;
    } catch (error) {
        logger.error('Error generating video:', error);
        return null;
    }
}

/**
 * Generate a concise label for a text cluster using AI
 */
export async function generateClusterLabel(clusterContent: string): Promise<string | null> {
    try {
        const response = await getAIClient().models.generateContent({
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

        if (label && label.length >= 3 && label.length <= 30 && !label.includes('"')) {
            return label;
        }

        return null;
    } catch (error) {
        logger.error('Error generating cluster label:', error);
        return null;
    }
}

/**
 * Get autocomplete suggestions
 */
export async function getAutocompleteSuggestions(
    currentText: string,
    context?: string
): Promise<string[]> {
    try {
        if (!currentText || currentText.trim().length === 0) {
            return [];
        }

        const prompt = context ? `${context}\n${currentText}` : currentText;

        const response = await getAIClient().models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents: `Continue this text with 3 possible next words (output format: "word1, word2, word3"): "${prompt}"`,
            config: {
                maxOutputTokens: 20,
                temperature: 0.7,
                systemInstruction: 'Provide only 3 comma-separated word suggestions, no explanation.'
            }
        });

        const result = response.text?.trim();
        if (!result) return [];

        return result
            .split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0 && /^[a-zA-Z]+$/.test(s))
            .slice(0, 3);
    } catch (error) {
        logger.error('Error getting autocomplete suggestions:', error);
        return [];
    }
}

// =============================================================================
// Client-side interface
// =============================================================================

export interface CanvasState {
    cursorPosition: { x: number; y: number };
    viewport: { offset: { x: number; y: number }; zoomLevel: number };
    selection: { start: { x: number; y: number } | null; end: { x: number; y: number } | null };
    agents: Array<{ id: string; x: number; y: number; spriteName?: string }>;
    notes: Array<{ id: string; x: number; y: number; width: number; height: number; contentType?: string; content?: string }>;
    chips: Array<{ id: string; x: number; y: number; text: string; color?: string }>;
}

/** Context for AI - provide whatever is available, AI decides what to do */
export interface AIContext {
    userId?: string;
    selection?: string;
    worldContext?: {
        compiledText: string;
        labels: Array<{ text: string; x: number; y: number }>;
        metadata?: string;
    };
    referenceImage?: string;
    aspectRatio?: string;
    canvasState?: CanvasState;
}

/** Result from ai() - model decides response type */
export interface AIResult {
    text?: string;
    actions?: Array<{
        tool: string;
        args: Record<string, any>;
    }>;
    image?: {
        imageData: string | null;
        text: string;
    };
    error?: string;
}

/**
 * Unified AI interface. Gemini decides whether to:
 * - Execute canvas tools (paint, move, create)
 * - Respond with text
 * - Generate/edit an image
 *
 * Just call ai(prompt, context) and let the model figure it out.
 */
export const ai = async (prompt: string, context?: AIContext): Promise<AIResult> => {
    const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, ...context })
    });
    return response.json();
};
