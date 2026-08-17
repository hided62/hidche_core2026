# 전투 시뮬레이터 브라우저 실행 경계

## 요청과 권위 데이터

`BattleSimulatorView.vue`는 사용자가 편집한 장수·국가·도시 입력을
`battle.prepareSimulation`에 보냅니다. 이 API는 로그인만 요구하며 게임 장수
보유 여부나 input-event transaction에는 의존하지 않습니다. 서버는 현재
`WorldState`에서 다음 값을 읽어 실행 payload에 추가합니다.

- 전체 `UnitSetDefinition`
- 전투 상수와 성벽 병종/병과 ID
- 시나리오 시작 연도와 저장된 `scenarioEffect`
- 고정 seed가 없는 경우 각 반복에 사용할 UUID seed

클라이언트가 같은 이름의 `scenarioEffect`를 보내도 입력 schema가 제거하며,
저장된 효과가 유일한 기준입니다. 1000회 실행 seed를 서버에서 한 번 확정하므로
브라우저와 Node가 동일 payload를 재실행해 전체 결과를 정확히 비교할 수 있습니다.

## 실행 경로

준비된 payload는 module Web Worker에 전달됩니다. Worker는 메시지 handler를 먼저
등록한 뒤 `@sammo-ts/logic`을 lazy-load하고 `processBattleSimJob()`을 실행합니다.
전투 중 UI thread를 점유하지 않으며, 결과만 화면 상태로 돌려줍니다. Worker
bundle은 동적 trait/item module을 한 파일에 묶어 첫 실행의 다수 요청을 피합니다.

공용 processor와 DTO는 `packages/logic/src/battleSimulator/`가 소유합니다.
game-api의 processor/type 파일은 기존 import와 Redis worker 호환을 위한 re-export
경계입니다. 기존 `battle.simulate` → Redis queue → battle-sim worker 경로는 당장
삭제하지 않고 검증 및 호환 fallback으로 유지하지만 기본 화면에서는 호출하지
않습니다.

## RNG와 부작용

- 고정 seed가 있으면 기존 계약대로 한 번만 실행합니다.
- 고정 seed가 없으면 `payload.seeds[index]`를 반복 순서대로 소비합니다.
- 구형 Redis payload처럼 seed 배열이 없을 때만 실행 runtime의
  `crypto.randomUUID()`를 fallback으로 사용합니다.
- 계산은 전달받은 plain object에서 새 도메인 객체를 만들며 DB, Redis, 턴 상태를
  변경하지 않습니다.

## 검증

`battleSimulator.spec.ts`는 production bundle의 실제 Chromium module Worker를
실행합니다. 고정 seed와 서버 발급 seed 1000개 케이스에서 Node processor 결과와
브라우저 Worker의 전체 결과 객체를 비교하고, 기본 UI 경로가
`battle.simulate`/`battle.getSimulation`을 호출하지 않는지 확인합니다.
