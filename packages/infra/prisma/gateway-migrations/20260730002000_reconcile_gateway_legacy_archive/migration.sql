-- The game and gateway histories once used the same 20260727000000 migration
-- name. Prisma records names in one shared table, so whichever history ran
-- second skipped its different archive SQL. Reapply the gateway side
-- idempotently under a globally unique migration name.
ALTER TABLE "app_user"
    ADD COLUMN IF NOT EXISTS "legacy_data" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "system"
    ADD COLUMN IF NOT EXISTS "registration_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS "login_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "legacy_member_log" (
    "id" BIGINT PRIMARY KEY,
    "member_no" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "action_type" TEXT NOT NULL,
    "action" JSONB
);

CREATE INDEX IF NOT EXISTS "legacy_member_log_user_date"
    ON "legacy_member_log" ("user_id", "date");
CREATE INDEX IF NOT EXISTS "legacy_member_log_member_date"
    ON "legacy_member_log" ("member_no", "date");

CREATE TABLE IF NOT EXISTS "legacy_banned_member" (
    "no" INTEGER PRIMARY KEY,
    "hashed_email" TEXT NOT NULL UNIQUE,
    "info" TEXT
);

CREATE TABLE IF NOT EXISTS "legacy_root_key_value" (
    "id" SERIAL PRIMARY KEY,
    "source_table" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "migrated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "legacy_root_key_value_source_namespace_key"
        UNIQUE ("source_table", "namespace", "key")
);
