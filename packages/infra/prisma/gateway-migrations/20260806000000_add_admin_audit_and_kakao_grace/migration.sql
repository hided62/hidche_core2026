DO $$
BEGIN
    CREATE TYPE "AdminAuditOutcome" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "app_user"
    ADD COLUMN IF NOT EXISTS "kakao_grace_until" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "admin_audit_event" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "correlation_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "actor_username" TEXT NOT NULL,
    "credential_kind" TEXT NOT NULL DEFAULT 'SESSION',
    "capability" TEXT,
    "scope" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "profile_name" TEXT,
    "reason" TEXT,
    "outcome" "AdminAuditOutcome" NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_audit_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "admin_audit_event_correlation_id_created_at_idx"
    ON "admin_audit_event"("correlation_id", "created_at");
CREATE INDEX IF NOT EXISTS "admin_audit_event_actor_user_id_created_at_idx"
    ON "admin_audit_event"("actor_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "admin_audit_event_target_type_target_id_created_at_idx"
    ON "admin_audit_event"("target_type", "target_id", "created_at");
CREATE INDEX IF NOT EXISTS "admin_audit_event_profile_name_created_at_idx"
    ON "admin_audit_event"("profile_name", "created_at");
CREATE INDEX IF NOT EXISTS "admin_audit_event_action_created_at_idx"
    ON "admin_audit_event"("action", "created_at");

COMMENT ON TABLE "admin_audit_event" IS
    'Append-only administrator action ledger. Application code must never update or delete rows.';

CREATE OR REPLACE FUNCTION reject_admin_audit_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'admin_audit_event is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "admin_audit_event_append_only" ON "admin_audit_event";
CREATE TRIGGER "admin_audit_event_append_only"
    BEFORE UPDATE OR DELETE ON "admin_audit_event"
    FOR EACH ROW EXECUTE FUNCTION reject_admin_audit_event_mutation();
