// Test script to verify server-side GEMINI_API_KEY works
// This demonstrates the target architecture - API routes using server-side key only

const { GoogleGenAI } = require('@google/genai');

// Use server-side only key (what we WANT to use)
const apiKey = process.env.GEMINI_API_KEY;

console.log('Testing server-side AI setup with GEMINI_API_KEY (no public key)...');
console.log('API Key present:', !!apiKey);
console.log('API Key (first 10 chars):', apiKey ? apiKey.substring(0, 10) + '...' : 'NOT FOUND');

if (!apiKey) {
    console.error('ERROR: GEMINI_API_KEY is not set!');
    console.error('Make sure GEMINI_API_KEY is set in .env.local');
    process.exit(1);
}

// Initialize AI client (same way ai.ts does it)
const ai = new GoogleGenAI({ apiKey });

// Test a simple AI call
async function testAI() {
    try {
        console.log('\nTesting AI call...');
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents: 'Say "Hello from test!" in exactly 3 words.',
            config: {
                maxOutputTokens: 10,
                temperature: 0.5
            }
        });

        const result = response.text?.trim();
        console.log('✓ AI Response:', result);
        console.log('✓ Test successful! Server-side GEMINI_API_KEY works.');
        console.log('✓ This confirms API routes will work without NEXT_PUBLIC key.');
        return true;
    } catch (error) {
        console.error('✗ AI call failed:', error.message);
        return false;
    }
}

testAI().then(success => {
    process.exit(success ? 0 : 1);
});
