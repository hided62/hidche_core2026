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
