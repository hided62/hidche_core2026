# 일반 장수 명령 차등 테스트 설계

## 상태

- 문서 상태: 단계적 구현 중
- 비교 기준: `ref/sam`의 `ng_compare` 브랜치
- 대상: 휴식과 `cr_건국`을 포함한 일반 장수 예약 명령 55개
- 범위: 명령 결과, RNG 소비, 로그, 예약 턴 lifecycle, DB 영속화

현재 ref MariaDB와 core memory를 잇는 공통 runner, 성공 경로 55개,
실행 중 확률 실패 9개, full constraint fallback 12개와 모략 확률 clamp
8개, 모략 결과값 경계 5개, 부상 경계 3개, alternative 5개와 pre-required
turn 중간 경계 6개, post-required cooldown 경계 3개가 구현됐다.
실패 9개는 내정 critical
`주민선정/정착장려/상업투자/기술연구/물자조달`과 모략
`화계/선동/파괴/탈취`이며 RNG 전체 trace, semantic state delta와 실패
로그 본문을 비교한다. 공통 제약 7개는 무소속, 방랑국, 타국 도시, 보급
단절, 금·쌀 부족과 민심 상한을 대표한다. 모략 제약 5개는 동일 도시,
중립 도시, 불가침국, 계략 비용 금·쌀 부족을 고정한다. 모두 휴식
fallback과 RNG/state delta를 비교한다. clamp 8개는
`화계/선동/파괴/탈취` 각각의 계산 확률 0과
0.5 경계에서 성공 판정 RNG의 무소비 또는 `nextBits(1)` 소비와 전체
state delta를 비교한다. 결과값 5개는 화계 농업·상업, 선동 치안·민심,
파괴 수비·성벽의 0 바닥과 탈취의 대상 국가 자원 상한·미보급 도시 최종
저장 상태를 비교한다. 부상 3개는 화계·선동·파괴의 대상 장수별 판정,
부상도 80 상한, 병력·훈련·사기 0.98 정수 저장과 대상 장수 로그를
비교한다. alternative 5개는 해산·랜덤임관·무작위건국·출병의 모든 대체
분기에서 최초 명령 RNG의 연속 소비와 최종 상태를 비교한다. pre-required
turn 6개는 전투태세 1/2/3턴, 내정·전투 특기 초기화 1턴, 은퇴 1턴의
`last_turn`과 진행 로그, RNG 무소비를 비교한다. cooldown 3개는 특기
초기화 완료 직후 `current + 60 - preReq`, 1턴 전 차단, 경계 월 허용을
ref `next_execute` KV와 core general meta의 공통 projection으로 비교한다.
존재하지 않는 대상 경계 4개는 증여·등용의 장수 ID와 첩보·이동의 도시 ID를
고정해 원 명령 미완료, 휴식 fallback, RNG 무소비와 semantic delta를
비교한다.

2026-07-26부터 canonical snapshot은 관찰 장수의 `rank_data`도 비교한다.
ref의 `RankColumn` 37종만 의미 행으로 정규화하며, ref에서 자연 `general`
column인 경험·공헌·숙련을 위해 core가 보유한 7개 mirror row는 비교에서
제외한다. 화계 fixture는 같은 초기 `firenum`에서 성공 명령 뒤 양쪽이
동일하게 1 증가하는지 확인한다. 은퇴 fixture는 37종 전부를 서로 다른
비영 값으로 채운 뒤 양쪽이 전부 0으로 만드는지 확인한다. 이 검증으로
일반 명령 snapshot에서 누락됐던 명장일람 누적치와 은퇴 후 메모리→DB
재저장 경로를 관찰한다.
자원 인자·보유량 경계 13개는 증여·헌납·군량매매의 100단위 반올림과
100..max clamp 9개, 헌납의 보유량보다 큰 요청·최소 쌀 미달 2개,
증여의 최소 쌀 보존·자기 자신 거부 2개를 비교한다.
필수 인자 객체 자체를 생략한 `증여`는 ref/core 모두
`인자가 올바르지 않습니다. 증여 실패.` 로그와 휴식 fallback, RNG 무소비,
동일 state delta를 확인했다. 같은 형태의 `이동`은 ref가
`CityConstBase::byID(null)` TypeError로 종료된다. 예약 API가 이 입력을
사전에 거부하므로 정상 제품 경로가 아니며, 손상된 저장 큐에서도 daemon을
중단하지 않고 실패 로그와 휴식으로 복구하는 core 동작을 의도적 안전 차이로
유지한다.
나머지 명령별 제약 실패·값 경계와 전체 core PostgreSQL 재조회가 완료
기준을 통과하기 전까지 55개 명령 전체의 동적 호환 상태를 `확인`으로
올리지 않는다.

## 결정 요약

일반 장수 명령은 하나의 canonical fixture로 다음 세 결과를 만든다.

1. ref PHP가 격리된 MariaDB에서 실제 예약 턴을 실행한 결과
2. core2026이 `InMemoryTurnWorld`에서 같은 예약 턴을 실행한 결과
3. 2의 dirty state를 격리된 PostgreSQL에 flush하고 다시 읽은 결과

두 비교를 모두 통과해야 한다.

```text
canonical fixture
        │
        ├── ref fixture adapter ──> PHP full turn ──> MariaDB ──> ref projection
        │                                                        │
        └── core fixture adapter ─> InMemory full turn ──────────┼─ exact semantic diff
                                      │                          │
                                      └── DB hooks ─> PostgreSQL ─┘
```

- `ref projection == core memory projection`은 호환 로직을 검증한다.
- `core memory projection == core persisted projection`은 loader/flush를
  검증한다.
- raw MariaDB dump와 raw PostgreSQL dump는 비교하지 않는다. 테이블 구조와
  필드 소유권이 다르므로 의미 필드로 정규화한 JSON을 비교한다.
- 명령 결과와 RNG는 원칙적으로 exact 비교한다. 저장 레이아웃 차이만
  projection에서 제거한다.

## 목표와 비목표

### 목표

- 동일한 게임 상태, 명령, 인자, 시각과 seed로 ref/core를 실행한다.
- 성공, 실행 중 실패, 제약 실패, alternative, 다중 턴과 전처리 경로를
  구분한다.
- 장수·도시·국가·부대·외교·예약 큐·rank·로그 등 모든 관찰 가능한
  side effect를 비교한다.
- RNG의 domain, 호출 순서, 연산, 인자와 결과를 비교한다.
- core 메모리 결과가 실제 PostgreSQL에 같은 의미로 저장되고 재시작 후
  같은 상태로 로드되는지 검증한다.
- 명령이 예상 밖의 raw DB 필드를 바꾸면 projection 누락으로 실패시킨다.
- 각 명령의 테스트 근거와 아직 없는 경로를 기계적으로 집계한다.

### 비목표

- MariaDB와 PostgreSQL의 물리 schema, sequence, index 또는 내부 row ID를
  동일하게 만드는 일
- 레거시 제품 브랜치 `devel`에 비교 endpoint를 추가하는 일
- 운영/개발 DB를 초기화하거나 기존 ref DB를 fixture 저장소로 사용하는 일
- 현재 구현을 정답으로 삼아 snapshot을 자동 승인하는 일
- UI와 API 요청 형식 검증을 이 suite 하나로 대체하는 일

## 테스트 계층

### 1. core logic regression

기존 `InMemoryTurnWorld`와 예약 턴 handler를 사용한다. 빠른 테스트이며
fixture의 core memory projection을 단언한다. DB 제약이나 직렬화는 보장하지
않는다.

### 2. ref ↔ core differential integration

Docker의 ref PHP CLI와 격리 MariaDB를 호출하므로 integration test로
분류한다. 두 엔진의 canonical 결과와 RNG trace를 비교한다.

### 3. core persistence integration

동일한 core 실행 결과를 `databaseHooks`로 격리 PostgreSQL에 flush하고
새 connection으로 다시 load한다. 메모리 projection과 재조회 projection을
비교한다.

### 4. 선택적 daemon system test

예약 API, command queue와 daemon lifecycle까지 필요한 대표 명령만 별도
system test로 둔다. 55개 수치 호환성 검증을 이 느린 계층에 모두 넣지 않는다.

## 제안 파일 구조

구현 시 다음 경계를 사용한다.

```text
core2026/
  tools/integration-tests/
    fixtures/general/
      manifest.json
      base/
        scenario-2.json
      che_화계/
        success-basic.json
        failure-probability.json
        probability-clamp-max.json
        injury-and-item.json
    src/general-command/
      fixtureSchema.ts
      canonicalSchema.ts
      compareCanonical.ts
      referenceRunner.ts
      referenceProjection.ts
      coreMemoryRunner.ts
      coreMemoryProjection.ts
      coreDatabaseRunner.ts
      coreDatabaseProjection.ts
      changedPathAudit.ts
      databaseSandbox.ts
      tracingRng.ts
    test/
      generalCommandDifferential.test.ts
      generalCommandPersistence.test.ts
      generalCommandComparator.test.ts

ref/sam/                         # ng_compare 전용
  hwe/compare/
    general_command_trace.php
    GeneralCommandFixture.php
    GeneralCommandProjection.php
    ComparisonTracingRNG.php

docker_compose_files/
  general-command-differential/
    compose.yml
    .env.example
    README.md
    scripts/
      prepare-secrets.sh
      initialize-templates.sh
      run-fixture.sh
      verify-isolation.sh
    secrets/
      mariadb_password.example
      postgres_password.example
```

기존 `battleDifferential.test.ts`의 workspace 탐색, `docker compose exec`,
stdin JSON 전달과 tracing RNG 패턴을 재사용한다. 일반 명령용 코드는 전투
fixture와 섞지 않는다.

integration Vitest는 case DB 수명주기를 예측할 수 있도록
`fileParallelism: false`, 기본 `testTimeout: 120_000`을 유지한다. CI
sharding은 별도 Compose project와 worker prefix를 받은 프로세스 사이에서만
수행한다.

## 실행 격리

### 전용 Compose stack

`general-command-differential`은 개발, ref UI, input-event E2E와 수명주기가
다르므로 별도 Compose stack으로 둔다.

필수 service:

- `ref-db`: 고정 버전 MariaDB, 외부 port 미공개
- `ref-runner`: 기존 ref PHP image, CLI 명령만 허용
- `core-db`: 고정 버전 PostgreSQL, 프로젝트 전용 loopback port
- 선택 profile `system`: Redis와 core daemon runner

DB data directory는 suite 전용 `tmpfs`를 기본으로 한다. 테스트가 중단되어도
운영·개발 volume을 가리킬 수 없게 Compose project, container, network와
port 이름을 별도로 고정한다.

실제 비밀값은 Git에서 제외된 secret file로만 주입한다. ref의 생성된
`d_setting/DB.php` overlay는 `/run` 또는 `mktemp` 아래에 mode `0600`으로
만들어 container에 read-only mount하고 종료 시 삭제한다. JSON 결과,
명령행과 보고서에는 credential을 넣지 않는다.

### ref는 transaction rollback을 사용하지 않는다

레거시 `general`, `city`, `general_turn`, `general_record`, `rank_data` 등
핵심 테이블은 Aria engine이다. 따라서 transaction rollback은 fixture
격리를 보장하지 못한다.

ref 격리는 다음 순서로 수행한다.

1. suite 시작 시 schema와 비교 기준 scenario config로 immutable template
   DB 두 개(root/HWE)를 만든다.
2. case마다 검증된 prefix
   `sammo_gc_ref_<worker>_<caseHash>`의 DB를 새로 만든다.
3. template dump를 case DB에 복원하고 fixture override를 적용한다.
4. case DB를 가리키는 임시 `RootDB.php`/`DB.php` overlay로 PHP CLI를
   한 번 실행한다.
5. canonical 결과를 읽은 뒤 case DB를 삭제한다.
6. cleanup 대상 이름이 허용 prefix와 정확히 일치하지 않으면 삭제를
   거부한다.

이 흐름은 기존 `test-fast-forward-sandbox.sh`의 DB 복제, DB 이름 override,
원본 DB 불변 검사 패턴을 재사용한다. 기존 `sammo_ref_hwe`는 읽거나
복제 기준으로도 사용하지 않고, suite가 직접 만든 template만 사용한다.

### core DB 격리

suite 전용 PostgreSQL 안에 `public`과 `che` schema 및 migration을 적용한
template database를 만든다. case마다 template에서 새 database를 만들고
case 종료 후 검증된 prefix에 한해 삭제한다.

각 case는 다음을 보장한다.

- 새 Prisma connection 사용
- 명시적인 profile/scenario
- fixture에 없는 이전 row가 없음
- flush 이후 connection을 닫고 새 connection으로 재조회
- dirty-state acknowledge는 DB commit 이후에만 수행
- 실패한 case도 case database만 정리

현재 `.env.ci`가 가리키는 개발 DB의 `public`/`che` schema를 truncate하는
기존 initialization test는 이 suite의 backend로 사용하지 않는다.

## 기준 scenario와 base state

fixture는 양쪽에 공통으로 존재하는 `scenario_2`의 rule, map과 unit set을
사용한다. 전체 scenario의 NPC와 국가를 그대로 seed하면 검색, 정렬과
무작위 후보가 fixture 밖 row에 영향을 받으므로 다음 base를 별도로 만든다.

- scenario config, `GameConst`, map과 unit set은 `scenario_2`에서 로드
- map의 모든 도시는 중립 기본 row로 생성
- 장수, 국가, 부대, 외교와 예약 턴은 fixture가 명시한 것만 생성
- game/root env는 명령 생성과 턴 실행에 필요한 key 전체를 명시
- 시간은 UTC ISO 문자열과 게임 연·월을 함께 고정
- 자동 턴은 기본적으로 끄고 fixture가 요구할 때만 켬
- 국가 예약 명령은 기본 휴식으로 고정
- actor만 due 상태로 두고 대상/보조 장수의 turn time은 실행 범위 밖으로 둠
- fixture의 test hidden seed를 임시 `UniqueConst.php` overlay와 core world
  meta 양쪽에 같은 값으로 주입

base generator가 양쪽 입력을 따로 만들되, 기준 값은 하나의 canonical
base JSON에서 가져온다.

## Fixture 계약

fixture는 구현 내부 객체가 아니라 게임 의미를 기술한다. Zod schema와
JSON Schema를 함께 생성하고 resource validation에 포함한다.

개념 예시는 다음과 같다.

```json
{
    "schemaVersion": 1,
    "id": "che_화계/success-basic",
    "scenario": "scenario_2",
    "execution": {
        "mode": "full-turn",
        "year": 200,
        "month": 1,
        "turnTime": "0200-01-01T00:00:00.000Z",
        "hiddenSeed": "general-differential-test-seed",
        "actorGeneralId": 101,
        "command": {
            "key": "che_화계",
            "args": { "destCityId": 2 }
        },
        "autorun": false
    },
    "world": {
        "generals": [],
        "cities": [],
        "nations": [],
        "troops": [],
        "diplomacy": [],
        "generalTurns": [],
        "nationTurns": [],
        "rank": [],
        "events": [],
        "rootUsers": []
    },
    "observe": {
        "generalIds": [101, 201],
        "cityIds": [1, 2],
        "nationIds": [1, 2],
        "metaKeys": ["intel_exp", "firenum", "killturn", "myset", "inherit_lived_month"],
        "collections": ["logs", "generalTurns", "rank"]
    },
    "expect": {
        "outcome": "success"
    },
    "evidence": {
        "legacyFiles": ["hwe/sammo/Command/General/che_화계.php", "hwe/func.php"],
        "contract": "화계 성공 기본 경로"
    }
}
```

실제 fixture에는 생략 없이 모든 필수 entity field를 넣는다. `hiddenSeed`는
테스트 전용 공개값이며 운영 seed를 복사하지 않는다.

### Fixture 불변식

- 양쪽에서 같은 numeric ID를 사용한다.
- 이름과 정렬 순서에 영향을 주는 문자열도 명시한다.
- `undefined`를 사용하지 않는다. 값 없음은 `null`, collection 없음은 `[]`,
  object 없음은 `{}`로 표현한다.
- 자동 증가 DB ID는 fixture의 의미 식별자로 사용하지 않는다.
- 확률 결과를 임의 stub으로 강제하지 않는다. seed와 입력 상태로 원하는
  분기를 만들고 RNG trace를 고정한다.
- fixture의 기대값은 core 실행 결과에서 생성하지 않는다. ref trace와
  레거시 코드 근거를 함께 기록한다.
- fixture update는 별도 review 대상이며 snapshot 자동 갱신 명령을
  제공하지 않는다.

## 실행 모드

### `full-turn`

기본 모드다. 양쪽의 실제 예약 턴 실행 순서를 거친다.

- lived-month 증가
- preprocess trigger, 부상 회복, 병력 군량
- block
- 필요 시 국가 명령
- 일반 명령 제약, term stack, cooldown, alternative
- 명령별 RNG
- queue shift
- killturn, myset, autorun limit
- next turn time
- retirement/deletion
- DB flush와 로그 확정

55개 호환 판정은 이 모드의 결과로 한다.

### `command-only`

수식과 RNG 분기를 좁게 진단하는 보조 모드다. 전체 호환 판정의 근거로
단독 사용하지 않는다. full-turn 실패가 preprocess/queue 문제인지 명령
resolver 문제인지 분리할 때 사용한다.

## ref runner 계약

`general_command_trace.php`는 다음 조건을 모두 만족해야 한다.

- `PHP_SAPI === 'cli'`
- 명시적인 `SAMMO_GENERAL_COMPARE=1` guard
- stdin의 fixture 한 개만 처리
- case 전용 DB 이름 외 연결 거부
- fixture seed 후 `TurnExecutionHelper`의 실제 경로 호출
- logger를 flush하고 DB 결과를 읽은 뒤 JSON 한 개 출력
- stdout에는 JSON만, 진단은 stderr
- 기존 명령 계산·정렬·RNG·DB mutation 순서를 바꾸지 않음
- 종료 전 원본 template/main DB가 변하지 않았음을 runner가 검사

출력은 engine-specific raw state와 trace를 담는다. canonical 변환은
`referenceProjection.ts`가 수행한다. PHP와 TS projection이 서로의
오류를 그대로 복제하지 않도록 한 구현을 공유하지 않는다.

현재 `TurnExecutionHelper`는 내부에서 RNG를 직접 생성하므로 `ng_compare`에
최소 test seam이 필요하다. 기본값은 기존 `new RandUtil(new
LiteHashDRBG(seed))`를 그대로 사용하고, CLI guard가 활성화된 경우에만
같은 DRBG를 tracing proxy로 감싸는 factory를 주입한다. observer on/off에서
동일 fixture의 DB 결과가 같다는 계측 무영향 테스트를 ref에 둔다.

## core runner 계약

### memory runner

- fixture를 `TurnWorldSnapshot`, `TurnWorldState`,
  `InMemoryReservedTurnStore`로 변환
- production `createReservedTurnHandler`와 `InMemoryTurnProcessor` 사용
- fixture가 선언한 한 장수의 한 due turn만 실행
- 실행 전후 world, dirty state, queue, logs와 RNG trace 반환

`reservedTurnHandler`도 RNG를 내부 생성하므로 production default를 보존하는
선택적 `rngFactory(domain, seed)` test seam을 둔다. 옵션을 생략한 경로는
현재 구현과 byte-for-byte 같은 DRBG를 만들고, 테스트만 tracing wrapper를
반환한다. seed 구성 자체를 runner에서 다시 구현하지 않는다.

### database runner

- 같은 fixture를 case PostgreSQL에 seed
- production loader로 새 `InMemoryTurnWorld` 생성
- 같은 handler/processor 실행
- production `databaseHooks`로 commit
- 모든 connection을 닫고 새 loader/Prisma query로 결과 재조회
- memory projection과 persisted projection 비교

테스트 전용 runner가 `buildCityUpdate` 같은 private production helper를
복제해 직접 호출해서는 안 된다. 반드시 production hook 경계를 지나야
`City.state`/`City.meta.state`와 같은 투영 오류를 검출할 수 있다.

## RNG trace

RNG trace entry는 다음 형태다.

```json
{
    "domain": "generalCommand",
    "sequence": 3,
    "operation": "nextInt",
    "arguments": { "maxInclusive": 99 },
    "result": 42
}
```

domain은 최소 다음을 구분한다.

- `preprocess`
- `nationCommand`
- `generalCommand`
- `uniqueLottery`
- 명령이 추가로 분리한 명시적 child domain

비교 규칙:

- entry 수 exact
- domain과 sequence exact
- primitive RNG operation exact
- arguments exact
- integer/byte/bit result exact
- float는 JSON number의 실제 값 exact

PHP/JavaScript의 동일 계산 결과가 표현 차이만 보이는 경우에도 RNG trace
허용치를 넓히지 않는다. 게임 상태 수치에 불가피한 부동소수점 차이가 있으면
필드별 compatibility rule을 근거와 함께 별도 등록한다.

## Canonical snapshot

결과 envelope:

```text
schemaVersion
fixtureId
engine                       ref | core-memory | core-db
execution
  requestedCommand
  resolvedCommand
  outcome                    success | command-failure | constraint-denied | fallback | error
  blockedReason
  nextTurnTime
before
after
delta
rng
unmappedChanges
```

`before`와 `after`는 다음 collection을 ID/복합 key로 정렬한다.

### 일반 상태

- world: year, month, tick/turn term, killturn 설정과 명령이 읽거나 바꾼 env
- generals: scalar stats, 소속, 관직, 자원, 병력, 부상, 장비, 특기, 성격,
  능력 경험, turn time, lastTurn
- general meta: killturn, myset, autorun/cooldown, 계승, command별 변경 key
- item inventory: instance ID 자체보다 item key, slot, charges와 values
- rank: `(generalId, type, value)`

### 도시·국가·관계

- cities: 소속, state, 인구와 최대치, 내정치와 최대치, 수비·성벽, 보급,
  전선, trust, trade, region, conflict
- nations: 수도, 군주, 규모, 자원, 기술, power, type과 명령 관련 meta
- troops: leader/id, nation, name와 membership에 의해 바뀐 장수 troopId
- diplomacy: 양방향 row를 `(srcNationId, destNationId)`로 정렬하고 state,
  term, dead/showing과 의미 meta 비교

### side-effect collection

- generalTurns, nationTurns: logical key, action, args와 순서
- logs: scope, category, subtype, year, month, 대상 ID와 최종 formatting text
- messages
- events
- hall/archive rows
- inheritance point/log/result
- access-log 변경
- 생성·삭제된 entity ID

DB auto ID, `createdAt`, `updatedAt`, connection별 sequence와 물리 JSON key
순서는 제거한다. JSON object key는 정렬하지만 array 순서는 보존한다.
core memory log는 production `finalizeLogEntry`를 같은 고정 year/month/time
context로 통과시킨 뒤 persisted/ref log와 비교한다.

## 명령 seed 밖의 난수

사료 NPC 랜덤임관의 PHP 전역 `shuffle()`처럼 `RandUtil` 밖의 난수는
명령 seed만으로 재현할 수 없다. 이 값을 무시하거나 fixture에서 해당
분기를 제외하지 않는다.

비교 환경에서는 외부 비결정값을 명시적 input tape로 취급한다.

```json
{
    "externalDecisions": [
        {
            "domain": "legacyGlobalShuffle",
            "input": [201, 202, 203],
            "output": [203, 201, 202]
        }
    ]
}
```

- ref `ng_compare`는 CLI guard 아래에서만 해당 shuffle 호출을 작은 wrapper로
  통과시키고 tape의 permutation을 사용한다.
- core runner도 같은 permutation을 입력으로 사용한다.
- input/output 원소가 정확한 permutation이 아니면 실패한다.
- guard가 꺼진 wrapper는 PHP builtin `shuffle()`을 그대로 한 번 호출한다.
- 계측 on/off의 deterministic 경로 무영향 테스트와, guard-off shuffle의
  permutation property test를 별도로 둔다.
- canonical trace에는 external decision의 소비 순서도 포함한다.

따라서 이 경로의 호환 의미는 “같은 외부 shuffle 결과가 주어졌을 때 이후
후보 평가, `RandUtil` 소비와 선택 결과가 같다”이다. PHP 전역 RNG 자체를
core command seed와 같다고 주장하지 않는다.

## 변경 경로 감사

fixture가 명시한 필드만 비교하면 예상하지 못한 side effect를 놓칠 수 있다.
각 runner는 engine raw state의 before/after diff도 만든다.

- 알려진 raw path는 canonical mapping registry에 연결한다.
- 명령이 바꾼 raw path가 canonical path나 명시적 ignore rule에 연결되지
  않으면 `unmappedChanges`에 넣고 실패한다.
- ignore rule은 timestamp, auto ID처럼 게임 의미가 없는 필드만 허용한다.
- ignore entry에는 engine, raw path pattern, 이유와 근거 파일을 기록한다.
- broad wildcard로 `aux`, `meta` 또는 전체 table을 무시하지 않는다.

이 gate는 새로운 aux/meta key나 누락된 persistence table을 조용히
통과시키지 않기 위한 것이다.

## 비교 규칙

기본은 deep exact equality다.

정규화 허용:

- snake_case ↔ camelCase
- `intel` ↔ `intelligence`
- ref scalar/aux/rank ↔ core typed field/meta/rank row
- `None` ↔ `null`인 장비 없음 표현
- DB가 부여한 ID와 timestamp 제거
- JSON object key 정렬

정규화 금지:

- 반올림, truncation 또는 clamp 결과 변경
- RNG 호출 추가/삭제/재정렬
- collection 정렬로 실제 처리 순서 은폐
- 로그 문구나 조사 차이를 임의로 제거
- 누락 row를 기본값으로 만들어 일치시킴
- 도시 `state`와 `meta.state`처럼 소유권이 다른 필드를 같은 값으로 간주

필드별 허용 차이는 `compatibility-rules.json`에 다음을 반드시 기록한다.

- fixture 또는 command
- canonical path
- 허용 조건
- 레거시/core 근거 파일
- 사용자 상태와 이후 턴에 영향이 없는 이유
- 제거 예정 여부

## 화계 첫 acceptance matrix

설계 검증의 첫 명령은 `che_화계`로 한다. 최소 fixture:

| fixture                  | 보호할 계약                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `success-basic`          | 비용, 성공, 농업·상업 피해, state 32, 경험·공헌·지력 경험·firenum, queue/LastTurn/log |
| `failure-probability`    | 실패 RNG, 피해·부상·아이템 소비 없음, 실패 경험/공헌 범위                             |
| `probability-clamp-zero` | 음수 계산 결과 0 clamp와 RNG 소비                                                     |
| `probability-clamp-max`  | 0.5 상한, 거리 나눗셈 순서                                                            |
| `defence-population`     | 대상국 장수만 포함, 최대 지력, 인원 log2, 보급·치안 보정                              |
| `injury-and-item`        | 장수별 부상 판정/상한 80, crew/train/atmos 0.98 절삭, 일회용 아이템 소비              |
| `damage-clamp`           | 낮은 농업·상업에서 0 미만 방지                                                        |
| `constraint-denied`      | 중립/같은 도시/자원/보급/불가침 제약과 queue fallback                                 |

`success-basic`과 확률 상한 fixture는 `City.meta.state`와 `City.state`
혼동을 검출한다. 상한 fixture에서 실제로 이 결함을 발견해 화계 성공 시
물리 `City.state=32`를 저장하도록 수정했다. 같은 fixture 묶음에서 선동의
전체 city spread가 불필요한 front 재계산을 일으키는 문제와 MariaDB
`city.trust FLOAT` 재조회 정밀도 차이도 발견해 부분 patch와 6자리
유효숫자 저장 경계로 바로잡았다.

결과값 경계 fixture에서는 파괴의 전체 city spread도 선동과 같이
불필요한 front 재계산을 일으키는 문제를 발견해 수비·성벽·state 부분
patch로 좁혔다. 미보급 탈취는 레거시가 자원 감소 update 뒤 원본
`destCity.agri/comm`을 다시 저장하므로 관찰 가능한 최종 자원은 변하지
않는다. 버그로 보이지만 호환 계약으로 보존하고 `state=32`만 남긴다.

부상 경계 fixture에서는 화계의 `계략로 인해` 조사를 레거시
`계략으로 인해`로 수정하고, 선동·파괴에 누락된 대상 장수 부상 로그를
추가했다. 병력·훈련·사기의 0.98 감소는 ref 정수 DB 저장처럼 내림이 아닌
반올림을 적용한다.

## 55개 명령 coverage manifest

`manifest.json`은 PHP command inventory와 TS registry의 합집합을 기준으로
생성 검증한다. 각 명령에는 다음 case class가 필요하다.

- 실행 가능한 기본 경로
- full constraint 거부
- 확률 분기가 있으면 성공과 실패
- 값 clamp/상한/하한이 있으면 경계
- 다중 턴이면 stack 중간과 완료/레거시 reset
- alternative가 있으면 원 명령과 대체 명령
- 생성/삭제/소속 변경이 있으면 관련 collection
- 아이템/특기/국가/관직 보정이 있으면 최소 한 개
- 명령별 외부 side effect가 있으면 해당 collection

적용 불가능한 case class는 `notApplicable`과 레거시 근거를 기록한다.
fixture가 하나 있다는 이유만으로 명령을 covered로 세지 않는다.

inventory gate가 검증할 집계:

- ref command 수
- core command 수
- command별 필수 case class 충족
- fixture schema validation
- orphan fixture
- skip/todo/notApplicable 근거
- unmapped changed path 수

## 실패 출력과 artifact

실패 시 다음만 출력한다.

- fixture ID와 세 engine
- 첫 canonical mismatch path와 양쪽 값
- 전체 RNG trace에서 최초 divergence와 전후 제한된 window
- unmapped raw changed path
- 재현 명령

전체 DB dump, credential, 운영 hidden seed, 사용자 개인정보는 출력하거나
artifact로 저장하지 않는다. 필요하면 canonical JSON만 Git 제외된
`artifacts/general-command/<fixture>/`에 저장하고 민감 필드를 검사한다.

## 실행 명령 계약

구현 후 제공할 명령:

```bash
# stack 준비와 격리 검증
pnpm general-diff:prepare
pnpm general-diff:verify-isolation

# 화계 한 fixture
pnpm general-diff:test --fixture che_화계/success-basic

# 한 명령 전체
pnpm general-diff:test --command che_화계

# 55개 coverage 및 전체 differential/persistence
pnpm general-diff:check
```

명령은 기존 개발 DB를 발견하거나 전용 stack marker가 없으면 실행을
거부한다. `general-diff:check`는 skip이 있으면 실패한다. 진단용
`--allow-skip`은 CI와 완료 판정에서 금지한다.

## CI 단계

### PR fast gate

- fixture/schema/manifest validation
- comparator unit test
- 변경된 명령과 공통 실행기 영향 명령의 differential
- 해당 fixture의 core persistence

### compatibility gate

- 55개 manifest의 모든 필수 case
- ref/core RNG 및 canonical state exact diff
- core memory/persisted exact diff
- unmapped changes 0
- skip 0

명령별 case를 shard할 수 있지만 같은 case DB를 공유하지 않는다.

## Comparator 자체 검증

`generalCommandComparator.test.ts`는 실제 production 결과 없이도 다음
synthetic mismatch를 각각 검출해야 한다.

- 숫자 1 차이
- null과 누락
- array 순서
- RNG operation/result
- 로그 대상과 format text
- queue shift 방향
- 생성 대신 수정
- 삭제 누락
- `City.state`와 `meta.state`
- 알려지지 않은 aux/meta/raw DB 변경

protected behavior를 고의로 perturb한 mutation audit를 fixture review에
포함한다. 단순히 현재 구현을 snapshot으로 저장하고 다시 읽는 테스트는
호환 근거로 인정하지 않는다.

## 구현 순서

1. canonical fixture/schema와 comparator unit test
2. 전용 Compose stack과 원본 DB 불변 isolation test
3. ref `general_command_trace.php`를 `ng_compare`에 추가
4. core memory runner
5. core DB runner와 새 connection reload
6. 화계 acceptance matrix 완성 및 현재 city state 결함 수정
7. 계략 4종으로 공통 runner 검증
8. side-effect family별 대표 명령 확장
9. 55개 manifest 완성
10. project-generated Prisma client를 사용하는 전용 connection readiness
    check 추가
11. `pnpm general-diff:check`를 compatibility gate로 등록

ref 계측 commit, core test/infra commit, 제품 버그 수정 commit은 분리한다.

## 완료 기준

다음이 모두 증명되어야 이 설계의 구현을 완료로 본다.

- 전용 stack이 기존 ref/dev DB를 바꾸지 않는 isolation test 통과
- ref runner가 CLI/test guard 밖에서 접근 불가
- 화계 8개 acceptance fixture 통과
- 화계 `state=32`가 core DB 재조회에도 유지됨
- 각 fixture의 ref/core RNG trace exact 일치
- 외부 비결정 경로는 input tape 소비와 이후 결과 exact 일치
- 55개 명령의 필수 manifest case 충족
- ref/core memory canonical diff 0
- core memory/persisted canonical diff 0
- unmapped changed path 0
- skip/todo 0
- comparator mutation audit 통과
- 관련 typecheck, lint, build와 integration test 통과
- `docs/ref-core2026-mapping.md`에서 동적 검증 근거와 미확인 항목 갱신
- 실행 명령, 기준 commit과 fixture 목록을 `report/`에 기록

이 조건 전에는 정적 제약·로그 검사와 smoke test 통과만으로 일반 장수 명령
전체를 `확인` 또는 이식 완료로 표시하지 않는다.
