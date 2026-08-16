# 인증 HTTP/tRPC + SSE 부하 도구

이 package는 `docs/architecture/realtime-change-journal.md`의 A1/A2/A3/M1 viewer 부하를
재현하기 위한 read-only driver다. 300개 game bearer token으로 SSE를 열고, idle/own/global/mixed
phase에서 실제 game API tRPC query를 실행한다. HTTP latency p50/p95/p99, 성공/오류, SSE
open/close/reconnect/event와 public payload 금지 field 수, driver CPU/RSS/event-loop lag를 raw JSON에
남긴다. token 값, 사용자/장수/도시/국가 ID와 response/event payload는 출력하지 않는다.
dashboard query의 opaque revision은 viewer별 메모리에서만 다음 `known` 입력으로 이어서
unchanged/snapshot/patch 경로를 구분하며 raw JSON에는 종류별 count만 남긴다.

## 안전 경계

- 운영/public profile에 실행하지 않는다. config의 `publicProfile`은 반드시 `false`이고 target hostname은
  `allowedHosts`에 정확히 있어야 하며 loopback, RFC 1918/ULA 또는 `.local`/`.internal`이어야 한다. 이
  guard를 우회하는 CLI flag는 없다.
- 전용 PostgreSQL schema는 `load_`로, Redis prefix는 `load-tests:`로 시작해야 한다. fixture/runtime을
  기동하는 외부 orchestration에도 같은 값을 주어 공유 개발·운영 profile과 분리한다.
- driver는 query만 허용한다. own/global phase 이름은 invalidation 뒤 viewer read fan-out을 뜻하며 mutation을
  만들지 않는다. 실제 own/global change stimulus는 격리 runtime에서 별도 orchestration으로 발생시킨다.
- token 파일은 이 workspace 안의 Git ignored path여야 하고 정확히 `0600`이어야 한다. 권장 위치는
  `tools/load-tests/secrets/game-tokens.json`이며 JSON 형식은 `{"tokens":["...", "..."]}` 하나뿐이다.
- raw result는 새 파일로만 쓰고(`wx`) `0600`을 적용한다. 기본 ignored 위치는
  `tools/load-tests/results/`다.

## 재현 명령

먼저 sample의 `runtimeMetadata` placeholder를 실제 fixture SHA-256, image digest, PostgreSQL/Redis
version으로 바꾼 복사본을 만든다. secret이나 ID를 config에 넣지 않는다.

```sh
install -m 600 /dev/null tools/load-tests/secrets/game-tokens.json
# 편집기로 300개 synthetic game bearer token을 tokens 배열에 입력

pnpm --filter @sammo-ts/load-tests validate --config tools/load-tests/config/300-users-900-npcs-5m.json
pnpm --filter @sammo-ts/load-tests dry-run \
  --config tools/load-tests/config/300-users-900-npcs-5m.json \
  --tokens tools/load-tests/secrets/game-tokens.json
pnpm --filter @sammo-ts/load-tests run \
  --config tools/load-tests/config/300-users-900-npcs-5m.json \
  --tokens tools/load-tests/secrets/game-tokens.json \
  --output tools/load-tests/results/300-users-900-npcs-5m.json
```

`validate`는 config만 검사한다. `dry-run`은 config, host allowlist, token count/permission/Git-ignore와 phase
계획을 검사하지만 network connection을 열지 않는다. driver process는 가능하면 target runtime과 다른
host/cgroup에서 실행하고 두 host의 CPU quota와 competing load를 별도로 기록한다.
`run`은 sample의 runtime metadata placeholder가 하나라도 남아 있으면 시작하지 않는다.

## 결과와 해석

raw JSON은 Git commit/tree/dirty 상태, config/runtime/host hash, Node/V8, host CPU/memory와 cgroup limit,
fixture/image/PostgreSQL/Redis metadata, phase별 metric을 포함한다. 이 정보는 재현 조건이지 합격 판정 자체가
아니다. `runtimeMetadata` placeholder가 남은 run과 외부 stimulus가 없던 own/global phase를 capacity pass로
보고하지 않는다.

E1의 DB-free 자연 통일 계산은 기존 실행 가능한 benchmark를 그대로 사용한다.

```sh
NPC_UNIFICATION_BENCHMARK_CONVERGENCE_ASSIST=none \
NPC_UNIFICATION_BENCHMARK_MAX_YEAR=300 \
NPC_UNIFICATION_BENCHMARK_REPORT_PATH=/dev/shm/npc-unification.json \
pnpm --filter @sammo-ts/game-engine profile:npc-unification-timing
```

현재 E1 command의 기본 fixture는 문서상 880 NPC/10분 턴이므로 900 NPC/5분 또는 총 1,200장수 E1이라고
바꿔 부르지 않는다. E2는 실제 daemon fast-forward, PostgreSQL flush, Redis publish와 schedule-lag/DB
statement 계측을 한 lifecycle로 묶는 안전한 fixture API가 아직 없어 stub을 추가하지 않았다. 따라서 이
package 단독 실행은 E2나 M1 전체 합격 근거가 아니다.

## 도구 자체 검증

```sh
pnpm --filter @sammo-ts/load-tests test
pnpm --filter @sammo-ts/load-tests typecheck
```
