ALTER TABLE "legacy_archive"."import_run"
    ADD COLUMN "source_key" TEXT,
    ADD COLUMN "source_fingerprint" CHAR(64),
    ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'full',
    ADD COLUMN "progress" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "legacy_archive"."import_run"
    ADD CONSTRAINT "legacy_archive_import_run_mode_check" CHECK ("mode" IN ('full', 'incremental')),
    ADD CONSTRAINT "legacy_archive_import_run_fingerprint_check"
        CHECK ("source_fingerprint" IS NULL OR "source_fingerprint" ~ '^[a-f0-9]{64}$');

CREATE INDEX "legacy_archive_import_run_source_started"
    ON "legacy_archive"."import_run" ("source_profile", "source_key", "started_at" DESC);

CREATE TABLE "legacy_archive"."import_checkpoint" (
    "source_profile" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "source_fingerprint" CHAR(64) NOT NULL,
    "source_table" TEXT NOT NULL,
    "last_legacy_id" BIGINT NOT NULL,
    "import_run_id" BIGINT NOT NULL REFERENCES "legacy_archive"."import_run" ("id"),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("source_profile", "source_key", "source_table"),
    CONSTRAINT "legacy_archive_import_checkpoint_profile_check"
        CHECK ("source_profile" IN ('che', 'kwe', 'pwe', 'twe', 'nya', 'pya', 'hwe')),
    CONSTRAINT "legacy_archive_import_checkpoint_fingerprint_check"
        CHECK ("source_fingerprint" ~ '^[a-f0-9]{64}$')
);
