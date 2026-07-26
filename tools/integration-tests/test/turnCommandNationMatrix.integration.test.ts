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
        generalIds: [1, 2, 3],
        cityIds: [3, 70],
        nationIds: [1, 2],
        logAfterId: 0,
        messageAfterId: 0,
    },
});

const cases: Array<[string, Record<string, unknown> | undefined, FixturePatches?]> = [
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
