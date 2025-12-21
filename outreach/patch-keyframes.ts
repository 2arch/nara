import admin from 'firebase-admin';
import path from 'path';

const serviceAccount = require(path.join(__dirname, '../functions/service-account-key.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://nara-a65bc-default-rtdb.firebaseio.com'
});

const db = admin.database();

async function main() {
  // Clear all experiences
  await db.ref('experiences').remove();
  console.log('Cleared all experiences');

  // Create sp-26mId4 with keyframes
  const experience = {
    id: 'sp-26mId4',
    name: 'Spatial Thinking v1',
    campaignId: 'spatial-2024',
    keyframes: [
      { dialogue: 'Space changes how you think.', bg: '#000000', monogram: 'perlin' },
      { dialogue: 'Most tools flatten your ideas into lists. This doesn\'t.' },
      { dialogue: 'Here, your thoughts can breathe.' },
      { dialogue: 'Drop your email to begin.', input: 'email' },
      { dialogue: 'Choose a password.', input: 'password', bg: '#0a0a0a' },
      { dialogue: 'Pick a username.', input: 'username' },
      { handler: 'createAccount', dialogue: 'Creating your account...' },
      { dialogue: 'Welcome to Nara.', handler: 'redirect' }
    ],
    createdAt: new Date().toISOString()
  };

  await db.ref('experiences/sp-26mId4').set(experience);
  console.log('Created sp-26mId4 with keyframes');

  // Verify
  const snapshot = await db.ref('experiences').once('value');
  console.log('Current experiences:', Object.keys(snapshot.val() || {}));

  process.exit(0);
}

main().catch(console.error);
