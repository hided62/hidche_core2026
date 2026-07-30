CREATE TYPE "GatewayRuntimeActionStatus" AS ENUM (
    'REQUESTED',
    'PARTIAL',
    'APPLIED',
    'FAILED',
    'IGNORED'
);

CREATE TABLE "gateway_runtime_action" (
    "id" TEXT NOT NULL,
    "profile_name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "duration_minutes" INTEGER,
    "scheduled_at" TIMESTAMP(3),
    "reason" TEXT,
    "requested_by" TEXT NOT NULL,
    "status" "GatewayRuntimeActionStatus" NOT NULL DEFAULT 'REQUESTED',
    "detail" TEXT,
    "handler" TEXT,
    "handled_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateway_runtime_action_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "gateway_runtime_action_profile_name_fkey"
        FOREIGN KEY ("profile_name")
        REFERENCES "gateway_profile"("profile_name")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE INDEX "gateway_runtime_action_profile_name_status_created_at_idx"
    ON "gateway_runtime_action"("profile_name", "status", "created_at");

CREATE INDEX "gateway_runtime_action_profile_name_created_at_idx"
    ON "gateway_runtime_action"("profile_name", "created_at");

CREATE UNIQUE INDEX "gateway_runtime_action_one_pending_per_profile_idx"
    ON "gateway_runtime_action"("profile_name")
    WHERE "status" IN ('REQUESTED', 'PARTIAL');
