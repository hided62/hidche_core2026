import { describe, expect, it } from 'vitest';

import { buildRefGeneralTargetOptions, type GeneralTargetSource } from '../src/turns/commandTargets.js';

const general = (overrides: Partial<GeneralTargetSource>): GeneralTargetSource => ({
    id: 1,
    name: '본인',
    nationId: 1,
    cityId: 10,
    npcState: 0,
    officerLevel: 5,
    ...overrides,
});

describe('Ref command general targets', () => {
    const sources = [
        general({}),
        general({ id: 2, name: '아국유저', officerLevel: 12 }),
        general({ id: 3, name: '아국NPC', npcState: 2, officerLevel: 0 }),
        general({ id: 4, name: '타국유저', nationId: 2, cityId: 20, officerLevel: 0 }),
        general({ id: 5, name: '타국NPC', nationId: 2, cityId: 20, npcState: 3, officerLevel: 0 }),
    ];
    const result = buildRefGeneralTargetOptions({
        actorId: 1,
        actorNationId: 1,
        generals: sources,
        nationNames: new Map([
            [1, '아국'],
            [2, '타국'],
        ]),
        cityNames: new Map([
            [10, '업'],
            [20, '허창'],
        ]),
    });
    const ids = (action: string) => result.generalTargets[action]?.map((entry) => entry.value);

    it('includes user and NPC generals of the same nation for every Ref nation personnel command', () => {
        for (const action of ['che_발령', 'che_포상', 'che_몰수', 'che_부대탈퇴지시']) {
            expect(ids(action)).toEqual([1, 2, 3]);
        }
    });

    it('preserves the distinct Ref filters for gift, abdication, recruitment, and target-based joining', () => {
        expect(ids('che_증여')).toEqual([1, 2, 3]);
        expect(ids('che_선양')).toEqual([2, 3]);
        expect(ids('che_등용')).toEqual([4]);
        expect(ids('che_장수대상임관')).toEqual([2, 3, 4, 5]);
        expect(result.generals.map((entry) => entry.value)).toEqual([1, 2, 4]);
    });
});
