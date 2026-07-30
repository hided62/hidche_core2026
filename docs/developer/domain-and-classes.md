# 도메인과 조립 지점

## World entity

`packages/logic/src/domain/entities.ts`와 `world/types.ts`가 장수, 국가, 도시,
부대, 외교와 trigger state의 런타임 타입을 정의합니다. Prisma row는
`app/game-engine/src/turn/worldLoader.ts`가 이 타입으로 변환합니다.
`InMemoryTurnWorld`가 조회와 mutation을 제공하고 `EngineStateManager`가
transaction snapshot과 dirty state를 관리합니다.

## Command

장수 command는 `GeneralActionDefinition`으로 다음 계약을 가집니다.

- key와 사용자 표시 이름
- raw args parser
- 예약, 최소, 실행 constraint
- 실패 문구 formatter
- pre/post turn과 stack metadata
- state patch, log와 side effect를 담는 실행 결과

국가 command는 `packages/logic/src/actions/turn/nation`의 module과
`app/game-engine/src/turn/reservedTurnCommands.ts`에서 같은 실행 context에
연결됩니다. `commandRegistry.ts`와 command profile이 profile별 가용 명령을
결정합니다.

## Constraint

`packages/logic/src/constraints`는 `ConstraintContext`와 `StateView`를 받아
예약·실행 조건을 평가합니다. API가 client 입력을 검증하는 단계와 daemon이
실행 직전 world 상태를 검사하는 단계는 분리합니다. 실패 결과는 ref 문구,
turn 소비와 side effect 계약을 보존합니다.

## Action module

`loadActionModuleBundle()`은 국가 특성, 관직, 내정 특기, 전투 특기, 성격,
병종, 계승, scenario slot, item 순서로 module을 조립합니다. 계산 fold,
priority trigger와 의미 event는 각각 다른 interface를 사용합니다.
[행동 모듈 프로토콜](../architecture/action-module-protocol.md)을 따라 주세요.

## 주요 클래스

| 클래스·함수               | 책임                                               |
| ------------------------- | -------------------------------------------------- |
| `GatewayOrchestrator`     | profile operation과 process reconciliation         |
| `createGameApiServer`     | game transport, context, router와 worker lifecycle |
| `DatabaseTurnDaemonLease` | profile별 lease, heartbeat와 fencing               |
| `TurnDaemonLifecycle`     | schedule, pause/resume/run/shutdown loop           |
| `InMemoryTurnWorld`       | turn 실행 중 world state와 dirty tracking          |
| `EngineStateManager`      | snapshot, transaction flush와 rollback restore     |
| `ReservedTurnHandler`     | revision·lease 기반 예약 명령 claim과 실행         |
| `GeneralActionPipeline`   | action module 계산·trigger·event 실행              |
| `WarEngine`               | 전투 phase, RNG, 상태와 log 결과                   |

## 명령 추가

1. ref command의 예약·실행 constraint, args, RNG, log와 DB mutation을 찾습니다.
2. command definition과 필요한 domain helper를 추가합니다.
3. engine registry, profile resource와 frontend args UI를 연결합니다.
4. state patch와 dirty field가 flush·reload되는지 확인합니다.
5. 정상·실패·경계 fixed-seed test와 ref 차등 fixture를 추가합니다.
6. 생성 command catalog, 상위 mapping과 report를 갱신합니다.
