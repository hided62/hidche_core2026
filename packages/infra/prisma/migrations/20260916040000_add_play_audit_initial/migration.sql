ALTER TABLE "play_audit_month" DROP CONSTRAINT "play_audit_month_kind_check";
ALTER TABLE "play_audit_month" ADD CONSTRAINT "play_audit_month_kind_check"
    CHECK ("kind" IN ('MONTH_END', 'FINAL', 'INITIAL'));
CREATE UNIQUE INDEX "play_audit_month_initial_server_key" ON "play_audit_month" ("server_id")
    WHERE "kind" = 'INITIAL';
