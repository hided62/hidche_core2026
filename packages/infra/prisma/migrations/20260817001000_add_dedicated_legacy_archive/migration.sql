CREATE SCHEMA IF NOT EXISTS "legacy_archive";

CREATE TABLE IF NOT EXISTS "legacy_archive"."import_run" (
    "id" BIGSERIAL PRIMARY KEY,
    "source_profile" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "counts" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "source_format_summary" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "error" TEXT,
    CONSTRAINT "legacy_archive_import_run_profile_check"
        CHECK ("source_profile" IN ('che', 'kwe', 'pwe', 'twe', 'nya', 'pya', 'hwe')),
    CONSTRAINT "legacy_archive_import_run_status_check"
        CHECK ("status" IN ('RUNNING', 'COMPLETED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS "legacy_archive_import_run_profile_started"
    ON "legacy_archive"."import_run" ("source_profile", "started_at" DESC);

CREATE TABLE IF NOT EXISTS "legacy_archive"."game_history" (
    "source_profile" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "legacy_id" INTEGER NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "legacy_date" TIMESTAMP(3) NOT NULL,
    "winner_nation" INTEGER,
    "map" TEXT,
    "season" INTEGER NOT NULL,
    "scenario" INTEGER NOT NULL,
    "scenario_name" TEXT NOT NULL,
    "raw_env" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "import_run_id" BIGINT NOT NULL REFERENCES "legacy_archive"."import_run" ("id"),
    PRIMARY KEY ("source_profile", "server_id")
);

CREATE INDEX IF NOT EXISTS "legacy_archive_game_history_opened"
    ON "legacy_archive"."game_history" ("source_profile", "opened_at" DESC);

CREATE TABLE IF NOT EXISTS "legacy_archive"."general" (
    "source_profile" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "general_no" INTEGER NOT NULL,
    "legacy_id" INTEGER NOT NULL,
    "owner" TEXT,
    "name" TEXT NOT NULL,
    "last_yearmonth" INTEGER NOT NULL,
    "turntime" TIMESTAMP(3) NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "source_format" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "raw_data" JSONB NOT NULL,
    "import_run_id" BIGINT NOT NULL REFERENCES "legacy_archive"."import_run" ("id"),
    PRIMARY KEY ("source_profile", "server_id", "general_no"),
    CONSTRAINT "legacy_archive_general_schema_version_check" CHECK ("schema_version" = 1)
);

CREATE INDEX IF NOT EXISTS "legacy_archive_general_owner_opened"
    ON "legacy_archive"."general" ("owner", "source_profile", "server_id");
CREATE INDEX IF NOT EXISTS "legacy_archive_general_name"
    ON "legacy_archive"."general" ("source_profile", "server_id", "name");

CREATE TABLE IF NOT EXISTS "legacy_archive"."nation" (
    "source_profile" TEXT NOT NULL,
    "legacy_id" INTEGER NOT NULL,
    "server_id" TEXT NOT NULL,
    "nation" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "archived_at" TIMESTAMP(3) NOT NULL,
    "import_run_id" BIGINT NOT NULL REFERENCES "legacy_archive"."import_run" ("id"),
    PRIMARY KEY ("source_profile", "legacy_id")
);

CREATE INDEX IF NOT EXISTS "legacy_archive_nation_server"
    ON "legacy_archive"."nation" ("source_profile", "server_id", "nation", "archived_at" DESC);

CREATE TABLE IF NOT EXISTS "legacy_archive"."hall" (
    "source_profile" TEXT NOT NULL,
    "legacy_id" INTEGER NOT NULL,
    "server_id" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "scenario" INTEGER NOT NULL,
    "general_no" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "owner" TEXT,
    "aux" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "import_run_id" BIGINT NOT NULL REFERENCES "legacy_archive"."import_run" ("id"),
    PRIMARY KEY ("source_profile", "server_id", "type", "general_no")
);

CREATE INDEX IF NOT EXISTS "legacy_archive_hall_scenario"
    ON "legacy_archive"."hall" ("source_profile", "season", "scenario", "type", "value" DESC);

CREATE TABLE IF NOT EXISTS "legacy_archive"."emperor" (
    "id" BIGSERIAL PRIMARY KEY,
    "source_profile" TEXT NOT NULL,
    "legacy_id" INTEGER NOT NULL,
    "server_id" TEXT,
    "data" JSONB NOT NULL,
    "import_run_id" BIGINT NOT NULL REFERENCES "legacy_archive"."import_run" ("id"),
    CONSTRAINT "legacy_archive_emperor_source_key" UNIQUE ("source_profile", "legacy_id")
);

CREATE INDEX IF NOT EXISTS "legacy_archive_emperor_server"
    ON "legacy_archive"."emperor" ("source_profile", "server_id", "id" DESC);

CREATE TABLE IF NOT EXISTS "legacy_archive"."yearbook" (
    "source_profile" TEXT NOT NULL,
    "legacy_id" INTEGER NOT NULL,
    "profile_name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "map" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "nations" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "global_history" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "global_action" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "content_hash" TEXT NOT NULL,
    "import_run_id" BIGINT NOT NULL REFERENCES "legacy_archive"."import_run" ("id"),
    PRIMARY KEY ("source_profile", "legacy_id")
);

CREATE INDEX IF NOT EXISTS "legacy_archive_yearbook_month"
    ON "legacy_archive"."yearbook" ("source_profile", "profile_name", "year", "month", "legacy_id");
