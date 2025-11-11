// Description: Module for downloading images with retry logic, calculating hashes, and logging.

import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { retryWithBackoff } from '../lib/retry.js';
import { asError } from '../lib/utils.js';

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

      logger.debug('download - Downloaded image', {
        filename,
        url: sanitizedUrl,
        size,
        hash,
        contentType,
      });

      return { filename, buffer, hash, contentType, size };
    } catch (error: unknown) {
      const err = asError(error);
      logger.error('Failed to download image', {
        url: sanitizedUrl,
        error: err.message,
      });
      throw new Error(`Image download failed: ${err.message}`);
    }
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
