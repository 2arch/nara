import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

// Lazy client initialization
let genaiClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
    if (!genaiClient) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY environment variable is not set');
        }
        genaiClient = new GoogleGenAI({ apiKey });
    }
    return genaiClient;
}

export async function POST(request: NextRequest) {
    try {
        // Get the audio data from form data
        const formData = await request.formData();
        const audioFile = formData.get('audio') as Blob | null;

        if (!audioFile) {
            return NextResponse.json(
                { error: 'Audio file is required' },
                { status: 400 }
            );
        }

        // Convert blob to base64
        const arrayBuffer = await audioFile.arrayBuffer();
        const base64Audio = Buffer.from(arrayBuffer).toString('base64');

        // Determine mime type
        const mimeType = audioFile.type || 'audio/webm';

        // Send to Gemini for transcription
        const response = await getClient().models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                {
                    role: 'user',
                    parts: [
                        {
                            inlineData: {
                                mimeType: mimeType,
                                data: base64Audio
                            }
                        },
                        {
                            text: 'Transcribe this audio exactly as spoken. Return only the transcription text, nothing else. If the audio is silent or unclear, return an empty string.'
                        }
                    ]
                }
            ]
        });

        const transcript = response.text?.trim() || '';

        return NextResponse.json({ transcript });
    } catch (error) {
        console.error('Transcription error:', error);
        return NextResponse.json(
            { error: 'Failed to transcribe audio' },
            { status: 500 }
        );
    }
}
