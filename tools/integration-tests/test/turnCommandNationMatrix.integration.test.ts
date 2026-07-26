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
const readNationResource = (row: { gold?: unknown; rice?: unknown } | undefined, resource: 'gold' | 'rice'): number =>
    typeof row?.[resource] === 'number' ? row[resource] : 0;
const readCityPopulation = (row: { population?: unknown } | undefined): number =>
    typeof row?.population === 'number' ? row.population : 0;
const readNumericField = (row: Record<string, unknown> | undefined, field: string): number =>
    typeof row?.[field] === 'number' ? row[field] : 0;
const readNationMeta = (row: { meta?: unknown } | undefined): Record<string, unknown> =>
    typeof row?.meta === 'object' && row.meta !== null && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : {};
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
            ...Object.entries(fixturePatches.generals ?? {})
                .filter(([id]) => !['1', '2', '3'].includes(id))
                .map(([id, patch]) => ({
                    ...general(
                        Number(id),
                        typeof patch.nationId === 'number' ? patch.nationId : 0,
                        typeof patch.cityId === 'number' ? patch.cityId : 3,
                        typeof patch.officerLevel === 'number' ? patch.officerLevel : 1
                    ),
                    ...patch,
                })),
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

integration('nation seizure zero target balance parity', () => {
    it('matches the legacy zero-amount logs for a user target', async () => {
        const request = buildRequest(
            'che_몰수',
            { isGold: true, amount: 100, destGeneralID: 3 },
            { generals: { 3: { name: '무자원장수', gold: 0, npcState: 0 } } }
        );
        const reference = runReferenceTurnCommandTraceRequest(
            workspaceRoot!,
            request as unknown as Record<string, unknown>
        );
        const core = await runCoreTurnCommandTrace(request, reference.before);
        const referenceLogs = reference.after.logs.slice(reference.before.logs.length);

        expect(reference.execution.outcome).toMatchObject({ completed: true });
        expect(core.execution.outcome).toMatchObject({
            requestedAction: 'che_몰수',
            actionKey: 'che_몰수',
            usedFallback: false,
        });
        expect(reference.rng).toEqual([]);
        expect(core.rng).toEqual(reference.rng);
        expect(referenceLogs.map((entry) => entry.text)).toEqual(
            expect.arrayContaining([
                expect.stringContaining('금 0를 몰수 당했습니다.'),
                expect.stringContaining('금 <C>0</>를 몰수했습니다.'),
            ])
        );
        expect(core.after.logs.map((entry) => entry.text)).toEqual(
            expect.arrayContaining([
                expect.stringContaining('금 0를 몰수 당했습니다.'),
                expect.stringContaining('금 <C>0</>를 몰수했습니다.'),
            ])
        );
        expect(
            compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                ignoredPathPatterns: ignoredLifecyclePaths,
            })
        ).toEqual([]);
    }, 120_000);

    it('preserves NPC message RNG and side effects before applying a zero delta', async () => {
        const request = buildRequest(
            'che_몰수',
            { isGold: true, amount: 100, destGeneralID: 3 },
            {
                world: { hiddenSeed: 'seizure-message-37' },
                generals: { 3: { name: '무자원NPC', gold: 0, npcState: 2 } },
            }
        );
        const reference = runReferenceTurnCommandTraceRequest(
            workspaceRoot!,
            request as unknown as Record<string, unknown>
        );
        const core = await runCoreTurnCommandTrace(request, reference.before);
        const referenceMessages = reference.after.messages.slice(reference.before.messages.length);

        expect(reference.execution.outcome).toMatchObject({ completed: true });
        expect(reference.rng.map((call) => call.operation)).toEqual(['nextFloat1', 'nextInt']);
        expect(core.rng).toEqual(reference.rng);
        expect(referenceMessages).toHaveLength(1);
        expect(core.after.messages).toHaveLength(1);
        expect(referenceMessages[0]).toMatchObject({
            type: 'public',
            sourceId: 3,
            payload: { text: NPC_SEIZURE_MESSAGE_TEXT },
        });
        expect(core.after.messages[0]).toMatchObject({
            payload: { msgType: 'public', text: NPC_SEIZURE_MESSAGE_TEXT },
        });
        expect(
            compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                ignoredPathPatterns: ignoredLifecyclePaths,
            })
        ).toEqual([]);
    }, 120_000);
});

const nationPersonnelTargetCases: Array<{
    name: string;
    action: 'che_포상' | 'che_몰수';
    destGeneralID: number;
}> = [
    {
        name: 'award rejects a missing target general',
        action: 'che_포상',
        destGeneralID: 9999,
    },
    {
        name: 'award rejects a foreign target general',
        action: 'che_포상',
        destGeneralID: 2,
    },
    {
        name: 'seizure rejects a missing target general',
        action: 'che_몰수',
        destGeneralID: 9999,
    },
    {
        name: 'seizure rejects a foreign target general',
        action: 'che_몰수',
        destGeneralID: 2,
    },
];

integration('nation award and seizure target constraints', () => {
    it.each(nationPersonnelTargetCases)(
        '$name matches legacy fallback, RNG, and semantic delta',
        async ({ action, destGeneralID }) => {
            const request = buildRequest(action, { isGold: true, amount: 100, destGeneralID });
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
            expect(reference.rng).toEqual([]);
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

const materialAidResourceCases: Array<{
    name: string;
    amountList: [number, number];
    fixturePatches?: FixturePatches;
    completed: boolean;
    expectedGold: number;
    expectedRice: number;
}> = [
    {
        name: 'allows a zero rice component',
        amountList: [100, 0],
        completed: true,
        expectedGold: 100,
        expectedRice: 0,
    },
    {
        name: 'allows a zero gold component',
        amountList: [0, 100],
        completed: true,
        expectedGold: 0,
        expectedRice: 100,
    },
    {
        name: 'clamps gold to the source available balance',
        amountList: [100, 0],
        fixturePatches: { nations: { 1: { gold: 50 } } },
        completed: true,
        expectedGold: 50,
        expectedRice: 0,
    },
    {
        name: 'clamps rice while preserving the source base reserve',
        amountList: [0, 100],
        fixturePatches: { nations: { 1: { rice: 2_050 } } },
        completed: true,
        expectedGold: 0,
        expectedRice: 50,
    },
    {
        name: 'allows the exact rank aid limit',
        amountList: [10_000, 0],
        completed: true,
        expectedGold: 10_000,
        expectedRice: 0,
    },
    {
        name: 'rejects an amount above the rank aid limit',
        amountList: [10_001, 0],
        completed: false,
        expectedGold: 0,
        expectedRice: 0,
    },
    {
        name: 'rejects two zero components',
        amountList: [0, 0],
        completed: false,
        expectedGold: 0,
        expectedRice: 0,
    },
];

integration('nation material aid resource boundaries', () => {
    it.each(materialAidResourceCases)(
        '$name matches legacy completion, amounts, RNG, and semantic delta',
        async ({ amountList, fixturePatches, completed, expectedGold, expectedRice }) => {
            const request = buildRequest('che_물자원조', { destNationID: 2, amountList }, fixturePatches);
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);

            const referenceSourceBefore = reference.before.nations.find((entry) => entry.id === 1);
            const referenceSourceAfter = reference.after.nations.find((entry) => entry.id === 1);
            const referenceDestBefore = reference.before.nations.find((entry) => entry.id === 2);
            const referenceDestAfter = reference.after.nations.find((entry) => entry.id === 2);
            const coreSourceBefore = core.before.nations.find((entry) => entry.id === 1);
            const coreSourceAfter = core.after.nations.find((entry) => entry.id === 1);
            const coreDestBefore = core.before.nations.find((entry) => entry.id === 2);
            const coreDestAfter = core.after.nations.find((entry) => entry.id === 2);

            for (const [resource, expected] of [
                ['gold', expectedGold],
                ['rice', expectedRice],
            ] as const) {
                expect(
                    readNationResource(referenceSourceBefore, resource) -
                        readNationResource(referenceSourceAfter, resource)
                ).toBe(expected);
                expect(
                    readNationResource(referenceDestAfter, resource) - readNationResource(referenceDestBefore, resource)
                ).toBe(expected);
                expect(
                    readNationResource(coreSourceBefore, resource) - readNationResource(coreSourceAfter, resource)
                ).toBe(expected);
                expect(readNationResource(coreDestAfter, resource) - readNationResource(coreDestBefore, resource)).toBe(
                    expected
                );
            }

            expect(reference.execution.outcome).toMatchObject({ completed });
            expect(core.execution.outcome).toMatchObject({
                requestedAction: 'che_물자원조',
                actionKey: completed ? 'che_물자원조' : '휴식',
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

    it('uses the legacy object particle when the rice component is zero', async () => {
        const request = buildRequest('che_물자원조', {
            destNationID: 2,
            amountList: [100, 0],
        });
        const reference = runReferenceTurnCommandTraceRequest(
            workspaceRoot!,
            request as unknown as Record<string, unknown>
        );
        const core = await runCoreTurnCommandTrace(request, reference.before);
        const referenceLogs = reference.after.logs.slice(reference.before.logs.length);

        expect(referenceLogs.map((entry) => entry.text)).toEqual(
            expect.arrayContaining([expect.stringContaining('쌀<C>0</>를 지원')])
        );
        expect(core.after.logs.map((entry) => entry.text)).toEqual(
            expect.arrayContaining([expect.stringContaining('쌀<C>0</>를 지원')])
        );
    }, 120_000);
});

const materialAidConstraintCases: Array<{
    name: string;
    args: Record<string, unknown>;
    fixturePatches?: FixturePatches;
}> = [
    {
        name: 'rejects a missing destination nation',
        args: { destNationID: 9999, amountList: [100, 0] },
    },
    {
        name: 'rejects the source nation as destination',
        args: { destNationID: 1, amountList: [100, 0] },
    },
    {
        name: 'rejects a source nation under diplomacy restriction',
        args: { destNationID: 2, amountList: [100, 0] },
        fixturePatches: { nations: { 1: { diplomacyLimit: 1 } } },
    },
    {
        name: 'rejects a destination nation under diplomacy restriction',
        args: { destNationID: 2, amountList: [100, 0] },
        fixturePatches: { nations: { 2: { diplomacyLimit: 1 } } },
    },
    {
        name: 'rejects a negative component',
        args: { destNationID: 2, amountList: [-1, 100] },
    },
    {
        name: 'rejects a fractional component',
        args: { destNationID: 2, amountList: [100.5, 0] },
    },
    {
        name: 'rejects a one-element amount list',
        args: { destNationID: 2, amountList: [100] },
    },
    {
        name: 'rejects a three-element amount list',
        args: { destNationID: 2, amountList: [100, 0, 0] },
    },
    {
        name: 'rejects a non-array amount list',
        args: { destNationID: 2, amountList: '100,0' },
    },
    {
        name: 'rejects a zero destination nation ID',
        args: { destNationID: 0, amountList: [100, 0] },
    },
    {
        name: 'rejects a fractional destination nation ID',
        args: { destNationID: 2.5, amountList: [100, 0] },
    },
];

integration('nation material aid target and input constraints', () => {
    it.each(materialAidConstraintCases)(
        '$name matches legacy fallback, RNG, and semantic delta',
        async ({ args, fixturePatches }) => {
            const request = buildRequest('che_물자원조', args, fixturePatches);
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);

            expect(reference.execution.outcome).toMatchObject({ completed: false });
            expect(core.execution.outcome).toMatchObject({
                requestedAction: 'che_물자원조',
                actionKey: '휴식',
                usedFallback: true,
            });
            expect(reference.rng).toEqual([]);
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

integration('nation material aid accumulated assistance and officer logs', () => {
    it.each([
        {
            name: 'array entry',
            priorEntry: [1, 250],
        },
        {
            name: 'legacy object entry',
            priorEntry: { 0: 1, 1: 250 },
        },
    ])(
        'accumulates a repeated aid amount from an existing $name',
        async ({ priorEntry }) => {
            const request = buildRequest(
                'che_물자원조',
                {
                    destNationID: 2,
                    amountList: [100, 200],
                },
                {
                    nations: {
                        2: {
                            nationEnv: {
                                recv_assist: {
                                    n1: priorEntry,
                                    n9: [9, 400],
                                },
                            },
                        },
                    },
                }
            );
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);
            const referenceDest = reference.after.nations.find((entry) => entry.id === 2);
            const coreDest = core.after.nations.find((entry) => entry.id === 2);

            expect(readNationMeta(referenceDest).recv_assist).toEqual({
                n1: [1, 550],
                n9: [9, 400],
            });
            expect(readNationMeta(coreDest).recv_assist).toEqual(readNationMeta(referenceDest).recv_assist);
            expect(core.rng).toEqual(reference.rng);
            expect(
                compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                    ignoredPathPatterns: ignoredLifecyclePaths,
                })
            ).toEqual([]);
        },
        120_000
    );

    it('notifies eligible officers in both nations with the legacy messages', async () => {
        const request = buildRequest(
            'che_물자원조',
            {
                destNationID: 2,
                amountList: [100, 200],
            },
            {
                generals: {
                    3: { officerLevel: 5 },
                    5: { nationId: 2, cityId: 70, officerLevel: 5, officerCityId: 70 },
                },
            }
        );
        const reference = runReferenceTurnCommandTraceRequest(
            workspaceRoot!,
            request as unknown as Record<string, unknown>
        );
        const core = await runCoreTurnCommandTrace(request, reference.before);
        const referenceLogs = reference.after.logs.slice(reference.before.logs.length);
        const sourceOfficerLog = {
            generalId: 3,
            text: expect.stringContaining('<D><b>타국</b></>으로 금<C>100</> 쌀<C>200</>을 지원했습니다.'),
        };
        const destinationOfficerLog = {
            generalId: 5,
            text: expect.stringContaining('<D><b>아국</b></>에서 금<C>100</> 쌀<C>200</>을 원조했습니다.'),
        };

        expect(referenceLogs).toEqual(
            expect.arrayContaining([
                expect.objectContaining(sourceOfficerLog),
                expect.objectContaining(destinationOfficerLog),
            ])
        );
        expect(core.after.logs).toEqual(
            expect.arrayContaining([
                expect.objectContaining(sourceOfficerLog),
                expect.objectContaining(destinationOfficerLog),
            ])
        );
        expect(core.rng).toEqual(reference.rng);
        expect(
            compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                ignoredPathPatterns: ignoredLifecyclePaths,
            })
        ).toEqual([]);
    }, 120_000);
});

const populationMoveCases: Array<{
    name: string;
    amount: unknown;
    fixturePatches?: FixturePatches;
    completed: boolean;
    expectedMoved: number;
    costBasis: number;
}> = [
    {
        name: 'completes a zero population move',
        amount: 0,
        completed: true,
        expectedMoved: 0,
        costBasis: 0,
    },
    {
        name: 'truncates a fractional amount',
        amount: 100.9,
        completed: true,
        expectedMoved: 100,
        costBasis: 100,
    },
    {
        name: 'caps the request and moves only the available population',
        amount: 100_001,
        completed: true,
        expectedMoved: 70_000,
        costBasis: 100_000,
    },
    {
        name: 'charges for the request before clamping to available population',
        amount: 1_000,
        fixturePatches: { cities: { 3: { population: 30_100 } } },
        completed: true,
        expectedMoved: 100,
        costBasis: 1_000,
    },
    {
        name: 'accepts a numeric string amount',
        amount: '1000',
        completed: true,
        expectedMoved: 1_000,
        costBasis: 1_000,
    },
    {
        name: 'rejects a negative integer amount',
        amount: -1,
        completed: false,
        expectedMoved: 0,
        costBasis: 0,
    },
    {
        name: 'allows the exact gold and rice cost',
        amount: 1_000,
        fixturePatches: { nations: { 1: { gold: 2, rice: 2_002 } } },
        completed: true,
        expectedMoved: 1_000,
        costBasis: 1_000,
    },
    {
        name: 'rejects one less than the required gold',
        amount: 1_000,
        fixturePatches: { nations: { 1: { gold: 1, rice: 2_002 } } },
        completed: false,
        expectedMoved: 0,
        costBasis: 0,
    },
    {
        name: 'rejects one less than the required rice reserve',
        amount: 1_000,
        fixturePatches: { nations: { 1: { gold: 2, rice: 2_001 } } },
        completed: false,
        expectedMoved: 0,
        costBasis: 0,
    },
];

integration('nation population move value and resource boundaries', () => {
    it.each(populationMoveCases)(
        '$name matches legacy completion, resources, RNG, and semantic delta',
        async ({ amount, fixturePatches, completed, expectedMoved, costBasis }) => {
            const request = buildRequest(
                'cr_인구이동',
                { destCityID: 70, amount },
                {
                    ...fixturePatches,
                    cities: {
                        ...fixturePatches?.cities,
                        70: {
                            nationId: 1,
                            supplyState: 1,
                            ...fixturePatches?.cities?.[70],
                        },
                    },
                }
            );
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);
            const referenceSourceBefore = reference.before.cities.find((entry) => entry.id === 3);
            const referenceSourceAfter = reference.after.cities.find((entry) => entry.id === 3);
            const referenceDestBefore = reference.before.cities.find((entry) => entry.id === 70);
            const referenceDestAfter = reference.after.cities.find((entry) => entry.id === 70);
            const coreSourceBefore = core.before.cities.find((entry) => entry.id === 3);
            const coreSourceAfter = core.after.cities.find((entry) => entry.id === 3);
            const coreDestBefore = core.before.cities.find((entry) => entry.id === 70);
            const coreDestAfter = core.after.cities.find((entry) => entry.id === 70);
            const referenceNationBefore = reference.before.nations.find((entry) => entry.id === 1);
            const referenceNationAfter = reference.after.nations.find((entry) => entry.id === 1);
            const coreNationBefore = core.before.nations.find((entry) => entry.id === 1);
            const coreNationAfter = core.after.nations.find((entry) => entry.id === 1);
            const referenceGeneralBefore = reference.before.generals.find((entry) => entry.id === 1);
            const referenceGeneralAfter = reference.after.generals.find((entry) => entry.id === 1);
            const coreGeneralBefore = core.before.generals.find((entry) => entry.id === 1);
            const coreGeneralAfter = core.after.generals.find((entry) => entry.id === 1);
            const develCost =
                typeof reference.before.world.develCost === 'number' ? reference.before.world.develCost : 0;
            const expectedCost = Math.round((develCost * costBasis) / 10_000);
            expect(develCost).toBe(18);

            for (const [before, after, direction] of [
                [referenceSourceBefore, referenceSourceAfter, -1],
                [referenceDestBefore, referenceDestAfter, 1],
                [coreSourceBefore, coreSourceAfter, -1],
                [coreDestBefore, coreDestAfter, 1],
            ] as const) {
                const expectedDelta = expectedMoved === 0 ? 0 : direction * expectedMoved;
                expect(readCityPopulation(after) - readCityPopulation(before)).toBe(expectedDelta);
            }
            for (const [before, after] of [
                [referenceNationBefore, referenceNationAfter],
                [coreNationBefore, coreNationAfter],
            ] as const) {
                expect(readNationResource(before, 'gold') - readNationResource(after, 'gold')).toBe(expectedCost);
                expect(readNationResource(before, 'rice') - readNationResource(after, 'rice')).toBe(expectedCost);
            }
            for (const field of ['experience', 'dedication']) {
                const expectedDelta = completed ? 5 : 0;
                expect(
                    readNumericField(referenceGeneralAfter, field) - readNumericField(referenceGeneralBefore, field)
                ).toBe(expectedDelta);
                expect(readNumericField(coreGeneralAfter, field) - readNumericField(coreGeneralBefore, field)).toBe(
                    expectedDelta
                );
            }
            if (amount === 0) {
                const zeroMoveText = '인구 <C>0</>명을 옮겼습니다.';
                expect(reference.after.logs.slice(reference.before.logs.length).map((entry) => entry.text)).toEqual(
                    expect.arrayContaining([expect.stringContaining(zeroMoveText)])
                );
                expect(core.after.logs.map((entry) => entry.text)).toEqual(
                    expect.arrayContaining([expect.stringContaining(zeroMoveText)])
                );
            }

            expect(reference.execution.outcome).toMatchObject({ completed });
            expect(core.execution.outcome).toMatchObject({
                requestedAction: 'cr_인구이동',
                actionKey: completed ? 'cr_인구이동' : '휴식',
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
