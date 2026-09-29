# 도메인과 조립 지점

**도메인**은 장수·도시·전투처럼 이 게임이 다루는 개념과 규칙입니다. 이 문서는
객체 지향 문법을 설명하기보다 “규칙을 누가 계산하고 결과를 누가 적용하는가”를
따라갑니다. [기초 안내](./first-steps.md)의 모병 예시를 떠올리면 좋습니다.

```text
저장된 장수·도시 → loader → 메모리 세계
예약한 명령 → 입력 해석 → 조건 검사 → 규칙 계산 → 변경 결과
변경 결과 → 메모리 세계에 적용 → DB 저장 또는 실패 시 복원
```

## World entity

`packages/logic/src/domain/entities.ts`와 `world/types.ts`가 장수, 국가, 도시,
부대, 외교와 trigger state의 런타임 타입을 정의합니다. Prisma row는
`app/game-engine/src/turn/worldLoader.ts`가 이 타입으로 변환합니다.
`InMemoryTurnWorld`가 조회와 mutation을 제공하고 `EngineStateManager`가
메모리 snapshot과 실패 복원을 관리합니다. 실제 DB transaction은
`databaseHooks.ts`의 책임입니다. **dirty state**는 마지막 저장 이후 바뀌어 다시
저장해야 하는 상태를 뜻합니다.

## Command

명령(command)은 “모병” 같은 행동 한 종류입니다. 입력(args)은 병종·수량처럼
그 행동에 필요한 값입니다. **constraint**는 실행에 필요한 조건이고,
**state patch**는 병력·자원 등 바꿀 값의 묶음입니다. 실행 결과에는 patch뿐 아니라
플레이어에게 보일 로그와 후속 효과도 포함됩니다.

장수 command는 definition·command spec·resolver를 통해 다음 계약을 연결합니다.

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

## 주요 클래스와 함수

| 클래스·함수                   | 책임                                               |
| ----------------------------- | -------------------------------------------------- |
| `GatewayOrchestrator`         | profile operation과 process reconciliation         |
| `createGameApiServer`         | game transport, context, router와 worker lifecycle |
| `DatabaseTurnDaemonLease`     | profile별 lease, heartbeat와 fencing               |
| `TurnDaemonLifecycle`         | schedule, pause/resume/run/shutdown loop           |
| `InMemoryTurnWorld`           | turn 실행 중 world state와 dirty tracking          |
| `EngineStateManager`          | 메모리 snapshot, 실패 시 restore                   |
| `createReservedTurnHandler()` | revision·lease 기반 예약 명령 claim과 실행         |
| `GeneralActionPipeline`       | action module 계산·trigger·event 실행              |
| `resolveWarBattle()`          | 전투 phase, RNG, 상태와 log 결과                   |

## 명령 추가

1. 계승 명령이면 Ref의 예약·실행 조건, 입력, RNG, 로그와 DB 변경을 찾습니다.
   Core 전용 명령이면 요구사항과 의도한 결과를 먼저 정합니다.
2. command definition과 필요한 domain helper를 추가합니다.
3. engine registry, profile resource와 frontend args UI를 연결합니다.
4. state patch와 dirty field가 flush·reload되는지 확인합니다.
5. 정상·실패·경계 fixed-seed test를 추가하고, 계승 계약은 Ref 차등 fixture로 확인합니다.
6. 생성 command catalog, 상위 mapping과 report를 갱신합니다.
