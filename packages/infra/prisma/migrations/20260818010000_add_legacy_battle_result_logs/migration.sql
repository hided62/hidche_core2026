CREATE TABLE IF NOT EXISTS "legacy_archive"."battle_result_import_run" (
    "id" BIGSERIAL PRIMARY KEY,
    "source_profile" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "source_fingerprint" CHAR(64) NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    "counts" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "progress" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "error" TEXT,
    CONSTRAINT "legacy_archive_battle_result_run_profile_check"
        CHECK ("source_profile" IN ('che', 'kwe', 'pwe', 'twe', 'nya', 'pya', 'hwe')),
    CONSTRAINT "legacy_archive_battle_result_run_mode_check" CHECK ("mode" IN ('full', 'incremental')),
    CONSTRAINT "legacy_archive_battle_result_run_status_check"
        CHECK ("status" IN ('RUNNING', 'COMPLETED', 'FAILED')),
    CONSTRAINT "legacy_archive_battle_result_run_fingerprint_check"
        CHECK ("source_fingerprint" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS "legacy_archive_battle_result_run_source_started"
    ON "legacy_archive"."battle_result_import_run" ("source_profile", "source_key", "started_at" DESC);

CREATE TABLE IF NOT EXISTS "legacy_archive"."general_battle_result" (
    "source_profile" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "general_no" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "line_count" INTEGER NOT NULL,
    "source_bytes" BIGINT NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "import_run_id" BIGINT NOT NULL REFERENCES "legacy_archive"."battle_result_import_run" ("id"),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("source_profile", "server_id", "general_no"),
    CONSTRAINT "legacy_archive_general_battle_result_profile_check"
        CHECK ("source_profile" IN ('che', 'kwe', 'pwe', 'twe', 'nya', 'pya', 'hwe')),
    CONSTRAINT "legacy_archive_general_battle_result_general_no_check" CHECK ("general_no" >= 0),
    CONSTRAINT "legacy_archive_general_battle_result_line_count_check" CHECK ("line_count" >= 0),
    CONSTRAINT "legacy_archive_general_battle_result_source_bytes_check" CHECK ("source_bytes" >= 0),
    CONSTRAINT "legacy_archive_general_battle_result_hash_check" CHECK ("content_hash" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE IF NOT EXISTS "legacy_archive"."battle_result_import_checkpoint" (
    "source_profile" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "source_fingerprint" CHAR(64) NOT NULL,
    "server_id" TEXT NOT NULL,
    "manifest_hash" CHAR(64) NOT NULL,
    "file_count" INTEGER NOT NULL,
    "total_bytes" BIGINT NOT NULL,
    "import_run_id" BIGINT NOT NULL REFERENCES "legacy_archive"."battle_result_import_run" ("id"),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("source_profile", "source_key", "server_id"),
    CONSTRAINT "legacy_archive_battle_result_checkpoint_profile_check"
        CHECK ("source_profile" IN ('che', 'kwe', 'pwe', 'twe', 'nya', 'pya', 'hwe')),
    CONSTRAINT "legacy_archive_battle_result_checkpoint_fingerprint_check"
        CHECK ("source_fingerprint" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "legacy_archive_battle_result_checkpoint_manifest_check"
        CHECK ("manifest_hash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "legacy_archive_battle_result_checkpoint_file_count_check" CHECK ("file_count" >= 0),
    CONSTRAINT "legacy_archive_battle_result_checkpoint_total_bytes_check" CHECK ("total_bytes" >= 0)
);
