# Notion to WordPress Sync Specification

**Last Updated**: 2025-11-13

## Overview

Automated synchronization system that publishes Notion pages to WordPress as draft posts, including images, with Telegram notifications.

## Core Workflow

1. User sets Notion page `status` to `adding`
2. System syncs page to WordPress as draft (scheduled or manual trigger)
3. System updates Notion `status` to `complete`
4. Admin reviews and publishes draft manually
5. Telegram notification sent on success/failure

## Status Property Values

- `writing`: Ignored by sync
- `adding`: Triggers sync to WordPress draft
- `complete`: Successfully synced
- `error`: Sync failed

## Key Features

### Automatic Sync
- Incremental scanning (only pages modified since last sync)
- Scheduled execution via cron (default: every 5 minutes)
- Manual trigger via CLI

### Image Handling
- Downloads images from Notion
- Uploads to WordPress media library
- Downloads and uploads images in batches to optimize speed

### Error Handling
- Max 3 retries with exponential backoff
- Rollback WordPress resources (posts/media) on failure
- Sets Notion `status` to `error` on failure
- Detailed error logging to stdout/stderr

### Notifications
- Telegram alerts for sync success/failure
- Error summary with log inspection instructions

## Technical Stack

- **Runtime**: Node.js 20.x LTS, TypeScript 5.9.3
- **APIs**: @notionhq/client, @wordpress/api-fetch, Telegraf
- **Conversion**: notion-to-md + marked (Notion → Markdown → HTML)
- **Scheduler**: node-cron
- **Database**: SQLite (better-sqlite3) for page-post mapping
- **Deployment**: Docker with .env configuration

## Authentication

All credentials managed via environment variables:
- `NOTION_API_TOKEN`: Integration token with read/update permissions
- `WP_API_URL`: WordPress REST API endpoint (HTTPS/HTTP)
- `WP_USERNAME`, `WP_APP_PASSWORD`: Application Password credentials
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`: Bot token and target chat

## Security

- HTTPS/TLS for Notion and Telegram APIs (required)
- HTTPS/TLS recommended for WordPress (HTTP acceptable for localhost/development/self-hosted)

## Limitations (MVP)

- No update sync: only new pages processed
- No idempotency: duplicate uploads allowed if status changed to `adding` multiple times
- No auto-publish: all posts require manual admin approval
- No Notion deletion sync: WordPress posts retained
- No category/tag sync: WordPress defaults used
