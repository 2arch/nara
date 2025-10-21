import { NextRequest, NextResponse } from 'next/server';
import { getAutocompleteSuggestions } from '@/app/bitworld/ai';

export async function POST(request: NextRequest) {
    try {
        const { currentText, context } = await request.json();

        if (!currentText || typeof currentText !== 'string') {
            return NextResponse.json(
                { error: 'currentText is required and must be a string' },
                { status: 400 }
            );
        }

        const suggestions = await getAutocompleteSuggestions(currentText, context);

        return NextResponse.json({ suggestions });
    } catch (error) {
        return NextResponse.json(
            { error: 'Failed to get autocomplete suggestions' },
            { status: 500 }
        );
    }
}
