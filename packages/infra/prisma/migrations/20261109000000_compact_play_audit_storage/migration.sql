-- 대형 기존 기록을 migration 중 재작성/전체 검사하지 않는다. 이전 배열과 새 압축 형식을 함께 허용한다.
BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE "play_audit_decision_chunk" DROP CONSTRAINT "play_audit_decision_chunk_steps_check";
ALTER TABLE "play_audit_decision_chunk" ADD CONSTRAINT "play_audit_decision_chunk_steps_check"
    CHECK (COALESCE(
        jsonb_typeof("steps") = 'array' OR (
            jsonb_typeof("steps") = 'object'
            AND "steps"->>'encoding' = 'gzip-json-v1'
            AND jsonb_typeof("steps"->'data') = 'string'
        ), false
    )) NOT VALID;
-- 기본 약 2KiB 문턱 아래의 반복 JSON도 압축하되 작은 snapshot은 TOAST 밖으로 쪼개지 않는다.
ALTER TABLE "play_audit_general" ALTER COLUMN "data" SET STORAGE MAIN;
ALTER TABLE "play_audit_general" SET (toast_tuple_target = 512);
ALTER TABLE "play_audit_decision" ALTER COLUMN "summary" SET STORAGE MAIN;
ALTER TABLE "play_audit_decision" SET (toast_tuple_target = 512);
COMMIT;
