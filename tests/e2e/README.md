# E2E Manual Scenario: Notion → WordPress Sync

This document outlines the manual end-to-end scenario to validate the full sync flow.

## Prerequisites
- Valid `.env` configured (see `specs/001-notion2wp-sync/quickstart.md`)
- WordPress instance reachable with Application Passwords
- Notion database with `status` select property
- Telegram bot token and chat id (optional for notifications)

## Steps
1. Prepare Notion page
   - Create or pick a page in the target database
   - Set `status` = `adding`
   - Include some text content and 1-2 images (Notion image blocks)

2. Start the service (scheduler) in dev mode
   - `npm run dev`
   - Or run manual sync once: `npm run sync:manual`

3. Observe logs
   - Look for job creation, page processing, image download/upload, and draft creation events

4. Verify WordPress
   - Open WP Admin → Posts → Drafts
   - Confirm a new draft with the Notion title exists
   - Open the draft and verify images are present

5. Verify Notion status update
   - The page `status` should become `complete` on success

6. Failure handling (optional)
   - Intentionally cause a failure (e.g., wrong credentials) and re-run
   - Verify rollback: draft/media deleted, Notion status set to `error`

7. Telegram notification (optional)
   - Check that the success/failure message arrived in the chat

## Cleanup
- Revert test page `status` or delete the draft
- Optionally remove media uploaded during the test
