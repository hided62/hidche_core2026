CREATE TABLE "web_push_outbox" (
    "id" BIGSERIAL NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "user_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "year" INTEGER,
    "month" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "lock_owner" TEXT,
    "delivered_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "web_push_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "web_push_outbox_event_id_key" ON "web_push_outbox"("event_id");
CREATE INDEX "web_push_outbox_delivered_at_available_at_id_idx"
    ON "web_push_outbox"("delivered_at", "available_at", "id");
