#!/usr/bin/env node
/**
 * WebSocket Bridge Server
 *
 * Sits between:
 * - MCP Server (connects as client)
 * - Nara Frontend (connects as client)
 *
 * Routes messages between them.
 */

import { WebSocketServer, WebSocket } from 'ws';

const PORT = parseInt(process.env.MCP_BRIDGE_PORT || '3002');

// Bind to all interfaces (0.0.0.0) so it's accessible via Tailscale
const wss = new WebSocketServer({ host: '0.0.0.0', port: PORT });

let mcpClient: WebSocket | null = null;
let naraClient: WebSocket | null = null;

console.log(`[Bridge] WebSocket bridge server running on ws://localhost:${PORT}`);

wss.on('connection', (ws, req) => {
  const path = req.url || '/';

  console.log(`[Bridge] New connection: ${path}`);

  if (path === '/mcp') {
    // MCP server connecting
    mcpClient = ws;
    console.log('[Bridge] MCP server connected');

    ws.on('message', (data) => {
      // Forward to Nara
      console.log('[Bridge] MCP -> Nara:', data.toString());
      if (naraClient?.readyState === WebSocket.OPEN) {
        naraClient.send(data.toString());
      } else {
        // Send error back to MCP
        try {
          const msg = JSON.parse(data.toString());
          ws.send(JSON.stringify({
            id: msg.id,
            success: false,
            error: 'Nara not connected'
          }));
        } catch (e) {
          // Ignore
        }
      }
    });

    ws.on('close', () => {
      console.log('[Bridge] MCP server disconnected');
      mcpClient = null;
    });

  } else if (path === '/nara') {
    // Nara frontend connecting
    naraClient = ws;
    console.log('[Bridge] Nara frontend connected');

    ws.on('message', (data) => {
      // Forward to MCP
      console.log('[Bridge] Nara -> MCP:', data.toString());
      if (mcpClient?.readyState === WebSocket.OPEN) {
        mcpClient.send(data.toString());
      }
    });

    ws.on('close', () => {
      console.log('[Bridge] Nara frontend disconnected');
      naraClient = null;
    });

  } else {
    console.log(`[Bridge] Unknown path: ${path}, closing`);
    ws.close();
  }

  ws.on('error', (err) => {
    console.error('[Bridge] WebSocket error:', err.message);
  });
});

console.log('[Bridge] Waiting for connections...');
console.log('[Bridge] - MCP server should connect to: ws://localhost:' + PORT + '/mcp');
console.log('[Bridge] - Nara frontend should connect to: ws://localhost:' + PORT + '/nara');
