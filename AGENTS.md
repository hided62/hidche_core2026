# Repository Guidelines

## Project Structure & Module Organization
- `legacy/` contains the application source. This is the active codebase.
- PHP entry points live under `legacy/` and `legacy/hwe/` (for example `legacy/index.php`, `legacy/hwe/index.php`).
- Core PHP domain code is under `legacy/src/sammo/` (PSR-4 `sammo\\` namespace).
- Frontend TypeScript/Vue sources are in `legacy/hwe/ts/` with shared components in `legacy/hwe/ts/components/`.
- Styles are split between `legacy/css/` and SCSS in `legacy/hwe/scss/`.
- Tests: PHPUnit in `legacy/tests/`, TypeScript tests in `legacy/hwe/test-ts/`.
- Static data/assets: scenarios in `legacy/hwe/scenario/`, templates in `legacy/hwe/templates/`.

## Build, Test, and Development Commands
Run commands from `legacy/` unless noted.
- `composer install` installs PHP dependencies.
- `npm install` installs frontend/tooling dependencies.
- `npm run build` builds production JS/CSS via webpack.
- `npm run buildDev` builds development assets.
- `npm run watch` or `npm run watchProd` runs webpack in watch mode.
- `npm run lint` lints `legacy/hwe/ts` with ESLint.
- `npm test` runs all tests (`phpunit` + `mocha`).
- `vendor/bin/phpunit --bootstrap vendor/autoload.php tests` runs PHP tests only.
- `npm run test-ts` runs TypeScript tests only.

## Coding Style & Naming Conventions
- Indentation: 4 spaces, no tabs; line length ~120
- PHP modules follow PSR-4 in `legacy/src/sammo/`.
- Legacy endpoints are named by role: JSON handlers `legacy/hwe/j_*.php`, views `legacy/hwe/v_*.php`, admin pages `legacy/hwe/_admin*.php`.
- Vue components use PascalCase filenames (e.g., `legacy/hwe/ts/components/MapViewer.vue`).

## Testing Guidelines
- PHPUnit for PHP (`legacy/tests/*Test.php`).
- Mocha for TypeScript (`legacy/hwe/test-ts/*.test.ts`).
- Prefer adding tests alongside the module you change; keep naming consistent with existing patterns.

## Commit & Pull Request Guidelines
- Git history is minimal and does not define a strict convention; use short, imperative messages (e.g., "Fix map cache loading").
- PRs should include a concise description, testing notes/commands, and screenshots for UI changes.
- Avoid committing secrets; use templates in `legacy/f_install/templates/` and settings files under `legacy/hwe/d_setting/` as references.
