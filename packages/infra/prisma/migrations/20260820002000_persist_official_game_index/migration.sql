-- Ref stores server_cnt once at reset time because it is rendered on every main-page load.
-- Backfill the active world's equivalent read-model value while excluding cancelled and
-- unfinished history rows from the official sequence.
UPDATE "world_state" AS ws
SET "meta" = jsonb_set(
    COALESCE(ws."meta", '{}'::jsonb),
    '{gameIdx}',
    to_jsonb((
        SELECT COUNT(*)::integer + 1
        FROM "ng_games" AS history
        WHERE history."status" = 'COMPLETED'
          AND (
              ws."meta"->>'serverId' IS NULL
              OR history."server_id" <> ws."meta"->>'serverId'
          )
    )),
    true
);
