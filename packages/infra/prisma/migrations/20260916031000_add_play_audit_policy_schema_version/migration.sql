ALTER TABLE "play_audit_policy" ADD COLUMN "schema_version" INTEGER NOT NULL DEFAULT 1 CHECK ("schema_version" > 0);
