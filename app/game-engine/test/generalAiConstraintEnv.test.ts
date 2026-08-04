import { describe, expect, it } from 'vitest';
import type { TurnCommandEnv } from '@sammo-ts/logic';

import { resolveConstraintEnv } from '../src/turn/ai/generalAi/constraint.js';

describe('general AI constraint environment', () => {
    it('passes the current development cost into candidate validation', () => {
        const env = resolveConstraintEnv(
            {
                id: 1,
                currentYear: 182,
                currentMonth: 5,
                tickSeconds: 600,
                lastTurnTime: new Date('2026-08-02T05:47:00.000Z'),
                meta: { develcost: 24 },
            },
            {
                title: 'test',
                startYear: 180,
                life: null,
                fiction: 1,
                history: [],
                ignoreDefaultEvents: false,
            },
            { develCost: 24, openingPartYear: 3, minAvailableRecruitPop: 30_000 } as TurnCommandEnv
        );

        expect(env).toMatchObject({ currentYear: 182, currentMonth: 5, develCost: 24 });
    });
});
