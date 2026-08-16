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
const GENERAL_REF_EDITOR_ACTIONS = [
    'che_은퇴',
    'che_임관',
    'che_랜덤임관',
    'che_강행',
    'che_징병',
    'che_출병',
    'che_농지개간',
    'che_선동',
    'che_탈취',
    'che_파괴',
    'che_화계',
    'che_증여',
    'che_하야',
    'che_장비매매',
] as const;
const GENERAL_REF_STRATEGY_ACTIONS = ['che_선동', 'che_탈취', 'che_파괴', 'che_화계'] as const;
const GENERAL_REF_STRATEGY_ACTION_SET = new Set<string>(GENERAL_REF_STRATEGY_ACTIONS);
const NATION_REF_EDITOR_ACTIONS = [
    '휴식',
    'che_발령',
    'che_포상',
    'che_몰수',
    'che_부대탈퇴지시',
    'che_물자원조',
    'che_불가침제의',
    'che_선전포고',
    'che_종전제의',
    'che_불가침파기제의',
    'che_초토화',
    'che_천도',
    'che_증축',
    'che_감축',
    'che_필사즉생',
    'che_백성동원',
    'che_수몰',
    'che_허보',
    'che_의병모집',
    'che_이호경식',
    'che_급습',
    'che_피장파장',
    'che_국기변경',
    'che_국호변경',
] as const;

describe('default turn command profile AI coverage', () => {
    it('loads every action selected directly by the general and nation AI', async () => {
        const profile = await loadTurnCommandProfile();

        expect(profile.general).toEqual(expect.arrayContaining([...GENERAL_AI_ACTIONS]));
        expect(profile.nation).toEqual(expect.arrayContaining([...NATION_AI_ACTIONS]));
    });

    it('keeps every command covered by the Ref general and chief editors', async () => {
        const profile = await loadTurnCommandProfile();

        expect(profile.general).toEqual(expect.arrayContaining([...GENERAL_REF_EDITOR_ACTIONS]));
        expect(profile.general.filter((action) => GENERAL_REF_STRATEGY_ACTION_SET.has(action))).toEqual(
            GENERAL_REF_STRATEGY_ACTIONS
        );
        expect(profile.nation).toEqual(NATION_REF_EDITOR_ACTIONS);
    });
});
