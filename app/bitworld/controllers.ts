import { useCallback, useState } from 'react';
import type { KeyboardEvent } from 'react';

// --- Controller System Types ---
export interface KeyBinding {
    key: string;
    ctrlOrMeta?: boolean;
    shift?: boolean;
    alt?: boolean;
    description: string;
    action: () => void;
}

export interface ControllerGroup {
    name: string;
    description: string;
    enabled: boolean;
    bindings: KeyBinding[];
}

export interface ControllerSystem {
    groups: ControllerGroup[];
    handleKeyDown: (e: KeyboardEvent<HTMLElement>) => boolean;
    registerGroup: (group: ControllerGroup) => void;
    unregisterGroup: (name: string) => void;
    getHelpText: () => string;
}

// --- Controller System Hook ---
export function useControllerSystem(): ControllerSystem {
    const [groups, setGroups] = useState<ControllerGroup[]>([]);

    const registerGroup = useCallback((group: ControllerGroup) => {
        setGroups(prevGroups => {
            const existingIndex = prevGroups.findIndex(g => g.name === group.name);
            if (existingIndex >= 0) {
                const newGroups = [...prevGroups];
                newGroups[existingIndex] = group;
                return newGroups;
            } else {
                return [...prevGroups, group];
            }});
    }, []);

    const unregisterGroup = useCallback((name: string) => {
        setGroups(prevGroups => prevGroups.filter(g => g.name !== name));
    }, []);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLElement>): boolean => {
        // Check all enabled controller groups
        for (const group of groups) {
            if (!group.enabled) continue;

            for (const binding of group.bindings) {
                const keyMatches = binding.key.toLowerCase() === e.key.toLowerCase();
                const ctrlMatches = !binding.ctrlOrMeta || (e.ctrlKey || e.metaKey);
                const shiftMatches = !binding.shift || e.shiftKey;
                const altMatches = !binding.alt || e.altKey;

                if (keyMatches && ctrlMatches && shiftMatches && altMatches) {
                    // Prevent default immediately to stop browser shortcuts
                    e.preventDefault();
                    e.stopPropagation();
                    
                    // Execute the action after preventing default
                    try {
                        binding.action();
                    } catch (error) {
                        console.error(`Error executing keybinding action for ${binding.key}:`, error);
                    }
                    
                    return true; // Handled
                }
            }
        }

        return false; // Not handled
    }, [groups]);

    const getHelpText = useCallback((): string => {
        const enabledGroups = groups.filter(g => g.enabled);
        if (enabledGroups.length === 0) return '';

        let helpText = '';
        enabledGroups.forEach(group => {
            helpText += `\n${group.description}:\n`;
            group.bindings.forEach(binding => {
                const modifiers = [];
                if (binding.ctrlOrMeta) modifiers.push('Ctrl');
                if (binding.shift) modifiers.push('Shift');
                if (binding.alt) modifiers.push('Alt');
                
                const keyCombo = modifiers.length > 0 
                    ? `${modifiers.join('+')}+${binding.key}`
                    : binding.key;
                
                helpText += `  ${keyCombo}: ${binding.description}\n`;
            });
        });

        return helpText;
    }, [groups]);

    return {
        groups,
        handleKeyDown,
        registerGroup,
        unregisterGroup,
        getHelpText
    };
}

// --- Monogram Controller ---
export function createMonogramController(monogramSystem: any): ControllerGroup {
    return {
        name: 'monogram',
        description: 'Psychedelic Pattern Controls',
        enabled: true,
        bindings: [
            {
                key: 'm',
                ctrlOrMeta: true,
                description: 'Cycle pattern mode (off/mode1/mode2/...)',
                action: () => monogramSystem.cycleMode()
            },
            {
                key: '=',
                ctrlOrMeta: true,
                description: 'Increase animation speed',
                action: () => monogramSystem.updateOption('speed', (speed: number) => Math.min(3.0, speed + 0.2))
            },
            {
                key: '+',
                ctrlOrMeta: true,
                description: 'Increase animation speed',
                action: () => monogramSystem.updateOption('speed', (speed: number) => Math.min(3.0, speed + 0.2))
            },
            {
                key: '-',
                ctrlOrMeta: true,
                description: 'Decrease animation speed',
                action: () => monogramSystem.updateOption('speed', (speed: number) => Math.max(0.1, speed - 0.2))
            },
            {
                key: ']',
                ctrlOrMeta: true,
                description: 'Increase complexity',
                action: () => monogramSystem.updateOption('complexity', (complexity: number) => Math.min(2.0, complexity + 0.2))
            },
            {
                key: '[',
                ctrlOrMeta: true,
                description: 'Decrease complexity',
                action: () => monogramSystem.updateOption('complexity', (complexity: number) => Math.max(0.1, complexity - 0.2))
            },
            {
                key: 'r',
                ctrlOrMeta: true,
                shift: true,
                description: 'Randomize color shift',
                action: () => monogramSystem.updateOption('colorShift', Math.random() * Math.PI * 2)
            }
        ]
    };
}

// --- Example: Debug Controller ---
export function createDebugController(debugSystem: any): ControllerGroup {
    return {
        name: 'debug',
        description: 'Debug & Development Controls',
        enabled: true,
        bindings: [
            {
                key: 'd',
                ctrlOrMeta: true,
                shift: true,
                description: 'Toggle debug display',
                action: () => debugSystem?.toggleDebug?.()
            },
            {
                key: 'i',
                ctrlOrMeta: true,
                shift: true,
                description: 'Show system info',
                action: () => debugSystem?.showSystemInfo?.()
            }
        ]
    };
}

// --- Example: Camera Controller ---
export function createCameraController(engine: any): ControllerGroup {
    return {
        name: 'camera',
        description: 'Camera & Viewport Controls',
        enabled: true,
        bindings: [
            {
                key: 'Home',
                description: 'Return to origin',
                action: () => engine.setViewOffset({ x: 0, y: 0 })
            },
            {
                key: 'h',
                ctrlOrMeta: true,
                description: 'Reset zoom level (Home zoom)',
                action: () => {
                    // Reset zoom to 1.0
                    if (engine.setZoomLevel) {
                        engine.setZoomLevel(1.0);
                    }
                }
            }
        ]
    };
}

// --- Grid Controller ---
export function createGridController(gridSystem: any): ControllerGroup {
    return {
        name: 'grid',
        description: '3D Grid Controls',
        enabled: true,
        bindings: [
            {
                key: 'g',
                ctrlOrMeta: true,
                description: 'Cycle grid mode (dots/lines)',
                action: () => {
                    if (gridSystem?.cycleGridMode) {
                        gridSystem.cycleGridMode();
                    }
                }
            }
        ]
    };
}

// --- Tape Recorder Controller ---
export function createTapeController(toggleRecording: () => void): ControllerGroup {
    return {
        name: 'tape',
        description: 'Canvas Recorder Controls',
        enabled: true,
        bindings: [
            {
                key: 'e',
                ctrlOrMeta: true,
                description: 'Toggle recording (start/stop & download)',
                action: toggleRecording
            }
        ]
    };
}

// --- Command Controller ---
export function createCommandController(actions: {
    executeNote: () => void;
    executePublish: () => void;
    openCommandPalette: () => void;
    openSearch: () => void;
}): ControllerGroup {
    return {
        name: 'commands',
        description: 'Quick Command Shortcuts',
        enabled: true,
        bindings: [
            {
                key: 'n',
                ctrlOrMeta: true,
                description: 'Create note region (/note)',
                action: actions.executeNote
            },
            {
                key: 'f',
                ctrlOrMeta: true,
                description: 'Search canvas (/search)',
                action: actions.openSearch
            },
            {
                key: 'k',
                ctrlOrMeta: true,
                description: 'Open command palette',
                action: actions.openCommandPalette
            },
            {
                key: 'p',
                ctrlOrMeta: true,
                description: 'Publish canvas (/publish)',
                action: actions.executePublish
            }
        ]
    };
}