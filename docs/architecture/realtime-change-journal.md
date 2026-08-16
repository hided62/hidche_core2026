# 실시간 read-model change journal과 revision-first 조회 설계

## 목적

메인 화면의 실시간 갱신이 실제 화면 변화가 없는 경우에도 viewer별 PostgreSQL
read model을 다시 구성한 뒤 `unchanged`를 판정하는 비용을 제거한다. 동시에 다음
운영 상한을 만족하는 구조와 재현 가능한 검증 절차를 제공한다.

- 실제 사용자 최대 약 300명
- NPC 최대 약 900명
- 5분 턴 서버
- 공백지 점령기처럼 지도·기록 변화가 집중되는 구간
- 300명이 모두 로그인하고 메인 화면 자동 갱신을 켠 상태
- 현재 `dev-sam2026`과 동급인 AMD Ryzen 7 5800X 8C/16T 호스트
- runtime container 제한 4 CPU, 8 GiB, 256 PID

이 문서는 성능을 위해 전투 결과, 명령 판정·RNG 소비 순서, DB mutation 순서,
권한과 공개 SSE redaction을 바꾸는 것을 허용하지 않는다. 성능 합격은 source
추산이 아니라 아래 workload를 실제 PostgreSQL·Redis·HTTP/SSE 경계에서 실행한
결과로 판정한다.

## 현재 상태와 병목

현재 turn daemon은 `InMemoryTurnWorld`의 dirty general/city/nation 후보를 daemon
수명의 in-memory baseline과 비교한다. `databaseHooks`가 `content`, `map`,
`contacts`, `frontStatus`, `lobby` canonical projection을 나누어 비교한 뒤
`RealtimeReadModelChanges`를 만든다. 이 단계는 dirty entity만 직렬화하며 일반
entity 판정을 위해 DB를 다시 읽지 않는다.

DB transaction 안에서 직접 생성되는 `log_entry`는 별도다. `databaseHooks`는
transaction 진입 시 log ID floor를 잡고 flush 뒤 실제 저장된 화면 노출 row를
조회하여 개인 기록, 장수 동향과 중원 정세 flag를 보완한다. 이 조회는 direct
Prisma writer와 rollback을 정확히 포괄하기 위해 유지한다.

주요 낭비는 browser가 invalidation을 받은 뒤다.

```text
readModelInvalidated
  -> frontend가 모든 non-empty plan에 context=true를 강제
  -> access-limit gate가 general/world/access-log를 조회
  -> getGeneralContext()가 viewer context를 3~15 SQL로 재구성
  -> canonical JSON/hash 뒤에야 unchanged 판정
  -> map/records/front-status 등 선택 slice를 추가 조회
```

보통 소속 장수의 context-only 자동 갱신은 access gate를 포함해 약 13 SQL이고,
command table까지 포함하면 약 21 SQL이다. 300 viewer가 global 변화 burst를 1초
간격으로 받으면 bundle만 이론상 약 3,900~6,300 statement/s까지 커질 수 있다.
이는 실제 운영 측정값이 아니라 현재 호출 그래프의 상한식이며, 구현 뒤 실제
statement rate로 대체한다.

## 보존할 계약

1. gameplay 계산 중 hook은 DB, Redis, network side effect를 실행하지 않는다.
2. 공개할 변화는 DB commit 성공 뒤에만 만들어진다. rollback된 변화는 보이지 않는다.
3. `log_entry` 기반 기록은 in-memory draft가 아니라 commit되는 실제 row가 기준이다.
4. Redis pub/sub은 best-effort wake-up이며 durable state source가 아니다.
5. 내부 committed change에는 entity ID를 둘 수 있지만 public SSE는 viewer별 boolean
   slice만 노출한다.
6. 다른 장수의 private 변화와 clock-only turn은 public SSE와 dashboard 조회를 만들지
   않는다.
7. cache/revision 장애, 구버전 client와 rolling deployment는 기존 full snapshot으로
   복구한다.
8. viewer-private payload는 공유 cache에 저장하지 않는다.
9. manual refresh는 최신 authoritative DB snapshot을 다시 읽는 복구 경로로 남긴다.
10. typed journal 수집은 action module order, RNG 호출과 persistence 순서를 바꾸지 않는다.

## 목표 구조

```text
engine / API / worker mutation
  -> transaction-local ChangeJournal에 entity 후보와 닫힌 의미 변화 기록
  -> 영향받는 canonical projection만 final value와 baseline 비교
  -> 같은 DB transaction에서 read_model_revision을 batch increment
  -> 같은 DB transaction에 compact read_model_outbox 1건 기록
  -> transaction commit
  -> outbox dispatcher가 Redis readModelChanged를 at-least-once publish
  -> shared projection은 domain revision을 cache key로 사용
  -> browser가 viewer-safe slice invalidation을 merge
  -> access-only gate + slice source revision 1회 조회
       known source revision 동일: payload DB 조회 없이 unchanged
       다름: 해당 viewer-private projection만 lazy 재구성
  -> content hash/RFC 6902 patch/full snapshot의 기존 복구 계약 유지
```

### 세 단계 자료형

#### `ChangeCandidate`

transaction 안에서만 쓰는 mutable collector다. gameplay action에 범용 callback을
연결하지 않고 현재 dirty state와 API/worker의 명시적 mutation 결과를 수집한다.

```ts
type ChangeCandidate = {
    generalIds: Set<number>;
    cityIds: Set<number>;
    nationIds: Set<number>;
    domains: Set<ReadModelDomain>;
    generalRecordIds: Set<number>;
};
```

entity dirty는 비교 후보일 뿐 public 변화의 증거가 아니다. 예를 들어 gold 변경은
context/command에 영향을 줄 수 있지만 map에는 영향이 없다. 기존 canonical
projection 비교 또는 명시적인 field dependency가 최종 domain을 결정한다.

#### `CommittedReadModelInvalidation`

DB transaction에서 revision과 함께 확정되는 내부 계약이다. 현재
`RealtimeReadModelChanges`의 entity ID와 domain flag를 이 이름과 역할로 정리한다.
API는 이 값으로 viewer identity를 대조하지만 그대로 browser에 보내지 않는다.

#### `RealtimeReadModelInvalidation`

현재와 동일하게 entity ID, wall/logical time과 global revision을 제거한 public
boolean slice다. 신규 domain도 실제 화면 consumer가 있는 경우에만 boolean을
추가한다.

## durable revision

### DB schema

profile마다 별도 PostgreSQL schema를 사용하므로 profile column은 두지 않는다.

```prisma
model ReadModelRevision {
  domain    String
  entityId  Int      @default(0) @map("entity_id")
  revision  BigInt   @default(0)
  updatedAt DateTime @updatedAt @map("updated_at")

  @@id([domain, entityId])
  @@map("read_model_revision")
}

model ReadModelOutbox {
  id          BigInt    @id @default(autoincrement())
  payload     Json
  attempts    Int       @default(0)
  availableAt DateTime  @default(now()) @map("available_at")
  lockedAt    DateTime? @map("locked_at")
  lockOwner   String?   @map("lock_owner")
  deliveredAt DateTime? @map("delivered_at")
  lastError   String?   @map("last_error")
  createdAt   DateTime  @default(now()) @map("created_at")

  @@index([deliveredAt, availableAt, id])
  @@map("read_model_outbox")
}

model ReadModelRevisionMeta {
  id              Int @id
  coverageVersion Int @default(0) @map("coverage_version")

  @@map("read_model_revision_meta")
}
```

한 mutation에서 같은 key가 여러 번 표시돼도 collector에서 dedupe한다. commit 시
모든 key를 한 `INSERT ... ON CONFLICT ... DO UPDATE revision = revision + 1`로 올려
statement 수와 row lock 시간을 제한한다. 없는 key의 revision은 0으로 해석한다.

초기 domain은 다음과 같다.

| domain | entity ID | 의미 |
| --- | ---: | --- |
| `general.content` | general ID | 현재 장수 context/command/board dependency |
| `city.content` | city ID | 현재 도시 context/command dependency |
| `nation.content` | nation ID | 현재 국가 context/command/board dependency |
| `world.content` | 0 | 연월, scenario/config/catalog 성격의 dependency |
| `map.world` | 0 | shared base map projection |
| `records.general` | general ID | 개인 최근 기록 |
| `records.global` | 0 | 장수 동향 |
| `records.history` | 0 | 중원 정세 |
| `front.general` | general ID | actor별 front status |
| `front.nation` | nation ID | 국가 공지 등 viewer별 front status |
| `front.global` | 0 | 설문과 global front status |
| `access.general` | general ID | 접속 점수와 제한 상태, public fan-out 없음 |
| `lobby.world` | 0 | NPC/국가 수, 공용 lobby projection |
| `tournament` | 0 | 토너먼트 stage/state |
| `betting` | 0 | 국가/토너먼트 베팅 목록·상태 |

projection 세부 ID 목록은 Redis wake-up의 viewer filtering에 사용하고, DB revision
row는 API가 작은 dependency vector를 읽는 authoritative 경계로 사용한다.
`access.general`은 제한 gate와 현재 context의 접속 점수에만 포함하고 public SSE를
발행하지 않는다. 모든 access 기록마다 다른 viewer를 깨우지 않으면서 본인 다음 조회의
source revision은 정확히 바뀐다.

### outbox와 coverage gate

revision은 `unchanged` 판정의 authority이고 outbox는 commit 뒤 browser wake-up과
shared projector 실행의 내구성 경계다. non-empty journal transaction마다 normalized
payload 한 건만 넣는다. dispatcher는 `FOR UPDATE SKIP LOCKED`와 bounded lease로 row를
claim하고 Redis publish/cache 작업을 at-least-once 수행한다. revision-keyed cache와
boolean invalidation은 중복 전달에 idempotent해야 한다.

- commit 뒤 publish 전 crash: pending outbox가 재시도한다.
- publish 뒤 acknowledge 전 crash: 중복 publish될 수 있으나 현재 state를 다시 읽으므로
  결과는 같다.
- 전달 완료 row는 짧은 운영 진단 retention 뒤 batch prune하여 4 turns/s 지속 workload의
  무제한 table 성장을 막는다.
- outbox ID는 전달 identity일 뿐 projection revision으로 사용하지 않는다. 서로 다른
  transaction의 sequence 할당 순서와 commit 순서가 다를 수 있기 때문이다.

`coverageVersion=0`에서는 revision-first equality를 절대 신뢰하지 않는다. 모든
engine/API/worker writer와 dispatcher가 배포되고 reconciliation이 끝난 뒤 현재 binary가
요구하는 version으로 올린다. coverage가 없거나 낮으면 기존 content-hash full computation
경로를 사용한다. rollback은 coverage를 0으로 내리는 것만으로 fast path를 끌 수 있다.

감사·기록은 outbox payload로 재구성하지 않고 원래 transaction의 domain row와
`log_entry`를 source of truth로 유지한다.

## producer별 적용

### game engine

- 현재 dirty general/city/nation/log/reserved state를 `ChangeJournal` adapter에 연결한다.
- 기존 canonical projection 비교를 유지한다.
- `persistedVisibleLogs`를 합친 최종 invalidation으로 DB revision을 같은 transaction에서
  batch increment하고 outbox를 쓴다.
- transaction이 성공한 뒤에만 dirty baseline을 acknowledge하고 committed receipt를 노출한다.
  Redis publish는 durable outbox dispatcher가 담당한다.
- 월 경계는 현재 DB commit 뒤에 `worldChanged`를 덧붙이므로 durable revision과 원자적이지
  않다. 연·월과 response-relevant config/meta만 포함하고 clock/lease/heartbeat를 제외한
  world canonical projection을 transaction 전에 비교하여 `world.content`와
  `map.world`를 같은 transaction에서 올린다.

### game API transaction

`inputEventMiddleware`가 request-local journal을 만들고 transaction context에 전달한다.
handler는 성공한 mutation의 닫힌 의미만 mark한다. middleware는 handler와
`input_event=SUCCEEDED`를 저장한 같은 transaction에서 revision을 올리고, outer
transaction commit 뒤에는 dispatcher wake-up만 시도한다.

설문은 현재 handler 안에서 Redis publish를 실행하므로 DB transaction보다 publish가
먼저 보일 수 있다. 이를 journal mark로 바꾸어 actor/global front-status revision과
outbox row를 같은 transaction에서 확정하고, publish는 dispatcher가 commit 뒤에
수행하게 한다.

현재 일부 `authedProcedure`/`accessAuthedProcedure` mutation은 API interactive
transaction을 잡은 채 `turnDaemon.requestCommand()`의 별도 ENGINE transaction 완료를
기다린다. 300명 동시 mutation에서는 pool 고갈·timeout 위험이 있으므로 다음처럼
분류한다.

- daemon만 state를 소유하는 handler: `engineAuthedProcedure` 계열로 옮겨 API outer
  transaction을 만들지 않는다.
- API DB write와 daemon write가 섞인 handler: journal만 추가하고 원자적이라고 부르지
  않는다. 한쪽 소유 transaction으로 이동하거나 durable idempotent saga를 정의한다.
- API input event와 ENGINE input event의 request ID/idempotency 관계를 integration test로
  고정한다.

### Redis-owned tournament state

토너먼트 state/participants/matches/bets는 현재 Redis가 원본이므로 PostgreSQL
revision과 원자적으로 묶을 수 없다. `TournamentStore`가 state write와 Redis domain
revision 증가를 같은 Redis transaction 또는 Lua script로 수행한다. 저장 뒤 별도
`publish()` 두 호출로 끝내지 않는다. 장기 durability 요구가 생기면 tournament state
자체를 PostgreSQL 소유로 옮기는 별도 migration으로 다룬다.

### 국가 베팅과 direct writer

- 국가 베팅 제출은 actor의 비용/랭킹과 `betting` domain을 같은 API transaction에서
  mark한다.
- engine의 베팅 open/finish와 정산 로그는 engine transaction journal이 소유한다.
- diplomacy/message response처럼 city/nation을 직접 쓰는 API 경로는 해당 entity와
  map/front/contacts projection을 명시적으로 mark한다.
- direct writer inventory test가 알려진 mutation 파일을 journal 등록 목록과 대조한다.

`TurnWorldChanges`에 있으나 현재 realtime summary가 사용하지 않는 troop, diplomacy,
messages, neutral auction, nation betting과 nation reserved queue도 inventory에 포함한다.
화면 consumer가 없는 값은 무조건 event를 만들지 않고 명시적 비대상으로 기록한다.

## request 경로

### 1단계: access-only gate

`dashboard.getContextBundleDelta`의 include가 모두 false인 요청을 허용하거나 별도
`dashboard.checkRealtimeAccess`를 둔다. frontend는 모든 event에 `context=true`를
강제하지 않는다. 제한이면 후속 query를 만들지 않고 현재와 같이 EventSource를 닫는다.

`getGeneralAccessState()`의 general/world/access-log 조회는 한 SQL 또는 request-local
loader로 합친다. non-limited 결과는 짧은 최대 5초 cadence로만 재검사할 수 있지만,
manual mutation/명시적 제한 endpoint는 기존 server-side gate를 계속 적용한다.

### 2단계: revision-first delta

각 private slice response는 기존 content `revision` 외에 opaque `sourceRevision`을
포함한다. source revision은 domain/entity/revision tuple을 canonicalize한 뒤 hash한
값이고 내부 ID vector 자체를 browser에 내보내지 않는다.

```ts
type KnownDashboardRevision = {
    content?: string;
    source?: string;
};
```

API는 access gate에서 얻은 현재 general/city/nation identity로 slice dependency key를
만들고 `read_model_revision`을 한 번 읽는다.

- client source와 같으면 `getGeneralContext()`, command table, board access와 payload
  canonicalization을 모두 생략하고 `unchanged`를 반환한다.
- 다르면 현재 projection을 만들고 기존 content hash/Redis baseline/patch/snapshot
  선택을 수행한다.
- source revision row/table이 없거나 query가 실패하면 기존 full computation으로
  fallback한다.
- `coverageVersion`이 현재 binary 요구값보다 낮으면 source가 같아도 fast unchanged를
  사용하지 않는다.
- general의 소속·위치가 바뀌면 `general.content`가 먼저 mismatch되므로 새 identity로
  projection과 source revision을 다시 만든다.

### shared projection

- world map base cache key는 Redis에서 best-effort로 증가한 값이 아니라 DB의
  `map.world` revision을 사용한다.
- 개인 `spyList`, `shownByGeneralList`, `myCity`, `myNation`은 request에서 계속 조합한다.
- tournament는 Redis atomic state revision을 cache/source revision으로 사용한다.
- records는 기존 `lastGeneralRecordId`/`lastWorldHistoryId` 증분 조회를 유지하되 해당
  domain이 선택되지 않으면 query하지 않는다.

## frontend scheduling

같은 profile/account의 visible tab leader 하나만 SSE와 tRPC를 수행하는 현재
BroadcastChannel 계약을 유지한다. 변경 ID set/boolean은 drop하지 않고 union한다.

초기 cadence 목표는 다음과 같다.

| 종류 | 최대 시작 빈도 | 이유 |
| --- | ---: | --- |
| 자기 context/commands/board | 1초 1회 | 자기 명령 결과의 빠른 반영 |
| records/front status | 2초 1회 | global burst 합치기 |
| map/lobby/tournament/betting | 5초 1회 | 300 viewer의 shared fan-out 제한 |
| access-only non-limited 재확인 | 5초 1회 | 제한 DB gate fan-out 제한 |

manual refresh, visible 복귀와 realtime 재활성화는 cadence를 기다리지 않고 fresh
snapshot을 한 번 읽는다. 숫자는 실제 혼합 부하 결과에 따라 조정하며, 부하만 낮추기
위해 5초를 초과하지 않는다.

## 구현 단계와 commit 경계

### Phase A: 저위험 read 절감

1. access-only gate/all-false bundle을 허용한다.
2. frontend의 강제 `context=true`를 제거한다.
3. request-local actor/world/access loader 또는 단일 SQL로 gate 중복을 줄인다.
4. unit + 실제 PostgreSQL query-count integration + production Chromium network trace를
   통과시킨다.

### Phase B: typed journal과 durable revision

1. `ReadModelDomain`, collector와 committed invalidation type을 common에 추가한다.
2. revision/outbox/meta migration과 Prisma model을 추가한다.
3. engine transaction에서 final projection/log 결과, revision과 outbox를 원자화한다.
4. outbox dispatcher의 claim/lease/retry/prune를 구현한다.
5. API `inputEventMiddleware`에 request journal을 추가하고 pre-commit publish를 제거한다.
6. daemon-only procedure와 mixed API/ENGINE saga inventory를 분리한다.
7. survey/nation betting/message/diplomacy/direct writer를 등록한다.
8. rollback, duplicate input, direct log writer와 Redis publish 실패를 검증한다.

### Phase C: revision-first와 shared cache

1. dashboard delta contract에 source revision을 optional로 추가한다.
2. context/command/board의 dependency vector와 fast unchanged를 구현한다.
3. map cache를 durable world revision으로 전환한다.
4. tournament Redis state/revision을 원자화한다.
5. old client, missing row, Redis/DB failure와 rolling deployment fallback을 검증한다.
6. writer coverage reconciliation 뒤에만 coverage version을 활성화한다.

### Phase D: scale benchmark와 tuning

1. 5분 턴·900 NPC 및 900 NPC+300 human control engine profile을 고정 seed로 실행한다.
2. 300 SSE 연결의 idle/keepalive/memory를 측정한다.
3. 300 인증 viewer의 own-change와 global map/record burst를 실제 HTTP/PostgreSQL/Redis로
   실행한다.
4. daemon 900 NPC 처리와 API mixed load를 동시에 실행한다.
5. 결과에 따라 pool, cadence, cache와 worker concurrency를 조정하고 전체 benchmark를
   다시 실행한다.

각 phase는 독립 commit으로 유지한다. broad refactor 뒤에는
`pnpm exec turbo typecheck --force`, lint/build와 architecture check를 실행한다.

## 부하 workload와 합격 기준

### 산술 기준

5분 턴에서 900 NPC는 평균 3 general turns/s다. 사용자 300명의 turn이 같은 주기로
분산되면 평균 1 turn/s이므로 정상 지속 입력은 약 4 general turns/s다. "NPC 포함 총
900장수"도 별도 control로 둔다. 경계 시각의 몰림과 worker catch-up을 위해 최소
3배인 12 turns/s 지속 burst와 1,200장수 동시 경계 chunk를 별도로 측정한다.

기존 880 NPC DB-free 자연 통일 profile은 계산 상한을 제공하지만 PostgreSQL, Redis,
API와 process 경합을 제외하므로 production 수용 근거로 단독 사용하지 않는다.

### workload

| ID | workload | 필수 관찰값 |
| --- | --- | --- |
| E1 | 5분 턴, 900 NPC 및 총 1,200장수 DB-free 고정 seed | turns/actions/s, command p95/p99, memory high-water, 최종 state hash |
| E2 | 실제 DB flush를 포함한 12 turns/s와 1,200 동시 경계 | 계산/flush/publish, schedule lag, rows/statements, rollback 0 |
| A1 | 300 SSE idle 30분 | 연결 성공/유지율, ping, runtime RSS, event-loop lag |
| A2 | 300 viewer own context 변화 5분 주기 | HTTP p95/p99, fast unchanged 비율, DB statements/s |
| A3 | 초당 3회 map/record 후보 10분 | coalesced request rate, shared cache hit, stale/missed revision 0 |
| M1 | E2 + A1 + A2 + A3 혼합 30분 | CPU/RSS/DB/Redis/HTTP/SSE와 daemon lag 전체 |
| R1 | Redis publish/cache 장애와 API/daemon restart | durable revision 수렴, full snapshot 1회, 유실/중복 표시 0 |

### provisional pass gate

현재 운영 후보 runtime limit과 한 호스트의 PostgreSQL/Redis 공유를 기준으로 한다.

- runtime CPU: 30분 sustained 4 CPU의 70% 이하, 1분 burst 90% 이하
- runtime RSS: 6 GiB 이하, 종료 후 지속 증가 없음
- API HTTP: 성공률 99.9% 이상, read p95 500ms 이하, p99 1.5s 이하,
  mutation p95 1s 이하, p99 3s 이하
- SSE: 300 연결의 99.5% 이상 steady 유지, publish-to-client p95 250ms 이하,
  p99 1s 이하, reconnect storm 없음
- PostgreSQL: connection pool 고갈 0, deadlock/serialization failure 0,
  query p95 50ms 이하
- Redis: command error 0, blocked client 0, cache 장애 주입 후 요청 실패 대신 snapshot 복구
- daemon: 계산+flush p99 60초 이하, 관측 max 120초 이하, 5분 턴 backlog가 다음
  경계까지 누적되지 않음
- correctness: 고정 seed engine state hash 동일, rollback invalidation 0,
  public SSE entity ID/time/revision 노출 0
- fast path: revision 동일 context/command/board 요청에서 payload projection SQL 0회
- global burst: viewer당 shared slice 시작률 5초당 1회 이하, trailing union 보존
- own commit-to-dashboard p99 2초 이하, shared map은 5초 cadence를 포함해 p99 7초 이하

이 gate는 최초 측정 전 목표값이다. 미달이면 "추산상 가능"으로 끝내지 않고 병목을
계측하여 수정하고 M1/R1을 다시 실행한다. dev host의 다른 workload가 결과에 영향을
주면 container CPU/memory limit과 host steal/load를 함께 기록한다.

## 검증 matrix

### unit

- journal merge/dedupe와 domain dependency
- entity dirty지만 projection 동일한 경우 revision 증가 없음
- content-only/map-only/front-only 분리
- source revision 같을 때 loader 0회
- malformed/missing source revision fallback
- public invalidation redaction

### PostgreSQL/Redis integration

- migration fresh/re-run 검사
- engine commit은 state/log/revision을 함께 저장
- transaction rollback은 revision과 public event를 남기지 않음
- API mutation/input-event/revision 원자성
- direct Prisma log writer 포함
- Redis publish 실패 후 DB revision으로 최신 snapshot 수렴
- 동시 transaction의 같은 domain revision lost update 없음
- 동일 head 32개 동시 writer가 정확히 +32이고 stable key order에서 deadlock 없음
- commit 후 publish 전 crash는 dispatcher가 복구하고 publish 후 ack 전 crash는 중복에
  안전함

### Chromium

- empty/clock-only event network 0건
- records/map/front-only event에서 `getGeneralContext()` 0회
- 실제 context 변화의 patch와 DOM identity 유지
- same-account visible 2 tab은 SSE/query 1세트
- sync OFF/hidden/off-route 중단
- access 제한은 gate 뒤 후속 query 0, 수동 복구 성공

### capacity 도구

기존 저장소와 호스트에는 지속 부하 도구가 없다. tRPC/SSE/auth 의미를 그대로 쓰는
repo-local `tools/load-tests` package를 추가한다. synthetic token은 Git 제외 0600
파일에 두고 report에는 token/user ID를 기록하지 않는다.

```text
tools/load-tests/
  config/300-users-900-npcs-5m.json
  src/seed-capacity-fixture.ts
  src/api-sse-load.ts
  src/mixed-orchestrator.ts
  src/metrics.ts
```

load generator 자체의 CPU/event-loop lag를 결과에 포함하고 가능하면 target runtime과
다른 host/cgroup에서 실행한다. fixture는 실제 daemon fast-forward checkpoint를 전용
PostgreSQL schema와 Redis prefix로 복원하며 공유 운영 profile을 부하 대상으로 쓰지
않는다. raw JSON에는 commit/image digest, Node/PostgreSQL/Redis 버전, CPU/memory quota,
fixture hash와 실패 run도 남긴다.

## rollback과 운영 관측

- schema는 additive이며 구버전 API는 revision table을 사용하지 않아도 동작한다.
- source revision은 optional contract로 시작해 rolling deployment를 허용한다.
- fast path를 runtime flag로 끌 수 있게 하고 disabled 시 기존 full computation으로 간다.
- migration rollback이 필요하면 fast path를 먼저 끄고 code rollback 뒤 table을 보존한다.
  revision table 삭제는 데이터 복구에 필요하지 않으므로 즉시 수행하지 않는다.
- metric label에는 profile/domain/slice만 사용하고 user/general ID, token과 payload를
  넣지 않는다.
- 기록할 metric: invalidation candidate/committed count, revision bump rows,
  fast-unchanged/full-compute/patch/snapshot, query count/time, SSE connections,
  coalesced event count, daemon schedule lag와 process CPU/RSS/event-loop lag.

## 완료 조건

1. Phase A~D 코드와 이 문서, 상위 mapping/report가 현재 source와 일치한다.
2. 모든 mutation producer inventory가 journal 등록 또는 명시적 비대상으로 분류된다.
3. unit/type/lint/build/architecture, 실제 PostgreSQL/Redis, production Chromium 검증이
   통과한다.
4. E1~M1과 R1 raw JSON/요약/재현 명령이 남는다.
5. 300 viewer·900 NPC·5분 서버 pass gate가 실제 측정으로 확인된다.
6. 전용 branch를 최신 main에 통합한 뒤 핵심 검증을 재실행한다.
7. local main, tracking branch와 `git ls-remote` hash/ancestry를 확인하고 push한다.
