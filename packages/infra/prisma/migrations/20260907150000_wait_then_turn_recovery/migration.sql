-- 복구 시작은 중단 당시 월 내부 좌표를 보존하고, 종료만 월 경계에 맞춘다.
-- 기존 월 경계 시작 창도 그대로 유효하며 저장 좌표를 변경하지 않는다.
ALTER TABLE "world_state"
    DROP CONSTRAINT "world_state_turn_recovery_window_check",
    ADD CONSTRAINT "world_state_turn_recovery_window_check" CHECK (
        ("clock_recovery_start_tick" IS NULL AND "clock_recovery_end_tick" IS NULL AND "clock_recovery_start_wall_at" IS NULL)
        OR (
            "clock_recovery_start_tick" IS NOT NULL AND "clock_recovery_end_tick" IS NOT NULL AND "clock_recovery_start_wall_at" IS NOT NULL
            AND "clock_recovery_start_tick" BETWEEN -9007199254740991 AND 9007199254740991
            AND "clock_recovery_end_tick" BETWEEN -9007199254740991 AND 9007199254740991
            AND "clock_recovery_end_tick" % 36000000 = 0
            AND "clock_recovery_end_tick" - "clock_recovery_start_tick" BETWEEN 1 AND 899999999
        )
    );
