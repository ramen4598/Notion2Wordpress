#!/usr/bin/env node
// shebang to specify Node.js interpreter
// MUST be at the very top of the file

// Description: CLI script to trigger a manual synchronization job
import { logger } from '../lib/logger.js';
import { db } from '../db/index.js';
import { syncOrchestrator } from '../orchestrator/syncOrchestrator.js';
import { JobType } from '../enums/db.enums.js';
import { JobStatus } from '../enums/db.enums.js';
import { asError } from '../lib/utils.js';

async function main() {
  logger.info('Starting manual sync job');

  try {
    const startTime = Date.now();

    // Initialize database
    await db.initialize();

    // Execute manual sync
    const result = await syncOrchestrator.executeSyncJob(JobType.Manual);

    // Log results
    logger.info('Manual sync completed', {
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

    // Close database
    await db.close();

    const duration = Date.now() - startTime;
    logger.info(`Manual sync job completed in ${duration}ms`);

    // Exit with appropriate code
    process.exit(result.status === JobStatus.Completed ? 0 : 1);
  } catch (error: unknown) {
    logger.error('Manual sync failed', asError(error));
    await db.close();
    process.exit(1);
  }
}

main();
