# Quickstart Guide: Notion to WordPress Sync

**Feature**: 001-notion2wp-sync  
**Date**: 2025-10-27  
**Version**: 1.0

## Overview

This guide provides a quick reference for setting up and running the Notion-WordPress sync system. It covers environment setup, configuration, deployment, and basic operations.

---

## Prerequisites

- **Node.js**: Version 20.x LTS or higher
- **Docker**: Version 20.x or higher (for containerized deployment)
- **Notion**: Integration token with access to target database
- **WordPress**: Site with REST API enabled, Application Password credentials
- **Telegram**: Bot token and chat ID for notifications

---

## Setup Steps

### 1. Clone Repository

```bash
git clone https://github.com/your-org/Notion2Wordpress.git
cd Notion2Wordpress
```

### 2. Install Dependencies

```bash
npm install
```

Installed versions:
- `@notionhq/client`: 5.3.0
- `axios`: 1.13.0
- `better-sqlite3`: 12.4.1
- `dotenv`: 17.2.3
- `form-data`: 4.0.4
- `marked`: 16.4.1
- `node-cron`: 4.2.1
- `notion-to-md`: 3.1.9
- `telegraf`: 4.16.3
- `typescript`: 5.9.3
- `vitest`: 4.0.4
- `eslint`: 9.38.0
- `prettier`: 3.6.2

### 3. Configure Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Notion Configuration
NOTION_API_TOKEN=secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NOTION_DATABASE_ID=7f2a3b4c5d6e7f8g9h0i1j2k3l4m5n6o

# WordPress Configuration
WP_API_URL=https://your-wordpress-site.com/wp-json  # Production: HTTPS
# WP_API_URL=http://localhost:8080/wp-json          # Dev/Self-hosted: HTTP allowed
WP_USERNAME=your-wordpress-username
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
# Optional (self-signed internal certs):
# WP_VERIFY_SSL=false

# Telegram Configuration
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=@your_channel_or_chat_id

# Sync Configuration
SYNC_SCHEDULE=*/5 * * * *    # Every 5 minutes (cron syntax)
NODE_ENV=production

# Database Configuration (optional, defaults shown)
DATABASE_PATH=./data/sync.db
LOG_LEVEL=info
```

---

## Obtaining Credentials

### Notion Integration Token

1. Visit https://www.notion.so/my-integrations
2. Click "New integration"
3. Name: "Notion2WordPress Sync"
4. Select workspace and capabilities:
   - ✅ Read content
   - ✅ Update content
5. Copy the "Internal Integration Token" (starts with `secret_`)
6. Share your database with the integration:
   - Open database in Notion
   - Click "..." → "Add connections"
   - Select your integration

### Notion Database ID

From your Notion database URL:
```
https://www.notion.so/{workspace}/{database-id}?v={view-id}
```
Copy the `{database-id}` portion (32 characters, no hyphens).

### WordPress Application Password

1. Log in to WordPress admin panel
2. Navigate to: Users → Profile
3. Scroll to "Application Passwords"
4. Name: "Notion Sync"
5. Click "Add New Application Password"
6. Copy the generated password (format: `xxxx xxxx xxxx xxxx`)

**Note**: Your WordPress user must have "Author" or "Editor" role.

### Telegram Bot Token

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` command
3. Follow prompts to name your bot
4. Copy the bot token (format: `1234567890:ABCdef...`)

### Telegram Chat ID

**For personal chat**:
1. Send a message to your bot
2. Visit: `https://api.telegram.org/bot{YOUR_BOT_TOKEN}/getUpdates`
3. Find `"chat":{"id":...}` in the response

**For channel**:
1. Add your bot as channel admin
2. Use channel username: `@your_channel` or numeric ID

---

## Database Setup

The SQLite database is auto-created on first run. To manually initialize:

```bash
npm run db:init
```

This creates `./data/sync.db` with the schema defined in `config/schema.sql`.

---

## Running the Sync Service

### Local Development

```bash
# Run once (manual sync)
npm run sync:manual

# Start daemon (scheduled sync) 
npm run build # requires build first
npm run start

# Development mode (with auto-restart, no build needed)
npm run dev
```

### Docker Deployment

Build and run the container:

```bash
# Build image
docker build -t notion2wp-sync .

# Run container
docker run -d \
  --name notion2wp-sync \
  --env-file .env \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/.env:/app/.env:ro \
  --restart unless-stopped \
  notion2wp-sync
```

**Using Docker Compose** (recommended):

```bash
docker-compose up -d
```

View logs:

```bash
docker-compose logs -f
```

---

## Configuration Reference

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NOTION_API_TOKEN` | ✅ | - | Notion integration token |
| `NOTION_DATABASE_ID` | ✅ | - | Target Notion database UUID |
| `WP_API_URL` | ✅ | - | WordPress REST API base URL |
| `WP_USERNAME` | ✅ | - | WordPress username |
| `WP_APP_PASSWORD` | ✅ | - | WordPress Application Password |
| `TELEGRAM_BOT_TOKEN` | ✅ | - | Telegram bot token |
| `TELEGRAM_CHAT_ID` | ✅ | - | Telegram chat/channel ID |
| `SYNC_SCHEDULE` | ❌ | `*/5 * * * *` | Cron schedule (every 5 min) |
| `DATABASE_PATH` | ❌ | `./data/sync.db` | SQLite database file path |
| `LOG_LEVEL` | ❌ | `info` | Logging level (debug/info/warn/error) |
| `NODE_ENV` | ❌ | `development` | Environment (development/production) |

### Cron Schedule Examples

```bash
# Every 5 minutes
SYNC_SCHEDULE="*/5 * * * *"

# Every hour at :00
SYNC_SCHEDULE="0 * * * *"

# Every day at 2:00 AM
SYNC_SCHEDULE="0 2 * * *"

# Every Monday at 9:00 AM
SYNC_SCHEDULE="0 9 * * 1"
```

---

## Usage

### Notion Workflow

1. **Create page** in monitored Notion database
2. **Set status** to `"writing"` while drafting (default, sync ignores)
3. **Change status** to `"adding"` when ready to sync
4. **Wait for sync**: Next scheduled run (max 5 minutes)
5. **Check Telegram**: Receive success notification
6. **Review in WordPress**: Log in and find draft post
7. **Publish**: Manually publish after review

### Checking Sync Status

**View recent sync jobs**:
```bash
npm run logs:sync
```

**Query database**:
```bash
sqlite3 ./data/sync.db "SELECT * FROM sync_jobs ORDER BY started_at DESC LIMIT 5;"
```

**View failed syncs**:
```bash
sqlite3 ./data/sync.db "SELECT * FROM sync_job_items WHERE status='failed';"
```

### Manual Trigger

To run sync immediately (outside scheduled cron):

```bash
npm run sync:manual
```

Or via Docker:
```bash
docker exec notion2wp-sync npm run sync:manual
```

---

## Troubleshooting

### Common Issues

#### 1. "Notion authentication failed"

**Cause**: Invalid `NOTION_API_TOKEN` or database not shared with integration

**Solution**:
- Verify token format: `secret_...` (50 characters)
- Check database connection in Notion (Add connections → Select integration)

---

#### 2. "WordPress 401 Unauthorized"

**Cause**: Invalid credentials or Application Passwords not enabled

**Solution**:
- Verify `WP_USERNAME` matches WordPress account
- Re-generate Application Password
- Ensure WordPress REST API is enabled (check `{WP_URL}/wp-json`)

---

#### 3. "Image upload failed: 413 Payload Too Large"

**Cause**: Image exceeds WordPress upload limit

**Solution**:
- Increase `upload_max_filesize` in WordPress `php.ini`
- Or resize images in Notion before syncing

---

#### 4. "Telegram notification failed"

**Cause**: Invalid bot token or chat ID

**Solution**:
- Verify bot token via: `https://api.telegram.org/bot{TOKEN}/getMe`
- Verify chat ID via: `https://api.telegram.org/bot{TOKEN}/getUpdates`
- Ensure bot is added to channel (if using channel)

---

#### 5. "Database locked" error

**Cause**: Multiple sync processes running simultaneously

**Solution**:
- Stop all running instances
- Restart with single process: `docker-compose restart`

---

### Logs

**View live logs**:
```bash
# Docker
docker-compose logs -f

# Local
npm run start | tee logs/sync.log
```

**Log format**:
```
[2025-10-27T10:30:00Z] [INFO] SyncJob #42 started (scheduled)
[2025-10-27T10:30:05Z] [INFO] Found 3 pages with status=adding
[2025-10-27T10:30:10Z] [SUCCESS] Page "My Article" → WP Post #123
[2025-10-27T10:30:15Z] [ERROR] Page "Another Post": Image upload failed (retry 1/3)
[2025-10-27T10:30:20Z] [INFO] SyncJob #42 completed: 2 succeeded, 1 failed
```

---

## Testing

### Unit Tests

```bash
npm test
```

### Integration Tests (requires test credentials)

```bash
npm run test:integration
```

### E2E Test (manual workflow)

1. Create test Notion page
2. Add sample content + image
3. Set status to `"adding"`
4. Wait for sync notification
5. Verify WordPress draft exists
6. Clean up: Delete WP post, set Notion status to `"writing"`

---

## Monitoring

### Health Checks

Check if service is running:
```bash
docker ps | grep notion2wp-sync
```

Check last sync time:
```bash
sqlite3 ./data/sync.db "SELECT started_at, status FROM sync_jobs ORDER BY started_at DESC LIMIT 1;"
```

### Performance Metrics

View sync job statistics:
```bash
sqlite3 ./data/sync.db "
  SELECT 
    COUNT(*) as total_jobs,
    SUM(pages_succeeded) as total_synced,
    AVG(pages_succeeded) as avg_per_job
  FROM sync_jobs 
  WHERE status='completed';
"
```

---

## Maintenance

### Content Conversion (Notion → Markdown → HTML)

The service uses notion-to-md + marked to convert Notion blocks to WordPress-ready HTML. If you need a quick local test:

```ts
import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import { marked } from "marked";

const notion = new Client({ auth: process.env.NOTION_API_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });

async function convertToHtml(pageId: string) {
  const mdBlocks = await n2m.pageToMarkdown(pageId);
  const mdString = n2m.toMarkdownString(mdBlocks);
  const html = marked.parse(mdString);
  return html;
}
```

### Transport Security

- Notion API and Telegram Bot API: HTTPS/TLS only
- WordPress API: HTTPS/TLS (production) and HTTP (allowed for local/self-hosted dev)
- If using a self-signed certificate internally, set `WP_VERIFY_SSL=false` to bypass strict verification (dev only)

### Backup Database

```bash
# Stop service
docker-compose stop

# Backup database
cp ./data/sync.db ./data/sync.db.backup.$(date +%Y%m%d)

# Restart service
docker-compose start
```

### Clean Up Old Jobs

Delete sync job records older than 30 days:
```bash
sqlite3 ./data/sync.db "DELETE FROM sync_jobs WHERE started_at < datetime('now', '-30 days');"
```

### Update Dependencies

```bash
npm update
npm audit fix
docker-compose build --no-cache
```

---

## Production Deployment Checklist

- [ ] Set `NODE_ENV=production` in `.env`
- [ ] Configure persistent volume for `./data/sync.db`
- [ ] Set up log rotation (e.g., logrotate)
- [ ] Enable Docker auto-restart: `--restart unless-stopped`
- [ ] Configure monitoring (e.g., Prometheus, Grafana)
- [ ] Set up backup cron job for SQLite database
- [ ] Test rollback procedure (delete WP post/media)
- [ ] Verify Telegram notifications work
- [ ] Document disaster recovery process

---

## FAQ

**Q: Can I sync multiple Notion databases?**  
A: Not in MVP. Future version will support multiple databases via config file.

**Q: Will it sync changes to already-published posts?**  
A: No. MVP only creates new drafts. Bidirectional sync planned for v2.

**Q: What happens if I manually delete a WordPress post?**  
A: Mapping remains in database. Future sync won't recreate (idempotency not in MVP).

**Q: Can I customize the HTML output format?**  
A: Yes, edit `src/lib/content-converter.ts` to modify block-to-HTML rules.

**Q: How do I pause syncing temporarily?**  
A: Stop the Docker container: `docker-compose stop`. Restart when ready.

---

## Support

- **Documentation**: See `/specs/001-notion2wp-sync/` for detailed specs
- **Issues**: Report bugs via GitHub Issues
- **Logs**: Check `docker-compose logs` for error details

---

**Next Steps**: See [data-model.md](./data-model.md) and [api-contracts.md](./contracts/api-contracts.md) for implementation details.
