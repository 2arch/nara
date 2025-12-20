// outreach/push-monogram-experience.ts
// Push a monogram showcase experience to Firebase

import * as admin from 'firebase-admin';
import * as path from 'path';

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, '../functions/service-account-key.json');

try {
  const serviceAccount = require(serviceAccountPath);
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: 'https://nara-a65bc-default-rtdb.firebaseio.com'
    });
  }
} catch (e) {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: 'https://nara-a65bc-default-rtdb.firebaseio.com'
    });
  }
}

const database = admin.database();

// ============================================================================
// MONOGRAM SHOWCASE EXPERIENCE
// Demonstrates all monogram modes and parameters
// ============================================================================

const monogramExperience = {
  id: 'monogram-showcase',
  name: 'Monogram Showcase',
  campaignId: 'test',
  createdAt: new Date().toISOString(),
  keyframes: [
    // ============================================
    // INTRO
    // ============================================
    {
      id: 'intro',
      dialogue: 'Welcome to the Monogram Showcase',
      bg: '#000000',
      monogram: 'perlin',
      monogramSpeed: 0.3,
      monogramComplexity: 1.0,
      backgroundMode: 'color'
    },
    {
      id: 'intro_explain',
      dialogue: 'This experience will cycle through all monogram modes and demonstrate their parameters.',
      previousKeyframeId: 'intro'
    },

    // ============================================
    // PERLIN MODE
    // ============================================
    {
      id: 'perlin_intro',
      dialogue: 'PERLIN MODE - Flowing noise patterns',
      bg: '#1a1a2e',
      monogram: 'perlin',
      monogramSpeed: 0.5,
      monogramComplexity: 1.0,
      previousKeyframeId: 'intro_explain'
    },
    {
      id: 'perlin_slow',
      dialogue: 'Slow speed (0.2) - meditative, calm flow',
      monogram: 'perlin',
      monogramSpeed: 0.2,
      monogramComplexity: 1.0,
      previousKeyframeId: 'perlin_intro'
    },
    {
      id: 'perlin_fast',
      dialogue: 'Fast speed (1.5) - energetic, dynamic',
      monogramSpeed: 1.5,
      previousKeyframeId: 'perlin_slow'
    },
    {
      id: 'perlin_low_complexity',
      dialogue: 'Low complexity (0.3) - larger, smoother patterns',
      monogramSpeed: 0.5,
      monogramComplexity: 0.3,
      previousKeyframeId: 'perlin_fast'
    },
    {
      id: 'perlin_high_complexity',
      dialogue: 'High complexity (2.5) - detailed, intricate patterns',
      monogramComplexity: 2.5,
      previousKeyframeId: 'perlin_low_complexity'
    },

    // ============================================
    // NARA MODE
    // ============================================
    {
      id: 'nara_intro',
      dialogue: 'NARA MODE - Distorted text logo',
      bg: '#000000',
      monogram: 'nara',
      monogramSpeed: 0.5,
      monogramComplexity: 1.0,
      previousKeyframeId: 'perlin_high_complexity'
    },
    {
      id: 'nara_explain',
      dialogue: 'The NARA logo morphs and flows with Perlin-based distortion.',
      previousKeyframeId: 'nara_intro'
    },
    {
      id: 'nara_slow',
      dialogue: 'Slow morphing (0.2) - subtle, gentle distortion',
      monogramSpeed: 0.2,
      monogramComplexity: 0.8,
      previousKeyframeId: 'nara_explain'
    },
    {
      id: 'nara_fast',
      dialogue: 'Fast morphing (1.2) - dynamic, liquid-like',
      monogramSpeed: 1.2,
      monogramComplexity: 1.5,
      previousKeyframeId: 'nara_slow'
    },

    // ============================================
    // VORONOI MODE
    // ============================================
    {
      id: 'voronoi_intro',
      dialogue: 'VORONOI MODE - Cellular patterns',
      bg: '#0a0a1a',
      monogram: 'voronoi',
      monogramSpeed: 0.0,
      monogramComplexity: 1.0,
      previousKeyframeId: 'nara_fast'
    },
    {
      id: 'voronoi_explain',
      dialogue: 'Static cellular structure based on Voronoi diagrams. Try moving your cursor!',
      previousKeyframeId: 'voronoi_intro'
    },
    {
      id: 'voronoi_small_cells',
      dialogue: 'High complexity (2.0) - smaller, denser cells',
      monogramComplexity: 2.0,
      previousKeyframeId: 'voronoi_explain'
    },
    {
      id: 'voronoi_large_cells',
      dialogue: 'Low complexity (0.5) - larger, more spacious cells',
      monogramComplexity: 0.5,
      previousKeyframeId: 'voronoi_small_cells'
    },

    // ============================================
    // FACE3D MODE (if available)
    // ============================================
    {
      id: 'face3d_intro',
      dialogue: 'FACE3D MODE - 3D projected geometry',
      bg: '#1a0a1a',
      monogram: 'face3d',
      monogramSpeed: 0.3,
      monogramComplexity: 1.0,
      previousKeyframeId: 'voronoi_large_cells'
    },
    {
      id: 'face3d_explain',
      dialogue: 'This mode renders 3D face geometry. Connect a webcam with face tracking for interactive control!',
      previousKeyframeId: 'face3d_intro'
    },
    {
      id: 'face3d_large',
      dialogue: 'Large scale (complexity 1.5)',
      monogramComplexity: 1.5,
      previousKeyframeId: 'face3d_explain'
    },
    {
      id: 'face3d_small',
      dialogue: 'Small scale (complexity 0.7)',
      monogramComplexity: 0.7,
      previousKeyframeId: 'face3d_large'
    },

    // ============================================
    // CLEAR MODE
    // ============================================
    {
      id: 'clear_intro',
      dialogue: 'CLEAR MODE - No background pattern',
      bg: '#F0FF6A',
      monogram: 'clear',
      monogramSpeed: 0.0,
      monogramComplexity: 1.0,
      previousKeyframeId: 'face3d_small'
    },
    {
      id: 'clear_explain',
      dialogue: 'Clear mode shows only the background color. Good for focused content.',
      previousKeyframeId: 'clear_intro'
    },

    // ============================================
    // COLOR COMBINATIONS
    // ============================================
    {
      id: 'combo_sulfur_perlin',
      dialogue: 'Sulfur yellow + Perlin = energetic, vibrant',
      bg: '#F0FF6A',
      monogram: 'perlin',
      monogramSpeed: 0.6,
      monogramComplexity: 1.2,
      previousKeyframeId: 'clear_explain'
    },
    {
      id: 'combo_chalk_nara',
      dialogue: 'Chalk blue + NARA = calm, focused',
      bg: '#69AED6',
      monogram: 'nara',
      monogramSpeed: 0.4,
      monogramComplexity: 0.9,
      previousKeyframeId: 'combo_sulfur_perlin'
    },
    {
      id: 'combo_dark_voronoi',
      dialogue: 'Deep purple + Voronoi = mysterious, structured',
      bg: '#1a0a2e',
      monogram: 'voronoi',
      monogramSpeed: 0.0,
      monogramComplexity: 1.5,
      previousKeyframeId: 'combo_chalk_nara'
    },

    // ============================================
    // OUTRO
    // ============================================
    {
      id: 'outro',
      dialogue: 'That concludes the Monogram Showcase!',
      bg: '#000000',
      monogram: 'perlin',
      monogramSpeed: 0.3,
      monogramComplexity: 1.0,
      previousKeyframeId: 'combo_dark_voronoi'
    },
    {
      id: 'outro_tip',
      dialogue: 'Use these modes and parameters to create unique visual experiences.',
      previousKeyframeId: 'outro'
    },
    {
      id: 'dismiss',
      dialogue: '',
      handler: 'dismiss',
      previousKeyframeId: 'outro_tip'
    }
  ]
};

// ============================================================================
// PUSH TO FIREBASE
// ============================================================================

async function pushExperience() {
  const experienceId = monogramExperience.id;

  console.log(`\nPushing experience: ${experienceId}`);
  console.log(`  Name: ${monogramExperience.name}`);
  console.log(`  Keyframes: ${monogramExperience.keyframes.length}`);

  try {
    await database.ref(`experiences/${experienceId}`).set(monogramExperience);
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
