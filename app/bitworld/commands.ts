import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Point, WorldData } from './world.engine';
import { generateImage } from './ai';

// --- Command System Types ---
export interface CommandState {
    isActive: boolean;
    input: string;
    matchedCommands: string[];
    selectedIndex: number;
    commandStartPos: Point;
}

export interface CommandExecution {
    command: string;
    args: string[];
    commandStartPos: Point;
}

// --- Mode System Types ---
export type CanvasMode = 'air' | 'light' | 'chat';
export type BackgroundMode = 'transparent' | 'color' | 'image' | 'space';

export interface ModeState {
    currentMode: CanvasMode;
    lightModeData: WorldData; // Ephemeral text data for light mode
    backgroundMode: BackgroundMode;
    backgroundColor: string;
    backgroundImage?: string; // URL or data URL for generated images
    textColor: string;
}

interface UseCommandSystemProps {
    setDialogueText: (text: string) => void;
    initialBackgroundColor?: string;
}

// --- Command System Constants ---
const AVAILABLE_COMMANDS = ['summarize', 'transform', 'explain', 'label', 'mode', 'settings', 'debug', 'deepspawn', 'chat', 'bg', 'nav'];
const MODE_COMMANDS = ['air', 'light', 'chat'];
const BG_COMMANDS = ['clear', 'white', 'black'];
const NAV_COMMANDS = ['off'];

// --- Command System Hook ---
export function useCommandSystem({ setDialogueText, initialBackgroundColor }: UseCommandSystemProps) {
    const router = useRouter();
    const [commandState, setCommandState] = useState<CommandState>({
        isActive: false,
        input: '',
        matchedCommands: [],
        selectedIndex: 0,
        commandStartPos: { x: 0, y: 0 }
    });
    
    const [commandData, setCommandData] = useState<WorldData>({});
    
    // Mode system state
    const [modeState, setModeState] = useState<ModeState>({
        currentMode: 'air',
        lightModeData: {},
        backgroundMode: 'space', // Default to space background
        backgroundColor: '#FFFFFF',
        backgroundImage: undefined,
        textColor: '#FFFFFF', // White text for space background by default
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
            if (parts.length > 1) {
                const navInput = parts[1];
                const suggestions = NAV_COMMANDS
                    .filter(nav => nav.startsWith(navInput))
                    .map(nav => `nav ${nav}`);
                
                const currentCommand = `nav ${navInput}`;
                if (navInput.length > 0 && !suggestions.some(s => s === currentCommand)) {
                     return [currentCommand, ...suggestions];
                }
                return suggestions;
            }
            return ['nav', ...NAV_COMMANDS.map(nav => `nav ${nav}`)];
        }
        
        return AVAILABLE_COMMANDS.filter(cmd => cmd.toLowerCase().startsWith(lowerInput));
    }, []);

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

    const switchBackgroundMode = useCallback((newMode: BackgroundMode, bgColor?: string, textColor?: string): boolean => {
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

            setModeState(prev => ({
                ...prev,
                backgroundMode: 'color',
                backgroundColor: hexBgColor,
                textColor: finalTextColor,
            }));
        } else if (newMode === 'transparent') {
            setModeState(prev => ({
                ...prev,
                backgroundMode: 'transparent',
                backgroundImage: undefined,
                textColor: '#FFFFFF', // Set text to white for transparent background
            }));
        } else if (newMode === 'space') {
            setModeState(prev => ({
                ...prev,
                backgroundMode: 'space',
                backgroundImage: undefined,
                textColor: '#FFFFFF', // White text for space background
            }));
        } else if (newMode === 'image' && bgColor) {
            // bgColor is actually the image URL/data for image mode
            setModeState(prev => ({
                ...prev,
                backgroundMode: 'image',
                backgroundImage: bgColor, // Using bgColor parameter as image URL
                textColor: textColor || '#FFFFFF', // Default to white text on images
            }));
        }
        return true;
    }, [setDialogueText]);

    useEffect(() => {
        if (initialBackgroundColor) {
            switchBackgroundMode('color', initialBackgroundColor);
        }
    }, [initialBackgroundColor, switchBackgroundMode]);

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
            const restOfInput = inputParts.slice(2).join(' '); // Everything after 'bg clear'

            if (bgArg === 'clear') {
                if (restOfInput.trim()) {
                    // 'bg clear' with a prompt - generate AI image
                    setDialogueText("Generating background image...");
                    generateImage(restOfInput).then((imageUrl) => {
                        if (imageUrl) {
                            switchBackgroundMode('image', imageUrl);
                            setDialogueText("Background image generated successfully!");
                        } else {
                            // Fallback to space background if image generation fails
                            switchBackgroundMode('space');
                            setDialogueText("Image generation not available, using space background.");
                        }
                    }).catch(() => {
                        switchBackgroundMode('space');
                        setDialogueText("Image generation failed, using space background.");
                    });
                } else {
                    // 'bg clear' without prompt - show space background
                    switchBackgroundMode('space');
                }
            } else if (bgArg) {
                const textArg = inputParts.length > 2 ? inputParts[2] : undefined;
                switchBackgroundMode('color', bgArg, textArg);
            } else {
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
            
            // Parse nav command arguments
            const inputParts = commandState.input.trim().split(/\s+/);
            const args = inputParts.slice(1);
            return { command: 'nav', args, commandStartPos: commandState.commandStartPos };
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
        
        if (selectedCommand.toLowerCase().startsWith(commandName.toLowerCase())) {
            const args = inputParts.slice(1);
            console.log('Executing command:', selectedCommand, 'with args:', args);
            return { command: selectedCommand, args, commandStartPos: commandState.commandStartPos };
        }
        
        return null;
    }, [commandState, switchMode]);

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
        // Mode system exports
        modeState,
        switchMode,
        addEphemeralText,
        currentMode: modeState.currentMode,
        lightModeData: modeState.lightModeData,
        backgroundMode: modeState.backgroundMode,
        backgroundColor: modeState.backgroundColor,
        backgroundImage: modeState.backgroundImage,
        textColor: modeState.textColor,
    };
}
