# Game clock reconciliation

## Product contract

Gameplay time is an integer `GameTick`; one turn is permanently `36,000,000`
ticks. Wall time is separately authoritative for account, community, audit,
lease, retry, notification, and operational rules. It is never projected into a
game deadline. A long suspension advances the observed game coordinate to the
resume wall instant without replaying skipped turns, monthly events, RNG,
auctions, or tournaments. Every movable future GAME schedule is shifted by the
same exact tick delta, including the sub-turn remainder. WALL occurrences and
deadlines are outside that operation.

The clock state is stored in `world_state`:

- `clock_phase` gates gameplay commits.
- `clock_revision` identifies the coordinate conversion generation.
- `deadline_generation` fences worker deadlines rebuilt from that generation.
- `clock_tick` and `clock_wall_anchor` form the durable observed-time snapshot.
- `last_turn_tick` is the execution cursor and is independent from occurrence
  history.

The phases are `PREOPEN`, `RUNNING`, `SUSPENDED`, `RECONCILING`, `MANUAL`, and
`COMPLETED`. `PREOPEN` alone permits signed negative observed ticks and floors
executable schedules at zero. `RUNNING` never projects below its durable tick
when wall time moves backward. `SUSPENDED`, `RECONCILING`, and `COMPLETED` do not
permit turn or monthly commits. `MANUAL` moves only through explicit engine
progression.

## Durable operation

A suspension begins under the turn-daemon fence and schema-scoped clock lock.
It records the cut tick, database wall instant, rate, source revision, and
participant checksum in `clock_suspension`. Resume reads the database wall
instant and builds an exact plan:

```text
gapTicks = max(0, ticksBetween(cutWall, resumeWall, rateAtCut))
shiftTicks = gapTicks - catchUpTicks
alignedTick = cutTick + gapTicks
deadlineAfter = deadlineBefore + shiftTicks
```

Planned maintenance, delayed opening, and unification wait use zero catch-up.
The compatibility-only complete-turn behavior is named
`LEGACY_COMPLETE_TURNS`; it is not the exact policy.

Every participant writes its `SHIFT`, `KEEP`, `REBUILD`, or `FORBID` decision,
row count, and before/after checksum to `clock_reconciliation_participant`.
The authoritative registry is
[`game-clock-participants.json`](./game-clock-participants.json). The
architecture gate rejects a new tick/revision field that is absent from that
inventory.

The participant set contains only GAME authority or its projections: world and
turn cursors, general turns/recent-war occurrences/reselection deadlines,
auction occurrences/deadlines, actionable-message occurrences/deadlines,
vote deadlines, selection/NPC windows, input-event game coordinates,
tournament Redis deadlines, and clock-operation metadata. A normal message's
`created_at_wall`/`delete_until_wall`, inheritance receipts, notification and
outbox retry timestamps, leases, and audit columns are explicitly excluded.
The former broad `message-expiry` meaning is split into
`message-action-expiry`; an envelope has no GAME lifetime.

## Unification wait

A unification month with an invader choice changes `RUNNING -> SUSPENDED` and
persists a deterministic `UNIFICATION_WAIT` suspension in the same transaction
as the archive, prompts, and final unification state. Only a `raiseInvader`
message response tied to that active suspension may pass the suspended command
queue; all other gameplay remains pending.

If the profile processes are operationally stopped during this wait, Gateway
RESUME starts the runtime without consuming the suspension. The database remains
`SUSPENDED`; the daemon-authorized response is still the only transition that may
reconcile it. Selecting one difficulty resolves every pending `raiseInvader`
alternative created at the same game tick, while preserving each message's wall
envelope as history.

The response transaction verifies daemon authority, performs the exact
alignment, applies all participant shifts, optionally changes the turn rate,
then creates the invader nation, deterministic general IDs/RNG results, first
turns, and the final target-revision outbox. The optional rate change refreshes
the outbox with the final base/rate before commit. DB remains `RECONCILING`
until the daemon projection worker applies Redis and verifies the target
revision/generation. Games without an invader choice move directly to
`COMPLETED`. After an invader game reaches `isUnited=3`, `InvaderEnding` also
changes the clock to `COMPLETED` in the terminal monthly transaction.

## DB to Redis boundary

The database transaction leaves the phase `RECONCILING` and creates exactly one
`clock_projection_outbox` row for the target revision. An outbox worker rebuilds
auction and tournament projections and writes
`sammo:{profile}:clock:active-revision` last. Only after checksum verification
may the database transition to `RUNNING` for the same target revision and
deadline generation.

Workers must compare DB revision, Redis active revision, phase, and deadline
generation before dequeue and again in their final database transaction. Due
pop is one Redis operation: verify revision/phase, read `-inf..nowTick`, and
remove the claimed members. A failed Redis rebuild therefore leaves the game in
`RECONCILING`; process liveness alone is not readiness.

`applyNextClockProjection()` claims rows with `FOR UPDATE SKIP LOCKED` and uses
PostgreSQL UTC wall time for claim/retry timestamps. One Redis Lua operation
compares the active source revision, rebuilds the auction timer, conditionally
replaces the exact tournament source snapshot, and writes target revision plus
deadline generation. The DB finalizer then re-acquires the clock-operation lock
and changes `RECONCILING -> RUNNING` only when target revision and generation
still match. If the process dies after the Lua commit, retry observes the
already-active target revision and performs only the DB finalizer.

An active legacy tournament containing only `nextAt`/`bettingCloseAt` is a
fail-closed migration boundary. Reconciliation remains incomplete until its
authoritative `nextTick`/`bettingCloseTick` dual-write exists.

## Lock order

All mutation paths use this order:

```text
turn-daemon fencing row
-> game-clock:operation advisory transaction lock
-> general-access:persistence advisory transaction lock (only if needed)
-> world_state FOR UPDATE
-> participant rows/tables in registry order
-> DB commit
-> Redis outbox projection
```

The ordinary turn flush and daemon command claim validate phase, revision, and
deadline generation after taking this lock prefix. WALL-only message/account
operations do not take this lock and remain available while suspended. Hybrid
operations commit their GAME effect only behind this fence; inheritance debit,
receipt, effect, and command success are one transaction.

## Opening invariant

Both production and direct seeding use the same scenario seeder. It stores
`clock_tick = 0`, `last_turn_tick = 0`, and the scheduled opening as
`clock_wall_anchor`. The metadata names `seededAtWall`, `scheduledOpenAtWall`,
`projectedGameDateAtOpening`, and `calendarStart` separately. Precreated general
turn ticks are calculated from zero and therefore cannot be negative. At the
wall anchor the in-memory phase promotion refuses any PREOPEN clock whose stored
tick is not exactly zero.

## Compatibility and migration

This branch begins with dual-read defaults for callers and fixtures built before
the new columns. Database migration backfills manual profiles as `MANUAL`,
future anchored realtime profiles as `PREOPEN`, and other profiles as
`RUNNING`. Existing DateTime columns remain projections while tick columns are
authoritative.

A row is considered an initialized authoritative clock only when
`clock_base_time`, `clock_tick`, `clock_wall_anchor`, and `last_turn_tick` are
all present. Before that boundary, the loader and ordinary turn-flush fence both
treat the row as legacy `MANUAL`; the first fenced flush installs the complete
snapshot atomically instead of trusting the new column's `RUNNING` database
default. Input-event acceptance does not use that compatibility fallback: an
API or worker records only a DB-wall receipt, then the daemon establishes the
GAME coordinate while claiming under the authoritative fence. Rolling-upgrade
payload coordinates may be parsed and ignored, but never become rule authority.

Migration `20260903140000_split_message_wall_and_game_time` separates message
envelopes from actions and adds explicit auction-bid occurrence/request facts,
inheritance receipts, and selection cooldown tick authority. Legacy projection
columns remain temporarily for old readers. A missing GAME tick fails closed;
it never changes the rule to WALL_TIME. A WALL rule likewise never derives an
authority tick. See [`time-domains.md`](./time-domains.md) for the complete
inventory and migration policy.

Migration `20260903183000_turn_daemon_lease_utc_wall` expires ephemeral daemon
leases at deployment and installs UTC wall defaults. Migration
`20260903201500_complete_invader_game_clock` repairs legacy `isUnited=3` worlds
left in a running/manual phase and resolves obsolete unchosen invader actions at
the terminal authoritative game tick.

No active participant remains `FORBID`. Tournament writes carry
tick/revision/generation coordinates and are revision-fenced in Redis.
Unification wait uses the same durable ledger and outbox boundary; the former
temporary `lastTurnTime` save/restore workaround is not part of the workflow.
