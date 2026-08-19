# Frontend legacy parity

This document records the reusable browser fixture and the visual contracts that
are enforced while the PHP frontend is moved to the Vue applications. The
workspace-level `docs/ref-core2026-mapping.md` remains the source of truth for
the end-to-end PHP-to-core2026 mapping.

## Canonical browser fixture

`tools/frontend-legacy-parity/fixtures/canonical.ts` contains deterministic,
non-secret gateway, session, map, and hall-of-fame data. The fixture uses a
synthetic `ga_` game access token so the game router guard follows the same
authenticated path as a real session without contacting a live database.

The test suite intercepts only the tRPC operations required by each screen and
fails on unknown operations. It also serves the checked-out reference image
tree instead of replacing images with layout-neutral placeholders.
`public-gaps.spec.ts` adds bounded fixtures for nation betting and the public
NPC list, including mutations and recoverable API failures.
`tournament-betting.spec.ts` covers the separate tournament and tournament
betting routes, including a recoverable failed bet.
`reference-rankings.mjs` records the authenticated PHP 명장일람 and public
명예의 전당 computed DOM without embedding the reference password.
`battleSimulator.spec.ts` covers the authenticated simulator with and without
an owned general. `battleSimulatorRef.spec.ts` can additionally exercise the
live reference page when its URL, user, and ignored password file are supplied.

Run the suite from the core2026 repository root:

```sh
pnpm typecheck:e2e:frontend-legacy
pnpm test:e2e:frontend-legacy
```

현재 PM2 검증 profile의 실제 PostgreSQL·Redis를 읽는 main 화면 전용 suite는
다음 명령으로 별도 실행합니다. `sammo-verify-che-api` process가 제공하는 환경을
read-only source로 사용하며, 일반 fixture suite에 묵시적으로 섞지 않습니다.

```sh
pnpm test:e2e:main-front-status-live
pnpm test:e2e:main-records-live
```

When another worktree occupies the default ports, set
`FRONTEND_PARITY_GATEWAY_PORT`, `FRONTEND_PARITY_GAME_PORT`, and
`FRONTEND_PARITY_GAME_URL`. If the core2026 worktree is outside the workspace
that owns `image/`, set `FRONTEND_PARITY_IMAGE_ROOT` to that ignored image
checkout. `FRONTEND_PARITY_ARTIFACT_DIR` retains the tournament and betting
screenshots.

Main 화면 전용 suite의 frontend/API port가 사용 중이면
`FRONTEND_PARITY_LIVE_FRONTEND_PORT`와 `FRONTEND_PARITY_LIVE_API_PORT`를
지정합니다.

Run the focused simulator fixture with:

```sh
pnpm --filter @sammo-ts/game-frontend test:e2e:battle-simulator
```

The optional reference check uses `REF_BATTLE_SIM_URL`, `REF_USER_ID`, and
`REF_USER_PASSWORD_FILE`. The password is read inside the test and is never
written to screenshots or reports.

The suite starts both applications at their public prefixes:

- gateway: `http://127.0.0.1:15100/gateway/`
- game: `http://127.0.0.1:15102/che/`

Chromium uses the same locale, timezone, device scale factor, and color scheme
for desktop and mobile checks. Tests assert geometry, computed typography and
texture URLs before checking hover, focus, menu, login mutation, session
storage, route guards, and image loading.

## Enforced contracts

| Screen               | Ref entry point                          | Current automated contract                                                                                                                                                                       |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| gateway login/status | `index.php`                              | 450/700px desktop widths, mobile collapse, Pretendard title, real login mutation/session storage, actual seasonal map asset                                                                      |
| gateway account      | `i_entrance/user_info.php`               | 550px × minimum 575px panel, 14px Pretendard, three legacy textures, success and API-error password flows                                                                                        |
| gateway OAuth join   | `oauth_kakao/join.php`                   | 700px centered registration card, Kakao exchange/register success, retained-input API error, hover/focus                                                                                         |
| gateway Kakao OTP    | `index.php#modalOTP`                     | 동일 문구·500px modal, desktop/mobile geometry와 색상·typography, password/OAuth 진입, autofocus·focus-visible·active·disabled·오류 재시도·session 저장                                          |
| game login hand-off  | unauthenticated `hwe/index.php` redirect | `/che/login` delegates to `/gateway/`                                                                                                                                                            |
| troop                | `hwe/v_troop.php`                        | existing `app/game-frontend/e2e/troop.spec.ts` desktop/mobile geometry and interaction suite                                                                                                     |
| current city         | `hwe/b_currentCity.php`                  | main-page Pretendard 14px, wrapping general-name summary, small reserved-turn lines but normal-size NPC labels, 1000px summary/1024px general tables, 400px selector, 64px icon, nation title color, force summary, actor/spy/admin redaction, and map-click query navigation |
| best general         | `hwe/a_bestGeneral.php`                  | authenticated 500/1000px ranking and unique-item grids, user/NPC switch, 100/64px cell/image geometry, title/button computed styles, retained-data API error                                     |
| hall of fame         | `hwe/a_hallOfFame.php`                   | public 500/1000px container, 100px ranking cells, 64px natural image, title/button/select computed styles, scenario switch and retained-data API error                                           |
| yearbook             | `hwe/v_history.php`                      | 1000px 700+300 desktop grid, 500px stacked grid, month navigation, legacy textures, success and API-error flows                                                                                  |
| inheritance          | `hwe/v_inheritPoint.php`                 | 1000px 3-column desktop and 500px stacked layout, walnut/green textures, Pretendard 14px, scenario unique selector, buff purchase success and retained-input API error                           |
| nation betting       | `hwe/v_nationBetting.php`                | 1000px/6-column desktop and 500px/3-column mobile grids, picked card style, payout table, success and retained-form error                                                                        |
| public NPC list      | `hwe/a_npcList.php`                      | 1000px 12-column table with Chromium-expanded legacy widths, NPC color, eight sorts, retained table/sort after API error                                                                         |
| survey               | `hwe/v_vote.php`, `hwe/ts/PageVote.vue`  | 1000/500px fixed container, blue title/green table textures, list/detail/results/comments, selection/focus/hover, submit and retained-selection API error                                        |
| nation personnel     | `hwe/b_myBossInfo.php`                   | fixed 1000px document at both viewports, chief icon columns, officer/permission/city/kick controls, role redaction                                                                               |
| nation finance       | `hwe/v_nationStratFinan.php`             | 1000/500px at the legacy 940px breakpoint, exact diplomacy grid, policy controls, role gating and failed-mutation rollback                                                                       |
| battle simulator     | `hwe/battle_simulator.php`               | centered 1000px desktop document, 500px responsive stacking, independent/current presets, owned-general import gating, browser Web Worker calculation including 1000 repeats, fixed-seed result/logs, retained input after API error |
| NPC policy           | `hwe/v_NPCControl.php`                   | 1000/500px form and priority-list geometry, walnut/green textures, dynamic zero hints, drag/focus/tooltip, successful save and permission failures                                               |
| tournament           | `hwe/b_tournament.php`                   | fixed 2000px canvas, 16×125px bracket, eight 250px group tables, walnut texture, 1024px overflow, hover/focus                                                                                    |
| tournament betting   | `hwe/b_betting.php`                      | fixed 1120px canvas, 16×70px candidates, four 280px rank tables, exact title/button geometry, retained selection on error                                                                        |

The global game baseline is black, white, Pretendard 14px. Legacy texture
helpers intentionally follow `common.orig.css`: `bg0` is walnut, `bg1` is
green, and `bg2` is blue. Shared `PanelCard` uses the same walnut body and green
header. Screens using the common component therefore render the walnut/green
contract with Pretendard typography.

The survey fixture covers both the poll list and an open detail. Its result
rows are visible before the current general votes when the poll uses the
legacy-compatible `after_vote` mode. The mutation fixture covers voting and
comment submission, while the error fixture confirms that a failed vote keeps
the selected radio option so the user can retry.

## Route coverage rule

Adding or changing a frontend route requires:

1. a verified ref entry-point mapping in the workspace mapping document;
2. deterministic tRPC fixture data for the visible state;
3. desktop and 500px/mobile geometry and computed-style assertions;
4. actual Chromium interaction checks for every visible interactive state;
5. natural image dimensions and `object-fit` checks where images affect layout.

Pixel snapshots may be added after these structural assertions pass. Dynamic
regions must not be hidden merely to make a pixel threshold pass.

개인 공격·수비 기록의 Ref 글자 크기는 checkout의 실제 `formatLog.ts`와 빌드된
`v_main.css`를 사용하는 정적 Chromium fixture로 독립 재현할 수 있습니다. 이
helper는 고정된 비민감 기록 문구만 렌더링하므로 live PHP session이나 DB 저장
경로 검증을 대신하지 않습니다.

```sh
REF_SAM_ROOT=/path/to/ref/sam \
REF_PERSONAL_WAR_LOG_ARTIFACT_DIR=/path/to/ignored/artifacts \
  node tools/frontend-legacy-parity/reference-personal-war-log-font.mjs
```

대응하는 Core 검증은 `inGameMenus.spec.ts`의 “공격·수비 시각” test이며,
`MENU_PARITY_ARTIFACT_DIR`를 지정하면 1200×900·500×900 screenshot과 computed
style JSON을 남깁니다.

같은 Ref collector는 “진격합니다.” 전투 seed marker도 함께 렌더링하여
desktop/mobile의 투명색, 0px 글자 크기, 0×0 rect와 selection text 보존을
수집합니다. Core의 대응 test는 `inGameMenus.spec.ts`의 “전투시드는 메인·내
정보·감찰부에서 숨긴 채 선택할 수 있다”이며 `PLAYWRIGHT_FRONTEND_MODE=production`
과 `MENU_PARITY_ARTIFACT_DIR`를 함께 지정하면 세 화면의 1000×900·500×900
screenshot과 computed JSON을 남깁니다.

To refresh the PHP ranking evidence after building the ignored reference
webpack assets, run:

```sh
REF_RANKING_URL=http://127.0.0.1:3400/sam/ \
REF_RANKING_PASSWORD_FILE=/path/to/ignored/user1_password \
REF_RANKING_ARTIFACT_DIR=/path/to/ignored/artifacts \
node tools/frontend-legacy-parity/reference-rankings.mjs
```

The nation office suite can be run independently:

```sh
pnpm --filter @sammo-ts/game-frontend test:e2e:nation-offices
```

Set `PLAYWRIGHT_FRONTEND_PORT` when the default `15120` port is occupied. For
reference collection, `tools/frontend-legacy-parity/reference-nation-offices.mjs`
records desktop/500px computed DOM and screenshots from the PHP service without
changing its product code.

The NPC policy suite and its reference collector can be run independently:

```sh
PLAYWRIGHT_FRONTEND_PORT=15126 \
  pnpm --filter @sammo-ts/game-frontend test:e2e:npc-policy

REF_PARITY_USER=refuser1 \
REF_PARITY_PASSWORD_FILE=/path/to/password-file \
REF_PARITY_BASE_URL=http://127.0.0.1:3400/sam/ \
  node tools/frontend-legacy-parity/reference-npc-policy.mjs
```

The collector writes desktop and 500px screenshots plus computed DOM JSON only
when `REF_PARITY_ARTIFACT_DIR` is set. It requires an existing reference general
owned by the supplied account and never accepts a password on the command line.

The current-city reference can be collected independently with
`tools/frontend-legacy-parity/reference-current-city.mjs`. It requires
`REF_PARITY_PASSWORD_FILE` and accepts `REF_PARITY_URL`, `REF_PARITY_USER`, and
`REF_PARITY_ARTIFACT_DIR`; the password is read from the ignored secret file
and is never written to the artifact. The matching core fixture is
`app/game-frontend/e2e/inGameInfo.spec.ts`, which writes its computed DOM and
screenshot only when `CITY_PARITY_ARTIFACT_DIR` is set.

Ref's standalone current-city document inherits the browser's 16px Times face
because its page-local includes do not load the in-game Pretendard baseline.
Core intentionally follows the requested main-page 14px Pretendard typography
instead. The Ref row contract still applies to commands: only a non-NPC
general's reserved turns use `general_turn_text`/`x-small`; `NPC 장수`, foreign
nation, and wanderer labels stay at the table's normal font size. The summary
general-name cell must remain wrappable when many generals share a city.

징병·모병의 Ref 화면은 다음 collector로 1000/500px DOM, 이미지 natural size,
불가능 병종 toggle과 hover/focus를 수집합니다. 기본 모드는 현재 Ref session을
사용합니다. 비교 계정이 없는 환경에서는 `REF_STATIC_FIXTURE=1`로 Ref가 빌드한
실제 `v_processing.js`/CSS에 고정 `procRes`만 주입하며, 이 결과는 live PHP/DB
export 검증과 구분합니다. artifact 디렉터리는 Git 밖의 경로를 사용합니다.

```sh
REF_PARITY_PASSWORD_FILE=/path/to/ignored/password \
REF_PARITY_ARTIFACT_DIR=/tmp/ref-recruitment \
  node tools/frontend-legacy-parity/reference-recruitment.mjs

REF_STATIC_FIXTURE=1 \
REF_PARITY_ARTIFACT_DIR=/tmp/ref-recruitment-static \
  node tools/frontend-legacy-parity/reference-recruitment.mjs
```

For a review run that also writes full-page screenshots, create an ignored
artifact directory and set `FRONTEND_PARITY_ARTIFACT_DIR` before invoking the
suite. The ordinary CI run does not write screenshots after successful tests.

Kakao OTP 화면만 실제 Chromium으로 재검증하고 선택적으로 artifact를 남기려면 다음
명령을 사용합니다. Ref helper는 checked-out `index.php` markup과 실제 빌드 CSS를
사용하므로 live Ref service가 없어도 정적 geometry 기준을 재현하지만, OAuth
callback 자체의 provider 검증을 대신하지는 않습니다.

```sh
KAKAO_OTP_ARTIFACT_DIR=/path/to/ignored/artifacts \
  pnpm exec playwright test --config app/gateway-frontend/e2e/playwright.config.mjs \
  app/gateway-frontend/e2e/kakao-otp.spec.ts

REF_SAM_ROOT=/path/to/ref/sam \
KAKAO_OTP_ARTIFACT_DIR=/path/to/ignored/artifacts \
  node tools/frontend-legacy-parity/kakao-otp-ref-geometry.mjs
```
