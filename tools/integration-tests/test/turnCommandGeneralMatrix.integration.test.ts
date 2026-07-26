import { describe, expect, it } from 'vitest';
import { LEGACY_RANK_DATA_TYPES } from '@sammo-ts/common';

import { compareTurnSnapshotDeltas } from '../src/turn-differential/compare.js';
import { runCoreTurnCommandTrace, type TurnCommandFixtureRequest } from '../src/turn-differential/coreCommandTrace.js';
import {
    findTurnDifferentialWorkspaceRoot,
    runReferenceTurnCommandTraceRequest,
} from '../src/turn-differential/referenceSnapshot.js';

const configuredWorkspaceRoot = process.env.TURN_DIFFERENTIAL_WORKSPACE_ROOT;
const workspaceRoot = configuredWorkspaceRoot ?? findTurnDifferentialWorkspaceRoot(process.cwd());
const integration = describe.skipIf(!workspaceRoot || process.env.TURN_DIFFERENTIAL_REFERENCE !== '1');

const normalizeStoredLogText = (value: unknown): string =>
    String(value)
        .replace(/^(?:<C>●<\/>|<S>◆<\/>|<R>★<\/>)(?:(?:\d+년 )?\d+월:|\d+년:)?/, '')
        .replace(/ ?<1>\d{2}:\d{2}<\/>$/, '');

const semanticLogSignatures = (logs: Array<Record<string, unknown>>): string[] =>
    logs
        .filter((entry) => normalizeStoredLogText(entry.text) !== '아무것도 실행하지 않았습니다.')
        .map((entry) =>
            JSON.stringify({
                scope: String(entry.scope).toLowerCase(),
                category: String(entry.category).toLowerCase(),
                generalId: Number(entry.generalId) || null,
                nationId: Number(entry.nationId) || null,
                text: normalizeStoredLogText(entry.text),
            })
        )
        .sort();

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
    rankData?: Array<{ generalId: number; type: string; value: number }>;
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
        ...(fixturePatches.rankData ? { rankData: fixturePatches.rankData } : {}),
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

interface SelfStateBoundaryCase {
    name: string;
    action: 'che_단련' | 'che_숙련전환' | 'che_사기진작' | 'che_요양';
    args?: Record<string, unknown>;
    actorPatch?: Record<string, unknown>;
    fixturePatches?: FixturePatches;
    completed: boolean;
}

const selfStateBoundaryCases: SelfStateBoundaryCase[] = [
    { name: 'drill rejects a neutral actor', action: 'che_단련', actorPatch: { nationId: 0 }, completed: false },
    { name: 'drill rejects zero crew', action: 'che_단련', actorPatch: { crew: 0 }, completed: false },
    {
        name: 'drill rejects training one below the floor',
        action: 'che_단련',
        actorPatch: { train: 39 },
        completed: false,
    },
    {
        name: 'drill rejects morale one below the floor',
        action: 'che_단련',
        actorPatch: { atmos: 39 },
        completed: false,
    },
    { name: 'drill rejects insufficient gold', action: 'che_단련', actorPatch: { gold: 0 }, completed: false },
    { name: 'drill rejects insufficient rice', action: 'che_단련', actorPatch: { rice: 0 }, completed: false },
    {
        name: 'drill accepts the exact training and morale floors',
        action: 'che_단련',
        actorPatch: { train: 40, atmos: 40, crew: 1001 },
        completed: true,
    },
    {
        name: 'dex transfer rejects numeric-string arm types',
        action: 'che_숙련전환',
        args: { srcArmType: '1', destArmType: 2 },
        completed: false,
    },
    {
        name: 'dex transfer rejects fractional arm types',
        action: 'che_숙련전환',
        args: { srcArmType: 1.9, destArmType: 2 },
        completed: false,
    },
    {
        name: 'dex transfer rejects the same source and destination',
        action: 'che_숙련전환',
        args: { srcArmType: 1, destArmType: 1 },
        completed: false,
    },
    {
        name: 'dex transfer rejects an unknown arm type',
        action: 'che_숙련전환',
        args: { srcArmType: 99, destArmType: 2 },
        completed: false,
    },
    {
        name: 'dex transfer rejects a neutral actor',
        action: 'che_숙련전환',
        args: { srcArmType: 1, destArmType: 2 },
        actorPatch: { nationId: 0 },
        completed: false,
    },
    {
        name: 'dex transfer rejects a foreign-occupied city',
        action: 'che_숙련전환',
        args: { srcArmType: 1, destArmType: 2 },
        fixturePatches: { cities: { 3: { nationId: 2 } } },
        completed: false,
    },
    {
        name: 'dex transfer rejects insufficient gold',
        action: 'che_숙련전환',
        args: { srcArmType: 1, destArmType: 2 },
        actorPatch: { gold: 0 },
        completed: false,
    },
    {
        name: 'dex transfer rejects insufficient rice',
        action: 'che_숙련전환',
        args: { srcArmType: 1, destArmType: 2 },
        actorPatch: { rice: 0 },
        completed: false,
    },
    {
        name: 'dex transfer preserves integer truncation at a low source value',
        action: 'che_숙련전환',
        args: { srcArmType: 1, destArmType: 2 },
        actorPatch: { dex1: 3, dex2: 7 },
        completed: true,
    },
    {
        name: 'morale boost rejects a neutral actor',
        action: 'che_사기진작',
        actorPatch: { nationId: 0 },
        completed: false,
    },
    {
        name: 'morale boost rejects a wandering nation',
        action: 'che_사기진작',
        fixturePatches: { nations: { 1: { level: 0 } } },
        completed: false,
    },
    {
        name: 'morale boost rejects a foreign-occupied city',
        action: 'che_사기진작',
        fixturePatches: { cities: { 3: { nationId: 2 } } },
        completed: false,
    },
    { name: 'morale boost rejects zero crew', action: 'che_사기진작', actorPatch: { crew: 0 }, completed: false },
    {
        name: 'morale boost rejects insufficient gold',
        action: 'che_사기진작',
        actorPatch: { gold: 0 },
        completed: false,
    },
    {
        name: 'morale boost rejects the command maximum',
        action: 'che_사기진작',
        actorPatch: { atmos: 100 },
        completed: false,
    },
    {
        name: 'morale boost clamps at the command maximum',
        action: 'che_사기진작',
        actorPatch: { atmos: 99, train: 51, crew: 1001 },
        completed: true,
    },
    {
        name: 'recovery always clears injury without resource cost',
        action: 'che_요양',
        actorPatch: { nationId: 0, injury: 80, gold: 0, rice: 0 },
        completed: true,
    },
];

integration('general self-state command boundary parity', () => {
    it.each(selfStateBoundaryCases)(
        '$name',
        async ({ name, action, args, actorPatch, fixturePatches, completed }) => {
            const request = buildRequest(action, args, actorPatch, fixturePatches);
            request.setup!.world!.hiddenSeed = `general-self-state-${name}`;
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

            if (completed) {
                const referenceActor = reference.after.generals.find((entry) => entry.id === 1);
                const coreActor = core.after.generals.find((entry) => entry.id === 1);
                expect(coreActor).toMatchObject({
                    dex1: referenceActor?.dex1,
                    dex2: referenceActor?.dex2,
                    leadershipExp: referenceActor?.leadershipExp,
                    experience: referenceActor?.experience,
                    dedication: referenceActor?.dedication,
                    injury: referenceActor?.injury,
                    gold: referenceActor?.gold,
                    rice: referenceActor?.rice,
                    train: referenceActor?.train,
                    atmos: referenceActor?.atmos,
                });
            }
        },
        120_000
    );
});

integration('general sightseeing event, RNG, value, and log parity', () => {
    it.each(Array.from({ length: 20 }, (_, index) => index))(
        'matches legacy sightseeing seed %i',
        async (seedIndex) => {
            const request = buildRequest(
                'che_견문',
                undefined,
                { injury: seedIndex % 2 === 0 ? 0 : 75, gold: seedIndex % 3 === 0 ? 100 : 100_000, rice: 100 },
                { world: { hiddenSeed: `general-sightseeing-${seedIndex}` } }
            );
            request.observe!.includeGlobalHistoryLogs = true;
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);

            expect(reference.execution.outcome).toMatchObject({ completed: true });
            expect(core.execution.outcome).toMatchObject({
                requestedAction: 'che_견문',
                actionKey: 'che_견문',
                usedFallback: false,
            });
            expect(core.rng).toEqual(reference.rng);
            expect(
                compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                    ignoredPathPatterns: ignoredLifecyclePaths,
                })
            ).toEqual([]);
            expect(semanticLogSignatures(core.after.logs)).toEqual(
                semanticLogSignatures(addedReferenceLogs(reference.before, reference.after.logs))
            );
        },
        120_000
    );
});

interface MovementBoundaryCase {
    name: string;
    action: 'che_강행' | 'che_귀환' | 'che_접경귀환' | 'che_집합' | 'che_방랑';
    args?: Record<string, unknown>;
    actorPatch?: Record<string, unknown>;
    fixturePatches?: FixturePatches;
    completed: boolean;
    fallback?: boolean;
}

const movementBoundaryCases: MovementBoundaryCase[] = [
    {
        name: 'forced move accepts a numeric-string city ID',
        action: 'che_강행',
        args: { destCityID: '70' },
        completed: true,
    },
    {
        name: 'forced move truncates a fractional city ID',
        action: 'che_강행',
        args: { destCityID: 70.9 },
        completed: true,
    },
    {
        name: 'forced move rejects the current city',
        action: 'che_강행',
        args: { destCityID: 3 },
        completed: false,
    },
    {
        name: 'forced move rejects an unknown city',
        action: 'che_강행',
        args: { destCityID: 999 },
        completed: false,
    },
    {
        name: 'forced move rejects insufficient gold',
        action: 'che_강행',
        args: { destCityID: 70 },
        actorPatch: { gold: 0 },
        completed: false,
    },
    {
        name: 'forced move preserves the training and morale floors',
        action: 'che_강행',
        args: { destCityID: 70 },
        actorPatch: { train: 20, atmos: 20 },
        completed: true,
    },
    {
        name: 'forced move carries every wandering-nation general',
        action: 'che_강행',
        args: { destCityID: 70 },
        fixturePatches: { nations: { 1: { level: 0 } } },
        completed: true,
    },
    {
        name: 'return rejects a neutral actor',
        action: 'che_귀환',
        actorPatch: { nationId: 0 },
        completed: false,
    },
    {
        name: 'return rejects a wandering nation',
        action: 'che_귀환',
        fixturePatches: { nations: { 1: { level: 0 } } },
        completed: false,
    },
    {
        name: 'return rejects a lord already in the capital',
        action: 'che_귀환',
        completed: false,
    },
    {
        name: 'return lets a local officer leave the capital for the assigned city',
        action: 'che_귀환',
        actorPatch: { officerLevel: 2, officerCityId: 70 },
        fixturePatches: { cities: { 70: { nationId: 1 } } },
        completed: true,
    },
    {
        name: 'return rewards an officer already in the assigned non-capital city',
        action: 'che_귀환',
        actorPatch: { officerLevel: 4, officerCityId: 70, cityId: 70 },
        fixturePatches: { cities: { 70: { nationId: 1 } } },
        completed: true,
    },
    {
        name: 'return sends a normal officer to the capital',
        action: 'che_귀환',
        actorPatch: { officerLevel: 1, cityId: 70 },
        completed: true,
    },
    {
        name: 'border return rejects a neutral actor',
        action: 'che_접경귀환',
        actorPatch: { nationId: 0, cityId: 70 },
        completed: false,
    },
    {
        name: 'border return rejects a wandering nation',
        action: 'che_접경귀환',
        actorPatch: { cityId: 70 },
        fixturePatches: { nations: { 1: { level: 0 } } },
        completed: false,
    },
    {
        name: 'border return rejects an actor already in an owned city',
        action: 'che_접경귀환',
        completed: false,
    },
    {
        name: 'border return fails without a supplied owned city in range',
        action: 'che_접경귀환',
        actorPatch: { cityId: 70 },
        fixturePatches: { cities: { 3: { supplyState: 0 } } },
        completed: false,
        fallback: false,
    },
    {
        name: 'border return consumes the single-candidate choice and moves',
        action: 'che_접경귀환',
        actorPatch: { cityId: 70 },
        completed: true,
    },
    {
        name: 'assembly rejects a neutral actor',
        action: 'che_집합',
        actorPatch: { nationId: 0, troopId: 1 },
        fixturePatches: { troops: [{ id: 1, nationId: 1, name: '조조군' }] },
        completed: false,
    },
    {
        name: 'assembly rejects a foreign-occupied city',
        action: 'che_집합',
        actorPatch: { troopId: 1 },
        fixturePatches: {
            cities: { 3: { nationId: 2 } },
            troops: [{ id: 1, nationId: 1, name: '조조군' }],
        },
        completed: false,
    },
    {
        name: 'assembly rejects an unsupplied city',
        action: 'che_집합',
        actorPatch: { troopId: 1 },
        fixturePatches: {
            cities: { 3: { supplyState: 0 } },
            troops: [{ id: 1, nationId: 1, name: '조조군' }],
        },
        completed: false,
    },
    {
        name: 'assembly rejects a non-leader',
        action: 'che_집합',
        actorPatch: { troopId: 3 },
        fixturePatches: {
            generals: { 3: { troopId: 3 } },
            troops: [{ id: 3, nationId: 1, name: '조조군' }],
        },
        completed: false,
    },
    {
        name: 'assembly rejects a troop without another member',
        action: 'che_집합',
        actorPatch: { troopId: 1 },
        fixturePatches: { troops: [{ id: 1, nationId: 1, name: '조조군' }] },
        completed: false,
    },
    {
        name: 'assembly completes when every member is already present',
        action: 'che_집합',
        actorPatch: { troopId: 1 },
        fixturePatches: {
            generals: { 3: { troopId: 1 } },
            troops: [{ id: 1, nationId: 1, name: '조조군' }],
        },
        completed: true,
    },
    {
        name: 'assembly moves a remote member and records its plain log',
        action: 'che_집합',
        actorPatch: { troopId: 1 },
        fixturePatches: {
            generals: { 3: { cityId: 70, troopId: 1 } },
            troops: [{ id: 1, nationId: 1, name: '조조군' }],
        },
        completed: true,
    },
    {
        name: 'wander rejects a non-lord',
        action: 'che_방랑',
        actorPatch: { officerLevel: 11 },
        fixturePatches: { diplomacy: { '1:2': { state: 2 }, '2:1': { state: 2 } } },
        completed: false,
    },
    {
        name: 'wander rejects an already wandering nation',
        action: 'che_방랑',
        fixturePatches: {
            nations: { 1: { level: 0 } },
            diplomacy: { '1:2': { state: 2 }, '2:1': { state: 2 } },
        },
        completed: false,
    },
    {
        name: 'wander rejects the opening phase',
        action: 'che_방랑',
        fixturePatches: {
            world: { year: 180 },
            diplomacy: { '1:2': { state: 2 }, '2:1': { state: 2 } },
        },
        completed: false,
    },
    {
        name: 'wander rejects a disallowed diplomacy state',
        action: 'che_방랑',
        completed: false,
    },
    {
        name: 'wander accepts neutral diplomacy',
        action: 'che_방랑',
        fixturePatches: { diplomacy: { '1:2': { state: 2 }, '2:1': { state: 2 } } },
        completed: true,
    },
    {
        name: 'wander accepts non-aggression diplomacy',
        action: 'che_방랑',
        fixturePatches: { diplomacy: { '1:2': { state: 7 }, '2:1': { state: 7 } } },
        completed: true,
    },
];

integration('general movement command boundary and log parity', () => {
    it.each(movementBoundaryCases)(
        '$name',
        async ({ name, action, args, actorPatch, fixturePatches, completed, fallback }) => {
            const request = buildRequest(action, args, actorPatch, fixturePatches);
            request.setup!.world!.hiddenSeed = `general-movement-${name}`;
            request.observe!.includeGlobalHistoryLogs = true;
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);
            const usedFallback = fallback ?? !completed;

            expect(reference.execution.outcome).toMatchObject({ completed });
            expect(core.execution.outcome).toMatchObject({
                requestedAction: action,
                actionKey: usedFallback ? '휴식' : action,
                usedFallback,
            });
            expect(core.rng).toEqual(reference.rng);
            expect(
                compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                    ignoredPathPatterns: ignoredLifecyclePaths,
                })
            ).toEqual([]);

            if (completed) {
                expect(semanticLogSignatures(core.after.logs)).toEqual(
                    semanticLogSignatures(addedReferenceLogs(reference.before, reference.after.logs))
                );
            }
        },
        120_000
    );
});

integration('명장일람 rank_data command parity', () => {
    it('화계 increments firenum from the same seeded value as legacy', async () => {
        const request = buildRequest(
            'che_화계',
            { destCityID: 70 },
            { intelligence: 100 },
            {
                generals: { 2: { intelligence: 10 } },
                rankData: [{ generalId: 1, type: 'firenum', value: 17 }],
            }
        );
        request.setup!.world!.hiddenSeed = 'general-injury-4';
        const reference = runReferenceTurnCommandTraceRequest(
            workspaceRoot!,
            request as unknown as Record<string, unknown>
        );
        const core = await runCoreTurnCommandTrace(request, reference.before);

        expect(reference.after.rankData).toContainEqual(
            expect.objectContaining({ generalId: 1, type: 'firenum', value: 18 })
        );
        expect(
            compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                ignoredPathPatterns: ignoredLifecyclePaths,
            })
        ).toEqual([]);
    }, 120_000);

    it('은퇴 resets every legacy RankColumn row exactly like legacy', async () => {
        const request = buildRequest(
            'che_은퇴',
            undefined,
            { age: 65, lastTurn: { command: '은퇴', term: 1 } },
            {
                rankData: LEGACY_RANK_DATA_TYPES.map((type, index) => ({
                    generalId: 1,
                    type,
                    value: index + 1,
                })),
            }
        );
        const reference = runReferenceTurnCommandTraceRequest(
            workspaceRoot!,
            request as unknown as Record<string, unknown>
        );
        const core = await runCoreTurnCommandTrace(request, reference.before);

        expect(reference.after.rankData.filter((row) => row.generalId === 1)).toHaveLength(
            LEGACY_RANK_DATA_TYPES.length
        );
        expect(reference.after.rankData.filter((row) => row.generalId === 1).every((row) => row.value === 0)).toBe(
            true
        );
        expect(
            compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                ignoredPathPatterns: ignoredLifecyclePaths,
            })
        ).toEqual([]);
    }, 120_000);
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

type SabotageProbabilityClampCase = {
    name: string;
    action: 'che_화계' | 'che_선동' | 'che_파괴' | 'che_탈취';
    stat: 'leadership' | 'strength' | 'intelligence';
    boundary: 'zero' | 'max';
};

const sabotageProbabilityClampCases: SabotageProbabilityClampCase[] = (
    [
        ['che_화계', 'intelligence'],
        ['che_선동', 'leadership'],
        ['che_파괴', 'strength'],
        ['che_탈취', 'strength'],
    ] as const
).flatMap(([action, stat]) => [
    { name: `${action} probability zero clamp`, action, stat, boundary: 'zero' },
    { name: `${action} probability 0.5 clamp`, action, stat, boundary: 'max' },
]);

integration('general sabotage probability clamp matrix', () => {
    it.each(sabotageProbabilityClampCases)(
        '$name preserves the legacy clamp and RNG primitive',
        async ({ action, stat, boundary }) => {
            const isZero = boundary === 'zero';
            const request = buildRequest(
                action,
                { destCityID: 70 },
                { [stat]: isZero ? 10 : 100 },
                {
                    generals: { 2: { [stat]: isZero ? 100 : 10 } },
                    cities: {
                        70: {
                            security: isZero ? 2_000 : 0,
                            securityMax: 2_000,
                            supplyState: 1,
                        },
                    },
                }
            );
            request.setup!.world!.hiddenSeed = `general-probability-clamp-${action}-${boundary}`;
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
            expect(reference.rng[0]).toMatchObject(
                isZero
                    ? { operation: 'nextInt', arguments: { maxInclusive: 99 } }
                    : { operation: 'nextBits', arguments: { bits: 1 } }
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

type SabotageValueBoundaryCase = {
    name: string;
    action: 'che_화계' | 'che_선동' | 'che_파괴' | 'che_탈취';
    stat: 'leadership' | 'strength' | 'intelligence';
    fixturePatches: FixturePatches;
};

const sabotageValueBoundaryCases: SabotageValueBoundaryCase[] = [
    {
        name: 'fire attack does not reduce agriculture or commerce below zero',
        action: 'che_화계',
        stat: 'intelligence',
        fixturePatches: { cities: { 70: { agriculture: 1, commerce: 1 } } },
    },
    {
        name: 'agitation does not reduce security or trust below zero',
        action: 'che_선동',
        stat: 'leadership',
        fixturePatches: { cities: { 70: { security: 1, trust: 1 } } },
    },
    {
        name: 'destruction does not reduce defence or wall below zero',
        action: 'che_파괴',
        stat: 'strength',
        fixturePatches: { cities: { 70: { defence: 1, wall: 1 } } },
    },
    {
        name: 'seizure does not take more than supplied nation resources',
        action: 'che_탈취',
        stat: 'strength',
        fixturePatches: { nations: { 2: { gold: 1, rice: 1 } } },
    },
    {
        name: 'seizure does not reduce unsupplied city resources below zero',
        action: 'che_탈취',
        stat: 'strength',
        fixturePatches: {
            cities: { 70: { agriculture: 1, commerce: 1, supplyState: 0 } },
        },
    },
];

const hasSuccessfulSabotageLog = (logs: Array<Record<string, unknown>>): boolean =>
    logs.some((entry) => typeof entry.text === 'string' && entry.text.includes('성공했습니다.'));

integration('general sabotage value boundary matrix', () => {
    it.each(sabotageValueBoundaryCases)(
        '$name matches the legacy clamped state delta',
        async ({ action, stat, fixturePatches }) => {
            const request = buildRequest(
                action,
                { destCityID: 70 },
                { [stat]: 100 },
                {
                    ...fixturePatches,
                    generals: {
                        ...fixturePatches.generals,
                        2: { ...fixturePatches.generals?.[2], [stat]: 10 },
                    },
                    cities: {
                        ...fixturePatches.cities,
                        70: {
                            ...fixturePatches.cities?.[70],
                            security: 0,
                            securityMax: 2_000,
                        },
                    },
                }
            );
            request.setup!.world!.hiddenSeed = 'general-value-0';
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
            expect(hasSuccessfulSabotageLog(reference.after.logs)).toBe(true);
            expect(hasSuccessfulSabotageLog(core.after.logs)).toBe(true);
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

type SabotageInjuryBoundaryCase = {
    action: 'che_화계' | 'che_선동' | 'che_파괴';
    stat: 'leadership' | 'strength' | 'intelligence';
    hiddenSeed: string;
};

const sabotageInjuryBoundaryCases: SabotageInjuryBoundaryCase[] = [
    { action: 'che_화계', stat: 'intelligence', hiddenSeed: 'general-injury-4' },
    { action: 'che_선동', stat: 'leadership', hiddenSeed: 'general-injury-13' },
    { action: 'che_파괴', stat: 'strength', hiddenSeed: 'general-injury-4' },
];

const injuryLogTexts = (logs: Array<Record<string, unknown>>): string[] =>
    logs
        .map((entry) => entry.text)
        .filter((text): text is string => typeof text === 'string' && text.includes('부상</>을 당했습니다.'));

const legacyInjuryLogBody = (text: string): string => text.replace(/^<C>●<\/>\d+월:/, '');

integration('general sabotage injury boundary matrix', () => {
    it.each(sabotageInjuryBoundaryCases)(
        '$action matches legacy injury cap, integer persistence, and log',
        async ({ action, stat, hiddenSeed }) => {
            const request = buildRequest(
                action,
                { destCityID: 70 },
                { [stat]: 100 },
                {
                    generals: {
                        2: {
                            [stat]: 10,
                            injury: 79,
                            crew: 101,
                            atmos: 51,
                            train: 51,
                        },
                    },
                    cities: { 70: { security: 0, securityMax: 2_000 } },
                }
            );
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
            expect(injuryLogTexts(reference.after.logs)).toHaveLength(1);
            expect(injuryLogTexts(core.after.logs)).toEqual(
                injuryLogTexts(reference.after.logs).map(legacyInjuryLogBody)
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

integration('general command alternative matrix', () => {
    const expectAlternativeParity = async (
        request: TurnCommandFixtureRequest,
        expectedActionKey: string,
        expectedLogText: string
    ): Promise<void> => {
        const reference = runReferenceTurnCommandTraceRequest(
            workspaceRoot!,
            request as unknown as Record<string, unknown>
        );
        const core = await runCoreTurnCommandTrace(request, reference.before);

        expect(reference.execution.outcome).toMatchObject({ completed: false });
        expect(core.execution.outcome).toMatchObject({
            requestedAction: request.action,
            actionKey: expectedActionKey,
            usedFallback: false,
        });
        expect(
            reference.after.logs.some((entry) => typeof entry.text === 'string' && entry.text.includes(expectedLogText))
        ).toBe(true);
        expect(
            core.after.logs.some((entry) => typeof entry.text === 'string' && entry.text.includes(expectedLogText))
        ).toBe(true);
        expect(core.rng).toEqual(reference.rng);
        expect(
            compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                ignoredPathPatterns: ignoredLifecyclePaths,
            })
        ).toEqual([]);
    };

    it('che_해산 continues into che_인재탐색 with the legacy RNG and state delta', async () => {
        const request = buildRequest(
            'che_해산',
            undefined,
            {},
            {
                world: { initYear: 190, initMonth: 1 },
                nations: { 1: { level: 0, capitalCityId: 0, typeCode: 'None' } },
            }
        );
        request.setup!.world!.hiddenSeed = 'general-alternative-disband-search';
        await expectAlternativeParity(request, 'che_인재탐색', '다음 턴부터 해산할 수 있습니다.');
    }, 120_000);

    it('che_랜덤임관 continues into che_인재탐색 when no eligible nation exists', async () => {
        const request = buildRequest(
            'che_랜덤임관',
            undefined,
            { nationId: 0, officerLevel: 0 },
            {
                generals: {
                    2: { npcState: 5 },
                    3: { npcState: 5 },
                },
            }
        );
        request.setup!.world!.hiddenSeed = 'general-alternative-random-appointment-search';
        await expectAlternativeParity(request, 'che_인재탐색', '임관 가능한 국가가 없습니다.');
    }, 120_000);

    it('che_무작위건국 continues into che_인재탐색 during the initial month', async () => {
        const request = buildRequest(
            'che_무작위건국',
            { nationName: '신국', nationType: 'che_도적', colorType: 1 },
            {},
            {
                world: { startYear: 190, initYear: 190, initMonth: 1 },
                nations: { 1: { level: 0, capitalCityId: 0, typeCode: 'None' } },
            }
        );
        request.setup!.world!.hiddenSeed = 'general-alternative-random-founding-search';
        await expectAlternativeParity(request, 'che_인재탐색', '다음 턴부터 건국할 수 있습니다.');
    }, 120_000);

    it('che_무작위건국 continues into che_해산 when no founding city exists', async () => {
        const request = buildRequest(
            'che_무작위건국',
            { nationName: '신국', nationType: 'che_도적', colorType: 1 },
            {},
            {
                world: { initYear: 180, initMonth: 1, year: 181 },
                nations: { 1: { level: 0, capitalCityId: 0, typeCode: 'None' } },
                cities: {
                    3: { nationId: 1, level: 4 },
                    70: { nationId: 0, level: 4 },
                },
                randomFoundingCandidateCityIds: [3],
            }
        );
        request.setup!.world!.hiddenSeed = 'general-alternative-random-founding-disband';
        await expectAlternativeParity(request, 'che_해산', '건국할 수 있는 도시가 없습니다.');
    }, 120_000);

    it('che_출병 continues into che_이동 when the destination belongs to the actor nation', async () => {
        const request = buildRequest(
            'che_출병',
            { destCityID: 70 },
            {},
            {
                world: { startYear: 180, year: 185 },
                cities: { 70: { nationId: 1, supplyState: 1, frontState: 0 } },
                generals: { 2: { nationId: 1 } },
            }
        );
        request.setup!.world!.hiddenSeed = 'general-alternative-sortie-move';
        await expectAlternativeParity(request, 'che_이동', '본국입니다.');
    }, 120_000);
});

type GeneralPreReqBoundaryCase = {
    name: string;
    action: string;
    actorPatch?: Record<string, unknown>;
    expectedCommand: string;
    expectedTerm: number;
    expectedProgressText: string;
};

const generalPreReqBoundaryCases: GeneralPreReqBoundaryCase[] = [
    {
        name: 'battle preparation starts at term 1',
        action: 'che_전투태세',
        expectedCommand: '전투태세',
        expectedTerm: 1,
        expectedProgressText: '전투태세 수행중... (1/4)',
    },
    {
        name: 'battle preparation advances term 1 to 2',
        action: 'che_전투태세',
        actorPatch: { lastTurn: { command: '전투태세', term: 1 } },
        expectedCommand: '전투태세',
        expectedTerm: 2,
        expectedProgressText: '전투태세 수행중... (2/4)',
    },
    {
        name: 'battle preparation advances term 2 to 3',
        action: 'che_전투태세',
        actorPatch: { lastTurn: { command: '전투태세', term: 2 } },
        expectedCommand: '전투태세',
        expectedTerm: 3,
        expectedProgressText: '전투태세 수행중... (3/4)',
    },
    {
        name: 'domestic trait reset starts at term 1 after another command',
        action: 'che_내정특기초기화',
        actorPatch: {
            specialDomestic: 'che_인덕',
            lastTurn: { command: '전투태세', term: 3 },
        },
        expectedCommand: '내정 특기 초기화',
        expectedTerm: 1,
        expectedProgressText: '새로운 적성을 찾는 중... (1/2)',
    },
    {
        name: 'war trait reset starts at term 1',
        action: 'che_전투특기초기화',
        actorPatch: { specialWar: 'che_귀병' },
        expectedCommand: '전투 특기 초기화',
        expectedTerm: 1,
        expectedProgressText: '새로운 적성을 찾는 중... (1/2)',
    },
    {
        name: 'retirement starts at term 1 without applying retirement',
        action: 'che_은퇴',
        actorPatch: { age: 60 },
        expectedCommand: '은퇴',
        expectedTerm: 1,
        expectedProgressText: '은퇴 수행중... (1/2)',
    },
];

integration('general command pre-required turn boundary matrix', () => {
    it.each(generalPreReqBoundaryCases)(
        '$name matches legacy intermediate last-turn state without consuming command RNG',
        async ({ action, actorPatch, expectedCommand, expectedTerm, expectedProgressText }) => {
            const request = buildRequest(action, undefined, actorPatch);
            request.setup!.world!.hiddenSeed = `general-prereq-${action}-${expectedTerm}`;
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);
            const referenceActor = reference.after.generals.find((entry) => entry.id === 1);
            const coreActor = core.after.generals.find((entry) => entry.id === 1);

            expect(reference.execution.outcome).toMatchObject({ completed: false });
            expect(core.execution.outcome).toMatchObject({
                requestedAction: action,
                actionKey: action,
                usedFallback: false,
            });
            expect(referenceActor?.lastTurn).toMatchObject({
                command: expectedCommand,
                term: expectedTerm,
            });
            expect(coreActor?.lastTurn).toMatchObject({
                command: expectedCommand,
                term: expectedTerm,
            });
            expect(reference.after.logs.some((entry) => String(entry.text).includes(expectedProgressText))).toBe(true);
            expect(core.after.logs.some((entry) => String(entry.text).includes(expectedProgressText))).toBe(true);
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

const readGeneralCooldown = (
    snapshot: { world: Record<string, unknown> },
    generalId: number,
    actionName: string
): number | null => {
    const cooldowns = Array.isArray(snapshot.world.generalCooldowns) ? snapshot.world.generalCooldowns : [];
    const matched = cooldowns.find(
        (entry) =>
            typeof entry === 'object' &&
            entry !== null &&
            (entry as Record<string, unknown>).generalId === generalId &&
            (entry as Record<string, unknown>).actionName === actionName
    );
    const value =
        typeof matched === 'object' && matched !== null ? (matched as Record<string, unknown>).nextAvailableTurn : null;
    return typeof value === 'number' ? value : null;
};

integration('general command post-required cooldown boundary matrix', () => {
    it('stores the same 60-turn cooldown after domestic trait reset completion', async () => {
        const request = buildRequest('che_내정특기초기화', undefined, {
            specialDomestic: 'che_인덕',
            lastTurn: { command: '내정 특기 초기화', term: 1 },
        });
        request.observe!.generalCooldowns = [{ generalId: 1, actionName: '내정 특기 초기화' }];
        const reference = runReferenceTurnCommandTraceRequest(
            workspaceRoot!,
            request as unknown as Record<string, unknown>
        );
        const core = await runCoreTurnCommandTrace(request, reference.before);
        const expectedNextAvailableTurn = 190 * 12 + 1 - 1 + 60 - 1;

        expect(reference.execution.outcome).toMatchObject({ completed: true });
        expect(core.execution.outcome).toMatchObject({
            requestedAction: 'che_내정특기초기화',
            actionKey: 'che_내정특기초기화',
            usedFallback: false,
        });
        expect(readGeneralCooldown(reference.after, 1, '내정 특기 초기화')).toBe(expectedNextAvailableTurn);
        expect(readGeneralCooldown(core.after, 1, '내정 특기 초기화')).toBe(expectedNextAvailableTurn);
        expect(core.rng).toEqual(reference.rng);
        expect(
            compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                ignoredPathPatterns: ignoredLifecyclePaths,
            })
        ).toEqual([]);
    }, 120_000);

    it('blocks domestic trait reset one turn before the cooldown boundary', async () => {
        const currentYearMonth = 190 * 12 + 1 - 1;
        const request = buildRequest('che_내정특기초기화', undefined, {
            specialDomestic: 'che_인덕',
            lastTurn: { command: '내정 특기 초기화', term: 1 },
        });
        request.setup!.generalCooldowns = [
            {
                generalId: 1,
                actionName: '내정 특기 초기화',
                nextAvailableTurn: currentYearMonth + 1,
            },
        ];
        request.observe!.generalCooldowns = [{ generalId: 1, actionName: '내정 특기 초기화' }];
        const reference = runReferenceTurnCommandTraceRequest(
            workspaceRoot!,
            request as unknown as Record<string, unknown>
        );
        const core = await runCoreTurnCommandTrace(request, reference.before);

        expect(readGeneralCooldown(reference.before, 1, '내정 특기 초기화')).toBe(currentYearMonth + 1);
        expect(readGeneralCooldown(core.before, 1, '내정 특기 초기화')).toBe(currentYearMonth + 1);
        expect(reference.execution.outcome).toMatchObject({ completed: false });
        expect(core.execution.outcome).toMatchObject({
            requestedAction: 'che_내정특기초기화',
            actionKey: '휴식',
            usedFallback: true,
            blockedReason: '1턴 더 기다려야 합니다',
        });
        expect(reference.after.logs.some((entry) => String(entry.text).includes('1턴 더 기다려야 합니다'))).toBe(true);
        expect(core.after.logs.some((entry) => String(entry.text).includes('1턴 더 기다려야 합니다'))).toBe(true);
        expect(readGeneralCooldown(reference.after, 1, '내정 특기 초기화')).toBe(currentYearMonth + 1);
        expect(readGeneralCooldown(core.after, 1, '내정 특기 초기화')).toBe(currentYearMonth + 1);
        expect(core.rng).toEqual(reference.rng);
        expect(
            compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                ignoredPathPatterns: ignoredLifecyclePaths,
            })
        ).toEqual([]);
    }, 120_000);

    it('allows war trait reset exactly at the cooldown boundary', async () => {
        const currentYearMonth = 190 * 12 + 1 - 1;
        const request = buildRequest('che_전투특기초기화', undefined, {
            specialWar: 'che_귀병',
            lastTurn: { command: '전투 특기 초기화', term: 1 },
        });
        request.setup!.generalCooldowns = [
            {
                generalId: 1,
                actionName: '전투 특기 초기화',
                nextAvailableTurn: currentYearMonth,
            },
        ];
        request.observe!.generalCooldowns = [{ generalId: 1, actionName: '전투 특기 초기화' }];
        const reference = runReferenceTurnCommandTraceRequest(
            workspaceRoot!,
            request as unknown as Record<string, unknown>
        );
        const core = await runCoreTurnCommandTrace(request, reference.before);
        const expectedNextAvailableTurn = currentYearMonth + 60 - 1;

        expect(reference.execution.outcome).toMatchObject({ completed: true });
        expect(core.execution.outcome).toMatchObject({
            requestedAction: 'che_전투특기초기화',
            actionKey: 'che_전투특기초기화',
            usedFallback: false,
        });
        expect(readGeneralCooldown(reference.after, 1, '전투 특기 초기화')).toBe(expectedNextAvailableTurn);
        expect(readGeneralCooldown(core.after, 1, '전투 특기 초기화')).toBe(expectedNextAvailableTurn);
        expect(core.rng).toEqual(reference.rng);
        expect(
            compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                ignoredPathPatterns: ignoredLifecyclePaths,
            })
        ).toEqual([]);
    }, 120_000);
});

const missingTargetCases: Array<{ name: string; action: string; args: Record<string, unknown> }> = [
    {
        name: 'gift to a missing general',
        action: 'che_증여',
        args: { isGold: true, amount: 100, destGeneralID: 999 },
    },
    {
        name: 'spy on a missing city',
        action: 'che_첩보',
        args: { destCityID: 999 },
    },
    {
        name: 'move to a missing city',
        action: 'che_이동',
        args: { destCityID: 999 },
    },
    {
        name: 'employ a missing general',
        action: 'che_등용',
        args: { destGeneralID: 999 },
    },
];

integration('general command missing-target fallback matrix', () => {
    it.each(missingTargetCases)(
        '$name rejects the missing target and falls back without command RNG',
        async ({ action, args }) => {
            const request = buildRequest(action, args);
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

const resourceAmountCases: Array<{
    name: string;
    action: string;
    args: Record<string, unknown>;
    expectedAmount: number;
}> = [
    {
        name: 'gift rounds a half unit up',
        action: 'che_증여',
        args: { isGold: true, amount: 150, destGeneralID: 3 },
        expectedAmount: 200,
    },
    {
        name: 'gift clamps below the minimum',
        action: 'che_증여',
        args: { isGold: true, amount: 1, destGeneralID: 3 },
        expectedAmount: 100,
    },
    {
        name: 'gift clamps above the maximum',
        action: 'che_증여',
        args: { isGold: true, amount: 10_050, destGeneralID: 3 },
        expectedAmount: 10_000,
    },
    {
        name: 'donation rounds a half unit up',
        action: 'che_헌납',
        args: { isGold: true, amount: 150 },
        expectedAmount: 200,
    },
    {
        name: 'donation clamps below the minimum',
        action: 'che_헌납',
        args: { isGold: true, amount: 1 },
        expectedAmount: 100,
    },
    {
        name: 'donation clamps above the maximum',
        action: 'che_헌납',
        args: { isGold: true, amount: 10_050 },
        expectedAmount: 10_000,
    },
    {
        name: 'trade rounds a half unit up',
        action: 'che_군량매매',
        args: { buyRice: true, amount: 150 },
        expectedAmount: 200,
    },
    {
        name: 'trade clamps below the minimum',
        action: 'che_군량매매',
        args: { buyRice: true, amount: 1 },
        expectedAmount: 100,
    },
    {
        name: 'trade clamps above the maximum',
        action: 'che_군량매매',
        args: { buyRice: true, amount: 10_050 },
        expectedAmount: 10_000,
    },
];

integration('general command resource amount normalization matrix', () => {
    it.each(resourceAmountCases)(
        '$name matches legacy rounding and clamp semantics',
        async ({ action, args, expectedAmount }) => {
            const request = buildRequest(action, args);
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);
            const referenceActor = reference.after.generals.find((entry) => entry.id === 1);
            const coreActor = core.after.generals.find((entry) => entry.id === 1);
            const referenceLastTurn = referenceActor?.lastTurn as { arg?: Record<string, unknown> } | null | undefined;
            const coreLastTurn = coreActor?.lastTurn as { arg?: Record<string, unknown> } | null | undefined;

            expect(reference.execution.outcome).toMatchObject({ completed: true });
            expect(core.execution.outcome).toMatchObject({
                requestedAction: action,
                actionKey: action,
                usedFallback: false,
            });
            expect(referenceLastTurn?.arg).toMatchObject({ amount: expectedAmount });
            expect(coreLastTurn?.arg).toMatchObject({ amount: expectedAmount });
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

integration('general command donation resource boundaries', () => {
    it('donates the available resource when the normalized request exceeds the current amount', async () => {
        const request = buildRequest('che_헌납', { isGold: true, amount: 10_000 }, { gold: 5_000 });
        const reference = runReferenceTurnCommandTraceRequest(
            workspaceRoot!,
            request as unknown as Record<string, unknown>
        );
        const core = await runCoreTurnCommandTrace(request, reference.before);

        expect(reference.execution.outcome).toMatchObject({ completed: true });
        expect(core.execution.outcome).toMatchObject({
            requestedAction: 'che_헌납',
            actionKey: 'che_헌납',
            usedFallback: false,
        });
        expect(core.rng).toEqual(reference.rng);
        expect(
            compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                ignoredPathPatterns: ignoredLifecyclePaths,
            })
        ).toEqual([]);
    }, 120_000);

    it('falls back when current rice is below the legacy minimum even for a small request', async () => {
        const request = buildRequest('che_헌납', { isGold: false, amount: 100 }, { rice: 499 });
        const reference = runReferenceTurnCommandTraceRequest(
            workspaceRoot!,
            request as unknown as Record<string, unknown>
        );
        const core = await runCoreTurnCommandTrace(request, reference.before);

        expect(reference.execution.outcome).toMatchObject({ completed: false });
        expect(core.execution.outcome).toMatchObject({
            requestedAction: 'che_헌납',
            actionKey: '휴식',
            usedFallback: true,
        });
        expect(core.rng).toEqual(reference.rng);
        expect(
            compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                ignoredPathPatterns: ignoredLifecyclePaths,
            })
        ).toEqual([]);
    }, 120_000);
});

integration('general command gift resource and target boundaries', () => {
    it('keeps the legacy minimum rice reserve while gifting the available amount', async () => {
        const request = buildRequest('che_증여', { isGold: false, amount: 10_000, destGeneralID: 3 }, { rice: 600 });
        const reference = runReferenceTurnCommandTraceRequest(
            workspaceRoot!,
            request as unknown as Record<string, unknown>
        );
        const core = await runCoreTurnCommandTrace(request, reference.before);

        expect(reference.execution.outcome).toMatchObject({ completed: true });
        expect(core.execution.outcome).toMatchObject({
            requestedAction: 'che_증여',
            actionKey: 'che_증여',
            usedFallback: false,
        });
        expect(core.rng).toEqual(reference.rng);
        expect(
            compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                ignoredPathPatterns: ignoredLifecyclePaths,
            })
        ).toEqual([]);
    }, 120_000);

    it('rejects gifting to the actor and falls back without command RNG', async () => {
        const request = buildRequest('che_증여', { isGold: true, amount: 100, destGeneralID: 1 });
        const reference = runReferenceTurnCommandTraceRequest(
            workspaceRoot!,
            request as unknown as Record<string, unknown>
        );
        const core = await runCoreTurnCommandTrace(request, reference.before);

        expect(reference.execution.outcome).toMatchObject({ completed: false });
        expect(core.execution.outcome).toMatchObject({
            requestedAction: 'che_증여',
            actionKey: '휴식',
            usedFallback: true,
        });
        expect(core.rng).toEqual(reference.rng);
        expect(
            compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                ignoredPathPatterns: ignoredLifecyclePaths,
            })
        ).toEqual([]);
    }, 120_000);
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
    {
        name: 'sabotage targets the occupied city',
        action: 'che_화계',
        args: { destCityID: 3 },
    },
    {
        name: 'sabotage targets a neutral city',
        action: 'che_화계',
        args: { destCityID: 70 },
        fixturePatches: { cities: { 70: { nationId: 0 } } },
    },
    {
        name: 'sabotage targets a non-aggression nation',
        action: 'che_화계',
        args: { destCityID: 70 },
        fixturePatches: {
            diplomacy: {
                '1:2': { state: 7 },
                '2:1': { state: 7 },
            },
        },
    },
    {
        name: 'insufficient sabotage gold',
        action: 'che_화계',
        args: { destCityID: 70 },
        actorPatch: { gold: 0 },
    },
    {
        name: 'insufficient sabotage rice',
        action: 'che_화계',
        args: { destCityID: 70 },
        actorPatch: { rice: 0 },
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
