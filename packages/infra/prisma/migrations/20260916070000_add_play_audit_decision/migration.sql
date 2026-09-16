CREATE TABLE "play_audit_decision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "server_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "phase" TEXT NOT NULL CHECK ("phase" IN ('general', 'nation')),
    "general_id" INTEGER NOT NULL,
    "nation_id" INTEGER NOT NULL,
    "city_id" INTEGER NOT NULL,
    "npc_state" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL CHECK ("month" BETWEEN 1 AND 12),
    "tick" BIGINT NOT NULL CHECK ("tick" >= 0),
    "step_count" INTEGER NOT NULL CHECK ("step_count" > 0),
    "summary" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "play_audit_decision_execution_id_phase_key" ON "play_audit_decision"("execution_id", "phase");
CREATE INDEX "play_audit_decision_server_id_general_id_tick_id_idx" ON "play_audit_decision"("server_id", "general_id", "tick", "id");
CREATE INDEX "play_audit_decision_server_id_nation_id_tick_id_idx" ON "play_audit_decision"("server_id", "nation_id", "tick", "id");
CREATE TABLE "play_audit_decision_chunk" (
    "decision_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL CHECK ("ordinal" >= 0),
    "steps" JSONB NOT NULL CHECK (jsonb_typeof("steps") = 'array'),
    PRIMARY KEY ("decision_id", "ordinal"),
    FOREIGN KEY ("decision_id") REFERENCES "play_audit_decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
