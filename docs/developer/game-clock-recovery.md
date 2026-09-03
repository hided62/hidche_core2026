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

## Rollback

There is no blind inverse update. Before enabling exact reconciliation in an
environment, keep the normal database backup required for schema migrations.
If participant verification shows an unexpected mutation, stop the profile,
retain the ledger/outbox evidence, and restore the whole game schema from that
backup. Redis projections are then rebuilt from the restored DB revision.

The implementation-plan release gate remains open until these steps have an
automated fixture and an operator-facing status endpoint.
