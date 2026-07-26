ALTER TABLE "app_user"
    ADD COLUMN "terms_accepted_at" TIMESTAMP(3),
    ADD COLUMN "privacy_accepted_at" TIMESTAMP(3),
    ADD COLUMN "kakao_verified_at" TIMESTAMP(3),
    ADD COLUMN "kakao_grace_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "app_user"
SET "kakao_verified_at" = COALESCE("updated_at", "created_at")
WHERE "oauth_type" = 'KAKAO'
  AND "kakao_verified_at" IS NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "app_user"
        GROUP BY "display_name"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Cannot enforce unique app_user.display_name: resolve duplicate display names before applying this migration.';
    END IF;
END
$$;

CREATE UNIQUE INDEX "app_user_display_name_key" ON "app_user"("display_name");
