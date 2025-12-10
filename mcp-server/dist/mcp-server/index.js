#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { WebSocket } from "ws";
// Import from shared tools
import { tools, generateRectCells, generateCircleCells, generateLineCells, } from "../app/bitworld/ai.tools.js";
// Connection to bridge server (which connects to Nara frontend)
let naraSocket = null;
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
    }
    catch (err) {
        console.error("[MCP] Failed to connect:", err);
        setTimeout(connectToNara, 3000);
    }
}
// Send command to Nara
function sendToNara(command) {
    return new Promise((resolve, reject) => {
        if (!naraSocket || naraSocket.readyState !== WebSocket.OPEN) {
            reject(new Error("Not connected to Nara. Make sure Nara is running with MCP enabled."));
            return;
        }
        const id = Date.now().toString();
        const message = Object.assign({ id }, command);
        const timeout = setTimeout(() => {
            reject(new Error("Timeout waiting for Nara response"));
        }, 10000);
        const handler = (data) => {
            try {
                const response = JSON.parse(data.toString());
                if (response.id === id) {
                    clearTimeout(timeout);
                    naraSocket === null || naraSocket === void 0 ? void 0 : naraSocket.off("message", handler);
                    resolve(response);
                }
            }
            catch (e) {
                // Ignore parse errors
            }
        };
        naraSocket.on("message", handler);
        naraSocket.send(JSON.stringify(message));
    });
}
// Create MCP server
const server = new Server({
    name: "nara-mcp-server",
    version: "0.2.0",
}, {
    capabilities: {
        tools: {},
    },
});
// List available tools - using shared definitions (sense + make)
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: tools.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.parameters,
        })),
    };
});
// Handle tool calls - consolidated sense/make pattern
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        if (name === "sense") {
            // sense() - query the canvas
            const { find, region, near, id } = args;
            const response = await sendToNara({ type: "sense", find, region, near, id });
            return {
                content: [{ type: "text", text: JSON.stringify(response.result || response, null, 2) }],
            };
        }
        if (name === "make") {
            // make() - create or modify things
            console.error("[MCP DEBUG] args:", JSON.stringify(args, null, 2));
            const { paint, note, text, chip, agent, delete: deleteOp, command } = args;
            console.error("[MCP DEBUG] note:", JSON.stringify(note, null, 2));
            const results = [];
            // Handle paint operations
            if (paint) {
                let cells = [];
                if (paint.cells) {
                    cells = paint.cells;
                }
                else if (paint.rect) {
                    const { x, y, width, height, color, filled = true } = paint.rect;
                    cells = generateRectCells(x, y, width, height, filled).map(c => (Object.assign(Object.assign({}, c), { color })));
                }
                else if (paint.circle) {
                    const { x, y, radius, color, filled = true } = paint.circle;
                    cells = generateCircleCells(x, y, radius, filled).map(c => (Object.assign(Object.assign({}, c), { color })));
                }
                else if (paint.line) {
                    const { x1, y1, x2, y2, color } = paint.line;
                    cells = generateLineCells(x1, y1, x2, y2).map(c => (Object.assign(Object.assign({}, c), { color })));
                }
                if (cells.length > 0) {
                    await sendToNara({ type: "paint_cells", cells });
                    results.push(`Painted ${cells.length} cells`);
                }
                if (paint.erase) {
                    const { x, y, width, height } = paint.erase;
                    const eraseCells = generateRectCells(x, y, width, height, true);
                    await sendToNara({ type: "erase_cells", cells: eraseCells });
                    results.push(`Erased region ${width}x${height} at (${x},${y})`);
                }
            }
            // Handle note creation
            if (note) {
                const { x, y, width, height, contentType, content, imageData, generateImage, scriptData, tableData } = note;
                await sendToNara({
                    type: "create_note",
                    x, y, width, height,
                    contentType: contentType || 'text',
                    content,
                    imageData,
                    generateImage,
                    scriptData,
                    tableData
                });
                results.push(`Created ${contentType || 'text'} note at (${x},${y})`);
            }
            // Handle text writing
            if (text) {
                const { x, y, content } = text;
                await sendToNara({ type: "write_text", position: { x, y }, text: content });
                results.push(`Wrote text at (${x},${y})`);
            }
            // Handle chip creation
            if (chip) {
                const { x, y, text: chipText, color } = chip;
                await sendToNara({ type: "create_chip", x, y, text: chipText, color });
                results.push(`Created chip "${chipText}" at (${x},${y})`);
            }
            // Handle agent operations
            if (agent) {
                const { target, create, move, action } = agent;
                // Create new agent
                if (create) {
                    const response = await sendToNara({
                        type: "create_agent",
                        position: { x: create.x, y: create.y },
                        spriteName: create.spriteName
                    });
                    results.push(`Created agent${create.spriteName ? ` "${create.spriteName}"` : ''} at (${create.x},${create.y})`);
                }
                // Operations on existing agents (need target)
                if (target && (move || action)) {
                    // Resolve target to agent IDs
                    let agentIds = [];
                    if (target.id) {
                        agentIds = [target.id];
                    }
                    else if (target.all) {
                        const agentsResponse = await sendToNara({ type: "sense", find: "agents" });
                        agentIds = (agentsResponse.result || []).map((a) => a.id);
                    }
                    else if (target.near) {
                        const agentsResponse = await sendToNara({
                            type: "sense",
                            find: "agents",
                            near: target.near
                        });
                        agentIds = (agentsResponse.result || []).map((a) => a.id);
                    }
                    else if (target.name) {
                        const agentsResponse = await sendToNara({ type: "sense", find: "agents" });
                        agentIds = (agentsResponse.result || [])
                            .filter((a) => a.spriteName === target.name)
                            .map((a) => a.id);
                    }
                    if (agentIds.length === 0) {
                        results.push("No agents matched target");
                    }
                    else {
                        // Handle movement
                        if (move) {
                            if (move.stop) {
                                await sendToNara({ type: "stop_agents_expr", agentIds });
                                results.push(`Stopped ${agentIds.length} agent(s)`);
                            }
                            else if (move.to) {
                                await sendToNara({ type: "move_agents", agentIds, destination: move.to });
                                results.push(`Moved ${agentIds.length} agent(s) to (${move.to.x},${move.to.y})`);
                            }
                            else if (move.path) {
                                await sendToNara({ type: "move_agents_path", agentIds, path: move.path });
                                results.push(`Set path for ${agentIds.length} agent(s)`);
                            }
                            else if (move.expr) {
                                await sendToNara({
                                    type: "move_agents_expr",
                                    agentIds,
                                    xExpr: move.expr.x,
                                    yExpr: move.expr.y,
                                    vars: move.expr.vars,
                                    duration: move.expr.duration
                                });
                                results.push(`Set expression movement for ${agentIds.length} agent(s)`);
                            }
                        }
                        // Handle action
                        if (action) {
                            for (const agentId of agentIds) {
                                await sendToNara({
                                    type: "agent_action",
                                    agentId,
                                    command: action.command,
                                    selection: action.selection
                                });
                            }
                            results.push(`Executed "${action.command}" on ${agentIds.length} agent(s)`);
                        }
                    }
                }
            }
            // Handle deletion
            if (deleteOp) {
                await sendToNara({ type: "delete_entity", entityType: deleteOp.type, id: deleteOp.id });
                results.push(`Deleted ${deleteOp.type} ${deleteOp.id}`);
            }
            // Handle command
            if (command) {
                await sendToNara({ type: "run_command", command });
                results.push(`Executed: ${command}`);
            }
            // Handle edit_note (CRDT-style operations)
            const edit_note = args.edit_note;
            if (edit_note) {
                const { noteId, operation, text: editText, position, range, cell } = edit_note;
                const edit = { operation };
                if (editText !== undefined)
                    edit.text = editText;
                if (position !== undefined)
                    edit.position = position;
                if (range !== undefined)
                    edit.range = range;
                if (cell !== undefined)
                    edit.cell = cell;
                const response = await sendToNara({ type: "edit_note", noteId, edit });
                if (response.success) {
                    results.push(`Edited note ${noteId}: ${operation}`);
                }
                else {
                    results.push(`Edit failed: ${response.error}`);
                }
            }
            return {
                content: [{ type: "text", text: results.join("\n") || "No operations performed" }],
            };
        }
        throw new Error(`Unknown tool: ${name}`);
    }
    catch (error) {
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
    console.error("[MCP] Nara MCP server running (v0.2.0 - sense/make)");
}
main().catch(console.error);
