import { describe, expect, it } from 'vitest';

import {
    buildJoinCreateGeneralSeed,
    cutJoinTurnTime,
    JOIN_WELCOME_MESSAGE,
    normalizeJoinSpecialityCode,
    resolveJoinTurnTime,
} from '../src/turn/joinCreateGeneralService.js';

describe('generic join legacy time contracts', () => {
    it('builds the Ref MakeGeneral seed from the logical game tick', () => {
        expect(buildJoinCreateGeneralSeed('seed', 42, 72_000_000)).toBe(
            'str(4,seed)|str(11,MakeGeneral)|int(42)|int(72000000)'
        );
    });

    it('aligns a 120-minute turn from the Ref Asia/Seoul previous-day 01:00 anchor', () => {
        expect(cutJoinTurnTime(new Date('2026-07-30T03:34:56.789Z'), 120 * 60).toISOString()).toBe(
            '2026-07-30T02:00:00.000Z'
        );
    });

    it('schedules a new general within one turn of the accepted game time even when the daemon cursor is stale', () => {
        const calls: Array<[number, number]> = [];
        const values = [59, 250_000];
        const rng = {
            nextRangeInt(min: number, max: number) {
                calls.push([min, max]);
                return values.shift() ?? min;
            },
        };
        const acceptedAt = new Date('2026-08-15T17:57:05.837Z');
        const staleRuntimeTurnTime = new Date('2026-08-15T07:10:00.000Z');

        const turnTime = resolveJoinTurnTime(
            rng,
            { tickSeconds: 120 } as Parameters<typeof resolveJoinTurnTime>[1],
            acceptedAt,
            staleRuntimeTurnTime,
            undefined
        );

        expect(turnTime.toISOString()).toBe('2026-08-15T17:58:05.087Z');
        expect(turnTime.getTime()).toBeGreaterThan(acceptedAt.getTime());
        expect(turnTime.getTime()).toBeLessThanOrEqual(acceptedAt.getTime() + 120_000);
        expect(calls).toEqual([
            [0, 119],
            [0, 999_999],
        ]);
    });

    it('uses the HiDCHe product name without the legacy PHP runtime label', () => {
        expect(JOIN_WELCOME_MESSAGE).toBe('삼국지 모의전투 HiDCHe의 세계에 오신 것을 환영합니다 ^o^');
        expect(JOIN_WELCOME_MESSAGE).not.toContain('PHP');
    });

    it('normalizes the Ref empty-speciality sentinel at the join boundary', () => {
        expect(normalizeJoinSpecialityCode(undefined)).toBeNull();
        expect(normalizeJoinSpecialityCode('')).toBeNull();
        expect(normalizeJoinSpecialityCode('None')).toBeNull();
        expect(normalizeJoinSpecialityCode('che_견고')).toBe('che_견고');
    });
});
