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
});
