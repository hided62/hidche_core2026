ALTER TABLE "general_turn_revision"
    ADD COLUMN "lease_owner" TEXT,
    ADD COLUMN "lease_expires_at" TIMESTAMP(3);

ALTER TABLE "nation_turn_revision"
    ADD COLUMN "lease_owner" TEXT,
    ADD COLUMN "lease_expires_at" TIMESTAMP(3);
