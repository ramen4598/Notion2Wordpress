# Data Model: Notion to WordPress Sync

**Date**: 2025-10-27  
**Feature**: 001-notion2wp-sync  
**Version**: 1.0

## Overview

This document defines the core data entities, their relationships, validation rules, and state transitions for the Notion-WordPress synchronization system.

---

## Entity Diagram

```
┌─────────────────┐         ┌──────────────────┐
│   NotionPage    │────────▶│   SyncJob        │
│  (External)     │  1:N    │   (Internal)     │
└─────────────────┘         └──────────────────┘
        │                            │
        │ 1:1                        │ 1:N
        ▼                            ▼
┌─────────────────┐         ┌──────────────────┐
│  PagePostMap    │         │  SyncJobItem     │
│  (Internal)     │         │  (Internal)      │
└─────────────────┘         └──────────────────┘
        │
        │ 1:1
        ▼
┌─────────────────┐
│    WPPost       │
│  (External)     │
└─────────────────┘
        │
        │ 1:N
        ▼
┌─────────────────┐         ┌──────────────────┐
│   ImageAsset    │────────▶│  WPMedia         │
│  (Internal)     │  1:1    │  (External)      │
└─────────────────┘         └──────────────────┘
```

---

## Entities

### 1. NotionPage (External - Notion API)

Represents a page in the monitored Notion database.

**Source**: Notion API (`databases.query`, `pages.retrieve`, `blocks.children.list`)

**Fields**:
- `id` (string, UUID): Notion page ID (e.g., `"7f2a3b4c-5d6e-7f8g-9h0i-1j2k3l4m5n6o"`)
- `title` (string): Page title extracted from title property
- `status` (enum): Workflow status - one of:
  - `"writing"`: Draft in progress (ignored by sync)
  - `"adding"`: Ready for WordPress upload (triggers sync)
  - `"complete"`: Successfully synced
  - `"error"`: Sync failed
- `blocks` (Block[]): Array of Notion block objects (paragraphs, images, headings, etc.)
- `last_edited_time` (ISO 8601 string): Timestamp of last modification (e.g., `"2025-10-27T10:30:00.000Z"`)
- `created_time` (ISO 8601 string): Page creation timestamp
- `properties` (object): Additional Notion properties (future: categories, tags)

**Validation Rules**:
- `id`: Must be valid UUID format
- `status`: Must be one of allowed enum values
- `title`: Cannot be empty/null
- `blocks`: Must be valid array (can be empty)
- `last_edited_time`: Must be valid ISO 8601 timestamp

**State Transitions**:
```
[writing] ──user changes──▶ [adding]
                                │
                                │ sync succeeds
                                ▼
                            [complete]
                                ▲
                                │ retry succeeds
                                │
                            [error]
                                ▲
                                │ sync fails
                                │
                            [adding]
```

**Business Rules**:
- Only pages with `status="adding"` are eligible for sync
- System updates `status` to `"complete"` on successful sync
- System updates `status` to `"error"` on sync failure (after exhausting retries)
- User can manually change `status` from `"error"` back to `"adding"` to retry

---

### 2. WPPost (External - WordPress REST API)

Represents a WordPress post (draft state).

**Source**: WordPress REST API (`/wp/v2/posts`)

**Fields**:
- `id` (number): WordPress post ID (e.g., `42`)
- `title` (object): `{ rendered: string }` - Post title
- `content` (object): `{ rendered: string }` - Post HTML content
- `status` (string): Always `"draft"` for MVP
- `date` (ISO 8601 string): Post creation date (WordPress-assigned)
- `modified` (ISO 8601 string): Last modification date
- `author` (number): WordPress user ID who created post

**Validation Rules**:
- `title.rendered`: Cannot be empty
- `content.rendered`: Can be empty (WordPress allows)
- `status`: Must be `"draft"` for synced posts

**Business Rules**:
- All synced posts are created with `status="draft"`
- Admin manually publishes after review
- System does not modify posts after initial creation (MVP scope)

---

### 3. PagePostMap (Internal - SQLite Table)

Tracks the mapping between Notion pages and WordPress posts.

**Table**: `page_post_map`

**Schema**:
```sql
CREATE TABLE page_post_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notion_page_id TEXT NOT NULL UNIQUE,
  wp_post_id INTEGER NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT fk_sync_job FOREIGN KEY (notion_page_id) 
    REFERENCES sync_jobs(notion_page_id) ON DELETE CASCADE
);

CREATE INDEX idx_notion_page_id ON page_post_map(notion_page_id);
CREATE INDEX idx_wp_post_id ON page_post_map(wp_post_id);
```

**Fields**:
- `id`: Auto-increment primary key
- `notion_page_id`: Notion page UUID (unique)
- `wp_post_id`: WordPress post ID (unique)
- `created_at`: Timestamp when mapping was created
- `updated_at`: Timestamp of last update

**Validation Rules**:
- `notion_page_id`: Must be unique, not null
- `wp_post_id`: Must be unique, not null
- Both timestamps must be valid ISO 8601

**Business Rules**:
- One Notion page maps to exactly one WordPress post (1:1)
- Duplicate sync attempts (same `notion_page_id`) are prevented by unique constraint
- Used to prevent duplicate uploads (future enhancement for idempotency)

---

### 4. SyncJob (Internal - SQLite Table)

Represents a single sync operation (scheduled or manual).

**Table**: `sync_jobs`

**Schema**:
```sql
CREATE TABLE sync_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL CHECK(job_type IN ('scheduled', 'manual')),
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  error_message TEXT,
  pages_processed INTEGER DEFAULT 0,
  pages_succeeded INTEGER DEFAULT 0,
  pages_failed INTEGER DEFAULT 0,
  last_sync_timestamp TEXT
);

CREATE INDEX idx_job_status ON sync_jobs(status);
CREATE INDEX idx_started_at ON sync_jobs(started_at);
```

**Fields**:
- `id`: Auto-increment primary key
- `job_type`: `"scheduled"` (cron) or `"manual"` (CLI trigger)
- `status`: `"running"`, `"completed"`, or `"failed"`
- `started_at`: Job start timestamp
- `completed_at`: Job completion timestamp (null if running)
- `error_message`: Error summary if `status="failed"`
- `pages_processed`: Total pages evaluated
- `pages_succeeded`: Successfully synced pages
- `pages_failed`: Failed sync attempts
- `last_sync_timestamp`: Last edited time of most recent page processed (for incremental scan)

**Validation Rules**:
- `job_type`: Must be `"scheduled"` or `"manual"`
- `status`: Must be `"running"`, `"completed"`, or `"failed"`
- `pages_*`: Non-negative integers
- `last_sync_timestamp`: Valid ISO 8601 timestamp

**State Transitions**:
```
[running] ──all succeeded──▶ [completed]
          ──any failed──▶ [failed]
```

**Business Rules**:
- Each cron execution creates new SyncJob record
- `last_sync_timestamp` used to filter pages for incremental scanning
- Failed jobs trigger Telegram notification

---

### 5. SyncJobItem (Internal - SQLite Table)

Tracks individual page sync attempts within a SyncJob.

**Table**: `sync_job_items`

**Schema**:
```sql
CREATE TABLE sync_job_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_job_id INTEGER NOT NULL,
  notion_page_id TEXT NOT NULL,
  wp_post_id INTEGER,
  status TEXT NOT NULL CHECK(status IN ('pending', 'success', 'failed')),
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sync_job_id) REFERENCES sync_jobs(id) ON DELETE CASCADE
);

CREATE INDEX idx_sync_job_id ON sync_job_items(sync_job_id);
CREATE INDEX idx_notion_page_id_item ON sync_job_items(notion_page_id);
```

**Fields**:
- `id`: Auto-increment primary key
- `sync_job_id`: Foreign key to `sync_jobs`
- `notion_page_id`: Notion page UUID being synced
- `wp_post_id`: WordPress post ID (null if sync failed)
- `status`: `"pending"`, `"success"`, or `"failed"`
- `error_message`: Error details if `status="failed"`
- `retry_count`: Number of retry attempts (0-3)
- `created_at`: Item creation timestamp
- `updated_at`: Last update timestamp

**State Transitions**:
```
[pending] ──sync success──▶ [success]
          ──max retries──▶ [failed]
          ──retry──▶ [pending] (increment retry_count)
```

**Business Rules**:
- Max 3 retry attempts (`retry_count <= 3`)
- Exponential backoff: 1s, 2s, 4s delays between retries
- Failed items trigger rollback (delete WP post/media if created)

---

### 6. ImageAsset (Internal - SQLite Table)

Tracks images extracted from Notion pages and their WordPress media equivalents.

**Table**: `image_assets`

**Schema**:
```sql
CREATE TABLE image_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notion_page_id TEXT NOT NULL,
  notion_block_id TEXT NOT NULL,
  notion_url TEXT NOT NULL,
  wp_media_id INTEGER,
  wp_media_url TEXT,
  file_hash TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending', 'uploaded', 'failed')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (notion_page_id) REFERENCES page_post_map(notion_page_id) ON DELETE CASCADE
);

CREATE INDEX idx_notion_block_id ON image_assets(notion_block_id);
CREATE INDEX idx_file_hash ON image_assets(file_hash);
```

**Fields**:
- `id`: Auto-increment primary key
- `notion_page_id`: Parent Notion page UUID
- `notion_block_id`: Notion block ID (for image block)
- `notion_url`: Original Notion image URL (signed, temporary)
- `wp_media_id`: WordPress media library ID (null if upload failed)
- `wp_media_url`: Permanent WordPress media URL
- `file_hash`: SHA-256 hash of image content (for deduplication)
- `status`: `"pending"`, `"uploaded"`, or `"failed"`
- `error_message`: Error details if upload failed
- `created_at`: Timestamp

**Validation Rules**:
- `notion_url`: Must be valid URL
- `file_hash`: 64-character hex string (SHA-256)
- `wp_media_id`: Unique if not null

**Business Rules**:
- File hash used to prevent duplicate uploads (same image, different block)
- On rollback, delete WordPress media via REST API (`DELETE /wp/v2/media/{id}`)
- Notion image URLs expire after ~1 hour (download immediately)

---

### 7. WPMedia (External - WordPress REST API)

Represents uploaded media in WordPress media library.

**Source**: WordPress REST API (`/wp/v2/media`)

**Fields**:
- `id` (number): WordPress media ID
- `source_url` (string): Public URL of uploaded media
- `title` (object): `{ rendered: string }` - Media title
- `alt_text` (string): Alt text for accessibility
- `media_type` (string): `"image"` for MVP
- `mime_type` (string): e.g., `"image/jpeg"`, `"image/png"`

**Business Rules**:
- Created via `POST /wp/v2/media` with multipart/form-data
- Deleted on rollback via `DELETE /wp/v2/media/{id}`

---

## Relationships

1. **NotionPage → PagePostMap**: 1:1 (one page maps to one post)
2. **PagePostMap → WPPost**: 1:1 (one mapping points to one post)
3. **SyncJob → SyncJobItem**: 1:N (one job has many item attempts)
4. **NotionPage → ImageAsset**: 1:N (one page has many images)
5. **ImageAsset → WPMedia**: 1:1 (one asset maps to one media item)

---

## Validation Summary

| Entity | Key Constraints | Unique Fields |
|--------|----------------|---------------|
| NotionPage | UUID format, status enum | `id` |
| WPPost | Non-empty title | `id` |
| PagePostMap | Valid UUIDs/IDs | `notion_page_id`, `wp_post_id` |
| SyncJob | Status enum, non-negative counters | `id` |
| SyncJobItem | Status enum, retry_count ≤ 3 | `id` |
| ImageAsset | Valid URL, SHA-256 hash | `file_hash` (optional) |
| WPMedia | Valid MIME type | `id` |

---

## Future Extensions (Post-MVP)

1. **Idempotency**: Use `page_post_map` to detect duplicate sync requests
2. **Categories/Tags**: Map Notion properties to WordPress taxonomies
3. **Bidirectional Sync**: Track WordPress edits and update Notion
4. **Versioning**: Track revision history for posts
5. **Webhooks**: Replace polling with Notion/WordPress webhooks
