-- Replace the former umbrella profile role with the explicit capabilities that
-- preserve its effective operation scope. New grants use only these individual
-- roles, and the update is idempotent because the legacy role is removed.
UPDATE "app_user" AS "user_row"
SET "roles" = (
    SELECT COALESCE(
        jsonb_agg(to_jsonb("expanded"."role") ORDER BY "expanded"."role"),
        '[]'::jsonb
    )
    FROM (
        SELECT DISTINCT "replacement"."role"
        FROM jsonb_array_elements_text("user_row"."roles") AS "source"("role")
        CROSS JOIN LATERAL unnest(
            CASE
                WHEN "source"."role" = 'admin.profiles.manage'
                    OR "source"."role" LIKE 'admin.profiles.manage:%'
                THEN ARRAY[
                    'admin.profiles.runtime' || substring(
                        "source"."role" FROM char_length('admin.profiles.manage') + 1
                    ),
                    'admin.profiles.settings' || substring(
                        "source"."role" FROM char_length('admin.profiles.manage') + 1
                    ),
                    'admin.profiles.deploy' || substring(
                        "source"."role" FROM char_length('admin.profiles.manage') + 1
                    ),
                    'admin.scenarios.reset' || substring(
                        "source"."role" FROM char_length('admin.profiles.manage') + 1
                    ),
                    'admin.reset.schedule' || substring(
                        "source"."role" FROM char_length('admin.profiles.manage') + 1
                    )
                ]
                ELSE ARRAY["source"."role"]
            END
        ) AS "replacement"("role")
    ) AS "expanded"
)
WHERE jsonb_typeof("user_row"."roles") = 'array'
  AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text("user_row"."roles") AS "existing"("role")
      WHERE "existing"."role" = 'admin.profiles.manage'
         OR "existing"."role" LIKE 'admin.profiles.manage:%'
  );
