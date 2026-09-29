# 구조 문서 찾아보기

[기초 안내](./first-steps.md)와 [경험자 안내](./system-walkthrough.md)가 학습 경로를,
아래 문서들은 세부 계약을 제공합니다. 목록·벤치마크·과거 계획을 처음부터 모두
읽기보다 현재 질문에 해당하는 문서를 고르세요.

## 현재 구조와 구현 계약

| 질문                                    | 문서                                                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 무엇이 어디서 실행되나요?               | [개요](../architecture/overview.md), [런타임](../architecture/runtime.md)                                                                                    |
| 어느 파일부터 읽나요?                   | [파일 지도](./code-map.md), [패키지 경계](../architecture/package-boundaries.md)                                                                             |
| 한 행동이 어떻게 계산되나요?            | [도메인과 조립](./domain-and-classes.md), [행동 모듈](../architecture/action-module-protocol.md)                                                             |
| 언제 저장되고 실패는 어떻게 처리하나요? | [요청·턴·저장](./request-turn-persistence.md), [API 재시도](../architecture/api-input-event-replay.md)                                                       |
| 시간 정지·재개는 어떻게 되나요?         | [게임 시계](../architecture/game-clock.md), [시간 도메인 목록](../architecture/time-domains.md), [재정렬 계약](../architecture/game-clock-reconciliation.md) |
| 설정을 여러 파일에서 조합하나요?        | [시나리오 합성](../architecture/scenario-composition.md)                                                                                                     |
| 화면에 변경이 어떻게 전달되나요?        | [실시간 변경 원장](../architecture/realtime-change-journal.md)                                                                                               |
| 전투 시뮬레이터가 어디서 계산하나요?    | [브라우저 Worker](../architecture/battle-simulator-browser-worker.md)                                                                                        |
| Ref와 무엇을 비교하나요?                | [차등 검증](../architecture/turn-state-differential-testing.md)                                                                                              |
| TypeScript 버전이 왜 둘인가요?          | [도구 체인 정책](../architecture/typescript-version.md)                                                                                                      |

## 변경 범위를 빠짐없이 확인하는 목록

[엔진 호출 procedure 목록](../architecture/game-api-daemon-procedure-inventory.md)과
[직접 변경·journal 목록](../architecture/game-api-direct-mutation-journal-inventory.md)은
읽기 교재보다 변경 누락을 찾는 검토 자료입니다. 표의 조사 날짜·기준선과 현재
router·검사 코드를 함께 확인하세요. 새 API가 늘어도 과거 조사 숫자가 자동으로
현재 개수가 되지는 않습니다.

시계 참여자 JSON·mutation evidence TSV는 기계가 사용하는 자료입니다. 형식과
검사 계약을 유지하며 해당 기능을 바꿀 때 갱신합니다.

## 측정·계획·운영 자료

| 자료                                                                                | 해석 범위                                                   |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [NPC 메모리 측정](../architecture/npc-lifecycle-memory-profile.md)                  | 지정 fixture의 메모리·생성/사망 부하. 운영 DB 처리량과 다름 |
| [NPC 천통 시간 측정](../architecture/npc-unification-timing-benchmark.md)           | 인메모리 계산 시간. 실제 배포 성능 보장이 아님              |
| [시계 구현 계획 기록](./game-clock-reconciliation-plan.md)                          | 당시 branch의 milestone. 현재 운영 상태의 기준이 아님       |
| [시계 복구](./game-clock-recovery.md)                                               | 상태·원장 확인과 같은 작업 재시도                           |
| [릴리스 운영](../release-operations.md)                                             | 실제 배포 작업과 준비 확인                                  |
| [관리자 콘솔](../admin-console.md), [플레이 감사 운영](../play-audit-operations.md) | 관리자 권한과 현재 조사 기능                                |
| [테스트 정책](../testing-policy.md)                                                 | 실행 준비·검증 종류·skip의 해석                             |
| [프론트엔드 CSS 구조](../frontend-css-architecture.md)                              | 화면 스타일의 소유권과 배치 계약                            |

기능 설계의 목표, 코드에 있는 구현, 테스트로 확인한 범위, 실제 배포 상태는 서로
다릅니다. 문서의 “완료”는 함께 적힌 날짜와 검증 범위로 해석하세요.
