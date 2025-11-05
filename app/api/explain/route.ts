import { NextRequest, NextResponse } from 'next/server';
import { explainText } from '@/app/bitworld/ai';

export async function POST(request: NextRequest) {
    try {
        const { text, analysisType, userId } = await request.json();

        if (!text || typeof text !== 'string') {
            return NextResponse.json(
                { error: 'text is required and must be a string' },
                { status: 400 }
            );
        }

        const result = await explainText(text, analysisType, userId);

        return NextResponse.json({ result });
    } catch (error) {
        return NextResponse.json(
            { error: 'Failed to explain text' },
            { status: 500 }
        );
    }
}
