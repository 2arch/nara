// Lightweight AI utilities that don't require GenAI SDK
// These can be imported without loading the heavy AI module

const DEFAULT_TEXT = '';

// Global abort controller for interrupting AI operations
let globalAbortController: AbortController | null = null;

/**
 * Create a new abort controller for AI operations
 */
export function createAIAbortController(): AbortController {
    // Cancel any existing operation
    if (globalAbortController && !globalAbortController.signal.aborted) {
        globalAbortController.abort('New AI operation started');
    }

    globalAbortController = new AbortController();
    return globalAbortController;
}

/**
 * Abort the current AI operation
 */
export function abortCurrentAI(): boolean {
    if (globalAbortController && !globalAbortController.signal.aborted) {
        globalAbortController.abort('User interrupted');
        return true;
    }
    return false;
}

/**
 * Check if there's an active AI operation
 */
export function isAIActive(): boolean {
    return globalAbortController !== null && !globalAbortController.signal.aborted;
}

// Helper function to set dialogue text with automatic revert to default
export function setDialogueWithRevert(text: string, setDialogueText: (text: string) => void, timeout: number = 2500) {
    setDialogueText(text);
    setTimeout(() => {
        setDialogueText(DEFAULT_TEXT);
    }, timeout);
}

// Function to cycle through subtitle-style text
export function createSubtitleCycler(text: string, setDialogueText: (text: string) => void) {
    const MAX_SUBTITLE_LENGTH = 120; // Allow for 2 lines (~60 chars per line)

    if (text.length <= MAX_SUBTITLE_LENGTH) {
        setDialogueText(text);
        // Revert to default after 2.5 seconds for short messages
        setTimeout(() => {
            setDialogueText(DEFAULT_TEXT);
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
            // Revert to default after all chunks have been shown
            setTimeout(() => {
                setDialogueText(DEFAULT_TEXT);
            }, 2500); // Wait another 2.5 seconds before reverting
        }
    };

    showNextChunk();
}
