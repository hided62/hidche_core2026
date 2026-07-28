# NPC 통일 장기 실행 메모리 프로파일

## 목적

`npcNationUprisingUnification.test.ts`의 고정 시나리오를 실제 턴 처리기로
통일까지 실행하고, 장수 수백 명 규모에서 Node 프로세스와 계산 savepoint가
차지하는 메모리를 분리해 관찰한다. 이 프로파일은 성능 회귀 관찰용이며
운영 capacity 산정이나 레거시 결과 동등성의 단독 근거가 아니다.

## 시나리오 계약

- 시작: 181년 8월, NPC 300명, 도시 9개, 국가 없음
- 고정 입력: world id/seed `1`, 고정 장수 능력치와 배치, 고정 map/unit set
- 실제 경로: NPC 건국, 국가 AI 선전포고, 장수 AI 출병, 전투, 점령, 멸망,
  월 경계와 통일 판정
- 수렴 보조: 매 월 국가 ID 1 소유 도시의 인구·방어·성벽·민심을 최대값으로
  복원한다. 따라서 이것은 자연 분포 예측이 아니라 통일 도달을 보장하기 위한
  synthetic stress fixture다.
- 통일 handler는 실제 조건인 “활성 국가 1개이며 모든 도시를 소유”와
  `isUnited=2`/통일 history만 재현한다. 운영 handler의 PostgreSQL
  inheritance/hall-of-fame/dynasty 정산은 실행하지 않는다.
- yearbook PostgreSQL upsert와 tournament Redis lifecycle도 실행하지 않는다.
  이 외부 저장소들의 메모리는 아래 프로세스 수치에 포함되지 않는다.

연감 map/nation payload는 같은 월 경계 world 상태라면 결정적이고 hash가
같다. 토너먼트 월 판정도 `hiddenSeed + previous year/month`와 선행 국가
power RNG 소비 횟수가 같으면 결정적이다. 이 profile 조사 중 발견한 빈
`tournamentPattern`의 `Math.random()` fallback은
`hiddenSeed, "monthly", previousYear, previousMonth, "tournamentPattern"`
전용 `LiteHashDRBG` shuffle로 교체했다. 이 독립 substream은 pattern을
결정적으로 만들면서 뒤따르는 중립 경매의 기존 monthly RNG 위치를 바꾸지
않는다.

## 실행

```bash
pnpm --filter @sammo-ts/game-engine profile:npc-unification-memory
```

runner는 `node --expose-gc`, Vitest thread worker 1개로 이 파일만 실행한다.
전체 JSON은 기본적으로
`app/game-engine/test-results/npc-unification-memory.json`에 기록되며
`test-results/`는 Git에서 제외된다. 경로는
`NPC_UNIFICATION_MEMORY_REPORT_PATH`로 바꿀 수 있다.

## 측정 정의

- `maxObservedHeapUsedBytes`: 월별 관찰과 명시적 GC 전후 savepoint sample에서
  본 Node heap 최고치
- `maxObservedRssBytes`: 같은 관찰점의 프로세스 RSS 최고치
- `processResourceMaxRssBytes`: OS가 보고한 실행 전체 high-water RSS
- `participantSnapshotBytes`: world와 reserved-turn snapshot을 V8 serialize한
  크기. 실제 live heap 크기가 아니라 비교 가능한 payload 크기다.
- `participantSnapshotHeapDeltaBytes.peakWhileRetained`: 명시적 GC 직후
  snapshot을 잡아 둔 동안의 heap 증가 최고치
- `participantSnapshotHeapDeltaBytes.peakAfterRelease`: snapshot 참조를
  해제하고 다시 GC한 뒤 baseline 대비 heap 차이 최고치
- `participantSnapshotCloneMs`: `captureState()` 두 개의 복제 시간

프로세스 수치는 Node, Vitest worker, 테스트 harness, engine state를 모두
포함한다. 반대로 PostgreSQL, Redis와 production daemon 주변 프로세스는
포함하지 않는다.

## 2026-07-28 관찰 결과

Node `v24.14.1`, Linux x64에서 독립 실행 두 번 모두 다음 게임 결과가
동일했다.

- 193년 1월 통일, 137개월 진행
- 5개국 건국, 선전포고 6회, 출병 2,136회
- 종료 시 장수 356명
- participant snapshot: 초기 139,363 bytes, 종료 449,359 bytes,
  최고 452,686 bytes
- snapshot 유지 중 heap 증가 최고 2,399,640 bytes, 해제·GC 후 최고
  1,132,104 bytes

프로세스 관찰값은 실행별로 다음과 같았다.

| 실행 | wall time | max heap used | max observed RSS | OS max RSS | clone 평균 / 최고 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 19.87 s | 145,309,008 B | 481,943,552 B | 486,830,080 B | 3.18 / 4.33 ms |
| 2 | 19.86 s | 145,253,136 B | 488,198,144 B | 489,697,280 B | 3.24 / 3.91 ms |

게임 결과와 serialized snapshot 크기는 두 번 모두 정확히 같았다. RSS는
allocator/JIT/Vitest 영향으로 약 6.3 MB 차이가 났으므로 단일 숫자를 엔진
상태 크기로 해석하지 않는다.

## 해석과 남은 범위

이 fixture에서 계산 rollback용 participant snapshot payload의 최고치는
약 0.43 MiB이고, snapshot이 살아 있는 순간의 관찰 heap 증가는 약
2.29 MiB였다. 반면 전체 테스트 프로세스 high-water RSS는 약
464–467 MiB였다. 따라서 이 실행에서 RSS 대부분을 savepoint payload
자체가 설명하지는 않는다.

운영 통일 handler는 `isUnited`와 history를 memory에 반영한 뒤 inheritance,
hall-of-fame, dynasty PostgreSQL 정산 세 개를 await하지 않고 시작한다.
이 프로파일은 통일 판정까지의 engine memory를 측정하지만 그 비동기 정산의
완료, 실패 복구, 메모리 또는 distributed atomicity는 검증하지 않는다.
그 경로를 관찰하려면 격리 PostgreSQL fixture와 정산 완료 barrier 또는
durable outbox가 별도로 필요하다.
