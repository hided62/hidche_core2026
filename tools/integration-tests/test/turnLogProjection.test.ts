import { describe, expect, it } from 'vitest';

import { orderedSemanticLogStreams } from '../src/turn-differential/logProjection.js';

const actionLog = (id: number, text: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id,
    scope: 'general',
    category: 'action',
    generalId: 1,
    nationId: null,
    year: 190,
    month: 1,
    format: 4,
    text,
    ...overrides,
});

const historyLog = (id: number, text: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id,
    scope: 'nation',
    category: 'history',
    generalId: null,
    nationId: 1,
    year: 190,
    month: 1,
    format: 2,
    text,
    ...overrides,
});

const generalHistoryLog = (
    id: number,
    text: string,
    overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
    id,
    scope: 'general',
    category: 'history',
    generalId: 1,
    nationId: null,
    year: 190,
    month: 1,
    format: 2,
    text,
    ...overrides,
});

describe('orderedSemanticLogStreams', () => {
    it('preserves observable ordering inside general_record', () => {
        const expected = orderedSemanticLogStreams([actionLog(1, '명령'), actionLog(2, '능력 상승')]);
        const reversed = orderedSemanticLogStreams([actionLog(2, '명령'), actionLog(1, '능력 상승')]);

        expect(reversed).not.toEqual(expected);
    });

    it('keeps general history in general_record so an action/history order mutant fails', () => {
        const expected = orderedSemanticLogStreams([generalHistoryLog(1, '장수 역사'), actionLog(2, '장수 행동')]);
        const reversed = orderedSemanticLogStreams([actionLog(1, '장수 행동'), generalHistoryLog(2, '장수 역사')]);

        expect(reversed).not.toEqual(expected);
    });

    it('orders each Ref table by its own id and does not invent a cross-table order', () => {
        const left = orderedSemanticLogStreams([
            historyLog(4, '국가 기록 둘'),
            historyLog(3, '국가 기록 하나'),
            actionLog(8, '장수 기록 둘'),
            generalHistoryLog(6, '장수 역사'),
            actionLog(7, '장수 기록 하나'),
        ]);
        const right = orderedSemanticLogStreams([
            generalHistoryLog(6, '장수 역사'),
            actionLog(7, '장수 기록 하나'),
            actionLog(8, '장수 기록 둘'),
            historyLog(3, '국가 기록 하나'),
            historyLog(4, '국가 기록 둘'),
        ]);

        expect(left).toEqual(right);
    });

    it('can omit the lifecycle rest log without omitting other ordered entries', () => {
        expect(
            orderedSemanticLogStreams([actionLog(1, '아무것도 실행하지 않았습니다.'), actionLog(2, '명령')], {
                omitRest: true,
            })
        ).toEqual(orderedSemanticLogStreams([actionLog(2, '명령')]));
    });

    it('maps a Core draft format to the same semantic persisted prefix as Ref', () => {
        const core = actionLog(1, '명령');
        const reference = actionLog(1, '<C>●</>1월:명령');
        delete reference.format;

        expect(orderedSemanticLogStreams([core])).toEqual(orderedSemanticLogStreams([reference]));
    });

    it('normalizes the hidden battle seed span with either HTML quote style', () => {
        const singleQuoted = actionLog(1, `진격<span class='hidden_but_copyable'>(전투시드: abc)</span>`);
        const doubleQuoted = actionLog(1, `진격<span class="hidden_but_copyable">(전투시드: abc)</span>`);

        expect(orderedSemanticLogStreams([doubleQuoted])).toEqual(orderedSemanticLogStreams([singleQuoted]));
        expect(
            orderedSemanticLogStreams([actionLog(1, `진격<span class="visible">(전투시드: abc)</span>`)])
        ).not.toEqual(orderedSemanticLogStreams([singleQuoted]));
    });

    it.each([
        ['year', { year: 191 }],
        ['month', { month: 2 }],
        ['format', { format: 1 }],
    ])('keeps a %s mutation visible', (_field, overrides) => {
        expect(orderedSemanticLogStreams([actionLog(1, '명령', overrides)])).not.toEqual(
            orderedSemanticLogStreams([actionLog(1, '명령')])
        );
    });

    it('rejects a persisted prefix whose calendar disagrees with its row', () => {
        const malformed = actionLog(1, '<C>●</>2월:명령');
        delete malformed.format;

        expect(() => orderedSemanticLogStreams([malformed])).toThrow('stored log month 2 does not match row month 1');
    });
});
