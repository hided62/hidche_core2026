# Gateway orchestrator E2E

## 검증 대상

Gateway orchestrator는 PostgreSQL의 profile·operation 상태를 기준으로
commit worktree, build와 PM2 process를 조정합니다. 검증은 다음 경계를
나눕니다.

- `app/gateway-api/test/orchestratorPlan.test.ts`: profile 상태에서 필요한
  process plan 계산
- `orchestratorOperations.test.ts`: operation claim, 상태 전이와 오류
- `adminOperations.test.ts`: 관리자 API와 operation 생성
- `profileDeployOperation.test.ts`: DB 보존 배포에서 migration은 실행하고 seed는 실행하지 않는 계약
- `gatewayReleaseRepository.integration.test.ts`: release lease, 단일 active queue와 publish fencing
- `app/release-controller/test/releaseController.test.ts`: Gateway 세 역할 전환·복구와 controller self-upgrade
- `workspaceManager.test.ts`: source commit과 worktree
- `app/gateway-frontend/e2e/server-operations.spec.ts`: 관리자 화면
- `app/gateway-frontend/e2e/hwe-lifecycle.spec.ts`: reset/build/seed/PM2와
  두 사용자 게임 진입

Unit·mock test는 실제 Git, build, PM2, PostgreSQL, Redis와 브라우저를 모두
통과한 lifecycle을 증명하지 않습니다.

## HWE lifecycle

`hwe-lifecycle.spec.ts`는 한 관리자와 독립된 두 사용자 browser context로
다음을 실행합니다.

1. 관리자가 gateway에 로그인합니다.
2. `hwe:2` profile을 선택하고 full commit SHA로 reset operation을 요청합니다.
3. operation 완료와 HWE open 상태를 기다립니다.
4. 두 사용자가 각각 로그인하고 HWE로 이동합니다.
5. 각 사용자가 장수를 생성하고 game dashboard에 진입합니다.

비밀번호는 ignored secret directory의 파일에서 읽습니다.

```text
SAMMO_LIFECYCLE_SECRET_ROOT/
├─ admin_password
├─ user_a_password
└─ user_b_password
```

Secret file은 mode `0600`을 사용하고 값은 명령행·log·screenshot에 넣지
않습니다. `SAMMO_LIFECYCLE_SOURCE_COMMIT`에는 전체 commit SHA를 전달합니다.

## Build 계약

Gateway frontend:

```sh
VITE_APP_BASE_PATH=/gateway \
VITE_GATEWAY_API_URL=/gateway/api/trpc \
VITE_GAME_API_URL_TEMPLATE='/{profile}/api/trpc' \
VITE_GAME_WEB_URL_TEMPLATE='/{profile}/' \
pnpm --filter @sammo-ts/gateway-frontend build
```

HWE frontend:

```sh
VITE_APP_BASE_PATH=/hwe \
VITE_GAME_API_URL=/hwe/api/trpc \
VITE_GAME_SSE_URL=/hwe/api/events \
pnpm --filter @sammo-ts/game-frontend build
```

Lifecycle suite는 PostgreSQL, Redis, gateway API, orchestrator, PM2와 두
frontend preview를 격리된 포트·schema·Redis prefix로 준비한 뒤 실행합니다.

```sh
SAMMO_LIFECYCLE_SECRET_ROOT=/path/to/ignored/secrets \
SAMMO_LIFECYCLE_SOURCE_COMMIT="$(git rev-parse HEAD)" \
pnpm --filter @sammo-ts/gateway-frontend test:e2e:hwe-lifecycle
```

Playwright용 prefix proxy는 `app/gateway-frontend/e2e/prefix-proxy.mjs`이며
기본 port는 `15140`입니다. 외부 Caddy를 통과하지 않으므로 suite 성공과 외부
HTTPS·host·firewall 검증을 구분합니다.

## 확인 항목

- operation의 requested/running/succeeded 또는 failed 상태
- resolved commit과 build workspace
- `sammo:<profileName>:game-api`, `sammo:<profileName>:turn-daemon` process
- `sammo:<profileName>:game-frontend`와 API·daemon·worker 전체 process
- game API와 daemon의 profile name 일치
- 관리자 capability와 일반 사용자 거부
- 두 사용자의 서로 분리된 session·장수 소유권
- 실패 시 secret이 없는 operation error와 PM2 log

Cleanup은 이 suite가 만든 process, worktree, schema와 Redis prefix만
대상으로 합니다. 공유 PM2 process, DB, Redis나 worktree를 이름 추정으로
삭제하지 않습니다.
