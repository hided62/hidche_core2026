# 파일 지도

먼저 증상이 보이는 화면이나 동작 하나를 고르고, 아래 시작점에서 호출을 따라가세요.
폴더 이름만으로 저장 책임이나 권한을 추측하지 않습니다. 읽는 순서는
[기초 안내](./first-steps.md)와 [경험자 안내](./system-walkthrough.md)에 있습니다.

## 최상위

```text
core2026/
├─ app/
│  ├─ gateway-frontend/
│  ├─ gateway-api/
│  ├─ game-frontend/
│  ├─ game-api/
│  ├─ game-engine/
│  └─ release-controller/
├─ packages/
│  ├─ common/
│  ├─ logic/
│  ├─ infra/
│  └─ tools-scripts/
├─ resources/
├─ tools/
└─ docs/
```

## 기능별 시작점

| 기능              | 시작점                                                     | 연결 경로                                   |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------- |
| gateway 인증·로비 | `app/gateway-api/src/router.ts`                            | `auth/`, `account/`, gateway frontend       |
| 관리자·profile    | `app/gateway-api/src/adminRouter.ts`                       | `orchestrator/`, gateway Prisma             |
| game server       | `app/game-api/src/server.ts`                               | config, context, tRPC, SSE, worker          |
| game router       | `app/game-api/src/router.ts`                               | `router/*`                                  |
| game actor        | `app/game-api/src/trpc.ts`                                 | auth token, procedure, router shared helper |
| 예약 턴 API       | `app/game-api/src/router/turns`                            | `turns/reservedTurns.ts`, input event       |
| turn daemon       | `app/game-engine/src/turn/turnDaemon.ts`                   | lifecycle, loader, handler, flush           |
| daemon lease      | `app/game-engine/src/lifecycle/databaseTurnDaemonLease.ts` | `TurnDaemonLease`                           |
| world load·flush  | `worldLoader.ts`, `databaseHooks.ts`                       | `EngineStateManager`, game Prisma           |
| package 경계      | `tools/check-package-boundaries.mjs`                       | source import, manifest dependency          |
| 장수·국가 명령    | `packages/logic/src/actions/turn`                          | constraint, command module, engine handler  |
| 전투              | `packages/logic/src/war`                                   | action module, crew type, item, trait       |
| 지도 거리 계산    | `packages/logic/src/world/distance.ts`                     | AI·명령이 공유하는 순수 BFS                 |
| 월간 처리         | `app/game-engine/src/turn/monthly*.ts`                     | scenario event, world dirty state           |
| frontend route    | `app/*-frontend/src/router/index.ts`                       | view, store, tRPC client                    |
| schema            | `packages/infra/prisma/*.prisma`                           | migration, client, loader                   |
| resource          | `resources/`                                               | `app/game-engine/src/scenario/*Loader.ts`   |

## 변경 단위

### API와 화면

Router의 input schema, procedure, actor 해석, transaction과 error를 먼저
확인합니다. Frontend의 loading, empty, success, error와 auth redirect를
연결합니다. Prefix에서 direct navigation, tRPC, SSE와 asset URL을 검증합니다.

### 게임 규칙

ref entry point, SQL, RNG, log와 mutation 순서를 조사합니다. 순수 계산은
`packages/logic`, 실행 context와 persistence는 `app/game-engine`에 둡니다.
Fixed-seed unit, 실제 DB integration과 ref 차등 fixture를 함께 갱신합니다.
새 package import나 파일 이동은
[패키지 경계 문서](../architecture/package-boundaries.md)와
`pnpm check:architecture`로 확인합니다.

### DB

Prisma schema, 새 migration, generated client, runtime type, loader,
in-memory dirty marking, transaction flush와 reload를 연결합니다. 기존 migration
파일은 수정하지 않습니다.

### 문서

코드 구조는 `architecture/`와 `developer/`, 사용자 동작은 `user/`, ref
대응은 상위 mapping, 작업별 증거는 날짜가 있는 report에 기록합니다.
