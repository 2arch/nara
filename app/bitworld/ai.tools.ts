// Consolidated tool definitions for Nara canvas
// Two core tools: sense() and make()
// No external dependencies - can be used by both Gemini AI and MCP server
// This file is the SINGLE SOURCE OF TRUTH for all canvas actions

// Tool definition interface (framework-agnostic)
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

// =============================================================================
// ACTION TYPES - Single source of truth for canvas actions
// =============================================================================

/** Top-level make() action keys - the canonical list of what can be done to the canvas */
export const MAKE_ACTIONS = [
  'paint',       // Paint cells, shapes, lines
  'note',        // Create notes (text, image, data, script)
  'text',        // Write text directly on canvas
  'chip',        // Create label chips
  'agent',       // Create/move/command agents
  'delete',      // Delete entities
  'command',     // Run any /command
  'run_script',  // Execute a script note
  'edit_note',   // CRDT-style note editing
] as const;

/** Type derived from MAKE_ACTIONS array */
export type MakeAction = typeof MAKE_ACTIONS[number];

/** Sense query types */
export const SENSE_QUERIES = [
  'notes',
  'agents',
  'chips',
  'text',
  'paint',
  'viewport',
  'cursor',
  'selection',
  'all',
] as const;

export type SenseQuery = typeof SENSE_QUERIES[number];

/** Agent movement commands - separate from canvas actions */
export const AGENT_MOVEMENT = [
  'move',        // Move agent (relative dx,dy)
  'stop',        // Stop agent movement
] as const;

export type AgentMovement = typeof AGENT_MOVEMENT[number];

/** Combined: what behaviors can trigger (canvas actions + movement) */
export type OnColorAction = MakeAction | AgentMovement;

// =============================================================================
// CONSOLIDATED TOOLS: sense + make
// =============================================================================

export const canvasTools: ToolDefinition[] = [
  {
    name: 'sense',
    description: `Query the canvas to find entities and get information. Use this to discover what exists before taking action.

Examples:
- sense({ find: 'agents' }) - get all agents
- sense({ find: 'notes', region: { x: 0, y: 0, width: 100, height: 100 } }) - notes in region
- sense({ find: 'all', near: { x: 50, y: 50 } }) - everything near a point
- sense({ find: 'viewport' }) - current camera position
- sense({ find: 'text', region: {...} }) - read text in area`,
    parameters: {
      type: 'object',
      properties: {
        find: {
          type: 'string',
          enum: ['notes', 'agents', 'chips', 'text', 'paint', 'viewport', 'cursor', 'selection', 'all'],
          description: 'What to look for'
        },
        region: {
          type: 'object',
          description: 'Rectangular region to query',
          properties: {
            x: { type: 'number', description: 'Top-left X' },
            y: { type: 'number', description: 'Top-left Y' },
            width: { type: 'number', description: 'Width in cells' },
            height: { type: 'number', description: 'Height in cells' }
          },
          required: ['x', 'y', 'width', 'height']
        },
        near: {
          type: 'object',
          description: 'Find entities near this position',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            radius: { type: 'number', description: 'Search radius (default: 10)' }
          },
          required: ['x', 'y']
        },
        id: {
          type: 'string',
          description: 'Find specific entity by ID/key'
        }
      },
      required: ['find']
    }
  },
  {
    name: 'make',
    description: `Create or modify things on the canvas. This is the primary action tool.

Examples:
- make({ paint: { rect: { x: 0, y: 0, width: 10, height: 10, color: '#ff0000' } } })
- make({ paint: { circle: { x: 50, y: 50, radius: 5, color: '#00ff00' } } })
- make({ paint: { line: { x1: 0, y1: 0, x2: 100, y2: 100, color: '#0000ff' } } })
- make({ paint: { cells: [{ x: 1, y: 1, color: '#fff' }, ...] } })
- make({ paint: { erase: { x: 0, y: 0, width: 10, height: 10 } } })
- make({ note: { x: 10, y: 10, width: 20, height: 15, contentType: 'text', content: 'Hello' } })
- make({ note: { x: 10, y: 10, width: 30, height: 20, contentType: 'image', generateImage: 'a sunset' } })
- make({ text: { x: 5, y: 5, content: 'Hello world' } })
- make({ chip: { x: 0, y: 0, text: 'Label', color: '#ff0000' } })
- make({ agent: { create: { x: 50, y: 50, spriteName: 'wizard' } } })
- make({ agent: { target: { near: { x: 10, y: 10 } }, move: { to: { x: 100, y: 100 } } } })
- make({ agent: { target: { all: true }, move: { expr: { x: 'startX + t*5', y: 'startY + sin(t)*10' } } } })
- make({ agent: { target: { name: 'wizard' }, action: { command: '/paint red' } } })
- make({ agent: { target: { id: 'abc123' }, move: { stop: true } } })
- make({ delete: { type: 'note', id: 'note_123,456_789' } })
- make({ command: '/color blue' })
- make({ run_script: { noteId: 'note_123_abc' } }) - execute a script note by ID`,
    parameters: {
      type: 'object',
      properties: {
        // PAINT
        paint: {
          type: 'object',
          description: 'Paint on the canvas',
          properties: {
            cells: {
              type: 'array',
              description: 'Array of individual cells to paint',
              items: {
                type: 'object',
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  color: { type: 'string', description: 'Hex color (e.g., #ff0000)' }
                },
                required: ['x', 'y', 'color']
              }
            },
            rect: {
              type: 'object',
              description: 'Paint a rectangle',
              properties: {
                x: { type: 'number', description: 'Top-left X' },
                y: { type: 'number', description: 'Top-left Y' },
                width: { type: 'number' },
                height: { type: 'number' },
                color: { type: 'string', description: 'Hex color' },
                filled: { type: 'boolean', description: 'Fill or outline (default: true)' }
              },
              required: ['x', 'y', 'width', 'height', 'color']
            },
            circle: {
              type: 'object',
              description: 'Paint a circle',
              properties: {
                x: { type: 'number', description: 'Center X' },
                y: { type: 'number', description: 'Center Y' },
                radius: { type: 'number' },
                color: { type: 'string', description: 'Hex color' },
                filled: { type: 'boolean', description: 'Fill or outline (default: true)' }
              },
              required: ['x', 'y', 'radius', 'color']
            },
            line: {
              type: 'object',
              description: 'Paint a line',
              properties: {
                x1: { type: 'number', description: 'Start X' },
                y1: { type: 'number', description: 'Start Y' },
                x2: { type: 'number', description: 'End X' },
                y2: { type: 'number', description: 'End Y' },
                color: { type: 'string', description: 'Hex color' }
              },
              required: ['x1', 'y1', 'x2', 'y2', 'color']
            },
            erase: {
              type: 'object',
              description: 'Erase a region',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                width: { type: 'number' },
                height: { type: 'number' }
              },
              required: ['x', 'y', 'width', 'height']
            }
          }
        },
        // NOTE
        note: {
          type: 'object',
          description: 'Create a note (text, image, or other content)',
          properties: {
            x: { type: 'number', description: 'Top-left X' },
            y: { type: 'number', description: 'Top-left Y' },
            width: { type: 'number', description: 'Width in cells' },
            height: { type: 'number', description: 'Height in cells' },
            contentType: {
              type: 'string',
              enum: ['text', 'image', 'data', 'terminal'],
              description: 'Type of note content (default: text)'
            },
            content: { type: 'string', description: 'Text content for text notes' },
            generateImage: { type: 'string', description: 'Prompt to generate image (for image notes)' },
            imageData: {
              type: 'object',
              description: 'Direct image data (if already have it)',
              properties: {
                src: { type: 'string' },
                originalWidth: { type: 'number' },
                originalHeight: { type: 'number' }
              }
            },
            scriptData: {
              type: 'object',
              description: 'Script note configuration (for script contentType)',
              properties: {
                language: { type: 'string', description: 'Programming language (javascript, python, etc.)' }
              }
            },
            tableData: {
              type: 'object',
              description: 'Table/data note configuration (for data contentType)',
              properties: {
                columns: {
                  type: 'array',
                  description: 'Column definitions',
                  items: {
                    type: 'object',
                    properties: {
                      width: { type: 'number', description: 'Column width in cells' }
                    },
                    required: ['width']
                  }
                },
                rows: {
                  type: 'array',
                  description: 'Row definitions',
                  items: {
                    type: 'object',
                    properties: {
                      height: { type: 'number', description: 'Row height (usually 1)' }
                    },
                    required: ['height']
                  }
                },
                cells: {
                  type: 'object',
                  description: 'Cell data as "row,col": "value" (e.g., {"0,0": "Name", "0,1": "Age", "1,0": "Alice", "1,1": "25"})'
                }
              },
              required: ['columns', 'rows', 'cells']
            }
          },
          required: ['x', 'y', 'width', 'height']
        },
        // TEXT
        text: {
          type: 'object',
          description: 'Write text directly on the canvas',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            content: { type: 'string' }
          },
          required: ['x', 'y', 'content']
        },
        // CHIP
        chip: {
          type: 'object',
          description: 'Create a small label/chip',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            text: { type: 'string' },
            color: { type: 'string', description: 'Hex color (optional)' }
          },
          required: ['x', 'y', 'text']
        },
        // AGENT
        agent: {
          type: 'object',
          description: 'Create, move, or command agents',
          properties: {
            target: {
              type: 'object',
              description: 'Which agent(s) to act on',
              properties: {
                id: { type: 'string', description: 'Specific agent ID' },
                near: {
                  type: 'object',
                  properties: { x: { type: 'number' }, y: { type: 'number' } },
                  description: 'Agent nearest to position'
                },
                name: { type: 'string', description: 'Agent by sprite name' },
                all: { type: 'boolean', description: 'All agents' }
              }
            },
            create: {
              type: 'object',
              description: 'Create a new agent',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                spriteName: { type: 'string' }
              },
              required: ['x', 'y']
            },
            move: {
              type: 'object',
              description: 'Movement state',
              properties: {
                to: {
                  type: 'object',
                  properties: { x: { type: 'number' }, y: { type: 'number' } },
                  description: 'Move to point'
                },
                path: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { x: { type: 'number' }, y: { type: 'number' } }
                  },
                  description: 'Follow path of waypoints'
                },
                expr: {
                  type: 'object',
                  properties: {
                    x: { type: 'string', description: 'Expression for X (e.g., "startX + t * 5")' },
                    y: { type: 'string', description: 'Expression for Y (e.g., "startY + sin(t) * 10")' },
                    duration: { type: 'number', description: 'Duration in seconds' },
                    vars: { type: 'object', description: 'Custom variables' }
                  },
                  description: 'Expression-based movement'
                },
                stop: { type: 'boolean', description: 'Stop movement' }
              }
            },
            action: {
              type: 'object',
              description: 'Execute command at agent position',
              properties: {
                command: { type: 'string', description: 'Command to execute (e.g., "/paint red")' },
                selection: {
                  type: 'object',
                  properties: {
                    width: { type: 'number' },
                    height: { type: 'number' }
                  },
                  description: 'Optional selection region'
                }
              },
              required: ['command']
            },
            mind: {
              type: 'object',
              description: 'Set agent mind/persona for autonomous behavior',
              properties: {
                persona: { type: 'string', description: 'Who is this agent? What drives it?' },
                goals: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'What the agent is trying to accomplish'
                }
              }
            },
            think: {
              type: 'boolean',
              description: 'Trigger one thinking cycle for the targeted agent(s). Agent will perceive nearby context and decide what to do.'
            },
            behaviors: {
              type: 'object',
              description: 'Add or remove paint-reactive behaviors for stigmergic movement',
              properties: {
                add: {
                  type: 'object',
                  description: 'Add a behavior',
                  properties: {
                    type: {
                      type: 'string',
                      enum: ['follow-color', 'avoid-color', 'stop-on-color', 'turn-on-color'],
                      description: 'Behavior type'
                    },
                    color: { type: 'string', description: 'Hex color to react to (e.g., #000000)' },
                    direction: {
                      type: 'string',
                      enum: ['left', 'right', 'reverse'],
                      description: 'Turn direction (for turn-on-color)'
                    },
                    priority: { type: 'number', description: 'Higher = evaluated first' }
                  },
                  required: ['type', 'color']
                },
                remove: {
                  type: 'object',
                  description: 'Remove a behavior',
                  properties: {
                    type: {
                      type: 'string',
                      enum: ['follow-color', 'avoid-color', 'stop-on-color', 'turn-on-color'],
                      description: 'Behavior type to remove'
                    },
                    color: { type: 'string', description: 'Color of behavior to remove' }
                  },
                  required: ['type', 'color']
                },
                clear: { type: 'boolean', description: 'Remove all behaviors' },
                list: { type: 'boolean', description: 'Return list of current behaviors' }
              }
            }
          }
        },
        // DELETE
        delete: {
          type: 'object',
          description: 'Delete an entity',
          properties: {
            type: {
              type: 'string',
              enum: ['note', 'agent', 'chip'],
              description: 'Type of entity to delete'
            },
            id: { type: 'string', description: 'Entity ID to delete' }
          },
          required: ['type', 'id']
        },
        // COMMAND
        command: {
          type: 'string',
          description: 'Execute a Nara command (e.g., "/color red", "/brush 3")'
        },
        // RUN SCRIPT
        run_script: {
          type: 'object',
          description: 'Execute a script note by ID and get the output',
          properties: {
            noteId: { type: 'string', description: 'The ID of the script note to execute' }
          },
          required: ['noteId']
        },
        // EDIT NOTE - CRDT-style patch operations for collaborative editing
        edit_note: {
          type: 'object',
          description: 'Edit an existing note using CRDT-style patch operations. Supports append, insert, delete, and replace.',
          properties: {
            noteId: { type: 'string', description: 'The ID of the note to edit' },
            operation: {
              type: 'string',
              enum: ['append', 'insert', 'delete', 'replace', 'clear'],
              description: 'The type of edit operation'
            },
            // For append/insert/replace
            text: { type: 'string', description: 'Text to insert or append' },
            // For insert - position in the text
            position: {
              type: 'object',
              description: 'Position for insert operation (line and column)',
              properties: {
                line: { type: 'number', description: 'Line number (0-indexed)' },
                column: { type: 'number', description: 'Column number (0-indexed)' }
              }
            },
            // For delete/replace - range to affect
            range: {
              type: 'object',
              description: 'Range for delete/replace operations',
              properties: {
                startLine: { type: 'number', description: 'Start line (0-indexed)' },
                startColumn: { type: 'number', description: 'Start column (0-indexed)' },
                endLine: { type: 'number', description: 'End line (0-indexed)' },
                endColumn: { type: 'number', description: 'End column (0-indexed)' }
              }
            },
            // For table notes - cell-level edits
            cell: {
              type: 'object',
              description: 'For table/data notes: edit a specific cell',
              properties: {
                row: { type: 'number', description: 'Row index (0-indexed)' },
                col: { type: 'number', description: 'Column index (0-indexed)' },
                value: { type: 'string', description: 'New cell value' }
              }
            }
          },
          required: ['noteId', 'operation']
        }
      }
    }
  }
];

// =============================================================================
// TOOL CONTEXT - Interface for executing tools
// =============================================================================

export interface ToolContext {
  // Paint operations
  paintCells: (cells: Array<{ x: number; y: number; color: string }>) => void;
  eraseCells: (cells: Array<{ x: number; y: number }>) => void;

  // Sensing
  getCursorPosition: () => { x: number; y: number };
  setCursorPosition?: (x: number, y: number) => void;
  getViewport: () => { offset: { x: number; y: number }; zoomLevel: number };
  setViewport?: (x: number, y: number, zoom?: number) => void;
  getSelection: () => { start: { x: number; y: number } | null; end: { x: number; y: number } | null };
  setSelection?: (startX: number, startY: number, endX: number, endY: number) => void;
  clearSelection?: () => void;
  getAgents: () => Array<{ id: string; x: number; y: number; spriteName?: string }>;
  getNotes: () => Array<{ id: string; x: number; y: number; width: number; height: number; contentType?: string; content?: string }>;
  getChips: () => Array<{ id: string; x: number; y: number; text: string; color?: string }>;
  getTextAt?: (x: number, y: number, width: number, height: number) => string[];
  getCanvasInfo?: (region?: { x: number; y: number; width: number; height: number }) => any;

  // Creating
  createNote: (x: number, y: number, width: number, height: number, contentType?: string, content?: string, imageData?: { src: string; originalWidth: number; originalHeight: number }, generateImage?: string, scriptData?: { language: string }, tableData?: { columns: { width: number }[]; rows: { height: number }[]; cells: Record<string, string>; frozenRows?: number; frozenCols?: number; activeCell?: { row: number; col: number }; cellScrollOffsets?: Record<string, number> }) => void;
  createChip: (x: number, y: number, text: string, color?: string) => void;
  createAgent: (x: number, y: number, spriteName?: string) => string | null;
  writeText: (x: number, y: number, text: string) => void;

  // Agent operations
  moveAgents: (agentIds: string[], destination: { x: number; y: number }) => void;
  moveAgentsPath?: (agentIds: string[], path: Array<{ x: number; y: number }>) => void;
  moveAgentsExpr?: (agentIds: string[], xExpr: string, yExpr: string, vars?: Record<string, number>, duration?: number) => void;
  stopAgentsExpr?: (agentIds: string[]) => void;
  agentAction?: (agentId: string, command: string, selection?: { width: number; height: number }) => void;
  setAgentMind?: (agentId: string, persona?: string, goals?: string[]) => void;
  agentThink?: (agentId: string) => Promise<{ thought: string; actions?: any[] } | null>;

  // Deletion
  deleteEntity?: (type: 'note' | 'agent' | 'chip', id: string) => void;

  // Commands
  runCommand: (command: string) => void;

  // Script execution
  runScript?: (noteId: string) => Promise<{ success: boolean; output?: string[]; error?: string }>;

  // Note editing - CRDT-style operations
  editNote?: (noteId: string, edit: NoteEdit) => { success: boolean; error?: string };
}

// =============================================================================
// NOTE EDIT TYPES - CRDT-style patch operations
// =============================================================================

export interface NoteEditPosition {
  line: number;
  column: number;
}

export interface NoteEditRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface NoteEditCell {
  row: number;
  col: number;
  value: string;
}

export type NoteEdit =
  | { operation: 'append'; text: string }
  | { operation: 'insert'; text: string; position: NoteEditPosition }
  | { operation: 'delete'; range: NoteEditRange }
  | { operation: 'replace'; text: string; range: NoteEditRange }
  | { operation: 'clear' }
  | { operation: 'cell'; cell: NoteEditCell }

// =============================================================================
// HELPER FUNCTIONS - Shape generation
// =============================================================================

export function generateRectCells(x: number, y: number, width: number, height: number, filled: boolean): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      if (filled || dx === 0 || dx === width - 1 || dy === 0 || dy === height - 1) {
        cells.push({ x: x + dx, y: y + dy });
      }
    }
  }
  return cells;
}

export function generateCircleCells(centerX: number, centerY: number, radius: number, filled: boolean): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      const distance = Math.sqrt(x * x + y * y);
      if (filled) {
        if (distance <= radius) {
          cells.push({ x: centerX + x, y: centerY + y });
        }
      } else {
        if (distance >= radius - 0.5 && distance <= radius + 0.5) {
          cells.push({ x: centerX + x, y: centerY + y });
        }
      }
    }
  }
  return cells;
}

export function generateLineCells(x1: number, y1: number, x2: number, y2: number): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let err = dx - dy;
  let x = x1;
  let y = y1;

  while (true) {
    cells.push({ x, y });
    if (x === x2 && y === y2) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return cells;
}

// =============================================================================
// TOOL EXECUTION
// =============================================================================

// Helper to find agent by flexible target
function resolveAgentTarget(
  target: { id?: string; near?: { x: number; y: number }; name?: string; all?: boolean } | undefined,
  agents: Array<{ id: string; x: number; y: number; spriteName?: string }>
): string[] {
  if (!target) return [];

  if (target.all) {
    return agents.map(a => a.id);
  }

  if (target.id) {
    const agent = agents.find(a => a.id === target.id);
    return agent ? [agent.id] : [];
  }

  if (target.name) {
    return agents.filter(a => a.spriteName === target.name).map(a => a.id);
  }

  if (target.near) {
    // Find closest agent to position
    let closest: { id: string; dist: number } | null = null;
    for (const agent of agents) {
      const dist = Math.sqrt(Math.pow(agent.x - target.near.x, 2) + Math.pow(agent.y - target.near.y, 2));
      if (!closest || dist < closest.dist) {
        closest = { id: agent.id, dist };
      }
    }
    return closest ? [closest.id] : [];
  }

  return [];
}

// Helper to filter entities by region or near
function filterByLocation<T extends { x: number; y: number }>(
  entities: T[],
  region?: { x: number; y: number; width: number; height: number },
  near?: { x: number; y: number; radius?: number }
): T[] {
  let result = entities;

  if (region) {
    result = result.filter(e =>
      e.x >= region.x && e.x < region.x + region.width &&
      e.y >= region.y && e.y < region.y + region.height
    );
  }

  if (near) {
    const radius = near.radius || 10;
    result = result.filter(e => {
      const dist = Math.sqrt(Math.pow(e.x - near.x, 2) + Math.pow(e.y - near.y, 2));
      return dist <= radius;
    });
  }

  return result;
}

export async function executeTool(
  toolName: string,
  args: Record<string, any>,
  ctx: ToolContext
): Promise<{ success: boolean; result?: any; error?: string }> {
  try {
    switch (toolName) {
      // ===================
      // SENSE
      // ===================
      case 'sense': {
        const { find, region, near, id } = args;

        switch (find) {
          case 'viewport':
            return { success: true, result: ctx.getViewport() };

          case 'cursor':
            return { success: true, result: ctx.getCursorPosition() };

          case 'selection':
            return { success: true, result: ctx.getSelection() };

          case 'agents': {
            let agents = ctx.getAgents();
            if (id) {
              agents = agents.filter(a => a.id === id);
            } else {
              agents = filterByLocation(agents, region, near);
            }
            return { success: true, result: agents };
          }

          case 'notes': {
            let notes = ctx.getNotes();
            if (id) {
              notes = notes.filter(n => n.id === id);
            } else {
              notes = filterByLocation(notes, region, near);
            }
            return { success: true, result: notes };
          }

          case 'chips': {
            let chips = ctx.getChips();
            if (id) {
              chips = chips.filter(c => c.id === id);
            } else {
              chips = filterByLocation(chips, region, near);
            }
            return { success: true, result: chips };
          }

          case 'text': {
            if (!region) {
              return { success: false, error: 'region required for text sensing' };
            }
            if (ctx.getTextAt) {
              const lines = ctx.getTextAt(region.x, region.y, region.width, region.height);
              return { success: true, result: lines };
            }
            return { success: false, error: 'getTextAt not implemented' };
          }

          case 'paint':
          case 'all': {
            if (ctx.getCanvasInfo) {
              const info = ctx.getCanvasInfo(region);
              if (find === 'all') {
                // Return everything
                return {
                  success: true,
                  result: {
                    canvas: info,
                    agents: filterByLocation(ctx.getAgents(), region, near),
                    notes: filterByLocation(ctx.getNotes(), region, near),
                    chips: filterByLocation(ctx.getChips(), region, near),
                    viewport: ctx.getViewport(),
                    cursor: ctx.getCursorPosition(),
                    selection: ctx.getSelection()
                  }
                };
              }
              return { success: true, result: info };
            }
            return { success: false, error: 'getCanvasInfo not implemented' };
          }

          default:
            return { success: false, error: `Unknown find type: ${find}` };
        }
      }

      // ===================
      // MAKE
      // ===================
      case 'make': {
        const results: string[] = [];

        // PAINT
        if (args.paint) {
          const { cells, rect, circle, line, erase } = args.paint;

          if (cells) {
            ctx.paintCells(cells);
            results.push(`Painted ${cells.length} cells`);
          }

          if (rect) {
            const { x, y, width, height, color, filled = true } = rect;
            const paintCells = generateRectCells(x, y, width, height, filled).map(c => ({ ...c, color }));
            ctx.paintCells(paintCells);
            results.push(`Painted ${filled ? 'filled' : 'outlined'} rectangle`);
          }

          if (circle) {
            const { x, y, radius, color, filled = true } = circle;
            const paintCells = generateCircleCells(x, y, radius, filled).map(c => ({ ...c, color }));
            ctx.paintCells(paintCells);
            results.push(`Painted ${filled ? 'filled' : 'outlined'} circle`);
          }

          if (line) {
            const { x1, y1, x2, y2, color } = line;
            const paintCells = generateLineCells(x1, y1, x2, y2).map(c => ({ ...c, color }));
            ctx.paintCells(paintCells);
            results.push(`Painted line from (${x1},${y1}) to (${x2},${y2})`);
          }

          if (erase) {
            const { x, y, width, height } = erase;
            const eraseCells = generateRectCells(x, y, width, height, true);
            ctx.eraseCells(eraseCells);
            results.push(`Erased region ${width}x${height}`);
          }
        }

        // NOTE
        if (args.note) {
          const { x, y, width, height, contentType = 'text', content, generateImage, imageData, scriptData, tableData } = args.note;
          ctx.createNote(x, y, width, height, contentType, content, imageData, generateImage, scriptData, tableData);
          if (generateImage) {
            results.push(`Created note with image generation request: "${generateImage}"`);
          } else {
            results.push(`Created ${contentType} note at (${x}, ${y})`);
          }
        }

        // TEXT
        if (args.text) {
          const { x, y, content } = args.text;
          ctx.writeText(x, y, content);
          results.push(`Wrote text at (${x}, ${y})`);
        }

        // CHIP
        if (args.chip) {
          const { x, y, text, color } = args.chip;
          ctx.createChip(x, y, text, color);
          results.push(`Created chip "${text}"`);
        }

        // AGENT
        if (args.agent) {
          const { target, create, move, action, mind, think } = args.agent;

          // Create new agent
          if (create) {
            const agentId = ctx.createAgent(create.x, create.y, create.spriteName);
            results.push(`Created agent ${agentId} at (${create.x}, ${create.y})`);
          }

          // Resolve target agents
          const agents = ctx.getAgents();
          const targetIds = resolveAgentTarget(target, agents);

          // Set mind (persona/goals) for agents
          if (mind && targetIds.length > 0 && ctx.setAgentMind) {
            for (const agentId of targetIds) {
              ctx.setAgentMind(agentId, mind.persona, mind.goals);
            }
            results.push(`Set mind for ${targetIds.length} agents`);
          }

          // Think - trigger AI reasoning cycle
          if (think && targetIds.length > 0 && ctx.agentThink) {
            for (const agentId of targetIds) {
              const thought = await ctx.agentThink(agentId);
              if (thought) {
                results.push(`Agent ${agentId} thinks: "${thought.thought?.slice(0, 100)}..."`);
                // Actions from thinking are queued by agentThink implementation
              }
            }
          }

          // Move
          if (move && targetIds.length > 0) {
            if (move.stop) {
              if (ctx.stopAgentsExpr) {
                ctx.stopAgentsExpr(targetIds);
                results.push(`Stopped ${targetIds.length} agents`);
              }
            } else if (move.to) {
              ctx.moveAgents(targetIds, move.to);
              results.push(`Moving ${targetIds.length} agents to (${move.to.x}, ${move.to.y})`);
            } else if (move.path && ctx.moveAgentsPath) {
              ctx.moveAgentsPath(targetIds, move.path);
              results.push(`Moving ${targetIds.length} agents along path`);
            } else if (move.expr && ctx.moveAgentsExpr) {
              ctx.moveAgentsExpr(targetIds, move.expr.x, move.expr.y, move.expr.vars, move.expr.duration);
              results.push(`Moving ${targetIds.length} agents with expression`);
            }
          }

          // Action
          if (action && targetIds.length > 0 && ctx.agentAction) {
            for (const agentId of targetIds) {
              ctx.agentAction(agentId, action.command, action.selection);
            }
            results.push(`${targetIds.length} agents executed: ${action.command}`);
          }
        }

        // DELETE
        if (args.delete) {
          const { type, id } = args.delete;
          if (ctx.deleteEntity) {
            ctx.deleteEntity(type, id);
            results.push(`Deleted ${type} ${id}`);
          } else {
            return { success: false, error: 'deleteEntity not implemented' };
          }
        }

        // COMMAND
        if (args.command) {
          ctx.runCommand(args.command);
          results.push(`Executed: ${args.command}`);
        }

        // RUN SCRIPT
        if (args.run_script && ctx.runScript) {
          const { noteId } = args.run_script;
          // Note: This is async but we return synchronously
          // The MCP bridge handles this via the run_script command type directly
          const scriptResult = await ctx.runScript(noteId);
          if (scriptResult.success) {
            results.push(`Script executed: ${scriptResult.output?.join(' | ') || 'no output'}`);
          } else {
            results.push(`Script error: ${scriptResult.error}`);
          }
        }

        // EDIT NOTE
        if (args.edit_note && ctx.editNote) {
          const { noteId, operation, text, position, range, cell } = args.edit_note;
          let edit: NoteEdit;

          switch (operation) {
            case 'append':
              if (!text) return { success: false, error: 'append requires text' };
              edit = { operation: 'append', text };
              break;
            case 'insert':
              if (!text || !position) return { success: false, error: 'insert requires text and position' };
              edit = { operation: 'insert', text, position };
              break;
            case 'delete':
              if (!range) return { success: false, error: 'delete requires range' };
              edit = { operation: 'delete', range };
              break;
            case 'replace':
              if (!text || !range) return { success: false, error: 'replace requires text and range' };
              edit = { operation: 'replace', text, range };
              break;
            case 'clear':
              edit = { operation: 'clear' };
              break;
            case 'cell':
              if (!cell) return { success: false, error: 'cell operation requires cell object' };
              edit = { operation: 'cell', cell };
              break;
            default:
              return { success: false, error: `Unknown edit operation: ${operation}` };
          }

          const editResult = ctx.editNote(noteId, edit);
          if (editResult.success) {
            results.push(`Edited note ${noteId}: ${operation}`);
          } else {
            results.push(`Edit failed: ${editResult.error}`);
          }
        }

        if (results.length === 0) {
          return { success: false, error: 'No valid make operation specified' };
        }

        return { success: true, result: results.join('; ') };
      }

      // ===================
      // EDIT_NOTE (standalone tool for direct calls)
      // ===================
      case 'edit_note': {
        if (!ctx.editNote) {
          return { success: false, error: 'editNote not implemented' };
        }

        const { noteId, operation, text, position, range, cell } = args;
        if (!noteId || !operation) {
          return { success: false, error: 'edit_note requires noteId and operation' };
        }

        let edit: NoteEdit;
        switch (operation) {
          case 'append':
            if (!text) return { success: false, error: 'append requires text' };
            edit = { operation: 'append', text };
            break;
          case 'insert':
            if (!text || !position) return { success: false, error: 'insert requires text and position' };
            edit = { operation: 'insert', text, position };
            break;
          case 'delete':
            if (!range) return { success: false, error: 'delete requires range' };
            edit = { operation: 'delete', range };
            break;
          case 'replace':
            if (!text || !range) return { success: false, error: 'replace requires text and range' };
            edit = { operation: 'replace', text, range };
            break;
          case 'clear':
            edit = { operation: 'clear' };
            break;
          case 'cell':
            if (!cell) return { success: false, error: 'cell operation requires cell object' };
            edit = { operation: 'cell', cell };
            break;
          default:
            return { success: false, error: `Unknown edit operation: ${operation}` };
        }

        const result = ctx.editNote(noteId, edit);
        return { success: result.success, result: result.success ? `Edited note ${noteId}` : undefined, error: result.error };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Export tools for external use
export { canvasTools as tools };
