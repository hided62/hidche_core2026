import { describe, expect, it } from 'vitest';

import {
    buildRefAmountPresets,
    buildRefGeneralTargetOptions,
    buildRefNationTargetOptions,
    type GeneralTargetSource,
} from '../src/turns/commandTargets.js';

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
        expect(result.generalTargets.che_포상?.map((entry) => entry.npcState)).toEqual([0, 0, 2]);
    });

    it('adds resource, crew, and troop details and puts actual troop members first for kick orders', () => {
        const detailed = buildRefGeneralTargetOptions({
            actorId: 1,
            actorNationId: 1,
            generals: [
                general({ id: 1, name: '본인', gold: 5000, rice: 4000, crew: 1000, troopId: 0 }),
                general({
                    id: 2,
                    name: '부대원',
                    gold: 100,
                    rice: 200,
                    crew: 900,
                    train: 80,
                    atmos: 70,
                    troopId: 3,
                }),
                general({ id: 3, name: '부대장', npcState: 2, gold: 300, rice: 400, crew: 800, troopId: 3 }),
            ],
            nationNames: new Map([[1, '아국']]),
            cityNames: new Map([[10, '업']]),
            troopNames: new Map([[3, '청룡대']]),
        });

        expect(detailed.generalTargets.che_부대탈퇴지시?.map((entry) => entry.value)).toEqual([2, 1, 3]);
        expect(detailed.generalTargets.che_부대탈퇴지시?.[0]).toMatchObject({
            availableNow: true,
            gold: 100,
            rice: 200,
            crew: 900,
            troopId: 3,
            description: expect.stringContaining('탑승 부대 청룡대'),
        });
        expect(detailed.generalTargets.che_발령?.map((entry) => entry.label)).toEqual([
            '본인 (업)',
            '부대원 (업)',
            '부대장 (업)',
        ]);
        expect(detailed.generalTargets.che_발령?.[1]?.description).not.toContain('탑승 부대');
        expect(detailed.generalTargets.che_포상?.map((entry) => entry.label)).toEqual([
            '본인 (업)',
            '부대원 (업)',
            '부대장 (업)',
        ]);
        expect(detailed.generalTargets.che_포상?.[0]?.description).toBe('금 5,000 · 쌀 4,000 · 병력 1,000');
        expect(detailed.generalTargets.che_몰수?.[1]?.description).not.toContain('탑승 부대');
    });
});

describe('Ref nation target guidance', () => {
    const nations = [
        {
            id: 1,
            name: '아국',
            color: '#008000',
            capitalName: '업',
            level: 3,
            power: 1000,
            generalCount: 5,
            cityCount: 2,
            diplomacyState: 7,
            diplomacyTerm: 0,
            adjacent: false,
        },
        {
            id: 2,
            name: '교역국',
            color: '#800000',
            capitalName: '허창',
            level: 2,
            power: 800,
            generalCount: 4,
            cityCount: 2,
            diplomacyState: 2,
            diplomacyTerm: 0,
            adjacent: true,
            diplomacyRestricted: true,
        },
        {
            id: 3,
            name: '불가침국',
            color: '#000080',
            capitalName: '건업',
            level: 2,
            power: 900,
            generalCount: 3,
            cityCount: 1,
            diplomacyState: 7,
            diplomacyTerm: 12,
            adjacent: false,
        },
        {
            id: 4,
            name: '전쟁국',
            color: '#ff0000',
            capitalName: '성도',
            level: 1,
            power: 500,
            generalCount: 2,
            cityCount: 1,
            diplomacyState: 0,
            diplomacyTerm: 6,
            adjacent: true,
        },
    ];

    it('sorts the currently relevant relation first for each diplomacy command', () => {
        const result = buildRefNationTargetOptions({ actorNationId: 1, nations });
        expect(result.nationTargets.che_선전포고?.map((entry) => entry.value)).toEqual([2, 1, 3, 4]);
        expect(result.nationTargets.che_종전제의?.[0]).toMatchObject({ value: 4, availableNow: true });
        expect(result.nationTargets.che_불가침파기제의?.[0]).toMatchObject({ value: 3, availableNow: true });
        expect(result.nationTargets.che_물자원조?.map((entry) => entry.value)).toEqual([3, 4, 1, 2]);
        expect(result.nationTargets.che_물자원조?.at(-1)?.description).toContain('외교제한');
        expect(result.nationTargets.che_불가침파기제의?.[0]?.description).toContain('불가침 12턴');
        expect(result.nationTargets.che_불가침파기제의?.at(-1)).toMatchObject({ value: 4, availableNow: false });
    });
});

describe('Ref amount presets', () => {
    it('keeps the exact reward/seizure guide and the nation-level aid guide', () => {
        const result = buildRefAmountPresets(3, 10_000);
        expect(result.che_포상).toEqual({
            values: [
                100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7000,
                8000, 9000, 10000,
            ],
            defaultValue: 1000,
            min: 100,
            max: 10_000,
            step: 1,
        });
        expect(result.che_몰수).toEqual(result.che_포상);
        expect(result.che_물자원조).toEqual({
            values: [10_000, 20_000, 30_000],
            defaultValue: 1000,
            min: 1000,
            max: 30_000,
            step: 10,
        });
    });
});
