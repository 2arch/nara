import { NextRequest, NextResponse } from 'next/server';
import { summarizeText } from '@/app/bitworld/ai';

export async function POST(request: NextRequest) {
    try {
        const { text, focus, userId } = await request.json();

        if (!text || typeof text !== 'string') {
            return NextResponse.json(
                { error: 'text is required and must be a string' },
                { status: 400 }
            );
        }

        const result = await summarizeText(text, focus, userId);

        return NextResponse.json({ result });
    } catch (error) {
        return NextResponse.json(
            { error: 'Failed to summarize text' },
            { status: 500 }
        );
    }
}
