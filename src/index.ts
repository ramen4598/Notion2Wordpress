// Description: Entry point for Notion2WordPress sync service

import cron from 'node-cron';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { db } from './db/index.js';
import { syncOrchestrator } from './orchestrator/syncOrchestrator.js';
import { JobType } from './enums/db.enums.js';
import { asError } from './lib/utils.js';

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
        const result = await syncOrchestrator.executeSyncJob(JobType.Scheduled);
        logger.info('Scheduled sync completed', {
          jobId: result.jobId,
          JobType: result.jobType,
          status: result.status,
          pagesProcessed: result.pagesProcessed,
          pagesSucceeded: result.pagesSucceeded,
          pagesFailed: result.pagesFailed,
        });

        if (result.errors.length > 0) {
          logger.error('Sync completed with errors:', {
            errorCount: result.errors.length,
            errors: result.errors,
          });
        }
      } catch (error) {
        logger.error('Scheduled sync failed', error);
      }
    });

    logger.info('Sync scheduler started successfully');

    // Keep the process running

    // 'SIGINT' is sent on Ctrl+C, 'SIGTERM' is sent by process managers
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully');
      await db.close();
      process.exit(0);
    });

    // 'SIGTERM' is sent on termination signal, e.g., from Docker or Kubernetes
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully');
      await db.close();
      process.exit(0);
    });
  } catch (error: unknown) {
    logger.error('Failed to start sync service', asError(error));
    process.exit(1);
  }
}

main();
