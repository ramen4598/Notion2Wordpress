# Implementation Plan: Notion to WordPress Sync

**Branch**: `001-notion2wp-sync` | **Date**: 2025-10-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-notion2wp-sync/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

This feature implements automated synchronization of Notion pages to WordPress as draft posts. The system monitors a Notion datasource, uploads pages with `status=adding` to WordPress (including images), and sends Telegram notifications on completion. Key capabilities include scheduled/manual sync, incremental scanning, image handling with collision prevention, error recovery with rollback, and comprehensive logging.

## Technical Context

**Language/Version**: TypeScript 5.9.3 with Node.js 20.x LTS  
**Primary Dependencies**: 
- Notion SDK (@notionhq/client 5.3.0) for Notion API integration
- Notion-to-MD (notion-to-md 3.1.9) for converting Notion blocks to Markdown
- Marked (marked 16.4.1) for converting Markdown to HTML
- WordPress REST API client (@wordpress/api-fetch 7.33.0)
- Telegram Bot API client (telegraf 4.16.3)
- Scheduler library (node-cron 4.2.1)
- HTTP client for media downloads (axios 1.13.0)
- Database (better-sqlite3 12.4.1)
- Environment config (dotenv 17.2.3)
- Form data handling (form-data 4.0.4)

**Storage**: SQLite for:
- Page-to-post mapping (NotionPageID → WordPressPostID)
- Sync job history and status tracking
- Last sync timestamp for incremental scanning
- Image asset tracking (original URL → WordPress media ID)

**Testing**: 
- Unit tests (Vitest 4.0.4)
- Integration tests for API interactions (Vitest 4.0.4)
- Contract tests for Notion/WordPress API responses (Vitest 4.0.4)
- E2E tests for sync workflow (Vitest 4.0.4)
- Code coverage (@vitest/coverage-v8 4.0.4)

**Target Platform**: Docker container (Linux-based) with:
- Environment variables for API credentials (.env file via bind mount)
- Volume/bind mount for SQLite database persistence
- Volume/bind mount for logs (stdout/stderr)

**Project Type**: Single backend service (Node.js daemon/CLI with scheduler)

**Performance Goals**: 
- Process up to 5,000 pages per day (SC-004)
- Sync latency: Draft creation within 5 minutes of status change (SC-001)
- Image upload success rate: 95%+ (SC-002)
- Notification delivery: Within 1 minute (SC-003)

**Constraints**: 
- Notion API rate limits: 3 requests/second per integration
- WordPress REST API rate limits (NEEDS CLARIFICATION - depends on hosting)
- Telegram Bot API limits (NEEDS CLARIFICATION - typical: 30 messages/second)
- Image file size limits (NEEDS CLARIFICATION - WordPress default: 2MB-10MB)
- Exponential backoff retry: max 3 attempts with increasing delays
- Rollback capability for failed sync operations
- **Transport Security**: 
	- HTTPS/TLS for Notion API (api.notion.com)
	- HTTPS/TLS for Telegram Bot API (api.telegram.org)
	- **HTTPS/TLS and HTTP for WordPress API** (support both for self-hosted WordPress during development)

**Scale/Scope**: 
- Single Notion datasource monitoring
- MVP: 100-500 pages expected in initial deployment
- Support for text + image content (no video/embed support in MVP)
- Single WordPress site target
- Single Telegram channel for notifications

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### I. Data Integrity ✅
- Notion-to-WordPress mapping stored in SQLite ensures traceability
- All transformations (Notion blocks → WordPress HTML) will be logged
- Status field changes (`adding` → `complete`/`error`) tracked in sync job history
- Rollback mechanism for failed syncs maintains consistency

### II. Content Synchronization ✅
- Automated sync via scheduler (cron-like) with manual trigger option
- Incremental scanning using last sync timestamp reduces redundant processing
- Conflict resolution: Status field acts as single source of truth
- All sync operations logged to stdout/stderr for audit trail

### III. User Experience ✅
- Minimal setup: Environment variables for API credentials
- Clear feedback: Telegram notifications for success/failure
- Error messages include summary + log access instructions
- Status field provides intuitive workflow (`writing` → `adding` → `complete`/`error`)

### IV. Security & Privacy ✅
- API credentials managed via environment variables (.env)
- HTTPS/TLS for all API communications (Notion, WordPress, Telegram)
- Minimum privilege: Service only needs specific API scopes (NEEDS CLARIFICATION in research)
- No credential storage in code or logs

### V. Performance & Optimization ✅
- Incremental scanning minimizes API calls
- Batch processing for image uploads (NEEDS CLARIFICATION - batch size strategy)
- Exponential backoff for rate limit handling
- Caching strategy for Notion blocks (NEEDS CLARIFICATION - if applicable)
- Performance monitoring via sync job metrics

### Development Standards Compliance
- ✅ TypeScript as primary language
- ⚠️  Test coverage 80%+ (TBD - framework selection needed)
- ✅ Code quality tools: ESLint, Prettier (standard for TypeScript)
- ⚠️  Documentation for libraries/tools (will be added during implementation)

**Gate Status**: **PASS** with clarifications needed in Phase 0 research

**Issues Requiring Research**:
1. Specific API rate limits for Notion/WordPress/Telegram
2. Node.js version compatibility and LTS selection
3. Library selection for WordPress REST API, Telegram, scheduler, testing
4. API permission scopes (minimum privilege principle)
5. Image upload batch size optimization
6. Block caching strategy (if needed for performance)

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
# Single backend service project
src/
├── models/              # Data models: NotionPage, WPPost, SyncJob, ImageAsset
├── services/            # Business logic
│   ├── notion/         # Notion API integration, incremental scanning
│   ├── wordpress/      # WordPress REST API, image upload, post creation
│   ├── telegram/       # Notification service
│   └── sync/           # Sync orchestration, retry/rollback logic
├── database/           # SQLite schema, migrations, queries
├── scheduler/          # Cron jobs, manual trigger handlers
├── lib/                # Utilities (logger, config loader, retry helpers)
└── index.ts            # Entry point (daemon or CLI)

tests/
├── unit/               # Unit tests for services, models
├── integration/        # API integration tests (mocked/sandboxed)
└── e2e/                # End-to-end sync workflow tests

config/
└── schema.sql          # SQLite schema definition

docker/
├── Dockerfile
└── docker-compose.yml  # Include .env, volume mounts

.env.example            # Template for environment variables
```

**Structure Decision**: Single backend service architecture chosen because:
- No frontend UI required (headless sync daemon)
- All components (Notion/WordPress/Telegram integrations) share the same runtime context
- Simplifies deployment (single Docker container)
- Aligns with Constitution principle of minimal complexity

## Complexity Tracking

> **No violations detected - this section is intentionally left minimal**

The current design adheres to all Constitution principles without requiring exceptions or justifications for added complexity. The single-service architecture, standard TypeScript tooling, and straightforward sync workflow align with simplicity goals.

## Constitution Check (Post-Design)

Re-evaluated after Phase 1 design with research decisions applied.

### I. Data Integrity ✅
- SQLite schema covers Notion→WordPress mapping, sync jobs, and image assets.
- Rollback plan finalised: delete created WP resources on failure; mark Notion page status=error; record job outcome.
- Transformation logging retained; mapping guarantees traceability.

### II. Content Synchronization ✅
- Scheduler: node-cron with configurable expression via env.
- Manual trigger supported via CLI/entrypoint stub (to be implemented in src/index.ts).
- Incremental scan by last-modified; no caching for MVP to favour correctness.
- Rate-limit handling strategies documented for Notion, WordPress, Telegram with exponential backoff.

### III. User Experience ✅
- Quickstart will include minimal env setup and run instructions.
- Telegram notifications via Telegraf with clear success/failure summaries.
- Errors will include remediation hints and log pointers.

### IV. Security & Privacy ✅
- Secrets via environment variables; no secrets in code or logs.
- Minimum-privilege scopes defined: Notion integration caps, WP Application Password permissions, Telegram send-only.
- All APIs over HTTPS.

### V. Performance & Optimization ✅
- Node.js 20.x LTS selected.
- Image handling: concurrent download (3) + sequential upload; retry with backoff.
- No block caching for MVP; revisit if >1k pages.
- Basic metrics via sync job records; extendable later.

### Development Standards Compliance
- ✅ Language: TypeScript
- ✅ Linters/formatters: ESLint + Prettier (to be wired in project bootstrap)
- ✅ Tests: Vitest selected; coverage target ≥ 80%
- ✅ Documentation: quickstart + library notes to be included; contracts generated

Gate Result: PASS (no unresolved clarifications)

Notes:
- Follow-ups: implement CLI/manual trigger; wire ESLint/Prettier/Vitest config in repo bootstrap; add Dockerfile/compose as per structure.
