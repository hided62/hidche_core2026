CREATE TABLE "select_pool" (
    "id" SERIAL PRIMARY KEY,
    "unique_name" VARCHAR(20) NOT NULL,
    "owner_user_id" TEXT,
    "general_id" INTEGER,
    "reserved_until" TIMESTAMP(3),
    "info" JSONB NOT NULL
);

CREATE UNIQUE INDEX "select_pool_unique_name_key"
    ON "select_pool"("unique_name");
CREATE UNIQUE INDEX "select_pool_general_id_key"
    ON "select_pool"("general_id");
CREATE INDEX "select_pool_owner_user_id_idx"
    ON "select_pool"("owner_user_id");
CREATE INDEX "select_pool_reserved_until_general_id_idx"
    ON "select_pool"("reserved_until", "general_id");
