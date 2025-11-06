// Description: Orchestrates the synchronization process between Notion, ContentConverter and WordPress.

import { db } from '../db/index.js';
import { notionService, NotionPage } from '../services/notionService.js';
import { wpService } from '../services/wpService.js';
import { telegramService } from '../services/telegramService.js';
import { contentConverter } from '../lib/contentConverter.js';
import { imageDownloader } from '../lib/imageDownloader.js';
import { logger } from '../lib/logger.js';

export interface SyncError {
  notionPageId: string;
  pageTitle: string;
  errorMessage: string;
  retryCount: number;
}

export interface ExecuteSyncJobResponse {
  jobId: number;
  status: 'completed' | 'failed';
  pagesProcessed: number;
  pagesSucceeded: number;
  pagesFailed: number;
  errors: SyncError[];
}

// TODO: 전체적으로 리팩토링 필요. 가독성 및 유지보수성 향상
class SyncOrchestrator {
  // TODO: 메서드가 너무 큼. 더 작은 메서드로 분리 고려
  async executeSyncJob(jobType: 'scheduled' | 'manual'): Promise<ExecuteSyncJobResponse> {
    logger.info(`Starting sync job: ${jobType}`);

    // Create sync job
    const jobId = await db.createSyncJob(jobType);
    const errors: SyncError[] = [];
    let pagesProcessed = 0;
    let pagesSucceeded = 0;
    let pagesFailed = 0;

    try {
      // Get last sync timestamp for incremental scanning
      const lastSyncTimestamp = await db.getLastSyncTimestamp();
      logger.info('Querying Notion pages', { lastSyncTimestamp });

      // Get pages
      // Query Notion pages with status=adding
      const { pages } = await notionService.queryPages({
        lastSyncTimestamp: lastSyncTimestamp || undefined,
        statusFilter: 'adding',
      });

      logger.info(`Found ${pages.length} pages to sync`);

      for (const page of pages) {
        pagesProcessed++;
        logger.info(`Processing page ${pagesProcessed}/${pages.length}: ${page.title}`, {
          pageId: page.id,
        });

        // Sync each page
        try {
          await this.syncPage(jobId, page);
          pagesSucceeded++;
          logger.info(`Successfully synced page: ${page.title}`);
        } catch (error: any) {
          pagesFailed++;
          const syncError: SyncError = {
            notionPageId: page.id,
            pageTitle: page.title,
            errorMessage: error.message,
            retryCount: 0,
          };
          errors.push(syncError);
          logger.error(`Failed to sync page: ${page.title}`, error);
        }

        // Update job progress
        await db.updateSyncJob(jobId, {
          pages_processed: pagesProcessed,
          pages_succeeded: pagesSucceeded,
          pages_failed: pagesFailed,
        });
      }

      // Mark job as completed
      await db.updateSyncJob(jobId, {
        status: pagesFailed === 0 ? 'completed' : 'failed',
        last_sync_timestamp: new Date().toISOString(),
      });

      // TODO: telegram notification option 활성화 시
      // Send Telegram notification
      await telegramService.sendSyncNotification({
        jobId,
        jobType,
        status: pagesFailed === 0 ? 'success' : 'failure',
        pagesProcessed,
        pagesSucceeded,
        pagesFailed,
        errors,
      });

      logger.info(`Sync job ${jobId} completed`, {
        pagesProcessed,
        pagesSucceeded,
        pagesFailed,
      });

      return {
        jobId,
        status: pagesFailed === 0 ? 'completed' : 'failed',
        pagesProcessed,
        pagesSucceeded,
        pagesFailed,
        errors,
      };
    } catch (error: any) {
      // Handle sync job failure, not individual sync job item failures.
      // Fatal error - mark job as failed
      await db.updateSyncJob(jobId, {
        status: 'failed',
        error_message: error.message,
      });

      // TODO: telegram notification option 활성화 시
      // Send failure notification
      await telegramService.sendSyncNotification({
        jobId,
        jobType,
        status: 'failure',
        pagesProcessed,
        pagesSucceeded,
        pagesFailed,
        errors: [
          {
            notionPageId: 'N/A',
            pageTitle: 'Fatal Error',
            errorMessage: error.message,
          },
        ],
      });

      logger.error(`Sync job ${jobId} failed with fatal error`, error);
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
        status: 'pending',
        retry_count: 0,
      });

      // Get page notion-blocks
      const blocks = await notionService.getPageBlocks(page.id);

      // Convert to HTML and extract images
      // TODO: extract image url -> download & upload -> replace url -> convert to HTML 순서로 변경 
      const { html, images } = await contentConverter.convertToHTML(page.id, blocks);

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
            status: 'pending',
          });

          // Download image
          // TODO: downloadMultiple 사용하도록 수정. See imageDownloader.ts:96.
          const { buffer, hash, contentType } = await imageDownloader.download({
            url: image.url,
          });

          // Generate filename from hash to prevent collisions
          const extension = this.getExtensionFromContentType(contentType);
          // TODO: 기존의 filename + hash 조합 방식으로 변경 고려 - url의 마지막 path에 있는 파일명 사용
          const filename = `${hash.substring(0, 16)}.${extension}`;

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
            file_hash: hash,
            status: 'uploaded',
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
        status: 'draft',
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
      await notionService.updatePageStatus(page.id, 'complete');

      // Mark job item as success
      await db.updateSyncJobItem(jobItemId, {
        status: 'success',
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
      await notionService.updatePageStatus(notionPageId, 'error');
      logger.info(`Updated Notion page ${notionPageId} status to error`);
    } catch (error: any) {
      logger.warn(`Failed to update Notion page ${notionPageId} status`, error);
    }

    // Mark job item as failed
    if (jobItemId) {
      try {
        await db.updateSyncJobItem(jobItemId, {
          status: 'failed',
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
}

export const syncOrchestrator = new SyncOrchestrator();
