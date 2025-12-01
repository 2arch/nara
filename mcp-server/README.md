# Nara MCP Server

MCP (Model Context Protocol) server that enables Claude Code to interact with the Nara canvas.

## Architecture

```
Claude Code <--stdio--> MCP Server <--WebSocket--> Bridge Server <--WebSocket--> Nara Frontend
```

- **MCP Server** (`index.ts`): Defines tools and handles Claude Code requests
- **Bridge Server** (`bridge.ts`): WebSocket relay between MCP and Nara frontend
- **Frontend Hook** (`useMcpBridge.ts`): React hook that executes commands in the canvas

## Setup

1. **Install dependencies:**
   ```bash
   cd mcp-server
   npm install
   ```

2. **Start the bridge server:**
   ```bash
   npm run bridge
   ```

3. **Configure for Tailscale** (optional, in `.env.local`):
   ```bash
   NEXT_PUBLIC_MCP_BRIDGE_URL=ws://100.x.x.x:3002
   ```

4. **Add to `.mcp.json`** in your project root:
   ```json
   {
     "mcpServers": {
       "nara": {
         "command": "npx",
         "args": ["tsx", "/path/to/nara/mcp-server/index.ts"]
       }
     }
   }
   ```

5. **Restart Claude Code** to load the MCP tools

## Available Tools

### Paint Tools

| Tool | Description |
|------|-------------|
| `paint_cells` | Paint multiple cells with specified colors |
| `paint_rect` | Paint a filled or outlined rectangle |
| `paint_circle` | Paint a filled or outlined circle |
| `paint_line` | Paint a line between two points (Bresenham's algorithm) |
| `erase_cells` | Erase paint from specific cells |
| `erase_region` | Erase all paint in a rectangular region |

### Cursor

| Tool | Description |
|------|-------------|
| `get_cursor_position` | Get current cursor coordinates |
| `set_cursor_position` | Move cursor to a specific position |

### Canvas Info

| Tool | Description |
|------|-------------|
| `get_canvas_info` | Get canvas state including painted cells in a region |

### Viewport

| Tool | Description |
|------|-------------|
| `get_viewport` | Get viewport offset, zoom level, and visible bounds |
| `set_viewport` | Pan/zoom the canvas view |

### Selection

| Tool | Description |
|------|-------------|
| `get_selection` | Get current selection rectangle |
| `set_selection` | Set selection to a specific region |
| `clear_selection` | Clear the current selection |

### Agents

| Tool | Description |
|------|-------------|
| `get_agents` | List all agents with positions and sprite info |
| `move_agents` | Move agents to destination (with smooth animation) |
| `create_agent` | Spawn a new agent at a position |

### Content

| Tool | Description |
|------|-------------|
| `get_notes` | Get all notes with positions and content preview |
| `get_chips` | Get all chips (labels) with positions and text |
| `get_text_at` | Read text content in a rectangular region |
| `write_text` | Write text at a specific position |

### Commands

| Tool | Description |
|------|-------------|
| `run_command` | Execute any Nara command (e.g., `/color red`, `/note create`) |

## Examples

### Paint a rectangle
```json
{
  "x": 10, "y": 10,
  "width": 5, "height": 5,
  "color": "#ff0000",
  "filled": true
}
```

### Move agents
```json
{
  "agentIds": ["agent_abc123"],
  "destination": {"x": 50, "y": 30}
}
```

### Run a command
```json
{
  "command": "/color blue"
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BRIDGE_WS_URL` | MCP server → Bridge connection | `ws://localhost:3002/mcp` |
| `NEXT_PUBLIC_MCP_BRIDGE_URL` | Frontend → Bridge connection | `ws://localhost:3002` |

## Development

```bash
npm install
npm run bridge  # Start bridge server on port 3002
```

The MCP server itself is started automatically by Claude Code via the `.mcp.json` config.
