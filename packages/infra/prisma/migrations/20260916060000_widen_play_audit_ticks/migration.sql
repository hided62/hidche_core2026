-- 1개월은 36,000,000 tick이다. 기존 INTEGER는 약60개월에 넘치므로
-- 현재 world/input_event와 같은 BIGINT로 넓힌다. 기존 값과 hash는 유지한다.
ALTER TABLE "play_audit_month" ALTER COLUMN "tick" TYPE BIGINT USING "tick"::BIGINT;
ALTER TABLE "play_audit_policy" ALTER COLUMN "tick" TYPE BIGINT USING "tick"::BIGINT;
