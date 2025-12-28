# Architecture TODOs

This list tracks optional extensions and follow-up items for documentation.
Move items into the main docs once they are finalized.

## Runtime and Operations

- Turn daemon scheduling details and preemption rules
- Turn daemon vs API server priority policy under load
- In-memory state lifecycle and DBMS flush checkpoints
- [AI suggestion] Specify the turn daemon main loop (distributed lock, `runUntil(now)` catch-up, checkpoint/resume cursor, release lock) and define a status/health endpoint for ops.
- [AI suggestion] Define tick budget settings (wall time, max generals, catch-up cap) to replace PHP `max_execution_time` behavior and clarify partial progress persistence.
- [AI suggestion] Define admin controls (pause/resume, manual run, force-catch-up) and their interaction with the lock/state.
- [AI suggestion] Define a constraint evaluation contract with explicit data requirements and a tri-state result (allow/deny/unknown) to support DB-backed prechecks vs in-memory full checks.
- Recovery behavior after partial flush or crash
- Observability: metrics, logs, and alerts for turn processing
- [AI suggestion] Define a stable in-memory AI state contract (snapshot + delta invalidation rules) aligned with `GeneralAI` inputs.

## Game Logic and Testing

- Input snapshot format (seed, scenario, trigger inputs, game time)
- Output comparison rules (sorting, tolerances, diff granularity)
- Unit test vs simulation test split and responsibilities
- Deterministic RNG test harness guidelines

## Trigger System

- Example trigger sets per scenario or rule pack

## Data and Profiles

- "Next-turn intent" (예턴) data schema and lifecycle
- Profile selection workflow and deployment mapping
- [AI suggestion] Define a scenario bootstrap pipeline that turns scenario/map/unit set inputs into a world snapshot or DB seed payload.
- [AI suggestion] Implement a DB-backed world loader for turn daemon startup (nation/city/general + scenario config).
- [AI suggestion] Add map/unit set loaders that normalize legacy `CityConstBase`/`GameUnitConstBase` into `MapDefinition`/`UnitSetDefinition` inputs.
- [AI suggestion] Add a DB seed writer that converts `WorldSeedPayload` into DB inserts with defaults and audit logs.

## Legacy Engine Docs

- [AI suggestion] Expand monthly pipeline details (`preUpdateMonthly`, `postUpdateMonthly`, `turnDate`, `checkStatistic`) with concrete side effects and tables touched.
- [AI suggestion] Document `ConquerCity()` resolution paths (nation collapse, officer handling, reward/penalty rules).
- [AI suggestion] Add per-command effect summaries (inputs, resource deltas, logs).
- [AI suggestion] Document `event` table schema and the static event handler map (`GameConst::$staticEventHandlers`) with command hook examples.
- [AI suggestion] Document auction scheduling (`registerAuction` call sites) and lifecycle timing rules.
- [AI suggestion] Document scenario-specific unit/map overrides and per-map city deltas.
- [AI suggestion] Document per-command `Constraint` env payload keys and lifecycle.
- [AI suggestion] Document `MessageType` values and message table schema used by diplomacy/mailbox flows.
- [AI suggestion] Document `PenaltyKey` effects and the `GeneralBase` / `LazyVarAndAuxUpdater` state conventions.
- [AI suggestion] Document personality/special selection RNG thresholds and scenario overrides.
