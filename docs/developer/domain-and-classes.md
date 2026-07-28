# 도메인 로직과 핵심 클래스

## 핵심 entity

`packages/logic/src/domain/entities.ts`가 HTTP나 Prisma row에 종속되지 않은 `General`, `City`, `Nation`,
`Troop`, diplomacy와 trigger 상태를 정의합니다. engine 전용 `TurnGeneral`, `TurnWorldState`,
`TurnEvent`는 `app/game-engine/src/turn/types.ts`에서 실행 시간·예약 턴·월간 상태를 더합니다.

| entity  | 핵심 책임                                                                  |
| ------- | -------------------------------------------------------------------------- |
| General | 능력치, 경험·공헌, 소속·도시·부대, 병력·훈련·사기, 자원, 특기·아이템, meta |
| City    | 소유 국가, 규모, 인구·농업·상업·치안, 수비·성벽, 보급·전선 상태            |
| Nation  | 수도, 국고·군량, 등급·국가 타입, 기술과 국가 meta                          |
| Troop   | 부대장·구성원과 부대 상태                                                  |
| World   | 현재 연·월, 최근 턴 시각, scenario config/meta와 전체 entity collection    |

Prisma row를 곧바로 게임 규칙에 넘기지 않습니다. `worldLoader.ts`와 API의 row mapper가 DB 표현을 domain
표현으로 바꾸고, flush 계층이 반대 변환을 담당합니다.

## 명령 정의

`GeneralActionDefinition`은 장수·국가 예약 명령이 공유하는 계약입니다.

- `key`, `name`: 저장 key와 화면 표시명
- `parseArgs`: 외부 입력을 실행 인자로 변환
- `buildPermissionConstraints`: 예약 입력 자체를 허용할지 판단
- `buildMinConstraints`: command table에서 현재 가능한지 사전 판단
- `buildConstraints`: 실행 시점의 전체 조건
- `getPreReqTurn`, `getPostReqTurn`: 연속 실행과 재사용 대기
- `resolve`: domain state와 effect를 계산

각 파일의 `commandSpec`은 category, 인자 필요 여부, schema와 definition factory를 등록합니다.
`GENERAL_TURN_COMMAND_KEYS`, `NATION_TURN_COMMAND_KEYS`가 전체 key 집합이며, `TurnCommandProfile`이
profile별 subset을 선택합니다.

## Constraint 시스템

`packages/logic/src/constraints`는 “무엇이 필요한가”와 “현재 view가 무엇을 알고 있는가”를 분리합니다.
`ConstraintContext`에는 actor, city, nation, args, env와 평가 mode가 있고 `StateView`가 entity와 대상
정보를 제공합니다.

평가 결과는 다음 셋입니다.

- `allow`: 현재 정보로 조건을 만족합니다.
- `deny`: 이유가 확정된 실패입니다.
- `unknown`: 대상 입력이나 추가 state가 없어 아직 판정할 수 없습니다.

API command table은 `unknown`의 missing requirement가 대상 입력뿐이면 `needsInput`, 그 밖이면
`unknown`으로 보여 줍니다. 예약 뒤 실제 실행에서는 전체 context로 다시 판단합니다.

## 핵심 클래스와 조립 지점

### TurnDaemonLifecycle

`app/game-engine/src/lifecycle/turnDaemonLifecycle.ts`에 있습니다. clock, control queue, hook과 run budget을
조정하며 pause/resume/manual/scheduled run의 상태 전이를 소유합니다.

### DatabaseTurnDaemonLease

`app/game-engine/src/lifecycle/databaseTurnDaemonLease.ts`에 있습니다. profile별 단일 active owner와 fencing을
관리합니다. daemon 계산이 맞아도 lease를 잃었다면 결과를 저장하면 안 됩니다.

### InMemoryTurnWorld

`app/game-engine/src/turn/inMemoryWorld.ts`에 있습니다. entity map, dirty/create/delete set, log, message,
event, checkpoint와 월 변경을 소유합니다. `peekDirtyState()`는 저장할 변경을 보여 주고 성공한 flush 뒤
정리됩니다.

### EngineStateManager

`app/game-engine/src/turn/engineStateManager.ts`에 있습니다. world와 예약 턴 store 같은 mutable participant를
등록하고 계산 단위의 capture/restore/transaction을 제공합니다. PostgreSQL transaction을 대신하지 않고
실패한 계산의 메모리 rollback을 담당합니다.

### InMemoryReservedTurnStore와 ReservedTurnHandler

`reservedTurnStore.ts`는 장수 30칸·국가 12칸 예약 queue를 메모리에 유지합니다.
`reservedTurnHandler.ts`는 명령 loading, constraint, action context, AI fallback, progress/cooldown,
효과·로그와 queue rotation을 연결합니다.

### GeneralActionPipeline과 trigger module

`packages/logic/src/actions/engine.ts`, `triggers/*`는 명령 본체 전후의 특기·아이템·국가 특성 효과를
일정한 우선순위로 적용합니다. 같은 module 목록이라도 실행 순서가 결과와 RNG 소비를 바꿀 수 있습니다.

### WarEngine

`packages/logic/src/war/engine.ts`가 전투 resolution을, `war/actions.ts`와 trigger module이 확장 효과를,
`war/aftermath.ts`가 피해·점령·외교·후속 state를 계산합니다. `che_출병.ts`가 map, unit set, diplomacy,
time, seed와 aftermath를 조립하는 실제 장수 명령 entry입니다.

### GatewayOrchestrator

`app/gateway-api/src/orchestrator/gatewayOrchestrator.ts`가 DB의 profile desired state를 process state에
맞춥니다. `workspaceManager.ts`, `buildRunner.ts`, `seedProfileDatabase.ts`, `pm2ProcessManager.ts`가
commit worktree 준비부터 build, seed, start/stop을 나눕니다.

## 새 명령을 추가할 때

1. 가장 가까운 ref command의 constraint, 실행 순서, RNG, 로그와 DB side effect를 조사합니다.
2. `packages/logic/src/actions/turn/{general,nation}`에 definition과 `commandSpec`을 작성합니다.
3. 해당 `*_TURN_COMMAND_KEYS`와 필요한 `resources/turn-commands` profile에 key를 등록합니다.
4. 인자가 있으면 Zod schema와 `app/game-api/src/turns/commandInput.ts`의 화면 입력 field를 연결합니다.
5. engine action context가 대상 entity·map·unit set·시간·seed를 완전하게 공급하는지 확인합니다.
6. permission/min/full 실패, 성공, 연속 턴, cooldown과 persistence를 테스트합니다.
7. `pnpm docs:generate`로 플레이어 커맨드 목록을 갱신하고 ref 매핑 문서를 함께 수정합니다.
