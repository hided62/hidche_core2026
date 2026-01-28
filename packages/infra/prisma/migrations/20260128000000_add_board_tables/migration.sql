CREATE TABLE "board_post" (
    "id" SERIAL PRIMARY KEY,
    "nation_id" INTEGER NOT NULL,
    "is_secret" BOOLEAN NOT NULL DEFAULT FALSE,
    "author_general_id" INTEGER NOT NULL,
    "author_name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content_html" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "board_post_nation_secret_created_idx" ON "board_post"("nation_id", "is_secret", "created_at");

CREATE TABLE "board_comment" (
    "id" SERIAL PRIMARY KEY,
    "post_id" INTEGER NOT NULL REFERENCES "board_post"("id") ON DELETE CASCADE,
    "nation_id" INTEGER NOT NULL,
    "is_secret" BOOLEAN NOT NULL DEFAULT FALSE,
    "author_general_id" INTEGER NOT NULL,
    "author_name" TEXT NOT NULL,
    "content_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "board_comment_post_created_idx" ON "board_comment"("post_id", "created_at");