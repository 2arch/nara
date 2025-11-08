#!/usr/bin/env node
/**
 * Pattern World Generator
 *
 * Generates and commits pattern worlds to Firebase for pre-populated URLs
 * Usage: node generate-patterns.js [patternId1] [patternId2] ...
 * Example: node generate-patterns.js dungeon1 maze2 castle3
 */

const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, get } = require('firebase/database');

// Firebase configuration (same as app/firebase.ts)
const firebaseConfig = {
  apiKey: "AIzaSyD5P6G7CMHiuUrKeCE-1R01P6vQSavdTiI",
  authDomain: "nara-a65bc.firebaseapp.com",
  projectId: "nara-a65bc",
  storageBucket: "nara-a65bc.firebasestorage.app",
  messagingSenderId: "927080876309",
  appId: "1:927080876309:web:f490f48dca87faa26b811c",
  databaseURL: "https://nara-a65bc-default-rtdb.firebaseio.com"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

/**
 * Generate deterministic pattern from pattern ID
 * (Mirrors generatePatternFromId from world.engine.ts)
 */
function generatePatternFromId(patternId, centerPos = { x: 0, y: 0 }) {
    // Convert pattern ID to numeric seed (base36 decode)
    const seed = parseInt(patternId, 36);

    // If invalid, use hash of the string
    const numericSeed = isNaN(seed)
        ? patternId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
        : seed;

    // Deterministic RNG based on seed
    const random = (n) => {
        const x = Math.sin(numericSeed + n) * 10000;
        return x - Math.floor(x);
    };

    // BSP generation (same as pattern command)
    const width = 120;
    const height = 60;

    const bspSplit = (node, depth, maxDepth, rng, rngOffset) => {
        if (depth >= maxDepth) {
            const margin = 2;
            if (node.width < margin * 2 + 3 || node.height < margin * 2 + 3) return;
            const roomWidth = Math.floor(rng(rngOffset) * 12) + 28;
            const roomHeight = Math.floor(rng(rngOffset + 1) * 6) + 10;
            const roomX = node.x + margin + Math.floor(rng(rngOffset + 2) * Math.max(0, node.width - roomWidth - margin * 2));
            const roomY = node.y + margin + Math.floor(rng(rngOffset + 3) * Math.max(0, node.height - roomHeight - margin * 2));
            node.room = { x: roomX, y: roomY, width: roomWidth, height: roomHeight };
            return;
        }
        const visualWidth = node.width * 1;
        const visualHeight = node.height * 2;
        const splitHorizontal = visualHeight > visualWidth ? true : (visualWidth > visualHeight ? false : rng(rngOffset + depth) > 0.5);
        if (splitHorizontal && node.height >= 20) {
            const splitY = node.y + Math.floor(node.height / 2) + Math.floor(rng(rngOffset + depth + 1) * 6) - 3;
            node.leftChild = { x: node.x, y: node.y, width: node.width, height: splitY - node.y };
            node.rightChild = { x: node.x, y: splitY, width: node.width, height: node.y + node.height - splitY };
        } else if (!splitHorizontal && node.width >= 40) {
            const splitX = node.x + Math.floor(node.width / 2) + Math.floor(rng(rngOffset + depth + 2) * 8) - 4;
            node.leftChild = { x: node.x, y: node.y, width: splitX - node.x, height: node.height };
            node.rightChild = { x: splitX, y: node.y, width: node.x + node.width - splitX, height: node.height };
        } else {
            const margin = 2;
            const roomWidth = Math.max(28, Math.min(node.width - margin * 2, 40));
            const roomHeight = Math.max(10, Math.min(node.height - margin * 2, 16));
            if (roomWidth >= 28 && roomHeight >= 10) {
                node.room = { x: node.x + margin, y: node.y + margin, width: roomWidth, height: roomHeight };
            }
            return;
        }
        if (node.leftChild) bspSplit(node.leftChild, depth + 1, maxDepth, rng, rngOffset + depth * 10);
        if (node.rightChild) bspSplit(node.rightChild, depth + 1, maxDepth, rng, rngOffset + depth * 10 + 5);
    };

    const collectRooms = (node) => {
        const result = [];
        if (node.room) result.push(node.room);
        if (node.leftChild) result.push(...collectRooms(node.leftChild));
        if (node.rightChild) result.push(...collectRooms(node.rightChild));
        return result;
    };

    const rootNode = {
        x: Math.floor(centerPos.x - width / 2),
        y: Math.floor(centerPos.y - height / 2),
        width: width,
        height: height
    };

    bspSplit(rootNode, 0, 3, random, 100);
    const rooms = collectRooms(rootNode);

    // Calculate actual bounding box from rooms
    const corridorPadding = 3;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const room of rooms) {
        const roomMinX = room.x;
        const roomMinY = room.y;
        const roomMaxX = room.x + room.width;
        const roomMaxY = room.y + room.height;
        const centerX = room.x + Math.floor(room.width / 2);
        const centerY = room.y + Math.floor(room.height / 2);

        minX = Math.min(minX, roomMinX, centerX - corridorPadding);
        minY = Math.min(minY, roomMinY, centerY - corridorPadding);
        maxX = Math.max(maxX, roomMaxX, centerX + corridorPadding);
        maxY = Math.max(maxY, roomMaxY, centerY + corridorPadding);
    }

    const actualWidth = maxX - minX;
    const actualHeight = maxY - minY;
    const actualCenterX = minX + actualWidth / 2;
    const actualCenterY = minY + actualHeight / 2;

    const patternKey = `pattern_${patternId}`;
    const patternData = {
        centerX: actualCenterX,
        centerY: actualCenterY,
        width: actualWidth,
        height: actualHeight,
        timestamp: numericSeed,
        rooms: rooms
    };

    return { patternData, patternKey };
}

/**
 * Save pattern world to Firebase
 */
async function savePatternWorld(patternId, worldPath = 'worlds/public/base') {
    console.log(`\n📦 Generating pattern: ${patternId}`);

    // Generate pattern
    const { patternData, patternKey } = generatePatternFromId(patternId, { x: 0, y: 0 });

    console.log(`  ├─ Pattern key: ${patternKey}`);
    console.log(`  ├─ Rooms: ${patternData.rooms.length}`);
    console.log(`  ├─ Size: ${patternData.width}x${patternData.height}`);
    console.log(`  └─ Seed: ${patternData.timestamp}`);

    // Create world data with just the pattern
    const worldData = {
        [patternKey]: JSON.stringify(patternData)
    };

    // Save to Firebase at the specified path
    const dataRef = ref(database, `${worldPath}/data`);

    try {
        await set(dataRef, worldData);
        console.log(`✓ Saved to Firebase: ${worldPath}/data`);
        console.log(`🌐 URL: /base?p=${patternId}`);
        return true;
    } catch (error) {
        console.error(`✗ Failed to save: ${error.message}`);
        return false;
    }
}

/**
 * Check if pattern already exists
 */
async function checkPatternExists(patternId, worldPath = 'worlds/public/base') {
    const patternKey = `pattern_${patternId}`;
    const dataRef = ref(database, `${worldPath}/data/${patternKey}`);

    try {
        const snapshot = await get(dataRef);
        return snapshot.exists();
    } catch (error) {
        return false;
    }
}

/**
 * Main execution
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('Usage: node generate-patterns.js [patternId1] [patternId2] ...');
        console.log('Example: node generate-patterns.js dungeon1 maze2 castle3');
        console.log('\nGenerating default patterns...\n');

        // Generate default patterns
        args.push('dungeon1', 'maze1', 'castle1', 'labyrinth1', 'temple1');
    }

    console.log(`🏗️  Pattern World Generator`);
    console.log(`📝 Generating ${args.length} patterns\n`);

    let successCount = 0;
    let skipCount = 0;

    for (const patternId of args) {
        const exists = await checkPatternExists(patternId);

        if (exists) {
            console.log(`\n⏭️  Skipping ${patternId} (already exists)`);
            skipCount++;
            continue;
        }

        const success = await savePatternWorld(patternId);
        if (success) successCount++;
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`✅ Generated: ${successCount}`);
    console.log(`⏭️  Skipped: ${skipCount}`);
    console.log(`📊 Total: ${args.length}`);
    console.log(`${'='.repeat(50)}\n`);

    process.exit(0);
}

// Run the script
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
