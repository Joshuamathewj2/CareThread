import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function setupDatabase(dbPath = ':memory:') {
  const db = new Database(dbPath);
  
  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Check if migrations table exists
  const hasMigrations = db.prepare(`
    SELECT count(*) as count FROM sqlite_master 
    WHERE type='table' AND name='schema_migrations'
  `).get() as { count: number };

  if (hasMigrations.count === 0) {
    db.prepare(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `).run();
  }

  const currentVersionResult = db.prepare(`SELECT MAX(version) as version FROM schema_migrations`).get() as { version: number | null };
  const currentVersion = currentVersionResult?.version ?? 0;

  if (currentVersion < 1) {
    const migrationSql = readFileSync(join(__dirname, 'migrations', '001_initial.sql'), 'utf-8');
    db.exec(migrationSql);
    db.prepare(`INSERT INTO schema_migrations (version, applied_at) VALUES (1, datetime('now'))`).run();
  }

  return db;
}

export const db = setupDatabase(process.env.DATABASE_PATH || ':memory:');
