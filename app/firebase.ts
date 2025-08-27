// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getDatabase, connectDatabaseEmulator, ref, onValue, set, get } from "firebase/database";
import { getAuth } from "firebase/auth";
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
console.log("Firebase Realtime Database initialized with default persistence");

// Connect to emulator if in development mode
if (process.env.NODE_ENV === 'development' && process.env.FIREBASE_EMULATOR === 'true') {
  connectDatabaseEmulator(database, 'localhost', 9000);
  console.log('Connected to Firebase emulator');
}

// Force cleanup all connections when page unloads to prevent leaks
if (typeof window !== 'undefined') {
  const { goOffline } = require('firebase/database');
  
  const cleanup = () => {
    console.log('Page unloading - forcing Firebase offline to prevent connection leaks');
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

export { database, app, auth };
