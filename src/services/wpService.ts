import apiFetch from '@wordpress/api-fetch';
import FormData from 'form-data';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { retryWithBackoff } from '../lib/retry.js';

export interface CreatePostOptions {
  title: string;
  content: string;
  status?: 'draft' | 'publish';
}

export interface CreatePostResponse {
  id: number;
  title: string;
  link: string;
  status: string;
}

export interface UploadMediaOptions {
  buffer: Buffer;
  filename: string;
  contentType: string;
  altText?: string;
}

export interface UploadMediaResponse {
  id: number;
  url: string;
  mediaType: string;
  mimeType: string;
}

class WordPressService {
  private baseUrl: string;
  private auth: string;

  constructor() {
    this.baseUrl = config.wpApiUrl;
    const auth = Buffer.from(`${config.wpUsername}:${config.wpAppPassword}`).toString('base64');
    this.auth = `Basic ${auth}`;

    // Configure apiFetch
    apiFetch.use(apiFetch.createRootURLMiddleware(this.baseUrl));
    apiFetch.use((options, next) => {
      return next({
        ...options,
        headers: {
          ...options.headers,
          Authorization: this.auth,
        },
      });
    });
  }

  async createDraftPost(options: CreatePostOptions): Promise<CreatePostResponse> {
    const { title, content, status = 'draft' } = options;

    try {
      const response = await retryWithBackoff(
        async () => {
          return await apiFetch({
            path: '/wp/v2/posts',
            method: 'POST',
            data: {
              title,
              content,
              status,
            },
          });
        },
        {
          onRetry: (error, attempt) => {
            logger.warn(`Retrying WordPress post creation (attempt ${attempt})`, {
              title,
              error: error.message,
            });
          },
        }
      );

      const post = response as any;

      logger.info(`Created WordPress post: ${post.id}`, {
        title: post.title.rendered,
        status: post.status,
      });

      return {
        id: post.id,
        title: post.title.rendered,
        link: post.link,
        status: post.status,
      };
    } catch (error: any) {
      logger.error('Failed to create WordPress post', { title, error: error.message });
      throw new Error(`WordPress post creation failed: ${error.message}`);
    }
  }

  async uploadMedia(options: UploadMediaOptions): Promise<UploadMediaResponse> {
    const { buffer, filename, contentType, altText } = options;

    try {
      const formData = new FormData();
      formData.append('file', buffer, {
        filename,
        contentType,
      });

      if (altText) {
        formData.append('alt_text', altText);
      }

      type WPCreateMediaResponse = {
        id: number;
        source_url: string;
        media_type: string;
        mime_type: string;
      };

      const response = (await retryWithBackoff(
        async () => {
          // Use fetch directly for multipart/form-data
          const res = await fetch(`${this.baseUrl}/wp/v2/media`, {
            method: 'POST',
            headers: {
              Authorization: this.auth,
              ...formData.getHeaders(),
            },
            body: formData as any,
          });

          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`HTTP ${res.status}: ${errorText}`);
          }

          return (await res.json()) as WPCreateMediaResponse;
        },
        {
          onRetry: (error, attempt) => {
            logger.warn(`Retrying WordPress media upload (attempt ${attempt})`, {
              filename,
              error: error.message,
            });
          },
        }
      )) as WPCreateMediaResponse;

      logger.info(`Uploaded media to WordPress: ${response.id}`, {
        url: response.source_url,
        filename,
      });

      return {
        id: response.id,
        url: response.source_url,
        mediaType: response.media_type,
        mimeType: response.mime_type,
      };
    } catch (error: any) {
      logger.error('Failed to upload media to WordPress', { filename, error: error.message });
      throw new Error(`WordPress media upload failed: ${error.message}`);
    }
  }

  async deletePost(postId: number): Promise<void> {
    try {
      await retryWithBackoff(
        async () => {
          return await apiFetch({
            path: `/wp/v2/posts/${postId}`,
            method: 'DELETE',
            data: {
              force: true, // Permanently delete, bypass trash
            },
          });
        },
        {
          onRetry: (error, attempt) => {
            logger.warn(`Retrying WordPress post deletion (attempt ${attempt})`, {
              postId,
              error: error.message,
            });
          },
        }
      );

      logger.info(`Deleted WordPress post: ${postId}`);
    } catch (error: any) {
      logger.error(`Failed to delete WordPress post ${postId}`, error);
      throw new Error(`WordPress post deletion failed: ${error.message}`);
    }
  }

  async deleteMedia(mediaId: number): Promise<void> {
    try {
      await retryWithBackoff(
        async () => {
          return await apiFetch({
            path: `/wp/v2/media/${mediaId}`,
            method: 'DELETE',
            data: {
              force: true, // Permanently delete
            },
          });
        },
        {
          onRetry: (error, attempt) => {
            logger.warn(`Retrying WordPress media deletion (attempt ${attempt})`, {
              mediaId,
              error: error.message,
            });
          },
        }
      );

      logger.info(`Deleted WordPress media: ${mediaId}`);
    } catch (error: any) {
      logger.warn(`Failed to delete WordPress media ${mediaId}`, error);
      // Don't throw - media deletion failures shouldn't block rollback
    }
  }

  async replaceImageUrls(html: string, imageMap: Map<string, string>): Promise<string> {
    let updatedHtml = html;

    for (const [notionUrl, wpUrl] of imageMap.entries()) {
      // Replace Notion signed URLs with WordPress media URLs
      const notionUrlEscaped = notionUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(notionUrlEscaped, 'g');
      updatedHtml = updatedHtml.replace(regex, wpUrl);
    }

    return updatedHtml;
  }
}

export const wpService = new WordPressService();
