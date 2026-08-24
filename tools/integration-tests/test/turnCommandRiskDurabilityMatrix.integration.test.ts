import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asRecord } from '@sammo-ts/common';
import {
    GENERAL_TURN_COMMAND_KEYS,
    NATION_TURN_COMMAND_KEYS,
    type GeneralTurnCommandKey,
    type NationTurnCommandKey,
} from '@sammo-ts/logic';
import { createDatabaseTurnHooks } from '@sammo-ts/game-engine/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '@sammo-ts/game-engine/turn/inMemoryWorld.js';
import { createReservedTurnHandler } from '@sammo-ts/game-engine/turn/reservedTurnHandler.js';
import { InMemoryReservedTurnStore } from '@sammo-ts/game-engine/turn/reservedTurnStore.js';
import { loadMapDefinitionByName } from '@sammo-ts/game-engine/scenario/mapLoader.js';
import { loadUnitSetDefinitionByName } from '@sammo-ts/game-engine/scenario/unitSetLoader.js';
import { loadTurnWorldFromDatabase } from '@sammo-ts/game-engine/turn/worldLoader.js';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import {
    commandDurabilityEvidence,
    generalCommandDurabilityRisk,
    nationCommandDurabilityRisk,
    type CommandDurabilityRisk,
} from '../src/turn-differential/commandDurabilityRisk.js';
import {
    canonicalizeTurnCommandArgs,
    type CanonicalTurnSnapshot,
    type TurnSnapshotSelector,
} from '../src/turn-differential/canonical.js';
import { compareTurnSnapshotDeltas } from '../src/turn-differential/compare.js';
import {
    clearCoreTurnCommandPersistenceFixture,
    seedCoreTurnCommandPersistenceFixture,
} from '../src/turn-differential/coreCommandPersistenceFixture.js';
import {
    buildCoreTurnCommandWorldInput,
    createCoreTurnCommandProfile,
    resolveCoreTurnCommandArgs,
    runCoreTurnCommandTrace,
    type TurnCommandFixtureRequest,
} from '../src/turn-differential/coreCommandTrace.js';
import { readCoreDatabaseSnapshot } from '../src/turn-differential/databaseSnapshot.js';
import { normalizeStoredTurnLogText, orderedSemanticLogStreams } from '../src/turn-differential/logProjection.js';
import { projectSemanticTurnMessages } from '../src/turn-differential/messageProjection.js';
import {
    findTurnDifferentialWorkspaceRoot,
    runReferenceTurnCommandTraceRequest,
} from '../src/turn-differential/referenceSnapshot.js';

const databaseUrl = process.env.TURN_COMMAND_DURABLE_MATRIX_DATABASE_URL;
const workspaceRoot = process.env.TURN_DIFFERENTIAL_WORKSPACE_ROOT ?? findTurnDifferentialWorkspaceRoot(process.cwd());
const referenceSourceRoot = workspaceRoot
    ? path.resolve(process.env.REF_COMPARE_SOURCE_ROOT ?? path.join(workspaceRoot, 'ref/sam'))
    : null;
const hasReferenceRunner =
    referenceSourceRoot !== null && fs.existsSync(path.join(referenceSourceRoot, 'hwe/compare/turn_command_trace.php'));
const databaseIntegration = describe.skipIf(
    !databaseUrl || !workspaceRoot || !hasReferenceRunner || process.env.TURN_DIFFERENTIAL_REFERENCE !== '1'
);
const dedicatedSuffix = 'turn_command_durable_matrix';
const leaseOwner = 'turn-command-durable-matrix-daemon';
const siblingRulerGeneralId = 3;
const siblingGeneralTurnRevisionSentinel = {
    generalId: siblingRulerGeneralId,
    revision: 37,
    leaseOwner,
    leaseExpiresAt: new Date('2099-08-24T12:34:56.789Z'),
};

const buildSiblingNationTurnRevisionSentinel = (actorNationId: number, actorOfficerLevel: number) => ({
    nationId: actorOfficerLevel === 5 ? actorNationId : 2,
    officerLevel: 12,
    revision: 41,
    leaseOwner,
    leaseExpiresAt: new Date('2099-08-24T23:45:01.234Z'),
});

const readSiblingTurnRevisionSentinels = async (
    db: GamePrismaClient,
    siblingNationSentinel: ReturnType<typeof buildSiblingNationTurnRevisionSentinel>
) => ({
    general: await db.generalTurnRevision.findUniqueOrThrow({
        where: { generalId: siblingGeneralTurnRevisionSentinel.generalId },
        select: { generalId: true, revision: true, leaseOwner: true, leaseExpiresAt: true },
    }),
    nation: await db.nationTurnRevision.findUniqueOrThrow({
        where: {
            nationId_officerLevel: {
                nationId: siblingNationSentinel.nationId,
                officerLevel: siblingNationSentinel.officerLevel,
            },
        },
        select: { nationId: true, officerLevel: true, revision: true, leaseOwner: true, leaseExpiresAt: true },
    }),
});

export const assertDedicatedTurnCommandDurableMatrixDatabase = (rawUrl: string): void => {
    const url = new URL(rawUrl);
    const schema = url.searchParams.get('schema');
    const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!schema?.endsWith(dedicatedSuffix) && !databaseName.endsWith(dedicatedSuffix)) {
        throw new Error(
            `Refusing to mutate non-dedicated turn command durable matrix database: schema=${schema ?? '(missing)'}, database=${databaseName || '(missing)'}`
        );
    }
};

describe('turn command durability risk manifest', () => {
    it('classifies the exact 55 general and 35 nation command registries without duplicates', () => {
        expect(Object.keys(generalCommandDurabilityRisk).sort()).toEqual([...GENERAL_TURN_COMMAND_KEYS].sort());
        expect(Object.keys(nationCommandDurabilityRisk).sort()).toEqual([...NATION_TURN_COMMAND_KEYS].sort());
        expect(Object.keys(generalCommandDurabilityRisk)).toHaveLength(55);
        expect(Object.keys(nationCommandDurabilityRisk)).toHaveLength(35);
    });

    it('keeps the reviewed R1/R2/R3 population stable and explicit', () => {
        const counts = (values: CommandDurabilityRisk[]) =>
            Object.fromEntries(
                (['R1', 'R2', 'R3'] as const).map((risk) => [risk, values.filter((value) => value === risk).length])
            );

        expect(counts(Object.values(generalCommandDurabilityRisk))).toEqual({ R1: 14, R2: 16, R3: 25 });
        expect(counts(Object.values(nationCommandDurabilityRisk))).toEqual({ R1: 12, R2: 3, R3: 20 });
    });

    it('assigns a dedicated PostgreSQL representative to every scope/risk cell and stronger R3 facet', () => {
        const matrixCells = new Set(
            commandDurabilityEvidence
                .filter((entry) => entry.matrixRepresentative)
                .map((entry) => `${entry.scope}:${entry.risk}`)
        );
        const requiredCells = (['general', 'nation'] as const).flatMap((scope) =>
            (['R1', 'R2', 'R3'] as const).map((risk) => `${scope}:${risk}`)
        );
        expect([...matrixCells].sort()).toEqual(requiredCells.sort());

        const facets = new Set(commandDurabilityEvidence.map((entry) => entry.facet));
        expect(facets).toEqual(
            new Set([
                'single-actor',
                'local-aggregate',
                'cross-entity',
                'placement-topology',
                'hostile-rng-destructive',
                'diplomacy-strategy',
                'entity-creation-fanout',
                'retirement-archive',
                'multi-turn-research',
            ])
        );
    });

    it('keeps every declared PostgreSQL representative synchronized with its typed risk inventory and executed case', () => {
        const evidence = commandDurabilityEvidence
            .filter((entry) => entry.matrixRepresentative)
            .map(({ scope, risk, command }) => `${scope}:${risk}:${command}`)
            .sort();
        const cases = riskMatrixCases.map(({ scope, risk, action }) => `${scope}:${risk}:${action}`).sort();
        expect(cases).toEqual(evidence);

        for (const entry of riskMatrixCases) {
            const classifiedRisk =
                entry.scope === 'general'
                    ? generalCommandDurabilityRisk[entry.action]
                    : nationCommandDurabilityRisk[entry.action];
            expect(entry.risk, `${entry.scope}:${entry.action}`).toBe(classifiedRisk);
        }
    });
});

describe('turn command durable matrix database guard', () => {
    it('rejects a shared database and schema before connecting', () => {
        expect(() =>
            assertDedicatedTurnCommandDurableMatrixDatabase(
                'postgresql://fixture:fixture@127.0.0.1:5432/sammo?schema=public'
            )
        ).toThrow('Refusing to mutate non-dedicated turn command durable matrix database');
    });

    it('accepts only an explicitly dedicated schema or database name', () => {
        expect(() =>
            assertDedicatedTurnCommandDurableMatrixDatabase(
                'postgresql://fixture:fixture@127.0.0.1:5432/sammo?schema=ci_turn_command_durable_matrix'
            )
        ).not.toThrow();
        expect(() =>
            assertDedicatedTurnCommandDurableMatrixDatabase(
                'postgresql://fixture:fixture@127.0.0.1:5432/ci_turn_command_durable_matrix'
            )
        ).not.toThrow();
    });
});

const general = (id: number, nationId: number, cityId: number, officerLevel: number): Record<string, unknown> => ({
    id,
    name: `위험행렬장수${id}`,
    nationId,
    cityId,
    troopId: 0,
    leadership: 90,
    strength: 80,
    intelligence: 70,
    leadershipExp: 0,
    strengthExp: 0,
    intelExp: 0,
    experience: 1_000,
    dedication: 1_000,
    expLevel: 0,
    officerLevel,
    officerCityId: officerLevel >= 5 ? cityId : 0,
    belong: 10,
    permission: 'normal',
    injury: 0,
    age: 30,
    gold: 100_000,
    rice: 100_000,
    crew: 1_000,
    crewTypeId: 1_100,
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

interface RiskMatrixCaseBase {
    label: string;
    risk: CommandDurabilityRisk;
    args?: Record<string, unknown>;
    nationPatch?: Record<string, unknown>;
    cityPatch?: Record<string, unknown>;
}

type RiskMatrixCase =
    | (RiskMatrixCaseBase & { scope: 'general'; action: GeneralTurnCommandKey })
    | (RiskMatrixCaseBase & { scope: 'nation'; action: NationTurnCommandKey });

const riskMatrixCases: RiskMatrixCase[] = [
    { label: 'general actor aggregate', scope: 'general', risk: 'R1', action: 'che_훈련' },
    { label: 'general/city cross aggregate', scope: 'general', risk: 'R2', action: 'che_농지개간' },
    {
        label: 'general multi-party resource transfer',
        scope: 'general',
        risk: 'R3',
        action: 'che_증여',
        args: { isGold: true, amount: 100, destGeneralID: 3 },
    },
    {
        label: 'general placement topology',
        scope: 'general',
        risk: 'R3',
        action: 'che_이동',
        args: { destCityID: 70 },
    },
    {
        label: 'nation aggregate',
        scope: 'nation',
        risk: 'R1',
        action: 'che_국호변경',
        args: { nationName: '위험행렬국' },
    },
    {
        label: 'nation/capital topology',
        scope: 'nation',
        risk: 'R2',
        action: 'che_증축',
        nationPatch: {
            capitalRevision: 0,
            turnLastByOfficerLevel: { 12: { command: '증축', arg: {}, term: 5, seq: 0 } },
        },
        cityPatch: { level: 7 },
    },
    {
        label: 'nation diplomacy relationship',
        scope: 'nation',
        risk: 'R3',
        action: 'che_선전포고',
        args: { destNationID: 2 },
    },
    {
        label: 'nation cross-entity material aid',
        scope: 'nation',
        risk: 'R3',
        action: 'che_물자원조',
        args: { destNationID: 2, amountList: [100, 200] },
        nationPatch: {
            turnLastByOfficerLevel: {
                12: { command: '국호 변경', arg: { nationName: '수뇌보존국' }, term: 7, seq: 3 },
            },
        },
    },
    {
        label: 'nation multi-turn research completion',
        scope: 'nation',
        risk: 'R1',
        action: 'event_원융노병연구',
        nationPatch: {
            turnLastByOfficerLevel: { 12: { command: '원융노병 연구', term: 23 } },
        },
    },
];

const buildRiskMatrixRequest = (entry: RiskMatrixCase): TurnCommandFixtureRequest => {
    const validatesMinimumChiefBoundary = entry.action === 'che_물자원조';
    const actorOfficerLevel = validatesMinimumChiefBoundary ? 5 : 12;
    const siblingRulerTurns = validatesMinimumChiefBoundary
        ? Array.from({ length: 12 }, (_, turnIndex) => ({
              nationId: 1,
              officerLevel: 12,
              turnIndex,
              action: turnIndex === 0 ? 'che_국호변경' : '휴식',
              args: turnIndex === 0 ? { nationName: '수뇌보존대기국' } : {},
          }))
        : [];

    return {
        kind: entry.scope,
        actorGeneralId: 1,
        action: entry.action,
        ...(entry.args ? { args: entry.args } : {}),
        includeLifecycle: true,
        setup: {
            isolateWorld: true,
            world: {
                startYear: 180,
                year: 190,
                month: 1,
                hiddenSeed: `turn-command-durable-${entry.scope}-${entry.action}`,
                freezeClock: true,
            },
            nations: [
                {
                    id: 1,
                    name: '아국',
                    color: '#777777',
                    capitalCityId: 3,
                    gold: 1_000_000,
                    rice: 1_000_000,
                    tech: 1_000,
                    level: 1,
                    typeCode: 'che_명가',
                    war: 0,
                    diplomacyLimit: 0,
                    strategicCommandLimit: 0,
                    generalCount: 2,
                    meta: { can_국호변경: 1, can_국기변경: 1, surlimit: 0 },
                    ...entry.nationPatch,
                },
                {
                    id: 2,
                    name: '타국',
                    color: '#888888',
                    capitalCityId: 71,
                    gold: 1_000_000,
                    rice: 1_000_000,
                    tech: 1_000,
                    level: 1,
                    typeCode: 'che_명가',
                    war: 0,
                    diplomacyLimit: 0,
                    strategicCommandLimit: 0,
                    generalCount: 1,
                    meta: { surlimit: 0 },
                },
            ],
            cities: [
                {
                    id: 3,
                    nationId: 1,
                    level: 5,
                    population: 100_000,
                    populationMax: 200_000,
                    agriculture: 1_000,
                    agricultureMax: 2_000,
                    commerce: 1_000,
                    commerceMax: 2_000,
                    security: 1_000,
                    securityMax: 2_000,
                    defence: 1_000,
                    defenceMax: 2_000,
                    wall: 1_000,
                    wallMax: 2_000,
                    supplyState: 1,
                    frontState: 0,
                    state: 0,
                    term: 0,
                    trust: 80,
                    trade: 100,
                    ...entry.cityPatch,
                },
                {
                    id: 70,
                    nationId: 1,
                    level: 5,
                    population: 100_000,
                    populationMax: 200_000,
                    agriculture: 1_000,
                    agricultureMax: 2_000,
                    commerce: 1_000,
                    commerceMax: 2_000,
                    security: 1_000,
                    securityMax: 2_000,
                    defence: 1_000,
                    defenceMax: 2_000,
                    wall: 1_000,
                    wallMax: 2_000,
                    supplyState: 1,
                    frontState: 1,
                    state: 0,
                    term: 0,
                    trust: 80,
                    trade: 100,
                },
                {
                    id: 71,
                    nationId: 2,
                    level: 5,
                    population: 100_000,
                    populationMax: 200_000,
                    agriculture: 1_000,
                    agricultureMax: 2_000,
                    commerce: 1_000,
                    commerceMax: 2_000,
                    security: 1_000,
                    securityMax: 2_000,
                    defence: 1_000,
                    defenceMax: 2_000,
                    wall: 1_000,
                    wallMax: 2_000,
                    supplyState: 1,
                    frontState: 1,
                    state: 0,
                    term: 0,
                    trust: 80,
                    trade: 100,
                },
            ],
            generals: [
                general(1, 1, 3, actorOfficerLevel),
                general(2, 2, 71, 12),
                general(siblingRulerGeneralId, 1, 3, validatesMinimumChiefBoundary ? 12 : 1),
            ],
            diplomacy: [
                { fromNationId: 1, toNationId: 2, state: 3, term: 0, dead: 0 },
                { fromNationId: 2, toNationId: 1, state: 3, term: 0, dead: 0 },
            ],
            ...(entry.scope === 'general'
                ? {
                      generalTurns: Array.from({ length: 30 }, (_, turnIndex) => ({
                          generalId: 1,
                          turnIndex,
                          action: turnIndex === 0 ? entry.action : '휴식',
                          args: turnIndex === 0 ? (entry.args ?? {}) : {},
                      })),
                  }
                : {
                      nationTurns: [
                          ...Array.from({ length: 12 }, (_, turnIndex) => ({
                              nationId: 1,
                              officerLevel: actorOfficerLevel,
                              turnIndex,
                              action: turnIndex === 0 ? entry.action : '휴식',
                              args: turnIndex === 0 ? (entry.args ?? {}) : {},
                          })),
                          ...siblingRulerTurns,
                      ],
                  }),
        },
        observe: {
            allGenerals: true,
            allCities: true,
            allNations: true,
            allTroops: true,
            generalIds: [1, 2, 3],
            cityIds: [3, 70, 71],
            nationIds: [1, 2],
            troopIds: [],
            includeRankMirrors: true,
            logAfterId: 0,
            messageAfterId: 0,
            includeNationHistoryLogs: true,
            includeGlobalHistoryLogs: true,
        },
    };
};

const lifecycleIgnoredPaths = [
    /^generalTurns/,
    /^nationTurns/,
    /^logs/,
    /^messages/,
    /^world\.turnTime$/,
    /^world\.gameNow$/,
    /^world\.lastTurnTick$/,
    /^generals\[[^\]]+\]\.(?:turnTime|recentWarTime|lastTurn|killTurn|mySet|turnTick|turnSecond|turnFraction)(?:\.|$)/,
    /^generals\[[^\]]+\]\.meta(?:\.|$)/,
    /^nations\[[^\]]+\]\.meta\.(?:turn_last_\d+|next_execute_.+|capset|tech|gennum|power|war|surlimit|strategic_cmd_limit)(?:\.|$)/,
];

const addedReferenceLogs = (
    before: { watermarks: { logId: number; historyLogId: number } },
    after: Array<Record<string, unknown>>
): Array<Record<string, unknown>> =>
    after.filter((entry) => {
        const scope = String(entry.scope).toLowerCase();
        const category = String(entry.category).toLowerCase();
        const watermark =
            scope === 'nation' || (scope === 'system' && category === 'history')
                ? before.watermarks.historyLogId
                : before.watermarks.logId;
        return Number(entry.id) > watermark;
    });

const isTrailingDefaultGeneralRestLog = (entry: Record<string, unknown>): boolean =>
    String(entry.scope).toLowerCase() === 'general' &&
    String(entry.category).toLowerCase() === 'action' &&
    normalizeStoredTurnLogText(entry.text) === '아무것도 실행하지 않았습니다.';

const withoutVolatileGameNow = ({ world, ...snapshot }: CanonicalTurnSnapshot) => {
    const { gameNow: _gameNow, ...stableWorld } = world;
    return { ...snapshot, world: stableWorld };
};

const projectDatabaseIndependentTurnMessages = (
    messages: CanonicalTurnSnapshot['messages'],
    messageAfterId: number
) => {
    const newMessages = messages.filter((message) => Number(message.id) > messageAfterId);
    const projected = projectSemanticTurnMessages(messages, messageAfterId);
    const projectedById = new Map(newMessages.map((message, index) => [Number(message.id), projected[index]!]));

    return projected.map((message) => {
        const option =
            typeof message.option === 'object' && message.option !== null && !Array.isArray(message.option)
                ? (message.option as Record<string, unknown>)
                : null;
        if (!option || option.receiverMessageID === undefined) return message;

        if (
            typeof option.receiverMessageID !== 'number' ||
            !Number.isSafeInteger(option.receiverMessageID) ||
            option.receiverMessageID <= 0
        ) {
            throw new Error(`message receiverMessageID must be a positive safe integer number`);
        }
        const receiverMessageId = option.receiverMessageID;
        const receiverCopy = projectedById.get(receiverMessageId);
        if (
            !receiverCopy ||
            receiverCopy.mailbox !== message.destinationId ||
            receiverCopy.type !== message.type ||
            receiverCopy.sourceId !== message.sourceId ||
            receiverCopy.destinationId !== message.destinationId ||
            receiverCopy.text !== message.text
        ) {
            throw new Error(`message receiverMessageID ${String(option.receiverMessageID)} is not its receiver copy`);
        }

        // Ref MariaDB and the dedicated PostgreSQL schema have independent
        // sequences. Keep the cross-row link exact, but compare its database-
        // local numeric key by relation rather than by an impossible shared id.
        return {
            ...message,
            option: { ...option, receiverMessageID: 'receiver-copy' },
        };
    });
};

const readForbiddenSideEffects = async (db: GamePrismaClient) => ({
    inputEvents: await db.inputEvent.count(),
    webPushOutbox: await db.webPushOutbox.count(),
    events: await db.event.count(),
    auctions: await db.auction.count(),
    auctionBids: await db.auctionBid.count(),
});

const expectNoDirtyWorldChanges = (world: InMemoryTurnWorld): void => {
    const { realtimeBacklogShiftTicks, ...arrayChanges } = world.peekDirtyState();
    expect(realtimeBacklogShiftTicks).toBe(0);
    for (const [changeName, entries] of Object.entries(arrayChanges)) {
        expect(entries, `world dirty state ${changeName}`).toEqual([]);
    }
};

const projectReloadedGeneralTurns = (store: InMemoryReservedTurnStore, generalId: number) =>
    store.getGeneralTurns(generalId).map((turn, turnIndex) => ({
        generalId,
        turnIndex,
        action: turn.action,
        args: turn.args,
    }));

const projectReloadedNationTurns = (store: InMemoryReservedTurnStore, nationId: number, officerLevel: number) =>
    store.getNationTurns(nationId, officerLevel).map((turn, turnIndex) => ({
        nationId,
        officerLevel,
        turnIndex,
        action: turn.action,
        args: turn.args,
    }));

type ReloadedWorldSnapshot = Awaited<ReturnType<typeof loadTurnWorldFromDatabase>>['snapshot'];

const projectReloadableWorldGraph = (
    snapshot: Pick<ReloadedWorldSnapshot, 'generals' | 'cities' | 'nations' | 'troops' | 'diplomacy'>,
    selector: TurnSnapshotSelector
) => {
    const selectedIds = (all: boolean | undefined, ids: readonly number[]) => (all ? null : new Set(ids));
    const generalIds = selectedIds(selector.allGenerals, selector.generalIds);
    const cityIds = selectedIds(selector.allCities, selector.cityIds);
    const nationIds = selectedIds(selector.allNations, selector.nationIds);
    const troopIds = selectedIds(selector.allTroops, selector.troopIds ?? []);
    const byId = <Row extends { id: number }>(rows: readonly Row[], ids: Set<number> | null) =>
        structuredClone(rows)
            .filter((row) => ids === null || ids.has(row.id))
            .sort((left, right) => left.id - right.id);
    const generals = byId(snapshot.generals, generalIds).map((general) => {
        const { itemInventory: _persistedItemInventory, legacyScanOrder: _legacyScanOrder, ...meta } = general.meta;
        return { ...general, meta };
    });
    const nations = byId(snapshot.nations, nationIds).map((nation) => {
        const { power: _projectedPower, ...meta } = nation.meta;
        return { ...nation, meta };
    });

    return {
        // The database loader reconstructs itemInventory from its canonical
        // top-level field and may materialize projected defaults in meta. Keep
        // those three storage/fixture duplicates out, while comparing every
        // command-owned entity field (including top-level itemInventory) exact.
        generals,
        cities: byId(snapshot.cities, cityIds),
        nations,
        troops: byId(snapshot.troops, troopIds),
        diplomacy: structuredClone(snapshot.diplomacy)
            .filter(
                (entry) => nationIds === null || (nationIds.has(entry.fromNationId) && nationIds.has(entry.toNationId))
            )
            .sort((left, right) => left.fromNationId - right.fromNationId || left.toNationId - right.toNationId),
    };
};

const projectCanonicalCommandLifecycleState = (
    snapshot: CanonicalTurnSnapshot,
    actorGeneralId: number,
    nationId: number,
    officerLevel: number
) => {
    const general = snapshot.generals.find((row) => row.id === actorGeneralId);
    const nation = snapshot.nations.find((row) => row.id === nationId);
    if (!general) throw new Error(`canonical lifecycle actor is missing: ${actorGeneralId}`);
    if (!nation) throw new Error(`canonical lifecycle nation is missing: ${nationId}`);
    if (typeof nation.meta !== 'object' || nation.meta === null || Array.isArray(nation.meta)) {
        throw new Error(`canonical lifecycle nation meta is invalid: ${nationId}`);
    }
    const nationMeta = nation.meta as Record<string, unknown>;
    return {
        generalLastTurn: general.lastTurn,
        nationOfficerLastTurn: nationMeta[`turn_last_${officerLevel}`],
        nationCapitalRevision: nation.capitalRevision,
        nationCapset: nationMeta.capset,
    };
};

const projectDomainCommandLifecycleState = (
    snapshot: Pick<ReloadedWorldSnapshot, 'generals' | 'nations'>,
    actorGeneralId: number,
    nationId: number,
    officerLevel: number
) => {
    const general = snapshot.generals.find((row) => row.id === actorGeneralId);
    const nation = snapshot.nations.find((row) => row.id === nationId);
    if (!general) throw new Error(`domain lifecycle actor is missing: ${actorGeneralId}`);
    if (!nation) throw new Error(`domain lifecycle nation is missing: ${nationId}`);
    return {
        generalLastTurn: general.lastTurn,
        nationOfficerLastTurn: nation.meta[`turn_last_${officerLevel}`],
        nationCapitalRevision: nation.meta.capset,
        nationCapset: nation.meta.capset,
    };
};

const requireLastTurnRecord = (value: unknown, label: string): Record<string, unknown> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    const record = value as Record<string, unknown>;
    if (typeof record.command !== 'string' || record.command === '') {
        throw new Error(`${label}.command must be a non-empty string`);
    }
    return record;
};

const projectSemanticLastTurn = (value: unknown, label: string) => {
    const record = requireLastTurnRecord(value, label);
    const finiteIntegerOrZero = (candidate: unknown): number =>
        typeof candidate === 'number' && Number.isFinite(candidate) ? Math.floor(candidate) : 0;
    const rawArg = record.arg ?? {};
    return {
        command: record.command,
        // PHP's no-argument LastTurn serializes `arg` as [], while Core's typed
        // command contract uses {}. A non-empty list remains significant.
        arg: Array.isArray(rawArg) && rawArg.length === 0 ? {} : canonicalizeTurnCommandArgs(rawArg),
        term: finiteIntegerOrZero(record.term),
        seq: finiteIntegerOrZero(record.seq),
    };
};

const projectReferenceOutcomeLastTurn = (outcome: unknown): unknown => {
    const record = asRecord(outcome);
    return record.lastTurn;
};

const compareCanonicalGeneralTurns = (left: Record<string, unknown>, right: Record<string, unknown>): number =>
    Number(left.generalId) - Number(right.generalId) || Number(left.turnIndex) - Number(right.turnIndex);

const compareCanonicalNationTurns = (left: Record<string, unknown>, right: Record<string, unknown>): number =>
    Number(left.nationId) - Number(right.nationId) ||
    Number(left.officerLevel) - Number(right.officerLevel) ||
    Number(left.turnIndex) - Number(right.turnIndex);

databaseIntegration('risk-based command PostgreSQL durability matrix', () => {
    let db: GamePrismaClient | undefined;
    let disconnect: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        assertDedicatedTurnCommandDurableMatrixDatabase(databaseUrl!);
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        disconnect = () => connector.disconnect();
        await clearCoreTurnCommandPersistenceFixture(db);
    });

    beforeEach(async () => {
        if (db) await clearCoreTurnCommandPersistenceFixture(db);
    });

    afterAll(async () => {
        try {
            if (db) await clearCoreTurnCommandPersistenceFixture(db);
        } finally {
            await disconnect?.();
        }
    });

    it.each(riskMatrixCases)(
        '$scope $risk $action ($label) matches Ref/Core, commits through one flush, and survives a fresh PostgreSQL reload',
        async (entry) => {
            if (!db) throw new Error('fixture database is not connected');
            const request = buildRiskMatrixRequest(entry);
            const selector = request.observe as TurnSnapshotSelector;
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const expected = await runCoreTurnCommandTrace(request, reference.before);
            expect(expected.execution.outcome).toMatchObject({
                requestedAction: entry.action,
                actionKey: entry.action,
                usedFallback: false,
            });
            expect(expected.rng).toEqual(reference.rng);
            expect(
                compareTurnSnapshotDeltas(reference.before, reference.after, expected.before, expected.after, {
                    ignoredPathPatterns: lifecycleIgnoredPaths,
                })
            ).toEqual([]);

            const unitSet = await loadUnitSetDefinitionByName('che');
            const map = await loadMapDefinitionByName('che');
            const worldInput = buildCoreTurnCommandWorldInput(request, reference.before, unitSet, map);
            const actorBefore = reference.before.generals.find(
                (generalRow) => generalRow.id === request.actorGeneralId
            );
            if (!actorBefore) throw new Error('fixture actor is missing from the reference before snapshot');
            const actorNationId = Number(actorBefore.nationId);
            const actorOfficerLevel = Number(actorBefore.officerLevel);
            if (!Number.isSafeInteger(actorNationId) || !Number.isSafeInteger(actorOfficerLevel)) {
                throw new Error('fixture actor nation/officer identity is invalid');
            }
            const validatesMinimumChiefBoundary = entry.action === 'che_물자원조';
            if (validatesMinimumChiefBoundary) {
                expect(actorOfficerLevel).toBe(5);
                expect(
                    expected.before.generals.find((generalRow) => generalRow.id === siblingRulerGeneralId)
                ).toMatchObject({ nationId: actorNationId, officerLevel: 12 });
            }
            const siblingNationTurnRevisionSentinel = buildSiblingNationTurnRevisionSentinel(
                actorNationId,
                actorOfficerLevel
            );
            const expectedSiblingTurnRevisionSentinels = {
                general: siblingGeneralTurnRevisionSentinel,
                nation: siblingNationTurnRevisionSentinel,
            };
            const expectedBeforeLifecycle = projectCanonicalCommandLifecycleState(
                expected.before,
                request.actorGeneralId,
                actorNationId,
                actorOfficerLevel
            );
            const expectedAfterLifecycle = projectCanonicalCommandLifecycleState(
                expected.after,
                request.actorGeneralId,
                actorNationId,
                actorOfficerLevel
            );
            requireLastTurnRecord(expectedAfterLifecycle.generalLastTurn, 'expected actor lastTurn');
            requireLastTurnRecord(expectedAfterLifecycle.nationOfficerLastTurn, 'expected officer turn_last');
            const referenceAfterLifecycle = projectCanonicalCommandLifecycleState(
                reference.after,
                request.actorGeneralId,
                actorNationId,
                actorOfficerLevel
            );
            if (entry.scope === 'general') {
                expect(
                    projectSemanticLastTurn(referenceAfterLifecycle.generalLastTurn, 'Ref actor lastTurn')
                ).toStrictEqual(projectSemanticLastTurn(expectedAfterLifecycle.generalLastTurn, 'Core actor lastTurn'));
                expect(expectedAfterLifecycle.nationOfficerLastTurn).toStrictEqual({ command: '휴식', term: 0 });
            } else {
                // Ref snapshots project nation.aux but not nation_env. The trace
                // outcome is the exact resultTurnRaw value written to
                // nation_env.turn_last_<officerLevel> by the comparison harness.
                expect(
                    projectSemanticLastTurn(
                        projectReferenceOutcomeLastTurn(reference.execution.outcome),
                        'Ref officer turn_last outcome'
                    )
                ).toStrictEqual(
                    projectSemanticLastTurn(expectedAfterLifecycle.nationOfficerLastTurn, 'Core officer turn_last')
                );
                expect(expectedAfterLifecycle.generalLastTurn).toStrictEqual({ command: '휴식' });
            }
            if (entry.action === 'che_증축') {
                const referenceBeforeLifecycle = projectCanonicalCommandLifecycleState(
                    reference.before,
                    request.actorGeneralId,
                    actorNationId,
                    actorOfficerLevel
                );
                // Ref persists capset as nation.capset; Core mirrors that column
                // into both canonical capitalRevision and the domain meta value.
                expect(referenceBeforeLifecycle.nationCapitalRevision).toBe(0);
                expect(expectedBeforeLifecycle).toMatchObject({ nationCapitalRevision: 0, nationCapset: 0 });
                expect(referenceAfterLifecycle.nationCapitalRevision).toBe(1);
                expect(expectedAfterLifecycle).toMatchObject({ nationCapitalRevision: 1, nationCapset: 1 });
            }
            const expectedSiblingRulerLifecycle = validatesMinimumChiefBoundary
                ? projectCanonicalCommandLifecycleState(expected.before, siblingRulerGeneralId, actorNationId, 12)
                : null;
            if (expectedSiblingRulerLifecycle) {
                expect(
                    projectCanonicalCommandLifecycleState(expected.after, siblingRulerGeneralId, actorNationId, 12)
                ).toStrictEqual(expectedSiblingRulerLifecycle);
                expect(expectedSiblingRulerLifecycle.nationOfficerLastTurn).toStrictEqual({
                    command: '국호 변경',
                    arg: { nationName: '수뇌보존국' },
                    term: 7,
                    seq: 3,
                });
            }
            await seedCoreTurnCommandPersistenceFixture(db, {
                worldInput,
                scenarioCode: 'turn-command-durable-matrix',
                generalTurns: reference.before.generalTurns.map((turn) =>
                    entry.scope === 'general' && turn.generalId === request.actorGeneralId && turn.turnIndex === 0
                        ? { ...turn, args: resolveCoreTurnCommandArgs(request) }
                        : turn
                ),
                nationTurns: reference.before.nationTurns.map((turn) =>
                    entry.scope === 'nation' &&
                    turn.nationId === actorBefore.nationId &&
                    turn.officerLevel === actorBefore.officerLevel &&
                    turn.turnIndex === 0
                        ? { ...turn, args: resolveCoreTurnCommandArgs(request) }
                        : turn
                ),
            });
            // Keep the active daemon owner on both sentinels deliberately. A
            // flush that releases leases by owner instead of by exact queue
            // key would corrupt these unrelated command streams.
            await db.generalTurnRevision.create({ data: siblingGeneralTurnRevisionSentinel });
            await db.nationTurnRevision.create({ data: siblingNationTurnRevisionSentinel });
            expect(await readSiblingTurnRevisionSentinels(db, siblingNationTurnRevisionSentinel)).toStrictEqual(
                expectedSiblingTurnRevisionSentinels
            );
            const forbiddenSideEffectsBefore = await readForbiddenSideEffects(db);
            const databaseBefore = await readCoreDatabaseSnapshot(databaseUrl!, selector);
            expect(
                projectCanonicalCommandLifecycleState(
                    databaseBefore,
                    request.actorGeneralId,
                    actorNationId,
                    actorOfficerLevel
                )
            ).toStrictEqual(expectedBeforeLifecycle);
            const siblingRulerTurnQueueBefore = validatesMinimumChiefBoundary
                ? databaseBefore.nationTurns.filter(
                      (turn) => turn.nationId === actorNationId && turn.officerLevel === 12
                  )
                : [];
            if (expectedSiblingRulerLifecycle) {
                expect(siblingRulerTurnQueueBefore).toHaveLength(12);
                expect(
                    projectCanonicalCommandLifecycleState(databaseBefore, siblingRulerGeneralId, actorNationId, 12)
                ).toStrictEqual(expectedSiblingRulerLifecycle);
            }
            if (entry.action === 'che_증축') {
                expect(
                    projectCanonicalCommandLifecycleState(
                        databaseBefore,
                        request.actorGeneralId,
                        actorNationId,
                        actorOfficerLevel
                    )
                ).toMatchObject({ nationCapitalRevision: 0, nationCapset: 0 });
            }

            const loaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
            const reservedTurns = new InMemoryReservedTurnStore(db, {
                maxGeneralTurns: 30,
                maxNationTurns: 12,
                leaseOwner,
                leaseDurationMs: 60_000,
            });
            await reservedTurns.loadAll();
            const loadedActor = loaded.snapshot.generals.find((generalRow) => generalRow.id === request.actorGeneralId);
            if (!loadedActor) throw new Error('fixture actor is missing after database load');
            if (validatesMinimumChiefBoundary) {
                expect(
                    loaded.snapshot.generals.find((generalRow) => generalRow.id === siblingRulerGeneralId)
                ).toMatchObject({ nationId: actorNationId, officerLevel: 12 });
            }
            await reservedTurns.prepareTurnsForExecution(loadedActor.id, {
                nationId: loadedActor.nationId,
                officerLevel: loadedActor.officerLevel,
            });

            const resolvedActions: Array<{ kind: string; requestedAction: string; usedFallback: boolean }> = [];
            let world: InMemoryTurnWorld | null = null;
            const gameNow = new Date(String(reference.before.world.gameNow));
            if (!Number.isFinite(gameNow.getTime())) {
                throw new Error(`reference world.gameNow is invalid: ${String(reference.before.world.gameNow)}`);
            }
            const handler = await createReservedTurnHandler({
                reservedTurns,
                scenarioConfig: loaded.snapshot.scenarioConfig,
                scenarioMeta: loaded.snapshot.scenarioMeta,
                map: loaded.snapshot.map,
                unitSet: loaded.snapshot.unitSet,
                getWorld: () => world,
                now: () => new Date(gameNow.getTime()),
                messageSharedIconBaseUrl: request.setup?.world?.messageSharedIconBaseUrl,
                commandProfile: createCoreTurnCommandProfile(request),
                onActionResolved: (resolved) => {
                    resolvedActions.push({
                        kind: resolved.kind,
                        requestedAction: resolved.requestedAction,
                        usedFallback: resolved.usedFallback,
                    });
                },
            });
            world = new InMemoryTurnWorld(loaded.state, loaded.snapshot, {
                schedule: {
                    entries: [
                        {
                            startMinute: 0,
                            tickMinutes: Math.max(1, Math.round(loaded.state.tickSeconds / 60)),
                        },
                    ],
                },
                generalTurnHandler: handler,
            });
            const actor = world.getGeneralById(request.actorGeneralId);
            if (!actor) throw new Error('fixture actor is missing from executable world');
            world.executeGeneralTurn(actor);
            expect(resolvedActions).toContainEqual({
                kind: entry.scope,
                requestedAction: entry.action,
                usedFallback: false,
            });
            const liveAfterLifecycle = projectDomainCommandLifecycleState(
                { generals: world.listGenerals(), nations: world.listNations() },
                request.actorGeneralId,
                actor.nationId,
                actor.officerLevel
            );
            expect(liveAfterLifecycle).toStrictEqual(expectedAfterLifecycle);
            if (expectedSiblingRulerLifecycle) {
                expect(
                    projectDomainCommandLifecycleState(
                        { generals: world.listGenerals(), nations: world.listNations() },
                        siblingRulerGeneralId,
                        actor.nationId,
                        12
                    )
                ).toStrictEqual(expectedSiblingRulerLifecycle);
            }
            if (entry.action === 'che_증축') {
                expect(liveAfterLifecycle).toMatchObject({ nationCapitalRevision: 1, nationCapset: 1 });
            }
            if (entry.action === 'che_훈련') {
                const expectedActorAfter = expected.after.generals.find(
                    (generalRow) => generalRow.id === request.actorGeneralId
                );
                const dirtyActor = world
                    .peekDirtyState()
                    .generals.find((generalRow) => generalRow.id === request.actorGeneralId);
                expect(dirtyActor?.role.items.weapon).toBe(expectedActorAfter?.itemWeapon);
            }

            const beforeFlush = await readCoreDatabaseSnapshot(databaseUrl!, selector);
            expect(withoutVolatileGameNow(beforeFlush)).toStrictEqual(withoutVolatileGameNow(databaseBefore));
            expect(await readSiblingTurnRevisionSentinels(db, siblingNationTurnRevisionSentinel)).toStrictEqual(
                expectedSiblingTurnRevisionSentinels
            );

            const hooks = await createDatabaseTurnHooks(databaseUrl!, world, { reservedTurns });
            try {
                if (!hooks.hooks.flushChanges) throw new Error('database turn hooks do not expose flushChanges');
                await hooks.hooks.flushChanges({
                    lastTurnTime: loaded.state.lastTurnTime.toISOString(),
                    processedGenerals: 1,
                    processedTurns: 1,
                    durationMs: 0,
                    partial: false,
                });
                const receipt = hooks.takeCommittedReadModelChangeReceipt();
                if (!receipt) throw new Error('flush did not publish a read-model change receipt');
                expect(receipt.invalidation.revisions.length).toBeGreaterThan(0);
                expect(
                    await db.readModelRevision.findMany({
                        select: { domain: true, entityId: true, revision: true },
                        orderBy: [{ domain: 'asc' }, { entityId: 'asc' }],
                    })
                ).toEqual(receipt.invalidation.revisions);
                expect(await db.readModelOutbox.count()).toBe(1);
                expect(hooks.takeCommittedReadModelChangeReceipt()).toBeNull();
            } finally {
                await hooks.close();
            }

            expectNoDirtyWorldChanges(world);
            expect(reservedTurns.peekDirtyState()).toStrictEqual({
                generalIds: [],
                generalInitializationIds: [],
                generalLeaseIds: [],
                nationKeys: [],
                nationInitializationKeys: [],
                nationLeaseKeys: [],
            });
            expect(await readForbiddenSideEffects(db)).toEqual(forbiddenSideEffectsBefore);
            expect(await db.inputEvent.count()).toBe(0);
            expect(await readSiblingTurnRevisionSentinels(db, siblingNationTurnRevisionSentinel)).toStrictEqual(
                expectedSiblingTurnRevisionSentinels
            );

            const after = await readCoreDatabaseSnapshot(databaseUrl!, selector);
            const expectedPersistedGeneralTurns = [
                ...databaseBefore.generalTurns.filter((turn) => turn.generalId !== request.actorGeneralId),
                ...expected.after.generalTurns.filter((turn) => turn.generalId === request.actorGeneralId),
            ].sort(compareCanonicalGeneralTurns);
            const expectedPersistedNationTurns = [
                ...databaseBefore.nationTurns.filter(
                    (turn) => turn.nationId !== actor.nationId || turn.officerLevel !== actor.officerLevel
                ),
                ...expected.after.nationTurns.filter(
                    (turn) => turn.nationId === actor.nationId && turn.officerLevel === actor.officerLevel
                ),
            ].sort(compareCanonicalNationTurns);
            expect(after.generalTurns).toStrictEqual(expectedPersistedGeneralTurns);
            expect(after.nationTurns).toStrictEqual(expectedPersistedNationTurns);
            if (expectedSiblingRulerLifecycle) {
                expect(
                    after.nationTurns.filter((turn) => turn.nationId === actor.nationId && turn.officerLevel === 12)
                ).toStrictEqual(siblingRulerTurnQueueBefore);
                expect(
                    projectCanonicalCommandLifecycleState(after, siblingRulerGeneralId, actor.nationId, 12)
                ).toStrictEqual(expectedSiblingRulerLifecycle);
            }
            expect(
                projectCanonicalCommandLifecycleState(after, request.actorGeneralId, actor.nationId, actor.officerLevel)
            ).toStrictEqual(expectedAfterLifecycle);
            if (entry.action === 'che_증축') {
                expect(
                    projectCanonicalCommandLifecycleState(
                        after,
                        request.actorGeneralId,
                        actor.nationId,
                        actor.officerLevel
                    )
                ).toMatchObject({ nationCapitalRevision: 1, nationCapset: 1 });
            }
            expect(
                await db.generalTurnRevision.findMany({
                    select: { generalId: true, revision: true, leaseOwner: true, leaseExpiresAt: true },
                    orderBy: { generalId: 'asc' },
                })
            ).toStrictEqual([
                { generalId: request.actorGeneralId, revision: 1, leaseOwner: null, leaseExpiresAt: null },
                siblingGeneralTurnRevisionSentinel,
            ]);
            expect(
                await db.nationTurnRevision.findMany({
                    select: {
                        nationId: true,
                        officerLevel: true,
                        revision: true,
                        leaseOwner: true,
                        leaseExpiresAt: true,
                    },
                    orderBy: [{ nationId: 'asc' }, { officerLevel: 'asc' }],
                })
            ).toStrictEqual([
                {
                    nationId: actor.nationId,
                    officerLevel: actor.officerLevel,
                    revision: 1,
                    leaseOwner: null,
                    leaseExpiresAt: null,
                },
                siblingNationTurnRevisionSentinel,
            ]);
            if (entry.action === 'che_물자원조') {
                const sourceNation = after.nations.find((nation) => nation.id === 1);
                const destinationNation = after.nations.find((nation) => nation.id === 2);
                expect(sourceNation).toMatchObject({ gold: 999_900, rice: 999_800 });
                expect(destinationNation).toMatchObject({ gold: 1_000_100, rice: 1_000_200 });
                expect(asRecord(sourceNation?.meta).surlimit).toBe(12);
                expect(asRecord(asRecord(destinationNation?.meta).recv_assist).n1).toEqual([1, 300]);
            }
            expect(
                compareTurnSnapshotDeltas(reference.before, reference.after, databaseBefore, after, {
                    ignoredPathPatterns: lifecycleIgnoredPaths,
                })
            ).toEqual([]);
            expect(
                compareTurnSnapshotDeltas(expected.before, expected.after, databaseBefore, after, {
                    ignoredPathPatterns: lifecycleIgnoredPaths,
                })
            ).toEqual([]);
            const trailingDefaultGeneralRestLogs = after.logs.filter(isTrailingDefaultGeneralRestLog);
            if (entry.scope === 'nation') {
                // The production lifecycle always follows an officer's nation command with
                // that officer's general queue. turn_command_trace.php intentionally executes
                // only the requested command, so assert and remove this one known harness delta.
                expect(trailingDefaultGeneralRestLogs).toHaveLength(1);
            } else {
                expect(trailingDefaultGeneralRestLogs).toHaveLength(0);
            }
            const comparablePersistedLogs = after.logs.filter(
                (log) => entry.scope !== 'nation' || !isTrailingDefaultGeneralRestLog(log)
            );
            expect(orderedSemanticLogStreams(comparablePersistedLogs)).toEqual(
                orderedSemanticLogStreams(addedReferenceLogs(reference.before, reference.after.logs))
            );
            expect(projectDatabaseIndependentTurnMessages(after.messages, 0)).toEqual(
                projectDatabaseIndependentTurnMessages(reference.after.messages, reference.before.watermarks.messageId)
            );

            const committedWorldGraph = projectReloadableWorldGraph(
                {
                    generals: world.listGenerals(),
                    cities: world.listCities(),
                    nations: world.listNations(),
                    troops: world.listTroops(),
                    diplomacy: world.listDiplomacy(),
                },
                selector
            );
            const reloadedWorld = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
            expect(projectReloadableWorldGraph(reloadedWorld.snapshot, selector)).toStrictEqual(committedWorldGraph);
            const reloadedLifecycle = projectDomainCommandLifecycleState(
                reloadedWorld.snapshot,
                request.actorGeneralId,
                actor.nationId,
                actor.officerLevel
            );
            expect(reloadedLifecycle).toStrictEqual(expectedAfterLifecycle);
            if (expectedSiblingRulerLifecycle) {
                expect(
                    projectDomainCommandLifecycleState(
                        reloadedWorld.snapshot,
                        siblingRulerGeneralId,
                        actor.nationId,
                        12
                    )
                ).toStrictEqual(expectedSiblingRulerLifecycle);
            }
            if (entry.action === 'che_증축') {
                expect(reloadedLifecycle).toMatchObject({ nationCapitalRevision: 1, nationCapset: 1 });
            }

            const reloadedTurns = new InMemoryReservedTurnStore(db, { maxGeneralTurns: 30, maxNationTurns: 12 });
            await reloadedTurns.loadAll();
            expect(projectReloadedGeneralTurns(reloadedTurns, request.actorGeneralId)).toStrictEqual(
                expected.after.generalTurns.filter((turn) => turn.generalId === request.actorGeneralId)
            );
            expect(projectReloadedNationTurns(reloadedTurns, actor.nationId, actor.officerLevel)).toStrictEqual(
                expected.after.nationTurns.filter(
                    (turn) => turn.nationId === actor.nationId && turn.officerLevel === actor.officerLevel
                )
            );
            if (expectedSiblingRulerLifecycle) {
                expect(projectReloadedNationTurns(reloadedTurns, actor.nationId, 12)).toStrictEqual(
                    siblingRulerTurnQueueBefore
                );
            }
            expect(await readSiblingTurnRevisionSentinels(db, siblingNationTurnRevisionSentinel)).toStrictEqual(
                expectedSiblingTurnRevisionSentinels
            );
        },
        180_000
    );
});
