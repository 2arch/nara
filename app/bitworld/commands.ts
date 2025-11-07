import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Point, WorldData } from './world.engine';
import { generateImage, generateVideo, setDialogueWithRevert } from './ai';
import { detectImageIntent } from './ai.utils';
import type { WorldSettings } from './settings';

// --- Command System Types ---
export interface CommandState {
    isActive: boolean;
    input: string;
    matchedCommands: string[];
    selectedIndex: number;
    commandStartPos: Point;
    originalCursorPos: Point; // Store original cursor position to restore on Escape
    hasNavigated: boolean; // Track if user has used arrow keys to navigate
    helpMode?: boolean; // Flag to show help text for all commands
}

export interface PendingCommand {
    command: string;
    args: string[];
    isWaitingForSelection: boolean;
}

export interface CommandExecution {
    command: string;
    args: string[];
    commandStartPos: Point;
    clipContent?: string; // For /clip command
}

// --- Mode System Types ---
export type CanvasMode = 'default' | 'air' | 'chat' | 'note';
export type BackgroundMode = 'transparent' | 'color' | 'image' | 'video' | 'space' | 'stream';
export type CameraMode = 'default' | 'focus';

export type GridMode = 'dots' | 'lines';
export type ArtifactType = 'images' | 'questions';

export interface ModeState {
    currentMode: CanvasMode;
    lightModeData: WorldData; // Ephemeral text data for air mode
    backgroundMode: BackgroundMode;
    backgroundColor: string;
    backgroundImage?: string; // URL or data URL for generated images
    backgroundVideo?: string; // URL or data URL for generated videos
    backgroundStream?: MediaStream; // MediaStream for screen share
    textColor: string;
    textBackground?: string; // Background color for text
    fontFamily: string; // Font family for text rendering
    currentTextStyle: {
        color: string;
        background?: string;
    }; // Current persistent text style
    searchPattern: string; // Current search pattern
    isSearchActive: boolean; // Whether search highlighting is active
    cameraMode: CameraMode; // Camera tracking mode
    isIndentEnabled: boolean; // Whether smart indentation is enabled for Enter key
    isMoveMode: boolean; // Whether move mode is active for dragging text blocks
    isPaintMode: boolean; // Whether paint mode is active for drawing monogram zones
    gridMode: GridMode; // 3D grid rendering mode
    artefactsEnabled: boolean; // Whether 3D artifacts are enabled in space mode
    artifactType: ArtifactType; // Type of artifacts to show (images or questions)
    isFullscreenMode: boolean; // Whether fullscreen/constrained mode is active
    fullscreenRegion?: { // The region to constrain viewport to
        type: 'bound' | 'list';
        key: string;
        startX: number;
        endX: number;
        startY: number;
        endY?: number; // For lists/finite bounds
    };
}

interface UseCommandSystemProps {
    setDialogueText: (text: string) => void;
    initialBackgroundColor?: string;
    initialTextColor?: string;
    getAllLabels?: () => Array<{text: string, x: number, y: number, color: string}>;
    getAllBounds?: () => Array<{startX: number, endX: number, startY: number, endY: number, color: string, title?: string}>;
    availableStates?: string[];
    username?: string;
    userUid?: string | null;
    membershipLevel?: string; // User's membership level (e.g., 'super', 'pro', etc.)
    updateSettings?: (settings: Partial<WorldSettings>) => void;
    settings?: WorldSettings;
    getEffectiveCharDims: (zoom: number) => { width: number; height: number; fontSize: number; };
    zoomLevel: number;
    clipboardItems?: Array<{id: string, content: string, startX: number, endX: number, startY: number, endY: number, timestamp: number}>;
    toggleRecording?: () => Promise<void> | void;
    isReadOnly?: boolean;
    getNormalizedSelection?: () => { startX: number, endX: number, startY: number, endY: number } | null;
    setWorldData?: (data: any) => void;
    worldData?: any;
    setSelectionStart?: (pos: { x: number, y: number } | null) => void;
    setSelectionEnd?: (pos: { x: number, y: number } | null) => void;
    uploadImageToStorage?: (dataUrl: string, mimeType?: string) => Promise<string>;
    triggerUpgradeFlow?: () => void;
    triggerTutorialFlow?: () => void;
    onCommandExecuted?: (command: string, args: string[]) => void;
    cancelComposition?: () => void; // Callback to cancel IME composition
}

// --- Command System Constants ---
// Commands available in read-only mode (not authenticated or not owner)
const READ_ONLY_COMMANDS = ['signin', 'share'];

// Commands organized by category for logical ordering
const AVAILABLE_COMMANDS = [
    // Navigation & View
    'nav', 'search', 'cam', 'indent', 'zoom', 'map',
    // Content Creation
    'label', 'task', 'link', 'clip', 'upload',
    // Special
    'mode', 'note', 'mail', 'chat', 'tutorial', 'help',
    // Styling & Display
    'bg', 'text', 'font',
    // State Management
    'state', 'random', 'clear', 'replay',
    // Sharing & Publishing
    'publish', 'unpublish', 'share', 'spawn', 'monogram',
    // Account
    'signin', 'signout', 'account',
    // Debug
    'debug'
];

// Category mapping for visual organization
export const COMMAND_CATEGORIES: { [category: string]: string[] } = {
    'nav': ['nav', 'search', 'cam', 'indent', 'zoom', 'map'],
    'create': ['label', 'task', 'link', 'clip', 'upload'],
    'special': ['mode', 'note', 'mail', 'chat', 'tutorial', 'help'],
    'style': ['bg', 'text', 'font'],
    'state': ['state', 'random', 'clear', 'replay'],
    'share': ['publish', 'unpublish', 'share', 'spawn', 'monogram'],
    'account': ['signin', 'signout', 'account'],
    'debug': ['debug']
};

const MODE_COMMANDS = ['default', 'air', 'chat', 'note'];
const BG_COMMANDS: string[] = []; // Removed 'clear', 'live', 'web' options
const FONT_COMMANDS = ['IBM Plex Mono', 'Neureal'];
const NAV_COMMANDS: string[] = [];
const CAMERA_COMMANDS = ['default', 'focus'];

// Detailed help descriptions for each command
export const COMMAND_HELP: { [command: string]: string } = {
    'nav': 'Navigate to saved labels. Type /nav to see all your labels, then select one to jump to that location. Labels act as spatial bookmarks in your canvas.',
    'search': 'Search through all text on your canvas. Type /search followed by your query to find and navigate to specific content. Useful for finding ideas in large canvases.',
    'map': 'Generate a procedural map of ephemeral labels around your viewport. Creates a tasteful exploration terrain with temporary waypoints that disappear when you press Escape.',
    'cam': 'Control camera behavior. Use /cam focus to enable focus mode, which smoothly follows your cursor. Use /cam default to return to normal panning.',
    'indent': 'Toggle text indentation. This affects how new lines are indented when you press Enter, helping you organize thoughts hierarchically.',
    'label': 'Create a spatial label at your current selection. Type /label \'text\' [color]. Defaults to current text color (accent). Custom colors: /label \'text\' crimson. Labels show as colored cells with cutout text.',
    'task': 'Create a toggleable task from selected text. Select text, then type /task [color]. Click the highlighted task to toggle completion (adds strikethrough). Click again to un-complete it.',
    'link': 'Create a clickable link from selected text. Select text, then type /link [url]. Click the underlined link to open the URL in a new tab. URLs are auto-detected when pasted.',
    'clip': 'Save selected text to your clipboard. Select text, then type /clip to capture it. Access your clips later to paste them anywhere on the canvas.',
    'upload': 'Upload an image to your canvas. Type /upload, then select an image file. The image will be placed at your current cursor position and saved to your canvas.',
    'mode': 'Switch canvas modes. /mode default for standard writing, /mode air for ephemeral text that doesn\'t save, /mode chat to talk with AI, /mode note for focused note-taking.',
    'note': 'Quick shortcut to enter note mode. This creates a focused writing space perfect for drafting ideas before placing them on your main canvas.',
    'mail': '[SUPER ONLY] Create an email region. Select a rectangular area, type /mail. Row 1 = recipient email, Row 2 = subject line, Row 3+ = message body. Click the send button to deliver the email.',
    'chat': 'Quick shortcut to enter chat mode. Talk with AI to transform, expand, or generate text. The AI can help you develop ideas or create content based on your prompts.',
    'tutorial': 'Start the interactive tutorial. Learn the basics of spatial writing through hands-on exercises that teach you core commands and concepts.',
    'help': 'Show this detailed help menu. The command list stays open with descriptions for every available command, so you can explore what\'s possible.',
    'tab': 'Toggle AI-powered autocomplete suggestions. When enabled, type and see AI suggestions appear as gray text. Press Tab to accept suggestions.',
    'bg': 'Change background color. Use /bg [color] for solid colors like /bg white, /bg black, /bg sulfur, etc.',
    'text': 'Change text color. Type /text followed by a color name (garden, sky, sunset, etc.). This sets the color for all new text you write on the canvas.',
    'font': 'Change font family. Type /font followed by a font name: "IBM Plex Mono" for a clean monospace font, or "Neureal" for a more stylized aesthetic.',
    'state': 'Save or load canvas states. Type /state to see saved states, /state save [name] to save current canvas, /state load [name] to restore a saved state. Perfect for versioning your work.',
    'random': 'Randomize text styling. Applies random colors and styles to your text for a more organic, playful aesthetic. Great for breaking out of rigid design patterns.',
    'clear': 'Clear all text from the canvas. WARNING: This deletes everything on your current canvas. Use /state save first if you want to preserve your work.',
    'publish': 'Publish your canvas publicly. Makes your canvas accessible at your public URL (nara.ws/username/canvasname). Others can view but not edit.',
    'unpublish': 'Unpublish your canvas. Makes your canvas private again. It will no longer be accessible at the public URL.',
    'share': 'Get a shareable link to your canvas. Copy this link to share your canvas with others. If published, they can view it; if private, you control access.',
    'spawn': 'Set your spawn point. This is where you\'ll start when you open this canvas. Type /spawn to set it to your current position.',
    'monogram': 'Add your monogram to the canvas. Places your personal identifier at the current cursor position.',
    'signin': 'Sign in to your Nara account. Required for saving work, publishing canvases, and accessing AI features.',
    'signout': 'Sign out of your Nara account. You\'ll return to read-only mode.',
    'account': 'Manage your account settings. Use /account reset to reset your password.',
    'debug': 'Toggle debug mode. Shows technical information about canvas state, performance, and rendering. Useful for troubleshooting or understanding the system.'
};

// Standardized color mapping used throughout the application
export const COLOR_MAP: { [name: string]: string } = {
    'white': '#FFFFFF',
    'black': '#000000',
    'sulfur': '#F0FF6A',
    'chalk': '#69AED6',
    'cobalt': '#0B109F',
    'shamrock': '#10B981',
    'spring': '#D4FF00',
    'garden': '#162400',
    'crimson': '#FF5200',
    'orchid': '#FFC0CB',
};

// --- Command System Hook ---
export function useCommandSystem({ setDialogueText, initialBackgroundColor, initialTextColor, getAllLabels, getAllBounds, availableStates = [], username, userUid, membershipLevel, updateSettings, settings, getEffectiveCharDims, zoomLevel, clipboardItems = [], toggleRecording, isReadOnly = false, getNormalizedSelection, setWorldData, worldData, setSelectionStart, setSelectionEnd, uploadImageToStorage, triggerUpgradeFlow, triggerTutorialFlow, onCommandExecuted, cancelComposition }: UseCommandSystemProps) {
    const router = useRouter();
    const backgroundStreamRef = useRef<MediaStream | undefined>(undefined);
    const previousBackgroundStateRef = useRef<{
        mode: BackgroundMode;
        color?: string;
        image?: string;
        video?: string;
        textColor: string;
        textBackground?: string;
    } | null>(null);
    const [commandState, setCommandState] = useState<CommandState>({
        isActive: false,
        input: '',
        matchedCommands: [],
        selectedIndex: 0,
        commandStartPos: { x: 0, y: 0 },
        originalCursorPos: { x: 0, y: 0 },
        hasNavigated: false
    });

    const [commandData, setCommandData] = useState<WorldData>({});
    const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(null);
    
    // Mode system state
    const [modeState, setModeState] = useState<ModeState>({
        currentMode: 'default',
        lightModeData: {},
        backgroundMode: 'color', // Default to color background
        backgroundColor: '#FFFFFF', // White background
        backgroundImage: undefined,
        backgroundVideo: undefined,
        backgroundStream: undefined,
        textColor: '#000000', // Black text on white background
        textBackground: undefined, // No text background by default
        fontFamily: 'IBM Plex Mono', // Default font
        currentTextStyle: {
            color: '#000000', // Default black text
            background: undefined
        },
        searchPattern: '', // No search pattern initially
        isSearchActive: false, // Search not active initially
        cameraMode: 'default', // Default camera mode for all devices
        isIndentEnabled: true, // Smart indentation enabled by default
        isMoveMode: false, // Move mode not active initially
        isPaintMode: false, // Paint mode not active initially
        gridMode: 'dots', // Default grid mode
        artefactsEnabled: false, // Artifacts enabled by default in space mode
        artifactType: 'images', // Default to image artifacts
        isFullscreenMode: false, // Fullscreen mode not active initially
        fullscreenRegion: undefined, // No fullscreen region initially
    });

    // Function to load saved color preferences
    const loadColorPreferences = useCallback((settings: WorldSettings) => {
        if (settings.backgroundColor || settings.textColor || settings.customBackground) {
            setModeState(prev => {
                const updates: Partial<ModeState> = {};
                
                if (settings.customBackground) {
                    // Load AI-generated background
                    if (settings.customBackground.type === 'ai-generated') {
                        if (settings.customBackground.content.includes('video') || settings.customBackground.content.includes('.mp4')) {
                            updates.backgroundMode = 'video';
                            updates.backgroundVideo = settings.customBackground.content;
                        } else {
                            updates.backgroundMode = 'image';
                            updates.backgroundImage = settings.customBackground.content;
                        }
                        updates.backgroundColor = undefined;
                    }
                } else if (settings.backgroundColor) {
                    // Load solid color background
                    updates.backgroundMode = 'color';
                    updates.backgroundColor = settings.backgroundColor;
                    updates.backgroundImage = undefined;
                    updates.backgroundVideo = undefined;
                }
                
                if (settings.textColor) {
                    updates.textColor = settings.textColor;
                    updates.currentTextStyle = {
                        color: settings.textColor,
                        background: prev.currentTextStyle.background
                    };
                }
                
                return { ...prev, ...updates };
            });
        }
    }, []);

    // Utility function to match commands based on input
    const matchCommands = useCallback((input: string): string[] => {
        let commandList = isReadOnly ? READ_ONLY_COMMANDS : AVAILABLE_COMMANDS;

        // Filter signin/signout based on authentication state
        const isAuthenticated = !!userUid;
        commandList = commandList.filter(cmd => {
            if (isAuthenticated && cmd === 'signin') return false; // Hide signin when authenticated
            if (!isAuthenticated && cmd === 'signout') return false; // Hide signout when not authenticated
            if (cmd === 'mail' && membershipLevel !== 'super') return false; // Hide mail unless super member
            return true;
        });

        if (!input) return commandList;
        const lowerInput = input.toLowerCase().split(' ')[0];
        
        // Special handling for mode command with subcommands
        if (lowerInput === 'mode') {
            const parts = input.toLowerCase().split(' ');
            if (parts.length > 1) {
                // Show mode subcommands that match the second part
                const modeInput = parts[1];
                return MODE_COMMANDS
                    .filter(mode => mode.startsWith(modeInput))
                    .map(mode => `mode ${mode}`);
            }
            return MODE_COMMANDS.map(mode => `mode ${mode}`);
        }

        if (lowerInput === 'bg') {
            const parts = input.toLowerCase().split(' ');
            if (parts.length > 1) {
                const bgInput = parts[1];
                // Combine BG_COMMANDS with color names from COLOR_MAP
                const colorNames = Object.keys(COLOR_MAP);
                const allOptions = [...BG_COMMANDS, ...colorNames];
                const suggestions = allOptions
                    .filter(bg => bg.startsWith(bgInput))
                    .map(bg => `bg ${bg}`);

                const currentCommand = `bg ${bgInput}`;
                if (bgInput.length > 0 && !suggestions.some(s => s === currentCommand)) {
                     return [currentCommand, ...suggestions];
                }
                return suggestions;
            }
            // Show all BG_COMMANDS plus all color names
            const colorNames = Object.keys(COLOR_MAP);
            const allOptions = [...BG_COMMANDS, ...colorNames];
            return allOptions.map(bg => `bg ${bg}`);
        }

        if (lowerInput === 'font') {
            const parts = input.toLowerCase().split(' ');
            if (parts.length > 1) {
                const fontInput = parts[1];
                const suggestions = FONT_COMMANDS
                    .filter(font => font.toLowerCase().startsWith(fontInput))
                    .map(font => `font ${font}`);
                
                const currentCommand = `font ${fontInput}`;
                if (fontInput.length > 0 && !suggestions.some(s => s === currentCommand)) {
                     return [currentCommand, ...suggestions];
                }
                return suggestions;
            }
            return FONT_COMMANDS.map(font => `font ${font}`);
        }

        if (lowerInput === 'nav') {
            const parts = input.toLowerCase().split(' ');
            const labels = getAllLabels ? getAllLabels() : [];
            const bounds = getAllBounds ? getAllBounds() : [];

            // Get label names
            const labelNames = labels.map(label => label.text.toLowerCase());

            // Get bound titles (fallback to bound[width] if no title)
            const boundNames = bounds.map(bound => {
                if (bound.title) {
                    return bound.title.toLowerCase();
                } else {
                    const width = bound.endX - bound.startX + 1;
                    return `bound[${width}]`;
                }
            });

            // Combine both labels and bounds
            const allTargets = [...labelNames, ...boundNames];

            if (parts.length > 1) {
                const navInput = parts[1];
                const suggestions = allTargets
                    .filter(target => target.startsWith(navInput))
                    .map(target => `nav ${target}`);

                const currentCommand = `nav ${navInput}`;
                if (navInput.length > 0 && !suggestions.some(s => s === currentCommand)) {
                     return [currentCommand, ...suggestions];
                }
                return suggestions;
            }
            return allTargets.length > 0 ? allTargets.map(target => `nav ${target}`) : ['nav'];
        }

        if (lowerInput === 'search') {
            const parts = input.split(' ');
            if (parts.length > 1) {
                // Return the full search command with its arguments
                return [input];
            }
            return ['search'];
        }

        if (lowerInput === 'state') {
            const parts = input.toLowerCase().split(' ');
            
            if (parts.length > 1) {
                const secondArg = parts[1];
                
                // Handle --rm flag
                if (secondArg === '--rm') {
                    if (parts.length > 2) {
                        // After --rm, show state suggestions that match the input
                        const stateInput = parts[2];
                        const suggestions = availableStates
                            .filter(state => state.toLowerCase().startsWith(stateInput))
                            .map(state => `state --rm ${state}`);
                        
                        const currentCommand = `state --rm ${stateInput}`;
                        if (stateInput.length > 0 && !suggestions.some(s => s === currentCommand)) {
                             return [currentCommand, ...suggestions];
                        }
                        return suggestions.length > 0 ? suggestions : [`state --rm ${stateInput}`];
                    }
                    // Just typed --rm, show all states for deletion
                    return availableStates.length > 0 ? availableStates.map(state => `state --rm ${state}`) : ['state --rm'];
                } else {
                    // Regular state command suggestions
                    const stateInput = secondArg;
                    const suggestions = availableStates
                        .filter(state => state.toLowerCase().startsWith(stateInput))
                        .map(state => `state ${state}`);
                    
                    const currentCommand = `state ${stateInput}`;
                    if (stateInput.length > 0 && !suggestions.some(s => s === currentCommand)) {
                         return [currentCommand, ...suggestions];
                    }
                    return suggestions.length > 0 ? suggestions : [`state ${stateInput}`];
                }
            }
            // Always show available states, or allow new state creation
            if (availableStates.length > 0) {
                return availableStates.map(state => `state ${state}`);
            } else {
                return ['state']; // Just show the command itself if no states exist
            }
        }

        if (lowerInput === 'label') {
            const parts = input.split(' ');

            if (parts.length > 1) {
                const secondArg = parts[1];

                // Handle --distance flag
                if (secondArg === '--distance') {
                    if (parts.length > 2) {
                        // User is typing the distance number
                        return [input];
                    }
                    // Just typed --distance, show example
                    return ['label --distance <number>'];
                } else if (parts.length === 2 && secondArg.startsWith("'")) {
                    // Typing quoted text - show as is
                    return [input];
                } else if (parts.length >= 2 && input.includes("'")) {
                    // Check if user is typing color after quoted text
                    const quoteMatch = input.match(/'([^']+)'\s*(\S*)$/);
                    if (quoteMatch && quoteMatch[2]) {
                        // User is typing color - show color suggestions
                        const colorInput = quoteMatch[2].toLowerCase();
                        const colorNames = Object.keys(COLOR_MAP);
                        const suggestions = colorNames
                            .filter(color => color.startsWith(colorInput))
                            .map(color => `label '${quoteMatch[1]}' ${color}`);
                        return suggestions.length > 0 ? suggestions : [input];
                    } else if (quoteMatch && quoteMatch[1] && input.endsWith("' ")) {
                        // Completed quoted text, show color options
                        const colorNames = Object.keys(COLOR_MAP);
                        return colorNames.map(color => `label '${quoteMatch[1]}' ${color}`);
                    }
                    return [input];
                } else {
                    // Regular label command - show as typed
                    return [input];
                }
            }
            return ['label', 'label --distance', "label 'text'", ...Object.keys(COLOR_MAP).map(color => `label 'text' ${color}`)];
        }

        if (lowerInput === 'task') {
            const parts = input.split(' ');

            if (parts.length > 1) {
                // User is typing color argument - show color suggestions
                const colorInput = parts[1].toLowerCase();
                const colorNames = Object.keys(COLOR_MAP);
                const suggestions = colorNames
                    .filter(color => color.startsWith(colorInput))
                    .map(color => `task ${color}`);
                return suggestions.length > 0 ? suggestions : [input];
            }
            // Show color examples
            return ['task', ...Object.keys(COLOR_MAP).map(color => `task ${color}`)];
        }

        if (lowerInput === 'text') {
            const parts = input.split(' ');

            if (parts.length > 1) {
                const secondArg = parts[1].toLowerCase();

                // Handle --g flag for global color update
                if (secondArg === '--g') {
                    if (parts.length > 2) {
                        // User is typing the color after --g
                        const colorInput = parts[2].toLowerCase();
                        const colorNames = Object.keys(COLOR_MAP);
                        const suggestions = colorNames
                            .filter(color => color.startsWith(colorInput))
                            .map(color => `text --g ${color}`);
                        return suggestions.length > 0 ? suggestions : [input];
                    }
                    // Just typed --g, show all color options
                    const colorNames = Object.keys(COLOR_MAP);
                    return colorNames.map(color => `text --g ${color}`);
                } else {
                    // Regular text command - show color suggestions
                    const colorNames = Object.keys(COLOR_MAP);
                    const suggestions = colorNames
                        .filter(color => color.startsWith(secondArg))
                        .map(color => `text ${color}`);
                    return suggestions.length > 0 ? suggestions : [input];
                }
            }
            // Show --g option and color examples
            return ['text --g', ...Object.keys(COLOR_MAP).map(color => `text ${color}`)];
        }

        if (lowerInput === 'list') {
            const parts = input.split(' ');

            if (parts.length > 1) {
                // User is typing color argument - show what they've typed
                return [input];
            }
            return ['list', 'list #FF8800', 'list #00FF00', 'list #0088FF'];
        }

        if (lowerInput === 'cam') {
            const parts = input.toLowerCase().split(' ');
            if (parts.length > 1) {
                // Show camera subcommands that match the second part
                const cameraInput = parts[1];
                return CAMERA_COMMANDS
                    .filter(camera => camera.startsWith(cameraInput))
                    .map(camera => `cam ${camera}`);
            }
            return CAMERA_COMMANDS.map(camera => `cam ${camera}`);
        }

        if (lowerInput === 'upload') {
            const parts = input.split(' ');

            if (parts.length > 1) {
                const secondArg = parts[1];

                // Handle --bitmap flag
                if (secondArg === '--bitmap') {
                    return ['upload --bitmap'];
                } else if ('--bitmap'.startsWith(secondArg)) {
                    return ['upload --bitmap'];
                }
            }
            return ['upload', 'upload --bitmap'];
        }

        if (lowerInput === 'clip') {
            // Show clipboard entries
            if (clipboardItems.length === 0) {
                return ['clip'];
            }
            return clipboardItems.map((item, idx) => {
                // Get first line of content, trimmed to max 50 chars
                const firstLine = item.content.split('\n')[0].trim();
                const preview = firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;
                return `clip ${idx} ${preview}`;
            });
        }

        return commandList.filter(cmd => cmd.toLowerCase().startsWith(lowerInput));
    }, [getAllLabels, getAllBounds, availableStates, clipboardItems, isReadOnly, userUid, membershipLevel]);

    // Mode switching functionality
    const switchMode = useCallback((newMode: CanvasMode) => {
        setModeState(prev => {
            // Clear air mode data when switching away from air mode
            const lightModeData = newMode === 'air' ? prev.lightModeData : {};
            
            return {
                ...prev,
                currentMode: newMode,
                lightModeData
            };
        });
    }, []);

    const switchBackgroundMode = useCallback((newMode: BackgroundMode, bgColor?: string, textColor?: string, textBg?: string, aiPrompt?: string): boolean => {
        if (newMode === 'color' && bgColor) {
            const hexBgColor = (COLOR_MAP[bgColor.toLowerCase()] || bgColor).toUpperCase();

            if (!/^#[0-9A-F]{6}$/i.test(hexBgColor)) {
                setDialogueWithRevert(`Invalid background color: ${bgColor}. Please use a name (e.g., white) or hex code (e.g., #1a1a1a).`, setDialogueText);
                return false;
            }
            
            let finalTextColor: string;
            let preserveCustomText = false;

            if (textColor) {
                // User specified text color - validate it
                const hexTextColor = (COLOR_MAP[textColor.toLowerCase()] || textColor).toUpperCase();
                if (!/^#[0-9A-F]{6}$/i.test(hexTextColor)) {
                    setDialogueWithRevert(`Invalid text color: ${textColor}. Please use a name (e.g., white) or hex code (e.g., #1a1a1a).`, setDialogueText);
                    return false;
                }
                finalTextColor = hexTextColor;
            } else if (settings?.hasCustomTextColor && settings?.textColor) {
                // User has previously set a custom text color via /text --g
                // Preserve it instead of auto-assigning
                finalTextColor = settings.textColor;
                preserveCustomText = true;
            } else {
                // Auto-assign text color based on background brightness for optimal contrast
                const rgb = parseInt(hexBgColor.substring(1), 16);
                const r = (rgb >> 16) & 0xff;
                const g = (rgb >>  8) & 0xff;
                const b = (rgb >>  0) & 0xff;
                const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                finalTextColor = luma < 128 ? '#FFFFFF' : '#000000';
            }

            let finalTextBg: string | undefined;
            if (textBg) {
                // User specified text background - validate it
                const hexTextBg = (COLOR_MAP[textBg.toLowerCase()] || textBg).toUpperCase();
                if (!/^#[0-9A-F]{6}$/i.test(hexTextBg)) {
                    setDialogueWithRevert(`Invalid text background: ${textBg}. Please use a name (e.g., white) or hex code (e.g., #1a1a1a).`, setDialogueText);
                    return false;
                }
                finalTextBg = hexTextBg;
            }

            setModeState(prev => ({
                ...prev,
                backgroundMode: 'color',
                backgroundColor: hexBgColor,
                textColor: finalTextColor,
                textBackground: finalTextBg,
                currentTextStyle: {
                    color: finalTextColor,
                    background: finalTextBg
                }
            }));

            // Save color preferences to settings
            if (updateSettings) {
                const newSettings = {
                    backgroundColor: hexBgColor,
                    textColor: finalTextColor,
                    customBackground: undefined // Clear any AI background when setting solid color
                };
                updateSettings(newSettings);
            }
        } else if (newMode === 'transparent') {
            const finalTextColor = textColor || '#FFFFFF'; // Default to white text for transparent background
            setModeState(prev => ({
                ...prev,
                backgroundMode: 'transparent',
                backgroundImage: undefined,
                textColor: finalTextColor,
                textBackground: textBg,
                currentTextStyle: {
                    color: finalTextColor,
                    background: textBg
                }
            }));

            // Save color preferences to settings
            if (updateSettings) {
                const newSettings = {
                    backgroundColor: undefined, // Transparent has no color
                    textColor: finalTextColor,
                    customBackground: undefined
                };
                updateSettings(newSettings);
            }
        } else if (newMode === 'space') {
            const finalTextColor = textColor || '#FFFFFF'; // Default to white text for space background
            setModeState(prev => ({
                ...prev,
                backgroundMode: 'space',
                backgroundImage: undefined,
                textColor: finalTextColor,
                textBackground: textBg,
                currentTextStyle: {
                    color: finalTextColor,
                    background: textBg
                }
            }));

            // Save color preferences to settings
            if (updateSettings) {
                const newSettings = {
                    backgroundColor: undefined, // Space mode has no solid color
                    textColor: finalTextColor,
                    customBackground: undefined
                };
                updateSettings(newSettings);
            }
        } else if (newMode === 'image' && bgColor) {
            // bgColor is actually the image URL/data for image mode
            const finalTextColor = textColor || '#FFFFFF'; // Default to white text on images
            setModeState(prev => ({
                ...prev,
                backgroundMode: 'image',
                backgroundImage: bgColor, // Using bgColor parameter as image URL
                backgroundVideo: undefined,
                textColor: finalTextColor,
                textBackground: textBg,
                currentTextStyle: {
                    color: finalTextColor,
                    background: textBg
                }
            }));

            // Save AI-generated background to settings if prompt is provided
            if (updateSettings && aiPrompt) {
                const newSettings = {
                    backgroundColor: undefined,
                    textColor: finalTextColor,
                    customBackground: {
                        type: 'ai-generated' as const,
                        content: bgColor,
                        prompt: aiPrompt
                    }
                };
                updateSettings(newSettings);
            }
        } else if (newMode === 'video' && bgColor) {
            // bgColor is actually the video URL/data for video mode
            const finalTextColor = textColor || '#FFFFFF'; // Default to white text on videos
            setModeState(prev => ({
                ...prev,
                backgroundMode: 'video',
                backgroundImage: undefined,
                backgroundVideo: bgColor, // Using bgColor parameter as video URL
                textColor: finalTextColor,
                textBackground: textBg,
                currentTextStyle: {
                    color: finalTextColor,
                    background: textBg
                }
            }));

            // Save AI-generated video background to settings if prompt is provided
            if (updateSettings && aiPrompt) {
                const newSettings = {
                    backgroundColor: undefined,
                    textColor: finalTextColor,
                    customBackground: {
                        type: 'ai-generated' as const,
                        content: bgColor,
                        prompt: aiPrompt
                    }
                };
                updateSettings(newSettings);
            }
        } else if (newMode === 'stream') {
            // Stream mode for screen sharing
            const finalTextColor = textColor || '#FFFFFF'; // Default to white text on stream
            setModeState(prev => ({
                ...prev,
                backgroundMode: 'stream',
                backgroundImage: undefined,
                backgroundVideo: undefined,
                textColor: finalTextColor,
                textBackground: textBg,
                currentTextStyle: {
                    color: finalTextColor,
                    background: textBg
                }
            }));
            // Don't save stream mode to settings as it's temporary
        }
        return true;
    }, [setDialogueText, updateSettings]);

    useEffect(() => {
        if (initialBackgroundColor && modeState.backgroundMode !== 'stream') {
            switchBackgroundMode('color', initialBackgroundColor, initialTextColor);
        }
    }, [initialBackgroundColor, initialTextColor]); // Removed switchBackgroundMode to avoid dependency issues

    // Load color preferences from settings when they change
    useEffect(() => {
        if (settings) {
            loadColorPreferences(settings);
        }
    }, [settings, loadColorPreferences]);

    // Add ephemeral text (disappears after delay)
    const addEphemeralText = useCallback((pos: Point, char: string, options?: {
        animationDelay?: number;
        frameDelay?: number;
        color?: string;
        background?: string;
    }) => {

        const key = `${pos.x},${pos.y}`;
        const animationDelay = options?.animationDelay || 1500;
        const frameDelay = options?.frameDelay || 80;

        // Symbol sequence for despawn animation - progressive decay
        const despawnSymbols = ['@', '#', '*', '=', ';', ':', '•', '·', '.'];
        let symbolIndex = 0;

        // Set initial character with optional color and background (using StyledCharacter format)
        const charData = (options?.color || options?.background)
            ? {
                char,
                style: {
                    ...(options.color && { color: options.color }),
                    ...(options.background && { background: options.background })
                }
              }
            : char;
        setModeState(prev => ({
            ...prev,
            lightModeData: {
                ...prev.lightModeData,
                [key]: charData
            }
        }));
        
        // Simple fade-out after specified delay
        setTimeout(() => {
            // Remove the character directly without animation
            setModeState(prev => {
                const newLightModeData = { ...prev.lightModeData };
                delete newLightModeData[key];
                return {
                    ...prev,
                    lightModeData: newLightModeData
                };
            });
        }, animationDelay);
    }, [modeState.currentMode]);

    // Calculate dynamic wrap width based on query text
    const calculateResponseWidth = useCallback((queryText: string, minWidth: number = 15): number => {
        const queryLines = queryText.split('\n');
        const maxQueryLineLength = Math.max(...queryLines.map(line => line.length));
        return Math.max(minWidth, maxQueryLineLength);
    }, []);

    // Add AI response as ephemeral text with typewriter effect
    const addAIResponse = useCallback((startPos: Point, text: string, options?: {
        wrapWidth?: number;
        typewriterSpeed?: number;
        lineDelay?: number;
        color?: string;
        persistTime?: number;
        queryText?: string; // Add queryText to calculate dynamic width
    }) => {
        
        const wrapWidth = options?.wrapWidth || (options?.queryText ? calculateResponseWidth(options.queryText) : 30);
        const typewriterSpeed = options?.typewriterSpeed || 50;
        const lineDelay = options?.lineDelay || 150;
        const color = options?.color || '#808080'; // Gray for AI responses (same as regular ephemeral text)
        const persistTime = options?.persistTime || 3000; // Longer persistence for AI
        
        // Text wrapping that honors paragraph breaks
        const wrapText = (text: string, maxWidth: number): string[] => {
            // First split by paragraph breaks
            const paragraphs = text.split('\n');
            const lines: string[] = [];
            
            for (let i = 0; i < paragraphs.length; i++) {
                const paragraph = paragraphs[i].trim();
                
                if (paragraph === '') {
                    // Empty line for paragraph break
                    lines.push('');
                    continue;
                }
                
                // Wrap this paragraph
                const words = paragraph.split(' ');
                let currentLine = '';
                
                for (const word of words) {
                    const testLine = currentLine ? `${currentLine} ${word}` : word;
                    if (testLine.length <= maxWidth) {
                        currentLine = testLine;
                    } else {
                        if (currentLine) {
                            lines.push(currentLine);
                            currentLine = word;
                        } else {
                            // Word is longer than line, split it
                            lines.push(word.substring(0, maxWidth));
                            currentLine = word.substring(maxWidth);
                        }
                    }
                }
                if (currentLine) lines.push(currentLine);
            }
            return lines;
        };
        
        const wrappedLines = wrapText(text, wrapWidth);
        let lineIndex = 0;
        let charIndex = 0;
        const allCharPositions: Array<{ x: number; y: number; char: string }> = [];
        
        // Calculate total typing time to delay fade start
        const totalChars = wrappedLines.reduce((sum, line) => sum + line.length, 0);
        const totalLines = wrappedLines.length;
        const totalTypingTime = (totalChars * typewriterSpeed) + (totalLines * lineDelay);
        
        const typeNextChar = () => {
            if (lineIndex >= wrappedLines.length) return;
            
            const currentLine = wrappedLines[lineIndex];
            if (charIndex < currentLine.length) {
                const char = currentLine[charIndex];
                const x = startPos.x + charIndex;
                const y = startPos.y + lineIndex;
                
                // Store for later cleanup
                allCharPositions.push({ x, y, char });
                
                // Add character with delayed fade (starts after all typing is done)
                addEphemeralText({ x, y }, char, {
                    color: color,
                    animationDelay: totalTypingTime + persistTime
                });
                
                charIndex++;
                setTimeout(typeNextChar, typewriterSpeed);
            } else {
                // Move to next line
                lineIndex++;
                charIndex = 0;
                if (lineIndex < wrappedLines.length) {
                    setTimeout(typeNextChar, lineDelay);
                }
            }
        };
        
        typeNextChar();
    }, [addEphemeralText, modeState.currentMode, calculateResponseWidth]);
    
    // Add instant AI response with character-by-character fade
    const addInstantAIResponse = useCallback((startPos: Point, text: string, options?: {
        wrapWidth?: number;
        fadeDelay?: number;  // Delay before starting fade
        fadeInterval?: number;  // Delay between each character fade
        color?: string;
        queryText?: string;
        centered?: boolean; // Whether to center the text (default true for backwards compatibility)
    }) => {
        // Calculate intelligent wrap width based on viewport (like dialogue system)
        const BASE_FONT_SIZE = 16;
        const BASE_CHAR_WIDTH = BASE_FONT_SIZE * 0.6;
        const { width: effectiveCharWidth } = getEffectiveCharDims(zoomLevel);
        const charWidth = effectiveCharWidth || BASE_CHAR_WIDTH;

        const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 800;
        const availableWidthChars = Math.floor(viewportWidth / charWidth);
        const MARGIN_CHARS = 8; // Comfortable margin on each side
        const MAX_WIDTH_CHARS = 60; // Maximum for readability

        const intelligentWrapWidth = Math.min(MAX_WIDTH_CHARS, availableWidthChars - (2 * MARGIN_CHARS));
        const wrapWidth = options?.wrapWidth || intelligentWrapWidth;

        const fadeDelay = options?.fadeDelay || 3000;  // Wait 3 seconds before starting fade
        const fadeInterval = options?.fadeInterval || 50;  // 50ms between each character fade
        const color = options?.color || '#808080';
        
        // Text wrapping that honors paragraph breaks
        const wrapText = (text: string, maxWidth: number): string[] => {
            const paragraphs = text.split('\n');
            const lines: string[] = [];
            
            for (let i = 0; i < paragraphs.length; i++) {
                const paragraph = paragraphs[i].trim();
                
                if (paragraph === '') {
                    lines.push('');
                    continue;
                }
                
                const words = paragraph.split(' ');
                let currentLine = '';
                
                for (const word of words) {
                    const testLine = currentLine ? `${currentLine} ${word}` : word;
                    if (testLine.length <= maxWidth) {
                        currentLine = testLine;
                    } else {
                        if (currentLine) {
                            lines.push(currentLine);
                            currentLine = word;
                        } else {
                            lines.push(word.substring(0, maxWidth));
                            currentLine = word.substring(maxWidth);
                        }
                    }
                }
                if (currentLine) lines.push(currentLine);
            }
            return lines;
        };
        
        const wrappedLines = wrapText(text, wrapWidth);
        const allCharPositions: Array<{ x: number; y: number; char: string }> = [];

        // Calculate dimensions for centering
        const maxLineWidth = Math.max(...wrappedLines.map(line => line.length));
        const totalHeight = wrappedLines.length;

        // Offset startPos to center the text block (unless centered: false)
        const centeredStartX = options?.centered !== false
            ? Math.floor(startPos.x - maxLineWidth / 2)
            : startPos.x;
        const centeredStartY = options?.centered !== false
            ? Math.floor(startPos.y - totalHeight / 2)
            : startPos.y;

        // Add all characters instantly
        let y = centeredStartY;
        wrappedLines.forEach(line => {
            for (let x = 0; x < line.length; x++) {
                const char = line[x];
                const worldX = centeredStartX + x;
                allCharPositions.push({ x: worldX, y, char });

                // Add character instantly with no initial fade
                addEphemeralText({ x: worldX, y }, char, {
                    color: color,
                    animationDelay: fadeDelay + (allCharPositions.length * fadeInterval)  // Stagger fade times
                });
            }
            y++;
        });

        return { width: maxLineWidth, height: totalHeight };
    }, [addEphemeralText, calculateResponseWidth]);

    // Start command mode when '/' is pressed
    const startCommand = useCallback((cursorPos: Point) => {
        // Initialize command display
        const newCommandData: WorldData = {};
        const commandText = '/';

        // Draw initial '/' at cursor position
        const key = `${cursorPos.x},${cursorPos.y}`;
        newCommandData[key] = '/';

        // Filter commands based on authentication state
        const isAuthenticated = !!userUid;

        // Draw all available commands below with category labels
        let currentY = cursorPos.y + 1;
        Object.entries(COMMAND_CATEGORIES).forEach(([categoryName, commands]) => {
            // Filter commands in this category based on auth state and membership
            const filteredCommands = commands.filter(cmd => {
                if (isAuthenticated && cmd === 'signin') return false;
                if (!isAuthenticated && cmd === 'signout') return false;
                if (cmd === 'mail' && membershipLevel !== 'super') return false; // Hide mail unless super
                return true;
            });

            // Skip empty categories
            if (filteredCommands.length === 0) return;

            filteredCommands.forEach((command, indexInCategory) => {
                // Draw category label to the left of first command in category with lighter background
                if (indexInCategory === 0) {
                    for (let i = 0; i < categoryName.length; i++) {
                        const labelKey = `${cursorPos.x - categoryName.length + i},${currentY}`;
                        newCommandData[labelKey] = {
                            char: categoryName[i],
                            style: {
                                background: 'category-label', // Special marker for category labels
                                color: categoryName // Store category name for hover detection
                            }
                        };
                    }
                }

                // Draw command
                for (let i = 0; i < command.length; i++) {
                    const cmdKey = `${cursorPos.x + i},${currentY}`;
                    newCommandData[cmdKey] = command[i];
                }
                currentY++;
            });
        });

        setCommandData(newCommandData);
        setCommandState({
            isActive: true,
            input: '',
            matchedCommands: matchCommands(''), // Use matchCommands to apply authentication filtering
            selectedIndex: 0,
            commandStartPos: { x: cursorPos.x, y: cursorPos.y },
            originalCursorPos: { x: cursorPos.x, y: cursorPos.y }, // Store original position
            hasNavigated: false
        });
    }, [isReadOnly, matchCommands, userUid, membershipLevel]);

    // Handle character input in command mode
    const addCharacter = useCallback((char: string) => {
        setCommandState(prev => {
            const newInput = prev.input + char;
            const newMatchedCommands = matchCommands(newInput);
            
            // Update command display at original command start position
            const newCommandData: WorldData = {};
            const commandText = `/${newInput}`;
            
            // Draw command text at original command start position
            for (let i = 0; i < commandText.length; i++) {
                const key = `${prev.commandStartPos.x + i},${prev.commandStartPos.y}`;
                newCommandData[key] = commandText[i];
            }
            
            // Draw autocomplete suggestions below
            newMatchedCommands.forEach((command, index) => {
                const suggestionY = prev.commandStartPos.y + 1 + index;
                for (let i = 0; i < command.length; i++) {
                    const key = `${prev.commandStartPos.x + i},${suggestionY}`;
                    newCommandData[key] = command[i];
                }
            });
            
            setCommandData(newCommandData);
            
            return {
                ...prev,
                input: newInput,
                matchedCommands: newMatchedCommands,
                selectedIndex: Math.min(prev.selectedIndex, newMatchedCommands.length - 1),
                hasNavigated: false // Reset navigation when typing
            };
        });
    }, [matchCommands]);

    // Handle backspace in command mode
    const handleBackspace = useCallback((): { shouldExitCommand: boolean; shouldMoveCursor: boolean } => {
        // If no input characters, signal to exit command mode
        if (commandState.input.length === 0) {
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});
            return { shouldExitCommand: true, shouldMoveCursor: true };
        }
        
        // Remove last character from command input and display
        setCommandState(prev => {
            const newInput = prev.input.slice(0, -1);
            const newMatchedCommands = matchCommands(newInput);
            
            // Update command display
            const newCommandData: WorldData = {};
            const commandText = `/${newInput}`;
            
            // Draw command text at original command start position
            for (let i = 0; i < commandText.length; i++) {
                const key = `${prev.commandStartPos.x + i},${prev.commandStartPos.y}`;
                newCommandData[key] = commandText[i];
            }
            
            // Draw autocomplete suggestions below
            newMatchedCommands.forEach((command, index) => {
                const suggestionY = prev.commandStartPos.y + 1 + index;
                for (let i = 0; i < command.length; i++) {
                    const key = `${prev.commandStartPos.x + i},${suggestionY}`;
                    newCommandData[key] = command[i];
                }
            });
            
            setCommandData(newCommandData);
            
            return {
                ...prev,
                input: newInput,
                matchedCommands: newMatchedCommands,
                selectedIndex: Math.min(prev.selectedIndex, newMatchedCommands.length - 1),
                hasNavigated: false // Reset navigation when backspacing
            };
        });
        
        return { shouldExitCommand: false, shouldMoveCursor: true };
    }, [commandState.input.length, matchCommands]);

    // Navigate command suggestions
    const navigateUp = useCallback(() => {
        setCommandState(prev => ({
            ...prev,
            selectedIndex: Math.max(0, prev.selectedIndex - 1),
            hasNavigated: true
        }));
    }, []);

    const navigateDown = useCallback(() => {
        setCommandState(prev => ({
            ...prev,
            selectedIndex: Math.min(prev.matchedCommands.length - 1, prev.selectedIndex + 1),
            hasNavigated: true
        }));
    }, []);

    // Execute selected command
    const executeCommand = useCallback(async (isPermanent: boolean = false): Promise<CommandExecution | null> => {
        // If user hasn't navigated with arrow keys, use their raw input instead of selected suggestion
        const fullInput = commandState.input.trim();

        // Allow execution even with no matches - treat as AI prompt
        const commandToExecute = commandState.hasNavigated && commandState.matchedCommands.length > 0
            ? commandState.matchedCommands[commandState.selectedIndex]
            : fullInput;

        if (!commandToExecute) return null; // Safety check for undefined command

        const inputParts = commandToExecute.split(/\s+/);
        const commandName = inputParts[0];
        
        // Handle mode switching commands directly
        if (commandName === 'mode') {
            if (inputParts.length === 1) {
                // User typed just 'mode' - clear to default mode (like /state clears canvas)
                switchMode('default');
            } else if (inputParts.length === 2) {
                // User typed 'mode <something>' - use their specified mode
                const modeArg = inputParts[1] as CanvasMode;
                if (MODE_COMMANDS.includes(modeArg)) {
                    if (modeArg === 'chat') {
                        // For chat mode, redirect to /chat
                        router.push('/chat');
                    } else {
                        // For other modes, switch mode in current context
                        switchMode(modeArg);
                        if (modeArg === 'note') {
                            setDialogueWithRevert("Note mode: Make selections and press Enter to save. Esc to exit.", setDialogueText);
                        }
                    }
                }
            }
            
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});
            
            return null; // Mode switches don't need further processing
        }

        // Handle tab/autocomplete toggle
        if (commandName === 'tab') {
            if (updateSettings) {
                updateSettings({
                    isAutocompleteEnabled: !settings?.isAutocompleteEnabled
                });
                const newState = !settings?.isAutocompleteEnabled;
                setDialogueWithRevert(
                    `Autocomplete ${newState ? 'enabled' : 'disabled'}`,
                    setDialogueText
                );
            }

            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            return null; // Autocomplete toggle doesn't need further processing
        }

        if (commandToExecute.startsWith('bg')) {
            const inputParts = commandState.input.trim().split(/\s+/);
            const bgArg = inputParts.length > 1 ? inputParts[1] : undefined;

            // Extract optional parameters
            const param2 = inputParts.length > 2 ? inputParts[2] : undefined;
            const param3 = inputParts.length > 3 ? inputParts[3] : undefined;
            const restOfInput = inputParts.slice(1).join(' '); // Everything after /bg

            // Check if /bg was called with no args and there's an image at cursor position
            if (!bgArg && worldData) {
                // Look for an image at the command start position
                for (const key in worldData) {
                    if (key.startsWith('image_')) {
                        const imgData = worldData[key];
                        if (imgData && typeof imgData === 'object' && 'type' in imgData && imgData.type === 'image') {
                            const img = imgData as any;
                            // Check if command was typed over this image
                            if (commandState.commandStartPos.x >= img.startX && commandState.commandStartPos.x <= img.endX &&
                                commandState.commandStartPos.y >= img.startY && commandState.commandStartPos.y <= img.endY) {

                                // Store previous background state
                                previousBackgroundStateRef.current = {
                                    mode: modeState.backgroundMode,
                                    color: modeState.backgroundColor,
                                    image: modeState.backgroundImage,
                                    video: modeState.backgroundVideo,
                                    textColor: modeState.textColor,
                                    textBackground: modeState.textBackground
                                };

                                // Set image as background temporarily
                                switchBackgroundMode('image', img.src, '#FFFFFF');
                                setDialogueWithRevert("Press ESC to restore background", setDialogueText);

                                // Clear command mode
                                setCommandState({
                                    isActive: false,
                                    input: '',
                                    matchedCommands: [],
                                    selectedIndex: 0,
                                    commandStartPos: { x: 0, y: 0 },
                                    originalCursorPos: { x: 0, y: 0 },
                                    hasNavigated: false
                                });
                                setCommandData({});

                                return null;
                            }
                        }
                    }
                }
            }

            if (bgArg) {
                // Check if this is a webcam request
                if (bgArg.toLowerCase() === 'webcam') {
                    try {
                        // Determine which camera to use based on param2
                        let facingMode: 'user' | 'environment' = 'environment'; // Default to back camera
                        let cameraLabel = 'back';

                        if (param2) {
                            const cameraArg = param2.toLowerCase();
                            if (cameraArg === 'front') {
                                facingMode = 'user';
                                cameraLabel = 'front';
                            } else if (cameraArg === 'back') {
                                facingMode = 'environment';
                                cameraLabel = 'back';
                            }
                        }

                        // Request webcam access
                        const stream = await navigator.mediaDevices.getUserMedia({
                            video: {
                                width: { ideal: 1920 },
                                height: { ideal: 1080 },
                                facingMode: facingMode
                            },
                            audio: false
                        });

                        // Stop any existing stream
                        if (backgroundStreamRef.current) {
                            backgroundStreamRef.current.getTracks().forEach(track => track.stop());
                        }

                        // Store stream reference
                        backgroundStreamRef.current = stream;

                        // Switch to stream background mode (use param3 for text color if provided)
                        switchBackgroundMode('stream', undefined, param3);
                        setDialogueWithRevert(`Webcam background active (${cameraLabel} camera)`, setDialogueText);
                    } catch (error) {
                        console.error('Failed to access webcam:', error);
                        setDialogueWithRevert("Failed to access webcam. Please grant camera permission.", setDialogueText);
                    }

                    // Clear command mode
                    setCommandState({
                        isActive: false,
                        input: '',
                        matchedCommands: [],
                        selectedIndex: 0,
                        commandStartPos: { x: 0, y: 0 },
                        originalCursorPos: { x: 0, y: 0 },
                        hasNavigated: false
                    });
                    setCommandData({});

                    return null;
                }
                // Check if this is a video background request
                else if (bgArg.toLowerCase() === 'video' || bgArg.toLowerCase().endsWith('.mp4')) {
                    // Determine video URL
                    let videoUrl: string;
                    if (bgArg.toLowerCase() === 'video') {
                        // Default to forest.mp4 in public directory
                        videoUrl = '/forest.mp4';
                    } else if (bgArg.startsWith('http://') || bgArg.startsWith('https://') || bgArg.startsWith('/')) {
                        // Use provided URL or path directly
                        videoUrl = bgArg;
                    } else {
                        // Assume it's in public directory
                        videoUrl = `/${bgArg}`;
                    }
                    
                    // Switch to video background mode
                    switchBackgroundMode('video', videoUrl, param2, param3);
                } else {
                    // Format: /bg {backgroundColor} {textColor} {textBackground}
                    // All parameters are optional
                    switchBackgroundMode('color', bgArg, param2, param3);
                }
            } else {
                // No arguments - default to white background
                switchBackgroundMode('color', '#FFFFFF');
            }

            // Notify tutorial flow that bg command was executed
            if (onCommandExecuted) {
                const args = inputParts.slice(1);
                onCommandExecuted('bg', args);
            }

            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            return null;
        }

        if (commandToExecute.startsWith('text')) {
            const inputParts = commandState.input.trim().split(/\s+/);
            const firstArg = inputParts.length > 1 ? inputParts[1] : undefined;

            // Check if --g flag is present for global update
            const isGlobal = firstArg === '--g';
            const colorArg = isGlobal ? (inputParts.length > 2 ? inputParts[2] : undefined) : firstArg;
            const backgroundArg = isGlobal ? (inputParts.length > 3 ? inputParts[3] : undefined) : (inputParts.length > 2 ? inputParts[2] : undefined);

            if (colorArg) {
                // Validate color format (hex code or named colors)
                let finalTextColor: string;
                if (colorArg.toLowerCase() === 'default') {
                    // Reset to default text color
                    finalTextColor = modeState.textColor; // Use current global text color
                } else {
                    const hexColor = (COLOR_MAP[colorArg.toLowerCase()] || colorArg).toUpperCase();
                    if (!/^#[0-9A-F]{6}$/i.test(hexColor)) {
                        setDialogueWithRevert(`Invalid color: ${colorArg}. Use hex code (e.g., #FF0000) or name (e.g., red, blue).`, setDialogueText);
                        // Clear command mode
                        setCommandState({
                            isActive: false,
                            input: '',
                            matchedCommands: [],
                            selectedIndex: 0,
                            commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                            hasNavigated: false
                        });
                        setCommandData({});
                        return null;
                    }
                    finalTextColor = hexColor;
                }
                
                let finalTextBackground: string | undefined;
                if (backgroundArg) {
                    if (backgroundArg.toLowerCase() === 'none') {
                        finalTextBackground = undefined;
                    } else {
                        const hexBackground = (COLOR_MAP[backgroundArg.toLowerCase()] || backgroundArg).toUpperCase();
                        if (!/^#[0-9A-F]{6}$/i.test(hexBackground)) {
                            setDialogueWithRevert(`Invalid background color: ${backgroundArg}. Use hex code or name.`, setDialogueText);
                            // Clear command mode
                            setCommandState({
                                isActive: false,
                                input: '',
                                matchedCommands: [],
                                selectedIndex: 0,
                                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                                hasNavigated: false
                            });
                            setCommandData({});
                            return null;
                        }
                        finalTextBackground = hexBackground;
                    }
                }
                
                if (isGlobal) {
                    // Update global text color (affects all text)
                    setModeState(prev => ({
                        ...prev,
                        textColor: finalTextColor,
                        textBackground: finalTextBackground,
                        currentTextStyle: {
                            color: finalTextColor,
                            background: finalTextBackground
                        }
                    }));

                    // Save to settings and mark as custom text color
                    if (updateSettings) {
                        const newSettings = {
                            textColor: finalTextColor,
                            hasCustomTextColor: true
                        };
                        updateSettings(newSettings);
                    }

                    const styleMsg = finalTextBackground ?
                        `Global text: ${finalTextColor} on ${finalTextBackground}` :
                        `Global text color: ${finalTextColor}`;
                    setDialogueWithRevert(styleMsg, setDialogueText);
                } else {
                    // Update the persistent text style for individual character styling only
                    setModeState(prev => ({
                        ...prev,
                        currentTextStyle: {
                            color: finalTextColor,
                            background: finalTextBackground
                        }
                    }));

                    const styleMsg = finalTextBackground ?
                        `Text style: ${finalTextColor} on ${finalTextBackground}` :
                        `Text color: ${finalTextColor}`;
                    setDialogueWithRevert(styleMsg, setDialogueText);
                }
            } else {
                // Reset to default text style
                setModeState(prev => ({
                    ...prev,
                    currentTextStyle: {
                        color: prev.textColor, // Reset to global text color
                        background: undefined
                    }
                }));
                setDialogueWithRevert("Text style reset to default", setDialogueText);
            }

            // Notify tutorial flow that text command was executed
            if (onCommandExecuted) {
                const args = inputParts.slice(1);
                onCommandExecuted('text', args);
            }

            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            return null;
        }

        if (commandToExecute.startsWith('font')) {
            // Parse the full command (e.g., "font IBM Plex Mono" or "font Apercu Pro")
            const fontCommandParts = commandToExecute.split(' ');
            const fontName = fontCommandParts.slice(1).join(' '); // Join all parts after "font"
            
            if (fontName) {
                // Check if the font name exactly matches one of our available fonts
                const selectedFont = FONT_COMMANDS.find(font => 
                    font.toLowerCase() === fontName.toLowerCase()
                );
                
                if (selectedFont) {
                    // Update font in mode state
                    setModeState(prev => ({
                        ...prev,
                        fontFamily: selectedFont
                    }));
                    setDialogueWithRevert(`Font changed to: ${selectedFont}`, setDialogueText);
                } else {
                    setDialogueWithRevert(`Font not found. Available fonts: ${FONT_COMMANDS.join(', ')}`, setDialogueText);
                }
            } else {
                // No font specified - show available fonts
                setDialogueWithRevert(`Available fonts: ${FONT_COMMANDS.join(', ')}`, setDialogueText);
            }
            
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});
            
            return null;
        }

        if (commandToExecute.startsWith('nav')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            // Use the command to execute instead of the typed input
            // Extract target name from command (format: "nav targetname")
            const commandParts = commandToExecute.split(' ');
            const targetQuery = commandParts.slice(1).join(' ');

            if (targetQuery) {
                // Try to find a matching label first
                if (getAllLabels) {
                    const labels = getAllLabels();
                    const targetLabel = labels.find(label =>
                        label.text.toLowerCase() === targetQuery.toLowerCase()
                    );

                    if (targetLabel) {
                        return {
                            command: 'nav',
                            args: [targetLabel.x.toString(), targetLabel.y.toString()],
                            commandStartPos: commandState.commandStartPos
                        };
                    }
                }

                // If no label found, try to find a matching bound
                if (getAllBounds) {
                    const bounds = getAllBounds();
                    const targetBound = bounds.find(bound => {
                        if (bound.title) {
                            return bound.title.toLowerCase() === targetQuery.toLowerCase();
                        } else {
                            const width = bound.endX - bound.startX + 1;
                            return `bound[${width}]` === targetQuery.toLowerCase();
                        }
                    });

                    if (targetBound) {
                        // Navigate to center of bound
                        const boundCenterX = Math.floor((targetBound.startX + targetBound.endX) / 2);
                        return {
                            command: 'nav',
                            args: [boundCenterX.toString(), targetBound.startY.toString()],
                            commandStartPos: commandState.commandStartPos
                        };
                    }
                }
            }

            return { command: 'nav', args: [], commandStartPos: commandState.commandStartPos };
        }

        if (commandToExecute.startsWith('search')) {
            const inputParts = commandState.input.trim().split(/\s+/);
            const searchTerm = inputParts.slice(1).join(' ');
            
            if (searchTerm) {
                // Activate search with the term
                setModeState(prev => ({
                    ...prev,
                    searchPattern: searchTerm,
                    isSearchActive: true
                }));
                setDialogueWithRevert(`Search active: "${searchTerm}" - Press Escape to clear`, setDialogueText);
            } else {
                // No search term - clear search
                setModeState(prev => ({
                    ...prev,
                    searchPattern: '',
                    isSearchActive: false
                }));
                setDialogueWithRevert("Search cleared", setDialogueText);
            }
            
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});
            
            return null;
        }

        if (commandToExecute.startsWith('state')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});
            
            // Parse the command to execute
            const commandParts = commandToExecute.split(' ');
            const args = commandParts.slice(1); // Everything after 'state'
            
            // Don't execute if user selected a placeholder (shouldn't happen now)
            if (args.length === 1 && args[0] === '<name>') {
                setDialogueWithRevert("Please specify a state name", setDialogueText);
                return null;
            }
            
            // Handle navigation for state commands
            if (username) {
                if (args.length === 0) {
                    // Navigate to user's homepage (no state)
                    router.push(`/@${username}`);
                    return null;
                } else if (args[0] === '--rm') {
                    // Delete command - let world engine handle it
                    return {
                        command: 'state',
                        args: args,
                        commandStartPos: commandState.commandStartPos
                    };
                } else {
                    const stateName = args[0];
                    // Navigate to state page
                    router.push(`/@${username}/${stateName}`);
                    return null;
                }
            }
            
            // Fallback: Return command execution for world engine to handle (old behavior)
            return {
                command: 'state',
                args: args,
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('random')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});
            
            // Navigate to a random existing state
            if (username && availableStates.length > 0) {
                // Pick a random state from available states
                const randomIndex = Math.floor(Math.random() * availableStates.length);
                const randomStateName = availableStates[randomIndex];
                
                // Navigate to random existing state page
                router.push(`/@${username}/${randomStateName}`);
                setDialogueWithRevert(`Random state: ${randomStateName}`, setDialogueText);
                return null;
            } else if (availableStates.length === 0) {
                setDialogueWithRevert("No existing states found to navigate to", setDialogueText);
                return null;
            }
            
            // Fallback: Return command execution for world engine to handle (old behavior)
            return {
                command: 'random',
                args: [],
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('publish')) {
            // Parse arguments for --region flag
            const parts = commandToExecute.split(/\s+/);
            const hasRegionFlag = parts.includes('--region');

            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            // Return command execution for world engine to handle
            return {
                command: 'publish',
                args: hasRegionFlag ? ['--region'] : [],
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('replay')) {
            // Parse arguments for speed parameter (default 100ms between characters)
            const parts = commandToExecute.split(/\s+/);
            const speed = parts.length > 1 ? parseInt(parts[1], 10) : 100;

            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            // Return command execution for world engine to handle
            return {
                command: 'replay',
                args: [speed.toString()],
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('cluster')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});
            
            // Return command execution for world engine to handle cluster generation
            return {
                command: 'cluster',
                args: [],
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('frames')) {
            // Parse frames command arguments
            const parts = commandToExecute.split(' ');
            const args = parts.slice(1); // Remove 'frames' from args
            
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});
            
            // Return command execution for world engine to handle frame toggling
            return {
                command: 'frames',
                args: args,
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('clear')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            // Return command execution for world engine to handle clearing the canvas
            return {
                command: 'clear',
                args: [],
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('clip')) {
            const parts = commandToExecute.split(' ');

            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            // If user selected a specific clipboard entry
            if (parts.length > 1) {
                const clipIndex = parseInt(parts[1]);
                if (!isNaN(clipIndex) && clipIndex >= 0 && clipIndex < clipboardItems.length) {
                    const clipItem = clipboardItems[clipIndex];
                    // Return command execution for world engine to paste clipboard content
                    return {
                        command: 'clip',
                        args: [clipIndex.toString()],
                        commandStartPos: commandState.commandStartPos,
                        clipContent: clipItem.content
                    };
                }
            }

            // No selection or invalid index
            setDialogueWithRevert("No clipboard item selected", setDialogueText);
            return null;
        }

        if (commandToExecute.startsWith('cam')) {
            const parts = commandToExecute.split(' ');
            const cameraMode = parts[1];

            if (CAMERA_COMMANDS.includes(cameraMode)) {
                // Update camera mode in state
                setModeState(prev => ({
                    ...prev,
                    cameraMode: cameraMode as CameraMode
                }));

                // Return command execution to let world engine calculate initial offset
                setCommandData({});
                setCommandState({
                    isActive: false,
                    input: '',
                    matchedCommands: [],
                    selectedIndex: 0,
                    commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                    hasNavigated: false
                });

                return {
                    command: 'cam',
                    args: [cameraMode],
                    commandStartPos: commandState.commandStartPos
                };
            } else if (!cameraMode) {
                setDialogueWithRevert(`Current camera mode: ${modeState.cameraMode}`, setDialogueText);
            } else {
                setDialogueWithRevert(`Unknown camera mode. Available: ${CAMERA_COMMANDS.join(', ')}`, setDialogueText);
            }

            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            return null;
        }

        if (commandToExecute.startsWith('indent')) {
            // Toggle smart indentation
            setModeState(prev => ({
                ...prev,
                isIndentEnabled: !prev.isIndentEnabled
            }));
            
            const newState = !modeState.isIndentEnabled;
            setDialogueWithRevert(newState ? "Smart indentation enabled" : "Smart indentation disabled", setDialogueText);
            
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});
            
            return null;
        }

        if (commandToExecute.startsWith('signin')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            // Return command execution for world engine to handle signin flow
            return {
                command: 'signin',
                args: [],
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('signout')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            // Return command execution for world engine to handle the actual sign out
            return {
                command: 'signout',
                args: [],
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('mail')) {
            // /mail command - create mail region from selection
            // Check if user has 'super' membership
            if (membershipLevel !== 'super') {
                setDialogueWithRevert("Mail command requires Super membership", setDialogueText);

                // Clear command mode
                setCommandState({
                    isActive: false,
                    input: '',
                    matchedCommands: [],
                    selectedIndex: 0,
                    commandStartPos: { x: 0, y: 0 },
                    originalCursorPos: { x: 0, y: 0 },
                    hasNavigated: false
                });
                setCommandData({});

                return null;
            }

            const existingSelection = getNormalizedSelection?.();

            if (existingSelection) {
                // Selection exists - create mail region immediately
                const hasMeaningfulSelection =
                    existingSelection.startX !== existingSelection.endX ||
                    existingSelection.startY !== existingSelection.endY;

                if (!hasMeaningfulSelection) {
                    setDialogueWithRevert("Selection must span more than one cell", setDialogueText);
                } else if (setWorldData && worldData && setSelectionStart && setSelectionEnd) {
                    // Create mail region data
                    const mailRegion = {
                        startX: existingSelection.startX,
                        endX: existingSelection.endX,
                        startY: existingSelection.startY,
                        endY: existingSelection.endY,
                        timestamp: Date.now()
                    };

                    // Store mail region in worldData with unique key
                    const mailKey = `mail_${existingSelection.startX},${existingSelection.startY}_${Date.now()}`;

                    // Create send button bound to this mail region (bottom-right corner)
                    const sendButton = {
                        mailKey: mailKey,
                        x: existingSelection.endX,
                        y: existingSelection.endY,
                        text: 'Send',
                        timestamp: Date.now()
                    };
                    const buttonKey = `mailbutton_${mailKey}`;

                    const newWorldData = { ...worldData };
                    newWorldData[mailKey] = JSON.stringify(mailRegion);
                    newWorldData[buttonKey] = JSON.stringify(sendButton);
                    setWorldData(newWorldData);

                    const width = existingSelection.endX - existingSelection.startX + 1;
                    const height = existingSelection.endY - existingSelection.startY + 1;
                    setDialogueWithRevert(`Mail region created (${width}×${height}). Row 1: To, Row 2: Subject, Row 3+: Message`, setDialogueText);

                    // Clear selection
                    setSelectionStart(null);
                    setSelectionEnd(null);
                }
            } else {
                // No selection - set as pending command waiting for selection
                setPendingCommand({
                    command: 'mail',
                    args: [],
                    isWaitingForSelection: true
                });

                setDialogueWithRevert("Make a selection, then press Enter to create mail region", setDialogueText);
            }

            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            // Return special flag to indicate cursor should be restored
            return {
                command: 'mail',
                args: [],
                commandStartPos: commandState.commandStartPos,
                restoreCursor: true
            } as CommandExecution & { restoreCursor?: boolean };
        }

        if (commandToExecute.startsWith('note')) {
            // /note command - one-shot note region creation from selection
            // Check if there's already a selection
            const existingSelection = getNormalizedSelection?.();

            if (existingSelection) {
                // Selection exists - create note region immediately
                const hasMeaningfulSelection =
                    existingSelection.startX !== existingSelection.endX ||
                    existingSelection.startY !== existingSelection.endY;

                if (!hasMeaningfulSelection) {
                    setDialogueWithRevert("Selection must span more than one cell", setDialogueText);
                } else if (setWorldData && worldData && setSelectionStart && setSelectionEnd) {
                    // Create note region data
                    const noteRegion = {
                        startX: existingSelection.startX,
                        endX: existingSelection.endX,
                        startY: existingSelection.startY,
                        endY: existingSelection.endY,
                        timestamp: Date.now()
                    };

                    // Store note region in worldData with unique key
                    const noteKey = `note_${existingSelection.startX},${existingSelection.startY}_${Date.now()}`;
                    const newWorldData = { ...worldData };
                    newWorldData[noteKey] = JSON.stringify(noteRegion);
                    setWorldData(newWorldData);

                    const width = existingSelection.endX - existingSelection.startX + 1;
                    const height = existingSelection.endY - existingSelection.startY + 1;
                    setDialogueWithRevert(`Note region saved (${width}×${height})`, setDialogueText);

                    // Clear selection
                    setSelectionStart(null);
                    setSelectionEnd(null);
                }
            } else {
                // No selection - set as pending command waiting for selection
                setPendingCommand({
                    command: 'note',
                    args: [],
                    isWaitingForSelection: true
                });

                setDialogueWithRevert("Make a selection, then press Enter to save as note region", setDialogueText);
            }

            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            // Return special flag to indicate cursor should be restored
            return {
                command: 'note',
                args: [],
                commandStartPos: commandState.commandStartPos,
                restoreCursor: true
            } as CommandExecution & { restoreCursor?: boolean };
        }

        if (commandToExecute.startsWith('list')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            // Return command execution for immediate processing
            const args = inputParts.slice(1);

            return {
                command: 'list',
                args: args,
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('unlist')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            // Return command execution for immediate processing
            return {
                command: 'unlist',
                args: [],
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('move')) {
            // Toggle move mode
            setModeState(prev => ({
                ...prev,
                isMoveMode: !prev.isMoveMode
            }));

            const newState = !modeState.isMoveMode;
            setDialogueWithRevert(newState ? "Move mode enabled - hover over text blocks to drag them. Press Escape to exit." : "Move mode disabled", setDialogueText);

            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            return null;
        }

        if (commandToExecute.startsWith('pro')) {
            // Direct redirect to Stripe checkout
            setDialogueWithRevert("Redirecting to checkout...", setDialogueText);

            // Get current user and create checkout session
            import('firebase/auth').then(({ onAuthStateChanged }) => {
                import('../firebase').then(({ auth }) => {
                    onAuthStateChanged(auth, (user) => {
                        if (user) {
                            fetch('/api/stripe/checkout', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    plan: 'pro',
                                    interval: 'monthly',
                                    userId: user.uid,
                                }),
                            })
                            .then(r => r.json())
                            .then(data => {
                                if (data.url) {
                                    window.location.href = data.url;
                                } else {
                                    setDialogueWithRevert('Checkout failed. Please try again.', setDialogueText);
                                }
                            })
                            .catch(() => {
                                setDialogueWithRevert('Checkout failed. Please try again.', setDialogueText);
                            });
                        } else {
                            setDialogueWithRevert('Please sign in first.', setDialogueText);
                        }
                    });
                });
            });

            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            return null;
        }

        if (commandToExecute.startsWith('tutorial')) {
            // Trigger the tutorial flow
            if (triggerTutorialFlow) {
                triggerTutorialFlow();
            }

            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            return null;
        }

        if (commandToExecute.startsWith('help')) {
            // Keep command mode active to show all commands
            // Help text will only be shown on hover
            let allCommands = isReadOnly ? READ_ONLY_COMMANDS : AVAILABLE_COMMANDS;

            // Filter out mail command for non-super users
            allCommands = allCommands.filter(cmd => {
                if (cmd === 'mail' && membershipLevel !== 'super') return false;
                return true;
            });

            // Build command data - just show commands, no help text yet
            const newCommandData: WorldData = {};
            const commandText = '/';

            // Draw command text
            for (let i = 0; i < commandText.length; i++) {
                const key = `${commandState.commandStartPos.x + i},${commandState.commandStartPos.y}`;
                newCommandData[key] = commandText[i];
            }

            // Draw all commands without help text (help text shown on hover)
            allCommands.forEach((command, index) => {
                const suggestionY = commandState.commandStartPos.y + 1 + index;

                // Draw command name
                for (let i = 0; i < command.length; i++) {
                    const key = `${commandState.commandStartPos.x + i},${suggestionY}`;
                    newCommandData[key] = command[i];
                }
            });

            setCommandData(newCommandData);
            setCommandState(prev => ({
                ...prev,
                input: '',
                matchedCommands: allCommands,
                selectedIndex: 0,
                helpMode: true
            }));

            return null;
        }

        if (commandToExecute.startsWith('spawn')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            // Return command execution for world engine to handle spawn point setting
            return {
                command: 'spawn',
                args: [],
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('glitch')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            // Return command execution for world engine to handle glitch region creation
            return {
                command: 'glitch',
                args: [],
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('zoom')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            // Return command execution for world engine to handle zoom animation
            return {
                command: 'zoom',
                args: [],
                commandStartPos: commandState.commandStartPos
            };
        }

        // Handle commands that need text selection
        if (['transform', 'explain', 'summarize'].includes(commandToExecute.toLowerCase().split(' ')[0])) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});
            
            // Set as pending command waiting for selection
            const args = inputParts.slice(1);
            setPendingCommand({
                command: commandToExecute,
                args: args,
                isWaitingForSelection: true
            });
            
            return { command: 'pending_selection', args: [commandToExecute], commandStartPos: commandState.commandStartPos };
        }

        // Handle monogram command
        if (commandToExecute.startsWith('monogram')) {
            const args = inputParts.slice(1);

            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            return { command: 'monogram', args, commandStartPos: commandState.commandStartPos };
        }

        // Handle share command - always publishes with region coordinates
        if (commandToExecute.startsWith('share')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            return { command: 'share', args: [], commandStartPos: commandState.commandStartPos };
        }

        // Handle latex command - activates LaTeX input mode
        if (commandToExecute.startsWith('latex')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            return { command: 'latex', args: [], commandStartPos: commandState.commandStartPos };
        }

        // Handle smiles command - activates SMILES (molecular structure) input mode
        if (commandToExecute.startsWith('smiles')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            return { command: 'smiles', args: [], commandStartPos: commandState.commandStartPos };
        }

        // Handle upload command - opens file picker for image upload
        if (commandToExecute.startsWith('upload')) {
            const parts = commandToExecute.split(/\s+/);
            const args = parts.slice(1); // Capture --bitmap flag if present

            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            return { command: 'upload', args, commandStartPos: commandState.commandStartPos };
        }

        // Check if this is an unrecognized command - treat as AI prompt
        if (!AVAILABLE_COMMANDS.includes(commandName.toLowerCase())) {
            // This is an AI prompt, not a recognized command
            const aiPrompt = commandToExecute; // Full input is the prompt

            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            // Return special command for AI chat - world engine will handle the AI call
            // Pass isPermanent flag to differentiate Enter vs Cmd+Enter
            return {
                command: 'ai-chat',
                args: [aiPrompt, isPermanent ? 'permanent' : 'ephemeral'],
                commandStartPos: commandState.commandStartPos
            };
        }

        // Clear command mode for other commands
        setCommandState({
            isActive: false,
            input: '',
            matchedCommands: [],
            selectedIndex: 0,
            commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
            hasNavigated: false
        });
        setCommandData({});

        if (commandToExecute.toLowerCase().startsWith(commandName.toLowerCase())) {
            const args = inputParts.slice(1);
            return { command: commandName, args, commandStartPos: commandState.commandStartPos };
        }

        return null;
    }, [commandState, switchMode]);

    // Execute pending command with selection
    const executePendingCommand = useCallback((selectedText: string): CommandExecution | null => {
        if (!pendingCommand) return null;
        
        // Clear pending command state
        const cmd = pendingCommand;
        setPendingCommand(null);
        
        // Return the command execution with the selected text as first argument
        return {
            command: cmd.command,
            args: [selectedText, ...cmd.args],
            commandStartPos: { x: 0, y: 0 } // Not relevant for pending commands
        };
    }, [pendingCommand]);

    // Handle pasting text into command mode
    const pasteIntoCommand = useCallback(async (): Promise<{ success: boolean; newLength: number }> => {
        if (!commandState.isActive) return { success: false, newLength: 0 };

        try {
            const clipText = await navigator.clipboard.readText();
            // Replace newlines with spaces to keep command on one line
            const processedText = clipText.replace(/[\r\n]+/g, ' ').trim();

            if (!processedText) return { success: false, newLength: 0 };

            let newLength = 0;

            // Add each character to the command input
            setCommandState(prev => {
                const newInput = prev.input + processedText;
                newLength = newInput.length;
                const newMatchedCommands = matchCommands(newInput);

                // Update command display at original command start position
                const newCommandData: WorldData = {};
                const commandText = `/${newInput}`;

                // Draw command text at original command start position
                for (let i = 0; i < commandText.length; i++) {
                    const key = `${prev.commandStartPos.x + i},${prev.commandStartPos.y}`;
                    newCommandData[key] = commandText[i];
                }

                // Draw autocomplete suggestions below
                newMatchedCommands.forEach((command, index) => {
                    const suggestionY = prev.commandStartPos.y + 1 + index;
                    for (let i = 0; i < command.length; i++) {
                        const key = `${prev.commandStartPos.x + i},${suggestionY}`;
                        newCommandData[key] = command[i];
                    }
                });

                setCommandData(newCommandData);

                return {
                    ...prev,
                    input: newInput,
                    matchedCommands: newMatchedCommands,
                    selectedIndex: Math.min(prev.selectedIndex, newMatchedCommands.length - 1),
                };
            });

            return { success: true, newLength };
        } catch (err) {
            console.warn('Could not paste into command:', err);
            return { success: false, newLength: 0 };
        }
    }, [commandState.isActive, matchCommands]);

    // Handle keyboard events for command mode
    const handleKeyDown = useCallback(async (
        key: string,
        cursorPos: Point,
        setCursorPos: (pos: Point | ((prev: Point) => Point)) => void,
        ctrlKey: boolean = false,
        metaKey: boolean = false,
        shiftKey: boolean = false,
        altKey: boolean = false,
        isComposing: boolean = false
    ): Promise<boolean | CommandExecution | null> => {
        const isPermanent = metaKey || ctrlKey; // Track if Cmd/Ctrl+Enter
        // Handle paste in command mode (Cmd+V or Ctrl+V)
        if (commandState.isActive && key === 'v' && (ctrlKey || metaKey)) {
            pasteIntoCommand().then(result => {
                if (result.success) {
                    // Move cursor to end of pasted content
                    // newLength is the input length, +1 for the '/'
                    setCursorPos({
                        x: commandState.commandStartPos.x + result.newLength + 1,
                        y: commandState.commandStartPos.y
                    });
                }
            });
            return true;
        }

        if (!commandState.isActive) {
            // Check if starting command mode with '/'
            if (key === '/') {
                startCommand(cursorPos);
                // Move cursor to next position
                setCursorPos({ x: cursorPos.x + 1, y: cursorPos.y });
                return true;
            }
            return false;
        }

        // Handle command mode keys
        if (key === '/') {
            // If '/' is pressed while command is active, restart command at new position
            startCommand(cursorPos);
            // Move cursor to next position
            setCursorPos({ x: cursorPos.x + 1, y: cursorPos.y });
            return true;
        } else if (key === 'Enter') {
            const originalPos = commandState.originalCursorPos;
            const result = executeCommand(isPermanent);

            // Check if command returned a flag to restore cursor
            if (result && typeof result === 'object' && 'restoreCursor' in result && result.restoreCursor) {
                setCursorPos(originalPos);
            }

            return result;
        } else if (key === 'Escape') {
            // Cancel any active composition before exiting
            if (cancelComposition) {
                cancelComposition();
            }

            // Exit command mode without executing and restore cursor to original position
            const originalPos = commandState.originalCursorPos;
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                originalCursorPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});
            // Restore cursor to original position
            setCursorPos(originalPos);
            return true;
        } else if (key === 'ArrowUp') {
            navigateUp();
            return true;
        } else if (key === 'ArrowDown') {
            navigateDown();
            return true;
        } else if (key === 'Tab') {
            // Tab completion - complete to the currently selected match
            if (commandState.matchedCommands.length >= 1) {
                const selectedCommand = commandState.matchedCommands[commandState.selectedIndex];
                if (selectedCommand) {
                    // Get new suggestions based on the selected command
                    const newMatchedCommands = matchCommands(selectedCommand);

                    // Update command state with the completed command
                    setCommandState(prev => {
                        const newCommandData: WorldData = {};
                        const commandText = `/${selectedCommand}`;

                        // Draw command text
                        for (let i = 0; i < commandText.length; i++) {
                            const key = `${prev.commandStartPos.x + i},${prev.commandStartPos.y}`;
                            newCommandData[key] = commandText[i];
                        }

                        // Draw suggestions
                        newMatchedCommands.forEach((command, index) => {
                            const suggestionY = prev.commandStartPos.y + 1 + index;
                            for (let i = 0; i < command.length; i++) {
                                const key = `${prev.commandStartPos.x + i},${suggestionY}`;
                                newCommandData[key] = command[i];
                            }
                        });

                        setCommandData(newCommandData);

                        return {
                            ...prev,
                            input: selectedCommand,
                            matchedCommands: newMatchedCommands,
                            selectedIndex: 0,
                            hasNavigated: true // Mark that user has navigated/completed
                        };
                    });

                    // Move cursor to end of completed command
                    setCursorPos({
                        x: commandState.commandStartPos.x + selectedCommand.length + 1,
                        y: commandState.commandStartPos.y
                    });
                }
            }
            return true;
        } else if (key === 'Backspace') {
            if (metaKey) {
                // Cmd+Backspace: Delete entire command input
                setCommandState(prev => {
                    const newCommandData: WorldData = {};
                    // Keep only the '/' character
                    newCommandData[`${prev.commandStartPos.x},${prev.commandStartPos.y}`] = '/';
                    setCommandData(newCommandData);

                    return {
                        ...prev,
                        input: '',
                        matchedCommands: matchCommands(''),
                        selectedIndex: 0
                    };
                });
                // Move cursor to just after '/'
                setCursorPos({
                    x: commandState.commandStartPos.x + 1,
                    y: commandState.commandStartPos.y
                });
            } else if (altKey) {
                // Option+Backspace: Delete last word
                const words = commandState.input.trim().split(/\s+/);
                if (words.length > 0 && commandState.input.length > 0) {
                    // Remove last word
                    words.pop();
                    const newInput = words.join(' ');

                    setCommandState(prev => {
                        const newMatchedCommands = matchCommands(newInput);

                        // Update command display
                        const newCommandData: WorldData = {};
                        const commandText = `/${newInput}`;

                        // Draw command text at original command start position
                        for (let i = 0; i < commandText.length; i++) {
                            const key = `${prev.commandStartPos.x + i},${prev.commandStartPos.y}`;
                            newCommandData[key] = commandText[i];
                        }

                        // Draw autocomplete suggestions below (if any)
                        newMatchedCommands.forEach((command, index) => {
                            const suggestionY = prev.commandStartPos.y + 1 + index;
                            for (let i = 0; i < command.length; i++) {
                                const key = `${prev.commandStartPos.x + i},${suggestionY}`;
                                newCommandData[key] = command[i];
                            }
                        });

                        setCommandData(newCommandData);

                        return {
                            ...prev,
                            input: newInput,
                            matchedCommands: newMatchedCommands,
                            selectedIndex: 0
                        };
                    });

                    // Move cursor to end of new input
                    setCursorPos({
                        x: commandState.commandStartPos.x + newInput.length + 1, // +1 for the '/'
                        y: commandState.commandStartPos.y
                    });
                }
            } else {
                // Regular backspace
                const result = handleBackspace();
                if (result.shouldMoveCursor) {
                    setCursorPos(prev => ({ x: prev.x - 1, y: prev.y }));
                }
            }
            return true;
        } else if (key.length === 1 && !isComposing) {
            // Add character to command input (skip during IME composition)
            addCharacter(key);
            // Move cursor forward
            setCursorPos(prev => ({ x: prev.x + 1, y: prev.y }));
            return true;
        }

        return false;
    }, [commandState, startCommand, executeCommand, navigateUp, navigateDown, handleBackspace, addCharacter, pasteIntoCommand]);

    // Select a command from dropdown (for click handling)
    const selectCommand = useCallback((selectedCommand: string) => {
        setCommandState(prev => {
            const newMatchedCommands = matchCommands(selectedCommand);
            
            // Update command display
            const newCommandData: WorldData = {};
            const commandText = `/${selectedCommand}`;
            
            // Draw command text at original command start position
            for (let i = 0; i < commandText.length; i++) {
                const key = `${prev.commandStartPos.x + i},${prev.commandStartPos.y}`;
                newCommandData[key] = commandText[i];
            }
            
            // Draw autocomplete suggestions below (if any)
            newMatchedCommands.forEach((command, index) => {
                const suggestionY = prev.commandStartPos.y + 1 + index;
                for (let i = 0; i < command.length; i++) {
                    const key = `${prev.commandStartPos.x + i},${suggestionY}`;
                    newCommandData[key] = command[i];
                }
            });
            
            setCommandData(newCommandData);
            
            return {
                ...prev,
                input: selectedCommand,
                matchedCommands: newMatchedCommands,
                selectedIndex: 0,
                hasNavigated: true // Mark as navigated since user clicked
            };
        });
    }, [matchCommands]);

    // Helper method to execute a command from a string (for keyboard shortcuts)
    // This executes immediately without opening the command palette
    const executeCommandString = useCallback((commandString: string) => {
        // Parse the command
        const inputParts = commandString.split(/\s+/);
        const commandName = inputParts[0];

        // Directly execute based on command name
        if (commandName === 'note') {
            // Check if there's a selection
            const existingSelection = getNormalizedSelection?.();
            if (existingSelection) {
                const hasMeaningfulSelection =
                    existingSelection.startX !== existingSelection.endX ||
                    existingSelection.startY !== existingSelection.endY;

                if (hasMeaningfulSelection && setWorldData && worldData && setSelectionStart && setSelectionEnd) {
                    // Create note region
                    const noteRegion = {
                        startX: existingSelection.startX,
                        endX: existingSelection.endX,
                        startY: existingSelection.startY,
                        endY: existingSelection.endY,
                        timestamp: Date.now()
                    };

                    const noteKey = `note_${existingSelection.startX},${existingSelection.startY}_${Date.now()}`;
                    const newWorldData = { ...worldData };
                    newWorldData[noteKey] = JSON.stringify(noteRegion);
                    setWorldData(newWorldData);

                    const width = existingSelection.endX - existingSelection.startX + 1;
                    const height = existingSelection.endY - existingSelection.startY + 1;
                    setDialogueWithRevert(`Note region saved (${width}×${height})`, setDialogueText);

                    // Clear selection
                    setSelectionStart(null);
                    setSelectionEnd(null);
                } else {
                    setDialogueWithRevert("Selection must span more than one cell", setDialogueText);
                }
            } else {
                setDialogueWithRevert("Make a selection first", setDialogueText);
            }
        } else if (commandName === 'paint') {
            // Toggle paint mode for drawing monogram zones
            const newPaintMode = !modeState.isPaintMode;
            setModeState(prev => ({ ...prev, isPaintMode: newPaintMode }));

            if (newPaintMode) {
                setDialogueWithRevert("Paint mode enabled - click and drag to draw. Press ESC to exit.", setDialogueText);
            } else {
                setDialogueWithRevert("Paint mode disabled", setDialogueText);
            }
        } else if (commandName === 'label') {
            // Check if there's a selection to create label from
            const existingSelection = getNormalizedSelection?.();
            if (existingSelection) {
                const hasMeaningfulSelection =
                    existingSelection.startX !== existingSelection.endX ||
                    existingSelection.startY !== existingSelection.endY;

                if (hasMeaningfulSelection && setWorldData && worldData && setSelectionStart && setSelectionEnd) {
                    // Extract text from selection
                    const minX = existingSelection.startX;
                    const maxX = existingSelection.endX;
                    const minY = existingSelection.startY;
                    const maxY = existingSelection.endY;

                    // Helper to extract character from cell data
                    const getCharacter = (cellData: any): string => {
                        if (!cellData) return '';
                        if (typeof cellData === 'string') return cellData;
                        if (typeof cellData === 'object' && 'char' in cellData) return cellData.char;
                        return '';
                    };

                    // Extract text from selection
                    let selectedText = '';
                    for (let y = minY; y <= maxY; y++) {
                        let line = '';
                        for (let x = minX; x <= maxX; x++) {
                            const cellKey = `${x},${y}`;
                            line += getCharacter(worldData[cellKey]);
                        }
                        selectedText += line.trimEnd() + ' ';
                    }
                    selectedText = selectedText.trim();

                    if (selectedText) {
                        // Create label at selection start position
                        const labelKey = `label_${minX},${minY}`;
                        const newLabel = {
                            text: selectedText,
                            color: '#000000', // Default black text
                            background: '#FFFFFF' // Default white background
                        };

                        const newWorldData = { ...worldData };
                        newWorldData[labelKey] = JSON.stringify(newLabel);
                        setWorldData(newWorldData);

                        setDialogueWithRevert(`Label "${selectedText}" created`, setDialogueText);

                        // Clear selection after creating label
                        setSelectionStart(null);
                        setSelectionEnd(null);
                    } else {
                        setDialogueWithRevert("Selection is empty", setDialogueText);
                    }
                } else {
                    setDialogueWithRevert("Selection must span more than one cell", setDialogueText);
                }
            } else {
                setDialogueWithRevert("Make a selection first", setDialogueText);
            }
        } else if (commandName === 'publish') {
            // Execute publish command
            // TODO: Implement publish logic or call existing publish function
            setDialogueWithRevert("Publishing canvas...", setDialogueText);
        }
    }, [getNormalizedSelection, setWorldData, worldData, setSelectionStart, setSelectionEnd, setDialogueText]);

    // Helper method to activate command with pre-filled input (for Cmd+F search)
    const startCommandWithInput = useCallback((cursorPos: Point, input: string) => {
        startCommand(cursorPos);

        // Pre-fill the input
        const matchedCmds = matchCommands(input);
        setCommandState(prev => ({
            ...prev,
            input,
            matchedCommands: matchedCmds,
            selectedIndex: 0
        }));

        // Update the command data display
        const newCommandData: WorldData = {};
        const commandText = `/${input}`;

        for (let i = 0; i < commandText.length; i++) {
            const key = `${cursorPos.x + i},${cursorPos.y}`;
            newCommandData[key] = commandText[i];
        }

        // Draw suggestions
        matchedCmds.forEach((command, index) => {
            const suggestionY = cursorPos.y + 1 + index;
            for (let i = 0; i < command.length; i++) {
                const key = `${cursorPos.x + i},${suggestionY}`;
                newCommandData[key] = command[i];
            }
        });

        setCommandData(newCommandData);
    }, [startCommand, matchCommands]);

    // Helper method to remove trigger character for IME composition
    const removeCompositionTrigger = useCallback(() => {
        setCommandState(prev => {
            // Remove last character from input
            const newInput = prev.input.slice(0, -1);
            const newMatchedCommands = matchCommands(newInput);

            // Update command display
            const newCommandData: WorldData = {};
            const commandText = `/${newInput}`;

            // Draw command text at original command start position
            for (let i = 0; i < commandText.length; i++) {
                const key = `${prev.commandStartPos.x + i},${prev.commandStartPos.y}`;
                newCommandData[key] = commandText[i];
            }

            // Draw autocomplete suggestions below
            newMatchedCommands.forEach((command, index) => {
                const suggestionY = prev.commandStartPos.y + 1 + index;
                for (let i = 0; i < command.length; i++) {
                    const key = `${prev.commandStartPos.x + i},${suggestionY}`;
                    newCommandData[key] = command[i];
                }
            });

            setCommandData(newCommandData);

            return {
                ...prev,
                input: newInput,
                matchedCommands: newMatchedCommands,
                selectedIndex: Math.min(prev.selectedIndex, newMatchedCommands.length - 1),
            };
        });
    }, [matchCommands]);

    // Helper method to add composed text from IME (Korean, Japanese, Chinese, etc.)
    const addComposedText = useCallback((text: string, startPos: Point) => {
        setCommandState(prev => {
            const newInput = prev.input + text;
            const newMatchedCommands = matchCommands(newInput);

            // Update command display at original command start position
            const newCommandData: WorldData = {};
            const commandText = `/${newInput}`;

            // Draw command text at original command start position
            for (let i = 0; i < commandText.length; i++) {
                const key = `${prev.commandStartPos.x + i},${prev.commandStartPos.y}`;
                newCommandData[key] = commandText[i];
            }

            // Draw autocomplete suggestions below
            newMatchedCommands.forEach((command, index) => {
                const suggestionY = prev.commandStartPos.y + 1 + index;
                for (let i = 0; i < command.length; i++) {
                    const key = `${prev.commandStartPos.x + i},${suggestionY}`;
                    newCommandData[key] = command[i];
                }
            });

            setCommandData(newCommandData);

            return {
                ...prev,
                input: newInput,
                matchedCommands: newMatchedCommands,
                selectedIndex: Math.min(prev.selectedIndex, newMatchedCommands.length - 1),
            };
        });
    }, [matchCommands]);

    // Function to restore previous background (for ESC after /bg over image)
    const restorePreviousBackground = useCallback(() => {
        if (previousBackgroundStateRef.current) {
            const prev = previousBackgroundStateRef.current;

            if (prev.mode === 'color') {
                switchBackgroundMode('color', prev.color, prev.textColor, prev.textBackground);
            } else if (prev.mode === 'image') {
                switchBackgroundMode('image', prev.image, prev.textColor, prev.textBackground);
            } else if (prev.mode === 'video') {
                switchBackgroundMode('video', prev.video, prev.textColor, prev.textBackground);
            } else if (prev.mode === 'space') {
                switchBackgroundMode('space', undefined, prev.textColor, prev.textBackground);
            } else if (prev.mode === 'transparent') {
                switchBackgroundMode('transparent', undefined, prev.textColor, prev.textBackground);
            }

            previousBackgroundStateRef.current = null;
            return true;
        }
        return false;
    }, [switchBackgroundMode]);

    return {
        commandState,
        commandData,
        handleKeyDown,
        selectCommand,
        executeCommandString,
        startCommand, // Expose startCommand for keyboard shortcuts
        startCommandWithInput, // Expose for Cmd+F
        addComposedText, // Expose for IME composition
        removeCompositionTrigger, // Expose for IME composition start
        isCommandMode: commandState.isActive,
        // Pending command system
        pendingCommand,
        executePendingCommand,
        setPendingCommand,
        // Mode system exports
        modeState,
        switchMode,
        switchBackgroundMode,
        restorePreviousBackground,
        addEphemeralText,
        addAIResponse,
        addInstantAIResponse,
        currentMode: modeState.currentMode,
        lightModeData: modeState.lightModeData,
        backgroundMode: modeState.backgroundMode,
        backgroundColor: modeState.backgroundColor,
        backgroundImage: modeState.backgroundImage,
        backgroundVideo: modeState.backgroundVideo,
        backgroundStream: backgroundStreamRef.current || modeState.backgroundStream,
        textColor: modeState.textColor,
        textBackground: modeState.textBackground,
        fontFamily: modeState.fontFamily,
        currentTextStyle: modeState.currentTextStyle,
        searchPattern: modeState.searchPattern,
        isSearchActive: modeState.isSearchActive,
        clearSearch: () => setModeState(prev => ({ ...prev, searchPattern: '', isSearchActive: false })),
        clearLightModeData: () => setModeState(prev => ({ ...prev, lightModeData: {} })),
        setLightModeData: (data: WorldData) => setModeState(prev => ({ ...prev, lightModeData: data })),
        cameraMode: modeState.cameraMode,
        isIndentEnabled: modeState.isIndentEnabled,
        isMoveMode: modeState.isMoveMode,
        exitMoveMode: () => setModeState(prev => ({ ...prev, isMoveMode: false })),
        isPaintMode: modeState.isPaintMode,
        exitPaintMode: () => setModeState(prev => ({ ...prev, isPaintMode: false })),
        gridMode: modeState.gridMode,
        cycleGridMode: () => setModeState(prev => ({ 
            ...prev, 
            gridMode: prev.gridMode === 'dots' ? 'lines' : 'dots' 
        })),
        artefactsEnabled: modeState.artefactsEnabled,
        artifactType: modeState.artifactType,
        isFullscreenMode: modeState.isFullscreenMode,
        fullscreenRegion: modeState.fullscreenRegion,
        setFullscreenMode: (enabled: boolean, region?: ModeState['fullscreenRegion']) =>
            setModeState(prev => ({ ...prev, isFullscreenMode: enabled, fullscreenRegion: region })),
        exitFullscreenMode: () =>
            setModeState(prev => ({ ...prev, isFullscreenMode: false, fullscreenRegion: undefined })),
    };
}
