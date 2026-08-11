# 릴리스 운영 매뉴얼

이 문서는 Core2026의 profile 서버와 Gateway를 Git commit 단위로 배포하고
되돌리는 현재 운영 경계를 설명합니다. Profile은 Gateway orchestrator가,
Gateway 전체는 별도 release-controller가 처리합니다.

## 구성과 권한

| 대상                              | 요청 경로           | 실행자                  | 영속 상태                                        |
| --------------------------------- | ------------------- | ----------------------- | ------------------------------------------------ |
| `che`, `hwe` 등 profile           | Gateway 관리자 화면 | Gateway orchestrator    | `GatewayOperation`, `GatewayProfile`             |
| Gateway API·frontend·orchestrator | Gateway 관리자 화면 | 외부 release-controller | `GatewayReleaseOperation`, `GatewayReleaseState` |
| release-controller 자체           | 별도 CLI process    | self-upgrade CLI        | PM2 `sammo:release-controller`                   |

Profile 화면은 `/gateway/admin/servers/:profileName/version`과
`/gateway/admin/servers/:profileName/scenario`, Gateway 화면은
`/gateway/admin/releases`입니다. 이전 `/gateway/admin/server-operations`는
호환성을 위해 서버 목록으로 이동합니다. Profile 작업은 runtime/settings/deploy/reset
capability로 분리되며 기존 `admin.profiles.manage`는 포괄 호환 권한입니다. Gateway 전체 릴리스에는
profile 범위 권한과 별개인 전역 `admin.releases.manage` 권한이 필요합니다.
일반 사용자와 권한이 없는 관리자는 Gateway 릴리스 영역을 사용할 수 없습니다.

운영 전에 다음을 확인해 주세요.

- 대상 branch 또는 전체 commit SHA가 Core2026 저장소에 존재합니다.
- 대상 commit의 `release-manifest.json`에 필요한 component와 현재 migration
  head가 들어 있습니다.
- Gateway PostgreSQL, profile PostgreSQL, Redis와 PM2가 준비되어 있습니다.
- controller가 `GATEWAY_DATABASE_URL`, `GATEWAY_DB_SCHEMA`, workspace와
  worktree 경로를 올바르게 읽습니다.
- 공개 hostname을 쉼표로 구분한 `VITE_PREVIEW_ALLOWED_HOSTS`가 Gateway와
  profile frontend build 환경에 전달됩니다. 신뢰된 reverse proxy 뒤가 아니라면
  `*`를 사용하지 않습니다.
- PM2 definition은 Gateway에 `GATEWAY_ROLE=api|orchestrator`, game API에
  `GAME_API_ROLE=server|*-worker`, turn daemon에
  `GAME_ENGINE_ROLE=turn-daemon`을 명시합니다. library import나 PM2 wrapper의
  argv만으로 실행 역할을 추론하지 않습니다.
- PM2 child에서 상속된 `pm_id`, `name`, `pm_exec_path`, `NODE_APP_INSTANCE`와
  `axm_*` 메타데이터는 새 definition에 전달하지 않습니다. 동일 process 이름은
  시작 전에 제거하며 PM2 start는 남은 동일 이름을 거부합니다.
- Runtime process는 10초 이전의 불안정 종료에 대해 최대 5회, 2초 간격으로만
  자동 재시작합니다. Readiness는 예상 process 수가 정확하고 모든 restart count가
  0일 때만 성공합니다.
- Root와 server package의 `tsdown`은 0.22.14 계열로 통일합니다. Docker runtime의
  Node heap/Rayon 상한을 상속한 동일 toolchain으로 초기 Gateway와 profile
  worktree를 빌드하여 구형 Rolldown의 과도한 native thread 생성을 피합니다.
- Profile, Gateway와 controller self-upgrade의 server package build는 Turbo DAG를
  사용합니다. 실행 중인 game/Gateway process와 4 GiB runtime을 공유하는 기본
  동시성은 1이며, 더 큰 격리 build host에서는 `RELEASE_TURBO_CONCURRENCY`를 측정 후
  2 이상으로 올릴 수 있습니다. 기본 local cache는 원래 Core checkout의
  `.turbo/release-cache`이므로 commit별 worktree가 달라도 재사용됩니다. 별도
  persistent 경로가 필요하면 controller/orchestrator 환경에 `TURBO_CACHE_DIR`을
  설정합니다. Cache는 재생성 가능한 build artifact이며 DB/Redis backup이 아닙니다.
- `NODE_ENV`와 Vite가 추론한 `VITE_*`는 build hash에 포함됩니다. 따라서 base path나
  API URL이 다른 frontend artifact를 cache hit로 잘못 복원하지 않습니다.
  `NODE_OPTIONS`와 `RAYON_NUM_THREADS`는 출력에는 영향을 주지 않는 resource 제한으로
  build child에 전달됩니다.
- migration 이후 이전 애플리케이션으로 돌아갈 때 schema 하위 호환성이
  유지됩니다.

## Profile 배포

버전 업데이트 화면에서 profile의 branch 또는 commit을 선택합니다. Branch는 worker가
작업을 claim할 때 commit으로 해석하며, commit 입력은 전체 SHA로 고정됩니다.
같은 profile에는 `QUEUED` 또는 `RUNNING` 작업을 동시에 하나만 둘 수 있습니다.

### DB 유지 배포

`DB 유지 배포`는 현재 시즌을 계속 운영하면서 코드를 교체할 때 사용합니다.

1. 대상 commit의 game frontend, API, engine과 worker artifact를 빌드합니다.
2. 기존 profile PM2 process를 정지합니다.
3. profile game schema에 `prisma migrate deploy`를 실행합니다.
4. Scenario seed를 실행하지 않고 frontend, API, daemon과 worker를 시작합니다.
5. HTTP와 모든 PM2 role의 readiness가 확인된 뒤 build commit을 게시합니다.

이 모드는 현재 scenario, status와 인게임 DB를 유지합니다. Migration이
데이터를 변환할 수 있으므로 대상 migration의 운영 데이터 영향은 배포 전에
별도로 검토해 주세요.

### 시나리오 초기화

시나리오 초기화는 새 시즌이나 새 scenario로 현 시즌 데이터를 교체할 때
사용합니다. 기본 `현재 배포 버전`은 profile의 게시된 full commit을 서버에서
결정하므로 Git 입력과 `admin.profiles.deploy` 권한이 필요하지 않습니다. 새 branch
또는 commit을 함께 배포하는 모드는 `admin.scenarios.reset`과
`admin.profiles.deploy`를 모두 요구합니다. Source와 scenario를 확인한 뒤 turn 간격, 가오픈·정식 오픈,
NPC와 자동 진행 설정을 확인하고 요청해 주세요.

턴 간격과 고급 옵션은 서버 상태 화면에서 저장한
`GatewayProfile.meta.resetDefaults`를 최초값으로 사용합니다. 서버별 기본값을
바꾸려면 `admin.profiles.settings:<name>` 권한으로 메타를 저장하고 시나리오
초기화 화면을 다시 여세요. 값이 없거나 유효하지 않으면 60분, 동기화·가상
장수·연장·토너먼트 사용, 기본 NPC, 이미지 단계 3, 전체 가입과 유저 자동턴
미사용이라는 기존 시스템 기본값으로 돌아갑니다. 실행마다 달라지는 scenario와
예약·가오픈·정식 오픈 시각은 자동 입력하지 않습니다.

이 모드는 build와 migration 후 기존 season/tick metadata를 읽고 scenario seeder를 실행합니다.
빈 profile schema도 migration을 먼저 적용하므로 최초 `world_state` 조회가
table 부재로 실패하지 않습니다. 현 시즌의 장수,
국가, 도시, command queue와 시장·경매 등은 새 scenario 기준으로 교체됩니다.
다음 장기보존 자료는 reset 범위 밖에 있으므로 기수를 넘어 유지됩니다.

- `hall`, `ng_games` 명예의 전당과 게임 이력
- 연감과 과거 장수·국가 기록
- 왕조·상속 자료
- legacy storage와 진단·오류 기록

초기화 작업은 되돌릴 수 있는 앱 rollback과 다릅니다. 운영 DB backup과 새
scenario 설정을 확인한 뒤 실행해 주세요.

### Profile 실패와 재시도

Build는 현재 runtime을 멈추기 전에 수행합니다. Migration 또는 새 process
readiness가 실패하면 작업은 `FAILED`가 됩니다. DB 유지 배포는 이전 worktree의
process 복구를 시도합니다. 관리자 화면의 오류와 PM2 process 상태를 확인한
뒤 원인을 해결하고 실패한 작업을 재시도해 주세요. 재시도는 처음 고정된 commit을
사용합니다.

## Gateway 전체 배포

Gateway는 자기 process를 직접 교체하지 않습니다. 관리자 화면에서 `Gateway
배포`를 요청하면 외부 `sammo:release-controller`가 다음 순서로 처리합니다.

1. Source ref를 commit SHA로 고정하고 commit worktree를 준비합니다.
2. Release manifest의 protocol, component와 migration head를 검증합니다.
3. Gateway API와 frontend를 공유 Turbo cache로 빌드하고 gateway migration을 적용합니다.
4. `sammo:gateway-api`, `sammo:gateway-frontend`,
   `sammo:gateway-orchestrator`를 새 worktree definition으로 전환합니다.
5. Gateway API `/healthz`, `/gateway/`와 세 PM2 process의 `online` 상태를
   확인합니다.
6. 모두 준비된 경우에만 현재·이전 commit과 workspace를 게시합니다.

release-controller는 PM2 process 안에서 실행되므로 부모의 `args`, `pm_id`,
`pm_exec_path`, `name`, `NODE_APP_INSTANCE`와 `axm_*` 같은 PM2 내부 값을 자식
환경으로 전달하지 않습니다. 특히 부모의 `args=daemon`이 frontend의
`vite preview --host 0.0.0.0 --port 15000` 인자를 덮으면 PM2 상태만 `online`이고
Caddy upstream port는 열리지 않을 수 있습니다. 배포 readiness는 process 상태와
두 HTTP endpoint를 함께 확인해야 합니다.

Gateway process definition에는 `GATEWAY_DATABASE_URL`과 `REDIS_URL`이 모두
필요합니다. controller는 `REDIS_URL`이 없는 환경에서는 시작 단계에서 실패하여
불완전한 Gateway process 전환을 막습니다.

Gateway 전체에는 활성 릴리스 작업을 동시에 하나만 둘 수 있습니다. 화면의
릴리스 이력에서 요청 source, 고정 commit, 상태와 오류를 확인할 수 있습니다.
작업을 선택하면 관리자 화면이 `admin.releases.logs`를 최대 20초씩 long polling하여
commit 해석, worktree 준비, build 명령 출력, migration, process 전환,
readiness와 rollback 진행을 커서 순서대로 이어 붙입니다. 완료된 작업의 로그도
같은 이력에서 다시 열 수 있으며 화면은 최근 1,000줄을 유지합니다.
Build 로그의 `cache hit`/`cache miss`와 마지막 `Cached: N cached, M total`은 실제
이번 릴리스의 cache 사용 여부를 나타냅니다.

로그 원본은 Gateway DB의 `GatewayReleaseLog`에 작업별로 저장되고 작업 삭제 시
함께 제거됩니다. Controller는 ANSI 제어 문자를 제거하고 secret·token·password
계열 환경 변수 값과 URL password를 저장 전에 가립니다. 최초로 이 migration을
적용하는 배포에서는 log table이 생기기 전의 build 구간을 기록할 수 없지만,
migration 이후 단계와 다음 릴리스부터는 전체 진행 로그를 기록합니다. 로그가
관리자 전용이라고 해도 credential이나 실제 환경 파일 내용을 명령 출력에
의도적으로 남기지 마세요.

### Gateway rollback

`이전 Gateway로 rollback`은 `GatewayReleaseState`에 기록된 바로 이전 commit을
다시 배포합니다. 새 Gateway의 readiness가 실패하면 controller는 이전 세
process definition을 복구합니다.

Prisma migration은 역방향으로 적용하지 않습니다. 따라서 rollback 대상 앱이
이미 적용된 새 gateway schema를 읽을 수 있어야 합니다. Schema 호환성이
확인되지 않은 릴리스는 GUI rollback에 의존하지 말고 backup·restore를 포함한
별도 복구 절차를 준비해 주세요.

## Release-controller CLI

CLI는 repository 루트에서 Git에 포함되지 않은 안전한 환경 변수 또는 secret
주입 상태로 실행합니다. 실제 database URL이나 credential을 명령행, 로그 또는
문서에 남기지 말아 주세요.

현재 릴리스 상태와 최근 작업을 확인합니다.

```sh
pnpm --filter @sammo-ts/release-controller status
```

대기 중인 Gateway 작업을 한 건만 처리하고 종료합니다.

```sh
pnpm --filter @sammo-ts/release-controller run-once
```

운영 daemon은 `app/release-controller/dist/index.js daemon`을
`sammo:release-controller` PM2 process로 실행합니다. 상세한 최초 설치와 환경
변수는 저장소의 `app/release-controller/README.md`를 확인해 주세요.

### Controller self-upgrade

Self-upgrade는 실행 중인 controller daemon과 다른 shell/CLI process에서
실행해 주세요. 대상 worktree를 준비하고 build와 gateway migration을 마친 뒤
controller PM2 definition만 전환합니다. CLI 환경에는 `GATEWAY_DATABASE_URL`과
`REDIS_URL`을 모두 주입해야 합니다. 새 controller의 cwd는 선택 commit
worktree이지만 `RELEASE_CONTROLLER_WORKSPACE_ROOT`는 원래 Core checkout을
유지하며, release state가 없는 최초 DEPLOY의 rollback 기준으로 사용합니다.

```sh
pnpm --filter @sammo-ts/release-controller build
pnpm --filter @sammo-ts/release-controller self-upgrade BRANCH main
# 또는
pnpm --filter @sammo-ts/release-controller self-upgrade COMMIT <full-sha>
```

새 controller가 제한 시간 안에 `online`이 되지 않으면 이전 definition을
복구합니다. Self-upgrade 중에도 migration downgrade는 수행하지 않습니다.

`release-manifest.json`의 `controllerProtocol`이 현재 controller가 지원하는
값보다 높으면 일반 Gateway 배포는 시작 전에 실패합니다. Protocol 2부터
release-controller가 `GatewayReleaseLog` 진행 로그를 저장하는 것이 계약입니다.
로그 기능이 포함된 Gateway API/frontend만 먼저 배포하면 화면은 polling하지만
구형 controller는 로그를 만들 수 있으므로, protocol 변경 commit은 위
`self-upgrade`로 controller를 먼저 전환한 뒤 Gateway 배포를 요청해야 합니다.
명시적인 self-upgrade 경로만 다음 controller protocol의 manifest를 읽을 수 있고,
schema head·component 검사는 그대로 수행합니다.

## 운영 확인 목록

배포 전:

- Source commit과 `release-manifest.json`을 확인합니다.
- DB backup, migration 영향과 rollback schema 호환성을 확인합니다.
- 대상 profile과 Gateway의 현재 commit·workspace를 기록합니다.
- controller, PostgreSQL, Redis와 PM2 상태를 확인합니다.

배포 후:

- 작업이 `SUCCEEDED`이고 고정 commit이 요청한 commit과 같은지 확인합니다.
- PM2 process 이름별 항목이 정확히 하나이고 restart count가 0이며, cwd와
  script가 게시된 worktree를 가리키는지 확인합니다.
- Gateway frontend의 실제 인자가 `preview --host 0.0.0.0 --port 15000`을
  유지하고 container 내부 `127.0.0.1:15000/gateway/`와 Caddy에서
  `runtime:15000/gateway/`가 모두 응답하는지 확인합니다.
- `/gateway/` 또는 대상 profile prefix에 직접 접속하고 새로고침합니다.
- API health, tRPC, SSE와 정적 자산 경로를 확인합니다.
- DB 유지 배포에서는 현재 season/scenario와 핵심 게임 상태가 유지됐는지
  확인합니다.
- 시나리오 초기화에서는 새 시즌 상태와 명예의 전당·연감 등 장기보존 자료를
  함께 확인합니다.

Local unit, 격리 DB integration과 fixture Chromium 통과는 운영 PM2, 외부
Caddy/HTTPS, 방화벽과 실제 운영 DB 전환을 증명하지 않습니다. 운영 배포에서는
위 확인 목록을 실제 서비스 경로에서 다시 수행해 주세요.
