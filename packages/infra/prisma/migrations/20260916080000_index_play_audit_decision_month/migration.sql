CREATE INDEX "play_audit_decision_general_month_idx" ON "play_audit_decision"("server_id", "general_id", "year", "month", "tick", "id");
DROP INDEX "play_audit_decision_server_id_general_id_tick_id_idx";
