import cron from 'node-cron';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { db } from './db/index.js';
import { syncOrchestrator } from './orchestrator/syncOrchestrator.js';

async function main() {
  logger.info('Starting Notion2WordPress Sync Service');
  logger.info(`Node environment: ${config.nodeEnv}`);
  logger.info(`Sync schedule: ${config.syncSchedule}`);

  try {
    // Initialize database
    await db.initialize();
    logger.info('Database initialized successfully');

    // Schedule sync job
    cron.schedule(config.syncSchedule, async () => {
      logger.info('Scheduled sync job triggered');
      try {
        const result = await syncOrchestrator.executeSyncJob('scheduled');
        logger.info('Scheduled sync completed', {
          jobId: result.jobId,
          pagesProcessed: result.pagesProcessed,
          pagesSucceeded: result.pagesSucceeded,
          pagesFailed: result.pagesFailed,
        });
      } catch (error) {
        logger.error('Scheduled sync failed', error);
      }
    });

    logger.info('Sync scheduler started successfully');

    // Keep the process running
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully');
      await db.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully');
      await db.close();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to start sync service', error);
    process.exit(1);
  }
}

main();
