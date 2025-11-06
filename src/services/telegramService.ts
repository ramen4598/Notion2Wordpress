// Description: Service to send Telegram notifications about sync job status

import { Telegraf } from 'telegraf';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

export interface NotificationOptions {
  jobId: number;
  jobType: 'scheduled' | 'manual';
  status: 'success' | 'failure';
  pagesProcessed: number;
  pagesSucceeded: number;
  pagesFailed: number;
  errors?: Array<{
    notionPageId: string;
    pageTitle: string;
    errorMessage: string;
  }>;
}

class TelegramService {
  private bot: Telegraf | null;
  private chatId: string | null;
  private enabled: boolean;

  constructor() {
    this.enabled = config.telegramEnabled;

    if(!this.enabled) {
      this.bot = null;
      this.chatId = null;
      logger.info('Telegram notifications are disabled');
      return;
    }

    if (!config.telegramBotToken || !config.telegramChatId) {
      logger.warn('Telegram is enabled but credentials are missing. Disabling notifications.');
      this.enabled = false;
      this.bot = null;
      this.chatId = null;
      return;
    }

    this.bot = new Telegraf(config.telegramBotToken);
    this.chatId = config.telegramChatId;
  }

  async sendSyncNotification(options: NotificationOptions): Promise<void> {
    if (!this.checkConfigured()) return;

    const { jobId, jobType, status, pagesProcessed, pagesSucceeded, pagesFailed, errors } = options;
    const message = this.formatNotificationMessage({
      jobId,
      jobType,
      status,
      pagesProcessed,
      pagesSucceeded,
      pagesFailed,
      errors,
    });

    try {
      await this.bot!.telegram.sendMessage(this.chatId!, message, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
      });
      logger.info(`Sent Telegram notification for job ${jobId}`, { status });
    } catch (error) {
      logger.error('Failed to send Telegram notification', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - notification failures shouldn't block the sync
    }
  }

  private formatNotificationMessage(options: NotificationOptions): string {
    const { jobId, jobType, status, pagesProcessed, pagesSucceeded, pagesFailed, errors } =
      options;

    const emoji = status === 'success' ? '✅' : '❌';
    const statusText = status === 'success' ? 'COMPLETED' : 'FAILED';

    let message = `${emoji} *Notion→WordPress Sync ${statusText}*\n\n`;
    message += `*Job ID:* ${jobId}\n`;
    message += `*Type:* ${jobType}\n`;
    message += `*Pages Processed:* ${pagesProcessed}\n`;
    message += `*Succeeded:* ${pagesSucceeded}\n`;
    message += `*Failed:* ${pagesFailed}\n`;

    if (status === 'failure' && errors && errors.length > 0) {
      message += `\n*Errors:*\n`;
      const maxErrors = 5; // Limit to avoid message being too long
      const displayErrors = errors.slice(0, maxErrors);

      for (const error of displayErrors) {
        message += `• ${error.pageTitle}\n`;
        message += `  _${this.truncateError(error.errorMessage)}_\n`;
      }

      if (errors.length > maxErrors) {
        message += `\n_...and ${errors.length - maxErrors} more errors_\n`;
      }

      message += `\n*Check logs for full error details*`;
    }

    return message;
  }

  private truncateError(error: string, maxLength: number = 100): string {
    if (error.length <= maxLength) return error;
    return error.substring(0, maxLength) + '...';
  }
  
  private checkConfigured(): boolean {
    if (!this.enabled) {
      logger.info('Telegram notifications disabled, skipping notification');
      return false;
    }
    if (!this.bot) {
      logger.warn('Telegram bot not configured, skipping notification');
      return false;
    }
    if (!this.chatId) {
      logger.warn('Telegram chat ID not configured, skipping notification');
      return false;
    }
    return true;
  }

  async sendTestMessage(message: string): Promise<void> {
    if (!this.checkConfigured()) return;
    try {
      await this.bot!.telegram.sendMessage(this.chatId!, message);
      logger.info('Sent test Telegram message');
    } catch (error) {
      logger.error('Failed to send test Telegram message', error);
      throw error;
    }
  }
}

export const telegramService = new TelegramService();
