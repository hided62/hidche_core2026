# Architecture TODOs

This list tracks optional extensions and follow-up items for documentation.
Move items into the main docs once they are finalized.

## Runtime and Operations

- [AI suggestion] Make profile turn execution a durable single-writer contract:
  add a DB-backed lease with fencing epoch/world version, and reject stale
  daemon commits after a restart or split-brain.
- [AI suggestion] Replace the current destructive dirty-state drain and
  multi-query flush with bounded atomic batches. Persist entity deltas, logs,
  reserved turns, checkpoint, and outbox events in one transaction, then clear
  dirty state only after commit.
- [AI suggestion] Introduce durable command inbox/outbox records with unique
  request IDs, idempotent results, and per-profile ordering. Keep Redis as a
  wake-up/fan-out layer, or add consumer groups, ACK/pending recovery, DLQ, and
  stream trimming if Redis Streams remain the command source.
- [AI suggestion] Add ownership authorization to all turn reservation
  procedures (`auth user -> owned general -> current officer role -> nation`)
  and add revision/optimistic concurrency to reservation queue updates.
- [AI suggestion] Implement full turn engine pipeline parity with legacy: time gate, distributed lock, catch-up monthly loop, partial progress persistence, and post-turn maintenance (traffic/statistics/auction/tournament).
- [AI suggestion] Implement command continuation/alternate flow (LastTurn/term stack/pre/post requirements/next_execute) and integrate into reserved turn processing.
- [AI suggestion] Integrate trigger preprocessing + attempt/execute phases into turn resolution (parity with legacy trigger composition).
- [AI suggestion] Add AI/autorun and inactivity (killturn/block) handling with NPC takeover/deletion policies.
- [AI suggestion] Add an event execution pipeline (initial + monthly + conditional) tied to tick/month transitions with deterministic RNG seeding.
- [AI suggestion] Add monthly economy/city/nation updates and hook them into the turn calendar handler.
- [AI suggestion] Implement diplomacy/state transitions and monthly/command-based updates beyond read-only maps.
- [AI suggestion] Integrate war/battle pipeline into turn processing (troop movement/war resolution hooks, not just isolated sim jobs).
- [AI suggestion] Expand turn command catalog beyond the current subset (general/nation commands).
- [AI suggestion] Replace growing switch-based command routing/serialization with a registry (command schema + handler map + validator) to reduce manual case additions.
- [AI suggestion] Apply install settings (`join_mode`, `npcmode`, `show_img_level`, `tournament_trig`) to runtime rules/command constraints and UI behavior, beyond just storing them in world state.
- [AI suggestion] Implement full auction finalization logic in the daemon (resource transfers, unique item grants, and log writes) once the auction schema is stabilized.

## Frontend

- [AI suggestion] Build a legacy-compatible `classic` theme from semantic
  design tokens and shared UI primitives, verify it with Chromium
  screenshot/geometry/computed-style tests, then add a separately selectable
  `modern` theme without changing page behavior.
- [AI suggestion] Provide one profile-aware public runtime configuration for
  web/API/event/asset base URLs so `/gateway`, `/che`, and `/hwe` work for SPA
  navigation, direct refresh, tRPC, SSE, and externally owned `/image/*`.
- [AI suggestion] Maintain a game frontend SPA implementation plan and keep it aligned with legacy screen inventory (`docs/architecture/game-frontend-spa-plan.md`).
- [AI suggestion] Define gateway login handoff + profile selection flow for the game frontend (token delivery, auto-login, cookie vs localStorage policy).
- [AI suggestion] Implement Public 화면: 캐싱된 지도/중원정세/세력일람 + 제한된 장수일람 API/뷰.
- [AI suggestion] Define main screen SSE contract + 실시간 동기화 토글 연동 (지도/명령/도시/국가/장수/메시지/동향/기록).
- [AI suggestion] Port legacy main UI components into `app/game-frontend` (MapViewer, CommandSelectForm, MessagePanel 등).
- [AI suggestion] Provide map city name/position data for MapViewer (API or scenario export) and replace placeholder layout.
- [AI suggestion] Implement join/빙의 UI and post-creation refresh flow.
- [AI suggestion] Build and maintain a legacy-to-SPA route mapping table with data requirements.
- [AI suggestion] Implement command reservation UI (일반/국가 예턴) and connect `CommandSelectForm` to `turns.reserved` APIs with validation + queue preview.
- [AI suggestion] Wire `realtimeEnabled` to an SSE or polling channel and update main dashboard data buckets (map/lobby/messages/commands).
- [AI suggestion] Finalize static asset and web base URLs (`VITE_GAME_WEB_URL`, `VITE_GAME_ASSET_URL`) and document deployment mapping for legacy images.
- [AI suggestion] Expand Join UI to cover inherit options (특기/도시/턴타임/보너스 스탯) using `join.getConfig` and `join.createGeneral` inputs.
- [AI suggestion] Extend MessagePanel to support private/diplomacy targets and surface sender/receiver metadata from message payloads.
- [AI suggestion] Port legacy TipTap-based editors (국가 방침/임관 권유) into game-frontend and reuse the new board image upload policy.

## Runtime and Operations (Lower Priority)

- Document current turn daemon scheduling details and preemption rules (based on TurnDaemonLifecycle).
- Document in-memory state lifecycle and DB flush checkpoints (current InMemoryTurnWorld + databaseHooks flow).
- Document existing status/health endpoint requirements for ops and the current daemon loop behavior.
- Document tick budget settings (wall time, max generals, catch-up cap) and partial progress persistence.
- Document admin controls (pause/resume/manual run) and how they interact with lock/state.
- [AI suggestion] Define gateway admin build/daemon control approach (direct orchestration vs supervisor like systemd/pm2), security model, audit logging, and safe rollback/stop/start workflows.
- [AI suggestion] Specify single-host gateway orchestration: boot reconciliation from DB (완료/예약/가동중/정지됨/비활성화), desired-state mapping, and pm2-managed process lifecycles for api/daemon.
- Turn daemon vs API server priority policy under load
- Recovery behavior after partial flush or crash
- Observability: metrics, logs, and alerts for turn processing
- [AI suggestion] Define a stable in-memory AI state contract (snapshot + delta invalidation rules) aligned with `GeneralAI` inputs.

## Game Logic and Testing

- [AI suggestion] Audit every test inherited at the 2026-07-25 baseline before
  using it as correctness evidence. Record the protected contract and
  independent oracle, replace truthiness/smoke-only assertions, add
  negative/boundary/side-effect coverage, and verify that an intentional
  behavior mutation makes the test fail.
- [AI suggestion] Add a PHP↔TypeScript battle differential harness that
  compares the serialized seed, ordered RNG calls, trigger
  attempt/execute trace, phase-by-phase numeric outcomes, and final
  general/city/nation/troop numeric snapshot. Treat log wording as a permitted
  difference when event meaning, displayed values, and visibility are kept.
- [AI suggestion] Restore the legacy command RNG seed domains
  (`generalCommand`/`nationCommand` plus raw command class) before treating
  fixed-seed command or battle results as compatible.
- [AI suggestion] Define an explicit ruleset trigger manifest and fail profile
  startup when a unit/item/trait references an unregistered trigger. Compose
  personality, domestic/war specialty, item, inheritance, nation, and unit
  triggers in the live turn-daemon battle path.
- Input snapshot format (seed, scenario, trigger inputs, game time)
- Deterministic RNG test harness guidelines
- Output comparison rules (sorting, tolerances, diff granularity)
- Unit test vs simulation test split and responsibilities
- [AI suggestion] Add a test helper that runs commands through parseArgs + constraint evaluation with a deterministic RNG (e.g., LiteHashDRBG) to mirror legacy execution paths.
- [AI suggestion] Expand command tests to assert legacy side effects (exp/ded/stat-exp, gold/rice deltas, betray/inventory/troop cleanup) for key commands (e.g., 하야/강행/농지개간).
- [AI suggestion] Replace smoke/placeholder tests with concrete assertions for success/failure outcomes (e.g., 등용, NPC능동 invalid args, 출병 troop creation).
- [AI suggestion] Document che*출병 parity gaps vs legacy (city state/term=43, fallback to che*이동 when friendly, nation.war/AllowWar check, post-war static events/unique-item lottery, missing route data when map/diplomacy not provided).
- [AI suggestion] Verify that "이호경식" followed by "출병" is correctly blocked with the new reserved-turn overlay (diplomacy state sync).
- [AI suggestion] Survey/unique lottery should account for auction/storage-held unique items once the inventory and auction models are finalized.

## Trigger System

- Example trigger sets per scenario or rule pack
- [AI suggestion] Define item/equipment effect modeling for war triggers (equip vs carry, stacking, consumable/breakable) and hook into WarActionPipeline/trigger registry.

## Data and Profiles (Lower Priority)

- [AI suggestion] Split gateway orchestration into immutable `Release`,
  versioned `Ruleset`, `ProfileInstance`, `Deployment`, and first-class
  `AdminJob` records. Store artifact/API/resource digests and an auditable job
  state machine instead of profile `meta.adminActions` arrays.
- [AI suggestion] Run the artifact built in each profile's selected worktree
  (or preferably an immutable image digest), include required workers and
  frontend/resources in the release manifest, and verify readiness before
  switching traffic.
- [AI suggestion] Give each profile instance an immutable ID, dedicated DB
  schema/URL, and public route. Do not derive DB isolation from the broad
  server profile (`che`, `hwe`) when multiple scenarios/releases can coexist.
- [AI suggestion] Publish and negotiate gateway/game API contract and
  capability versions so profiles running different releases can be accepted,
  degraded, or blocked explicitly by the gateway.
- Profile selection workflow and deployment mapping
- "Next-turn intent" (예턴) data schema and lifecycle

## Legacy Engine Docs (Lower Priority)

- [AI suggestion] Expand monthly pipeline details (`preUpdateMonthly`, `postUpdateMonthly`, `turnDate`, `checkStatistic`) with concrete side effects and tables touched.
- [AI suggestion] Document `event` table schema and the static event handler map (`GameConst::$staticEventHandlers`) with command hook examples.
- [AI suggestion] Add per-command effect summaries (inputs, resource deltas, logs).
- [AI suggestion] Document per-command `Constraint` env payload keys and lifecycle.
- [AI suggestion] Document `ConquerCity()` resolution paths (nation collapse, officer handling, reward/penalty rules).
- [AI suggestion] Document auction scheduling (`registerAuction` call sites) and lifecycle timing rules.
- [AI suggestion] Document scenario-specific unit/map overrides and per-map city deltas.
- [AI suggestion] Document `MessageType` values and message table schema used by diplomacy/mailbox flows.
- [AI suggestion] Document `PenaltyKey` effects and the `GeneralBase` / `LazyVarAndAuxUpdater` state conventions.
- [AI suggestion] Document personality/special selection RNG thresholds and scenario overrides.
