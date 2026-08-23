import { orderLegacyActionLoggerFlush } from '@sammo-ts/logic/logging/actionLogger.js';
import type { ActionLogger } from '@sammo-ts/logic/logging/actionLogger.js';
import type { LogEntryDraft } from '@sammo-ts/logic/logging/types.js';

/**
 * Ref의 한 `ActionLogger::flush()`/`General::applyDB()` 경계를 로그 정렬 그룹 하나로 보존한다.
 * 시작값을 생략하면 그룹 표식 없이 logger별 bucket 순서만 유지한다.
 */
export class LegacyWarLogFlushSequence {
    public constructor(private nextLegacyFlushGroup?: number) {}

    public claimGroup(): number | undefined {
        if (this.nextLegacyFlushGroup === undefined) {
            return undefined;
        }
        const group = this.nextLegacyFlushGroup;
        this.nextLegacyFlushGroup += 1;
        return group;
    }

    public flush(logger: ActionLogger): LogEntryDraft[] {
        return this.flushEntries(logger.flush());
    }

    public flushEntries(entries: readonly LogEntryDraft[]): LogEntryDraft[] {
        const ordered = orderLegacyActionLoggerFlush(entries);
        const group = this.claimGroup();
        if (group === undefined) {
            return ordered;
        }
        return ordered.map((entry) => ({ ...entry, legacyFlushGroup: group }));
    }

    /** WarUnitCity::applyDB()처럼 logger 내용을 버리지만 flush epoch은 소비하는 경계. */
    public discard(logger: ActionLogger): void {
        logger.rollback();
        this.claimGroup();
    }
}
