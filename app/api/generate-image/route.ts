import { NextRequest, NextResponse } from 'next/server';
import { generateImage } from '@/app/bitworld/ai';

export async function POST(request: NextRequest) {
    try {
        const { prompt, referenceImage, userId, aspectRatio } = await request.json();

        if (!prompt || typeof prompt !== 'string') {
            return NextResponse.json(
                { error: 'prompt is required and must be a string' },
                { status: 400 }
            );
        }

        const result = await generateImage(prompt, referenceImage, userId, aspectRatio);

        return NextResponse.json({ result });
    } catch (error) {
        return NextResponse.json(
            { error: 'Failed to generate image' },
            { status: 500 }
        );
    }
}
