ALTER TABLE world_state
    ADD COLUMN clock_base_time TIMESTAMP(3),
    ADD COLUMN clock_tick BIGINT,
    ADD COLUMN clock_mode TEXT NOT NULL DEFAULT 'realtime',
    ADD COLUMN clock_wall_anchor TIMESTAMP(3),
    ADD COLUMN last_turn_tick BIGINT;

UPDATE world_state
SET clock_base_time = COALESCE(NULLIF(meta->>'lastTurnTime', '')::timestamp, updated_at),
    clock_wall_anchor = CURRENT_TIMESTAMP,
    clock_tick = ROUND(
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(NULLIF(meta->>'lastTurnTime', '')::timestamp, updated_at)))
        * (36000000::numeric / tick_seconds)
    )::bigint,
    last_turn_tick = 0;

ALTER TABLE general
    ADD COLUMN turn_tick BIGINT,
    ADD COLUMN recent_war_tick BIGINT;

UPDATE general
SET turn_tick = ROUND(
        EXTRACT(EPOCH FROM (general.turn_time - world_state.clock_base_time))
        * (36000000::numeric / world_state.tick_seconds)
    )::bigint,
    recent_war_tick = CASE WHEN general.recent_war_time IS NULL THEN NULL ELSE ROUND(
        EXTRACT(EPOCH FROM (general.recent_war_time - world_state.clock_base_time))
        * (36000000::numeric / world_state.tick_seconds)
    )::bigint END
FROM world_state;

ALTER TABLE select_pool ADD COLUMN reserved_until_tick BIGINT;
ALTER TABLE select_npc_token ADD COLUMN valid_until_tick BIGINT, ADD COLUMN pick_more_from_tick BIGINT;
ALTER TABLE message ADD COLUMN time_tick BIGINT, ADD COLUMN valid_until_tick BIGINT;
ALTER TABLE auction ADD COLUMN open_tick BIGINT, ADD COLUMN close_tick BIGINT;
ALTER TABLE vote_poll ADD COLUMN start_tick BIGINT, ADD COLUMN end_tick BIGINT;

UPDATE select_pool SET reserved_until_tick = CASE WHEN reserved_until IS NULL THEN NULL ELSE ROUND(EXTRACT(EPOCH FROM (reserved_until - world_state.clock_base_time)) * (36000000::numeric / world_state.tick_seconds))::bigint END FROM world_state;
UPDATE select_npc_token SET valid_until_tick = ROUND(EXTRACT(EPOCH FROM (valid_until - world_state.clock_base_time)) * (36000000::numeric / world_state.tick_seconds))::bigint, pick_more_from_tick = ROUND(EXTRACT(EPOCH FROM (pick_more_from - world_state.clock_base_time)) * (36000000::numeric / world_state.tick_seconds))::bigint FROM world_state;
UPDATE message
SET time_tick = ROUND(
        EXTRACT(EPOCH FROM (time - world_state.clock_base_time))
        * (36000000::numeric / world_state.tick_seconds)
    )::bigint,
    valid_until_tick = CASE
        -- Legacy permanent messages use the year-9999 sentinel. Keep their
        -- DateTime fallback instead of persisting a tick JavaScript cannot
        -- represent safely.
        WHEN valid_until >= TIMESTAMP '9999-01-01 00:00:00' THEN NULL
        ELSE ROUND(
            EXTRACT(EPOCH FROM (valid_until - world_state.clock_base_time))
            * (36000000::numeric / world_state.tick_seconds)
        )::bigint
    END
FROM world_state;
UPDATE auction SET open_tick = ROUND(EXTRACT(EPOCH FROM (created_at - world_state.clock_base_time)) * (36000000::numeric / world_state.tick_seconds))::bigint, close_tick = ROUND(EXTRACT(EPOCH FROM (close_at - world_state.clock_base_time)) * (36000000::numeric / world_state.tick_seconds))::bigint FROM world_state;
UPDATE vote_poll SET start_tick = ROUND(EXTRACT(EPOCH FROM (start_at - world_state.clock_base_time)) * (36000000::numeric / world_state.tick_seconds))::bigint, end_tick = CASE WHEN end_at IS NULL THEN NULL ELSE ROUND(EXTRACT(EPOCH FROM (end_at - world_state.clock_base_time)) * (36000000::numeric / world_state.tick_seconds))::bigint END FROM world_state;

CREATE INDEX general_turn_tick_id_idx ON general(turn_tick, id);
CREATE INDEX auction_status_close_tick_idx ON auction(status, close_tick);
