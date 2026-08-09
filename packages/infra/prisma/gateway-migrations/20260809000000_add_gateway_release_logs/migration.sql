CREATE TABLE "gateway_release_log" (
    "id" BIGSERIAL NOT NULL,
    "operation_id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gateway_release_log_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "gateway_release_log_operation_id_fkey"
        FOREIGN KEY ("operation_id") REFERENCES "gateway_release_operation"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "gateway_release_log_operation_id_id_idx"
    ON "gateway_release_log" ("operation_id", "id");
