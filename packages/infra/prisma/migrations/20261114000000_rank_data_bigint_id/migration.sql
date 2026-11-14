-- Keep all existing row IDs and the current sequence position, including an
-- exhausted int4 sequence. Widen both ends; changing the sequence alone leaves
-- INSERTs failing with integer overflow. Never rewind or cycle production IDs.
BEGIN;
ALTER TABLE "rank_data" ALTER COLUMN "id" TYPE BIGINT;
ALTER SEQUENCE "rank_data_id_seq" AS BIGINT NO MAXVALUE NO CYCLE;
COMMIT;
