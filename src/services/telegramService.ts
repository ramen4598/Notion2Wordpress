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
  private bot: Telegraf;
  private chatId: string;

  constructor() {
    this.bot = new Telegraf(config.telegramBotToken);
    this.chatId = config.telegramChatId;
  }

  async sendSyncNotification(options: NotificationOptions): Promise<void> {
    const { jobId, jobType, status, pagesProcessed, pagesSucceeded, pagesFailed, errors } =
      options;

    try {
      const message = this.formatNotificationMessage({
        jobId,
        jobType,
        status,
        pagesProcessed,
        pagesSucceeded,
        pagesFailed,
        errors,
      });

      await this.bot.telegram.sendMessage(this.chatId, message, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
      });

      logger.info(`Sent Telegram notification for job ${jobId}`, { status });
    } catch (error: any) {
      logger.error('Failed to send Telegram notification', {
        jobId,
        error: error.message,
      });
      // Don't throw - notification failures shouldn't block the sync
    }
  }

  private formatNotificationMessage(options: NotificationOptions): string {
    const { jobId, jobType, status, pagesProcessed, pagesSucceeded, pagesFailed, errors } =
      options;

    // TODO: 삼항연산자 사용하지 말고 깔끔하게 리팩토링
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

  async sendTestMessage(message: string): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(this.chatId, message);
      logger.info('Sent test Telegram message');
    } catch (error: any) {
      logger.error('Failed to send test Telegram message', error);
      throw error;
    }
  }
}

export const telegramService = new TelegramService();
