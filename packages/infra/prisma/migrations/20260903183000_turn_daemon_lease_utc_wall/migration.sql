-- A daemon lease is an operational WALL_TIME deadline. The game database keeps
-- legacy DateTime columns as TIMESTAMP(3), while its session timezone can be
-- Asia/Seoul, so bare CURRENT_TIMESTAMP writes were nine hours ahead of the UTC
-- comparisons used by clock fencing.
--
-- Lease rows are ephemeral authority, not business history. Expire every row at
-- the migration boundary so an old writer is fenced and a new UTC-aware daemon
-- must acquire a fresh epoch. This also makes mixed-version deployment fail
-- closed instead of preserving a falsely-live lease.
BEGIN;

UPDATE "turn_daemon_lease"
SET
    "lease_until" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
    "heartbeat_at" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC';

ALTER TABLE "turn_daemon_lease"
    ALTER COLUMN "heartbeat_at" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');

COMMIT;
