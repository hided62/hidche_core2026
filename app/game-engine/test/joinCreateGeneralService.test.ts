import { describe, expect, it } from 'vitest';

import {
    buildJoinCreateGeneralSeed,
    cutJoinTurnTime,
    JOIN_WELCOME_MESSAGE,
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

    it('uses the HiDCHe product name without the legacy PHP runtime label', () => {
        expect(JOIN_WELCOME_MESSAGE).toBe('삼국지 모의전투 HiDCHe의 세계에 오신 것을 환영합니다 ^o^');
        expect(JOIN_WELCOME_MESSAGE).not.toContain('PHP');
    });
});
