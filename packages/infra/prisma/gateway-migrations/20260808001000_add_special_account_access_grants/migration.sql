DO $$
BEGIN
    CREATE TYPE "SpecialAccountAccessKind" AS ENUM ('TESTER', 'RECOVERY', 'OTHER');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "special_account_access_grant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "kind" "SpecialAccountAccessKind" NOT NULL,
    "profiles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "allows_general_creation" BOOLEAN NOT NULL DEFAULT TRUE,
    "expires_at" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "granted_by_user_id" TEXT NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" TEXT,
    "revoked_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "special_account_access_grant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "special_account_access_grant_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "special_account_access_grant_user_id_revoked_at_expires_at_idx"
    ON "special_account_access_grant"("user_id", "revoked_at", "expires_at");
CREATE INDEX IF NOT EXISTS "special_account_access_grant_kind_created_at_idx"
    ON "special_account_access_grant"("kind", "created_at");

COMMENT ON TABLE "special_account_access_grant" IS
    'Explicit audited exception allowing selected local accounts to enter game profiles without Kakao verification.';
