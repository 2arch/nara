const WebSocket = require('ws');
const pty = require('node-pty');

const PORT = process.env.PORT || 8767;
const wss = new WebSocket.Server({ port: PORT });

// Track active sessions
const sessions = new Map();

wss.on('connection', (ws) => {
  console.log('Client connected');

  // Spawn shell
  const shell = pty.spawn('bash', [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME,
    env: process.env,
  });

  sessions.set(ws, shell);

  // Send terminal output to client
  shell.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  // Handle incoming messages
  ws.on('message', (msg) => {
    const message = msg.toString();

    // Check for resize command
    if (message.startsWith('\x1b[RESIZE:')) {
      const match = message.match(/\x1b\[RESIZE:(\d+),(\d+)\]/);
      if (match) {
        const cols = parseInt(match[1], 10);
        const rows = parseInt(match[2], 10);
        shell.resize(cols, rows);
        return;
      }
    }

    // Regular input
    shell.write(message);
  });

  // Cleanup on disconnect
  ws.on('close', () => {
    console.log('Client disconnected');
    shell.kill();
    sessions.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    shell.kill();
    sessions.delete(ws);
  });
});

console.log(`Terminal server running on ws://localhost:${PORT}`);
