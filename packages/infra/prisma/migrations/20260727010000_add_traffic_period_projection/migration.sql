CREATE TABLE "traffic_period" (
    "id" SERIAL PRIMARY KEY,
    "world_state_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "last_refresh" TIMESTAMP(3) NOT NULL,
    "refresh" INTEGER NOT NULL DEFAULT 0,
    "online" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "traffic_period_world_state_id_fkey"
        FOREIGN KEY ("world_state_id") REFERENCES "world_state"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "traffic_period_month_check" CHECK ("month" BETWEEN 1 AND 12),
    CONSTRAINT "traffic_period_refresh_check" CHECK ("refresh" >= 0),
    CONSTRAINT "traffic_period_online_check" CHECK ("online" >= 0)
);

CREATE UNIQUE INDEX "traffic_period_world_state_year_month_key"
    ON "traffic_period"("world_state_id", "year", "month");
CREATE INDEX "traffic_period_world_state_started_at_idx"
    ON "traffic_period"("world_state_id", "started_at");

CREATE TABLE "traffic_period_general" (
    "period_id" INTEGER NOT NULL,
    "general_id" INTEGER NOT NULL,
    "user_id" TEXT,
    "refresh" INTEGER NOT NULL DEFAULT 0,
    "last_refresh" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "traffic_period_general_pkey" PRIMARY KEY ("period_id", "general_id"),
    CONSTRAINT "traffic_period_general_period_id_fkey"
        FOREIGN KEY ("period_id") REFERENCES "traffic_period"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "traffic_period_general_refresh_check" CHECK ("refresh" >= 0)
);

CREATE INDEX "traffic_period_general_period_refresh_general_idx"
    ON "traffic_period_general"("period_id", "refresh", "general_id");

-- Preserve legacy completed-period snapshots. Invalid or missing legacy dates use
-- the world row timestamp so one malformed JSON item cannot block deployment.
WITH legacy_rows AS (
    SELECT
        world."id" AS "world_state_id",
        item,
        ordinality
    FROM "world_state" AS world
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE
            WHEN jsonb_typeof(world."meta"->'recentTraffic') = 'array'
                THEN world."meta"->'recentTraffic'
            ELSE '[]'::jsonb
        END
    ) WITH ORDINALITY AS legacy(item, ordinality)
),
normalized AS (
    SELECT
        legacy_rows."world_state_id",
        CASE
            WHEN pg_input_is_valid(legacy_rows.item->>'year', 'integer')
                THEN (legacy_rows.item->>'year')::INTEGER
            ELSE NULL
        END AS "year",
        CASE
            WHEN pg_input_is_valid(legacy_rows.item->>'month', 'integer')
                THEN (legacy_rows.item->>'month')::INTEGER
            ELSE NULL
        END AS "month",
        CASE
            WHEN pg_input_is_valid(legacy_rows.item->>'refresh', 'integer')
                THEN (legacy_rows.item->>'refresh')::INTEGER
            ELSE 0
        END AS "refresh",
        CASE
            WHEN pg_input_is_valid(legacy_rows.item->>'online', 'integer')
                THEN (legacy_rows.item->>'online')::INTEGER
            ELSE 0
        END AS "online",
        CASE
            WHEN pg_input_is_valid(
                legacy_rows.item->>'date',
                'timestamp without time zone'
            )
                THEN (legacy_rows.item->>'date')::TIMESTAMP
            ELSE world."updated_at"
        END AS "observed_at",
        legacy_rows.ordinality
    FROM legacy_rows
    JOIN "world_state" AS world ON world."id" = legacy_rows."world_state_id"
)
INSERT INTO "traffic_period" (
    "world_state_id",
    "year",
    "month",
    "started_at",
    "last_refresh",
    "refresh",
    "online"
)
SELECT DISTINCT ON ("world_state_id", "year", "month")
    "world_state_id",
    "year",
    "month",
    "observed_at",
    "observed_at",
    "refresh",
    "online"
FROM normalized
WHERE "year" IS NOT NULL
  AND "month" BETWEEN 1 AND 12
ORDER BY "world_state_id", "year", "month", ordinality DESC
ON CONFLICT ("world_state_id", "year", "month") DO NOTHING;
