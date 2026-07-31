import { describe, expect, it } from 'vitest';

import { buildJoinCreateGeneralSeed, cutJoinTurnTime } from '../src/turn/joinCreateGeneralService.js';

describe('generic join legacy time contracts', () => {
    it('builds the Ref MakeGeneral seed from the Seoul whole-second timestamp', () => {
        expect(buildJoinCreateGeneralSeed('seed', 42, new Date('2026-07-30T23:59:58.987Z'))).toBe(
            'str(4,seed)|str(11,MakeGeneral)|int(42)|str(19,2026-07-31 08:59:58)'
        );
    });

    it('aligns a 120-minute turn from the Ref Asia/Seoul previous-day 01:00 anchor', () => {
        expect(cutJoinTurnTime(new Date('2026-07-30T03:34:56.789Z'), 120 * 60).toISOString()).toBe(
            '2026-07-30T02:00:00.000Z'
        );
    });
});
