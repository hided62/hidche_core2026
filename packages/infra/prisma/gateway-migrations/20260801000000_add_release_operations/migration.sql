ALTER TYPE "GatewayOperationType" ADD VALUE IF NOT EXISTS 'DEPLOY';

CREATE TYPE "GatewayReleaseOperationType" AS ENUM ('DEPLOY', 'ROLLBACK');

CREATE TABLE "gateway_release_state" (
    "id" TEXT NOT NULL DEFAULT 'gateway',
    "active_commit_sha" TEXT,
    "active_workspace" TEXT,
    "previous_commit_sha" TEXT,
    "previous_workspace" TEXT,
    "last_successful_at" TIMESTAMP(3),
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateway_release_state_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gateway_release_operation" (
    "id" TEXT NOT NULL,
    "type" "GatewayReleaseOperationType" NOT NULL,
    "status" "GatewayOperationStatus" NOT NULL DEFAULT 'QUEUED',
    "source_mode" "GatewaySourceMode",
    "source_ref" TEXT,
    "resolved_commit_sha" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "reason" TEXT,
    "requested_by" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error" TEXT,
    "lease_owner" TEXT,
    "lease_until" TIMESTAMPTZ,
    "heartbeat_at" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateway_release_operation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gateway_release_operation_status_lease_until_created_at_idx"
    ON "gateway_release_operation" ("status", "lease_until", "created_at");
CREATE INDEX "gateway_release_operation_created_at_idx"
    ON "gateway_release_operation" ("created_at");
CREATE UNIQUE INDEX "gateway_release_operation_one_active_idx"
    ON "gateway_release_operation" ((1))
    WHERE "status" IN ('QUEUED', 'RUNNING');
