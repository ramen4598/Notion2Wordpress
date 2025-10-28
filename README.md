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

- 언어/런타임: TypeScript on Node.js 20.x LTS
- 스토리지: SQLite (동기화 이력/매핑/이미지 자산)
- 주요 라이브러리:
	- Notion SDK: `@notionhq/client`
	- 컨텐츠 변환: `notion-to-md` + `marked` (Notion → Markdown → HTML)
	- 스케줄러: `node-cron`
	- HTTP 클라이언트(이미지 다운로드): `axios`
	- 알림: `telegraf` (Telegram Bot)

## 전송 보안

- Notion API, Telegram Bot API: HTTPS/TLS
- WordPress API: 운영은 HTTPS/TLS, 로컬/자체 호스팅 개발 환경에서는 HTTP 허용

## 상태

- 현재 작업 브랜치: `001-notion2wp-sync`

필요한 자세한 설치/실행 방법은 Quickstart 문서를 참고하세요.
