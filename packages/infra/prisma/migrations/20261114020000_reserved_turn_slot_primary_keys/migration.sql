-- Queue position and revision/lease are the domain identity. The unused ID was
-- regenerated on every transactional delete/create, consuming 30/12 numbers.
-- Reuse the existing proven unique indexes; keep every command and timestamp.
BEGIN;
ALTER TABLE "general_turn" DROP CONSTRAINT "general_turn_pkey";
ALTER TABLE "general_turn" ADD CONSTRAINT "general_turn_pkey"
    PRIMARY KEY USING INDEX "general_turn_general_id_turn_idx_key";
ALTER TABLE "general_turn" DROP COLUMN "id";
ALTER TABLE "nation_turn" DROP CONSTRAINT "nation_turn_pkey";
ALTER TABLE "nation_turn" ADD CONSTRAINT "nation_turn_pkey"
    PRIMARY KEY USING INDEX "nation_turn_nation_id_officer_level_turn_idx_key";
ALTER TABLE "nation_turn" DROP COLUMN "id";
COMMIT;
