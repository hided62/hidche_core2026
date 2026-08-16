CREATE TABLE "read_model_revision" (
    "domain" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL DEFAULT 0,
    "revision" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "read_model_revision_pkey" PRIMARY KEY ("domain", "entity_id"),
    CONSTRAINT "read_model_revision_entity_id_check" CHECK ("entity_id" >= 0),
    CONSTRAINT "read_model_revision_revision_check" CHECK ("revision" >= 0)
);

CREATE TABLE "read_model_outbox" (
    "id" BIGSERIAL NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "lock_owner" TEXT,
    "delivered_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "read_model_outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "read_model_outbox_attempts_check" CHECK ("attempts" >= 0)
);

CREATE INDEX "read_model_outbox_delivered_at_available_at_id_idx"
    ON "read_model_outbox"("delivered_at", "available_at", "id");

CREATE TABLE "read_model_revision_meta" (
    "id" INTEGER NOT NULL,
    "coverage_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "read_model_revision_meta_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "read_model_revision_meta_coverage_version_check" CHECK ("coverage_version" >= 0)
);

INSERT INTO "read_model_revision_meta" ("id", "coverage_version")
VALUES (1, 0);
