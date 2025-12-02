#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WebSocket } from "ws";

// Connection to bridge server (which connects to Nara frontend)
let naraSocket: WebSocket | null = null;
const BRIDGE_WS_URL = process.env.BRIDGE_WS_URL || "ws://localhost:3002/mcp";

function connectToNara() {
  try {
    naraSocket = new WebSocket(BRIDGE_WS_URL);

    naraSocket.on("open", () => {
      console.error("[MCP] Connected to Nara");
    });

    naraSocket.on("close", () => {
      console.error("[MCP] Disconnected from Nara, reconnecting...");
      naraSocket = null;
      setTimeout(connectToNara, 3000);
    });

    naraSocket.on("error", (err) => {
      console.error("[MCP] WebSocket error:", err.message);
    });
  } catch (err) {
    console.error("[MCP] Failed to connect:", err);
    setTimeout(connectToNara, 3000);
  }
}

// Send command to Nara
function sendToNara(command: object): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!naraSocket || naraSocket.readyState !== WebSocket.OPEN) {
      reject(new Error("Not connected to Nara. Make sure Nara is running with MCP enabled."));
      return;
    }

    const id = Date.now().toString();
    const message = { id, ...command };

    const timeout = setTimeout(() => {
      reject(new Error("Timeout waiting for Nara response"));
    }, 10000);

    const handler = (data: Buffer) => {
      try {
        const response = JSON.parse(data.toString());
        if (response.id === id) {
          clearTimeout(timeout);
          naraSocket?.off("message", handler);
          resolve(response);
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    naraSocket.on("message", handler);
    naraSocket.send(JSON.stringify(message));
  });
}

// Create MCP server
const server = new Server(
  {
    name: "nara-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "paint_cells",
        description: "Paint multiple cells on the Nara canvas with specified colors. Use this to draw pixel art, shapes, or any visual elements.",
        inputSchema: {
          type: "object",
          properties: {
            cells: {
              type: "array",
              description: "Array of cells to paint",
              items: {
                type: "object",
                properties: {
                  x: { type: "number", description: "X coordinate" },
                  y: { type: "number", description: "Y coordinate" },
                  color: { type: "string", description: "Hex color (e.g., #ff0000)" },
                },
                required: ["x", "y", "color"],
              },
            },
          },
          required: ["cells"],
        },
      },
      {
        name: "paint_rect",
        description: "Paint a filled or outlined rectangle on the canvas",
        inputSchema: {
          type: "object",
          properties: {
            x: { type: "number", description: "Top-left X coordinate" },
            y: { type: "number", description: "Top-left Y coordinate" },
            width: { type: "number", description: "Width in cells" },
            height: { type: "number", description: "Height in cells" },
            color: { type: "string", description: "Hex color (e.g., #ff0000)" },
            filled: { type: "boolean", description: "If true, fill the rectangle. If false, only outline.", default: true },
          },
          required: ["x", "y", "width", "height", "color"],
        },
      },
      {
        name: "paint_circle",
        description: "Paint a filled or outlined circle on the canvas using pixel approximation",
        inputSchema: {
          type: "object",
          properties: {
            centerX: { type: "number", description: "Center X coordinate" },
            centerY: { type: "number", description: "Center Y coordinate" },
            radius: { type: "number", description: "Radius in cells" },
            color: { type: "string", description: "Hex color (e.g., #ff0000)" },
            filled: { type: "boolean", description: "If true, fill the circle. If false, only outline.", default: true },
          },
          required: ["centerX", "centerY", "radius", "color"],
        },
      },
      {
        name: "paint_line",
        description: "Paint a line between two points using Bresenham's algorithm",
        inputSchema: {
          type: "object",
          properties: {
            x1: { type: "number", description: "Start X coordinate" },
            y1: { type: "number", description: "Start Y coordinate" },
            x2: { type: "number", description: "End X coordinate" },
            y2: { type: "number", description: "End Y coordinate" },
            color: { type: "string", description: "Hex color (e.g., #ff0000)" },
          },
          required: ["x1", "y1", "x2", "y2", "color"],
        },
      },
      {
        name: "erase_cells",
        description: "Erase paint from specific cells",
        inputSchema: {
          type: "object",
          properties: {
            cells: {
              type: "array",
              description: "Array of cells to erase",
              items: {
                type: "object",
                properties: {
                  x: { type: "number", description: "X coordinate" },
                  y: { type: "number", description: "Y coordinate" },
                },
                required: ["x", "y"],
              },
            },
          },
          required: ["cells"],
        },
      },
      {
        name: "erase_region",
        description: "Erase all paint in a rectangular region",
        inputSchema: {
          type: "object",
          properties: {
            x: { type: "number", description: "Top-left X coordinate" },
            y: { type: "number", description: "Top-left Y coordinate" },
            width: { type: "number", description: "Width in cells" },
            height: { type: "number", description: "Height in cells" },
          },
          required: ["x", "y", "width", "height"],
        },
      },
      {
        name: "get_cursor_position",
        description: "Get the current cursor position on the canvas",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_canvas_info",
        description: "Get information about the canvas state including painted regions",
        inputSchema: {
          type: "object",
          properties: {
            region: {
              type: "object",
              description: "Optional region to query. If not provided, returns general canvas info.",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
                width: { type: "number" },
                height: { type: "number" },
              },
            },
          },
        },
      },
      {
        name: "get_agents",
        description: "Get all agents on the canvas with their positions, names, and sprite info",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "move_agents",
        description: "Move one or more agents to a destination with smooth walking animation",
        inputSchema: {
          type: "object",
          properties: {
            agentIds: {
              type: "array",
              description: "Array of agent IDs to move (e.g., ['agent_abc123'])",
              items: { type: "string" },
            },
            destination: {
              type: "object",
              description: "Target position to move agents to",
              properties: {
                x: { type: "number", description: "Target X coordinate" },
                y: { type: "number", description: "Target Y coordinate" },
              },
              required: ["x", "y"],
            },
          },
          required: ["agentIds", "destination"],
        },
      },
      {
        name: "move_agents_path",
        description: "Move one or more agents along a custom path (array of points). Use this for custom movement patterns like sine waves, circles, spirals, etc.",
        inputSchema: {
          type: "object",
          properties: {
            agentIds: {
              type: "array",
              description: "Array of agent IDs to move (e.g., ['agent_abc123'])",
              items: { type: "string" },
            },
            path: {
              type: "array",
              description: "Array of points defining the path to follow",
              items: {
                type: "object",
                properties: {
                  x: { type: "number", description: "X coordinate" },
                  y: { type: "number", description: "Y coordinate" },
                },
                required: ["x", "y"],
              },
            },
          },
          required: ["agentIds", "path"],
        },
      },
      {
        name: "move_agents_expr",
        description: "Move agents using mathematical expressions evaluated each frame. Expressions can use variables: x, y (current position), t (time in seconds), vx, vy (velocity), startX, startY (initial position), avgX, avgY (average position of all agents). Math functions: sin, cos, tan, sqrt, abs, pow, min, max, etc. Example: xExpr='startX + t * 5', yExpr='startY + sin(t * 2) * 10' for a sine wave.",
        inputSchema: {
          type: "object",
          properties: {
            agentIds: {
              type: "array",
              description: "Array of agent IDs to move",
              items: { type: "string" },
            },
            xExpr: {
              type: "string",
              description: "Math expression for x position (e.g., 'startX + t * 5')",
            },
            yExpr: {
              type: "string",
              description: "Math expression for y position (e.g., 'startY + sin(t * 2) * 10')",
            },
            vars: {
              type: "object",
              description: "Optional custom variables to use in expressions (e.g., {speed: 5, amplitude: 10})",
              additionalProperties: { type: "number" },
            },
            duration: {
              type: "number",
              description: "Optional duration in seconds. Movement stops after this time.",
            },
          },
          required: ["agentIds", "xExpr", "yExpr"],
        },
      },
      {
        name: "stop_agents_expr",
        description: "Stop expression-based movement for specified agents",
        inputSchema: {
          type: "object",
          properties: {
            agentIds: {
              type: "array",
              description: "Array of agent IDs to stop",
              items: { type: "string" },
            },
          },
          required: ["agentIds"],
        },
      },
      {
        name: "set_cursor_position",
        description: "Move the cursor to a specific position on the canvas",
        inputSchema: {
          type: "object",
          properties: {
            x: { type: "number", description: "X coordinate" },
            y: { type: "number", description: "Y coordinate" },
          },
          required: ["x", "y"],
        },
      },
      {
        name: "create_agent",
        description: "Create a new agent at a specified position on the canvas",
        inputSchema: {
          type: "object",
          properties: {
            x: { type: "number", description: "X coordinate to spawn the agent" },
            y: { type: "number", description: "Y coordinate to spawn the agent" },
            spriteName: { type: "string", description: "Optional sprite name for the agent (default: 'default')" },
          },
          required: ["x", "y"],
        },
      },
      // Viewport tools
      {
        name: "get_viewport",
        description: "Get current viewport information including offset, zoom level, and visible bounds",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "set_viewport",
        description: "Set the viewport offset and optionally zoom level to pan/zoom the canvas view",
        inputSchema: {
          type: "object",
          properties: {
            x: { type: "number", description: "X offset for viewport" },
            y: { type: "number", description: "Y offset for viewport" },
            zoomLevel: { type: "number", description: "Optional zoom level (default: current)" },
          },
          required: ["x", "y"],
        },
      },
      // Selection tools
      {
        name: "get_selection",
        description: "Get the current selection rectangle (start and end coordinates)",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "set_selection",
        description: "Set the selection rectangle to a specific region",
        inputSchema: {
          type: "object",
          properties: {
            startX: { type: "number", description: "Start X coordinate" },
            startY: { type: "number", description: "Start Y coordinate" },
            endX: { type: "number", description: "End X coordinate" },
            endY: { type: "number", description: "End Y coordinate" },
          },
          required: ["startX", "startY", "endX", "endY"],
        },
      },
      {
        name: "clear_selection",
        description: "Clear the current selection",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      // Notes and Chips
      {
        name: "get_notes",
        description: "Get all notes on the canvas with their positions, dimensions, and content preview",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_chips",
        description: "Get all chips (small labels) on the canvas with their positions, text, and color",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      // Text tools
      {
        name: "get_text_at",
        description: "Get text content within a specified rectangular region",
        inputSchema: {
          type: "object",
          properties: {
            x: { type: "number", description: "Top-left X coordinate" },
            y: { type: "number", description: "Top-left Y coordinate" },
            width: { type: "number", description: "Width in cells" },
            height: { type: "number", description: "Height in cells" },
          },
          required: ["x", "y", "width", "height"],
        },
      },
      {
        name: "write_text",
        description: "Write text at a specific position on the canvas",
        inputSchema: {
          type: "object",
          properties: {
            x: { type: "number", description: "X coordinate to start writing" },
            y: { type: "number", description: "Y coordinate to start writing" },
            text: { type: "string", description: "Text content to write" },
          },
          required: ["x", "y", "text"],
        },
      },
      // Command execution
      {
        name: "run_command",
        description: "Execute a Nara command string (e.g., '/color red', '/brush 3', '/agent create')",
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string", description: "Command string to execute (starting with /)" },
          },
          required: ["command"],
        },
      },
      // Agent-based command execution
      {
        name: "agent_command",
        description: "Execute a command at a specific agent's position. The cursor is temporarily moved to the agent's location, the command is executed, then the cursor is restored. This allows agents to perform actions like creating notes, chips, or paint at their location.",
        inputSchema: {
          type: "object",
          properties: {
            agentId: { type: "string", description: "The ID of the agent (e.g., 'agent_1234567890_xyz')" },
            command: { type: "string", description: "Command string to execute (e.g., '/chip Hello', '/note', '/paint')" },
            restoreCursor: { type: "boolean", description: "If true, restore cursor to original position after command. Default: true", default: true },
          },
          required: ["agentId", "command"],
        },
      },
      // Agent action with optional selection (atomic operation)
      {
        name: "agent_action",
        description: "Execute a command at an agent's position with optional selection. This is an atomic operation that: 1) saves cursor/selection state, 2) moves cursor to agent, 3) optionally creates a selection relative to the agent, 4) executes the command, 5) clears selection, 6) restores original state. Use this for selection-based commands like /note, /paint that need a region.",
        inputSchema: {
          type: "object",
          properties: {
            agentId: { type: "string", description: "The ID of the agent" },
            command: { type: "string", description: "Command string to execute (e.g., '/note', '/paint')" },
            selection: {
              type: "object",
              description: "Optional selection region relative to agent position. If provided, creates a selection from (agentX, agentY) to (agentX + width, agentY + height)",
              properties: {
                width: { type: "number", description: "Width of selection in cells" },
                height: { type: "number", description: "Height of selection in cells" },
              },
              required: ["width", "height"],
            },
          },
          required: ["agentId", "command"],
        },
      },
      // Sequence tool for executing multiple operations in order
      {
        name: "sequence",
        description: "Execute multiple operations in sequence with proper timing. Each operation completes before the next begins. Supports all MCP operations. Use this for coordinated multi-step actions like: move agent, set selection, create note. Optional delay between operations (default: 50ms).",
        inputSchema: {
          type: "object",
          properties: {
            operations: {
              type: "array",
              description: "Array of operations to execute in order. Each operation has a 'type' matching MCP tool names and the relevant parameters.",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", description: "Operation type (e.g., 'set_selection', 'run_command', 'move_agents', 'set_viewport')" },
                },
                required: ["type"],
                additionalProperties: true,
              },
            },
            delayMs: {
              type: "number",
              description: "Delay in milliseconds between operations (default: 50)",
              default: 50,
            },
          },
          required: ["operations"],
        },
      },
      // Direct note creation
      {
        name: "create_note",
        description: "Create a note directly at a specified position with given dimensions. This bypasses the need to set selection and run /note command separately.",
        inputSchema: {
          type: "object",
          properties: {
            x: { type: "number", description: "X coordinate (top-left)" },
            y: { type: "number", description: "Y coordinate (top-left)" },
            width: { type: "number", description: "Width in cells" },
            height: { type: "number", description: "Height in cells" },
            content: { type: "string", description: "Optional initial content for the note" },
          },
          required: ["x", "y", "width", "height"],
        },
      },
      // Direct chip creation
      {
        name: "create_chip",
        description: "Create a chip (small label) directly at a specified position.",
        inputSchema: {
          type: "object",
          properties: {
            x: { type: "number", description: "X coordinate" },
            y: { type: "number", description: "Y coordinate" },
            text: { type: "string", description: "Text content for the chip" },
            color: { type: "string", description: "Optional hex color for the chip" },
          },
          required: ["x", "y", "text"],
        },
      },
    ],
  };
});

// Helper: Generate circle cells
function generateCircleCells(centerX: number, centerY: number, radius: number, filled: boolean): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];

  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      const distance = Math.sqrt(x * x + y * y);
      if (filled) {
        if (distance <= radius) {
          cells.push({ x: centerX + x, y: centerY + y });
        }
      } else {
        // Outline only
        if (distance >= radius - 0.5 && distance <= radius + 0.5) {
          cells.push({ x: centerX + x, y: centerY + y });
        }
      }
    }
  }

  return cells;
}

// Helper: Generate line cells (Bresenham's algorithm)
function generateLineCells(x1: number, y1: number, x2: number, y2: number): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];

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
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }

  return cells;
}

// Helper: Generate rectangle cells
function generateRectCells(x: number, y: number, width: number, height: number, filled: boolean): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];

  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      if (filled || dx === 0 || dx === width - 1 || dy === 0 || dy === height - 1) {
        cells.push({ x: x + dx, y: y + dy });
      }
    }
  }

  return cells;
}

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "paint_cells": {
        const { cells } = args as { cells: { x: number; y: number; color: string }[] };
        const response = await sendToNara({ type: "paint_cells", cells });
        return {
          content: [{ type: "text", text: `Painted ${cells.length} cells` }],
        };
      }

      case "paint_rect": {
        const { x, y, width, height, color, filled = true } = args as any;
        const cells = generateRectCells(x, y, width, height, filled).map(c => ({ ...c, color }));
        const response = await sendToNara({ type: "paint_cells", cells });
        return {
          content: [{ type: "text", text: `Painted ${filled ? 'filled' : 'outlined'} rectangle (${width}x${height}) at (${x},${y})` }],
        };
      }

      case "paint_circle": {
        const { centerX, centerY, radius, color, filled = true } = args as any;
        const cells = generateCircleCells(centerX, centerY, radius, filled).map(c => ({ ...c, color }));
        const response = await sendToNara({ type: "paint_cells", cells });
        return {
          content: [{ type: "text", text: `Painted ${filled ? 'filled' : 'outlined'} circle (radius ${radius}) at (${centerX},${centerY})` }],
        };
      }

      case "paint_line": {
        const { x1, y1, x2, y2, color } = args as any;
        const cells = generateLineCells(x1, y1, x2, y2).map(c => ({ ...c, color }));
        const response = await sendToNara({ type: "paint_cells", cells });
        return {
          content: [{ type: "text", text: `Painted line from (${x1},${y1}) to (${x2},${y2})` }],
        };
      }

      case "erase_cells": {
        const { cells } = args as { cells: { x: number; y: number }[] };
        const response = await sendToNara({ type: "erase_cells", cells });
        return {
          content: [{ type: "text", text: `Erased ${cells.length} cells` }],
        };
      }

      case "erase_region": {
        const { x, y, width, height } = args as any;
        const cells = generateRectCells(x, y, width, height, true);
        const response = await sendToNara({ type: "erase_cells", cells });
        return {
          content: [{ type: "text", text: `Erased region (${width}x${height}) at (${x},${y})` }],
        };
      }

      case "get_cursor_position": {
        const response = await sendToNara({ type: "get_cursor_position" });
        return {
          content: [{ type: "text", text: JSON.stringify(response.position || { x: 0, y: 0 }) }],
        };
      }

      case "get_canvas_info": {
        const { region } = args as any;
        const response = await sendToNara({ type: "get_canvas_info", region });
        return {
          content: [{ type: "text", text: JSON.stringify(response.info || {}) }],
        };
      }

      case "get_agents": {
        const response = await sendToNara({ type: "get_agents" });
        return {
          content: [{ type: "text", text: JSON.stringify(response.agents || []) }],
        };
      }

      case "move_agents": {
        const { agentIds, destination } = args as { agentIds: string[]; destination: { x: number; y: number } };
        const response = await sendToNara({ type: "move_agents", agentIds, destination });
        const result = {
          moved: response.moved || [],
          errors: response.errors || [],
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      }

      case "move_agents_path": {
        const { agentIds, path } = args as { agentIds: string[]; path: { x: number; y: number }[] };
        const response = await sendToNara({ type: "move_agents_path", agentIds, path });
        const result = {
          moved: response.moved || [],
          errors: response.errors || [],
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      }

      case "move_agents_expr": {
        const { agentIds, xExpr, yExpr, vars, duration } = args as { agentIds: string[]; xExpr: string; yExpr: string; vars?: Record<string, number>; duration?: number };
        const response = await sendToNara({ type: "move_agents_expr", agentIds, xExpr, yExpr, vars, duration });
        const result = {
          moved: response.moved || [],
          errors: response.errors || [],
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      }

      case "stop_agents_expr": {
        const { agentIds } = args as { agentIds: string[] };
        const response = await sendToNara({ type: "stop_agents_expr", agentIds });
        const result = {
          stopped: response.stopped || [],
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      }

      case "set_cursor_position": {
        const { x, y } = args as { x: number; y: number };
        const response = await sendToNara({ type: "set_cursor_position", position: { x, y } });
        return {
          content: [{ type: "text", text: `Cursor moved to (${x}, ${y})` }],
        };
      }

      case "create_agent": {
        const { x, y, spriteName } = args as { x: number; y: number; spriteName?: string };
        const response = await sendToNara({ type: "create_agent", position: { x, y }, spriteName });
        if (response.error) {
          return {
            content: [{ type: "text", text: `Error: ${response.error}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ agentId: response.agentId, position: { x, y } }) }],
        };
      }

      // Viewport tools
      case "get_viewport": {
        const response = await sendToNara({ type: "get_viewport" });
        return {
          content: [{ type: "text", text: JSON.stringify(response.viewport || { offset: { x: 0, y: 0 }, zoomLevel: 1, visibleBounds: {} }) }],
        };
      }

      case "set_viewport": {
        const { x, y, zoomLevel } = args as { x: number; y: number; zoomLevel?: number };
        const response = await sendToNara({ type: "set_viewport", offset: { x, y }, zoomLevel });
        return {
          content: [{ type: "text", text: `Viewport set to offset (${x}, ${y})${zoomLevel !== undefined ? ` zoom ${zoomLevel}` : ''}` }],
        };
      }

      // Selection tools
      case "get_selection": {
        const response = await sendToNara({ type: "get_selection" });
        return {
          content: [{ type: "text", text: JSON.stringify(response.selection || { start: null, end: null }) }],
        };
      }

      case "set_selection": {
        const { startX, startY, endX, endY } = args as { startX: number; startY: number; endX: number; endY: number };
        const response = await sendToNara({ type: "set_selection", start: { x: startX, y: startY }, end: { x: endX, y: endY } });
        return {
          content: [{ type: "text", text: `Selection set from (${startX}, ${startY}) to (${endX}, ${endY})` }],
        };
      }

      case "clear_selection": {
        const response = await sendToNara({ type: "clear_selection" });
        return {
          content: [{ type: "text", text: "Selection cleared" }],
        };
      }

      // Notes and Chips
      case "get_notes": {
        const response = await sendToNara({ type: "get_notes" });
        return {
          content: [{ type: "text", text: JSON.stringify(response.notes || []) }],
        };
      }

      case "get_chips": {
        const response = await sendToNara({ type: "get_chips" });
        return {
          content: [{ type: "text", text: JSON.stringify(response.chips || []) }],
        };
      }

      // Text tools
      case "get_text_at": {
        const { x, y, width, height } = args as { x: number; y: number; width: number; height: number };
        const response = await sendToNara({ type: "get_text_at", region: { x, y, width, height } });
        return {
          content: [{ type: "text", text: JSON.stringify(response.lines || []) }],
        };
      }

      case "write_text": {
        const { x, y, text } = args as { x: number; y: number; text: string };
        const response = await sendToNara({ type: "write_text", position: { x, y }, text });
        return {
          content: [{ type: "text", text: `Wrote "${text}" at (${x}, ${y})` }],
        };
      }

      // Command execution
      case "run_command": {
        const { command } = args as { command: string };
        const response = await sendToNara({ type: "run_command", command });
        return {
          content: [{ type: "text", text: `Executed command: ${command}` }],
        };
      }

      // Agent-based command execution
      case "agent_command": {
        const { agentId, command, restoreCursor = true } = args as { agentId: string; command: string; restoreCursor?: boolean };
        const response = await sendToNara({ type: "agent_command", agentId, command, restoreCursor });
        if (!response.success) {
          return {
            content: [{ type: "text", text: `Error: ${response.error}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: `Agent ${agentId} executed: ${command} at (${response.agentPos?.x}, ${response.agentPos?.y})` }],
        };
      }

      // Agent action with optional selection (atomic operation)
      case "agent_action": {
        const { agentId, command, selection } = args as {
          agentId: string;
          command: string;
          selection?: { width: number; height: number };
        };
        const response = await sendToNara({ type: "agent_action", agentId, command, selection });
        if (!response.success) {
          return {
            content: [{ type: "text", text: `Error: ${response.error}` }],
            isError: true,
          };
        }
        const selectionInfo = selection ? ` with selection ${selection.width}x${selection.height}` : '';
        return {
          content: [{ type: "text", text: `Agent ${agentId} executed: ${command}${selectionInfo} at (${response.agentPos?.x}, ${response.agentPos?.y})` }],
        };
      }

      // Sequence tool - executes multiple operations in order
      case "sequence": {
        const { operations, delayMs = 50 } = args as {
          operations: Array<{ type: string; [key: string]: any }>;
          delayMs?: number;
        };

        const results: Array<{ type: string; success: boolean; result?: any; error?: string }> = [];

        for (const op of operations) {
          const { type, ...params } = op;

          try {
            // Small delay between operations for React state to settle
            if (results.length > 0 && delayMs > 0) {
              await new Promise(resolve => setTimeout(resolve, delayMs));
            }

            let response: any;

            // Route to appropriate handler based on operation type
            switch (type) {
              case "set_selection": {
                const { startX, startY, endX, endY } = params;
                response = await sendToNara({ type: "set_selection", start: { x: startX, y: startY }, end: { x: endX, y: endY } });
                break;
              }
              case "clear_selection": {
                response = await sendToNara({ type: "clear_selection" });
                break;
              }
              case "run_command": {
                response = await sendToNara({ type: "run_command", command: params.command });
                break;
              }
              case "set_viewport": {
                response = await sendToNara({ type: "set_viewport", offset: { x: params.x, y: params.y }, zoomLevel: params.zoomLevel });
                break;
              }
              case "set_cursor_position": {
                response = await sendToNara({ type: "set_cursor_position", position: { x: params.x, y: params.y } });
                break;
              }
              case "move_agents": {
                response = await sendToNara({ type: "move_agents", agentIds: params.agentIds, destination: params.destination });
                break;
              }
              case "paint_cells": {
                response = await sendToNara({ type: "paint_cells", cells: params.cells });
                break;
              }
              case "erase_cells": {
                response = await sendToNara({ type: "erase_cells", cells: params.cells });
                break;
              }
              case "write_text": {
                response = await sendToNara({ type: "write_text", position: { x: params.x, y: params.y }, text: params.text });
                break;
              }
              case "create_note": {
                response = await sendToNara({ type: "create_note", x: params.x, y: params.y, width: params.width, height: params.height, content: params.content });
                break;
              }
              case "create_chip": {
                response = await sendToNara({ type: "create_chip", x: params.x, y: params.y, text: params.text, color: params.color });
                break;
              }
              default:
                // Generic passthrough for other operations
                response = await sendToNara({ type, ...params });
            }

            results.push({ type, success: response.success !== false, result: response });
          } catch (error: any) {
            results.push({ type, success: false, error: error.message });
          }
        }

        const successCount = results.filter(r => r.success).length;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              completed: successCount,
              total: operations.length,
              results
            }, null, 2)
          }],
        };
      }

      // Direct note creation
      case "create_note": {
        const { x, y, width, height, content } = args as { x: number; y: number; width: number; height: number; content?: string };
        const response = await sendToNara({ type: "create_note", x, y, width, height, content });
        if (!response.success) {
          return {
            content: [{ type: "text", text: `Error: ${response.error || 'Failed to create note'}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: `Created note at (${x}, ${y}) with size ${width}x${height}` }],
        };
      }

      // Direct chip creation
      case "create_chip": {
        const { x, y, text, color } = args as { x: number; y: number; text: string; color?: string };
        const response = await sendToNara({ type: "create_chip", x, y, text, color });
        if (!response.success) {
          return {
            content: [{ type: "text", text: `Error: ${response.error || 'Failed to create chip'}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: `Created chip "${text}" at (${x}, ${y})` }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  // Connect to Nara
  connectToNara();

  // Start MCP server over stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[MCP] Nara MCP server running");
}

main().catch(console.error);
