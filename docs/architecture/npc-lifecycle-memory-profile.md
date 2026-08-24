# NPC 생명주기 메모리 프로파일

## 목적과 해석 경계

턴 데몬이 오래 실행될 때의 안정 상태와 NPC 생성·사망 churn을 서로 분리해
측정한다. 각 case는 별도 Node/Vitest worker에서 실행하며 명시적 GC 뒤의
retained heap, RSS, rollback participant의 V8 직렬화 크기, 실제 live 장수 수와
예약 턴 큐 수를 기록한다.

이 프로파일은 `scenario_2601`의 실제 장수 shape, `InMemoryTurnWorld`,
`InMemoryReservedTurnStore`, `EngineStateManager.transaction()`과 flush 뒤
acknowledgement를 사용한다. PostgreSQL/Redis I/O, 실제 NPC AI·전투·월간 event,
다른 PM2 process와 allocator/cgroup 경합은 포함하지 않는다. 따라서 heap과
snapshot은 엔진 상태 보유량 비교에 사용하고 RSS는 동일 host의 보조 high-water로만
해석한다.

## 시나리오

| 이름 | 고정 조건 | 확인하는 위험 |
| --- | --- | --- |
| `steady-state` | 1,200명, 매 cycle 100명 update/예약 턴 shift, 생성·사망 0 | 장기 transaction/flush 자체의 retained heap drift |
| `growth` | 1,200명에서 cycle마다 100명 생성 | live NPC 1명당 world+예약 큐 증가량 |
| `death-drain` | 종료 시 1,200명이 되도록 큰 roster에서 cycle마다 100명 사망 | 사망 뒤 world와 예약 큐가 실제로 줄어드는지 |
| `balanced-churn` | 1,200명을 유지하면서 cycle마다 100명 사망+100명 생성 | live 수가 일정해도 과거 ID/queue가 남는 누수 |
| `rollback-churn` | cycle마다 100명 생성+사망 후 강제 실패 | rollback snapshot 복원 뒤 retained state drift |

`death-drain`과 `balanced-churn`은 `retain`과 `prune`을 같은 입력으로 A/B
실행할 수 있다. `retain`은 수정 전처럼 삭제된 예약 큐를 남기는 비교 모드이고,
`prune`은 PostgreSQL world flush 성공 뒤 삭제된 장수·국가 큐를 제거하는 현재
제품 경계다. 큐 제거는 `EngineStateManager.transaction()` 안에서 수행되므로 이후
오류가 발생하면 transaction savepoint가 큐와 journal set까지 복원한다.

## 실행

기본 행렬은 1,200명, 80 cycle, cycle당 100명, 5 cycle 간격 sample이다.

```sh
NPC_LIFECYCLE_MEMORY_REPORT_PATH=/dev/shm/npc-lifecycle-memory.json \
pnpm --filter @sammo-ts/game-engine profile:npc-lifecycle-memory
```

시나리오와 규모를 좁힐 수 있다.

```sh
NPC_LIFECYCLE_MEMORY_SCENARIOS=balanced-churn@retain,balanced-churn@prune \
NPC_LIFECYCLE_MEMORY_CYCLES=240 \
NPC_LIFECYCLE_MEMORY_BATCH_SIZE=100 \
NPC_LIFECYCLE_MEMORY_SAMPLE_EVERY=15 \
NPC_LIFECYCLE_MEMORY_BASE_GENERALS=1200 \
NPC_LIFECYCLE_MEMORY_REPORT_PATH=/dev/shm/npc-lifecycle-memory-churn-240.json \
pnpm --filter @sammo-ts/game-engine profile:npc-lifecycle-memory
```

지원 변수:

- `NPC_LIFECYCLE_MEMORY_SCENARIOS`: 쉼표 구분 `name@prune|retain`
- `NPC_LIFECYCLE_MEMORY_CYCLES`: transaction/flush 반복 횟수
- `NPC_LIFECYCLE_MEMORY_BATCH_SIZE`: cycle당 update/create/delete 수
- `NPC_LIFECYCLE_MEMORY_SAMPLE_EVERY`: 명시적 GC와 snapshot sample 간격
- `NPC_LIFECYCLE_MEMORY_BASE_GENERALS`: steady/growth/churn의 live 기준 수
- `NPC_LIFECYCLE_MEMORY_REPETITIONS`: 각 독립 case 반복 횟수
- `NPC_LIFECYCLE_MEMORY_REPORT_PATH`: aggregate JSON 경로

## 2026-08-24 기준 결과

Node v24.18.0, Linux x64 shared 개발 host에서 80×100 행렬을 독립적으로 두 번
실행했다. 게임 결과에 영향을 주지 않는 profile 수치 중 retained heap delta는
두 번의 차이가 14 KiB 이내였고 snapshot delta와 최종 queue 수는 정확히
일치했다.

| case | 최종 live/queue | retained heap delta (run 1/2) | snapshot delta | 해석 |
| --- | ---: | ---: | ---: | --- |
| steady 80 | 1,200 / 1,200 | +121,664 / +126,720 B | 0 B | transaction 반복 자체는 안정 |
| growth 8,000명 | 9,200 / 9,200 | +37,487,264 / +37,494,272 B | +13,807,868 B | live NPC 약 4.69 KiB heap, 1.73 KiB snapshot/명 |
| death retain | 1,200 / 9,200 | -11,407,296 / -11,393,936 B | -7,450,860 B | world는 줄지만 죽은 큐 8,000개 잔존 |
| death prune | 1,200 / 1,200 | -37,058,496 / -37,054,712 B | -13,802,736 B | live roster와 queue가 함께 감소 |
| balanced retain | 1,200 / 9,200 | +25,970,064 / +25,969,504 B | +6,357,008 B | live 수가 같아도 과거 큐가 선형 증가 |
| balanced prune | 1,200 / 1,200 | +314,464 / +305,984 B | +5,132 B | 8,000명 churn 뒤 dead queue 0 |
| rollback churn | 1,200 / 1,200 | +1,982,920 / +1,985,664 B | +72,000 B | 80회 강제 rollback 후 live/queue 복원 |

장기 soak도 별도로 실행했다.

- steady 720 cycle: live/queue `1,200/1,200`, heap `+217,192 B`, snapshot `0 B`,
  후반 slope 약 `182 B/cycle`
- balanced 24,000명 churn, retain: queue 25,200, heap `+77,121,104 B`,
  snapshot `+19,063,275 B`
- 같은 churn, prune: queue 1,200, heap `+321,256 B`, snapshot `+7,400 B`

수정 전 예약 큐 보유량은 churn 1명당 retained heap 약 3.2 KiB, 직렬화된
transaction participant 약 794 B로 선형 증가했다. 정리 후 두 장기 case에서
dead queue는 0이며 live 수가 일정한 snapshot은 ID 문자열 길이 차이 외에는
거의 일정했다.

`growth` 9,200명 sample에서 in-transaction heap은 같은 cycle의 flush 후보다
최대 약 14.1 MiB 높았다. 현재 world rollback은 live state 전체를 deep clone하므로
다음 절감 후보는 mutation별 copy-on-write/delta journal이다. 다만 이 변경은
오류 rollback, RNG와 persistence 재시도 순서에 직접 닿으므로 이번 작업에서는
예약 큐처럼 소유권이 명확한 항목만 정리하고 world snapshot 구조는 바꾸지 않는다.

## 운영 관찰

턴 데몬 5분 telemetry는 world entity 수에 더해 `generalTurnQueues`와
`nationTurnQueues`를 출력한다. 정상 flush가 이어지는 장기 서버에서는
`generalTurnQueues - generals`가 사망 누적으로 계속 증가하지 않아야 한다.
heap/RSS만으로 queue leak을 추정하지 말고 두 count와 OOM/restart, 월 진행을 함께
관찰한다.
