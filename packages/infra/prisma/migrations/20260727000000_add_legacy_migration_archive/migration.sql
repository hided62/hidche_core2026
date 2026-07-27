ALTER TABLE "ng_old_nations"
    ADD COLUMN IF NOT EXISTS "source_id" INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS "ng_old_nations_server_id_nation";
CREATE UNIQUE INDEX IF NOT EXISTS "ng_old_nations_server_nation_source"
    ON "ng_old_nations" ("server_id", "nation", "source_id");

ALTER TABLE "yearbook_history"
    ADD COLUMN IF NOT EXISTS "source_id" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "global_history" JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS "global_action" JSONB NOT NULL DEFAULT '[]'::jsonb;

DROP INDEX IF EXISTS "yearbook_history_profile_year_month_key";
CREATE UNIQUE INDEX IF NOT EXISTS "yearbook_history_profile_year_month_source"
    ON "yearbook_history" ("profile_name", "year", "month", "source_id");

ALTER TABLE "inheritance_log"
    ADD COLUMN IF NOT EXISTS "legacy_id" INTEGER,
    ADD COLUMN IF NOT EXISTS "server_id" TEXT,
    ADD COLUMN IF NOT EXISTS "log_type" TEXT NOT NULL DEFAULT 'inheritPoint';

CREATE UNIQUE INDEX IF NOT EXISTS "inheritance_log_legacy_id_key"
    ON "inheritance_log" ("legacy_id");

ALTER TABLE "emperior"
    ADD COLUMN IF NOT EXISTS "legacy_id" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "emperior_legacy_id_key"
    ON "emperior" ("legacy_id");

ALTER TABLE "inheritance_result"
    ADD COLUMN IF NOT EXISTS "legacy_id" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "inheritance_result_legacy_id_key"
    ON "inheritance_result" ("legacy_id");

CREATE TABLE IF NOT EXISTS "legacy_game_storage" (
    "id" SERIAL PRIMARY KEY,
    "source_id" INTEGER NOT NULL,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "scope" TEXT NOT NULL,
    "migrated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "legacy_game_storage_source_id_key" UNIQUE ("source_id"),
    CONSTRAINT "legacy_game_storage_namespace_key" UNIQUE ("namespace", "key")
);

CREATE INDEX IF NOT EXISTS "legacy_game_storage_scope_namespace"
    ON "legacy_game_storage" ("scope", "namespace");
