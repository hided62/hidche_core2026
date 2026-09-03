# Game clock reconciliation implementation plan

Baseline: `main@b91dcbcaaac5acd4c7349cd3ed0996c547f58756`

Branch: `test/game-clock-reconciliation-20260903`

This plan is the status source for the long-running user test branch. A checked
item means code and focused automated evidence exist on this branch; it does not
mean deployment or production validation.

## Milestone 1 - authority and inventory

- [x] Branded `GameTick`, `ObservedGameInstant`, `ScheduleInstant`,
      `WallInstant`, and `ClockRevision` boundaries.
- [x] Explicit clock phase and monotonic RUNNING projection.
- [x] Exact alignment arithmetic preserving millisecond/sub-turn remainder.
- [x] Opening tick zero and PREOPEN executable floor in the shared seeder.
- [x] Schema columns for phase, revision, and deadline generation.
- [x] Suspension, participant-checksum, and Redis projection outbox tables.
- [x] Machine-readable DB/Redis/JSON participant inventory and architecture gate.
- [x] Turn flush lock prefix and phase/revision/generation fence.
- [x] Empty and upgraded database migration execution evidence.

## Milestone 2 - exact DB reconciliation

- [x] Suspension start command with DB wall time and idempotent source revision.
- [x] Exact resume plan transaction with deterministic participant lock order.
- [x] SHIFT adapters for cursor, generals, active auctions, message expiry, vote
      end, select pool, and NPC selection windows.
- [x] KEEP checksum adapters for occurrences and accepted command coordinates.
- [x] Explicit `LEGACY_COMPLETE_TURNS` and bounded `CATCH_UP` policies.
- [x] Property tests for remaining distance, ordering, and history invariants.
- [x] 24-hour and 65m17.250s PostgreSQL integration evidence.

## Milestone 3 - revisioned Redis and workers

- [x] Projection outbox claimer/retry/recovery state machine.
- [x] Redis active revision and atomic due-pop script.
- [x] Auction OPEN/FINALIZING revision and generation fence.
- [x] Tournament durable tick dual-write and projection rebuild.
- [x] DB-commit/Redis-failure crash-restart test.
- [x] Readiness integration in Gateway/API process health.

## Milestone 4 - command and lifecycle workflows

- [x] All durable input events record accepted tick and accepted revision.
- [x] Processing converts accepted coordinates across revisions or fails closed.
- [x] Gateway pause/resume/open orchestration writes the DB clock phase.
- [x] Unification wait becomes a durable `UNIFICATION_WAIT` suspension.
- [x] Alignment, optional rate change, invader IDs/RNG, creation, first schedule,
      outbox, verification, and RUNNING transition form one retry-safe workflow.
- [x] Multi-host drift and general-access/clock-operation deadlock tests.

## Milestone 5 - test-branch release gate

- [ ] Full typecheck, architecture, lint, unit, build, and non-conditional
      integration suites.
- [ ] Dedicated PostgreSQL/Redis conditional integration suite with skip count
      recorded.
- [x] Recovery runbook exercised from each incomplete status.
- [x] Admin status/readiness exposes revision, phase, participant checksums, and
      incomplete outbox state.
- [ ] User-test deployment evidence is recorded separately from Git push.
- [x] All `FORBID` inventory entries are removed by typed migrations or proven
      inactive preconditions.

## Evidence log

### 2026-09-03 - authority foundation

- `pnpm test:bootstrap`: dependency installation, Prisma generation, and package
  preparation passed in the dedicated worktree.
- `CI=1 TURBO_CONCURRENCY=1 pnpm typecheck`: 21/21 tasks passed.
- `CI=1 TURBO_CONCURRENCY=1 pnpm test`: 12/12 package tasks passed. Conditional
  suites remain classified separately and are not integration evidence.
- `CI=1 TURBO_CONCURRENCY=1 pnpm build`: 26/26 tasks passed.
- `TURBO_CONCURRENCY=1 pnpm lint`: passed with 36 pre-existing frontend
  warnings and no errors.
- `pnpm check:architecture`: package boundaries passed; 21 authoritative clock
  fields and 18 participants were registered.
- Migration SQL was generated, formatted, validated, and registered as the
  release manifest head. All 43 migrations applied to the empty dedicated
  PostgreSQL instance. A second schema upgraded from the previous head with an
  existing manual `world_state` row and verified `MANUAL:1:1` plus all three
  reconciliation tables.
- Dedicated PostgreSQL/Redis fixtures proved exact 24-hour and 65m17.250s gaps,
  schedule distance/order preservation, occurrence checksums, live-lease
  fencing, a single durable outbox, Redis target revision, and recovery after a
  crash between Redis commit and DB finalization.

### 2026-09-03 - revisioned workers and input coordinates

- `CI=1 TURBO_CONCURRENCY=1 pnpm typecheck`: 21/21 tasks passed after the
  worker/input contract changes.
- `CI=1 TURBO_CONCURRENCY=1 pnpm test`: 12/12 package tasks passed.
- Dedicated PostgreSQL runs passed `databaseCommandQueue.integration.test.ts`
  6/6 and `runtimeClockShiftPersistence.integration.test.ts` 3/3 when executed
  sequentially; the latter now clears each single-world fixture before the next
  case. Dedicated Redis passed tournament source revision 4/4, including an
  atomic stale-clock rejection. API input-event integration passed 13/13.
- The 24-hour/65m17.250s reconciliation suite passed 2/2 after the other DB
  suites. Conditional files share a deliberately dedicated schema and are run
  sequentially to prevent their fixture cleanup from racing another file.

### 2026-09-03 - Gateway lifecycle authority

- Runtime `PAUSE`/`STOP` starts a durable maintenance suspension before the
  Gateway status and process reconciliation change. `RESUME` completes the DB
  reconciliation and Redis outbox before the profile becomes `RUNNING`.
- Both an already-built overdue `RESERVED` profile and an overdue `PREOPEN`
  profile promote the game DB from `PREOPEN@0` before the Gateway status changes
  to `RUNNING`; the Redis clock phase is revision/generation fenced.
- `pnpm --filter @sammo-ts/gateway-api test` passed 313 tests with 35
  environment-conditional skips. Gateway typecheck and target lint passed.

### 2026-09-03 - atomic unification wait

- A unification flush now commits the finalization, actionable prompts, and one
  deterministic `UNIFICATION_WAIT` suspension together. A late archive failure
  rolls the whole boundary back; retry creates one ledger.
- The suspended command queue admits only an invader decision tied to the
  active ledger. The daemon-authorized command transaction applies a 36-hour
  exact gap, preserves participant positions, changes the fixture rate from 10
  to 20 minutes, creates one invader nation and ten deterministic generals with
  future first turns, and writes one final-rate projection outbox.
- The dedicated PostgreSQL/Redis fixture reached `RUNNING@2/2` only after the
  Redis projection. DB-wall versus a mocked 12-hour host drift and concurrent
  general-access lock acquisition completed without drift or deadlock.
