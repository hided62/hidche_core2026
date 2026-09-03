import {
    acquireGameSchemaAdvisoryXactLock,
    CLOCK_OPERATION_PERSISTENCE_LOCK,
    createGamePostgresConnector,
    GENERAL_ACCESS_PERSISTENCE_LOCK,
    GamePrisma,
    writeReadModelChangeJournal,
    enqueuePrivateMessageWebPush,
    enqueueWebPushOutboxEvents,
    type InputJsonValue,
    type ReadModelJournalWriteResult,
    type TurnEngineCityUpdateInput,
    type TurnEngineDiplomacyCreateManyInput,
    type TurnEngineDiplomacyUpdateInput,
    type TurnEngineGeneralCreateManyInput,
    type TurnEngineGeneralUpdateInput,
    type TurnEngineLogEntryCreateManyInput,
    type TurnEngineNationUpdateInput,
    type TurnEngineTroopCreateManyInput,
    type TurnEngineTroopUpdateInput,
    type TurnEngineWorldStateUpdateInput,
} from '@sammo-ts/infra';
import {
    finalizeLogEntry,
    LogCategory,
    LogFormat,
    LogScope,
    sendMessage,
    readScenarioGeneralPoolClaim,
    type City,
    type LogEntryDraft,
    type MessageRecordDraft,
    type Nation,
} from '@sammo-ts/logic';
import {
    asRecord,
    ChangeJournal,
    GAME_TICKS_PER_TURN,
    type CommittedReadModelInvalidation,
    type ReadModelDomain,
    type RealtimeReadModelChanges,
} from '@sammo-ts/common';

import type { TurnDaemonCommandResult, TurnDaemonHooks } from '../lifecycle/types.js';
import type { InMemoryTurnWorld, TurnWorldChanges } from './inMemoryWorld.js';
import type { InMemoryReservedTurnStore, ReservedTurnChanges } from './reservedTurnStore.js';
import { buildDiplomacyMeta } from '@sammo-ts/logic';
import { ensureItemInventory, withSerializedItemInventory } from '@sammo-ts/logic/items/index.js';
import { persistGeneralLifecycleEvents, type GeneralLifecycleArchiveLog } from './generalTurnLifecyclePersistence.js';
import type { DatabaseTurnDaemonLease } from '../lifecycle/databaseTurnDaemonLease.js';
import { calculateNationBettingRewards } from '../betting/nationBettingSettlement.js';
import type { NationBettingCandidate, PendingNationBettingFinish, PendingNationBettingOpen } from './types.js';
import type { TurnGeneral } from './types.js';
import { buildInitialRankRows, buildPersistedRankRows } from './rankData.js';
import { persistUnificationFinalization } from './unificationPersistence.js';
import { buildOldNationArchiveData } from './oldNationArchive.js';
import { persistYearbookSnapshot } from './yearbookPersistence.js';
import { buildTurnWebPushEvents, captureWebPushTurnBaseline } from './webPushEvents.js';
import {
    persistClockSuspensionLedgerUnderHeldLocks,
    prepareClockSuspensionUnderHeldLocks,
    readClockDatabaseWall,
    refreshClockProjectionForFinalClockUnderHeldLocks,
} from './clockReconciliation.js';
import { applyNextClockProjection, type ClockProjectionRedis } from './clockProjectionOutbox.js';

export interface DatabaseTurnHooks {
    hooks: TurnDaemonHooks;
    takeCommittedReadModelChanges(): RealtimeReadModelChanges | null;
    takeCommittedReadModelChangeReceipt(): CommittedReadModelChangeReceipt | null;
    close(): Promise<void>;
    applyClockProjection(redis: ClockProjectionRedis, workerId: string): Promise<boolean>;
}

export interface CommittedReadModelChangeReceipt {
    /** Delivery identity only; this is not a projection revision. */
    outboxId: bigint;
    invalidation: CommittedReadModelInvalidation;
    changes: RealtimeReadModelChanges;
}

const uniqueSortedIds = (values: Iterable<number>): number[] =>
    [...new Set(values)]
        .filter((value) => Number.isSafeInteger(value) && value > 0)
        .sort((left, right) => left - right);

export type ReadModelSignatures = {
    content: string;
    map: string;
    contacts: string;
    frontStatus: string;
    frontStatusGlobal: string;
    lobbyCount: string;
    lobbyPersonal: string;
};

export interface RealtimeReadModelBaseline {
    generals: Map<number, ReadModelSignatures>;
    cities: Map<number, ReadModelSignatures>;
    nations: Map<number, ReadModelSignatures>;
}

export type PersistedVisibleLogRow = {
    id: number;
    scope: LogScope;
    category: LogCategory;
    generalId: number | null;
};

const canonicalizeReadModelValue = (value: unknown): unknown => {
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (Array.isArray(value)) {
        return value.map(canonicalizeReadModelValue);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, item]) => [key, canonicalizeReadModelValue(item)])
        );
    }
    return value;
};

const signature = (value: unknown): string => JSON.stringify(canonicalizeReadModelValue(value)) ?? 'undefined';

const CLOCK_ONLY_WORLD_META_KEYS = new Set([
    'clockBaseTime',
    'clock_base_time',
    'clockMode',
    'clock_mode',
    'clockPhase',
    'clock_phase',
    'clockRevision',
    'clock_revision',
    'clockTick',
    'clock_tick',
    'clockWallAnchor',
    'clock_wall_anchor',
    'heartbeat',
    'heartbeatAt',
    'heartbeat_at',
    'lastExecuted',
    'last_executed',
    'lastTurnTick',
    'last_turn_tick',
    'lastTurnTime',
    'last_turn_time',
    'deadlineGeneration',
    'deadline_generation',
    'lease',
    'leaseOwner',
    'lease_owner',
    'leaseUntil',
    'lease_until',
]);

const projectWorldMeta = (meta: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(meta).filter(([key]) => !CLOCK_ONLY_WORLD_META_KEYS.has(key)));

/**
 * Canonical fields consumed by world-scoped screens. Moving clock cursors and
 * lease/heartbeat bookkeeping are deliberately absent, while turn term,
 * calendar, scenario config, and gameplay meta remain visible.
 */
export const createWorldReadModelSignature = (world: InMemoryTurnWorld): string => {
    const state = world.getState();
    return signature({
        currentYear: state.currentYear,
        currentMonth: state.currentMonth,
        tickSeconds: state.tickSeconds,
        config: world.getWorldConfig(),
        meta: projectWorldMeta(state.meta),
    });
};

const generalSignatures = (general: TurnGeneral): ReadModelSignatures => ({
    content: signature(general),
    map: signature({ cityId: general.cityId, nationId: general.nationId }),
    contacts: signature({
        name: general.name,
        nationId: general.nationId,
        officerLevel: general.officerLevel,
        npcState: general.npcState,
        permission: asRecord(general.meta).permission,
        penalty: general.penalty,
    }),
    frontStatus: signature({ name: general.name, nationId: general.nationId }),
    frontStatusGlobal: '',
    lobbyCount: signature({ npcState: general.npcState }),
    lobbyPersonal: signature({
        name: general.name,
        picture: general.picture,
        imageServer: general.imageServer,
    }),
});

const citySignatures = (city: City): ReadModelSignatures => ({
    content: signature(city),
    map: signature({
        level: city.level,
        nationId: city.nationId,
        state: city.state,
        supplyState: city.supplyState,
    }),
    contacts: '',
    frontStatus: '',
    frontStatusGlobal: '',
    lobbyCount: '',
    lobbyPersonal: '',
});

const nationSignatures = (nation: Nation): ReadModelSignatures => ({
    content: signature(nation),
    map: signature({
        name: nation.name,
        color: nation.color,
        capitalCityId: nation.capitalCityId,
    }),
    contacts: signature({ name: nation.name, color: nation.color }),
    frontStatus: signature({ notice: asRecord(nation.meta).notice }),
    frontStatusGlobal: signature({ name: nation.name }),
    lobbyCount: signature({ level: nation.level }),
    lobbyPersonal: '',
});

export const createRealtimeReadModelBaseline = (world: InMemoryTurnWorld): RealtimeReadModelBaseline => ({
    generals: new Map(world.listGenerals().map((general) => [general.id, generalSignatures(general)])),
    cities: new Map(world.listCities().map((city) => [city.id, citySignatures(city)])),
    nations: new Map(world.listNations().map((nation) => [nation.id, nationSignatures(nation)])),
});

const changedProjectionIds = (
    candidateIds: readonly number[],
    baseline: ReadonlyMap<number, ReadModelSignatures>,
    final: ReadonlyMap<number, ReadModelSignatures>,
    projection: keyof ReadModelSignatures
): number[] =>
    uniqueSortedIds(candidateIds.filter((id) => baseline.get(id)?.[projection] !== final.get(id)?.[projection]));

const buildFinalSignatures = <Entity extends { id: number }>(
    entities: readonly Entity[],
    project: (entity: Entity) => ReadModelSignatures
): Map<number, ReadModelSignatures> => new Map(entities.map((entity) => [entity.id, project(entity)]));

export const applyRealtimeReadModelBaseline = (
    baseline: RealtimeReadModelBaseline,
    changes: TurnWorldChanges
): void => {
    const apply = (
        target: Map<number, ReadModelSignatures>,
        candidateIds: readonly number[],
        final: ReadonlyMap<number, ReadModelSignatures>
    ) => {
        for (const id of candidateIds) {
            const next = final.get(id);
            if (next) target.set(id, next);
            else target.delete(id);
        }
    };
    const generalIds = uniqueSortedIds([
        ...changes.generals.map((general) => general.id),
        ...changes.createdGenerals.map((general) => general.id),
        ...changes.deletedGenerals,
        ...changes.lifecycleEvents.map((event) => event.generalId),
    ]);
    const cityIds = uniqueSortedIds(changes.cities.map((city) => city.id));
    const nationIds = uniqueSortedIds([
        ...changes.nations.map((nation) => nation.id),
        ...changes.createdNations.map((nation) => nation.id),
        ...changes.deletedNations,
        ...changes.deletedNationSnapshots.map((snapshot) => snapshot.nation.id),
    ]);
    apply(
        baseline.generals,
        generalIds,
        buildFinalSignatures([...changes.generals, ...changes.createdGenerals], generalSignatures)
    );
    apply(baseline.cities, cityIds, buildFinalSignatures(changes.cities, citySignatures));
    apply(
        baseline.nations,
        nationIds,
        buildFinalSignatures([...changes.nations, ...changes.createdNations], nationSignatures)
    );
};

export const summarizeRealtimeReadModelChanges = (
    changes: TurnWorldChanges,
    reservedTurnChanges?: ReservedTurnChanges,
    baseline?: RealtimeReadModelBaseline
): RealtimeReadModelChanges => {
    const generalCandidates = uniqueSortedIds([
        ...changes.generals.map((general) => general.id),
        ...changes.createdGenerals.map((general) => general.id),
        ...changes.deletedGenerals,
        ...changes.lifecycleEvents.map((event) => event.generalId),
    ]);
    const cityCandidates = uniqueSortedIds(changes.cities.map((city) => city.id));
    const nationCandidates = uniqueSortedIds([
        ...changes.nations.map((nation) => nation.id),
        ...changes.createdNations.map((nation) => nation.id),
        ...changes.deletedNations,
        ...changes.deletedNationSnapshots.map((snapshot) => snapshot.nation.id),
    ]);
    const finalGenerals = buildFinalSignatures([...changes.generals, ...changes.createdGenerals], generalSignatures);
    const finalCities = buildFinalSignatures(changes.cities, citySignatures);
    const finalNations = buildFinalSignatures([...changes.nations, ...changes.createdNations], nationSignatures);
    const generalIds = baseline
        ? changedProjectionIds(generalCandidates, baseline.generals, finalGenerals, 'content')
        : generalCandidates;
    const cityIds = baseline
        ? changedProjectionIds(cityCandidates, baseline.cities, finalCities, 'content')
        : cityCandidates;
    const nationIds = baseline
        ? changedProjectionIds(nationCandidates, baseline.nations, finalNations, 'content')
        : nationCandidates;
    const mapGeneralIds = baseline
        ? changedProjectionIds(generalCandidates, baseline.generals, finalGenerals, 'map')
        : generalIds;
    const mapCityIds = baseline ? changedProjectionIds(cityCandidates, baseline.cities, finalCities, 'map') : cityIds;
    const mapNationIds = baseline
        ? changedProjectionIds(nationCandidates, baseline.nations, finalNations, 'map')
        : nationIds;
    const frontStatusNationIds = baseline
        ? changedProjectionIds(nationCandidates, baseline.nations, finalNations, 'frontStatus')
        : nationIds;
    const frontStatusGeneralIds = baseline
        ? changedProjectionIds(generalCandidates, baseline.generals, finalGenerals, 'frontStatus')
        : generalIds;
    const frontStatusChanged = baseline
        ? frontStatusGeneralIds.length > 0 ||
          changedProjectionIds(nationCandidates, baseline.nations, finalNations, 'frontStatusGlobal').length > 0
        : false;
    const lobbyGeneralIds = baseline
        ? changedProjectionIds(generalCandidates, baseline.generals, finalGenerals, 'lobbyPersonal')
        : generalIds;
    const lobbyChanged = baseline
        ? changedProjectionIds(generalCandidates, baseline.generals, finalGenerals, 'lobbyCount').length > 0 ||
          changedProjectionIds(nationCandidates, baseline.nations, finalNations, 'lobbyCount').length > 0
        : changes.createdGenerals.length > 0 ||
          changes.deletedGenerals.length > 0 ||
          changes.createdNations.length > 0 ||
          changes.deletedNations.length > 0;
    const reservedGeneralIds = uniqueSortedIds(
        reservedTurnChanges
            ? [
                  ...reservedTurnChanges.generalIds,
                  ...reservedTurnChanges.generalInitializationIds,
                  ...reservedTurnChanges.generalLeaseIds,
              ]
            : []
    );
    const recordGeneralIds = uniqueSortedIds(
        changes.logs.flatMap((entry) =>
            entry.scope === LogScope.GENERAL && entry.category === LogCategory.ACTION && entry.generalId
                ? [entry.generalId]
                : []
        )
    );
    const globalRecordsChanged = changes.logs.some(
        (entry) =>
            entry.scope === LogScope.SYSTEM &&
            (entry.category === LogCategory.SUMMARY || entry.category === LogCategory.ACTION)
    );
    const worldHistoryChanged = changes.logs.some(
        (entry) => entry.scope === LogScope.SYSTEM && entry.category === LogCategory.HISTORY
    );
    const contactsChanged = baseline
        ? changedProjectionIds(generalCandidates, baseline.generals, finalGenerals, 'contacts').length > 0 ||
          changedProjectionIds(nationCandidates, baseline.nations, finalNations, 'contacts').length > 0
        : changes.createdGenerals.length > 0 ||
          changes.deletedGenerals.length > 0 ||
          changes.createdNations.length > 0 ||
          changes.deletedNations.length > 0 ||
          changes.lifecycleEvents.some((event) => {
              const after = event.after;
              const beforePermission = asRecord(event.before.meta).permission;
              const afterPermission = after ? asRecord(after.meta).permission : undefined;
              return (
                  !after ||
                  event.before.name !== after.name ||
                  event.before.nationId !== after.nationId ||
                  event.before.officerLevel !== after.officerLevel ||
                  beforePermission !== afterPermission
              );
          });

    return {
        generalIds,
        cityIds,
        nationIds,
        mapGeneralIds,
        mapCityIds,
        mapNationIds,
        frontStatusGeneralIds,
        frontStatusNationIds,
        lobbyGeneralIds,
        reservedGeneralIds,
        recordGeneralIds,
        worldChanged: changes.realtimeBacklogShiftTicks > 0,
        globalRecordsChanged,
        worldHistoryChanged,
        contactsChanged,
        frontStatusChanged,
        lobbyChanged,
    };
};

export const mergePersistedVisibleLogChanges = (
    changes: RealtimeReadModelChanges,
    rows: readonly PersistedVisibleLogRow[]
): RealtimeReadModelChanges => ({
    ...changes,
    recordGeneralIds: uniqueSortedIds([
        ...changes.recordGeneralIds,
        ...rows.flatMap((entry) =>
            entry.scope === LogScope.GENERAL && entry.category === LogCategory.ACTION && entry.generalId
                ? [entry.generalId]
                : []
        ),
    ]),
    globalRecordsChanged:
        changes.globalRecordsChanged ||
        rows.some(
            (entry) =>
                entry.scope === LogScope.SYSTEM &&
                (entry.category === LogCategory.SUMMARY || entry.category === LogCategory.ACTION)
        ),
    worldHistoryChanged:
        changes.worldHistoryChanged ||
        rows.some((entry) => entry.scope === LogScope.SYSTEM && entry.category === LogCategory.HISTORY),
});

const markIds = (journal: ChangeJournal, domain: ReadModelDomain, ids: readonly number[]): void => {
    for (const id of ids) {
        journal.mark(domain, id);
    }
};

/**
 * Converts the final legacy internal invalidation into durable domain keys.
 * City/nation map changes are shared-map changes; general movement remains
 * actor-targeted. General name/nation changes affect the global online list,
 * while frontStatusActorIds is the private actor projection.
 */
export const createReadModelChangeJournal = (changes: RealtimeReadModelChanges): ChangeJournal => {
    const journal = new ChangeJournal();
    markIds(journal, 'general.content', changes.generalIds);
    markIds(journal, 'city.content', changes.cityIds);
    markIds(journal, 'nation.content', changes.nationIds);
    markIds(journal, 'map.general', changes.mapGeneralIds ?? []);
    markIds(journal, 'front.nation', changes.frontStatusNationIds ?? []);
    markIds(journal, 'front.general', changes.frontStatusActorIds ?? []);
    markIds(journal, 'lobby.general', changes.lobbyGeneralIds ?? []);
    markIds(journal, 'reserved.general', changes.reservedGeneralIds);
    markIds(journal, 'records.general', changes.recordGeneralIds);

    if (changes.worldChanged) {
        journal.mark('world.content').mark('map.world');
    }
    if (changes.mapChanged || (changes.mapCityIds ?? []).length > 0 || (changes.mapNationIds ?? []).length > 0) {
        journal.mark('map.world');
    }
    if ((changes.frontStatusGeneralIds ?? []).length > 0 || changes.frontStatusChanged) {
        journal.mark('front.global');
    }
    if (changes.globalRecordsChanged) {
        journal.mark('records.global');
    }
    if (changes.worldHistoryChanged) {
        journal.mark('records.history');
    }
    if (changes.contactsChanged) {
        journal.mark('contacts.world');
    }
    if (changes.lobbyChanged) {
        journal.mark('lobby.world');
    }
    return journal;
};

/**
 * Conservative transitive dependency for the private dashboard projections.
 * Context reads troop/leader-turn state and command options scan the complete
 * general/city/nation sets, so entity-local heads alone are insufficient.
 */
export const hasDashboardSourceMutation = (
    changes: TurnWorldChanges,
    readModelChanges: RealtimeReadModelChanges
): boolean =>
    readModelChanges.worldChanged ||
    readModelChanges.reservedGeneralIds.length > 0 ||
    changes.generals.length > 0 ||
    changes.createdGenerals.length > 0 ||
    changes.deletedGenerals.length > 0 ||
    changes.lifecycleEvents.length > 0 ||
    changes.cities.length > 0 ||
    changes.nations.length > 0 ||
    changes.createdNations.length > 0 ||
    changes.deletedNations.length > 0 ||
    changes.troops.length > 0 ||
    changes.createdTroops.length > 0 ||
    changes.deletedTroops.length > 0 ||
    changes.diplomacy.length > 0 ||
    changes.createdDiplomacy.length > 0;

export const excludeDeletedReservedTurnQueues = (
    changes: ReservedTurnChanges,
    deletedGeneralIds: readonly number[],
    deletedNationIds: readonly number[]
): ReservedTurnChanges => {
    const deletedGenerals = new Set(deletedGeneralIds);
    const deletedNations = new Set(deletedNationIds);
    const keepGeneral = (generalId: number): boolean => !deletedGenerals.has(generalId);
    const keepNation = (key: string): boolean => !deletedNations.has(Number(key.split(':', 1)[0]));

    return {
        generalIds: changes.generalIds.filter(keepGeneral),
        generalInitializationIds: changes.generalInitializationIds.filter(keepGeneral),
        generalLeaseIds: changes.generalLeaseIds.filter(keepGeneral),
        nationKeys: changes.nationKeys.filter(keepNation),
        nationInitializationKeys: changes.nationInitializationKeys.filter(keepNation),
        nationLeaseKeys: changes.nationLeaseKeys.filter(keepNation),
    };
};

const asJson = (value: unknown): InputJsonValue => value as InputJsonValue;
const formatLegacyNumber = (value: number): string => Math.round(value).toLocaleString('en-US');

const readBettingCandidates = (value: unknown): NationBettingCandidate[] => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((candidate) => {
        const item = asRecord(candidate);
        const aux = asRecord(item.aux);
        if (typeof item.title !== 'string' || typeof aux.nation !== 'number' || !Number.isInteger(aux.nation)) {
            return [];
        }
        return [
            {
                title: item.title,
                info: typeof item.info === 'string' ? item.info : '',
                isHtml: true as const,
                aux: {
                    nation: aux.nation,
                    name: typeof aux.name === 'string' ? aux.name : item.title,
                    color: typeof aux.color === 'string' ? aux.color : '#000000',
                    type: typeof aux.type === 'string' ? aux.type : '',
                    level: typeof aux.level === 'number' ? aux.level : 0,
                    capital: typeof aux.capital === 'number' ? aux.capital : null,
                    gennum: typeof aux.gennum === 'number' ? aux.gennum : 0,
                    power: typeof aux.power === 'number' ? aux.power : 0,
                    city_cnt: typeof aux.city_cnt === 'number' ? aux.city_cnt : 0,
                },
            },
        ];
    });
};

const persistNationBettingOpen = async (
    prisma: GamePrisma.TransactionClient,
    betting: PendingNationBettingOpen
): Promise<void> => {
    await prisma.nationBetting.create({
        data: {
            id: betting.id,
            type: 'bettingNation',
            name: betting.name,
            finished: false,
            selectCount: betting.selectCount,
            isExclusive: betting.isExclusive,
            requiresInheritancePoint: betting.requiresInheritancePoint,
            openYearMonth: betting.openYearMonth,
            closeYearMonth: betting.closeYearMonth,
            candidates: asJson(betting.candidates),
        },
    });
    if (betting.bonusPoint > 0) {
        await prisma.nationBet.create({
            data: {
                bettingId: betting.id,
                generalId: 0,
                userId: null,
                selection: [-1],
                selectionKey: '[-1]',
                amount: betting.bonusPoint,
            },
        });
    }
};

const persistNationBettingFinish = async (
    prisma: GamePrisma.TransactionClient,
    finish: PendingNationBettingFinish
): Promise<void> => {
    await prisma.$queryRaw`
        SELECT id
        FROM nation_betting
        WHERE id = ${finish.id}
        FOR UPDATE
    `;
    const betting = await prisma.nationBetting.findUnique({
        where: { id: finish.id },
        include: { bets: { orderBy: { id: 'asc' } } },
    });
    if (!betting || betting.type !== 'bettingNation' || betting.finished) {
        return;
    }
    if (finish.winnerNationIds.length !== betting.selectCount) {
        return;
    }

    const candidates = readBettingCandidates(betting.candidates);
    const candidateIndexByNation = new Map(candidates.map((candidate, index) => [candidate.aux.nation, index]));
    let newNationOffset = 0;
    const winner = finish.winnerNationIds.map((nationId) => {
        const candidateIndex = candidateIndexByNation.get(nationId);
        if (candidateIndex !== undefined) {
            return candidateIndex;
        }
        const result = candidates.length + newNationOffset;
        newNationOffset += 1;
        return result;
    });
    const purifiedWinner = [...new Set(winner)].sort((left, right) => left - right);
    if (purifiedWinner.length !== betting.selectCount) {
        return;
    }

    const rewards = calculateNationBettingRewards({
        selectCount: betting.selectCount,
        isExclusive: betting.isExclusive,
        winner: purifiedWinner,
        stakes: betting.bets.map((bet) => ({
            generalId: bet.generalId,
            userId: bet.userId,
            selection: Array.isArray(bet.selection)
                ? bet.selection.filter((value): value is number => typeof value === 'number')
                : [],
            amount: bet.amount,
        })),
    });

    for (const reward of rewards) {
        if (!reward.userId) {
            continue;
        }
        const existing = await prisma.inheritancePoint.findUnique({
            where: { userId_key: { userId: reward.userId, key: 'previous' } },
            select: { value: true },
        });
        const previousPoint = existing?.value ?? 0;
        const nextPoint = previousPoint + reward.amount;
        await prisma.inheritancePoint.upsert({
            where: { userId_key: { userId: reward.userId, key: 'previous' } },
            update: { value: nextPoint },
            create: { userId: reward.userId, key: 'previous', value: nextPoint },
        });
        await prisma.rankData.upsert({
            where: {
                generalId_type: {
                    generalId: reward.generalId,
                    type: 'inherit_earned_act',
                },
            },
            update: { value: { increment: Math.trunc(reward.amount) } },
            create: {
                generalId: reward.generalId,
                nationId:
                    (
                        await prisma.general.findUnique({
                            where: { id: reward.generalId },
                            select: { nationId: true },
                        })
                    )?.nationId ?? 0,
                type: 'inherit_earned_act',
                value: Math.trunc(reward.amount),
            },
        });
        const partialText =
            reward.matchPoint === betting.selectCount
                ? '베팅 당첨'
                : `베팅 부분 당첨(${reward.matchPoint}/${betting.selectCount})`;
        await prisma.inheritanceLog.createMany({
            data: [
                {
                    userId: reward.userId,
                    year: finish.year,
                    month: finish.month,
                    text: `${betting.name} ${partialText} 보상으로 ${formatLegacyNumber(reward.amount)} 포인트 획득.`,
                },
                {
                    userId: reward.userId,
                    year: finish.year,
                    month: finish.month,
                    text: `포인트 ${formatLegacyNumber(previousPoint)} => ${formatLegacyNumber(nextPoint)}`,
                },
            ],
        });
    }

    await prisma.nationBetting.update({
        where: { id: finish.id },
        data: {
            finished: true,
            winner: purifiedWinner,
        },
    });
    const openYear = Math.floor(betting.openYearMonth / 12);
    const openMonth = (betting.openYearMonth % 12) + 1;
    const finishLog = finalizeLogEntry(
        {
            scope: LogScope.SYSTEM,
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
            text: `<B><b>【내기】</b></> ${openYear}년 ${openMonth}월에 열렸던 ${betting.name} 내기의 결과가 나왔습니다!`,
        },
        {
            year: finish.year,
            month: finish.month,
            at: finish.turnTime,
        }
    );
    if (finishLog) {
        await prisma.logEntry.create({
            data: {
                scope: finishLog.scope,
                category: finishLog.category,
                subType: finishLog.subType ?? null,
                year: finishLog.year,
                month: finishLog.month,
                text: finishLog.text,
                generalId: finishLog.generalId ?? null,
                nationId: finishLog.nationId ?? null,
                userId: finishLog.userId ?? null,
                meta: asJson(finishLog.meta ?? {}),
                createdAt: finishLog.createdAt,
            },
        });
    }
};

const toCode = (value: string | null | undefined): string => (value && value !== 'None' ? value : 'None');

const readMetaNumber = (meta: Record<string, unknown>, key: string): number | null => {
    const value = meta[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const toLegacyDatabaseInt = (value: number): number => {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
};

const LEGACY_INTEGER_GENERAL_META_KEYS = [
    'leadership_exp',
    'strength_exp',
    'intel_exp',
    'dex1',
    'dex2',
    'dex3',
    'dex4',
    'dex5',
    'explevel',
    'dedlevel',
    'killturn',
    'myset',
] as const;

const buildPersistedGeneralMeta = (
    general: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['generals'][number]
): InputJsonValue => {
    const meta = withSerializedItemInventory(general.meta, ensureItemInventory(general));
    for (const key of LEGACY_INTEGER_GENERAL_META_KEYS) {
        const value = meta[key];
        if (typeof value === 'number') {
            meta[key] = toLegacyDatabaseInt(value);
        }
    }
    return asJson(meta);
};

const RANK_DATA_UPSERT_BATCH_SIZE = 1_000;

const upsertRankRows = async (
    prisma: GamePrisma.TransactionClient,
    rows: Array<{ generalId: number; nationId: number; type: string; value: number }>
): Promise<void> => {
    for (let offset = 0; offset < rows.length; offset += RANK_DATA_UPSERT_BATCH_SIZE) {
        const batch = rows.slice(offset, offset + RANK_DATA_UPSERT_BATCH_SIZE);
        await prisma.$executeRaw(GamePrisma.sql`
            INSERT INTO "rank_data" ("general_id", "nation_id", "type", "value")
            VALUES ${GamePrisma.join(
                batch.map((row) => GamePrisma.sql`(${row.generalId}, ${row.nationId}, ${row.type}, ${row.value})`)
            )}
            ON CONFLICT ("general_id", "type") DO UPDATE
            SET
                "nation_id" = EXCLUDED."nation_id",
                "value" = EXCLUDED."value"
        `);
    }
};

const buildGeneralUpdate = (
    general: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['generals'][number]
): TurnEngineGeneralUpdateInput => ({
    userId: general.userId ?? null,
    name: general.name,
    nationId: general.nationId,
    cityId: general.cityId,
    troopId: general.troopId,
    leadership: toLegacyDatabaseInt(general.stats.leadership),
    strength: toLegacyDatabaseInt(general.stats.strength),
    intel: toLegacyDatabaseInt(general.stats.intelligence),
    experience: toLegacyDatabaseInt(general.experience),
    dedication: toLegacyDatabaseInt(general.dedication),
    officerLevel: general.officerLevel,
    injury: toLegacyDatabaseInt(general.injury),
    gold: toLegacyDatabaseInt(general.gold),
    rice: toLegacyDatabaseInt(general.rice),
    crew: toLegacyDatabaseInt(general.crew),
    crewTypeId: general.crewTypeId,
    train: toLegacyDatabaseInt(general.train),
    atmos: toLegacyDatabaseInt(general.atmos),
    age: general.age,
    affinity: general.affinity ?? null,
    bornYear: general.bornYear,
    deadYear: general.deadYear,
    picture: general.picture ?? null,
    imageServer: general.imageServer ?? 0,
    startAge: general.startAge ?? general.age,
    npcState: general.npcState,
    horseCode: toCode(general.role.items.horse),
    weaponCode: toCode(general.role.items.weapon),
    bookCode: toCode(general.role.items.book),
    itemCode: toCode(general.role.items.item),
    personalCode: toCode(general.role.personality),
    specialCode: toCode(general.role.specialDomestic),
    special2Code: toCode(general.role.specialWar),
    lastTurn: asJson(general.lastTurn ?? { command: '휴식' }),
    penalty: asJson(general.penalty ?? {}),
    meta: buildPersistedGeneralMeta(general),
    turnTime: general.turnTime,
    turnTick: BigInt(general.turnTick ?? 0),
    recentWarTime: general.recentWarTime ?? null,
    recentWarTick:
        general.recentWarTick === null || general.recentWarTick === undefined ? null : BigInt(general.recentWarTick),
});

const buildGeneralCreate = (
    general: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['generals'][number]
): TurnEngineGeneralCreateManyInput => ({
    id: general.id,
    userId: general.userId ?? null,
    name: general.name,
    nationId: general.nationId,
    cityId: general.cityId,
    troopId: general.troopId,
    npcState: general.npcState,
    leadership: toLegacyDatabaseInt(general.stats.leadership),
    strength: toLegacyDatabaseInt(general.stats.strength),
    intel: toLegacyDatabaseInt(general.stats.intelligence),
    experience: toLegacyDatabaseInt(general.experience),
    dedication: toLegacyDatabaseInt(general.dedication),
    officerLevel: general.officerLevel,
    injury: toLegacyDatabaseInt(general.injury),
    gold: toLegacyDatabaseInt(general.gold),
    rice: toLegacyDatabaseInt(general.rice),
    crew: toLegacyDatabaseInt(general.crew),
    crewTypeId: general.crewTypeId,
    train: toLegacyDatabaseInt(general.train),
    atmos: toLegacyDatabaseInt(general.atmos),
    age: general.age,
    affinity: general.affinity ?? null,
    bornYear: general.bornYear,
    deadYear: general.deadYear,
    picture: general.picture ?? null,
    imageServer: general.imageServer ?? 0,
    startAge: general.startAge ?? general.age,
    horseCode: toCode(general.role.items.horse),
    weaponCode: toCode(general.role.items.weapon),
    bookCode: toCode(general.role.items.book),
    itemCode: toCode(general.role.items.item),
    personalCode: toCode(general.role.personality),
    specialCode: toCode(general.role.specialDomestic),
    special2Code: toCode(general.role.specialWar),
    lastTurn: asJson(general.lastTurn ?? { command: '휴식' }),
    penalty: asJson(general.penalty ?? {}),
    meta: buildPersistedGeneralMeta(general),
    turnTime: general.turnTime,
    turnTick: BigInt(general.turnTick ?? 0),
    recentWarTime: general.recentWarTime ?? null,
    recentWarTick:
        general.recentWarTick === null || general.recentWarTick === undefined ? null : BigInt(general.recentWarTick),
});

const buildCityUpdate = (
    city: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['cities'][number]
): TurnEngineCityUpdateInput => {
    const meta: Record<string, unknown> = {
        ...(city.meta as Record<string, unknown>),
        state: city.state,
    };
    const trust = readMetaNumber(meta, 'trust');
    const trade = readMetaNumber(meta, 'trade');
    const region = readMetaNumber(meta, 'region');
    const { trust: _projectedTrust, trade: _projectedTrade, region: _projectedRegion, ...persistedMeta } = meta;

    const data: TurnEngineCityUpdateInput = {
        name: city.name,
        nationId: city.nationId,
        level: city.level,
        population: city.population,
        populationMax: city.populationMax,
        agriculture: city.agriculture,
        agricultureMax: city.agricultureMax,
        commerce: city.commerce,
        commerceMax: city.commerceMax,
        security: city.security,
        securityMax: city.securityMax,
        supplyState: city.supplyState,
        frontState: city.frontState,
        defence: city.defence,
        defenceMax: city.defenceMax,
        wall: city.wall,
        wallMax: city.wallMax,
        ...(city.conflict ? { conflict: asJson(city.conflict) } : {}),
        meta: asJson(persistedMeta),
    };

    if (trust !== null) {
        data.trust = trust;
    }
    // trade가 없는 도시는 레거시 DB에서 NULL이다. City meta에 trade가
    // 없다는 사실도 dirty city의 전체 snapshot 일부로 영속화한다.
    data.trade = trade;
    if (region !== null) {
        data.region = region;
    }

    return data;
};

const buildNationUpdate = (
    nation: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['nations'][number]
): TurnEngineNationUpdateInput => ({
    name: nation.name,
    color: nation.color,
    capitalCityId: nation.capitalCityId,
    chiefGeneralId: nation.chiefGeneralId,
    gold: toLegacyDatabaseInt(nation.gold),
    rice: toLegacyDatabaseInt(nation.rice),
    // Ref persists nation.tech as FLOAT. Domestic research commonly produces
    // tenths, and truncating here changes the following month's state/power.
    tech: typeof nation.meta.tech === 'number' && Number.isFinite(nation.meta.tech) ? nation.meta.tech : 0,
    level: nation.level,
    typeCode: nation.typeCode,
    meta: asJson({
        ...nation.meta,
        power: nation.power,
    }),
});

const buildTroopUpdate = (
    troop: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['troops'][number]
): TurnEngineTroopUpdateInput => ({
    nationId: troop.nationId,
    name: troop.name,
});

const buildTroopCreate = (
    troop: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['troops'][number]
): TurnEngineTroopCreateManyInput => ({
    troopLeaderId: troop.id,
    nationId: troop.nationId,
    name: troop.name,
});

const buildDiplomacyCreate = (
    entry: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['diplomacy'][number]
): TurnEngineDiplomacyCreateManyInput => ({
    srcNationId: entry.fromNationId,
    destNationId: entry.toNationId,
    stateCode: entry.state,
    term: entry.term,
    meta: asJson(buildDiplomacyMeta(entry)),
});

const buildDiplomacyUpdate = (
    entry: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['diplomacy'][number]
): TurnEngineDiplomacyUpdateInput => ({
    stateCode: entry.state,
    term: entry.term,
    meta: asJson(buildDiplomacyMeta(entry)),
});

const buildLogCreateData = (
    entry: LogEntryDraft,
    context: { year: number; month: number; at: Date }
): TurnEngineLogEntryCreateManyInput | null => {
    const record = finalizeLogEntry(entry, {
        year: context.year,
        month: context.month,
        at: context.at,
    });
    if (!record) {
        return null;
    }

    return {
        scope: record.scope,
        category: record.category,
        subType: record.subType ?? null,
        year: record.year,
        month: record.month,
        text: record.text,
        generalId: record.generalId ?? null,
        nationId: record.nationId ?? null,
        userId: record.userId ?? null,
        meta: asJson(record.meta ?? {}),
        createdAt: record.createdAt,
    };
};

export const createDatabaseTurnHooks = async (
    databaseUrl: string,
    world: InMemoryTurnWorld,
    options?: {
        profileName?: string;
        reservedTurns?: InMemoryReservedTurnStore;
        turnDaemonLease?: DatabaseTurnDaemonLease;
        transactionTimeoutMs?: number;
    }
): Promise<DatabaseTurnHooks> => {
    // 턴 처리 결과를 DB에 반영하는 훅을 만든다.
    const connector = createGamePostgresConnector({ url: databaseUrl });
    await connector.connect();
    const prisma = connector.prisma;
    // Prisma's 5-second default matches the normal turn execution budget too
    // closely. A populated season can finish the turn but expire while flushing
    // it, which rolls the transaction back and marks the profile PAUSED.
    const transactionOptions = { timeout: options?.transactionTimeoutMs ?? 30_000 };
    const readModelBaseline = createRealtimeReadModelBaseline(world);
    let worldReadModelBaseline = createWorldReadModelSignature(world);
    let persistedTickSeconds = world.getState().tickSeconds;
    let webPushTurnBaseline = captureWebPushTurnBaseline(world, options?.reservedTurns);
    const committedReceipts = new Map<bigint, CommittedReadModelChangeReceipt>();

    const enqueueCommittedReceipt = (
        changes: RealtimeReadModelChanges,
        journalWrite: ReadModelJournalWriteResult | null
    ): void => {
        if (!journalWrite) {
            return;
        }
        committedReceipts.set(journalWrite.outboxId, {
            outboxId: journalWrite.outboxId,
            invalidation: journalWrite.invalidation,
            changes,
        });
    };
    const takeCommittedReceipt = (): CommittedReadModelChangeReceipt | null => {
        const next = committedReceipts.entries().next();
        if (next.done) {
            return null;
        }
        const [outboxId, receipt] = next.value;
        committedReceipts.delete(outboxId);
        return receipt;
    };

    const persistChanges = async (
        transaction?: GamePrisma.TransactionClient,
        commandCompletion?: { requestId: string; result: TurnDaemonCommandResult },
        directLogFloor?: number
    ): Promise<{
        acknowledge: () => void;
        readModelChanges: RealtimeReadModelChanges;
        journalWrite: ReadModelJournalWriteResult | null;
    }> => {
        const state = world.getState();
        const changes = world.peekDirtyState();
        let persistedVisibleLogs: PersistedVisibleLogRow[] = [];
        let visibleLogFloor = directLogFloor;
        const {
            realtimeBacklogShiftTicks,
            accessScoreResetGeneralIds,
            generals,
            cities,
            nations,
            troops,
            deletedTroops,
            deletedGenerals,
            deletedNations,
            deletedNationSnapshots,
            diplomacy,
            logs,
            messages,
            createdGenerals,
            createdNations,
            createdTroops,
            createdDiplomacy,
            createdEvents,
            deletedEvents,
            lifecycleEvents,
            pendingNeutralAuctions,
            inheritancePointAdjustments,
            pendingInheritanceLogs,
            pendingNationBettingOpens,
            pendingNationBettingFinishes,
            pendingYearbookSnapshots,
            pendingUnificationFinalizations,
        } = changes;
        const reservedTurnChanges = options?.reservedTurns?.peekDirtyState();
        const persistedReservedTurnChanges = reservedTurnChanges
            ? excludeDeletedReservedTurnQueues(reservedTurnChanges, deletedGenerals, deletedNations)
            : undefined;
        const nextWebPushTurnBaseline = captureWebPushTurnBaseline(world, options?.reservedTurns);
        const webPushEvents = buildTurnWebPushEvents({
            before: webPushTurnBaseline,
            after: nextWebPushTurnBaseline,
            changes,
            ...(persistedReservedTurnChanges ? { reservedTurnChanges: persistedReservedTurnChanges } : {}),
        });

        const worldStateUpdate: TurnEngineWorldStateUpdateInput = {
            currentYear: state.currentYear,
            currentMonth: state.currentMonth,
            tickSeconds: state.tickSeconds,
            clockBaseTime: state.clockBaseTime ?? state.lastTurnTime,
            clockTick: BigInt(state.clockTick ?? 0),
            clockMode: state.clockMode ?? 'manual',
            clockWallAnchor: state.clockWallAnchor ?? state.lastTurnTime,
            lastTurnTick: BigInt(state.lastTurnTick ?? world.dateToGameTick(state.lastTurnTime)),
            clockPhase: state.clockPhase ?? (state.clockMode === 'realtime' ? 'RUNNING' : 'MANUAL'),
            clockRevision: BigInt(state.clockRevision ?? 1),
            deadlineGeneration: BigInt(state.deadlineGeneration ?? 1),
            config: asJson(world.getWorldConfig()),
            meta: asJson(state.meta),
        };
        const writesGeneralAccess =
            accessScoreResetGeneralIds.length > 0 ||
            lifecycleEvents.length > 0 ||
            deletedGenerals.length > 0 ||
            generals.some(
                (general) => typeof general.refreshScoreTotal === 'number' && Number.isFinite(general.refreshScoreTotal)
            );
        const persist = async (
            prisma: GamePrisma.TransactionClient
        ): Promise<{
            readModelChanges: RealtimeReadModelChanges;
            journalWrite: ReadModelJournalWriteResult | null;
            worldReadModelSignature: string;
        }> => {
            visibleLogFloor ??=
                (
                    await prisma.logEntry.findFirst({
                        orderBy: { id: 'desc' },
                        select: { id: true },
                    })
                )?.id ?? 0;
            const logContext = {
                year: state.currentYear,
                month: state.currentMonth,
                at: state.lastTurnTime,
            };
            const pendingLogRows = logs
                .map((entry) => buildLogCreateData(entry, logContext))
                .filter((entry): entry is TurnEngineLogEntryCreateManyInput => Boolean(entry));
            const pendingLifecycleArchiveLogs: GeneralLifecycleArchiveLog[] = pendingLogRows.flatMap((entry) =>
                entry.generalId !== null &&
                (entry.category === LogCategory.HISTORY || entry.category === LogCategory.BATTLE_BRIEF)
                    ? [{ generalId: entry.generalId, category: entry.category, text: entry.text }]
                    : []
            );
            // Lock and validate the fencing row in the same transaction as every
            // world mutation. A stale daemon can finish calculating, but it can
            // never commit after another owner has advanced the epoch.
            await options?.turnDaemonLease?.assertActive(prisma);
            await acquireGameSchemaAdvisoryXactLock(prisma, CLOCK_OPERATION_PERSISTENCE_LOCK);
            if (writesGeneralAccess) {
                // General-access API writers take this lock before touching
                // world rows. Clock operations use the same global order.
                await acquireGameSchemaAdvisoryXactLock(prisma, GENERAL_ACCESS_PERSISTENCE_LOCK);
            }
            const persistedClock = await prisma.$queryRaw<
                Array<{
                    clock_phase: string;
                    clock_revision: bigint;
                    deadline_generation: bigint;
                    opening_reached: boolean;
                }>
            >(GamePrisma.sql`
                SELECT clock_phase,
                       clock_revision,
                       deadline_generation,
                       clock_wall_anchor <= CURRENT_TIMESTAMP AS opening_reached
                FROM world_state
                WHERE id = ${state.id}
                FOR UPDATE
            `);
            const durableClock = persistedClock[0];
            if (!durableClock) {
                throw new Error(`world_state ${state.id} is missing during a fenced turn flush.`);
            }
            const expectedPhase = state.clockPhase ?? (state.clockMode === 'realtime' ? 'RUNNING' : 'MANUAL');
            const expectedRevision = BigInt(state.clockRevision ?? 1);
            const expectedGeneration = BigInt(state.deadlineGeneration ?? 1);
            const stateMeta = asRecord(state.meta);
            const unificationSuspensionId =
                typeof stateMeta.unificationClockSuspensionId === 'string'
                    ? stateMeta.unificationClockSuspensionId
                    : null;
            const openingPhaseTransition =
                durableClock.clock_phase === 'PREOPEN' && expectedPhase === 'RUNNING' && durableClock.opening_reached;
            const unificationSuspensionTransition =
                durableClock.clock_phase === 'RUNNING' &&
                expectedPhase === 'SUSPENDED' &&
                Number(stateMeta.isunited ?? stateMeta.isUnited ?? 0) === 2 &&
                Boolean(unificationSuspensionId);
            const completionPhaseTransition =
                durableClock.clock_phase === 'RUNNING' &&
                expectedPhase === 'COMPLETED' &&
                Number(stateMeta.isunited ?? stateMeta.isUnited ?? 0) >= 2;
            if (
                (!openingPhaseTransition &&
                    !unificationSuspensionTransition &&
                    !completionPhaseTransition &&
                    durableClock.clock_phase !== expectedPhase) ||
                durableClock.clock_revision !== expectedRevision ||
                durableClock.deadline_generation !== expectedGeneration
            ) {
                throw new Error(
                    `Game clock fence changed before flush: expected ${expectedPhase}@${expectedRevision}/${expectedGeneration}, ` +
                        `found ${durableClock.clock_phase}@${durableClock.clock_revision}/${durableClock.deadline_generation}.`
                );
            }
            const unificationCutWallAt = unificationSuspensionTransition ? await readClockDatabaseWall(prisma) : null;
            const unificationCutTick = unificationCutWallAt
                ? world.dateToGameTick(world.getGameNow(unificationCutWallAt))
                : null;
            const suspensionPreparation =
                unificationCutTick !== null
                    ? await prepareClockSuspensionUnderHeldLocks({
                          db: prisma,
                          cutTick: unificationCutTick,
                          cutWallAt: unificationCutWallAt!,
                      })
                    : null;
            if (commandCompletion) {
                const commandFence = await prisma.$queryRaw<
                    Array<{
                        status: string;
                        processing_clock_revision: bigint | null;
                        processing_deadline_generation: bigint | null;
                    }>
                >(GamePrisma.sql`
                    SELECT status,
                           processing_clock_revision,
                           processing_deadline_generation
                    FROM input_event
                    WHERE request_id = ${commandCompletion.requestId}
                      AND target = 'ENGINE'::"InputEventTarget"
                    FOR UPDATE
                `);
                const event = commandFence[0];
                const unificationRevisionTransition =
                    commandCompletion.result.type === 'messageRespond' &&
                    commandCompletion.result.ok &&
                    commandCompletion.result.action === 'raiseInvader' &&
                    expectedPhase === 'RECONCILING' &&
                    event?.processing_clock_revision !== null &&
                    event?.processing_deadline_generation !== null &&
                    event?.processing_clock_revision + 1n === expectedRevision &&
                    event?.processing_deadline_generation + 1n === expectedGeneration;
                if (
                    !event ||
                    event.status !== 'PROCESSING' ||
                    (!unificationRevisionTransition &&
                        (event.processing_clock_revision !== expectedRevision ||
                            event.processing_deadline_generation !== expectedGeneration))
                ) {
                    throw new Error(
                        `Input event processing clock fence changed before commit: ${commandCompletion.requestId}.`
                    );
                }
            }
            let neutralAuctionsToCreate = pendingNeutralAuctions;
            if (pendingNeutralAuctions.length > 0) {
                const latestRegistrationKey =
                    pendingNeutralAuctions[pendingNeutralAuctions.length - 1]!.registrationKey;
                await acquireGameSchemaAdvisoryXactLock(prisma, `neutral-auction-registration:world-state:${state.id}`);
                const persistedRows = await prisma.$queryRaw<Array<{ meta: unknown }>>`
                    SELECT meta
                    FROM world_state
                    WHERE id = ${state.id}
                    FOR UPDATE
                `;
                const persistedMeta = asRecord(persistedRows[0]?.meta);
                if (persistedMeta.neutralAuctionRegistrationKey === latestRegistrationKey) {
                    neutralAuctionsToCreate = [];
                }
            }

            await prisma.worldState.update({
                where: { id: state.id },
                data: worldStateUpdate,
            });

            if (realtimeBacklogShiftTicks > 0) {
                const deltaTicks = BigInt(realtimeBacklogShiftTicks);
                const deltaSeconds = (realtimeBacklogShiftTicks / GAME_TICKS_PER_TURN) * state.tickSeconds;
                await prisma.$executeRaw(
                    GamePrisma.sql`
                        UPDATE general
                        SET turn_tick = CASE WHEN turn_tick IS NULL THEN NULL ELSE turn_tick + ${deltaTicks} END,
                            turn_time = turn_time + (${deltaSeconds} * INTERVAL '1 second')
                    `
                );
                await prisma.$executeRaw(
                    GamePrisma.sql`
                        UPDATE auction
                        SET close_tick = CASE WHEN close_tick IS NULL THEN NULL ELSE close_tick + ${deltaTicks} END,
                            close_at = close_at + (${deltaSeconds} * INTERVAL '1 second'),
                            updated_at = NOW()
                        WHERE status = 'OPEN'
                    `
                );
                await prisma.$executeRaw(
                    GamePrisma.sql`
                        UPDATE select_pool
                        SET reserved_until_tick = CASE
                                WHEN reserved_until_tick IS NULL THEN NULL
                                ELSE reserved_until_tick + ${deltaTicks}
                            END,
                            reserved_until = CASE
                                WHEN reserved_until IS NULL THEN NULL
                                ELSE reserved_until + (${deltaSeconds} * INTERVAL '1 second')
                            END
                        WHERE general_id IS NULL
                          AND (reserved_until_tick IS NOT NULL OR reserved_until IS NOT NULL)
                    `
                );
            }

            if (
                state.tickSeconds !== persistedTickSeconds &&
                commandCompletion?.result.type !== 'updateRuntimeSettings'
            ) {
                const ticksPerSecond = BigInt(GAME_TICKS_PER_TURN / state.tickSeconds);
                const baseTime = state.clockBaseTime ?? state.lastTurnTime;
                await prisma.$executeRaw(GamePrisma.sql`
                    UPDATE auction
                    SET close_at = CAST(${baseTime} AS timestamp)
                        + (close_tick / ${ticksPerSecond}) * INTERVAL '1 second'
                        + (((close_tick % ${ticksPerSecond}) * 1000) / ${ticksPerSecond}) * INTERVAL '1 millisecond',
                        updated_at = NOW()
                    WHERE close_tick IS NOT NULL
                `);
                await prisma.$executeRaw(GamePrisma.sql`
                    UPDATE message
                    SET time = CASE
                            WHEN time_tick IS NULL THEN time
                            ELSE CAST(${baseTime} AS timestamp)
                                + (time_tick / ${ticksPerSecond}) * INTERVAL '1 second'
                                + (((time_tick % ${ticksPerSecond}) * 1000) / ${ticksPerSecond}) * INTERVAL '1 millisecond'
                        END,
                        valid_until = CASE
                            WHEN valid_until_tick IS NULL THEN valid_until
                            ELSE CAST(${baseTime} AS timestamp)
                                + (valid_until_tick / ${ticksPerSecond}) * INTERVAL '1 second'
                                + (((valid_until_tick % ${ticksPerSecond}) * 1000) / ${ticksPerSecond}) * INTERVAL '1 millisecond'
                        END
                    WHERE time_tick IS NOT NULL OR valid_until_tick IS NOT NULL
                `);
                await prisma.$executeRaw(GamePrisma.sql`
                    UPDATE vote_poll
                    SET start_at = CASE
                            WHEN start_tick IS NULL THEN start_at
                            ELSE CAST(${baseTime} AS timestamp)
                                + (start_tick / ${ticksPerSecond}) * INTERVAL '1 second'
                                + (((start_tick % ${ticksPerSecond}) * 1000) / ${ticksPerSecond}) * INTERVAL '1 millisecond'
                        END,
                        end_at = CASE
                            WHEN end_tick IS NULL THEN end_at
                            ELSE CAST(${baseTime} AS timestamp)
                                + (end_tick / ${ticksPerSecond}) * INTERVAL '1 second'
                                + (((end_tick % ${ticksPerSecond}) * 1000) / ${ticksPerSecond}) * INTERVAL '1 millisecond'
                        END
                    WHERE start_tick IS NOT NULL OR end_tick IS NOT NULL
                `);
                await prisma.$executeRaw(GamePrisma.sql`
                    UPDATE select_pool
                    SET reserved_until = CASE
                            WHEN reserved_until_tick IS NULL THEN reserved_until
                            ELSE CAST(${baseTime} AS timestamp)
                                + (reserved_until_tick / ${ticksPerSecond}) * INTERVAL '1 second'
                                + (((reserved_until_tick % ${ticksPerSecond}) * 1000) / ${ticksPerSecond})
                                    * INTERVAL '1 millisecond'
                        END
                    WHERE reserved_until_tick IS NOT NULL
                `);
                await prisma.$executeRaw(GamePrisma.sql`
                    UPDATE select_npc_token
                    SET valid_until = CASE
                            WHEN valid_until_tick IS NULL THEN valid_until
                            ELSE CAST(${baseTime} AS timestamp)
                                + (valid_until_tick / ${ticksPerSecond}) * INTERVAL '1 second'
                                + (((valid_until_tick % ${ticksPerSecond}) * 1000) / ${ticksPerSecond})
                                    * INTERVAL '1 millisecond'
                        END,
                        pick_more_from = CASE
                            WHEN pick_more_from_tick IS NULL THEN pick_more_from
                            ELSE CAST(${baseTime} AS timestamp)
                                + (pick_more_from_tick / ${ticksPerSecond}) * INTERVAL '1 second'
                                + (((pick_more_from_tick % ${ticksPerSecond}) * 1000) / ${ticksPerSecond})
                                    * INTERVAL '1 millisecond'
                        END
                    WHERE valid_until_tick IS NOT NULL OR pick_more_from_tick IS NOT NULL
                `);
            }

            for (const betting of pendingNationBettingOpens) {
                await persistNationBettingOpen(prisma, betting);
            }
            for (const finish of pendingNationBettingFinishes) {
                await persistNationBettingFinish(prisma, finish);
            }

            const meta = asRecord(state.meta);
            const serverId =
                typeof meta.serverId === 'string' && meta.serverId.trim() ? meta.serverId.trim() : 'default';
            const persistInheritancePointAdjustments = async (
                entries: typeof inheritancePointAdjustments
            ): Promise<void> => {
                if (entries.length === 0) {
                    return;
                }
                const grouped = new Map<string, { userId: string; key: string; amount: number }>();
                for (const entry of entries) {
                    const groupKey = `${entry.userId}\u0000${entry.key}`;
                    const current = grouped.get(groupKey);
                    if (current) {
                        current.amount += entry.amount;
                    } else {
                        grouped.set(groupKey, {
                            userId: entry.userId,
                            key: entry.key,
                            amount: entry.amount,
                        });
                    }
                }
                for (const entry of grouped.values()) {
                    await prisma.inheritancePoint.upsert({
                        where: { userId_key: { userId: entry.userId, key: entry.key } },
                        update: { value: { increment: entry.amount } },
                        create: { userId: entry.userId, key: entry.key, value: entry.amount },
                    });
                }
            };
            const persistInheritanceLogs = async (entries: typeof pendingInheritanceLogs): Promise<void> => {
                if (entries.length === 0) {
                    return;
                }
                await prisma.inheritanceLog.createMany({
                    data: entries.map((entry) => ({
                        userId: entry.userId,
                        year: entry.year,
                        month: entry.month,
                        text: entry.text,
                    })),
                });
            };
            const beforeLifecycleAdjustments = inheritancePointAdjustments.filter(
                (entry) => entry.phase !== 'after_lifecycle'
            );
            const afterLifecycleAdjustments = inheritancePointAdjustments.filter(
                (entry) => entry.phase === 'after_lifecycle'
            );
            const beforeLifecycleLogs = pendingInheritanceLogs.filter((entry) => entry.phase !== 'after_lifecycle');
            const afterLifecycleLogs = pendingInheritanceLogs.filter((entry) => entry.phase === 'after_lifecycle');

            await persistInheritancePointAdjustments(beforeLifecycleAdjustments);
            await persistInheritanceLogs(beforeLifecycleLogs);
            await persistGeneralLifecycleEvents(
                prisma,
                lifecycleEvents,
                meta,
                asRecord(world.getScenarioConfig().const),
                world.gameTickToDate(state.clockTick ?? state.lastTurnTick ?? 0),
                pendingLifecycleArchiveLogs
            );
            await persistInheritancePointAdjustments(afterLifecycleAdjustments);
            await persistInheritanceLogs(afterLifecycleLogs);

            if (accessScoreResetGeneralIds.length > 0) {
                await prisma.generalAccessLog.updateMany({
                    where: { generalId: { in: accessScoreResetGeneralIds } },
                    data: { refreshScore: 0 },
                });
            }

            if (deletedNationSnapshots.length > 0) {
                const nationIds = deletedNationSnapshots.map((snapshot) => snapshot.nation.id);
                const historyRows = await prisma.logEntry.findMany({
                    where: {
                        nationId: { in: nationIds },
                        scope: LogScope.NATION,
                        category: LogCategory.HISTORY,
                    },
                    orderBy: { id: 'asc' },
                    select: { nationId: true, text: true },
                });
                const historyMap = new Map<number, string[]>();
                for (const row of historyRows) {
                    const bucket = historyMap.get(row.nationId ?? 0) ?? [];
                    bucket.push(row.text);
                    historyMap.set(row.nationId ?? 0, bucket);
                }
                await Promise.all(
                    deletedNationSnapshots.map((snapshot) =>
                        prisma.oldNation.upsert({
                            where: {
                                serverId_nation_sourceId: {
                                    serverId,
                                    nation: snapshot.nation.id,
                                    sourceId: 0,
                                },
                            },
                            update: {
                                data: buildOldNationArchiveData({
                                    nation: snapshot.nation,
                                    generalIds: snapshot.generalIds,
                                    history: historyMap.get(snapshot.nation.id) ?? [],
                                }) as InputJsonValue,
                                date: snapshot.removedAt,
                            },
                            create: {
                                serverId,
                                nation: snapshot.nation.id,
                                sourceId: 0,
                                data: buildOldNationArchiveData({
                                    nation: snapshot.nation,
                                    generalIds: snapshot.generalIds,
                                    history: historyMap.get(snapshot.nation.id) ?? [],
                                }) as InputJsonValue,
                                date: snapshot.removedAt,
                            },
                        })
                    )
                );
            }

            if (neutralAuctionsToCreate.length > 0) {
                await prisma.auction.createMany({
                    data: neutralAuctionsToCreate.map((auction) => ({
                        type: auction.type,
                        targetCode: auction.targetCode,
                        hostGeneralId: auction.hostGeneralId,
                        hostName: auction.hostName,
                        detail: asJson(auction.detail),
                        status: 'OPEN',
                        openTick: BigInt(state.clockTick ?? world.dateToGameTick(state.lastTurnTime)),
                        closeTick: BigInt(world.dateToGameTick(auction.closeAt)),
                        closeAt: auction.closeAt,
                    })),
                });
            }

            const createdIds = new Set(createdGenerals.map((general) => general.id));
            const createdNationIds = new Set(createdNations.map((nation) => nation.id));
            const createdTroopIds = new Set(createdTroops.map((troop) => troop.id));
            const createdDiplomacyKeys = new Set(
                createdDiplomacy.map((entry) => `${entry.fromNationId}:${entry.toNationId}`)
            );

            // Ref first claims a select_pool row and then finalizes it with the
            // newly inserted general ID. Core computes the turn in memory, so
            // perform the equivalent CAS in the same fenced flush transaction.
            // Releasing deaths first also preserves same-batch pool reuse.
            if (deletedGenerals.length > 0) {
                await prisma.selectPoolEntry.updateMany({
                    where: { generalId: { in: deletedGenerals } },
                    data: {
                        generalId: null,
                        ownerUserId: null,
                        reservedUntil: null,
                        reservedUntilTick: null,
                    },
                });
            }
            const createdGeneralPoolClaims = createdGenerals.flatMap((general) => {
                const claim = readScenarioGeneralPoolClaim(general.meta);
                return claim ? [{ general, claim }] : [];
            });
            const claimedPoolIds = new Set<number>();
            for (const { general, claim } of createdGeneralPoolClaims) {
                if (claimedPoolIds.has(claim.poolEntryId)) {
                    throw new Error(`한 flush에서 select_pool 후보 ${claim.poolEntryId}를 중복 점유할 수 없습니다.`);
                }
                claimedPoolIds.add(claim.poolEntryId);
                const claimedAt = new Date(claim.claimedAt);
                const claimedAtTick = world.dateToGameTick(claimedAt);
                if (!Number.isSafeInteger(claimedAtTick)) {
                    throw new Error(
                        `select_pool 후보 점유 tick이 안전한 정수 범위를 벗어났습니다: ${claim.uniqueName}`
                    );
                }
                const occupied = await prisma.selectPoolEntry.updateMany({
                    where: {
                        id: claim.poolEntryId,
                        uniqueName: claim.uniqueName,
                        OR: [
                            { generalId: general.id },
                            {
                                generalId: null,
                                OR: [
                                    { ownerUserId: null, reservedUntil: null, reservedUntilTick: null },
                                    { reservedUntilTick: { lt: BigInt(claimedAtTick) } },
                                    { reservedUntilTick: null, reservedUntil: { lt: claimedAt } },
                                ],
                            },
                        ],
                    },
                    data: {
                        generalId: general.id,
                        ownerUserId: null,
                        reservedUntil: null,
                        reservedUntilTick: null,
                    },
                });
                if (occupied.count !== 1) {
                    throw new Error(`select_pool 후보를 점유하지 못했습니다: ${claim.uniqueName}`);
                }
            }

            if (createdGenerals.length > 0) {
                await prisma.general.createMany({
                    data: createdGenerals.map(buildGeneralCreate),
                });
            }
            if (createdNations.length > 0) {
                await prisma.nation.createMany({
                    data: createdNations.map((nation) => ({
                        id: nation.id,
                        name: nation.name,
                        color: nation.color,
                        capitalCityId: nation.capitalCityId,
                        chiefGeneralId: nation.chiefGeneralId,
                        gold: toLegacyDatabaseInt(nation.gold),
                        rice: toLegacyDatabaseInt(nation.rice),
                        tech:
                            typeof nation.meta.tech === 'number' && Number.isFinite(nation.meta.tech)
                                ? nation.meta.tech
                                : 0,
                        level: nation.level,
                        typeCode: nation.typeCode,
                        meta: asJson(nation.meta),
                    })),
                });
            }
            if (createdTroops.length > 0) {
                await prisma.troop.createMany({
                    data: createdTroops.map(buildTroopCreate),
                });
            }
            if (createdDiplomacy.length > 0) {
                await prisma.diplomacy.createMany({
                    data: createdDiplomacy.map(buildDiplomacyCreate),
                });
            }
            if (createdEvents.length > 0) {
                await prisma.event.createMany({
                    data: createdEvents.map((event) => ({
                        id: event.id,
                        targetCode: event.targetCode,
                        priority: event.priority,
                        condition: asJson(event.condition),
                        action: asJson(event.action),
                        meta: asJson(event.meta),
                    })),
                });
                await prisma.$queryRaw`
                    SELECT setval(
                        pg_get_serial_sequence('event', 'id'),
                        GREATEST((SELECT COALESCE(MAX(id), 1) FROM event), 1)
                    )
                `;
            }
            if (deletedTroops.length > 0) {
                await prisma.troop.deleteMany({
                    where: { troopLeaderId: { in: deletedTroops } },
                });
            }

            if (deletedGenerals.length > 0) {
                await prisma.selectPoolEntry.updateMany({
                    where: { generalId: { in: deletedGenerals } },
                    data: {
                        generalId: null,
                        ownerUserId: null,
                        reservedUntil: null,
                        reservedUntilTick: null,
                    },
                });
                if (prisma.generalTurnRevision) {
                    await prisma.generalTurnRevision.deleteMany({
                        where: { generalId: { in: deletedGenerals } },
                    });
                }
                await prisma.generalTurn.deleteMany({
                    where: { generalId: { in: deletedGenerals } },
                });
                await prisma.general.deleteMany({
                    where: { id: { in: deletedGenerals } },
                });
                await prisma.rankData.deleteMany({
                    where: { generalId: { in: deletedGenerals } },
                });
            }

            if (deletedNations.length > 0) {
                await prisma.diplomacy.deleteMany({
                    where: {
                        OR: [{ srcNationId: { in: deletedNations } }, { destNationId: { in: deletedNations } }],
                    },
                });
                if (prisma.nationTurnRevision) {
                    await prisma.nationTurnRevision.deleteMany({
                        where: { nationId: { in: deletedNations } },
                    });
                }
                await prisma.nationTurn.deleteMany({
                    where: { nationId: { in: deletedNations } },
                });
                await prisma.nation.deleteMany({
                    where: { id: { in: deletedNations } },
                });
            }
            if (deletedEvents.length > 0) {
                await prisma.event.deleteMany({
                    where: { id: { in: deletedEvents } },
                });
            }

            await Promise.all([
                ...generals
                    .filter((general) => !createdIds.has(general.id))
                    .map((general) =>
                        prisma.general.update({
                            where: { id: general.id },
                            data: buildGeneralUpdate(general),
                        })
                    ),
                ...generals
                    .filter(
                        (general) =>
                            typeof general.refreshScoreTotal === 'number' && Number.isFinite(general.refreshScoreTotal)
                    )
                    .map((general) =>
                        prisma.generalAccessLog.upsert({
                            where: { generalId: general.id },
                            update: {
                                refreshScoreTotal: Math.floor(general.refreshScoreTotal ?? 0),
                            },
                            create: {
                                generalId: general.id,
                                userId: general.userId ?? null,
                                refreshScoreTotal: Math.floor(general.refreshScoreTotal ?? 0),
                            },
                        })
                    ),
                ...cities.map((city) =>
                    prisma.city.update({
                        where: { id: city.id },
                        data: buildCityUpdate(city),
                    })
                ),
                ...nations
                    .filter((nation) => !createdNationIds.has(nation.id))
                    .map((nation) =>
                        prisma.nation.upsert({
                            where: { id: nation.id },
                            update: buildNationUpdate(nation),
                            create: {
                                id: nation.id,
                                ...buildNationUpdate(nation),
                            },
                        })
                    ),
                ...troops
                    .filter((troop) => !createdTroopIds.has(troop.id))
                    .map((troop) =>
                        prisma.troop.update({
                            where: { troopLeaderId: troop.id },
                            data: buildTroopUpdate(troop),
                        })
                    ),
                ...diplomacy
                    .filter((entry) => !createdDiplomacyKeys.has(`${entry.fromNationId}:${entry.toNationId}`))
                    .map((entry) =>
                        prisma.diplomacy.update({
                            where: {
                                srcNationId_destNationId: {
                                    srcNationId: entry.fromNationId,
                                    destNationId: entry.toNationId,
                                },
                            },
                            data: buildDiplomacyUpdate(entry),
                        })
                    ),
            ]);

            const rankTargets = generals.filter((general) => !createdIds.has(general.id));
            if (createdGenerals.length > 0 || rankTargets.length > 0) {
                const rankRows = [
                    ...createdGenerals.flatMap(buildInitialRankRows),
                    ...rankTargets.flatMap(buildPersistedRankRows),
                ];
                await upsertRankRows(prisma, rankRows);
            }

            if (pendingLogRows.length > 0) {
                await prisma.logEntry.createMany({
                    data: pendingLogRows,
                });
            }
            for (const snapshot of pendingYearbookSnapshots) {
                await persistYearbookSnapshot(prisma, snapshot);
            }
            const persistedMessageMailboxes: number[] = [];
            for (const finalization of pendingUnificationFinalizations) {
                if (options?.profileName && finalization.profileName !== options.profileName) {
                    throw new Error(
                        `Unification profile mismatch: pending=${finalization.profileName}, daemon=${options.profileName}.`
                    );
                }
                const result = await persistUnificationFinalization(prisma, finalization, world);
                persistedMessageMailboxes.push(...result.messageMailboxes);
            }
            for (const message of messages) {
                await sendMessage(
                    {
                        insertMessage: async (draft: MessageRecordDraft) => {
                            const toTickOrNull = (date: Date): bigint | null => {
                                try {
                                    return BigInt(world.dateToGameTick(date));
                                } catch {
                                    // Legacy messages may use year 9999 as an
                                    // effectively-unbounded expiry, beyond the
                                    // safe JavaScript tick range.
                                    return null;
                                }
                            };
                            const rows = await prisma.$queryRaw<Array<{ id: number }>>`
                                INSERT INTO message (
                                    mailbox, type, src, dest, time, time_tick, valid_until, valid_until_tick, message
                                )
                                VALUES (
                                    ${draft.mailbox},
                                    ${draft.msgType},
                                    ${draft.srcId},
                                    ${draft.destId},
                                    ${draft.time},
                                    ${toTickOrNull(draft.time)},
                                    ${draft.validUntil},
                                    ${toTickOrNull(draft.validUntil)},
                                    CAST(${JSON.stringify(draft.payload)} AS jsonb)
                                )
                                RETURNING id
                            `;
                            const id = rows[0]?.id;
                            if (!id) {
                                throw new Error('Failed to persist turn message.');
                            }
                            await enqueuePrivateMessageWebPush(prisma, draft, id);
                            persistedMessageMailboxes.push(draft.mailbox);
                            return id;
                        },
                    },
                    message,
                    { sendDestOnly: message.sendDestOnly }
                );
            }
            if (options?.reservedTurns && persistedReservedTurnChanges) {
                await options.reservedTurns.persistChanges(prisma, persistedReservedTurnChanges);
            }
            if (suspensionPreparation && unificationSuspensionId) {
                const cutTick = unificationCutTick!;
                await prisma.worldState.update({
                    where: { id: state.id },
                    data: {
                        clockTick: BigInt(cutTick),
                        clockWallAnchor: suspensionPreparation.cutWallAt,
                    },
                });
                await persistClockSuspensionLedgerUnderHeldLocks({
                    db: prisma,
                    suspensionId: unificationSuspensionId,
                    worldStateId: state.id,
                    profileName: options?.profileName ?? 'default',
                    source: 'UNIFICATION_WAIT',
                    cutTick,
                    cutWallAt: suspensionPreparation.cutWallAt,
                    rateTicksPerSecond: GAME_TICKS_PER_TURN / state.tickSeconds,
                    sourceRevision: state.clockRevision ?? 1,
                });
            }
            if (
                commandCompletion?.result.type === 'messageRespond' &&
                commandCompletion.result.ok &&
                commandCompletion.result.action === 'raiseInvader' &&
                unificationSuspensionId &&
                state.clockPhase === 'RECONCILING'
            ) {
                await refreshClockProjectionForFinalClockUnderHeldLocks({
                    db: prisma,
                    suspensionId: unificationSuspensionId,
                    clockBaseTime: state.clockBaseTime ?? state.lastTurnTime,
                    tickSeconds: state.tickSeconds,
                });
            }
            if (commandCompletion) {
                await prisma.inputEvent.update({
                    where: { requestId: commandCompletion.requestId },
                    data: {
                        status: 'SUCCEEDED',
                        result: asJson(commandCompletion.result),
                        completedAt: new Date(),
                        error: null,
                        lockedBy: null,
                        leaseUntil: null,
                    },
                });
            }
            persistedVisibleLogs = await prisma.logEntry.findMany({
                where: {
                    id: { gt: visibleLogFloor },
                    OR: [
                        {
                            scope: LogScope.GENERAL,
                            category: LogCategory.ACTION,
                        },
                        {
                            scope: LogScope.SYSTEM,
                            category: { in: [LogCategory.SUMMARY, LogCategory.ACTION, LogCategory.HISTORY] },
                        },
                    ],
                },
                orderBy: { id: 'asc' },
                select: { id: true, scope: true, category: true, generalId: true },
            });

            const worldReadModelSignature = createWorldReadModelSignature(world);
            const readModelChanges = mergePersistedVisibleLogChanges(
                summarizeRealtimeReadModelChanges(changes, persistedReservedTurnChanges, readModelBaseline),
                persistedVisibleLogs
            );
            if (worldReadModelSignature !== worldReadModelBaseline) {
                readModelChanges.worldChanged = true;
            }
            const journal = createReadModelChangeJournal(readModelChanges);
            if (hasDashboardSourceMutation(changes, readModelChanges)) {
                journal.mark('dashboard.global');
            }
            markIds(journal, 'messages.mailbox', uniqueSortedIds(persistedMessageMailboxes));
            markIds(journal, 'access.general', accessScoreResetGeneralIds);
            if (pendingNationBettingOpens.length > 0 || pendingNationBettingFinishes.length > 0) {
                journal.mark('betting');
            }
            const journalWrite = await writeReadModelChangeJournal(prisma, journal.snapshot());
            await enqueueWebPushOutboxEvents(prisma, webPushEvents);
            return { readModelChanges, journalWrite, worldReadModelSignature };
        };
        const persisted = transaction
            ? await persist(transaction)
            : await prisma.$transaction(persist, transactionOptions);
        return {
            acknowledge: () => {
                world.acknowledgeDirtyState(changes);
                if (options?.reservedTurns && reservedTurnChanges) {
                    options.reservedTurns.acknowledgeDirtyState(reservedTurnChanges);
                    options.reservedTurns.pruneDeletedEntityQueues(deletedGenerals, deletedNations);
                }
                applyRealtimeReadModelBaseline(readModelBaseline, changes);
                worldReadModelBaseline = persisted.worldReadModelSignature;
                persistedTickSeconds = state.tickSeconds;
                webPushTurnBaseline = nextWebPushTurnBaseline;
            },
            readModelChanges: persisted.readModelChanges,
            journalWrite: persisted.journalWrite,
        };
    };

    const hooks: TurnDaemonHooks = {
        flushChanges: async () => {
            const committed = await persistChanges();
            committed.acknowledge();
            enqueueCommittedReceipt(committed.readModelChanges, committed.journalWrite);
        },
        commitCommand: async (requestId, result) => {
            const committed = await persistChanges(undefined, { requestId, result });
            committed.acknowledge();
            enqueueCommittedReceipt(committed.readModelChanges, committed.journalWrite);
        },
        executeCommand: async (requestId, execute) => {
            const committed = await prisma.$transaction(async (transaction) => {
                await options?.turnDaemonLease?.assertActive(transaction);
                await acquireGameSchemaAdvisoryXactLock(transaction, CLOCK_OPERATION_PERSISTENCE_LOCK);
                await acquireGameSchemaAdvisoryXactLock(transaction, GENERAL_ACCESS_PERSISTENCE_LOCK);
                const leaseToken = options?.turnDaemonLease?.getToken();
                const directLogFloor =
                    (
                        await transaction.logEntry.findFirst({
                            orderBy: { id: 'desc' },
                            select: { id: true },
                        })
                    )?.id ?? 0;
                const result = await execute({
                    db: transaction,
                    ...(leaseToken
                        ? {
                              clockOperationAuthority: {
                                  kind: 'DAEMON' as const,
                                  profileName: leaseToken.profile,
                                  ownerId: leaseToken.ownerId,
                                  fencingEpoch: leaseToken.fencingEpoch,
                              },
                          }
                        : {}),
                });
                const persisted = await persistChanges(transaction, { requestId, result }, directLogFloor);
                return { result, persisted };
            }, transactionOptions);
            committed.persisted.acknowledge();
            enqueueCommittedReceipt(committed.persisted.readModelChanges, committed.persisted.journalWrite);
            return committed.result;
        },
    };

    return {
        hooks,
        takeCommittedReadModelChanges: () => {
            return takeCommittedReceipt()?.changes ?? null;
        },
        takeCommittedReadModelChangeReceipt: takeCommittedReceipt,
        applyClockProjection: async (redis, workerId) => {
            await applyNextClockProjection({ db: prisma, redis, workerId });
            const clock = await prisma.worldState.findFirst({
                orderBy: { id: 'asc' },
                select: { clockPhase: true },
            });
            return clock?.clockPhase === 'RUNNING' || clock?.clockPhase === 'MANUAL';
        },
        close: () => connector.disconnect(),
    };
};
