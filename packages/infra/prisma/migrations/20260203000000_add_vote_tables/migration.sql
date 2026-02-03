CREATE TABLE "vote_poll" (
    "id" SERIAL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "options" JSONB NOT NULL,
    "multiple_options" INTEGER NOT NULL DEFAULT 1,
    "reveal_mode" TEXT NOT NULL,
    "opener_general_id" INTEGER NOT NULL,
    "opener_name" TEXT NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_at" TIMESTAMP(3) NULL,
    "closed_at" TIMESTAMP(3) NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "vote" (
    "id" SERIAL PRIMARY KEY,
    "vote_id" INTEGER NOT NULL REFERENCES "vote_poll"("id") ON DELETE CASCADE,
    "general_id" INTEGER NOT NULL,
    "nation_id" INTEGER NOT NULL,
    "selection" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "vote_vote_general_uidx" ON "vote"("vote_id", "general_id");
CREATE INDEX "vote_vote_idx" ON "vote"("vote_id");

CREATE TABLE "vote_comment" (
    "id" SERIAL PRIMARY KEY,
    "vote_id" INTEGER NOT NULL REFERENCES "vote_poll"("id") ON DELETE CASCADE,
    "general_id" INTEGER NOT NULL,
    "nation_id" INTEGER NOT NULL,
    "general_name" TEXT NOT NULL,
    "nation_name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "vote_comment_vote_created_idx" ON "vote_comment"("vote_id", "created_at");
