import { describe, expect, it } from 'vitest';

import { finalizeLogEntry, LogCategory, LogFormat, LogScope } from '../src/index.js';

describe('finalizeLogEntry', () => {
    it('uses an explicit draft year and month for pre-month logs', () => {
        expect(
            finalizeLogEntry(
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.HISTORY,
                    text: '이전 달 사건',
                    format: LogFormat.YEAR_MONTH,
                    year: 193,
                    month: 12,
                },
                { year: 194, month: 1 }
            )
        ).toMatchObject({
            year: 193,
            month: 12,
            text: '<C>●</>193년 12월:이전 달 사건',
        });
    });

    it('keeps an explicit occurrence time instead of replacing it with the flush time', () => {
        const occurredAt = new Date('0200-01-01T00:37:43.000Z');
        const flushAt = new Date('0200-01-01T00:40:00.000Z');

        expect(
            finalizeLogEntry(
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    text: '상업 투자를 실행했습니다.',
                    generalId: 1,
                    occurredAt,
                },
                { year: 200, month: 1, at: flushAt }
            )?.createdAt
        ).toEqual(occurredAt);
    });
});
