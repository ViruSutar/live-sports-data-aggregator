import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { logger } from '../common/utils/logger.js';

export type DatabaseHandle = InstanceType<typeof Database>;

/**
 * Creates and configures a SQLite database connection.
 * Enables WAL mode, foreign keys, and busy timeout.
 * Runs migrations to ensure schema is up to date.
 */
export function createDatabase(dbPath: string): DatabaseHandle {
  const resolvedPath = dbPath === ':memory:' ? dbPath : resolve(dbPath);

  if (resolvedPath !== ':memory:') {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const db = new Database(resolvedPath);

  // Configure SQLite pragmas for reliability and performance
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Run migrations
  runMigrations(db);

  logger.info({ path: resolvedPath }, 'Database initialized');

  return db;
}

/**
 * Executes SQL migration files.
 * Uses CREATE IF NOT EXISTS so migrations are idempotent.
 */
function runMigrations(db: DatabaseHandle): void {
  // Use __dirname for CJS (tsc output) — tsx also provides __dirname
  const migrationsDir = join(__dirname, 'migrations');

  try {
    const migrationFile = join(migrationsDir, '001_initial_schema.sql');
    const sql = readFileSync(migrationFile, 'utf-8');
    db.exec(sql);
    logger.info('Database migrations applied successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to apply database migrations');
    throw error;
  }
}

/**
 * Seeds initial data (matches and provider mappings).
 * Uses INSERT OR IGNORE for idempotency — safe to call on every startup.
 */
export function seedDatabase(db: DatabaseHandle): void {
  const seed = db.transaction(() => {
    // Seed the match
    db.prepare(`
      INSERT OR IGNORE INTO matches (id, name)
      VALUES (?, ?)
    `).run('match-1001', 'India vs Australia — T20 World Cup 2026');

    // Seed provider match mappings
    db.prepare(`
      INSERT OR IGNORE INTO provider_match_mappings (provider, provider_match_id, match_id)
      VALUES (?, ?, ?)
    `).run('provider-a', 'a-match-1001', 'match-1001');

    db.prepare(`
      INSERT OR IGNORE INTO provider_match_mappings (provider, provider_match_id, match_id)
      VALUES (?, ?, ?)
    `).run('provider-b', 'b-match-1001', 'match-1001');
  });

  seed();
  logger.info('Database seeded successfully');
}
