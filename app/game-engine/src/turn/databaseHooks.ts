import {
    createGamePostgresConnector,
    GamePrisma,
    type InputJsonValue,
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
    type LogEntryDraft,
    type MessageRecordDraft,
} from '@sammo-ts/logic';
import { asRecord } from '@sammo-ts/common';

import type { TurnDaemonCommandResult, TurnDaemonHooks } from '../lifecycle/types.js';
import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { InMemoryReservedTurnStore, ReservedTurnChanges } from './reservedTurnStore.js';
import { buildDiplomacyMeta } from '@sammo-ts/logic';
import { ensureItemInventory, withSerializedItemInventory } from '@sammo-ts/logic/items/index.js';
import { persistGeneralLifecycleEvents } from './generalTurnLifecyclePersistence.js';
import type { DatabaseTurnDaemonLease } from '../lifecycle/databaseTurnDaemonLease.js';
import { calculateNationBettingRewards } from '../betting/nationBettingSettlement.js';
import type { NationBettingCandidate, PendingNationBettingFinish, PendingNationBettingOpen } from './types.js';
import { buildPersistedRankRows } from './rankData.js';
import { persistUnificationFinalization } from './unificationPersistence.js';
import { buildOldNationArchiveData } from './oldNationArchive.js';
import { persistYearbookSnapshot } from './yearbookPersistence.js';

export interface DatabaseTurnHooks {
    hooks: TurnDaemonHooks;
    close(): Promise<void>;
}

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

const buildInitialRankRows = (
    general: ReturnType<InMemoryTurnWorld['consumeDirtyState']>['generals'][number]
): Array<{ generalId: number; nationId: number; type: string; value: number }> =>
    buildPersistedRankRows(general).map((row) => ({
        ...row,
        nationId: 0,
        // Ref Join은 전체 rank_data를 0으로 만든 직후 장수 생성에 사용한
        // 유산 포인트만 inherit_spent_dyn에 반영한다.
        value: row.type === 'inherit_spent_dyn' ? row.value : 0,
    }));

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
    const meta = {
        ...(city.meta as Record<string, unknown>),
        state: city.state,
    };
    const trust = readMetaNumber(meta, 'trust');
    const trade = readMetaNumber(meta, 'trade');
    const region = readMetaNumber(meta, 'region');

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
        meta: asJson(meta),
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

    const persistChanges = async (
        transaction?: GamePrisma.TransactionClient,
        commandCompletion?: { requestId: string; result: TurnDaemonCommandResult }
    ): Promise<() => void> => {
        const state = world.getState();
        const changes = world.peekDirtyState();
        const {
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
            pendingNationBettingOpens,
            pendingNationBettingFinishes,
            pendingYearbookSnapshots,
            pendingUnificationFinalizations,
        } = changes;
        const reservedTurnChanges = options?.reservedTurns?.peekDirtyState();
        const persistedReservedTurnChanges = reservedTurnChanges
            ? excludeDeletedReservedTurnQueues(reservedTurnChanges, deletedGenerals, deletedNations)
            : undefined;

        const worldStateUpdate: TurnEngineWorldStateUpdateInput = {
            currentYear: state.currentYear,
            currentMonth: state.currentMonth,
            tickSeconds: state.tickSeconds,
            clockBaseTime: state.clockBaseTime ?? state.lastTurnTime,
            clockTick: BigInt(state.clockTick ?? 0),
            clockMode: state.clockMode ?? 'manual',
            clockWallAnchor: state.clockWallAnchor ?? state.lastTurnTime,
            lastTurnTick: BigInt(state.lastTurnTick ?? world.dateToGameTick(state.lastTurnTime)),
            meta: asJson(state.meta),
        };
        const persist = async (prisma: GamePrisma.TransactionClient): Promise<void> => {
            // Lock and validate the fencing row in the same transaction as every
            // world mutation. A stale daemon can finish calculating, but it can
            // never commit after another owner has advanced the epoch.
            await options?.turnDaemonLease?.assertActive(prisma);
            let neutralAuctionsToCreate = pendingNeutralAuctions;
            if (pendingNeutralAuctions.length > 0) {
                const latestRegistrationKey =
                    pendingNeutralAuctions[pendingNeutralAuctions.length - 1]!.registrationKey;
                await prisma.$executeRaw`
                    SELECT pg_advisory_xact_lock(
                        hashtext(${'neutral-auction-registration'}),
                        ${state.id}
                    )
                `;
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

            for (const betting of pendingNationBettingOpens) {
                await persistNationBettingOpen(prisma, betting);
            }
            for (const finish of pendingNationBettingFinishes) {
                await persistNationBettingFinish(prisma, finish);
            }

            const meta = asRecord(state.meta);
            const serverId =
                typeof meta.serverId === 'string' && meta.serverId.trim() ? meta.serverId.trim() : 'default';
            await persistGeneralLifecycleEvents(
                prisma,
                lifecycleEvents,
                meta,
                asRecord(world.getScenarioConfig().const),
                world.gameTickToDate(state.clockTick ?? state.lastTurnTick ?? 0)
            );

            if (inheritancePointAdjustments.length > 0) {
                const grouped = new Map<string, { userId: string; key: string; amount: number }>();
                for (const entry of inheritancePointAdjustments) {
                    const groupKey = `${entry.userId}\u0000${entry.key}`;
                    const current = grouped.get(groupKey);
                    if (current) {
                        current.amount += entry.amount;
                    } else {
                        grouped.set(groupKey, { ...entry });
                    }
                }
                for (const entry of grouped.values()) {
                    await prisma.inheritancePoint.upsert({
                        where: { userId_key: { userId: entry.userId, key: entry.key } },
                        update: { value: { increment: entry.amount } },
                        create: { userId: entry.userId, key: entry.key, value: entry.amount },
                    });
                }
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

            if (logs.length > 0) {
                const logContext = {
                    year: state.currentYear,
                    month: state.currentMonth,
                    at: state.lastTurnTime,
                };
                const payload = logs
                    .map((entry) => buildLogCreateData(entry, logContext))
                    .filter((entry): entry is TurnEngineLogEntryCreateManyInput => Boolean(entry));
                if (payload.length > 0) {
                    await prisma.logEntry.createMany({
                        data: payload,
                    });
                }
            }
            for (const snapshot of pendingYearbookSnapshots) {
                await persistYearbookSnapshot(prisma, snapshot);
            }
            for (const finalization of pendingUnificationFinalizations) {
                if (options?.profileName && finalization.profileName !== options.profileName) {
                    throw new Error(
                        `Unification profile mismatch: pending=${finalization.profileName}, daemon=${options.profileName}.`
                    );
                }
                await persistUnificationFinalization(prisma, finalization, world);
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
                            return id;
                        },
                    },
                    message
                );
            }
            if (options?.reservedTurns && persistedReservedTurnChanges) {
                await options.reservedTurns.persistChanges(prisma, persistedReservedTurnChanges);
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
        };
        if (transaction) {
            await persist(transaction);
        } else {
            await prisma.$transaction(
                persist,
                options?.transactionTimeoutMs ? { timeout: options.transactionTimeoutMs } : undefined
            );
        }

        return () => {
            world.acknowledgeDirtyState(changes);
            if (options?.reservedTurns && reservedTurnChanges) {
                options.reservedTurns.acknowledgeDirtyState(reservedTurnChanges);
            }
        };
    };

    const hooks: TurnDaemonHooks = {
        flushChanges: async () => {
            const acknowledge = await persistChanges();
            acknowledge();
        },
        commitCommand: async (requestId, result) => {
            const acknowledge = await persistChanges(undefined, { requestId, result });
            acknowledge();
        },
        executeCommand: async (requestId, execute) => {
            const committed = await prisma.$transaction(
                async (transaction) => {
                    const result = await execute({ db: transaction });
                    const acknowledge = await persistChanges(transaction, { requestId, result });
                    return { result, acknowledge };
                },
                options?.transactionTimeoutMs ? { timeout: options.transactionTimeoutMs } : undefined
            );
            committed.acknowledge();
            return committed.result;
        },
    };

    return {
        hooks,
        close: () => connector.disconnect(),
    };
};
