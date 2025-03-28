// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
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

// Initialize Realtime Database and get a reference to the service
export const database = getDatabase(app);