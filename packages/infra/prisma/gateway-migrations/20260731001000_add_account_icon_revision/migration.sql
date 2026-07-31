BEGIN;

ALTER TABLE "app_user"
    ADD COLUMN "icon_revision" TIMESTAMP(3),
    ADD COLUMN "profile_icon_reset_at" TIMESTAMP(3);

-- Before this migration the administrator reset marker lived in the sanctions
-- JSON. Refuse malformed non-string data instead of silently losing a reset;
-- PostgreSQL's cast below likewise makes an invalid datetime fail the deploy.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "app_user"
        WHERE "sanctions" ? 'profileIconResetAt'
          AND (
              jsonb_typeof("sanctions" -> 'profileIconResetAt') IS DISTINCT FROM 'string'
              OR NOT ("sanctions" ->> 'profileIconResetAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
          )
    ) THEN
        RAISE EXCEPTION 'app_user.sanctions.profileIconResetAt must be an ISO datetime string';
    END IF;
END
$$;

UPDATE "app_user"
SET "profile_icon_reset_at" =
    (("sanctions" ->> 'profileIconResetAt')::TIMESTAMPTZ AT TIME ZONE 'UTC')
WHERE "sanctions" ? 'profileIconResetAt';

UPDATE "app_user"
SET "icon_revision" = GREATEST(
        "created_at",
        COALESCE("icon_updated_at", "created_at"),
        COALESCE("profile_icon_reset_at", "created_at")
    );

UPDATE "app_user"
SET "sanctions" = "sanctions" - 'profileIconResetAt'
WHERE "sanctions" ? 'profileIconResetAt';

COMMIT;
