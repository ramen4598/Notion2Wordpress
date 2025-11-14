// Description: Orchestrates the synchronization process between Notion, ContentConverter and WordPress.

import { db } from '../db/index.js';
import { notionService, NotionPage, ImageReference } from '../services/notionService.js';
import { wpService } from '../services/wpService.js';
import { telegramService } from '../services/telegramService.js';
import { imageDownloader } from '../lib/imageDownloader.js';
import { logger } from '../lib/logger.js';
import { JobType, JobStatus, JobItemStatus, ImageAssetStatus } from '../enums/db.enums.js';
import { NotionPageStatus as NPStatus } from '../enums/notion.enums.js';
import { WpPostStatus } from '../enums/wp.enums.js';
import { config } from '../config/index.js';
import { asError } from '../lib/utils.js';

type SyncError = {
  notionPageId: string;
  pageTitle: string;
  errorMessage: string;
};

/**
 * Sync job representing the overall synchronization process.
 * Tracks any errors encountered during sync of multiple pages.
 */
export type SyncJob = {
  jobId: number;
  jobType: JobType;
  status: JobStatus;
  pagesProcessed: number;
  pagesSucceeded: number;
  pagesFailed: number;
  errors: SyncError[]; // Errors for individual page sync failures
}

/**
 * Sync job item representing the sync status of a single Notion page.
 * Tracks the associated WordPress post ID and uploaded media IDs for rollback if needed.
 */
type SyncJobItem = {
  id: number;
  pageId: string;
  wpPostId: number | undefined;
  uploadedMediaIds: number[];
}

export type ExecuteSyncJobResponse = SyncJob & {
  status: Exclude<JobStatus, JobStatus.Running>; // No longer running
};

class SyncOrchestrator {
  // executeSyncJob -> syncPages -> syncPage -> syncImages -> syncImage
  // if failure in syncPage -> rollback

  /**
   * Executes a synchronization job between Notion and WordPress.
   * Main entry point to execute a sync job
   * @param jobType - The type of sync job to execute.
   * @returns A promise that resolves to the result of the sync job execution.
   * @throws An error if the sync job fails, not individual page sync failures.
   */
  async executeSyncJob(jobType: JobType): Promise<ExecuteSyncJobResponse> {
    logger.info(`Starting sync job: ${jobType}`);

    const syncJob: SyncJob = await this.createSyncJob(jobType);

    try {
      // Query Notion for pages to sync
      const lastSyncTimestamp = await db.getLastSyncTimestamp();
      const pages = await notionService.queryPages({
        lastSyncTimestamp: lastSyncTimestamp || undefined,
        statusFilter: NPStatus.Adding,
      });

      // Sync pages
      await this.syncPages(syncJob, pages);

      syncJob.status = syncJob.pagesFailed === 0 ? JobStatus.Completed : JobStatus.Failed;

      await db.updateSyncJob(syncJob.jobId, {
        status: syncJob.status,
        last_sync_timestamp: new Date().toISOString(),
      });

      await this.sendTelegramNotification(syncJob);

      logger.info(`Sync job ${syncJob.jobId} completed`, {
        pagesProcessed: syncJob.pagesProcessed,
        pagesSucceeded: syncJob.pagesSucceeded,
        pagesFailed: syncJob.pagesFailed,
      });

      return syncJob as ExecuteSyncJobResponse;
    } catch (error: unknown) {
      // Handle sync job failure, not individual sync job item failures.
      const err = asError(error);
      syncJob.status = JobStatus.Failed;
      syncJob.errors = [{
        notionPageId: 'N/A',
        pageTitle: 'Fatal Error',
        errorMessage: err.message,
      }];

      await db.updateSyncJob(syncJob.jobId, {
        status: syncJob.status,
        error_message: err.message,
      });

      await this.sendTelegramNotification(syncJob);

      logger.error(`Sync job ${syncJob.jobId} failed with fatal error`, err);
      throw err;
    }
  }

  /**
   * Syncs a list of Notion pages.
   * Handle individual page sync failures without aborting the entire job
   * @param syncJob - The sync job context.
   * @param pages - The list of Notion pages to sync. 
   * @returns A promise that resolves when all pages have been processed.
   */
  private async syncPages(syncJob: SyncJob, pages: NotionPage[]): Promise<void> {

    logger.info(`Found ${pages.length} pages to sync`);

    for (const page of pages) {
      syncJob.pagesProcessed++;
      logger.info(`Processing page ${syncJob.pagesProcessed}/${pages.length}: ${page.title}`, {
        pageId: page.id,
      });

      try {
        await this.syncPage(syncJob.jobId, page);
        syncJob.pagesSucceeded++;
        logger.info(`Successfully synced page: ${page.title}`);
      } catch (error: unknown) {
        const err = asError(error);
        syncJob.pagesFailed++;
        const syncError: SyncError = {
          notionPageId: page.id,
          pageTitle: page.title,
          errorMessage: err.message,
        };
        syncJob.errors.push(syncError);
      }

      // Update job progress
      await db.updateSyncJob(syncJob.jobId, {
        pages_processed: syncJob.pagesProcessed,
        pages_succeeded: syncJob.pagesSucceeded,
        pages_failed: syncJob.pagesFailed,
      });
    }
  }

  /**
   * Syncs a single Notion page to WordPress.
   * On failure, rollback any created WP posts and uploaded images
   * @param jobId - The ID of the sync job.
   * @param page - The Notion page to sync.
   * @returns A promise that resolves when the page has been synced.
   * @throws An error if the sync fails.
   */
  private async syncPage(jobId: number, page: NotionPage): Promise<void> {
    const syncJobItem : SyncJobItem = await this.createSyncJobItem(jobId, page.id);
    try {

      // Convert Notion page to HTML, Extract images, Replace image URLs with placeholders
      const {html, images} = await notionService.getPageHTML(page.id);

      const imageMap = new Map<string, string>();

      await this.syncImages(syncJobItem, imageMap, images);

      // Replace image URLs in HTML
      const finalHtml = await wpService.replaceImageUrls(html, imageMap);

      // Create WordPress draft post
      const post = await wpService.createDraftPost({
        title: page.title,
        content: finalHtml,
        status: WpPostStatus.DRAFT,
      });

      syncJobItem.wpPostId = post.id;

      // Update job item with post ID
      await db.updateSyncJobItem(syncJobItem.id, {
        wp_post_id: post.id,
      });

      // Create page-post mapping
      await db.createPagePostMap({
        notion_page_id: page.id,
        wp_post_id: post.id,
      });

      // Update Notion page status to done
      await notionService.updatePageStatus(page.id, NPStatus.Done);

      // Mark job item as success
      await db.updateSyncJobItem(syncJobItem.id, {
        status: JobItemStatus.Success,
      });

      logger.info(`Successfully created WordPress post ${post.id} for page ${page.id}`);
    } catch (error: unknown) {
      const err = asError(error);
      logger.error(`Sync failed for page ${page.id}, rolling back`, err);

      try {
        this.rollback(syncJobItem, err.message);
      } catch (rollbackError: unknown) {
        logger.error(`Rollback failed for page ${page.id}`, asError(rollbackError));
      }

      throw err;
    }
  }

  /**
   * Syncs multiple images for a Notion page.
   * Processes images in batches to limit concurrency.
   * @param syncJobItem - The sync job item context.
   * @param imageMap - A map to store Notion URL to WordPress URL mappings.
   * @param images - The list of images to sync.
   * @returns A promise that resolves when all images have been processed.
   * @throws An aggregate error. Collect errors from individual image sync failures.
   */
  private async syncImages(syncJobItem: SyncJobItem, imageMap: Map<string, string>, images: ImageReference[]): Promise<void> {
    const results: PromiseSettledResult<void>[] = [];    
    const maxConcurrent = config.maxConcurrentImageDownloads;
    const errors : Error[] = [];

    // Process images in batches
    for(let i = 0; i < images.length; i += maxConcurrent) {
      logger.info(`Syncing images ${i + 1} to ${Math.min(i + maxConcurrent, images.length)} of ${images.length}`);
      const batch = images.slice(i, i + maxConcurrent);
      const promises = batch.map((image) => this.syncImage(syncJobItem, imageMap, image));
      const batchResults = await Promise.allSettled(promises);
      results.push(...batchResults);
    }

    // Collect errors
    for (const result of results) {
      if (result.status === 'rejected') {
        errors.push(new Error(result.reason));
      }
    }

    // If any errors, throw aggregate error
    if (errors.length > 0) {
      const message = errors.map(e => e.message).join('; ')
      throw new Error(`Failed to sync ${errors.length} images : ${message}`);
    }
  }

  /**
   * Syncs a single image from Notion to WordPress.
   * @param syncJobItem - The sync job item context.
   * @param imageMap - A map to store placeholder and WordPress URL mappings.
   * @param image - The image reference to sync.
   * @returns A promise that resolves when the image has been synced.
   * @throws An error if the image sync fails.
   */
  private async syncImage(syncJobItem: SyncJobItem, imageMap: Map<string, string>, image: ImageReference): Promise<void> {
    const assetId = await db.createImageAsset({
      sync_job_item_id: syncJobItem.id,
      notion_page_id: syncJobItem.pageId,
      notion_block_id: image.blockId,
      notion_url: image.url,
      status: ImageAssetStatus.Pending,
    });

    try {
      // Download image
      const { filename: ogfname, buffer, hash, contentType } = await imageDownloader.download({
        url: image.url,
      });

      const extension = this.getExtensionFromContentType(contentType);
      const filename = `${ogfname}-${hash.substring(0, 16)}.${extension}`;

      // Upload to WordPress
      const media = await wpService.uploadMedia({
        buffer,
        filename,
        contentType,
        altText: image.altText,
      });

      syncJobItem.uploadedMediaIds.push(media.id);

      // Update image asset record
      await db.updateImageAsset(assetId, {
        wp_media_id: media.id,
        wp_media_url: media.url,
        status: ImageAssetStatus.Uploaded,
      });

      // Map Notion URL to WordPress URL
      imageMap.set(image.placeholder, media.url);

      logger.debug(`syncImage - Uploaded image: ${filename} -> ${media.url}`);
    } catch (error: unknown) {
      const err = asError(error);

      // Update image asset record
      await db.updateImageAsset(assetId, {
        status: ImageAssetStatus.Failed,
        error_message: err.message,
      });

      logger.warn(`Failed to upload image from block ${image.blockId}`, err);
      throw new Error(`Failed to upload image from block ${image.blockId}`, err);
    }
  }

  /**
   * Rolls back changes made during a failed page sync.
   * Deletes any created WordPress posts and uploaded media.
   * Updates Notion page status to error.
   * Marks the sync job item as failed.
   * @param syncJobItem - The sync job item context.
   * @param errorMessage - The error message to record.
   */
  private rollback( syncJobItem: SyncJobItem, errorMessage: string ): void {
    // Fire-and-forget. if edit code, this can cause race conditions. Be careful.
    const { id: jobItemId, pageId: notionPageId, wpPostId, uploadedMediaIds } = syncJobItem;
    logger.warn(`Rolling back sync for page ${notionPageId}`);

    // Delete uploaded media
    for (const mediaId of uploadedMediaIds) {
      wpService.deleteMedia(mediaId).catch((error: unknown) => {
        logger.warn(`Failed to delete media ${mediaId} during rollback`, asError(error));
      });
    }

    // Delete WordPress post if created
    if (wpPostId) {
      wpService.deletePost(wpPostId).catch((error: unknown) => {
        logger.warn(`Failed to delete post ${wpPostId} during rollback`, asError(error));
      });
    }

    // Update Notion page status to error
    notionService.updatePageStatus(notionPageId, NPStatus.Error).catch((error: unknown) => {
      logger.warn(`Failed to update Notion page ${notionPageId} status`, asError(error));
    });

    // Mark job item as failed
    if (jobItemId) {
      db.updateSyncJobItem(jobItemId, {
        status: JobItemStatus.Failed,
        error_message: errorMessage,
      }).catch((error: unknown) => {
        logger.warn(`Failed to update job item ${jobItemId} status`, asError(error));
      });
    }
  }

  /**
   * Creates a new sync job record in the database.
   * @param jobType - The type of sync job.
   * @returns A promise that resolves to the created sync job.
   * @throws An error if the sync job creation fails.
   */
  private async createSyncJob(jobType: JobType): Promise<SyncJob> {
    try {
      return {
        jobId: await db.createSyncJob(jobType),
        jobType: jobType,
        status: JobStatus.Running,
        pagesProcessed: 0,
        pagesSucceeded: 0,
        pagesFailed: 0,
        errors: [],
      };
    } catch (error: unknown) {
      const err = asError(error);
      logger.error('Failed to create sync job', err);
      throw err;
    }
  }

  /**
   * Creates a sync job item for a Notion page.
   * @param jobId - The ID of the sync job.
   * @param pageId - The ID of the Notion page.
   * @returns A promise that resolves to the created sync job item.
   * @throws An error if the sync job item creation fails.
   */
  private async createSyncJobItem(jobId: number, pageId: string) : Promise<SyncJobItem> {
    try{
      const jobItemId = await db.createSyncJobItem({
        sync_job_id: jobId,
        notion_page_id: pageId,
        status: JobItemStatus.Pending,
      });

      return {
        id: jobItemId,
        pageId: pageId,
        wpPostId: undefined,
        uploadedMediaIds: [],
      };
    } catch (error: unknown) {
      const err = asError(error);
      logger.error('Failed to create sync job item', err);
      throw err;
    }
  }

  /**
   * Gets the file extension for a given content type.
   * Defaults to 'jpg' if the content type is unknown.
   * @param contentType - The MIME content type.
   * @returns The corresponding file extension.
   * @example 'image/png' -> 'png'
   */
  private getExtensionFromContentType(contentType: string): string {
    const extensions: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
    };

    return extensions[contentType] || 'jpg';
  }

  /**
   * Sends a Telegram notification about the sync job status.
   * @param syncJob - The sync job context.
   * @returns A promise that resolves when the notification has been sent.
   * @throws Nothing. Errors are logged but not thrown.
   */
  private async sendTelegramNotification(syncJob: SyncJob): Promise<void> {
    await telegramService.sendSyncNotification({
      jobId: syncJob.jobId,
      jobType: syncJob.jobType,
      status: syncJob.status,
      pagesProcessed: syncJob.pagesProcessed,
      pagesSucceeded: syncJob.pagesSucceeded,
      pagesFailed: syncJob.pagesFailed,
      errors: syncJob.errors,
    });
  }
}

export const syncOrchestrator = new SyncOrchestrator();
