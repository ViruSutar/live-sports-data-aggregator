-- Initial schema for Live Sports Match Data Aggregator
-- Creates all required tables with constraints and indexes

-- A. matches: stores internal match information
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- B. provider_match_mappings: maps external provider match IDs to internal match IDs
CREATE TABLE IF NOT EXISTS provider_match_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  provider_match_id TEXT NOT NULL,
  match_id TEXT NOT NULL REFERENCES matches(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, provider_match_id)
);

-- C. provider_score_snapshots: stores the latest accepted snapshot per provider
CREATE TABLE IF NOT EXISTS provider_score_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  match_id TEXT NOT NULL REFERENCES matches(id),
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  status TEXT NOT NULL,
  innings INTEGER NOT NULL CHECK (innings >= 0),
  runs INTEGER NOT NULL CHECK (runs >= 0),
  wickets INTEGER NOT NULL CHECK (wickets >= 0),
  overs TEXT NOT NULL,
  provider_timestamp TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, match_id)
);

-- D. provider_commentary: stores commentary independently for each provider
CREATE TABLE IF NOT EXISTS provider_commentary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  match_id TEXT NOT NULL REFERENCES matches(id),
  ball_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  innings INTEGER NOT NULL CHECK (innings >= 0),
  over INTEGER NOT NULL CHECK (over >= 0),
  ball INTEGER NOT NULL CHECK (ball >= 0),
  text TEXT NOT NULL,
  occurred_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, match_id, ball_id)
);

-- E. processed_deliveries: stores successfully processed Provider A webhook delivery IDs
CREATE TABLE IF NOT EXISTS processed_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, delivery_id)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_provider_match_mappings_match
  ON provider_match_mappings(match_id);

CREATE INDEX IF NOT EXISTS idx_provider_score_snapshots_provider_match
  ON provider_score_snapshots(provider, match_id);

CREATE INDEX IF NOT EXISTS idx_provider_commentary_sequence
  ON provider_commentary(provider, match_id, sequence ASC, ball_id ASC);

CREATE INDEX IF NOT EXISTS idx_processed_deliveries_lookup
  ON processed_deliveries(provider, delivery_id);
