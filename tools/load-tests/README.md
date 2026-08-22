# 인증 HTTP/tRPC + SSE 부하 도구

이 package는 `docs/architecture/realtime-change-journal.md`의 A1/A2/A3/M1 viewer 부하를
재현하기 위한 read-only driver다. 300개 game bearer token으로 SSE를 열고, idle/own/global/mixed
phase에서 실제 game API tRPC query를 실행한다. HTTP latency p50/p95/p99, 성공/오류, SSE
open/close/reconnect/event와 public payload 금지 field 수, driver CPU/RSS/event-loop lag를 raw JSON에
남긴다. token 값, 사용자/장수/도시/국가 ID와 response/event payload는 출력하지 않는다.
dashboard query의 opaque content/source revision은 viewer별 메모리에서만 다음 `known`/`knownSource`
입력으로 이어서 unchanged/snapshot/patch와 source-revision fast-path 조건을 구분한다. raw JSON에는
종류별 count와 source revision 관측/전송/일치-unchanged aggregate만 남긴다.

## 안전 경계

- 운영/public profile에 실행하지 않는다. config의 `publicProfile`은 반드시 `false`이고 target hostname은
  `allowedHosts`에 정확히 있어야 하며 loopback, RFC 1918/ULA 또는 `.local`/`.internal`이어야 한다. 이
  guard를 우회하는 CLI flag는 없다.
- 전용 PostgreSQL schema는 `load_`로, Redis prefix는 `load-tests:`로 시작해야 한다. fixture/runtime을
  기동하는 외부 orchestration에도 같은 값을 주어 공유 개발·운영 profile과 분리한다.
- fixture CLI는 config와 DB URL의 schema가 정확히 같고, Redis DB가 config의 전용 `1..15` DB와 정확히
  같을 때만 동작한다. 둘 다 loopback/private host만 허용한다. cleanup은 전용 Redis manifest와 schema명을
  다시 확인한 뒤 그 `load_` schema와 해당 profile의 access token만 지운다. Redis `FLUSHDB`와 공유 schema
  삭제는 하지 않는다.
- driver는 query만 허용한다. own/global phase 이름은 invalidation 뒤 viewer read fan-out을 뜻하며 mutation을
  만들지 않는다. 실제 own/global change stimulus는 격리 runtime에서 별도 orchestration으로 발생시킨다.
- token 파일은 이 workspace 안의 Git ignored path여야 하고 정확히 `0600`이어야 한다. 권장 위치는
  `tools/load-tests/secrets/game-tokens.json`이며 JSON 형식은 `{"tokens":["...", "..."]}` 하나뿐이다.
- raw result는 새 파일로만 쓰고(`wx`) `0600`을 적용한다. 기본 ignored 위치는
  `tools/load-tests/results/`다.

## 재현 명령

### 1. 격리 PostgreSQL/Redis와 1,200장수 fixture

아래 Compose는 loopback에만 포트를 열고 PostgreSQL 18.4, Redis 8.2.7을 고정한다. PostgreSQL 18의
versioned data-directory 계약에 맞춰 volume은 `/var/lib/postgresql`에 붙인다. host port는 기본
`15442/16379`이며 `CAPACITY_POSTGRES_PORT`/`CAPACITY_REDIS_PORT`로 충돌 없이 바꿀 수 있다. `prepare`는
PostgreSQL password, API token/image secret과 정확한 URL을 무작위 생성해 Git ignored `secrets/`의 새
파일 세 개에 `0600`으로 저장한다. 기존 파일을 덮어쓰거나 비밀값을 stdout에 쓰지 않는다.
기존 fixture volume을 보존하면서 별도 실행이 필요하면
`CAPACITY_COMPOSE_PROJECT_NAME`과 `CAPACITY_POSTGRES_VOLUME_NAME`을 함께 고유하게 지정한다.

```sh
pnpm --filter @sammo-ts/load-tests prepare:capacity \
  --config tools/load-tests/config/300-users-900-npcs-5m.json

set -a
source tools/load-tests/secrets/capacity.env
set +a

docker compose -f tools/load-tests/compose.capacity.yml config --quiet
docker compose -f tools/load-tests/compose.capacity.yml up -d --wait

pnpm --filter @sammo-ts/load-tests seed \
  --config tools/load-tests/config/300-users-900-npcs-5m.json \
  --tokens tools/load-tests/secrets/game-tokens.json
pnpm --filter @sammo-ts/load-tests verify-fixture \
  --config tools/load-tests/config/300-users-900-npcs-5m.json

pnpm --filter @sammo-ts/load-tests activate-coverage \
  --config tools/load-tests/config/300-users-900-npcs-5m.json \
  --confirm load_capacity_300_900_5m
```

`seed`는 해당 `load_` schema에 migration을 적용하고 scenario 2601을 고정 seed/time으로 설치한 뒤 정확히
900 NPC + 300 synthetic 사용자 장수로 재구성한다. synthetic 사용자는 같은 fixture 국가와 도시에 배치하고
관직 5 이상을 순환 배정하여 암행부·사령부·감찰부·내무부를 실제 권한으로 읽을 수 있게 한다. 시나리오에
비중립 국가가 없으면 전용 fixture 안에만 측정 국가 하나를 만든다. 각 사용자의 24시간 access token은 Redis 전용 DB와
새 `0600` JSON에만 저장한다. stdout에는 token, user/general ID, DB/Redis URL을 내보내지 않고 count와
비밀값을 제외한 fixture SHA-256만 기록한다. token 파일이 이미 있으면 DB 작업 전에 실패한다.

fixture와 같은 환경으로 API를 띄울 때 핵심 namespace는 다음과 같다. `capacity.env` 값을 다시 명령행에
풀어 쓰지 않는다.

`activate-coverage`는 Redis의 전용 fixture manifest와 schema 확인 문자열을 모두 요구한 뒤, infra의
advisory-lock/CAS transaction을 그대로 호출해 coverage 1과 초기 shared revision head를 활성화한다.
공유 schema나 manifest가 없는 runtime에는 실행되지 않는다. activation 전후의 coverage/head/outbox는
`verify-fixture`의 비밀값 없는 aggregate로 확인할 수 있다.

```sh
pnpm --filter @sammo-ts/common build
pnpm --filter @sammo-ts/logic build
pnpm --filter @sammo-ts/infra build
pnpm --filter @sammo-ts/game-engine build
pnpm --filter @sammo-ts/game-api build

systemd-run --user --unit=sammo-capacity-api --collect \
  --property=MemoryMax=8G \
  --setenv=POSTGRES_POOL_MAX=4 \
  --working-directory="$(pwd)" \
  "$(pwd)/tools/load-tests/scripts/run-capacity-api.sh"
```

runner script는 `capacity.env`의 Node binary를 사용하고 `taskset 0-3`으로 API를 4 logical CPU에 제한한다.
systemd unit은 API에 8 GiB memory limit을 적용한다. `systemctl --user show`로 얻은 main PID의 affinity와
unit `MemoryMax`를 각각 `taskset -pc`와 `systemctl --user show`로 확인한다. API와 driver는 별도 process로 실행한다.
공개 `dev-sam2026.hided.net` profile에는 이 fixture나 driver를 연결하지 않는다.

### 2. 인증 HTTP/SSE driver

먼저 sample의 `runtimeMetadata` placeholder를 실제 fixture SHA-256, image digest, PostgreSQL/Redis
version으로 바꾼 ignored 복사본을 만든다. secret이나 ID를 config에 넣지 않는다.

```sh
pnpm --filter @sammo-ts/load-tests validate --config tools/load-tests/config/300-users-900-npcs-5m.json
pnpm --filter @sammo-ts/load-tests dry-run \
  --config tools/load-tests/config/300-users-900-npcs-5m.json \
  --tokens tools/load-tests/secrets/game-tokens.json
pnpm --filter @sammo-ts/load-tests run run \
  --config tools/load-tests/config/300-users-900-npcs-5m.json \
  --tokens tools/load-tests/secrets/game-tokens.json \
  --output tools/load-tests/results/300-users-900-npcs-5m.json
```

`validate`는 config만 검사한다. `dry-run`은 config, host allowlist, token count/permission/Git-ignore와 phase
계획을 검사하지만 network connection을 열지 않는다. driver process는 가능하면 target runtime과 다른
host/cgroup에서 실행하고 두 host의 CPU quota와 competing load를 별도로 기록한다.
`run`은 sample의 runtime metadata placeholder가 하나라도 남아 있으면 시작하지 않는다.

300 SSE/HTTP의 짧은 연결·query calibration은 검증된 fixture에서 ignored runtime config를 먼저 만든다.
기본 calibration은 idle 5초와 own/global/mixed 각 10초이며 capacity 합격 판정용 soak test가 아니다.

```sh
pnpm --filter @sammo-ts/load-tests materialize-calibration \
  --config tools/load-tests/config/300-users-900-npcs-5m.json \
  --output tools/load-tests/results/calibration-config.json

pnpm --filter @sammo-ts/load-tests run run \
  --config tools/load-tests/results/calibration-config.json \
  --tokens tools/load-tests/secrets/game-tokens.json \
  --output tools/load-tests/results/calibration-result.json
```

`materialize-calibration`은 DB/Redis count와 manifest/hash를 다시 확인하고 실제 PostgreSQL/Redis version을
기록한다. `LOAD_TEST_IMAGE_DIGEST`가 없으면 image 결과라고 부르지 않고 현재 dirty source-tree commit을
명시한다. driver JSON의 process CPU/RSS는 driver 자체 값이다. API target 값은 systemd unit의
`CPUUsageNSec`, `MemoryCurrent`, `MemoryPeak`를 run 직전/직후 별도로 수집한다.

## 결과와 해석

raw JSON은 Git commit/tree/dirty 상태, config/runtime/host hash, Node/V8, host CPU/memory와 cgroup limit,
fixture/image/PostgreSQL/Redis metadata, phase별 metric을 포함한다. 이 정보는 재현 조건이지 합격 판정 자체가
아니다. `runtimeMetadata` placeholder가 남은 run과 외부 stimulus가 없던 own/global phase를 capacity pass로
보고하지 않는다.

### 3. E1 결정론적 engine capacity profile

E1은 DB/Redis 없이 scenario 2601을 정확히 900 NPC + 300 synthetic 사용자 장수로 확장해 5분 턴 한 달을
실행한다. report에는 정확한 초기 count, 전체 장수턴 처리량, 장수턴 및 월 wall-time p50/p95/p99/max,
RSS/heap과 최종 상태 SHA-256이 들어간다. 같은 commit/Node/fixture에서 상태 hash가 같아야 한다.

```sh
NPC_UNIFICATION_BENCHMARK_FIXED_MONTHS=1 \
NPC_UNIFICATION_BENCHMARK_REPORT_PATH=/dev/shm/npc-capacity-1200.json \
pnpm --filter @sammo-ts/game-engine profile:npc-capacity-1200
```

이 프로필은 자연 통일 소요시간 시험이 아니라 고정 1개월 engine 처리량 시험이다. 기존
`profile:npc-unification-timing`의 무보정 자연 진행 의미는 바꾸지 않는다.

### 4. E2 PostgreSQL flush와 profile 간 경합

`measure-turn-flush`는 검증된 fixture를 production loader로 읽고 daemon lease/fencing, 장수 턴,
dirty-state transaction, journal/outbox와 commit 이후 Redis 발행을 거쳐 정확히 한 월 경계를 실행한다.
정상 realtime daemon처럼 장수는 한 transaction에 하나씩 commit한다. 권위 순서는 `turn_tick`이며,
JavaScript `Date`의 밀리초보다 세밀한 tick을 포함하도록 cutoff를 보정한다.

```sh
pnpm --filter @sammo-ts/load-tests measure-turn-flush \
  --config tools/load-tests/config/300-users-900-npcs-5m.json \
  --confirm load_capacity_300_900_5m \
  --output tools/load-tests/results/turn-flush.json
```

결과에는 장수 transaction과 월 transaction/Redis 발행 latency, 처리량, 시작·종료 장수 수,
process CPU/RSS/event-loop lag, database-wide `pg_stat_database` delta와 connection/active/lock-wait 최대값이
들어간다. PostgreSQL delta에는 별도 observer sampler의 read transaction도 포함되므로 transaction 수를
daemon commit 수와 동일하다고 해석하지 않는다.

`nya`와 `pya` 동시 1분 경합용 config는 각각 Redis DB 14/13과 별도 `load_` schema를 사용한다.
같은 PostgreSQL/CPU에서 두 fixture를 seed한 뒤 두 `measure-turn-flush` process를 동시에 시작하여
schema 간 row-lock 격리와 공유 CPU/I/O/connection 경합을 확인한다. 이 실행은 실제 운영 profile이나
공개 URL을 대상으로 하지 않는다.

- `tools/load-tests/config/nya-10-users-800-npcs-1m.json`
- `tools/load-tests/config/pya-10-users-800-npcs-1m.json`

### 5. 1분 턴과 10-user 실제 화면 동시 측정

`measure-turn-cycle`은 fixture의 권위 `turn_time` 분포대로 장수 턴을 wall clock 1분에 pacing하고 월 경계를
한 번 처리한다. `measure-page-navigation`은 실제 Chromium context 10개가 암행부, 사령부, 현재 도시,
감찰부, 내무부를 순환하며 페이지와 tRPC 지연을 기록한다. 화면 이동 중에도 사용자마다 별도 SSE 한 개를
계속 유지한다. 이는 제품 UI가 메인 화면 밖에서 dashboard SSE를 닫는 동작과 “각 사용자가 실시간 알림을
계속 받는다”는 부하 조건을 분리해 재현하기 위한 구성이다.

두 명령에 같은 미래 `LOAD_TEST_START_AT_EPOCH_MS`를 주면 턴과 브라우저 측정 구간을 맞출 수 있다.
`LOAD_TEST_FRONTEND_URL`은 private/loopback URL과 정확한 profile suffix여야 하며,
`LOAD_TEST_API_PID`는 같은 workspace에서 실행 중인 game-api PID여야 한다. 결과에는 token, 응답 본문과
사용자 식별자를 넣지 않는다.

```sh
export LOAD_TEST_START_AT_EPOCH_MS=REPLACE_WITH_NEAR_FUTURE_EPOCH_MS
export LOAD_TEST_FRONTEND_URL=http://127.0.0.1:15000/pya/
export LOAD_TEST_API_PID=REPLACE_WITH_LOCAL_GAME_API_PID

pnpm --filter @sammo-ts/load-tests measure-page-navigation \
  --config tools/load-tests/config/pya-10-users-800-npcs-1m.json \
  --tokens tools/load-tests/secrets/game-tokens.json \
  --output tools/load-tests/results/page-navigation.json

pnpm --filter @sammo-ts/load-tests measure-turn-cycle \
  --config tools/load-tests/config/pya-10-users-800-npcs-1m.json \
  --confirm load_capacity_pya_10_800_1m \
  --output tools/load-tests/results/turn-cycle.json
```

페이지 latency는 production frontend의 lazy chunk, 인증 초기화와 Playwright `networkidle` 500ms를 모두
포함하므로 API procedure latency와 함께 해석한다. API CPU/RSS는 지정 PID만, PostgreSQL 지표는 같은 DB의
observer를 포함한 database-wide delta만 나타낸다. 호스트의 다른 profile, Gateway와 worker 부하는 포함하지 않는다.

### 6. 명시적 cleanup

token 파일은 별도로 안전하게 삭제하고, fixture schema/Redis token은 schema명을 그대로 확인 인자로 주어
정리한다. named volume은 보존한다. 데이터 폐기가 필요하지 않으면 이 명령을 실행하지 않는다.

```sh
pnpm --filter @sammo-ts/load-tests cleanup \
  --config tools/load-tests/config/300-users-900-npcs-5m.json \
  --confirm load_capacity_300_900_5m
docker compose -f tools/load-tests/compose.capacity.yml down
```

## 아직 남은 측정 경계

- `measure-turn-flush`는 한 달을 wall-clock보다 빠르게 replay하는 처리량 시험이다. 실제 1분 schedule lag는
  `measure-turn-cycle`로 확인할 수 있지만 장시간 pool wait와 autovacuum/checkpoint는 더 긴 soak가 필요하다.
- 월 경계 latency는 실행당 표본이 하나다. scenario 진행 시점과 월별 event 차이를 포괄하지 않는다.
- 두 1분 profile 동시 실행은 최악 turn-rate 조합의 국소 증거이며, 여섯 profile의 전체 PM2 RSS,
  Gateway·worker connection과 운영 container cgroup을 재현하지 않는다.
- own/global phase의 mutation stimulus는 driver가 만들지 않는다. 격리 runtime의 실제 engine/API mutation과
  함께 실행하지 않았다면 A2/A3/M1 전체 합격으로 보고하지 않는다.
- 이 repository에서 실행한 로컬 E1 수치는 source-tree 회귀 근거다. dev-sam2026 동급 4 CPU/8 GiB container
  결과로 부르려면 동일 image/fixture와 cgroup에서 다시 측정해야 한다.

## 도구 자체 검증

```sh
pnpm --filter @sammo-ts/load-tests test
pnpm --filter @sammo-ts/load-tests typecheck
```
