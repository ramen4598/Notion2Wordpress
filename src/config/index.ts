// Description: Configuration module to load environment variables and provide typed access throughout the application.

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// meta is a special object in ES modules that provides metadata about the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ENV_PATH = '../../.env';
const DEFAULT_DATABASE_PATH = './data/sync.db';

// Load environment variables
// from .env file to the process.env object
dotenv.config({ path: path.resolve(__dirname, DEFAULT_ENV_PATH) });

export interface Config {
  // Notion
  notionApiToken: string;
  notionDatasourceId: string;

  // WordPress
  wpApiUrl: string;
  wpUsername: string;
  wpAppPassword: string;
  wpVerifySsl: boolean;

  // Telegram
  telegramBotToken: string;
  telegramChatId: string;

  // Sync
  syncSchedule: string;
  nodeEnv: string;

  // Database
  databasePath: string;
  logLevel: string;

  // Image Download
  maxConcurrentImageDownloads: number;
  imageDownloadTimeoutMs: number;

  // Retry
  maxRetryAttempts: number;
  retryInitialDelayMs: number;
}

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (!value && !defaultValue) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || defaultValue!;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    throw new Error(`Environment variable ${key} must be a number, got: ${value}`);
  }
  return num;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  // === 'true' means true, anything else is false
  return value.toLowerCase() === 'true';
}

export const config: Config = {
  // Notion
  notionApiToken: getEnv('NOTION_API_TOKEN'),
  notionDatasourceId: getEnv('NOTION_DATASOURCE_ID'),

  // WordPress
  wpApiUrl: getEnv('WP_API_URL'),
  wpUsername: getEnv('WP_USERNAME'),
  wpAppPassword: getEnv('WP_APP_PASSWORD'),
  wpVerifySsl: getEnvBoolean('WP_VERIFY_SSL', true),

  // Telegram
  telegramBotToken: getEnv('TELEGRAM_BOT_TOKEN'),
  telegramChatId: getEnv('TELEGRAM_CHAT_ID'),

  // Sync
  syncSchedule: getEnv('SYNC_SCHEDULE', '*/5 * * * *'), // Default: every 5 minutes
  nodeEnv: getEnv('NODE_ENV', 'development'),

  // Database
  databasePath: getEnv('DATABASE_PATH', DEFAULT_DATABASE_PATH),
  logLevel: getEnv('LOG_LEVEL', 'info'),

  // Image Download
  maxConcurrentImageDownloads: getEnvNumber('MAX_CONCURRENT_IMAGE_DOWNLOADS', 3),
  imageDownloadTimeoutMs: getEnvNumber('IMAGE_DOWNLOAD_TIMEOUT_MS', 30000),

  // Retry
  maxRetryAttempts: getEnvNumber('MAX_RETRY_ATTEMPTS', 3),
  retryInitialDelayMs: getEnvNumber('RETRY_INITIAL_DELAY_MS', 1000),
};
