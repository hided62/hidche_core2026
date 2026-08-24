# ref ↔ core2026 차등 검증

## 목적

차등 검증은 같은 입력과 seed에서 ref와 core2026의 판정, RNG 소비, 출력,
상태 mutation과 persistence 순서를 비교합니다. 명령 이름이나 최종 성공 여부만
같은 것은 호환성 근거가 아닙니다.

## 검증 계층

| 계층              | 위치                                            | 보장 범위                                  |
| ----------------- | ----------------------------------------------- | ------------------------------------------ |
| 정적 catalog 비교 | `tools/compare-command-*.mjs`                   | command key, constraint, log 계약          |
| logic unit        | `packages/logic/test`                           | 계산, constraint, trigger, fixed-seed 결과 |
| engine unit       | `app/game-engine/test`                          | handler 순서, in-memory state, lifecycle   |
| DB integration    | `tools/integration-tests`, app integration test | Prisma transaction, lease, queue, reload   |
| ref 차등          | `tools/integration-tests/src/legacy*`           | 동일 fixture의 ref/core 결과               |
| live Chromium     | `tools/frontend-legacy-parity`                  | 실제 화면 geometry와 interaction           |

각 계층은 다른 계층을 대체하지 않습니다. Unit test는 PostgreSQL commit을
증명하지 않고, API mock은 인증 transport를 증명하지 않으며, screenshot
한 장은 hover·focus·error 흐름을 증명하지 않습니다.

## Fixture 계약

Fixture에는 다음 값이 명시되어야 합니다.

- ref 기준 commit과 core2026 기준 commit
- profile, scenario, game time과 turn term
- user, general, nation, city, diplomacy, troop과 예약 턴
- command key와 원시 args
- seed와 RNG 초기 상태
- 성공·실패 경로에 필요한 resource
- 비교 대상 state field, log, message와 side effect

ref MariaDB fixture는 전용 schema를 사용합니다. core PostgreSQL과 Redis도
worktree 전용 instance를 사용합니다. 다른 실행이 공유 RNG, queue, table,
Redis key를 변경할 수 있는 환경에서 결과를 비교하지 않습니다.

## 실행 경로

정적 명령 계약:

```sh
pnpm check:legacy:general
pnpm check:legacy:nation
```

기능 worktree의 case wrapper를 검증할 때는
`TURN_DIFFERENTIAL_CASE_SCRIPT`로 해당 shell script를 지정합니다.
이 값은 wrapper가 ref container 내부 PHP 계측기를 선택할 때 전달하는
`TURN_DIFFERENTIAL_RUNNER_SCRIPT`와 구분합니다.

즉시 외교 3종의 core log는 명령 파일이 아니라 공통
`packages/logic/src/diplomacy/instantResponse.ts`에서 생성됩니다.
정적 log 비교의 이 예외는 명령별 allowlist로 제한하며,
`instantDiplomacyCoreReference.integration.test.ts`에서 실제 Ref API entry와 Core
router 결과를 별도로 비교합니다.

장수·수뇌 registry 전수 성공 case는 각각
`turnCommandGeneralMatrix.integration.test.ts`와
`turnCommandNationMatrix.integration.test.ts`가 registry와 exact-set으로 닫습니다.
두 matrix의 `includeLifecycle`은 요청 scope의 queue shift와 tail lifecycle까지이며,
같은 actor의 수뇌→장수 제품 outer loop를 뜻하지 않습니다. 결합 outer lifecycle은
`turnCommandFullLifecycle.integration.test.ts`, 실제 PostgreSQL flush/reload는
`turnCommandFullLifecyclePersistence.integration.test.ts`가 대표 fixture로 검증합니다.

기본 integration:

```sh
pnpm test:integration
```

PostgreSQL·Redis 조건부 경계:

```sh
pnpm test:integration:conditional
```

개별 suite와 test name은 package script 뒤에 전달합니다.

```sh
pnpm --filter @sammo-ts/game-engine test inputEventAtomicity.test.ts
pnpm --filter @sammo-ts/integration-tests test:integration
```

실제 script 인자는 해당 package의 `package.json`을 확인해 주세요.

## 비교 snapshot

Canonical 비교값은 의미 단위로 정규화합니다.

- general: 위치, 소속, owner identity, 자원, 병력, 능력치, 경험·공헌·rank mirror,
  affinity·NPC origin/state, penalty, aux, turn time
- nation: 자원, level, 수도, 외교, 정책, flag·spy·rate·bill·secret limit, 저장 `gennum`, aux
- city: 소유권, 인구·내정·방어, conflict, supply와 인접 상태
- troop과 실행 중 새로 생긴 general/city/nation/troop의 created-entity closure
- queue: command, args, term, next available, revision
- output: `general_record`/`world_history`별 물리 순서, log year·month·format·text,
  strict message payload·option·icon·lifetime·unread timeline, 공개 문구와 error
- execution: RNG trace, handler 순서, input event와 checkpoint

DB auto ID, 생성 시각처럼 의미 없는 차이는 comparator에서 이름과 이유를
명시합니다. 의미 field를 ignore하거나 숫자 허용 범위를 넓혀 mismatch를
숨기지 않습니다.

Core가 의도적으로 full precision을 유지하는 `nation.tech`와 `city.trust`를 Ref의
MariaDB `FLOAT` snapshot과 비교할 때는 raw 차이 경로를 fixture별로 먼저 고정합니다.
그 뒤 test-only binary32 저장·6자리 읽기 projection을 Core의 절대 before/after 값에
적용해 Ref delta와 정확히 일치하는지 다시 검사합니다. 제품 상태를 양자화하거나
전역 tolerance·전역 ignore로 다른 차이를 숨기지 않습니다.

JSON missing·`{}`·`[]`는 snapshot 원형에서 구분합니다. 일반 message option 부재의
Ref `[]`와 Core `{}`만 의미상 같게 보며, actionable diplomacy의 `option=null` sentinel은
부재로 합치지 않습니다. Ref log prefix와 Core format은 독립적으로 해석하고, 서로 다른
`ActionLogger::flush()`/`applyDB()` 경계는 고유 `legacyFlushGroup`으로 보존합니다.

## RNG

Gameplay RNG는 `LiteHashDRBG`, `RNG`, `RandUtil` 경로를 추적합니다.
후보가 하나인 선택, 실패 분기, fallback도 ref가 소비한 호출 수와 순서를
보존합니다. 보조 무작위성이 필요하면 main stream과 분리된 seeded substream을
사용하고 main stream의 소비량이 변하지 않는지 확인합니다.

전투는 최종 승패 외에 phase, 공격 순서, critical·회피·계략 판정, 피해,
부상, 병량, 도시·국가 후처리와 log까지 비교합니다.

## 실패 판정

Mismatch는 다음 정보를 함께 남깁니다.

- fixture와 command
- 첫 RNG divergence
- 첫 state divergence
- ref/core log
- transaction 또는 reload 결과
- 재현 명령

기준선 자체의 실패와 변경으로 생긴 회귀를 분리합니다. 환경 누락으로 skip된
suite는 통과로 집계하지 않습니다.

## 완료 조건

기능별 완료에는 다음 근거가 모두 필요합니다.

1. 정상, 권한 실패, 입력 실패와 경계값 fixture
2. 같은 seed의 RNG와 결과 비교
3. state, log, queue와 persistence 비교
4. 실제 PostgreSQL 경로 또는 명시된 미검증 경계
5. UI 기능이면 같은 Chromium 조건의 화면·상호작용 비교
6. 상위 `ref-core2026-mapping.md`와 날짜가 있는 report의 재현 정보
