# 전투 시뮬레이터 브라우저 실행 경계

## 요청과 권위 데이터

`BattleSimulatorView.vue`는 화면을 열 때 `battle.getSimulatorContext`에서 form
option과 브라우저 Worker의 실행 context를 한 번 함께 받습니다. 이 API는 현재
`WorldState`를 한 번 읽어 다음 서버 권위 값을 제공합니다.

- 전체 `UnitSetDefinition`
- 전투 상수와 성벽 병종/병과 ID
- 시나리오 시작 연도와 저장된 `scenarioEffect`

사용자가 전투 또는 정렬을 시작하면 `battle.prepareSimulation`은 인증과 Zod 입력
검증을 유지하되 `WorldState`를 다시 조회하거나 입력·병종 정의를 response에
반복하지 않습니다. 고정 seed가 없을 때 단일 UUID `seedBase`만 반환합니다. 따라서
전투 시작당 payload 준비를 위한 `WorldState` 추가 조회는 1회에서 0회로 줄고 응답
크기는 반복 횟수와 무관합니다. weight 0 접속·최근 활동 기록 같은 공통 request
lifecycle DB 작업은 기존 호환 계약대로 유지합니다. 브라우저는 로드 시 받은 권위
context와 현재 입력을 합쳐 Worker payload를 만듭니다.

`seedBase`는 반복 번호와 함께 명시적인 직렬화 문자열로 바뀐 뒤 SHA-512 기반
`LiteHashDRBG`의 seed가 됩니다. 1000개 seed 문자열을 전송하지 않으면서도 동일한
payload를 Node와 브라우저에서 재실행하면 전체 결과가 정확히 같습니다. 배포 전에
queue에 들어간 `seeds[]` payload는 각 항목을 먼저 소비해 기존 결과를 보존합니다.

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
- 고정 seed가 없으면 구형 `payload.seeds[index]`, 새
  `payload.seedBase + 반복 번호`, runtime `crypto.randomUUID()` 순서로 seed를
  결정합니다.
- 계산은 전달받은 plain object에서 새 도메인 객체를 만들며 DB, Redis, 턴 상태를
  변경하지 않습니다.

## 검증

`battleSimulator.spec.ts`는 production bundle의 실제 Chromium module Worker를
실행합니다. 고정 seed와 단일 seed base 1000회 케이스에서 Node processor 결과와
브라우저 Worker의 전체 결과 객체를 비교하고, 준비 응답이 128 byte 미만이며 기본
UI 경로가 `battle.simulate`/`battle.getSimulation`을 호출하지 않는지 확인합니다.
