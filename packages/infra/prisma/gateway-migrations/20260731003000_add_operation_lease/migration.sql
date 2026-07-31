ALTER TABLE "gateway_operation"
    ADD COLUMN "lease_owner" TEXT,
    ADD COLUMN "lease_until" TIMESTAMPTZ,
    ADD COLUMN "heartbeat_at" TIMESTAMPTZ,
    ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "gateway_operation_status_lease_until_created_at_idx"
    ON "gateway_operation" ("status", "lease_until", "created_at");
