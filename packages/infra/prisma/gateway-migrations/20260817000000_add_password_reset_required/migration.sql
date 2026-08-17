ALTER TABLE "app_user"
    ADD COLUMN "password_reset_required" BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE "app_user"
SET "password_reset_required" = TRUE
WHERE "password_hash" ~ '^[[:xdigit:]]{128}$';
