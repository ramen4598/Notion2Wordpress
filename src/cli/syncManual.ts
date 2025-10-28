#!/usr/bin/env node
import { logger } from '../lib/logger.js';
import { db } from '../db/index.js';
import { syncOrchestrator } from '../orchestrator/syncOrchestrator.js';

async function main() {
  logger.info('Starting manual sync job');

  try {
    // Initialize database
    await db.initialize();

    // Execute manual sync
    const result = await syncOrchestrator.executeSyncJob('manual');

    // Log results
    logger.info('Manual sync completed', {
      jobId: result.jobId,
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

    // Close database
    await db.close();

    // Exit with appropriate code
    process.exit(result.status === 'completed' ? 0 : 1);
  } catch (error) {
    logger.error('Manual sync failed', error);
    await db.close();
    process.exit(1);
  }
}

main();
