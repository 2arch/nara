// Generic tool definitions for Nara canvas
// No external dependencies - can be used by both Gemini AI and MCP server

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

// All canvas tools - single source of truth
export const canvasTools: ToolDefinition[] = [
  {
    name: 'paint_cells',
    description: 'Paint multiple cells on the canvas with specified colors. Use this to draw pixel art, shapes, or any visual elements.',
    parameters: {
      type: 'object',
      properties: {
        cells: {
          type: 'array',
          description: 'Array of cells to paint',
          items: {
            type: 'object',
            properties: {
              x: { type: 'number', description: 'X coordinate' },
              y: { type: 'number', description: 'Y coordinate' },
              color: { type: 'string', description: 'Hex color (e.g., #ff0000)' },
            },
            required: ['x', 'y', 'color'],
          },
        },
      },
      required: ['cells'],
    },
  },
  {
    name: 'paint_rect',
    description: 'Paint a filled or outlined rectangle on the canvas',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Top-left X coordinate' },
        y: { type: 'number', description: 'Top-left Y coordinate' },
        width: { type: 'number', description: 'Width in cells' },
        height: { type: 'number', description: 'Height in cells' },
        color: { type: 'string', description: 'Hex color (e.g., #ff0000)' },
        filled: { type: 'boolean', description: 'If true, fill the rectangle. If false, only outline.', default: true },
      },
      required: ['x', 'y', 'width', 'height', 'color'],
    },
  },
  {
    name: 'paint_circle',
    description: 'Paint a filled or outlined circle on the canvas',
    parameters: {
      type: 'object',
      properties: {
        centerX: { type: 'number', description: 'Center X coordinate' },
        centerY: { type: 'number', description: 'Center Y coordinate' },
        radius: { type: 'number', description: 'Radius in cells' },
        color: { type: 'string', description: 'Hex color (e.g., #ff0000)' },
        filled: { type: 'boolean', description: 'If true, fill the circle. If false, only outline.', default: true },
      },
      required: ['centerX', 'centerY', 'radius', 'color'],
    },
  },
  {
    name: 'paint_line',
    description: 'Paint a line between two points using Bresenham\'s algorithm',
    parameters: {
      type: 'object',
      properties: {
        x1: { type: 'number', description: 'Start X coordinate' },
        y1: { type: 'number', description: 'Start Y coordinate' },
        x2: { type: 'number', description: 'End X coordinate' },
        y2: { type: 'number', description: 'End Y coordinate' },
        color: { type: 'string', description: 'Hex color (e.g., #ff0000)' },
      },
      required: ['x1', 'y1', 'x2', 'y2', 'color'],
    },
  },
  {
    name: 'erase_cells',
    description: 'Erase paint from specific cells',
    parameters: {
      type: 'object',
      properties: {
        cells: {
          type: 'array',
          description: 'Array of cells to erase',
          items: {
            type: 'object',
            properties: {
              x: { type: 'number', description: 'X coordinate' },
              y: { type: 'number', description: 'Y coordinate' },
            },
            required: ['x', 'y'],
          },
        },
      },
      required: ['cells'],
    },
  },
  {
    name: 'erase_region',
    description: 'Erase all paint in a rectangular region',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Top-left X coordinate' },
        y: { type: 'number', description: 'Top-left Y coordinate' },
        width: { type: 'number', description: 'Width in cells' },
        height: { type: 'number', description: 'Height in cells' },
      },
      required: ['x', 'y', 'width', 'height'],
    },
  },
  {
    name: 'get_cursor_position',
    description: 'Get the current cursor position on the canvas',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'set_cursor_position',
    description: 'Move the cursor to a specific position on the canvas',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'get_canvas_info',
    description: 'Get information about the canvas state including painted regions',
    parameters: {
      type: 'object',
      properties: {
        region: {
          type: 'object',
          description: 'Optional region to query. If not provided, returns general canvas info.',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
        },
      },
    },
  },
  {
    name: 'get_viewport',
    description: 'Get current viewport information including offset, zoom level, and visible bounds',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'set_viewport',
    description: 'Set the viewport offset and optionally zoom level to pan/zoom the canvas view',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X offset for viewport' },
        y: { type: 'number', description: 'Y offset for viewport' },
        zoomLevel: { type: 'number', description: 'Optional zoom level' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'get_selection',
    description: 'Get the current selection rectangle (start and end coordinates)',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'set_selection',
    description: 'Set the selection rectangle to a specific region',
    parameters: {
      type: 'object',
      properties: {
        startX: { type: 'number', description: 'Start X coordinate' },
        startY: { type: 'number', description: 'Start Y coordinate' },
        endX: { type: 'number', description: 'End X coordinate' },
        endY: { type: 'number', description: 'End Y coordinate' },
      },
      required: ['startX', 'startY', 'endX', 'endY'],
    },
  },
  {
    name: 'clear_selection',
    description: 'Clear the current selection',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_agents',
    description: 'Get all agents on the canvas with their positions, names, and sprite info',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'create_agent',
    description: 'Create a new agent at a specified position on the canvas',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate to spawn the agent' },
        y: { type: 'number', description: 'Y coordinate to spawn the agent' },
        spriteName: { type: 'string', description: 'Optional sprite name for the agent' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'move_agents',
    description: 'Move one or more agents to a destination with smooth walking animation',
    parameters: {
      type: 'object',
      properties: {
        agentIds: {
          type: 'array',
          description: 'Array of agent IDs to move',
          items: { type: 'string' },
        },
        destination: {
          type: 'object',
          description: 'Target position to move agents to',
          properties: {
            x: { type: 'number', description: 'Target X coordinate' },
            y: { type: 'number', description: 'Target Y coordinate' },
          },
          required: ['x', 'y'],
        },
      },
      required: ['agentIds', 'destination'],
    },
  },
  {
    name: 'move_agents_path',
    description: 'Move one or more agents along a custom path (array of points). Use this for custom movement patterns like sine waves, circles, spirals, etc.',
    parameters: {
      type: 'object',
      properties: {
        agentIds: {
          type: 'array',
          description: 'Array of agent IDs to move',
          items: { type: 'string' },
        },
        path: {
          type: 'array',
          description: 'Array of points defining the path to follow',
          items: {
            type: 'object',
            properties: {
              x: { type: 'number', description: 'X coordinate' },
              y: { type: 'number', description: 'Y coordinate' },
            },
            required: ['x', 'y'],
          },
        },
      },
      required: ['agentIds', 'path'],
    },
  },
  {
    name: 'move_agents_expr',
    description: 'Move agents using mathematical expressions evaluated each frame. Expressions can use variables: x, y (current position), t (time in seconds), vx, vy (velocity), startX, startY (initial position), avgX, avgY (average position of all agents). Math functions: sin, cos, tan, sqrt, abs, pow, min, max, etc.',
    parameters: {
      type: 'object',
      properties: {
        agentIds: {
          type: 'array',
          description: 'Array of agent IDs to move',
          items: { type: 'string' },
        },
        xExpr: { type: 'string', description: 'Math expression for x position (e.g., "startX + t * 5")' },
        yExpr: { type: 'string', description: 'Math expression for y position (e.g., "startY + sin(t * 2) * 10")' },
        vars: {
          type: 'object',
          description: 'Optional custom variables to use in expressions (e.g., {speed: 5, amplitude: 10})',
          additionalProperties: { type: 'number' },
        },
        duration: { type: 'number', description: 'Optional duration in seconds. Movement stops after this time.' },
      },
      required: ['agentIds', 'xExpr', 'yExpr'],
    },
  },
  {
    name: 'stop_agents_expr',
    description: 'Stop expression-based movement for specified agents',
    parameters: {
      type: 'object',
      properties: {
        agentIds: {
          type: 'array',
          description: 'Array of agent IDs to stop',
          items: { type: 'string' },
        },
      },
      required: ['agentIds'],
    },
  },
  {
    name: 'get_notes',
    description: 'Get all notes on the canvas with their positions, dimensions, and content preview',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'create_note',
    description: 'Create a note directly at a specified position with given dimensions',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate (top-left)' },
        y: { type: 'number', description: 'Y coordinate (top-left)' },
        width: { type: 'number', description: 'Width in cells' },
        height: { type: 'number', description: 'Height in cells' },
        content: { type: 'string', description: 'Optional initial content for the note' },
      },
      required: ['x', 'y', 'width', 'height'],
    },
  },
  {
    name: 'get_chips',
    description: 'Get all chips (small labels) on the canvas with their positions, text, and color',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'create_chip',
    description: 'Create a chip (small label) directly at a specified position',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
        text: { type: 'string', description: 'Text content for the chip' },
        color: { type: 'string', description: 'Optional hex color for the chip' },
      },
      required: ['x', 'y', 'text'],
    },
  },
  {
    name: 'get_text_at',
    description: 'Get text content within a specified rectangular region',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Top-left X coordinate' },
        y: { type: 'number', description: 'Top-left Y coordinate' },
        width: { type: 'number', description: 'Width in cells' },
        height: { type: 'number', description: 'Height in cells' },
      },
      required: ['x', 'y', 'width', 'height'],
    },
  },
  {
    name: 'write_text',
    description: 'Write text at a specific position on the canvas',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate to start writing' },
        y: { type: 'number', description: 'Y coordinate to start writing' },
        text: { type: 'string', description: 'Text content to write' },
      },
      required: ['x', 'y', 'text'],
    },
  },
  {
    name: 'run_command',
    description: 'Execute a Nara command string (e.g., "/color red", "/brush 3", "/agent create")',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command string to execute (starting with /)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'agent_command',
    description: 'Execute a command at a specific agent\'s position. The cursor is temporarily moved to the agent\'s location, the command is executed, then the cursor is restored.',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The ID of the agent' },
        command: { type: 'string', description: 'Command string to execute (e.g., "/chip Hello", "/note", "/paint")' },
        restoreCursor: { type: 'boolean', description: 'If true, restore cursor to original position after command. Default: true', default: true },
      },
      required: ['agentId', 'command'],
    },
  },
  {
    name: 'agent_action',
    description: 'Execute a command at an agent\'s position with optional selection. Atomic operation: saves state, moves cursor to agent, optionally creates selection, executes command, restores state.',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The ID of the agent' },
        command: { type: 'string', description: 'Command string to execute (e.g., "/note", "/paint")' },
        selection: {
          type: 'object',
          description: 'Optional selection region relative to agent position',
          properties: {
            width: { type: 'number', description: 'Width of selection in cells' },
            height: { type: 'number', description: 'Height of selection in cells' },
          },
          required: ['width', 'height'],
        },
      },
      required: ['agentId', 'command'],
    },
  },
  {
    name: 'sequence',
    description: 'Execute multiple operations in sequence with proper timing. Each operation completes before the next begins.',
    parameters: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          description: 'Array of operations to execute in order. Each has a "type" matching tool names and relevant parameters.',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'Operation type (e.g., "set_selection", "run_command", "move_agents")' },
            },
            required: ['type'],
            additionalProperties: true,
          },
        },
        delayMs: { type: 'number', description: 'Delay in milliseconds between operations (default: 50)', default: 50 },
      },
      required: ['operations'],
    },
  },
];

// Type for tool execution context - passed from the canvas component
export interface ToolContext {
  // Paint operations
  paintCells: (cells: Array<{ x: number; y: number; color: string }>) => void;
  eraseCells: (cells: Array<{ x: number; y: number }>) => void;

  // Cursor/viewport
  getCursorPosition: () => { x: number; y: number };
  setCursorPosition: (x: number, y: number) => void;
  getViewport: () => { offset: { x: number; y: number }; zoomLevel: number };
  setViewport: (x: number, y: number, zoomLevel?: number) => void;

  // Canvas info
  getCanvasInfo?: (region?: { x: number; y: number; width: number; height: number }) => any;

  // Selection
  getSelection: () => { start: { x: number; y: number } | null; end: { x: number; y: number } | null };
  setSelection: (startX: number, startY: number, endX: number, endY: number) => void;
  clearSelection: () => void;

  // Agents
  getAgents: () => Array<{ id: string; x: number; y: number; spriteName?: string }>;
  createAgent: (x: number, y: number, spriteName?: string) => string | null;
  moveAgents: (agentIds: string[], destination: { x: number; y: number }) => void;
  moveAgentsPath?: (agentIds: string[], path: Array<{ x: number; y: number }>) => void;
  moveAgentsExpr?: (agentIds: string[], xExpr: string, yExpr: string, vars?: Record<string, number>, duration?: number) => void;
  stopAgentsExpr?: (agentIds: string[]) => void;

  // Notes and chips
  getNotes: () => Array<{ id: string; x: number; y: number; width: number; height: number; content: string }>;
  createNote: (x: number, y: number, width: number, height: number, content?: string) => void;
  getChips: () => Array<{ id: string; x: number; y: number; text: string; color?: string }>;
  createChip: (x: number, y: number, text: string, color?: string) => void;

  // Text
  getTextAt?: (x: number, y: number, width: number, height: number) => string[];
  writeText: (x: number, y: number, text: string) => void;

  // Commands
  runCommand: (command: string) => void;
  agentCommand?: (agentId: string, command: string, restoreCursor?: boolean) => void;
  agentAction?: (agentId: string, command: string, selection?: { width: number; height: number }) => void;

  // Sequence
  executeSequence?: (operations: Array<{ type: string; [key: string]: any }>, delayMs?: number) => Promise<any>;
}

// Helper functions for generating shapes
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

// Execute a tool call with the given context
export function executeTool(
  toolName: string,
  args: Record<string, any>,
  ctx: ToolContext
): { success: boolean; result?: any; error?: string } {
  try {
    switch (toolName) {
      case 'paint_cells': {
        ctx.paintCells(args.cells);
        return { success: true, result: `Painted ${args.cells.length} cells` };
      }

      case 'paint_rect': {
        const { x, y, width, height, color, filled = true } = args;
        const cells = generateRectCells(x, y, width, height, filled).map(c => ({ ...c, color }));
        ctx.paintCells(cells);
        return { success: true, result: `Painted ${filled ? 'filled' : 'outlined'} rectangle` };
      }

      case 'paint_circle': {
        const { centerX, centerY, radius, color, filled = true } = args;
        const cells = generateCircleCells(centerX, centerY, radius, filled).map(c => ({ ...c, color }));
        ctx.paintCells(cells);
        return { success: true, result: `Painted ${filled ? 'filled' : 'outlined'} circle` };
      }

      case 'paint_line': {
        const { x1, y1, x2, y2, color } = args;
        const cells = generateLineCells(x1, y1, x2, y2).map(c => ({ ...c, color }));
        ctx.paintCells(cells);
        return { success: true, result: `Painted line from (${x1},${y1}) to (${x2},${y2})` };
      }

      case 'erase_cells': {
        ctx.eraseCells(args.cells);
        return { success: true, result: `Erased ${args.cells.length} cells` };
      }

      case 'erase_region': {
        const { x, y, width, height } = args;
        const cells = generateRectCells(x, y, width, height, true);
        ctx.eraseCells(cells);
        return { success: true, result: `Erased region ${width}x${height}` };
      }

      case 'get_cursor_position': {
        const pos = ctx.getCursorPosition();
        return { success: true, result: pos };
      }

      case 'set_cursor_position': {
        ctx.setCursorPosition(args.x, args.y);
        return { success: true, result: `Cursor moved to (${args.x}, ${args.y})` };
      }

      case 'get_canvas_info': {
        if (ctx.getCanvasInfo) {
          const info = ctx.getCanvasInfo(args.region);
          return { success: true, result: info };
        }
        return { success: false, error: 'getCanvasInfo not implemented' };
      }

      case 'get_viewport': {
        const viewport = ctx.getViewport();
        return { success: true, result: viewport };
      }

      case 'set_viewport': {
        ctx.setViewport(args.x, args.y, args.zoomLevel);
        return { success: true, result: `Viewport set to (${args.x}, ${args.y})` };
      }

      case 'get_selection': {
        const selection = ctx.getSelection();
        return { success: true, result: selection };
      }

      case 'set_selection': {
        ctx.setSelection(args.startX, args.startY, args.endX, args.endY);
        return { success: true, result: 'Selection set' };
      }

      case 'clear_selection': {
        ctx.clearSelection();
        return { success: true, result: 'Selection cleared' };
      }

      case 'get_agents': {
        const agents = ctx.getAgents();
        return { success: true, result: agents };
      }

      case 'create_agent': {
        const agentId = ctx.createAgent(args.x, args.y, args.spriteName);
        return { success: true, result: { agentId, position: { x: args.x, y: args.y } } };
      }

      case 'move_agents': {
        ctx.moveAgents(args.agentIds, args.destination);
        return { success: true, result: `Moving ${args.agentIds.length} agents` };
      }

      case 'move_agents_path': {
        if (ctx.moveAgentsPath) {
          ctx.moveAgentsPath(args.agentIds, args.path);
          return { success: true, result: `Moving ${args.agentIds.length} agents along path` };
        }
        return { success: false, error: 'moveAgentsPath not implemented' };
      }

      case 'move_agents_expr': {
        if (ctx.moveAgentsExpr) {
          ctx.moveAgentsExpr(args.agentIds, args.xExpr, args.yExpr, args.vars, args.duration);
          return { success: true, result: `Moving ${args.agentIds.length} agents with expressions` };
        }
        return { success: false, error: 'moveAgentsExpr not implemented' };
      }

      case 'stop_agents_expr': {
        if (ctx.stopAgentsExpr) {
          ctx.stopAgentsExpr(args.agentIds);
          return { success: true, result: `Stopped ${args.agentIds.length} agents` };
        }
        return { success: false, error: 'stopAgentsExpr not implemented' };
      }

      case 'get_notes': {
        const notes = ctx.getNotes();
        return { success: true, result: notes };
      }

      case 'create_note': {
        ctx.createNote(args.x, args.y, args.width, args.height, args.content);
        return { success: true, result: `Created note at (${args.x}, ${args.y})` };
      }

      case 'get_chips': {
        const chips = ctx.getChips();
        return { success: true, result: chips };
      }

      case 'create_chip': {
        ctx.createChip(args.x, args.y, args.text, args.color);
        return { success: true, result: `Created chip "${args.text}"` };
      }

      case 'get_text_at': {
        if (ctx.getTextAt) {
          const lines = ctx.getTextAt(args.x, args.y, args.width, args.height);
          return { success: true, result: lines };
        }
        return { success: false, error: 'getTextAt not implemented' };
      }

      case 'write_text': {
        ctx.writeText(args.x, args.y, args.text);
        return { success: true, result: `Wrote text at (${args.x}, ${args.y})` };
      }

      case 'run_command': {
        ctx.runCommand(args.command);
        return { success: true, result: `Executed: ${args.command}` };
      }

      case 'agent_command': {
        if (ctx.agentCommand) {
          ctx.agentCommand(args.agentId, args.command, args.restoreCursor);
          return { success: true, result: `Agent executed: ${args.command}` };
        }
        return { success: false, error: 'agentCommand not implemented' };
      }

      case 'agent_action': {
        if (ctx.agentAction) {
          ctx.agentAction(args.agentId, args.command, args.selection);
          return { success: true, result: `Agent action: ${args.command}` };
        }
        return { success: false, error: 'agentAction not implemented' };
      }

      case 'sequence': {
        if (ctx.executeSequence) {
          // Note: This is async but executeTool is sync - caller handles this
          ctx.executeSequence(args.operations, args.delayMs);
          return { success: true, result: `Executing ${args.operations.length} operations` };
        }
        return { success: false, error: 'executeSequence not implemented' };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Convert to Gemini FunctionDeclaration format
export function toGeminiFunctionDeclarations() {
  return canvasTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.parameters,
  }));
}

// Convert to MCP tool format
export function toMCPTools() {
  return canvasTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
  }));
}
