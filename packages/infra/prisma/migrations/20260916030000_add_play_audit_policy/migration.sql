CREATE TABLE "play_audit_policy" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "server_id" TEXT NOT NULL,
  "nation_id" INTEGER NOT NULL,
  "area" TEXT NOT NULL CHECK ("area" IN ('NPC_VALUES', 'NPC_NATION_PRIORITY', 'NPC_GENERAL_PRIORITY', 'DEFENCE')),
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "previous_id" TEXT,
  "source" TEXT NOT NULL CHECK ("source" IN ('BASELINE', 'CHANGE', 'OBSERVED_GAP')),
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL CHECK ("month" BETWEEN 1 AND 12),
  "tick" INTEGER,
  "request_id" TEXT,
  "input_sequence" BIGINT,
  "ordinal" INTEGER NOT NULL,
  "actor" JSONB,
  "before" JSONB,
  "after" JSONB NOT NULL,
  "hash" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "play_audit_policy_server_id_nation_id_area_revision_key" ON "play_audit_policy" ("server_id", "nation_id", "area", "revision");
CREATE INDEX "play_audit_policy_server_id_nation_id_year_month_ordinal_idx" ON "play_audit_policy" ("server_id", "nation_id", "year", "month", "ordinal");
