-- Notion2Wordpress SQLite schema
-- Date: 2025-10-28
-- Note: Aligns with specs/001-notion2wp-sync/data-model.md (v1.0 updated)

PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

-- 1) sync_jobs: top-level job runs
CREATE TABLE IF NOT EXISTS sync_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL CHECK(job_type IN ('scheduled', 'manual')),
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  error_message TEXT,
  pages_processed INTEGER NOT NULL DEFAULT 0,
  pages_succeeded INTEGER NOT NULL DEFAULT 0,
  pages_failed INTEGER NOT NULL DEFAULT 0,
  last_sync_timestamp TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_status ON sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_started_at ON sync_jobs(started_at);

-- 2) sync_job_items: per-page attempts within a job
CREATE TABLE IF NOT EXISTS sync_job_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_job_id INTEGER NOT NULL,
  notion_page_id TEXT NOT NULL,
  wp_post_id INTEGER,
  status TEXT NOT NULL CHECK(status IN ('pending', 'success', 'failed')),
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sync_job_id) REFERENCES sync_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_job_id ON sync_job_items(sync_job_id);
CREATE INDEX IF NOT EXISTS idx_notion_page_id_item ON sync_job_items(notion_page_id);

-- 3) image_assets: images discovered during a sync attempt
CREATE TABLE IF NOT EXISTS image_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_job_item_id INTEGER NOT NULL,
  notion_page_id TEXT NOT NULL,
  notion_block_id TEXT NOT NULL,
  notion_url TEXT NOT NULL,
  wp_media_id INTEGER,
  wp_media_url TEXT,
  file_hash TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending', 'uploaded', 'failed')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sync_job_item_id) REFERENCES sync_job_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_job_item_id ON image_assets(sync_job_item_id);
CREATE INDEX IF NOT EXISTS idx_notion_block_id ON image_assets(notion_block_id);
CREATE INDEX IF NOT EXISTS idx_file_hash ON image_assets(file_hash);

-- 4) page_post_map: final mapping, created only after successful sync
CREATE TABLE IF NOT EXISTS page_post_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notion_page_id TEXT NOT NULL UNIQUE,
  wp_post_id INTEGER NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notion_page_id ON page_post_map(notion_page_id);
CREATE INDEX IF NOT EXISTS idx_wp_post_id ON page_post_map(wp_post_id);

COMMIT;