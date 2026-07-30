# 요청·턴·저장 흐름

## 조회

```text
browser -> tRPC -> procedure auth -> Prisma/Redis read -> DTO/redaction -> browser
```

Public, own, same-nation, foreign, NPC와 role별 응답은 router가 server-side
actor와 resource relation으로 결정합니다. Prisma row를 그대로 반환하지 않고
endpoint DTO에서 공개 field를 선택합니다.

## API transaction mutation

```text
request
  -> requestId와 input 검증
  -> session actor·권한 검사
  -> InputEvent(target=API, PROCESSING)
  -> Prisma transaction
       -> domain row mutation
       -> InputEvent(SUCCEEDED)
  -> commit
  -> notification
```

`app/game-api/src/inputEventBoundary.ts`의 `executeInputEvent()`가 이 경계를
제공합니다. 중복 request ID는 완료·처리 중 event를 다시 실행하지 않으며,
실패 event는 claim 조건을 만족할 때 attempts를 증가시킵니다.

## Daemon mutation

```text
request
  -> actor·input 검증
  -> InputEvent(target=DAEMON)
  -> daemon transport
  -> lease owner claim
  -> in-memory world mutation
  -> EngineStateManager transaction flush
  -> event 결과와 checkpoint commit
  -> SSE/realtime
```

명령은 API 수락 시점과 daemon 실행 시점에 필요한 조건을 각각 검사합니다.
예약 뒤 world가 바뀔 수 있으므로 실행 constraint를 생략하지 않습니다.

## Tick

`TurnDaemonLifecycle`은 다음 장수 turn time과 tick 경계 중 빠른 시각을
선택합니다. 한 run은 budget 안에서 due command를 처리하고 calendar 경계를
진행합니다.

1. lease와 fencing token을 확인합니다.
2. 예약 턴을 revision/lease로 claim합니다.
3. command args와 실행 constraint를 평가합니다.
4. action module과 command handler가 state patch, log, message를 만듭니다.
5. world에 patch를 적용하고 dirty entity를 기록합니다.
6. 월 경계를 지났으면 scenario event action을 정해진 순서로 실행합니다.
7. transaction에서 dirty state, turn queue, log, event와 checkpoint를 flush합니다.

Transaction 실패 시 `EngineStateManager`가 in-memory snapshot을 복원합니다.
Lease를 잃은 process는 fencing 검사에서 commit하지 못합니다.

## 저장 위치

| 상태                                | 기준                                 |
| ----------------------------------- | ------------------------------------ |
| world, 장수, 국가, 도시, 외교, 부대 | game Prisma model                    |
| 예약 명령과 revision                | `GeneralTurn*`, `NationTurn*`        |
| 내구성 입력                         | `InputEvent`                         |
| daemon 소유권                       | `TurnDaemonLease`                    |
| checkpoint와 calendar meta          | `WorldState`                         |
| 사용자 출력                         | `LogEntry`, message·board 관련 model |
| fan-out                             | Redis/SSE                            |

Redis notification 실패는 이미 commit된 PostgreSQL mutation을 되돌리지
않습니다. 재연결 client는 DB 조회로 상태를 복구합니다.

## RNG

RNG instance는 command와 월간 handler context로 전달합니다. 판정 순서,
후보 정렬과 소비 호출 수를 변경하지 않습니다. Main stream과 관계없는
fallback 무작위성은 seed가 있는 별도 substream을 사용합니다.

## 추적 지점

- request acceptance: `app/game-api/src/inputEventBoundary.ts`
- daemon transport: `app/game-api/src/daemon/`
- lifecycle: `app/game-engine/src/lifecycle/turnDaemonLifecycle.ts`
- runtime composition: `app/game-engine/src/turn/turnDaemon.ts`
- world: `inMemoryWorld.ts`, `worldLoader.ts`
- transaction: `engineStateManager.ts`, `databaseHooks.ts`
- queue: `reservedTurnStore.ts`, `reservedTurnHandler.ts`
- schema: `packages/infra/prisma/game.prisma`
