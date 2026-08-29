# 테스트 정책

## 원칙

- 변경한 계약과 가장 가까운 test부터 실행하고 범위를 넓힙니다.
- deterministic clock, seed와 fixture를 사용합니다.
- ref 호환성은 결과, 순서, RNG, 저장 상태와 출력으로 검증합니다.
- 인증·권한은 session actor, 소유권, role, sanction과 redaction을 포함합니다.
- DB 코드는 실제 PostgreSQL transaction과 reload 경로를 검증합니다.
- UI는 실제 Chromium에서 geometry, computed style과 interaction을 비교합니다.
- skip, baseline failure와 환경 미검증을 pass와 분리합니다.

## 기본 검증

```sh
CI=1 pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

루트 `pnpm test`와 `pnpm build`는 간단 출력이 기본입니다. Turbo는 실패한 task의
로그를 남기고 성공 task의 본문을 생략하며, Vitest를 package에서 직접 실행할 때도
`minimal` reporter를 사용합니다. 테스트별 진행과 성공 task 로그까지 필요한 진단은
각각 `pnpm test-verbose`, `pnpm build-verbose`로 다시 실행합니다. Codex도 일반
검증에는 간단 출력을 사용하고, 실패 원인에 상세 로그가 필요할 때만 verbose 명령을
사용합니다. Gateway 서버 빌드 워커의 streaming 로그는 관리자 관찰 계약이므로 이
로컬 기본값의 영향을 받지 않습니다.

문서만 변경한 경우에도 Markdown link, Prettier, 생성 문서 일치와
`pnpm docs:build`를 확인합니다. 제품 코드 동작을 바꾸지 않은 문서 작업은
typecheck·unit·Chromium 검증을 실행한 것으로 설명하지 않습니다.

## 새 worktree 준비

Playwright 설정의 `webServer`는 frontend package의 `dev` 또는
`vue-tsc && vite build`를 직접 실행합니다. 이 경로는 root Turbo task가
보장하는 Prisma 생성과 upstream package build를 거치지 않으므로, 새 worktree에서
브라우저 test를 먼저 실행하면 제품 코드와 무관한 module/type 오류가 발생할 수
있습니다.

Node 24 환경을 활성화한 뒤 저장소 root에서 다음 한 명령으로 준비합니다.

```sh
fnm use
pnpm test:bootstrap
```

현재 호스트는 `fnm use`가 `.nvmrc`를 읽습니다. nvm 환경에서는 `nvm use`로 같은
Node 24 계약을 적용합니다.

`test:bootstrap`은 다음 순서를 고정합니다.

1. `pnpm install --offline --frozen-lockfile`
2. game/Gateway Prisma client 생성
3. `common → logic → infra → game-engine → game-api → gateway-api` build

로컬 pnpm store에 필요한 package가 없는 호스트에서만 network 사용 가능 여부를
확인한 뒤 `pnpm install --frozen-lockfile`과 `pnpm test:prepare`를
나누어 실행합니다. 이미 install된 worktree에서는 schema, package source 또는
branch가 바뀐 뒤 다음 준비 명령만 다시 실행합니다.

```sh
pnpm test:prepare
```

Chromium executable이 없다는 Playwright 안내가 나온 경우에만 다음을 실행합니다.
이는 package/Prisma 준비와 별도이며 browser cache를 변경합니다.

```sh
pnpm exec playwright install chromium
```

### Browser test 실행

Game frontend fixture의 예시는 다음과 같습니다. Ref 룩앤필 근거가 필요한 UI
변경은 `PLAYWRIGHT_FRONTEND_MODE=production`을 사용해 production bundle을
검증합니다.

```sh
PLAYWRIGHT_FRONTEND_PORT=15241 \
PLAYWRIGHT_FRONTEND_MODE=production \
pnpm --filter @sammo-ts/game-frontend exec playwright test \
  inGameMenus.spec.ts --config e2e/playwright.config.mjs --grep '대상 이름'
```

Gateway fixture는 별도의 port 환경 변수를 사용합니다.

```sh
PLAYWRIGHT_GATEWAY_FRONTEND_PORT=15242 \
pnpm --filter @sammo-ts/gateway-frontend exec playwright test \
  public-map-tabs.spec.ts --config e2e/playwright.config.mjs --grep '대상 이름'
```

Ref/Core 공통 fixture는 root script를 사용하며, 다른 worktree와 port가 겹치면
설정을 편집하지 않고 환경 변수로 격리합니다.

```sh
FRONTEND_PARITY_GATEWAY_PORT=15243 \
FRONTEND_PARITY_GAME_PORT=15244 \
pnpm test:e2e:frontend-legacy
```

같은 game frontend `dist`를 쓰는 CHE/HWE production build와 Playwright run은
동시에 실행하지 않습니다. 각 profile을 직렬로 실행하고 해당 run의 base path,
profile, viewport와 fixture를 결과에 기록합니다.

### 준비 실패와 제품 실패 구분

| 증상                                                                           | 먼저 확인할 항목                                        | 처리                                                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm: command not found`                                                      | `.nvmrc`의 Node 24가 활성화됐는지                       | 현재 호스트는 `fnm use`; nvm 환경은 `nvm use`; shim이 없으면 `corepack enable` 후 재실행  |
| Corepack 하위 실행에서 pnpm version mismatch                                   | package script 안에서 다른 Corepack pnpm이 재호출됐는지 | Node 24 적용 후 직접 `pnpm test:bootstrap` 실행; `corepack pnpm test:bootstrap` 중첩 금지 |
| `Cannot find module '../prisma/generated/...'` 또는 새 Prisma field 부재       | generated client가 현재 checkout schema와 같은지        | `pnpm test:prepare`                                                                       |
| `Failed to resolve import '@sammo-ts/common'`, `@sammo-ts/logic` 또는 `TS6305` | upstream `dist`가 현재 checkout source로 build됐는지    | `pnpm test:prepare`; 계속되면 실패 package의 `build`를 단독 실행해 실제 오류 확인         |
| `Process from config.webServer was not able to start`                          | 위 준비 오류와 frontend build의 숨겨진 stderr           | 준비 후 `pnpm --filter <frontend> build`를 단독 실행                                      |
| `EADDRINUSE` 또는 server timeout                                               | 다른 worktree의 151xx listener                          | 해당 Playwright port 환경 변수로 고유 port 지정; config 임시 수정 금지                    |
| browser executable 부재                                                        | Playwright가 표시한 cache path                          | `pnpm exec playwright install chromium`                                                   |
| `node_modules/.modules.yaml` `EACCES`                                          | 기존 checkout의 소유권이 다른 작업에서 바뀌었는지       | 소유권을 임의 변경하지 말고 같은 commit의 깨끗한 worktree에서 준비·검증                   |

준비 명령이 성공한 뒤 발생한 assertion, browser console, request 또는 geometry
차이만 제품/fixture 분석 대상으로 올립니다. 넓은 suite 실패는 변경 없는 동일
commit에서도 재현하여 baseline과 회귀를 구분하고, skip은 pass로 세지 않습니다.

## 테스트 계층

### Unit

`packages/common`, `packages/logic`, 각 app의 `test/`가 순수 계산, parser,
constraint, lifecycle과 service를 검증합니다. Gameplay 계산에는 fixed seed와
정확한 state/log 기대값을 사용합니다.

### Integration

`tools/integration-tests`와 `*.integration.test.ts`가 PostgreSQL, Redis,
Fastify transport, Prisma transaction, lease와 worker 경계를 검증합니다.

```sh
pnpm test:integration
pnpm test:integration:conditional
```

조건부 suite는 worktree별 PostgreSQL·Redis instance를 준비합니다. Test가
schema truncate와 Redis 정리를 수행하므로 공유 개발 instance를 사용하지
않습니다.

### Differential

```sh
pnpm check:legacy:general
pnpm check:legacy:nation
```

실제 ref runner와 canonical snapshot 계약은
[차등 검증](architecture/turn-state-differential-testing.md)을 따릅니다.

### Browser

```sh
pnpm typecheck:e2e:frontend-legacy
pnpm test:e2e:frontend-legacy
pnpm test:e2e:main-front-status-live
pnpm test:e2e:main-records-live
```

같은 Chromium, viewport, device scale, zoom, locale, font, image, 로그인과
test data를 사용합니다. Screenshot과 함께 `getBoundingClientRect()`와
`getComputedStyle()`을 수집하고 hover, focus, pointer down/up,
checked/selected/disabled, dropdown, modal과 transition을 확인합니다.

## 권한 matrix

API 변경은 최소한 다음 행위자를 구분합니다.

- 무인증
- 인증됐지만 장수가 없는 사용자
- 자기 장수
- 같은 국가의 다른 장수
- 외국 장수
- NPC
- 직책·서비스 role별 사용자
- sanction 대상 사용자

거부 경로는 DB·queue·Redis side effect가 없어야 합니다. Public DTO는 숨겨야
할 field가 빠졌는지 확인하고, role 이름만 비교하지 말고 실제 capability와
resource relation을 검증합니다.

## DB와 migration

Schema 변경은 빈 DB 전체 migration, 기존 DB 증분 migration, 두 번째 deploy의
no-op, unique/FK/index, runtime query와 reload를 확인합니다. 기존 migration
파일과 checksum은 수정하지 않습니다. `prisma db push`는 격리 fixture의
일시적 schema 준비에만 사용합니다.

## 결과 기록

Report에는 실행 명령, commit, 서비스와 fixture, pass/fail/skip 수, baseline
failure, 미검증 경계와 artifact 위치를 기록합니다. Screenshot과 log에는
token, password, 개인정보를 포함하지 않습니다.
