# Game clock reconciliation recovery

This runbook is intentionally fail-closed. Do not force a profile to `RUNNING`
or delete an outbox row merely because its process is alive.

## Observe

Read only the target game schema. Record `world_state.clock_phase`,
`clock_revision`, `deadline_generation`, the latest `clock_suspension`, all its
participant checksums, and the matching `clock_projection_outbox`. Compare that
target revision with `sammo:{profile}:clock:active-revision`. Never print DB or
Redis credentials.

## Status meaning

- `SUSPENDED`: the cut is durable; no alignment DB transaction has committed.
- `RECONCILING` with `PENDING`/`FAILED` outbox: DB schedules moved, Redis is not
  authoritative yet, and gameplay must remain stopped.
- `RECONCILING` with `APPLIED` outbox: verify Redis active revision and all
  participant checksums before finalizing.
- `RUNNING`: DB revision, deadline generation, and Redis active revision must
  agree. A mismatch is an incident and workers must not dequeue.

## Retry

Retry the same suspension ID and target revision through the clock-operation
service. The service must re-read participant checksums and either return the
already-applied result or resume the pending outbox. Never create a replacement
revision to hide a failed target revision.

For `UNIFICATION_WAIT`, never rerun invader creation as a separate repair.
The input event, aligned schedules, optional rate, deterministic invader IDs,
reserved turns, and outbox committed together. A committed command with a
`RECONCILING` world therefore needs only the same outbox retry. If the command
transaction rolled back, the original prompt and source revision remain and
the same response can be retried without changing IDs or RNG results.

When an outbox row is `FAILED`, the profile must remain `RECONCILING`. A retry
is safe in both crash locations:

- before Redis commit, the Lua operation reapplies from the source revision;
- after Redis commit but before DB finalization, the Lua operation returns the
  already-active target result and DB finalization resumes without shifting any
  tournament deadline twice.

`lastError` naming a legacy tournament deadline means the tournament lacks its
tick dual-write. Do not force the active revision; migrate or prove the
tournament inactive, then retry the same outbox.

## Rollback

There is no blind inverse update. Before enabling exact reconciliation in an
environment, keep the normal database backup required for schema migrations.
If participant verification shows an unexpected mutation, stop the profile,
retain the ledger/outbox evidence, and restore the whole game schema from that
backup. Redis projections are then rebuilt from the restored DB revision.

The conditional clock suite exercises `SUSPENDED`, `RECONCILING/PENDING`,
`RECONCILING/FAILED` before and after Redis commit, recovered `APPLIED`, and
final `RUNNING`. The admin status endpoint exposes the phase, revision,
participant checksums, and outbox error needed to choose the matching step.
