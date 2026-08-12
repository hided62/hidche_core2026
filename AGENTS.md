# core2026 작업 지침

## 적용 범위와 목표

이 파일은 `core2026/` 전체에 적용됩니다. 하위 디렉터리에 더 가까운
`AGENTS.md`가 생기면 사용자 지시, 가까운 파일, 이 파일, 상위 작업공간
지침 순으로 적용합니다.

목표는 `../ref/sam`의 PHP 서비스를 TypeScript 런타임으로 호환 이관하는
것입니다. 내부 구조를 더 깔끔하게 만드는 일보다 기존 결과, 상태 전이, 권한,
화면과 운영 경계를 보존하는 일이 우선입니다.

## 현재 기준과 저장소 경계

- `core2026/`은 제품 구현 저장소입니다. gateway/game frontend·API, game engine,
  공통 package, Prisma와 검증 도구가 실제로 존재합니다.
- PHP 기준 구현은 이 저장소 내부 `legacy/`가 아니라 `../ref/sam`입니다.
  `devel`은 변경하지 않는 기준선이고 비교 fixture·계측은 `ng_compare`에만
  두어 주세요.
- 아키텍처 매핑과 보고서는 별도 상위 저장소의
  `../docs/ref-core2026-mapping.md`, `../report/`에 있습니다. 두 Git 경계의
  commit과 상태를 혼동하지 말아 주세요.
- 이미지의 운영 소유자는 외부 Caddy의 `/image/*`입니다. 제품 저장소에 무단
  복제하거나 앱 경로로 rewrite하지 말아 주세요.

작업 시작과 종료에 최소한 다음을 확인해 주세요.

```sh
git status --short --branch
git remote -v
git rev-parse HEAD
```

상위 매핑/보고서를 바꾸면 상위 저장소에서도 같은 검사를 별도로 수행해 주세요.
dirty 파일은 사용자의 변경일 수 있으므로 관련 없는 수정, 정리, stage,
commit 또는 삭제를 하지 말아 주세요.

## 완료 상태를 해석하는 법

이관 상태는 현재 `main`의 코드, Git ancestry, 실행 경로와 ref 비교로
판정해 주세요. 기능 목록이나 report의 완료 표현만으로 전체 이관이 끝났다고
판정하지 말아 주세요.

- 새 차등 fixture가 mismatch를 드러내면 다시 제품 결함으로 분류해 주세요.
- green unit test는 ref 호환, 실제 DB transaction, Chromium geometry 또는
  운영 장애 복구를 자동으로 증명하지 않습니다.
- 환경 변수가 없는 기본 test에서 skip된 integration은 실행된 검증이 아닙니다.
- local/mock prefix E2E와 실제 외부 Caddy·host/firewall 검증은 별도입니다.
- report 제목의 `완료`보다 현재 코드, Git ancestry, 실행 경로와 재현 결과를
  우선합니다.

기능 작업 전에 관련 매핑 항목과 최신 report를 읽고, 오래된 결론은 현재
코드와 commit으로 다시 확인해 주세요.

## 실제 구조와 책임

- `app/gateway-frontend`: 가입·로그인, 로비, 계정, 관리자 운영 UI
- `app/gateway-api`: 계정·세션·profile 정책, operation queue와 PM2
  orchestration
- `app/game-frontend`: profile별 게임 SPA와 ref 호환 UI
- `app/game-api`: tRPC/SSE, 조회·입력 API와 battle/auction/tournament worker
- `app/game-engine`: turn daemon, scheduler, 월간 lifecycle와 DB flush
- `packages/common`: 타입, 직렬화, RNG와 공통 유틸리티
- `packages/logic`: 전투·명령·월간 action과 typed action module 도메인 로직
- `packages/infra`: gateway/game Prisma schema, migration과 client
- `tools/integration-tests`: PostgreSQL/Redis 및 ref↔core 차등
- `tools/frontend-legacy-parity`: 실제 Chromium 비교
- `tools/legacy-db-migration`: 장기보존 데이터 CLI 이관

`tools/build-scripts/build-server.mjs`는 현재 profile resource 복사
placeholder입니다. 이를 완성된 배포 bundle이나 검증된 profile build로 설명하지
않습니다. 운영 build/reset/open은 gateway operation, commit별 worktree와
orchestrator 실행 경로를 조사해 주세요.

장수 action은 `packages/logic/src/actionModules/`에 둡니다. 계산 fold,
priority/unique-ID trigger와 닫힌 의미 이벤트를 한 범용 hook으로 합치지
말아 주세요. 제품용 module 순서는 `loadActionModuleBundle()`의
`RefOrderedActionStack`에서만 조립하며, 새 의미 이벤트는
`GeneralActionEventPayloadMap`에 payload와 필수 context를 먼저 선언해
주세요. 자세한 계약은 `docs/architecture/action-module-protocol.md`에
있습니다.

## 레거시 매핑과 비교

기능을 변경하기 전에 다음을 end-to-end로 연결해 주세요.

1. ref entry point와 호출 순서
2. PHP domain class, SQL read/write, template/CSS/JS와 사용자 출력
3. core service/router/action/loader/flush와 frontend 호출부
4. session/auth, validation, transaction, 비동기 경계와 오류 복구
5. RNG 생성·소비와 persistence 순서

`../docs/ref-core2026-mapping.md`에는 1:1 대응을 억지로 만들지 말고 1:N/N:1
소유권과 변환 지점을 기록해 주세요. `확인`, `부분 확인`, `가설`, `미구현`,
`의도적 차이`를 근거와 함께 사용해 주세요. 문서와 코드가 다르면 먼저 양쪽 기준
commit과 실제 실행을 확인하고 사실관계를 고쳐 주세요.

ref 계측이 필요하면 다음을 지켜 주세요.

- `devel`에 test, endpoint, fixture나 debug 코드를 commit하지 말아 주세요.
- 기존 `ng_compare` 이력과 분기 기준을 조사하고 reset/overwrite하지 말아 주세요.
- 계측은 최소·deterministic·가능하면 read-only로 두고 test 환경 guard를
  사용해 주세요.
- 계측 유무가 결과, RNG 소비, DB mutation과 출력 순서를 바꾸지 않는지
  확인해 주세요.
- ref와 core 변경은 서로 다른 저장소와 commit으로 관리해 주세요.

## 호환성 우선순위

1. 전투 결과, 계산식, 판정·반올림·정렬과 RNG 소비 순서
2. 턴/명령 조건, 자원 변화, DB 상태 전이와 권한
3. API 요청·응답·오류, session과 인증
4. 문구, 로그, 화면 흐름과 룩앤필
5. 내부 구현 세부사항

레거시의 이상해 보이는 동작도 계약일 수 있습니다. 보안 또는 데이터 손상 위험이
아니면 우선 같은 동작을 재현하고 개선 제안은 분리해 주세요. 허용하는 차이는
사용자 경험, 저장 상태와 후속 턴 결과에 영향이 없다는 근거를 mapping/report에
남겨 주세요.

## 인증과 권한

- actor, general과 archive owner는 인증 session/token에서 서버가 결정합니다.
  client가 보낸 user ID, general ID, owner, role을 권한 근거로 신뢰하지 말아 주세요.
- game token의 profile, role, sanction과 장수 생성 정책을 world mutation보다
  먼저 확인해 주세요.
- 새 browser flow는 `x-session-token` 또는 현재 session transport를 사용하고
  token을 query string이나 로그에 노출하지 말아 주세요.
- 실패한 logout에서 client token을 먼저 버려 서버 revoke 실패를 숨기지 말아 주세요.
- 비밀번호 원문·OAuth credential·global salt·private key·session token을
  Git, CLI argument, build log, report 또는 screenshot에 넣지 말아 주세요.
- `VITE_*`는 공개값입니다. 비밀값은 Git 제외 파일이나 `/run/secrets/...`를
  사용해 주세요.

API를 변경하면 성공뿐 아니라 무인증, 다른 사용자, sanction/role, 잘못된
입력과 경계값을 검사해 주세요. 권한 테스트는 router mock만으로 끝내지 않고 위험도에
따라 실제 HTTP transport까지 확인해 주세요.

## 턴, transaction과 RNG

현재 gameplay mutation의 내구성 기준은 PostgreSQL `input_event`입니다.

```text
API request
  -> input_event accept/idempotency
  -> daemon claim + lease/fencing 확인
  -> in-memory action/turn/monthly handlers
  -> world/log/queue/result flush
  -> input_event 완료를 같은 transaction으로 commit
  -> realtime 알림
```

- Redis pub/sub은 best-effort fan-out이며 mutation commit의 source of truth가
  아닙니다.
- daemon lease/fencing을 우회하거나 이전 owner의 stale transaction을
  commit 가능하게 만들지 말아 주세요.
- 예약 queue의 revision/CAS, repeat/bulk 직렬화와 API/daemon race를 보존해 주세요.
- 새 persistence field는 Prisma schema, 새 migration, domain/model type,
  loader, in-memory dirty state, transaction flush와 reload test까지 연결해 주세요.
- 기존 migration 파일이나 checksum을 수정하지 말아 주세요.
- 전투·명령·월간 action의 호출, state patch, 로그와 RNG 소비 순서를
  리팩터링 편의로 바꾸지 말아 주세요.

게임 난수는 `packages/common/src/util/LiteHashDRBG.ts`, `RNG.ts`,
`RandUtil.ts` 흐름을 사용해 주세요. `Math.random()` 같은 임의 경로를 gameplay에
추가하지 말아 주세요. 후보가 하나뿐인 선택, 실패 분기, fallback에서도 ref가
소비하는 RNG call을 생략하지 말아 주세요.

전투/RNG 변경에는 fixed seed 결과뿐 아니라 RNG trace, 로그, 전체 state
side effect와 실패 경로의 ref 비교가 필요합니다. comparator ignore를 늘리기
전에 canonical snapshot에서 누락된 field가 없는지 확인해 주세요.

## 프론트엔드와 룩앤필

새 디자인 시스템이나 현대적 재해석을 임의로 도입하지 말아 주세요. 보존 범위는
layout, font, line-height, 줄바꿈, 색상, texture, border, shadow, opacity,
이미지 natural size/aspect ratio/object-fit과 표시 순서입니다.

- gateway `/gateway/`, game `/che/`와 `/hwe/` prefix에서 direct navigation,
  refresh, tRPC, SSE와 asset URL을 확인해 주세요.
- `kwe`, `twe`, `nya`, `pya`, `pwe`가 코드에 있어도 외부 route가 활성화된
  것으로 가정하지 말아 주세요.
- `/image/*`를 frontend build artifact로 가져오거나 root 배포 URL로
  하드코딩하지 말아 주세요.
- 공통화는 동일한 렌더링 계약이 확인된 token/shell에 한합니다. `.error`,
  `.stack`처럼 이름만 같은 page selector를 전역화하지 말아 주세요.
- `v-html`은 입력 source와 sanitization/allowlist를 확인해 주세요. 기존 warning을
  일괄 disable하지 말아 주세요.

UI를 변경하면 실제 Chromium을 사용해 주세요.

- ref와 core에 같은 Chromium, viewport, device scale, zoom, locale, font,
  image와 로그인/test data를 사용해 주세요.
- 전체·영역 screenshot과 `getBoundingClientRect()`,
  `getComputedStyle()`을 수집해 주세요.
- `hover()`, focus, pointer down/up, checked/selected/disabled, dropdown,
  modal과 transition 상태를 실제 interaction으로 만들어 주세요.
- pixel diff mask는 시간·난수 등 불가피한 영역만 최소화하고 이유를 기록해 주세요.
- auth redirect만 확인하고 visual parity라고 주장하지 말아 주세요.
- 민감정보가 보이는 artifact는 저장하거나 report에 넣지 말아 주세요.

CSS layer와 selector 경계는 `docs/frontend-css-architecture.md`, 비교 실행은
`docs/frontend-legacy-parity.md`를 따라 주세요.

## DB와 레거시 데이터 이관

Gateway는 기본 `public`, game은 profile별 PostgreSQL schema를 사용합니다.
schema 변경 후 최소한 다음을 위험도에 맞게 확인해 주세요.

- 빈 DB migration 전체 적용
- 두 번째 deploy가 no-op인지
- 기존 설치에서 증분 적용되는지
- unique/FK/index와 runtime query 일치
- rollback 또는 backup/restore 경로

`prisma db push`는 격리된 fixture에서 scoped schema 확인용으로만 사용하고
정식 migration chain을 대신하지 말아 주세요.

레거시 DB 이관은 `tools/legacy-db-migration` CLI만 사용해 주세요.

- dry-run이 기본이며 실제 쓰기는 명시적 `--apply`가 필요합니다.
- DB URL과 secret은 환경/secret file로 전달해 주세요.
- PostgreSQL advisory lock, stable legacy key와 idempotent upsert를 보존해 주세요.
- 현 시즌 `general/city/nation`, queue, message, market, log와 seasonal
  storage를 장기보존 이관에 섞지 말아 주세요.
- 운영 apply 전 backup, maintenance mode, source/target count와 rollback
  절차를 다시 확인해 주세요.
- dump에 우연히 있는 table이 아니라 ref schema와 사용자 범위를 기준으로
  삼아 주세요.

## 환경과 배포

`.env` 또는 secret key를 추가하기 전에 `.gitignore`와 `.env.example`을
함께 갱신해 주세요. example은 모든 필수 key와 명백한 placeholder를 포함하되 실제
비밀을 담지 말아 주세요.

전체 작업공간의 개발 PostgreSQL/Redis는
`../docker_compose_files/development/`에서 worktree별로 격리할 수 있습니다.
통합 fixture는 schema truncate와 Redis 초기화를 수행할 수 있으므로 병렬
worktree가 같은 instance를 공유하지 않도록 해 주세요. volume 삭제 명령은 사용자가
명시적으로 데이터 폐기를 요청하지 않으면 실행하지 말아 주세요.

현재 외부 호스트 계약은 `0.0.0.0` bind와 `/gateway/`, `/che/`, `/hwe/`
prefix입니다. Caddy는 외부 인프라로 취급하고 요청 없이 설정 변경을 전제하지
않습니다. local preview/mock 성공을 외부 HTTPS 성공으로 보고하지 말아 주세요.

Gateway preview를 검증할 때 최소 계약은 다음과 같습니다.

```sh
VITE_APP_BASE_PATH=/gateway \
VITE_GATEWAY_API_URL=/gateway/api/trpc \
VITE_GAME_API_URL_TEMPLATE='/{profile}/api/trpc' \
VITE_GAME_WEB_URL_TEMPLATE='/{profile}/' \
pnpm --filter @sammo-ts/gateway-frontend build
```

profile별 정확한 포트와 game frontend/API 변수는
`docs/e2e-caddy-routing.md`에서 확인하고 현재 인프라와 대조해 주세요.

## 개발과 검증 절차

1. 현재 branch/status/remote, 사용자 변경과 가까운 지침을 확인해 주세요.
2. 관련 mapping/report와 ref/core 호출 경로를 조사해 주세요.
3. 보존할 계약, 허용할 차이와 검증 범위를 먼저 정합니다.
4. 코드와 함께 type/schema/migration/fixture/mapping을 갱신해 주세요.
5. 좁은 단위 test → typecheck/lint/build → DB integration → ref 차등 →
   Chromium E2E 순으로 위험에 맞게 넓혀 주세요.
6. 명령, 결과, skip/미검증과 baseline failure를 분리해 report에 기록해 주세요.
7. 양쪽 Git diff/status와 필요한 ancestry를 다시 확인해 주세요.

기본 정적 검사는 실제 루트 script를 사용해 주세요.

```sh
CI=1 pnpm typecheck
pnpm check:architecture
pnpm lint
pnpm test
pnpm build
```

- 모든 코드 변경 후 `CI=1 pnpm typecheck`를 실행해 주세요.
- package import나 파일 위치를 변경한 뒤 `pnpm check:architecture`를 실행해
  주세요. `packages/logic`의 runtime I/O는 `ports/` interface와 app/infra
  adapter로 분리합니다.
- `pnpm test`의 skip 수를 pass처럼 보고하지 말아 주세요.
- Vitest file/name filter는 package script 뒤에 불필요한 `--`를 넣지 말아 주세요.
  예: `pnpm --filter @sammo-ts/game-engine test monthlyCoreEventHandler.test.ts`
- frontend package의 `test` placeholder를 실제 UI 검증으로 오해하지 말아 주세요.
  해당 Playwright script 또는 legacy parity suite를 사용해 주세요.
- 전체 lint/test의 기존 실패가 있으면 targeted 결과와 baseline 재현 결과를
  구분하고, 관련 없는 기대값을 완화해 숨기지 말아 주세요.

외부 서비스 없는 기본 integration:

```sh
pnpm test:integration
```

전용 PostgreSQL/Redis를 준비한 조건부 전체 경계:

```sh
pnpm test:integration:conditional
```

ref 명령과 UI entry point:

```sh
pnpm check:legacy:general
pnpm check:legacy:nation
pnpm test:e2e:frontend-legacy
```

각 command가 요구하는 ref checkout, Docker, DB URL, secret과 fixture는 관련
docs에서 확인해 주세요. 존재하지 않는 명령을 오래된 report나 제안 문서만 보고
실행하지 말아 주세요.

## 코드 스타일

- Vite, Vue/Volar와 compiler API 소비자는 workspace 전체에서 정확히
  TypeScript `6.0.3`을 사용해 주세요. CLI project build/typecheck는 root의
  `@typescript/native` alias로 고정한 TypeScript 7 `tsc`를 사용하며 package-local
  다른 compiler version이나 직접 `tsc` 호출을 추가하지 말아 주세요.
- TypeScript/JSON/Vue SFC는 기존 4-space 스타일을 유지해 주세요.
- public API는 명시적 타입을 사용하고 `any`, 불필요하게 넓은 `unknown`,
  `as unknown as` 우회를 피해 주세요.
- Vue component는 PascalCase, composable은 `useX`, 변수/함수는 camelCase,
  type/class는 PascalCase를 사용해 주세요.
- 한국어 domain identifier와 설명은 의미가 더 명확할 때 유지해 주세요.
- action/command/전투 코드에는 한국 독자가 side effect와 ref 근거를 이해할
  수 있는 주석을 남기되 코드의 반복 설명은 피해 주세요.
- 기능 이관과 무관한 대규모 formatting/refactor를 같은 변경에 섞지 말아 주세요.

## 문서와 보고서

기능·운영·호환성에 의미 있는 변경은 코드와 같은 작업에서 다음을 갱신해 주세요.

- `README.md`: 사용자가 알아야 할 현재 구조, 시작점과 운영 경계
- 이 `AGENTS.md`: 반복 작업 규칙과 검증 계약
- `docs/*`: core2026 내부 구현·운영 상세
- `../docs/ref-core2026-mapping.md`: ref↔core 근거와 상태
- `../report/YYYY-MM-DD-간결한-작업명.md`: 재현 가능한 인수인계

보고서에는 목적/범위, 조사한 ref, 변경 파일, 보존 계약, 명령과 결과,
skip/미검증, 알려진 차이, 후속 작업과 저장소별 commit을 포함합니다. commit
전이면 `커밋 전`으로 기록하고 서로 다른 저장소의 hash를 명확히 구분해 주세요.

## Git, worktree와 commit

- 중·장기 작업은 전용 branch/worktree와 고유 DB/Redis instance에서 합니다.
- 최신 `main`을 통합하고 회귀를 확인한 뒤 요청된 범위에 따라 local `main`에
  병합해 주세요. 원격 push는 별도 요청 없이는 하지 말아 주세요.
- 관련 없는 사용자 변경을 stage/commit/revert하지 말아 주세요.
- ref 비교 변경과 core 제품 변경, 상위 mapping/report 변경은 각 Git
  저장소에서 별도 commit해 주세요.
- 생성물, `.env`, DB volume, log, coverage, screenshot, test-results와
  secret을 commit하지 말아 주세요.
- worktree 정리는 clean status와
  `git merge-base --is-ancestor HEAD <baseline>`을 모두 확인한 뒤 non-force
  제거해 주세요. 이름, 나이 또는 uncommitted 여부만으로 삭제하지 말아 주세요.
- 사용자가 commit을 요청하지 않은 일반 작업은 diff와 권장 commit 경계를
  준비하되 임의로 commit하지 말아 주세요.

## Qwen 보조 분석

Qwen은 대규모 파일 목록, diff·로그 분류, 반복 추출과 누락 후보 재검색에만
사용해 주세요. 필요한 최소 발췌만 전달하고 secret, 개인정보와 환경 파일 값을
보내지 말아 주세요.

- 아키텍처·보안·DB mutation·전투/RNG 판단과 최종 검증을 위임하지 말아 주세요.
- 결과는 파일, Git, test 또는 실제 trace로 독립 검증해 주세요.
- 응답 budget은 128–4096 token 범위로 제한해 주세요.
- 실패하면 health 확인 후 일시 오류일 때 한 번만 재시도하고, 선택적 작업이면
  로컬 분석을 계속해 주세요.
