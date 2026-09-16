# Game frontend CSS architecture

The game frontend preserves the rendered contract of `ref/sam`; CSS reuse is
not a reason to normalize a page's width, height, typography, texture, or
interaction states. When reuse and the reference geometry conflict, the
reference geometry wins.

## Layers

`app/game-frontend/src/assets/main.css` is the single global entry point. It
loads the following layers:

1. `styles/tokens.css`: exact shared font, color, and `/image/game` texture
   values. These are value aliases only and must resolve to the same computed
   value as the ref page.
2. `styles/game-shell.css`: the flexible shell shared by the main dashboard,
   public dashboard, and chief center. Only declarations proven identical
   across those screens belong here.
3. `styles/ref-shell.css`: fixed ref geometry, including the 1000px desktop /
   500px mobile family used by the battle center. Its namespace stays separate
   from the flexible shell so a generic responsive rule cannot override it.
4. Scoped SFC styles: page-specific grids, fixed table dimensions, selectors,
   and state styling. These remain closest to the DOM contract they implement.

`styles/legacy-controls.css` is the shared control layer between tokens and the
two shell layers. It owns only control geometry and state rules that are proven
identical in the Ref Bootstrap/Lumen family. A page still owns control width,
grid placement, and any visual family that is not Bootstrap/Lumen.

The Ref-style directory pages share a second, deliberately compact control
family through `LegacySortControls.vue`. Its `.legacy-sort-*` rules own the
explicit dark select/option palette, the raised submit button, and the
focus/active states for sortable table headers. A page supplies only the
available sort keys and placement. NPC·암행부·세력도시는 Ref의 고정 방향을
유지합니다. 장수 일람은 사용자 조작 계약에 따라 로드한 snapshot 위에서
`내림차순 → 오름차순 → 해제`를 순환하고, 여러 열의 방향과 우선순위를 scoped
SFC indicator로 표시합니다. 장수 일람의 성격·특기·부상 설명은 많은 행에서
eager popup instance를 만들지 않는 `DirectoryTooltip.vue` scoped CSS가 소유하며,
mobile에서는 viewport 가장자리 8px 안의 고정 설명판으로 전환합니다. 게임 내
tooltip trigger는 hover/focus 동작과 `cursor: help`를 유지하되, tooltip이 있는 모든
텍스트에 점선 밑줄을 반복하지 않습니다. keyboard `focus-visible` outline은 별도의
접근성 상태로 유지합니다.

## Button composition

Choose the Ref visual family before choosing a semantic color. Buttons from
different historical families are not made identical merely because they have
the same label.

| Ref family                   | Core composition                           | Use                                                                                    |
| ---------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| Bootstrap/Lumen primary      | `.legacy-button.legacy-button--primary`    | commit, purchase, submit, or another affirmative mutation                              |
| Bootstrap/Lumen secondary    | `.legacy-button.legacy-button--secondary`  | reset, cancel, neutral toggle, or load-more                                            |
| Bootstrap/Lumen danger       | `.legacy-button.legacy-button--danger`     | destructive action only when Ref uses `variant="danger"`                               |
| Bootstrap/Lumen info         | `.legacy-button.legacy-button--info`       | informational or edit action only when Ref uses `variant="info"`                       |
| `btn-sammo-base2` navigation | `.legacy-button.legacy-button--navigation` | page back/close and paired reload controls                                             |
| Bootstrap/Lumen dark         | `.legacy-button.legacy-button--dark`       | dark navigation or utility control when Ref uses `btn-dark`                            |
| dynamic Lumen color          | `.legacy-button.legacy-button--lumen`      | nation or scenario color supplied through the shared face/edge/text custom properties  |
| page-specific/native control | feature-namespaced scoped class            | only when Ref computed geometry or interaction differs from the Bootstrap/Lumen family |

The base class supplies accessible link/button normalization and the historical
`base1` fallback used by already measured screens. The Lumen family selector
owns the `0 1px 4px` raised edge and the shared hover/active movement. Its
semantic modifiers only assign `--legacy-button-bg`, `--legacy-button-border`,
and `--legacy-button-color`; custom nation colors use the explicit
`.legacy-button--lumen` structure class and assign those same properties. New
Bootstrap/Lumen controls must add an explicit family or semantic modifier; do
not infer a mutation role from a label such as `구입` in page CSS. A disabled
control keeps its semantic color and uses the shared opacity/cursor state.
Hover and active use the Ref Lumen bottom-border movement rather than an
unrelated brightness filter.

The shared family is opt-in at each rendered control; defining the primitive
does not connect an existing `.main-menu-link`, `.game-shell__action`, or
feature button automatically. `MainNavigationLink.vue` exposes
`lumenVariant="navigation|lumen"` so top-level global and nation links can opt
in while flat popup menu items stay outside the raised family. The main page's
global menu, nation menu, desktop synchronization/reload/lobby controls, and
reserved-turn pull/push/expand row all use the same primitive. When adding a
new main-page control, inventory every desktop/mobile render site instead of
validating one representative button.

The primitive does not set a fixed `min-height`: Ref's 35.5px default height is
the result of line-height, padding, and the 4px edge, so it naturally becomes
34.5px/33.5px while the 1px/2px top margin keeps the bottom coordinate fixed.
A fixed row opts into `.legacy-button--fixed-height` and supplies only
`--legacy-button-height`; the shared layer derives the hover/active heights so
every owner keeps the same bottom-coordinate contract.

Only layout belongs in the SFC: width, grid column, the fixed height variable,
margins required by the page, and breakpoint-specific placement. Color base
variables may be supplied by the owner for dynamic nation/scenario colors, but
border construction, font weight, hover/focus/active, and disabled presentation
belong in `legacy-controls.css` when the Ref family is shared. Generic `.btn`,
`button`, or `.primary` rules must not be promoted globally.

## Class naming

- `.game-shell`, `.game-shell__header`, `.game-shell__actions`: flexible
  application shell.
- `.ref-shell`, `.ref-shell__topbar`, `.ref-shell__control`: measured legacy
  shell and controls.
- `.game-feedback--error`, `.ref-feedback--error`: feedback scoped to its
  visual family.
- Feature-specific classes stay namespaced by their feature or component.
  Generic names such as `.title`, `.error`, `.ghost`, `.stack`, and
  `.layout-grid` must not be promoted from a scoped SFC merely because the same
  spelling appears elsewhere.

Feature hooks stay inside their owning component. Shared presentation uses one
of the explicit shell namespaces.

## Consolidation rule

Before moving declarations out of an SFC:

1. Compare every same-named selector's declarations and semantic role.
2. Confirm the affected pages use the same layout family.
3. Record desktop and mobile `getBoundingClientRect()` and
   `getComputedStyle()` values before the move.
4. Move only identical declarations; keep exceptions in the owning SFC.
5. Re-run Chromium geometry plus hover, focus, active, and disabled states.

The main page and chief center are the flexible-shell references. The battle
center is the fixed ref-shell reference. If another page has a measured ref
contract that differs from both, preserve that page's local contract rather
than forcing it into either family.

## Asset boundary

The CSS variables contain `/image/game/*` URLs but do not import or copy image
files. Caddy continues to own `/image/*`; Vite must not rewrite the image tree
as application assets.


## Game typography tiers

The game UI uses four starting sizes from `assets/styles/tokens.css`:

| Token suffix (`--sammo-font-size-`) | CSS size | Role |
| --- | --- | --- |
| `small` | `normal × 12 / 14` (12px) | Compact controls, metadata, secondary labels |
| `normal` | 14px | Body, tables, ordinary controls |
| `emphasis` | 16px | Emphasized names and section labels |
| `title` | 24px | Page and major section headings |

This is an intentional Core UX policy adopted on 2026-09-15. It is a starting
policy for verified UI, not a claim that every rendered glyph has one of four
computed sizes. Existing geometry and media queries remain owned by each page.
A breakpoint can choose another tier (for example, the personnel nation heading
uses 16px on its narrow layout and 24px on its wide layout).

Use the tokens for new UI. Do not round arbitrary content or all remaining
relative sizes automatically. Before moving an existing label to a tier, compare
actual Chromium screenshots and text geometry at 500px and 1000px, with the
same font, data, DPR and zoom. Also check the real mobile viewport modes: a
390px-wide device scales a 500px layout to approximately 78% and a 1000px layout
to 39%; these do not change the CSS token values. A page with a fixed 1000px
minimum width can still render at about 39% in 500px mode because Chromium
fits the overflowing content. Record `visualViewport.scale` for each route;
do not infer every route's scale from the selected mode alone.

### Preserved exceptions

- Battle log `.small_war_log .name_plate` remains `0.75em`, and `.crew_plate`
  remains `90%`. Legacy inline `0.9em` conversions and zero-sized hidden markers
  remain unchanged. At a 14px parent these are 10.5px and 12.6px respectively;
  nested content must be calculated from its actual parent.
- NPC possession names retain their existing length rule: 4 and 7 characters
  render at 16px, and the existing `length >= 9` branch renders at 12px. Do not
  remove the smaller branch or enlarge long names to match adjacent labels.
- Player HTML, editor size choices, and personal CSS remain content/user settings.
  Scoped `small` rules normalize UI metadata without rewriting injected HTML.

### Deferred conversions

| Area | Preserved size | Reason |
| --- | --- | --- |
| Chief overview compact rows and turn indices | `0.55rem` (8.8px) | 12px text overlaps the existing 11.25px rows |
| Chief compact header/name | `0.65rem` / `0.6rem` | Preserve the same dense card contract |
| Narrow personnel chief name / lock label | 15px / 10px | Enlarging them reduces visible maximum-length names |
| Best generals / hall name and nation cells | 11px; inner `small` 95% | 12px worsens overflow in the fixed name cells |
| General selection and main nation basic card | Existing local/inherited sizes | Maximum-width names already overflow; conversion is deferred |

User-created general names and founded/renamed nation names are limited by
legacy width 18 (CJK counts 2, ASCII counts 1): test both 9 CJK characters and
18 wide ASCII characters. Selection-pool and scenario names have a different
source contract and are not proven bounded by that user-input guard.

Existing ellipsis, horizontal scrolling, and pre-existing maximum-name overflow
are not fixed by these tokens. The deferred areas need a separate layout decision
before their fonts are enlarged. The `typographyPolicy.spec.ts` fixture tests
protect the safe main labels, personnel breakpoints, dense chief rows, NPC
length branches, and battle log ratios. They use mocked read responses and do
not constitute live game or public deployment verification.


### Relative small tier and exception variables (2026-09-15)

`small` is `calc(var(--sammo-font-size-normal) * 12 / 14)`. The reference is the
14px normal tier, not the immediate parent. An 80% declaration on nested `small`
elements would shrink repeatedly and would yield 12.8px inside a 16px parent;
the token keeps UI metadata at 12px regardless of nesting.

The retained exceptions are also named in `tokens.css`: `nation-card`,
`chief-compact-{base,row,header,name}`, `hall-{name,secondary}`,
`personnel-mobile-{name,lock}`, `bracket-bet-button`, and `war-{name,crew}`
(all with the `--sammo-font-size-` prefix). Their values preserve the previous
rendering, including rem/em/% semantics. Zero-sized hidden markers and arbitrary
user HTML remain content contracts. The betting page and bracket now reference
the shared tier variables directly instead of the redundant `--bet-font-*` aliases.
The historical deferral reasons above describe the original 12px proposal.
