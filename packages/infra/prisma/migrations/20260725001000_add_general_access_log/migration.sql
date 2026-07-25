CREATE TABLE "general_access_log" (
    "id" SERIAL PRIMARY KEY,
    "general_id" INTEGER NOT NULL,
    "user_id" TEXT,
    "last_refresh" TIMESTAMP(3),
    "refresh" INTEGER NOT NULL DEFAULT 0,
    "refresh_total" INTEGER NOT NULL DEFAULT 0,
    "refresh_score" INTEGER NOT NULL DEFAULT 0,
    "refresh_score_total" INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX "general_access_log_general_id_key" ON "general_access_log"("general_id");
CREATE INDEX "general_access_log_user_id_idx" ON "general_access_log"("user_id");
