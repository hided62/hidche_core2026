ALTER TABLE "app_user"
    ADD COLUMN "kakao_talk_verified_until" TIMESTAMP(3);

UPDATE "app_user"
SET "kakao_talk_verified_until" = NULLIF("legacy_data" ->> 'tokenValidUntil', '')::TIMESTAMP(3)
WHERE "oauth_type" = 'KAKAO'
  AND "legacy_data" ->> 'tokenValidUntil' ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$';
