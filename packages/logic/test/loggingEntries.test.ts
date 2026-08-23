import { describe, expect, it } from 'vitest';

import {
    ActionLogger,
    finalizeLogEntry,
    LogCategory,
    LogFormat,
    LogScope,
    orderLegacyActionLoggerFlush,
} from '../src/index.js';

describe('ActionLogger', () => {
    it('flushes Ref category buffers in physical persistence order', () => {
        const logger = new ActionLogger({ generalId: 7, nationId: 3 });

        logger.pushGlobalActionLog('global action');
        logger.pushGlobalHistoryLog('global history');
        logger.pushNationHistoryLog('nation history');
        logger.pushGeneralActionLog(['first action', 'second action']);
        logger.pushGeneralHistoryLog('general history');

        expect(logger.flush().map((entry) => entry.text)).toEqual([
            'general history',
            'first action',
            'second action',
            'nation history',
            'global history',
            'global action',
        ]);
    });

    it('keeps a separately flushed logger after every category of the earlier logger', () => {
        expect(
            orderLegacyActionLoggerFlush([
                {
                    scope: LogScope.NATION,
                    category: LogCategory.HISTORY,
                    nationId: 1,
                    text: 'actor nation history',
                },
                {
                    scope: LogScope.NATION,
                    category: LogCategory.HISTORY,
                    nationId: 2,
                    text: 'destination nation history',
                    legacyFlushGroup: 1,
                },
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.HISTORY,
                    text: 'global history',
                },
            ]).map((entry) => entry.text)
        ).toEqual(['actor nation history', 'global history', 'destination nation history']);
    });

    it('preserves early, actor, and destructor flush stages before applying category buckets', () => {
        const ordered = orderLegacyActionLoggerFlush([
            {
                scope: LogScope.NATION,
                category: LogCategory.HISTORY,
                nationId: 1,
                text: 'actor nation history',
            },
            {
                scope: LogScope.NATION,
                category: LogCategory.HISTORY,
                nationId: 2,
                text: 'destructor nation history',
                legacyFlushGroup: 1,
            },
            {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                generalId: 7,
                text: 'early chief action',
                legacyFlushGroup: -1,
            },
            {
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                text: 'actor global history',
            },
        ]);

        expect(ordered.map((entry) => entry.text)).toEqual([
            'early chief action',
            'actor nation history',
            'actor global history',
            'destructor nation history',
        ]);
    });
});

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
