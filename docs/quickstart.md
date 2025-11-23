# Quickstart Guide: Notion to WordPress Sync

**Last Updated**: 2025-11-23  
**Version**: 1.0

## Introduction

This guide helps you deploy **Notion2WordPress** - an automated service that syncs your Notion pages to WordPress as draft posts. Perfect for content creators who draft in Notion and publish on WordPress.

**What you'll need:**
- 15-20 minutes of setup time
- Docker or Docker Compose installed
- Notion and WordPress accounts
- Telegram accounts (optional)

**What you'll get:**
- Automatic syncing every 5 minutes (configurable)
- Images uploaded to WordPress media library
- Telegram notifications for sync status (optional)
- Draft posts ready for review before publishing

> **⚠️ Important Limitations (MVP)**
> - Only **new** pages are synced (no updates to existing posts)
> - Posts are created as **drafts only** (manual publish required)
> - Deleting a Notion page won't delete the WordPress post
> - No category/tag syncing (WordPress defaults apply)

---

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Step 1: Install Docker](#step-1-install-docker)
3. [Step 2: Get Your Credentials](#step-2-get-your-credentials)
4. [Step 3: Configure Environment](#step-3-configure-environment)
5. [Step 4: Deploy with Docker](#step-4-deploy-with-docker)
6. [Step 5: Verify Deployment](#step-5-verify-deployment)
7. [How to Use](#how-to-use)
8. [Troubleshooting](#troubleshooting)
9. [Managing Your Deployment](#managing-your-deployment)
10. [Advanced Configuration](#advanced-configuration)
11. [Security Best Practices](#security-best-practices)
12. [Getting Help](#getting-help)

---

## Prerequisites

Before starting, ensure you have:

### Required Accounts
- **Notion** account with a database to sync
- **WordPress** site with REST API enabled (check: `https://your-site.com/wp-json`)
- **Telegram** account (for sync notifications)(optional)

### Required Access
- **Notion**: Ability to create integrations
- **WordPress**: Author or Editor role on your site
- **Telegram**: Ability to create bots via @BotFather (optional)

### Required Software
- **Docker** OR **Docker Compose**
- **Text editor** for editing configuration files

> **💡 Don't have Docker?** See [Step 1: Install Docker](#step-1-install-docker) below.

---

## Step 1: Install Docker

### Option A: Docker Desktop (Recommended for Beginners)

Docker Desktop includes both Docker and Docker Compose.

**For macOS:**
1. Download: [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/)
2. Open the `.dmg` file and drag Docker to Applications
3. Launch Docker Desktop from Applications
4. Verify installation:
   ```bash
   docker --version
   docker compose version
   ```

**For Windows:**
1. Download: [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/)
2. Run the installer and follow prompts
3. Launch Docker Desktop
4. Verify installation:
   ```bash
   docker --version
   docker compose version
   ```

**For Linux:**
1. Install Docker Desktop: [Docker Desktop for Linux](https://docs.docker.com/desktop/install/linux-install/)
2. Or install Docker Engine directly: [Docker Engine Install](https://docs.docker.com/engine/install/)
3. Verify installation:
   ```bash
   docker --version
   docker compose version
   ```

> **✅ Installation Complete?** You should see version numbers when running the verify commands above.

---

## Step 2: Get Your Credentials

You'll need credentials from three services. Follow these steps carefully.

### 2.1 Notion Integration Token

1. Visit **https://www.notion.so/my-integrations**
2. Click **"New integration"**
3. Fill in:
   - **Name**: `Notion2WordPress Sync` (or any name you prefer)
   - **Associated workspace**: Select your workspace
4. Under **Capabilities**, enable:
   - ✅ **Read content**
   - ✅ **Update content**
5. Click **"Submit"**
6. Click **"Show"** and copy the **Internal Integration Token** (starts with `secret_`)
7. Save this token - you'll need it for your `.env` file

> **⚠️ Critical Step**: You must share your database with this integration!  
> Open your Notion database → Click **"..."** (top right) → **"Add connections"** → Select your integration

### 2.2 Notion Database ID

You need a Notion database with a status property to track sync state.

![Status property example](./img/notion_database_example.png)
![Database ID location](./img/notion_datasource_id.png)

**Setup your database:**

1. **Create or open** a Notion database
2. **Add a Status property** (if not already present):
   - Click **"+"** to add property
   - Choose **"Status"** type
   - Name it `status` (or customize via `NOTION_PAGE_PROPERTY_NAME` env var)
3. **Configure status options**:
   - `writing` - Pages you're still drafting (ignored by sync)
   - `adding` - Ready to sync to WordPress
   - `done` - Successfully synced
   - `error` - Sync failed

4. **Get the Database ID**:
   - Open your database as a **full page** (not inline)
   - Look at the browser URL:
     ```
     https://www.notion.so/{workspace-name}/{DATABASE_ID}?v=...
     ```
   - Copy the **32-character string** (the part between workspace name and `?v=`)
   - Example: `1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p`

5. **Share database with integration**:
   - In your database, click **"..."** (top right)
   - Select **"Add connections"**
   - Choose the integration you created in step 2.1

### 2.3 WordPress Application Password

1. Log in to your **WordPress admin panel**
2. Navigate to: **Users → Profile** (or **Users → Your Profile**)
3. Scroll down to **"Application Passwords"** section
4. Enter a name: `Notion2WordPress Sync`
5. Click **"Add New Application Password"**
6. **Copy the generated password** immediately (format: `xxxx xxxx xxxx xxxx xxxx xxxx`)
7. Save this password - you can't view it again

> **📝 Note**: Your WordPress account must have **Author** or **Editor** role.  
> **⚠️ Security**: Never use your main WordPress password. Application Passwords can be revoked anytime.

### 2.4 Telegram Bot Token (optional)

1. Open **Telegram** app
2. Search for **@BotFather** (official bot with blue checkmark)
3. Send command: `/newbot`
4. Follow the prompts:
   - Choose a **display name** for your bot (e.g., "Notion2WP Notifier")
   - Choose a **username** (must end with `bot`, e.g., "notion2wp_notifier_bot")
5. **Copy the bot token** (format: `1234567890:ABCdef-GHIjklMNOpqrSTUvwxYZ`)
6. Save this token

### 2.5 Telegram Chat ID (optional)

**For personal notifications:**

1. **Start a chat** with your bot (search for it in Telegram and click "Start")
2. Send any message to your bot (e.g., "hello")
3. Open this URL in your browser (replace `{YOUR_BOT_TOKEN}` with your actual token):
   ```
   https://api.telegram.org/bot{YOUR_BOT_TOKEN}/getUpdates
   ```
4. Look for `"chat":{"id":123456789}` in the JSON response
5. Copy the **numeric ID** (e.g., `123456789`)

**For channel notifications:**

1. Create a **Telegram channel** (or use existing one)
2. Add your bot as an **administrator**:
   - Open channel → **Settings** → **Administrators** → **Add Administrator**
   - Search for your bot and add it
3. Use the channel username (e.g., `@your_channel_name`) as Chat ID, or:
4. Post a message in the channel, then check the `getUpdates` URL above for the numeric channel ID

> **✅ Credentials Complete?** You should now have 5 pieces of information:
> 1. Notion Integration Token
> 2. Notion Database ID
> 3. WordPress API URL
> 4. WordPress Username
> 5. WordPress Application Password

---

## Step 3: Configure Environment

Now we'll create a configuration file with your credentials.

### 3.1 Create Configuration File

Create a file named `.env` in your working directory. You can use any text editor.

```bash
mkdir notion2wp && cd notion2wp # Create and enter working directory
curl -fsSL -o .env https://raw.githubusercontent.com/ramen4598/Notion2Wordpress/refs/heads/main/.env.example
```

**Or copy [.env.example](../.env.example) and rename it to `.env`.(version specific)**

### 3.2 Fill In Your Credentials

Replace the placeholder values with your actual credentials from Step 2:

| Variable | Where to Get It | Example Format |
|----------|----------------|----------------|
| `NOTION_API_TOKEN` | Step 2.1 - Notion integrations page | `secret_ABC123...` (50 chars) |
| `NOTION_DATASOURCE_ID` | Step 2.2 - Database URL | `1a2b3c4d5e6f...` (32 chars, no hyphens) |
| `WP_API_URL` | Your WordPress site + `/wp-json` | `https://myblog.com/wp-json` |
| `WP_USERNAME` | Your WordPress login username | `john_doe` |
| `WP_APP_PASSWORD` | Step 2.3 - Application Password | `xxxx xxxx xxxx xxxx xxxx xxxx` |
| `TELEGRAM_BOT_TOKEN` | Step 2.4 - @BotFather | `1234567890:ABCdef...` |
| `TELEGRAM_CHAT_ID` | Step 2.5 - getUpdates API | `123456789` or `@channel_name` |

if you don't want Telegram notifications, set:
```
# Disable Telegram notifications
TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

### 3.3 Important Notes

> **🔒 HTTPS Required (Production)**  
> - Notion API: HTTPS only (enforced)
> - Telegram API: HTTPS only (enforced)
> - WordPress API: **HTTPS strongly recommended** for production
>   - HTTP allowed for: `localhost`, `127.0.0.1`, local development
>   - HTTP allowed for: self-hosted internal networks
>   - Otherwise use HTTPS to protect credentials

> **⚠️ Security Warning**  
> - Never commit `.env` file to Git/GitHub
> - Keep your `.env` file private
> - Don't share credentials in screenshots or logs

### 3.4 Verify Your Configuration

Double-check these common mistakes:

- [ ] Notion database is **shared with the integration** (Step 2.2, item 5)
- [ ] WordPress API URL ends with `/wp-json` (not just the domain)
- [ ] WordPress Application Password has **no spaces removed** (keep the spaces)
- [ ] Telegram bot has been **started** (you sent at least one message)
- [ ] All tokens are **complete** (not truncated when copying)

---

## Step 4: Deploy with Docker

Choose your preferred deployment method. **Option A (Docker Compose)** is recommended for most users.

### Option A: Docker Compose (Recommended)

Docker Compose is the easiest way to manage your deployment.

#### 4.1 Create docker-compose.yml

Create a file named `docker-compose.yml` in the same directory as your `.env` file:

```bash
curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/ramen4598/Notion2Wordpress/refs/heads/main/docker-compose.yml
```

Or copy and paste this [template](../docker-compose.yml):

#### 4.2 Start the Service

Run this command in the same directory:

```bash
docker compose up -d
```

**What this command does:**
- `docker compose up` - Starts the service
- `-d` - Runs in background (detached mode)

**You should see:**
```
[+] Running 2/2
 ✔ Network notion2wordpress_default  Created
 ✔ Container notion2wp               Started
```

#### 4.3 Verify It's Running

```bash
docker compose ps
```

**Expected output:**
```
NAME        IMAGE                                          STATUS
notion2wp   ghcr.io/ramen4598/notion2wordpress:latest      Up X seconds
```

> **✅ Success!** Your sync service is now running in the background.

---

### Option B: Docker Run (Alternative)

If you prefer not to use Docker Compose, you can run Docker directly.

#### 4.1 Create Data Directory

```bash
mkdir -p data
```

#### 4.2 Start the Container

**Copy and paste this command** (make sure you're in the directory with your `.env` file):

```bash
docker run -d \
  --name notion2wp \
  --restart unless-stopped \
  --env-file .env \
  -v "$(pwd)/data:/app/data" \
  -e NODE_ENV=production \
  ghcr.io/ramen4598/notion2wordpress:latest
```

**Command breakdown:**
- `-d` - Run in background
- `--name notion2wp` - Name the container "notion2wp"
- `--restart unless-stopped` - Auto-restart if it crashes
- `--env-file .env` - Load environment variables from .env file
- `-v "$(pwd)/data:/app/data"` - Mount data directory (for database)
- `-e NODE_ENV=production` - Set production mode
- `ghcr.io/ramen4598/notion2wordpress:latest` - Use official pre-built image

#### 4.3 Verify It's Running

```bash
docker ps | grep notion2wp
```

**Expected output:**
```
CONTAINER ID   IMAGE                                          STATUS
abc123def456   ghcr.io/ramen4598/notion2wordpress:latest      Up X seconds
```

> **✅ Success!** Your sync service is now running.

---

## Step 5: Verify Deployment

Let's make sure everything is working correctly.

### 5.1 Check Logs

**Docker Compose:**
```bash
docker compose logs -f
```

**Docker Run:**
```bash
docker logs -f notion2wp
```

Press `Ctrl+C` to stop viewing logs.


### 5.2 Check Database

The database file should be created automatically:

```bash
ls -lh data/
```

**Expected output:**
```
-rw-r--r-- 1 user user 20K Nov 15 10:30 sync.db
```

### 5.3 Test First Sync

1. **Create a test page** in your Notion database
2. **Set status** to `writing` (default)
3. **Add some content** (text, heading, image - optional)
4. **Change status** to `adding`
5. **Wait up to 5 minutes** (default sync interval)
6. **Check Telegram** for notification
7. **Check WordPress** admin panel → Posts → Drafts

> **✅ Success?** You should see:
> - Telegram message: "✅ Sync completed successfully"
> - WordPress draft post with your Notion content
> - Notion page status changed to `done`

> **❌ Didn't work?** See [Troubleshooting](#troubleshooting) section below.

---

## How to Use

### Daily Workflow

1. **Write in Notion**
   - Create pages in your synced database
   - Keep status as `writing` while drafting
   - Add text, headings, images, lists, etc.

2. **Trigger Sync**
   - Change status to `adding` when ready
   - Wait for next scheduled sync (default: 5 minutes)
   - Or manually trigger (see below)

3. **Review in WordPress**
   - Receive Telegram notification
   - Log in to WordPress admin
   - Find draft post in Posts → All Posts
   - Review content and images

4. **Publish**
   - Edit if needed
   - Click "Publish" when ready
   - Post goes live on your site

### Status Meanings

| Status | What It Means | Action |
|--------|---------------|--------|
| `writing` | You're still drafting | Sync will ignore this page |
| `adding` | Ready to sync | Sync will create WordPress draft |
| `done` | Successfully synced | Auto-set by system |
| `error` | Sync failed | Check logs, fix issue, set to `adding` again |

### Manual Sync (Optional)

To sync immediately without waiting for scheduled run:

**Docker Compose:**
```bash
docker ps // Find your container name
docker compose exec Container_Name node dist/cli/syncManual.js
```

**Docker Run:**
```bash
docker exec notion2wp node dist/cli/syncManual.js
```

### Viewing Sync History

Check recent activity:

**Docker Compose:**
```bash
docker compose logs --tail=50
```

**Docker Run:**
```bash
docker logs --tail=50 notion2wp
```

---

## Troubleshooting

### Quick Diagnostic Commands

**Check if container is running:**
```bash
# Docker Compose
docker compose ps

# Docker Run
docker ps | grep notion2wp
```

**View recent logs:**
```bash
# Docker Compose
docker compose logs --tail=100

# Docker Run
docker logs --tail=100 notion2wp
```

**Restart service:**
```bash
# Docker Compose
docker compose restart

# Docker Run
docker restart notion2wp
```

---

### Common Issues

#### Issue 1: Container Won't Start

**Symptoms:**
- Container exits immediately after starting
- `docker compose ps` shows "Exited (1)"

**Possible Causes & Solutions:**

1. **Missing or invalid .env file**
   ```bash
   # Check if .env exists
   ls -la .env
   
   # Verify it contains required variables
   cat .env | grep -E "NOTION_API_TOKEN|WP_API_URL"
   ```
   **Solution**: Ensure `.env` file exists and has all required variables from Step 3.

2. **Invalid environment variable format**
   - Check logs: `docker compose logs`
   - Look for: `[ERROR] Invalid environment variable`
   **Solution**: Review `.env` format - no quotes needed, one variable per line.

3. **Docker permission issues (Linux)**
   ```bash
   # Check current user permissions
   groups $USER | grep docker
   ```
   **Solution**: Add user to docker group:
   ```bash
   sudo usermod -aG docker $USER
   newgrp docker
   ```

---

#### Issue 2: "Notion authentication failed" Error

**Causes & Solutions:**

1. **Invalid NOTION_API_TOKEN**
   - Token must start with `ntn`
   - **Solution**: Re-generate token at https://www.notion.so/my-integrations

2. **Database not shared with integration** ⚠️ Most common issue!
   - **Solution**: 
     1. Open your Notion database
     2. Click **"..."** (top right corner)
     3. Select **"Add connections"**
     4. Choose your integration
     5. Confirm the connection

3. **Integration lacks required capabilities**
   - **Solution**: Edit integration at https://www.notion.so/my-integrations
   - Ensure both **"Read content"** and **"Update content"** are checked

---

#### Issue 3: "WordPress 401 Unauthorized" Error

**Causes & Solutions:**

1. **Wrong WP_USERNAME**
   - **Solution**: Use your WordPress login username, not email or display name
   - Check: WordPress Admin → Users → All Users

2. **Invalid Application Password**
   - **Solution**: Generate a new one:
     1. WordPress Admin → Users → Profile
     2. Scroll to "Application Passwords"
     3. Create new password
     4. Copy **with spaces** (don't remove spaces!)

3. **Application Passwords not enabled**
   - **Check**: Visit `https://your-site.com/wp-json/wp/v2/posts`
   - If you see XML instead of JSON, REST API might be disabled
   - **Solution**: Check WordPress settings or contact hosting provider

4. **User lacks permission**
   - **Solution**: User must have **Author** or **Editor** role
   - Check: WordPress Admin → Users → All Users → Edit user → Role

**Test your credentials:**
```bash
# Replace with your details (keep spaces in password)
curl -u "username:xxxx xxxx xxxx xxxx xxxx xxxx" \
     https://your-site.com/wp-json/wp/v2/users/me
```

---

#### Issue 4: "Image upload failed" Errors

**Causes & Solutions:**

1. **413 Payload Too Large**
   - Image exceeds WordPress upload limit
   - **Solution**: Increase `upload_max_filesize` in WordPress:
     - cPanel/PHP settings
     - Or add to `wp-config.php`:
       ```php
       @ini_set('upload_max_size', '64M');
       @ini_set('post_max_size', '64M');
       ```
   - **Workaround**: Compress images in Notion before syncing

2. **Timeout errors**
   - Large images taking too long to download
   - **Solution**: Increase timeout in `.env`:
     ```bash
     IMAGE_DOWNLOAD_TIMEOUT_MS=60000  # 60 seconds
     ```

3. **Network connection issues**
   - Check logs for specific error
   - **Solution**: Verify internet connectivity
   ```bash
   # Test Notion image access
   docker compose exec notion2wp ping -c 3 notion.so
   
   # Test WordPress access  
   docker compose exec notion2wp ping -c 3 your-site.com
   ```

4. **WordPress media permissions**
   - **Solution**: Check WordPress uploads directory permissions
   - Should be writable (755 or 775)

---

#### Issue 5: "Telegram notification failed" Error

**Causes & Solutions:**

1. **Invalid TELEGRAM_BOT_TOKEN**
   - **Test your token:**
     ```bash
     # Replace with your token
     curl https://api.telegram.org/botYOUR_BOT_TOKEN/getMe
     ```
   - Should return JSON with bot info
   - **Solution**: If error, re-generate token from @BotFather

2. **Wrong TELEGRAM_CHAT_ID**
   - **Get your chat ID:**
     ```bash
     # 1. Send message to your bot
     # 2. Run this command (replace token):
     curl https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
     ```
   - Look for `"chat":{"id":123456789}`
   - **Solution**: Update chat ID in `.env`

3. **Bot not started by user**
   - For personal chats, you must click "Start" button
   - **Solution**: Open bot in Telegram and click "Start"

4. **Bot not added to channel**
   - For channel notifications
   - **Solution**: Add bot as administrator in channel settings

5. **Want to disable Telegram?**
   - Set in `.env`:
     ```bash
     TELEGRAM_ENABLED=false
     TELEGRAM_BOT_TOKEN=
     TELEGRAM_CHAT_ID=
     ```

---

#### Issue 6: "Database locked" Error

**Cause:** Multiple processes trying to access database simultaneously.

**Solutions:**

1. **Check for multiple containers:**
   ```bash
   docker ps -a | grep notion2wp
   ```
   **Solution**: Stop all instances, keep only one:
   ```bash
   docker stop $(docker ps -aq -f name=notion2wp)
   docker compose up -d
   ```

2. **Manual sync running during scheduled sync:**
   - **Solution**: Wait for current sync to finish
   - Check logs: `docker compose logs -f`

3. **Database file permissions issue:**
   ```bash
   # Check permissions
   ls -la data/sync.db
   ```
   **Solution**: Ensure Docker can write to data directory:

---

#### Issue 7: No Sync Happening

**Symptoms:**
- Container running but no syncs occur
- No Telegram notifications
- Notion pages stay in "adding" status

**Diagnostic Steps:**

1. **Check logs for errors:**
   ```bash
   docker compose logs --tail=200 | grep ERROR
   ```

2. **Verify cron schedule:**
   ```bash
   docker compose logs | grep "Scheduled sync"
   ```
   Should show: `[INFO] Scheduled sync job triggered`

3. **Check database exists:**
   ```bash
   ls -lh data/sync.db
   ```

4. **Verify pages are in correct status:**
   - Notion database: status must be `adding`
   - Status `writing` is ignored by design

5. **Test manual sync:**
   ```bash
   docker compose exec notion2wp node dist/cli/syncManual.js
   ```
   Watch output for specific errors

**Common Solutions:**

- **Wait 5 minutes** - Default sync interval
- **Check Notion database is shared** - Most common issue
- **Restart container** - `docker compose restart`
- **Check all credentials** - Review Step 3 checklist

---

#### Issue 8: Images Not Appearing in WordPress

**Symptoms:**
- Post created successfully
- Text content is correct
- Images missing or broken

**Causes & Solutions:**

1. **Images uploaded but not embedded**
   - Check WordPress Media Library
   - **Solution**: If images exist but not in post, this might be a bug.
   - Please make an issue on GitHub with information.

2. **Image URL access blocked**
   - Notion image URLs may be temporary
   - **Solution**: Ensure sync completes before URLs expire (usually 1 hour)

3. **WordPress media library full**
   - Check hosting storage limits
   - **Solution**: Upgrade hosting plan or clean up old media

4. **Image format not supported**
   - **Solution**: Use common formats: JPG, PNG, GIF, WebP
   - Avoid: HEIC, TIFF, large SVG files

---

#### Issue 9: Container Keeps Restarting

**Symptoms:**
```bash
docker compose ps
# Shows: Restarting (1) 2 seconds ago
```

**Diagnostic:**
```bash
# Check what's causing crashes
docker compose logs --tail=50
```

**Common Causes:**

1. **Missing environment variables** - See Issue 1
2. **Invalid configuration format** - Check `.env` syntax
3. **Port conflict** - Not applicable (this service doesn't expose ports)
4. **Out of memory** - Check Docker Desktop resources
5. **Corrupted database** - Backup and delete `data/sync.db`, let it recreate

---

### Getting More Help

**Before asking for help, collect this information:**

1. **Your environment:**
   ```bash
   docker --version
   docker compose version
   ```

2. **Container status:**
   ```bash
   docker compose ps
   ```

3. **Recent logs:**
   ```bash
   docker compose logs --tail=100 > logs.txt
   ```

4. **Environment variables** (remove sensitive values):
   ```bash
   cat .env | sed 's/=.*$/=***REDACTED***/' > env-template.txt
   ```

5. **Error messages** - Copy the complete error from logs

**Where to get help:**
- GitHub Issues: https://github.com/ramen4598/Notion2Wordpress/issues
- Include: Environment, logs, and steps to reproduce

---

## Managing Your Deployment

### Viewing Logs

**Real-time logs (follow mode):**
```bash
# Docker Compose
docker compose logs -f

# Docker Run  
docker logs -f notion2wp
```

**Last 100 lines:**
```bash
# Docker Compose
docker compose logs --tail=100

# Docker Run
docker logs --tail=100 notion2wp
```

**Filter for errors only:**
```bash
docker compose logs | grep ERROR
```

### Stopping the Service

```bash
# Docker Compose
docker compose stop

# Docker Run
docker stop notion2wp
```

### Starting the Service

```bash
# Docker Compose
docker compose start

# Docker Run
docker start notion2wp
```

### Restarting the Service

**After changing .env file:**
```bash
# Docker Compose
docker compose restart

# Docker Run
docker restart notion2wp
```

### Updating to Latest Version

**Docker Compose:**
```bash
docker compose pull
docker compose up -d --force-recreate
```

**Docker Run:**
```bash
docker pull ghcr.io/ramen4598/notion2wordpress:latest
docker stop notion2wp
docker rm notion2wp
# Then run the docker run command from Step 4 again
```

### Backing Up Your Database

**Important:** Always backup before updates!

```bash
# Stop service
docker compose stop

# Create backup
cp data/sync.db data/sync.db.backup.$(date +%Y%m%d_%H%M%S)

# Verify backup
ls -lh data/*.backup*

# Restart service
docker compose start
```

**Restore from backup:**
```bash
docker compose stop
cp data/sync.db.backup.YYYYMMDD_HHMMSS data/sync.db
docker compose start
```

### Removing Everything

**To completely remove the service:**

```bash
# Docker Compose
docker compose down
rm -rf data/  # Deletes database!
rm .env
rm docker-compose.yml

# Docker Run
docker stop notion2wp
docker rm notion2wp
rm -rf data/
rm .env
```

> **⚠️ Warning:** This deletes all sync history. Backup first if needed!

---

## Advanced Configuration

<details>
<summary><b>Click to expand advanced settings</b></summary>

### Optional Environment Variables

These settings have sensible defaults but can be customized:

```bash
# ============================================
# Logging Configuration  
# ============================================
LOG_LEVEL=warn
# Options: debug, info, warn, error
# Use "debug" for troubleshooting

NODE_ENV=production
# Options: development, production

# ============================================
# Notion Configuration
# ============================================
NOTION_PAGE_PROPERTY_NAME=status
# Name of status property in your Notion database
# Change if you use different property name

# ============================================
# Image Download Configuration
# ============================================
MAX_CONCURRENT_IMAGE_DOWNLOADS=3
# Number of images to download simultaneously
# Increase for faster sync (if bandwidth allows)

IMAGE_DOWNLOAD_TIMEOUT_MS=30000
# Timeout in milliseconds (30 seconds default)
# Increase for slow connections or large images

# ============================================
# Retry Configuration
# ============================================
MAX_RETRY_ATTEMPTS=3
# How many times to retry failed operations

RETRY_INITIAL_DELAY_MS=1000
# Initial delay before first retry (1 second)

RETRY_MAX_DELAY_MS=30000
# Maximum delay between retries (30 seconds)

RETRY_BACKOFF_MULTIPLIER=2
# Exponential backoff multiplier
# Delay doubles each retry: 1s → 2s → 4s → 8s...

# ============================================
# Docker Image Version
# ============================================
N2W_VERSION=latest
# Docker image tag to use
# Options: latest, v1.0.0, v1.1.0, etc.
# Change in docker-compose.yml or docker run command
```

### Custom Sync Schedules

The `SYNC_SCHEDULE` variable uses [cron expression format](https://crontab.guru/):

```bash
# Pattern: minute hour day month weekday
# Examples:

# Every 5 minutes (default)
SYNC_SCHEDULE="*/5 * * * *"

# Every 10 minutes  
SYNC_SCHEDULE="*/10 * * * *"

# Every 30 minutes
SYNC_SCHEDULE="*/30 * * * *"

# Every hour at :00
SYNC_SCHEDULE="0 * * * *"

# Every 3 hours
SYNC_SCHEDULE="0 */3 * * *"

# Every day at 2:00 AM
SYNC_SCHEDULE="0 2 * * *"

# Every day at 9:00 AM and 6:00 PM
SYNC_SCHEDULE="0 9,18 * * *"

# Monday through Friday at 9:00 AM
SYNC_SCHEDULE="0 9 * * 1-5"

# First day of every month at midnight
SYNC_SCHEDULE="0 0 1 * *"
```

**Testing cron expressions:** https://crontab.guru/

### Performance Tuning

**For many images:**
```bash
MAX_CONCURRENT_IMAGE_DOWNLOADS=5
IMAGE_DOWNLOAD_TIMEOUT_MS=60000
```

**For slow networks:**
```bash
MAX_CONCURRENT_IMAGE_DOWNLOADS=1
IMAGE_DOWNLOAD_TIMEOUT_MS=120000
MAX_RETRY_ATTEMPTS=5
RETRY_MAX_DELAY_MS=60000
```

**For large databases:**
```bash
SYNC_SCHEDULE="*/15 * * * *"  # Sync every 15 min instead of 5
LOG_LEVEL=warn  # Reduce log verbosity
```

### Running Without Telegram

If you don't want notifications:

```bash
TELEGRAM_ENABLED=false
# No need to set TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID
```

### Using Specific Version

To pin to a specific version instead of `latest`:

**.env** - Edit `.env`:
```
N2W_VERSION=1.0.0
```

**Docker Run:**
```bash
docker run ... ghcr.io/ramen4598/notion2wordpress:v1.0.0
```

**Available versions:** https://github.com/ramen4598/Notion2Wordpress/pkgs/container/notion2wordpress

</details>

---

## Security Best Practices

### Essential Security Measures

1. **Use HTTPS for Production**
   - ✅ **Required**: Notion API (enforced)
   - ✅ **Required**: Telegram API (enforced)  
   - ⚠️ **Strongly recommended**: WordPress API
   - ℹ️ **Acceptable for HTTP**: `localhost`, `127.0.0.1`, local dev, internal networks

2. **Protect Your .env File**
   ```bash
   # Set restrictive permissions
   chmod 600 .env
   
   # Never commit to Git
   echo ".env" >> .gitignore
   
   # Don't include in Docker images
   # (Our setup mounts it as volume - correct approach)
   ```

3. **Rotate Credentials Regularly**
   - WordPress Application Passwords: Every 3-6 months
   - Notion Integration Token: If compromised or yearly
   - Telegram Bot Token: If compromised

4. **Limit WordPress User Permissions**
   - Use dedicated account for sync
   - Grant only **Author** or **Editor** role (not Administrator)
   - Use Application Passwords (never main password)

5. **Keep Docker Updated**
   ```bash
   # Update to latest image regularly
   docker compose pull
   docker compose up -d
   ```

6. **Backup Your Database**
   - Automated backups recommended
   - Test restore process
   - Keep backups secure (contain page mappings)

7. **Monitor Logs for Suspicious Activity**
   ```bash
   # Check for repeated failures (potential attack)
   docker compose logs | grep -i "fail\|error\|unauthorized"
   ```

8. **Network Security**
   - If self-hosting WordPress, use firewall rules
   - Consider VPN for WordPress admin access
   - Use strong WordPress admin password (separate from Application Password)

### Security Checklist

- [ ] `.env` file has restrictive permissions (600)
- [ ] `.env` is in `.gitignore`
- [ ] WordPress uses HTTPS in production
- [ ] Using Application Password (not main password)
- [ ] WordPress user has minimal required role
- [ ] Docker image is up-to-date
- [ ] Regular database backups configured
- [ ] Monitoring logs for errors

---

## Getting Help

### Before Requesting Help

1. **Check this guide** - Review [Troubleshooting](#troubleshooting) section
2. **Check logs** - Most issues show clear error messages
3. **Verify configuration** - Review [Step 3](#step-3-configure-environment) checklist
4. **Try manual sync** - Test with manual trigger command

### How to Report Issues

**Open a GitHub Issue:** https://github.com/ramen4598/Notion2Wordpress/issues

**Include this information:**

1. **Environment:**
   ```bash
   docker --version
   docker compose version
   uname -a  # (Linux/macOS)
   ```

2. **Container status:**
   ```bash
   docker compose ps
   ```

3. **Logs** (last 100 lines, **remove sensitive data**):
   ```bash
   docker compose logs --tail=100 > logs.txt
   ```

4. **Configuration** (remove all tokens/passwords):
   ```bash
   # Example sanitized .env:
   NOTION_API_TOKEN=secret_***
   NOTION_DATASOURCE_ID=abc123***
   WP_API_URL=https://mysite.com/wp-json
   # ...etc
   ```

5. **Steps to reproduce**
6. **Expected vs actual behavior**

### Additional Resources

- **Full Documentation**: See `README.md` in project root
- **Developer Guide**: See `docs/quickstart-dev.md` for development setup
- **Technical Spec**: See `docs/spec.md` for architecture details
- **Diagram**: See `docs/diagram/` for some details
- **Project Repository**: https://github.com/ramen4598/Notion2Wordpress

---

## What's Next?

### Current Limitations (MVP)

This is an MVP (Minimum Viable Product) release with intentional limitations:

1. **No update synchronization** - Only new pages are synced
   - Editing a synced Notion page won't update WordPress
   - **Workaround**: Edit post directly in WordPress

2. **No auto-publish** - Posts created as drafts only
   - Manual review and publish required in WordPress
   - **By design**: Ensures content review before going live

3. **No deletion sync** - Deleting Notion page won't delete WordPress post
   - **Workaround**: Delete post manually in WordPress

4. **No category/tag sync** - WordPress defaults applied
   - **Workaround**: Add categories/tags in WordPress after sync

5. **Limited idempotency** - Changing status to `adding` multiple times creates duplicates
   - **Workaround**: Only set to `adding` once per page

### Planned Features

Future releases may include:
- Category and tag mapping
- Custom field mapping
- Improved idempotency
- WordPress post status control

### Contributing

Interested in contributing? Check:
- I'm junior programmer. Please advise me.
- GitHub Issues for open tasks
- `docs/quickstart-dev.md` for development setup
- Project README for contribution guidelines

---

**🎉 Congratulations!** You've successfully deployed Notion2WordPress. Happy syncing! :)
