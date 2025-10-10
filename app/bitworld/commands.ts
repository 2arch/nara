import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Point, WorldData } from './world.engine';
import { generateImage, generateVideo, setDialogueWithRevert } from './ai';
import type { WorldSettings } from './settings';

// --- Command System Types ---
export interface CommandState {
    isActive: boolean;
    input: string;
    matchedCommands: string[];
    selectedIndex: number;
    commandStartPos: Point;
    hasNavigated: boolean; // Track if user has used arrow keys to navigate
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
export type CanvasMode = 'default' | 'air' | 'chat';
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
    getAllLabels?: () => Array<{text: string, x: number, y: number, color: string}>;
    getAllBounds?: () => Array<{startX: number, endX: number, startY: number, endY: number, color: string, title?: string}>;
    availableStates?: string[];
    username?: string;
    updateSettings?: (settings: Partial<WorldSettings>) => void;
    settings?: WorldSettings;
    getEffectiveCharDims: (zoom: number) => { width: number; height: number; fontSize: number; };
    zoomLevel: number;
    clipboardItems?: Array<{id: string, content: string, startX: number, endX: number, startY: number, endY: number, timestamp: number}>;
}

// --- Command System Constants ---
const AVAILABLE_COMMANDS = ['label', 'mode', 'debug', 'chat', 'bg', 'nav', 'search', 'state', 'random', 'text', 'font', 'signin', 'signout', 'publish', 'unpublish', 'share', 'clear', 'cam', 'indent', 'bound', 'unbound', 'upload', 'spawn', 'monogram', 'stage', 'clip'];
const MODE_COMMANDS = ['default', 'air', 'chat'];
const BG_COMMANDS = ['clear', 'live', 'web'];
const FONT_COMMANDS = ['IBM Plex Mono', 'Apercu Pro', 'Neureal'];
const NAV_COMMANDS: string[] = [];
const CAMERA_COMMANDS = ['default', 'focus'];

// Standardized color mapping used throughout the application
export const COLOR_MAP: { [name: string]: string } = {
    'white': '#FFFFFF',
    'black': '#000000',
    'sulfur': '#F0FF6A',
    'chalk': '#69AED6',
    'garden': '#162400',
    'orange': '#FFA500',
    'ochre': '#FFC0CB',
};

// --- Command System Hook ---
export function useCommandSystem({ setDialogueText, initialBackgroundColor, getAllLabels, getAllBounds, availableStates = [], username, updateSettings, settings, getEffectiveCharDims, zoomLevel, clipboardItems = [] }: UseCommandSystemProps) {
    const router = useRouter();
    const backgroundStreamRef = useRef<MediaStream | undefined>(undefined);
    const [commandState, setCommandState] = useState<CommandState>({
        isActive: false,
        input: '',
        matchedCommands: [],
        selectedIndex: 0,
        commandStartPos: { x: 0, y: 0 },
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
        cameraMode: typeof window !== 'undefined' && 'ontouchstart' in window ? 'focus' : 'default', // Focus mode on mobile, default on desktop
        isIndentEnabled: true, // Smart indentation enabled by default
        isMoveMode: false, // Move mode not active initially
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
        if (!input) return AVAILABLE_COMMANDS;
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
                } else {
                    // Regular label command - show as typed (supports quoted strings)
                    return [input];
                }
            }
            return ['label', 'label --distance', "label 'text with spaces'"];
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

        if (lowerInput === 'bound') {
            const parts = input.split(' ');
            
            if (parts.length > 1) {
                const secondArg = parts[1];
                
                // Handle --x and --y flags
                if (secondArg === '--x') {
                    if (parts.length > 2) {
                        // User is typing the x value
                        return [input];
                    }
                    // Just typed --x, show example
                    return ['bound --x <width>'];
                } else if (secondArg === '--y') {
                    if (parts.length > 2) {
                        // User is typing the y value
                        return [input];
                    }
                    // Just typed --y, show example
                    return ['bound --y <height>'];
                } else {
                    // Regular bound command - show as typed
                    return [input];
                }
            }
            return ['bound', 'bound --x', 'bound --y', 'bound --x <width> --y <height>'];
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

        return AVAILABLE_COMMANDS.filter(cmd => cmd.toLowerCase().startsWith(lowerInput));
    }, [getAllLabels, getAllBounds, availableStates, clipboardItems]);

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
            switchBackgroundMode('color', initialBackgroundColor);
        }
    }, [initialBackgroundColor]); // Removed switchBackgroundMode to avoid dependency issues

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

        // Offset startPos to center the text block
        const centeredStartX = Math.floor(startPos.x - maxLineWidth / 2);
        const centeredStartY = Math.floor(startPos.y - totalHeight / 2);

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
        
        // Draw all available commands below
        AVAILABLE_COMMANDS.forEach((command, index) => {
            const suggestionY = cursorPos.y + 1 + index;
            for (let i = 0; i < command.length; i++) {
                const key = `${cursorPos.x + i},${suggestionY}`;
                newCommandData[key] = command[i];
            }
        });
        
        setCommandData(newCommandData);
        setCommandState({
            isActive: true,
            input: '',
            matchedCommands: AVAILABLE_COMMANDS,
            selectedIndex: 0,
            commandStartPos: { x: cursorPos.x, y: cursorPos.y },
            hasNavigated: false
        });
    }, []);

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
    const executeCommand = useCallback((): CommandExecution | null => {
        if (commandState.matchedCommands.length === 0) return null;

        // If user hasn't navigated with arrow keys, use their raw input instead of selected suggestion
        const fullInput = commandState.input.trim();
        const commandToExecute = commandState.hasNavigated 
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
                hasNavigated: false
            });
            setCommandData({});
            
            return null; // Mode switches don't need further processing
        }

        if (commandToExecute.startsWith('bg')) {
            const inputParts = commandState.input.trim().split(/\s+/);
            const bgArg = inputParts.length > 1 ? inputParts[1] : undefined;
            
            // Extract optional parameters
            const param2 = inputParts.length > 2 ? inputParts[2] : undefined;
            const param3 = inputParts.length > 3 ? inputParts[3] : undefined;
            const restOfInput = inputParts.slice(2).join(' '); // For AI prompts

            if (bgArg === 'clear') {
                // Parse quoted prompt and color parameters
                let prompt = '';
                let textColorParam: string | undefined;
                let textBgParam: string | undefined;
                
                // Join all parts after 'bg clear' to handle quoted strings
                const fullInput = inputParts.slice(2).join(' ');
                
                // Check if there's a quoted prompt
                const quoteMatch = fullInput.match(/^'([^']*)'(.*)$/);
                
                if (quoteMatch) {
                    // Quoted prompt found
                    prompt = quoteMatch[1];
                    const remainingParams = quoteMatch[2].trim().split(/\s+/).filter(p => p.length > 0);
                    
                    if (remainingParams.length > 0) {
                        textColorParam = remainingParams[0];
                    }
                    if (remainingParams.length > 1) {
                        textBgParam = remainingParams[1];
                    }
                } else {
                    // No quotes - use the old behavior for backward compatibility
                    // Just take first two params as colors if they exist
                    if (param2) {
                        textColorParam = param2;
                    }
                    if (param3) {
                        textBgParam = param3;
                    }
                }
                
                if (prompt.trim()) {
                    // 'bg clear' with a prompt - generate AI image
                    setDialogueWithRevert("Generating background image...", setDialogueText);
                    generateImage(prompt).then((imageUrl) => {
                        if (imageUrl && (imageUrl.startsWith('data:') || imageUrl.startsWith('http'))) {
                            // Validate that we have a proper image URL/data URL
                            switchBackgroundMode('image', imageUrl, textColorParam, textBgParam, prompt);
                            setDialogueWithRevert(`"${prompt}"`, setDialogueText);
                        } else {
                            // Fallback to space background if image generation fails or returns invalid data
                            switchBackgroundMode('space', undefined, textColorParam, textBgParam);
                            setDialogueWithRevert("Image generation not available, using space background.", setDialogueText);
                        }
                    }).catch(() => {
                        switchBackgroundMode('space', undefined, textColorParam, textBgParam);
                        setDialogueWithRevert("Image generation failed, using space background.", setDialogueText);
                    });
                } else {
                    // 'bg clear' without prompt - show space background
                    switchBackgroundMode('space', undefined, param2, param3);
                }
            } else if (bgArg === 'live') {
                // Parse quoted prompt and color parameters
                let prompt = '';
                let textColorParam: string | undefined;
                let textBgParam: string | undefined;
                
                // Join all parts after 'bg live' to handle quoted strings
                const fullInput = inputParts.slice(2).join(' ');
                
                // Check if there's a quoted prompt
                const quoteMatch = fullInput.match(/^'([^']*)'(.*)$/);
                
                if (quoteMatch) {
                    // Quoted prompt found
                    prompt = quoteMatch[1];
                    const remainingParams = quoteMatch[2].trim().split(/\s+/).filter(p => p.length > 0);
                    
                    if (remainingParams.length > 0) {
                        textColorParam = remainingParams[0];
                    }
                    if (remainingParams.length > 1) {
                        textBgParam = remainingParams[1];
                    }
                } else {
                    // No quotes - use the old behavior for backward compatibility
                    // Just take first two params as colors if they exist
                    if (param2) {
                        textColorParam = param2;
                    }
                    if (param3) {
                        textBgParam = param3;
                    }
                }
                
                if (prompt.trim()) {
                    // 'bg live' with a prompt - generate AI video
                    setDialogueWithRevert("Generating background video...", setDialogueText);
                    generateVideo(prompt).then((videoUrl) => {
                        if (videoUrl && (videoUrl.startsWith('data:') || videoUrl.startsWith('http'))) {
                            // Validate that we have a proper video URL/data URL
                            switchBackgroundMode('video', videoUrl, textColorParam, textBgParam, prompt);
                            setDialogueWithRevert(`"${prompt}"`, setDialogueText);
                        } else {
                            // Fallback to space background if video generation fails or returns invalid data
                            switchBackgroundMode('space', undefined, textColorParam, textBgParam);
                            setDialogueWithRevert("Video generation not available, using space background.", setDialogueText);
                        }
                    }).catch(() => {
                        switchBackgroundMode('space', undefined, textColorParam, textBgParam);
                        setDialogueWithRevert("Video generation failed, using space background.", setDialogueText);
                    });
                } else {
                    // 'bg live' without prompt - show space background
                    switchBackgroundMode('space', undefined, param2, param3);
                    setDialogueWithRevert("Video generation requires a prompt. Use: /bg live 'your prompt'", setDialogueText);
                }
            } else if (bgArg === 'web') {
                // Handle web screen sharing with optional text color and background
                const textColorArg = param2 || '#FFFFFF'; // Default to white text
                const textBgArg = param3; // Optional text background
                
                if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
                    navigator.mediaDevices.getDisplayMedia({
                        video: true,
                        audio: false
                    }).then((stream) => {
                        // Store stream in ref to persist across renders
                        backgroundStreamRef.current = stream;
                        
                        // Validate and set text color
                        const hexTextColor = (COLOR_MAP[textColorArg.toLowerCase()] || textColorArg).toUpperCase();
                        const validTextColor = /^#[0-9A-F]{6}$/i.test(hexTextColor) ? hexTextColor : '#FFFFFF';
                        
                        // Validate text background if provided
                        let validTextBg: string | undefined;
                        if (textBgArg) {
                            const hexTextBg = (COLOR_MAP[textBgArg.toLowerCase()] || textBgArg).toUpperCase();
                            validTextBg = /^#[0-9A-F]{6}$/i.test(hexTextBg) ? hexTextBg : undefined;
                        }
                        
                        setModeState(prev => ({
                            ...prev,
                            backgroundMode: 'stream',
                            backgroundStream: stream,
                            textColor: validTextColor,
                            textBackground: validTextBg,
                        }));
                        setDialogueWithRevert("Screen sharing active", setDialogueText);

                        // Listen for stream end
                        stream.getVideoTracks()[0].onended = () => {
                            backgroundStreamRef.current = undefined;
                            setModeState(prev => ({
                                ...prev,
                                backgroundMode: 'color',
                                backgroundColor: '#FFFFFF',
                                backgroundStream: undefined,
                                textColor: '#000000',
                                textBackground: undefined,
                            }));
                            setDialogueWithRevert("Screen sharing ended", setDialogueText);
                        };
                    }).catch((err) => {
                        console.error('Error accessing screen share:', err);
                        setDialogueWithRevert("Screen sharing cancelled or not available", setDialogueText);
                    });
                } else {
                    setDialogueWithRevert("Screen sharing not supported in this browser", setDialogueText);
                }
            } else if (bgArg) {
                // Format: /bg {backgroundColor} {textColor} {textBackground}
                // All parameters are optional
                switchBackgroundMode('color', bgArg, param2, param3);
            } else {
                // No arguments - default to white background
                switchBackgroundMode('color', '#FFFFFF');
            }
            
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
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
            
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
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

        if (commandToExecute.startsWith('cluster')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
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

        if (commandToExecute.startsWith('bound')) {
            
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});
            
            // Return command execution for immediate processing
            const args = inputParts.slice(1);
            
            return {
                command: 'bound',
                args: args,
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('unbound')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            // Return command execution for immediate processing
            return {
                command: 'unbound',
                args: [],
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('list')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
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
                hasNavigated: false
            });
            setCommandData({});

            return null;
        }

        if (commandToExecute.startsWith('full')) {
            // Clear command mode first
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            // Toggle fullscreen mode or return command for world engine to handle detection
            return {
                command: 'full',
                args: [],
                commandStartPos: commandState.commandStartPos
            };
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
                hasNavigated: false
            });
            setCommandData({});

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

        if (commandToExecute.startsWith('stage')) {
            // Parse: /stage <url>
            const parts = commandToExecute.split(/\s+/);
            const url = parts[1];

            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            // Return command execution for world engine to handle image staging
            return {
                command: 'stage',
                args: url ? [url] : [],
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

        if (commandToExecute.startsWith('agent')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});

            // Return command execution for world engine to handle agent toggle
            return {
                command: 'agent',
                args: [],
                commandStartPos: commandState.commandStartPos
            };
        }

        if (commandToExecute.startsWith('artefacts')) {
            const inputParts = commandState.input.trim().split(/\s+/);
            const typeArg = inputParts.length > 1 ? inputParts[1] : undefined;
            
            if (typeArg === '--images') {
                // Switch to images artifact type and enable artifacts
                setModeState(prev => ({
                    ...prev,
                    artefactsEnabled: true,
                    artifactType: 'images'
                }));
                setDialogueWithRevert("3D image artifacts enabled", setDialogueText);
            } else if (typeArg === '--questions') {
                // Switch to questions artifact type and enable artifacts
                setModeState(prev => ({
                    ...prev,
                    artefactsEnabled: true,
                    artifactType: 'questions'
                }));
                setDialogueWithRevert("3D question artifacts enabled", setDialogueText);
            } else {
                // No type specified - toggle artifacts enabled state
                setModeState(prev => ({
                    ...prev,
                    artefactsEnabled: !prev.artefactsEnabled
                }));
                
                const newState = !modeState.artefactsEnabled;
                setDialogueWithRevert(newState ? "3D artifacts enabled" : "3D artifacts disabled", setDialogueText);
            }
            
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});
            
            return null;
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
                hasNavigated: false
            });
            setCommandData({});

            return { command: 'share', args: [], commandStartPos: commandState.commandStartPos };
        }

        // Clear command mode for other commands
        setCommandState({
            isActive: false,
            input: '',
            matchedCommands: [],
            selectedIndex: 0,
            commandStartPos: { x: 0, y: 0 },
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
    const handleKeyDown = useCallback((
        key: string,
        cursorPos: Point,
        setCursorPos: (pos: Point | ((prev: Point) => Point)) => void,
        ctrlKey: boolean = false,
        metaKey: boolean = false
    ): boolean | CommandExecution | null => {
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
            return executeCommand();
        } else if (key === 'Escape') {
            // Exit command mode without executing
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 },
                hasNavigated: false
            });
            setCommandData({});
            return true;
        } else if (key === 'ArrowUp') {
            navigateUp();
            return true;
        } else if (key === 'ArrowDown') {
            navigateDown();
            return true;
        } else if (key === 'Tab') {
            // Tab completion - complete to currently selected suggestion or if there's only one match
            if (commandState.matchedCommands.length >= 1) {
                const selectedCommand = commandState.matchedCommands[commandState.selectedIndex];
                if (selectedCommand) {
                    // Update input to the selected/completed command
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
                            selectedIndex: 0
                        };
                    });
                    
                    // Move cursor to end of completed command
                    setCursorPos({
                        x: commandState.commandStartPos.x + selectedCommand.length + 1, // +1 for the '/'
                        y: commandState.commandStartPos.y
                    });
                }
            }
            return true;
        } else if (key === 'Backspace') {
            const result = handleBackspace();
            if (result.shouldMoveCursor) {
                setCursorPos(prev => ({ x: prev.x - 1, y: prev.y }));
            }
            return true;
        } else if (key.length === 1) {
            // Add character to command input
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

    return {
        commandState,
        commandData,
        handleKeyDown,
        selectCommand,
        isCommandMode: commandState.isActive,
        // Pending command system
        pendingCommand,
        executePendingCommand,
        setPendingCommand,
        // Mode system exports
        modeState,
        switchMode,
        switchBackgroundMode,
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
        cameraMode: modeState.cameraMode,
        isIndentEnabled: modeState.isIndentEnabled,
        isMoveMode: modeState.isMoveMode,
        exitMoveMode: () => setModeState(prev => ({ ...prev, isMoveMode: false })),
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
