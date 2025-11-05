import { NextRequest, NextResponse } from 'next/server';
import { transformText } from '@/app/bitworld/ai';

export async function POST(request: NextRequest) {
    try {
        const { text, instructions, userId } = await request.json();

        if (!text || typeof text !== 'string') {
            return NextResponse.json(
                { error: 'text is required and must be a string' },
                { status: 400 }
            );
        }

        if (!instructions || typeof instructions !== 'string') {
            return NextResponse.json(
                { error: 'instructions is required and must be a string' },
                { status: 400 }
            );
        }

        const result = await transformText(text, instructions, userId);

        return NextResponse.json({ result });
    } catch (error) {
        return NextResponse.json(
            { error: 'Failed to transform text' },
            { status: 500 }
        );
    }
}
