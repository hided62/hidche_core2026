# 삼국지 모의전투 HiDCHe core2026

`core2026`은 `../ref/sam`의 PHP 서비스를 TypeScript로 호환 이관하는 pnpm
모노레포입니다. 전투·턴·권한·저장 상태·API·화면 동작은 ref 구현과 실제 실행
결과를 기준으로 검증합니다.

## 저장소 구성

| 경로                           | 책임                                                           |
| ------------------------------ | -------------------------------------------------------------- |
| `app/gateway-frontend`         | 가입, 로그인, 로비, 계정, 관리자 UI                            |
| `app/gateway-api`              | 계정·세션, profile 정책, operation queue, PM2 orchestration    |
| `app/release-controller`       | Gateway 전체 릴리스와 controller CLI self-upgrade              |
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
패키지 의존 방향과 파일 배치 규칙은
[패키지와 파일 경계](docs/architecture/package-boundaries.md)에 고정되어 있으며
`pnpm check:architecture`로 검사합니다.

## 런타임 경계

Gateway는 계정과 profile 운영을 소유합니다. `gateway-api`가 gateway
PostgreSQL과 Redis session을 사용하며, game session token을 발급합니다.
관리 operation은 `GatewayProfile`과 `GatewayOperation`에 저장되고
orchestrator가 commit별 worktree와 PM2 process를 조정합니다.
Gateway 자체 릴리스는 Gateway 프로세스 밖의 `release-controller`가 별도
`GatewayReleaseOperation` queue를 처리합니다.

Kakao 계정은 OAuth callback과 일반 비밀번호 로그인 모두에서 Kakao 고유 ID와
현재 인증 이메일을 다시 확인합니다. 로컬 고유 ID 연결이 없지만 영구 보존된
이메일 계정이 있으면 자동 로그인하지 않고 그 계정에 연결할지 묻습니다. 기존
계정 연결을 확인하면 이전 Kakao ID와 과거 talk proof를 교체하고 새
“나와의 채팅” 숫자 코드로 다시 증명한 뒤에만 Gateway session을 발급합니다.
Kakao가 `already registered`를 반환했지만 보존 이메일 계정도 없으면 재가입
확인 뒤 신규 가입 form을 엽니다. 이미 로컬에 연결된 stable ID의 변경 이메일이
다른 계정에 있으면 기존처럼 충돌을 거부합니다.

Kakao 인증을 사용할 수 없는 운영·검증·복구 계정은 Gateway의 특수 접근 자격으로
게임 서버에 들어갈 수 있습니다. `superuser`, `admin`, `admin.*` role은 운영자
자격으로 모든 profile과 장수 생성에 자동 허용됩니다. 그 밖의 계정은 관리자
콘솔에서 `TESTER`, `RECOVERY`, `OTHER` grant를 profile 범위, 만료, 장수 생성
허용 여부와 사유를 지정해 부여합니다. `RECOVERY`는 최대 90일의 만료가 필수이며,
부여·해제는 감사 원장과 별도 DB 이력에 모두 남습니다. 계정 제재는 이 자격보다
먼저 검사됩니다. 기존 Kakao 연결 계정이 인증 수단을 잃은 경우에도 비밀번호
인증은 유지하면서 유효한 특수 자격 기간에는 Kakao 공급자 호출 없이 로그인할 수
있습니다.

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

- pnpm `11.21.0`, Turbo
- TypeScript `6.0.3` compiler API와 TypeScript `7.0.2` native `tsc`
- Fastify, tRPC, zod
- Vue 3, Pinia, Vue Router, Vite
- PostgreSQL, Prisma, Redis
- Vitest, Playwright/Chromium
- VitePress

Node.js는 `.nvmrc`에서 24.x로 고정합니다. 의존성 설치와 검증에는
`package.json`과 `pnpm-lock.yaml`을 함께 사용해 주세요. 모든 workspace package는
내부 전용(`private`)이므로 manifest의 `0.0.0`은 배포 버전이 아닙니다. 배포 source는
full Git commit으로 고정하고, 실험 릴리스 같은 milestone은 annotated Git tag로
식별합니다. Profile frontend는 같은 commit의 정적 버전 문서를 고정 URL과 ETag로
주기적으로 재검증하고, 현재 열린 bundle과 달라졌을 때만 강제 reload 없이 공용
toast로 한 번 안내합니다.

## 개발 환경

```sh
fnm use
pnpm test:bootstrap
cp .env.example .env
CI=1 pnpm typecheck
```

현재 호스트의 `fnm use`는 `.nvmrc`의 Node 24를 적용합니다. nvm을 사용하는 다른
환경에서는 같은 위치에서 `nvm use`를 사용합니다.

`test:bootstrap`은 새 worktree에서 offline frozen install, game/Gateway Prisma
client 생성과 내부 package build를 순서대로 수행합니다. 이미 install이 끝난
worktree에서 schema 또는 내부 package가 바뀌었으면 `pnpm test:prepare`만 다시
실행합니다. Playwright를 직접 실행하기 전의 표준 절차와 오류별 복구 방법은
[테스트 정책](docs/testing-policy.md#새-worktree-준비)에 있습니다.

`.env`는 Git에서 제외됩니다. 비밀값은 명령행, 로그, screenshot, report,
`VITE_*` 변수에 넣지 말아 주세요. 상위 작업공간에서는
`../docker_compose_files/development/README.md`의 PostgreSQL·Redis stack을
worktree별로 준비할 수 있습니다.

Gateway 사용자 아이콘은 이미지 서비스의 Git checkout이 아니라 별도 bind
저장소로 직접 업로드합니다. `gateway-api`에는 이미지 서비스와 같은
`image_upload_core2026_secret`을 `/run/secrets/image_upload_core2026_secret`로
mount하고 다음 서버 전용 변수를 설정합니다.

```text
GATEWAY_IMAGE_UPLOAD_URL=https://sam-image.hided.net
GATEWAY_IMAGE_UPLOAD_SECRET_FILE=/run/secrets/image_upload_core2026_secret
GATEWAY_SHARED_ICON_PUBLIC_URL=https://sam-image.hided.net/icons
GATEWAY_USER_ICON_PUBLIC_URL=https://sam-image.hided.net/icons
GAME_IMAGE_UPLOAD_URL=https://sam-image.hided.net
GAME_IMAGE_UPLOAD_SECRET_FILE=/run/secrets/image_upload_core2026_secret
GAME_CONTENT_IMAGE_PUBLIC_URL=https://sam-image.hided.net/uploads/core2026
IMAGE_SYNC_URL=https://sam-image.hided.net
IMAGE_SYNC_SECRET_FILE=/run/secrets/image_sync_core2026_secret
VITE_IMAGE_PUBLIC_URL=https://sam-image.hided.net
VITE_GATEWAY_USER_ICON_BASE_URL=https://sam-image.hided.net/icons
```

Gateway가 인증과 50KB·크기·형식을 확인한 뒤 60초짜리 HMAC 요청으로 서버 간
PUT을 수행합니다. game-api의 국방·외교·정찰 편집기 첨부 이미지도 같은 계약을
사용하되 `/uploads/core2026/` bind 경로에 저장합니다. 공유 비밀값은 `VITE_*`,
브라우저 응답 또는 Cloudflare로 전달하지 않습니다.

두 frontend는 별도 설정이 없으면 `https://sam-image.hided.net`을 공개 이미지
origin으로 사용합니다. 게임 자산은 `/game`, 공용 장수 아이콘은 `/icons`,
Core2026 사용자 아이콘은 서버가 발급한 `users/core2026/<파일>`을 `/icons`
base 아래에 붙여 읽습니다. 로컬
이미지 fixture가 필요한 비교 환경만 `VITE_IMAGE_PUBLIC_URL=/image`와 기존
`VITE_GAME_ASSET_URL`을 명시적으로 덮어씁니다. 모든 `VITE_*` 값은 공개값이며,
업로드 HMAC secret은 반드시 위의 server-side secret 파일로만 주입합니다.

Gitea webhook을 놓친 경우에는 별도의 `image_sync_core2026_secret`을 mount한
서버 컨테이너에서 `pnpm sync:image`를 실행합니다. 특정 이미지 저장소 commit을
확인하면서 동기화하려면 `pnpm sync:image -- --commit <full-commit-sha>`를
사용합니다. 이 호출은 현재 활성 branch의 fast-forward만 요청하며 branch를
변경할 권한은 없습니다. 업로드 secret과 sync secret은 서로 바꾸어 쓰지 않습니다.

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
pnpm typecheck:e2e:frontend-legacy
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
- [릴리스 운영 매뉴얼](docs/release-operations.md)
- [Gateway와 게임 공통 메뉴 설정](docs/runtime-navigation.md)
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

Gateway와 game frontend의 production build는 공개 코드의 디버깅과 장애 분석을
위해 source map을 함께 생성합니다. 일반적인 bundle 크기 또는 build 시간 최적화는
source map 제거 사유가 아니며, 별도의 보안 요구와 검토가 있을 때만 이 계약을
변경합니다.

각 서버의 `버전 업데이트`는 profile의 game migration만 적용하고 현재
게임 DB를 seed하지 않습니다. 별도 `시나리오 초기화`는 Git 업데이트 없이
현재 게시 commit을 기본으로 사용하며, 필요할 때만 새 버전 배포와 결합합니다.
상태 설정·버전 업데이트·시나리오 초기화·게임 취소는 서버별 상단 탭으로 이동하며,
버전/초기화 화면은 URL에 고정된 profile을 다시 선택하거나 전체 profile 상태를
기다리지 않습니다.
초기화는 현재 시즌 테이블을 새 시나리오로 교체하지만 `hall`, `ng_games`, 연감, 과거 장수·국가와 상속 자료는
보존합니다. Gateway API·frontend·orchestrator는 외부 release-controller가
함께 전환합니다. 설치와 CLI self-upgrade 절차는
[`app/release-controller/README.md`](app/release-controller/README.md)를 확인해
주세요. 관리자 화면의 메뉴와 책임 분리는
[`docs/admin-console.md`](docs/admin-console.md)에 정리되어 있습니다.
