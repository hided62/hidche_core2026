# 삼국지 모의전투 HiDCHe — core2026

`core2026`은 삼국지 모의전투 HiDCHe(삼모/삼모전/힏체섭)의 PHP 서비스를
TypeScript로 호환 이관하는 pnpm 모노레포입니다. 기준 구현은 이 저장소 안의
`legacy/`가 아니라 작업공간의 `../ref/sam`이며, 제품 동작·저장 상태·화면은
그 기준과 실제 실행 결과를 대조합니다.

## 현재 상태

2026-07-27의 `main` 기준으로 gateway, game API/프론트엔드, turn daemon과
주요 게임 명령·월간 이벤트가 구현되어 있습니다. 최근 백엔드 누락 감사에서
재현 가능한 구체적 미구현 또는 미병합 항목은 남지 않았지만, 이것이 전체
호환성이나 운영 준비 완료를 뜻하지는 않습니다.

현재 열린 경계는 주로 다음과 같습니다.

- 아직 fixture가 없는 명령 실패값·조합과 live 출병 조합의 차등 범위 확대
- 실제 배포 profile에서 worker의 장시간 소비, 재시작, host/firewall 장애 검증
- 인증 fixture가 필요한 화면과 남은 페이지의 Chromium 룩앤필 비교
- 외부 Caddy의 `/gateway/`, `/che/`, `/hwe/` 경로에서 tRPC, SSE, 자산,
  새로고침과 로그인 인계의 반복 검증
- 운영 DB 이관 전 backup/restore, maintenance mode와 dry-run count 재확인

테스트가 통과했다는 사실만으로 PHP 기준과의 호환성이 증명되지는 않습니다.
기능별 근거와 남은 범위는 작업공간의 `../docs/ref-core2026-mapping.md`와
`../report/`를 함께 확인해 주세요.

## 구성

| 경로                           | 역할                                              |
| ------------------------------ | ------------------------------------------------- |
| `app/gateway-frontend`         | 가입·로그인, 로비, 계정과 관리자 운영 UI          |
| `app/gateway-api`              | 계정·세션·profile 정책과 PM2 운영 orchestration   |
| `app/game-frontend`            | 게임 SPA와 ref 룩앤필 호환 화면                   |
| `app/game-api`                 | profile별 tRPC/SSE, 조회·입력 API와 비동기 worker |
| `app/game-engine`              | 턴 scheduler/daemon, 월간 처리와 DB flush         |
| `packages/common`              | 공통 타입, 직렬화, 결정적 RNG와 유틸리티          |
| `packages/logic`               | 전투·명령·월간 action 등 게임 도메인 로직         |
| `packages/infra`               | game/gateway Prisma schema, migration과 client    |
| `packages/tools-scripts`       | resource schema 생성·검증 도구                    |
| `tools/integration-tests`      | PostgreSQL/Redis 및 ref↔core 통합·차등 테스트     |
| `tools/frontend-legacy-parity` | 실제 Chromium 기반 화면·상호작용 비교             |
| `tools/legacy-db-migration`    | 레거시 장기보존 데이터 CLI 이관                   |
| `tools/docs`                   | 플레이어 커맨드 문서 자동 생성                    |
| `resources/scenario`           | 시나리오 본문과 조합 가능한 이벤트·규칙 확장      |
| `docs`                         | VitePress 핸드북과 런타임·테스트·운영 문서        |

런타임의 영속 입력은 PostgreSQL `input_event`가 담당합니다. game API가
요청을 기록하고 turn daemon이 claim한 뒤, 게임 상태·로그·예약 턴·결과와
event 완료를 transaction으로 commit합니다. Redis는 session, realtime fan-out,
battle simulation 등 해당 기능의 계약에만 사용하며 게임 mutation의 영속
성공 여부를 대신하지 않습니다. 자세한 흐름은
[`docs/architecture/runtime.md`](docs/architecture/runtime.md)와
[`docs/architecture/turn-daemon-lifecycle.md`](docs/architecture/turn-daemon-lifecycle.md)에
있습니다.

## 도구 체인

- pnpm workspace와 Turbo
- TypeScript `6.0.2` 고정
- Node.js + Fastify + tRPC + zod
- Vue 3 + Pinia + Vue Router + Vite
- PostgreSQL + Prisma, Redis
- Vitest와 Playwright/Chromium
- VitePress 정적 HTML 문서 사이트

package manager 버전은 루트 `package.json`의 `packageManager`를 따릅니다.
현재 값은 `pnpm@11.17.0`입니다. 저장소는 Node `engines`를 고정하지 않으므로
개발 호스트의 임의 버전을 README 계약으로 간주하지 말고, lockfile 설치와
전체 검증 결과로 호환성을 확인해 주세요.

## 로컬 시작

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm --filter @sammo-ts/infra prisma:generate
CI=1 pnpm typecheck
```

`.env`는 Git에서 제외됩니다. `.env.example`의 placeholder를 실제 비밀값으로
바꾸되 secret을 커밋, 명령행, 로그, 스크린샷 또는 `VITE_*` 변수에 넣지
말아 주세요.

PostgreSQL과 Redis가 필요합니다. 전체 `sam_rebuild` 작업공간에서는
`../docker_compose_files/development/README.md`의 worktree별 격리 stack을
사용할 수 있습니다. standalone checkout이라면 `.env.example` 계약에 맞는
별도 PostgreSQL/Redis를 준비해 주세요.

작업공간 helper를 사용하는 기본 예시는 다음과 같습니다.

```sh
cd ../docker_compose_files/development
./scripts/prepare-instance.sh main 15433 16379 ../../core2026
./scripts/compose.sh main up -d --wait

cd ../../core2026
pnpm --filter @sammo-ts/infra prisma:generate
pnpm test:integration
```

`prepare-instance.sh`는 ignored `.env`와 `.env.ci`를 생성합니다. 통합 테스트는
schema를 truncate하거나 Redis를 비울 수 있으므로 다른 worktree나 개발
데이터와 DB/Redis instance를 공유하지 말아 주세요. volume 삭제는 명시적으로
데이터 폐기를 결정한 경우에만 수행해 주세요.

## 자주 쓰는 명령

```sh
pnpm lint
pnpm test
CI=1 pnpm typecheck
pnpm build
pnpm dev
```

`pnpm test`의 일부 PostgreSQL/Redis 테스트는 전용 환경 변수가 없으면
의도적으로 skip됩니다. 외부 서비스가 필요한 경계까지 실행하려면 격리된
instance를 준비한 뒤 다음을 사용해 주세요.

```sh
pnpm test:integration
pnpm test:integration:conditional
```

레거시 명령의 정적 계약과 실제 Chromium 화면 비교는 각각 다음 entry
point를 사용해 주세요.

```sh
pnpm check:legacy:general
pnpm check:legacy:nation
pnpm test:e2e:frontend-legacy
```

이 명령들은 ref checkout, fixture, 로그인 상태 또는 별도 서비스가 필요할
수 있습니다. 실행 조건과 coverage는
[`docs/integration-tests.md`](docs/integration-tests.md)와
[`docs/frontend-legacy-parity.md`](docs/frontend-legacy-parity.md)를 따라 주세요.

프론트엔드나 개별 서비스만 실행할 때는 workspace filter를 사용해 주세요.

```sh
pnpm --filter @sammo-ts/gateway-frontend dev
pnpm --filter @sammo-ts/gateway-api dev
pnpm --filter @sammo-ts/game-frontend dev
pnpm --filter @sammo-ts/game-api dev
pnpm --filter @sammo-ts/game-engine dev
```

## 문서 사이트

개발자 아키텍처·파일 흐름·핵심 클래스와 플레이어 커맨드·시기별 가이드는
[`docs/index.md`](docs/index.md)에서 시작합니다. VitePress 개발 서버와 정적 HTML
빌드는 다음 명령으로 실행합니다.

```sh
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

`docs:dev`와 `docs:build`는 먼저 `pnpm docs:generate`를 실행합니다. 이 단계는
현재 장수·국가 명령 등록부와 각 `commandSpec`에서
`docs/user/command-catalog.generated.md`를 다시 만듭니다. 생성 파일을 직접
수정하지 말고 명령 정의나 생성기를 고쳐 주세요. 정적 HTML은
`docs/.vitepress/dist`에 생성되며 Git에서 제외됩니다.

핸드북이 조사한 코드 기준은
[`docs/reference-baseline.md`](docs/reference-baseline.md)에 고정해 두었습니다.
기능 리팩터링 뒤에는 기준 commit부터 현재 commit까지의 diff를 대조하고 관련
페이지, 생성 목록과 기준선을 같은 변경에서 갱신해 주세요.

## DB schema와 migration

Gateway는 기본적으로 PostgreSQL `public` schema를 사용하고, 게임은
`PROFILE`별 schema를 사용합니다.

```sh
pnpm --filter @sammo-ts/infra prisma:migrate:status:game
pnpm --filter @sammo-ts/infra prisma:migrate:deploy:game
pnpm --filter @sammo-ts/infra prisma:migrate:deploy:gateway
```

새 영속 필드는 Prisma schema와 migration만 추가해서 끝내지 말아 주세요. runtime
model/type, loader, transaction flush와 실제 PostgreSQL 검증까지 연결해 주세요.
기존 migration 파일이나 checksum을 고치지 말아 주세요.

레거시 장기보존 데이터 이관은 HTTP 기능이 아닌 CLI입니다. 기본 동작은
dry-run이며 실제 쓰기에는 `--apply`가 필요합니다.

```sh
pnpm migrate:legacy -- --help
```

현재 기수의 `general`, `city`, `nation`, queue, 시장, 메시지 등은 이관
범위가 아닙니다. 운영 적용 절차와 table별 범위는
[`docs/legacy-db-migration.md`](docs/legacy-db-migration.md)와
[`tools/legacy-db-migration/README.md`](tools/legacy-db-migration/README.md)를
따라 주세요.

## 배포 경로와 자산

현재 외부 계약의 활성 경로는 gateway `/gateway/`, game `/che/`와 `/hwe/`입니다.
프론트 build와 API는 같은 prefix의 tRPC/SSE/direct navigation 계약을
지켜야 합니다. `/image/*`는 외부 Caddy가 별도 파일 시스템에서 제공하므로 앱이
rewrite하거나 복제하지 말아 주세요.

`kwe`, `twe`, `nya`, `pya`, `pwe` 같은 profile 이름이 코드나 계획 문서에
존재하더라도 외부 route가 활성화됐다는 뜻은 아닙니다. 실제 포트와 build-time
환경 변수는 [`docs/e2e-caddy-routing.md`](docs/e2e-caddy-routing.md)를
현재 인프라와 다시 대조해 주세요.

루트의 `build:server` 스크립트는 현재 profile resource를 `dist/<profile>`로
복사하기 위한 placeholder이며, API·daemon·frontend의 완전한 배포 bundle을
만들지 않습니다. 운영 build는 gateway operation/orchestrator와 profile별
worktree 흐름을 사용합니다.

## 호환성 원칙

- 전투 결과, 판정·반올림·정렬과 RNG 소비 순서를 최우선으로 보존합니다.
- actor와 archive owner는 인증 session에서 서버가 결정합니다. client가 보낸
  general ID나 owner 값을 권한 근거로 신뢰하지 않습니다.
- gameplay 난수는 `packages/common/src/util/LiteHashDRBG.ts`,
  `RNG.ts`, `RandUtil.ts`의 기존 흐름을 사용합니다.
- ref와 같은 viewport, Chromium, font, image, 로그인 fixture에서 geometry와
  hover/focus/active/disabled 상태를 비교합니다.
- 동일한 CSS class 이름만으로 page별 layout을 합치지 않습니다. 공통 token과
  shell의 기준은 [`docs/frontend-css-architecture.md`](docs/frontend-css-architecture.md)입니다.
- mock/local E2E 성공과 외부 Caddy·운영 데이터 검증을 구분합니다.

## 핵심 문서

- [core2026 핸드북](docs/index.md)
- [문서 기준 커밋](docs/reference-baseline.md)
- [개발자 핸드북](docs/developer/index.md)
- [플레이어 가이드](docs/user/index.md)
- [테스트 정책](docs/testing-policy.md)
- [테스트 suite 감사](docs/test-suite-audit.md)
- [통합 테스트](docs/integration-tests.md)
- [프론트엔드 ref 호환 검증](docs/frontend-legacy-parity.md)
- [Caddy prefix E2E](docs/e2e-caddy-routing.md)
- [레거시 DB 이관](docs/legacy-db-migration.md)
- [TypeScript 버전 정책](docs/architecture/typescript-version.md)
- [저장소 작업 지침](AGENTS.md)
