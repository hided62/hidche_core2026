# 삼국지 모의전투 HiDCHe core2026

`core2026`은 `../ref/sam`의 PHP 서비스를 TypeScript로 호환 이관하는 pnpm
모노레포입니다. 전투·턴·권한·저장 상태·API·화면 동작은 ref 구현과 실제 실행
결과를 기준으로 검증합니다.

## 저장소 구성

| 경로                           | 책임                                                           |
| ------------------------------ | -------------------------------------------------------------- |
| `app/gateway-frontend`         | 가입, 로그인, 로비, 계정, 관리자 UI                            |
| `app/gateway-api`              | 계정·세션, profile 정책, operation queue, PM2 orchestration    |
| `app/game-frontend`            | profile별 게임 SPA와 ref 호환 화면                             |
| `app/game-api`                 | tRPC, SSE, 인증, 조회·입력 API, 비동기 worker                  |
| `app/game-engine`              | turn daemon, AI, 월간 lifecycle, in-memory world와 DB flush    |
| `packages/common`              | 공통 타입, 직렬화, 인증 token, 결정적 RNG                      |
| `packages/logic`               | 명령, constraint, 전투, trait·item·병종 action module          |
| `packages/infra`               | gateway/game Prisma schema, migration, PostgreSQL·Redis client |
| `packages/tools-scripts`       | resource schema 생성과 검증                                    |
| `resources`                    | scenario, map, unit set, turn-command profile                  |
| `tools/integration-tests`      | PostgreSQL·Redis 및 ref↔core 차등 검증                         |
| `tools/frontend-legacy-parity` | Chromium 기반 화면·상호작용 비교                               |
| `tools/legacy-db-migration`    | 레거시 장기보존 데이터 이관 CLI                                |
| `tools/docs`                   | 플레이어 커맨드 문서 생성                                      |

구조와 실행 흐름은 [아키텍처 개요](docs/architecture/overview.md), 파일별 변경
위치는 [개발자 핸드북](docs/developer/index.md)에서 확인해 주세요. ref entry
point와 core 구현의 대응 근거는 상위 작업공간의
`../docs/ref-core2026-mapping.md`에 있습니다.

## 런타임 경계

Gateway는 계정과 profile 운영을 소유합니다. `gateway-api`가 gateway
PostgreSQL과 Redis session을 사용하며, game session token을 발급합니다.
관리 operation은 `GatewayProfile`과 `GatewayOperation`에 저장되고
orchestrator가 commit별 worktree와 PM2 process를 조정합니다.

각 game profile은 별도 PostgreSQL schema를 사용합니다. `game-api`는 인증된
요청을 검증하고 직접 처리할 mutation 또는 daemon 입력을
`InputEvent`에 기록합니다. `game-engine`은 DB lease와 fencing token을 확보한
단일 실행자로서 world를 메모리에 적재하고, 명령·월간 이벤트·로그·예약 턴과
input-event 결과를 transaction으로 반영합니다. Redis pub/sub과 SSE는 알림
경로이며 gameplay commit의 기준 저장소가 아닙니다.

자세한 흐름은 [런타임 아키텍처](docs/architecture/runtime.md)와
[요청·턴·저장 흐름](docs/developer/request-turn-persistence.md)을 확인해
주세요.

## 도구 체인

- pnpm `11.17.0`, Turbo
- TypeScript `6.0.2`
- Fastify, tRPC, zod
- Vue 3, Pinia, Vue Router, Vite
- PostgreSQL, Prisma, Redis
- Vitest, Playwright/Chromium
- VitePress

Node.js 버전은 저장소에서 고정하지 않습니다. 의존성 설치와 검증에는
`package.json`과 `pnpm-lock.yaml`을 함께 사용해 주세요.

## 개발 환경

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm --filter @sammo-ts/infra prisma:generate
CI=1 pnpm typecheck
```

`.env`는 Git에서 제외됩니다. 비밀값은 명령행, 로그, screenshot, report,
`VITE_*` 변수에 넣지 말아 주세요. 상위 작업공간에서는
`../docker_compose_files/development/README.md`의 PostgreSQL·Redis stack을
worktree별로 준비할 수 있습니다.

```sh
cd ../docker_compose_files/development
./scripts/prepare-instance.sh main 15433 16379 ../../core2026
./scripts/compose.sh main up -d --wait
```

통합 테스트는 schema를 truncate하거나 Redis key를 정리할 수 있습니다. 다른
worktree나 개발 데이터와 같은 instance를 공유하지 말아 주세요.

## 검증 명령

```sh
pnpm lint
CI=1 pnpm typecheck
pnpm test
pnpm build
pnpm test:integration
```

PostgreSQL·Redis 조건부 suite는 격리된 서비스를 준비한 뒤 실행합니다.

```sh
pnpm test:integration:conditional
```

ref 명령 계약과 실제 화면은 다음 명령으로 비교합니다.

```sh
pnpm check:legacy:general
pnpm check:legacy:nation
pnpm test:e2e:frontend-legacy
pnpm test:e2e:main-front-status-live
pnpm test:e2e:main-records-live
```

각 명령의 fixture, 서비스, 인증 요구사항은
[테스트 정책](docs/testing-policy.md),
[통합 테스트](docs/integration-tests.md),
[프론트엔드 호환 검증](docs/frontend-legacy-parity.md)에 있습니다. skip된
테스트와 mock 검증은 실제 외부 서비스 검증으로 간주하지 않습니다.

## 문서

```sh
pnpm docs:generate
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

`docs:generate`는 등록된 장수·국가 command spec에서
`docs/user/command-catalog.generated.md`를 만듭니다. 생성 파일은 직접
수정하지 말아 주세요.

문서의 시작점은 다음과 같습니다.

- [core2026 핸드북](docs/index.md)
- [개발자 핸드북](docs/developer/index.md)
- [플레이어 가이드](docs/user/index.md)
- [아키텍처 개요](docs/architecture/overview.md)
- [런타임 아키텍처](docs/architecture/runtime.md)
- [차등 검증](docs/architecture/turn-state-differential-testing.md)
- [Caddy prefix 계약](docs/e2e-caddy-routing.md)
- [레거시 DB 이관](docs/legacy-db-migration.md)

## DB와 배포

Gateway schema는 `packages/infra/prisma/gateway.prisma`, game schema는
`packages/infra/prisma/game.prisma`가 정의합니다. migration은 각각
`gateway-migrations/`와 `migrations/`에 있습니다.

```sh
pnpm --filter @sammo-ts/infra prisma:migrate:status:game
pnpm --filter @sammo-ts/infra prisma:migrate:deploy:game
pnpm --filter @sammo-ts/infra prisma:migrate:deploy:gateway
pnpm migrate:legacy -- --help
```

Game과 gateway가 같은 database/schema를 쓰므로 deploy 순서는
`game → gateway`입니다. 양쪽 migration directory 이름은 공유
`_prisma_migrations`에서 충돌하지 않도록 전역적으로 고유해야 합니다.

활성 외부 prefix는 `/gateway/`, `/che/`, `/hwe/`입니다. 앱은 필요한
listener를 `0.0.0.0`에 bind하고 prefix를 보존한 frontend, tRPC, SSE,
direct-navigation URL을 사용합니다. `/image/*`는 외부 Caddy가 소유합니다.

`build:server`는 profile resource를 `dist/<profile>`에 복사하는 도구입니다.
완전한 API·daemon·frontend 배포 bundle은 gateway orchestrator의
commit-worktree build 경로에서 구성합니다.
