-- Vote mutations use raw SQL to preserve their locked transaction and Ref
-- ordering. Game connections retain the Ref-compatible Seoul session, so make
-- timestamp-omitting insert fallbacks safe for older and future writers.
-- Historical rows are intentionally preserved because
-- Prisma-seeded UTC values and DB-default Seoul values have no durable
-- provenance marker that would allow a safe blanket rewrite.
ALTER TABLE "vote_poll"
    ALTER COLUMN "created_at" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    ALTER COLUMN "updated_at" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');

ALTER TABLE "vote"
    ALTER COLUMN "created_at" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');

ALTER TABLE "vote_comment"
    ALTER COLUMN "created_at" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
