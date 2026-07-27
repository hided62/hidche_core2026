DO $$
BEGIN
    CREATE TYPE "OAuthType" AS ENUM ('NONE', 'KAKAO');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    CREATE TYPE "GatewayProfileStatus" AS ENUM (
        'RESERVED', 'PREOPEN', 'RUNNING', 'PAUSED', 'COMPLETED', 'STOPPED', 'DISABLED'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    CREATE TYPE "GatewayBuildStatus" AS ENUM ('IDLE', 'QUEUED', 'RUNNING', 'FAILED', 'SUCCEEDED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    CREATE TYPE "GatewayOperationType" AS ENUM ('RESET', 'START', 'STOP');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    CREATE TYPE "GatewayOperationStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    CREATE TYPE "GatewaySourceMode" AS ENUM ('BRANCH', 'COMMIT');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "app_user" (
    "id" TEXT PRIMARY KEY,
    "login_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "password_salt" TEXT NOT NULL,
    "roles" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "sanctions" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "oauth_type" "OAuthType" NOT NULL DEFAULT 'NONE',
    "oauth_id" TEXT,
    "email" TEXT,
    "oauth_info" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_login_at" TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "app_user_login_id_key" ON "app_user" ("login_id");
CREATE UNIQUE INDEX IF NOT EXISTS "app_user_oauth_id_key" ON "app_user" ("oauth_id");
CREATE UNIQUE INDEX IF NOT EXISTS "app_user_email_key" ON "app_user" ("email");

CREATE TABLE IF NOT EXISTS "gateway_profile" (
    "profile_name" TEXT PRIMARY KEY,
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
    "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "gateway_profile_profile_scenario_key"
    ON "gateway_profile" ("profile", "scenario");

CREATE TABLE IF NOT EXISTS "gateway_operation" (
    "id" TEXT PRIMARY KEY,
    "profile_name" TEXT NOT NULL REFERENCES "gateway_profile" ("profile_name") ON DELETE CASCADE,
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
    "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "gateway_operation_status_scheduled_at_created_at_idx"
    ON "gateway_operation" ("status", "scheduled_at", "created_at");
CREATE INDEX IF NOT EXISTS "gateway_operation_profile_name_created_at_idx"
    ON "gateway_operation" ("profile_name", "created_at");

CREATE TABLE IF NOT EXISTS "system" (
    "no" INTEGER PRIMARY KEY DEFAULT 1,
    "notice" TEXT NOT NULL DEFAULT ''
);
