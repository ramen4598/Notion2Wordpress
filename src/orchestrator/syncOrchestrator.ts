// Description: Orchestrates the synchronization process between Notion, ContentConverter and WordPress.

import { db } from '../db/index.js';
import { notionService, NotionPage } from '../services/notionService.js';
import { wpService } from '../services/wpService.js';
import { telegramService } from '../services/telegramService.js';
import { imageDownloader } from '../lib/imageDownloader.js';
import { logger } from '../lib/logger.js';
import { JobType, JobStatus, JobItemStatus, ImageAssetStatus } from '../enums/db.enums.js';
import { NotionPageStatus as NPStatus } from '../enums/notion.enums.js';
import { WpPostStatus } from '../enums/wp.enums.js';

type SyncError = {
  notionPageId: string;
  pageTitle: string;
  errorMessage: string;
};

export type SyncJob = {
  jobId: number;
  jobType: JobType;
  status: JobStatus;
  pagesProcessed: number;
  pagesSucceeded: number;
  pagesFailed: number;
  errors: SyncError[];
}

export type ExecuteSyncJobResponse = SyncJob & {
  status: Exclude<JobStatus, JobStatus.Running>;
};

class SyncOrchestrator {

  // TODO: 메서드가 너무 큼. 더 작은 메서드로 분리 고려
  async executeSyncJob(jobType: JobType): Promise<ExecuteSyncJobResponse> {
    logger.info(`Starting sync job: ${jobType}`);

    const syncJob: SyncJob = await this.createSyncJob(jobType);

    try {
      // Get last sync timestamp for incremental scanning
      const lastSyncTimestamp = await db.getLastSyncTimestamp();
      logger.info('Querying Notion pages', { lastSyncTimestamp });

      // Get pages - Query Notion pages with status=adding
      const pages = await notionService.queryPages({
        lastSyncTimestamp: lastSyncTimestamp || undefined,
        statusFilter: NPStatus.Adding,
      });

      logger.info(`Found ${pages.length} pages to sync`);

      for (const page of pages) {
        syncJob.pagesProcessed++;
        logger.info(`Processing page ${syncJob.pagesProcessed}/${pages.length}: ${page.title}`, {
          pageId: page.id,
        });

        // Sync each page
        try {
          await this.syncPage(syncJob.jobId, page);
          syncJob.pagesSucceeded++;
          logger.info(`Successfully synced page: ${page.title}`);
        } catch (error: any) {
          syncJob.pagesFailed++;
          const syncError: SyncError = {
            notionPageId: page.id,
            pageTitle: page.title,
            errorMessage: error.message,
          };
          syncJob.errors.push(syncError);
          logger.error(`Failed to sync page: ${page.title}`, error);
        }

        // Update job progress
        await db.updateSyncJob(syncJob.jobId, {
          pages_processed: syncJob.pagesProcessed,
          pages_succeeded: syncJob.pagesSucceeded,
          pages_failed: syncJob.pagesFailed,
        });
      }

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
    } catch (error: any) { // TODO: error 타입 개선
      // Handle sync job failure, not individual sync job item failures.
      syncJob.status = JobStatus.Failed;
      syncJob.errors = [{
        notionPageId: 'N/A',
        pageTitle: 'Fatal Error',
        errorMessage: error.message,
      }];

      await db.updateSyncJob(syncJob.jobId, {
        status: syncJob.status,
        error_message: error.message,
      });

      await this.sendTelegramNotification(syncJob);

      logger.error(`Sync job ${syncJob.jobId} failed with fatal error`, error);
      throw error;
    }
  }

  // TODO: 메서드가 너무 큼. 더 작은 메서드로 분리 고려
  private async syncPage(jobId: number, page: NotionPage): Promise<void> {
    let jobItemId: number | undefined;
    let wpPostId: number | undefined;
    const uploadedMediaIds: number[] = [];

    try {
      // Create sync job item
      jobItemId = await db.createSyncJobItem({
        sync_job_id: jobId,
        notion_page_id: page.id,
        status: JobItemStatus.Pending,
        retry_count: 0, // TODO: retry_count 구현 필요
      });

      // Convert Notion page to HTML
      // Extract images, Replace image URLs with placeholders
      const {html, images} = await notionService.getPageHTML(page.id);

      logger.info(`Converted page to HTML with ${images.length} images`, {
        pageId: page.id,
      });

      // Download and upload images
      const imageMap = new Map<string, string>();

      for (const image of images) {
        try {
          // Create image asset record
          const assetId = await db.createImageAsset({
            sync_job_item_id: jobItemId,
            notion_page_id: page.id,
            notion_block_id: image.blockId,
            notion_url: image.url,
            status: ImageAssetStatus.Pending,
          });

          // Download image
          // TODO: downloadMultiple 사용하도록 수정
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

          uploadedMediaIds.push(media.id);

          // Update image asset record
          await db.updateImageAsset(assetId, {
            wp_media_id: media.id,
            wp_media_url: media.url,
            status: ImageAssetStatus.Uploaded,
          });

          // Map Notion URL to WordPress URL
          imageMap.set(image.placeholder, media.url);

          logger.info(`Uploaded image: ${filename} -> ${media.url}`);
        } catch (error: any) {
          logger.warn(`Failed to upload image from block ${image.blockId}`, error);
          // Continue with other images - don't fail the whole sync
          // TODO: 특정 이미지를 업로드하지 못한 경우 즉시 해당 페이지를 롤백하고 다음 페이지로 넘어감
        }
      }

      // Replace image URLs in HTML
      const finalHtml = await wpService.replaceImageUrls(html, imageMap);

      // Create WordPress draft post
      const post = await wpService.createDraftPost({
        title: page.title,
        content: finalHtml,
        status: WpPostStatus.DRAFT,
      });

      wpPostId = post.id;

      // Update job item with post ID
      await db.updateSyncJobItem(jobItemId, {
        wp_post_id: post.id,
      });

      // Create page-post mapping
      await db.createPagePostMap({
        notion_page_id: page.id,
        wp_post_id: post.id,
      });

      // Update Notion page status to complete
      await notionService.updatePageStatus(page.id, NPStatus.Complete);

      // Mark job item as success
      await db.updateSyncJobItem(jobItemId, {
        status: JobItemStatus.Success,
      });

      logger.info(`Successfully created WordPress post ${post.id} for page ${page.id}`);
    } catch (error: any) {
      // Rollback on failure
      logger.error(`Sync failed for page ${page.id}, rolling back`, error);

      try {
        await this.rollback(wpPostId, uploadedMediaIds, page.id, jobItemId, error.message);
      } catch (rollbackError: any) {
        logger.error(`Rollback failed for page ${page.id}`, rollbackError);
      }

      throw error;
    }
  }

  private async rollback(
    wpPostId: number | undefined,
    uploadedMediaIds: number[],
    notionPageId: string,
    jobItemId: number | undefined,
    errorMessage: string
  ): Promise<void> {
    logger.warn(`Rolling back sync for page ${notionPageId}`);

    // Delete uploaded media
    for (const mediaId of uploadedMediaIds) {
      try {
        await wpService.deleteMedia(mediaId);
        logger.info(`Rolled back media: ${mediaId}`);
      } catch (error: any) {
        logger.warn(`Failed to delete media ${mediaId} during rollback`, error);
      }
    }

    // Delete WordPress post if created
    if (wpPostId) {
      try {
        await wpService.deletePost(wpPostId);
        logger.info(`Rolled back post: ${wpPostId}`);
      } catch (error: any) {
        logger.warn(`Failed to delete post ${wpPostId} during rollback`, error);
      }
    }

    // Update Notion page status to error
    try {
      await notionService.updatePageStatus(notionPageId, NPStatus.Error);
      logger.info(`Updated Notion page ${notionPageId} status to error`);
    } catch (error: any) {
      logger.warn(`Failed to update Notion page ${notionPageId} status`, error);
    }

    // Mark job item as failed
    if (jobItemId) {
      try {
        await db.updateSyncJobItem(jobItemId, {
          status: JobItemStatus.Failed,
          error_message: errorMessage,
        });
      } catch (error: any) {
        logger.warn(`Failed to update job item ${jobItemId} status`, error);
      }
    }
  }

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
    } catch (error) {
      logger.error('Failed to create sync job', error);
      throw error;
    }
  }
}

export const syncOrchestrator = new SyncOrchestrator();
