// Description: Service to interact with WordPress REST API

import axios, { type AxiosInstance, isAxiosError } from 'axios';
import FormData from 'form-data';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { retryWithBackoff } from '../lib/retry.js';
import { WpPostStatus } from '../enums/wp.enums.js';
import { asError } from '../lib/utils.js';

export interface CreatePostOptions {
  title: string;
  content: string;
  status?: WpPostStatus;
}

export interface CreatePostResponse {
  id: number;
  title: string;
  link: string; // URL to the post
  status: WpPostStatus;
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
  private client: AxiosInstance;

  constructor() {
    // Use Buffer.from to create Base64 encoded auth string
    const auth = Buffer.from(`${config.wpUsername}:${config.wpAppPassword}`).toString('base64');

    this.client = axios.create({
      baseURL: config.wpApiUrl,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Create a draft post in WordPress
   * @param options - title, content, and status(optional, defaults to draft)
   * @returns CreatePostResponse with post details
   * @throws Error if creation fails after retries
   */
  async createDraftPost(options: CreatePostOptions): Promise<CreatePostResponse> {

    const { title, content, status = WpPostStatus.DRAFT } = options;

    const fn = async () => {
      const res = await this.client.post('/wp/v2/posts', {
        title,
        content,
        status,
      });
      return res.data;
    };

    const onRetryFn = (error: Error, attempt: number) => {
      const errorMsg = this.getAxiosErrorMessage(error);
      logger.warn(`Retrying WordPress post creation (attempt ${attempt})`, {
        title,
        error: errorMsg,
      });
    }

    interface WPPostResponse {
      id: number;
      title: { rendered: string };
      link: string;
      status: WpPostStatus;
    }

    try {
      const post = (await retryWithBackoff(fn, { onRetry: onRetryFn })) as WPPostResponse;

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
    } catch (error: unknown) {
      const message = this.getAxiosErrorMessage(error);
      logger.error('Failed to create WordPress post', { title, error: message });
      throw new Error(`WordPress post creation failed: ${message}`);
    }
  }

  /**
   * Upload media to WordPress
   * @param options - buffer, filename, contentType, altText(optional)
   * @returns UploadMediaResponse with media details
   * @throws Error if upload fails after retries
   */
  async uploadMedia(options: UploadMediaOptions): Promise<UploadMediaResponse> {
    const { buffer, filename, contentType, altText } = options;

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

    const fn = async () => {
      const res = await this.client.post('/wp/v2/media', formData, {
        headers: formData.getHeaders(),
      });
      return res.data as WPCreateMediaResponse;
    };

    const onRetryFn = (error: Error, attempt: number) => {
      const errorMsg = this.getAxiosErrorMessage(error);
      logger.warn(`Retrying WordPress media upload (attempt ${attempt})`, {
        filename,
        error: errorMsg,
      });
    };

    try {
      const response = (await retryWithBackoff(
        fn, { onRetry: onRetryFn }
      )) as WPCreateMediaResponse;

      logger.debug(`uploadMedia - Uploaded media to WordPress: ${response.id}`, {
        url: response.source_url,
        filename,
      });

      return {
        id: response.id,
        url: response.source_url,
        mediaType: response.media_type,
        mimeType: response.mime_type,
      };
    } catch (error: unknown) {
      const message = this.getAxiosErrorMessage(error);
      logger.error('Failed to upload media to WordPress', { filename, error: message });
      throw new Error(`WordPress media upload failed: ${message}`);
    }
  }

  /**
   * Delete a post in WordPress
   * @param postId - ID of the post to delete
   * @throws Error if deletion fails after retries
   */
  async deletePost(postId: number): Promise<void> {
    const fn = async () => {
      const res = await this.client.delete(`/wp/v2/posts/${postId}`, {
        params: { force: true },
      });
      return res.data;
    };

    const onRetryFn = (error: Error, attempt: number) => {
      const errorMsg = this.getAxiosErrorMessage(error);
      logger.warn(`Retrying WordPress post deletion (attempt ${attempt})`, {
        postId,
        error: errorMsg,
      });
    };

    try {
      await retryWithBackoff(fn, { onRetry: onRetryFn });
      logger.info(`Deleted WordPress post: ${postId}`);
    } catch (error: unknown) {
      logger.error(`Failed to delete WordPress post ${postId}`, error);
      const message = this.getAxiosErrorMessage(error);
      throw new Error(`WordPress post deletion failed: ${message}`);
    }
  }

  /**
   * Delete media in WordPress
   * @param mediaId - ID of the media to delete
   * @throws Error if deletion fails after retries
   */
  async deleteMedia(mediaId: number): Promise<void> {
    const fn = async () => {
      const res = await this.client.delete(`/wp/v2/media/${mediaId}`, {
        params: { force: true },
      });
      return res.data;
    };
    
    const onRetryFn = (error: Error, attempt: number) => {
      const errorMsg = this.getAxiosErrorMessage(error);
      logger.warn(`Retrying WordPress media deletion (attempt ${attempt})`, {
        mediaId,
        error: errorMsg,
      });
    };

    try {
      await retryWithBackoff(fn, { onRetry: onRetryFn });
      logger.info(`Deleted WordPress media: ${mediaId}`);
    } catch (error: unknown) {
      logger.warn(`Failed to delete WordPress media ${mediaId}`, error);
      const message = this.getAxiosErrorMessage(error);
      throw new Error(`WordPress media deletion failed: ${message}`);
    }
  }

  /**
   * Replace image placeholders in HTML with actual WordPress URLs
   * @param html - The HTML content with placeholders
   * @param imageMap - Map of placeholders to WordPress URLs
   * @returns Updated HTML with replaced URLs
   */
  async replaceImageUrls(html: string, imageMap: Map<string, string>): Promise<string> {
    let updatedHtml = html;

    // logger.debug(`replaceImageUrls: before process - HTML: ${html}`);
    // logger.debug(`replaceImageUrls: before process - imageMap: ${JSON.stringify(Array.from(imageMap.entries()))}`);
    for (const [placeholder, wpUrl] of imageMap.entries()) {
      const regex = new RegExp(placeholder, 'g');
      updatedHtml = updatedHtml.replace(regex, wpUrl);
    }
    // logger.debug(`replaceImageUrls: after process - updatedHTML: ${updatedHtml}`);
    logger.debug(`replaceImageUrls: replaced ${imageMap.size} image URLs in HTML`);
    return updatedHtml;
  }

  /**
   * Extract error message from Axios error or generic error
   * @param error - unknown error object
   * @returns Extracted error message string
   */
  private getAxiosErrorMessage(error: unknown): string {
    if (isAxiosError(error)) {
      return `${error.message}${error.response?.status ? ` (HTTP ${error.response.status})` : ''}`;
    } else {
      return asError(error).message;
    }
  } 
}

export const wpService = new WordPressService();
