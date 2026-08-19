-- Preserve the source policy of the release that produced the active profile build.
-- BRANCH keeps following its remote head; COMMIT remains explicitly pinned.
WITH latest_success AS (
    SELECT DISTINCT ON ("profile_name")
        "profile_name",
        "source_mode",
        "source_ref",
        "resolved_commit_sha"
    FROM "gateway_operation"
    WHERE "status" = 'SUCCEEDED'
      AND (
          "type" = 'DEPLOY'
          OR ("type" = 'RESET' AND "payload" ->> 'requestedSource' IN ('BRANCH', 'COMMIT'))
      )
      AND "source_mode" IS NOT NULL
      AND "source_ref" IS NOT NULL
      AND "resolved_commit_sha" IS NOT NULL
    ORDER BY "profile_name", "completed_at" DESC NULLS LAST, "created_at" DESC
)
UPDATE "gateway_profile" AS profile
SET "meta" = jsonb_set(
    COALESCE(profile."meta", '{}'::jsonb),
    '{releaseSource}',
    jsonb_build_object(
        'mode', latest."source_mode"::text,
        'ref', CASE
            WHEN latest."source_mode" = 'BRANCH' THEN latest."source_ref"
            ELSE latest."resolved_commit_sha"
        END
    ),
    true
)
FROM latest_success AS latest
WHERE profile."profile_name" = latest."profile_name"
  AND profile."build_commit_sha" = latest."resolved_commit_sha"
  AND NOT (COALESCE(profile."meta", '{}'::jsonb) ? 'releaseSource');
