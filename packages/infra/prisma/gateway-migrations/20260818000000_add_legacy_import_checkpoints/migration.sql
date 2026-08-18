CREATE TABLE "legacy_import_run" (
    "id" BIGSERIAL PRIMARY KEY,
    "source_key" TEXT NOT NULL,
    "source_fingerprint" CHAR(64) NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    "counts" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "progress" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "error" TEXT,
    CONSTRAINT "legacy_import_run_mode_check" CHECK ("mode" IN ('full', 'incremental')),
    CONSTRAINT "legacy_import_run_status_check" CHECK ("status" IN ('RUNNING', 'COMPLETED', 'FAILED')),
    CONSTRAINT "legacy_import_run_fingerprint_check" CHECK ("source_fingerprint" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX "legacy_import_run_source_started"
    ON "legacy_import_run" ("source_key", "started_at" DESC);

CREATE TABLE "legacy_import_checkpoint" (
    "source_key" TEXT NOT NULL,
    "source_fingerprint" CHAR(64) NOT NULL,
    "source_table" TEXT NOT NULL,
    "last_legacy_id" BIGINT NOT NULL,
    "import_run_id" BIGINT NOT NULL REFERENCES "legacy_import_run" ("id"),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("source_key", "source_table"),
    CONSTRAINT "legacy_import_checkpoint_fingerprint_check" CHECK ("source_fingerprint" ~ '^[a-f0-9]{64}$')
);
