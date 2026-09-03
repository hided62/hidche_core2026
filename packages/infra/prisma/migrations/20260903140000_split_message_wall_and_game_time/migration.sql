-- Message envelopes are WALL_TIME. The existing time/valid_until columns are
-- retained as rolling-deploy projections while actionable gameplay state moves
-- to an explicit GAME_TIME record.
ALTER TABLE message
    ADD COLUMN created_at_wall TIMESTAMP(3),
    ADD COLUMN delete_until_wall TIMESTAMP(3),
    ADD COLUMN tombstoned_at_wall TIMESTAMP(3),
    ADD COLUMN occurred_game_tick BIGINT;

-- Historical rows predate a trustworthy wall-occurrence field. `time` is the
-- only available evidence, so preserve it as the best-effort occurrence while
-- ensuring the migration can never reopen an old five-minute delete window.
UPDATE message
SET created_at_wall = time,
    delete_until_wall = LEAST(time + INTERVAL '5 minutes', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    tombstoned_at_wall = CASE
        WHEN lower(COALESCE(message->'option'->>'invalid', 'false')) IN ('true', '1')
            THEN CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
        ELSE NULL
    END,
    occurred_game_tick = time_tick;

ALTER TABLE message
    ALTER COLUMN created_at_wall SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    ALTER COLUMN created_at_wall SET NOT NULL,
    ALTER COLUMN delete_until_wall SET DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '5 minutes'),
    ALTER COLUMN delete_until_wall SET NOT NULL;

CREATE INDEX message_mailbox_type_id_idx ON message(mailbox, type, id);
CREATE INDEX message_delete_until_wall_idx ON message(delete_until_wall);

CREATE TABLE message_action (
    message_id INTEGER PRIMARY KEY REFERENCES message(id) ON DELETE CASCADE,
    action_type VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    created_game_tick BIGINT NOT NULL,
    expires_game_tick BIGINT,
    resolved_game_tick BIGINT,
    clock_revision BIGINT NOT NULL,
    deadline_generation BIGINT NOT NULL,
    created_at_wall TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    updated_at_wall TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    CONSTRAINT message_action_status_check CHECK (status IN ('PENDING', 'RESOLVED', 'CANCELLED')),
    CONSTRAINT message_action_resolution_check CHECK (
        (status = 'PENDING' AND resolved_game_tick IS NULL)
        OR (status <> 'PENDING' AND resolved_game_tick IS NOT NULL)
    )
);

-- Existing actionable payloads used message ticks as their GAME_TIME
-- authority. Backfill once; after this migration message_action is authoritative
-- and NULL never changes the clock domain of the rule.
INSERT INTO message_action (
    message_id,
    action_type,
    status,
    created_game_tick,
    expires_game_tick,
    resolved_game_tick,
    clock_revision,
    deadline_generation
)
SELECT
    message.id,
    message.message->'option'->>'action',
    CASE
        WHEN message.time_tick IS NULL
          OR (message.valid_until < TIMESTAMP '9000-01-01' AND message.valid_until_tick IS NULL)
          OR lower(COALESCE(message.message->'option'->>'used', 'false')) IN ('true', '1')
          OR lower(COALESCE(message.message->'option'->>'invalid', 'false')) IN ('true', '1')
          OR message.valid_until <= message.time
        THEN 'RESOLVED'
        ELSE 'PENDING'
    END,
    COALESCE(message.time_tick, 0),
    CASE
        WHEN message.valid_until_tick IS NULL
          OR message.valid_until_tick >= 9007199254740991
        THEN NULL
        ELSE message.valid_until_tick
    END,
    CASE
        WHEN message.time_tick IS NULL
          OR (message.valid_until < TIMESTAMP '9000-01-01' AND message.valid_until_tick IS NULL)
          OR lower(COALESCE(message.message->'option'->>'used', 'false')) IN ('true', '1')
          OR lower(COALESCE(message.message->'option'->>'invalid', 'false')) IN ('true', '1')
          OR message.valid_until <= message.time
        THEN COALESCE(message.valid_until_tick, message.time_tick, 0)
        ELSE NULL
    END,
    COALESCE((SELECT clock_revision FROM world_state ORDER BY id ASC LIMIT 1), 1),
    COALESCE((SELECT deadline_generation FROM world_state ORDER BY id ASC LIMIT 1), 1)
FROM message
WHERE jsonb_typeof(message.message->'option') = 'object'
  AND NULLIF(message.message->'option'->>'action', '') IS NOT NULL;

CREATE INDEX message_action_status_expires_game_tick_idx
    ON message_action(status, expires_game_tick);

-- Inheritance requests are WALL_TIME receipts. Their input_event row remains
-- the durable command/effect state and owns the GAME clock fence coordinate.
CREATE TABLE inheritance_ledger (
    id BIGSERIAL PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    cost DOUBLE PRECISION NOT NULL,
    status TEXT NOT NULL DEFAULT 'APPLIED',
    requested_at_wall TIMESTAMP(3) NOT NULL,
    consumed_at_wall TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    applied_clock_revision BIGINT NOT NULL,
    applied_deadline_generation BIGINT NOT NULL,
    created_at_wall TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    CONSTRAINT inheritance_ledger_status_check CHECK (status IN ('APPLIED')),
    CONSTRAINT inheritance_ledger_cost_check CHECK (cost >= 0)
);

CREATE INDEX inheritance_ledger_user_id_id_idx ON inheritance_ledger(user_id, id);
CREATE INDEX inheritance_ledger_status_id_idx ON inheritance_ledger(status, id);

-- Auction bid receipt and gameplay occurrence are different facts. event_at is
-- retained as the GAME_TIME projection used by existing UI and ordering code.
ALTER TABLE auction_bid
    ADD COLUMN requested_at_wall TIMESTAMP(3),
    ADD COLUMN occurred_game_tick BIGINT;

UPDATE auction_bid AS bid
SET requested_at_wall = bid.created_at,
    occurred_game_tick = ROUND(
        EXTRACT(EPOCH FROM (bid.event_at - world.clock_base_time))
        * (36000000::numeric / world.tick_seconds)
    )::bigint
FROM world_state AS world;

ALTER TABLE auction_bid
    ALTER COLUMN requested_at_wall SET NOT NULL,
    ALTER COLUMN occurred_game_tick SET NOT NULL,
    ALTER COLUMN created_at SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');

CREATE INDEX auction_bid_auction_occurred_game_tick_idx
    ON auction_bid(auction_id, occurred_game_tick);

-- Selection-pool reselection is expressed in turns. Preserve the old DateTime
-- keys only as projections and make one GAME_TIME authority explicit.
UPDATE general AS actor
SET meta = jsonb_set(
    actor.meta,
    '{next_change_tick}',
    to_jsonb(ROUND(
        EXTRACT(EPOCH FROM (
            COALESCE(NULLIF(actor.meta->>'next_change', ''), actor.meta->>'nextChangeAt')::timestamp
            - world.clock_base_time
        )) * (36000000::numeric / world.tick_seconds)
    )::bigint),
    true
)
FROM world_state AS world
WHERE COALESCE(NULLIF(actor.meta->>'next_change', ''), actor.meta->>'nextChangeAt') IS NOT NULL
  AND COALESCE(NULLIF(actor.meta->>'next_change', ''), actor.meta->>'nextChangeAt')
      ~ '^\d{4}-\d{2}-\d{2}T';
