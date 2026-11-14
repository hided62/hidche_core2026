-- High churn queues/upserts and append-only logs need lifetime IDs, independent
-- of live row count. Keep logical keys, values and sequence positions intact.
BEGIN;
ALTER TABLE "general_turn" ALTER COLUMN "id" TYPE BIGINT;
ALTER SEQUENCE "general_turn_id_seq" AS BIGINT NO MAXVALUE NO CYCLE;
ALTER TABLE "nation_turn" ALTER COLUMN "id" TYPE BIGINT;
ALTER SEQUENCE "nation_turn_id_seq" AS BIGINT NO MAXVALUE NO CYCLE;
ALTER TABLE "general_access_log" ALTER COLUMN "id" TYPE BIGINT;
ALTER SEQUENCE "general_access_log_id_seq" AS BIGINT NO MAXVALUE NO CYCLE;
ALTER TABLE "diplomacy" ALTER COLUMN "id" TYPE BIGINT;
ALTER SEQUENCE "diplomacy_id_seq" AS BIGINT NO MAXVALUE NO CYCLE;
ALTER TABLE "inheritance_point" ALTER COLUMN "id" TYPE BIGINT;
ALTER SEQUENCE "inheritance_point_id_seq" AS BIGINT NO MAXVALUE NO CYCLE;
ALTER TABLE "log_entry" ALTER COLUMN "id" TYPE BIGINT;
ALTER SEQUENCE "log_entry_id_seq" AS BIGINT NO MAXVALUE NO CYCLE;
ALTER TABLE "error_log" ALTER COLUMN "id" TYPE BIGINT;
ALTER SEQUENCE "error_log_id_seq" AS BIGINT NO MAXVALUE NO CYCLE;
ALTER TABLE "inheritance_log" ALTER COLUMN "id" TYPE BIGINT;
ALTER SEQUENCE "inheritance_log_id_seq" AS BIGINT NO MAXVALUE NO CYCLE;
ALTER TABLE "traffic_period" ALTER COLUMN "id" TYPE BIGINT;
ALTER SEQUENCE "traffic_period_id_seq" AS BIGINT NO MAXVALUE NO CYCLE;
ALTER TABLE "traffic_period_general" ALTER COLUMN "period_id" TYPE BIGINT;
COMMIT;
