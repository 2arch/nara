// outreach/experiences.ts
// CRUD operations for experiences with nanoid generation

import { getDb } from './db';
import { nanoid } from 'nanoid';

// ============================================================================
// TYPES
// ============================================================================

export type OpeningHook =
  | 'default'
  | 'spatial-thinking'
  | 'creative-tool'
  | 'writing-evolution'
  | 'productivity-escape';

export interface Experience {
  id: string;
  name: string;
  openingHook: OpeningHook;
  openingMessages: string[];
  visualPreset: string;
  presetCanvasId?: string;
  campaignId?: string;
  createdAt: string;
  updatedAt: string;
  syncedAt?: string;
  active: boolean;
}

export interface CreateExperienceInput {
  name: string;
  openingHook: OpeningHook;
  openingMessages?: string[];  // Uses defaults if not provided
  visualPreset?: string;       // Defaults to 'image'
  presetCanvasId?: string;
  campaignId?: string;
}

// ============================================================================
// DEFAULT OPENING MESSAGES
// ============================================================================

export const DEFAULT_OPENING_MESSAGES: Record<OpeningHook, string[]> = {
  'default': [
    "Hey! Welcome to Nara.",
    "Nara is a new medium for spatial writing.",
    "Take a look around."
  ],
  'spatial-thinking': [
    "Space changes how you think.",
    "Most tools flatten your ideas into lists. This doesn't.",
    "Here, your thoughts can breathe."
  ],
  'creative-tool': [
    "You're here to make something.",
    "Nara is a canvas — no templates, no structure imposed.",
    "Just you and the space."
  ],
  'writing-evolution': [
    "Writing hasn't changed in 40 years.",
    "What if the page wasn't a page?",
    "Welcome to something different."
  ],
  'productivity-escape': [
    "You're tired of tools that optimize you.",
    "This is the opposite of that.",
    "No dashboards. No metrics. Just space to think."
  ]
};

// ============================================================================
// HOOK PREFIXES (for readable IDs)
// ============================================================================

const HOOK_PREFIXES: Record<OpeningHook, string> = {
  'default': 'df',
  'spatial-thinking': 'sp',
  'creative-tool': 'cr',
  'writing-evolution': 'wr',
  'productivity-escape': 'es'
};

// ============================================================================
// ID GENERATION
// ============================================================================

/**
 * Generate a unique experience ID
 * Format: [hook-prefix]-[nanoid(6)]
 * Example: sp-V1StGX
 */
export function generateExperienceId(hook: OpeningHook): string {
  const prefix = HOOK_PREFIXES[hook] || 'ex';
  const suffix = nanoid(6);
  return `${prefix}-${suffix}`;
}

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

/**
 * Create a new experience
 */
export function createExperience(input: CreateExperienceInput): Experience {
  const db = getDb();
  const now = new Date().toISOString();
  const id = generateExperienceId(input.openingHook);

  const experience: Experience = {
    id,
    name: input.name,
    openingHook: input.openingHook,
    openingMessages: input.openingMessages || DEFAULT_OPENING_MESSAGES[input.openingHook],
    visualPreset: input.visualPreset || 'image',
    presetCanvasId: input.presetCanvasId,
    campaignId: input.campaignId,
    createdAt: now,
    updatedAt: now,
    active: true
  };

  const stmt = db.prepare(`
    INSERT INTO experiences (
      id, name, opening_hook, opening_messages, visual_preset,
      preset_canvas_id, campaign_id, created_at, updated_at, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    experience.id,
    experience.name,
    experience.openingHook,
    JSON.stringify(experience.openingMessages),
    experience.visualPreset,
    experience.presetCanvasId || null,
    experience.campaignId || null,
    experience.createdAt,
    experience.updatedAt,
    1
  );

  return experience;
}

/**
 * Get an experience by ID
 */
export function getExperience(id: string): Experience | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM experiences WHERE id = ? AND active = 1');
  const row = stmt.get(id) as any;

  if (!row) return null;

  return rowToExperience(row);
}

/**
 * Get all experiences
 */
export function getAllExperiences(): Experience[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM experiences WHERE active = 1 ORDER BY created_at DESC');
  const rows = stmt.all() as any[];

  return rows.map(rowToExperience);
}

/**
 * Get experiences by campaign
 */
export function getExperiencesByCampaign(campaignId: string): Experience[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM experiences WHERE campaign_id = ? AND active = 1 ORDER BY created_at DESC');
  const rows = stmt.all(campaignId) as any[];

  return rows.map(rowToExperience);
}

/**
 * Get experiences by hook type
 */
export function getExperiencesByHook(hook: OpeningHook): Experience[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM experiences WHERE opening_hook = ? AND active = 1 ORDER BY created_at DESC');
  const rows = stmt.all(hook) as any[];

  return rows.map(rowToExperience);
}

/**
 * Update an experience
 */
export function updateExperience(id: string, updates: Partial<CreateExperienceInput>): Experience | null {
  const db = getDb();
  const existing = getExperience(id);

  if (!existing) return null;

  const updated: Experience = {
    ...existing,
    ...updates,
    openingMessages: updates.openingMessages || existing.openingMessages,
    updatedAt: new Date().toISOString()
  };

  const stmt = db.prepare(`
    UPDATE experiences SET
      name = ?, opening_hook = ?, opening_messages = ?, visual_preset = ?,
      preset_canvas_id = ?, campaign_id = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(
    updated.name,
    updated.openingHook,
    JSON.stringify(updated.openingMessages),
    updated.visualPreset,
    updated.presetCanvasId || null,
    updated.campaignId || null,
    updated.updatedAt,
    id
  );

  return updated;
}

/**
 * Soft delete an experience
 */
export function deleteExperience(id: string): boolean {
  const db = getDb();
  const stmt = db.prepare('UPDATE experiences SET active = 0, updated_at = ? WHERE id = ?');
  const result = stmt.run(new Date().toISOString(), id);
  return result.changes > 0;
}

/**
 * Mark an experience as synced to Firebase
 */
export function markSynced(id: string): void {
  const db = getDb();
  const stmt = db.prepare('UPDATE experiences SET synced_at = ? WHERE id = ?');
  stmt.run(new Date().toISOString(), id);
}

/**
 * Get experiences that need syncing (modified since last sync)
 */
export function getUnsyncedExperiences(): Experience[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM experiences
    WHERE active = 1 AND (synced_at IS NULL OR updated_at > synced_at)
    ORDER BY updated_at DESC
  `);
  const rows = stmt.all() as any[];

  return rows.map(rowToExperience);
}

// ============================================================================
// HELPERS
// ============================================================================

function rowToExperience(row: any): Experience {
  return {
    id: row.id,
    name: row.name,
    openingHook: row.opening_hook as OpeningHook,
    openingMessages: JSON.parse(row.opening_messages),
    visualPreset: row.visual_preset,
    presetCanvasId: row.preset_canvas_id || undefined,
    campaignId: row.campaign_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at || undefined,
    active: row.active === 1
  };
}

// ============================================================================
// URL GENERATION
// ============================================================================

/**
 * Generate a full URL for an experience
 */
export function getExperienceUrl(id: string, baseUrl: string = 'https://nara.ws'): string {
  return `${baseUrl}/?exp=${encodeURIComponent(id)}`;
}

/**
 * Print all experience URLs (for debugging/export)
 */
export function printExperienceUrls(baseUrl: string = 'https://nara.ws'): void {
  const experiences = getAllExperiences();

  console.log('\n=== Experience URLs ===\n');
  for (const exp of experiences) {
    console.log(`${exp.name} (${exp.id}):`);
    console.log(`  Hook: ${exp.openingHook}`);
    console.log(`  Visual: ${exp.visualPreset}`);
    console.log(`  URL: ${getExperienceUrl(exp.id, baseUrl)}`);
    console.log(`  Synced: ${exp.syncedAt || 'never'}`);
    console.log('');
  }
}
