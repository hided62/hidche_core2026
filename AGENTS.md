# Repository Guidelines

## Project Structure & Module Organization
- `legacy/` contains the application source. This is the active codebase.
- PHP entry points live under `legacy/` and `legacy/hwe/` (for example `legacy/index.php`, `legacy/hwe/index.php`).
- `legacy/` is mostly a shell; `legacy/src/` is largely unused.
- Core PHP domain logic lives under `legacy/hwe/sammo/` (PSR-4 `sammo\\` namespace).
- `legacy/hwe/sammo/` is the game engine core, organized by domain concerns rather than endpoints.
  - `Command/` contains turn actions (general/nation commands) and their resolution rules.
  - `API/` exposes engine operations for UI and automation (general, nation, command, message, auction, etc.).
  - `Event/` and `StaticEvent/` implement dynamic and scheduled event processing.
  - `General*`, `Nation*`, `WarUnit*`, `City*` classes model game entities and combat/city state.
  - `Action*` and `Special*` capture traits, personalities, special actions, and scenario effects.
  - `Trigger*` and `*Trigger` manage conditional logic for units, generals, and state changes.
  - `Scenario/` and `Scenario.php` define scenario loading and rulesets.
  - `DTO/`, `VO/`, `Enums/`, `Constraint/` are shared types and validation rules.
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

## Commit & Pull Request Guidelines
- Git history is minimal and does not define a strict convention; use short, imperative messages (e.g., "Fix map cache loading").
- PRs should include a concise description, testing notes/commands, and screenshots for UI changes.
- Avoid committing secrets; use templates in `legacy/f_install/templates/` and settings files under `legacy/hwe/d_setting/` as references.
