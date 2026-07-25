CREATE TYPE "InputEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "InputEventTarget" AS ENUM ('API', 'ENGINE');

CREATE TABLE "input_event" (
    "sequence" BIGSERIAL NOT NULL,
    "request_id" TEXT NOT NULL,
    "target" "InputEventTarget" NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "actor_user_id" TEXT,
    "status" "InputEventStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_by" TEXT,
    "lease_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "input_event_pkey" PRIMARY KEY ("sequence")
);

CREATE UNIQUE INDEX "input_event_request_id_key" ON "input_event"("request_id");
CREATE INDEX "input_event_target_status_sequence_idx" ON "input_event"("target", "status", "sequence");
