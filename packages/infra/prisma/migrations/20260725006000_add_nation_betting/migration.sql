CREATE TABLE "nation_betting" (
    "id" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'bettingNation',
    "name" TEXT NOT NULL,
    "finished" BOOLEAN NOT NULL DEFAULT false,
    "select_count" INTEGER NOT NULL,
    "is_exclusive" BOOLEAN,
    "requires_inheritance_point" BOOLEAN NOT NULL DEFAULT true,
    "open_year_month" INTEGER NOT NULL,
    "close_year_month" INTEGER NOT NULL,
    "candidates" JSONB NOT NULL,
    "winner" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nation_betting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "nation_bet" (
    "id" SERIAL NOT NULL,
    "betting_id" INTEGER NOT NULL,
    "general_id" INTEGER NOT NULL,
    "user_id" TEXT,
    "selection" JSONB NOT NULL,
    "selection_key" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nation_bet_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "nation_betting_type_id_idx" ON "nation_betting"("type", "id");
CREATE INDEX "nation_bet_betting_id_idx" ON "nation_bet"("betting_id");
CREATE INDEX "nation_bet_betting_id_user_id_idx" ON "nation_bet"("betting_id", "user_id");
CREATE UNIQUE INDEX "nation_bet_betting_id_user_id_selection_key_key"
    ON "nation_bet"("betting_id", "user_id", "selection_key");

ALTER TABLE "nation_bet"
    ADD CONSTRAINT "nation_bet_betting_id_fkey"
    FOREIGN KEY ("betting_id") REFERENCES "nation_betting"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
