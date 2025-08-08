import { useState, useCallback } from 'react';
import type { Point, WorldData } from './world.engine';

// --- Command System Types ---
export interface CommandState {
    isActive: boolean;
    input: string;
    matchedCommands: string[];
    selectedIndex: number;
    commandStartPos: Point;
}

// --- Command System Constants ---
const AVAILABLE_COMMANDS = ['summarize', 'transform', 'explain', 'label', 'modes', 'settings'];

// --- Command System Hook ---
export function useCommandSystem() {
    const [commandState, setCommandState] = useState<CommandState>({
        isActive: false,
        input: '',
        matchedCommands: [],
        selectedIndex: 0,
        commandStartPos: { x: 0, y: 0 }
    });
    
    const [commandData, setCommandData] = useState<WorldData>({});

    // Utility function to match commands based on input
    const matchCommands = useCallback((input: string): string[] => {
        if (!input) return AVAILABLE_COMMANDS;
        const lowerInput = input.toLowerCase();
        return AVAILABLE_COMMANDS.filter(cmd => cmd.toLowerCase().startsWith(lowerInput));
    }, []);

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
    const executeCommand = useCallback(() => {
        const selectedCommand = commandState.matchedCommands[commandState.selectedIndex];
        
        // Clear command mode
        setCommandState({
            isActive: false,
            input: '',
            matchedCommands: [],
            selectedIndex: 0,
            commandStartPos: { x: 0, y: 0 }
        });
        setCommandData({});
        
        // TODO: Implement actual command execution logic
        console.log('Executing command:', selectedCommand);
        
        return selectedCommand;
    }, [commandState.matchedCommands, commandState.selectedIndex]);

    // Handle keyboard events for command mode
    const handleKeyDown = useCallback((
        key: string, 
        cursorPos: Point,
        setCursorPos: (pos: Point | ((prev: Point) => Point)) => void
    ): boolean => {
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
        if (key === 'Enter') {
            executeCommand();
            return true;
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
        isCommandMode: commandState.isActive
    };
}