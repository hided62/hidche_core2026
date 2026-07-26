-- The Prisma model and auction runtime persist bid metadata, but the original
-- auction migration predates that field. Existing db-push installations may
-- already have it, so keep this reconciliation migration idempotent.
ALTER TABLE "auction_bid"
    ADD COLUMN IF NOT EXISTS "meta" JSONB NOT NULL DEFAULT '{}'::jsonb;
