// outreach/sync.ts
// Firebase synchronization for experiences

import {
  getUnsyncedExperiences,
  getExperience,
  markSynced,
  getAllExperiences,
  type Experience
} from './experiences';

// Firebase Admin SDK - lazy initialization
let firebaseInitialized = false;
let database: any = null;

async function initFirebase() {
  if (firebaseInitialized) return database;

  try {
    const admin = await import('firebase-admin');

    // Check if already initialized
    if (admin.apps.length === 0) {
      // Initialize with application default credentials or service account
      const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
        require('path').join(__dirname, '../functions/service-account-key.json');

      try {
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          databaseURL: 'https://nara-a65bc-default-rtdb.firebaseio.com'
        });
      } catch (e) {
        // Fall back to application default credentials
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
          databaseURL: 'https://nara-a65bc-default-rtdb.firebaseio.com'
        });
      }
    }

    database = admin.database();
    firebaseInitialized = true;
    return database;
  } catch (error) {
    console.error('[sync] Failed to initialize Firebase:', error);
    throw error;
  }
}

// ============================================================================
// FIREBASE SYNC
// ============================================================================

/**
 * Sync a single experience to Firebase
 */
export async function syncExperience(experience: Experience): Promise<boolean> {
  const db = await initFirebase();

  const data = {
    id: experience.id,
    name: experience.name,
    openingHook: experience.openingHook,
    openingMessages: experience.openingMessages,
    visualPreset: experience.visualPreset,
    presetCanvasId: experience.presetCanvasId || null,
    campaignId: experience.campaignId || null,
    createdAt: experience.createdAt,
    updatedAt: experience.updatedAt
  };

  await db.ref(`experiences/${experience.id}`).set(data);

  // Mark as synced locally
  markSynced(experience.id);

  return true;
}

/**
 * Sync all unsynced experiences to Firebase
 */
export async function syncToFirebase(): Promise<{ synced: number; failed: number }> {
  const unsynced = getUnsyncedExperiences();
  let synced = 0;
  let failed = 0;

  for (const experience of unsynced) {
    try {
      const success = await syncExperience(experience);
      if (success) {
        synced++;
        console.log(`[sync] ✓ ${experience.id}`);
      } else {
        failed++;
        console.error(`[sync] ✗ ${experience.id} - unknown error`);
      }
    } catch (error) {
      failed++;
      console.error(`[sync] ✗ ${experience.id} - ${error}`);
    }
  }

  return { synced, failed };
}

/**
 * Export experiences as JSON (for manual upload or backup)
 */
export function exportAsJson(experiences: Experience[]): string {
  const exportData = experiences.map(exp => ({
    id: exp.id,
    name: exp.name,
    openingHook: exp.openingHook,
    openingMessages: exp.openingMessages,
    visualPreset: exp.visualPreset,
    presetCanvasId: exp.presetCanvasId || null,
    campaignId: exp.campaignId || null,
    createdAt: exp.createdAt,
    updatedAt: exp.updatedAt
  }));

  return JSON.stringify(exportData, null, 2);
}

/**
 * Generate Firebase Realtime Database rules for experiences
 */
export function generateFirebaseRules(): string {
  return `{
  "experiences": {
    ".read": true,
    ".write": false,
    "$experienceId": {
      ".validate": "newData.hasChildren(['id', 'name', 'openingHook', 'openingMessages', 'visualPreset'])"
    }
  }
}`;
}
