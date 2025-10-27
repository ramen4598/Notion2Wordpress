# Feature Specification: Notion to WordPress Sync

**Feature Branch**: `001-notion2wp-sync`  
**Created**: 2025-10-27  
**Status**: Draft  
**Input**: User description: "Notion에서 작성한 페이지를 Wordpress로 자동으로 업로드한다. 이미지 포함, 일정 주기 모니터링, 새 글은 draft로 업로드, Telegram 알림" 

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 자동 동기화 및 초안 업로드 (Priority: P1)

사용자로서, 나는 Notion 데이터베이스에서 페이지의 `status` 속성을 `adding`으로 설정하면 자동으로 WordPress에 해당 페이지를 "초안(draft)"으로 업로드되도록 하고, 업로드 완료 후 `status`가 `complete`로 자동 변경되기를 원한다.

**Why this priority**: 핵심 가치(콘텐츠 자동 전송 및 상태 기반 워크플로우 보장). 이 기능이 없으면 시스템은 존재 의의가 없음.

**Independent Test**: Notion에 새로운 테스트 페이지를 생성(기본 `status`는 `writing`)하고, `status`를 `adding`으로 변경한 뒤, 동기화 주기가 완료되면 WordPress에 draft 포스트가 생성되고 Notion의 `status`가 `complete`로 변경되는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 사용자가 Notion 데이터베이스에 새 페이지를 생성하면(기본 `status` 값은 `writing`), **When** 사용자가 작성을 완료하고 `status`를 `adding`으로 변경하고 다음 스케줄된 동기화가 실행되면, **Then** WordPress에 해당 콘텐츠의 draft 포스트가 생성되어야 한다.
2. **Given** WordPress에 draft 포스트가 성공적으로 업로드되면, **When** 동기화가 완료되면, **Then** Notion 페이지의 `status`가 `complete`로 변경되어야 한다.
3. **Given** WordPress 업로드 과정 중 오류가 발생하면, **When** 오류가 감지되면, **Then** 시스템은 생성된 WordPress 리소스(포스트/미디어)를 가능한 범위에서 원복하고(Notion 기준 단일 트랜잭션 보장 대상 아님), Notion 페이지의 `status`를 `error`로 변경해야 한다.

---

### User Story 2 - 이미지 포함 및 자원 처리 (Priority: P1)

사용자로서, 나는 Notion 페이지에 포함된 이미지가 WordPress로 업로드될 때 손상되지 않고 올바르게 연결되기를 원한다.

**Why this priority**: 대부분의 게시물이 이미지 포함. 이미지가 누락되면 게시물 품질 저하.

**Independent Test**: Notion 페이지에 이미지(임베디드/첨부)를 포함시켜 동기화 후 WordPress에서 이미지가 존재하고 렌더링되는지 확인한다.

**Acceptance Scenarios**:

1. **Given** Notion 페이지에 이미지가 첨부되어 있고, **When** 동기화가 완료되면, **Then** WordPress 포스트에 이미지가 업로드되어 적절히 인라인 또는 미디어 라이브러리에 등록되어야 한다.
2. **Given** 서로 다른 내용의 이미지가 동일한 파일명을 갖고 Notion 페이지에 포함되어 있어도, **When** 동기화가 실행되면, **Then** 파일명 충돌 없이 모두 업로드되고 포스트 본문에서 올바르게 참조되어야 한다(고유 파일명/콘텐츠 기반 식별 등 충돌 방지 메커니즘 적용).

---

### User Story 3 - 관리자 검토 및 게시 (Priority: P2)

사용자로서, 나는 동기화된 콘텐츠가 draft 상태로 올라가서 관리자가 검토 후 수동으로 게시할 수 있기를 원한다.

**Why this priority**: 운영자의 편집/검토 프로세스 필요.

**Independent Test**: 동기화 후 WordPress 관리자 계정으로 로그인하여 draft를 확인하고 게시할 수 있는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 동기화로 생성된 draft가 존재하면, **When** 관리자가 해당 draft를 검토하고 "Publish"를 선택하면, **Then** 포스트가 공개되어야 한다.

---

### User Story 4 - 알림 (Priority: P2)

사용자로서, 나는 동기화 완료(성공/실패)에 대해 Telegram을 통해 알림을 받고 싶다.

**Why this priority**: 운영자에게 자동 알림 제공으로 신속한 대응 가능.

**Independent Test**: 동기화 작업을 실행하고 성공/실패 메시지가 Telegram으로 수신되는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 동기화 작업이 완료되면, **When** 작업이 성공적이면, **Then** Telegram으로 성공 메시지가 전송되어야 한다.
2. **Given** 동기화 작업이 실패하면, **When** 오류가 발생하면, **Then** Telegram으로 실패 알림과 간단한 오류 요약과 error log를 보는 방법이 전송되어야 하며, Notion 페이지의 `status`가 `error`로 변경되었음을 포함해야 한다.

---

### Edge Cases

- Notion 페이지에 포함된 대용량 이미지를 처리할 수 없는 경우: 최대 3회 재시도(지수 백오프), 최종 실패 시 생성된 리소스 원복 및 실패 보고
- Notion 또는 WordPress API의 일시적 레이트 리밋/오류: 최대 3회 재시도(지수 백오프), 각 재시도 실패 시 생성된 리소스 원복 후 오류 보고
- 동일 콘텐츠의 중복 업로드: MVP에서는 허용(향후 버전에서 idempotency 제공)
- Notion 페이지 삭제 시 WordPress의 대응 정책(자동 삭제 vs. 보존)
- `status` 필드 변경 중 동기화가 동시에 실행되는 경우: 트랜잭션/락 처리 또는 재시도
- 사용자가 `status`를 `adding`으로 변경했으나 WordPress 업로드 실패 시: 생성된 리소스 원복 후 `status`를 `error`로 변경
- `status`가 `complete`인 페이지를 사용자가 다시 `adding`으로 변경한 경우: 중복 생성 방지 로직 필요

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 시스템은 특정 Notion 데이터베이스 또는 페이지 집합을 모니터링할 수 있어야 한다. 효율성을 위해 시스템은 증분 스캔 방식을 사용하여 마지막 동기화 이후 수정된 페이지만 확인해야 한다.
- **FR-002**: 시스템은 스케줄(예약) 또는 수동 트리거에 따라 동기화를 실행할 수 있어야 한다.
- **FR-003**: 시스템은 Notion 페이지의 `status` 속성이 `adding`인 경우에만 WordPress의 draft 포스트로 생성해야 한다.
- **FR-004**: 시스템은 WordPress에 포스트 업로드 완료 후 Notion 페이지의 `status`를 `complete`로 변경해야 한다.
- **FR-005**: 시스템은 Notion 페이지 내 이미지 및 미디어를 전송하여 WordPress 포스트에 올바르게 포함/연결해야 한다.
- **FR-006**: 시스템은 동기화 성공/실패 이벤트를 Telegram으로 통지해야 한다.
- **FR-007**: 시스템은 동기화 과정에서 발생한 주요 오류를 로깅하고, 운영자가 확인할 수 있도록 요약을 제공해야 한다. 로그는 표준 출력/에러(stdout/stderr)로 출력되어 Docker 로그 시스템을 통해 확인 가능해야 한다.
- **FR-008**: MVP 범위에서는 동일 콘텐츠의 중복 업로드를 허용한다(향후 버전에서 idempotency 제공). 
- **FR-009**: 동기화 동작은 WordPress에 새로운 글을 "draft" 상태로 올려야 한다(관리자 수동으로 게시). 시스템은 Notion의 게시 날짜/시간 메타데이터를 WordPress에 동기화하지 않으며, 모든 초안은 관리자의 명시적 승인 후에만 게시된다.
- **FR-010**: 시스템은 `status`가 `writing` 상태인 페이지는 무시하고 동기화 대상에서 제외해야 한다.
- **FR-011**: 동기화 중 예상치 못한 오류 발생 시, 시스템은 생성된 WordPress 리소스(포스트/미디어)를 가능한 범위에서 원복하고 Notion 페이지의 `status`를 `error`로 변경해야 한다. API 호출 실패 시 최대 3회까지 지수 백오프 방식으로 재시도하며, 각 재시도 실패 시에도 생성된 리소스를 확실하게 원복해야 한다.
- **FR-012**: 이미지 파일명 충돌을 방지하기 위한 메커니즘(예: 고유 파일명 부여, 콘텐츠 기반 해싱 등)을 통해 서로 다른 내용의 동일 파일명이 업로드 실패를 야기하지 않도록 해야 한다.

### Key Entities *(include if feature involves data)*

- **NotionPage**: 페이지 식별자, 제목, 본문 블록, 첨부 미디어 메타데이터, 최종 수정일, **status 속성**(가능한 값: `writing`, `adding`, `complete`, `error`)
- **WPPost (Draft)**: WordPress 포스트 식별자, 제목, 본문(마크다운/HTML 변환 결과), 상태(draft), 관련 미디어 참조
- **ImageAsset**: 원본 URL 또는 바이너리, 변환된 미디어 식별자, 업로드 상태
- **SyncJob**: 스케줄 정보, 시작/종료 시간, 결과(성공/실패), 변경된 항목 목록, **마지막 동기화 타임스탬프**(증분 스캔 기준점)
- **Operator (Admin)**: 검토 및 게시 권한을 가진 사용자(운영자)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 새로운 Notion 페이지의 `status`가 `adding`으로 변경된 후, 다음 스케줄된 동기화 실행 내에(최대 5분 지연 허용) WordPress에 draft가 생성되어야 한다.
- **SC-002**: 업로드된 포스트의 이미지/미디어가 95% 이상 성공적으로 포함되어야 한다(테스트 배치에서 측정).
- **SC-003**: 동기화 작업 완료(성공/실패)에 대한 Telegram 알림이 1분 내에 전송되어야 한다.
- **SC-004**: 시스템은 하루 최대 5,000 페이지의 동기화 작업을 처리할 수 있어야 하며(처리율 측정), 처리 중 치명적 손실이 없어야 한다.
- **SC-005**: MVP에서는 동일 콘텐츠의 중복 업로드가 발생할 수 있다. 그럼에도 매핑 무결성은 검증 시 99% 이상 유지되어야 한다.

## Assumptions

- README에 명시된 기술 스택(TypeScript, Docker, SQLite)은 구현 권장사항으로 참고하지만, 이 스펙의 요구사항은 기술-중립적으로 정의되었다.
- 페이지와 포스트 간의 매핑 정보를 저장하기 위해 로컬 데이터베이스(SQLite)를 사용한다고 가정한다.
- 인증/권한(WordPress API 키, Notion integration token, Telegram bot token)은 환경 변수(.env 파일)를 통해 관리되며, Docker 컨테이너 실행 시 주입된다.
- 운영자는 WordPress에 게시 권한을 가진 계정을 보유하고 있다.
- MVP 범위에서는 콘텐츠 중복 업로드(idempotency) 기능을 제공하지 않으며, 동일 콘텐츠의 중복 업로드 발생을 허용한다(향후 버전에서 개선).

## Clarifications

### Session 2025-10-27

- Q: Notion 페이지(`status=adding`)가 WordPress에 초안으로 동기화될 때, Notion 페이지의 게시 날짜/시간 메타데이터도 함께 동기화하여 WordPress 포스트를 자동 예약 게시하도록 해야 할까요? → A: 아니오, 모든 초안은 게시 전 관리자의 수동 승인 필요
- Q: 동기화 주기마다 Notion 데이터베이스를 모니터링할 때, 전체 페이지를 매번 스캔해야 할까요, 아니면 마지막 동기화 이후 변경된 페이지만 확인해야 할까요? → A: 증분 스캔: 마지막 동기화 이후 수정된 페이지만 확인
- Q: Notion API 토큰, WordPress API 키, Telegram Bot 토큰 등의 인증 정보를 어떻게 관리해야 할까요? → A: 환경 변수(.env 파일)로 관리
- Q: Notion 또는 WordPress API 호출이 실패할 때(일시적 오류, 레이트 리밋 등), 재시도 정책은 어떻게 해야 할까요? → A: 최대 3회 재시도, 지수 백오프 적용. 각 재시도 실패 시 생성된 리소스를 확실하게 원복
- Q: 동기화 과정의 로그를 어디에 기록해야 할까요? → A: 표준 출력/에러(stdout/stderr)로 출력

## Notes

- 구현 세부(언어, 프레임워크, 라이브러리)는 이 스펙의 범위에서 제외되며, 구현 단계에서 결정한다.
- 주요 환경변수(.env)는 Docker bind mount를 통해 영속성을 보장해야 한다.
- SQLite 데이터베이스는 Docker 볼륨 또는 bind mount를 통해 영속성을 보장해야 한다.
