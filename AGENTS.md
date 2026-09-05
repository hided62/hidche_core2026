# core2026 작업 지침

## 적용 범위와 문서 역할

이 파일은 `core2026/`의 제품별 추가 규칙을 담습니다. 사용자 지시, 더 가까운
AGENTS, 이 파일, [상위 AGENTS](../AGENTS.md) 순으로 적용합니다. 공통 Git·보고·
보안·Ref 계약은 상위 지침을 따르며, 아래에 같은 정책을 별도로 재정의하지 않습니다.

상위 지침의 상대 경로는 `sam_rebuild/`, 이 파일의 경로는 `core2026/` 기준입니다.
독립 checkout에서 상위 작업공간 문서를 참조할 수 없으면 실제 작업공간 위치를
확인하고, 확인하지 못한 규칙이나 Ref 근거를 읽었다고 보고하지 않습니다.

| 작업                       | 상세 기준                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| 구조·파일 책임             | [README](README.md#저장소-구성), [개발자 핸드북](docs/developer/index.md)                  |
| Ref 비교·계측·분류         | [상위 호환성 계약](../AGENTS.md#호환성-계약), [매핑](../docs/ref-core2026-mapping.md)      |
| 테스트 준비·실행·오류 복구 | [테스트 정책](docs/testing-policy.md)                                                      |
| CSS·실제 Chromium 비교     | [CSS 구조](docs/frontend-css-architecture.md), [호환 검증](docs/frontend-legacy-parity.md) |
| DB 이관                    | [이관 절차](tools/legacy-db-migration/README.md)                                           |
| 배포 대상 선택             | [환경 라우팅](../docs/docker-environment-routing.md)                                       |
| prefix·빌드 변수           | [Caddy 계약](docs/e2e-caddy-routing.md)                                                    |
| Gateway·profile 릴리스     | [릴리스 운영](docs/release-operations.md)                                                  |

PHP 기준 구현은 `../ref/sam`이며 이 저장소 내부 `legacy/`가 아닙니다.
매핑과 `../report/`는 별도 상위 Git 저장소 소유입니다. 변경 시작·종료에
각 저장소의 status·branch·remote·HEAD를 확인하고 관련 없는 dirty 변경을 보존합니다.

## 완료 상태를 해석하는 법

이관 상태는 현재 `main`의 코드, Git ancestry, 실행 경로와 ref 비교로
판정해 주세요. 기능 목록이나 report의 완료 표현만으로 전체 이관이 끝났다고
판정하지 말아 주세요.

- 새 차등 fixture가 mismatch를 드러내면 계승 계약, 의도적 제품 차이, 누락·회귀,
  비교 불가 중 무엇인지 조사한 뒤 분류해 주세요. mismatch만으로 제품 결함을
  확정하지 않습니다.
- green unit test는 ref 호환, 실제 DB transaction, Chromium geometry 또는
  운영 장애 복구를 자동으로 증명하지 않습니다.
- 환경 변수가 없는 기본 test에서 skip된 integration은 실행된 검증이 아닙니다.
- local/mock prefix E2E와 실제 외부 Caddy·host/firewall 검증은 별도입니다.
- report 제목의 `완료`보다 현재 코드, Git ancestry, 실행 경로와 재현 결과를
  우선합니다.

기능 작업 전에 관련 매핑 항목과 최신 report를 읽고, 오래된 결론은 현재
코드와 commit으로 다시 확인해 주세요.

## 도메인 조립과 비교

장수 action은 `packages/logic/src/actionModules/`에 둡니다. 계산 fold,
priority/unique-ID trigger와 닫힌 의미 이벤트를 한 범용 hook으로 합치지
말아 주세요. 제품용 module 순서는 `loadActionModuleBundle()`의
`RefOrderedActionStack`에서만 조립하며, 새 의미 이벤트는
`GeneralActionEventPayloadMap`에 payload와 필수 context를 먼저 선언합니다.
상세 계약은 [행동 모듈 프로토콜](docs/architecture/action-module-protocol.md)을 따릅니다.

차등 테스트는 계승 계약에 exact equality를 요구합니다. 의도적 제품 차이는
별도 기대값·허용 목록·버전된 fixture로 명시하며 테스트를 끄거나 Ref 기대값에
되맞추지 않습니다. 분류·호출 순서·소유권·계측의 공통 요구는 상위 호환성 계약을
따릅니다.

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
추가하지 말아 주세요. 계승 계약에서는 후보가 하나뿐인 선택, 실패 분기, fallback에서도 Ref가
소비하는 RNG call을 생략하지 말아 주세요.

전투/RNG 변경에는 fixed seed 결과뿐 아니라 RNG trace, 로그, 전체 state
side effect와 실패 경로를 검증합니다. 계승 계약은 Ref와 비교하고 의도적 제품
차이·Core 전용 기능은 문서화한 Core 기대값과 불변조건을 사용합니다. comparator ignore를 늘리기
전에 canonical snapshot에서 누락된 field가 없는지 확인해 주세요.

## 프론트엔드와 룩앤필

UI의 공통 보존·Chromium·artifact 요구는 [상위 UI 지침](../AGENTS.md#ui와-룩앤필)을
따릅니다. 의도적 UX 차이는 Core geometry·interaction 기대값을 명시합니다.

- gateway `/gateway/`, game `/che/`와 `/hwe/` prefix에서 direct navigation,
  refresh, tRPC, SSE와 asset URL을 확인해 주세요.
- `kwe`, `twe`, `nya`, `pya`, `pwe`가 코드에 있어도 외부 route가 활성화된
  것으로 가정하지 말아 주세요.
- `/image/*`를 frontend build artifact로 가져오거나 root 배포 URL로
  하드코딩하지 말아 주세요.
- Gateway와 game frontend의 production source map은 공개 코드에서 개발·장애
  분석 편의를 위해 배포하는 산출물입니다. 보안상 비공개가 필요하다는 별도 요구와
  검토가 없는 한 번들 크기, build 시간 또는 일반적인 "최적화" 지시만으로
  `build.sourcemap`을 끄거나 `.map` 파일을 배포 산출물에서 제외하지 말아 주세요.
- 공통화는 동일한 렌더링 계약이 확인된 token/shell에 한합니다. `.error`,
  `.stack`처럼 이름만 같은 page selector를 전역화하지 말아 주세요.
- `v-html`은 입력 source와 sanitization/allowlist를 확인해 주세요. 기존 warning을
  일괄 disable하지 말아 주세요.

Chromium 비교는 같은 locale과 font도 맞추고 dropdown·modal을 실제로 열어
확인합니다. auth redirect만 확인하고 visual parity로 보고하지 않습니다.
CSS layer와 selector 경계는 `docs/frontend-css-architecture.md`, 비교 실행은
`docs/frontend-legacy-parity.md`를 따릅니다.

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

컨테이너 서비스는 필요한 listener를 `0.0.0.0`에 bind합니다. 로컬 E2E의
`/gateway/`, `/che/`, `/hwe/`와 운영 stack의 활성 prefix를 혼동하지 않습니다.
대상 선택은 상위 환경 라우팅, frontend/API 변수와 preview 명령은
`docs/e2e-caddy-routing.md`를 확인합니다. local preview/mock 성공은 외부
HTTPS 검증과 구분합니다.

## 개발과 검증 절차

상위 [작업 흐름과 검증](../AGENTS.md#작업-흐름과-검증)에 따라 변경 계약에 가까운
검증부터 실행하고, 명령·결과·skip·baseline 실패와 미검증 범위를 보고합니다.
명령 목록·간단 출력 정책·새 worktree 준비·Playwright port 격리는
[테스트 정책](docs/testing-policy.md)을 기준으로 합니다.

- 모든 코드 변경 후 `CI=1 pnpm typecheck`를 실행합니다.
- package import나 파일 위치 변경 후 `pnpm check:architecture`를 실행합니다.
  `packages/logic`의 runtime I/O는 `ports/`와 app/infra adapter로 분리합니다.
- Vitest filter에 불필요한 `--`를 넣지 않습니다.
  예: `pnpm --filter @sammo-ts/game-engine test monthlyCoreEventHandler.test.ts`
- frontend package의 `test` placeholder는 UI 검증이 아닙니다. 해당 Playwright
  script 또는 legacy parity suite를 실행합니다.
- ref checkout·Docker·DB·secret 요구는 해당 실행 문서에서 확인합니다.
  오래된 report만 보고 명령을 가정하지 않습니다.
- 문서만 변경할 때의 검증도 테스트 정책을 따릅니다.

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
- toast·dialog·aria-label·로그처럼 사용자에게 노출하는 동적 한국어 문구에 조사를
  붙일 때는 `@sammo-ts/common/util/JosaUtil`의 `put()` 또는 `pick()`을 사용해 주세요.
  `` `${value}을(를)` ``, `` `${value}이(가)` ``, `` `${value}(으)로` `` 같은 병기 표기를
  실제 제품 문구에 남기지 말고, 받침 있는 값과 없는 값의 최종 표시 문구를 검증해 주세요.
- action/command/전투 코드에는 한국 독자가 side effect와 ref 근거를 이해할
  수 있는 주석을 남기되 코드의 반복 설명은 피해 주세요.
- 기능 이관과 무관한 대규모 formatting/refactor를 같은 변경에 섞지 말아 주세요.

## 문서와 보고서

변경이 영향을 주는 문서만 같은 작업에서 갱신합니다. 구조·시작점은 README,
반복 규칙은 AGENTS, 구현·운영 상세는 `docs/`, Ref 대응은 상위 매핑이 소유합니다.
모든 기능 변경에서 README와 AGENTS까지 기계적으로 수정하지 않습니다.

보고서의 필수 내용과 저장소별 commit 기록은
[상위 보고서 규칙](../AGENTS.md#보고서와-commit)을 따릅니다.

## Git, worktree와 commit

[상위 Git 규칙](../AGENTS.md#저장소와-git-경계)과
[기본 commit 정책](../AGENTS.md#보고서와-commit)을 따릅니다. 일반 작업은
충돌 없는 현재 checkout에서 수행하고, 완료한 관련 변경은 사용자가 금지하지
않았다면 한국어 설명으로 commit합니다. push·merge·배포는 요청된 범위에 한합니다.

Core 제품, Ref 계측, 상위 문서는 각 저장소에서 별도 commit합니다. 생성물,
환경·secret, DB volume, log, coverage, screenshot과 test-results는 제외합니다.
worktree 정리가 요청 범위라면 clean status와
`git merge-base --is-ancestor HEAD <baseline>`을 확인한 뒤 non-force로 제거합니다.
이름·나이·uncommitted 여부만으로 삭제하지 않습니다.
