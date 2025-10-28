# Notion2Wordpress

자동으로 Notion 페이지를 WordPress 초안(draft)으로 동기화하는 백엔드 서비스입니다. 이미지 업로드, 스케줄 실행, 실패 시 롤백, Telegram 알림을 지원합니다.

## 빠른 시작

- Quickstart 가이드: `specs/001-notion2wp-sync/quickstart.md`
- 예시 환경변수: `.env.example` (루트 경로)
- SQLite 스키마: `config/schema.sql`

## 문서 모음

- 기능 스펙: `specs/001-notion2wp-sync/spec.md`
- 구현 계획(Plan): `specs/001-notion2wp-sync/plan.md`
- 리서치(Research): `specs/001-notion2wp-sync/research.md`
- 데이터 모델(Data Model): `specs/001-notion2wp-sync/data-model.md`
- 내부 계약(API Contracts): `specs/001-notion2wp-sync/contracts/api-contracts.md`

## 기술 개요

- 언어/런타임: TypeScript 5.9.3 on Node.js 20.x LTS
- 스토리지: SQLite (better-sqlite3 12.4.1)
- 주요 라이브러리:
	- Notion SDK: `@notionhq/client` 5.3.0
	- WordPress API: `@wordpress/api-fetch` 7.33.0
	- 컨텐츠 변환: `notion-to-md` 3.1.9 + `marked` 16.4.1
	- 스케줄러: `node-cron` 4.2.1
	- HTTP 클라이언트: `axios` 1.13.0
	- 알림: `telegraf` 4.16.3
	- 환경 설정: `dotenv` 17.2.3
	- 테스팅: `vitest` 4.0.4
	- 코드 품질: `eslint` 9.38.0, `prettier` 3.6.2

## 전송 보안

- Notion API, Telegram Bot API: HTTPS/TLS
- WordPress API: 운영은 HTTPS/TLS, 로컬/자체 호스팅 개발 환경에서는 HTTP 허용

## 상태

- 현재 작업 브랜치: `001-notion2wp-sync`

## 설치 및 실행

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 설정

`.env.example`을 복사하여 `.env` 파일을 생성하고 필요한 값을 입력합니다:

```bash
cp .env.example .env
```

필수 환경 변수:
- `NOTION_API_TOKEN`: Notion integration token
- `NOTION_DATABASE_ID`: 모니터링할 Notion 데이터베이스 ID
- `WP_API_URL`: WordPress REST API URL (예: https://your-site.com/wp-json)
- `WP_USERNAME`: WordPress 사용자명
- `WP_APP_PASSWORD`: WordPress Application Password
- `TELEGRAM_BOT_TOKEN`: Telegram 봇 토큰
- `TELEGRAM_CHAT_ID`: Telegram 채널/채팅 ID

### 3. 실행 방법

**개발 모드 (자동 재시작)**:
```bash
npm run dev
```

**수동 동기화 실행**:
```bash
npm run sync:manual
```

**프로덕션 빌드 및 실행**:
```bash
npm run build
npm start
```

**Docker로 실행**:
```bash
docker-compose up -d
```

## 관리자 검토 및 게시 워크플로

1. Notion에서 페이지 작성 후 `status` 필드를 `adding`으로 변경
2. 동기화 서비스가 자동으로 WordPress에 초안(draft)으로 업로드
3. WordPress 관리자 대시보드에서 초안을 검토
4. 검토 완료 후 수동으로 게시(Publish) 버튼 클릭

**중요**: 이 시스템은 절대 자동으로 게시하지 않으며, 모든 포스트는 `draft` 상태로만 생성됩니다.

## 데이터베이스 쿼리 예시 (디버깅용)

SQLite 데이터베이스(`./data/sync.db`)에서 페이지-포스트 매핑 확인:

```bash
sqlite3 ./data/sync.db "SELECT * FROM page_post_map;"
```

동기화 작업 이력 확인:

```bash
sqlite3 ./data/sync.db "SELECT * FROM sync_jobs ORDER BY started_at DESC LIMIT 10;"
```

필요한 자세한 설치/실행 방법은 Quickstart 문서를 참고하세요.
