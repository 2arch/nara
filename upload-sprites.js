/**
 * Upload sprites to Firebase Storage
 * Quick utility to upload generated sprites from tmp-sprites/
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const SPRITES_DIR = path.join(__dirname, 'tmp-sprites');
const STORAGE_PATH = 'sprites/borders/ruins';

// Firebase config (from your firebase.ts)
const firebaseConfig = {
    apiKey: "AIzaSyD5P6G7CMHiuUrKeCE-1R01P6vQSavdTiI",
    authDomain: "nara-a65bc.firebaseapp.com",
    projectId: "nara-a65bc",
    storageBucket: "nara-a65bc.firebasestorage.app",
    messagingSenderId: "927080876309",
    appId: "1:927080876309:web:f490f48dca87faa26b811c"
};

async function uploadSprites() {
    console.log('🔐 Initializing Firebase Admin...');

    // Try to load service account key
    const serviceAccountPath = path.join(__dirname, 'service-account-key.json');
    let initConfig;

    if (fs.existsSync(serviceAccountPath)) {
        console.log('  Using service-account-key.json');
        const serviceAccount = require(serviceAccountPath);
        initConfig = {
            credential: admin.credential.cert(serviceAccount),
            storageBucket: firebaseConfig.storageBucket
        };
    } else {
        console.log('  Using Application Default Credentials');
        initConfig = {
            projectId: firebaseConfig.projectId,
            storageBucket: firebaseConfig.storageBucket
        };
    }

    try {
        admin.initializeApp(initConfig);
    } catch (e) {
        console.error('Failed to initialize Firebase:', e.message);
        console.log('\nTo authenticate:');
        console.log('  1. Download service account key from Firebase Console');
        console.log('     Project Settings > Service Accounts > Generate New Private Key');
        console.log('  2. Save as: service-account-key.json');
        console.log('  3. Re-run this script');
        console.log('\nOr run: gcloud auth application-default login');
        process.exit(1);
    }

    const bucket = admin.storage().bucket();

    console.log(`\n📤 Uploading sprites from ${SPRITES_DIR}...`);

    // Check if directory exists
    if (!fs.existsSync(SPRITES_DIR)) {
        console.error(`Error: ${SPRITES_DIR} not found. Run generate-and-upload-sprites.js first.`);
        process.exit(1);
    }

    const files = fs.readdirSync(SPRITES_DIR).filter(f => f.endsWith('.png'));

    if (files.length === 0) {
        console.error('No PNG files found in tmp-sprites/');
        process.exit(1);
    }

    console.log(`Found ${files.length} sprites to upload\n`);

    for (const file of files) {
        const filePath = path.join(SPRITES_DIR, file);
        const destination = `${STORAGE_PATH}/${file}`;

        try {
            await bucket.upload(filePath, {
                destination,
                metadata: {
                    contentType: 'image/png',
                    cacheControl: 'public, max-age=31536000',
                },
                public: true // Make publicly readable
            });

            // Get public URL
            const publicUrl = `https://storage.googleapis.com/${firebaseConfig.storageBucket}/${destination}`;
            console.log(`  ✓ ${file} → ${publicUrl}`);
        } catch (error) {
            console.error(`  ✗ Failed to upload ${file}:`, error.message);
        }
    }

    console.log('\n✅ Upload complete!');
    console.log(`\nSprites available at:`);
    console.log(`  gs://${firebaseConfig.storageBucket}/${STORAGE_PATH}/`);
    console.log(`\n🧹 Cleanup: rm -rf tmp-sprites/`);
}

uploadSprites().catch(console.error);
