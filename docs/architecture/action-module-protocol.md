# 장수 행동 모듈 프로토콜

`packages/logic/src/actionModules/`는 core2026 실행 경계를 타입으로
표현합니다. 계산
hook, 우선순위 trigger, 의미 이벤트는 서로 다른 실행 계약입니다.

## 세 가지 실행 계약

| 계약             | core2026 경계                                           | 실행 의미                                                         |
| ---------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| 순차 계산 hook   | `GeneralActionPipeline`                                 | ref의 `General::getActionList()` 순서대로 값을 fold합니다.        |
| 우선순위 trigger | `triggers/core.ts`, `triggers/general.ts`, 전투 trigger | priority, 삽입 순서와 unique ID 중복 제거를 보존한 뒤 fire합니다. |
| 의미 이벤트      | `actionModules/events.ts`                               | 닫힌 이벤트별 payload와 context를 동기적으로 순회합니다.          |

priority trigger를 의미 이벤트로 바꾸거나, 의미 이벤트를 `TriggerCaller`로
감싸지 않습니다. 두 경로는 정렬과 중복 제거 의미가 다릅니다.

## ref 순서와 소유권

정기턴은 `loadActionModuleBundle()`에서, 전투 시뮬레이터는 같은
`createRefOrderedActionStack()` factory에서 제품용 action stack을
조립합니다. 순서는 다음과 같습니다.

1. 국가 타입
2. 관직
3. 내정 특기
4. 전투 특기
5. 성격
6. 병종
7. 계승 버프
8. 시나리오 효과
9. 아이템

`RefOrderedActionStack`의 readonly unique-symbol brand는 임의 배열을 제품용
표준 stack으로 오인하지 않게 하는 shadow type입니다. 모든 slot을 명시하는
factory에서만 이 brand를 만들 수 있으며, 예약턴 runtime env에도 spread하지
않고 그대로 전달합니다. 현재 시나리오 효과 runtime module은 이식되지 않아
해당 slot은 명시적으로 `null`입니다. 따라서 이 brand는 순서와 slot 소유권을
증명하며, 시나리오 효과 구현 완료를 뜻하지 않습니다.

## 닫힌 의미 이벤트

`GeneralActionEventPayloadMap`이 허용하는 이벤트와 payload의 단일
source입니다. 현재 이벤트는 장비 구매·판매, 계략 성공, 도시 점령입니다.

- 이벤트는 `createGeneralActionEvent()`만 생성합니다. private
  unique-symbol brand 때문에 객체 literal로 위조할 수 없습니다.
- `GeneralActionEventContext<K>`가 이벤트별 필수 능력을 정합니다. 예를 들어
  판매는 RNG와 연월, 도시 점령은 RNG가 없으면 compile되지 않습니다.
- leaf module은 `eventHandlers`에 처리하는 이벤트 key만 선언합니다.
- trait, 병종과 item catalog 같은 합성 router만 내부 `handleEvent`를
  구현합니다. 두 capability는 `never`를 사용한 상호 배타적 union이라 한
  module에서 동시에 선언할 수 없습니다.
- 새 문자열 action name, `phase`, `aux: Record<string, unknown>`를 범용
  우회로로 추가하지 않습니다.

새 이벤트를 추가할 때는 payload map과 context 조건을 먼저 추가한 뒤,
실제 producer와 필요한 handler만 연결합니다. 존재하지 않는 handler
종류를 interface에 선행 추가하지 않습니다.

## 저장과 RNG 경계

의미 이벤트는 producer가 가진 객체를 동기적으로 수정합니다. producer는
이벤트 전후의 ref mutation 순서를 유지한 뒤 effect/flush
경계에 결과를 전달합니다.

- 장비 판매는 판매 대금 반영 → 판매 이벤트 → 슬롯 제거 순서입니다.
- 도기 판매의 2분기는 ref `choice([gold, rice])`와 같이 index 0이 금,
  index 1이 쌀입니다.
- 도시 점령은 점령 도시의 수비국 장수 전원을 입력 순서로 호출한 뒤 국가
  멸망 손실을 계산합니다. 이벤트 handler와 멸망 손실은 같은
  `ConquerCity` RNG 객체를 이어 씁니다.
- 계략 성공 아이템 소비는 `consumeOnStrategySuccess`라는 명시 capability로
  선언하며 다른 임의 action 이름과 공유하지 않습니다.

## 검증 경계

`actionModuleEvents.test.ts`는 표준 순서, 이벤트 brand와 잘못된 context의
compile 실패를 검증합니다. `itemActionEvents.test.ts`는 도기 분기와
연차 경계, 충차·환약 초기 충전, 계략 성공 소비를 검증합니다.
`warAftermath.test.ts`는 도시 점령 대상과 공유 RNG 소비 순서를 검증합니다.
ref↔core 실제 명령 차등은
`turnCommandGeneralMatrix.integration.test.ts`의 도기 판매 fixture가
담당합니다.
