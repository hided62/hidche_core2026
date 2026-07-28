# 파일 지도와 변경 절차

## 최상위 지도

```text
core2026/
├─ app/
│  ├─ gateway-frontend/   계정·로비·관리 UI
│  ├─ gateway-api/        인증·profile·operation·orchestrator
│  ├─ game-frontend/      profile 게임 SPA
│  ├─ game-api/           tRPC/SSE와 mutation 수신
│  └─ game-engine/        turn daemon과 persistence orchestration
├─ packages/
│  ├─ common/             공통 타입·직렬화·RNG
│  ├─ logic/              명령·constraint·전투·trigger·scenario
│  ├─ infra/              Prisma·PostgreSQL·Redis
│  └─ tools-scripts/      resource schema 도구
├─ resources/             scenario·map·unitset·명령 profile
├─ tools/
│  ├─ integration-tests/  DB/Redis 및 ref 차등
│  ├─ frontend-legacy-parity/ 실제 Chromium 비교
│  ├─ legacy-db-migration/ 장기보존 데이터 CLI
│  ├─ build-scripts/      profile resource 복사 기반 build 도구
│  └─ docs/               문서 생성 도구
└─ docs/                  VitePress 소스와 상세 설계 문서
```

## 기능에서 파일로

| 기능           | 시작점                                        | 핵심 하위 경계                        |
| -------------- | --------------------------------------------- | ------------------------------------- |
| 로그인·session | `gateway-api/src/router.ts`                   | `auth/*`, `account/router.ts`, Redis  |
| profile 운영   | `gateway-api/src/adminRouter.ts`              | `orchestrator/*`, gateway Prisma      |
| 게임 인증      | `game-api/src/context.ts`, `router/auth`      | session actor, profile·sanction       |
| 메인 턴 입력   | `game-frontend/src/stores/mainDashboard.ts`   | `router/turns`, `turns/*`             |
| command 실행   | `game-engine/src/turn/reservedTurnHandler.ts` | `packages/logic/src/actions/turn`     |
| 월간 lifecycle | `game-engine/src/turn/turnDaemon.ts`          | `monthly*Handler.ts`, scenario events |
| 전투           | `actions/turn/general/che_출병.ts`            | `packages/logic/src/war`              |
| DB load/flush  | `game-engine/src/turn/worldLoader.ts`         | `databaseHooks.ts`, `packages/infra`  |
| 공개/국가 정보 | `game-api/src/router/public`, `router/nation` | DTO와 redaction                       |
| 화면 parity    | `game-frontend/src/views`, `styles`           | `tools/frontend-legacy-parity`        |

## 변경 절차

### API나 화면

router의 input, auth procedure, transaction과 response를 먼저 정한 뒤 frontend 호출부와 오류·loading 상태를
연결합니다. public prefix에서 direct navigation, asset, tRPC와 SSE URL을 확인합니다. UI를 바꾸면 실제
Chromium에서 ref와 geometry·computed style·interaction을 비교합니다.

### 도메인 로직

ref entry point부터 SQL·로그까지 호출 순서를 찾고, `packages/logic` 계산과 engine context/persistence를 함께
수정합니다. unit test만으로 끝내지 않고 fixed seed, 전체 state, RNG trace, 실패 side effect와 가능한
ref 차등을 확인합니다.

### DB

기존 migration을 고치지 않고 새 migration을 만듭니다. 빈 DB 전체 적용, 기존 DB 증분 적용, 재실행 no-op,
constraint/index와 runtime query, backup/restore 또는 rollback 경로를 확인합니다.

## 문서 사이트

```sh
pnpm install
pnpm docs:generate
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

`docs:dev`와 `docs:build`는 먼저 커맨드 목록을 생성합니다. 정적 결과는 `docs/.vitepress/dist`에 생기며
Git에 포함하지 않습니다. 문서만 바꿔도 Prettier, 생성 결과의 clean diff, VitePress build와 내부 링크를
검증해 주세요.

## 리팩터링 체크포인트

- [문서 기준선](../reference-baseline.md)과 현재 commit의 diff를 먼저 봅니다.
- 파일 이동만 했는지 소유권·transaction·호출 순서까지 바뀌었는지 구분합니다.
- public API, DB schema, action key와 resource format은 내부 파일명보다 강한 계약입니다.
- `rg`로 이 페이지의 이전 경로가 남았는지 확인합니다.
- command key를 바꿨다면 저장된 예약 턴과 profile resource의 migration/호환 경로가 필요합니다.
- 문서의 광범위한 “완료” 표현은 관련 integration·ref 차등·Chromium 증거가 있을 때만 사용합니다.
