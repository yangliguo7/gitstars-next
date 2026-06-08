CREATE TABLE github_sync_state (
  user_id TEXT PRIMARY KEY,
  baseline_complete INTEGER NOT NULL DEFAULT 0,
  baseline_next_page INTEGER NOT NULL DEFAULT 1,
  last_starred_at TEXT,
  last_repair_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

ALTER TABLE sync_jobs ADD COLUMN mode TEXT NOT NULL DEFAULT 'sync';
ALTER TABLE summaries ADD COLUMN short_content TEXT;
ALTER TABLE summaries ADD COLUMN detail_content TEXT;
