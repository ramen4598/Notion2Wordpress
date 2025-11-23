// Description: Database service using better-sqlite3
// for managing sync jobs, job items, image assets, and page-post mappings.

import DatabaseConstructor, { type Database as BetterSqliteDatabase } from 'better-sqlite3';
import { logger } from '../lib/logger.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { JobType, JobStatus, JobItemStatus, ImageAssetStatus } from '../enums/db.enums.js';
import { asError } from '../lib/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SCHEMA_PATH = path.resolve(__dirname, '../../config/schema.sql');
const DEFAULT_DATABASE_PATH = path.resolve(__dirname, '../../data/sync.db');

export interface SyncJob {
  id?: number;
  job_type: JobType;
  status: JobStatus;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  pages_processed: number;
  pages_succeeded: number;
  pages_failed: number;
  last_sync_timestamp?: string;
}

export interface SyncJobItem {
  id?: number;
  sync_job_id: number;
  notion_page_id: string;
  wp_post_id?: number;
  status: JobItemStatus;
  error_message?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ImageAsset {
  id?: number;
  sync_job_item_id: number;
  notion_page_id: string;
  notion_block_id: string;
  notion_url: string;
  wp_media_id?: number;
  wp_media_url?: string;
  status: ImageAssetStatus;
  error_message?: string;
  created_at?: string;
}

export interface PagePostMap {
  id?: number;
  notion_page_id: string;
  wp_post_id: number;
  created_at?: string;
}

class DatabaseService {
  private db: BetterSqliteDatabase | null = null;

  async initialize(): Promise<void> {
    const dbPath = DEFAULT_DATABASE_PATH;
    const dbDir = path.dirname(dbPath);

    // Create data directory if it doesn't exist
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      logger.info(`Created database directory: ${dbDir}`);
    }

    try {
      this.db = new DatabaseConstructor(dbPath, {});
      logger.info(`Database connected: ${dbPath}`);
      await this.initSchema();
    } catch (error : unknown) {
      const err = asError(error);
      logger.error('Failed to open database', err);
      throw err;
    }
  }

  private async initSchema(): Promise<void> {
    const schemaPath = DEFAULT_SCHEMA_PATH;
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    try {
      // What happens if the existing schema exists? 
      // -> Since schema.sql includes IF NOT EXISTS, there is no problem
      this.db!.exec(schema); // ! means db must not be null here
      logger.info('Database schema initialized');
    } catch (error : unknown) {
      const err = asError(error);
      logger.error('Failed to initialize database schema', err);
      throw err;
    }
  }

  async close(): Promise<void> {
    if (!this.db) return;

    try {
      this.db!.close();
      logger.info('Database connection closed');
      this.db = null;
    } catch (error : unknown) {
      const err = asError(error);
      logger.error('Failed to close database', err);
      throw err;
    }
  }

  // Sync Jobs
  async createSyncJob(jobType: 'scheduled' | 'manual'): Promise<number> {
    const sql = `
      INSERT INTO sync_jobs (job_type, status, pages_processed, pages_succeeded, pages_failed)
      VALUES (?, ?, 0, 0, 0)
    `;

    const stmt = this.db!.prepare(sql);
    const info = stmt.run(jobType, JobStatus.Running);
    const id = Number(info.lastInsertRowid);
    logger.info(`Created sync job with ID: ${id}`);
    return id;
  }

  async updateSyncJob(
    id: number,
    updates: Partial<Omit<SyncJob, 'id' | 'started_at'>> // id and started_at are not updatable
  ): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.status) {
      fields.push('status = ?');
      values.push(updates.status);
      if (updates.status === JobStatus.Completed || updates.status === JobStatus.Failed) {
        fields.push("completed_at = datetime('now')");
      }
    }
    if (updates.error_message !== undefined) {
      fields.push('error_message = ?');
      values.push(updates.error_message);
    }
    if (updates.pages_processed !== undefined) {
      fields.push('pages_processed = ?');
      values.push(updates.pages_processed);
    }
    if (updates.pages_succeeded !== undefined) {
      fields.push('pages_succeeded = ?');
      values.push(updates.pages_succeeded);
    }
    if (updates.pages_failed !== undefined) {
      fields.push('pages_failed = ?');
      values.push(updates.pages_failed);
    }
    if (updates.last_sync_timestamp) {
      fields.push('last_sync_timestamp = ?');
      values.push(updates.last_sync_timestamp);
    }

    if (fields.length === 0) return;

    const sql = `UPDATE sync_jobs SET ${fields.join(', ')} WHERE id = ?`;
    values.push(id);

    const stmt = this.db!.prepare(sql);
    stmt.run(...values);
  }

  async getSyncJob(id: number): Promise<SyncJob | null> {
    const sql = 'SELECT * FROM sync_jobs WHERE id = ?';

    try {
      const row = this.db!.prepare(sql).get(id) as SyncJob | undefined;
      // Nullish Coalescing Operator
      // return if row is undefined and null, return right side value
      return row ?? null; 
    } catch (error : unknown) {
      const err = asError(error);
      logger.error(`Failed to get sync job ${id}`, err);
      throw err;
    }
  }

  // Get the last successful sync timestamp
  // Used for incremental syncs
  // Returns null if no successful sync found
  async getLastSyncTimestamp(): Promise<string | null> {
    const sql = `
      SELECT last_sync_timestamp
      FROM sync_jobs
      WHERE status = ? AND last_sync_timestamp IS NOT NULL
      ORDER BY completed_at DESC
      LIMIT 1
    `;

    try {
      const row = this.db!.prepare(sql).get(JobStatus.Completed) as { last_sync_timestamp: string } | undefined;
      const lastSyncTimestamp = row?.last_sync_timestamp ?? null;
      logger.info('Querying Notion pages', { lastSyncTimestamp });
      return lastSyncTimestamp;
    } catch (error: unknown) {
      const err = asError(error);
      logger.error('Failed to get last sync timestamp', err);
      throw err;
    }
  }

  // Sync Job Items
  async createSyncJobItem(
    item: Omit<SyncJobItem, 'id' | 'created_at' | 'updated_at'>
  ): Promise<number> {
    const sql = `
      INSERT INTO sync_job_items (sync_job_id, notion_page_id, wp_post_id, status)
      VALUES (?, ?, ?, ?)
    `;

    const stmt = this.db!.prepare(sql);
    const info = stmt.run(
      item.sync_job_id,
      item.notion_page_id,
      item.wp_post_id,
      item.status,
    );
    return Number(info.lastInsertRowid);
  }

  async updateSyncJobItem(
    id: number,
    updates: Partial<Omit<SyncJobItem, 'id' | 'created_at'>>
  ): Promise<void> {
    const fields: string[] = ["updated_at = datetime('now')"];
    const values: any[] = [];

    if (updates.wp_post_id !== undefined) {
      fields.push('wp_post_id = ?');
      values.push(updates.wp_post_id);
    }
    if (updates.status) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.error_message !== undefined) {
      fields.push('error_message = ?');
      values.push(updates.error_message);
    }

    const sql = `UPDATE sync_job_items SET ${fields.join(', ')} WHERE id = ?`;
    values.push(id);

    const stmt = this.db!.prepare(sql);
    stmt.run(...values);
  }

  // Image Assets
  async createImageAsset(asset: Omit<ImageAsset, 'id' | 'created_at'>): Promise<number> {
    const sql = `
      INSERT INTO image_assets (
        sync_job_item_id, notion_page_id, notion_block_id, notion_url,
        wp_media_id, wp_media_url, status, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const stmt = this.db!.prepare(sql);
    const info = stmt.run(
      asset.sync_job_item_id,
      asset.notion_page_id,
      asset.notion_block_id,
      asset.notion_url,
      asset.wp_media_id,
      asset.wp_media_url,
      asset.status,
      asset.error_message
    );
    return Number(info.lastInsertRowid);
  }

  async updateImageAsset(
    id: number,
    updates: Partial<Omit<ImageAsset, 'id' | 'created_at'>>
  ): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.wp_media_id !== undefined) {
      fields.push('wp_media_id = ?');
      values.push(updates.wp_media_id);
    }
    if (updates.wp_media_url) {
      fields.push('wp_media_url = ?');
      values.push(updates.wp_media_url);
    }
    if (updates.status) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.error_message !== undefined) {
      fields.push('error_message = ?');
      values.push(updates.error_message);
    }

    if (fields.length === 0) return;

    const sql = `UPDATE image_assets SET ${fields.join(', ')} WHERE id = ?`;
    values.push(id);

    const stmt = this.db!.prepare(sql);
    stmt.run(...values);
  }

  async getImageAssetsByJobItem(syncJobItemId: number): Promise<ImageAsset[]> {
    const sql = 'SELECT * FROM image_assets WHERE sync_job_item_id = ?';

    try {
      const rows = this.db!.prepare(sql).all(syncJobItemId) as ImageAsset[];
      return rows;
    } catch (error: unknown) {
      const err = asError(error);
      logger.error(`Failed to get image assets for job item ${syncJobItemId}`, err);
      throw err;
    }
  }

  // Page Post Map
  async createPagePostMap(map: Omit<PagePostMap, 'id' | 'created_at'>): Promise<number> {
    const sql = `
      INSERT INTO page_post_map (notion_page_id, wp_post_id)
      VALUES (?, ?)
    `;

    const stmt = this.db!.prepare(sql);
    const info = stmt.run(map.notion_page_id, map.wp_post_id);
    const id = Number(info.lastInsertRowid);
    logger.info(`Created page-post mapping: ${map.notion_page_id} -> ${map.wp_post_id}`);
    return id;
  }

  async getPagePostMap(notionPageId: string): Promise<PagePostMap | null> {
    const sql = 'SELECT * FROM page_post_map WHERE notion_page_id = ?';

    try {
      const row = this.db!.prepare(sql).get(notionPageId) as PagePostMap | undefined;
      return row ?? null;
    } catch (error: unknown) {
      const err = asError(error);
      logger.error(`Failed to get page-post mapping for ${notionPageId}`, err);
      throw err;
    }
  }
}

export const db = new DatabaseService();
