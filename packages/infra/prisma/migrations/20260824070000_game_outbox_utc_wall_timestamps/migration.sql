-- The game schema contains legacy wall-clock DateTime fields, so its shared
-- connection pool cannot be changed to UTC wholesale. Keep the two operational
-- outboxes rollback-compatible as TIMESTAMP(3), but make their scheduling and
-- event-time contract explicitly UTC wall time.
BEGIN;

-- Read-model journal inserts omit both timestamp columns and therefore used the
-- database session wall clock. Normalize that single-provenance history to UTC
-- wall time. Web Push createMany already wrote JavaScript UTC fields, so its
-- created_at values must remain byte-for-byte unchanged.
UPDATE "read_model_outbox"
SET "created_at" = ("created_at" AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'UTC';

-- Both outboxes are at-least-once. Release stale leases and make every pending
-- row immediately eligible so mixed historical available_at provenance cannot
-- strand it. Read-model replay is a tolerated duplicate invalidation; Web Push
-- replay is deduplicated by its stable Gateway event ID.
UPDATE "read_model_outbox"
SET
    "available_at" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
    "locked_at" = NULL,
    "lock_owner" = NULL
WHERE "delivered_at" IS NULL;

UPDATE "web_push_outbox"
SET
    "available_at" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
    "locked_at" = NULL,
    "lock_owner" = NULL
WHERE "delivered_at" IS NULL;

ALTER TABLE "read_model_outbox"
    ALTER COLUMN "available_at" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    ALTER COLUMN "created_at" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');

ALTER TABLE "web_push_outbox"
    ALTER COLUMN "available_at" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    ALTER COLUMN "created_at" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');

COMMIT;
