// outreach/index.ts
// Main entry point for the outreach experience system
// Usage: npx ts-node outreach/index.ts [command]

export { getDb, closeDb } from './db';
export {
  type Experience,
  type OpeningHook,
  type CreateExperienceInput,
  DEFAULT_OPENING_MESSAGES,
  generateExperienceId,
  createExperience,
  getExperience,
  getAllExperiences,
  getExperiencesByCampaign,
  getExperiencesByHook,
  updateExperience,
  deleteExperience,
  markSynced,
  getUnsyncedExperiences,
  getExperienceUrl,
  printExperienceUrls
} from './experiences';

export { syncToFirebase, syncExperience } from './sync';

// ============================================================================
// CLI INTERFACE
// ============================================================================

import {
  createExperience,
  getAllExperiences,
  getExperience,
  deleteExperience,
  printExperienceUrls,
  getUnsyncedExperiences,
  type OpeningHook
} from './experiences';
import { syncToFirebase } from './sync';
import { closeDb } from './db';

const commands: Record<string, () => void> = {
  'list': () => {
    const experiences = getAllExperiences();
    console.log(`\nFound ${experiences.length} experiences:\n`);
    for (const exp of experiences) {
      console.log(`  ${exp.id} - ${exp.name} (${exp.openingHook})`);
    }
    console.log('');
  },

  'urls': () => {
    printExperienceUrls();
  },

  'create-samples': () => {
    console.log('\nCreating sample experiences...\n');

    const samples: Array<{ name: string; hook: OpeningHook; visual: string }> = [
      { name: 'Spatial Thinking v1', hook: 'spatial-thinking', visual: 'minimal-black' },
      { name: 'Creative Tool v1', hook: 'creative-tool', visual: 'sulfur' },
      { name: 'Writing Evolution v1', hook: 'writing-evolution', visual: 'chalk' },
      { name: 'Productivity Escape v1', hook: 'productivity-escape', visual: 'no-monogram' },
    ];

    for (const sample of samples) {
      const exp = createExperience({
        name: sample.name,
        openingHook: sample.hook,
        visualPreset: sample.visual,
        campaignId: 'initial-2024'
      });
      console.log(`  Created: ${exp.id} - ${exp.name}`);
    }
    console.log('\nDone!\n');
  },

  'sync': async () => {
    console.log('\nSyncing to Firebase...\n');
    const unsynced = getUnsyncedExperiences();
    console.log(`Found ${unsynced.length} experiences to sync.`);

    if (unsynced.length > 0) {
      await syncToFirebase();
      console.log('\nSync complete!\n');
    } else {
      console.log('Nothing to sync.\n');
    }
  },

  'unsynced': () => {
    const unsynced = getUnsyncedExperiences();
    console.log(`\nUnsynced experiences: ${unsynced.length}\n`);
    for (const exp of unsynced) {
      console.log(`  ${exp.id} - ${exp.name} (updated: ${exp.updatedAt})`);
    }
    console.log('');
  },

  'help': () => {
    console.log(`
Outreach Experience Manager

Commands:
  list            List all experiences
  urls            Print all experience URLs
  create-samples  Create sample experiences for each hook type
  sync            Sync unsynced experiences to Firebase
  unsynced        List experiences that need syncing
  help            Show this help message

Examples:
  npx ts-node outreach/index.ts list
  npx ts-node outreach/index.ts create-samples
  npx ts-node outreach/index.ts sync
`);
  }
};

// Run CLI if executed directly
if (require.main === module) {
  const command = process.argv[2] || 'help';

  if (commands[command]) {
    Promise.resolve(commands[command]()).finally(() => {
      closeDb();
    });
  } else {
    console.error(`Unknown command: ${command}`);
    commands['help']();
    closeDb();
    process.exit(1);
  }
}
