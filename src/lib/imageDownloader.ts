// Description: Module for downloading images with retry logic, calculating hashes, and logging.

import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { retryWithBackoff } from '../lib/retry.js';

const VERSION = '1.0';

export interface DownloadImageOptions {
  url: string;
  timeout?: number;
}

export interface DownloadImageResponse {
  filename: string;
  buffer: Buffer;
  hash: string;
  contentType: string;
  size: number;
}

class ImageDownloader {
  async download(options: DownloadImageOptions): Promise<DownloadImageResponse> {
    const { url, timeout = config.imageDownloadTimeoutMs } = options;
    const sanitizedUrl = this.sanitizeUrl(url);

    const fn = async () => {
      return await axios.get(url, {
        responseType: 'arraybuffer',
        timeout,
        headers: {
          'User-Agent': `Notion2WordPress/${VERSION}`,
        },
      });
    };

    const onRetryFn = (error: Error, attempt: number) => {
      logger.warn(`Retrying image download (attempt ${attempt})`, {
        url: sanitizedUrl,
        error: error.message,
      });
    };

    try {
      const response = await retryWithBackoff(fn, { onRetry: onRetryFn });

      const filename = this.getFilenameFromUrl(url);
      const buffer = Buffer.from(response.data);
      const hash = this.calculateHash(buffer);
      const contentType = response.headers['content-type'] || 'image/jpeg';
      const size = buffer.length;

      logger.info('Downloaded image', {
        filename,
        url: sanitizedUrl,
        size,
        hash,
        contentType,
      });

      return { filename, buffer, hash, contentType, size };
    } catch (error: any) {
      logger.error('Failed to download image', {
        url: sanitizedUrl,
        error: error.message,
      });
      throw new Error(`Image download failed: ${error.message}`);
    }
  }

  // TODO: 사용하지 않는 메서드 제거 고려
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
          logger.warn('Failed to download image in batch', {
            url: this.sanitizeUrl(url),
            error: (error as Error).message,
          });
          return { url, result: null };
        }
      });

      const batchResults = await Promise.all(promises);

      for (const { url, result } of batchResults) {
        // TODO: 실패한 다운로드도 results에 추가할 것. 별도의  status 필드로 성공/실패 구분.
        // Only add successful downloads
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
    // For logging, remove query parameters and fragments
    try {
      const urlObj = new URL(url);
      return `${urlObj.origin}${urlObj.pathname}`;
    } catch {
      return url.substring(0, 50) + '...';
    }
  }

  private getFilenameFromUrl(url: string): string {
    let filename = url.split('/').pop()?.split('?')[0] || 'image';
    const lastDot = filename.lastIndexOf('.');
    if (lastDot > 0) {
      filename = filename.substring(0, lastDot);
    }
    return decodeURIComponent(filename);
  }
}

export const imageDownloader = new ImageDownloader();
