# 플레이 감사 구현 기록과 수집 inventory

[확정 설계](play-audit.md)의 P1~P6를 구현하는 작업 기록이다. 전체 기능은 진행 중이며,
아래 순수 projection은 아직 runtime 수집·DB·API·화면에 연결되지 않았다.

## 현재 구현

`app/game-engine/src/playAudit/snapshot.ts`는 기존 메모리 엔티티에서 명시적으로
허용한 장수·도시 필드와 국가별 자원·숙련 집계를 만든다. 입력 iterable을 각각
한 번 순회하며 국가마다 장수 목록을 다시 검색하지 않는다. 장수의 stats/role/items도
복사하여 이후 개명·이동·장비 변경으로 과거 표본이 변하지 않게 한다. 임의 meta,
triggerState, credential과 전체 world는 복사하지 않는다.

장수 분류는 human(`npcState < 2`), npc(`>= 2`, 5 제외), troopNpc(5)이다.
빈 집단은 합계 0, 평균 null이다. nation 0도 입력에 있으면 일반 국가와 별도로
집계한다. 장수의 국가와 도시 소유국을 일치시키지 않으므로 외국 주둔을 보존한다.

정산은 당월에 실제 관측한 `income/paid`만 별도 입력으로 받는다. 수집 완료 월에
정산이 없으면 0, 도입 월처럼 완전 수집을 증명하지 못한 기간은 null이다.
`prev_income_gold/rice`는 과거 정산 metadata이므로 집계하지 않는다. 정산 원장의
국가 전후값·적용 세율·보정액은 이후 원장 구현에서 보존해야 하며 이 projection만으로
R1을 완료했다고 판단하지 않는다.

## 수집 지점과 쓰기 재검토

기준 Core commit은 `5ac961dfd17738dc4c39e6401f975296f39403a5`이다.
SQL/bytes는 아직 실측하지 않았으며 아래는 현재 소스에서 확인한 연결 지점과 구현 경계다.

| 자료                | 실제 source / 관측할 값                                                                                                    | 구현·비용 결정                                                                                                                             | 남은 검증                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 월별 장수·도시·국가 | `turn/yearbookHandler.ts`의 `beforeMonthChanged`; `playAudit/snapshot.ts`의 필드 allowlist                                 | 메모리 한 순회, 추가 SELECT 없이 수집. 상세는 도시/국가/장수로 페이지 조회 가능한 행에 batch 저장하며 큰 월 JSON 전체를 목록 조회하지 않음 | 월 pending/rollback 연결, migration, DB reload, 종료 부분 표본 |
| 세율 적용 수입·급여 | `turn/incomeHandler.ts`의 `applyIncome`, `incomeValue`, `current`, `next`, `ratio`, 장수별 `pay`; `turn/nationTaxRate.ts`  | 이미 계산한 수치만 관측. 국가 수입과 실제 급여 합계 분리, 과거 metadata 재누적 금지. 정산 원장을 월집계 입력으로 재사용                    | 정수화·최저 자원 보정, 원장/집계 원자 저장, 도입 월 coverage   |
| 월별 내구성         | `turn/inMemoryWorld.ts`의 capture/restore, peek/acknowledge와 pending yearbook; `turn/databaseHooks.ts`의 `persistChanges` | 별도 audit pending을 같은 transaction과 savepoint에 포함. 기존 연감의 장기보존 테이블에 상세 감사를 넣지 않음                              | 실패·중복·재시작, bounded 삭제                                 |
| 기수 identity       | `scenario/scenarioSeeder.ts`의 `install.serverId`, `GameHistory` 충돌 검사                                                 | profile명으로 대체하지 않음. 외부 install 입력을 만드는 지점과 RESET 전체 경로를 추가 추적한 뒤 수집 활성화                                | 신규 identity 생성, 재시도, 기존 설치에 identity 누락 시 처리  |
| 외교                | game-api `router/diplomacy/index.ts`, engine 월간 외교 처리                                                                | 불변 문서는 참조, 갱신되는 내용만 당시 버전 저장. 현재 상태 월복사만으로 사건을 대신하지 않음                                              | 모든 API/engine mutation별 inventory                           |
| NPC 정책            | `turn/worldCommandHandler.ts` → `turn/npcPolicyMutation.ts`                                                                | CAS 성공하고 실제 값이 달라진 경우에만 불변 버전. 무변경/거부는 적용 버전에서 제외                                                         | 초기 버전, actor/직책, 국방 mutation inventory                 |
| 권한                | Gateway `adminCapabilities.ts`, `adminAuth.ts`; game-api `trpc.ts` 인증·제재 middleware                                    | scoped 감사 권한과 공통 계정 추가 권한 분리. `getMyGeneral` 요구 없이 서버에서 검사                                                        | catalog/token/flush/HTTP matrix 전체 연결                      |

월간 실행은 이전 월 snapshot → 달 변경 → 새달 `onMonthChanged` 순서다.
1월 금/7월 쌀 정산은 새로 진입한 월의 흐름으로 누적하고 그 월 마감에 집계한다.
입력 목록은 이미 로드된 world를 사용하며 기존 연감의 로그 SELECT를 새 감사 수집의
필수 입력으로 만들지 않는다.

## 검증 진입점

- 순수 projection: `app/game-engine/test/playAuditSnapshot.test.ts`.
- 월말·저장 경계: `monthlyBoundaryPrePersistence.integration.test.ts`.
- 수입: `monthlySemiAnnualPersistence.integration.test.ts`, `monthlyWarIncomePersistence.integration.test.ts`.
- 원자성: `inputEventAtomicity.test.ts`, `readModelChangeJournalPersistence.integration.test.ts`.

현재 순수 fixture는 분모, 0/null, 소수 수입, 미수집, 외국 주둔, 과거 값의 독립성,
민감 meta 제외와 단일 순회를 검증한다. PostgreSQL SQL count/WAL/실행계획,
권한 HTTP, CHE/HWE Chromium과 전체 source inventory는 아직 남아 있다.
