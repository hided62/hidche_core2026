CREATE TYPE "GatewayOperationType" AS ENUM ('RESET', 'START', 'STOP');
CREATE TYPE "GatewayOperationStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "GatewaySourceMode" AS ENUM ('BRANCH', 'COMMIT');

CREATE TABLE "gateway_operation" (
    "id" TEXT NOT NULL,
    "profile_name" TEXT NOT NULL,
    "type" "GatewayOperationType" NOT NULL,
    "status" "GatewayOperationStatus" NOT NULL DEFAULT 'QUEUED',
    "source_mode" "GatewaySourceMode",
    "source_ref" TEXT,
    "resolved_commit_sha" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "reason" TEXT,
    "requested_by" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gateway_operation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "gateway_operation_profile_name_fkey"
        FOREIGN KEY ("profile_name") REFERENCES "gateway_profile"("profile_name")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "gateway_operation_status_scheduled_at_created_at_idx"
    ON "gateway_operation"("status", "scheduled_at", "created_at");
CREATE INDEX "gateway_operation_profile_name_created_at_idx"
    ON "gateway_operation"("profile_name", "created_at");
CREATE UNIQUE INDEX "gateway_operation_one_active_per_profile_idx"
    ON "gateway_operation"("profile_name")
    WHERE "status" IN ('QUEUED', 'RUNNING');
