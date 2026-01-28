CREATE TYPE "diplomacy_letter_state" AS ENUM ('PROPOSED', 'ACTIVATED', 'CANCELLED', 'REPLACED');

CREATE TABLE "diplomacy_letter" (
    "id" SERIAL PRIMARY KEY,
    "src_nation_id" INTEGER NOT NULL,
    "dest_nation_id" INTEGER NOT NULL,
    "prev_id" INTEGER,
    "state" "diplomacy_letter_state" NOT NULL DEFAULT 'PROPOSED',
    "text_brief" TEXT NOT NULL,
    "text_detail" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "src_signer" INTEGER NOT NULL,
    "dest_signer" INTEGER,
    "aux" JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX "diplomacy_letter_src_dest_idx" ON "diplomacy_letter"("src_nation_id", "dest_nation_id");
CREATE INDEX "diplomacy_letter_dest_src_idx" ON "diplomacy_letter"("dest_nation_id", "src_nation_id");
CREATE INDEX "diplomacy_letter_state_date_idx" ON "diplomacy_letter"("state", "date");