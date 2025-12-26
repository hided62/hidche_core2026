# Repository Guidelines

## Project Goal (Rewrite)
- This repository is transitioning from the legacy PHP codebase to a TypeScript-based monorepo using pnpm workspaces.
- The legacy game remains the current active source under `legacy/` while the rewrite is prepared alongside it.
- Legacy data under `legacy/` is for migration only; once DB migration is complete,
  the runtime will no longer depend on legacy data.

## Project Structure & Module Organization
- `legacy/` contains the application source. This is the active codebase.
- PHP entry points live under `legacy/` and `legacy/hwe/` (for example `legacy/index.php`, `legacy/hwe/index.php`).
- `legacy/` is mostly a shell; `legacy/src/` is largely unused.
- Core PHP domain logic lives under `legacy/hwe/sammo/` (PSR-4 `sammo\\` namespace).
- Frontend TypeScript/Vue sources are in `legacy/hwe/ts/` with shared components in `legacy/hwe/ts/components/`.
- Styles are split between `legacy/css/` and SCSS in `legacy/hwe/scss/`.
- Tests: PHPUnit in `legacy/tests/`, TypeScript tests in `legacy/hwe/test-ts/`.
- Static data/assets: scenarios in `legacy/hwe/scenario/`, templates in `legacy/hwe/templates/`.

## Legacy Endpoint Patterns
- JSON API handlers: `legacy/hwe/j_*.php`.
- Vue multi-entry pages: `legacy/hwe/v_*.php`.
- Legacy PHP + jQuery pages: `legacy/hwe/b_*.php` with POST handlers in `legacy/hwe/c_*.php`.
- Modern API router: `legacy/hwe/api.php` accepts a path argument and dispatches to `legacy/hwe/API/` modules.

## Planned Monorepo Layout (TypeScript Rewrite)
- `/packages/common`: shared utilities and type definitions.
- `/packages/logic`: pure game logic with DI/interfaces for external dependencies.
- `/app/gateway-frontend`: Gateway UI application.
- `/app/gateway-api`: Gateway backend service.
- `/app/game-frontend`: Game UI application.
- `/app/game-api`: Game backend service per server profile.
- `/app/game-engine`: Game engine / turn daemon per server profile.
- `/tools/build-scripts`: build and deployment scripts.

## Planned Runtime & Tooling
- Backend: Node.js + Fastify, with Prisma ORM.
- Turn daemon: turn scheduler/resolver service for game ticks.
- Turn daemon and API server communicate via Redis Stream or Redis pub/sub.
- API server and frontend may use SSE for live updates.
- API: tRPC + zod.
- Frontend: Vue 3, Pinia, Vue Router, TailwindCSS, Vite.
- Data: PostgreSQL; sessions backed by Redis.
- Testing: Vitest.
- Package manager: pnpm (workspace-based monorepo).
- Build output: server builds emitted to `/dist/{serverName}` per profile.

## Suggested Monorepo Scripts (Proposal)
These are placeholders to align teams; adjust once packages exist.
- `pnpm install`: install all workspace dependencies.
- `pnpm -r lint`: lint all packages.
- `pnpm -r test`: run all unit tests (Vitest where configured).
- `pnpm -r build`: build all packages/apps.
- `pnpm -r dev`: run dev servers where applicable.
- `pnpm --filter ./app/game-frontend dev`: run a single app by filter.
- `pnpm --filter ./app/game-api dev`: run a single service by filter.
- `pnpm --filter ./app/game-engine dev`: run a single service by filter.

## Build Profiles (Proposal)
- Server builds should accept a profile (scenario, server variant) as an explicit input.
- Recommended pattern: a `tools/build-scripts` runner invoked by pnpm, e.g. `pnpm build:server --profile che`.
- Prefer environment variables for CI/CD (`PROFILE=che pnpm build:server`) and a small wrapper script for local usage.
- Build output stays in `/dist/{serverName}` per profile to keep deployments predictable.
- Profile selection can target different git branches or specific commits; server operators decide the compatibility baseline.
- Profiles should allow scenario selection and include the matching unit pack in the build output.

## Server Profiles (Planned)
- `che`, `kwe`, `pwe`, `twe`, `nya`, `pya`

## Game Domain Notes (Behavioral Context)
- Turn-based multiplayer loop with configurable tick length (historically 120/60/30/20/10/5/2/1 min; experimental day/night schedules).
- Core stats: leadership, strength, intelligence with effects on internal affairs and combat.
- Traits and modifiers apply via the Trigger system, evaluated by priority; "attempt" then "execute".
- Scenarios define maps, NPCs, initial resources; scenario loading separated to allow future modding.
- "Unit packs" bundle unit graphics, audio, and special effects per scenario.

## Randomness Policy (Verifiable RNG)
- All game-impacting randomness must be verifiable and reproducible from a deterministic seed.
- Prefer reusing the existing TypeScript implementations: `legacy/hwe/ts/util/LiteHashDRBG.ts` and `legacy/hwe/ts/util/RNG.ts` with minimal or no changes.
- Seed composition should include a hidden base seed plus action context (action type, time, actor, target) so results can be re-validated later.
- Do not introduce ad-hoc randomness in game logic; allow non-deterministic randomness only for non-gameplay, cosmetic, or UI-only cases.

## Coding Style & Naming Conventions
- Follow repo lint/format configuration once it exists; keep diffs consistent within a file.
- Indentation: 4 spaces for TypeScript, JSON, and Vue SFCs.
- Prefer explicit types for public APIs; avoid `any` and narrow `unknown`.
- Vue components: PascalCase filenames; composables use `useX` naming.
- Use `camelCase` for variables/functions and `PascalCase` for classes/types.
- Legacy concepts may use Korean identifiers; preserve Korean naming when it improves maintainability.
- Hybrid naming is acceptable (e.g., `use전투규칙`, `use도시상태`) when the prefix is conventional but the domain term is Korean.
- For classes, commands, and domain logic, add clear Korean comments to support Korean readers and future maintainers.

## Commit & Pull Request Guidelines
- Git history is minimal and does not define a strict convention; use short, imperative messages (e.g., "Fix map cache loading").
- PRs should include a concise description, testing notes/commands, and screenshots for UI changes.

## Architecture References
- Overview: `docs/architecture/overview.md`.
- Legacy engine map: `docs/architecture/legacy-engine.md`.
- TypeScript rewrite plan: `docs/architecture/rewrite-plan.md`.
- Runtime and build profiles: `docs/architecture/runtime.md`.

## Documentation Workflow
- When AI proposes future improvements or expansions, record them in
  `docs/architecture/todo.md` with an "AI suggestion" label.
