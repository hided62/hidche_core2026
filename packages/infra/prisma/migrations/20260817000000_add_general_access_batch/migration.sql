CREATE TABLE "general_access_batch" (
    "id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "general_access_batch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "general_access_batch_created_at_idx"
    ON "general_access_batch"("created_at");
