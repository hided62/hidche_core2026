# NPC 대규모 인메모리 천통 시간 벤치마크

## 목적

`scenario_2601`의 장수 roster와 `che` 지도를 사용해 PostgreSQL·Redis를
연결하지 않은 계산 전용 월드에서 NPC가 건국부터 통일까지 자동 진행하는 시간을
측정한다. 전체 wall time과 함께 다음 구간을 분리한다.

- 일반/국가 커맨드 실행 시간
- NPC AI 판단 시간
- 수뇌(`officerLevel >= 5`)와 일반 NPC 장수 턴 시간
- 게임 연월별 월 처리 시간과 국가·장수 수

이 벤치마크는 DB throughput이나 production daemon capacity를 측정하지 않는다.
서버 계산량의 상한/회귀를 재현하는 프로파일이며 실제 운영 wall time에는
PostgreSQL transaction, flush, lease, Redis, API와 다른 프로세스 경합을 별도로
더해야 한다.

## 실행

기본 실행은 고정 seed, 시나리오 2601, 880명, 94도시, 10분 턴과 300년 안전
상한을 사용한다.

```sh
NPC_UNIFICATION_BENCHMARK_CONVERGENCE_ASSIST=none \
NPC_UNIFICATION_BENCHMARK_MAX_YEAR=300 \
NPC_UNIFICATION_BENCHMARK_REPORT_PATH=/dev/shm/npc-unification.json \
pnpm --filter @sammo-ts/game-engine profile:npc-unification-timing
```

`NPC_UNIFICATION_BENCHMARK_CONVERGENCE_ASSIST=none`이 무보정 자연 진행이다.
비교용 `nation-1-max-city`는 매월 1번 국가가 이미 소유한 도시의 인구·내정·방어·성벽과
민심을 최대값으로 복원한다. 국가 선택, 외교, 출병, 전투, 점령, 멸망과 통일
판정을 직접 만들지는 않는다. 대형 fixture가 유한 시간에 통일하도록 한 기존
`npcNationUprisingUnification.test.ts`의 수렴 보조를 94도시로 확장한 것이다.

## 실행 경계

포함하는 경로는 다음과 같다.

- `scenario_2601.json` 합성 loader, `map_che.json`, `unitset_che.json`
- `buildScenarioBootstrap()`의 deterministic 초기 배치
- `InMemoryTurnWorld`, `InMemoryReservedTurnStore`, `InMemoryTurnProcessor`
- `GeneralAI.chooseNationTurn()`과 `chooseGeneralTurn()`
- 실제 일반/국가 action definition, 전투, 점령과 국가 멸망
- test harness의 국가 예약턴 월 갱신, 수입, NPC 세금, 전선 갱신
- 실제 `unificationHandler.ts`의 단일 국가·전 도시 소유 판정과 in-memory draft

제외하는 경로는 다음과 같다.

- PostgreSQL loader, transaction, lease, flush와 통일 최종 archive
- Redis tournament/realtime
- scenario event action과 yearbook persistence
- API, scheduler sleep, worker IPC와 browser

월마다 `world.consumeDirtyState()`와 예약 큐 acknowledgement를 호출해 log,
message와 persistence draft를 메모리 sink로 비운다. DB write는 수행하지 않지만
운영 flush 뒤 메모리 draft가 정리되는 경계는 재현한다.

## 계측 정의

`createReservedTurnHandler()`의 선택적 `onActionProfiled` hook은 hook을 넘긴
경우에만 `process.hrtime.bigint()`로 다음 시간을 잰다.

- `aiDecisionDurationNs`: `GeneralAI` 생성/재사용과 해당
  `chooseNationTurn()` 또는 `chooseGeneralTurn()` 호출
- `actionDurationNs`: 선택된 action의 parse, constraint, execute와 결과 patch
  생성

`InMemoryTurnProcessor`의 before/after hook은 한 장수 턴 전체를 잰다. 수뇌는
한 턴에 국가 AI와 일반 AI를 모두 실행할 수 있으므로 수뇌의 “판단/턴”은 두
decision 합계를 수뇌 턴 수로 나누어 해석한다. JSON은 커맨드별 count/total/
average/p50/p95/p99/max, 수뇌 여부, 연월별 합계와 process memory high-water를
포함한다.

계측 clock 호출과 배열 수집 자체의 overhead가 wall time에 포함된다. 같은
고정 seed의 독립 실행을 반복하여 결과 state가 같고 wall time만 변하는지 함께
확인해야 한다.

## 2026-08-15 기준 결과

AMD Ryzen 7 9800X3D, 16 logical CPU, Node v24.18.0, Linux x64의 shared 개발
호스트에서 무보정 자연 실행 세 번 모두 242년 4월, 747개월, 46개국 건국,
총 699,892 장수 턴과 최종 장수 970명으로 동일하게 통일했다. wall time은
483.68초, 466.91초, 최신 `main` 469.71초(평균 473.43초)였다. 상세 수치와
커맨드 33종 표는 상위 작업공간의
`report/2026-08-15-NPC-대규모-인메모리-천통-벤치마크.md`에 기록한다.

수렴 보조 실행 두 번은 225년 11월에 375.24/422.68초로 끝났다.
도시 자원 복원이 전쟁과 통일 연월에 영향을 줬으므로 이 수치는 자연 실행과 분리한
비교 근거로만 사용한다.
