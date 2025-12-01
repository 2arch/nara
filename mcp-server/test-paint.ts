#!/usr/bin/env npx tsx
/**
 * Test script to paint directly via the bridge
 *
 * Usage:
 *   1. Start the bridge: npm run bridge
 *   2. Have Nara running with mcpEnabled={true}
 *   3. Run this: npx tsx test-paint.ts
 */

import { WebSocket } from 'ws';

const BRIDGE_URL = process.env.BRIDGE_WS_URL || 'ws://localhost:3002/mcp';

async function testPaint() {
  console.log('Connecting to bridge at', BRIDGE_URL);

  const ws = new WebSocket(BRIDGE_URL);

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      console.log('Connected!');
      resolve();
    });
    ws.on('error', reject);
  });

  // Wait for Nara to connect
  console.log('Waiting 2s for Nara frontend to connect...');
  await new Promise(r => setTimeout(r, 2000));

  // Paint a simple flower
  const flower = generateFlower(20, 20);

  console.log(`Painting flower with ${flower.length} cells...`);

  const message = {
    id: Date.now().toString(),
    type: 'paint_cells',
    cells: flower
  };

  ws.send(JSON.stringify(message));

  // Wait for response
  await new Promise<void>((resolve) => {
    ws.on('message', (data) => {
      console.log('Response:', data.toString());
      resolve();
    });
    setTimeout(resolve, 3000);
  });

  ws.close();
  console.log('Done!');
}

function generateFlower(centerX: number, centerY: number) {
  const cells: Array<{ x: number; y: number; color: string }> = [];

  // Red petals in a circle pattern
  const petalColor = '#ff4444';
  const petalRadius = 4;
  for (let angle = 0; angle < 360; angle += 45) {
    const rad = (angle * Math.PI) / 180;
    const px = Math.round(centerX + Math.cos(rad) * petalRadius);
    const py = Math.round(centerY + Math.sin(rad) * petalRadius);

    // Each petal is a small cluster
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (Math.abs(dx) + Math.abs(dy) <= 1) {
          cells.push({ x: px + dx, y: py + dy, color: petalColor });
        }
      }
    }
  }

  // Yellow center
  const centerColor = '#ffdd00';
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy <= 4) {
        cells.push({ x: centerX + dx, y: centerY + dy, color: centerColor });
      }
    }
  }

  // Green stem
  const stemColor = '#22aa22';
  for (let y = centerY + 5; y < centerY + 12; y++) {
    cells.push({ x: centerX, y, color: stemColor });
  }

  // Leaves
  const leafColor = '#33bb33';
  // Left leaf
  cells.push({ x: centerX - 1, y: centerY + 7, color: leafColor });
  cells.push({ x: centerX - 2, y: centerY + 7, color: leafColor });
  cells.push({ x: centerX - 2, y: centerY + 8, color: leafColor });
  // Right leaf
  cells.push({ x: centerX + 1, y: centerY + 9, color: leafColor });
  cells.push({ x: centerX + 2, y: centerY + 9, color: leafColor });
  cells.push({ x: centerX + 2, y: centerY + 10, color: leafColor });

  return cells;
}

testPaint().catch(console.error);
