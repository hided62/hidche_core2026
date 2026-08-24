-- Keep the opening RESET reservation while allowing exactly one immediate
-- operation (the application permits only DEPLOY) beside it. A single RUNNING
-- lane preserves the existing profile mutation serialization contract.
DROP INDEX "gateway_operation_one_active_per_profile_idx";

CREATE UNIQUE INDEX "gateway_operation_one_running_per_profile_idx"
    ON "gateway_operation" ("profile_name")
    WHERE "status" = 'RUNNING';

CREATE UNIQUE INDEX "gateway_operation_one_queued_scheduled_reset_per_profile_idx"
    ON "gateway_operation" ("profile_name")
    WHERE "status" = 'QUEUED'
      AND "type" = 'RESET'
      AND "scheduled_at" IS NOT NULL;

CREATE UNIQUE INDEX "gateway_operation_one_queued_immediate_per_profile_idx"
    ON "gateway_operation" ("profile_name")
    WHERE "status" = 'QUEUED'
      AND NOT ("type" = 'RESET' AND "scheduled_at" IS NOT NULL);
