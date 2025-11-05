import { NextRequest, NextResponse } from 'next/server';
import { chatWithAI } from '@/app/bitworld/ai';

export async function POST(request: NextRequest) {
    try {
        const { prompt, addToHistory, userId, worldContext } = await request.json();

        if (!prompt || typeof prompt !== 'string') {
            return NextResponse.json(
                { error: 'prompt is required and must be a string' },
                { status: 400 }
            );
        }

        const result = await chatWithAI(prompt, addToHistory, userId, worldContext);

        return NextResponse.json({ result });
    } catch (error) {
        return NextResponse.json(
            { error: 'Failed to chat with AI' },
            { status: 500 }
        );
    }
}
