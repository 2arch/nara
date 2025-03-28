// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getDatabase, connectDatabaseEmulator, ref, onValue, set, get } from "firebase/database";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCVOk85t5xkRIrEz5g9EuNxQcTWTTdKR68",
  authDomain: "j72n-ca622.firebaseapp.com",
  databaseURL: "https://j72n-ca622-default-rtdb.firebaseio.com",
  projectId: "j72n-ca622",
  storageBucket: "j72n-ca622.firebasestorage.app",
  messagingSenderId: "1081387839640",
  appId: "1:1081387839640:web:55e2fa9a52d01297a3e0ed"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

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

// Helper function to check connection status
const monitorConnection = () => {
  const connectedRef = ref(database, '.info/connected');
  onValue(connectedRef, (snap) => {
    if (snap.val() === true) {
      console.log('Connected to Firebase');
    } else {
      console.log('Not connected to Firebase, will use cached data if available');
    }
  });
};

// Start monitoring connection
monitorConnection();

export { database };