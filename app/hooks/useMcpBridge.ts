import { useEffect, useRef } from 'react';

interface McpCommand {
  id: string;
  type: string;
  [key: string]: any;
}

interface AgentInfo {
  id: string;
  x: number;
  y: number;
  name?: string;
  spriteUrl?: string;
  visualX?: number;
  visualY?: number;
}

interface McpBridgeOptions {
  enabled: boolean;
  mcpPaintCells: (cells: Array<{ x: number; y: number; color: string }>) => void;
  mcpEraseCells: (cells: Array<{ x: number; y: number }>) => void;
  getCursorPosition: () => { x: number; y: number };
  setCursorPosition: (pos: { x: number; y: number }) => void;
  getCanvasInfo: (region?: { x: number; y: number; width: number; height: number }) => any;
  getAgents: () => AgentInfo[];
  moveAgents: (agentIds: string[], destination: { x: number; y: number }) => { moved: string[]; errors: string[] };
  createAgent: (pos: { x: number; y: number }, spriteName?: string) => { agentId: string } | { error: string };
}

export function useMcpBridge(options: McpBridgeOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const optionsRef = useRef(options);

  // Keep options ref updated without triggering reconnects
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    if (!options.enabled) return;

    // Connect to bridge server (use NEXT_PUBLIC_MCP_BRIDGE_URL for Tailscale)
    // e.g., NEXT_PUBLIC_MCP_BRIDGE_URL=ws://100.x.x.x:3002
    const bridgeHost = process.env.NEXT_PUBLIC_MCP_BRIDGE_URL || 'ws://localhost:3002';
    const wsUrl = `${bridgeHost}/nara`;

    const handleCommand = (command: McpCommand) => {
      const { mcpPaintCells, mcpEraseCells, getCursorPosition, setCursorPosition, getCanvasInfo, getAgents, moveAgents, createAgent } = optionsRef.current;

      const respond = (data: any) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ id: command.id, ...data }));
        }
      };

      try {
        switch (command.type) {
          case 'paint_cells': {
            const { cells } = command as { cells: { x: number; y: number; color: string }[] } & McpCommand;
            mcpPaintCells(cells);
            respond({ success: true, painted: cells.length });
            break;
          }

          case 'erase_cells': {
            const { cells } = command as { cells: { x: number; y: number }[] } & McpCommand;
            mcpEraseCells(cells);
            respond({ success: true, erased: cells.length });
            break;
          }

          case 'get_cursor_position': {
            const position = getCursorPosition();
            respond({ success: true, position });
            break;
          }

          case 'get_canvas_info': {
            const { region } = command;
            const info = getCanvasInfo(region);
            respond({ success: true, info });
            break;
          }

          case 'get_agents': {
            const agents = getAgents();
            respond({ success: true, agents });
            break;
          }

          case 'move_agents': {
            const { agentIds, destination } = command as { agentIds: string[]; destination: { x: number; y: number } } & McpCommand;
            const result = moveAgents(agentIds, destination);
            respond({ success: true, ...result });
            break;
          }

          case 'set_cursor_position': {
            const { position } = command as { position: { x: number; y: number } } & McpCommand;
            setCursorPosition(position);
            respond({ success: true, position });
            break;
          }

          case 'create_agent': {
            const { position, spriteName } = command as { position: { x: number; y: number }; spriteName?: string } & McpCommand;
            const result = createAgent(position, spriteName);
            respond({ success: true, ...result });
            break;
          }

          default:
            respond({ success: false, error: `Unknown command: ${command.type}` });
        }
      } catch (error: any) {
        respond({ success: false, error: error.message });
      }
    };

    const connect = () => {
      // Don't reconnect if we already have a connection
      if (wsRef.current?.readyState === WebSocket.OPEN ||
          wsRef.current?.readyState === WebSocket.CONNECTING) {
        return;
      }

      try {
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log('[MCP Bridge] Connected');
        };

        ws.onmessage = (event) => {
          try {
            const command = JSON.parse(event.data) as McpCommand;
            handleCommand(command);
          } catch (e) {
            console.error('[MCP Bridge] Failed to parse command:', e);
          }
        };

        ws.onclose = () => {
          console.log('[MCP Bridge] Disconnected, reconnecting in 3s...');
          wsRef.current = null;
          setTimeout(connect, 3000);
        };

        ws.onerror = (error) => {
          console.error('[MCP Bridge] Error:', error);
        };

        wsRef.current = ws;
      } catch (e) {
        console.error('[MCP Bridge] Failed to connect:', e);
        setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [options.enabled]); // Only reconnect when enabled changes

  return {
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
  };
}
