# Nara MCP Server

MCP (Model Context Protocol) server that allows AI assistants like Claude to paint on the Nara canvas.

## Architecture

```
Claude (MCP Client)
    ↓ stdio
MCP Server (index.ts)
    ↓ WebSocket
Bridge Server (bridge.ts)
    ↓ WebSocket
Nara Frontend (useMcpBridge hook)
    ↓
Canvas Engine
```

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

3. **Configure Nara for Tailscale** (in `.env.local`):
   ```bash
   # Your Tailscale IP
   NEXT_PUBLIC_MCP_BRIDGE_URL=ws://100.x.x.x:3002
   ```

4. **Enable MCP in Nara frontend:**

   In your page component, add `mcpEnabled={true}` to BitCanvas:
   ```tsx
   <BitCanvas
     engine={engine}
     mcpEnabled={true}
     // ... other props
   />
   ```

5. **Configure Claude Code** to use this MCP server:

   In `~/.claude/claude_desktop_config.json` or Claude Code settings:
   ```json
   {
     "mcpServers": {
       "nara": {
         "command": "npx",
         "args": ["tsx", "/home/ubuntu/nara/mcp-server/index.ts"],
         "env": {
           "BRIDGE_WS_URL": "ws://100.x.x.x:3002/mcp"
         }
       }
     }
   }
   ```

## Available Tools

### `paint_cells`
Paint multiple cells with specified colors.
```json
{
  "cells": [
    {"x": 10, "y": 10, "color": "#ff0000"},
    {"x": 11, "y": 10, "color": "#ff0000"}
  ]
}
```

### `paint_rect`
Paint a filled or outlined rectangle.
```json
{
  "x": 10, "y": 10,
  "width": 5, "height": 5,
  "color": "#00ff00",
  "filled": true
}
```

### `paint_circle`
Paint a filled or outlined circle.
```json
{
  "centerX": 15, "centerY": 15,
  "radius": 5,
  "color": "#0000ff",
  "filled": true
}
```

### `paint_line`
Paint a line between two points.
```json
{
  "x1": 0, "y1": 0,
  "x2": 10, "y2": 10,
  "color": "#ffff00"
}
```

### `erase_cells`
Erase paint from specific cells.
```json
{
  "cells": [
    {"x": 10, "y": 10},
    {"x": 11, "y": 10}
  ]
}
```

### `erase_region`
Erase all paint in a rectangular region.
```json
{
  "x": 10, "y": 10,
  "width": 5, "height": 5
}
```

### `get_cursor_position`
Get current cursor position on canvas.

### `get_canvas_info`
Get information about canvas state.

## Example: Paint a Flower

Ask Claude: "Paint a red flower at position 20,20"

Claude will generate something like:
```
paint_circle(centerX=20, centerY=18, radius=3, color="#ff0000")  // petals
paint_circle(centerX=20, centerY=18, radius=1, color="#ffff00")  // center
paint_line(x1=20, y1=21, x2=20, y2=28, color="#00aa00")          // stem
paint_cells([{x:18, y:25, color:"#00aa00"}, {x:22, y:26, color:"#00aa00"}])  // leaves
```
