# 요청·턴·저장 흐름

## 조회 요청

일반 query는 다음 경로를 따릅니다.

```text
Vue view/store
  -> tRPC client
  -> game-api router
  -> session actor + 입력 validation
  -> Prisma query
  -> 권한에 맞춘 DTO/redaction
  -> 화면 상태
```

조회는 engine의 in-memory object를 직접 공유하지 않습니다. 따라서 daemon이 transaction을 commit하기 전의
중간 계산은 API query에 노출되지 않습니다.

## API가 직접 끝내는 mutation

예약 턴, 메시지처럼 API가 DB에서 완결할 수 있는 변경도 `input_event`를 사용합니다.

1. `Idempotency-Key`와 tRPC path로 요청 identity를 만듭니다.
2. `app/game-api/src/inputEventBoundary.ts`가 중복·처리 상태를 확인합니다.
3. 같은 PostgreSQL transaction에서 대상 row와 input event 결과를 저장합니다.
4. commit 뒤 응답하고 필요한 realtime 갱신을 알립니다.

동일 revision을 전제로 한 예약 턴 수정은 다른 탭이나 요청이 먼저 갱신했으면 충돌합니다. frontend는 최신
목록을 다시 불러와 사용자의 변경을 덮어쓰지 않게 해야 합니다.

## engine이 처리하는 mutation

```text
game-api mutation
  -> input_event PENDING
  -> daemon claim (FOR UPDATE SKIP LOCKED)
  -> lease/fencing 확인
  -> EngineStateManager savepoint
  -> command/turn/monthly handler가 InMemoryTurnWorld 변경
  -> world + 예약 턴 + log + message + event 결과 flush
  -> input_event COMPLETED를 같은 DB transaction으로 commit
  -> commit 이후 realtime 신호
```

계산이나 DB 쓰기가 실패하면 `EngineStateManager`가 등록된 in-memory participant를 savepoint로 되돌립니다.
DB transaction도 commit되지 않아 메모리와 DB의 부분 진행을 피합니다. lease를 잃은 worker는 stale 결과를
commit할 수 없어야 합니다.

## 한 tick의 처리

`TurnDaemonLifecycle`은 clock과 schedule에서 다음 실행 시점을 구합니다. 턴을 시작하면
`InMemoryTurnProcessor`와 `InMemoryTurnWorld`가 `turnTime`, 그다음 `general.id` 순서로 실행 대상을
결정합니다. checkpoint는 재시작 시 이미 처리한 동일 시점의 장수를 건너뛰는 기준입니다.

장수 한 명의 예약 명령은 대략 다음 순서입니다.

1. `InMemoryReservedTurnStore`에서 첫 예약 명령을 읽습니다.
2. 명령 key를 `GeneralTurnCommandLoader` 또는 `NationTurnCommandLoader`로 불러옵니다.
3. `actionContextBuilder`가 대상 도시·국가·장수, map, unit set, 외교, 시간과 RNG를 구성합니다.
4. permission/min/full constraint를 목적에 맞게 평가합니다.
5. 선행 턴이 있으면 진행 상태를 쌓고, 완성된 시점에 `resolve()`를 실행합니다.
6. effect와 직접 변경을 world에 반영하고 로그·메시지·후속 턴 시간을 기록합니다.
7. 실행된 queue를 당기고 끝에 기본 `휴식`을 채웁니다.

예약 시 통과와 실행 시 성공은 같지 않습니다. 그 사이 자원, 도시 소유, 외교, 직책이 바뀔 수 있으므로 full
constraint는 실행 순간 다시 평가됩니다.

## 월 변경 경계

`InMemoryTurnWorld.advanceMonth()`는 다음 순서를 보존합니다.

1. 다음 연·월을 계산합니다.
2. `beforeMonthChanged` handler를 등록 순서대로 실행합니다.
3. world의 현재 연·월을 바꿉니다.
4. `onMonthChanged` handler를 등록 순서대로 실행합니다.
5. 연도가 바뀌었으면 `onYearChanged`를 실행합니다.

`turnDaemon.ts`의 `composeCalendarHandlers()` 순서에는 월간 event, 수입, 연감, PRE_MONTH 상태 정리,
국가 명령, 국가 통계, 외교, 전쟁 설정, 방랑, 국가 수, 통일, 토너먼트, 경매, 전선 상태가 포함됩니다.
이 순서는 ref의 관찰 가능한 결과와 RNG·persistence에 영향을 주므로 리팩터링 시 단순 정렬하지 않습니다.

## RNG 경계

게임 결과에 영향을 주는 난수는 `LiteHashDRBG`와 `RandUtil`을 사용합니다. seed에는 hidden seed와
action/month/general 같은 context가 직렬화됩니다. main RNG의 소비 순서를 유지해야 하는 로직과 독립된
재현 가능 substream을 써야 하는 fallback을 구분합니다. authoritative path에 `Math.random()`을 넣지
않습니다.

## 장애를 추적할 위치

| 증상                          | 우선 확인                                                             |
| ----------------------------- | --------------------------------------------------------------------- |
| 같은 mutation이 두 번 보임    | idempotency key, `input_event` 상태·attempt                           |
| 요청은 성공했지만 화면이 늦음 | DB commit 결과, Redis/SSE fan-out                                     |
| daemon이 처리하지 않음        | profile gate, pause 상태, lease owner, PENDING claim                  |
| 재시작 뒤 일부 턴 반복        | checkpoint와 general turn ordering                                    |
| DB와 메모리가 다름            | `EngineStateManager`, `databaseHooks`, flush 대상 누락                |
| ref와 결과가 다름             | constraint 순서, action context, RNG trace, rounding, log/effect 순서 |
