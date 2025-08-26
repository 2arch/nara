import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Point, WorldData } from './world.engine';
import { generateImage, generateVideo } from './ai';

// --- Command System Types ---
export interface CommandState {
    isActive: boolean;
    input: string;
    matchedCommands: string[];
    selectedIndex: number;
    commandStartPos: Point;
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
}

// --- Mode System Types ---
export type CanvasMode = 'air' | 'light' | 'chat';
export type BackgroundMode = 'transparent' | 'color' | 'image' | 'video' | 'space' | 'stream';

export interface ModeState {
    currentMode: CanvasMode;
    lightModeData: WorldData; // Ephemeral text data for light mode
    backgroundMode: BackgroundMode;
    backgroundColor: string;
    backgroundImage?: string; // URL or data URL for generated images
    backgroundVideo?: string; // URL or data URL for generated videos
    backgroundStream?: MediaStream; // MediaStream for screen share
    textColor: string;
    textBackground?: string; // Background color for text
    searchPattern: string; // Current search pattern
    isSearchActive: boolean; // Whether search highlighting is active
}

interface UseCommandSystemProps {
    setDialogueText: (text: string) => void;
    initialBackgroundColor?: string;
    getAllLabels?: () => Array<{text: string, x: number, y: number, color: string}>;
    availableStates?: string[];
}

// --- Command System Constants ---
const AVAILABLE_COMMANDS = ['summarize', 'transform', 'explain', 'label', 'mode', 'settings', 'debug', 'deepspawn', 'chat', 'bg', 'nav', 'search', 'state'];
const MODE_COMMANDS = ['air', 'light', 'chat'];
const BG_COMMANDS = ['clear', 'live', 'white', 'black', 'web'];
const NAV_COMMANDS: string[] = [];

// --- Command System Hook ---
export function useCommandSystem({ setDialogueText, initialBackgroundColor, getAllLabels, availableStates = [] }: UseCommandSystemProps) {
    const router = useRouter();
    const backgroundStreamRef = useRef<MediaStream | undefined>(undefined);
    const [commandState, setCommandState] = useState<CommandState>({
        isActive: false,
        input: '',
        matchedCommands: [],
        selectedIndex: 0,
        commandStartPos: { x: 0, y: 0 }
    });
    
    const [commandData, setCommandData] = useState<WorldData>({});
    const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(null);
    
    // Mode system state
    const [modeState, setModeState] = useState<ModeState>({
        currentMode: 'air',
        lightModeData: {},
        backgroundMode: 'color', // Default to color background
        backgroundColor: '#FFFFFF', // White background
        backgroundImage: undefined,
        backgroundVideo: undefined,
        backgroundStream: undefined,
        textColor: '#000000', // Black text on white background
        textBackground: undefined, // No text background by default
        searchPattern: '', // No search pattern initially
        isSearchActive: false, // Search not active initially
    });

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
                const suggestions = BG_COMMANDS
                    .filter(bg => bg.startsWith(bgInput))
                    .map(bg => `bg ${bg}`);
                
                const currentCommand = `bg ${bgInput}`;
                if (bgInput.length > 0 && !suggestions.some(s => s === currentCommand)) {
                     return [currentCommand, ...suggestions];
                }
                return suggestions;
            }
            return BG_COMMANDS.map(bg => `bg ${bg}`);
        }

        if (lowerInput === 'nav') {
            const parts = input.toLowerCase().split(' ');
            const labels = getAllLabels ? getAllLabels() : [];
            const labelNames = labels.map(label => label.text.toLowerCase());
            
            if (parts.length > 1) {
                const navInput = parts[1];
                const suggestions = labelNames
                    .filter(label => label.startsWith(navInput))
                    .map(label => `nav ${label}`);
                
                const currentCommand = `nav ${navInput}`;
                if (navInput.length > 0 && !suggestions.some(s => s === currentCommand)) {
                     return [currentCommand, ...suggestions];
                }
                return suggestions;
            }
            return labelNames.length > 0 ? labelNames.map(label => `nav ${label}`) : ['nav'];
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
                        return suggestions;
                    }
                    // Just typed --rm, show all states for deletion
                    return availableStates.length > 0 ? availableStates.map(state => `state --rm ${state}`) : ['state --rm <name>'];
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
                    return suggestions;
                }
            }
            // Show only available states as suggestions (no --rm in basic suggestions)
            return availableStates.length > 0 ? availableStates.map(state => `state ${state}`) : ['state <name>'];
        }
        
        return AVAILABLE_COMMANDS.filter(cmd => cmd.toLowerCase().startsWith(lowerInput));
    }, [getAllLabels, availableStates]);

    // Mode switching functionality
    const switchMode = useCallback((newMode: CanvasMode) => {
        setModeState(prev => {
            // Clear light mode data when switching away from light mode
            const lightModeData = newMode === 'light' ? prev.lightModeData : {};
            
            return {
                ...prev,
                currentMode: newMode,
                lightModeData
            };
        });
    }, []);

    const switchBackgroundMode = useCallback((newMode: BackgroundMode, bgColor?: string, textColor?: string, textBg?: string): boolean => {
        if (newMode === 'color' && bgColor) {
            const colorMap: { [name: string]: string } = {
                'white': '#FFFFFF',
                'black': '#000000',
            };
            const hexBgColor = (colorMap[bgColor.toLowerCase()] || bgColor).toUpperCase();

            if (!/^#[0-9A-F]{6}$/i.test(hexBgColor)) {
                setDialogueText(`Invalid background color: ${bgColor}. Please use a name (e.g., white) or hex code (e.g., #1a1a1a).`);
                return false;
            }
            
            let finalTextColor: string;
            
            if (textColor) {
                // User specified text color - validate it
                const hexTextColor = (colorMap[textColor.toLowerCase()] || textColor).toUpperCase();
                if (!/^#[0-9A-F]{6}$/i.test(hexTextColor)) {
                    setDialogueText(`Invalid text color: ${textColor}. Please use a name (e.g., white) or hex code (e.g., #1a1a1a).`);
                    return false;
                }
                finalTextColor = hexTextColor;
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
                const hexTextBg = (colorMap[textBg.toLowerCase()] || textBg).toUpperCase();
                if (!/^#[0-9A-F]{6}$/i.test(hexTextBg)) {
                    setDialogueText(`Invalid text background: ${textBg}. Please use a name (e.g., white) or hex code (e.g., #1a1a1a).`);
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
            }));
        } else if (newMode === 'transparent') {
            setModeState(prev => ({
                ...prev,
                backgroundMode: 'transparent',
                backgroundImage: undefined,
                textColor: textColor || '#FFFFFF', // Default to white text for transparent background
                textBackground: textBg,
            }));
        } else if (newMode === 'space') {
            setModeState(prev => ({
                ...prev,
                backgroundMode: 'space',
                backgroundImage: undefined,
                textColor: textColor || '#FFFFFF', // Default to white text for space background
                textBackground: textBg,
            }));
        } else if (newMode === 'image' && bgColor) {
            // bgColor is actually the image URL/data for image mode
            setModeState(prev => ({
                ...prev,
                backgroundMode: 'image',
                backgroundImage: bgColor, // Using bgColor parameter as image URL
                backgroundVideo: undefined,
                textColor: textColor || '#FFFFFF', // Default to white text on images
                textBackground: textBg,
            }));
        } else if (newMode === 'video' && bgColor) {
            // bgColor is actually the video URL/data for video mode
            setModeState(prev => ({
                ...prev,
                backgroundMode: 'video',
                backgroundImage: undefined,
                backgroundVideo: bgColor, // Using bgColor parameter as video URL
                textColor: textColor || '#FFFFFF', // Default to white text on videos
                textBackground: textBg,
            }));
        } else if (newMode === 'stream') {
            // Stream mode for screen sharing
            setModeState(prev => ({
                ...prev,
                backgroundMode: 'stream',
                backgroundImage: undefined,
                backgroundVideo: undefined,
                textColor: textColor || '#FFFFFF', // Default to white text on stream
                textBackground: textBg,
            }));
        }
        return true;
    }, [setDialogueText]);

    useEffect(() => {
        if (initialBackgroundColor && modeState.backgroundMode !== 'stream') {
            switchBackgroundMode('color', initialBackgroundColor);
        }
    }, [initialBackgroundColor]); // Removed switchBackgroundMode to avoid dependency issues

    // Add ephemeral text in light mode (disappears after 2 seconds)
    const addEphemeralText = useCallback((pos: Point, char: string) => {
        if (modeState.currentMode !== 'light') return;
        
        const key = `${pos.x},${pos.y}`;
        setModeState(prev => ({
            ...prev,
            lightModeData: {
                ...prev.lightModeData,
                [key]: char
            }
        }));
        
        // Remove the text after 2 seconds
        setTimeout(() => {
            setModeState(prev => {
                const newLightModeData = { ...prev.lightModeData };
                delete newLightModeData[key];
                return {
                    ...prev,
                    lightModeData: newLightModeData
                };
            });
        }, 2000);
    }, [modeState.currentMode]);

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
            commandStartPos: { x: cursorPos.x, y: cursorPos.y }
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
                selectedIndex: Math.min(prev.selectedIndex, newMatchedCommands.length - 1)
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
                commandStartPos: { x: 0, y: 0 }
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
                selectedIndex: Math.min(prev.selectedIndex, newMatchedCommands.length - 1)
            };
        });
        
        return { shouldExitCommand: false, shouldMoveCursor: true };
    }, [commandState.input.length, matchCommands]);

    // Navigate command suggestions
    const navigateUp = useCallback(() => {
        setCommandState(prev => ({
            ...prev,
            selectedIndex: Math.max(0, prev.selectedIndex - 1)
        }));
    }, []);

    const navigateDown = useCallback(() => {
        setCommandState(prev => ({
            ...prev,
            selectedIndex: Math.min(prev.matchedCommands.length - 1, prev.selectedIndex + 1)
        }));
    }, []);

    // Execute selected command
    const executeCommand = useCallback((): CommandExecution | null => {
        if (commandState.matchedCommands.length === 0) return null;

        const selectedCommand = commandState.matchedCommands[commandState.selectedIndex];
        if (!selectedCommand) return null; // Safety check for undefined command
        
        const fullInput = commandState.input.trim();
        const inputParts = fullInput.split(/\s+/);
        const commandName = inputParts[0];
        
        // Handle mode switching commands directly
        if (selectedCommand.startsWith('mode ')) {
            const modeArg = selectedCommand.split(' ')[1] as CanvasMode;
            if (MODE_COMMANDS.includes(modeArg)) {
                if (modeArg === 'chat') {
                    // For chat mode, redirect to /chat
                    router.push('/chat');
                } else {
                    // For other modes, switch mode in current context
                    switchMode(modeArg);
                    console.log(`Switched to ${modeArg} mode`);
                }
            }
            
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 }
            });
            setCommandData({});
            
            return null; // Mode switches don't need further processing
        }

        if (selectedCommand.startsWith('bg')) {
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
                    setDialogueText("Generating background image...");
                    generateImage(prompt).then((imageUrl) => {
                        if (imageUrl) {
                            switchBackgroundMode('image', imageUrl, textColorParam, textBgParam);
                            setDialogueText(`"${prompt}"`);
                        } else {
                            // Fallback to space background if image generation fails
                            switchBackgroundMode('space', undefined, textColorParam, textBgParam);
                            setDialogueText("Image generation not available, using space background.");
                        }
                    }).catch(() => {
                        switchBackgroundMode('space', undefined, textColorParam, textBgParam);
                        setDialogueText("Image generation failed, using space background.");
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
                    setDialogueText("Generating background video...");
                    generateVideo(prompt).then((videoUrl) => {
                        if (videoUrl) {
                            switchBackgroundMode('video', videoUrl, textColorParam, textBgParam);
                            setDialogueText(`"${prompt}"`);
                        } else {
                            // Fallback to space background if video generation fails
                            switchBackgroundMode('space', undefined, textColorParam, textBgParam);
                            setDialogueText("Video generation not available, using space background.");
                        }
                    }).catch(() => {
                        switchBackgroundMode('space', undefined, textColorParam, textBgParam);
                        setDialogueText("Video generation failed, using space background.");
                    });
                } else {
                    // 'bg live' without prompt - show space background
                    switchBackgroundMode('space', undefined, param2, param3);
                    setDialogueText("Video generation requires a prompt. Use: /bg live 'your prompt'");
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
                        const colorMap: { [name: string]: string } = {
                            'white': '#FFFFFF',
                            'black': '#000000',
                        };
                        const hexTextColor = (colorMap[textColorArg.toLowerCase()] || textColorArg).toUpperCase();
                        const validTextColor = /^#[0-9A-F]{6}$/i.test(hexTextColor) ? hexTextColor : '#FFFFFF';
                        
                        // Validate text background if provided
                        let validTextBg: string | undefined;
                        if (textBgArg) {
                            const hexTextBg = (colorMap[textBgArg.toLowerCase()] || textBgArg).toUpperCase();
                            validTextBg = /^#[0-9A-F]{6}$/i.test(hexTextBg) ? hexTextBg : undefined;
                        }
                        
                        setModeState(prev => ({
                            ...prev,
                            backgroundMode: 'stream',
                            backgroundStream: stream,
                            textColor: validTextColor,
                            textBackground: validTextBg,
                        }));
                        setDialogueText("Screen sharing active");
                        
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
                            setDialogueText("Screen sharing ended");
                        };
                    }).catch((err) => {
                        console.error('Error accessing screen share:', err);
                        setDialogueText("Screen sharing cancelled or not available");
                    });
                } else {
                    setDialogueText("Screen sharing not supported in this browser");
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
                commandStartPos: { x: 0, y: 0 }
            });
            setCommandData({});
            
            return null;
        }

        if (selectedCommand.startsWith('nav')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 }
            });
            setCommandData({});
            
            // Use the selected command instead of the typed input
            // Extract label name from selected command (format: "nav labelname")
            const commandParts = selectedCommand.split(' ');
            const labelQuery = commandParts.slice(1).join(' ');
            
            if (labelQuery && getAllLabels) {
                const labels = getAllLabels();
                // Find the label that matches the selected command (case insensitive)
                const targetLabel = labels.find(label => 
                    label.text.toLowerCase() === labelQuery.toLowerCase()
                );
                
                if (targetLabel) {
                    return { 
                        command: 'nav', 
                        args: [targetLabel.x.toString(), targetLabel.y.toString()], 
                        commandStartPos: commandState.commandStartPos 
                    };
                }
            }
            
            return { command: 'nav', args: [], commandStartPos: commandState.commandStartPos };
        }

        if (selectedCommand.startsWith('search')) {
            const inputParts = commandState.input.trim().split(/\s+/);
            const searchTerm = inputParts.slice(1).join(' ');
            
            if (searchTerm) {
                // Activate search with the term
                setModeState(prev => ({
                    ...prev,
                    searchPattern: searchTerm,
                    isSearchActive: true
                }));
                setDialogueText(`Search active: "${searchTerm}" - Press Escape to clear`);
            } else {
                // No search term - clear search
                setModeState(prev => ({
                    ...prev,
                    searchPattern: '',
                    isSearchActive: false
                }));
                setDialogueText("Search cleared");
            }
            
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 }
            });
            setCommandData({});
            
            return null;
        }

        if (selectedCommand.startsWith('state')) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 }
            });
            setCommandData({});
            
            // Use the selected command instead of the typed input
            // Extract arguments from selected command (format: "state [--rm] statename")
            const commandParts = selectedCommand.split(' ');
            const args = commandParts.slice(1); // Everything after 'state'
            
            // Return command execution for world engine to handle
            return {
                command: 'state',
                args: args,
                commandStartPos: commandState.commandStartPos
            };
        }
        
        // Handle commands that need text selection
        if (['transform', 'explain', 'summarize'].includes(selectedCommand.toLowerCase().split(' ')[0])) {
            // Clear command mode
            setCommandState({
                isActive: false,
                input: '',
                matchedCommands: [],
                selectedIndex: 0,
                commandStartPos: { x: 0, y: 0 }
            });
            setCommandData({});
            
            // Set as pending command waiting for selection
            const args = inputParts.slice(1);
            setPendingCommand({
                command: selectedCommand,
                args: args,
                isWaitingForSelection: true
            });
            
            return { command: 'pending_selection', args: [selectedCommand], commandStartPos: commandState.commandStartPos };
        }
        
        // Clear command mode for other commands
        setCommandState({
            isActive: false,
            input: '',
            matchedCommands: [],
            selectedIndex: 0,
            commandStartPos: { x: 0, y: 0 }
        });
        setCommandData({});
        
        if (selectedCommand.toLowerCase().startsWith(commandName.toLowerCase())) {
            const args = inputParts.slice(1);
            console.log('Executing command:', selectedCommand, 'with args:', args);
            return { command: selectedCommand, args, commandStartPos: commandState.commandStartPos };
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

    // Handle keyboard events for command mode
    const handleKeyDown = useCallback((
        key: string, 
        cursorPos: Point,
        setCursorPos: (pos: Point | ((prev: Point) => Point)) => void
    ): boolean | CommandExecution | null => {
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
                commandStartPos: { x: 0, y: 0 }
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
    }, [commandState.isActive, startCommand, executeCommand, navigateUp, navigateDown, handleBackspace, addCharacter]);

    return {
        commandState,
        commandData,
        handleKeyDown,
        isCommandMode: commandState.isActive,
        // Pending command system
        pendingCommand,
        executePendingCommand,
        setPendingCommand,
        // Mode system exports
        modeState,
        switchMode,
        addEphemeralText,
        currentMode: modeState.currentMode,
        lightModeData: modeState.lightModeData,
        backgroundMode: modeState.backgroundMode,
        backgroundColor: modeState.backgroundColor,
        backgroundImage: modeState.backgroundImage,
        backgroundVideo: modeState.backgroundVideo,
        backgroundStream: backgroundStreamRef.current || modeState.backgroundStream,
        textColor: modeState.textColor,
        textBackground: modeState.textBackground,
        searchPattern: modeState.searchPattern,
        isSearchActive: modeState.isSearchActive,
        clearSearch: () => setModeState(prev => ({ ...prev, searchPattern: '', isSearchActive: false })),
    };
}
