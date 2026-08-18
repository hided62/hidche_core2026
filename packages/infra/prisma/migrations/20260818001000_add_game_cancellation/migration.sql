CREATE TYPE "GameHistoryStatus" AS ENUM ('OPEN', 'COMPLETED', 'ABANDONED');
CREATE TYPE "GameCancellationHistoryMode" AS ENUM ('RETAIN_ABANDONED', 'DELETE');
CREATE TYPE "GameCancellationGeneralMode" AS ENUM ('RETAIN', 'DELETE');

ALTER TABLE "ng_games"
    ADD COLUMN "status" "GameHistoryStatus" NOT NULL DEFAULT 'OPEN';

UPDATE "ng_games"
SET "status" = 'COMPLETED'
WHERE "winner_nation" IS NOT NULL;

CREATE TABLE "game_inheritance_baseline" (
    "server_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "opening_point" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'OPENING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "game_inheritance_baseline_pkey" PRIMARY KEY ("server_id", "user_id")
);

CREATE INDEX "game_inheritance_baseline_user_id_created_at_idx"
    ON "game_inheritance_baseline"("user_id", "created_at");

CREATE TABLE "game_cancellation" (
    "id" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "original_season" INTEGER NOT NULL,
    "scenario" INTEGER NOT NULL,
    "scenario_name" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3) NOT NULL,
    "cancelled_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "history_mode" "GameCancellationHistoryMode" NOT NULL,
    "general_mode" "GameCancellationGeneralMode" NOT NULL,
    "earned_point_retention_percent" INTEGER NOT NULL,
    "participant_count" INTEGER NOT NULL,
    "preserved_general_count" INTEGER NOT NULL,
    "settlement" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "game_cancellation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "game_cancellation_server_id_key" ON "game_cancellation"("server_id");
CREATE INDEX "game_cancellation_cancelled_at_idx" ON "game_cancellation"("cancelled_at");

ALTER TABLE "game_cancellation"
    ADD CONSTRAINT "game_cancellation_retention_percent_check"
    CHECK ("earned_point_retention_percent" BETWEEN 0 AND 100);
