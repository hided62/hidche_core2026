BEGIN;

-- Core의 한 사용자당 한 장수 invariant를 DB에서도 보장한다. 기존 중복 owner가
-- 있으면 어떤 DDL도 적용하기 전에 owner와 장수 ID를 식별해 실패한다.
DO $$
DECLARE
    duplicate_owners TEXT;
BEGIN
    SELECT string_agg(
        format('%s(count=%s, general_ids=%s)', "user_id", owner_count, general_ids),
        ', '
    )
    INTO duplicate_owners
    FROM (
        SELECT
            "user_id",
            count(*) AS owner_count,
            string_agg("id"::TEXT, ',' ORDER BY "id") AS general_ids
        FROM "general"
        WHERE "user_id" IS NOT NULL
        GROUP BY "user_id"
        HAVING count(*) > 1
        ORDER BY "user_id"
        LIMIT 20
    ) AS duplicate_rows;

    IF duplicate_owners IS NOT NULL THEN
        RAISE EXCEPTION
            'general.user_id duplicate owners must be reviewed before migration: %',
            duplicate_owners;
    END IF;
END
$$;

CREATE TABLE "select_npc_token" (
    "owner_user_id" TEXT NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "pick_more_from" TIMESTAMP(3) NOT NULL,
    "pick_result" JSONB NOT NULL,
    "nonce" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "select_npc_token_pkey" PRIMARY KEY ("owner_user_id")
);

CREATE INDEX "select_npc_token_valid_until_idx" ON "select_npc_token"("valid_until");

CREATE UNIQUE INDEX "general_user_id_key" ON "general"("user_id");

COMMIT;
