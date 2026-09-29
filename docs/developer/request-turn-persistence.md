# 요청·턴·저장 흐름

이 문서는 데이터베이스와 트랜잭션을 아는 독자를 위한 실행 흐름입니다. 처음이라면
[기초 구조 안내](./first-steps.md)를 먼저 읽으세요. **mutation**은 상태 변경,
**flush**는 메모리에서 바뀐 내용을 저장소에 반영하는 작업입니다.
조회·즉시 변경·예약 수정·시간에 따른 턴 실행을 구분해서 읽습니다.

## 조회

```text
browser -> tRPC -> procedure auth -> Prisma/Redis read -> DTO/redaction -> browser
```

Public, own, same-nation, foreign, NPC와 role별 응답은 router가 server-side
actor와 resource relation으로 결정합니다. Prisma row를 그대로 반환하지 않고
endpoint DTO에서 공개 field를 선택합니다.

## API transaction mutation

```text
request → requestId·입력·actor·권한 검증
  → PostgreSQL transaction
       → API InputEvent 생성 또는 기존 row 잠금
       → identity 확인 → PROCESSING(attempts + 1)
       → savepoint 이후 업무 변경
       → SUCCEEDED + 실제 result → commit
  → notification
```

`app/game-api/src/inputEventBoundary.ts`의 `executeInputEvent()`가 이 경계를
제공합니다. identity는 event type, actor, payload digest를 포함합니다. 같은 요청의
완료 결과는 재사용하고, 다른 내용으로 같은 ID를 사용하면 충돌로 거부합니다.
`PENDING`·`FAILED`는 identity가 맞으면 재시도할 수 있고, `PROCESSING`은 임의로
다시 선점하지 않습니다.

업무 오류는 savepoint까지 되돌린 뒤 실패 상태를 저장합니다. DB transaction
자체가 실패하면 그 안의 변경은 rollback됩니다. 상세 상태 표와 HTTP 응답 계약은
[API 입력 재시도](../architecture/api-input-event-replay.md)를 따릅니다.

## Daemon mutation

```text
request
  -> actor·input 검증
  -> InputEvent(target=ENGINE)
  -> daemon transport
  -> lease owner claim
  -> in-memory world mutation
  -> EngineStateManager의 메모리 복원 경계 안에서 DB transaction flush
  -> PostgreSQL event 결과 commit과 in-memory world checkpoint 확정
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
7. PostgreSQL transaction에서 dirty state, turn queue, log와 event를 flush하고,
   같은 `EngineStateManager` 경계에서 world checkpoint를 확정합니다.

`databaseHooks.ts`가 PostgreSQL transaction을 담당하고, 이를 감싼
`EngineStateManager`가 실패 시 메모리 snapshot을 복원합니다. 이 관리자는 DB를
직접 알지 못합니다. DB rollback과 메모리 복원을 함께 유지해야 합니다.
Lease를 잃은 process는 fencing 검사에서 commit하지 못합니다.
`InMemoryTurnStateStore`는 checkpoint를 별도로 복제하지 않고 rollback 대상인
`InMemoryTurnWorld`에서 읽습니다. 따라서 flush 실패 뒤 다음 run도 복원된
checkpoint에서 시작합니다.

## 저장 위치

| 상태                                | 기준                                 |
| ----------------------------------- | ------------------------------------ |
| world, 장수, 국가, 도시, 외교, 부대 | game Prisma model                    |
| 예약 명령과 revision                | `GeneralTurn*`, `NationTurn*`        |
| 내구성 입력                         | `InputEvent`                         |
| daemon 소유권                       | `TurnDaemonLease`                    |
| calendar meta                       | `WorldState`                         |
| 부분 run checkpoint                 | `InMemoryTurnWorld` snapshot         |
| 사용자 출력                         | `LogEntry`, message·board 관련 model |
| fan-out                             | Redis/SSE                            |

Redis notification 실패는 이미 commit된 PostgreSQL mutation을 되돌리지
않습니다. 재연결 client는 DB 조회로 상태를 복구합니다.
부분 run checkpoint 자체는 DB row가 아닙니다. 재시작 시에는 이미 commit된
`General.turnTime`과 `WorldState` calendar가 처리 완료 범위를 결정합니다.

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
