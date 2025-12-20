// outreach/push-keyframe-experience.ts
// Push a keyframe-based experience to Firebase for testing

import * as admin from 'firebase-admin';
import * as path from 'path';

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, '../functions/service-account-key.json');

try {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://nara-a65bc-default-rtdb.firebaseio.com'
  });
} catch (e) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: 'https://nara-a65bc-default-rtdb.firebaseio.com'
  });
}

const database = admin.database();

// ============================================================================
// KEYFRAME EXPERIENCE DEFINITION
// Mirrors the welcome flow from host.flows.ts
// ============================================================================

const loginExperience = {
  id: 'login-test',
  name: 'Login Test Flow',
  campaignId: 'test',
  createdAt: new Date().toISOString(),
  keyframes: [
    // ============================================
    // INTRO / WELCOME SEQUENCE
    // ============================================
    {
      id: 'welcome_message',
      dialogue: 'Hey! Welcome to Nara.',
      bg: '#000000',
      monogram: 'perlin',
      backgroundMode: 'image',
      backgroundImage: 'https://d2w9rnfcy7mm78.cloudfront.net/40525619/original_8f6196d0fda2a540ef8e380980921d25.jpg?1761186290?bc=0'
    },
    {
      id: 'explain_nara',
      dialogue: 'Nara is a new medium for spatial writing. \n \n ',
      previousKeyframeId: 'welcome_message'
    },
    {
      id: 'explain_function',
      dialogue: 'It\'s meant to provide a unique, and intuitive writing experience.',
      previousKeyframeId: 'explain_nara'
    },
    {
      id: 'explain_user',
      dialogue: 'I\'ve added some markers to get you started. Take a look around! \n \n (use two fingers to pan)',
      previousKeyframeId: 'explain_function',
      spawnContent: {
        labels: [
          { offsetX: 100, offsetY: -20, text: 'non-linear thinking', color: '#F0FF6A' },
          { offsetX: -80, offsetY: 24, text: 'spatial canvas', color: '#69AED6' },
          { offsetX: 120, offsetY: 12, text: 'connect ideas', color: '#FFA500' }
        ]
      }
    },
    {
      id: 'validate_user',
      dialogue: 'As you spend more time here, you\'ll find that the real limit is your ability to harness the space to connect the dots. \n \n We created a medium that helps you think better.',
      previousKeyframeId: 'explain_user'
    },

    // ============================================
    // EMAIL COLLECTION
    // ============================================
    {
      id: 'email',
      dialogue: 'Type your email and hit enter to begin your journey.',
      input: 'email',
      previousKeyframeId: 'validate_user',
      despawnLabels: true
    },

    // ============================================
    // PASSWORD COLLECTION
    // ============================================
    {
      id: 'password',
      dialogue: 'choose a password (at least 6 characters)',
      input: 'password',
      previousKeyframeId: 'email',
      nextKeyframeId: 'checking_user'
    },

    // ============================================
    // CREDENTIAL CHECK (HANDLER)
    // ============================================
    {
      id: 'checking_user',
      dialogue: 'checking credentials...',
      handler: 'checkCredentials'
      // Handler returns:
      // - success + redirect for existing user
      // - nextKeyframeId: 'collect_username' for new user
      // - nextKeyframeId: 'collect_password' for wrong password
    },

    // ============================================
    // USERNAME COLLECTION (NEW USER)
    // ============================================
    {
      id: 'collect_username',
      dialogue: 'choose a username',
      input: 'username',
      previousKeyframeId: 'password',
      nextKeyframeId: 'creating_account'
    },

    // ============================================
    // ACCOUNT CREATION (HANDLER)
    // ============================================
    {
      id: 'creating_account',
      dialogue: 'creating your account...',
      handler: 'createAccount'
      // Handler returns success, then continues to account_created
    },

    // ============================================
    // SUCCESS MESSAGE
    // ============================================
    {
      id: 'account_created',
      dialogue: 'welcome to nara!',
      autoAdvanceMs: 1500,
      nextKeyframeId: 'ask_navigation'
    },

    // ============================================
    // NAVIGATION CHOICE
    // ============================================
    {
      id: 'ask_navigation',
      dialogue: 'would you like to navigate to your home world? \n \n (yes / no)',
      input: 'choice',
      choices: ['yes', 'no'],
      branchLogic: {
        'yes': 'navigate_home',
        'no': 'stay_in_public'
      },
      previousKeyframeId: 'account_created'
    },

    // ============================================
    // NAVIGATE HOME (HANDLER)
    // ============================================
    {
      id: 'navigate_home',
      dialogue: 'taking you to your world...',
      handler: 'navigateHome'
    },

    // ============================================
    // STAY IN PUBLIC
    // ============================================
    {
      id: 'stay_in_public',
      dialogue: 'sounds good! you can always navigate to your home world using the /state command. \n \n enjoy! (press enter to continue)',
      input: 'text',
      nextKeyframeId: 'dismiss_flow'
    },

    // ============================================
    // DISMISS
    // ============================================
    {
      id: 'dismiss_flow',
      dialogue: '',
      handler: 'dismiss'
    }
  ]
};

// ============================================================================
// PUSH TO FIREBASE
// ============================================================================

async function pushExperience() {
  const experienceId = loginExperience.id;

  console.log(`\nPushing experience: ${experienceId}`);
  console.log(`  Name: ${loginExperience.name}`);
  console.log(`  Keyframes: ${loginExperience.keyframes.length}`);

  try {
    await database.ref(`experiences/${experienceId}`).set(loginExperience);
    console.log('\n✓ Experience pushed successfully!');
    console.log(`\nTest URL: http://localhost:3000/?exp=${experienceId}`);
    console.log(`Prod URL: https://nara.ws/?exp=${experienceId}`);
  } catch (error) {
    console.error('\n✗ Failed to push experience:', error);
    process.exit(1);
  }

  process.exit(0);
}

pushExperience();
