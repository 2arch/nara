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

interface NoteInfo {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  contentPreview?: string;
  contentType?: string;
}

interface ChipInfo {
  id: string;
  x: number;
  y: number;
  text: string;
  color?: string;
}

interface ViewportInfo {
  offset: { x: number; y: number };
  zoomLevel: number;
  visibleBounds: { minX: number; minY: number; maxX: number; maxY: number };
}

interface McpBridgeOptions {
  enabled: boolean;
  // Paint tools
  mcpPaintCells: (cells: Array<{ x: number; y: number; color: string }>) => void;
  mcpEraseCells: (cells: Array<{ x: number; y: number }>) => void;
  // Cursor
  getCursorPosition: () => { x: number; y: number };
  setCursorPosition: (pos: { x: number; y: number }) => void;
  // Canvas info
  getCanvasInfo: (region?: { x: number; y: number; width: number; height: number }) => any;
  getViewport: () => ViewportInfo;
  setViewport: (offset: { x: number; y: number }, zoomLevel?: number) => void;
  // Selection
  getSelection: () => { start: { x: number; y: number } | null; end: { x: number; y: number } | null };
  setSelection: (start: { x: number; y: number }, end: { x: number; y: number }) => void;
  clearSelection: () => void;
  // Agents
  getAgents: () => AgentInfo[];
  moveAgents: (agentIds: string[], destination: { x: number; y: number }) => { moved: string[]; errors: string[] };
  moveAgentsPath: (agentIds: string[], path: { x: number; y: number }[]) => { moved: string[]; errors: string[] };
  moveAgentsExpr: (agentIds: string[], xExpr: string, yExpr: string, vars?: Record<string, number>, duration?: number) => { moved: string[]; errors: string[] };
  stopAgentsExpr: (agentIds: string[]) => { stopped: string[] };
  createAgent: (pos: { x: number; y: number }, spriteName?: string) => { agentId: string } | { error: string };
  // Notes & Chips
  getNotes: () => NoteInfo[];
  getChips: () => ChipInfo[];
  createNote: (x: number, y: number, width: number, height: number, contentType?: string, content?: string, imageData?: { src: string; originalWidth: number; originalHeight: number }, generateImage?: string) => { success: boolean; noteId?: string; error?: string };
  createChip: (x: number, y: number, text: string, color?: string) => { success: boolean; chipId?: string; error?: string };
  deleteEntity: (type: 'note' | 'agent' | 'chip', id: string) => { success: boolean; error?: string };
  // Text
  getTextAt: (region: { x: number; y: number; width: number; height: number }) => string[];
  writeText: (pos: { x: number; y: number }, text: string) => void;
  // Commands
  runCommand: (command: string) => void;
  agentCommand: (agentId: string, command: string, restoreCursor?: boolean) => { success: boolean; agentPos?: { x: number; y: number }; error?: string };
  agentAction: (agentId: string, command: string, selection?: { width: number; height: number }) => { success: boolean; agentPos?: { x: number; y: number }; error?: string };
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
      const {
        mcpPaintCells, mcpEraseCells,
        getCursorPosition, setCursorPosition,
        getCanvasInfo, getViewport, setViewport,
        getSelection, setSelection, clearSelection,
        getAgents, moveAgents, moveAgentsPath, moveAgentsExpr, stopAgentsExpr, createAgent,
        getNotes, getChips, createNote, createChip, deleteEntity,
        getTextAt, writeText,
        runCommand, agentCommand, agentAction
      } = optionsRef.current;

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

          case 'move_agents_path': {
            const { agentIds, path } = command as { agentIds: string[]; path: { x: number; y: number }[] } & McpCommand;
            const result = moveAgentsPath(agentIds, path);
            respond({ success: true, ...result });
            break;
          }

          case 'move_agents_expr': {
            const { agentIds, xExpr, yExpr, vars, duration } = command as { agentIds: string[]; xExpr: string; yExpr: string; vars?: Record<string, number>; duration?: number } & McpCommand;
            const result = moveAgentsExpr(agentIds, xExpr, yExpr, vars, duration);
            respond({ success: true, ...result });
            break;
          }

          case 'stop_agents_expr': {
            const { agentIds } = command as { agentIds: string[] } & McpCommand;
            const result = stopAgentsExpr(agentIds);
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

          case 'get_viewport': {
            const viewport = getViewport();
            respond({ success: true, viewport });
            break;
          }

          case 'set_viewport': {
            const { offset, zoomLevel } = command as { offset: { x: number; y: number }; zoomLevel?: number } & McpCommand;
            setViewport(offset, zoomLevel);
            respond({ success: true, offset, zoomLevel });
            break;
          }

          case 'get_selection': {
            const selection = getSelection();
            respond({ success: true, selection });
            break;
          }

          case 'set_selection': {
            const { start, end } = command as { start: { x: number; y: number }; end: { x: number; y: number } } & McpCommand;
            setSelection(start, end);
            respond({ success: true, start, end });
            break;
          }

          case 'clear_selection': {
            clearSelection();
            respond({ success: true });
            break;
          }

          case 'get_notes': {
            const notes = getNotes();
            respond({ success: true, notes });
            break;
          }

          case 'get_chips': {
            const chips = getChips();
            respond({ success: true, chips });
            break;
          }

          case 'create_note': {
            const { x, y, width, height, contentType, content, imageData, generateImage } = command as {
              x: number; y: number; width: number; height: number;
              contentType?: string; content?: string;
              imageData?: { src: string; originalWidth: number; originalHeight: number };
              generateImage?: string;
            } & McpCommand;
            const result = createNote(x, y, width, height, contentType, content, imageData, generateImage);
            respond(result);
            break;
          }

          case 'create_chip': {
            const { x, y, text, color } = command as { x: number; y: number; text: string; color?: string } & McpCommand;
            const result = createChip(x, y, text, color);
            respond(result);
            break;
          }

          case 'delete_entity': {
            const { entityType, id } = command as { entityType: 'note' | 'agent' | 'chip'; id: string } & McpCommand;
            const result = deleteEntity(entityType, id);
            respond(result);
            break;
          }

          case 'get_text_at': {
            const { region } = command as { region: { x: number; y: number; width: number; height: number } } & McpCommand;
            const lines = getTextAt(region);
            respond({ success: true, lines });
            break;
          }

          case 'write_text': {
            const { position, text } = command as { position: { x: number; y: number }; text: string } & McpCommand;
            writeText(position, text);
            respond({ success: true, position, length: text.length });
            break;
          }

          case 'run_command': {
            const { command: cmdString } = command as { command: string } & McpCommand;
            runCommand(cmdString);
            respond({ success: true, command: cmdString });
            break;
          }

          case 'agent_command': {
            const { agentId, command: cmdString, restoreCursor = true } = command as { agentId: string; command: string; restoreCursor?: boolean } & McpCommand;
            const result = agentCommand(agentId, cmdString, restoreCursor);
            respond(result);
            break;
          }

          case 'agent_action': {
            const { agentId, command: cmdString, selection } = command as { agentId: string; command: string; selection?: { width: number; height: number } } & McpCommand;
            const result = agentAction(agentId, cmdString, selection);
            respond(result);
            break;
          }

          // Consolidated sense/make handlers
          case 'sense': {
            const { find, region, near, entityId } = command as { find: string; region?: any; near?: any; entityId?: string } & McpCommand;
            let result: any;

            switch (find) {
              case 'viewport':
                result = getViewport();
                break;
              case 'cursor':
                result = getCursorPosition();
                break;
              case 'selection':
                result = getSelection();
                break;
              case 'agents':
                result = getAgents();
                if (entityId) result = result.filter((a: any) => a.id === entityId);
                break;
              case 'notes':
                result = getNotes();
                if (entityId) result = result.filter((n: any) => n.id === entityId);
                break;
              case 'chips':
                result = getChips();
                if (entityId) result = result.filter((c: any) => c.id === entityId);
                break;
              case 'all':
                result = {
                  viewport: getViewport(),
                  cursor: getCursorPosition(),
                  selection: getSelection(),
                  agents: getAgents(),
                  notes: getNotes(),
                  chips: getChips(),
                };
                break;
              default:
                result = { error: `Unknown find type: ${find}` };
            }

            // Apply region/near filters for entities
            if (result && Array.isArray(result) && (region || near)) {
              result = result.filter((e: any) => {
                if (region) {
                  if (e.x < region.x || e.x >= region.x + region.width) return false;
                  if (e.y < region.y || e.y >= region.y + region.height) return false;
                }
                if (near) {
                  const dist = Math.sqrt(Math.pow(e.x - near.x, 2) + Math.pow(e.y - near.y, 2));
                  if (dist > (near.radius || 10)) return false;
                }
                return true;
              });
            }

            respond({ success: true, result });
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
