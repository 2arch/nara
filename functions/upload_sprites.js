const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin with explicit project ID
admin.initializeApp({
    projectId: 'nara-a65bc',
    storageBucket: 'nara-a65bc.firebasestorage.app'
});

const bucket = admin.storage().bucket();

async function findSpriteByCharacterId(characterId) {
    // List all metadata files in storage and find the one with matching characterId
    const [files] = await bucket.getFiles({ prefix: 'sprites/' });

    for (const file of files) {
        if (file.name.endsWith('metadata.json')) {
            try {
                const [content] = await file.download();
                const metadata = JSON.parse(content.toString());
                if (metadata.characterId === characterId) {
                    // Extract sprite path from file name: sprites/{userId}/{spriteId}/metadata.json
                    const parts = file.name.split('/');
                    return {
                        userId: parts[1],
                        spriteId: parts[2],
                        metadata
                    };
                }
            } catch (e) {
                // Skip files that can't be parsed
            }
        }
    }
    return null;
}

async function uploadSprites() {
    const characterId = 'c8d02a59-f8c1-414c-abd8-246b0da979fd';
    const outputDir = '/tmp/full_metal_knight/output';

    console.log('Searching for sprite with characterId:', characterId);

    // Find the sprite
    const spriteInfo = await findSpriteByCharacterId(characterId);

    if (!spriteInfo) {
        console.log('Sprite not found by characterId. Listing metadata files...');
        const [files] = await bucket.getFiles({ prefix: 'sprites/' });
        const metadataFiles = files.filter(f => f.name.endsWith('metadata.json'));
        console.log('Found', metadataFiles.length, 'metadata files');

        // Try to find any sprite with "full_metal_knight" or similar name
        for (const file of metadataFiles) {
            try {
                const [content] = await file.download();
                const metadata = JSON.parse(content.toString());
                console.log(`${file.name}: characterId=${metadata.characterId}, name=${metadata.name}`);

                if (metadata.name && metadata.name.toLowerCase().includes('metal')) {
                    const parts = file.name.split('/');
                    console.log('Found potential match!');
                    console.log('  userId:', parts[1]);
                    console.log('  spriteId:', parts[2]);
                }
            } catch (e) {
                // Skip
            }
        }
        return;
    }

    console.log('Found sprite:', spriteInfo);

    const storagePath = `sprites/${spriteInfo.userId}/${spriteInfo.spriteId}`;

    // Upload idle.png
    const idlePath = path.join(outputDir, 'idle.png');
    if (fs.existsSync(idlePath)) {
        console.log('Uploading idle.png...');
        await bucket.upload(idlePath, {
            destination: `${storagePath}/idle.png`,
            metadata: {
                contentType: 'image/png',
                metadata: {
                    firebaseStorageDownloadTokens: require('crypto').randomUUID()
                }
            }
        });
        console.log('idle.png uploaded!');
    }

    // Upload walk.png
    const walkPath = path.join(outputDir, 'walk.png');
    if (fs.existsSync(walkPath)) {
        console.log('Uploading walk.png...');
        await bucket.upload(walkPath, {
            destination: `${storagePath}/walk.png`,
            metadata: {
                contentType: 'image/png',
                metadata: {
                    firebaseStorageDownloadTokens: require('crypto').randomUUID()
                }
            }
        });
        console.log('walk.png uploaded!');
    }

    console.log('Done! Sprite sheets uploaded to:', storagePath);
}

uploadSprites().catch(console.error).finally(() => process.exit());
