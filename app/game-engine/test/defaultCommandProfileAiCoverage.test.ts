import { describe, expect, it } from 'vitest';

import { loadTurnCommandProfile } from '../src/turn/turnCommandProfile.js';

const GENERAL_AI_ACTIONS = [
    'che_군량매매',
    'che_귀환',
    'che_랜덤임관',
    'che_모병',
    'che_물자조달',
    'che_선양',
    'che_소집해제',
    'che_이동',
    'che_정착장려',
    'che_해산',
    'che_헌납',
] as const;

const NATION_AI_ACTIONS = ['che_몰수', 'che_발령', 'che_선전포고', 'che_천도', 'che_포상'] as const;

describe('default turn command profile AI coverage', () => {
    it('loads every action selected directly by the general and nation AI', async () => {
        const profile = await loadTurnCommandProfile();

        expect(profile.general).toEqual(expect.arrayContaining([...GENERAL_AI_ACTIONS]));
        expect(profile.nation).toEqual(expect.arrayContaining([...NATION_AI_ACTIONS]));
    });
});
