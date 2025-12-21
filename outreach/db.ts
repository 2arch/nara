// outreach/db.ts
// SQLite database for managing outreach experiences locally
// Syncs to Firebase for production use

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(__dirname, 'experiences.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema();
  }
  return db;
}

function initSchema(): void {
  const db = getDb();

  // Experiences table
  db.exec(`
    CREATE TABLE IF NOT EXISTS experiences (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      opening_hook TEXT NOT NULL,
      opening_messages TEXT NOT NULL,  -- JSON array
      visual_preset TEXT NOT NULL,
      preset_canvas_id TEXT,
      campaign_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      synced_at TEXT,  -- When last synced to Firebase
      active INTEGER DEFAULT 1  -- Soft delete
    )
  `);

  // Campaigns table (for grouping experiences)
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      active INTEGER DEFAULT 1
    )
  `);

  // Analytics table (track which experiences are used)
  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experience_id TEXT NOT NULL,
      event_type TEXT NOT NULL,  -- 'view', 'signup', 'conversion'
      timestamp TEXT NOT NULL,
      metadata TEXT,  -- JSON for extra data
      FOREIGN KEY (experience_id) REFERENCES experiences(id)
    )
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_experiences_campaign ON experiences(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_experiences_hook ON experiences(opening_hook);
    CREATE INDEX IF NOT EXISTS idx_analytics_experience ON analytics(experience_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_timestamp ON analytics(timestamp);
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
