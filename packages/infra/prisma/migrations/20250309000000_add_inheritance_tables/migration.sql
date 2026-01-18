CREATE TABLE "inheritance_point" (
    "id" SERIAL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "aux" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "inheritance_point_user_id_key" ON "inheritance_point"("user_id", "key");
CREATE INDEX "inheritance_point_user_id_idx" ON "inheritance_point"("user_id");

CREATE TABLE "inheritance_log" (
    "id" SERIAL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "inheritance_log_user_id_idx" ON "inheritance_log"("user_id", "id");

CREATE TABLE "inheritance_result" (
    "id" SERIAL PRIMARY KEY,
    "server_id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "general_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "inheritance_result_server_owner_idx" ON "inheritance_result"("server_id", "owner");

CREATE TABLE "inheritance_user_state" (
    "user_id" TEXT PRIMARY KEY,
    "meta" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
