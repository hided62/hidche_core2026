# Test Suite Audit

## Baseline and method

- Audit date: 2026-07-25
- Code baseline: `main@46ae79dbe7a0fb64aff9bdcc76eadafd75e10c9e`
- Executed test sources: 67 TypeScript `*.test.ts` files
- Excluded from the source count: ignored `dist/` outputs and non-executable
  fixtures/helpers
- Historical generated copies removed by this audit:
  `packages/common/test/*.{js,js.map,d.ts,d.ts.map}` (12 files)

Each suite was read together with its production entry point. Assertions were
classified by what they can actually establish:

- `contract`: focused input/output, rejection, ordering, or side-effect
  regression with concrete assertions.
- `compatibility`: expected values or traces are independently grounded in the
  PHP reference implementation.
- `integration`: real database, Redis, process, or HTTP behavior; environment
  gating must be reported as a skip rather than a pass.
- `smoke`: a broad scenario that proves only the stated liveness/invariant
  bounds. It is useful, but is not compatibility evidence.

`kept` means the suite's current scope and assertions match its stated role.
`corrected` means this audit changed a misleading, non-deterministic, empty, or
environment-dependent check.

## Per-suite disposition

### `packages/common`

| Test source              | Disposition | Layer         | What it establishes                                                                                                                                                                   |
| ------------------------ | ----------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/clock.test.ts`     | kept        | contract      | Manual and stepped clock advancement plus invalid step rejection.                                                                                                                     |
| `test/rng.test.ts`       | corrected   | compatibility | PHP/Python SHA-512 vectors, byte/bit consumption, integer and weighted selection, explicit boundary outputs, and a genuinely expanded long seed. Removed three assertion-free checks. |
| `test/test-rngs.test.ts` | kept        | contract      | Exact output sequences for deterministic test RNG implementations.                                                                                                                    |

### `app/gateway-api`

| Test source                     | Disposition | Layer    | What it establishes                                                                                                                                                                  |
| ------------------------------- | ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/authFlow.test.ts`         | kept        | contract | OAuth-backed registration, gateway session issuance, encrypted game token issuance, and successful validation through the router. Token storage/Redis TTL remains integration scope. |
| `test/orchestratorPlan.test.ts` | kept        | contract | Exact start/stop/no-op reconciliation decisions for every profile status represented by the planner.                                                                                 |
| `test/scenarioCatalog.test.ts`  | kept        | contract | Git ref resolution and preview loading from the checked-out repository.                                                                                                              |

### `app/game-api`

| Test source                                   | Disposition | Layer                            | What it establishes                                                                                                                                                                 |
| --------------------------------------------- | ----------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/battleSimProcessor.test.ts`             | corrected   | contract + compatibility support | Fixed-seed numeric battle summary, skill activation, exact defender order, and unknown crew handler rejection. Detailed PHP parity remains in `battleDifferential.test.ts`.         |
| `test/battleSimRouter.test.ts`                | kept        | contract                         | Queued-to-completed transport state flow through the battle router.                                                                                                                 |
| `test/commandTable.test.ts`                   | kept        | contract                         | Minimum constraints, rather than full command constraints, determine command-table availability. This is intentionally a focused positive regression.                               |
| `test/idempotentTransport.test.ts`            | kept        | contract                         | Stable ordered child request IDs derived from one API input event.                                                                                                                  |
| `test/inputEventBoundary.integration.test.ts` | kept        | integration                      | PostgreSQL atomic commit/rollback, retry, concurrent duplicate rejection, and child payload conflict. Explicitly skipped without `INPUT_EVENT_DATABASE_URL`.                        |
| `test/realtimeSse.test.ts`                    | kept        | contract                         | Exact SSE framing, multiline encoding, event parsing rejection, and profile channel namespace.                                                                                      |
| `test/reservedTurns.test.ts`                  | kept        | contract                         | General/nation queue padding and shift direction. Database constraints are outside this in-memory fake.                                                                             |
| `test/router.test.ts`                         | kept        | contract                         | Turn-daemon dispatch and serialization of world/status/reserved-turn responses through tRPC callers.                                                                                |
| `test/streamKeys.test.ts`                     | kept        | contract                         | Exact Redis stream namespace contract.                                                                                                                                              |
| `test/tournamentWorker.test.ts`               | corrected   | contract                         | Fixed-seed bracket winner and final energies, payout command data, auto-join filtering, NPC/dummy fill, and completion. Replaced winner-exists-only coverage for the fixed bracket. |

### `app/game-engine`

| Test source                                     | Disposition | Layer         | What it establishes                                                                                                                                                                                                                                                                         |
| ----------------------------------------------- | ----------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/crewTypeExecution.test.ts`                | kept        | compatibility | Crew action router ordering and legacy NPC arm-type weighting.                                                                                                                                                                                                                              |
| `test/databaseCommandQueue.integration.test.ts` | kept        | integration   | PostgreSQL single claim across consumers, persisted result, and expired-versus-active lease recovery. Explicitly skipped without a DB URL.                                                                                                                                                  |
| `test/generalAiLegacyDecisionParity.test.ts`    | added       | compatibility | Ref-backed final NPC command matrix across diplomacy, war readiness, city development/population, technology ceilings, gold/rice and casualty ranks, stats/affinity, special NPC state, treasury reserves, and command availability.                                                        |
| `test/inputEventAtomicity.test.ts`              | kept        | contract      | Dirty-state retention, mutation/commit/respond ordering, and pause/no-ack behavior on handler or commit failure.                                                                                                                                                                            |
| `test/monthlyCatalogCoverage.test.ts`           | added       | compatibility | Exact 29-action ref catalog coverage, dependency-safe segment assignment, executable core evidence files, and explicit multi-month/no-op/error dispositions. Behavioral claims remain in the referenced PostgreSQL/ref fixtures.                                                            |
| `test/nationCollapseOnConquest.test.ts`         | kept        | smoke         | Last-city conquest removes the nation and neutralizes its general. It is a focused engine scenario, not full battle parity.                                                                                                                                                                 |
| `test/nationTurnCompatibility.test.ts`          | kept        | compatibility | Legacy-backed 12-turn research accumulation and completion, diplomacy-message emission, and exact monthly strategy/diplomacy limit decay through the engine harness.                                                                                                                        |
| `test/npcGeneralDomesticTurn.test.ts`           | corrected   | contract      | Fixed seed chooses the security command, applies exactly `+50`, leaves other city values unchanged, and advances exactly one tick.                                                                                                                                                          |
| `test/npcNationGrowthScenario.test.ts`          | corrected   | smoke         | Long-running NPC growth invariants and collapse guards. The implementation-specific early recruitment bound was removed because legacy AI forbids peace/declaration recruitment; remaining thresholds are smoke bounds.                                                                     |
| `test/npcNationTechResearch.test.ts`            | corrected   | smoke         | Long-running monotonic tech growth. Net per-tick general gold is not treated as recruitment price because nation awards can occur in the same tick.                                                                                                                                         |
| `test/npcNationUprisingUnification.test.ts`     | corrected   | smoke         | Runs from 181-08 through at most 260-01 and covers multi-nation founding, declaration, live sortie, conquest, monotonic nation-count decline, and the no-orphan-city invariant. Terminal unification is asserted when reached; the focused war scenario below guarantees the terminal path. |
| `test/npcNationWarDeclaration.test.ts`          | corrected   | smoke         | Declaration, war transition, a battle-ready cohort, front deployment, conquest, unification, and dispatch occurrence without assuming every recruit is already fully trained.                                                                                                               |
| `test/npcWarPrepTurns.test.ts`                  | kept        | smoke         | Training/morale actions occur in the named months and leave battle-ready generals.                                                                                                                                                                                                          |
| `test/reservedTurnExecution.test.ts`            | kept        | smoke         | Multi-command engine application, invalid-argument and constraint fallbacks, uprising/founding transitions, and named failure constraints. Its large workflow scope is recorded as smoke rather than a unit test.                                                                           |
| `test/scenarioSeeder.test.ts`                   | kept        | integration   | Real schema row counts, diplomacy symmetry, and persisted install options. Reported as skipped when required tables are unavailable.                                                                                                                                                        |
| `test/turnDaemonLease.integration.test.ts`      | kept        | integration   | PostgreSQL profile lease exclusivity, expiry takeover with epoch increment, stale-owner fencing rollback, and clean release handoff. Explicitly skipped without a DB URL.                                                                                                                   |
| `test/turnDaemonLifecycle.test.ts`              | kept        | contract      | Queue-front versus scheduled-boundary selection and exact processor checkpoint arguments.                                                                                                                                                                                                   |
| `test/turnOrder.test.ts`                        | kept        | contract      | Stable `turnTime`, then ID, ordering independent of insertion order.                                                                                                                                                                                                                        |
| `test/uniqueLotteryCommand.test.ts`             | kept        | contract      | Fixed-seed eligible command awards the expected unique item and item log.                                                                                                                                                                                                                   |
| `test/voteReward.test.ts`                       | corrected   | contract      | Gold, exact unique item, persisted reward metadata, log, and idempotent second application.                                                                                                                                                                                                 |

### `packages/logic`

| Test source                                              | Disposition | Layer                    | What it establishes                                                                                                                                                                                                    |
| -------------------------------------------------------- | ----------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/actions/instant/nationStopWar.test.ts`             | kept        | contract                 | Invalid diplomacy rejection and symmetric neutral diplomacy patches.                                                                                                                                                   |
| `test/actions/turn/executionHelper.test.ts`              | kept        | contract                 | Successful resolution, fallback loading/log accumulation, and fallback loop termination.                                                                                                                               |
| `test/actions/turn/nation.test.ts`                       | corrected   | compatibility + contract | Declaration effects/logs, non-neighbor denial, capital/name/city effects, and exact legacy `필사즉생` gains (`+15`, train/morale 100, global delay 9).                                                                 |
| `test/actions/turn/nationMissing.test.ts`                | kept        | compatibility + contract | Legacy-backed rejection, message, cooldown, assistance accumulator, and state/resource/meta effects for represented migrated nation commands. Exact full PHP snapshots remain outside this suite.                      |
| `test/crewType.test.ts`                                  | kept        | contract                 | Unit-set normalization and tech/region/city availability requirements.                                                                                                                                                 |
| `test/crewTypeExecution.test.ts`                         | kept        | compatibility            | Shipped catalog compilation, unknown handlers, crew action routing, legacy triggers, and numeric pick-score formula.                                                                                                   |
| `test/diplomacy.test.ts`                                 | kept        | compatibility            | Exact monthly declaration/war/non-aggression transitions, casualty extension, and reset behavior.                                                                                                                      |
| `test/dispatchWarAction.test.ts`                         | kept        | contract                 | Dispatch emits battle logs and patches for defender general, city, and diplomacy casualty state. Numeric battle parity is delegated to the differential suite.                                                         |
| `test/itemInventory.test.ts`                             | kept        | contract                 | Legacy-slot upgrade, frozen-snapshot reads, exact consumable charge depletion, final unequip, and persisted metadata round-trip for canonical item instances.                                                          |
| `test/message.test.ts`                                   | kept        | contract                 | Private sender/receiver copies, national/public single-copy rules, and sender action sanitization.                                                                                                                     |
| `test/scenarioParser.test.ts`                            | corrected   | contract                 | Defaults and representative legacy-format rows from tracked `resources/scenario`; removed dependence on an untracked local `legacy/` directory.                                                                        |
| `test/scenarios/blankStart.test.ts`                      | kept        | smoke                    | Uprising-to-appointment-to-founding workflow and named founding rejections.                                                                                                                                            |
| `test/scenarios/diplomacy.test.ts`                       | corrected   | contract                 | Declaration is denied for deployment, then the identical command becomes allowed only after transition to WAR. Removed the previous false check that inspected an always-empty troop list while bypassing constraints. |
| `test/scenarios/domestic.test.ts`                        | corrected   | contract                 | Representative domestic action state changes and capacity behavior, including the exact `+100` agriculture effect, through the scenario harness.                                                                       |
| `test/scenarios/general/che_NPC능동.test.ts`             | corrected   | contract                 | NPC teleport, non-NPC resolver rejection, and structural argument parsing. Replaced an empty always-passing test.                                                                                                      |
| `test/scenarios/general/che_강행.test.ts`                | kept        | contract                 | Exact move/cost/experience effects, far-city denial, and wandering subordinate movement.                                                                                                                               |
| `test/scenarios/general/che_귀환.test.ts`                | kept        | contract                 | Capital/officer-city return effects and named location constraints.                                                                                                                                                    |
| `test/scenarios/general/che_등용수락.test.ts`            | kept        | contract                 | Neutral acceptance, betrayal resource/penalty effects, and monarch/same-nation denials.                                                                                                                                |
| `test/scenarios/general/che_이동.test.ts`                | kept        | contract                 | Exact movement, gold, morale, experience, and leadership-experience effects.                                                                                                                                           |
| `test/scenarios/general/migratedGeneralCommands.test.ts` | kept        | contract                 | Focused state transitions for mutiny, abdication, gift, disband, founding, and duplicate equipment purchase.                                                                                                           |
| `test/scenarios/general_commands_new.test.ts`            | kept        | smoke                    | Multi-command resolver workflow for procurement/donation/status and employment/sabotage families, including exact one-use strategy-item consumption. Other broad assertions remain workflow smoke only.                |
| `test/scenarios/reservedTurnExecution.test.ts`           | kept        | smoke                    | Multiple generals consume queued commands over three ticks and produce representative city/general changes.                                                                                                            |
| `test/scenarios/troops.test.ts`                          | corrected   | contract                 | Draft, train, and morale workflow with exact crew, training, and morale results through three commands.                                                                                                                |
| `test/specialActions.test.ts`                            | kept        | contract                 | Trait loading plus exact domestic/stat/heal/battle modifiers.                                                                                                                                                          |
| `test/uniqueLottery.test.ts`                             | kept        | contract                 | Fixed-seed item, eligible acquisition types, founding guarantee, and occupied-item counting.                                                                                                                           |
| `test/warAftermath.test.ts`                              | kept        | contract                 | Exact tech/death deltas and conquest/collapse resource/general/city effects.                                                                                                                                           |
| `test/warEngine.test.ts`                                 | kept        | contract                 | Critical trigger multiplier, no-rice defender rout, and exact multi-use/one-use battle-item charge persistence. Detailed phase/RNG parity is differential-test scope.                                                  |
| `test/world/distance.test.ts`                            | kept        | contract                 | Exact shortest distances, range search, and unreachable city handling.                                                                                                                                                 |
| `test/worldBootstrap.test.ts`                            | kept        | contract                 | Scenario/map conversion into exact snapshot and seed fields.                                                                                                                                                           |

### `tools/integration-tests`

| Test source                                         | Disposition | Layer                 | What it establishes                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------- | ----------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/auctionFlow.test.ts`                          | kept        | integration           | Real API/PostgreSQL/Redis/daemon resource and unique-auction bidding, extension, finalization, payout, and ownership constraints.                                                                                                                                                                                                   |
| `test/battleDifferential.test.ts`                   | kept        | compatibility         | PHP reference metadata and attacker/defender comparisons for all 145 scenario items, plus event order, RNG results, phase values, multi-defender, siege, and no-defender branches. The two exhaustive item cases currently fail on 13 attacker and 2 defender items; this is active compatibility evidence, not a green regression. |
| `test/initialization.test.ts`                       | kept        | integration           | Real gateway/game APIs, database/Redis reset, scenario seed, users, joins, turns, and founding state.                                                                                                                                                                                                                               |
| `test/orchestrator.e2e.test.ts`                     | kept        | integration           | Real PM2 game API/daemon startup, command serving, SSE completion, and persisted world update.                                                                                                                                                                                                                                      |
| `test/turnSnapshotComparator.test.ts`               | kept        | contract              | Canonical entity ordering, exact changed paths, numeric before/after delta equivalence, and live-conquest nation-deletion mismatch detection.                                                                                                                                                                                       |
| `test/turnSnapshotCoreDatabase.integration.test.ts` | kept        | integration           | Real PostgreSQL projection plus before/execute/after capture around a transaction boundary. Explicitly skipped without a DB URL.                                                                                                                                                                                                    |
| `test/turnSnapshotReference.integration.test.ts`    | kept        | integration           | Read-only canonical projection from the isolated PHP/MariaDB reference service. Explicitly enabled with `TURN_DIFFERENTIAL_REFERENCE=1`.                                                                                                                                                                                            |
| `test/turnCommandReference.integration.test.ts`     | kept        | compatibility harness | Disposable cloned-MariaDB execution of real legacy nation declaration and live sortie through conquest and nation collapse. Explicitly enabled with `TURN_DIFFERENTIAL_REFERENCE=1`.                                                                                                                                                |
| `test/turnTraceFiles.integration.test.ts`           | kept        | compatibility harness | Saved ref/core command identity, RNG sequence and semantic delta comparison. It is skipped until both independently executed trace files are supplied.                                                                                                                                                                              |

## Shared test support

The following support files were also reviewed because failures in them can
invalidate many suites:

| Support source                                    | Result                                                                                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/logic/test/testEnv.ts`                  | corrected: replaced `Math.random()` with a complete fixed-seed `RandUtil`; missing general IDs now fail setup instead of silently skipping a command. |
| `packages/logic/test/fixtures/minimalMap.ts`      | kept: small connected/unreachable map fixture used by focused command tests.                                                                          |
| `app/game-engine/test/fixtures/largeTestMap.ts`   | kept: broad NPC smoke fixture; not a legacy map snapshot.                                                                                             |
| `app/game-engine/test/helpers/turnTestHarness.ts` | kept: engine smoke harness; assertions remain in individual suites.                                                                                   |

## Trust boundary after this audit

This audit establishes that every executable test has a stated, non-empty
purpose and that broad simulations are labeled as smoke rather than silently
treated as exact compatibility proof. It does not promote all product behavior
to legacy-compatible:

- battle compatibility is supported only by the differential fixtures and the
  suites explicitly marked `compatibility`;
- broad NPC and multi-command scenarios guard liveness/invariants, while
  `generalAiLegacyDecisionParity.test.ts` establishes exact final choices only
  for its explicitly represented input branches;
- DB/Redis/PM2 claims require their integration suites to run rather than skip;
- changing an implementation and observing a green unit suite is still not a
  substitute for a new PHP trace when compatibility-sensitive behavior changes.
