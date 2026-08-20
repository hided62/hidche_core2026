-- isunited 2/3에서 Ref 턴 실행은 중단되고, 통일 시 늘린 refreshLimit가 유지된다.
-- 기존 core daemon pass가 기본값으로 되돌린 행만 식별해 100배 값을 복구한다.
UPDATE "world_state"
SET "meta" = jsonb_set(
    "meta",
    '{refreshLimit}',
    to_jsonb((("meta" ->> 'refreshLimit')::integer * 100)),
    true
)
WHERE COALESCE("meta" ->> 'isunited', "meta" ->> 'isUnited', '0') ~ '^[0-9]+$'
  AND COALESCE("meta" ->> 'isunited', "meta" ->> 'isUnited', '0')::integer >= 2
  AND COALESCE("meta" ->> 'refreshLimit', '') ~ '^[0-9]+$'
  AND ("meta" ->> 'refreshLimit')::integer =
      ROUND(POWER("tick_seconds"::numeric / 60, 0.6) * 3)::integer * 10;
