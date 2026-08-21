-- Gateway release history is an absolute control-plane timeline. Preserve every
-- existing raw value as its current UTC interpretation (including historical bad
-- rows), then make future CURRENT_TIMESTAMP writes independent of session timezone.
ALTER TABLE "gateway_release_operation"
    ALTER COLUMN "created_at" DROP DEFAULT;

ALTER TABLE "gateway_release_log"
    ALTER COLUMN "created_at" DROP DEFAULT;

ALTER TABLE "gateway_release_state"
    ALTER COLUMN "last_successful_at" TYPE TIMESTAMPTZ(3)
        USING "last_successful_at" AT TIME ZONE 'UTC',
    ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3)
        USING "updated_at" AT TIME ZONE 'UTC';

ALTER TABLE "gateway_release_operation"
    ALTER COLUMN "started_at" TYPE TIMESTAMPTZ(3)
        USING "started_at" AT TIME ZONE 'UTC',
    ALTER COLUMN "completed_at" TYPE TIMESTAMPTZ(3)
        USING "completed_at" AT TIME ZONE 'UTC',
    ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3)
        USING "created_at" AT TIME ZONE 'UTC',
    ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3)
        USING "updated_at" AT TIME ZONE 'UTC';

ALTER TABLE "gateway_release_log"
    ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3)
        USING "created_at" AT TIME ZONE 'UTC';

ALTER TABLE "gateway_release_operation"
    ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "gateway_release_log"
    ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
