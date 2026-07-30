# 시스템 아키텍처

## 런타임 구성

```text
브라우저
  ├─ /gateway/ ─ gateway-frontend ─ tRPC ─ gateway-api
  │                                      ├─ PostgreSQL public schema
  │                                      ├─ Redis session
  │                                      └─ orchestrator ─ Git worktree / build / PM2
  │
  └─ /{profile}/ ─ game-frontend ─ tRPC/SSE ─ game-api
                                             ├─ profile별 PostgreSQL schema
                                             ├─ Redis realtime/battle worker
                                             └─ input_event ─ game-engine
                                                              ├─ in-memory world
                                                              └─ transactional flush
```

Gateway는 계정·session·profile lifecycle을, game 계층은 한 profile의 플레이와 턴 진행을 소유합니다.
`/gateway`, `/che`, `/hwe` 같은 외부 prefix와 `/image/*`의 Caddy 소유권은 애플리케이션 밖의 배포
계약입니다.

## 애플리케이션

### gateway-frontend

`app/gateway-frontend/src/main.ts`가 Vue 앱과 router를 시작합니다. 가입·로그인·계정·로비·관리자 화면은
`src/views`에 있고, profile 선택 뒤 game frontend로 이동합니다. 브라우저에 보이는 `VITE_*` 값은
공개 설정이며 secret이 아닙니다.

### gateway-api

`app/gateway-api/src/server.ts`와 `router.ts`가 HTTP/tRPC 경계입니다.

- `auth/*`, `account/router.ts`: Kakao·로컬 계정, session 발급·폐기, 사용자 저장소
- `lobby/profileStatusService.ts`: 사용자에게 보여 줄 profile 상태
- `adminRouter.ts`, `adminAuth.ts`: 관리자 권한과 operation 입력
- `orchestrator/*`: 원하는 profile 상태를 Git worktree, build, seed, PM2 프로세스에 반영

Gateway DB는 기본 `public` schema를 사용합니다. game profile DB를 직접 게임 로직의 source of truth로
대체하지 않습니다.

### game-frontend

`app/game-frontend/src/main.ts`가 profile base path 아래 Vue SPA를 시작합니다. `src/views`가 공개 정보,
메인 턴 입력, 국가 운영, 경매·토너먼트·기록 화면을 나누고 `src/stores/mainDashboard.ts`가 메인 화면의
query, 예약 턴 revision, mutation과 realtime refresh를 조정합니다.

UI는 서버가 반환한 command table의 `available`, `blocked`, `needsInput`, `unknown` 상태를 사용합니다.
클라이언트가 장수 ID나 직책을 보냈다는 이유만으로 권한이 생기지 않습니다.

### game-api

`app/game-api/src/server.ts`와 `router.ts`가 query/mutation을 공개합니다. router는 기능 단위로
`src/router/*`에 나뉩니다.

- 읽기: world, public, directory, ranking, yearbook, dynasty 등은 권한·redaction을 거쳐 DB에서 조회합니다.
- 플레이: turns, join, nation, troop, diplomacy, messages, auction, betting, tournament 등이 있습니다.
- mutation: `inputEventBoundary.ts`가 idempotency와 PostgreSQL 작업 경계를 만듭니다.
- realtime: SSE와 Redis 알림은 commit 이후 화면 갱신 신호입니다.

### game-engine

`app/game-engine/src/index.ts`가 daemon entry point이고 `src/turn/turnDaemon.ts`가 profile resource,
world snapshot, command registry, calendar handler, persistence hook과 lease를 조립합니다.

한 daemon owner가 `TurnDaemonLifecycle`을 통해 정해진 tick과 durable inbox를 처리합니다. 실제 장수·도시·국가
상태는 `InMemoryTurnWorld`에서 계산하고, 성공한 작업만 `databaseHooks.ts`를 통해 PostgreSQL에 flush합니다.
lease/fencing은 오래된 daemon owner의 commit을 막습니다.

## 공유 package

| package                  | 책임                                                                            | 넣지 말아야 할 것                  |
| ------------------------ | ------------------------------------------------------------------------------- | ---------------------------------- |
| `packages/common`        | 공통 type, 직렬화, `LiteHashDRBG`, `RandUtil`, session/sanction 유틸리티        | profile DB orchestration           |
| `packages/logic`         | entity, constraint, command, battle, trigger, scenario parsing 같은 도메인 계산 | HTTP·Vue·Prisma transaction 소유권 |
| `packages/infra`         | Prisma client, PostgreSQL·Redis connector, log와 turn-engine DB adapter         | 게임 규칙 결정                     |
| `packages/tools-scripts` | resource schema 생성·검증                                                       | 런타임 요청 처리                   |

## 데이터와 구성

- `packages/infra/prisma/schema.gateway.prisma`: 계정·profile·operation 같은 gateway 모델
- `packages/infra/prisma/schema.game.prisma`: profile별 world·general·city·nation·turn·event·log 모델
- `resources/scenario`: 시작 연도, 상수, 월간 event 등 scenario 정의.
  `extensions/`의 이벤트·규칙·아이템 팩은 `extends`로 순서 있게 합성합니다.
- `resources/map`, `resources/unitset`: 지형과 병종 정의
- `resources/turn-commands`: profile별 허용 명령 목록

새 persistence field는 schema와 새 migration만으로 끝나지 않습니다. domain type, loader, in-memory dirty
tracking, transaction flush, reload 검증까지 연결해야 합니다.

## 인증·권한 모델

Gateway session은 사용자 identity를, game token은 profile과 게임 역할을 전달합니다. game API는 session으로
내 장수를 조회한 뒤 그 장수의 국가·직책·sanction과 대상 resource의 관계를 판단합니다. 공개 endpoint도
비공개 국가 정보, 타 사용자 archive, 비밀 명령을 DTO에서 제거해야 합니다.

권한 변경을 검증할 때는 무인증, 일반 사용자, 본인, 같은 국가, 다른 국가, NPC, 직책 보유자, sanction
적용자를 필요한 범위에서 나눕니다. 거부된 mutation은 world와 queue에 side effect를 남기지 않아야 합니다.
