# 경험자를 위한 시스템 읽기

웹 개발이나 컴퓨터공학 배경이 있고, 이 저장소의 책임과 상태 전이를 빠르게
이해하려는 독자를 위한 안내입니다. 웹 용어가 낯설다면 [기초 안내](./first-steps.md)를
먼저 읽으세요.

## 세 가지 흐름으로 나누기

| 흐름        | 시작과 끝                                                | 핵심 질문                                                 |
| ----------- | -------------------------------------------------------- | --------------------------------------------------------- |
| 사용자 요청 | 브라우저 → API → 저장 또는 엔진 입력 → 응답              | actor, 입력 검증, 중복 요청, 공개 범위는 누가 결정하는가? |
| 게임 진행   | 스케줄 → 장수 턴·월간 처리 → 저장 → 알림                 | 실행 순서, 난수 소비, 실패 후 복원이 보존되는가?          |
| 운영        | 관리자 요청 → 작업 원장 → 빌드·프로세스 전환 → 준비 확인 | 게임 상태와 배포 상태를 혼동하지 않는가?                  |

HTTP 요청 하나가 게임의 한 턴인 것은 아닙니다. 조회, 예약 수정, 즉시 동작,
시간에 따라 실행하는 턴은 서로 다른 수명주기를 가집니다. [전체 구조](../architecture/overview.md)에서
구성요소를 본 뒤 [요청·턴·저장](./request-turn-persistence.md)에서 경계를 읽으세요.

## 조회: 인증한 사람과 보여 줄 대상을 분리합니다

`app/game-api/src/server.ts`, `trpc.ts`, `router.ts`에서 transport와 인증 context,
procedure 조립을 따라갑니다. Gateway 계정과 게임 장수는 같은 식별자가 아닙니다.
클라이언트가 보낸 장수 번호만으로 소유권을 결정하지 않습니다.

구체적인 예는 `app/game-api/src/router/world/index.ts`의 `getCurrentCity`입니다.
자신의 위치, 같은 국가 장수의 위치, 소유 도시, 첩보와 인접 여부를 조합해
정보 공개 수준을 정합니다. 응답에 없는 비밀 값을 프론트엔드에서 가리는 방식이
아닙니다. 데이터 전달 객체(DTO)는 저장 행 전체와 다를 수 있습니다.

## 변경: 입력 원장과 결과의 원자성을 읽습니다

`InputEvent`는 받아들인 변경 요청과 처리 상태를 기록하는 PostgreSQL 모델입니다.
실제 `InputEventTarget` 값은 `API`와 `ENGINE`입니다. 엔진을 설명할 때 쓰는
“daemon”은 프로세스 역할이며 DB enum 값이 아닙니다.

API 쪽 경계는 `app/game-api/src/inputEventBoundary.ts`입니다. request ID만
같다고 모든 요청을 동일시하지 않습니다. actor, event type, payload identity와
상태를 함께 읽고 재시도·충돌·완료 결과 재사용을 구분합니다. 엔진 쪽 입력은
`app/game-api/src/daemon/`에서 따라갑니다.

예약 변경이 저장된 뒤 실제 턴 실행 조건은 다시 달라질 수 있습니다. request
acceptance 검증과 command execution 검증을 하나로 합치지 않습니다. API에서
완료된 변경과 엔진이 메모리에 보유한 세계 사이의 동기화도 확인해야 합니다.

## 엔진: 단일 소유자라도 장애 경계는 필요합니다

`createTurnDaemonRuntime()`의 조립부터 읽으면 loader, registry, AI, 월간 handler,
저장 hook이 연결됩니다. 계산 중 상태는 `InMemoryTurnWorld`, 저장과 실패 복원은
`EngineStateManager`, 실행 순서는 `TurnDaemonLifecycle`에서 추적합니다.

**Lease**는 일정 기간 엔진 소유권을 인정하는 임대입니다. **Fencing token**은
소유권 세대를 구분하여, 멈췄다가 돌아온 과거 프로세스가 새 소유자의 상태를
덮어쓰지 못하게 합니다. “프로세스가 한 개일 것”이라는 운영 가정만으로 대체할 수
없습니다. DB 저장 실패에는 메모리 rollback도 필요합니다.

난수도 입력 상태의 일부입니다. seed가 같아도 분기·정렬·호출 횟수가 바뀌면
이후 결과가 달라집니다. 도메인 계산은 [행동 모듈](../architecture/action-module-protocol.md),
비교 범위는 [차등 검증](../architecture/turn-state-differential-testing.md)을 읽으세요.

## 시간을 하나의 Date로 생각하지 않습니다

게임 진행 시각과 인증 만료·lease 같은 현실 시각은 목적이 다릅니다. 일시정지나
턴 간격 변경이 있다고 로그인 만료와 소유권 heartbeat를 같은 방식으로 옮길 수는
없습니다. [시간 도메인](../architecture/time-domains.md), [게임 시계](../architecture/game-clock.md),
[복구 절차](./game-clock-recovery.md) 순으로 읽으면 계산과 운영 경계가 이어집니다.

## 모듈과 프로세스도 다릅니다

`packages/logic`은 게임 계산을 소유하며 DB·파일·네트워크 I/O를 직접 하지 않습니다.
필요한 외부 동작을 interface인 port로 표현하고, app/infra 쪽 adapter를 주입합니다.
이 구분은 단위 검증과 런타임 저장 경계를 분리하기 위한 것입니다.

`game-api`가 `game-engine`의 일부 loader를 import한다고 API 안에서 턴 데몬을
실행한다는 뜻은 아닙니다. 공개 subpath와 프로세스 entrypoint를 구분하세요.
프론트엔드의 backend router 타입 참조도 서버 실행 코드를 브라우저에 넣는 것과
다릅니다. [패키지 경계](../architecture/package-boundaries.md)는 이 규칙의 기준입니다.

## 다음 조사 위치를 선택하기

- 화면 상태·재접속 문제: frontend store → 조회 응답 → [실시간 변경 원장](../architecture/realtime-change-journal.md)
- 새 게임 규칙: [도메인 조립](./domain-and-classes.md) → 명령·constraint → 엔진 결과 적용·flush
- 설정에 따른 차이: [시나리오 합성](../architecture/scenario-composition.md) → 선택한 resource → 실제 loader
- 계정·배포 문제: [런타임](../architecture/runtime.md) → [릴리스 운영](../release-operations.md)
- 관리자 조사 기록: [플레이 감사 운영](../play-audit-operations.md) → 수집 정책·snapshot·조회

코드 검증은 [테스트 정책](../testing-policy.md)을 따릅니다. 순수 계산 테스트,
실제 DB 저장 검증, 브라우저 검증은 서로 다른 질문에 답합니다. Ref는 계승 규칙의
비교 기준이며, 별도로 결정된 Core 기능까지 예전 구현으로 되돌리는 기준은 아닙니다.
