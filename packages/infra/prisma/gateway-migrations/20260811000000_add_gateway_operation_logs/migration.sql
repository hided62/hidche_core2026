CREATE TABLE "gateway_operation_log" (
    "id" BIGSERIAL NOT NULL,
    "operation_id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gateway_operation_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gateway_operation_log_operation_id_id_idx"
ON "gateway_operation_log"("operation_id", "id");

ALTER TABLE "gateway_operation_log"
ADD CONSTRAINT "gateway_operation_log_operation_id_fkey"
FOREIGN KEY ("operation_id") REFERENCES "gateway_operation"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
