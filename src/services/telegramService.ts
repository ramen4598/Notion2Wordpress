// Description: Service to send Telegram notifications about sync job status

import { Telegraf } from 'telegraf';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { SyncJob } from '../orchestrator/syncOrchestrator.js';
import { JobStatus } from '../enums/db.enums.js';

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

  async sendSyncNotification(syncJob: SyncJob): Promise<void> {
    if (!this.checkConfigured()) return;

    const { jobId, status } = syncJob;
    const message = this.formatNotificationMessage(syncJob);

    try {
      await this.bot!.telegram.sendMessage(this.chatId!, message, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
      });
      logger.info(`Sent Telegram notification for job ${jobId} : ${status}`);
    } catch (error) {
      logger.error('Failed to send Telegram notification', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - notification failures shouldn't block the sync
    }
  }

  private formatNotificationMessage(syncJob: SyncJob): string {
    const { jobId, jobType, status, pagesProcessed, pagesSucceeded, pagesFailed, errors } =
      syncJob;

    const emoji = status === JobStatus.Completed ? '✅' : '❌';
    const statusText = status === JobStatus.Completed ? 'Completed' : 'Failed';

    let message = `${emoji} *Notion→WordPress Sync ${statusText}*\n\n`;
    message += `*Job ID:* ${jobId}\n`;
    message += `*Type:* ${jobType}\n`;
    message += `*Pages Processed:* ${pagesProcessed}\n`;
    message += `*Succeeded:* ${pagesSucceeded}\n`;
    message += `*Failed:* ${pagesFailed}\n`;

    if (status === JobStatus.Failed && errors && errors.length > 0) {
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
