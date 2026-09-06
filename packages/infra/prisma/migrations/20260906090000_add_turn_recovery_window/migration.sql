ALTER TABLE "turn_daemon_lease" ADD COLUMN "clock_ready" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "world_state"
    ADD COLUMN "clock_recovery_start_tick" BIGINT,
    ADD COLUMN "clock_recovery_end_tick" BIGINT,
    ADD COLUMN "clock_recovery_start_wall_at" TIMESTAMP(3),
    ADD CONSTRAINT "world_state_turn_recovery_window_check" CHECK (
        ("clock_recovery_start_tick" IS NULL AND "clock_recovery_end_tick" IS NULL AND "clock_recovery_start_wall_at" IS NULL)
        OR (
            "clock_recovery_start_tick" IS NOT NULL AND "clock_recovery_end_tick" IS NOT NULL AND "clock_recovery_start_wall_at" IS NOT NULL
            AND "clock_recovery_start_tick" BETWEEN -9007199254740991 AND 9007199254740991
            AND "clock_recovery_end_tick" BETWEEN -9007199254740991 AND 9007199254740991
            AND "clock_recovery_start_tick" % 36000000 = 0
            AND "clock_recovery_end_tick" % 36000000 = 0
            AND "clock_recovery_end_tick" - "clock_recovery_start_tick" BETWEEN 72000000 AND 792000000
            AND ("clock_recovery_end_tick" - "clock_recovery_start_tick") % 72000000 = 0
        )
    );
