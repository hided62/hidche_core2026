-- A profile database can have only one destructive/runtime operation in flight.
-- Existing duplicates intentionally make this migration fail so an operator can
-- inspect and resolve them instead of silently discarding an operation.
CREATE UNIQUE INDEX "gateway_operation_one_active_per_profile_idx"
    ON "gateway_operation" ("profile_name")
    WHERE "status" IN ('QUEUED', 'RUNNING');
