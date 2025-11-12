// Description: Service to send Telegram notifications about sync job status

import { Telegraf } from 'telegraf';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { SyncJob } from '../orchestrator/syncOrchestrator.js';
import { JobStatus } from '../enums/db.enums.js';
import { asError } from '../lib/utils.js';

class TelegramService {
  private bot: Telegraf | null; // Telegram bot instance
  private chatId: string | null; // Telegram chat ID to send messages to
  private enabled: boolean; // Whether to use Telegram notifications

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

  /**
   * Sends a Telegram notification about the sync job status.
   * @param syncJob The sync job details.
   * @throws Will not throw - notification failures shouldn't block the sync.
   */
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
    } catch (error : unknown) {
      logger.error('Failed to send Telegram notification', {
        jobId,
        error: asError(error),
      });
      // Don't throw - notification failures shouldn't block the sync
    }
  }

  /**
   * Formats the notification message based on the sync job details.
   * @param syncJob The sync job details.
   * @returns Formatted message string.
   */
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

  /**
   * Truncates an error message to a maximum length.
   * @param error The error message.
   * @param maxLength Maximum length of the error message.
   * @returns Truncated error message string.
   */
  private truncateError(error: string, maxLength: number = 100): string {
    if (error.length <= maxLength) return error;
    return error.substring(0, maxLength) + '...';
  }
  
  /**
   * Checks if Telegram notifications are properly configured.
   * @returns True if configured, false otherwise.
   */
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
    } catch (error: unknown) {
      const err = asError(error);
      logger.error('Failed to send test Telegram message', err);
      throw err;
    }
  }
}

export const telegramService = new TelegramService();
