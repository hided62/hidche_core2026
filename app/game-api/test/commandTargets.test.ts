import { describe, expect, it } from 'vitest';

import {
    buildRefAmountPresets,
    buildRefGeneralTargetOptions,
    buildRefNationTargetOptions,
    type GeneralTargetSource,
    type NationTargetSource,
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

    it('indexes genuine names even when named 없음, and excludes missing-name placeholders', () => {
        const options = buildRefGeneralTargetOptions({
            actorId: 1,
            // 이름·국가·도시·부대 원본이 없는 경우. 재야 actor는 같은 국가 후보가 없으므로 국가 ID만 둔다.
            actorNationId: 5,
            generals: [general({ name: '없음', nationId: 5, cityId: 0, troopId: 99 })],
            nationNames: new Map(),
            cityNames: new Map(),
            troopNames: new Map(),
        });
        expect(options.generalTargets.che_증여?.[0]?.targetNames).toEqual({
            name: '없음',
            nationName: null,
            cityName: null,
            troopName: null,
        });
        expect(options.generalTargets.che_증여?.[0]?.description).not.toContain('없음');
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
                    leadership: 100,
                    strength: 95,
                    intel: 0,
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
            targetNames: { name: '부대원', nationName: '아국', cityName: '업', troopName: '청룡대' },
        });
        expect(detailed.generalTargets.che_발령?.map((entry) => entry.label)).toEqual([
            '본인 (업)',
            '부대원 (업)',
            '부대장 (업)',
        ]);
        expect(detailed.generalTargets.che_발령?.[1]?.description).toBe(
            '통솔 100 · 무력 95 · 지력 0\n병력 900 · 훈련 80 · 사기 70\n금 100 · 쌀 200'
        );
        expect(detailed.generalTargets.che_발령?.[0]?.description).toBe('병력 1,000\n금 5,000 · 쌀 4,000');
        expect(detailed.generalTargets.che_발령?.[2]?.targetNames?.troopName).toBe('청룡대');
        // Ref ProcessGeneralAmount.vue처럼 증여 후보도 (통/무/지)를 함께 보인다. 발령의 줄바꿈 형식은 쓰지 않는다.
        expect(detailed.generalTargets.che_증여?.[1]?.description).toBe(
            '금 100 · 쌀 200 · 병력 900 · 훈련 80 · 사기 70 · 통솔 100 · 무력 95 · 지력 0'
        );
        expect(detailed.generalTargets.che_증여?.map((entry) => entry.targetNames)).toEqual([
            { name: '본인', nationName: '아국', cityName: '업', troopName: null },
            { name: '부대원', nationName: '아국', cityName: '업', troopName: '청룡대' },
            { name: '부대장', nationName: '아국', cityName: '업', troopName: '청룡대' },
        ]);
        expect(detailed.generalTargets.che_포상?.map((entry) => entry.label)).toEqual([
            '본인 (업)',
            '부대원 (업)',
            '부대장 (업)',
        ]);
        expect(detailed.generalTargets.che_포상?.[0]?.description).toBe('금 5,000 · 쌀 4,000 · 병력 1,000');
        expect(detailed.generalTargets.che_몰수?.[1]?.description).not.toContain('탑승 부대');
    });

    it('limits cross-nation recruitment and joining targets to the fields Ref exports', () => {
        const foreign = general({
            id: 7,
            name: '타국장수',
            nationId: 2,
            cityId: 20,
            officerLevel: 1,
            gold: 9000,
            rice: 8000,
            crew: 7000,
            train: 90,
            atmos: 80,
            troopId: 7,
            leadership: 75,
            strength: 60,
            intel: 45,
        });
        const wanderer = general({ id: 8, name: '재야장수', nationId: 0, cityId: 30, gold: 500, rice: 400 });
        const options = buildRefGeneralTargetOptions({
            actorId: 1,
            actorNationId: 1,
            generals: [general({}), foreign, wanderer],
            nationNames: new Map([
                [1, '아국'],
                [2, '타국'],
            ]),
            cityNames: new Map([
                [10, '업'],
                [20, '허창'],
                [30, '단양'],
            ]),
            troopNames: new Map([[7, '비밀부대']]),
        });
        for (const list of [
            options.generalTargets.che_등용,
            options.generalTargets.che_장수대상임관,
            options.generals,
        ]) {
            const target = list?.find((entry) => entry.value === 7);
            // Ref: no,name,nation,officer_level,npc,leadership,strength,intel
            expect(target).toEqual({
                value: 7,
                label: '타국장수 (타국)',
                targetNames: { name: '타국장수', nationName: '타국' },
                description: '통솔 75 · 무력 60 · 지력 45',
                npcState: 0,
                nationId: 2,
            });
            const serialized = JSON.stringify(list);
            for (const hidden of ['9,000', '9000', '8000', '7000', '허창', '단양', '비밀부대', '훈련', '사기']) {
                expect(serialized).not.toContain(hidden);
            }
            expect(list?.find((entry) => entry.value === 8)).toMatchObject({
                label: '재야장수 (재야)',
                targetNames: { name: '재야장수', nationName: null },
                nationId: 0,
            });
        }
    });

    it('gives a wandering actor no same-nation general candidates', () => {
        const options = buildRefGeneralTargetOptions({
            actorId: 1,
            actorNationId: 0,
            generals: [general({ nationId: 0 }), general({ id: 2, name: '다른재야', nationId: 0, gold: 900 })],
            nationNames: new Map(),
            cityNames: new Map([[10, '업']]),
        });
        for (const action of ['che_증여', 'che_선양', 'che_발령', 'che_포상', 'che_몰수', 'che_부대탈퇴지시']) {
            expect(options.generalTargets[action]).toEqual([]);
        }
        expect(options.generalTargets.che_장수대상임관?.map((entry) => entry.value)).toEqual([2]);
        expect(JSON.stringify(options.generalTargets.che_장수대상임관)).not.toContain('900');
    });

    it('shows only city and Ref stats for abdication candidates', () => {
        const options = buildRefGeneralTargetOptions({
            actorId: 1,
            actorNationId: 1,
            generals: [
                general({}),
                general({
                    id: 2,
                    name: '후계',
                    gold: 100,
                    rice: 200,
                    crew: 300,
                    leadership: 80,
                    strength: 70,
                    intel: 60,
                }),
            ],
            nationNames: new Map([[1, '아국']]),
            cityNames: new Map([[10, '업']]),
        });
        expect(options.generalTargets.che_선양).toMatchObject([
            { value: 2, label: '후계 (업)', description: '통솔 80 · 무력 70 · 지력 60' },
        ]);
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

    it('indexes real nation and capital names without missing-capital or diplomacy copy', () => {
        const result = buildRefNationTargetOptions({
            actorNationId: 1,
            nations: nations.map((entry) => ({ ...entry, capitalName: undefined })),
        });
        expect(result.nations.map((entry) => entry.targetNames)).toEqual(
            nations.map((entry) => ({ name: entry.name, capitalName: null }))
        );
        for (const options of Object.values(result.nationTargets)) {
            for (const option of options) expect(option.targetNames).toEqual({ name: option.label, capitalName: null });
        }
        const populated = buildRefNationTargetOptions({ actorNationId: 1, nations });
        expect(populated.nations[0]?.targetNames).toEqual({
            name: nations[0]!.name,
            capitalName: nations[0]!.capitalName,
        });
    });

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

    it('marks counter-strategy targets like Ref exportJSVars notAvailable', () => {
        const withDeclaration = [
            ...nations,
            { ...nations[3]!, id: 5, name: '선포국', diplomacyState: 1, diplomacyTerm: 12 },
            { ...nations[3]!, id: 6, name: '신규선포국', diplomacyState: 1, diplomacyTerm: 11 },
        ];
        const result = buildRefNationTargetOptions({ actorNationId: 1, nations: withDeclaration });
        const available = (action: string) =>
            result.nationTargets[action]?.filter((entry) => entry.availableNow).map((entry) => entry.value);
        // 피장파장·이호경식: AllowDiplomacyBetweenStatus([0, 1])
        expect(available('che_피장파장')).toEqual([4, 5, 6]);
        expect(available('che_이호경식')).toEqual([4, 5, 6]);
        // 급습: AllowDiplomacyWithTerm(1, 12)
        expect(available('che_급습')).toEqual([5]);
        expect(result.nationTargets.che_급습?.find((entry) => entry.value === 6)?.description).toContain(
            '선포 12개월 이상인 상대국에만 가능합니다.'
        );
        expect(result.nationTargets.che_피장파장?.find((entry) => entry.value === 1)).toMatchObject({
            availableNow: false,
        });

        const exhausted = buildRefNationTargetOptions({
            actorNationId: 1,
            nations: withDeclaration,
            strategyAvailable: false,
        });
        expect(exhausted.nationTargets.che_피장파장?.every((entry) => entry.availableNow === false)).toBe(true);
        expect(exhausted.nationTargets.che_피장파장?.find((entry) => entry.value === 4)?.description).toContain(
            '사용할 수 있는 전략이 없습니다.'
        );
        expect(exhausted.nationTargets.che_이호경식?.some((entry) => entry.availableNow)).toBe(true);
    });

    it('keeps the Ref nation order for appointment targets and exports purified scout messages', () => {
        const joinNations: NationTargetSource[] = [
            { ...nations[0]!, scoutMessage: '<p>어서 오시오</p>' },
            { ...nations[1]!, blockScout: true },
            { ...nations[2]!, name: 'ⓤ태수국' },
            { ...nations[3]!, name: 'ⓞ이민족' },
            { ...nations[3]!, id: 5, name: '초반만원국', generalCount: 3, gennum: 10 },
        ];
        const join = { actorNpcState: 0, relYear: 1, openingPartYear: 3, initialNationGenLimit: 10 };
        const result = buildRefNationTargetOptions({ actorNationId: 0, nations: joinNations, join });
        expect(result.nationTargets.che_임관?.map((entry) => [entry.value, entry.availableNow])).toEqual([
            [1, true],
            [2, false],
            [3, false],
            [4, false],
            [5, false],
        ]);
        expect(result.nationTargets.che_임관?.map((entry) => entry.description?.split(' · ')[0])).toEqual([
            '현재 임관 가능',
            '임관이 금지되어 있습니다.',
            '유저장은 태수국에 임관할 수 없습니다.',
            '이민족 국가에 임관할 수 없습니다.',
            '임관이 제한되고 있습니다.',
        ]);
        // 초반 제한이 끝나면 인원 제한은 없고, NPC(9)는 이민족 국가에 임관할 수 있다.
        const later = buildRefNationTargetOptions({
            actorNationId: 0,
            nations: joinNations,
            join: { ...join, actorNpcState: 9, relYear: 3 },
        });
        expect(later.nationTargets.che_임관?.map((entry) => entry.availableNow)).toEqual([
            true,
            false,
            true,
            true,
            true,
        ]);
        expect(result.nationScoutMessages).toEqual(
            joinNations.map((entry) => ({
                nationId: entry.id,
                name: entry.name,
                color: entry.color,
                message: entry.scoutMessage ?? '',
            }))
        );
        // join 정보가 없으면 임관은 기존 공통 국가 목록을 그대로 쓴다.
        expect(buildRefNationTargetOptions({ actorNationId: 0, nations }).nationTargets.che_임관).toBeUndefined();
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
