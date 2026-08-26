import { describe, expect, it } from 'vitest';

import { LiteHashDRBG, RandUtil } from '@sammo-ts/common';

import {
    buildJoinCreateGeneralSeed,
    cutJoinTurnTime,
    JOIN_WELCOME_MESSAGE,
    normalizeJoinSpecialityCode,
    resolveJoinTurnTime,
} from '../src/turn/joinCreateGeneralService.js';

describe('generic join deterministic contracts', () => {
    it('builds a deterministic MakeGeneral seed with the allocated general number', () => {
        expect(buildJoinCreateGeneralSeed('seed', 42, 72_000_000, 17)).toBe(
            'str(4,seed)|str(11,MakeGeneral)|int(42)|int(72000000)|int(17)'
        );
    });

    it('rotates the MakeGeneral seed when the same owner recreates at a frozen logical tick', () => {
        const first = buildJoinCreateGeneralSeed('seed', 42, 72_000_000, 17);
        const recreated = buildJoinCreateGeneralSeed('seed', 42, 72_000_000, 18);

        expect(recreated).not.toBe(first);
        expect(buildJoinCreateGeneralSeed('seed', 42, 72_000_000, 17)).toBe(first);
    });

    it('produces distinct fixed-seed draw streams for consecutive general numbers', () => {
        const draw = (generalId: number): number[] => {
            const rng = new RandUtil(
                new LiteHashDRBG(buildJoinCreateGeneralSeed('seed', 42, 72_000_000, generalId))
            );
            return [
                rng.nextRangeInt(0, 5),
                rng.nextRangeInt(3, 5),
                rng.nextRangeInt(0, 1),
                rng.nextRangeInt(0, 299),
                rng.nextRangeInt(0, 999_999),
                rng.nextRangeInt(1, 150),
            ];
        };

        expect(draw(17)).toEqual([4, 5, 0, 153, 734_806, 128]);
        expect(draw(18)).toEqual([4, 4, 0, 49, 230_491, 44]);
        expect(draw(17)).toEqual(draw(17));
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
