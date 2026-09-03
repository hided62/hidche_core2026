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
- [ ] Empty and upgraded database migration execution evidence.

## Milestone 2 - exact DB reconciliation

- [ ] Suspension start command with DB wall time and idempotent source revision.
- [ ] Exact resume plan transaction with deterministic participant lock order.
- [ ] SHIFT adapters for cursor, generals, active auctions, message expiry, vote
  end, select pool, and NPC selection windows.
- [ ] KEEP checksum adapters for occurrences and history.
- [ ] Explicit `LEGACY_COMPLETE_TURNS` and bounded `CATCH_UP` policies.
- [ ] Property tests for remaining distance, ordering, and history invariants.
- [ ] 24-hour and 65m17.250s PostgreSQL integration evidence.

## Milestone 3 - revisioned Redis and workers

- [ ] Projection outbox claimer/retry/recovery state machine.
- [ ] Redis active revision and atomic due-pop script.
- [ ] Auction OPEN/FINALIZING revision and generation fence.
- [ ] Tournament durable tick dual-write and projection rebuild.
- [ ] DB-commit/Redis-failure restart tests and readiness integration.

## Milestone 4 - command and lifecycle workflows

- [ ] All durable input events record accepted tick and accepted revision.
- [ ] Processing converts accepted coordinates across revisions or fails closed.
- [ ] Gateway pause/resume/open orchestration writes the DB clock phase.
- [ ] Unification wait becomes a durable `UNIFICATION_WAIT` suspension.
- [ ] Alignment, optional rate change, invader IDs/RNG, creation, first schedule,
  outbox, verification, and RUNNING transition form one retry-safe workflow.
- [ ] Multi-host drift and general-access/clock-operation deadlock tests.

## Milestone 5 - test-branch release gate

- [ ] Full typecheck, architecture, lint, unit, build, and non-conditional
  integration suites.
- [ ] Dedicated PostgreSQL/Redis conditional integration suite with skip count
  recorded.
- [ ] Recovery runbook exercised from each incomplete status.
- [ ] Admin status/readiness exposes revision, phase, participant checksums, and
  incomplete outbox state.
- [ ] User-test deployment evidence is recorded separately from Git push.
- [ ] All `FORBID` inventory entries are removed by typed migrations or proven
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
  release manifest head. Empty/upgraded PostgreSQL execution is still pending.
