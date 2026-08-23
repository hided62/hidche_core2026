import { describe, expect, it } from 'vitest';

import { NATION_TURN_COMMAND_KEYS } from '@sammo-ts/logic';

import { compareTurnSnapshotDeltas } from '../src/turn-differential/compare.js';
import { runCoreTurnCommandTrace, type TurnCommandFixtureRequest } from '../src/turn-differential/coreCommandTrace.js';
import {
    normalizeStoredTurnLogText as normalizeStoredLogText,
    orderedSemanticLogStreams,
} from '../src/turn-differential/logProjection.js';
import {
    projectSemanticTurnMessages,
    projectSemanticUnreadMessageDeltas,
    projectStrictTurnMessageTimeline,
} from '../src/turn-differential/messageProjection.js';
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
const readRecord = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const readNationMeta = (row: { meta?: unknown } | undefined): Record<string, unknown> =>
    typeof row?.meta === 'object' && row.meta !== null && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : {};
const readGeneralMeta = readNationMeta;
const NPC_SEIZURE_MESSAGE_TEXT = '몰수를 하다니... 이것이 윗사람이 할 짓이란 말입니까...';

const timestampMillis = (value: unknown): number => {
    const raw = String(value);
    const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T').replace(/\.(\d{3})\d*$/, '.$1')}Z`;
    return new Date(normalized).getTime();
};

const semanticLogSignatures = (logs: Array<Record<string, unknown>>): string[] => orderedSemanticLogStreams(logs);

const nationCommandLogs = (logs: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
    logs.filter((entry) => normalizeStoredLogText(entry.text) !== '아무것도 실행하지 않았습니다.');

const ignoredLifecyclePaths = [
    /^generalTurns/,
    /^nationTurns/,
    /^logs/,
    /^messages/,
    /^world\.turnTime$/,
    /^world\.gameNow$/,
    /^generals\[[^\]]+\]\.(?:turnTime|recentWarTime|lastTurn|killTurn|mySet)(?:\.|$)/,
    /^generals\[1\]\.(?:turnTick|turnSecond|turnFraction)$/,
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

const researchConfigs: Record<
    string,
    {
        command: string;
        auxKey: string;
        preReqTurn: number;
        cost: number;
    }
> = {
    event_원융노병연구: {
        command: '원융노병 연구',
        auxKey: 'can_원융노병사용',
        preReqTurn: 23,
        cost: 100_000,
    },
    event_화시병연구: {
        command: '화시병 연구',
        auxKey: 'can_화시병사용',
        preReqTurn: 11,
        cost: 50_000,
    },
    event_음귀병연구: {
        command: '음귀병 연구',
        auxKey: 'can_음귀병사용',
        preReqTurn: 11,
        cost: 50_000,
    },
    event_대검병연구: {
        command: '대검병 연구',
        auxKey: 'can_대검병사용',
        preReqTurn: 11,
        cost: 50_000,
    },
    event_화륜차연구: {
        command: '화륜차 연구',
        auxKey: 'can_화륜차사용',
        preReqTurn: 23,
        cost: 100_000,
    },
    event_산저병연구: {
        command: '산저병 연구',
        auxKey: 'can_산저병사용',
        preReqTurn: 11,
        cost: 50_000,
    },
    event_극병연구: {
        command: '극병 연구',
        auxKey: 'can_극병사용',
        preReqTurn: 23,
        cost: 100_000,
    },
    event_상병연구: {
        command: '상병 연구',
        auxKey: 'can_상병사용',
        preReqTurn: 23,
        cost: 100_000,
    },
    event_무희연구: {
        command: '무희 연구',
        auxKey: 'can_무희사용',
        preReqTurn: 23,
        cost: 100_000,
    },
};

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
            freezeClock: true,
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
            ...Object.entries(fixturePatches.cities ?? {})
                .filter(([id]) => !['3', '70'].includes(id))
                .map(([id, patch]) => ({
                    id: Number(id),
                    nationId: 0,
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
                    ...patch,
                })),
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
            ...Object.entries(fixturePatches.diplomacy ?? {})
                .filter(([key]) => !['1:2', '2:1'].includes(key))
                .map(([key, patch]) => {
                    const [fromNationId, toNationId] = key.split(':').map(Number);
                    return {
                        fromNationId,
                        toNationId,
                        state: 3,
                        term: 0,
                        dead: 0,
                        ...patch,
                    };
                }),
        ],
        nationTurns: [
            {
                nationId: 1,
                officerLevel: 12,
                turnIndex: 1,
                action: 'che_국호변경',
                args: { nationName: '다음국' },
            },
        ],
    },
    observe: {
        allGenerals: true,
        allCities: true,
        allNations: true,
        allTroops: true,
        generalIds: [
            1,
            2,
            3,
            4,
            5,
            6,
            7,
            8,
            9,
            10,
            11,
            12,
            ...Object.keys(fixturePatches.generals ?? {})
                .map(Number)
                .filter((id) => ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(id)),
        ],
        cityIds: [
            3,
            70,
            ...Object.keys(fixturePatches.cities ?? {})
                .map(Number)
                .filter((id) => id !== 3 && id !== 70),
            ...(fixturePatches.randomFoundingCandidateCityIds ?? []).filter((id) => id !== 3 && id !== 70),
        ],
        nationIds: [1, 2],
        ...(fixturePatches.diplomacy
            ? {
                  diplomacyPairs: Object.keys(fixturePatches.diplomacy)
                      .filter((key) => !['1:2', '2:1'].includes(key))
                      .map((key) => {
                          const [fromNationId, toNationId] = key.split(':').map(Number);
                          return { fromNationId, toNationId };
                      }),
              }
            : {}),
        ...(action === 'che_백성동원' ||
        action === 'che_이호경식' ||
        action === 'che_급습' ||
        action === 'che_필사즉생' ||
        action === 'che_허보' ||
        action === 'che_의병모집' ||
        action === 'che_수몰'
            ? {
                  nationCooldowns: [
                      {
                          nationId: 1,
                          actionName:
                              action === 'che_백성동원'
                                  ? '백성동원'
                                  : action === 'che_이호경식'
                                    ? '이호경식'
                                    : action === 'che_급습'
                                      ? '급습'
                                      : action === 'che_필사즉생'
                                        ? '필사즉생'
                                        : action === 'che_허보'
                                          ? '허보'
                                          : action === 'che_의병모집'
                                            ? '의병모집'
                                            : '수몰',
                      },
                  ],
              }
            : {}),
        logAfterId: 0,
        includeNationHistoryLogs: true,
        includeGlobalHistoryLogs: true,
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

describe('nation command differential coverage manifest', () => {
    it('keeps one successful Ref/Core case for every registered nation turn command', () => {
        const matrixActions = cases.map(([action]) => action);

        expect(new Set(matrixActions).size).toBe(matrixActions.length);
        expect([...matrixActions].sort()).toEqual([...NATION_TURN_COMMAND_KEYS].sort());
    });
});

integration('nation command success matrix', () => {
    it.each(cases)(
        '%s matches the legacy state delta and command RNG',
        async (action, args, fixturePatches) => {
            const request = buildRequest(action, args, fixturePatches);
            request.includeLifecycle = true;
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

            const actorGeneralId = request.actorGeneralId;
            const actorNationId = 1;
            const actorOfficerLevel = 12;
            const referenceBeforeActor = reference.before.generals.find((general) => general.id === actorGeneralId);
            const referenceAfterActor = reference.after.generals.find((general) => general.id === actorGeneralId);
            const coreBeforeActor = core.before.generals.find((general) => general.id === actorGeneralId);
            const coreAfterActor = core.after.generals.find((general) => general.id === actorGeneralId);
            const expectedTurnMinutes = Number(reference.before.world.tickMinutes);
            const findActorNationTurn = (turns: Array<Record<string, unknown>>, turnIndex: number) =>
                turns.find(
                    (turn) =>
                        turn.nationId === actorNationId &&
                        turn.officerLevel === actorOfficerLevel &&
                        turn.turnIndex === turnIndex
                );

            expect(findActorNationTurn(reference.before.nationTurns, 0)?.action).toBe(action);
            expect(findActorNationTurn(core.before.nationTurns, 0)?.action).toBe(action);
            expect(findActorNationTurn(reference.after.nationTurns, 0)).toMatchObject({
                action: 'che_국호변경',
                args: { nationName: '다음국' },
            });
            expect(findActorNationTurn(core.after.nationTurns, 0)).toMatchObject({
                action: 'che_국호변경',
                args: { nationName: '다음국' },
            });
            expect(
                timestampMillis(referenceAfterActor?.turnTime) - timestampMillis(referenceBeforeActor?.turnTime)
            ).toBe(expectedTurnMinutes * 60_000);
            expect(timestampMillis(coreAfterActor?.turnTime) - timestampMillis(coreBeforeActor?.turnTime)).toBe(
                expectedTurnMinutes * 60_000
            );
            expect(timestampMillis(coreAfterActor?.turnTime)).toBe(timestampMillis(referenceAfterActor?.turnTime));
            expect(referenceAfterActor?.mySet).toBe(Math.min(9, Number(referenceBeforeActor?.mySet) + 3));
            expect(coreAfterActor?.mySet).toBe(referenceAfterActor?.mySet);
            expect(
                compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                    ignoredPathPatterns: ignoredLifecyclePaths,
                })
            ).toEqual([]);

            // Ref persists logs in two independent ID streams and messages in
            // per-mailbox rows, so they are excluded from the state comparator.
            // Compare those observable graphs for every registered command.
            expect(semanticLogSignatures(nationCommandLogs(addedReferenceLogs(core.before, core.after.logs)))).toEqual(
                semanticLogSignatures(nationCommandLogs(addedReferenceLogs(reference.before, reference.after.logs)))
            );
            const messageAfterId = reference.before.watermarks.messageId;
            const coreTimeline = projectStrictTurnMessageTimeline(core.before, core.after, messageAfterId);
            const referenceTimeline = projectStrictTurnMessageTimeline(
                reference.before,
                reference.after,
                messageAfterId
            );
            expect({
                unreadDeltas: projectSemanticUnreadMessageDeltas(core.before, core.after),
                messages: projectSemanticTurnMessages(core.after.messages, messageAfterId),
                timeline: coreTimeline,
            }).toEqual({
                unreadDeltas: projectSemanticUnreadMessageDeltas(reference.before, reference.after),
                messages: projectSemanticTurnMessages(reference.after.messages, messageAfterId),
                timeline: referenceTimeline,
            });
            expect(referenceTimeline.usesSingleTick).toBe(true);
            const researchConfig = researchConfigs[action];
            if (researchConfig) {
                for (const snapshot of [reference, core]) {
                    const nationBefore = snapshot.before.nations.find((entry) => entry.id === 1);
                    const nationAfter = snapshot.after.nations.find((entry) => entry.id === 1);
                    const generalBefore = snapshot.before.generals.find((entry) => entry.id === 1);
                    const generalAfter = snapshot.after.generals.find((entry) => entry.id === 1);
                    const expectedProgress = 5 * (researchConfig.preReqTurn + 1);

                    expect(readNationResource(nationBefore, 'gold') - readNationResource(nationAfter, 'gold')).toBe(
                        researchConfig.cost
                    );
                    expect(readNationResource(nationBefore, 'rice') - readNationResource(nationAfter, 'rice')).toBe(
                        researchConfig.cost
                    );
                    expect(
                        readNumericField(generalAfter, 'experience') - readNumericField(generalBefore, 'experience')
                    ).toBe(expectedProgress);
                    expect(
                        readNumericField(generalAfter, 'dedication') - readNumericField(generalBefore, 'dedication')
                    ).toBe(expectedProgress);
                    expect(readNumericField(readNationMeta(nationAfter), researchConfig.auxKey)).toBe(1);
                    expect(snapshot.rng).toEqual([]);
                }
            }
        },
        120_000
    );
});

integration('legacy nation lifecycle comparison guard', () => {
    it('does not alter command effects or RNG beyond the explicit queue and turn lifecycle', () => {
        const request = buildRequest('che_포상', { isGold: true, amount: 100, destGeneralID: 3 });
        const commandOnly = runReferenceTurnCommandTraceRequest(
            workspaceRoot!,
            request as unknown as Record<string, unknown>
        );
        const withLifecycle = runReferenceTurnCommandTraceRequest(workspaceRoot!, {
            ...request,
            includeLifecycle: true,
        } as unknown as Record<string, unknown>);

        expect(withLifecycle.rng).toEqual(commandOnly.rng);
        expect(
            compareTurnSnapshotDeltas(
                commandOnly.before,
                commandOnly.after,
                withLifecycle.before,
                withLifecycle.after,
                { ignoredPathPatterns: ignoredLifecyclePaths }
            )
        ).toEqual([]);
    }, 180_000);
});

type NationActiveActionInheritanceCase = {
    name: string;
    request: NationMatrixCase;
    expectedPointDelta: number;
};

const nationActiveActionInheritanceCases: NationActiveActionInheritanceCase[] = [
    {
        name: 'ordinary award does not count as a legacy active action',
        request: ['che_포상', { isGold: true, amount: 100, destGeneralID: 3 }],
        expectedPointDelta: 0,
    },
    {
        name: 'nation rename contributes one active action',
        request: ['che_국호변경', { nationName: '능동아국' }],
        expectedPointDelta: 3,
    },
    {
        name: 'event research contributes one active action on completion',
        request: researchCase('event_화시병연구', '화시병 연구', 11),
        expectedPointDelta: 3,
    },
    {
        name: 'nation rest does not count as a legacy active action',
        request: ['휴식', undefined],
        expectedPointDelta: 0,
    },
];

const readNationActorActiveActionPoints = (
    snapshot: { generals: Array<Record<string, unknown>> },
    generalId: number
): number => {
    const general = snapshot.generals.find((entry) => entry.id === generalId);
    const value = general?.inheritActiveActionPoints;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

integration('nation active-action inheritance point parity', () => {
    it.each(nationActiveActionInheritanceCases)(
        '$name',
        async ({ name, request: [action, args, fixturePatches], expectedPointDelta }) => {
            const request = buildRequest(action, args, fixturePatches);
            request.setup!.world!.hiddenSeed = `nation-active-action-${name}`;
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);
            const referencePointDelta =
                readNationActorActiveActionPoints(reference.after, 1) -
                readNationActorActiveActionPoints(reference.before, 1);
            const corePointDelta =
                readNationActorActiveActionPoints(core.after, 1) - readNationActorActiveActionPoints(core.before, 1);

            expect(reference.execution.outcome).toMatchObject({ completed: true });
            expect(core.execution.outcome).toMatchObject({
                requestedAction: action,
                actionKey: action,
                usedFallback: false,
            });
            expect(referencePointDelta).toBe(expectedPointDelta);
            expect(corePointDelta).toBe(referencePointDelta);
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

const nationNameBoundaryCases: Array<{
    name: string;
    nationName: string;
    completed: boolean;
    duplicate?: boolean;
}> = [
    { name: 'accepts nine full-width characters at width eighteen', nationName: '가나다라마바사아자', completed: true },
    { name: 'accepts eighteen half-width characters', nationName: '123456789012345678', completed: true },
    { name: 'preserves surrounding spaces', nationName: ' 신국 ', completed: true },
    { name: 'accepts a single space', nationName: ' ', completed: true },
    { name: 'rejects ten full-width characters at width twenty', nationName: '가나다라마바사아자차', completed: false },
    { name: 'rejects nineteen half-width characters', nationName: '1234567890123456789', completed: false },
    { name: 'rejects another nation duplicate', nationName: '타국', completed: false, duplicate: true },
    { name: 'rejects the current nation duplicate', nationName: '아국', completed: false, duplicate: true },
];

const nationColors = [
    '#FF0000',
    '#800000',
    '#A0522D',
    '#FF6347',
    '#FFA500',
    '#FFDAB9',
    '#FFD700',
    '#FFFF00',
    '#7CFC00',
    '#00FF00',
    '#808000',
    '#008000',
    '#2E8B57',
    '#008080',
    '#20B2AA',
    '#6495ED',
    '#7FFFD4',
    '#AFEEEE',
    '#87CEEB',
    '#00FFFF',
    '#00BFFF',
    '#0000FF',
    '#000080',
    '#483D8B',
    '#7B68EE',
    '#BA55D3',
    '#800080',
    '#FF00FF',
    '#FFC0CB',
    '#F5F5DC',
    '#E0FFFF',
    '#FFFFFF',
    '#A9A9A9',
] as const;

const nationFlagBoundaryCases: Array<{
    name: string;
    colorType: unknown;
    completed: boolean;
    expectedIndex?: number;
}> = [
    { name: 'accepts integer zero', colorType: 0, completed: true, expectedIndex: 0 },
    { name: 'accepts an integer numeric string', colorType: '1', completed: true, expectedIndex: 1 },
    { name: 'accepts boolean true as key one', colorType: true, completed: true, expectedIndex: 1 },
    { name: 'accepts boolean false as key zero', colorType: false, completed: true, expectedIndex: 0 },
    { name: 'truncates a positive fractional key', colorType: 1.9, completed: true, expectedIndex: 1 },
    { name: 'truncates a negative fraction to zero', colorType: -0.9, completed: true, expectedIndex: 0 },
    { name: 'accepts the upper fractional key', colorType: 32.9, completed: true, expectedIndex: 32 },
    { name: 'rejects a leading-zero numeric string', colorType: '01', completed: false },
    { name: 'rejects a fractional numeric string', colorType: '1.5', completed: false },
    { name: 'rejects the first out-of-range integer', colorType: 33, completed: false },
    { name: 'rejects a negative integer', colorType: -1, completed: false },
    { name: 'rejects null', colorType: null, completed: false },
];

const addedReferenceLogs = (
    before: { watermarks: { logId: number; historyLogId: number } },
    afterLogs: Array<Record<string, unknown>>
): Array<Record<string, unknown>> =>
    afterLogs.filter((entry) => {
        const scope = String(entry.scope).toLowerCase();
        const category = String(entry.category).toLowerCase();
        const watermark =
            scope === 'nation' || (scope === 'system' && category === 'history')
                ? before.watermarks.historyLogId
                : before.watermarks.logId;
        return (Number(entry.id) || 0) > watermark;
    });

integration('nation name boundary parity', () => {
    it.each(nationNameBoundaryCases)(
        '$name',
        async ({ nationName, completed, duplicate }) => {
            const request = buildRequest('che_국호변경', { nationName });
            request.observe!.includeNationHistoryLogs = true;
            request.observe!.includeGlobalHistoryLogs = true;
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);

            expect(reference.execution.outcome).toMatchObject({ completed });
            if (duplicate) {
                expect(core.execution.outcome).toMatchObject({
                    requestedAction: 'che_국호변경',
                    actionKey: 'che_국호변경',
                    usedFallback: false,
                    completed: false,
                });
            } else {
                expect(core.execution.outcome).toMatchObject({
                    requestedAction: 'che_국호변경',
                    actionKey: completed ? 'che_국호변경' : '휴식',
                    usedFallback: !completed,
                });
            }
            expect(core.rng).toEqual(reference.rng);
            expect(
                compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                    ignoredPathPatterns: ignoredLifecyclePaths,
                })
            ).toEqual([]);
            if (completed) {
                expect(readNationMeta(core.after.nations.find((entry) => entry.id === 1)).turn_last_12).toEqual(
                    readRecord(reference.execution.outcome).lastTurn
                );
                expect(core.after.nations.find((entry) => entry.id === 1)?.name).toBe(nationName);
                expect(semanticLogSignatures(nationCommandLogs(core.after.logs))).toEqual(
                    semanticLogSignatures(addedReferenceLogs(reference.before, reference.after.logs))
                );
            }
        },
        120_000
    );
});

integration('nation flag boundary parity', () => {
    it.each(nationFlagBoundaryCases)(
        '$name',
        async ({ colorType, completed, expectedIndex }) => {
            const request = buildRequest('che_국기변경', { colorType });
            request.observe!.includeNationHistoryLogs = true;
            request.observe!.includeGlobalHistoryLogs = true;
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);

            expect(reference.execution.outcome).toMatchObject({ completed });
            expect(core.execution.outcome).toMatchObject({
                requestedAction: 'che_국기변경',
                actionKey: completed ? 'che_국기변경' : '휴식',
                usedFallback: !completed,
            });
            expect(core.rng).toEqual(reference.rng);
            expect(
                compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                    ignoredPathPatterns: ignoredLifecyclePaths,
                })
            ).toEqual([]);
            if (completed) {
                expect(readNationMeta(core.after.nations.find((entry) => entry.id === 1)).turn_last_12).toEqual(
                    readRecord(reference.execution.outcome).lastTurn
                );
                expect(core.after.nations.find((entry) => entry.id === 1)?.color).toBe(nationColors[expectedIndex!]);
                expect(semanticLogSignatures(nationCommandLogs(core.after.logs))).toEqual(
                    semanticLogSignatures(addedReferenceLogs(reference.before, reference.after.logs))
                );
            }
        },
        120_000
    );
});

type DiplomacyProposalAction = 'che_선전포고' | 'che_불가침제의' | 'che_종전제의' | 'che_불가침파기제의';

interface DiplomacyProposalBoundaryCase {
    name: string;
    action: DiplomacyProposalAction;
    args?: Record<string, unknown>;
    fixturePatches?: FixturePatches;
    completed: boolean;
}

const diplomacyProposalBoundaryCases: DiplomacyProposalBoundaryCase[] = [
    ...(['che_선전포고', 'che_불가침제의', 'che_종전제의', 'che_불가침파기제의'] as const).flatMap((action) => [
        {
            name: `${action} rejects a numeric-string destination`,
            action,
            args: action === 'che_불가침제의' ? { destNationID: '2', year: 190, month: 7 } : { destNationID: '2' },
            completed: false,
        },
        {
            name: `${action} rejects a fractional destination instead of truncating it`,
            action,
            args: action === 'che_불가침제의' ? { destNationID: 2.9, year: 190, month: 7 } : { destNationID: 2.9 },
            completed: false,
        },
        {
            name: `${action} rejects a missing destination nation`,
            action,
            args: action === 'che_불가침제의' ? { destNationID: 9, year: 190, month: 7 } : { destNationID: 9 },
            completed: false,
        },
        {
            name: `${action} rejects a neutral actor`,
            action,
            args: action === 'che_불가침제의' ? { destNationID: 2, year: 190, month: 7 } : { destNationID: 2 },
            fixturePatches: {
                generals: { 1: { nationId: 0 } },
                cities: { 3: { nationId: 0 } },
            },
            completed: false,
        },
        {
            name: `${action} rejects an actor below chief`,
            action,
            args: action === 'che_불가침제의' ? { destNationID: 2, year: 190, month: 7 } : { destNationID: 2 },
            fixturePatches: { generals: { 1: { officerLevel: 4 } } },
            completed: false,
        },
    ]),
    {
        name: 'declare-war rejects the opening year',
        action: 'che_선전포고',
        args: { destNationID: 2 },
        fixturePatches: { world: { year: 180 } },
        completed: false,
    },
    {
        name: 'declare-war accepts the exact start-year plus one boundary',
        action: 'che_선전포고',
        args: { destNationID: 2 },
        fixturePatches: { world: { year: 181 } },
        completed: true,
    },
    {
        name: 'declare-war rejects an actor city occupied by another nation',
        action: 'che_선전포고',
        args: { destNationID: 2 },
        fixturePatches: { cities: { 3: { nationId: 2 } } },
        completed: false,
    },
    {
        name: 'declare-war rejects an unsupplied actor city',
        action: 'che_선전포고',
        args: { destNationID: 2 },
        fixturePatches: { cities: { 3: { supplyState: 0 } } },
        completed: false,
    },
    {
        name: 'declare-war rejects forward war state',
        action: 'che_선전포고',
        args: { destNationID: 2 },
        fixturePatches: { diplomacy: { '1:2': { state: 0 }, '2:1': { state: 3 } } },
        completed: false,
    },
    {
        name: 'declare-war ignores the reverse diplomacy state',
        action: 'che_선전포고',
        args: { destNationID: 2 },
        fixturePatches: { diplomacy: { '1:2': { state: 3 }, '2:1': { state: 0 } } },
        completed: true,
    },
    {
        name: 'non-aggression rejects a fractional year',
        action: 'che_불가침제의',
        args: { destNationID: 2, year: 190.9, month: 7 },
        completed: false,
    },
    {
        name: 'non-aggression rejects a fractional month',
        action: 'che_불가침제의',
        args: { destNationID: 2, year: 190, month: 7.9 },
        completed: false,
    },
    {
        name: 'non-aggression rejects a year before the scenario start even when six months ahead',
        action: 'che_불가침제의',
        args: { destNationID: 2, year: 179, month: 7 },
        fixturePatches: { world: { year: 179, month: 1 } },
        completed: false,
    },
    {
        name: 'non-aggression rejects five months ahead',
        action: 'che_불가침제의',
        args: { destNationID: 2, year: 190, month: 6 },
        completed: false,
    },
    {
        name: 'non-aggression accepts exactly six months ahead without city ownership or supply',
        action: 'che_불가침제의',
        args: { destNationID: 2, year: 190, month: 7 },
        fixturePatches: {
            nations: { 1: { name: '위' }, 2: { name: '탑' } },
            cities: { 3: { nationId: 2, supplyState: 0 } },
        },
        completed: true,
    },
    {
        name: 'non-aggression rejects a forward war state',
        action: 'che_불가침제의',
        args: { destNationID: 2, year: 190, month: 7 },
        fixturePatches: { diplomacy: { '1:2': { state: 0 }, '2:1': { state: 3 } } },
        completed: false,
    },
    {
        name: 'non-aggression ignores the reverse war state',
        action: 'che_불가침제의',
        args: { destNationID: 2, year: 190, month: 7 },
        fixturePatches: { diplomacy: { '1:2': { state: 3 }, '2:1': { state: 0 } } },
        completed: true,
    },
    {
        name: 'stop-war accepts forward declaration state zero',
        action: 'che_종전제의',
        args: { destNationID: 2 },
        fixturePatches: { diplomacy: { '1:2': { state: 0 }, '2:1': { state: 3 } } },
        completed: true,
    },
    {
        name: 'stop-war accepts forward war state one',
        action: 'che_종전제의',
        args: { destNationID: 2 },
        fixturePatches: { diplomacy: { '1:2': { state: 1 }, '2:1': { state: 3 } } },
        completed: true,
    },
    {
        name: 'stop-war rejects an unrelated forward state',
        action: 'che_종전제의',
        args: { destNationID: 2 },
        completed: false,
    },
    {
        name: 'stop-war rejects an unsupplied actor city',
        action: 'che_종전제의',
        args: { destNationID: 2 },
        fixturePatches: { cities: { 3: { supplyState: 0 } }, diplomacy: { '1:2': { state: 0 } } },
        completed: false,
    },
    {
        name: 'non-aggression cancellation accepts forward state seven',
        action: 'che_불가침파기제의',
        args: { destNationID: 2 },
        fixturePatches: { diplomacy: { '1:2': { state: 7 }, '2:1': { state: 3 } } },
        completed: true,
    },
    {
        name: 'non-aggression cancellation rejects an unrelated forward state',
        action: 'che_불가침파기제의',
        args: { destNationID: 2 },
        completed: false,
    },
    {
        name: 'non-aggression cancellation ignores a reverse-only state seven',
        action: 'che_불가침파기제의',
        args: { destNationID: 2 },
        fixturePatches: { diplomacy: { '1:2': { state: 3 }, '2:1': { state: 7 } } },
        completed: false,
    },
];

const expectedDiplomacyMessage = (
    action: DiplomacyProposalAction,
    sourceName: string,
    destinationName: string,
    year: number,
    month: number
): { type: 'national' | 'diplomacy'; text: string; option: Record<string, unknown> } => {
    switch (action) {
        case 'che_선전포고':
            return {
                type: 'national',
                text: `【외교】${year}년 ${month}월:${sourceName}에서 ${destinationName}에 선전포고`,
                option: {},
            };
        case 'che_불가침제의':
            return {
                type: 'diplomacy',
                text: `${sourceName}${sourceName === '위' ? '와' : '과'} ${year}년 ${month + 6}월까지 불가침 제의 서신`,
                option: { action: 'noAggression', year, month: month + 6 },
            };
        case 'che_종전제의':
            return {
                type: 'diplomacy',
                text: `${sourceName}의 종전 제의 서신`,
                option: { action: 'stopWar', deletable: false },
            };
        case 'che_불가침파기제의':
            return {
                type: 'diplomacy',
                text: `${sourceName}의 불가침 파기 제의 서신`,
                option: { action: 'cancelNA', deletable: false },
            };
    }
};

integration('nation diplomacy proposal boundary and message parity', () => {
    it.each(diplomacyProposalBoundaryCases)(
        '$name',
        async ({ action, args, fixturePatches, completed }) => {
            const request = buildRequest(action, args, fixturePatches);
            request.observe!.includeNationHistoryLogs = true;
            request.observe!.includeGlobalHistoryLogs = true;
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);

            expect(reference.execution.outcome).toMatchObject({ completed });
            if (
                fixturePatches?.generals?.[1]?.nationId === 0 ||
                (typeof fixturePatches?.generals?.[1]?.officerLevel === 'number' &&
                    fixturePatches.generals[1].officerLevel < 5)
            ) {
                expect(core.execution.outcome).toBeUndefined();
            } else {
                expect(core.execution.outcome).toMatchObject({
                    requestedAction: action,
                    actionKey: completed ? action : '휴식',
                    usedFallback: !completed,
                });
            }
            expect(core.rng).toEqual(reference.rng);
            expect(
                compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                    ignoredPathPatterns: ignoredLifecyclePaths,
                })
            ).toEqual([]);

            const messageAfterId = reference.before.watermarks.messageId;
            const coreTimeline = projectStrictTurnMessageTimeline(core.before, core.after, messageAfterId);
            const referenceTimeline = projectStrictTurnMessageTimeline(
                reference.before,
                reference.after,
                messageAfterId
            );
            expect({
                unreadDeltas: projectSemanticUnreadMessageDeltas(core.before, core.after),
                messages: projectSemanticTurnMessages(core.after.messages, messageAfterId),
                timeline: coreTimeline,
            }).toEqual({
                unreadDeltas: projectSemanticUnreadMessageDeltas(reference.before, reference.after),
                messages: projectSemanticTurnMessages(reference.after.messages, messageAfterId),
                timeline: referenceTimeline,
            });
            expect(referenceTimeline.usesSingleTick).toBe(true);

            const referenceMessages = reference.after.messages.slice(reference.before.messages.length);
            if (!completed) {
                expect(referenceMessages).toEqual([]);
                expect(core.after.messages).toEqual([]);
                return;
            }

            const sourceNation = reference.after.nations.find((entry) => entry.id === 1);
            const destinationNation = reference.after.nations.find((entry) => entry.id === 2);
            const expected = expectedDiplomacyMessage(
                action,
                String(sourceNation?.name),
                String(destinationNation?.name),
                Number(reference.after.world.year),
                Number(reference.after.world.month)
            );
            expect(referenceMessages).toHaveLength(2);
            expect(referenceMessages.find((entry) => entry.mailbox === 9002)).toMatchObject({
                type: expected.type,
                sourceId: 9001,
                destinationId: 9002,
                payload: {
                    src: { nation_id: 1, nation: sourceNation?.name },
                    dest: { nation_id: 2, nation: destinationNation?.name },
                    text: expected.text,
                    option: expected.option,
                },
            });
            expect(core.after.messages).toHaveLength(2);
            expect(core.after.messages.find((entry) => entry.mailbox === 9002)).toMatchObject({
                type: expected.type,
                sourceId: 9001,
                destinationId: 9002,
                payload: {
                    src: { nationId: 1, nationName: sourceNation?.name },
                    dest: { nationId: 2, nationName: destinationNation?.name },
                    text: expected.text,
                    option: expected.option,
                },
            });
            expect(semanticLogSignatures(nationCommandLogs(core.after.logs))).toEqual(
                semanticLogSignatures(addedReferenceLogs(reference.before, reference.after.logs))
            );
        },
        120_000
    );
});

interface PersonnelCommandBoundaryCase {
    name: string;
    action: 'che_부대탈퇴지시' | 'che_발령';
    args: Record<string, unknown>;
    fixturePatches?: FixturePatches;
    completed: boolean;
    expectedTroopId?: number;
    expectedCityId?: number;
}

const personnelCommandBoundaryCases: PersonnelCommandBoundaryCase[] = [
    {
        name: 'troop-kick rejects a numeric-string target',
        action: 'che_부대탈퇴지시',
        args: { destGeneralID: '3' },
        completed: false,
    },
    {
        name: 'troop-kick rejects a fractional target instead of truncating it',
        action: 'che_부대탈퇴지시',
        args: { destGeneralID: 3.9 },
        completed: false,
    },
    {
        name: 'troop-kick rejects self',
        action: 'che_부대탈퇴지시',
        args: { destGeneralID: 1 },
        completed: false,
    },
    {
        name: 'troop-kick rejects a missing target',
        action: 'che_부대탈퇴지시',
        args: { destGeneralID: 9 },
        completed: false,
    },
    {
        name: 'troop-kick rejects a foreign target',
        action: 'che_부대탈퇴지시',
        args: { destGeneralID: 2 },
        completed: false,
    },
    {
        name: 'troop-kick completes without mutation for a non-member',
        action: 'che_부대탈퇴지시',
        args: { destGeneralID: 3 },
        completed: true,
        expectedTroopId: 0,
    },
    {
        name: 'troop-kick completes without mutation for a troop leader',
        action: 'che_부대탈퇴지시',
        args: { destGeneralID: 3 },
        fixturePatches: { generals: { 3: { troopId: 3 } } },
        completed: true,
        expectedTroopId: 3,
    },
    {
        name: 'troop-kick removes a regular troop member',
        action: 'che_부대탈퇴지시',
        args: { destGeneralID: 3 },
        fixturePatches: { generals: { 3: { troopId: 1 } } },
        completed: true,
        expectedTroopId: 0,
    },
    {
        name: 'assignment accepts numeric-string IDs through PHP weak int coercion',
        action: 'che_발령',
        args: { destGeneralID: '3', destCityID: '70' },
        fixturePatches: { cities: { 70: { nationId: 1 } } },
        completed: true,
        expectedCityId: 70,
    },
    {
        name: 'assignment truncates fractional IDs through PHP weak int coercion',
        action: 'che_발령',
        args: { destGeneralID: 3.9, destCityID: 70.9 },
        fixturePatches: { cities: { 70: { nationId: 1 } } },
        completed: true,
        expectedCityId: 70,
    },
    {
        name: 'assignment rejects self',
        action: 'che_발령',
        args: { destGeneralID: 1, destCityID: 70 },
        fixturePatches: { cities: { 70: { nationId: 1 } } },
        completed: false,
    },
    {
        name: 'assignment rejects a missing target general at execution time',
        action: 'che_발령',
        args: { destGeneralID: 9, destCityID: 70 },
        fixturePatches: { cities: { 70: { nationId: 1 } } },
        completed: false,
    },
    {
        name: 'assignment rejects a foreign target general',
        action: 'che_발령',
        args: { destGeneralID: 2, destCityID: 70 },
        fixturePatches: { cities: { 70: { nationId: 1 } } },
        completed: false,
    },
    {
        name: 'assignment rejects an actor city occupied by another nation',
        action: 'che_발령',
        args: { destGeneralID: 3, destCityID: 70 },
        fixturePatches: { cities: { 3: { nationId: 2 }, 70: { nationId: 1 } } },
        completed: false,
    },
    {
        name: 'assignment rejects an unsupplied actor city',
        action: 'che_발령',
        args: { destGeneralID: 3, destCityID: 70 },
        fixturePatches: { cities: { 3: { supplyState: 0 }, 70: { nationId: 1 } } },
        completed: false,
    },
    {
        name: 'assignment rejects a destination city occupied by another nation',
        action: 'che_발령',
        args: { destGeneralID: 3, destCityID: 70 },
        completed: false,
    },
    {
        name: 'assignment rejects an unsupplied destination city',
        action: 'che_발령',
        args: { destGeneralID: 3, destCityID: 70 },
        fixturePatches: { cities: { 70: { nationId: 1, supplyState: 0 } } },
        completed: false,
    },
    {
        name: 'assignment moves a friendly target and records the assignment month',
        action: 'che_발령',
        args: { destGeneralID: 3, destCityID: 70 },
        fixturePatches: { cities: { 70: { nationId: 1 } } },
        completed: true,
        expectedCityId: 70,
    },
];

integration('nation personnel command boundary parity', () => {
    it.each(personnelCommandBoundaryCases)(
        '$name',
        async ({ action, args, fixturePatches, completed, expectedTroopId, expectedCityId }) => {
            const request = buildRequest(action, args, fixturePatches);
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);

            expect(reference.execution.outcome).toMatchObject({ completed });
            const originalCommandFailure = args.destGeneralID === 1;
            expect(core.execution.outcome).toMatchObject({
                requestedAction: action,
                actionKey: completed || originalCommandFailure ? action : '휴식',
                usedFallback: !completed && !originalCommandFailure,
            });
            expect(core.rng).toEqual(reference.rng);
            expect(
                compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                    ignoredPathPatterns: ignoredLifecyclePaths,
                })
            ).toEqual([]);
            if (!completed) {
                if (originalCommandFailure || (action === 'che_발령' && args.destGeneralID !== 9)) {
                    expect(semanticLogSignatures(nationCommandLogs(core.after.logs))).toEqual(
                        semanticLogSignatures(addedReferenceLogs(reference.before, reference.after.logs))
                    );
                }
                return;
            }

            const referenceTarget = reference.after.generals.find((entry) => entry.id === 3);
            const coreTarget = core.after.generals.find((entry) => entry.id === 3);
            if (expectedTroopId !== undefined) {
                expect(referenceTarget?.troopId).toBe(expectedTroopId);
                expect(coreTarget?.troopId).toBe(expectedTroopId);
            }
            if (expectedCityId !== undefined) {
                expect(referenceTarget?.cityId).toBe(expectedCityId);
                expect(coreTarget?.cityId).toBe(expectedCityId);
                expect(readGeneralMeta(coreTarget).last발령).toBe(readGeneralMeta(referenceTarget).last발령);
            }
            expect(semanticLogSignatures(nationCommandLogs(core.after.logs))).toEqual(
                semanticLogSignatures(addedReferenceLogs(reference.before, reference.after.logs))
            );
        },
        120_000
    );
});

const scenario911AssignmentCases: Array<{
    name: string;
    targetTroopId: number;
    expectedActorCityId: number;
    expectedMemberCityId: number;
}> = [
    {
        name: 'gathers remote members when the assigned general is their troop leader',
        targetTroopId: 3,
        expectedActorCityId: 70,
        expectedMemberCityId: 70,
    },
    {
        name: 'does not gather members when the assigned general is not their troop leader',
        targetTroopId: 1,
        expectedActorCityId: 3,
        expectedMemberCityId: 3,
    },
];

integration('scenario 911 assignment troop gather parity', () => {
    it.each(scenario911AssignmentCases)(
        '$name',
        async ({ targetTroopId, expectedActorCityId, expectedMemberCityId }) => {
            const request = buildRequest(
                'che_발령',
                { destGeneralID: 3, destCityID: 70 },
                {
                    world: {
                        staticEventHandlers: {
                            'sammo\\Command\\Nation\\che_발령': ['event_부대발령즉시집합'],
                        },
                    },
                    cities: { 70: { nationId: 1 } },
                    generals: {
                        1: { troopId: 3 },
                        3: { troopId: targetTroopId },
                        4: { nationId: 1, cityId: 3, troopId: 3 },
                        5: { nationId: 1, cityId: 70, troopId: 3 },
                        6: { nationId: 1, cityId: 3, troopId: 6 },
                    },
                    troops: [
                        { id: 1, nationId: 1, name: '선봉대' },
                        { id: 3, nationId: 1, name: '백마대' },
                        { id: 6, nationId: 1, name: '별동대' },
                    ],
                }
            );
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);

            expect(reference.execution.outcome).toMatchObject({ completed: true });
            expect(core.execution.outcome).toMatchObject({
                requestedAction: 'che_발령',
                actionKey: 'che_발령',
                usedFallback: false,
            });
            expect(core.rng).toEqual(reference.rng);
            expect(
                compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                    ignoredPathPatterns: ignoredLifecyclePaths,
                })
            ).toEqual([]);

            for (const [generalId, expectedCityId] of [
                [1, expectedActorCityId],
                [3, 70],
                [4, expectedMemberCityId],
                [5, 70],
                [6, 3],
            ] as const) {
                expect(reference.after.generals.find((entry) => entry.id === generalId)?.cityId).toBe(expectedCityId);
                expect(core.after.generals.find((entry) => entry.id === generalId)?.cityId).toBe(expectedCityId);
            }
            expect(semanticLogSignatures(nationCommandLogs(core.after.logs))).toEqual(
                semanticLogSignatures(addedReferenceLogs(reference.before, reference.after.logs))
            );
        },
        120_000
    );
});

type VolunteerRecruitOutcome = 'fallback' | 'intermediate' | 'completed';

const volunteerRecruitBoundaryCases: Array<{
    name: string;
    fixturePatches?: FixturePatches;
    outcome: VolunteerRecruitOutcome;
    coreResolution?: boolean;
    expectedCreateCount?: number;
    expectedPostReqTurn?: number;
    expectedStrategicCommandLimit?: number;
    expectedAverageExperience?: number;
}> = [
    {
        name: 'rejects a neutral actor',
        fixturePatches: {
            generals: { 1: { nationId: 0 } },
            cities: { 3: { nationId: 0 } },
        },
        outcome: 'fallback',
        coreResolution: false,
    },
    {
        name: 'rejects an actor city occupied by another nation',
        fixturePatches: { cities: { 3: { nationId: 2 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects an actor below chief rank',
        fixturePatches: { generals: { 1: { officerLevel: 4, officerCityId: 0 } } },
        outcome: 'fallback',
        coreResolution: false,
    },
    {
        name: 'rejects a remaining strategic-command delay',
        fixturePatches: { nations: { 1: { strategicCommandLimit: 1 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects the turn before the three-year opening boundary',
        fixturePatches: { world: { year: 182 } },
        outcome: 'fallback',
    },
    {
        name: 'accepts the exact three-year opening boundary',
        fixturePatches: { world: { year: 183 } },
        outcome: 'intermediate',
    },
    {
        name: 'allows an unsupplied actor city',
        fixturePatches: { cities: { 3: { supplyState: 0 } } },
        outcome: 'intermediate',
    },
    {
        name: 'starts at term one',
        outcome: 'intermediate',
    },
    {
        name: 'advances the prior first term to term two',
        fixturePatches: {
            nations: {
                1: {
                    turnLastByOfficerLevel: {
                        12: { command: '의병모집', term: 1 },
                    },
                },
            },
        },
        outcome: 'intermediate',
    },
    {
        name: 'restarts at term one after another command interrupted the stack',
        fixturePatches: {
            nations: {
                1: {
                    turnLastByOfficerLevel: {
                        12: { command: '필사즉생', arg: {}, term: 2 },
                    },
                },
            },
        },
        outcome: 'intermediate',
    },
    {
        name: 'creates three default volunteer generals',
        outcome: 'completed',
        expectedCreateCount: 3,
        expectedPostReqTurn: 98,
    },
    {
        name: 'applies the strategist command and global-delay modifiers',
        fixturePatches: { nations: { 1: { typeCode: 'che_종횡가' } } },
        outcome: 'completed',
        expectedCreateCount: 3,
        expectedPostReqTurn: 73,
        expectedStrategicCommandLimit: 5,
    },
    {
        name: 'uses stored eleven-general count for the nation cooldown',
        fixturePatches: { nations: { 1: { generalCount: 11 } } },
        outcome: 'completed',
        expectedCreateCount: 4,
        expectedPostReqTurn: 103,
    },
    {
        name: 'rounds the active nations stored average at the four-general creation boundary',
        fixturePatches: {
            nations: {
                1: { generalCount: 4 },
                2: { generalCount: 4 },
            },
        },
        outcome: 'completed',
        expectedCreateCount: 4,
        expectedPostReqTurn: 98,
    },
    {
        name: 'excludes a level-zero nation from the stored average',
        fixturePatches: {
            nations: {
                1: { generalCount: 4 },
                2: { generalCount: 100, level: 0 },
            },
        },
        outcome: 'completed',
        expectedCreateCount: 4,
        expectedPostReqTurn: 98,
    },
    {
        name: 'preserves legacy integer persistence for fractional nation averages',
        fixturePatches: {
            generals: {
                3: {
                    experience: 1001,
                    dedication: 1001,
                    meta: { dex1: 1, dex2: 1, dex3: 1, dex4: 1, dex5: 1 },
                },
            },
        },
        outcome: 'completed',
        expectedCreateCount: 3,
        expectedPostReqTurn: 98,
        expectedAverageExperience: 1000,
    },
];

integration('nation volunteer-recruitment constraints, creation values, RNG, and cooldown boundaries', () => {
    it.each(volunteerRecruitBoundaryCases)(
        '$name matches legacy progress, created generals, cooldown, logs, RNG, and semantic delta',
        async ({
            fixturePatches,
            outcome,
            coreResolution = true,
            expectedCreateCount = 0,
            expectedPostReqTurn,
            expectedStrategicCommandLimit = 9,
            expectedAverageExperience = 1000,
        }) => {
            const completed = outcome === 'completed';
            const fallback = outcome === 'fallback';
            const completionNationPatch = completed
                ? {
                      turnLastByOfficerLevel: {
                          12: { command: '의병모집', term: 2 },
                      },
                  }
                : {};
            const request = buildRequest('che_의병모집', undefined, {
                ...fixturePatches,
                nations: {
                    ...fixturePatches?.nations,
                    1: {
                        ...fixturePatches?.nations?.[1],
                        ...completionNationPatch,
                    },
                },
            });
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);

            expect(reference.execution.outcome).toMatchObject({ completed });
            if (coreResolution) {
                expect(core.execution.outcome).toMatchObject({
                    requestedAction: 'che_의병모집',
                    actionKey: fallback ? '휴식' : 'che_의병모집',
                    usedFallback: fallback,
                    ...(fallback ? {} : { completed }),
                });
            } else {
                expect(core.execution.outcome).toBeUndefined();
            }

            for (const snapshot of [reference, core]) {
                const nationBefore = snapshot.before.nations.find((entry) => entry.id === 1);
                const nationAfter = snapshot.after.nations.find((entry) => entry.id === 1);
                const actorBefore = snapshot.before.generals.find((entry) => entry.id === 1);
                const actorAfter = snapshot.after.generals.find((entry) => entry.id === 1);
                const beforeGeneralIds = new Set(snapshot.before.generals.map((entry) => entry.id));
                const createdGenerals = snapshot.after.generals.filter((entry) => !beforeGeneralIds.has(entry.id));

                expect(readNationResource(nationBefore, 'gold') - readNationResource(nationAfter, 'gold')).toBe(0);
                expect(readNationResource(nationBefore, 'rice') - readNationResource(nationAfter, 'rice')).toBe(0);
                expect(readNumericField(actorAfter, 'experience') - readNumericField(actorBefore, 'experience')).toBe(
                    completed ? 15 : 0
                );
                expect(readNumericField(actorAfter, 'dedication') - readNumericField(actorBefore, 'dedication')).toBe(
                    completed ? 15 : 0
                );
                expect(createdGenerals).toHaveLength(completed ? expectedCreateCount : 0);
                expect(readNumericField(nationAfter, 'strategicCommandLimit')).toBe(
                    completed ? expectedStrategicCommandLimit : readNumericField(nationBefore, 'strategicCommandLimit')
                );

                if (completed) {
                    for (const created of createdGenerals) {
                        expect(created).toMatchObject({
                            nationId: 1,
                            cityId: 3,
                            officerLevel: 1,
                            npcState: 4,
                            gold: 1000,
                            rice: 1000,
                            age: 20,
                            experience: expectedAverageExperience,
                            dedication: expectedAverageExperience,
                            specialDomestic: null,
                            specialWar: null,
                            specAge: 19,
                            specAge2: 19,
                        });
                        expect(String(created.name)).toMatch(/^ⓖ/);
                        expect(
                            readNumericField(created, 'leadership') +
                                readNumericField(created, 'strength') +
                                readNumericField(created, 'intelligence')
                        ).toBe(150);
                        expect(readNumericField(created, 'killTurn')).toBeGreaterThanOrEqual(64);
                        expect(readNumericField(created, 'killTurn')).toBeLessThanOrEqual(70);
                    }
                    const addedLogs = snapshot.after.logs.slice(snapshot.before.logs.length);
                    expect(addedLogs.map((entry) => entry.text)).toEqual(
                        expect.arrayContaining([expect.stringContaining('의병모집 발동')])
                    );
                    expect(
                        addedLogs.some((entry) => entry.generalId === 3 && String(entry.text).includes('의병모집'))
                    ).toBe(true);
                }
            }

            if (outcome === 'intermediate') {
                const priorTurnByOfficerLevel = fixturePatches?.nations?.[1]?.turnLastByOfficerLevel;
                const priorTerm =
                    priorTurnByOfficerLevel && typeof priorTurnByOfficerLevel === 'object'
                        ? (priorTurnByOfficerLevel as Record<number, { command?: string; term?: number }>)[12]
                        : undefined;
                const expectedTerm = priorTerm?.command === '의병모집' && priorTerm.term === 1 ? 2 : 1;
                expect(reference.execution.outcome).toMatchObject({
                    lastTurn: {
                        command: '의병모집',
                        term: expectedTerm,
                    },
                });
                expect(readNationMeta(core.after.nations.find((entry) => entry.id === 1)).turn_last_12).toMatchObject({
                    command: '의병모집',
                    term: expectedTerm,
                });
            }
            if (completed) {
                const currentYear = fixturePatches?.world?.year ?? 190;
                const expectedNextAvailableTurn = currentYear * 12 + expectedPostReqTurn!;
                expect(reference.after.world.nationCooldowns).toEqual([
                    {
                        nationId: 1,
                        actionName: '의병모집',
                        nextAvailableTurn: expectedNextAvailableTurn,
                    },
                ]);
                expect(core.after.world.nationCooldowns).toEqual(reference.after.world.nationCooldowns);
            }
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

type FloodOutcome = 'fallback' | 'intermediate' | 'completed';

const floodBoundaryCases: Array<{
    name: string;
    destCityId: unknown;
    fixturePatches?: FixturePatches;
    outcome: FloodOutcome;
    coreResolution?: boolean;
    expectedDefence?: number;
    expectedWall?: number;
    expectedPostReqTurn?: number;
    expectedStrategicCommandLimit?: number;
    expectedDestNationHistory?: boolean;
}> = [
    {
        name: 'rejects a missing destination city',
        destCityId: 9999,
        outcome: 'fallback',
    },
    {
        name: 'accepts a numeric string destination city ID',
        destCityId: '70',
        outcome: 'completed',
        expectedPostReqTurn: 61,
    },
    {
        name: 'truncates a fractional destination city ID',
        destCityId: 70.9,
        outcome: 'completed',
        expectedPostReqTurn: 61,
    },
    {
        name: 'rejects a neutral destination city',
        destCityId: 70,
        fixturePatches: { cities: { 70: { nationId: 0 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects a destination city occupied by the source nation',
        destCityId: 70,
        fixturePatches: { cities: { 70: { nationId: 1 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects a source city occupied by another nation',
        destCityId: 70,
        fixturePatches: { cities: { 3: { nationId: 2 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects an actor below chief rank',
        destCityId: 70,
        fixturePatches: { generals: { 1: { officerLevel: 4, officerCityId: 0 } } },
        outcome: 'fallback',
        coreResolution: false,
    },
    {
        name: 'rejects a remaining strategic-command delay',
        destCityId: 70,
        fixturePatches: { nations: { 1: { strategicCommandLimit: 1 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects a declaration state instead of active war',
        destCityId: 70,
        fixturePatches: { diplomacy: { '1:2': { state: 1 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects a reverse-only war',
        destCityId: 70,
        fixturePatches: {
            diplomacy: {
                '1:2': { state: 3 },
                '2:1': { state: 0 },
            },
        },
        outcome: 'fallback',
    },
    {
        name: 'allows unsupplied source and destination cities at term one',
        destCityId: 70,
        fixturePatches: {
            cities: {
                3: { supplyState: 0 },
                70: { supplyState: 0 },
            },
        },
        outcome: 'intermediate',
    },
    {
        name: 'advances the prior first term to term two',
        destCityId: 70,
        fixturePatches: {
            nations: {
                1: {
                    turnLastByOfficerLevel: {
                        12: { command: '수몰', arg: { destCityID: 70 }, term: 1 },
                    },
                    coreTurnLastByOfficerLevel: {
                        12: { command: '수몰', arg: { destCityId: 70 }, term: 1 },
                    },
                },
            },
        },
        outcome: 'intermediate',
    },
    {
        name: 'restarts at term one after another command interrupted the stack',
        destCityId: 70,
        fixturePatches: {
            nations: {
                1: {
                    turnLastByOfficerLevel: {
                        12: { command: '의병모집', term: 2 },
                    },
                },
            },
        },
        outcome: 'intermediate',
    },
    {
        name: 'completes the default flood effects and notifications',
        destCityId: 70,
        outcome: 'completed',
        expectedPostReqTurn: 61,
    },
    {
        name: 'omits destination nation history when it has no general',
        destCityId: 70,
        fixturePatches: { generals: { 2: { nationId: 0 } } },
        outcome: 'completed',
        expectedPostReqTurn: 61,
        expectedDestNationHistory: false,
    },
    {
        name: 'rounds defence and wall multiplication like MariaDB',
        destCityId: 70,
        fixturePatches: {
            cities: {
                70: {
                    defence: 1003,
                    wall: 1002,
                },
            },
        },
        outcome: 'completed',
        expectedDefence: 201,
        expectedWall: 200,
        expectedPostReqTurn: 61,
    },
    {
        name: 'applies the strategist command and global-delay modifiers',
        destCityId: 70,
        fixturePatches: { nations: { 1: { typeCode: 'che_종횡가' } } },
        outcome: 'completed',
        expectedPostReqTurn: 45,
        expectedStrategicCommandLimit: 5,
    },
    {
        name: 'uses stored eleven-general count for the nation cooldown',
        destCityId: 70,
        fixturePatches: { nations: { 1: { generalCount: 11 } } },
        outcome: 'completed',
        expectedPostReqTurn: 64,
    },
];

integration('nation flood constraints, multistep, city damage, logs, and cooldown boundaries', () => {
    it.each(floodBoundaryCases)(
        '$name matches legacy progress, damage, notifications, cooldown, RNG, and semantic delta',
        async ({
            destCityId,
            fixturePatches,
            outcome,
            coreResolution = true,
            expectedDefence,
            expectedWall,
            expectedPostReqTurn,
            expectedStrategicCommandLimit = 9,
            expectedDestNationHistory = true,
        }) => {
            const completed = outcome === 'completed';
            const fallback = outcome === 'fallback';
            const normalizedDestCityId = Math.trunc(Number(destCityId));
            const completionNationPatch = completed
                ? {
                      turnLastByOfficerLevel: {
                          12: { command: '수몰', arg: { destCityID: destCityId }, term: 2 },
                      },
                      coreTurnLastByOfficerLevel: {
                          12: { command: '수몰', arg: { destCityId: normalizedDestCityId }, term: 2 },
                      },
                  }
                : {};
            const request = buildRequest(
                'che_수몰',
                { destCityID: destCityId },
                {
                    ...fixturePatches,
                    nations: {
                        ...fixturePatches?.nations,
                        1: {
                            ...fixturePatches?.nations?.[1],
                            ...completionNationPatch,
                        },
                    },
                    diplomacy: {
                        '1:2': { state: 0 },
                        '2:1': { state: 3 },
                        ...fixturePatches?.diplomacy,
                    },
                }
            );
            request.observe!.includeNationHistoryLogs = true;
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);

            expect(reference.execution.outcome).toMatchObject({ completed });
            if (coreResolution) {
                expect(core.execution.outcome).toMatchObject({
                    requestedAction: 'che_수몰',
                    actionKey: fallback ? '휴식' : 'che_수몰',
                    usedFallback: fallback,
                    ...(fallback ? {} : { completed }),
                });
            } else {
                expect(core.execution.outcome).toBeUndefined();
            }

            for (const snapshot of [reference, core]) {
                const nationBefore = snapshot.before.nations.find((entry) => entry.id === 1);
                const nationAfter = snapshot.after.nations.find((entry) => entry.id === 1);
                const actorBefore = snapshot.before.generals.find((entry) => entry.id === 1);
                const actorAfter = snapshot.after.generals.find((entry) => entry.id === 1);
                const cityBefore = snapshot.before.cities.find((entry) => entry.id === normalizedDestCityId);
                const cityAfter = snapshot.after.cities.find((entry) => entry.id === normalizedDestCityId);

                expect(readNationResource(nationBefore, 'gold') - readNationResource(nationAfter, 'gold')).toBe(0);
                expect(readNationResource(nationBefore, 'rice') - readNationResource(nationAfter, 'rice')).toBe(0);
                expect(readNumericField(actorAfter, 'experience') - readNumericField(actorBefore, 'experience')).toBe(
                    completed ? 15 : 0
                );
                expect(readNumericField(actorAfter, 'dedication') - readNumericField(actorBefore, 'dedication')).toBe(
                    completed ? 15 : 0
                );
                expect(readNumericField(nationAfter, 'strategicCommandLimit')).toBe(
                    completed ? expectedStrategicCommandLimit : readNumericField(nationBefore, 'strategicCommandLimit')
                );
                expect(readNumericField(cityAfter, 'defence')).toBe(
                    completed
                        ? (expectedDefence ?? Math.round(readNumericField(cityBefore, 'defence') * 0.2))
                        : readNumericField(cityBefore, 'defence')
                );
                expect(readNumericField(cityAfter, 'wall')).toBe(
                    completed
                        ? (expectedWall ?? Math.round(readNumericField(cityBefore, 'wall') * 0.2))
                        : readNumericField(cityBefore, 'wall')
                );

                if (completed) {
                    const nationHistoryWatermark = snapshot.before.logs
                        .filter((entry) => entry.scope === 'nation')
                        .reduce((max, entry) => Math.max(max, readNumericField(entry, 'id')), 0);
                    const addedLogs = snapshot.after.logs.filter((entry) =>
                        entry.scope === 'nation'
                            ? readNumericField(entry, 'id') > nationHistoryWatermark
                            : readNumericField(entry, 'id') > snapshot.before.watermarks.logId
                    );
                    expect(
                        addedLogs.some((entry) => entry.generalId === 3 && String(entry.text).includes('수몰'))
                    ).toBe(true);
                    const hasDestGeneral = snapshot.before.generals.some((entry) => entry.nationId === 2);
                    expect(
                        addedLogs.some((entry) => entry.generalId === 2 && String(entry.text).includes('수몰'))
                    ).toBe(hasDestGeneral);
                    expect(
                        addedLogs.some(
                            (entry) => String(entry.text).includes('아국의') && String(entry.text).includes('수몰')
                        )
                    ).toBe(expectedDestNationHistory);
                    expect(
                        addedLogs.some(
                            (entry) =>
                                String(entry.text).includes('수몰') &&
                                !String(entry.text).includes('아국의') &&
                                String(entry.text).endsWith('발동')
                        )
                    ).toBe(true);
                }
            }

            if (outcome === 'intermediate') {
                const priorTurnByOfficerLevel = fixturePatches?.nations?.[1]?.turnLastByOfficerLevel;
                const priorTerm =
                    priorTurnByOfficerLevel && typeof priorTurnByOfficerLevel === 'object'
                        ? (
                              priorTurnByOfficerLevel as Record<
                                  number,
                                  { command?: string; arg?: { destCityID?: unknown }; term?: number }
                              >
                          )[12]
                        : undefined;
                const expectedTerm =
                    priorTerm?.command === '수몰' &&
                    Math.trunc(Number(priorTerm.arg?.destCityID)) === normalizedDestCityId &&
                    priorTerm.term === 1
                        ? 2
                        : 1;
                expect(reference.execution.outcome).toMatchObject({
                    lastTurn: {
                        command: '수몰',
                        term: expectedTerm,
                    },
                });
                expect(readNationMeta(core.after.nations.find((entry) => entry.id === 1)).turn_last_12).toMatchObject({
                    command: '수몰',
                    term: expectedTerm,
                });
            }
            if (completed) {
                const expectedNextAvailableTurn = 190 * 12 + expectedPostReqTurn!;
                expect(reference.after.world.nationCooldowns).toEqual([
                    {
                        nationId: 1,
                        actionName: '수몰',
                        nextAvailableTurn: expectedNextAvailableTurn,
                    },
                ]);
                expect(core.after.world.nationCooldowns).toEqual(reference.after.world.nationCooldowns);
            }
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

const counterStrategyNames = {
    che_필사즉생: '필사즉생',
    che_백성동원: '백성동원',
    che_수몰: '수몰',
    che_허보: '허보',
    che_의병모집: '의병모집',
    che_이호경식: '이호경식',
    che_급습: '급습',
} as const;

type CounterStrategyCommand = keyof typeof counterStrategyNames;

interface CounterStrategyBoundaryCase {
    name: string;
    destNationId?: unknown;
    commandType?: unknown;
    omitDestNationId?: boolean;
    omitCommandType?: boolean;
    fixturePatches?: FixturePatches;
    outcome: 'fallback' | 'intermediate' | 'completed';
    coreResolution?: boolean;
    expectedSourceTargetOffset?: number;
    expectedDestTargetTurn?: number;
    expectedDestGeneralLog?: boolean;
}

const counterStrategyBoundaryCases: CounterStrategyBoundaryCase[] = [
    {
        name: 'rejects a missing destination nation argument',
        omitDestNationId: true,
        outcome: 'fallback',
    },
    {
        name: 'rejects a numeric string destination nation',
        destNationId: '2',
        outcome: 'fallback',
    },
    {
        name: 'rejects a fractional destination nation instead of truncating it',
        destNationId: 2.9,
        outcome: 'fallback',
    },
    {
        name: 'rejects a zero destination nation',
        destNationId: 0,
        outcome: 'fallback',
    },
    {
        name: 'rejects a missing selected strategy',
        omitCommandType: true,
        outcome: 'fallback',
    },
    {
        name: 'rejects a non-string selected strategy',
        commandType: 1,
        outcome: 'fallback',
    },
    {
        name: 'rejects an unknown selected strategy',
        commandType: 'che_초토화',
        outcome: 'fallback',
    },
    {
        name: 'rejects selecting counter strategy itself',
        commandType: 'che_피장파장',
        outcome: 'fallback',
    },
    {
        name: 'rejects a nation that no longer exists',
        destNationId: 9,
        outcome: 'fallback',
    },
    {
        name: 'rejects a source city occupied by another nation',
        fixturePatches: { cities: { 3: { nationId: 2 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects an actor below chief rank',
        fixturePatches: { generals: { 1: { officerLevel: 4 } } },
        outcome: 'fallback',
        coreResolution: false,
    },
    {
        name: 'rejects a remaining strategic-command delay',
        fixturePatches: { nations: { 1: { strategicCommandLimit: 1 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects a selected strategy still cooling down in the source nation',
        fixturePatches: { nations: { 1: { nationEnv: { next_execute_허보: 2281 } } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects a forward diplomacy state outside declaration or war',
        fixturePatches: { diplomacy: { '1:2': { state: 2 }, '2:1': { state: 0 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects a reverse-only war',
        fixturePatches: { diplomacy: { '1:2': { state: 3 }, '2:1': { state: 0 } } },
        outcome: 'fallback',
    },
    {
        name: 'allows an unsupplied source city and starts at term one',
        fixturePatches: { cities: { 3: { supplyState: 0 } } },
        outcome: 'intermediate',
    },
    {
        name: 'restarts at term one when the same command has different prior arguments',
        fixturePatches: {
            nations: {
                1: {
                    turnLastByOfficerLevel: {
                        12: {
                            command: '피장파장',
                            arg: { destNationID: 2, commandType: 'che_백성동원' },
                            term: 1,
                        },
                    },
                },
            },
        },
        outcome: 'intermediate',
    },
    {
        name: 'restarts at term one after another command interrupted the stack',
        fixturePatches: {
            nations: {
                1: {
                    turnLastByOfficerLevel: {
                        12: {
                            command: '수몰',
                            arg: { destCityID: 70 },
                            term: 1,
                        },
                    },
                },
            },
        },
        outcome: 'intermediate',
    },
    {
        name: 'completes the default source and destination cooldowns and notifications',
        outcome: 'completed',
        expectedSourceTargetOffset: 72,
        expectedDestTargetTurn: 2340,
    },
    {
        name: 'allows the exact current-turn selected-strategy cooldown',
        fixturePatches: { nations: { 1: { nationEnv: { next_execute_허보: 2280 } } } },
        outcome: 'completed',
        expectedSourceTargetOffset: 72,
        expectedDestTargetTurn: 2340,
    },
    {
        name: 'adds sixty turns after an existing future destination cooldown',
        fixturePatches: { nations: { 2: { nationEnv: { next_execute_허보: 2300 } } } },
        outcome: 'completed',
        expectedSourceTargetOffset: 72,
        expectedDestTargetTurn: 2360,
    },
    {
        name: 'uses stored thirty-general count for the source selected-strategy cooldown',
        fixturePatches: { nations: { 1: { generalCount: 30 } } },
        outcome: 'completed',
        expectedSourceTargetOffset: 77,
        expectedDestTargetTurn: 2340,
    },
    {
        name: 'applies the strategist delay modifier but preserves the seventy-two-turn floor',
        fixturePatches: { nations: { 1: { typeCode: 'che_종횡가' } } },
        outcome: 'completed',
        expectedSourceTargetOffset: 72,
        expectedDestTargetTurn: 2340,
    },
    {
        name: 'keeps destination nation history when it has no general',
        fixturePatches: { generals: { 2: { nationId: 0 } } },
        outcome: 'completed',
        expectedSourceTargetOffset: 72,
        expectedDestTargetTurn: 2340,
        expectedDestGeneralLog: false,
    },
    {
        name: 'allows declaration state one regardless of reverse diplomacy',
        fixturePatches: { diplomacy: { '1:2': { state: 1 }, '2:1': { state: 7 } } },
        outcome: 'completed',
        expectedSourceTargetOffset: 72,
        expectedDestTargetTurn: 2340,
    },
];

integration('nation counter-strategy constraints, stack, dual cooldowns, and log boundaries', () => {
    it.each(counterStrategyBoundaryCases)(
        '$name matches legacy progress, cooldowns, notifications, RNG, and semantic delta',
        async ({
            destNationId = 2,
            commandType = 'che_허보',
            omitDestNationId = false,
            omitCommandType = false,
            fixturePatches,
            outcome,
            coreResolution = true,
            expectedSourceTargetOffset,
            expectedDestTargetTurn,
            expectedDestGeneralLog = true,
        }) => {
            const completed = outcome === 'completed';
            const fallback = outcome === 'fallback';
            const completionPatch = completed
                ? {
                      turnLastByOfficerLevel: {
                          12: {
                              command: '피장파장',
                              arg: { destNationID: destNationId, commandType },
                              term: 1,
                          },
                      },
                      coreTurnLastByOfficerLevel: {
                          12: {
                              command: '피장파장',
                              arg: { destNationId, commandType },
                              term: 1,
                          },
                      },
                  }
                : {};
            const args = {
                ...(omitDestNationId ? {} : { destNationID: destNationId }),
                ...(omitCommandType ? {} : { commandType }),
            };
            const request = buildRequest('che_피장파장', args, {
                ...fixturePatches,
                nations: {
                    ...fixturePatches?.nations,
                    1: {
                        ...fixturePatches?.nations?.[1],
                        ...completionPatch,
                    },
                },
                diplomacy: {
                    '1:2': { state: 0 },
                    '2:1': { state: 3 },
                    ...fixturePatches?.diplomacy,
                },
            });
            const selectedCommand =
                typeof commandType === 'string' && commandType in counterStrategyNames
                    ? (commandType as CounterStrategyCommand)
                    : 'che_허보';
            const selectedCommandName = counterStrategyNames[selectedCommand];
            request.observe!.includeNationHistoryLogs = true;
            request.observe!.nationCooldowns =
                typeof commandType === 'string' && commandType in counterStrategyNames
                    ? [
                          { nationId: 1, actionName: '피장파장' },
                          { nationId: 1, actionName: selectedCommandName },
                          { nationId: 2, actionName: selectedCommandName },
                      ]
                    : [];

            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);

            expect(reference.execution.outcome).toMatchObject({ completed });
            if (coreResolution) {
                expect(core.execution.outcome).toMatchObject({
                    requestedAction: 'che_피장파장',
                    actionKey: fallback ? '휴식' : 'che_피장파장',
                    usedFallback: fallback,
                    ...(fallback ? {} : { completed }),
                });
            } else {
                expect(core.execution.outcome).toBeUndefined();
            }
            for (const snapshot of [reference, core]) {
                const sourceBefore = snapshot.before.nations.find((entry) => entry.id === 1);
                const sourceAfter = snapshot.after.nations.find((entry) => entry.id === 1);
                const actorBefore = snapshot.before.generals.find((entry) => entry.id === 1);
                const actorAfter = snapshot.after.generals.find((entry) => entry.id === 1);
                expect(readNationResource(sourceBefore, 'gold') - readNationResource(sourceAfter, 'gold')).toBe(0);
                expect(readNationResource(sourceBefore, 'rice') - readNationResource(sourceAfter, 'rice')).toBe(0);
                expect(readNumericField(actorAfter, 'experience') - readNumericField(actorBefore, 'experience')).toBe(
                    completed ? 10 : 0
                );
                expect(readNumericField(actorAfter, 'dedication') - readNumericField(actorBefore, 'dedication')).toBe(
                    completed ? 10 : 0
                );
                expect(readNumericField(sourceAfter, 'strategicCommandLimit')).toBe(
                    readNumericField(sourceBefore, 'strategicCommandLimit')
                );

                if (completed) {
                    const nationHistoryWatermark = snapshot.before.logs
                        .filter((entry) => entry.scope === 'nation')
                        .reduce((max, entry) => Math.max(max, readNumericField(entry, 'id')), 0);
                    const addedLogs = snapshot.after.logs.filter((entry) =>
                        entry.scope === 'nation'
                            ? readNumericField(entry, 'id') > nationHistoryWatermark
                            : readNumericField(entry, 'id') > snapshot.before.watermarks.logId
                    );
                    expect(
                        addedLogs.some((entry) => entry.generalId === 3 && String(entry.text).includes('피장파장'))
                    ).toBe(true);
                    expect(
                        addedLogs.some((entry) => entry.generalId === 2 && String(entry.text).includes('피장파장'))
                    ).toBe(expectedDestGeneralLog);
                    expect(
                        addedLogs.filter(
                            (entry) =>
                                String(entry.scope).toLowerCase() === 'nation' &&
                                entry.nationId === 1 &&
                                String(entry.text).includes('피장파장')
                        )
                    ).toHaveLength(1);
                    expect(
                        addedLogs.filter(
                            (entry) =>
                                String(entry.scope).toLowerCase() === 'nation' &&
                                entry.nationId === 2 &&
                                String(entry.text).includes('피장파장')
                        )
                    ).toHaveLength(1);
                }
            }

            if (outcome === 'intermediate') {
                expect(reference.execution.outcome).toMatchObject({
                    lastTurn: {
                        command: '피장파장',
                        term: 1,
                    },
                });
                expect(readNationMeta(core.after.nations.find((entry) => entry.id === 1)).turn_last_12).toMatchObject({
                    command: '피장파장',
                    term: 1,
                });
            }
            if (completed) {
                expect(reference.after.world.nationCooldowns).toEqual([
                    {
                        nationId: 1,
                        actionName: '피장파장',
                        nextAvailableTurn: 2287,
                    },
                    {
                        nationId: 1,
                        actionName: selectedCommandName,
                        nextAvailableTurn: 2280 + expectedSourceTargetOffset!,
                    },
                    {
                        nationId: 2,
                        actionName: selectedCommandName,
                        nextAvailableTurn: expectedDestTargetTurn,
                    },
                ]);
                expect(core.after.world.nationCooldowns).toEqual(reference.after.world.nationCooldowns);
            }
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

integration('nation command missing argument object parity', () => {
    it.each(['che_포상', 'che_몰수'] as const)(
        '%s falls back with the legacy invalid-argument log and no RNG',
        async (action) => {
            const request = buildRequest(action);
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
            expect(semanticLogSignatures(nationCommandLogs(core.after.logs))).toEqual(
                semanticLogSignatures(addedReferenceLogs(reference.before, reference.after.logs))
            );
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
                generals: {
                    3: {
                        name: '몰수NPC',
                        npcState: 2,
                        picture: 'npc/custom.png',
                        imageServer: 0,
                    },
                },
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
        const messageAfterId = reference.before.watermarks.messageId;
        const coreTimeline = projectStrictTurnMessageTimeline(core.before, core.after, messageAfterId);
        const referenceTimeline = projectStrictTurnMessageTimeline(reference.before, reference.after, messageAfterId);
        expect({
            unreadDeltas: projectSemanticUnreadMessageDeltas(core.before, core.after),
            messages: projectSemanticTurnMessages(core.after.messages, messageAfterId),
            timeline: coreTimeline,
        }).toEqual({
            unreadDeltas: projectSemanticUnreadMessageDeltas(reference.before, reference.after),
            messages: projectSemanticTurnMessages(reference.after.messages, messageAfterId),
            timeline: referenceTimeline,
        });
        expect(referenceTimeline.usesSingleTick).toBe(true);
        expect(referenceMessages[0]).toMatchObject({
            mailbox: 9999,
            type: 'public',
            sourceId: 3,
            destinationId: 9999,
            payload: {
                src: {
                    id: 3,
                    name: '몰수NPC',
                    nation_id: 1,
                    nation: '아국',
                    icon: 'https://dev-sam-ref.hided.net/image/icons/npc/custom.png',
                },
                dest: {
                    id: 3,
                    name: '몰수NPC',
                    nation_id: 1,
                    nation: '아국',
                    icon: 'https://dev-sam-ref.hided.net/image/icons/npc/custom.png',
                },
                text: NPC_SEIZURE_MESSAGE_TEXT,
            },
        });
        expect(core.after.messages[0]).toMatchObject({
            mailbox: 9999,
            type: 'public',
            sourceId: 3,
            destinationId: 9999,
            payload: {
                src: {
                    generalId: 3,
                    generalName: '몰수NPC',
                    nationId: 1,
                    nationName: '아국',
                    icon: 'https://dev-sam-ref.hided.net/image/icons/npc/custom.png',
                },
                dest: {
                    generalId: 3,
                    generalName: '몰수NPC',
                    nationId: 1,
                    nationName: '아국',
                    icon: 'https://dev-sam-ref.hided.net/image/icons/npc/custom.png',
                },
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
        const messageAfterId = reference.before.watermarks.messageId;
        const coreTimeline = projectStrictTurnMessageTimeline(core.before, core.after, messageAfterId);
        const referenceTimeline = projectStrictTurnMessageTimeline(reference.before, reference.after, messageAfterId);
        expect({
            unreadDeltas: projectSemanticUnreadMessageDeltas(core.before, core.after),
            messages: projectSemanticTurnMessages(core.after.messages, messageAfterId),
            timeline: coreTimeline,
        }).toEqual({
            unreadDeltas: projectSemanticUnreadMessageDeltas(reference.before, reference.after),
            messages: projectSemanticTurnMessages(reference.after.messages, messageAfterId),
            timeline: referenceTimeline,
        });
        expect(referenceTimeline.usesSingleTick).toBe(true);
        expect(referenceMessages[0]).toMatchObject({
            type: 'public',
            sourceId: 3,
            payload: { text: NPC_SEIZURE_MESSAGE_TEXT },
        });
        expect(core.after.messages[0]).toMatchObject({
            type: 'public',
            payload: { text: NPC_SEIZURE_MESSAGE_TEXT },
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

const populationMoveConstraintCases: Array<{
    name: string;
    destCityId: unknown;
    fixturePatches?: FixturePatches;
    completed?: boolean;
    coreResolution?: boolean;
}> = [
    {
        name: 'rejects a missing destination city',
        destCityId: 9999,
    },
    {
        name: 'rejects the source city as destination',
        destCityId: 3,
    },
    {
        name: 'accepts a numeric string destination city ID',
        destCityId: '70',
        completed: true,
    },
    {
        name: 'rejects a source city below the minimum population',
        destCityId: 70,
        fixturePatches: { cities: { 3: { population: 30_099 } } },
    },
    {
        name: 'rejects a source city occupied by another nation',
        destCityId: 70,
        fixturePatches: { cities: { 3: { nationId: 2 } } },
    },
    {
        name: 'rejects a destination city occupied by another nation',
        destCityId: 70,
        fixturePatches: { cities: { 70: { nationId: 2 } } },
    },
    {
        name: 'rejects a non-adjacent destination city',
        destCityId: 73,
        fixturePatches: { cities: { 73: { nationId: 1, supplyState: 1 } } },
    },
    {
        name: 'rejects an actor below chief rank',
        destCityId: 70,
        fixturePatches: { generals: { 1: { officerLevel: 4, officerCityId: 0 } } },
        coreResolution: false,
    },
    {
        name: 'rejects an unsupplied source city',
        destCityId: 70,
        fixturePatches: { cities: { 3: { supplyState: 0 } } },
    },
    {
        name: 'rejects an unsupplied destination city',
        destCityId: 70,
        fixturePatches: { cities: { 70: { supplyState: 0 } } },
    },
];

integration('nation population move target and city constraints', () => {
    it.each(populationMoveConstraintCases)(
        '$name matches legacy fallback, RNG, and semantic delta',
        async ({ destCityId, fixturePatches, completed = false, coreResolution = true }) => {
            const request = buildRequest(
                'cr_인구이동',
                { destCityID: destCityId, amount: 1_000 },
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

            expect(reference.execution.outcome).toMatchObject({ completed });
            if (coreResolution) {
                expect(core.execution.outcome).toMatchObject({
                    requestedAction: 'cr_인구이동',
                    actionKey: completed ? 'cr_인구이동' : '휴식',
                    usedFallback: !completed,
                });
            } else {
                expect(core.execution.outcome).toBeUndefined();
            }
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

const capitalMoveCases: Array<{
    name: string;
    destCityId: unknown;
    fixturePatches?: FixturePatches;
    completed: boolean;
    referenceDistance: number;
    coreDistance?: number;
}> = [
    {
        name: 'rejects a missing destination city',
        destCityId: 9999,
        completed: false,
        referenceDistance: 0,
    },
    {
        name: 'rejects the current capital',
        destCityId: 3,
        completed: false,
        referenceDistance: 0,
    },
    {
        name: 'accepts a numeric string destination city ID',
        destCityId: '70',
        completed: true,
        referenceDistance: 1,
    },
    {
        name: 'rejects a destination city occupied by another nation',
        destCityId: 70,
        fixturePatches: { cities: { 70: { nationId: 2 } } },
        completed: false,
        referenceDistance: 50,
        coreDistance: 0,
    },
    {
        name: 'rejects an unsupplied destination city',
        destCityId: 70,
        fixturePatches: { cities: { 70: { supplyState: 0 } } },
        completed: false,
        referenceDistance: 1,
    },
    {
        name: 'rejects a source city occupied by another nation',
        destCityId: 70,
        fixturePatches: { cities: { 3: { nationId: 2 } } },
        completed: false,
        referenceDistance: 1,
    },
    {
        name: 'rejects an unsupplied source city',
        destCityId: 70,
        fixturePatches: { cities: { 3: { supplyState: 0 } } },
        completed: false,
        referenceDistance: 1,
    },
    {
        name: 'allows the exact distance-one gold and rice requirement',
        destCityId: 70,
        fixturePatches: { nations: { 1: { gold: 180, rice: 2_180 } } },
        completed: true,
        referenceDistance: 1,
    },
    {
        name: 'rejects one less than the distance-one gold requirement',
        destCityId: 70,
        fixturePatches: { nations: { 1: { gold: 179, rice: 2_180 } } },
        completed: false,
        referenceDistance: 1,
    },
    {
        name: 'rejects one less than the distance-one rice requirement',
        destCityId: 70,
        fixturePatches: { nations: { 1: { gold: 180, rice: 2_179 } } },
        completed: false,
        referenceDistance: 1,
    },
    {
        name: 'rejects an owned city without an owned-city route',
        destCityId: 73,
        fixturePatches: { cities: { 73: { nationId: 1, supplyState: 1 } } },
        completed: false,
        referenceDistance: 50,
        coreDistance: 0,
    },
    {
        name: 'completes a distance-two capital move through an owned city',
        destCityId: 23,
        fixturePatches: {
            nations: { 1: { gold: 360, rice: 2_360 } },
            cities: {
                70: { nationId: 1, supplyState: 1 },
                23: { nationId: 1, supplyState: 1 },
            },
        },
        completed: true,
        referenceDistance: 2,
    },
];

integration('nation capital move target, route, and resource constraints', () => {
    it.each(capitalMoveCases)(
        '$name matches legacy completion, multistep effects, RNG, and semantic delta',
        async ({ destCityId, fixturePatches, completed, referenceDistance, coreDistance = referenceDistance }) => {
            const coreDestCityId = typeof destCityId === 'string' ? Number(destCityId) : destCityId;
            const referenceLastTurn = {
                command: '천도',
                arg: { destCityID: destCityId },
                term: referenceDistance * 2,
                seq: 0,
            };
            const coreLastTurn = {
                command: '천도',
                arg: { destCityID: coreDestCityId },
                term: coreDistance * 2,
                seq: 0,
            };
            const request = buildRequest(
                'che_천도',
                { destCityID: destCityId },
                {
                    ...fixturePatches,
                    nations: {
                        ...fixturePatches?.nations,
                        1: {
                            ...fixturePatches?.nations?.[1],
                            capitalRevision: 0,
                            turnLastByOfficerLevel: { 12: referenceLastTurn },
                            coreTurnLastByOfficerLevel: { 12: coreLastTurn },
                        },
                    },
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
            const referenceNationBefore = reference.before.nations.find((entry) => entry.id === 1);
            const referenceNationAfter = reference.after.nations.find((entry) => entry.id === 1);
            const coreNationBefore = core.before.nations.find((entry) => entry.id === 1);
            const coreNationAfter = core.after.nations.find((entry) => entry.id === 1);
            const referenceGeneralBefore = reference.before.generals.find((entry) => entry.id === 1);
            const referenceGeneralAfter = reference.after.generals.find((entry) => entry.id === 1);
            const coreGeneralBefore = core.before.generals.find((entry) => entry.id === 1);
            const coreGeneralAfter = core.after.generals.find((entry) => entry.id === 1);
            const expectedExperience = completed ? 5 * (referenceDistance * 2 + 1) : 0;

            expect(reference.execution.outcome).toMatchObject({ completed });
            expect(core.execution.outcome).toMatchObject({
                requestedAction: 'che_천도',
                actionKey: completed ? 'che_천도' : '휴식',
                usedFallback: !completed,
            });
            for (const field of ['gold', 'rice']) {
                expect(
                    readNumericField(referenceNationBefore, field) - readNumericField(referenceNationAfter, field)
                ).toBe(0);
                expect(readNumericField(coreNationBefore, field) - readNumericField(coreNationAfter, field)).toBe(0);
            }
            for (const field of ['experience', 'dedication']) {
                expect(
                    readNumericField(referenceGeneralAfter, field) - readNumericField(referenceGeneralBefore, field)
                ).toBe(expectedExperience);
                expect(readNumericField(coreGeneralAfter, field) - readNumericField(coreGeneralBefore, field)).toBe(
                    expectedExperience
                );
            }
            if (completed) {
                expect(referenceNationAfter?.capitalCityId).toBe(coreDestCityId);
                expect(coreNationAfter?.capitalCityId).toBe(coreDestCityId);
            }
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

const expandCityCases: Array<{
    name: string;
    fixturePatches?: FixturePatches;
    completed: boolean;
}> = [
    {
        name: 'rejects a wandering nation without a capital',
        fixturePatches: { nations: { 1: { capitalCityId: 0 } } },
        completed: false,
    },
    {
        name: 'rejects a level-three capital',
        fixturePatches: { cities: { 3: { level: 3 } } },
        completed: false,
    },
    {
        name: 'allows the minimum level-four capital',
        fixturePatches: { cities: { 3: { level: 4 } } },
        completed: true,
    },
    {
        name: 'allows the maximum expandable level-seven capital',
        fixturePatches: { cities: { 3: { level: 7 } } },
        completed: true,
    },
    {
        name: 'rejects a level-eight capital',
        fixturePatches: { cities: { 3: { level: 8 } } },
        completed: false,
    },
    {
        name: 'allows the exact gold and rice requirement',
        fixturePatches: { nations: { 1: { gold: 69_000, rice: 71_000 } } },
        completed: true,
    },
    {
        name: 'rejects one less than the gold requirement',
        fixturePatches: { nations: { 1: { gold: 68_999, rice: 71_000 } } },
        completed: false,
    },
    {
        name: 'rejects one less than the rice requirement',
        fixturePatches: { nations: { 1: { gold: 69_000, rice: 70_999 } } },
        completed: false,
    },
    {
        name: 'rejects a source city occupied by another nation',
        fixturePatches: { cities: { 3: { nationId: 2 } } },
        completed: false,
    },
    {
        name: 'rejects an unsupplied source city',
        fixturePatches: { cities: { 3: { supplyState: 0 } } },
        completed: false,
    },
];

integration('nation expand city level, resource, and city constraints', () => {
    it.each(expandCityCases)(
        '$name matches legacy completion, expansion effects, RNG, and semantic delta',
        async ({ fixturePatches, completed }) => {
            const request = buildRequest('che_증축', undefined, {
                ...fixturePatches,
                nations: {
                    ...fixturePatches?.nations,
                    1: {
                        ...fixturePatches?.nations?.[1],
                        capitalRevision: 0,
                        turnLastByOfficerLevel: {
                            12: { command: '증축', arg: {}, term: 5, seq: 0 },
                        },
                    },
                },
                cities: {
                    ...fixturePatches?.cities,
                    3: {
                        level: 5,
                        populationMax: 300_000,
                        agricultureMax: 5_000,
                        commerceMax: 5_000,
                        securityMax: 5_000,
                        defenceMax: 5_000,
                        wallMax: 5_000,
                        ...fixturePatches?.cities?.[3],
                    },
                },
            });
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);
            const referenceCityBefore = reference.before.cities.find((entry) => entry.id === 3);
            const referenceCityAfter = reference.after.cities.find((entry) => entry.id === 3);
            const coreCityBefore = core.before.cities.find((entry) => entry.id === 3);
            const coreCityAfter = core.after.cities.find((entry) => entry.id === 3);
            const referenceNationBefore = reference.before.nations.find((entry) => entry.id === 1);
            const referenceNationAfter = reference.after.nations.find((entry) => entry.id === 1);
            const coreNationBefore = core.before.nations.find((entry) => entry.id === 1);
            const coreNationAfter = core.after.nations.find((entry) => entry.id === 1);
            const referenceGeneralBefore = reference.before.generals.find((entry) => entry.id === 1);
            const referenceGeneralAfter = reference.after.generals.find((entry) => entry.id === 1);
            const coreGeneralBefore = core.before.generals.find((entry) => entry.id === 1);
            const coreGeneralAfter = core.after.generals.find((entry) => entry.id === 1);
            const expectedCost = completed ? 69_000 : 0;

            expect(reference.before.world.develCost).toBe(18);
            expect(reference.execution.outcome).toMatchObject({ completed });
            expect(core.execution.outcome).toMatchObject({
                requestedAction: 'che_증축',
                actionKey: completed ? 'che_증축' : '휴식',
                usedFallback: !completed,
            });
            for (const [before, after] of [
                [referenceNationBefore, referenceNationAfter],
                [coreNationBefore, coreNationAfter],
            ] as const) {
                expect(readNationResource(before, 'gold') - readNationResource(after, 'gold')).toBe(expectedCost);
                expect(readNationResource(before, 'rice') - readNationResource(after, 'rice')).toBe(expectedCost);
            }
            for (const [before, after] of [
                [referenceGeneralBefore, referenceGeneralAfter],
                [coreGeneralBefore, coreGeneralAfter],
            ] as const) {
                expect(readNumericField(after, 'experience') - readNumericField(before, 'experience')).toBe(
                    completed ? 30 : 0
                );
                expect(readNumericField(after, 'dedication') - readNumericField(before, 'dedication')).toBe(
                    completed ? 30 : 0
                );
            }
            for (const [field, delta] of [
                ['level', 1],
                ['populationMax', 100_000],
                ['agricultureMax', 2_000],
                ['commerceMax', 2_000],
                ['securityMax', 2_000],
                ['defenceMax', 2_000],
                ['wallMax', 2_000],
            ] as const) {
                const expectedDelta = completed ? delta : 0;
                expect(readNumericField(referenceCityAfter, field) - readNumericField(referenceCityBefore, field)).toBe(
                    expectedDelta
                );
                expect(readNumericField(coreCityAfter, field) - readNumericField(coreCityBefore, field)).toBe(
                    expectedDelta
                );
            }
            expect(
                readNumericField(referenceNationAfter, 'capitalRevision') -
                    readNumericField(referenceNationBefore, 'capitalRevision')
            ).toBe(completed ? 1 : 0);
            expect(
                readNumericField(coreNationAfter, 'capitalRevision') -
                    readNumericField(coreNationBefore, 'capitalRevision')
            ).toBe(completed ? 1 : 0);
            expect(core.rng).toEqual(reference.rng);
            expect(
                compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                    ignoredPathPatterns: ignoredLifecyclePaths,
                })
            ).toEqual([]);
        },
        120_000
    );

    it('restarts at term one when capital revision changes during the stack', async () => {
        const request = buildRequest('che_증축', undefined, {
            nations: {
                1: {
                    capitalRevision: 1,
                    turnLastByOfficerLevel: {
                        12: { command: '증축', arg: {}, term: 5, seq: 0 },
                    },
                },
            },
            cities: {
                3: {
                    level: 5,
                    populationMax: 300_000,
                    agricultureMax: 5_000,
                    commerceMax: 5_000,
                    securityMax: 5_000,
                    defenceMax: 5_000,
                    wallMax: 5_000,
                },
            },
        });
        const reference = runReferenceTurnCommandTraceRequest(
            workspaceRoot!,
            request as unknown as Record<string, unknown>
        );
        const core = await runCoreTurnCommandTrace(request, reference.before);
        const coreNationAfter = core.after.nations.find((entry) => entry.id === 1);
        const coreLastTurn = readNationMeta(coreNationAfter).turn_last_12;

        expect(reference.execution.outcome).toMatchObject({
            // The ref runner's completion heuristic only sees the previous term=5
            // and reports true even though capset reset the persisted result to term 1.
            completed: true,
            lastTurn: {
                command: '증축',
                term: 1,
                seq: 1,
            },
        });
        expect(core.execution.outcome).toMatchObject({
            requestedAction: 'che_증축',
            actionKey: 'che_증축',
            usedFallback: false,
        });
        expect(coreLastTurn).toMatchObject({
            command: '증축',
            term: 1,
            seq: 1,
        });
        expect(core.rng).toEqual(reference.rng);
        expect(
            compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                ignoredPathPatterns: ignoredLifecyclePaths,
            })
        ).toEqual([]);
    }, 120_000);
});

const reduceCityCases: Array<{
    name: string;
    fixturePatches?: FixturePatches;
    completed: boolean;
}> = [
    {
        name: 'rejects a wandering nation without a capital',
        fixturePatches: { nations: { 1: { capitalCityId: 0 } } },
        completed: false,
    },
    {
        name: 'rejects a level-four capital',
        fixturePatches: { cities: { 3: { level: 4 } } },
        completed: false,
    },
    {
        name: 'rejects a level-five capital below its original map level',
        fixturePatches: { cities: { 3: { level: 5 } } },
        completed: false,
    },
    {
        name: 'rejects the original level-eight capital',
        fixturePatches: { cities: { 3: { level: 8 } } },
        completed: false,
    },
    {
        name: 'allows the minimum reducible level-nine capital',
        fixturePatches: { cities: { 3: { level: 9 } } },
        completed: true,
    },
    {
        name: 'allows a level-ten capital',
        fixturePatches: { cities: { 3: { level: 10 } } },
        completed: true,
    },
    {
        name: 'rejects a source city occupied by another nation',
        fixturePatches: { cities: { 3: { nationId: 2 } } },
        completed: false,
    },
    {
        name: 'rejects an unsupplied source city',
        fixturePatches: { cities: { 3: { supplyState: 0 } } },
        completed: false,
    },
    {
        name: 'clamps low population and development values',
        fixturePatches: {
            cities: {
                3: {
                    population: 50_000,
                    agriculture: 1_000,
                    commerce: 1_000,
                    security: 1_000,
                    defence: 1_000,
                    wall: 1_000,
                },
            },
        },
        completed: true,
    },
];

integration('nation reduce city level, value, recovery, and city constraints', () => {
    it.each(reduceCityCases)(
        '$name matches legacy completion, reduction effects, RNG, and semantic delta',
        async ({ fixturePatches, completed }) => {
            const request = buildRequest('che_감축', undefined, {
                ...fixturePatches,
                nations: {
                    ...fixturePatches?.nations,
                    1: {
                        ...fixturePatches?.nations?.[1],
                        capitalRevision: 0,
                        turnLastByOfficerLevel: {
                            12: { command: '감축', arg: {}, term: 5, seq: 0 },
                        },
                    },
                },
                cities: {
                    ...fixturePatches?.cities,
                    3: {
                        level: 9,
                        population: 250_000,
                        populationMax: 900_000,
                        agriculture: 5_000,
                        agricultureMax: 10_000,
                        commerce: 5_000,
                        commerceMax: 10_000,
                        security: 5_000,
                        securityMax: 10_000,
                        defence: 5_000,
                        defenceMax: 10_000,
                        wall: 5_000,
                        wallMax: 10_000,
                        ...fixturePatches?.cities?.[3],
                    },
                },
            });
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);
            const referenceCityBefore = reference.before.cities.find((entry) => entry.id === 3);
            const referenceCityAfter = reference.after.cities.find((entry) => entry.id === 3);
            const coreCityBefore = core.before.cities.find((entry) => entry.id === 3);
            const coreCityAfter = core.after.cities.find((entry) => entry.id === 3);
            const referenceNationBefore = reference.before.nations.find((entry) => entry.id === 1);
            const referenceNationAfter = reference.after.nations.find((entry) => entry.id === 1);
            const coreNationBefore = core.before.nations.find((entry) => entry.id === 1);
            const coreNationAfter = core.after.nations.find((entry) => entry.id === 1);
            const referenceGeneralBefore = reference.before.generals.find((entry) => entry.id === 1);
            const referenceGeneralAfter = reference.after.generals.find((entry) => entry.id === 1);
            const coreGeneralBefore = core.before.generals.find((entry) => entry.id === 1);
            const coreGeneralAfter = core.after.generals.find((entry) => entry.id === 1);
            const expectedRecovery = completed ? 39_000 : 0;

            expect(reference.before.world.develCost).toBe(18);
            expect(reference.execution.outcome).toMatchObject({ completed });
            expect(core.execution.outcome).toMatchObject({
                requestedAction: 'che_감축',
                actionKey: completed ? 'che_감축' : '휴식',
                usedFallback: !completed,
            });
            for (const [before, after] of [
                [referenceNationBefore, referenceNationAfter],
                [coreNationBefore, coreNationAfter],
            ] as const) {
                expect(readNationResource(after, 'gold') - readNationResource(before, 'gold')).toBe(expectedRecovery);
                expect(readNationResource(after, 'rice') - readNationResource(before, 'rice')).toBe(expectedRecovery);
            }
            for (const [before, after] of [
                [referenceGeneralBefore, referenceGeneralAfter],
                [coreGeneralBefore, coreGeneralAfter],
            ] as const) {
                expect(readNumericField(after, 'experience') - readNumericField(before, 'experience')).toBe(
                    completed ? 30 : 0
                );
                expect(readNumericField(after, 'dedication') - readNumericField(before, 'dedication')).toBe(
                    completed ? 30 : 0
                );
            }
            for (const [field, delta] of [
                ['level', -1],
                ['populationMax', -100_000],
                ['agricultureMax', -2_000],
                ['commerceMax', -2_000],
                ['securityMax', -2_000],
                ['defenceMax', -2_000],
                ['wallMax', -2_000],
            ] as const) {
                const expectedDelta = completed ? delta : 0;
                expect(readNumericField(referenceCityAfter, field) - readNumericField(referenceCityBefore, field)).toBe(
                    expectedDelta
                );
                expect(readNumericField(coreCityAfter, field) - readNumericField(coreCityBefore, field)).toBe(
                    expectedDelta
                );
            }
            for (const [before, after] of [
                [referenceCityBefore, referenceCityAfter],
                [coreCityBefore, coreCityAfter],
            ] as const) {
                expect(readNumericField(after, 'population')).toBe(
                    completed
                        ? Math.max(readNumericField(before, 'population') - 100_000, 30_000)
                        : readNumericField(before, 'population')
                );
                for (const field of ['agriculture', 'commerce', 'security', 'defence', 'wall'] as const) {
                    expect(readNumericField(after, field)).toBe(
                        completed
                            ? Math.max(readNumericField(before, field) - 2_000, 0)
                            : readNumericField(before, field)
                    );
                }
            }
            expect(
                readNumericField(referenceNationAfter, 'capitalRevision') -
                    readNumericField(referenceNationBefore, 'capitalRevision')
            ).toBe(completed ? 1 : 0);
            expect(
                readNumericField(coreNationAfter, 'capitalRevision') -
                    readNumericField(coreNationBefore, 'capitalRevision')
            ).toBe(completed ? 1 : 0);
            expect(core.rng).toEqual(reference.rng);
            expect(
                compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                    ignoredPathPatterns: ignoredLifecyclePaths,
                })
            ).toEqual([]);
        },
        120_000
    );

    it('restarts at term one when capital revision changes during the stack', async () => {
        const request = buildRequest('che_감축', undefined, {
            nations: {
                1: {
                    capitalRevision: 1,
                    turnLastByOfficerLevel: {
                        12: { command: '감축', arg: {}, term: 5, seq: 0 },
                    },
                },
            },
            cities: {
                3: {
                    level: 9,
                    population: 250_000,
                    populationMax: 900_000,
                    agriculture: 5_000,
                    agricultureMax: 10_000,
                    commerce: 5_000,
                    commerceMax: 10_000,
                    security: 5_000,
                    securityMax: 10_000,
                    defence: 5_000,
                    defenceMax: 10_000,
                    wall: 5_000,
                    wallMax: 10_000,
                },
            },
        });
        const reference = runReferenceTurnCommandTraceRequest(
            workspaceRoot!,
            request as unknown as Record<string, unknown>
        );
        const core = await runCoreTurnCommandTrace(request, reference.before);
        const coreNationAfter = core.after.nations.find((entry) => entry.id === 1);
        const coreLastTurn = readNationMeta(coreNationAfter).turn_last_12;

        expect(reference.execution.outcome).toMatchObject({
            // The ref runner's completion heuristic only sees the previous term=5
            // and reports true even though capset reset the persisted result to term 1.
            completed: true,
            lastTurn: {
                command: '감축',
                term: 1,
                seq: 1,
            },
        });
        expect(core.execution.outcome).toMatchObject({
            requestedAction: 'che_감축',
            actionKey: 'che_감축',
            usedFallback: false,
        });
        expect(coreLastTurn).toMatchObject({
            command: '감축',
            term: 1,
            seq: 1,
        });
        expect(core.rng).toEqual(reference.rng);
        expect(
            compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                ignoredPathPatterns: ignoredLifecyclePaths,
            })
        ).toEqual([]);
    }, 120_000);
});

type RandomCapitalOutcome = 'fallback' | 'incomplete' | 'completed';

const randomCapitalCases: Array<{
    name: string;
    fixturePatches?: FixturePatches;
    candidateCityIds: number[];
    flag?: number | null;
    officerLevel?: number;
    outcome: RandomCapitalOutcome;
}> = [
    {
        name: 'rejects a source city occupied by another nation',
        fixturePatches: { cities: { 3: { nationId: 2 } } },
        candidateCityIds: [70],
        outcome: 'fallback',
    },
    {
        name: 'rejects an unsupplied source city',
        fixturePatches: { cities: { 3: { supplyState: 0 } } },
        candidateCityIds: [70],
        outcome: 'fallback',
    },
    {
        name: 'rejects a non-lord actor',
        candidateCityIds: [70],
        officerLevel: 11,
        outcome: 'fallback',
    },
    {
        name: 'rejects at the opening-part year boundary',
        fixturePatches: { world: { year: 182 } },
        candidateCityIds: [70],
        outcome: 'fallback',
    },
    {
        name: 'rejects a missing remaining-use flag',
        candidateCityIds: [70],
        flag: null,
        outcome: 'fallback',
    },
    {
        name: 'rejects a zero remaining-use flag',
        candidateCityIds: [70],
        flag: 0,
        outcome: 'fallback',
    },
    {
        name: 'stays incomplete when no eligible city exists',
        candidateCityIds: [],
        outcome: 'incomplete',
    },
    {
        name: 'stays incomplete when the only neutral city is level four',
        fixturePatches: { cities: { 70: { level: 4 } } },
        candidateCityIds: [70],
        outcome: 'incomplete',
    },
    {
        name: 'stays incomplete when the only neutral city is level seven',
        fixturePatches: { cities: { 70: { level: 7 } } },
        candidateCityIds: [70],
        outcome: 'incomplete',
    },
    {
        name: 'allows a single level-five neutral city',
        fixturePatches: { cities: { 70: { level: 5 } } },
        candidateCityIds: [70],
        outcome: 'completed',
    },
    {
        name: 'allows a single level-six neutral city',
        fixturePatches: { cities: { 70: { level: 6 } } },
        candidateCityIds: [70],
        outcome: 'completed',
    },
    {
        name: 'matches legacy ordering and choice across two eligible cities',
        fixturePatches: {
            cities: {
                70: { level: 5 },
                71: {
                    nationId: 0,
                    level: 6,
                    conflict: { 2: 30 },
                    officerSet: 6,
                },
            },
        },
        candidateCityIds: [71, 70],
        outcome: 'completed',
    },
];

integration('nation random capital constraints, candidates, RNG, and city reset effects', () => {
    it.each(randomCapitalCases)(
        '$name matches legacy completion, destination, city resets, RNG, and semantic delta',
        async ({ fixturePatches, candidateCityIds, flag = 1, officerLevel = 12, outcome }) => {
            const request = buildRequest('che_무작위수도이전', undefined, {
                ...fixturePatches,
                world: {
                    year: 181,
                    ...fixturePatches?.world,
                },
                generals: {
                    ...fixturePatches?.generals,
                    1: {
                        ...fixturePatches?.generals?.[1],
                        officerLevel,
                    },
                },
                nations: {
                    ...fixturePatches?.nations,
                    1: {
                        ...fixturePatches?.nations?.[1],
                        meta: {
                            ...(flag === null ? {} : { can_무작위수도이전: flag }),
                        },
                        turnLastByOfficerLevel: {
                            [officerLevel]: {
                                command: '무작위 수도 이전',
                                arg: {},
                                term: 1,
                            },
                        },
                    },
                },
                cities: {
                    ...fixturePatches?.cities,
                    3: {
                        conflict: { 2: 10 },
                        officerSet: 7,
                        ...fixturePatches?.cities?.[3],
                    },
                    70: {
                        nationId: 0,
                        level: candidateCityIds.includes(70) ? 5 : 4,
                        conflict: { 2: 20 },
                        officerSet: 5,
                        ...fixturePatches?.cities?.[70],
                    },
                },
                randomFoundingCandidateCityIds: candidateCityIds,
            });
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);
            const referenceNationBefore = reference.before.nations.find((entry) => entry.id === 1);
            const referenceNationAfter = reference.after.nations.find((entry) => entry.id === 1);
            const coreNationBefore = core.before.nations.find((entry) => entry.id === 1);
            const coreNationAfter = core.after.nations.find((entry) => entry.id === 1);
            const referenceGeneralBefore = reference.before.generals.find((entry) => entry.id === 1);
            const referenceGeneralAfter = reference.after.generals.find((entry) => entry.id === 1);
            const coreGeneralBefore = core.before.generals.find((entry) => entry.id === 1);
            const coreGeneralAfter = core.after.generals.find((entry) => entry.id === 1);
            const completed = outcome === 'completed';
            const incomplete = outcome === 'incomplete';

            expect(reference.execution.outcome).toMatchObject({
                // The ref runner infers completion from the previous term=1.
                // A no-candidate run returns false without resetting that term,
                // so its heuristic reports a false positive for incomplete cases.
                completed: outcome !== 'fallback',
            });
            expect(core.execution.outcome).toMatchObject({
                requestedAction: 'che_무작위수도이전',
                actionKey: outcome === 'fallback' ? '휴식' : 'che_무작위수도이전',
                usedFallback: outcome === 'fallback',
                ...(outcome === 'fallback' ? {} : { completed }),
            });
            expect(readNumericField(referenceNationAfter, 'capitalCityId')).toBe(
                completed ? readNumericField(coreNationAfter, 'capitalCityId') : 3
            );
            expect(readNumericField(coreNationAfter, 'capitalCityId')).toBe(
                completed ? readNumericField(referenceNationAfter, 'capitalCityId') : 3
            );
            for (const [before, after] of [
                [referenceGeneralBefore, referenceGeneralAfter],
                [coreGeneralBefore, coreGeneralAfter],
            ] as const) {
                expect(readNumericField(after, 'experience') - readNumericField(before, 'experience')).toBe(
                    completed ? 10 : 0
                );
                expect(readNumericField(after, 'dedication') - readNumericField(before, 'dedication')).toBe(
                    completed ? 10 : 0
                );
            }

            if (completed) {
                const destCityId = readNumericField(referenceNationAfter, 'capitalCityId');
                expect(candidateCityIds).toContain(destCityId);
                for (const [beforeSnapshot, afterSnapshot] of [
                    [reference.before, reference.after],
                    [core.before, core.after],
                ] as const) {
                    const oldCity = afterSnapshot.cities.find((entry) => entry.id === 3);
                    const destCity = afterSnapshot.cities.find((entry) => entry.id === destCityId);
                    const actor = afterSnapshot.generals.find((entry) => entry.id === 1);
                    const compatriot = afterSnapshot.generals.find((entry) => entry.id === 3);
                    const foreignGeneralBefore = beforeSnapshot.generals.find((entry) => entry.id === 2);
                    const foreignGeneralAfter = afterSnapshot.generals.find((entry) => entry.id === 2);

                    expect(oldCity).toMatchObject({
                        nationId: 0,
                        frontState: 0,
                        conflict: {},
                        officerSet: 0,
                    });
                    expect(destCity).toMatchObject({
                        nationId: 1,
                        conflict: {},
                    });
                    expect(readNumericField(actor, 'cityId')).toBe(destCityId);
                    expect(readNumericField(compatriot, 'cityId')).toBe(destCityId);
                    expect(readNumericField(foreignGeneralAfter, 'cityId')).toBe(
                        readNumericField(foreignGeneralBefore, 'cityId')
                    );
                }
                expect(readNumericField(readNationMeta(referenceNationAfter), 'can_무작위수도이전')).toBe(0);
                expect(readNumericField(readNationMeta(coreNationAfter), 'can_무작위수도이전')).toBe(0);
                expect(reference.rng).toHaveLength(1);
                expect(reference.rng[0]).toMatchObject({
                    operation: 'nextInt',
                    arguments: { maxInclusive: candidateCityIds.length - 1 },
                });
            } else {
                expect(reference.rng).toEqual([]);
                expect(readNationMeta(referenceNationAfter).can_무작위수도이전).toBe(
                    readNationMeta(referenceNationBefore).can_무작위수도이전
                );
                expect(readNationMeta(coreNationAfter).can_무작위수도이전).toBe(
                    readNationMeta(coreNationBefore).can_무작위수도이전
                );
            }
            if (incomplete) {
                expect(reference.execution.outcome).toMatchObject({
                    completed: true,
                    lastTurn: {
                        command: '무작위 수도 이전',
                        term: 1,
                    },
                });
                expect(readNationMeta(coreNationAfter).turn_last_12).toMatchObject({
                    command: '무작위 수도 이전',
                    term: 1,
                });
                expect(readNumericField(readGeneralMeta(coreGeneralAfter), 'inherit_active_action')).toBe(
                    readNumericField(readGeneralMeta(coreGeneralBefore), 'inherit_active_action')
                );
                const noCandidateText = '이동할 수 있는 도시가 없습니다.';
                expect(reference.after.logs.slice(reference.before.logs.length).map((entry) => entry.text)).toEqual(
                    expect.arrayContaining([expect.stringContaining(noCandidateText)])
                );
                expect(core.after.logs.map((entry) => entry.text)).toEqual(
                    expect.arrayContaining([expect.stringContaining(noCandidateText)])
                );
            }
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

type ResearchBoundaryOutcome = 'fallback' | 'intermediate' | 'completed';

const researchBoundaryCases: Array<{
    name: string;
    action: 'event_화시병연구' | 'event_원융노병연구';
    term: number;
    gold?: number;
    rice?: number;
    auxValue?: unknown;
    setAuxValue?: boolean;
    fixturePatches?: FixturePatches;
    outcome: ResearchBoundaryOutcome;
}> = [
    {
        name: 'keeps the short research at its last intermediate turn',
        action: 'event_화시병연구',
        term: 10,
        outcome: 'intermediate',
    },
    {
        name: 'keeps the long research at its last intermediate turn',
        action: 'event_원융노병연구',
        term: 22,
        outcome: 'intermediate',
    },
    {
        name: 'allows the exact short-research reserves without supply',
        action: 'event_화시병연구',
        term: 11,
        fixturePatches: { cities: { 3: { supplyState: 0 } } },
        outcome: 'completed',
    },
    {
        name: 'allows the exact long-research reserves',
        action: 'event_원융노병연구',
        term: 23,
        outcome: 'completed',
    },
    {
        name: 'rejects one less than the short gold reserve',
        action: 'event_화시병연구',
        term: 11,
        gold: 49_999,
        outcome: 'fallback',
    },
    {
        name: 'rejects one less than the short rice reserve',
        action: 'event_화시병연구',
        term: 11,
        rice: 51_999,
        outcome: 'fallback',
    },
    {
        name: 'rejects one less than the long gold reserve',
        action: 'event_원융노병연구',
        term: 23,
        gold: 99_999,
        outcome: 'fallback',
    },
    {
        name: 'rejects one less than the long rice reserve',
        action: 'event_원융노병연구',
        term: 23,
        rice: 101_999,
        outcome: 'fallback',
    },
    {
        name: 'rejects a numeric completed flag',
        action: 'event_화시병연구',
        term: 11,
        auxValue: 1,
        setAuxValue: true,
        outcome: 'fallback',
    },
    {
        name: 'rejects a numeric-string completed flag',
        action: 'event_화시병연구',
        term: 11,
        auxValue: '1',
        setAuxValue: true,
        outcome: 'fallback',
    },
    {
        name: 'rejects a boolean completed flag',
        action: 'event_원융노병연구',
        term: 23,
        auxValue: true,
        setAuxValue: true,
        outcome: 'fallback',
    },
    {
        name: 'rejects an array-shaped completed flag',
        action: 'event_원융노병연구',
        term: 23,
        auxValue: [],
        setAuxValue: true,
        outcome: 'fallback',
    },
    {
        name: 'accepts a numeric-string incomplete flag',
        action: 'event_원융노병연구',
        term: 23,
        auxValue: '0',
        setAuxValue: true,
        outcome: 'completed',
    },
];

integration('nation event research turn, reserve, and duplicate-state boundaries', () => {
    it.each(researchBoundaryCases)(
        '$name matches legacy completion, resources, flags, logs, RNG, and semantic delta',
        async ({ action, term, gold, rice, auxValue, setAuxValue = false, fixturePatches, outcome }) => {
            const config = researchConfigs[action]!;
            const requiredGold = config.cost;
            const requiredRice = config.cost + 2_000;
            const request = buildRequest(action, undefined, {
                ...fixturePatches,
                nations: {
                    ...fixturePatches?.nations,
                    1: {
                        ...fixturePatches?.nations?.[1],
                        gold: gold ?? requiredGold,
                        rice: rice ?? requiredRice,
                        meta: {
                            ...(setAuxValue ? { [config.auxKey]: auxValue } : {}),
                        },
                        turnLastByOfficerLevel: {
                            12: {
                                command: config.command,
                                term,
                            },
                        },
                    },
                },
            });
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);
            const completed = outcome === 'completed';
            const intermediate = outcome === 'intermediate';

            expect(reference.execution.outcome).toMatchObject({ completed });
            expect(core.execution.outcome).toMatchObject({
                requestedAction: action,
                actionKey: outcome === 'fallback' ? '휴식' : action,
                usedFallback: outcome === 'fallback',
                ...(outcome === 'fallback' ? {} : { completed }),
            });

            for (const snapshot of [reference, core]) {
                const nationBefore = snapshot.before.nations.find((entry) => entry.id === 1);
                const nationAfter = snapshot.after.nations.find((entry) => entry.id === 1);
                const generalBefore = snapshot.before.generals.find((entry) => entry.id === 1);
                const generalAfter = snapshot.after.generals.find((entry) => entry.id === 1);
                const expectedCost = completed ? config.cost : 0;
                const expectedProgress = completed ? 5 * (config.preReqTurn + 1) : 0;

                expect(readNationResource(nationBefore, 'gold') - readNationResource(nationAfter, 'gold')).toBe(
                    expectedCost
                );
                expect(readNationResource(nationBefore, 'rice') - readNationResource(nationAfter, 'rice')).toBe(
                    expectedCost
                );
                expect(
                    readNumericField(generalAfter, 'experience') - readNumericField(generalBefore, 'experience')
                ).toBe(expectedProgress);
                expect(
                    readNumericField(generalAfter, 'dedication') - readNumericField(generalBefore, 'dedication')
                ).toBe(expectedProgress);

                if (completed) {
                    expect(readNumericField(readNationMeta(nationAfter), config.auxKey)).toBe(1);
                    expect(readNationResource(nationAfter, 'gold')).toBe(0);
                    expect(readNationResource(nationAfter, 'rice')).toBe(2_000);
                    expect(snapshot.after.logs.map((entry) => entry.text)).toEqual(
                        expect.arrayContaining([expect.stringContaining(`<M>${config.command}</> 완료`)])
                    );
                } else {
                    expect(readNationMeta(nationAfter)[config.auxKey]).toEqual(
                        readNationMeta(nationBefore)[config.auxKey]
                    );
                }
            }

            if (intermediate) {
                expect(reference.execution.outcome).toMatchObject({
                    lastTurn: {
                        command: config.command,
                        term: config.preReqTurn,
                    },
                });
                expect(readNationMeta(core.after.nations.find((entry) => entry.id === 1)).turn_last_12).toMatchObject({
                    command: config.command,
                    term: config.preReqTurn,
                });
            }
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

const mobilizePeopleBoundaryCases: Array<{
    name: string;
    destCityId: unknown;
    fixturePatches?: FixturePatches;
    completed?: boolean;
    coreResolution?: boolean;
    expectedDefence?: number;
    expectedWall?: number;
    expectedStrategicCommandLimit?: number;
    expectedPostReqTurn?: number;
}> = [
    {
        name: 'rejects a missing destination city',
        destCityId: 9999,
    },
    {
        name: 'accepts a numeric string destination city ID',
        destCityId: '70',
        completed: true,
        expectedPostReqTurn: 63,
    },
    {
        name: 'rejects a source city occupied by another nation',
        destCityId: 70,
        fixturePatches: { cities: { 3: { nationId: 2 } } },
    },
    {
        name: 'rejects a destination city occupied by another nation',
        destCityId: 70,
        fixturePatches: { cities: { 70: { nationId: 2 } } },
    },
    {
        name: 'rejects an actor below chief rank',
        destCityId: 70,
        fixturePatches: { generals: { 1: { officerLevel: 4, officerCityId: 0 } } },
        coreResolution: false,
    },
    {
        name: 'rejects a remaining strategic-command delay',
        destCityId: 70,
        fixturePatches: { nations: { 1: { strategicCommandLimit: 1 } } },
    },
    {
        name: 'allows an unsupplied source city',
        destCityId: 70,
        fixturePatches: { cities: { 3: { supplyState: 0 } } },
        completed: true,
        expectedPostReqTurn: 63,
    },
    {
        name: 'allows an unsupplied destination city',
        destCityId: 70,
        fixturePatches: { cities: { 70: { supplyState: 0 } } },
        completed: true,
        expectedPostReqTurn: 63,
    },
    {
        name: 'allows the actor city as destination',
        destCityId: 3,
        completed: true,
        expectedPostReqTurn: 63,
    },
    {
        name: 'rounds the 80-percent defence and wall floors like MariaDB',
        destCityId: 70,
        fixturePatches: {
            cities: {
                70: {
                    defence: 1_000,
                    defenceMax: 5_001,
                    wall: 1_000,
                    wallMax: 5_001,
                },
            },
        },
        completed: true,
        expectedDefence: 4_001,
        expectedWall: 4_001,
        expectedPostReqTurn: 63,
    },
    {
        name: 'preserves defence and wall already above their 80-percent floors',
        destCityId: 70,
        fixturePatches: {
            cities: {
                70: {
                    defence: 4_500,
                    defenceMax: 5_000,
                    wall: 4_600,
                    wallMax: 5_000,
                },
            },
        },
        completed: true,
        expectedDefence: 4_500,
        expectedWall: 4_600,
        expectedPostReqTurn: 63,
    },
    {
        name: 'applies the strategist global-delay modifier',
        destCityId: 70,
        fixturePatches: { nations: { 1: { typeCode: 'che_종횡가' } } },
        completed: true,
        expectedStrategicCommandLimit: 5,
        expectedPostReqTurn: 47,
    },
    {
        name: 'uses the actual eleven-general count for the nation cooldown',
        destCityId: 70,
        fixturePatches: {
            nations: { 1: { generalCount: 11 } },
            generals: {
                4: { nationId: 1 },
                5: { nationId: 1 },
                6: { nationId: 1 },
                7: { nationId: 1 },
                8: { nationId: 1 },
                9: { nationId: 1 },
                10: { nationId: 1 },
                11: { nationId: 1 },
                12: { nationId: 1 },
            },
        },
        completed: true,
        expectedPostReqTurn: 66,
    },
];

integration('nation mobilize-people target, delay, and city-effect boundaries', () => {
    it.each(mobilizePeopleBoundaryCases)(
        '$name matches legacy fallback, cooldown, effects, logs, RNG, and semantic delta',
        async ({
            destCityId,
            fixturePatches,
            completed = false,
            coreResolution = true,
            expectedDefence,
            expectedWall,
            expectedStrategicCommandLimit = 9,
            expectedPostReqTurn,
        }) => {
            const request = buildRequest(
                'che_백성동원',
                { destCityID: destCityId },
                {
                    ...fixturePatches,
                    cities: {
                        ...fixturePatches?.cities,
                        70: {
                            nationId: 1,
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
            const targetCityId = destCityId === 3 ? 3 : 70;

            expect(reference.execution.outcome).toMatchObject({ completed });
            if (coreResolution) {
                expect(core.execution.outcome).toMatchObject({
                    requestedAction: 'che_백성동원',
                    actionKey: completed ? 'che_백성동원' : '휴식',
                    usedFallback: !completed,
                });
            } else {
                expect(core.execution.outcome).toBeUndefined();
            }

            for (const snapshot of [reference, core]) {
                const nationBefore = snapshot.before.nations.find((entry) => entry.id === 1);
                const nationAfter = snapshot.after.nations.find((entry) => entry.id === 1);
                const generalBefore = snapshot.before.generals.find((entry) => entry.id === 1);
                const generalAfter = snapshot.after.generals.find((entry) => entry.id === 1);
                const cityBefore = snapshot.before.cities.find((entry) => entry.id === targetCityId);
                const cityAfter = snapshot.after.cities.find((entry) => entry.id === targetCityId);

                expect(readNationResource(nationBefore, 'gold') - readNationResource(nationAfter, 'gold')).toBe(0);
                expect(readNationResource(nationBefore, 'rice') - readNationResource(nationAfter, 'rice')).toBe(0);
                expect(
                    readNumericField(generalAfter, 'experience') - readNumericField(generalBefore, 'experience')
                ).toBe(completed ? 5 : 0);
                expect(
                    readNumericField(generalAfter, 'dedication') - readNumericField(generalBefore, 'dedication')
                ).toBe(completed ? 5 : 0);

                if (completed) {
                    expect(readNumericField(nationAfter, 'strategicCommandLimit')).toBe(expectedStrategicCommandLimit);
                    if (expectedDefence !== undefined) {
                        expect(readNumericField(cityAfter, 'defence')).toBe(expectedDefence);
                    }
                    if (expectedWall !== undefined) {
                        expect(readNumericField(cityAfter, 'wall')).toBe(expectedWall);
                    }
                    const addedLogs = snapshot.after.logs.slice(snapshot.before.logs.length);
                    expect(addedLogs.map((entry) => entry.text)).toEqual(
                        expect.arrayContaining([expect.stringContaining('백성동원 발동')])
                    );
                    const broadcastFragment = '<M>백성동원</>을 하였습니다.';
                    expect(
                        addedLogs.some(
                            (entry) => entry.generalId === 3 && String(entry.text).includes(broadcastFragment)
                        )
                    ).toBe(true);
                    expect(
                        addedLogs.some(
                            (entry) => entry.generalId === 2 && String(entry.text).includes(broadcastFragment)
                        )
                    ).toBe(false);
                    expect(addedLogs.some((entry) => String(entry.text).includes('에 <M>백성동원</>을 발동'))).toBe(
                        true
                    );
                } else {
                    expect(readNumericField(nationAfter, 'strategicCommandLimit')).toBe(
                        readNumericField(nationBefore, 'strategicCommandLimit')
                    );
                    expect(readNumericField(cityAfter, 'defence')).toBe(readNumericField(cityBefore, 'defence'));
                    expect(readNumericField(cityAfter, 'wall')).toBe(readNumericField(cityBefore, 'wall'));
                }
            }

            if (completed) {
                const expectedNextAvailableTurn = 190 * 12 + expectedPostReqTurn!;
                if (expectedPostReqTurn === 66) {
                    expect(reference.before.generals.filter((entry) => entry.nationId === 1)).toHaveLength(11);
                    expect(core.before.generals.filter((entry) => entry.nationId === 1)).toHaveLength(11);
                }
                expect(reference.after.world.nationCooldowns).toEqual([
                    {
                        nationId: 1,
                        actionName: '백성동원',
                        nextAvailableTurn: expectedNextAvailableTurn,
                    },
                ]);
                expect(core.after.world.nationCooldowns).toEqual(reference.after.world.nationCooldowns);
            }
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

const degradeRelationsBoundaryCases: Array<{
    name: string;
    destNationId: unknown;
    fixturePatches?: FixturePatches;
    completed?: boolean;
    coreResolution?: boolean;
    expectedForwardTerm?: number;
    expectedReverseTerm?: number;
    expectedSourceFront?: number;
    expectedDestFront?: number;
    expectedStrategicCommandLimit?: number;
    expectedPostReqTurn?: number;
}> = [
    {
        name: 'rejects a missing destination nation',
        destNationId: 99,
    },
    {
        name: 'rejects the source nation as destination',
        destNationId: 1,
    },
    {
        name: 'rejects a numeric string destination nation ID',
        destNationId: '2',
    },
    {
        name: 'rejects a fractional destination nation ID',
        destNationId: 2.9,
    },
    {
        name: 'rejects a source city occupied by another nation',
        destNationId: 2,
        fixturePatches: {
            cities: { 3: { nationId: 2 } },
            diplomacy: { '1:2': { state: 1, term: 12 } },
        },
    },
    {
        name: 'rejects an actor below chief rank',
        destNationId: 2,
        fixturePatches: {
            generals: { 1: { officerLevel: 4, officerCityId: 0 } },
            diplomacy: { '1:2': { state: 1, term: 12 } },
        },
        coreResolution: false,
    },
    {
        name: 'rejects a remaining strategic-command delay',
        destNationId: 2,
        fixturePatches: {
            nations: { 1: { strategicCommandLimit: 1 } },
            diplomacy: { '1:2': { state: 1, term: 12 } },
        },
    },
    {
        name: 'allows an unsupplied source city',
        destNationId: 2,
        fixturePatches: {
            cities: { 3: { supplyState: 0 } },
            diplomacy: {
                '1:2': { state: 1, term: 12 },
                '2:1': { state: 1, term: 12 },
            },
        },
        completed: true,
        expectedForwardTerm: 15,
        expectedReverseTerm: 15,
        expectedSourceFront: 2,
        expectedDestFront: 2,
        expectedPostReqTurn: 126,
    },
    {
        name: 'resets both war terms to three and refreshes both fronts',
        destNationId: 2,
        fixturePatches: {
            diplomacy: {
                '1:2': { state: 0, term: 12 },
                '2:1': { state: 0, term: 8 },
            },
        },
        completed: true,
        expectedForwardTerm: 3,
        expectedReverseTerm: 3,
        expectedSourceFront: 1,
        expectedDestFront: 1,
        expectedPostReqTurn: 126,
    },
    {
        name: 'keeps declaration fronts at the exact five-term boundary',
        destNationId: 2,
        fixturePatches: {
            diplomacy: {
                '1:2': { state: 1, term: 2 },
                '2:1': { state: 1, term: 2 },
            },
        },
        completed: true,
        expectedForwardTerm: 5,
        expectedReverseTerm: 5,
        expectedSourceFront: 1,
        expectedDestFront: 1,
        expectedPostReqTurn: 126,
    },
    {
        name: 'updates a disallowed reverse state independently',
        destNationId: 2,
        fixturePatches: {
            diplomacy: {
                '1:2': { state: 1, term: 4 },
                '2:1': { state: 2, term: 9 },
            },
        },
        completed: true,
        expectedForwardTerm: 7,
        expectedReverseTerm: 12,
        expectedSourceFront: 2,
        expectedDestFront: 2,
        expectedPostReqTurn: 126,
    },
    {
        name: 'applies the strategist command and global-delay modifiers',
        destNationId: 2,
        fixturePatches: {
            nations: { 1: { typeCode: 'che_종횡가' } },
            diplomacy: {
                '1:2': { state: 1, term: 12 },
                '2:1': { state: 1, term: 12 },
            },
        },
        completed: true,
        expectedForwardTerm: 15,
        expectedReverseTerm: 15,
        expectedSourceFront: 2,
        expectedDestFront: 2,
        expectedStrategicCommandLimit: 5,
        expectedPostReqTurn: 95,
    },
    {
        name: 'uses the actual eleven-general count for the nation cooldown',
        destNationId: 2,
        fixturePatches: {
            nations: { 1: { generalCount: 11 } },
            generals: {
                4: { nationId: 1 },
                5: { nationId: 1 },
                6: { nationId: 1 },
                7: { nationId: 1 },
                8: { nationId: 1 },
                9: { nationId: 1 },
                10: { nationId: 1 },
                11: { nationId: 1 },
                12: { nationId: 1 },
            },
            diplomacy: {
                '1:2': { state: 1, term: 12 },
                '2:1': { state: 1, term: 12 },
            },
        },
        completed: true,
        expectedForwardTerm: 15,
        expectedReverseTerm: 15,
        expectedSourceFront: 2,
        expectedDestFront: 2,
        expectedPostReqTurn: 133,
    },
];

integration('nation degrade-relations target, diplomacy, front, and cooldown boundaries', () => {
    it.each(degradeRelationsBoundaryCases)(
        '$name matches legacy fallback, diplomacy, fronts, cooldown, logs, RNG, and semantic delta',
        async ({
            destNationId,
            fixturePatches,
            completed = false,
            coreResolution = true,
            expectedForwardTerm,
            expectedReverseTerm,
            expectedSourceFront,
            expectedDestFront,
            expectedStrategicCommandLimit = 9,
            expectedPostReqTurn,
        }) => {
            const request = buildRequest('che_이호경식', { destNationID: destNationId }, fixturePatches);
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);

            expect(reference.execution.outcome).toMatchObject({ completed });
            if (coreResolution) {
                expect(core.execution.outcome).toMatchObject({
                    requestedAction: 'che_이호경식',
                    actionKey: completed ? 'che_이호경식' : '휴식',
                    usedFallback: !completed,
                });
            } else {
                expect(core.execution.outcome).toBeUndefined();
            }

            for (const snapshot of [reference, core]) {
                const nationBefore = snapshot.before.nations.find((entry) => entry.id === 1);
                const nationAfter = snapshot.after.nations.find((entry) => entry.id === 1);
                const generalBefore = snapshot.before.generals.find((entry) => entry.id === 1);
                const generalAfter = snapshot.after.generals.find((entry) => entry.id === 1);
                const sourceCityBefore = snapshot.before.cities.find((entry) => entry.id === 3);
                const sourceCityAfter = snapshot.after.cities.find((entry) => entry.id === 3);
                const destCityBefore = snapshot.before.cities.find((entry) => entry.id === 70);
                const destCityAfter = snapshot.after.cities.find((entry) => entry.id === 70);
                const forwardBefore = snapshot.before.diplomacy.find(
                    (entry) => entry.fromNationId === 1 && entry.toNationId === 2
                );
                const forwardAfter = snapshot.after.diplomacy.find(
                    (entry) => entry.fromNationId === 1 && entry.toNationId === 2
                );
                const reverseBefore = snapshot.before.diplomacy.find(
                    (entry) => entry.fromNationId === 2 && entry.toNationId === 1
                );
                const reverseAfter = snapshot.after.diplomacy.find(
                    (entry) => entry.fromNationId === 2 && entry.toNationId === 1
                );

                expect(readNationResource(nationBefore, 'gold') - readNationResource(nationAfter, 'gold')).toBe(0);
                expect(readNationResource(nationBefore, 'rice') - readNationResource(nationAfter, 'rice')).toBe(0);
                expect(
                    readNumericField(generalAfter, 'experience') - readNumericField(generalBefore, 'experience')
                ).toBe(completed ? 5 : 0);
                expect(
                    readNumericField(generalAfter, 'dedication') - readNumericField(generalBefore, 'dedication')
                ).toBe(completed ? 5 : 0);

                if (completed) {
                    expect(readNumericField(nationAfter, 'strategicCommandLimit')).toBe(expectedStrategicCommandLimit);
                    expect(readNumericField(forwardAfter, 'state')).toBe(1);
                    expect(readNumericField(reverseAfter, 'state')).toBe(1);
                    expect(readNumericField(forwardAfter, 'term')).toBe(expectedForwardTerm);
                    expect(readNumericField(reverseAfter, 'term')).toBe(expectedReverseTerm);
                    expect(readNumericField(sourceCityAfter, 'frontState')).toBe(expectedSourceFront);
                    expect(readNumericField(destCityAfter, 'frontState')).toBe(expectedDestFront);

                    const addedLogs = snapshot.after.logs.slice(snapshot.before.logs.length);
                    expect(addedLogs.map((entry) => entry.text)).toEqual(
                        expect.arrayContaining([expect.stringContaining('이호경식 발동')])
                    );
                    expect(
                        addedLogs.some((entry) => entry.generalId === 3 && String(entry.text).includes('이호경식'))
                    ).toBe(true);
                    expect(
                        addedLogs.some(
                            (entry) =>
                                entry.generalId === 2 &&
                                String(entry.text).includes('아국에 <M>이호경식</>을 발동하였습니다.')
                        )
                    ).toBe(true);
                } else {
                    expect(readNumericField(nationAfter, 'strategicCommandLimit')).toBe(
                        readNumericField(nationBefore, 'strategicCommandLimit')
                    );
                    expect(forwardAfter).toEqual(forwardBefore);
                    expect(reverseAfter).toEqual(reverseBefore);
                    expect(readNumericField(sourceCityAfter, 'frontState')).toBe(
                        readNumericField(sourceCityBefore, 'frontState')
                    );
                    expect(readNumericField(destCityAfter, 'frontState')).toBe(
                        readNumericField(destCityBefore, 'frontState')
                    );
                }
            }

            if (completed) {
                const expectedNextAvailableTurn = 190 * 12 + expectedPostReqTurn!;
                expect(reference.after.world.nationCooldowns).toEqual([
                    {
                        nationId: 1,
                        actionName: '이호경식',
                        nextAvailableTurn: expectedNextAvailableTurn,
                    },
                ]);
                expect(core.after.world.nationCooldowns).toEqual(reference.after.world.nationCooldowns);
            }
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

const surpriseAttackBoundaryCases: Array<{
    name: string;
    destNationId: unknown;
    fixturePatches?: FixturePatches;
    completed?: boolean;
    coreResolution?: boolean;
    expectedForwardState?: number;
    expectedReverseState?: number;
    expectedForwardTerm?: number;
    expectedReverseTerm?: number;
    expectedSourceFront?: number;
    expectedDestFront?: number;
    expectedStrategicCommandLimit?: number;
    expectedPostReqTurn?: number;
    expectedDestLogGeneralId?: number;
}> = [
    {
        name: 'rejects a missing destination nation',
        destNationId: 99,
    },
    {
        name: 'rejects a numeric string destination nation ID',
        destNationId: '2',
    },
    {
        name: 'rejects a fractional destination nation ID',
        destNationId: 2.9,
    },
    {
        name: 'rejects a source city occupied by another nation',
        destNationId: 2,
        fixturePatches: {
            cities: { 3: { nationId: 2 } },
            diplomacy: { '1:2': { state: 1, term: 12 } },
        },
    },
    {
        name: 'rejects an actor below chief rank',
        destNationId: 2,
        fixturePatches: {
            generals: { 1: { officerLevel: 4, officerCityId: 0 } },
            diplomacy: { '1:2': { state: 1, term: 12 } },
        },
        coreResolution: false,
    },
    {
        name: 'rejects a remaining strategic-command delay',
        destNationId: 2,
        fixturePatches: {
            nations: { 1: { strategicCommandLimit: 1 } },
            diplomacy: { '1:2': { state: 1, term: 12 } },
        },
    },
    {
        name: 'rejects a forward diplomacy state other than declaration',
        destNationId: 2,
        fixturePatches: {
            diplomacy: { '1:2': { state: 0, term: 12 } },
        },
    },
    {
        name: 'rejects declaration term eleven at the lower boundary',
        destNationId: 2,
        fixturePatches: {
            diplomacy: { '1:2': { state: 1, term: 11 } },
        },
    },
    {
        name: 'allows an unsupplied source city and preserves both fronts',
        destNationId: 2,
        fixturePatches: {
            cities: {
                3: { supplyState: 0, frontState: 2 },
                70: { frontState: 3 },
            },
            diplomacy: {
                '1:2': { state: 1, term: 12 },
                '2:1': { state: 1, term: 12 },
            },
        },
        completed: true,
        expectedForwardState: 1,
        expectedReverseState: 1,
        expectedForwardTerm: 9,
        expectedReverseTerm: 9,
        expectedSourceFront: 2,
        expectedDestFront: 3,
        expectedPostReqTurn: 126,
    },
    {
        name: 'subtracts three from a disallowed reverse state into a negative term',
        destNationId: 2,
        fixturePatches: {
            diplomacy: {
                '1:2': { state: 1, term: 15 },
                '2:1': { state: 2, term: 2 },
            },
        },
        completed: true,
        expectedForwardState: 1,
        expectedReverseState: 2,
        expectedForwardTerm: 12,
        expectedReverseTerm: -1,
        expectedSourceFront: 0,
        expectedDestFront: 1,
        expectedPostReqTurn: 126,
    },
    {
        name: 'allows the source nation when a self-diplomacy row is present',
        destNationId: 1,
        fixturePatches: {
            diplomacy: {
                '1:1': { state: 1, term: 12 },
            },
        },
        completed: true,
        expectedForwardState: 1,
        expectedReverseState: 1,
        expectedForwardTerm: 9,
        expectedReverseTerm: 9,
        expectedSourceFront: 0,
        expectedDestFront: 0,
        expectedPostReqTurn: 126,
        expectedDestLogGeneralId: 1,
    },
    {
        name: 'applies the strategist command and global-delay modifiers',
        destNationId: 2,
        fixturePatches: {
            nations: { 1: { typeCode: 'che_종횡가' } },
            diplomacy: {
                '1:2': { state: 1, term: 12 },
                '2:1': { state: 1, term: 12 },
            },
        },
        completed: true,
        expectedForwardState: 1,
        expectedReverseState: 1,
        expectedForwardTerm: 9,
        expectedReverseTerm: 9,
        expectedSourceFront: 0,
        expectedDestFront: 1,
        expectedStrategicCommandLimit: 5,
        expectedPostReqTurn: 95,
    },
    {
        name: 'uses the actual eleven-general count for the nation cooldown',
        destNationId: 2,
        fixturePatches: {
            nations: { 1: { generalCount: 11 } },
            generals: {
                4: { nationId: 1 },
                5: { nationId: 1 },
                6: { nationId: 1 },
                7: { nationId: 1 },
                8: { nationId: 1 },
                9: { nationId: 1 },
                10: { nationId: 1 },
                11: { nationId: 1 },
                12: { nationId: 1 },
            },
            diplomacy: {
                '1:2': { state: 1, term: 12 },
                '2:1': { state: 1, term: 12 },
            },
        },
        completed: true,
        expectedForwardState: 1,
        expectedReverseState: 1,
        expectedForwardTerm: 9,
        expectedReverseTerm: 9,
        expectedSourceFront: 0,
        expectedDestFront: 1,
        expectedPostReqTurn: 133,
    },
];

integration('nation surprise-attack target, diplomacy-term, front, and cooldown boundaries', () => {
    it.each(surpriseAttackBoundaryCases)(
        '$name matches legacy fallback, diplomacy, fronts, cooldown, logs, RNG, and semantic delta',
        async ({
            destNationId,
            fixturePatches,
            completed = false,
            coreResolution = true,
            expectedForwardState,
            expectedReverseState,
            expectedForwardTerm,
            expectedReverseTerm,
            expectedSourceFront,
            expectedDestFront,
            expectedStrategicCommandLimit = 9,
            expectedPostReqTurn,
            expectedDestLogGeneralId = 2,
        }) => {
            const request = buildRequest('che_급습', { destNationID: destNationId }, fixturePatches);
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);

            expect(reference.execution.outcome).toMatchObject({ completed });
            if (coreResolution) {
                expect(core.execution.outcome).toMatchObject({
                    requestedAction: 'che_급습',
                    actionKey: completed ? 'che_급습' : '휴식',
                    usedFallback: !completed,
                });
            } else {
                expect(core.execution.outcome).toBeUndefined();
            }

            for (const snapshot of [reference, core]) {
                const actualDestNationId = destNationId === 1 ? 1 : 2;
                const actualDestCityId = actualDestNationId === 1 ? 3 : 70;
                const nationBefore = snapshot.before.nations.find((entry) => entry.id === 1);
                const nationAfter = snapshot.after.nations.find((entry) => entry.id === 1);
                const generalBefore = snapshot.before.generals.find((entry) => entry.id === 1);
                const generalAfter = snapshot.after.generals.find((entry) => entry.id === 1);
                const sourceCityBefore = snapshot.before.cities.find((entry) => entry.id === 3);
                const sourceCityAfter = snapshot.after.cities.find((entry) => entry.id === 3);
                const destCityBefore = snapshot.before.cities.find((entry) => entry.id === actualDestCityId);
                const destCityAfter = snapshot.after.cities.find((entry) => entry.id === actualDestCityId);
                const forwardBefore = snapshot.before.diplomacy.find(
                    (entry) => entry.fromNationId === 1 && entry.toNationId === actualDestNationId
                );
                const forwardAfter = snapshot.after.diplomacy.find(
                    (entry) => entry.fromNationId === 1 && entry.toNationId === actualDestNationId
                );
                const reverseBefore = snapshot.before.diplomacy.find(
                    (entry) => entry.fromNationId === actualDestNationId && entry.toNationId === 1
                );
                const reverseAfter = snapshot.after.diplomacy.find(
                    (entry) => entry.fromNationId === actualDestNationId && entry.toNationId === 1
                );

                expect(readNationResource(nationBefore, 'gold') - readNationResource(nationAfter, 'gold')).toBe(0);
                expect(readNationResource(nationBefore, 'rice') - readNationResource(nationAfter, 'rice')).toBe(0);
                expect(
                    readNumericField(generalAfter, 'experience') - readNumericField(generalBefore, 'experience')
                ).toBe(completed ? 5 : 0);
                expect(
                    readNumericField(generalAfter, 'dedication') - readNumericField(generalBefore, 'dedication')
                ).toBe(completed ? 5 : 0);

                if (completed) {
                    expect(readNumericField(nationAfter, 'strategicCommandLimit')).toBe(expectedStrategicCommandLimit);
                    expect(readNumericField(forwardAfter, 'state')).toBe(expectedForwardState);
                    expect(readNumericField(reverseAfter, 'state')).toBe(expectedReverseState);
                    expect(readNumericField(forwardAfter, 'term')).toBe(expectedForwardTerm);
                    expect(readNumericField(reverseAfter, 'term')).toBe(expectedReverseTerm);
                    expect(readNumericField(sourceCityAfter, 'frontState')).toBe(expectedSourceFront);
                    expect(readNumericField(destCityAfter, 'frontState')).toBe(expectedDestFront);

                    const addedLogs = snapshot.after.logs.slice(snapshot.before.logs.length);
                    expect(addedLogs.map((entry) => entry.text)).toEqual(
                        expect.arrayContaining([expect.stringContaining('급습 발동')])
                    );
                    expect(
                        addedLogs.some((entry) => entry.generalId === 3 && String(entry.text).includes('급습'))
                    ).toBe(true);
                    expect(
                        addedLogs.some(
                            (entry) =>
                                entry.generalId === expectedDestLogGeneralId &&
                                String(entry.text).includes('아국에 <M>급습</>이 발동되었습니다.')
                        )
                    ).toBe(true);
                } else {
                    expect(readNumericField(nationAfter, 'strategicCommandLimit')).toBe(
                        readNumericField(nationBefore, 'strategicCommandLimit')
                    );
                    expect(forwardAfter).toEqual(forwardBefore);
                    expect(reverseAfter).toEqual(reverseBefore);
                    expect(readNumericField(sourceCityAfter, 'frontState')).toBe(
                        readNumericField(sourceCityBefore, 'frontState')
                    );
                    expect(readNumericField(destCityAfter, 'frontState')).toBe(
                        readNumericField(destCityBefore, 'frontState')
                    );
                }
            }

            if (completed) {
                const expectedNextAvailableTurn = 190 * 12 + expectedPostReqTurn!;
                expect(reference.after.world.nationCooldowns).toEqual([
                    {
                        nationId: 1,
                        actionName: '급습',
                        nextAvailableTurn: expectedNextAvailableTurn,
                    },
                ]);
                expect(core.after.world.nationCooldowns).toEqual(reference.after.world.nationCooldowns);
            }
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

const desperateSurvivalBoundaryCases: Array<{
    name: string;
    fixturePatches?: FixturePatches;
    outcome: 'fallback' | 'intermediate' | 'completed';
    coreResolution?: boolean;
    expectedLastTerm?: number;
    expectedStrategicCommandLimit?: number;
    expectedPostReqTurn?: number;
}> = [
    {
        name: 'rejects a nation without an outgoing war',
        outcome: 'fallback',
    },
    {
        name: 'rejects a reverse-only war',
        fixturePatches: {
            diplomacy: {
                '1:2': { state: 3 },
                '2:1': { state: 0 },
            },
        },
        outcome: 'fallback',
    },
    {
        name: 'rejects a source city occupied by another nation',
        fixturePatches: {
            cities: { 3: { nationId: 2 } },
            diplomacy: { '1:2': { state: 0 } },
        },
        outcome: 'fallback',
    },
    {
        name: 'rejects an actor below chief rank',
        fixturePatches: {
            generals: { 1: { officerLevel: 4, officerCityId: 0 } },
            diplomacy: { '1:2': { state: 0 } },
        },
        outcome: 'fallback',
        coreResolution: false,
    },
    {
        name: 'rejects a remaining strategic-command delay',
        fixturePatches: {
            nations: { 1: { strategicCommandLimit: 1 } },
            diplomacy: { '1:2': { state: 0 } },
        },
        outcome: 'fallback',
    },
    {
        name: 'allows an unsupplied city at the first intermediate turn',
        fixturePatches: {
            cities: { 3: { supplyState: 0 } },
            diplomacy: { '1:2': { state: 0 } },
        },
        outcome: 'intermediate',
        expectedLastTerm: 1,
    },
    {
        name: 'advances the second intermediate turn without side effects',
        fixturePatches: {
            nations: {
                1: {
                    turnLastByOfficerLevel: {
                        12: { command: '필사즉생', arg: {}, term: 1 },
                    },
                },
            },
            diplomacy: { '1:2': { state: 0 } },
        },
        outcome: 'intermediate',
        expectedLastTerm: 2,
    },
    {
        name: 'completes with an outgoing war even when the reverse relation is trade',
        fixturePatches: {
            nations: {
                1: {
                    turnLastByOfficerLevel: {
                        12: { command: '필사즉생', arg: {}, term: 2 },
                    },
                },
            },
            diplomacy: {
                '1:2': { state: 0, term: 0 },
                '2:1': { state: 3, term: 0 },
            },
        },
        outcome: 'completed',
        expectedPostReqTurn: 87,
    },
    {
        name: 'preserves training and morale values already above one hundred',
        fixturePatches: {
            generals: {
                1: { train: 120, atmos: 110 },
                3: { train: 105, atmos: 130 },
            },
            nations: {
                1: {
                    turnLastByOfficerLevel: {
                        12: { command: '필사즉생', arg: {}, term: 2 },
                    },
                },
            },
            diplomacy: { '1:2': { state: 0 } },
        },
        outcome: 'completed',
        expectedPostReqTurn: 87,
    },
    {
        name: 'accepts an explicit self-war as the outgoing war relation',
        fixturePatches: {
            nations: {
                1: {
                    turnLastByOfficerLevel: {
                        12: { command: '필사즉생', arg: {}, term: 2 },
                    },
                },
            },
            diplomacy: {
                '1:1': { state: 0 },
            },
        },
        outcome: 'completed',
        expectedPostReqTurn: 87,
    },
    {
        name: 'restarts at term one after a different command interrupted the stack',
        fixturePatches: {
            nations: {
                1: {
                    turnLastByOfficerLevel: {
                        12: { command: '급습', arg: { destNationID: 2 }, term: 2 },
                    },
                },
            },
            diplomacy: { '1:2': { state: 0 } },
        },
        outcome: 'intermediate',
        expectedLastTerm: 1,
    },
    {
        name: 'applies the strategist command and global-delay modifiers',
        fixturePatches: {
            nations: {
                1: {
                    typeCode: 'che_종횡가',
                    turnLastByOfficerLevel: {
                        12: { command: '필사즉생', arg: {}, term: 2 },
                    },
                },
            },
            diplomacy: { '1:2': { state: 0 } },
        },
        outcome: 'completed',
        expectedStrategicCommandLimit: 5,
        expectedPostReqTurn: 65,
    },
    {
        name: 'uses the actual eleven-general count for the nation cooldown',
        fixturePatches: {
            nations: {
                1: {
                    generalCount: 11,
                    turnLastByOfficerLevel: {
                        12: { command: '필사즉생', arg: {}, term: 2 },
                    },
                },
            },
            generals: {
                4: { nationId: 1 },
                5: { nationId: 1 },
                6: { nationId: 1 },
                7: { nationId: 1 },
                8: { nationId: 1 },
                9: { nationId: 1 },
                10: { nationId: 1 },
                11: { nationId: 1 },
                12: { nationId: 1 },
            },
            diplomacy: { '1:2': { state: 0 } },
        },
        outcome: 'completed',
        expectedPostReqTurn: 92,
    },
];

integration('nation desperate-survival multistep, diplomacy, effects, and cooldown boundaries', () => {
    it.each(desperateSurvivalBoundaryCases)(
        '$name matches legacy progress, effects, cooldown, logs, RNG, and semantic delta',
        async ({
            fixturePatches,
            outcome,
            coreResolution = true,
            expectedLastTerm,
            expectedStrategicCommandLimit = 9,
            expectedPostReqTurn,
        }) => {
            const request = buildRequest('che_필사즉생', undefined, fixturePatches);
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);
            const completed = outcome === 'completed';
            const fallback = outcome === 'fallback';

            expect(reference.execution.outcome).toMatchObject({ completed });
            if (coreResolution) {
                expect(core.execution.outcome).toMatchObject({
                    requestedAction: 'che_필사즉생',
                    actionKey: fallback ? '휴식' : 'che_필사즉생',
                    usedFallback: fallback,
                    ...(fallback ? {} : { completed }),
                });
            } else {
                expect(core.execution.outcome).toBeUndefined();
            }

            for (const snapshot of [reference, core]) {
                const nationBefore = snapshot.before.nations.find((entry) => entry.id === 1);
                const nationAfter = snapshot.after.nations.find((entry) => entry.id === 1);
                const actorBefore = snapshot.before.generals.find((entry) => entry.id === 1);
                const actorAfter = snapshot.after.generals.find((entry) => entry.id === 1);
                const teammateBefore = snapshot.before.generals.find((entry) => entry.id === 3);
                const teammateAfter = snapshot.after.generals.find((entry) => entry.id === 3);
                const foreignBefore = snapshot.before.generals.find((entry) => entry.id === 2);
                const foreignAfter = snapshot.after.generals.find((entry) => entry.id === 2);

                expect(readNationResource(nationBefore, 'gold') - readNationResource(nationAfter, 'gold')).toBe(0);
                expect(readNationResource(nationBefore, 'rice') - readNationResource(nationAfter, 'rice')).toBe(0);
                expect(readNumericField(actorAfter, 'experience') - readNumericField(actorBefore, 'experience')).toBe(
                    completed ? 15 : 0
                );
                expect(readNumericField(actorAfter, 'dedication') - readNumericField(actorBefore, 'dedication')).toBe(
                    completed ? 15 : 0
                );
                expect(readNumericField(nationAfter, 'strategicCommandLimit')).toBe(
                    completed ? expectedStrategicCommandLimit : readNumericField(nationBefore, 'strategicCommandLimit')
                );

                for (const [before, after] of [
                    [actorBefore, actorAfter],
                    [teammateBefore, teammateAfter],
                ] as const) {
                    expect(readNumericField(after, 'train')).toBe(
                        completed ? Math.max(100, readNumericField(before, 'train')) : readNumericField(before, 'train')
                    );
                    expect(readNumericField(after, 'atmos')).toBe(
                        completed ? Math.max(100, readNumericField(before, 'atmos')) : readNumericField(before, 'atmos')
                    );
                }
                expect(readNumericField(foreignAfter, 'train')).toBe(readNumericField(foreignBefore, 'train'));
                expect(readNumericField(foreignAfter, 'atmos')).toBe(readNumericField(foreignBefore, 'atmos'));

                if (completed) {
                    const addedLogs = snapshot.after.logs.slice(snapshot.before.logs.length);
                    expect(addedLogs.map((entry) => entry.text)).toEqual(
                        expect.arrayContaining([expect.stringContaining('필사즉생 발동')])
                    );
                    expect(
                        addedLogs.some((entry) => entry.generalId === 3 && String(entry.text).includes('필사즉생'))
                    ).toBe(true);
                }
            }

            if (outcome === 'intermediate') {
                expect(reference.execution.outcome).toMatchObject({
                    lastTurn: {
                        command: '필사즉생',
                        term: expectedLastTerm,
                    },
                });
                expect(readNationMeta(core.after.nations.find((entry) => entry.id === 1)).turn_last_12).toMatchObject({
                    command: '필사즉생',
                    term: expectedLastTerm,
                });
            }
            if (completed) {
                const expectedNextAvailableTurn = 190 * 12 + expectedPostReqTurn!;
                expect(reference.after.world.nationCooldowns).toEqual([
                    {
                        nationId: 1,
                        actionName: '필사즉생',
                        nextAvailableTurn: expectedNextAvailableTurn,
                    },
                ]);
                expect(core.after.world.nationCooldowns).toEqual(reference.after.world.nationCooldowns);
            }
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

const deceptionBoundaryCases: Array<{
    name: string;
    destCityId: unknown;
    fixturePatches?: FixturePatches;
    outcome: 'fallback' | 'intermediate' | 'completed';
    coreResolution?: boolean;
    expectedPostReqTurn?: number;
    expectedStrategicCommandLimit?: number;
    expectedTargetCityId?: number;
    expectedRngCalls?: number;
}> = [
    {
        name: 'rejects a missing destination city',
        destCityId: 99,
        outcome: 'fallback',
    },
    {
        name: 'accepts a numeric string destination city ID',
        destCityId: '70',
        fixturePatches: { diplomacy: { '1:2': { state: 0 } } },
        outcome: 'completed',
        expectedPostReqTurn: 62,
        expectedTargetCityId: 70,
        expectedRngCalls: 2,
    },
    {
        name: 'truncates a fractional destination city ID',
        destCityId: 70.9,
        fixturePatches: { diplomacy: { '1:2': { state: 0 } } },
        outcome: 'completed',
        expectedPostReqTurn: 62,
        expectedTargetCityId: 70,
        expectedRngCalls: 2,
    },
    {
        name: 'rejects a neutral destination city',
        destCityId: 70,
        fixturePatches: { cities: { 70: { nationId: 0 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects a destination city occupied by the source nation',
        destCityId: 70,
        fixturePatches: { cities: { 70: { nationId: 1 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects a trade relation to the destination nation',
        destCityId: 70,
        fixturePatches: { diplomacy: { '1:2': { state: 3 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects a reverse-only war relation',
        destCityId: 70,
        fixturePatches: {
            diplomacy: {
                '1:2': { state: 3 },
                '2:1': { state: 0 },
            },
        },
        outcome: 'fallback',
    },
    {
        name: 'rejects a source city occupied by another nation',
        destCityId: 70,
        fixturePatches: {
            cities: { 3: { nationId: 2 } },
            diplomacy: { '1:2': { state: 0 } },
        },
        outcome: 'fallback',
    },
    {
        name: 'rejects an actor below chief rank',
        destCityId: 70,
        fixturePatches: {
            generals: { 1: { officerLevel: 4, officerCityId: 0 } },
            diplomacy: { '1:2': { state: 0 } },
        },
        outcome: 'fallback',
        coreResolution: false,
    },
    {
        name: 'rejects a remaining strategic-command delay',
        destCityId: 70,
        fixturePatches: {
            nations: { 1: { strategicCommandLimit: 1 } },
            diplomacy: { '1:2': { state: 0 } },
        },
        outcome: 'fallback',
    },
    {
        name: 'allows an unsupplied source city on the intermediate turn',
        destCityId: 70,
        fixturePatches: {
            cities: { 3: { supplyState: 0 } },
            diplomacy: { '1:2': { state: 0 } },
        },
        outcome: 'intermediate',
    },
    {
        name: 'completes against a nation under declaration',
        destCityId: 70,
        fixturePatches: { diplomacy: { '1:2': { state: 1 } } },
        outcome: 'completed',
        expectedPostReqTurn: 62,
        expectedTargetCityId: 70,
        expectedRngCalls: 2,
    },
    {
        name: 'excludes supply state two and moves the target to the only supply-one city',
        destCityId: 70,
        fixturePatches: {
            cities: {
                70: { supplyState: 2 },
                23: { nationId: 2, supplyState: 1 },
            },
            diplomacy: { '1:2': { state: 0 } },
        },
        outcome: 'completed',
        expectedPostReqTurn: 62,
        expectedTargetCityId: 23,
        expectedRngCalls: 1,
    },
    {
        name: 'completes without RNG when no general is in the destination city',
        destCityId: 70,
        fixturePatches: {
            cities: { 23: { nationId: 2, supplyState: 1 } },
            generals: { 2: { cityId: 23 } },
            diplomacy: { '1:2': { state: 0 } },
        },
        outcome: 'completed',
        expectedPostReqTurn: 62,
        expectedTargetCityId: 23,
        expectedRngCalls: 0,
    },
    {
        name: 'restarts at term one after another command interrupted the stack',
        destCityId: 70,
        fixturePatches: {
            nations: {
                1: {
                    turnLastByOfficerLevel: {
                        12: { command: '필사즉생', arg: {}, term: 2 },
                    },
                },
            },
            diplomacy: { '1:2': { state: 0 } },
        },
        outcome: 'intermediate',
    },
    {
        name: 'applies the strategist command and global-delay modifiers',
        destCityId: 70,
        fixturePatches: {
            nations: { 1: { typeCode: 'che_종횡가' } },
            diplomacy: { '1:2': { state: 0 } },
        },
        outcome: 'completed',
        expectedPostReqTurn: 46,
        expectedStrategicCommandLimit: 5,
        expectedTargetCityId: 70,
        expectedRngCalls: 2,
    },
    {
        name: 'uses the actual eleven-general count for the nation cooldown',
        destCityId: 70,
        fixturePatches: {
            nations: { 1: { generalCount: 11 } },
            generals: {
                4: { nationId: 1 },
                5: { nationId: 1 },
                6: { nationId: 1 },
                7: { nationId: 1 },
                8: { nationId: 1 },
                9: { nationId: 1 },
                10: { nationId: 1 },
                11: { nationId: 1 },
                12: { nationId: 1 },
            },
            diplomacy: { '1:2': { state: 0 } },
        },
        outcome: 'completed',
        expectedPostReqTurn: 65,
        expectedTargetCityId: 70,
        expectedRngCalls: 2,
    },
];

integration('nation deception target, multistep, movement, RNG, and cooldown boundaries', () => {
    it.each(deceptionBoundaryCases)(
        '$name matches legacy progress, movement, cooldown, logs, RNG, and semantic delta',
        async ({
            destCityId,
            fixturePatches,
            outcome,
            coreResolution = true,
            expectedPostReqTurn,
            expectedStrategicCommandLimit = 9,
            expectedTargetCityId,
            expectedRngCalls,
        }) => {
            const normalizedDestCityId =
                typeof destCityId === 'string' ? Math.trunc(Number(destCityId)) : Math.trunc(Number(destCityId));
            const completed = outcome === 'completed';
            const fallback = outcome === 'fallback';
            const completionNationPatch = completed
                ? {
                      turnLastByOfficerLevel: {
                          12: { command: '허보', arg: { destCityID: destCityId }, term: 1 },
                      },
                      coreTurnLastByOfficerLevel: {
                          12: { command: '허보', arg: { destCityId: normalizedDestCityId }, term: 1 },
                      },
                  }
                : {};
            const request = buildRequest(
                'che_허보',
                { destCityID: destCityId },
                {
                    ...fixturePatches,
                    nations: {
                        ...fixturePatches?.nations,
                        1: {
                            ...fixturePatches?.nations?.[1],
                            ...completionNationPatch,
                        },
                    },
                }
            );
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);

            expect(reference.execution.outcome).toMatchObject({ completed });
            if (coreResolution) {
                expect(core.execution.outcome).toMatchObject({
                    requestedAction: 'che_허보',
                    actionKey: fallback ? '휴식' : 'che_허보',
                    usedFallback: fallback,
                    ...(fallback ? {} : { completed }),
                });
            } else {
                expect(core.execution.outcome).toBeUndefined();
            }

            for (const snapshot of [reference, core]) {
                const nationBefore = snapshot.before.nations.find((entry) => entry.id === 1);
                const nationAfter = snapshot.after.nations.find((entry) => entry.id === 1);
                const actorBefore = snapshot.before.generals.find((entry) => entry.id === 1);
                const actorAfter = snapshot.after.generals.find((entry) => entry.id === 1);
                const targetBefore = snapshot.before.generals.find((entry) => entry.id === 2);
                const targetAfter = snapshot.after.generals.find((entry) => entry.id === 2);

                expect(readNationResource(nationBefore, 'gold') - readNationResource(nationAfter, 'gold')).toBe(0);
                expect(readNationResource(nationBefore, 'rice') - readNationResource(nationAfter, 'rice')).toBe(0);
                expect(readNumericField(actorAfter, 'experience') - readNumericField(actorBefore, 'experience')).toBe(
                    completed ? 10 : 0
                );
                expect(readNumericField(actorAfter, 'dedication') - readNumericField(actorBefore, 'dedication')).toBe(
                    completed ? 10 : 0
                );
                expect(readNumericField(nationAfter, 'strategicCommandLimit')).toBe(
                    completed ? expectedStrategicCommandLimit : readNumericField(nationBefore, 'strategicCommandLimit')
                );
                expect(readNumericField(targetAfter, 'cityId')).toBe(
                    completed && expectedTargetCityId !== undefined
                        ? expectedTargetCityId
                        : readNumericField(targetBefore, 'cityId')
                );

                if (completed) {
                    const addedLogs = snapshot.after.logs.slice(snapshot.before.logs.length);
                    expect(addedLogs.map((entry) => entry.text)).toEqual(
                        expect.arrayContaining([expect.stringContaining('허보 발동')])
                    );
                    expect(
                        addedLogs.some((entry) => entry.generalId === 3 && String(entry.text).includes('허보'))
                    ).toBe(true);
                }
            }

            if (outcome === 'intermediate') {
                expect(reference.execution.outcome).toMatchObject({
                    lastTurn: {
                        command: '허보',
                        term: 1,
                    },
                });
                expect(readNationMeta(core.after.nations.find((entry) => entry.id === 1)).turn_last_12).toMatchObject({
                    command: '허보',
                    term: 1,
                });
            }
            if (completed) {
                const expectedNextAvailableTurn = 190 * 12 + expectedPostReqTurn!;
                expect(reference.after.world.nationCooldowns).toEqual([
                    {
                        nationId: 1,
                        actionName: '허보',
                        nextAvailableTurn: expectedNextAvailableTurn,
                    },
                ]);
                expect(core.after.world.nationCooldowns).toEqual(reference.after.world.nationCooldowns);
            }
            if (expectedRngCalls !== undefined) {
                expect(reference.rng).toHaveLength(expectedRngCalls);
            }
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

type ScorchedEarthOutcome = 'fallback' | 'intermediate' | 'completed';

const scorchedEarthBoundaryCases: Array<{
    name: string;
    destCityId: unknown;
    fixturePatches?: FixturePatches;
    outcome: ScorchedEarthOutcome;
    coreResolution?: boolean;
}> = [
    {
        name: 'rejects a missing destination city',
        destCityId: 99,
        outcome: 'fallback',
    },
    {
        name: 'rejects a destination city occupied by another nation',
        destCityId: 70,
        fixturePatches: { cities: { 70: { nationId: 2 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects a neutral destination city',
        destCityId: 70,
        fixturePatches: { cities: { 70: { nationId: 0 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects a source city occupied by another nation',
        destCityId: 70,
        fixturePatches: { cities: { 3: { nationId: 2 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects an unsupplied source city',
        destCityId: 70,
        fixturePatches: { cities: { 3: { supplyState: 0 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects an unsupplied destination city',
        destCityId: 70,
        fixturePatches: { cities: { 70: { supplyState: 0 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects an actor below chief rank',
        destCityId: 70,
        fixturePatches: { generals: { 1: { officerLevel: 4, officerCityId: 0 } } },
        outcome: 'fallback',
        coreResolution: false,
    },
    {
        name: 'rejects the national capital',
        destCityId: 70,
        fixturePatches: { nations: { 1: { capitalCityId: 70 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects a remaining diplomacy restriction',
        destCityId: 70,
        fixturePatches: { nations: { 1: { diplomacyLimit: 1 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects any outgoing war relation',
        destCityId: 70,
        fixturePatches: { diplomacy: { '1:2': { state: 0 } } },
        outcome: 'fallback',
    },
    {
        name: 'rejects an outgoing self-war relation',
        destCityId: 70,
        fixturePatches: { diplomacy: { '1:1': { state: 0 } } },
        outcome: 'fallback',
    },
    {
        name: 'starts at term one without side effects',
        destCityId: 70,
        outcome: 'intermediate',
    },
    {
        name: 'continues to term two without side effects',
        destCityId: 70,
        fixturePatches: {
            nations: {
                1: {
                    turnLastByOfficerLevel: {
                        12: { command: '초토화', arg: { destCityID: 70 }, term: 1 },
                    },
                    coreTurnLastByOfficerLevel: {
                        12: { command: '초토화', arg: { destCityId: 70 }, term: 1 },
                    },
                },
            },
        },
        outcome: 'intermediate',
    },
    {
        name: 'restarts at term one after another command interrupted the stack',
        destCityId: 70,
        fixturePatches: {
            nations: {
                1: {
                    turnLastByOfficerLevel: {
                        12: { command: '필사즉생', arg: {}, term: 2 },
                    },
                },
            },
        },
        outcome: 'intermediate',
    },
    {
        name: 'accepts a numeric string destination city ID',
        destCityId: '70',
        outcome: 'completed',
    },
    {
        name: 'truncates a fractional destination city ID',
        destCityId: 70.9,
        outcome: 'completed',
    },
    {
        name: 'accepts supply state two for both source and destination',
        destCityId: 70,
        fixturePatches: {
            cities: {
                3: { supplyState: 2 },
                70: { supplyState: 2 },
            },
        },
        outcome: 'completed',
    },
    {
        name: 'ignores a reverse-only war relation',
        destCityId: 70,
        fixturePatches: { diplomacy: { '2:1': { state: 0 } } },
        outcome: 'completed',
    },
    {
        name: 'uses ten-percent floors and raises low trust on a level-eight city',
        destCityId: 70,
        fixturePatches: {
            cities: {
                70: {
                    level: 8,
                    population: 1_000,
                    populationMax: 100_000,
                    agriculture: 10,
                    agricultureMax: 10_000,
                    commerce: 20,
                    commerceMax: 20_000,
                    security: 30,
                    securityMax: 30_000,
                    defence: 40,
                    defenceMax: 40_000,
                    wall: 50,
                    wallMax: 50_000,
                    trust: 20,
                    conflict: { 2: 30 },
                },
            },
        },
        outcome: 'completed',
    },
    {
        name: 'applies high-value ratios, recovered resources, officer penalties, and city resets',
        destCityId: 70,
        fixturePatches: {
            generals: {
                1: { experience: 1_235 },
            },
            cities: {
                23: { nationId: 1, frontState: 1, conflict: { 2: 10 } },
                70: {
                    level: 7,
                    population: 80_003,
                    populationMax: 100_000,
                    agriculture: 8_003,
                    agricultureMax: 10_000,
                    commerce: 16_003,
                    commerceMax: 20_000,
                    security: 24_003,
                    securityMax: 30_000,
                    defence: 32_003,
                    defenceMax: 40_000,
                    wall: 40_001,
                    wallMax: 50_000,
                    trust: 80,
                    conflict: { 2: 30 },
                },
            },
        },
        outcome: 'completed',
    },
];

const calcScorchedEarthReturnAmount = (city: Record<string, unknown>): number => {
    let amount = readNumericField(city, 'population') / 5;
    for (const [currentKey, maxKey] of [
        ['agriculture', 'agricultureMax'],
        ['commerce', 'commerceMax'],
        ['security', 'securityMax'],
    ] as const) {
        const current = readNumericField(city, currentKey);
        const max = readNumericField(city, maxKey);
        amount *= (current - max * 0.5) / max + 0.8;
    }
    return Math.trunc(amount);
};

integration('nation scorched-earth constraints, multistep, city values, officers, and diplomacy boundaries', () => {
    it.each(scorchedEarthBoundaryCases)(
        '$name matches legacy progress, destruction, resources, officers, logs, RNG, and semantic delta',
        async ({ destCityId, fixturePatches, outcome, coreResolution = true }) => {
            const normalizedDestCityId = Math.trunc(Number(destCityId));
            const completed = outcome === 'completed';
            const fallback = outcome === 'fallback';
            const completionNationPatch = completed
                ? {
                      turnLastByOfficerLevel: {
                          12: { command: '초토화', arg: { destCityID: destCityId }, term: 2 },
                      },
                      coreTurnLastByOfficerLevel: {
                          12: { command: '초토화', arg: { destCityId: normalizedDestCityId }, term: 2 },
                      },
                  }
                : {};
            const request = buildRequest(
                'che_초토화',
                { destCityID: destCityId },
                {
                    ...fixturePatches,
                    nations: {
                        ...fixturePatches?.nations,
                        1: {
                            ...fixturePatches?.nations?.[1],
                            ...completionNationPatch,
                        },
                    },
                    cities: {
                        ...fixturePatches?.cities,
                        70: {
                            nationId: 1,
                            ...fixturePatches?.cities?.[70],
                        },
                    },
                    generals: {
                        3: { betray: 1, ...fixturePatches?.generals?.[3] },
                        4: {
                            nationId: 1,
                            cityId: 3,
                            officerLevel: 5,
                            officerCityId: 3,
                            experience: 1_235,
                            betray: 2,
                            ...fixturePatches?.generals?.[4],
                        },
                        5: {
                            nationId: 1,
                            cityId: 3,
                            officerLevel: 4,
                            officerCityId: 0,
                            experience: 1_235,
                            betray: 3,
                            ...fixturePatches?.generals?.[5],
                        },
                        6: {
                            nationId: 2,
                            cityId: 70,
                            officerLevel: 5,
                            officerCityId: 70,
                            experience: 1_235,
                            betray: 4,
                            ...fixturePatches?.generals?.[6],
                        },
                        ...fixturePatches?.generals,
                    },
                }
            );
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);

            expect(reference.execution.outcome).toMatchObject({ completed });
            if (coreResolution) {
                expect(core.execution.outcome).toMatchObject({
                    requestedAction: 'che_초토화',
                    actionKey: fallback ? '휴식' : 'che_초토화',
                    usedFallback: fallback,
                    ...(fallback ? {} : { completed }),
                });
            } else {
                expect(core.execution.outcome).toBeUndefined();
            }

            if (outcome === 'intermediate') {
                const expectedTerm =
                    fixturePatches?.nations?.[1]?.turnLastByOfficerLevel &&
                    (fixturePatches.nations[1].turnLastByOfficerLevel as Record<number, { command?: string }>)[12]
                        ?.command === '초토화'
                        ? 2
                        : 1;
                expect(reference.execution.outcome).toMatchObject({
                    lastTurn: {
                        command: '초토화',
                        term: expectedTerm,
                    },
                });
                expect(readNationMeta(core.after.nations.find((entry) => entry.id === 1)).turn_last_12).toMatchObject({
                    command: '초토화',
                    term: expectedTerm,
                });
            }

            for (const snapshot of [reference, core]) {
                const nationBefore = snapshot.before.nations.find((entry) => entry.id === 1);
                const nationAfter = snapshot.after.nations.find((entry) => entry.id === 1);
                const cityBefore = snapshot.before.cities.find((entry) => entry.id === normalizedDestCityId);
                const cityAfter = snapshot.after.cities.find((entry) => entry.id === normalizedDestCityId);
                const actorBefore = snapshot.before.generals.find((entry) => entry.id === 1);
                const actorAfter = snapshot.after.generals.find((entry) => entry.id === 1);

                if (!completed) {
                    expect(readNationResource(nationAfter, 'gold')).toBe(readNationResource(nationBefore, 'gold'));
                    expect(readNationResource(nationAfter, 'rice')).toBe(readNationResource(nationBefore, 'rice'));
                    expect(readNumericField(actorAfter, 'experience')).toBe(
                        readNumericField(actorBefore, 'experience')
                    );
                    expect(readNumericField(actorAfter, 'dedication')).toBe(
                        readNumericField(actorBefore, 'dedication')
                    );
                    continue;
                }

                const rewardAmount = calcScorchedEarthReturnAmount(cityBefore!);
                expect(readNationResource(nationAfter, 'gold') - readNationResource(nationBefore, 'gold')).toBe(
                    rewardAmount
                );
                expect(readNationResource(nationAfter, 'rice') - readNationResource(nationBefore, 'rice')).toBe(
                    rewardAmount
                );
                expect(
                    readNumericField(nationAfter, 'diplomacyLimit') - readNumericField(nationBefore, 'diplomacyLimit')
                ).toBe(24);
                expect(readNumericField(actorAfter, 'experience')).toBe(
                    Math.round(readNumericField(actorBefore, 'experience') * 0.9 + 15)
                );
                expect(readNumericField(actorAfter, 'dedication') - readNumericField(actorBefore, 'dedication')).toBe(
                    15
                );
                expect(readNumericField(actorAfter, 'betray') - readNumericField(actorBefore, 'betray')).toBe(1);

                for (const generalId of [3, 4, 5, 6]) {
                    const before = snapshot.before.generals.find((entry) => entry.id === generalId);
                    const after = snapshot.after.generals.find((entry) => entry.id === generalId);
                    const friendly = [3, 4, 5].includes(generalId);
                    const officer = readNumericField(before, 'officerLevel') >= 5;
                    expect(readNumericField(after, 'experience')).toBe(
                        friendly && officer
                            ? Math.round(readNumericField(before, 'experience') * 0.9)
                            : readNumericField(before, 'experience')
                    );
                    expect(readNumericField(after, 'betray') - readNumericField(before, 'betray')).toBe(
                        friendly ? 1 : 0
                    );
                }

                expect(cityAfter).toMatchObject({
                    nationId: 0,
                    frontState: 0,
                    trust: Math.max(50, readNumericField(cityBefore, 'trust')),
                    population: Math.max(
                        Math.round(readNumericField(cityBefore, 'populationMax') * 0.1),
                        Math.round(readNumericField(cityBefore, 'population') * 0.2)
                    ),
                    agriculture: Math.max(
                        Math.round(readNumericField(cityBefore, 'agricultureMax') * 0.1),
                        Math.round(readNumericField(cityBefore, 'agriculture') * 0.2)
                    ),
                    commerce: Math.max(
                        Math.round(readNumericField(cityBefore, 'commerceMax') * 0.1),
                        Math.round(readNumericField(cityBefore, 'commerce') * 0.2)
                    ),
                    security: Math.max(
                        Math.round(readNumericField(cityBefore, 'securityMax') * 0.1),
                        Math.round(readNumericField(cityBefore, 'security') * 0.2)
                    ),
                    defence: Math.max(
                        Math.round(readNumericField(cityBefore, 'defenceMax') * 0.1),
                        Math.round(readNumericField(cityBefore, 'defence') * 0.2)
                    ),
                    wall: Math.max(
                        Math.round(readNumericField(cityBefore, 'wallMax') * 0.1),
                        Math.round(readNumericField(cityBefore, 'wall') * 0.5)
                    ),
                });
                expect(Object.keys((cityAfter?.conflict ?? {}) as object)).toHaveLength(0);
                const auxBefore = readNationMeta(nationBefore);
                const auxAfter = readNationMeta(nationAfter);
                expect(
                    readNumericField(auxAfter, 'did_특성초토화') - readNumericField(auxBefore, 'did_특성초토화')
                ).toBe(readNumericField(cityBefore, 'level') >= 8 ? 1 : 0);
                expect(snapshot.after.logs.slice(snapshot.before.logs.length).map((entry) => entry.text)).toEqual(
                    expect.arrayContaining([
                        expect.stringContaining('초토화했습니다'),
                        expect.stringContaining('초토화</> 명령'),
                    ])
                );
            }

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
