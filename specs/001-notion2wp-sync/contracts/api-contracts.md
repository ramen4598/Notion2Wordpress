# API Contracts: Notion to WordPress Sync

**Date**: 2025-10-28  
**Feature**: 001-notion2wp-sync  
**Version**: 2.0

## Overview

This document defines the internal service contracts for the sync system based on the operation sequence defined in data-model.md. All contracts follow the creation/rollback order specified in the sequence diagrams.

---

## 1. Sync Orchestrator Contract

### 1.1 Execute Sync Job

**Purpose**: Orchestrate full sync workflow following the sequence diagram

**Method**: `SyncOrchestrator.executeSyncJob()`

**Input Parameters**:
```typescript
interface ExecuteSyncJobParams {
  jobType: 'scheduled' | 'manual';
}
```

**Output**:
```typescript
interface ExecuteSyncJobResponse {
  jobId: number;                // SyncJob ID from database
  status: 'completed' | 'failed';
  pagesProcessed: number;
  pagesSucceeded: number;
  pagesFailed: number;
  errors: SyncError[];
}

interface SyncError {
  notionPageId: string;
  pageTitle: string;
  errorMessage: string;
  retryCount: number;
}
```

**Workflow (Success Path)**:
```
1. Create SyncJob (status=running)
2. Query Notion pages (status=adding, incremental scan)
3. FOR EACH page:
   a. Create SyncJobItem (status=pending)
   b. Get page blocks from Notion
   c. Convert blocks to Markdown then HTML
   d. Create WordPress Post (draft)
   e. FOR EACH image in blocks:
      - Create ImageAsset (status=pending)
      - Download image from Notion
      - Upload to WordPress Media
      - Update ImageAsset (status=uploaded, wp_media_id, wp_media_url)
   f. Create PagePostMap (notion_page_id, wp_post_id)
   g. Update Notion page status to 'complete'
   h. Update SyncJobItem (status=success)
   i. Update SyncJob counters (pages_succeeded++)
4. Update SyncJob (status=completed)
5. Send Telegram notification (success)
```

**Workflow (Failure Path)**:
```
1-3. Same as success path until error occurs
   ON ERROR at any step:
   a. Update ImageAsset (status=failed) for failed images
   b. Delete WordPress Media (foreach wp_media_id in ImageAsset)
   c. Delete WordPress Post (if created)
   d. Retry up to 3 times with exponential backoff (1s, 2s, 4s)
   e. If max retries exceeded:
      - Update Notion page status to 'error'
      - Update SyncJobItem (status=failed, error_message)
      - Update SyncJob counters (pages_failed++)
4. Update SyncJob (status=failed)
5. Send Telegram notification (failure with error summary)
```

**Error Handling**:
- Catch all errors per page
- Rollback WordPress resources (delete post/media via API)
- Continue processing remaining pages
- Report all errors in final notification

---

## 2. Notion Service Contract

### 2.1 Query Pages with Status Filter

**Purpose**: Retrieve pages from Notion datasource with incremental scanning

**Method**: `NotionService.queryPages()`

**Input Parameters**:
```typescript
interface QueryPagesParams {
  datasourceId: string;           // Notion datasouce UUID
  lastSyncTimestamp?: string;   // ISO 8601 for incremental scan
  statusFilter: 'adding';       // Only sync pages ready for upload
}
```

**Output**:
```typescript
interface QueryPagesResponse {
  pages: NotionPage[];
  hasMore: boolean;
  nextCursor?: string;
}

interface NotionPage {
  id: string;                   // Page UUID
  title: string;
  status: 'writing' | 'adding' | 'complete' | 'error';
  lastEditedTime: string;       // ISO 8601
  createdTime: string;          // ISO 8601
  properties: Record<string, any>;
}
```

**Error Conditions**:
- `401 Unauthorized`: Invalid Notion API token
- `404 Not Found`: Datasource doesn't exist or no access
- `429 Too Many Requests`: Rate limit exceeded (3 req/s)
- `500 Internal Server Error`: Notion API error

**Retry Policy**: 3 attempts with exponential backoff (1s, 2s, 4s)

**Transport**: HTTPS/TLS (Notion API endpoint: https://api.notion.com)

---

### 2.2 Retrieve Page Blocks

**Purpose**: Fetch content blocks (paragraphs, images, headings) from a page

**Method**: `NotionService.getPageBlocks()`

**Input Parameters**:
```typescript
interface GetPageBlocksParams {
  pageId: string;               // Notion page UUID
}
```

**Output**:
```typescript
interface GetPageBlocksResponse {
  blocks: Block[];
}

interface Block {
  id: string;                   // Block UUID
  type: string;                 // 'paragraph', 'heading_1', 'image', etc.
  [type]: {
    richText?: RichText[];      // For text blocks
    caption?: RichText[];       // For images
    url?: string;               // For external images
    file?: { url: string };     // For uploaded images (signed URL)
  };
}

interface RichText {
  type: 'text';
  text: { content: string };
  annotations: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
  };
}
```

**Error Conditions**:
- `401 Unauthorized`: Invalid token
- `404 Not Found`: Page doesn't exist or no access
- `429 Too Many Requests`: Rate limit exceeded

**Retry Policy**: 3 attempts with exponential backoff

**Transport**: HTTPS/TLS

**Note on Image URLs**: Signed URLs from `file.url` expire after ~1 hour. **Download immediately** after retrieving blocks.

---

### 2.3 Update Page Status

**Purpose**: Update page `status` property after sync completion/failure

**Method**: `NotionService.updatePageStatus()`

**Input Parameters**:
```typescript
interface UpdatePageStatusParams {
  pageId: string;
  status: 'complete' | 'error';
}
```

**Output**:
```typescript
interface UpdatePageStatusResponse {
  success: boolean;
  updatedTime: string;          // ISO 8601
}
```

**Error Conditions**:
- `401 Unauthorized`: Invalid token
- `404 Not Found`: Page doesn't exist
- `400 Bad Request`: Invalid status value
- `429 Too Many Requests`: Rate limit exceeded

**Retry Policy**: 3 attempts with exponential backoff

**Transport**: HTTPS/TLS

---

## 3. Content Converter Contract

### 3.1 Convert Notion Blocks to HTML

**Purpose**: Convert Notion blocks to WordPress-compatible HTML via Markdown

**Method**: `ContentConverter.convertToHTML()`

**Input Parameters**:
```typescript
interface ConvertToHTMLParams {
  blocks: Block[];              // Notion blocks from NotionService
  notionClient: Client;         // For notion-to-md library
}
```

**Output**:
```typescript
interface ConvertToHTMLResponse {
  html: string;                 // WordPress-ready HTML
  images: ImageReference[];     // Extracted image references
}

interface ImageReference {
  blockId: string;              // Notion block ID
  url: string;                  // Notion signed URL (temporary)
  altText?: string;             // From caption
}
```

**Libraries Used**:
- **notion-to-md** (https://github.com/souvikinator/notion-to-md)
  - Purpose: Convert Notion blocks to Markdown
  - Installation: `npm install notion-to-md @notionhq/client`
  
- **marked** (https://github.com/markedjs/marked)
  - Purpose: Convert Markdown to HTML
  - Installation: `npm install marked`

**Usage Example**:
```typescript
import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import { marked } from "marked";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });

async function convertPage(pageId: string) {
  const mdBlocks = await n2m.pageToMarkdown(pageId);
  const mdString = n2m.toMarkdownString(mdBlocks);
  const html = marked.parse(mdString);
  return html;
}
```

**Error Conditions**:
- `ConversionError`: Unsupported block type (log warning, skip block)
- `ParseError`: Invalid Markdown structure

**Retry Policy**: No retry (pure transformation, deterministic)

---

## 4. WordPress Service Contract

### 4.1 Create Draft Post

**Purpose**: Create a new WordPress post in draft status

**Method**: `WordPressService.createDraftPost()`

**Input Parameters**:
```typescript
interface CreateDraftPostParams {
  title: string;
  content: string;              // HTML from ContentConverter
  status: 'draft';              // Always draft for MVP
}
```

**Output**:
```typescript
interface CreateDraftPostResponse {
  id: number;                   // WordPress post ID
  link: string;                 // Post URL (preview link)
  date: string;                 // ISO 8601
  modified: string;
  title: { rendered: string };
  content: { rendered: string };
}
```

**Error Conditions**:
- `401 Unauthorized`: Invalid credentials (Application Password)
- `403 Forbidden`: Insufficient permissions (need `edit_posts`)
- `400 Bad Request`: Invalid post data
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: WordPress server error

**Retry Policy**: 3 attempts with exponential backoff

**Transport**: 
- HTTPS/TLS for hosted WordPress (https://example.com)
- **HTTP for self-hosted WordPress** (http://localhost:8080 during development)
- Support both protocols via configuration

**Authentication**: Application Password (WordPress 5.6+)
- Header: `Authorization: Basic base64(username:app_password)`

---

### 4.2 Upload Media

**Purpose**: Upload image to WordPress media library

**Method**: `WordPressService.uploadMedia()`

**Input Parameters**:
```typescript
interface UploadMediaParams {
  fileBuffer: Buffer;           // Image binary data (from Notion download)
  filename: string;             // Original filename or generated name
  mimeType: string;             // e.g., 'image/jpeg', 'image/png'
  altText?: string;             // Accessibility alt text (from Notion caption)
}
```

**Output**:
```typescript
interface UploadMediaResponse {
  id: number;                   // WordPress media ID
  sourceUrl: string;            // Permanent media URL
  title: { rendered: string };
  mediaType: 'image';
}
```

**Error Conditions**:
- `401 Unauthorized`: Invalid credentials
- `403 Forbidden`: Insufficient permissions (need `upload_files`)
- `413 Payload Too Large`: File exceeds WordPress upload limit (default: 2-10MB, configurable)
- `415 Unsupported Media Type`: Invalid MIME type
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: WordPress server error

**Retry Policy**: 3 attempts with exponential backoff

**Transport**: HTTPS/TLS or HTTP (self-hosted)

**Request Format**: multipart/form-data

---

### 4.3 Delete Post (Rollback)

**Purpose**: Delete WordPress post during error recovery

**Method**: `WordPressService.deletePost()`

**Input Parameters**:
```typescript
interface DeletePostParams {
  postId: number;
  force: boolean;               // true = permanent delete, false = move to trash
}
```

**Output**:
```typescript
interface DeletePostResponse {
  deleted: boolean;
  previous: {
    id: number;
    title: { rendered: string };
  };
}
```

**Error Conditions**:
- `401 Unauthorized`: Invalid credentials
- `404 Not Found`: Post doesn't exist (ignore in rollback)
- `403 Forbidden`: Insufficient permissions

**Retry Policy**: 1 attempt only (rollback must be fast, log failure)

**Transport**: HTTPS/TLS or HTTP

---

### 4.4 Delete Media (Rollback)

**Purpose**: Delete WordPress media during error recovery

**Method**: `WordPressService.deleteMedia()`

**Input Parameters**:
```typescript
interface DeleteMediaParams {
  mediaId: number;
  force: boolean;               // true = permanent delete
}
```

**Output**:
```typescript
interface DeleteMediaResponse {
  deleted: boolean;
  previous: {
    id: number;
    sourceUrl: string;
  };
}
```

**Error Conditions**:
- `401 Unauthorized`: Invalid credentials
- `404 Not Found`: Media doesn't exist (ignore in rollback)
- `403 Forbidden`: Insufficient permissions

**Retry Policy**: 1 attempt only

**Transport**: HTTPS/TLS or HTTP

---

## 5. Image Downloader Contract

### 5.1 Download Image from Notion

**Purpose**: Download image from Notion signed URL before expiration

**Method**: `ImageDownloader.downloadImage()`

**Input Parameters**:
```typescript
interface DownloadImageParams {
  url: string;                  // Notion signed URL (expires in ~1 hour)
  blockId: string;              // For reference in ImageAsset
}
```

**Output**:
```typescript
interface DownloadImageResponse {
  buffer: Buffer;               // Image binary data
  mimeType: string;             // Detected MIME type
  fileHash: string;             // SHA-256 hash (for deduplication)
  filename: string;             // Extracted or generated filename
}
```

**Error Conditions**:
- `401 Unauthorized`: Signed URL expired (retry not possible, fail sync)
- `404 Not Found`: Image no longer exists
- `408 Request Timeout`: Download timed out
- `500 Internal Server Error`: Notion CDN error

**Retry Policy**: 3 attempts with exponential backoff (for non-401 errors)

**Transport**: HTTPS/TLS (Notion CDN)

**Implementation Notes**:
- Use streaming to handle large images efficiently
- Calculate SHA-256 hash during download (no need to re-read buffer)

---

## 6. Database Service Contract

### 6.1 Create SyncJob

**Method**: `DatabaseService.createSyncJob()`

**Input**:
```typescript
interface CreateSyncJobParams {
  jobType: 'scheduled' | 'manual';
}
```

**Output**:
```typescript
interface CreateSyncJobResponse {
  id: number;                   // SyncJob ID
  startedAt: string;            // ISO 8601
}
```

**SQL**:
```sql
INSERT INTO sync_jobs (job_type, status, started_at)
VALUES (?, 'running', datetime('now'))
RETURNING id, started_at;
```

---

### 6.2 Create SyncJobItem

**Method**: `DatabaseService.createSyncJobItem()`

**Input**:
```typescript
interface CreateSyncJobItemParams {
  syncJobId: number;
  notionPageId: string;
}
```

**Output**:
```typescript
interface CreateSyncJobItemResponse {
  id: number;
  createdAt: string;
}
```

**SQL**:
```sql
INSERT INTO sync_job_items (sync_job_id, notion_page_id, status)
VALUES (?, ?, 'pending')
RETURNING id, created_at;
```

---

### 6.3 Create ImageAsset

**Method**: `DatabaseService.createImageAsset()`

**Input**:
```typescript
interface CreateImageAssetParams {
  syncJobItemId: number;
  notionPageId: string;
  notionBlockId: string;
  notionUrl: string;            // Temporary signed URL
}
```

**Output**:
```typescript
interface CreateImageAssetResponse {
  id: number;
  createdAt: string;
}
```

**SQL**:
```sql
INSERT INTO image_assets (
  sync_job_item_id, notion_page_id, notion_block_id,
  notion_url, status
)
VALUES (?, ?, ?, ?, 'pending')
RETURNING id, created_at;
```

---

### 6.4 Update ImageAsset on Upload Success

**Method**: `DatabaseService.updateImageAssetUploaded()`

**Input**:
```typescript
interface UpdateImageAssetUploadedParams {
  id: number;
  wpMediaId: number;
  wpMediaUrl: string;
}
```

**SQL**:
```sql
UPDATE image_assets
SET status = 'uploaded',
    wp_media_id = ?,
    wp_media_url = ?
WHERE id = ?;
```

---

### 6.5 Create PagePostMap

**Method**: `DatabaseService.createPagePostMap()`

**Input**:
```typescript
interface CreatePagePostMapParams {
  notionPageId: string;
  wpPostId: number;
}
```

**Output**:
```typescript
interface CreatePagePostMapResponse {
  id: number;
  createdAt: string;
}
```

**SQL**:
```sql
INSERT INTO page_post_map (notion_page_id, wp_post_id)
VALUES (?, ?)
RETURNING id, created_at;
```

**Note**: Only called on successful sync completion.

---

### 6.6 Update SyncJobItem on Success

**Method**: `DatabaseService.updateSyncJobItemSuccess()`

**Input**:
```typescript
interface UpdateSyncJobItemSuccessParams {
  id: number;
  wpPostId: number;
}
```

**SQL**:
```sql
UPDATE sync_job_items
SET status = 'success',
    wp_post_id = ?,
    updated_at = datetime('now')
WHERE id = ?;
```

---

### 6.7 Update SyncJobItem on Failure

**Method**: `DatabaseService.updateSyncJobItemFailure()`

**Input**:
```typescript
interface UpdateSyncJobItemFailureParams {
  id: number;
  errorMessage: string;
  retryCount: number;
}
```

**SQL**:
```sql
UPDATE sync_job_items
SET status = 'failed',
    error_message = ?,
    retry_count = ?,
    updated_at = datetime('now')
WHERE id = ?;
```

---

### 6.8 Update SyncJob on Completion

**Method**: `DatabaseService.updateSyncJobCompleted()`

**Input**:
```typescript
interface UpdateSyncJobCompletedParams {
  id: number;
  status: 'completed' | 'failed';
  pagesProcessed: number;
  pagesSucceeded: number;
  pagesFailed: number;
  lastSyncTimestamp?: string;   // Most recent notion page lastEditedTime
}
```

**SQL**:
```sql
UPDATE sync_jobs
SET status = ?,
    completed_at = datetime('now'),
    pages_processed = ?,
    pages_succeeded = ?,
    pages_failed = ?,
    last_sync_timestamp = ?
WHERE id = ?;
```

---

### 6.9 Get Last Sync Timestamp

**Method**: `DatabaseService.getLastSyncTimestamp()`

**Output**:
```typescript
interface GetLastSyncTimestampResponse {
  timestamp: string | null;     // ISO 8601 or null if first sync
}
```

**SQL**:
```sql
SELECT last_sync_timestamp
FROM sync_jobs
WHERE status = 'completed'
ORDER BY completed_at DESC
LIMIT 1;
```

**Purpose**: Used for incremental scanning (filter Notion pages by `last_edited_time > last_sync_timestamp`)

---

### 6.10 Get ImageAssets for Rollback

**Method**: `DatabaseService.getImageAssetsByJobItem()`

**Input**:
```typescript
interface GetImageAssetsByJobItemParams {
  syncJobItemId: number;
}
```

**Output**:
```typescript
interface GetImageAssetsByJobItemResponse {
  assets: ImageAssetRecord[];
}

interface ImageAssetRecord {
  id: number;
  wpMediaId: number | null;
  status: 'pending' | 'uploaded' | 'failed';
}
```

**SQL**:
```sql
SELECT id, wp_media_id, status
FROM image_assets
WHERE sync_job_item_id = ?;
```

**Purpose**: Used during rollback to delete uploaded WordPress media

---

## 7. Telegram Service Contract

### 7.1 Send Notification

**Purpose**: Send sync success/failure notification to Telegram channel

**Method**: `TelegramService.sendNotification()`

**Input Parameters**:
```typescript
interface SendNotificationParams {
  chatId: string;               // Telegram chat/channel ID
  message: string;              // Notification message
  parseMode?: 'Markdown' | 'HTML';
}
```

**Output**:
```typescript
interface SendNotificationResponse {
  success: boolean;
  messageId: number;            // Telegram message ID
}
```

**Message Format (Success)**:
```
✅ Sync Completed Successfully

Pages processed: 5
Pages succeeded: 5
Pages failed: 0

Job ID: 42
Completed at: 2025-10-28T10:30:00Z
```

**Message Format (Failure)**:
```
❌ Sync Failed

Pages processed: 5
Pages succeeded: 3
Pages failed: 2

Failed pages:
- "Article Title 1": API timeout after 3 retries
- "Article Title 2": Image upload failed

Job ID: 42
To view detailed logs: docker logs notion2wp-sync
```

**Error Conditions**:
- `401 Unauthorized`: Invalid bot token
- `400 Bad Request`: Invalid chat ID or message format
- `429 Too Many Requests`: Rate limit exceeded (30 msg/sec)

**Retry Policy**: 3 attempts with exponential backoff

**Transport**: HTTPS/TLS (Telegram Bot API: https://api.telegram.org)

**Library**: Telegraf v4.x
- Installation: `npm install telegraf`
- Usage: Simple send-only (no webhook/polling needed)

---

## 8. Error Handling & Rollback Strategy

### 8.1 Rollback Procedure

**Trigger**: Any error during sync process after WordPress resources created

**Steps**:
1. **Query ImageAssets** for current SyncJobItem
2. **Delete WordPress Media** (for each `wp_media_id` where status='uploaded')
   - Call `WordPressService.deleteMedia(mediaId, force=true)`
   - Log failure if delete fails (continue rollback)
3. **Update ImageAssets** to status='failed'
4. **Delete WordPress Post** (if `wp_post_id` exists in SyncJobItem)
   - Call `WordPressService.deletePost(postId, force=true)`
   - Log failure if delete fails
5. **Update Notion Page** status to 'error'
6. **Update SyncJobItem** status to 'failed' with error message
7. **Continue** processing next page

### 8.2 Retry Strategy

**Retry Conditions**:
- API errors: 429 (rate limit), 500-504 (server errors), timeouts
- Network errors: Connection refused, DNS resolution failures

**No Retry**:
- 401 Unauthorized (invalid credentials - fail immediately)
- 404 Not Found (resource doesn't exist)
- 400 Bad Request (invalid data - fix required)

**Exponential Backoff**:
- Attempt 1: Immediate
- Attempt 2: Wait 1 second
- Attempt 3: Wait 2 seconds
- Attempt 4: Wait 4 seconds
- Max: 3 retries (4 total attempts)

**Per-Page Retry**:
- Each SyncJobItem tracks `retry_count`
- Retry entire page sync (blocks + images + post creation)
- After 3 retries, mark as failed and continue to next page

---

## 9. Security & Authentication

### 9.1 Notion API Authentication

**Method**: Integration Token (Internal Integration)

**Configuration**:
- Environment variable: `NOTION_API_TOKEN`
- Header: `Authorization: Bearer <token>`
- Transport: HTTPS only

**Minimum Permissions**:
- Read content (query datasource, read pages, read blocks)
- Update content (update page properties for status field)

---

### 9.2 WordPress API Authentication

**Method**: Application Password (WordPress 5.6+)

**Configuration**:
- Environment variables:
  - `WP_API_URL` (e.g., `https://example.com` or `http://localhost:8080`)
  - `WP_USERNAME`
  - `WP_APP_PASSWORD`
- Header: `Authorization: Basic base64(username:app_password)`
- Transport: HTTPS/TLS for production, HTTP allowed for self-hosted development

**Minimum Permissions**:
- Author or Editor role
- Capabilities: `edit_posts`, `upload_files`

---

### 9.3 Telegram Bot Authentication

**Method**: Bot Token

**Configuration**:
- Environment variables:
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID`
- Transport: HTTPS only

**Permissions**: Send messages only (no webhook/polling)

---

## 10. Rate Limits & Throttling

### 10.1 Notion API

**Documented Limit**: 3 requests per second

**Implementation**:
- Client-side throttle: 2.5 req/s (safety margin)
- Queue requests with delay between calls
- Handle 429 responses: respect `Retry-After` header + exponential backoff

---

### 10.2 WordPress API

**Depends on Hosting**:
- Self-hosted: No default limit (depends on server config)
- WordPress.com: ~3,600 req/hour (~1 req/sec)
- Managed hosting: 600-1,200 req/hour

**Implementation**:
- Conservative throttle: 5 req/min (0.083 req/s)
- Handle 429 responses with exponential backoff
- Use `_fields` parameter to reduce payload size

---

### 10.3 Telegram Bot API

**Documented Limit**: 30 messages per second (global)

**Implementation**:
- MVP: 1 notification per sync job (unlikely to hit limit)
- Queue notifications if needed in future

---

## Summary

This contract document defines all service interfaces in the sync system, following the operation sequence from data-model.md. Key principles:

1. **Creation Order**: SyncJob → SyncJobItem → ImageAsset → WPMedia → PagePostMap
2. **Rollback Order**: Update ImageAsset → Delete WPMedia → Delete WPPost → Update Notion → Update SyncJobItem
3. **Foreign Keys**: SyncJob ← SyncJobItem ← ImageAsset (cascade delete)
4. **No FK**: PagePostMap (independent success record)
5. **Transport**: HTTPS/TLS for all APIs, HTTP supported for self-hosted WordPress
6. **Libraries**: notion-to-md + marked for content conversion
7. **Authentication**: Integration token (Notion), Application Password (WordPress), Bot token (Telegram)

All contracts include error handling, retry policies, and rollback procedures to ensure data consistency and system reliability.
