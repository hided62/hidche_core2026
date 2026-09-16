# 플레이 감사 구현 기록과 수집 inventory

[확정 설계](play-audit.md)의 P1~P6를 구현하는 작업 기록이다. 전체 기능은 진행 중이며,
월별 projection과 runtime 수집·DB transaction 연결을 구현했다. 프로필 권한과 장수·도시 현재/월말 조회 API를 연결했다. 화면과 나머지 조회는 미구현이다.
Push 요청 이후 `feat/play-audit` 전용 worktree에서 계속 구현하며 전체 완료 후 main 통합·push한다.

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

## 월별 저장 구현

`playAudit/collection.ts`가 `beforeMonthChanged`에 이전 월 표본을 queue한다.
`incomeHandler`에서 이미 계산한 수입·급여를 관측하여 작은 국가별 월합계를
world meta에 함께 저장한다. 월중 재시작에도 집계가 유지되며, 수집 도입 월은
불완전으로 표시하고 다음 월부터 완전 수집한다. 기수 identity가 없는 설치에서는
profile명으로 대체하지 않는다. 해당 구간의 API coverage 안내는 아직 구현해야 한다.

`InMemoryTurnWorld`의 capture/restore/peek/acknowledge에 pending 표본을 포함하고
`databaseHooks.persistChanges`에서 gameplay와 같은 transaction으로 저장한다.
`unificationHandler`는 월말과 구분되는 FINAL 표본을 queue한다.
`PlayAuditMonth/Nation/City/General` 네 테이블에 명시적 projection을 보존한다.
국가·도시별 장수 검색 index를 두고 child insert를 200행씩 분할한다. 표본 ID와
payload hash가 같은 재시도는 중복 저장하지 않고, 내용이 다르면 transaction을 실패시킨다.
200은 초기 batch 설정이며 payload bytes/WAL/heap 실측을 통한 최종 선정은 남아 있다.

새 migration은 기존 행을 backfill하지 않는다. 전용 PostgreSQL에서 빈 설치 전체 적용,
기존 49 migration 이후 새 migration 증분 적용, 두 번째 deploy no-op을 검증했다.
업무 데이터와 감사 표본의 transaction rollback, 재시도/충돌, 월 경계의 전월 세율과
world meta reload도 확인했다. 이전 기수 차단/정리, 최종 표본 전체 종료 경로,
정산 전후값의 별도 사건 원장은 아직 남아 있다.

## 프로필 조회·권한 구현

`game-api/router/playAudit`에 `capabilities`, `coverage`, `generals`, `cities`를
추가했다. Gateway는 capability catalog만 제공하며 게임 자료를 대신 조회하지 않는다.
`admin.playAudit.read:<profileName>`는 `che:default`처럼 scenario까지 정확히 비교한다.
기존 resolver와 같은 명시적 전체 grant와 `superuser/admin.superuser`를 허용하고
일반 `admin`, Gateway 조치 감사 권한, 인게임 직책으로 접근을 추론하지 않는다.
공통 계정 권한 판정은 추가 `admin.playAudit.accounts`를 요구한다. 계정 조사 자체는 아직 없다.

정상 bootstrap 첫 계정은 기존 발급 경로의 명시적 `superuser` role을 사용한다.
역할 없는 레거시 첫 계정에 대한 Gateway의 DB 기반 관리자 fallback은 게임 token에
전달되지 않는다. 감사 API는 기존 게임 token의 명시적 role만 신뢰하며 Gateway의
첫 계정 판정을 game DB에서 재현하지 않는다. 해당 계정은 기존 Gateway 권한 관리로
감사 role을 부여할 수 있다. 이 경계는 일반 `admin`의 권한 확대로 해결하지 않는다.

모든 조회는 인증·기존 제재·token profile 검사 후 실행한다. 장수 보유, 접속 가중치,
input_event 쓰기를 요구하지 않는다. 현재 세계 identity와 자료를 같은 RepeatableRead
transaction으로 읽으며 대기는 2초, 실행은 5초로 제한한다. 응답에 `asOf`, tick과
현재 기수 identity를 포함하고 오래된 기수 ID를 client에게 입력받지 않는다.

장수/도시 목록은 기본 50·최대 200, ID cursor로 페이지를 읽는다. `at`이 있으면
현재 기수의 해당 월말/FINAL 표본에서 조회하고 미수집이면 `collected:false`다.
현재 일반 장수와 NPC/부대장 NPC, 국가·도시 필터를 지원한다. 저장·현재 자료 모두
DTO allowlist를 적용해 임의 meta를 응답하지 않는다. `coverage`도 월 header만
cursor 조회하며 원문·장수 목록을 같이 싣지 않는다. 아직 마감 월 캐시는 없다.

실제 Gateway HTTP에서 새 role 부여·범위 확대 거부·flush 호출·암호화 game token의
정확한 scope 전달을 확인했다. 별도 PostgreSQL/Redis와 실제 game HTTP에서는
no-general 허용, 무인증·일반 admin·다른 profile·제재 거부, 200 상한,
과거 이름/미수집, 새 기수 전환 후 이전 표본 차단과 flush 후 401을 확인했다.

`nationSeries`는 국가 1개의 월별 집계만 조회한다. 월/반기 해상도, 기간, 페이지 크기
50 기본/200 최대를 받고 긴 기수는 다음 기간 cursor로 이어 읽는다. 한 번에 읽는
월 header는 최대 1200개(200반기), 국가 집계도 그 범위의 해당 국가만 읽으며
장수·도시 원본이나 전체 trace를 읽지 않는다. 기본 기간은 최근 6개월이고 반기는
1~~6월/7~~12월 경계로 묶는다. 보유·기술·집단 평균은 마지막 수집 표본과 그 시점을
반환하고 수입/급여만 기간 합산한다. 누락·국가 없음·불완전 정산의 흐름은 null,
관측한 정산 없음은 0이다. 기간 일부 요청은 from/to와 complete=false로 표시한다.

장수·도시 상세와 독립 로그, 국가 시계열의 FINAL 별도 표시, UI와 모든 조사 기능은 남았다.

## 수집 지점과 쓰기 재검토

기준 Core commit은 `5ac961dfd17738dc4c39e6401f975296f39403a5`이다.
SQL/bytes는 아직 실측하지 않았으며 아래는 현재 소스에서 확인한 연결 지점과 구현 경계다.

| 자료                | 실제 source / 관측할 값                                                                                                    | 구현·비용 결정                                                                                                                             | 남은 검증                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 월별 장수·도시·국가 | `turn/yearbookHandler.ts`의 `beforeMonthChanged`; `playAudit/snapshot.ts`의 필드 allowlist                                 | 메모리 한 순회, 추가 SELECT 없이 수집. 상세는 도시/국가/장수로 페이지 조회 가능한 행에 batch 저장하며 큰 월 JSON 전체를 목록 조회하지 않음 | 단위/DB 연결 확인; 전체 종료 경로·coverage·비용 gate는 남음   |
| 세율 적용 수입·급여 | `turn/incomeHandler.ts`의 `applyIncome`, `incomeValue`, `current`, `next`, `ratio`, 장수별 `pay`; `turn/nationTaxRate.ts`  | 이미 계산한 수치만 관측. 국가 수입과 실제 급여 합계 분리, 과거 metadata 재누적 금지. 정산 원장을 월집계 입력으로 재사용                    | 정수화·최저 자원 보정, 원장/집계 원자 저장, 도입 월 coverage  |
| 월별 내구성         | `turn/inMemoryWorld.ts`의 capture/restore, peek/acknowledge와 pending yearbook; `turn/databaseHooks.ts`의 `persistChanges` | 별도 audit pending을 같은 transaction과 savepoint에 포함. 기존 연감의 장기보존 테이블에 상세 감사를 넣지 않음                              | 실패·중복·재시작, bounded 삭제                                |
| 기수 identity       | `scenario/scenarioSeeder.ts`의 `install.serverId`, `GameHistory` 충돌 검사                                                 | profile명으로 대체하지 않음. 외부 install 입력을 만드는 지점과 RESET 전체 경로를 추가 추적한 뒤 수집 활성화                                | 신규 identity 생성, 재시도, 기존 설치에 identity 누락 시 처리 |
| 외교                | game-api `router/diplomacy/index.ts`, engine 월간 외교 처리                                                                | 불변 문서는 참조, 갱신되는 내용만 당시 버전 저장. 현재 상태 월복사만으로 사건을 대신하지 않음                                              | 모든 API/engine mutation별 inventory                          |
| NPC 정책            | `turn/worldCommandHandler.ts` → `turn/npcPolicyMutation.ts`                                                                | CAS 성공하고 실제 값이 달라진 경우에만 불변 버전. 무변경/거부는 적용 버전에서 제외                                                         | 초기 버전, actor/직책, 국방 mutation inventory                |
| 권한                | Gateway `adminCapabilities.ts`, `adminAuth.ts`; game-api `trpc.ts` 인증·제재 middleware                                    | scoped 감사 권한과 공통 계정 추가 권한 분리. `getMyGeneral` 요구 없이 서버에서 검사                                                        | catalog/token/flush/HTTP matrix 전체 연결                     |

월간 실행은 이전 월 snapshot → 달 변경 → 새달 `onMonthChanged` 순서다.
1월 금/7월 쌀 정산은 새로 진입한 월의 흐름으로 누적하고 그 월 마감에 집계한다.
입력 목록은 이미 로드된 world를 사용하며 기존 연감의 로그 SELECT를 새 감사 수집의
필수 입력으로 만들지 않는다.

## 검증 진입점

- 순수 projection: `app/game-engine/test/playAuditSnapshot.test.ts`.
- 월말·저장 경계: `monthlyBoundaryPrePersistence.integration.test.ts`.
- 수입: `monthlySemiAnnualPersistence.integration.test.ts`, `monthlyWarIncomePersistence.integration.test.ts`.
- 원자성: `inputEventAtomicity.test.ts`, `readModelChangeJournalPersistence.integration.test.ts`.

순수 fixture는 분모, 0/null, 소수 수입, 미수집, 외국 주둔, 과거 값의 독립성,
민감 meta 제외와 단일 순회를 검증한다. PostgreSQL SQL count/WAL/실행계획,
권한 HTTP, CHE/HWE Chromium과 전체 source inventory는 아직 남아 있다.

월 저장 검증: `playAuditCollection.test.ts`, `playAuditPersistence.integration.test.ts`와
확장한 `monthlyBoundaryPrePersistence.integration.test.ts`. 정확한 명령·결과는
상위 보고서 `2026-09-16-플레이-감사-월별-저장.md`에 기록한다.
