CREATE TABLE "rank_data" (
    "id" SERIAL PRIMARY KEY,
    "nation_id" INTEGER NOT NULL DEFAULT 0,
    "general_id" INTEGER NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX "rank_data_by_general" ON "rank_data"("general_id", "type");
CREATE INDEX "rank_data_by_type" ON "rank_data"("type", "value");
CREATE INDEX "rank_data_by_nation" ON "rank_data"("nation_id", "type", "value");

CREATE TABLE "hall" (
    "id" SERIAL PRIMARY KEY,
    "server_id" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "scenario" INTEGER NOT NULL,
    "general_no" INTEGER NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "owner" TEXT,
    "aux" JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX "hall_server_general" ON "hall"("server_id", "type", "general_no");
CREATE UNIQUE INDEX "hall_owner" ON "hall"("owner", "server_id", "type");
CREATE INDEX "hall_server_show" ON "hall"("server_id", "type", "value");
CREATE INDEX "hall_scenario" ON "hall"("season", "scenario", "type", "value");

CREATE TABLE "ng_games" (
    "id" SERIAL PRIMARY KEY,
    "server_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "winner_nation" INTEGER,
    "map" TEXT,
    "season" INTEGER NOT NULL,
    "scenario" INTEGER NOT NULL,
    "scenario_name" TEXT NOT NULL,
    "env" JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX "ng_games_server_id" ON "ng_games"("server_id");
CREATE INDEX "ng_games_date" ON "ng_games"("date");
