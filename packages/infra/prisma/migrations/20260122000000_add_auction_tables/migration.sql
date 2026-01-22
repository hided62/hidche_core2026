CREATE TYPE "auction_status" AS ENUM ('OPEN', 'FINALIZING', 'FINISHED', 'CANCELED');
CREATE TYPE "auction_type" AS ENUM ('BUY_RICE', 'SELL_RICE', 'UNIQUE_ITEM');

CREATE TABLE "auction" (
    "id" SERIAL PRIMARY KEY,
    "type" "auction_type" NOT NULL,
    "target_code" TEXT,
    "host_general_id" INTEGER NOT NULL,
    "host_name" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "status" "auction_status" NOT NULL DEFAULT 'OPEN',
    "close_at" TIMESTAMP(3) NOT NULL,
    "latest_event_id" TEXT NOT NULL DEFAULT '',
    "latest_event_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizing_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "auction_status_close_at_idx" ON "auction"("status", "close_at");

CREATE TABLE "auction_bid" (
    "id" SERIAL PRIMARY KEY,
    "auction_id" INTEGER NOT NULL REFERENCES "auction"("id") ON DELETE CASCADE,
    "general_id" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "auction_bid_auction_amount_idx" ON "auction_bid"("auction_id", "amount");
CREATE INDEX "auction_bid_auction_event_at_idx" ON "auction_bid"("auction_id", "event_at");
