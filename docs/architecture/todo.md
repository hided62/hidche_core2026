# Architecture TODOs

This list tracks optional extensions and follow-up items for documentation.
Move items into the main docs once they are finalized.

## Runtime and Operations

- [AI suggestion] Implement full turn engine pipeline parity with legacy: time gate, distributed lock, catch-up monthly loop, partial progress persistence, and post-turn maintenance (traffic/statistics/auction/tournament).
- [AI suggestion] Implement command continuation/alternate flow (LastTurn/term stack/pre/post requirements/next_execute) and integrate into reserved turn processing.
- [AI suggestion] Integrate trigger preprocessing + attempt/execute phases into turn resolution (parity with legacy trigger composition).
- [AI suggestion] Add AI/autorun and inactivity (killturn/block) handling with NPC takeover/deletion policies.
- [AI suggestion] Add an event execution pipeline (initial + monthly + conditional) tied to tick/month transitions with deterministic RNG seeding.
- [AI suggestion] Add monthly economy/city/nation updates and hook them into the turn calendar handler.
- [AI suggestion] Implement diplomacy/state transitions and monthly/command-based updates beyond read-only maps.
- [AI suggestion] Integrate war/battle pipeline into turn processing (troop movement/war resolution hooks, not just isolated sim jobs).
- [AI suggestion] Expand turn command catalog beyond the current subset (general/nation commands).

## Frontend

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

- Input snapshot format (seed, scenario, trigger inputs, game time)
- Deterministic RNG test harness guidelines
- Output comparison rules (sorting, tolerances, diff granularity)
- Unit test vs simulation test split and responsibilities
- [AI suggestion] Add a test helper that runs commands through parseArgs + constraint evaluation with a deterministic RNG (e.g., LiteHashDRBG) to mirror legacy execution paths.
- [AI suggestion] Expand command tests to assert legacy side effects (exp/ded/stat-exp, gold/rice deltas, betray/inventory/troop cleanup) for key commands (e.g., 하야/강행/농지개간).
- [AI suggestion] Replace smoke/placeholder tests with concrete assertions for success/failure outcomes (e.g., 등용, NPC능동 invalid args, 출병 troop creation).
- [AI suggestion] Document che*출병 parity gaps vs legacy (city state/term=43, fallback to che*이동 when friendly, nation.war/AllowWar check, post-war static events/unique-item lottery, missing route data when map/diplomacy not provided).
- [AI suggestion] Verify that "이호경식" followed by "출병" is correctly blocked with the new reserved-turn overlay (diplomacy state sync).

## Trigger System

- Example trigger sets per scenario or rule pack
- [AI suggestion] Define item/equipment effect modeling for war triggers (equip vs carry, stacking, consumable/breakable) and hook into WarActionPipeline/trigger registry.

## Data and Profiles (Lower Priority)

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
