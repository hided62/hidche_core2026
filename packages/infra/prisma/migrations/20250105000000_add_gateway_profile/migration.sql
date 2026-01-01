-- Create enums for gateway profile tracking
CREATE TYPE "GatewayProfileStatus" AS ENUM (
    'RESERVED',
    'PREOPEN',
    'RUNNING',
    'PAUSED',
    'COMPLETED',
    'STOPPED',
    'DISABLED'
);

CREATE TYPE "GatewayBuildStatus" AS ENUM (
    'IDLE',
    'QUEUED',
    'RUNNING',
    'FAILED',
    'SUCCEEDED'
);

-- Create gateway profile table
CREATE TABLE "gateway_profile" (
    "profile_name" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "api_port" INTEGER NOT NULL,
    "status" "GatewayProfileStatus" NOT NULL,
    "build_status" "GatewayBuildStatus" NOT NULL DEFAULT 'IDLE',
    "build_commit_sha" TEXT,
    "build_workspace" TEXT,
    "build_last_used_at" TIMESTAMP(3),
    "preopen_at" TIMESTAMP(3),
    "open_at" TIMESTAMP(3),
    "scheduled_start_at" TIMESTAMP(3),
    "build_requested_at" TIMESTAMP(3),
    "build_started_at" TIMESTAMP(3),
    "build_completed_at" TIMESTAMP(3),
    "build_error" TEXT,
    "last_error" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gateway_profile_pkey" PRIMARY KEY ("profile_name"),
    CONSTRAINT "gateway_profile_profile_scenario_key" UNIQUE ("profile", "scenario")
);
