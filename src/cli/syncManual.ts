#!/usr/bin/env node
// shebang to specify Node.js interpreter
// MUST be at the very top of the file

// Description: CLI script to trigger a manual synchronization job

import { logger } from '../lib/logger.js';
import { db } from '../db/index.js';
import { ExecuteSyncJobResponse, syncOrchestrator } from '../orchestrator/syncOrchestrator.js';
import { JobType } from '../enums/db.enums.js';
import { JobStatus } from '../enums/db.enums.js';
import { asError } from '../lib/utils.js';

async function main() {
  logger.info('Starting manual sync job');

  const startTime = Date.now();
  let result: ExecuteSyncJobResponse;
  try {
    // Initialize database
    await db.initialize();
    // Execute manual sync
    result = await syncOrchestrator.executeSyncJob(JobType.Manual);
    // Close database
    await db.close();

  } catch (error: unknown) {
    logger.error('Manual sync failed', asError(error));
    await db.close();
    process.exit(1);
  }

  if (!result) {
    logger.info('No pages to sync for this manual job');
    process.exit(0);
  }

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

  // Exit with appropriate code
  const duration = Date.now() - startTime;
  logger.info(`Manual sync job completed in ${duration}ms`);
  process.exit(result.status === JobStatus.Completed ? 0 : 1);
}

main();
