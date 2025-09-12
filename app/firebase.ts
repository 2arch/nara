// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getDatabase, connectDatabaseEmulator, ref, onValue, set, get, query, orderByChild, equalTo } from "firebase/database";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, User } from "firebase/auth";
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
export interface UserProfileData {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  uid: string;
  createdAt: string;
  membership: string;
}

export const signUpUser = async (email: string, password: string, firstName: string, lastName: string, username: string): Promise<{success: boolean, user?: User, error?: string}> => {
  try {
    // Create user with email and password
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Update the user's display name
    await updateProfile(user, {
      displayName: `${firstName} ${lastName}`
    });
    
    // Store additional user data in the database
    const userProfileData: UserProfileData = {
      firstName,
      lastName,
      username,
      email,
      uid: user.uid,
      createdAt: new Date().toISOString(),
      membership: 'fresh'
    };
    
    // Store user profile in database
    await set(ref(database, `users/${user.uid}`), userProfileData);
    
    return { success: true, user };
  } catch (error: any) {
    console.error('Signup error:', error);
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
    console.error('Signin error:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to sign in' 
    };
  }
};

export const checkUsernameAvailability = async (username: string): Promise<boolean> => {
  try {
    const usersQuery = query(ref(database, 'users'), orderByChild('username'), equalTo(username));
    const snapshot = await get(usersQuery);
    return !snapshot.exists(); // Available if no user has this username
  } catch (error) {
    console.error('Error checking username availability:', error);
    return false; // Assume not available on error
  }
};

export const getUsernameByUid = async (uid: string): Promise<string | null> => {
  try {
    const snapshot = await get(ref(database, `users/${uid}/username`));
    return snapshot.exists() ? snapshot.val() : null;
  } catch (error) {
    console.error('Error fetching username:', error);
    return null;
  }
};

export { database, app, auth };
