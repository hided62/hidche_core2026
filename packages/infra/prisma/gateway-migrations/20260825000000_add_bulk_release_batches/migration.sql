CREATE TABLE "gateway_bulk_release" (
    "id" UUID NOT NULL,
    "source_mode" "GatewaySourceMode" NOT NULL,
    "source_ref" TEXT NOT NULL,
    "resolved_commit_sha" TEXT NOT NULL,
    "reason" TEXT,
    "requested_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "gateway_bulk_release_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "gateway_operation"
    ADD COLUMN "bulk_release_id" UUID,
    ADD COLUMN "bulk_order" INTEGER;

ALTER TABLE "gateway_release_operation"
    ADD COLUMN "bulk_release_id" UUID,
    ADD COLUMN "bulk_order" INTEGER;

ALTER TABLE "gateway_operation"
    ADD CONSTRAINT "gateway_operation_bulk_release_id_fkey"
    FOREIGN KEY ("bulk_release_id") REFERENCES "gateway_bulk_release"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "gateway_release_operation"
    ADD CONSTRAINT "gateway_release_operation_bulk_release_id_fkey"
    FOREIGN KEY ("bulk_release_id") REFERENCES "gateway_bulk_release"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "gateway_bulk_release_created_at_idx"
    ON "gateway_bulk_release"("created_at");

CREATE INDEX "gateway_operation_bulk_release_id_bulk_order_idx"
    ON "gateway_operation"("bulk_release_id", "bulk_order");

CREATE INDEX "gateway_release_operation_bulk_release_id_bulk_order_idx"
    ON "gateway_release_operation"("bulk_release_id", "bulk_order");
