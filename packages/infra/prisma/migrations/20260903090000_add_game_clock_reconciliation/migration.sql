ALTER TABLE world_state
    ADD COLUMN clock_phase TEXT NOT NULL DEFAULT 'RUNNING',
    ADD COLUMN clock_revision BIGINT NOT NULL DEFAULT 1,
    ADD COLUMN deadline_generation BIGINT NOT NULL DEFAULT 1;

UPDATE world_state
SET clock_phase = CASE
        WHEN clock_mode = 'manual' THEN 'MANUAL'
        WHEN clock_wall_anchor IS NOT NULL AND clock_wall_anchor > CURRENT_TIMESTAMP THEN 'PREOPEN'
        ELSE 'RUNNING'
    END;

ALTER TABLE input_event
    ADD COLUMN accepted_game_tick BIGINT,
    ADD COLUMN accepted_clock_revision BIGINT;

CREATE TABLE clock_suspension (
    id VARCHAR(64) PRIMARY KEY,
    world_state_id INTEGER NOT NULL REFERENCES world_state(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    policy TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'SUSPENDED',
    source_revision BIGINT NOT NULL,
    target_revision BIGINT NOT NULL,
    cut_tick BIGINT NOT NULL,
    cut_wall_at TIMESTAMP(3) NOT NULL,
    resume_wall_at TIMESTAMP(3),
    rate_ticks_per_second INTEGER NOT NULL,
    catch_up_ticks BIGINT NOT NULL DEFAULT 0,
    gap_ticks BIGINT,
    shift_ticks BIGINT,
    aligned_tick BIGINT,
    participant_checksum_before VARCHAR(128),
    participant_checksum_after VARCHAR(128),
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    CONSTRAINT clock_suspension_world_revision_key UNIQUE (world_state_id, target_revision),
    CONSTRAINT clock_suspension_revision_step CHECK (target_revision = source_revision + 1),
    CONSTRAINT clock_suspension_nonnegative_catchup CHECK (catch_up_ticks >= 0),
    CONSTRAINT clock_suspension_positive_rate CHECK (rate_ticks_per_second > 0)
);

CREATE INDEX clock_suspension_status_created_at_idx ON clock_suspension(status, created_at);

CREATE TABLE clock_reconciliation_participant (
    suspension_id VARCHAR(64) NOT NULL REFERENCES clock_suspension(id) ON DELETE CASCADE,
    participant_key VARCHAR(96) NOT NULL,
    policy TEXT NOT NULL,
    before_checksum VARCHAR(128) NOT NULL,
    after_checksum VARCHAR(128) NOT NULL,
    affected_count INTEGER NOT NULL DEFAULT 0,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (suspension_id, participant_key),
    CONSTRAINT clock_reconciliation_participant_policy_check CHECK (policy IN ('SHIFT', 'KEEP', 'REBUILD', 'FORBID')),
    CONSTRAINT clock_reconciliation_participant_count_check CHECK (affected_count >= 0)
);

CREATE TABLE clock_projection_outbox (
    id BIGSERIAL PRIMARY KEY,
    world_state_id INTEGER NOT NULL REFERENCES world_state(id) ON DELETE CASCADE,
    suspension_id VARCHAR(64) REFERENCES clock_suspension(id) ON DELETE CASCADE,
    target_revision BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    checksum VARCHAR(128) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    locked_at TIMESTAMP(3),
    locked_by VARCHAR(128),
    applied_at TIMESTAMP(3),
    last_error TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    CONSTRAINT clock_projection_outbox_world_revision_key UNIQUE (world_state_id, target_revision),
    CONSTRAINT clock_projection_outbox_status_check CHECK (status IN ('PENDING', 'APPLYING', 'APPLIED', 'FAILED')),
    CONSTRAINT clock_projection_outbox_attempts_check CHECK (attempts >= 0)
);

CREATE INDEX clock_projection_outbox_status_available_at_id_idx
    ON clock_projection_outbox(status, available_at, id);
