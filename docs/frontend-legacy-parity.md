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

Run the suite from the core2026 repository root:

```sh
pnpm test:e2e:frontend-legacy
```

The suite starts both applications at their public prefixes:

- gateway: `http://127.0.0.1:15100/gateway/`
- game: `http://127.0.0.1:15102/che/`

Chromium uses the same locale, timezone, device scale factor, and color scheme
for desktop and mobile checks. Tests assert geometry, computed typography and
texture URLs before checking hover, focus, menu, login mutation, session
storage, route guards, and image loading.

## Enforced contracts

| Screen               | Ref entry point                          | Current automated contract                                                                                                  |
| -------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| gateway login/status | `index.php`                              | 450/700px desktop widths, mobile collapse, Pretendard title, real login mutation/session storage, actual seasonal map asset |
| game login hand-off  | unauthenticated `hwe/index.php` redirect | `/che/login` delegates to `/gateway/`                                                                                       |
| troop                | `hwe/v_troop.php`                        | existing `app/game-frontend/e2e/troop.spec.ts` desktop/mobile geometry and interaction suite                                |
| hall of fame         | `hwe/a_hallOfFame.php`                   | 500/1000px container, 100px ranking cells, 64px natural image, walnut/green textures, Pretendard, close-button focus        |

The global game baseline is black, white, Pretendard 14px. Legacy texture
helpers intentionally follow `common.orig.css`: `bg0` is walnut, `bg1` is
green, and `bg2` is blue. Shared `PanelCard` uses the same walnut body and green
header so screens that still use the common component no longer inherit the
discarded Galmuri/parchment visual system.

## Route coverage rule

Adding or changing a frontend route requires:

1. a verified ref entry-point mapping in the workspace mapping document;
2. deterministic tRPC fixture data for the visible state;
3. desktop and 500px/mobile geometry and computed-style assertions;
4. actual Chromium interaction checks for every visible interactive state;
5. natural image dimensions and `object-fit` checks where images affect layout.

Pixel snapshots may be added after these structural assertions pass. Dynamic
regions must not be hidden merely to make a pixel threshold pass.
