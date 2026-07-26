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

const readGold = (row: { gold?: unknown } | undefined): number => (typeof row?.gold === 'number' ? row.gold : 0);
const NPC_SEIZURE_MESSAGE_TEXT = '몰수를 하다니... 이것이 윗사람이 할 짓이란 말입니까...';

const ignoredLifecyclePaths = [
    /^generalTurns/,
    /^nationTurns/,
    /^logs/,
    /^messages/,
    /^world\.turnTime$/,
    /^generals\[[^\]]+\]\.(?:turnTime|recentWarTime|lastTurn|killTurn|mySet)(?:\.|$)/,
    /^generals\[[^\]]+\]\.meta(?:\.|$)/,
    /^nations\[[^\]]+\]\.meta\.(?:turn_last_\d+|next_execute_.+|capset|tech|gennum|war|surlimit|strategic_cmd_limit)(?:\.|$)/,
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
    world?: Partial<NonNullable<NonNullable<TurnCommandFixtureRequest['setup']>['world']>>;
    generals?: Record<number, Record<string, unknown>>;
    nations?: Record<number, Record<string, unknown>>;
    cities?: Record<number, Record<string, unknown>>;
    troops?: Array<Record<string, unknown>>;
    diplomacy?: Record<string, Record<string, unknown>>;
    randomFoundingCandidateCityIds?: number[];
}

type NationMatrixCase = [string, Record<string, unknown> | undefined, FixturePatches?];

const researchCase = (action: string, command: string, term: number): NationMatrixCase => [
    action,
    undefined,
    {
        nations: {
            1: {
                turnLastByOfficerLevel: {
                    12: { command, term },
                },
            },
        },
    },
];

const buildRequest = (
    action: string,
    args?: Record<string, unknown>,
    fixturePatches: FixturePatches = {}
): TurnCommandFixtureRequest => ({
    kind: 'nation',
    actorGeneralId: 1,
    action,
    ...(args ? { args } : {}),
    setup: {
        isolateWorld: true,
        world: {
            startYear: 180,
            year: 190,
            month: 1,
            hiddenSeed: 'turn-command-nation-matrix-v1',
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
                typeCode: 'che_명가',
                war: 0,
                diplomacyLimit: 0,
                strategicCommandLimit: 0,
                generalCount: 2,
                meta: { can_국호변경: 1, can_국기변경: 1, surlimit: 0 },
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
                typeCode: 'che_명가',
                war: 0,
                diplomacyLimit: 0,
                strategicCommandLimit: 0,
                generalCount: 1,
                meta: { surlimit: 0 },
                ...fixturePatches.nations?.[2],
            },
        ],
        cities: [
            {
                id: 3,
                nationId: 1,
                population: 100_000,
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
            { ...general(1, 1, 3, 12), ...fixturePatches.generals?.[1] },
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
                state: 3,
                term: 0,
                dead: 0,
                ...fixturePatches.diplomacy?.['1:2'],
            },
            {
                fromNationId: 2,
                toNationId: 1,
                state: 3,
                term: 0,
                dead: 0,
                ...fixturePatches.diplomacy?.['2:1'],
            },
        ],
    },
    observe: {
        generalIds: [1, 2, 3, 4, 5, 6],
        cityIds: [3, 70],
        nationIds: [1, 2],
        logAfterId: 0,
        messageAfterId: 0,
    },
});

const cases: NationMatrixCase[] = [
    ['휴식', undefined],
    ['che_포상', { isGold: true, amount: 100, destGeneralID: 3 }],
    ['che_선전포고', { destNationID: 2 }],
    ['che_국호변경', { nationName: '신아국' }],
    ['che_국기변경', { colorType: 1 }],
    ['che_몰수', { isGold: true, amount: 100, destGeneralID: 3 }],
    ['che_물자원조', { destNationID: 2, amountList: [100, 200] }],
    ['che_불가침제의', { destNationID: 2, year: 191, month: 1 }],
    [
        'che_부대탈퇴지시',
        { destGeneralID: 3 },
        {
            generals: { 1: { troopId: 1 }, 3: { troopId: 1 } },
            troops: [{ id: 1, nationId: 1, name: '조조군' }],
        },
    ],
    ['che_발령', { destGeneralID: 3, destCityID: 70 }, { cities: { 70: { nationId: 1 } } }],
    ['che_종전제의', { destNationID: 2 }, { diplomacy: { '1:2': { state: 0 }, '2:1': { state: 0 } } }],
    ['che_불가침파기제의', { destNationID: 2 }, { diplomacy: { '1:2': { state: 7 }, '2:1': { state: 7 } } }],
    ['cr_인구이동', { destCityID: 70, amount: 1000 }, { cities: { 70: { nationId: 1, supplyState: 1 } } }],
    [
        'che_천도',
        { destCityID: 70 },
        {
            nations: {
                1: {
                    capitalRevision: 0,
                    turnLastByOfficerLevel: {
                        12: {
                            command: '천도',
                            arg: { destCityID: 70 },
                            term: 2,
                            seq: 0,
                        },
                    },
                },
            },
            cities: { 70: { nationId: 1, supplyState: 1 } },
        },
    ],
    [
        'che_증축',
        undefined,
        {
            nations: {
                1: {
                    capitalRevision: 0,
                    turnLastByOfficerLevel: {
                        12: { command: '증축', arg: {}, term: 5, seq: 0 },
                    },
                },
            },
            cities: { 3: { level: 7 } },
        },
    ],
    [
        'che_감축',
        undefined,
        {
            nations: {
                1: {
                    capitalRevision: 0,
                    turnLastByOfficerLevel: {
                        12: { command: '감축', arg: {}, term: 5, seq: 0 },
                    },
                },
            },
            cities: { 3: { level: 9 } },
        },
    ],
    [
        'che_무작위수도이전',
        undefined,
        {
            world: { year: 181 },
            nations: {
                1: {
                    meta: {
                        can_무작위수도이전: 1,
                    },
                    turnLastByOfficerLevel: {
                        12: { command: '무작위 수도 이전', arg: {}, term: 1 },
                    },
                },
            },
            cities: { 70: { nationId: 0, supplyState: 0 } },
            randomFoundingCandidateCityIds: [70],
        },
    ],
    researchCase('event_원융노병연구', '원융노병 연구', 23),
    researchCase('event_화시병연구', '화시병 연구', 11),
    researchCase('event_음귀병연구', '음귀병 연구', 11),
    researchCase('event_대검병연구', '대검병 연구', 11),
    researchCase('event_화륜차연구', '화륜차 연구', 23),
    researchCase('event_산저병연구', '산저병 연구', 11),
    researchCase('event_극병연구', '극병 연구', 23),
    researchCase('event_상병연구', '상병 연구', 23),
    researchCase('event_무희연구', '무희 연구', 23),
    ['che_백성동원', { destCityID: 70 }, { cities: { 70: { nationId: 1 } } }],
    [
        'che_이호경식',
        { destNationID: 2 },
        { diplomacy: { '1:2': { state: 1, term: 12 }, '2:1': { state: 1, term: 12 } } },
    ],
    ['che_급습', { destNationID: 2 }, { diplomacy: { '1:2': { state: 1, term: 12 }, '2:1': { state: 1, term: 12 } } }],
    [
        'che_필사즉생',
        undefined,
        {
            nations: {
                1: {
                    turnLastByOfficerLevel: {
                        12: { command: '필사즉생', arg: {}, term: 2 },
                    },
                },
            },
            diplomacy: { '1:2': { state: 0 }, '2:1': { state: 0 } },
        },
    ],
    [
        'che_허보',
        { destCityID: 70 },
        {
            nations: {
                1: {
                    turnLastByOfficerLevel: {
                        12: { command: '허보', arg: { destCityID: 70 }, term: 1 },
                    },
                    coreTurnLastByOfficerLevel: {
                        12: { command: '허보', arg: { destCityId: 70 }, term: 1 },
                    },
                },
            },
            diplomacy: { '1:2': { state: 0 }, '2:1': { state: 0 } },
        },
    ],
    [
        'che_초토화',
        { destCityID: 70 },
        {
            nations: {
                1: {
                    turnLastByOfficerLevel: {
                        12: { command: '초토화', arg: { destCityID: 70 }, term: 2 },
                    },
                    coreTurnLastByOfficerLevel: {
                        12: { command: '초토화', arg: { destCityId: 70 }, term: 2 },
                    },
                },
            },
            cities: { 70: { nationId: 1, supplyState: 1 } },
        },
    ],
    [
        'che_의병모집',
        undefined,
        {
            nations: {
                1: {
                    turnLastByOfficerLevel: {
                        12: { command: '의병모집', term: 2 },
                    },
                },
            },
        },
    ],
    [
        'che_수몰',
        { destCityID: 70 },
        {
            nations: {
                1: {
                    turnLastByOfficerLevel: {
                        12: { command: '수몰', arg: { destCityID: 70 }, term: 2 },
                    },
                    coreTurnLastByOfficerLevel: {
                        12: { command: '수몰', arg: { destCityId: 70 }, term: 2 },
                    },
                },
            },
            diplomacy: { '1:2': { state: 0 }, '2:1': { state: 0 } },
        },
    ],
    [
        'che_피장파장',
        { destNationID: 2, commandType: 'che_필사즉생' },
        {
            nations: {
                1: {
                    turnLastByOfficerLevel: {
                        12: {
                            command: '피장파장',
                            arg: { destNationID: 2, commandType: 'che_필사즉생' },
                            term: 1,
                        },
                    },
                    coreTurnLastByOfficerLevel: {
                        12: {
                            command: '피장파장',
                            arg: { destNationId: 2, commandType: 'che_필사즉생' },
                            term: 1,
                        },
                    },
                },
            },
            diplomacy: { '1:2': { state: 0 }, '2:1': { state: 0 } },
        },
    ],
];

integration('nation command success matrix', () => {
    it.each(cases)(
        '%s matches the legacy state delta and command RNG',
        async (action, args, fixturePatches) => {
            const request = buildRequest(action, args, fixturePatches);
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
                            referenceOutcome: reference.execution.outcome,
                            coreOutcome: core.execution.outcome,
                            differences: compareTurnSnapshotDeltas(
                                reference.before,
                                reference.after,
                                core.before,
                                core.after,
                                { ignoredPathPatterns: ignoredLifecyclePaths }
                            ),
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

const nationResourceAmountCases: Array<{
    name: string;
    action: 'che_포상' | 'che_몰수';
    args: Record<string, unknown>;
    expectedAmount: number;
}> = [
    {
        name: 'award rounds a half unit up',
        action: 'che_포상',
        args: { isGold: true, amount: 150, destGeneralID: 3 },
        expectedAmount: 200,
    },
    {
        name: 'award clamps below the minimum',
        action: 'che_포상',
        args: { isGold: true, amount: 1, destGeneralID: 3 },
        expectedAmount: 100,
    },
    {
        name: 'award clamps above the maximum',
        action: 'che_포상',
        args: { isGold: true, amount: 10_050, destGeneralID: 3 },
        expectedAmount: 10_000,
    },
    {
        name: 'seizure rounds a half unit up',
        action: 'che_몰수',
        args: { isGold: true, amount: 150, destGeneralID: 3 },
        expectedAmount: 200,
    },
    {
        name: 'seizure clamps below the minimum',
        action: 'che_몰수',
        args: { isGold: true, amount: 1, destGeneralID: 3 },
        expectedAmount: 100,
    },
    {
        name: 'seizure clamps above the maximum',
        action: 'che_몰수',
        args: { isGold: true, amount: 10_050, destGeneralID: 3 },
        expectedAmount: 10_000,
    },
];

integration('nation command resource amount normalization matrix', () => {
    it.each(nationResourceAmountCases)(
        '$name matches legacy rounding and clamp semantics',
        async ({ action, args, expectedAmount }) => {
            const request = buildRequest(action, args);
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);
            const referenceTargetBefore = reference.before.generals.find((entry) => entry.id === 3);
            const referenceTargetAfter = reference.after.generals.find((entry) => entry.id === 3);
            const coreTargetBefore = core.before.generals.find((entry) => entry.id === 3);
            const coreTargetAfter = core.after.generals.find((entry) => entry.id === 3);
            const referenceAmount =
                action === 'che_포상'
                    ? readGold(referenceTargetAfter) - readGold(referenceTargetBefore)
                    : readGold(referenceTargetBefore) - readGold(referenceTargetAfter);
            const coreAmount =
                action === 'che_포상'
                    ? readGold(coreTargetAfter) - readGold(coreTargetBefore)
                    : readGold(coreTargetBefore) - readGold(coreTargetAfter);

            expect(reference.execution.outcome).toMatchObject({ completed: true });
            expect(core.execution.outcome).toMatchObject({
                requestedAction: action,
                actionKey: action,
                usedFallback: false,
            });
            expect(referenceAmount).toBe(expectedAmount);
            expect(coreAmount).toBe(expectedAmount);
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

const nationResourceBoundaryCases: Array<{
    name: string;
    action: 'che_포상' | 'che_몰수';
    args: Record<string, unknown>;
    fixturePatches?: FixturePatches;
    completed: boolean;
}> = [
    {
        name: 'award is limited to the available nation gold',
        action: 'che_포상',
        args: { isGold: true, amount: 10_000, destGeneralID: 3 },
        fixturePatches: { nations: { 1: { gold: 5_000 } } },
        completed: true,
    },
    {
        name: 'award keeps the legacy base rice reserve',
        action: 'che_포상',
        args: { isGold: false, amount: 10_000, destGeneralID: 3 },
        fixturePatches: { nations: { 1: { rice: 2_100 } } },
        completed: true,
    },
    {
        name: 'award rejects the actor as its target',
        action: 'che_포상',
        args: { isGold: true, amount: 100, destGeneralID: 1 },
        completed: false,
    },
    {
        name: 'seizure is limited to the target general gold',
        action: 'che_몰수',
        args: { isGold: true, amount: 1_000, destGeneralID: 3 },
        fixturePatches: { generals: { 3: { gold: 50 } } },
        completed: true,
    },
    {
        name: 'seizure rejects the actor as its target',
        action: 'che_몰수',
        args: { isGold: true, amount: 100, destGeneralID: 1 },
        completed: false,
    },
];

integration('nation command resource balance and target boundaries', () => {
    it.each(nationResourceBoundaryCases)(
        '$name matches legacy completion, RNG, and state delta',
        async ({ action, args, fixturePatches, completed }) => {
            const request = buildRequest(action, args, fixturePatches);
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);

            expect(reference.execution.outcome).toMatchObject({ completed });
            expect(core.execution.outcome).toMatchObject({
                requestedAction: action,
                actionKey: completed ? action : '휴식',
                usedFallback: !completed,
            });
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

integration('nation seizure NPC public message parity', () => {
    it('matches the legacy fixed-seed RNG and public message side effect', async () => {
        const request = buildRequest(
            'che_몰수',
            { isGold: true, amount: 100, destGeneralID: 3 },
            {
                world: { hiddenSeed: 'seizure-message-37' },
                generals: { 3: { name: '몰수NPC', npcState: 2 } },
            }
        );
        const reference = runReferenceTurnCommandTraceRequest(
            workspaceRoot!,
            request as unknown as Record<string, unknown>
        );
        const core = await runCoreTurnCommandTrace(request, reference.before);

        expect(reference.execution.outcome).toMatchObject({ completed: true });
        expect(reference.rng).toHaveLength(2);
        expect(reference.rng.map((call) => call.operation)).toEqual(['nextFloat1', 'nextInt']);
        expect(core.rng).toEqual(reference.rng);
        const referenceMessages = reference.after.messages.slice(reference.before.messages.length);
        expect(referenceMessages).toHaveLength(1);
        expect(core.after.messages).toHaveLength(1);
        expect(referenceMessages[0]).toMatchObject({
            mailbox: 9999,
            type: 'public',
            sourceId: 3,
            destinationId: 9999,
            payload: {
                src: { id: 3, name: '몰수NPC', nation_id: 1, nation: '아국' },
                dest: { id: 3, name: '몰수NPC', nation_id: 1, nation: '아국' },
                text: NPC_SEIZURE_MESSAGE_TEXT,
            },
        });
        expect(core.after.messages[0]).toMatchObject({
            payload: {
                msgType: 'public',
                src: { generalId: 3, generalName: '몰수NPC', nationId: 1, nationName: '아국' },
                dest: { generalId: 3, generalName: '몰수NPC', nationId: 1, nationName: '아국' },
                text: NPC_SEIZURE_MESSAGE_TEXT,
            },
        });
    }, 120_000);
});
