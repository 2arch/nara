import { useCallback } from 'react';
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
    const groups: ControllerGroup[] = [];

    const registerGroup = useCallback((group: ControllerGroup) => {
        const existingIndex = groups.findIndex(g => g.name === group.name);
        if (existingIndex >= 0) {
            groups[existingIndex] = group;
        } else {
            groups.push(group);
        }
    }, [groups]);

    const unregisterGroup = useCallback((name: string) => {
        const index = groups.findIndex(g => g.name === name);
        if (index >= 0) {
            groups.splice(index, 1);
        }
    }, [groups]);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLElement>): boolean => {
        // Check all enabled controller groups
        for (const group of groups) {
            if (!group.enabled) continue;

            for (const binding of group.bindings) {
                const keyMatches = binding.key.toLowerCase() === e.key.toLowerCase();
                const ctrlMatches = !binding.ctrlOrMeta || (e.ctrlKey || e.metaKey);
                const shiftMatches = !binding.shift || e.shiftKey;
                const altMatches = !binding.alt || e.altKey;

                // If ctrl/meta is required, make sure at least one is pressed
                const ctrlRequired = binding.ctrlOrMeta && !(e.ctrlKey || e.metaKey);

                if (keyMatches && ctrlMatches && shiftMatches && altMatches && !ctrlRequired) {
                    binding.action();
                    e.preventDefault();
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
                description: 'Toggle monogram on/off',
                action: () => monogramSystem.toggleEnabled()
            },
            {
                key: 'n',
                ctrlOrMeta: true,
                description: 'Cycle pattern mode',
                action: () => monogramSystem.cycleMode()
            },
            {
                key: '=',
                ctrlOrMeta: true,
                description: 'Increase animation speed',
                action: () => monogramSystem.updateOption('speed', Math.min(3.0, monogramSystem.options.speed + 0.2))
            },
            {
                key: '+',
                ctrlOrMeta: true,
                description: 'Increase animation speed',
                action: () => monogramSystem.updateOption('speed', Math.min(3.0, monogramSystem.options.speed + 0.2))
            },
            {
                key: '-',
                ctrlOrMeta: true,
                description: 'Decrease animation speed',
                action: () => monogramSystem.updateOption('speed', Math.max(0.1, monogramSystem.options.speed - 0.2))
            },
            {
                key: ']',
                ctrlOrMeta: true,
                description: 'Increase complexity',
                action: () => monogramSystem.updateOption('complexity', Math.min(2.0, monogramSystem.options.complexity + 0.2))
            },
            {
                key: '[',
                ctrlOrMeta: true,
                description: 'Decrease complexity',
                action: () => monogramSystem.updateOption('complexity', Math.max(0.1, monogramSystem.options.complexity - 0.2))
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
                key: '0',
                ctrlOrMeta: true,
                description: 'Reset zoom level',
                action: () => {
                    // Reset zoom to 1.0 if engine supports it
                    engine.setZoomLevel?.(1.0);
                }
            }
        ]
    };
}