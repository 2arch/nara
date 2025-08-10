import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Point, WorldData } from './world.engine';

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
export type BackgroundMode = 'transparent' | 'color';

export interface ModeState {
    currentMode: CanvasMode;
    lightModeData: WorldData; // Ephemeral text data for light mode
    backgroundMode: BackgroundMode;
    backgroundColor: string;
    textColor: string;
}

interface UseCommandSystemProps {
    setDialogueText: (text: string) => void;
    initialBackgroundColor?: string;
}

// --- Command System Constants ---
const AVAILABLE_COMMANDS = ['summarize', 'transform', 'explain', 'label', 'mode', 'settings', 'debug', 'deepspawn', 'chat', 'bg'];
const MODE_COMMANDS = ['air', 'light', 'chat'];
const BG_COMMANDS = ['clear', 'white', 'black'];

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
        backgroundMode: 'transparent',
        backgroundColor: '#FFFFFF',
        textColor: '#000000',
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

    const switchBackgroundMode = useCallback((newMode: BackgroundMode, color?: string): boolean => {
        if (newMode === 'color' && color) {
            const colorMap: { [name: string]: string } = {
                'white': '#FFFFFF',
                'black': '#000000',
            };
            const hexColor = (colorMap[color.toLowerCase()] || color).toUpperCase();

            if (!/^#[0-9A-F]{6}$/i.test(hexColor)) {
                setDialogueText(`Invalid color: ${color}. Please use a name (e.g., white) or hex code (e.g., #1a1a1a).`);
                return false;
            }
            
            const rgb = parseInt(hexColor.substring(1), 16);
            const r = (rgb >> 16) & 0xff;
            const g = (rgb >>  8) & 0xff;
            const b = (rgb >>  0) & 0xff;
            const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const newTextColor = luma < 128 ? '#FFFFFF' : '#000000';

            setModeState(prev => ({
                ...prev,
                backgroundMode: 'color',
                backgroundColor: hexColor,
                textColor: newTextColor,
            }));
        } else {
            setModeState(prev => ({
                ...prev,
                backgroundMode: 'transparent',
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

            if (bgArg === 'clear') {
                switchBackgroundMode('transparent');
            } else if (bgArg) {
                switchBackgroundMode('color', bgArg);
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
        textColor: modeState.textColor,
    };
}
