# Tasks: Notion to WordPress Sync

**Feature**: 001-notion2wp-sync

---

## Phase 1: Setup
- [X] T001 Create project structure and initialize Node.js/TypeScript project per plan.md
- [X] T002 Install dependencies: @notionhq/client, notion-to-md, marked, @wordpress/api-fetch, telegraf, node-cron, axios, vitest, dotenv, better-sqlite3, types for all
- [X] T003 Create .env.example and document required environment variables in README.md
- [X] T004 [P] Create Dockerfile and docker-compose.yml for service containerization
- [X] T005 [P] Initialize SQLite database using config/schema.sql
- [X] T006 [P] Set up basic logging to stdout/stderr

## Phase 2: Foundational
- [X] T007 Implement database service for sync_jobs, sync_job_items, image_assets, page_post_map (src/db/)
- [X] T008 Implement Notion service for querying pages, getting blocks, updating status (src/services/notionService.ts)
- [X] T009 Implement WordPress service for draft post creation, media upload, deletion (src/services/wpService.ts)
- [X] T010 Implement Telegram notification service (src/services/telegramService.ts)
- [X] T011 Implement content converter (Notion blocks → Markdown → HTML) (src/lib/contentConverter.ts)
- [X] T012 Implement image downloader with SHA-256 hashing and streaming (src/lib/imageDownloader.ts)
- [X] T013 [P] Implement retry/exponential backoff utility (src/lib/retry.ts)
- [X] T014 [P] Implement environment/config loader (src/config/index.ts)

## Phase 3: User Story 1 (P1) - 자동 동기화 및 초안 업로드
- [X] T015 [US1] Implement SyncOrchestrator to run scheduled/manual sync jobs (src/orchestrator/syncOrchestrator.ts)
- [X] T016 [P] [US1] Implement incremental Notion page scan (status=adding, last sync timestamp)
- [X] T017 [P] [US1] Implement per-page sync job item creation and status tracking
- [X] T018 [P] [US1] Implement Notion → WordPress draft post creation flow
- [X] T019 [P] [US1] Implement Notion status update to complete/error after sync
- [X] T020 [US1] Implement error handling and rollback (delete WP post/media, update Notion status)
- [X] T021 [US1] Implement logging for all sync steps and errors
- [X] T022 [US1] Add CLI/manual trigger for sync (src/cli/syncManual.ts)

## Phase 4: User Story 2 (P1) - 이미지 포함 및 자원 처리
- [X] T023 [US2] Implement image extraction from Notion blocks and download
- [X] T024 [P] [US2] Implement WordPress media upload and mapping to post content
- [X] T025 [P] [US2] Implement image filename collision prevention (hashing/unique naming)
- [X] T026 [US2] Implement rollback for failed image uploads (delete media, update status)
- [X] T027 [US2] Validate image inclusion in WordPress draft post

## Phase 5: User Story 3 (P2) - 관리자 검토 및 게시
- [X] T028 [US3] Ensure all posts are created as draft only, no auto-publish
- [X] T029 [US3] Document manual review/publish workflow in README.md (WordPress admin dashboard)
- [X] T030 [US3] Add database query examples for debugging page-post mappings in README.md

## Phase 6: User Story 4 (P2) - 알림
- [X] T031 [US4] Implement Telegram notification on sync success/failure
- [X] T032 [P] [US4] Format notification message per contract (job stats, error summary)
- [X] T033 [US4] Add error log reference in failure notification
 

## Final Phase: Polish & Cross-Cutting
- [ ] T034 Add unit/integration tests for all services (Vitest, src/tests/)
- [ ] T035 [P] Add E2E test scenario for full sync (manual, see quickstart.md)
- [ ] T036 [P] Add log rotation and backup scripts for SQLite DB
- [ ] T037 [P] Add health check and monitoring endpoint (src/server/health.ts)
- [ ] T038 [P] Add documentation for disaster recovery and rollback
- [ ] T039 [P] Review and update all docs (README, quickstart, specs)

---

## Dependencies
- US1 → US2 (이미지 포함은 기본 동기화 후)
- US1, US2 → US3 (관리자 검토는 동기화/이미지 완료 후)
- US1 → US4 (알림은 동기화 완료 후)

## Parallel Execution Examples
- T004, T005, T006 (Docker, DB, Logging) can be done in parallel
- T013, T014 (Retry, Config) can be done in parallel
- T016, T017, T018 (Notion scan, job item, post creation) can be parallelized per page
- T024, T025 (Media upload, filename collision) can be parallelized per image
- T032, T033 (Notification formatting, error log) can be parallelized

## Implementation Strategy
- MVP: Complete all P1 user stories (US1, US2) and foundational phases
- Deliver incrementally: Setup → Foundational → US1/US2 → US3/US4 → Polish
- Each phase is independently testable (see acceptance criteria in spec.md)
- All tasks follow strict checklist format: `- [ ] Tnnn [P?] [US?] Description with file path`
