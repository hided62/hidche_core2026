import { describe, expect, it } from 'vitest';

import { compareTurnSnapshotDeltas } from '../src/turn-differential/compare.js';
import { runCoreTurnCommandTrace, type TurnCommandFixtureRequest } from '../src/turn-differential/coreCommandTrace.js';
import {
    findTurnDifferentialWorkspaceRoot,
    runReferenceTurnCommandTraceRequest,
} from '../src/turn-differential/referenceSnapshot.js';

const configuredWorkspaceRoot = process.env.TURN_DIFFERENTIAL_WORKSPACE_ROOT;
const workspaceRoot = configuredWorkspaceRoot ?? findTurnDifferentialWorkspaceRoot(process.cwd());
const integration = describe.skipIf(!workspaceRoot || process.env.TURN_DIFFERENTIAL_REFERENCE !== '1');

const ignoredLifecyclePaths = [
    /^generalTurns/,
    /^nationTurns/,
    /^logs/,
    /^messages/,
    /^world\.turnTime$/,
    /^generals\[[^\]]+\]\.(?:turnTime|recentWarTime|lastTurn|killTurn|mySet)(?:\.|$)/,
    /^generals\[[^\]]+\]\.meta(?:\.|$)/,
    /^nations\[[^\]]+\]\.meta(?:\.|$)/,
];

const general = (id: number, nationId: number, cityId: number, officerLevel: number): Record<string, unknown> => ({
    id,
    nationId,
    cityId,
    troopId: 0,
    leadership: 90,
    strength: 80,
    intelligence: 70,
    leadershipExp: 0,
    strengthExp: 0,
    intelExp: 0,
    experience: 1000,
    dedication: 1000,
    expLevel: 0,
    officerLevel,
    officerCityId: officerLevel >= 5 ? cityId : 0,
    injury: 0,
    age: 30,
    gold: 100_000,
    rice: 100_000,
    crew: 1_000,
    crewTypeId: 1100,
    train: 50,
    atmos: 50,
    dex1: 0,
    dex2: 0,
    dex3: 0,
    dex4: 0,
    dex5: 0,
    killTurn: 24,
    npcState: 0,
    blockState: 0,
    personality: 'None',
    specialDomestic: 'None',
    specialWar: 'None',
    itemHorse: 'None',
    itemWeapon: 'None',
    itemBook: 'None',
    itemExtra: 'None',
    meta: {},
});

interface FixturePatches {
    world?: NonNullable<NonNullable<TurnCommandFixtureRequest['setup']>['world']>;
    generals?: Record<number, Record<string, unknown>>;
    nations?: Record<number, Record<string, unknown>>;
    cities?: Record<number, Record<string, unknown>>;
    troops?: Array<Record<string, unknown>>;
    diplomacy?: Record<string, Record<string, unknown>>;
    randomFoundingCandidateCityIds?: number[];
}

const buildRequest = (
    action: string,
    args?: Record<string, unknown>,
    actorPatch: Record<string, unknown> = {},
    fixturePatches: FixturePatches = {}
): TurnCommandFixtureRequest => ({
    kind: 'general',
    actorGeneralId: 1,
    action,
    ...(args ? { args } : {}),
    setup: {
        isolateWorld: true,
        world: {
            startYear: 180,
            year: 190,
            month: 1,
            hiddenSeed: 'turn-command-general-matrix-v1',
            ...fixturePatches.world,
        },
        nations: [
            {
                id: 1,
                name: '아국',
                capitalCityId: 3,
                gold: 1_000_000,
                rice: 1_000_000,
                tech: 1000,
                level: 1,
                typeCode: 'che_중립',
                war: 0,
                generalCount: 2,
                meta: {},
                ...fixturePatches.nations?.[1],
            },
            {
                id: 2,
                name: '타국',
                capitalCityId: 70,
                gold: 1_000_000,
                rice: 1_000_000,
                tech: 1000,
                level: 1,
                typeCode: 'che_중립',
                war: 0,
                generalCount: 1,
                meta: {},
                ...fixturePatches.nations?.[2],
            },
        ],
        cities: [
            {
                id: 3,
                nationId: 1,
                population: 100_000,
                populationMax: 200_000,
                agriculture: 1_000,
                commerce: 1_000,
                security: 1_000,
                defence: 1_000,
                wall: 1_000,
                supplyState: 1,
                frontState: 0,
                state: 0,
                term: 0,
                trust: 80,
                trade: 100,
                ...fixturePatches.cities?.[3],
            },
            {
                id: 70,
                nationId: 2,
                population: 100_000,
                populationMax: 200_000,
                agriculture: 1_000,
                commerce: 1_000,
                security: 1_000,
                defence: 1_000,
                wall: 1_000,
                supplyState: 1,
                frontState: 1,
                state: 0,
                term: 0,
                trust: 80,
                trade: 100,
                ...fixturePatches.cities?.[70],
            },
        ],
        generals: [
            { ...general(1, 1, 3, 12), ...actorPatch, ...fixturePatches.generals?.[1] },
            { ...general(2, 2, 70, 12), ...fixturePatches.generals?.[2] },
            { ...general(3, 1, 3, 1), ...fixturePatches.generals?.[3] },
        ],
        ...(fixturePatches.troops ? { troops: fixturePatches.troops } : {}),
        ...(fixturePatches.randomFoundingCandidateCityIds
            ? { randomFoundingCandidateCityIds: fixturePatches.randomFoundingCandidateCityIds }
            : {}),
        diplomacy: [
            {
                fromNationId: 1,
                toNationId: 2,
                state: 0,
                term: 12,
                dead: 0,
                ...fixturePatches.diplomacy?.['1:2'],
            },
            {
                fromNationId: 2,
                toNationId: 1,
                state: 0,
                term: 12,
                dead: 0,
                ...fixturePatches.diplomacy?.['2:1'],
            },
        ],
    },
    observe: {
        generalIds: [1, 2, 3],
        cityIds: [3, 70],
        nationIds: [1, 2],
        logAfterId: 0,
        messageAfterId: 0,
    },
});

const cases: Array<
    [string, Record<string, unknown> | undefined, Record<string, unknown> | undefined, FixturePatches?]
> = [
    ['휴식', undefined, undefined],
    ['che_훈련', undefined, undefined],
    ['cr_맹훈련', undefined, undefined],
    ['che_전투태세', undefined, { lastTurn: { command: '전투태세', term: 3 } }],
    ['che_단련', undefined, undefined],
    ['che_사기진작', undefined, undefined],
    ['che_요양', undefined, { injury: 30 }],
    ['che_견문', undefined, undefined],
    ['che_주민선정', undefined, undefined],
    ['che_정착장려', undefined, undefined],
    ['che_농지개간', undefined, undefined],
    ['che_상업투자', undefined, undefined],
    ['che_기술연구', undefined, undefined],
    ['che_치안강화', undefined, undefined],
    ['che_수비강화', undefined, undefined],
    ['che_성벽보수', undefined, undefined],
    ['che_인재탐색', undefined, undefined],
    ['che_소집해제', undefined, undefined],
    ['che_군량매매', { buyRice: true, amount: 100 }, undefined],
    ['che_물자조달', undefined, undefined],
    ['che_헌납', { isGold: true, amount: 100 }, undefined],
    ['che_이동', { destCityID: 70 }, undefined],
    ['che_강행', { destCityID: 70 }, undefined],
    ['che_귀환', undefined, { cityId: 70 }],
    ['che_접경귀환', undefined, { cityId: 70 }],
    ['che_증여', { isGold: true, amount: 100, destGeneralID: 3 }, undefined],
    ['che_첩보', { destCityID: 70 }, undefined],
    ['che_화계', { destCityID: 70 }, undefined],
    ['che_파괴', { destCityID: 70 }, undefined],
    ['che_선동', { destCityID: 70 }, undefined],
    ['che_탈취', { destCityID: 70 }, undefined],
    ['che_모병', { crewType: 1100, amount: 100 }, undefined],
    ['che_징병', { crewType: 1100, amount: 100 }, undefined],
    ['che_숙련전환', { srcArmType: 1, destArmType: 2 }, { dex1: 100 }],
    [
        'che_내정특기초기화',
        undefined,
        { specialDomestic: 'che_인덕', lastTurn: { command: '내정 특기 초기화', term: 1 } },
    ],
    ['che_전투특기초기화', undefined, { specialWar: 'che_귀병', lastTurn: { command: '전투 특기 초기화', term: 1 } }],
    ['che_장비매매', { itemType: 'weapon', itemCode: 'che_무기_01_단도' }, undefined],
    ['che_하야', undefined, { officerLevel: 1 }],
    ['che_은퇴', undefined, { age: 60, lastTurn: { command: '은퇴', term: 1 } }],
    [
        'che_임관',
        { destNationID: 1 },
        { nationId: 0, officerLevel: 0 },
        { generals: { 3: { officerLevel: 12, officerCityId: 3 } } },
    ],
    [
        'che_랜덤임관',
        undefined,
        { nationId: 0, officerLevel: 0 },
        { generals: { 3: { officerLevel: 12, officerCityId: 3 } } },
    ],
    ['che_장수대상임관', { destGeneralID: 2 }, { nationId: 0, officerLevel: 0 }],
    ['che_등용', { destGeneralID: 2 }, undefined, { generals: { 2: { officerLevel: 1 } } }],
    ['che_등용수락', { destNationID: 2, destGeneralID: 2 }, { nationId: 0, officerLevel: 0 }],
    ['che_선양', { destGeneralID: 3 }, undefined],
    ['che_NPC능동', { optionText: '순간이동', destCityID: 70 }, { npcState: 2 }],
    ['che_방랑', undefined, undefined, { diplomacy: { '1:2': { state: 2 }, '2:1': { state: 2 } } }],
    [
        'che_해산',
        undefined,
        undefined,
        {
            nations: { 1: { name: '조조', level: 0, capitalCityId: 0, typeCode: 'None' } },
            cities: { 3: { nationId: 0, supplyState: 0, frontState: 0 } },
        },
    ],
    [
        'che_집합',
        undefined,
        { troopId: 1 },
        {
            generals: { 3: { cityId: 70, troopId: 1 } },
            troops: [{ id: 1, nationId: 1, name: '조조군' }],
        },
    ],
    ['che_거병', undefined, { nationId: 0, officerLevel: 0 }, { world: { startYear: 180, year: 181 } }],
    [
        'che_모반시도',
        undefined,
        { officerLevel: 11 },
        { generals: { 3: { officerLevel: 12, officerCityId: 3, killTurn: 0 } } },
    ],
    [
        'che_건국',
        { nationName: '신국', nationType: 'che_도적', colorType: 1 },
        undefined,
        {
            world: { startYear: 180, initYear: 180, initMonth: 1, year: 181 },
            nations: { 1: { name: '조조', level: 0, capitalCityId: 0, typeCode: 'None' } },
            cities: { 3: { nationId: 0, level: 5 } },
        },
    ],
    [
        'cr_건국',
        { nationName: '신국', nationType: 'che_도적', colorType: 1 },
        undefined,
        {
            world: { startYear: 180, initYear: 180, initMonth: 1, year: 181 },
            nations: { 1: { name: '조조', level: 0, capitalCityId: 0, typeCode: 'None' } },
            cities: { 3: { nationId: 0, level: 5 } },
        },
    ],
    [
        'che_무작위건국',
        { nationName: '신국', nationType: 'che_도적', colorType: 1 },
        undefined,
        {
            world: { startYear: 180, initYear: 180, initMonth: 1, year: 181 },
            nations: { 1: { name: '조조', level: 0, capitalCityId: 0, typeCode: 'None' } },
            cities: {
                3: { nationId: 0, level: 5 },
                70: { nationId: 0, level: 5 },
            },
            randomFoundingCandidateCityIds: [3, 70],
        },
    ],
];

integration('general command success matrix', () => {
    it.each(cases)(
        '%s matches the legacy state delta and command RNG',
        async (action, args, actorPatch, fixturePatches) => {
            const request = buildRequest(action, args, actorPatch, fixturePatches);
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);
            if (process.env.TURN_DIFFERENTIAL_DEBUG === '1') {
                process.stderr.write(
                    `${JSON.stringify(
                        {
                            action,
                            coreOutcome: core.execution.outcome,
                            referenceRng: reference.rng,
                            coreRng: core.rng,
                            referenceGeneralDelta: compareTurnSnapshotDeltas(
                                reference.before,
                                reference.after,
                                reference.before,
                                reference.before,
                                { ignoredPathPatterns: ignoredLifecyclePaths }
                            ).filter((entry) => entry.path.startsWith('generals')),
                            coreGeneralDelta: compareTurnSnapshotDeltas(
                                core.before,
                                core.after,
                                core.before,
                                core.before,
                                { ignoredPathPatterns: ignoredLifecyclePaths }
                            ).filter((entry) => entry.path.startsWith('generals')),
                            referenceGenerals: reference.after.generals,
                            coreGenerals: core.after.generals,
                        },
                        null,
                        2
                    )}\n`
                );
            }

            expect(core.execution.outcome).toMatchObject({
                requestedAction: action,
                actionKey: action,
                usedFallback: false,
            });
            expect(reference.execution.outcome).toMatchObject({ completed: true });
            expect(core.execution.outcome).not.toHaveProperty('blockedReason');
            expect(core.rng).toEqual(reference.rng);
            expect(
                compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                    ignoredPathPatterns: ignoredLifecyclePaths,
                })
            ).toEqual([]);
        },
        120_000
    );
});

type GeneralFailureCase = {
    action: string;
    args?: Record<string, unknown>;
    hiddenSeed: string;
    failureText: string;
};

const failureCases: GeneralFailureCase[] = [
    {
        action: 'che_주민선정',
        hiddenSeed: 'general-failure-che_주민선정-0',
        failureText: "주민 선정을 <span class='ev_failed'>실패</span>",
    },
    {
        action: 'che_정착장려',
        hiddenSeed: 'general-failure-che_정착장려-0',
        failureText: "정착 장려를 <span class='ev_failed'>실패</span>",
    },
    {
        action: 'che_상업투자',
        hiddenSeed: 'general-failure-che_상업투자-2',
        failureText: "상업 투자를 <span class='ev_failed'>실패</span>",
    },
    {
        action: 'che_기술연구',
        hiddenSeed: 'general-failure-che_기술연구-0',
        failureText: "기술 연구를 <span class='ev_failed'>실패</span>",
    },
    {
        action: 'che_물자조달',
        hiddenSeed: 'general-failure-che_물자조달-1',
        failureText: "조달을 <span class='ev_failed'>실패</span>",
    },
    {
        action: 'che_화계',
        args: { destCityID: 70 },
        hiddenSeed: 'general-failure-che_화계-0',
        failureText: '화계가 실패했습니다.',
    },
    {
        action: 'che_선동',
        args: { destCityID: 70 },
        hiddenSeed: 'general-failure-che_선동-0',
        failureText: '선동이 실패했습니다.',
    },
    {
        action: 'che_파괴',
        args: { destCityID: 70 },
        hiddenSeed: 'general-failure-che_파괴-0',
        failureText: '파괴가 실패했습니다.',
    },
    {
        action: 'che_탈취',
        args: { destCityID: 70 },
        hiddenSeed: 'general-failure-che_탈취-0',
        failureText: '탈취가 실패했습니다.',
    },
];

const failureLogTexts = (logs: Array<Record<string, unknown>>, failureText: string): string[] =>
    logs
        .map((entry) => entry.text)
        .filter((text): text is string => typeof text === 'string' && text.includes(failureText));

const legacyActionLogBody = (text: string): string => {
    const match = /^<C>●<\/>\d+월:(.*) <1>\d{2}:\d{2}<\/>$/.exec(text);
    return match?.[1] ?? text;
};

integration('general command in-action failure matrix', () => {
    it.each(failureCases)(
        '$action matches legacy failure RNG, side effects, and failure log',
        async ({ action, args, hiddenSeed, failureText }) => {
            const request = buildRequest(action, args);
            request.setup!.world!.hiddenSeed = hiddenSeed;
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);

            expect(reference.execution.outcome).toMatchObject({ completed: true });
            expect(core.execution.outcome).toMatchObject({
                requestedAction: action,
                actionKey: action,
                usedFallback: false,
            });
            expect(core.execution.outcome).not.toHaveProperty('blockedReason');
            expect(failureLogTexts(reference.after.logs, failureText)).toHaveLength(1);
            expect(failureLogTexts(core.after.logs, failureText)).toEqual(
                failureLogTexts(reference.after.logs, failureText).map(legacyActionLogBody)
            );
            expect(core.rng).toEqual(reference.rng);
            expect(
                compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                    ignoredPathPatterns: ignoredLifecyclePaths,
                })
            ).toEqual([]);
        },
        120_000
    );
});

type GeneralConstraintCase = {
    name: string;
    action: string;
    args?: Record<string, unknown>;
    actorPatch?: Record<string, unknown>;
    fixturePatches?: FixturePatches;
};

const constraintCases: GeneralConstraintCase[] = [
    {
        name: 'neutral general',
        action: 'che_훈련',
        actorPatch: { nationId: 0, officerLevel: 0 },
    },
    {
        name: 'wandering nation',
        action: 'che_농지개간',
        fixturePatches: {
            nations: { 1: { level: 0, capitalCityId: 0, typeCode: 'None' } },
        },
    },
    {
        name: 'city not occupied by actor nation',
        action: 'che_농지개간',
        fixturePatches: { cities: { 3: { nationId: 2 } } },
    },
    {
        name: 'unsupplied city',
        action: 'che_농지개간',
        fixturePatches: { cities: { 3: { supplyState: 0 } } },
    },
    {
        name: 'insufficient gold',
        action: 'che_상업투자',
        actorPatch: { gold: 0 },
    },
    {
        name: 'insufficient rice',
        action: 'che_주민선정',
        actorPatch: { rice: 0 },
    },
    {
        name: 'maximum city trust',
        action: 'che_주민선정',
        fixturePatches: { cities: { 3: { trust: 100 } } },
    },
];

integration('general command full-constraint fallback matrix', () => {
    it.each(constraintCases)(
        '$name: $action falls back exactly like legacy',
        async ({ action, args, actorPatch, fixturePatches }) => {
            const request = buildRequest(action, args, actorPatch, fixturePatches);
            request.setup!.world!.hiddenSeed = `general-constraint-${action}`;
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);

            expect(reference.execution.outcome).toMatchObject({ completed: false });
            expect(core.execution.outcome).toMatchObject({
                requestedAction: action,
                actionKey: '휴식',
                usedFallback: true,
            });
            expect(core.execution.outcome).toHaveProperty('blockedReason');
            expect(core.rng).toEqual(reference.rng);
            expect(
                compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                    ignoredPathPatterns: ignoredLifecyclePaths,
                })
            ).toEqual([]);
        },
        120_000
    );
});
