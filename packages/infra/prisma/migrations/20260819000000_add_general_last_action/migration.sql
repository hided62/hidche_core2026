ALTER TABLE "general_access_log"
ADD COLUMN "last_action_at" TIMESTAMP(3);

CREATE INDEX "general_access_log_last_action_at_idx"
ON "general_access_log"("last_action_at");
