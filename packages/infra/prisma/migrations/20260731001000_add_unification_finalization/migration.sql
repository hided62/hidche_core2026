ALTER TABLE "ng_old_nations"
ALTER COLUMN "server_id" TYPE TEXT;

ALTER TABLE "ng_old_generals"
ALTER COLUMN "server_id" TYPE TEXT;

ALTER TABLE "emperior"
ALTER COLUMN "server_id" TYPE TEXT;

CREATE TABLE "unification_finalization" (
    "generation_key" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "profile_name" TEXT NOT NULL,
    "winner_nation" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unification_finalization_pkey" PRIMARY KEY ("generation_key")
);

CREATE UNIQUE INDEX "unification_finalization_server_id_key"
ON "unification_finalization" ("server_id");
