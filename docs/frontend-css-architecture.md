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
| page-specific/native control | feature-namespaced scoped class            | only when Ref computed geometry or interaction differs from the Bootstrap/Lumen family |

The base class supplies accessible link/button normalization and the historical
`base1` fallback used by already measured screens. New Bootstrap/Lumen controls
must add an explicit semantic modifier; do not infer a mutation role from a
label such as `구입` in page CSS. A disabled control keeps its semantic color
and uses the shared opacity/cursor state. Hover and active use the Ref Lumen
bottom-border movement rather than an unrelated brightness filter.

Only layout belongs in the SFC: width, grid column, margins required by the
page, and breakpoint-specific placement. Color, border, font weight,
hover/focus/active, and disabled presentation belong in
`legacy-controls.css` when the Ref family is shared. Generic `.btn`, `button`,
or `.primary` rules must not be promoted globally.

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
