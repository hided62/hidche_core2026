-- Keep profile_name stable because it is referenced by operations, runtime
-- actions, permission scopes, process names, Redis namespaces, and routes.
-- instance_key identifies the immutable slot while current_scenario records the
-- mutable game selection. The legacy scenario column remains during the
-- expansion phase so the previous Gateway release can still be restored.
ALTER TABLE "gateway_profile"
ADD COLUMN "instance_key" TEXT,
ADD COLUMN "current_scenario" TEXT;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "gateway_profile"
        WHERE left("profile_name", length("profile") + 1) <> "profile" || ':'
    ) THEN
        RAISE EXCEPTION 'gateway_profile.profile_name must start with profile followed by a colon';
    END IF;
END
$$;

UPDATE "gateway_profile"
SET
    "instance_key" = substring("profile_name" FROM length("profile") + 2),
    "current_scenario" = NULLIF("scenario", 'default');

ALTER TABLE "gateway_profile"
ALTER COLUMN "instance_key" SET NOT NULL;

-- Older combined-schema installs created this uniqueness rule as a table
-- constraint, while the standalone Gateway baseline created a unique index.
-- Dropping the constraint first also removes its backing index; the second
-- statement handles the standalone-index shape and is then a no-op otherwise.
ALTER TABLE "gateway_profile"
DROP CONSTRAINT IF EXISTS "gateway_profile_profile_scenario_key";

DROP INDEX IF EXISTS "gateway_profile_profile_scenario_key";

ALTER TABLE "gateway_profile"
ADD CONSTRAINT "gateway_profile_profile_instance_key_key" UNIQUE ("profile", "instance_key"),
ADD CONSTRAINT "gateway_profile_identity_check"
CHECK (
    length("instance_key") > 0
    AND "profile_name" = "profile" || ':' || "instance_key"
);

CREATE FUNCTION "sync_gateway_profile_scenario_compat"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."instance_key" IS NULL THEN
        IF left(NEW."profile_name", length(NEW."profile") + 1) <> NEW."profile" || ':' THEN
            RAISE EXCEPTION 'gateway_profile.profile_name must start with profile followed by a colon';
        END IF;
        NEW."instance_key" := substring(NEW."profile_name" FROM length(NEW."profile") + 2);
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW."current_scenario" IS NULL THEN
            NEW."current_scenario" := NULLIF(NEW."scenario", 'default');
        ELSE
            NEW."scenario" := NEW."current_scenario";
        END IF;
    ELSIF NEW."current_scenario" IS DISTINCT FROM OLD."current_scenario" THEN
        NEW."scenario" := COALESCE(NEW."current_scenario", 'default');
    ELSIF NEW."scenario" IS DISTINCT FROM OLD."scenario" THEN
        NEW."current_scenario" := NULLIF(NEW."scenario", 'default');
    END IF;

    RETURN NEW;
END
$$;

CREATE TRIGGER "gateway_profile_scenario_compat"
BEFORE INSERT OR UPDATE ON "gateway_profile"
FOR EACH ROW
EXECUTE FUNCTION "sync_gateway_profile_scenario_compat"();
