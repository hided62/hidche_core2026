# Gateway release controller

`release-controller`는 Gateway API·frontend·orchestrator와 분리된 PM2
프로세스입니다. 관리자 GUI가 `GatewayReleaseOperation`을 만들면 controller가
선택 commit을 고정하고 다음 순서로 전환합니다.

1. commit 전용 worktree를 준비하고 frozen lockfile로 의존성을 설치합니다.
2. `release-manifest.json`의 protocol, component와 실제 migration head를
   확인합니다.
3. Gateway API와 frontend를 빌드하고 gateway migration을 적용합니다.
4. 기존 `sammo:gateway-api`, `sammo:gateway-frontend`,
   `sammo:gateway-orchestrator`를 중지하고 새 worktree에서 시작합니다.
5. 두 HTTP endpoint와 세 PM2 process가 모두 준비된 경우에만 현재·이전
   릴리스 상태를 게시합니다. 실패하면 이전 세 프로세스를 복구합니다.

Controller는 PM2 자식으로 실행되지만 자신의 `args=daemon`과 PM2 identity를
Gateway process 환경에 전달하지 않습니다. 이 값이 frontend 정의를 덮으면 Vite가
의도한 preview port 대신 기본 개발 port로 실행될 수 있으므로, process `online`
여부뿐 아니라 Gateway API와 frontend HTTP readiness를 모두 확인합니다.

## 환경 변수

- `GATEWAY_DATABASE_URL`: Gateway PostgreSQL URL입니다. 필수입니다.
- `REDIS_URL`: Gateway API와 orchestrator가 사용할 Redis URL입니다. 필수입니다.
- `GATEWAY_DB_SCHEMA`: Gateway schema이며 기본값은 `public`입니다.
- `RELEASE_CONTROLLER_WORKSPACE_ROOT`: Git checkout입니다.
- `RELEASE_CONTROLLER_WORKTREE_ROOT`: commit worktree 상위 경로입니다.
- `GATEWAY_API_PORT`, `GATEWAY_FRONTEND_PORT`, `GATEWAY_BASE_PATH`: readiness와
  frontend build 계약입니다.
- `RELEASE_CONTROLLER_POLL_MS`, `RELEASE_CONTROLLER_READINESS_TIMEOUT_MS`: queue
  poll과 준비 제한 시간입니다.

비밀값은 Git에서 제외된 환경 파일 또는 process 환경으로 전달해 주세요.
`VITE_*`에는 공개 URL만 넣어 주세요.

Self-upgrade는 controller의 script와 cwd만 선택 commit worktree로 바꿉니다.
`RELEASE_CONTROLLER_WORKSPACE_ROOT`는 원래 Git checkout을 유지해야 합니다. 이를
controller artifact worktree로 바꾸면 아직 게시된 release state가 없는 최초
DEPLOY의 rollback이 frontend build가 없는 controller worktree를 이전 Gateway로
오인할 수 있습니다.

## 설치와 실행

먼저 controller가 읽을 Gateway schema를 migration하고 의존 package를 함께
빌드합니다.

```sh
pnpm install --frozen-lockfile
pnpm --filter @sammo-ts/infra prisma:generate
pnpm --filter @sammo-ts/common build
pnpm --filter @sammo-ts/infra build
pnpm --filter @sammo-ts/logic build
pnpm --filter @sammo-ts/game-engine build
pnpm --filter @sammo-ts/gateway-api build
pnpm --filter @sammo-ts/release-controller build
pnpm --filter @sammo-ts/infra prisma:migrate:deploy:gateway
pnpm --filter @sammo-ts/release-controller start
```

운영에서는 마지막 명령 대신 `sammo:release-controller`라는 PM2 process로
`app/release-controller/dist/index.js daemon`을 실행해 주세요. 상태와 queue
한 건 처리는 다음 CLI로 확인할 수 있습니다.

```sh
pnpm --filter @sammo-ts/release-controller status
pnpm --filter @sammo-ts/release-controller run-once
```

## Controller self-upgrade

이 명령은 현재 daemon과 별개의 CLI process에서 실행됩니다. 대상 worktree를
빌드하고 gateway migration을 적용한 뒤 `sammo:release-controller`만 새
worktree로 전환합니다. 새 daemon 시작에 실패하면 이전 definition을
복구합니다.

```sh
pnpm --filter @sammo-ts/release-controller build
pnpm --filter @sammo-ts/release-controller self-upgrade BRANCH main
# 또는
pnpm --filter @sammo-ts/release-controller self-upgrade COMMIT <full-sha>
```

Database migration은 일반적으로 되돌리지 않습니다. 이전 애플리케이션으로
rollback하려면 새 schema와의 하위 호환성을 릴리스 전에 확인해 주세요.

`release-manifest.json`의 `controllerProtocol`이 올라간 릴리스는 controller를
먼저 self-upgrade해야 합니다. Protocol 2는 `GatewayReleaseLog` 진행 로그 저장을
요구합니다. 구형 controller로 새 Gateway만 배포하면 관리자 화면과 controller의
기능이 어긋날 수 있으므로, manifest protocol 검사를 우회하지 마세요.
