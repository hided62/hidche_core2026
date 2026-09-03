-- InvaderEnding is the terminal gameplay boundary. Older rows can have
-- isUnited=3 while the logical game clock remains RUNNING because the handler
-- historically removed its event without completing the clock.
--
-- Deployment runs game-schema migrations while the profile runtime is stopped,
-- so this backfill installs the missing terminal state without racing a daemon.
-- Any unchosen raise-invader alternatives are no longer actionable after the
-- world leaves the unification-wait state; close their GAME_TIME action state at
-- the terminal authoritative tick while preserving the WALL_TIME envelopes.
BEGIN;

UPDATE "world_state"
SET "clock_phase" = 'COMPLETED'
WHERE "clock_phase" IN ('RUNNING', 'MANUAL')
  AND GREATEST(
      CASE WHEN "meta"->>'isUnited' ~ '^[0-9]+$' THEN ("meta"->>'isUnited')::integer ELSE 0 END,
      CASE WHEN "meta"->>'isunited' ~ '^[0-9]+$' THEN ("meta"->>'isunited')::integer ELSE 0 END
  ) >= 3;

UPDATE "message_action" AS action
SET "status" = 'RESOLVED',
    "resolved_game_tick" = GREATEST(action."created_game_tick", world."clock_tick"),
    "updated_at_wall" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM "world_state" AS world
WHERE action."action_type" = 'raiseInvader'
  AND action."status" = 'PENDING'
  AND world."clock_tick" IS NOT NULL
  AND GREATEST(
      CASE WHEN world."meta"->>'isUnited' ~ '^[0-9]+$' THEN (world."meta"->>'isUnited')::integer ELSE 0 END,
      CASE WHEN world."meta"->>'isunited' ~ '^[0-9]+$' THEN (world."meta"->>'isunited')::integer ELSE 0 END
  ) <> 2;

COMMIT;
