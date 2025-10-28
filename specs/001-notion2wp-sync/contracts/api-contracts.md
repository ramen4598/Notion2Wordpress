# API Contracts: Notion to WordPress Sync

**Date**: 2025-10-27  
**Feature**: 001-notion2wp-sync  
**Version**: 1.0

## Overview

This document defines the internal service contracts for the sync system. While the system doesn't expose HTTP APIs (it's a background daemon), these contracts document the interface between internal services and external APIs.

---

## 1. Notion Service Contract

### 1.1 Query Pages with Status Filter

**Purpose**: Retrieve pages from Notion database with incremental scanning

**Method**: `NotionService.queryPages()`

**Input Parameters**:
```typescript
interface QueryPagesParams {
  databaseId: string;           // Notion database UUID
  lastSyncTimestamp?: string;   // ISO 8601 timestamp for incremental scan
  statusFilter?: 'adding';      // Filter by status property
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
- `404 Not Found`: Database ID doesn't exist or no access
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Notion API error

**Retry Policy**: 3 attempts with exponential backoff (1s, 2s, 4s)

---

### 1.2 Retrieve Page Blocks

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
  type: string;                 // 'paragraph', 'heading_1', 'image', 'bulleted_list_item', etc.
  [type]: {                     // Type-specific content
    richText?: RichText[];      // For text blocks
    caption?: RichText[];       // For images
    url?: string;               // For external images
    file?: { url: string };     // For uploaded images
  };
}

interface RichText {
  type: 'text';
  text: { content: string };
  annotations: {
    bold: boolean;
    italic: boolean;
    // ... other formatting
  };
}
```

**Error Conditions**:
- `401 Unauthorized`: Invalid token
- `404 Not Found`: Page doesn't exist or no access
- `429 Too Many Requests`: Rate limit exceeded

**Retry Policy**: 3 attempts with exponential backoff

---

### 1.3 Update Page Status

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

---

## 2. WordPress Service Contract

### 2.1 Create Draft Post

**Purpose**: Create a new WordPress post in draft status

**Method**: `WordPressService.createDraftPost()`

**Input Parameters**:
```typescript
interface CreateDraftPostParams {
  title: string;
  content: string;              // HTML content (converted from Notion blocks)
  status: 'draft';              // Always draft for MVP
}
```

**Output**:
```typescript
interface CreateDraftPostResponse {
  id: number;                   // WordPress post ID
  link: string;                 // Post permalink
  date: string;                 // ISO 8601
  title: { rendered: string };
  content: { rendered: string };
}
```

**Error Conditions**:
- `401 Unauthorized`: Invalid credentials
- `403 Forbidden`: Insufficient permissions (need `edit_posts`)
- `400 Bad Request`: Invalid post data
- `429 Too Many Requests`: Rate limit exceeded

**Retry Policy**: 3 attempts with exponential backoff

---

### 2.2 Upload Media

**Purpose**: Upload image to WordPress media library

**Method**: `WordPressService.uploadMedia()`

**Input Parameters**:
```typescript
interface UploadMediaParams {
  fileBuffer: Buffer;           // Image binary data
  fileName: string;             // Original filename (with collision-safe suffix)
  mimeType: string;             // e.g., 'image/jpeg'
  altText?: string;             // Accessibility alt text
}
```

**Output**:
```typescript
interface UploadMediaResponse {
  id: number;                   // WordPress media ID
  sourceUrl: string;            // Public URL of uploaded image
  mimeType: string;
  mediaType: 'image';
}
```

**Error Conditions**:
- `401 Unauthorized`: Invalid credentials
- `403 Forbidden`: Insufficient permissions (need `upload_files`)
- `413 Payload Too Large`: File exceeds WordPress upload limit
- `415 Unsupported Media Type`: Invalid MIME type
- `429 Too Many Requests`: Rate limit exceeded

**Retry Policy**: 3 attempts with exponential backoff

---

### 2.3 Delete Post (Rollback)

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
- `404 Not Found`: Post doesn't exist
- `403 Forbidden`: Insufficient permissions

**Retry Policy**: 1 attempt (rollback must be fast)

---

### 2.4 Delete Media (Rollback)

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
- `404 Not Found`: Media doesn't exist
- `403 Forbidden`: Insufficient permissions

**Retry Policy**: 1 attempt

---

## 3. Telegram Service Contract

### 3.1 Send Notification

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

**Error Conditions**:
- `401 Unauthorized`: Invalid bot token
- `400 Bad Request`: Invalid chat ID or message format
- `429 Too Many Requests`: Rate limit exceeded

**Retry Policy**: 3 attempts with exponential backoff

---

## 4. Sync Orchestrator Contract

### 4.1 Execute Sync Job

**Purpose**: Orchestrate full sync workflow

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
  error: string;
  retryCount: number;
}
```

**Workflow**:
1. Create SyncJob record (status: `running`)
2. Query Notion pages with `status=adding` (incremental scan)
3. For each page:
   - Retrieve page blocks
   - Convert Notion blocks to HTML
   - Download images from Notion
   - Upload images to WordPress (sequential)
   - Create WordPress draft post with image references
   - Update Notion page status to `complete`
   - Create PagePostMap record
   - Create SyncJobItem record (status: `success`)
4. On error (any step):
   - Rollback: Delete WP post and media
   - Update Notion page status to `error`
   - Create SyncJobItem record (status: `failed`)
   - Retry up to 3 times with exponential backoff
5. Update SyncJob record (status: `completed` or `failed`)
6. Send Telegram notification

**Error Handling**:
- Catch all errors per page
- Rollback WordPress resources
- Continue processing remaining pages
- Report all errors in final notification

---

## 5. Database Service Contract

### 5.1 Create Page-Post Mapping

**Method**: `DatabaseService.createPagePostMapping()`

**Input**:
```typescript
interface CreatePagePostMappingParams {
  notionPageId: string;
  wpPostId: number;
}
```

**Output**:
```typescript
interface CreatePagePostMappingResponse {
  id: number;                   // Mapping record ID
  createdAt: string;
}
```

**Constraints**: Unique constraint on `notion_page_id` and `wp_post_id`

---

### 5.2 Create Sync Job

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
  id: number;
  startedAt: string;
}
```

---

### 5.3 Get Last Sync Timestamp

**Method**: `DatabaseService.getLastSyncTimestamp()`

**Output**:
```typescript
interface GetLastSyncTimestampResponse {
  timestamp: string | null;     // ISO 8601 or null if first sync
}
```

**Purpose**: Used for incremental scanning (filter Notion pages by `last_edited_time`)

---

### 5.4 Create Image Asset

**Method**: `DatabaseService.createImageAsset()`

**Input**:
```typescript
interface CreateImageAssetParams {
  notionPageId: string;
  notionBlockId: string;
  notionUrl: string;
  wpMediaId?: number;
  wpMediaUrl?: string;
  fileHash: string;
  status: 'pending' | 'uploaded' | 'failed';
}
```

**Output**:
```typescript
interface CreateImageAssetResponse {
  id: number;
  createdAt: string;
}
```

---

## 6. Content Converter Contract

### 6.1 Convert Notion Blocks to HTML

**Purpose**: Transform Notion block structure to WordPress-compatible HTML

**Method**: `ContentConverter.blocksToHTML()`

**Input**:
```typescript
interface BlocksToHTMLParams {
  blocks: Block[];              // Notion blocks from API
  imageMap: Map<string, string>; // Block ID → WordPress media URL
}
```

**Output**:
```typescript
interface BlocksToHTMLResponse {
  html: string;                 // WordPress post content
}
```

**Conversion Rules**:
- `paragraph` → `<p>{text}</p>`
- `heading_1` → `<h1>{text}</h1>`
- `heading_2` → `<h2>{text}</h2>`
- `heading_3` → `<h3>{text}</h3>`
- `bulleted_list_item` → `<ul><li>{text}</li></ul>`
- `numbered_list_item` → `<ol><li>{text}</li></ol>`
- `image` → `<img src="{wp_url}" alt="{caption}" />`
- `code` → `<pre><code>{text}</code></pre>`

**Rich Text Formatting**:
- `bold` → `<strong>{text}</strong>`
- `italic` → `<em>{text}</em>`
- `code` (inline) → `<code>{text}</code>`
- `link` → `<a href="{url}">{text}</a>`

---

## Error Response Format (Standard)

All services return errors in this format:

```typescript
interface ErrorResponse {
  error: {
    code: string;               // e.g., 'NOTION_AUTH_ERROR', 'WP_UPLOAD_FAILED'
    message: string;            // Human-readable error
    details?: any;              // Additional context
    retryable: boolean;         // Whether retry is recommended
  };
}
```

**Error Codes**:
- `NOTION_AUTH_ERROR`: Notion API authentication failure
- `NOTION_RATE_LIMIT`: Notion rate limit exceeded
- `WP_AUTH_ERROR`: WordPress authentication failure
- `WP_UPLOAD_FAILED`: Media upload failed
- `WP_POST_CREATION_FAILED`: Post creation failed
- `TELEGRAM_SEND_FAILED`: Notification send failed
- `DATABASE_ERROR`: SQLite operation failed
- `NETWORK_ERROR`: Network connectivity issue
- `UNKNOWN_ERROR`: Unexpected error

---

## Retry Policy Summary

| Operation | Max Retries | Backoff | Notes |
|-----------|-------------|---------|-------|
| Notion API calls | 3 | Exponential (1s, 2s, 4s) | All read/write ops |
| WordPress API calls | 3 | Exponential (1s, 2s, 4s) | Create post, upload media |
| WordPress rollback | 1 | None | Fast failure on rollback |
| Telegram notifications | 3 | Exponential (1s, 2s, 4s) | Non-blocking |
| Database operations | 0 | None | Fail fast (local) |

---

## Rate Limiting Strategy

| API | Limit | Strategy |
|-----|-------|----------|
| Notion | 3 req/s | Client-side throttle (2.5 req/s) + queue |
| WordPress | 300 req/hour | Client-side throttle (4 req/min) + queue |
| Telegram | 30 msg/s | No throttle needed (low volume) |

---

## Future Contract Extensions

1. **Webhook endpoints**: Replace polling with event-driven sync
2. **Batch operations**: Upload multiple media in single request (if WP supports)
3. **Partial updates**: Sync only changed blocks (incremental content sync)
4. **Bidirectional sync**: WordPress → Notion updates
