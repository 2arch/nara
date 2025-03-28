import { v4 as uuidv4 } from 'uuid';
import { ref, set, get, child } from 'firebase/database';
import { database } from '../firebase';
import { makeDiff, makePatches, applyPatches } from '@sanity/diff-match-patch';

// Types
export interface WorldData {
  [position: string]: string;  // Maps "x,y" to character
}

interface WorldVersion {
  timestamp: number;
  patches: string;
  metadata?: {
    name?: string;
  };
}

interface WorldMetadata {
  name?: string;
  createdAt: number;
  updatedAt: number;
  version: number;
}

// Remove undefined values (Firebase requirement)
const removeUndefinedValues = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(removeUndefinedValues);
  }

  const cleanObj: any = {};
  for (const key in obj) {
    if (obj[key] !== undefined) {
      cleanObj[key] = removeUndefinedValues(obj[key]);
    }
  }
  return cleanObj;
};

/**
 * Saves world data to Firebase with versioning
 */
export const saveWorld = async (
  worldId: string, 
  worldData: WorldData,
  name?: string
): Promise<string> => {
  // If no worldId provided, create a new one
  const id = worldId || uuidv4();
  const timestamp = Date.now();
  
  try {
    console.log(`Saving world ${id} with ${Object.keys(worldData).length} characters`);
    
    // Check if there's an existing version
    const worldRef = ref(database, `worlds/${id}`);
    const snapshot = await get(worldRef);
    
    // Sanitize data to remove undefined values
    const sanitizedData = removeUndefinedValues(worldData);
    
    const newData = {
      data: sanitizedData,
      metadata: {
        name: name || `World ${id.substring(0, 8)}`,
        updatedAt: timestamp,
        version: 1,
        createdAt: timestamp
      }
    };
    
    if (snapshot.exists()) {
      const currentData = snapshot.val();
      const currentVersion = currentData.metadata?.version || 0;
      
      // Update version number and timestamps
      newData.metadata = {
        name: newData.metadata.name,
        version: currentVersion + 1,
        createdAt: currentData.metadata?.createdAt || timestamp,
        updatedAt: timestamp
      };
      
      // Create diff using diff-match-patch
      const currentDataString = JSON.stringify(currentData);
      const newDataString = JSON.stringify(newData);
      
      const diff = makeDiff(currentDataString, newDataString);
      const patches = makePatches(diff);
      
      // Save patches to version history
      const versionsRef = ref(database, `worlds/${id}/versions/${newData.metadata.version}`);
      await set(versionsRef, {
        timestamp,
        patches: JSON.stringify(patches),
        metadata: {
          name: newData.metadata.name
        }
      });
      
      console.log(`Saved diff for version ${newData.metadata.version}`);
    }
    
    // Save complete current state
    await set(worldRef, newData);
    
    console.log(`Successfully saved world ${id}`);
    return id;
  } catch (error) {
    console.error("Error saving world:", error);
    if (error instanceof Error) {
      console.error("Error details:", error.message, error.stack);
    }
    throw error;
  }
};

/**
 * Loads world data from Firebase
 */
export const loadWorld = async (worldId: string): Promise<WorldData | null> => {
  try {
    console.log(`Loading world ${worldId}`);
    const worldRef = ref(database, `worlds/${worldId}`);
    const snapshot = await get(worldRef);
    
    if (snapshot.exists()) {
      const data = snapshot.val();
      console.log(`Successfully loaded world ${worldId}`);
      return data.data;
    } else {
      console.log(`No world data available for ID: ${worldId}`);
      return null;
    }
  } catch (error) {
    console.error(`Error loading world ${worldId}:`, error);
    return null;
  }
};

/**
 * Loads a specific version of a world by applying patches
 */
export const loadWorldVersion = async (worldId: string, version: number): Promise<WorldData | null> => {
  try {
    const dbRef = ref(database);
    const worldSnapshot = await get(child(dbRef, `worlds/${worldId}`));
    
    if (!worldSnapshot.exists()) {
      console.log("No world data available for this ID");
      return null;
    }
    
    const world = worldSnapshot.val();
    const currentVersion = world.metadata?.version || 0;
    
    // If requesting the current version, return it directly
    if (version >= currentVersion) {
      return world.data;
    }
    
    // Get all versions up to the requested one
    const versionsSnapshot = await get(child(dbRef, `worlds/${worldId}/versions`));
    if (!versionsSnapshot.exists()) {
      return world.data;
    }
    
    const versions = versionsSnapshot.val();
    
    // Start with empty state and apply patches sequentially
    let currentState = '';
    
    // Apply patches from version 1 to the requested version
    for (let i = 1; i <= version; i++) {
      if (versions[i]) {
        const patchesData = JSON.parse(versions[i].patches);
        const [newState] = applyPatches(patchesData, currentState);
        currentState = newState;
      }
    }
    
    // Parse the final state
    const parsedState = JSON.parse(currentState);
    
    return parsedState.data;
  } catch (error) {
    console.error("Error loading world version:", error);
    return null;
  }
};

/**
 * Get version history for a world
 */
export const getWorldVersions = async (worldId: string): Promise<WorldVersion[] | null> => {
  try {
    const dbRef = ref(database);
    const versionsSnapshot = await get(child(dbRef, `worlds/${worldId}/versions`));
    
    if (!versionsSnapshot.exists()) {
      return null;
    }
    
    const versions = versionsSnapshot.val();
    return Object.entries(versions).map(([key, value]) => ({
      ...value,
      version: parseInt(key, 10)
    }));
  } catch (error) {
    console.error("Error getting world versions:", error);
    return null;
  }
};

/**
 * Creates a new empty world with a unique ID
 */
export const createNewWorld = async (name?: string): Promise<string> => {
  try {
    const emptyWorld: WorldData = {};
    
    const newWorldId = uuidv4();
    console.log(`Creating new world with ID: ${newWorldId}`);
    
    // Save empty world
    const id = await saveWorld(newWorldId, emptyWorld, name);
    console.log(`Successfully created new world ${id}`);
    return id;
  } catch (error) {
    console.error("Error creating new world:", error);
    throw error;
  }
};