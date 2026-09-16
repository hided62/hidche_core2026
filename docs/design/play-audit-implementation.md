# 플레이 감사 구현 기록과 수집 inventory

[확정 설계](play-audit.md)의 P1~P6를 구현하는 작업 기록이다. 전체 기능은 진행 중이며,
월별 projection과 runtime 수집·DB transaction 연결을 구현했다. 프로필 권한과 장수·도시 현재/월말 조회 API,
국가 월/반기 시계열과 `/play-audit` 기본 조회 화면을 연결했다. 정책 이력 저장과 목록/상세 조회, 초기 기준 내구화를 추가했으며 전체 종료 경계, 외교, NPC trace와 조사 도구는 남아 있다.
Push 요청 이후 `feat/play-audit` 전용 worktree에서 계속 구현하며 전체 완료 후 main 통합·push한다.

## 현재 구현

### 기본 조회 화면

프로필 game frontend의 `/play-audit`는 장수가 없는 감사 계정도 직접 접근한다.
`capabilities`가 허용된 뒤 coverage와 국가 목록을 읽고 선택한 조회만 요청한다.
권한 거부 시 다른 감사 자료를 미리 가져오지 않는다. URL에 탭·국가·도시·표본 월·기간을
보존하며 도시의 주둔 장수 연결은 당시 월을 유지하고 국가 필터를 해제한다.
장수·도시 목록은 50개씩 명시적으로 더 읽는다. 느린 이전 응답은 후속 조회를 덮지 않는다.

국가 목록은 현재 또는 한 월의 이름/ID/color만 반환한다. 현재 목록은 해당 세 필드만
SELECT하며 과거 목록은 한 표본의 국가 JSON을 51행까지 읽고 allowlist projection한다.
기본 50·최대 200과 ID cursor를 사용하고 기수 전체의 국가를 DISTINCT 스캔하지 않는다.
멸망국은 해당 월 기준 목록으로 선택한다. 국가 시계열의 기본 범위는 최근 6개월이며
지표·집단 전환은 이미 받은 집계에서 계산해 추가 요청을 하지 않는다.

PanelCard, legacy-button, legacy-sort-select를 재사용한다. 새 차트 라이브러리 없이
표의 막대와 수치를 함께 표시한다. stock 마지막 표본 월, 월별 수집 여부·국가 존재·정산
완전성을 펼쳐볼 수 있고 null은 `자료 없음`이다. 국가 보유 금쌀/기술/세율,
수입·지급, 집단 인원·보유 총량/평균·5병종 평균 숙련 지표를 제공한다.

이 화면은 Core 신규 UX다. 최대 폭 1200px, 390px 모바일에서 문서 가로 넘침 없음,
넓은 표만 내부 수평 스크롤, 공통 14px 기본 typography와 명시적 focus/disabled가 계약이다.
월말/FINAL 장수·도시 projection을 보여주지만 지도,
전투 통계, 검색·정렬은 후속 구현으로 남는다. 로그와 현재 예약 조회는 아래 구현을 따른다.
따라서 기본 화면 추가만으로 R1~R3/P2를 완료 처리하지 않는다.

Gateway 서버 관리의 프로필 카드에는 `admin.playAudit.read` capability의 해당 전체
profile scope가 있을 때만 진입 버튼을 표시한다. 기존 `auth.issueGameSession` 발급과
game session transfer를 사용하고 Gateway가 감사 데이터를 대신 읽지 않는다.
기존 로비의 URL 구성/세션 전달을 `utils/gameEntry.ts`로 추출해 공유한다.
새 감사 진입은 동일 origin의 sessionStorage 전달만 허용하며, 실패하면 현재 화면에
재시도 가능한 오류를 표시한다. 기존 로비의 query fallback은 동작 변경 없이 유지하되
새 감사 경로에는 적용하지 않는다. 서로 다른 origin의 관리자 진입은 지원하지 않는다.

`nationSnapshot`은 같은 권한/기수 범위에서 한 월말 또는 FINAL header와 그 국가의
복합 PK 행 하나만 읽는다. 최종 국가 화면은 이 API만 사용하며 월말 시계열을 동시에
요청하지 않는다. 국가 보유량·집단 통계와 해당 월 수집 시점까지 관측한 정산을 표시한다.
FINAL의 관측값을 월말/반기 합계에 추가하지 않는다. 표본 없음과 해당 국가 없음도 구분한다.
최종 수집 자체의 모든 게임 종료 경로 연결은 P1의 남은 lifecycle 검증을 따른다.

`generalDetail/cityDetail`은 선택 엔티티와 관련 국가·도시의 PK만 조회한다.
현재/과거 DTO를 분리하고 과거 이름·위치 이름도 같은 표본에서 읽는다. 현재 행으로
과거의 누락을 메우지 않는다. 목록에서 이름을 누르면 URL의 `general/cityRecord`로
상세를 연다. 상세 열기/닫기는 목록 조회 조건에서 제외하여 목록을 다시 읽지 않는다.
도시 상세의 주둔 연결도 적용된 월을 유지한다.

`generalTurns`는 현재 예약 전용 별도 조회이며 과거 시점을 입력받지 않는다.
상세의 버튼을 눌렀을 때만 기본50/최대200, `turnIdx` cursor로 읽는다. 정상30 slot을
넘은 잘못된 값도 숨기지 않는다. 인자는 읽기 전용 `argumentJson` 텍스트로 반환한다.
범용 JSON의 재귀 타입을 UI에 그대로 전달하지 않으면서 값은 생략하지 않는다.
예약 조회 실패는 장수 상세를 지우지 않는다. 과거 예약 변경은 이후 사건 원장이 담당하며
현재 큐에서 복원한 것처럼 표시하지 않는다. 전투 통계와 지도·검색/정렬은 남는다.

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

### 실제 초기 달력의 조회 범위

감사 응답의 `startYear/startMonth`는 유효한 `world.meta.initYear/initMonth`를 우선한다.
동기화 개방은 `scenarioMeta.startYear`의 전년도에 시작할 수 있으므로 시나리오 규칙 연도를
조회 하한으로 고정하지 않는다. 두 metadata가 없거나 유효하지 않으면 시나리오 시작 연도와
현재 연도 중 이른 연도의 1월을 호환 fallback으로 사용한다. 이것은 최초 수집 증거가 아니며
자료 존재는 월 header로 별도 확인한다. 불변 기수 식별자 필터도 계속 적용한다.

월말/최종 상세, 장수 로그, 국가 시계열의 범위 검증과 기본 최근 6개월 기간은 같은 연월
하한을 사용한다. UI도 시작 연도의 최소 월과 현재 연도의 최대 월을 제한한다. 이미 읽던
world metadata로 계산하며 추가 DB 조회·쓰기나 시나리오/AI 규칙 변경은 없다.
PREOPEN은 wall-clock 대기 상태이며, 검증하는 것은 공식 개방 때의 논리 게임 달력이다.

## 외교 문서 상태 이벤트 저장 기반

`diplomacy.sendLetter/respondLetter/rollbackLetter/destroyLetter`의 기존 입력 원장
transaction에 제안·교체·승인·거절·회수·파기 요청·파기를 연결했다. 기존 SELECT와
UPDATE 반환값에서 변경 전후 allowlist를 만들고, 원장 잠금 SELECT의 sequence를
재사용한다. 감사 실패는 문서/알림과 함께 rollback하며 실패한 입력 원장은 남는다.
성공 재요청은 기존 결과를 반환해 이벤트를 중복 저장하지 않는다.

- migration55의 `play_audit_diplomacy_event`는 기수, 방향 있는 국가쌍, 실행/로컬 순번,
  DB sequence, 처리 당시 달력/tick/revision, actor와 작은 상태 전후 값을 저장한다.
  DB sequence와 입력 접수 sequence는 다른 개념이며 숫자 간격은 허용한다.
- 본문은 기존 `diplomacy_letter`를 ID/hash로 참조한다. 작성 본문·작성자·작성 시각·
  국가쌍·prevId의 UPDATE를 DB trigger로 거부하고, 기존 새 문서 작성 경로를 유지한다.
  상태·서명·aux 갱신은 허용한다. 기존 문서의 과거 상태를 소급 생성하지 않는다.
- 문서 쓰기 요청당 작은 world/clock SELECT 1회, RUNNING realtime이면 readiness
  SELECT 1회, 이벤트 200개당 bulk INSERT와 ID/hash 확인 SELECT 각 1회가 추가된다.
  원문 SELECT와 본문 복사는 추가하지 않는다. 기존 알림 wall time 조회와 결합해
  줄일 여지는 남으며, SQL/WAL 비용 gate의 실측 완료를 뜻하지 않는다.
- reset 뒤 이전 이벤트는 기존 retention 경로에서 ID 최대200개씩 정리한다.
  과거 tick/revision은 시계 이동 대상이 아닌 KEEP 이력으로 등록한다.
- 기존 `rollbackLetter`는 회수다. 현재 복구 mutation은 없어 복구 이력을 꾸며내지 않는다.

실제 PostgreSQL에서 문서 8개 시나리오, unit 7건, retention 4건, 신규55개/
증분54→55/재실행 migration을 검증했다. 외교 상태의 API 즉시 응답·엔진 월간/턴
변경, 도입 당시 기준, 감사 조회 API/UI는 후속 구현이며 **R4 전체 완료가 아니다**.
일반 외교 알림은 WALL_TIME이고 제의 처리와 tombstone은 구분한다. 오래된 알림
테스트의 게임 tick 가정을 현행 envelope 계약에 맞췄다.

### 즉시 외교 응답의 관계 전이

`messages.respond`의 별도 `executeInputEvent` 경로에도 인증된 입력 context를 전달한다.
불가침 체결·불가침 파기·종전 수락에서 이미 잠근 양방향 관계 행을 before로 사용하고,
각 diplomacy UPDATE의 반환값을 after로 기록한다. state/term/dead/isDead/isShowing만
투영하며 임의 meta를 복사하지 않는다. 같은 값의 재적용은 상태 전이에 포함하지 않는다.

추가 상태/clock/입력 SELECT는 없고, 두 방향의 전이를 한 bulk INSERT와 ID/hash
확인 SELECT로 저장한다. 원장·관계·로그·알림과 같은 transaction이다. API commit 뒤
엔진 메모리 동기화가 실패해도 재요청은 원장 결과를 재사용해 감사 이력을 중복 쓰지
않는다. 엔진 동기화에서 같은 사건을 다시 수집하지 않는다.

실제 PG에서 세 응답의 양방향 before/after, 처리 순서, RESOLVED 제의 상태와 동기화
실패 후 재요청을 검증했다. 엔진 transport만 fixture 응답이므로 엔진 runtime 동기화
완료의 증거는 아니다. 거절/실패/무변경은 관계 전이와 구분할 시도 원장 구현에 남겼다.
엔진 턴 변화와 기준 수집, 외교 조회 화면은 아직 남았다.

### 엔진 월간 외교 전이

`createMonthlyDiplomacyHandler`가 이미 가진 before/after에서 state/term/dead의 실제
변화만 directed event로 모은다. 사건 순서는 국가 ID 쌍으로 고정하고 실행 identity는
기수/달력/clock revision을 사용한다. 자연 월간 실행에 actor나 입력 원장 ID를 만들지
않는다. 기본 TRADE matrix 보충 자체와 무변경 행은 기록하지 않는다.

pending queue는 world capture/restore/peek/ack에 포함하고, 기존 fenced DB transaction
안에서 bulk200 INSERT와 hash 확인을 수행한다. 실패 시 상태와 이력은 함께 rollback,
queue는 재시도까지 유지하며 commit 후에만 제거한다. 기존 계산/RNG/로그 순서는
그대로고 추가 상태 SELECT는 없다. 기존 before 목록을 정렬한 메모리 사본만 추가한다.

실제 PG에서 개전·기간 감소·사상자 처리·불가침 만료·종전의 기존 결과/로그를 유지하며,
메모리 checkpoint 복구, 감사 INSERT 실패 rollback, 재시도/중복 방지를 검증했다.
엔진 개별 명령 전이와 초기 외교 기준, 조회 API/UI 및 전체 비용 실측은 남았다.

## NPC·국방 정책 버전 저장 기반

`PlayAuditPolicy`는 현재 기수/국가/영역별 불변 revision과 이전 버전 ID를 보존한다.
영역은 국가 NPC 값, 국가 NPC 우선순위, 장수 NPC 우선순위, 국방(`war/scout/secretlimit`)이다.
공지·권유문·세율·지급률 등 나머지 국가 설정의 사건 기록은 자원/행위 원장 연결에서 남아 있다.
NPC 설정은 기존 allowlist의 저장 값만 복사하며 setter/time이나 임의 nation metadata를
복사하지 않는다. 누락(null)은 설정 상속이다. 개인별·server별 보정이 적용된 최종 AI 값인
것처럼 표시하지 않으며, 해당 관측값과 코드 버전은 이후 NPC trace가 담당한다.

daemon world 구성과 신규 `addNation`에서 네 기준 버전을 pending에 담는다. 기존 정상
포인터가 있으면 재시작 때 재생성하지 않는다. 포인터 ID는 기수·국가·영역·revision으로
검증하므로 다른 국가 metadata를 복사해도 기존 국가 이력을 이어받지 않는다.
DB runtime의 기준 수집은 clock recovery/synchronization 뒤 수행하고 readiness 전에
startup flush로 내구화한다. PREOPEN에서 명령이 없어도 정책 기준을 저장한다.

기존 NPC mutation의 검증·CAS와 국가 설정의 권한·횟수 제한을 통과한 뒤 변경 전후를 비교한다.
setter/time 변경과 동일 설정 저장에는 새 적용 버전을 만들지 않는다. 기존 CAS token 갱신,
write와 성공 응답 계약은 유지한다. 거부된 입력은 정책 적용 이력에 넣지 않으며 기존
input_event의 ok:false와 구분한다. OBSERVED_GAP은 저장된 포인터와 현재 설정 불일치를
발견했을 때의 기준 재관측이다. 실제 변경 전 값/actor/시각을 추정하지 않는다.

pending 정책·최신 포인터·전역 감사 ordinal은 world capture/restore와 acknowledgement에
포함한다. 정책 row, nation meta, world meta와 input_event 완료는 같은 transaction이다.
기존 input_event fence SELECT에 sequence/actor_user_id만 추가하여 추가 요청 조회를 피한다.
수행자 ID가 명령과 일치하지 않거나 요청이 있는데 input context가 없으면 저장을 거부한다.
actor는 당시 user/general/name/nation/officer/npc/permission만 보존하며 createdAt은 DB wall time이다.
향후 수뇌 DTO는 nation 소유권과 기존 resolver를 적용하고 userId/inputSequence/requestId 및
관리자 진단을 제외해야 한다. 수뇌 직책/가입 전 열람 정책·화면은 확정 설계대로 후속 범위다.

ID와 payload hash로 재시도를 검증한다.200행마다 createMany와 ID/hash 확인 SELECT를 사용하며
본문 전체를 재조회하지 않는다. 최초 기준은 국가당4행, 적용 변경은 해당 영역1행이다.
세계 전체 정책이나 장수별 정책을 매 턴 복사하지 않는다. 기존 NPC 기본값은 별도 pure module로
옮겨 mutation과 audit allowlist가 공유하고 기존 export 경로는 유지한다.
정책 schema version은1이며 migration은 기존 이력을 backfill하지 않는다. 이미 적용한 migration
checksum은 수정하지 않고 schema_version 필드는 별도 증분 migration으로 추가했다.

정리 worker는 이전 기수 정책 ID도 최대200개씩 삭제한다. policy version의 self-reference는
삭제 FK로 강제하지 않아 과거 비공개 기수를 key batch로 정리할 수 있다. 현재 기수 포인터는
같은 transaction으로 저장하고 조회 시 항상 현재 기수 범위를 검사해야 한다.
NPC 결정의 정책 참조와 거부/무변경 시도의 사건 연결은 아직 남았다.

`policyHistory`는 국가/영역/기간을 필수로 받고 기본50·최대200개의 버전 요약을
revision 내림차순 cursor로 반환한다. 목록에서는 전후 정책 본문과 요청 자료를 읽지 않는다.
`policyVersion`은 선택 ID 한 건의 현재 기수 범위를 검사하고 전후 설정·당시 직책·입력
sequence를 반환한다. BigInt는 문자열로 보존하며 목록/상세 모두 계정 ID를 노출하지 않는다.
world identity와 자료는 기존 RepeatableRead/timeout 계약을 공유한다. 별도 count/쓰기나
현재 정책을 읽어 과거를 채우는 조회는 없다. 기존 국가/영역/revision 및 기간 index를
재사용한다. 반환 상한은 DB scan 상한의 증명이 아니며 실행계획/부하 측정은 P6에 남는다.

`projectPolicyConfiguration`은 수뇌 공개에 재사용할 전후 값·당시 소속/직책만 남기고
계정·요청·tick/ordinal·관리자 진단을 제외한다. 현행 endpoint는 관리자 전용이다.
향후 자국 API에서 기존 국가 resolver의 인가를 별도 적용해야 하며 이 projection 자체가
인가를 대신하지 않는다. 수뇌용 route나 직책 권한을 이번 변경에서 새로 열지 않았다.

프로필 `/play-audit`의 정책 화면은 적용한 국가/영역/기간만 읽고, 상세 열기/이전 버전
이동/실패 재시도가 목록과 국가 목록을 다시 읽지 않도록 한다. URL로 선택 버전을 보존한다.
입력 중인 필터는 조회 버튼을 누르기 전 SQL 요청을 발생시키지 않는다. 최초 관측,
실제 변경, 관측 누락 이후 기준과 자료 없음의 의미를 구분한다. 기존 PanelCard와 제어
스타일을 사용하고 NPC 설정 화면의 한국어 필드 이름을 따른다. 값은 텍스트로 출력한다.

## 초기 도입 기준과 즉시 내구성

`initializeAuditCollection`은 기수별 첫 관측에서만 INITIAL 표본과 world의
`playAuditCollection` 시작 좌표/실제 관측 시각을 pending에 담는다. INITIAL은 기존
국가·도시·장수 projection과 batch 저장을 재사용하며 월말과 FINAL을 대체하지 않는다.
새 migration은 INITIAL kind를 허용하고 부분 unique index로 기수당 한 행만 허용한다.
재시작은 저장된 marker를 사용하며 초기 상태를 현재 값으로 갱신하지 않는다.

runtime은 기존 lease 획득·world load·clock 복구/동기화 후 정책/상태 기준을 수집한다.
기존 fenced persistence로 기준과 국가 포인터/world marker를 함께 commit한 뒤에만
clockReady를 공개한다. 별도 input_event를 만들지 않는다. 초기 저장 실패는 기존 startup
오류 경로로 lease/연결을 정리하고 준비 완료를 알리지 않는다. 정상 재시작은 pending이
없으면 추가 flush가 없다. pending 확인은 배열 길이만 검사하여 큰 snapshot을 복사하지 않는다.

초기 수집은 이미 로드된 world를 각 한 번 순회한다. 추가 전체 엔티티 SELECT 없이 기존
header/child batch transaction을 한 번 수행한다. readiness 전에 저장하므로 큰 기수의
startup latency/WAL/heap 비용은 P6에서 함께 측정해야 한다. 값이나 표본을 생략하는
방식으로 비용을 줄이지 않는다. 초기 read-model receipt는 첫 실제 명령에 섞지 않는다.

조회 API의 표본 kind와 coverage cursor에 INITIAL을 포함한다. 현재 world meta에서
`collectionStart`만 allowlist projection하여 추가 DB 조회 없이 시작 시점을 표시한다.
국가·장수·도시의 수집 시작 기준 조회는 같은 snapshot identity를 유지하며 국가 시계열에는
MONTH_END만 포함한다. INITIAL의 흐름을 정규 월/반기 합계에 더하지 않는다.
시나리오 개방 달력과 실제 상세 수집 시작은 서로 다른 값이다.

## 이전 기수 월별 표본 정리

새 daemon runtime은 실제 `serverId`를 고정해 이전 월별 감사 표본 정리를 시작한다.
기수 변경 직후 조회 차단은 기존 API identity 필터가 담당한다. 정리는 gameplay flush와
별도 transaction이며, seeder와 같은 schema advisory lock을 try-lock한 뒤 DB의 현재
identity를 재확인한다. 이전 runtime/누락 identity는 정리하지 않는다. 부모 표본의 row lock으로
child 추가와 빈 부모 삭제의 경쟁을 막고, 장수→도시→국가 child의 PK만 최대200개 읽어
그 행을 삭제한다. 모두 빈 뒤 header1개를 삭제하여 대량 cascade를 피한다.

batch는 SQL statement2초/transaction5초 상한이고 성공 후1초, lock경합/오류 후30초에
재시도한다. 동시에 두 batch를 수행하지 않는다. 기수가 바뀌거나 이전 자료가 없으면
worker가 끝나므로 평상시 idle polling은 없다. 프로세스 재기동은 DB의 남은 key부터 다시
시작한다. 종료는 진행 중 transaction을 기다린 뒤 connector를 닫는다. 원문 DB 오류 대신
고정 경고를 운영 로그에 남기며 정리 실패로 gameplay 결과를 실패 처리하지 않는다.

현재 정리 대상은 구현된 PlayAuditMonth/General/City/Nation과 PlayAuditPolicy다. 기존 연감/계정 원장과
LogEntry 보존 정책은 바꾸지 않는다. 외교·정책·trace 테이블을 추가할 때 같은 수명주기와
key 단위 삭제를 연결해야 한다. Gateway RESET의 기존 process중지→seed commit→재기동
경로에서 시작한다. 예약 상태에서는 runtime이 없을 수 있어 seed commit 직후에도 batch
하나를 시도한다. 실패한 seed에는 정리가 실행되지 않고, 정리 실패는 seed 결과의 warning으로
남긴 뒤 이후 runtime이 재시도한다. RESERVED에서 남은 물리 정리는 PREOPEN 기동까지
연기되지만 새 identity로의 조회 차단은 즉시 적용된다. 취소 CANCELLED는 기존 정책상 API도
중지되므로 관리자 감사 접근과 최종 표본 수집의 별도 lifecycle 보완은 아직 남는다.

검증 fixture는 `PLAY_AUDIT_RETENTION_DATABASE_URL`의 `_retention_fixture` 전용 schema를
요구한다. schema에 정식 migration을 적용한 뒤 `playAuditRetention.integration.test.ts`를
실행한다. 삭제·trigger rollback fixture이므로 다른 통합 suite의 DB를 공유하지 않는다.
conditional registry는 external_fixture로 분류하며 일반 core DB URL에 자동 연결하지 않는다.
실제 DB에서401장수/201도시/1국가를 여러 batch로 정리하고 현재 기수를 보존했다.
추가 real daemon startup 검증은 기존 selectPool integration에 연결했다.

## 기존 장수 로그의 기수별 조회

`generalLogs`는 기존 `LogEntry`에서 현재 기수와 장수·기록 종류를 제한하고
ID 역순 cursor로 기본 50/최대 200행을 조회한다. 네 종류는 열전/개인 행동/
전투 결과/전투 상세다. 현재 장수가 사망했어도 보존된 로그를 조회할 수 있다.
과거 표본에서 열면 해당 게임 월 전체 기록을 조회하며 표본 순간까지의 기록인 것처럼
표시하지 않는다. `createdAt`은 게임 논리 시각일 수 있어 설치 wall time으로 필터하지 않는다.

별도 로그 복제 테이블 대신 nullable `LogEntry.serverId`를 추가했다. 엔진 공통 로그,
천통 내기 결과, 장수 선택/재선택, 외교 메시지 응답의 기존 저장 transaction에서
world meta의 실제 기수 ID를 함께 쓴다. 엔진과 장수 선택은 메모리에 있는 값을 사용한다.
외교 응답은 기존 world SELECT에 meta 필드를 추가한다(조회 횟수는 동일하지만 읽는 bytes는 증가).
별도 world SELECT나 로그 INSERT는 없다.
공백/누락 identity를 profile명으로 대신하지 않는다. 기존 및 레거시 이관 로그는
기수 귀속을 증명하지 못하므로 null 그대로 두며 API에서 제외하고 화면에 자료 범위를 표시한다.
설치 시 전체 backfill이나 로그 재복사는 수행하지 않는다.

현재 `(generalId, category, id)` index를 재사용한다. serverId/월은 잔여 조건이므로
오랜 기수의 희소한 월 조회에는 더 많은 index 행을 검사할 수 있다. 실행 5초 상한은
응답 실패를 자료 없음으로 숨기지 않는다. 큰 fixture의 EXPLAIN/지연 측정 후 복합 index의
추가 쓰기 비용과 비교하는 P6 gate는 남으며, 행 반환 상한을 스캔량 상한으로 보고하지 않는다.

`GeneralRecordPanels`에 선택 종류와 독립 오류/재시도 표시를 추가해 기존 표시를 재사용한다.
상세에서 버튼을 눌러야 로그를 읽고 종류별로 받은 페이지를 재사용한다. 엔티티/월이
바뀌면 캐시를 비우고 늦은 응답을 버린다. 동등한 월 객체가 재생성되어도 장수/도시 상세를
재조회하지 않도록 감시 대상을 ID·연·월·종류의 원시값으로 제한한다. 로그 원문은
기존 `formatLog` 허용 목록을 거쳐 렌더링한다.

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

장수·도시 상세와 독립 로그, FINAL 별도 표시와 정책 조회는 기본 화면에 연결했다. 외교·NPC 결정과 조사 기능은 남았다.

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
| NPC 정책            | `turn/worldCommandHandler.ts` → `turn/npcPolicyMutation.ts`                                                                | CAS 성공하고 실제 값이 달라진 경우에만 불변 버전. 무변경/거부는 적용 버전에서 제외                                                         | NPC 결정의 버전 참조, 거부/무변경 시도 원장                |
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
