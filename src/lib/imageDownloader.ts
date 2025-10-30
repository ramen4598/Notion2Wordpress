import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { retryWithBackoff } from '../lib/retry.js';

export interface DownloadImageOptions {
  url: string;
  timeout?: number;
}

export interface DownloadImageResponse {
  buffer: Buffer;
  hash: string;
  contentType: string;
  size: number;
}

class ImageDownloader {
  async download(options: DownloadImageOptions): Promise<DownloadImageResponse> {
    const { url, timeout = config.imageDownloadTimeoutMs } = options;

    try {
      const response = await retryWithBackoff(
        async () => {
          return await axios.get(url, {
            responseType: 'arraybuffer',
            timeout,
            headers: {
              'User-Agent': 'Notion2WordPress/1.0',
            },
          });
        },
        {
          onRetry: (error, attempt) => {
            logger.warn(`Retrying image download (attempt ${attempt})`, {
              url: this.sanitizeUrl(url),
              error: error.message,
            });
          },
        }
      );

      const buffer = Buffer.from(response.data);
      const hash = this.calculateHash(buffer);
      const contentType = response.headers['content-type'] || 'image/jpeg';
      const size = buffer.length;

      logger.info('Downloaded image', {
        url: this.sanitizeUrl(url),
        size,
        hash,
        contentType,
      });

      return { buffer, hash, contentType, size };
    } catch (error: any) {
      logger.error('Failed to download image', {
        url: this.sanitizeUrl(url),
        error: error.message,
      });
      throw new Error(`Image download failed: ${error.message}`);
    }
  }

  async downloadMultiple(urls: string[]): Promise<Map<string, DownloadImageResponse>> {
    const results = new Map<string, DownloadImageResponse>();
    const maxConcurrent = config.maxConcurrentImageDownloads;

    logger.info(`Downloading ${urls.length} images (max concurrent: ${maxConcurrent})`);

    // Process in batches to respect concurrency limit
    for (let i = 0; i < urls.length; i += maxConcurrent) {
      const batch = urls.slice(i, i + maxConcurrent);
      const promises = batch.map(async (url) => {
        try {
          const result = await this.download({ url });
          return { url, result };
        } catch (error) {
          logger.warn(`Failed to download image in batch: ${this.sanitizeUrl(url)}`);
          return { url, result: null };
        }
      });

      const batchResults = await Promise.all(promises);

      for (const { url, result } of batchResults) {
        if (result) {
          results.set(url, result);
        }
      }
    }

    logger.info(`Downloaded ${results.size}/${urls.length} images successfully`);
    return results;
  }

  private calculateHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  private sanitizeUrl(url: string): string {
    // Remove query parameters and tokens from logs for security
    try {
      const urlObj = new URL(url);
      return `${urlObj.origin}${urlObj.pathname}`;
    } catch {
      return url.substring(0, 50) + '...';
    }
  }
}

export const imageDownloader = new ImageDownloader();
