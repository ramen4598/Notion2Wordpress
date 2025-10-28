import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface Config {
  // Notion
  notionApiToken: string;
  notionDatabaseId: string;

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
  return value.toLowerCase() === 'true';
}

export const config: Config = {
  // Notion
  notionApiToken: getEnv('NOTION_API_TOKEN'),
  notionDatabaseId: getEnv('NOTION_DATABASE_ID'),

  // WordPress
  wpApiUrl: getEnv('WP_API_URL'),
  wpUsername: getEnv('WP_USERNAME'),
  wpAppPassword: getEnv('WP_APP_PASSWORD'),
  wpVerifySsl: getEnvBoolean('WP_VERIFY_SSL', true),

  // Telegram
  telegramBotToken: getEnv('TELEGRAM_BOT_TOKEN'),
  telegramChatId: getEnv('TELEGRAM_CHAT_ID'),

  // Sync
  syncSchedule: getEnv('SYNC_SCHEDULE', '*/5 * * * *'),
  nodeEnv: getEnv('NODE_ENV', 'development'),

  // Database
  databasePath: getEnv('DATABASE_PATH', './data/sync.db'),
  logLevel: getEnv('LOG_LEVEL', 'info'),

  // Image Download
  maxConcurrentImageDownloads: getEnvNumber('MAX_CONCURRENT_IMAGE_DOWNLOADS', 3),
  imageDownloadTimeoutMs: getEnvNumber('IMAGE_DOWNLOAD_TIMEOUT_MS', 30000),

  // Retry
  maxRetryAttempts: getEnvNumber('MAX_RETRY_ATTEMPTS', 3),
  retryInitialDelayMs: getEnvNumber('RETRY_INITIAL_DELAY_MS', 1000),
};
