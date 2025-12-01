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
          content: [{ type: "text", text: JSON.stringify(response.position) }],
        };
      }

      case "get_canvas_info": {
        const { region } = args as any;
        const response = await sendToNara({ type: "get_canvas_info", region });
        return {
          content: [{ type: "text", text: JSON.stringify(response.info) }],
        };
      }

      case "get_agents": {
        const response = await sendToNara({ type: "get_agents" });
        return {
          content: [{ type: "text", text: JSON.stringify(response.agents) }],
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
