// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getDatabase, connectDatabaseEmulator, ref, onValue, set, get, query, orderByChild, equalTo } from "firebase/database";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, User, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from "firebase/auth";
import { getStorage, ref as storageRef, uploadString, uploadBytes, getDownloadURL } from "firebase/storage";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, deleteDoc, query as firestoreQuery, orderBy, limit } from "firebase/firestore";
import { logger } from './bitworld/logger';
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyD5P6G7CMHiuUrKeCE-1R01P6vQSavdTiI",
  authDomain: "nara-a65bc.firebaseapp.com",
  projectId: "nara-a65bc",
  storageBucket: "nara-a65bc.firebasestorage.app",
  messagingSenderId: "927080876309",
  appId: "1:927080876309:web:f490f48dca87faa26b811c"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const storage = getStorage(app);
const firestore = getFirestore(app);

// Configure for Electron environment
const dbConfig = {
  // By default, Firebase Realtime Database has persistence enabled
  // The default cache size is 10MB, which should be sufficient for most apps
};

// Initialize Realtime Database with persistence enabled by default
const database = getDatabase(app);

// For Firebase Realtime Database, persistence is enabled by default
// No need to explicitly enable it, but we can log for confirmation

// Connect to emulator if in development mode
if (process.env.NODE_ENV === 'development' && process.env.FIREBASE_EMULATOR === 'true') {
  connectDatabaseEmulator(database, 'localhost', 9000);
}

// Force cleanup all connections when page unloads to prevent leaks
if (typeof window !== 'undefined') {
  const { goOffline } = require('firebase/database');
  
  const cleanup = () => {
    goOffline(database);
  };
  
  // Cleanup on page unload/refresh
  window.addEventListener('beforeunload', cleanup);
  window.addEventListener('pagehide', cleanup);
  
  // Cleanup in development when hot reloading
  if (process.env.NODE_ENV === 'development') {
    window.addEventListener('unload', cleanup);
  }
}

// Authentication functions
export type MembershipTier = 'fresh' | 'pro' | 'super';

export interface UserProfileData {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  uid: string;
  createdAt: string;
  membership: MembershipTier;
  subscriptionId?: string; // Stripe subscription ID
  planExpiry?: string; // ISO date string
  aiUsage?: {
    daily: { [date: string]: number }; // YYYY-MM-DD format
    monthly: { [month: string]: number }; // YYYY-MM format  
    total: number;
    lastReset?: string; // ISO date of last daily reset
  };
}

export const signUpUser = async (email: string, password: string, firstName: string, lastName: string, username: string): Promise<{success: boolean, user?: User, error?: string}> => {
  try {
    let user: User;
    let existingUser = false;

    try {
      // Try to create user with email and password
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      user = userCredential.user;
    } catch (createError: any) {
      // If email already in use, check if it's from email link auth (no password)
      if (createError.code === 'auth/email-already-in-use') {
        logger.info('Email already in use, attempting to link password credential');
        
        // Check if there's a current user (from email link)
        if (auth.currentUser && auth.currentUser.email === email) {
          // Link password to existing account
          const { EmailAuthProvider, linkWithCredential } = await import('firebase/auth');
          const credential = EmailAuthProvider.credential(email, password);
          
          try {
            await linkWithCredential(auth.currentUser, credential);
            user = auth.currentUser;
            existingUser = true;
            logger.info('Successfully linked password to existing account');
          } catch (linkError: any) {
            logger.error('Failed to link password:', linkError);
            return {
              success: false,
              error: 'Unable to link password to existing account'
            };
          }
        } else {
          // User exists but not currently signed in
          return {
            success: false,
            error: 'An account with this email already exists. Please sign in instead.'
          };
        }
      } else {
        throw createError;
      }
    }
    
    // Update the user's display name
    await updateProfile(user, {
      displayName: `${firstName} ${lastName}`
    });
    
    // Check if profile already exists (for linked accounts)
    const existingProfileSnapshot = await get(ref(database, `users/${user.uid}`));
    
    if (!existingProfileSnapshot.exists()) {
      // Store additional user data in the database
      const userProfileData: UserProfileData = {
        firstName,
        lastName,
        username,
        email,
        uid: user.uid,
        createdAt: new Date().toISOString(),
        membership: 'fresh',
        aiUsage: {
          daily: {},
          monthly: {},
          total: 0,
          lastReset: new Date().toISOString()
        }
      };
      
      // Store user profile in database
      await set(ref(database, `users/${user.uid}`), userProfileData);
    } else if (existingUser) {
      // Update existing profile with the new information
      await set(ref(database, `users/${user.uid}/firstName`), firstName);
      await set(ref(database, `users/${user.uid}/lastName`), lastName);
      await set(ref(database, `users/${user.uid}/username`), username);
      logger.info('Updated existing profile with new credentials');
    }
    
    return { success: true, user };
  } catch (error: any) {
    logger.error('Signup error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to create account' 
    };
  }
};

export const signInUser = async (email: string, password: string): Promise<{success: boolean, user?: User, error?: string}> => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return { success: true, user: userCredential.user };
  } catch (error: any) {
    // Don't log invalid-credential errors since they're expected for new users
    if (error.code !== 'auth/invalid-credential') {
      logger.error('Signin error:', error);
    }
    return {
      success: false,
      error: error.message || 'Failed to sign in'
    };
  }
};

// Email link (passwordless) authentication
export const sendSignInLink = async (email: string, firstName?: string, lastName?: string, username?: string): Promise<{success: boolean, error?: string}> => {
  try {
    const actionCodeSettings = {
      // URL to redirect to after email link is clicked - redirect to home so auth state listener can catch it
      url: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
      handleCodeInApp: true,
    };

    // Generate the sign-in link
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);

    // Note: To use a custom email (no-reply@nara.ws), you would need to:
    // 1. Set up Firebase Cloud Functions with custom SMTP
    // 2. Call a custom function here instead of sendSignInLinkToEmail
    // 3. Example: await customSendSignInEmail(email, link);

    // For now, Firebase's default email will be used
    // The email template can be customized in Firebase Console > Authentication > Templates

    // Save email to local storage to complete sign-in on redirect
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('emailForSignIn', email);
      // Save additional user info for account creation if provided
      if (firstName && lastName && username) {
        window.localStorage.setItem('pendingUserData', JSON.stringify({ firstName, lastName, username }));
      }
    }

    return { success: true };
  } catch (error: any) {
    logger.error('Error sending sign-in link:', error);
    return {
      success: false,
      error: error.message || 'Failed to send sign-in link'
    };
  }
};

export const completeSignInWithEmailLink = async (emailLink?: string): Promise<{success: boolean, user?: User, error?: string, isNewUser?: boolean}> => {
  try {
    const url = emailLink || (typeof window !== 'undefined' ? window.location.href : '');

    // Check if the URL is a sign-in link
    if (!isSignInWithEmailLink(auth, url)) {
      return { success: false, error: 'Invalid sign-in link' };
    }

    // Get email from local storage
    let email = typeof window !== 'undefined' ? window.localStorage.getItem('emailForSignIn') : null;

    if (!email) {
      // Fallback: ask user for email if not in storage
      return { success: false, error: 'Email not found. Please enter your email.' };
    }

    // Sign in with email link
    const userCredential = await signInWithEmailLink(auth, email, url);
    const user = userCredential.user;

    // Check if this is a new user
    const isNewUser = userCredential.user.metadata.creationTime === userCredential.user.metadata.lastSignInTime;

    if (isNewUser) {
      // Check if profile already exists (shouldn't happen but defensive)
      const existingProfile = await get(ref(database, `users/${user.uid}`));

      if (!existingProfile.exists()) {
        // Create minimal user profile - username will be added later in verification flow
        const userProfileData: Partial<UserProfileData> = {
          firstName: '',
          lastName: '',
          username: '', // Will be set by verification flow
          email: user.email || email,
          uid: user.uid,
          createdAt: new Date().toISOString(),
          membership: 'fresh',
          aiUsage: {
            daily: {},
            monthly: {},
            total: 0,
            lastReset: new Date().toISOString()
          }
        };

        await set(ref(database, `users/${user.uid}`), userProfileData);
        logger.debug('Created minimal user profile for', user.uid);
      }
    }

    // Clean up email from storage
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('emailForSignIn');
    }

    return { success: true, user, isNewUser };
  } catch (error: any) {
    logger.error('Error completing sign-in with email link:', error);
    return {
      success: false,
      error: error.message || 'Failed to complete sign-in'
    };
  }
};

export const checkUsernameAvailability = async (username: string): Promise<boolean> => {
  try {
    const usersQuery = query(ref(database, 'users'), orderByChild('username'), equalTo(username));
    const snapshot = await get(usersQuery);
    return !snapshot.exists(); // Available if no user has this username
  } catch (error) {
    logger.error('Error checking username availability:', error);
    return false; // Assume not available on error
  }
};

export const getUsernameByUid = async (uid: string): Promise<string | null> => {
  try {
    const snapshot = await get(ref(database, `users/${uid}/username`));
    return snapshot.exists() ? snapshot.val() : null;
  } catch (error) {
    logger.error('Error fetching username:', error);
    return null;
  }
};

export const getUidByUsername = async (username: string): Promise<string | null> => {
  try {
    const usersQuery = query(ref(database, 'users'), orderByChild('username'), equalTo(username));
    const snapshot = await get(usersQuery);
    
    if (snapshot.exists()) {
      // Get the first (and should be only) match
      const userData = snapshot.val();
      const uid = Object.keys(userData)[0];
      return uid;
    }
    return null;
  } catch (error) {
    logger.error('Error fetching UID by username:', error);
    return null;
  }
};

// Subscription and usage management
export const TIER_LIMITS = {
  fresh: { daily: 5, monthly: 50 },
  pro: { daily: -1, monthly: -1 }, // -1 = unlimited
  super: { daily: -1, monthly: -1 } // -1 = unlimited
} as const;

export const getUserProfile = async (uid: string): Promise<UserProfileData | null> => {
  try {
    const snapshot = await get(ref(database, `users/${uid}`));
    if (!snapshot.exists()) return null;
    
    const userData = snapshot.val() as UserProfileData;
    
    // Handle both old (membership as string) and new (membership as object) structures
    if (typeof userData.membership === 'object' && userData.membership && 'tier' in userData.membership) {
      // New structure - extract tier
      userData.membership = (userData.membership as any).tier;
    } else if (!userData.membership) {
      // No membership at all - initialize
      userData.membership = 'fresh';
      await set(ref(database, `users/${uid}/membership`), { tier: 'fresh' });
    } else if (typeof userData.membership === 'string') {
      // Old structure - migrate to new
      const tier = userData.membership;
      await set(ref(database, `users/${uid}/membership`), { tier });
    }
    
    // Initialize aiUsage if missing
    if (!userData.aiUsage) {
      userData.aiUsage = {
        daily: {},
        monthly: {},
        total: 0,
        lastReset: new Date().toISOString()
      };
      await set(ref(database, `users/${uid}/aiUsage`), userData.aiUsage);
    }
    
    return userData;
  } catch (error) {
    logger.error('Error fetching user profile:', error);
    return null;
  }
};

export const checkUserQuota = async (uid: string): Promise<{ canUseAI: boolean, dailyUsed: number, dailyLimit: number, tier: MembershipTier }> => {
  try {
    const profile = await getUserProfile(uid);
    if (!profile) {
      return { canUseAI: false, dailyUsed: 0, dailyLimit: 0, tier: 'fresh' };
    }

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const dailyUsed = profile.aiUsage?.daily?.[today] || 0;
    const tier = profile.membership || 'fresh'; // Default to 'fresh' if somehow still missing
    const dailyLimit = TIER_LIMITS[tier].daily;
    
    // Unlimited tier (-1) always allows usage
    const canUseAI = dailyLimit === -1 || dailyUsed < dailyLimit;
    
    return { canUseAI, dailyUsed, dailyLimit, tier };
  } catch (error) {
    logger.error('Error checking user quota:', error);
    return { canUseAI: false, dailyUsed: 0, dailyLimit: 0, tier: 'fresh' };
  }
};

export const upgradeUserToPro = async (uid: string): Promise<boolean> => {
  try {
    await set(ref(database, `users/${uid}/membership`), { tier: 'pro' });
    console.log(`User ${uid} upgraded to pro`);
    return true;
  } catch (error) {
    console.error('Error upgrading user to pro:', error);
    return false;
  }
};

export const incrementUserUsage = async (uid: string): Promise<boolean> => {
  try {
    console.log('[Firebase] Incrementing usage for uid:', uid);
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM

    const userRef = ref(database, `users/${uid}`);
    const snapshot = await get(userRef);

    if (!snapshot.exists()) {
      console.log('[Firebase] User not found:', uid);
      return false;
    }
    
    const userData = snapshot.val() as UserProfileData;
    const currentUsage = userData.aiUsage || { daily: {}, monthly: {}, total: 0 };

    // Ensure daily and monthly objects exist
    const daily = currentUsage.daily || {};
    const monthly = currentUsage.monthly || {};
    const total = currentUsage.total || 0;

    // Increment counters
    const newUsage = {
      daily: {
        ...daily,
        [today]: (daily[today] || 0) + 1
      },
      monthly: {
        ...monthly,
        [currentMonth]: (monthly[currentMonth] || 0) + 1
      },
      total: total + 1,
      lastReset: currentUsage.lastReset || new Date().toISOString()
    };
    
    // Update in database
    console.log('[Firebase] Writing usage to database:', newUsage);
    await set(ref(database, `users/${uid}/aiUsage`), newUsage);
    console.log(`[Firebase] AI usage incremented for ${uid}: ${newUsage.daily[today]} today, ${newUsage.total} total`);
    logger.info(`AI usage incremented for ${uid}: ${newUsage.daily[today]} today, ${newUsage.total} total`);
    return true;
  } catch (error) {
    logger.error('Error incrementing user usage:', error);
    return false;
  }
};

// Sprite management
export interface SavedSprite {
  id: string;
  name: string;
  description: string;
  walkUrl: string;
  idleUrl: string;
  createdAt: string;
  hasRotations?: boolean; // True if rotations/ folder exists (for --sheet command)
}

export const saveSprite = async (
  uid: string,
  name: string,
  description: string,
  walkSheetDataUrl: string,
  idleSheetDataUrl: string,
  existingSpriteId?: string
): Promise<{ success: boolean; sprite?: SavedSprite; error?: string }> => {
  try {
    const spriteId = existingSpriteId || `sprite_${Date.now()}`;
    console.log('[saveSprite] Starting save for user:', uid, 'sprite:', spriteId, 'existing:', !!existingSpriteId);

    // Extract base64 data from data URLs
    const walkBase64 = walkSheetDataUrl.split(',')[1];
    const idleBase64 = idleSheetDataUrl.split(',')[1];

    if (!walkBase64 || !idleBase64) {
      console.error('[saveSprite] Invalid data URLs - walk:', !!walkBase64, 'idle:', !!idleBase64);
      return { success: false, error: 'Invalid sprite data URLs' };
    }
    console.log('[saveSprite] Base64 data extracted - walk:', walkBase64.length, 'bytes, idle:', idleBase64.length, 'bytes');

    // Upload to Storage
    const walkRef = storageRef(storage, `sprites/${uid}/${spriteId}/walk.png`);
    const idleRef = storageRef(storage, `sprites/${uid}/${spriteId}/idle.png`);

    console.log('[saveSprite] Uploading to Firebase Storage...');
    await Promise.all([
      uploadString(walkRef, walkBase64, 'base64', { contentType: 'image/png' }),
      uploadString(idleRef, idleBase64, 'base64', { contentType: 'image/png' }),
    ]);
    console.log('[saveSprite] Storage upload complete');

    // Get download URLs
    const [walkUrl, idleUrl] = await Promise.all([
      getDownloadURL(walkRef),
      getDownloadURL(idleRef),
    ]);
    console.log('[saveSprite] Download URLs obtained:', walkUrl.substring(0, 50) + '...');

    // Save metadata.json alongside the sprite sheets
    const metadata = {
      id: spriteId,
      name,
      description,
      createdAt: new Date().toISOString(),
    };
    const metadataRef = storageRef(storage, `sprites/${uid}/${spriteId}/metadata.json`);
    const metadataBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
    await uploadBytes(metadataRef, metadataBlob);
    console.log('[saveSprite] Metadata saved');

    // Return sprite data (Storage URLs only, no Firestore)
    const spriteData: SavedSprite = {
      id: spriteId,
      name,
      description,
      walkUrl,
      idleUrl,
      createdAt: metadata.createdAt,
    };

    console.log('[saveSprite] Sprite saved to Storage:', spriteId);
    logger.info(`Sprite saved to Storage: ${spriteId} for user ${uid}`);
    return { success: true, sprite: spriteData };
  } catch (error: any) {
    console.error('[saveSprite] Error:', error);
    logger.error('Error saving sprite:', error);
    return { success: false, error: error.message || 'Failed to save sprite' };
  }
};

export const getUserSprites = async (uid: string | null): Promise<SavedSprite[]> => {
  try {
    const allSprites: SavedSprite[] = [];
    console.log('[getUserSprites] Fetching sprites for uid:', uid);

    // Fetch user sprites from Storage if authenticated
    if (uid) {
      const { listAll } = await import('firebase/storage');
      const userSpritesRef = storageRef(storage, `sprites/${uid}`);
      const result = await listAll(userSpritesRef);
      console.log('[getUserSprites] Found', result.prefixes.length, 'sprite folders');

      // Each sprite has a folder with walk.png, idle.png, and metadata.json
      // Sprites may be incomplete (only idle.png if animation hasn't been generated yet)
      for (const folderRef of result.prefixes) {
        const spriteId = folderRef.name;
        try {
          const walkRef = storageRef(storage, `sprites/${uid}/${spriteId}/walk.png`);
          const idleRef = storageRef(storage, `sprites/${uid}/${spriteId}/idle.png`);
          const metadataRef = storageRef(storage, `sprites/${uid}/${spriteId}/metadata.json`);

          // Load metadata if it exists
          let name = spriteId.replace('sprite_', '').replace(/_/g, ' ');
          let description = '';
          let createdAt = new Date().toISOString();

          try {
            const metadataUrl = await getDownloadURL(metadataRef);
            const metadataRes = await fetch(metadataUrl);
            const metadata = await metadataRes.json();
            name = metadata.name || name;
            description = metadata.description || '';
            createdAt = metadata.createdAt || createdAt;
          } catch (error) {
            // No metadata file, use defaults
          }

          // Try to load walk, idle URLs and check for rotations folder
          // Incomplete sprites may only have rotations/ folder (no idle.png yet)
          let walkUrl = '';
          let idleUrl = '';
          let hasRotations = false;

          try {
            walkUrl = await getDownloadURL(walkRef);
          } catch (error) {
            // walk.png doesn't exist yet - sprite animation incomplete
          }

          try {
            idleUrl = await getDownloadURL(idleRef);
          } catch (error) {
            // idle.png doesn't exist - check if rotations folder exists
          }

          // Check if rotations folder exists by looking for south.png
          const rotationsSouthRef = storageRef(storage, `sprites/${uid}/${spriteId}/rotations/south.png`);
          try {
            await getDownloadURL(rotationsSouthRef);
            hasRotations = true;
          } catch (error) {
            // No rotations folder
          }

          // Skip sprite only if it has neither idle.png nor rotations
          if (!idleUrl && !hasRotations) {
            console.warn(`Skipping sprite ${spriteId}: no idle.png or rotations found`);
            continue;
          }

          console.log(`[getUserSprites] Loaded sprite: ${spriteId} (name: ${name}, hasWalk: ${!!walkUrl}, hasIdle: ${!!idleUrl}, hasRotations: ${hasRotations})`);
          allSprites.push({
            id: spriteId,
            name,
            description,
            walkUrl,
            idleUrl,
            createdAt,
            hasRotations,
          });
        } catch (error) {
          console.warn(`Skipping sprite ${spriteId}:`, error);
        }
      }
    }

    // Sort by sprite ID (newest first, based on timestamp in ID)
    allSprites.sort((a, b) => b.id.localeCompare(a.id));
    console.log('[getUserSprites] Returning', allSprites.length, 'sprites');

    return allSprites;
  } catch (error) {
    logger.error('Error fetching sprites:', error);
    return [];
  }
};

export const loadSprite = async (uid: string, spriteId: string): Promise<SavedSprite | null> => {
  try {
    // Load sprite from Storage
    const walkRef = storageRef(storage, `sprites/${uid}/${spriteId}/walk.png`);
    const idleRef = storageRef(storage, `sprites/${uid}/${spriteId}/idle.png`);

    const [walkUrl, idleUrl] = await Promise.all([
      getDownloadURL(walkRef),
      getDownloadURL(idleRef),
    ]);

    return {
      id: spriteId,
      name: spriteId.replace('sprite_', '').replace(/_/g, ' '),
      description: '',
      walkUrl,
      idleUrl,
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('Error loading sprite:', error);
    return null;
  }
};

export const deleteSprite = async (uid: string, spriteId: string): Promise<{ success: boolean; error?: string }> => {
  try {
    const { deleteObject } = await import('firebase/storage');

    // Delete from Storage only
    const walkRef = storageRef(storage, `sprites/${uid}/${spriteId}/walk.png`);
    const idleRef = storageRef(storage, `sprites/${uid}/${spriteId}/idle.png`);

    await Promise.all([
      deleteObject(walkRef).catch(() => {}), // Ignore if doesn't exist
      deleteObject(idleRef).catch(() => {}),
    ]);

    logger.info(`Sprite deleted from Storage: ${spriteId} for user ${uid}`);
    return { success: true };
  } catch (error: any) {
    logger.error('Error deleting sprite:', error);
    return { success: false, error: error.message || 'Failed to delete sprite' };
  }
};

export const renameSprite = async (
  uid: string,
  spriteId: string,
  newName: string
): Promise<{ success: boolean; error?: string }> => {
  // Renaming not supported with Storage-only implementation
  // Sprite names are derived from sprite IDs
  logger.info(`Rename requested but not supported: ${spriteId} -> ${newName}`);
  return { success: false, error: 'Rename not supported with Storage-only sprites' };
};

export { database, app, auth, storage, firestore };
