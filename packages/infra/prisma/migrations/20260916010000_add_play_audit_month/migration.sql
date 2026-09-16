CREATE TABLE "play_audit_month" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "server_id" TEXT NOT NULL,
 "year" INTEGER NOT NULL,
 "month" INTEGER NOT NULL CHECK ("month" BETWEEN 1 AND 12),
 "kind" TEXT NOT NULL CHECK ("kind" IN ('MONTH_END', 'FINAL')),
 "tick" INTEGER,
 "schema_version" INTEGER NOT NULL DEFAULT 1,
 "settlements_complete" BOOLEAN NOT NULL,
 "hash" TEXT NOT NULL,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "play_audit_month_server_id_year_month_kind_key" ON "play_audit_month" ("server_id", "year", "month", "kind");
CREATE TABLE "play_audit_nation" (
 "sample_id" TEXT NOT NULL REFERENCES "play_audit_month"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "nation_id" INTEGER NOT NULL,
 "data" JSONB NOT NULL,
 PRIMARY KEY ("sample_id", "nation_id")
);
CREATE TABLE "play_audit_city" (
 "sample_id" TEXT NOT NULL REFERENCES "play_audit_month"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "city_id" INTEGER NOT NULL,
 "nation_id" INTEGER NOT NULL,
 "data" JSONB NOT NULL,
 PRIMARY KEY ("sample_id", "city_id")
);
CREATE INDEX "play_audit_city_sample_id_nation_id_city_id_idx" ON "play_audit_city" ("sample_id", "nation_id", "city_id");
CREATE TABLE "play_audit_general" (
 "sample_id" TEXT NOT NULL REFERENCES "play_audit_month"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "general_id" INTEGER NOT NULL,
 "nation_id" INTEGER NOT NULL,
 "city_id" INTEGER NOT NULL,
 "npc_state" INTEGER NOT NULL,
 "data" JSONB NOT NULL,
 PRIMARY KEY ("sample_id", "general_id")
);
CREATE INDEX "play_audit_general_sample_id_nation_id_general_id_idx" ON "play_audit_general" ("sample_id", "nation_id", "general_id");
CREATE INDEX "play_audit_general_sample_id_city_id_general_id_idx" ON "play_audit_general" ("sample_id", "city_id", "general_id");
