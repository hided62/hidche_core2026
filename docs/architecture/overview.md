# core2026 아키텍처

## 시스템 경계

`core2026`은 계정·profile 운영을 담당하는 gateway와 profile별 게임 런타임을
분리합니다.

```text
browser
  ├─ gateway-frontend ── tRPC ── gateway-api
  │                                  ├─ gateway PostgreSQL
  │                                  ├─ Redis session
  │                                  └─ GatewayOrchestrator ── worktree / PM2
  └─ game-frontend ───── tRPC/SSE ─ game-api
                                      ├─ profile PostgreSQL
                                      ├─ Redis worker/fan-out
                                      └─ input_event ── game-engine
                                                          ├─ DB lease/fencing
                                                          ├─ in-memory world
                                                          └─ transactional flush
```

Gateway session과 game session token은 별도 수명을 가집니다. game API는
token의 user, profile, role, sanction을 검증하고, 장수·국가 소유권은
PostgreSQL 상태와 결합해 서버에서 결정합니다.

## 애플리케이션

### Gateway

- `app/gateway-frontend`는 가입, 로그인, 로비, 계정, 관리자 화면을 제공합니다.
- `app/gateway-api/src/router.ts`는 인증·로비·계정 router를 조립합니다.
- `app/gateway-api/src/adminRouter.ts`는 관리자 인증 뒤 사용자·profile·operation
  기능을 제공합니다.
- `app/gateway-api/src/orchestrator/`는 DB operation queue, commit별 worktree,
  build, PM2 process와 예약 상태를 조정합니다.

### Game

- `app/game-frontend`는 profile base path에서 실행하는 Vue SPA입니다.
- `app/game-api/src/router.ts`는 auth, public, general, nation, turns, board,
  message, auction, tournament, archive 등 도메인 router를 조립합니다.
- `app/game-api/src/realtime/`은 commit 이후 알림을 SSE로 전달합니다.
- `app/game-api/src/daemon/`, `battleSim/`, `auction/`, `tournament/`는 각 worker
  transport와 scheduler를 소유합니다.
- `app/game-engine/src/turn/turnDaemon.ts`는 world loader, 명령 registry,
  AI, 월간 action, persistence hook을 조립합니다.
- `TurnDaemonLifecycle`은 clock, schedule, pause/resume/run command와 한 번의
  실행 transaction을 제어합니다.

## 공유 package

### `packages/common`

프로세스 사이에 공유하는 타입, schema, 인증 token, 직렬화와 RNG가 있습니다.
Gameplay 난수는 `LiteHashDRBG`, `RNG`, `RandUtil` 경로를 사용합니다.

### `packages/logic`

DB와 서버 process에 종속되지 않는 게임 규칙을 소유합니다.

- `actions/`: 장수·국가 command definition과 실행 결과
- `constraints/`: 예약·실행 조건과 state view
- `actionModules/`: trait·관직·병종·계승·item 효과 조립
- `war/`: 전투 unit, phase, trigger와 결과
- `scenario/`, `world/`: resource schema와 world 타입
- `items/`, `crewType/`, `inheritance/`, `diplomacy/`: 도메인 catalog

Command는 `GeneralActionDefinition` 또는 국가 command module로 args,
constraint, turn metadata, 결과와 로그를 선언합니다. 런타임 context와
persistence는 `app/game-engine`이 제공합니다.

### `packages/infra`

`prisma/gateway.prisma`와 `prisma/game.prisma`가 영속 schema의 기준입니다.
`src/gatewayPrisma.ts`, `src/gamePrisma.ts`, `src/postgres.ts`, `src/redis.ts`가
연결과 client 생성을 담당합니다.

구체적인 import 방향과 파일 배치 기준은
[패키지와 파일 경계](./package-boundaries.md)를 따릅니다. 순수 거리 계산과
도메인 로그 enum은 `packages/logic`, resource 파일 loader와 trace 출력은
app/infra adapter가 소유합니다.

## 데이터 소유권

| 데이터                        | 기준 저장소                          | 주요 접근 경로        |
| ----------------------------- | ------------------------------------ | --------------------- |
| 사용자·계정·profile·operation | gateway PostgreSQL                   | gateway API           |
| gateway session·flush signal  | Redis                                | gateway API           |
| world·장수·국가·도시·턴·로그  | profile PostgreSQL                   | game API, game engine |
| durable 입력과 실행 상태      | profile PostgreSQL `InputEvent`      | game API, game engine |
| turn daemon 소유권            | profile PostgreSQL `TurnDaemonLease` | game engine           |
| realtime 알림                 | Redis와 SSE                          | game API              |
| scenario·map·unit set         | `resources/`                         | game engine, build    |
| 이미지                        | 외부 `/image/*`                      | Caddy                 |

게임 상태 mutation은 PostgreSQL transaction이 확정합니다. Redis 전달 성공을
DB commit의 대체 조건으로 사용하지 않습니다.

## 시나리오와 profile

`profile`은 규칙·자산 계열이고 `scenario`는 게임 초기 데이터입니다.
런타임 식별자는 `${profile}:${scenario}`입니다. Scenario JSON은
`resources/scenario`에서 합성되고 zod parser를 거쳐 seeder와 runtime에
전달됩니다. map, unit set, turn-command profile도 resource loader를 통해
선택됩니다.

## 구현을 찾는 순서

1. frontend route와 store에서 사용자 흐름을 찾습니다.
2. gateway/game tRPC router에서 input, auth, transaction을 찾습니다.
3. engine command registry와 handler에서 실행 순서를 찾습니다.
4. `packages/logic`에서 constraint, 계산, trigger를 찾습니다.
5. Prisma schema, loader, dirty state, flush hook에서 저장 경계를 찾습니다.
6. unit·integration·differential·Chromium fixture에서 보장 범위를 확인합니다.

ref 대응은 상위 작업공간의 `../docs/ref-core2026-mapping.md`를 사용합니다.
현재 코드 경로가 문서의 근거이며, 보고서의 완료 표현만으로 구현 상태를
판정하지 않습니다.
