# Research: Notion to WordPress Sync

**Date**: 2025-10-27  
**Feature**: 001-notion2wp-sync  
**Status**: In Progress

## Overview

This document consolidates research findings for all technical unknowns identified during the Technical Context phase. Each decision includes rationale and alternatives considered.

---

## 1. Node.js Version Selection

### Decision
**Node.js 20.x LTS (Active LTS until April 2026)**

### Rationale
- Current Active LTS with long-term support
- Native ESM support (important for modern TypeScript tooling)
- Improved performance over Node.js 18
- Better compatibility with latest TypeScript features
- Security updates guaranteed through 2026

### Alternatives Considered
- **Node.js 18 LTS**: Still supported but older; 20.x provides better performance
- **Node.js 21/22**: Not LTS versions, unsuitable for production stability requirements

### Implementation Notes
- Specify `"engines": { "node": ">=20.0.0" }` in package.json
- Use Node.js 20 base image in Dockerfile (e.g., `node:20-alpine`)

---

## 2. WordPress REST API Client Library

### Decision
**@wordpress/api-fetch** with custom wrapper for type safety

### Rationale
- Official WordPress library, maintained by WordPress core team
- Built-in middleware support for authentication, error handling
- TypeScript-friendly with `@wordpress/api-fetch` type definitions available
- Well-documented and actively maintained
- Handles nonce/JWT authentication seamlessly

### Alternatives Considered
- **wpapi**: Third-party, less active maintenance (last update 2+ years ago)
- **Direct fetch/axios calls**: Requires manual implementation of authentication, error handling, pagination - more maintenance burden
- **wordpress-rest-api**: Minimal documentation, unclear maintenance status

### Implementation Notes
- Install: `npm install @wordpress/api-fetch`
- Create TypeScript wrapper for type-safe post creation, media upload
- Configure authentication middleware (Application Passwords or JWT)
- Reference: https://developer.wordpress.org/block-editor/reference-guides/packages/packages-api-fetch/

---

## 3. Telegram Bot API Client

## 3. Content Converter Libraries

### Decision
**notion-to-md + marked** (Notion → Markdown → HTML)

### Rationale
- **notion-to-md**: Official-like support for Notion block conversion
   - Handles all Notion block types (paragraphs, headings, lists, images, etc.)
   - Built on @notionhq/client, maintained actively
   - Provides intermediate Markdown for inspection/debugging
   - Clean API: `pageToMarkdown()` + `toMarkdownString()`
- **marked**: Industry-standard Markdown to HTML converter
   - Fast, reliable, widely used (40k+ GitHub stars)
   - Extensible via plugins/renderers
   - TypeScript support via @types/marked
   - WordPress-compatible HTML output (no custom tags)
- **Combination benefits**:
   - Transparent conversion pipeline (can log/validate Markdown intermediate)
   - Markdown files can be backed up/reused
   - HTML is WordPress REST API ready
   - Easy to customize rendering if needed

### Alternatives Considered
- **Direct Notion API parsing**: Too much manual work, error-prone for complex blocks
- **Custom HTML converter**: Reinventing the wheel, hard to maintain
- **notion-md-crawler**: Less maintained, no TypeScript support

### Implementation Notes
- Install: `npm install notion-to-md @notionhq/client marked @types/marked`
- Usage:
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
- Reference: 
   - https://github.com/souvikinator/notion-to-md
   - https://github.com/markedjs/marked

---

## 4. Telegram Bot API Client

### Decision
**Telegraf v4.x**

### Rationale

### Alternatives Considered

### Implementation Notes


## 4. Scheduler Library

### Decision
**node-cron**

### Rationale
- Simple, lightweight cron scheduler for Node.js
- Familiar cron syntax for scheduling
- No external dependencies (no MongoDB, Redis required)
- Sufficient for single-instance scheduled sync tasks
- Easy to combine with manual trigger via CLI or API endpoint

### Alternatives Considered
- **Agenda**: Requires MongoDB, overcomplicated for simple periodic tasks
- **Bull**: Requires Redis, designed for queue-based job processing (overkill)
- **node-schedule**: Similar to node-cron but less intuitive API

### Implementation Notes
- Install: `npm install node-cron @types/node-cron`
- Define cron expression via environment variable (e.g., `SYNC_SCHEDULE="*/5 * * * *"` for every 5 minutes)
- Allow manual trigger via separate CLI command or HTTP endpoint
- Reference: https://github.com/node-cron/node-cron

---

## 6. HTTP Client for Media Downloads

### Decision
**axios**

### Rationale
- Industry standard HTTP client for Node.js
- Built-in support for stream handling (important for large image downloads)
- Promise-based API compatible with async/await
- Excellent TypeScript support
- Automatic request/response transformations
- Interceptors for global error handling, retry logic

### Alternatives Considered
- **node-fetch**: Minimal API, requires additional setup for streams and retries
- **undici**: Newer, faster, but less ecosystem maturity for complex use cases
- **got**: Good alternative but larger bundle size, similar features to axios

### Implementation Notes
- Install: `npm install axios`
- Use streaming for downloading images: `axios.get(url, { responseType: 'stream' })`
- Implement retry logic with exponential backoff using axios interceptors or `axios-retry` package
- Reference: https://axios-http.com/

---

## 7. Testing Framework

### Decision
**Vitest** for unit and integration tests

### Rationale
- Modern, fast test runner built on Vite
- Native TypeScript and ESM support (no additional config needed)
- Compatible with Jest API (easy migration if needed)
- Fast watch mode for development
- Built-in coverage reporting with c8/Istanbul
- Better DX for TypeScript projects compared to Jest

### Alternatives Considered
- **Jest**: Industry standard but slower, requires additional TypeScript setup (ts-jest)
- **Mocha + Chai**: Requires more boilerplate, not TypeScript-native
- **AVA**: Good TypeScript support but smaller ecosystem

### Implementation Notes
- Install: `npm install -D vitest @vitest/ui c8`
- Configure coverage threshold: 80% minimum (Constitution requirement)
- Use `@vitest/spy` for mocking API calls
- For E2E tests, consider additional library like Playwright (if needed)
- Reference: https://vitest.dev/

---

## 8. API Rate Limits

### 8.1 Notion API Rate Limits

**Documented Limits**:
- **3 requests per second** per integration token
- **Burst allowance**: Brief spikes tolerated, but sustained rate must stay under 3 req/s
- **429 response**: Rate limit exceeded, includes `Retry-After` header

**Mitigation Strategy**:
- Implement request queue with max 2.5 req/s throttle (safety margin)
- Use exponential backoff on 429 responses
- Batch operations where possible (e.g., pagination)

**Reference**: https://developers.notion.com/reference/request-limits

### 8.2 WordPress REST API Rate Limits

**Hosting-Dependent**:
- **Self-hosted**: No default rate limit (depends on server config)
- **WordPress.com**: ~3,600 requests per hour per IP (varies by plan)
- **Managed hosting (WP Engine, Kinsta)**: Typically 600-1,200 req/hour

**Assumptions for MVP**:
- Assume conservative limit: **300 requests per hour** (5 req/min)
- Implement client-side throttle to stay under limit
- Handle 429 responses with exponential backoff

**Mitigation Strategy**:
- Batch media uploads where possible
- Cache WordPress post IDs to minimize lookups
- Use `_fields` parameter to reduce response payload

### 8.3 Telegram Bot API Rate Limits

**Documented Limits**:
- **30 messages per second** (global limit for all bots)
- **20 messages per minute** to the same group/channel
- **No limit** for 1-to-1 chats (practical limit: ~30/sec)

**Assumptions for MVP**:
- Send max 1 notification per sync job (success/failure)
- Unlikely to hit limits with typical sync frequency (every 5 minutes)

**Mitigation Strategy**:
- Queue notifications if burst sending is needed
- Group multiple sync results into single message if needed

**Reference**: https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this

---

## 9. API Permission Scopes (Minimum Privilege)

### 9.1 Notion Integration Permissions

**Required Capabilities**:
- **Read content**: To fetch page blocks, properties
- **Update content**: To change `status` property (`adding` → `complete`/`error`)
- **Read user information**: Optional (for audit logging)

**Scope Configuration**:
- Create internal integration in Notion workspace settings
- Grant access to specific datasource(s) only
- Enable "Read content" and "Update content" capabilities
- Store integration token in environment variable: `NOTION_API_TOKEN`

**Reference**: https://developers.notion.com/docs/authorization

### 9.2 WordPress Application Passwords

**Required Permissions**:
- **Create posts** (`edit_posts` capability)
- **Upload media** (`upload_files` capability)
- **Edit draft posts** (implicit with `edit_posts`)

**Setup**:
- Create Application Password for dedicated sync user account
- Assign "Author" or "Editor" role (both have required capabilities)
- Store credentials: `WP_API_URL`, `WP_USERNAME`, `WP_APP_PASSWORD`

**Reference**: https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/

### 9.3 Telegram Bot Token

**Required Permissions**:
- **Send messages** (default for all bots)
- No additional permissions needed for notification-only use case

**Setup**:
- Create bot via @BotFather
- Store token: `TELEGRAM_BOT_TOKEN`
- Store target chat ID: `TELEGRAM_CHAT_ID`

**Reference**: https://core.telegram.org/bots/tutorial

---

## 10. WordPress API Transport Protocol

### Decision
**Support both HTTPS/TLS and HTTP**

### Rationale
- **Production/Hosted WordPress**: Requires HTTPS/TLS
   - WordPress.com, WP Engine, Kinsta, etc. all enforce HTTPS
   - Certificate validation via standard CA certificates
   - Industry best practice for security
- **Self-Hosted WordPress (Development/Internal)**: May use HTTP
   - Local development environments (localhost, Docker)
   - Internal network deployments without public certificates
   - Testing environments
- **Flexibility**: System should support both based on `WP_API_URL` scheme
   - `https://example.com` → Use HTTPS with TLS verification
   - `http://localhost:8080` → Use HTTP without TLS

### Implementation Notes
- Detect protocol from `WP_API_URL` environment variable
   ```typescript
   const wpUrl = new URL(process.env.WP_API_URL);
   const isSecure = wpUrl.protocol === 'https:';
   ```
- For axios HTTP client:
   - HTTPS: Default behavior (validates certificates)
   - HTTP: No special configuration needed
   - Optional: Allow self-signed certificates for internal HTTPS via environment flag
      ```typescript
      const httpsAgent = new https.Agent({
         rejectUnauthorized: process.env.WP_VERIFY_SSL !== 'false'
      });
      ```
- Log warning if using HTTP in non-development environments
- Configuration example:
   ```env
   # Production
   WP_API_URL=https://myblog.com
  
   # Development
   WP_API_URL=http://localhost:8080
  
   # Self-signed cert (internal)
   WP_API_URL=https://internal-wp.local
   WP_VERIFY_SSL=false
   ```

### Security Considerations
- HTTPS/TLS strongly recommended for production
- HTTP acceptable only for:
   - Local development (localhost)
   - Internal networks with physical security
   - Testing environments
- Log warning when HTTP used: "Warning: WordPress API using HTTP (insecure). Recommended for development only."
- Application Passwords transmitted in Authorization header (Base64 encoded, not encrypted) - **requires HTTPS in production**

### Transport Summary
- **Notion API**: HTTPS/TLS only (api.notion.com)
- **Telegram Bot API**: HTTPS/TLS only (api.telegram.org)
- **WordPress REST API**: HTTPS/TLS (production) or HTTP (development/self-hosted)

**Reference**: 
- https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/
- https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/

---

## 9. Image Upload Optimization

### Decision
**Sequential upload with concurrent download** (max 3 concurrent downloads)

### Rationale
- **Download phase**: Fetch multiple images concurrently from Notion (3 concurrent)
- **Upload phase**: Upload to WordPress sequentially to avoid rate limits
- Balance between performance and API constraint compliance
- Reduces risk of WordPress rate limit (429) errors

### Alternatives Considered
- **Full sequential**: Too slow for pages with many images
- **Full concurrent**: High risk of rate limit violations
- **Batch upload (10+ images)**: WordPress API doesn't support true batch media upload

### Implementation Notes
- Use `Promise.all()` with limit for concurrent downloads
- Queue uploads sequentially with retry logic
- Cache downloaded images temporarily in memory/disk (cleanup after sync)
- Track upload progress for rollback on failure

### Batch Size Strategy
- **Download batch**: 3 images concurrently
- **Upload batch**: 1 at a time (sequential)
- **Retry budget**: 3 attempts per image (exponential backoff)

---

## 10. Notion Block Caching Strategy

### Decision
**No caching for MVP** (re-fetch on every sync)

### Rationale
- MVP prioritizes correctness over performance
- Incremental scanning (last modified timestamp) already reduces redundant API calls
- Caching adds complexity: invalidation, storage overhead, stale data risk
- Expected sync frequency (every 5 minutes) and page count (<500) makes caching premature optimization

### Alternatives Considered
- **In-memory cache**: Lost on restart, adds memory overhead
- **SQLite cache**: Requires invalidation logic, schema complexity
- **ETag-based cache**: Notion API doesn't support ETags for blocks

### Future Optimization Path
If performance becomes an issue (>1,000 pages), consider:
- Cache page blocks in SQLite with `last_edited_time` as cache key
- Invalidate cache on Notion webhook (requires webhook setup)

---

## 11. Error Recovery & Rollback Strategy

### Decision
**Transactional rollback with WordPress resource cleanup**

### Rationale
- Ensure Notion status consistency: Failed sync → `status=error`
- Prevent orphaned WordPress posts/media (resource leaks)
- Align with Constitution data integrity principle

### Rollback Workflow
1. **Track created resources**: Store WordPress post ID, media IDs during sync
2. **On error**:
   - Delete WordPress post (if created)
   - Delete uploaded media (if any)
   - Set Notion `status=error`
   - Log error details
3. **Retry with backoff**: Max 3 attempts
4. **Final failure**: Send Telegram notification with error summary

### Implementation Notes
- Use try-catch with cleanup in `finally` block
- Store intermediate state in sync job record (SQLite)
- WordPress REST API supports: `DELETE /wp/v2/posts/{id}`, `DELETE /wp/v2/media/{id}`

---

## Summary of Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Node.js | 20.x LTS |
| Language | TypeScript | 5.9.3 |
| Notion Client | @notionhq/client | 5.3.0 |
| WordPress Client | @wordpress/api-fetch | 7.33.0 |
| Telegram Client | Telegraf | 4.16.3 |
| Scheduler | node-cron | 4.2.1 |
| HTTP Client | axios | 1.13.0 |
| Content Converter | notion-to-md | 3.1.9 |
| Markdown Parser | marked | 16.4.1 |
| Database | SQLite (better-sqlite3) | 12.4.1 |
| Environment Config | dotenv | 17.2.3 |
| Form Data | form-data | 4.0.4 |
| Testing | Vitest | 4.0.4 |
| Test Coverage | @vitest/coverage-v8 | 4.0.4 |
| Code Quality | ESLint | 9.38.0 |
| Code Formatter | Prettier | 3.6.2 |
| TypeScript Config | @typescript-eslint/* | 8.46.2 |
| Dev Runtime | tsx | 4.20.6 |

---

## Open Questions for Implementation Phase

1. **Notion datasource ID**: How will users specify which datasource to monitor? (Environment variable vs. config file)
2. **WordPress category/tags**: Should sync include Notion page properties for categories/tags? (Out of scope for MVP?)
3. **Image alt text**: Should extract from Notion image captions? (Enhancement for accessibility)
4. **Sync schedule default**: Recommend 5-minute interval, but should be configurable?
5. **Graceful shutdown**: How to handle sync interruption (SIGTERM/SIGINT) mid-sync?

These questions will be addressed during Phase 1 design and implementation.
