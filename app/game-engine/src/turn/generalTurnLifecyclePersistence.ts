import {
    asRecord,
    HALL_OF_FAME_TYPES,
    RANK_DATA_TYPES,
    rankDataMetaKey,
    resolveLegacyTextColor,
    type HallOfFameType,
} from '@sammo-ts/common';
import type { GamePrisma, InputJsonValue } from '@sammo-ts/infra';
import { LogCategory, LogScope } from '@sammo-ts/logic';
import { computeInheritanceSettlementBreakdown } from '@sammo-ts/logic/inheritance/pointCalculation.js';
import {
    readCentennialRecordableDexterity,
    type CentennialDexKey,
} from '@sammo-ts/logic/scenario/centennialAllStar.js';

import type { GeneralLifecycleEvent } from './inMemoryWorld.js';
import { persistHallOfFameCandidate, resolveOfficialGameIndex } from './hallOfFamePersistence.js';
import { buildInheritanceSettlementLogTexts } from './inheritanceSettlementLogs.js';
import { buildPersistedRankRows } from './rankData.js';

const asJson = (value: unknown): InputJsonValue => value as InputJsonValue;

const readNumber = (record: Record<string, unknown>, key: string): number => {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
};

const readWorldNumber = (record: Record<string, unknown>, key: string, fallback: number): number => {
    const value = readNumber(record, key);
    return value === 0 && record[key] === undefined ? fallback : Math.floor(value);
};

type LifecycleRankValues = Map<string, number>;

export interface GeneralLifecycleArchiveLog {
    generalId: number;
    category: string;
    text: string;
}

const loadLifecycleRankValues = async (
    prisma: GamePrisma.TransactionClient,
    event: GeneralLifecycleEvent
): Promise<LifecycleRankValues> => {
    const persisted = await prisma.rankData.findMany({
        where: { generalId: event.generalId },
        select: { type: true, value: true },
    });
    const values = new Map(persisted.map((row) => [row.type, row.value]));
    const snapshotMeta = asRecord(event.before.meta);
    for (const row of buildPersistedRankRows(event.before)) {
        if (
            row.type === 'experience' ||
            row.type === 'dedication' ||
            Object.prototype.hasOwnProperty.call(snapshotMeta, rankDataMetaKey(row.type))
        ) {
            values.set(row.type, row.value);
        }
    }
    return values;
};

const persistPostRetirementRankValues = async (
    prisma: GamePrisma.TransactionClient,
    event: GeneralLifecycleEvent
): Promise<void> => {
    if (!event.after) {
        return;
    }
    for (const row of buildPersistedRankRows(event.after)) {
        await prisma.rankData.upsert({
            where: { generalId_type: { generalId: row.generalId, type: row.type } },
            update: { nationId: row.nationId, value: row.value },
            create: row,
        });
    }
};

const settleInheritance = async (
    prisma: GamePrisma.TransactionClient,
    event: GeneralLifecycleEvent,
    worldMeta: Record<string, unknown>,
    isRebirth: boolean,
    configConst: Record<string, unknown>,
    rankValues: ReadonlyMap<string, number>
): Promise<void> => {
    const userId = event.before.userId;
    if (!userId || event.before.npcState >= 2 || (isRebirth && event.before.npcState === 1)) {
        return;
    }
    const meta = asRecord(event.before.meta);
    if (event.before.npcState === 1) {
        const pickYearMonth = readNumber(meta, 'pickYearMonth');
        if (pickYearMonth === 0 && meta.pickYearMonth === undefined) {
            return;
        }
        const pickYear = Math.floor(pickYearMonth / 12);
        const scenarioMeta = asRecord(worldMeta.scenarioMeta);
        const startYear = readWorldNumber(
            worldMeta,
            'startYear',
            readWorldNumber(worldMeta, 'startyear', readWorldNumber(scenarioMeta, 'startYear', event.year))
        );
        if ((event.year - pickYear) * 2 <= event.year - startYear) {
            return;
        }
    }

    const rows = await prisma.inheritancePoint.findMany({
        where: { userId },
        select: { key: true, value: true },
    });
    const points = new Map(rows.map((row) => [row.key, row.value]));
    const previous = points.get('previous') ?? 0;
    const randomUniqueRefund =
        !isRebirth && meta.inheritRandomUnique ? readWorldNumber(configConst, 'inheritItemRandomPoint', 3000) : 0;
    const specificSpecialRefund =
        !isRebirth && meta.inheritSpecificSpecialWar
            ? readWorldNumber(configConst, 'inheritSpecificSpecialPoint', 4000)
            : 0;
    const refund = randomUniqueRefund + specificSpecialRefund;
    const calculationMeta = {
        ...Object.fromEntries(rankValues),
        ...Object.fromEntries(RANK_DATA_TYPES.map((type) => [rankDataMetaKey(type), rankValues.get(type) ?? 0])),
        ...meta,
    };
    const settlement = computeInheritanceSettlementBreakdown(
        {
            meta: calculationMeta,
            inheritancePoints: Object.fromEntries(points),
        },
        isRebirth
    );
    const total = Math.trunc(previous + refund + settlement.totalEarned);

    await prisma.inheritancePoint.upsert({
        where: { userId_key: { userId, key: 'previous' } },
        update: { value: total },
        create: { userId, key: 'previous', value: total },
    });
    if (isRebirth) {
        const retainedEntries = Object.entries(settlement.retained).filter(
            ([key, value]) => key === 'max_belong' || points.has(key) || value !== 0
        );
        for (const [key, value] of retainedEntries) {
            await prisma.inheritancePoint.upsert({
                where: { userId_key: { userId, key } },
                update: { value },
                create: { userId, key, value },
            });
        }
        await prisma.inheritancePoint.deleteMany({
            where: {
                userId,
                key: { notIn: ['previous', ...retainedEntries.map(([key]) => key)] },
            },
        });
    } else {
        await prisma.inheritancePoint.deleteMany({ where: { userId, key: { not: 'previous' } } });
    }
    const serverId =
        typeof worldMeta.serverId === 'string' && worldMeta.serverId.trim() ? worldMeta.serverId.trim() : 'default';
    await prisma.inheritanceResult.create({
        data: {
            serverId,
            owner: userId,
            generalId: event.generalId,
            year: event.year,
            month: event.month,
            value: asJson({
                previous,
                refund,
                ...settlement.earned,
                ...(isRebirth ? { retained: settlement.retained } : {}),
                rebirth: isRebirth,
                total,
            }),
        },
    });
    for (const text of [
        ...(randomUniqueRefund > 0 ? [`사망으로 랜덤 유니크 구입 ${randomUniqueRefund} 포인트 반환`] : []),
        ...(specificSpecialRefund > 0 ? [`사망으로 전투 특기 지정 ${specificSpecialRefund} 포인트 반환`] : []),
    ]) {
        await prisma.inheritanceLog.create({
            data: {
                userId,
                year: event.year,
                month: event.month,
                text,
            },
        });
    }
    for (const text of buildInheritanceSettlementLogTexts({
        previous: previous + refund,
        points: settlement.earned,
        storedKeys: new Set([...points.keys(), ...(refund > 0 ? (['previous'] as const) : [])]),
        total,
        isRebirth,
    })) {
        await prisma.inheritanceLog.create({
            data: {
                userId,
                year: event.year,
                month: event.month,
                text,
            },
        });
    }
};

const computeRate = (numerator: number, denominator: number): number => (denominator > 0 ? numerator / denominator : 0);

const settleHall = async (
    prisma: GamePrisma.TransactionClient,
    event: GeneralLifecycleEvent,
    worldMeta: Record<string, unknown>,
    gameNow: Date,
    rank: ReadonlyMap<string, number>
): Promise<void> => {
    const isUnited =
        event.isUnitedAtEvent ?? readWorldNumber(worldMeta, 'isUnited', readWorldNumber(worldMeta, 'isunited', 0));
    if (isUnited !== 0) {
        return;
    }
    const [nation, serverIdx] = await Promise.all([
        event.before.nationId > 0
            ? prisma.nation.findUnique({
                  where: { id: event.before.nationId },
                  select: { name: true, color: true },
              })
            : null,
        resolveOfficialGameIndex(prisma, worldMeta),
    ]);
    const value = (key: string): number => rank.get(key) ?? readNumber(asRecord(event.before.meta), key);
    const warnum = value('warnum');
    const tt = value('ttw') + value('ttd') + value('ttl');
    const tl = value('tlw') + value('tld') + value('tll');
    const ts = value('tsw') + value('tsd') + value('tsl');
    const ti = value('tiw') + value('tid') + value('til');
    const calc: Record<string, number> = {
        winrate: computeRate(value('killnum'), warnum),
        killrate: computeRate(value('killcrew'), Math.max(1, value('deathcrew'))),
        killrate_person: computeRate(value('killcrew_person'), Math.max(1, value('deathcrew_person'))),
        ttrate: computeRate(value('ttw'), Math.max(1, tt)),
        tlrate: computeRate(value('tlw'), Math.max(1, tl)),
        tsrate: computeRate(value('tsw'), Math.max(1, ts)),
        tirate: computeRate(value('tiw'), Math.max(1, ti)),
        betrate: computeRate(value('betwingold'), Math.max(1, value('betgold'))),
    };
    const serverId =
        typeof worldMeta.serverId === 'string' && worldMeta.serverId.trim() ? worldMeta.serverId.trim() : 'default';
    const season = readWorldNumber(worldMeta, 'season', 1);
    const scenario = readWorldNumber(worldMeta, 'scenarioId', 0);
    const scenarioName =
        typeof asRecord(worldMeta.scenarioMeta).title === 'string'
            ? String(asRecord(worldMeta.scenarioMeta).title)
            : '';
    const aux = {
        name: event.before.name,
        nationName: nation?.name ?? '재야',
        bgColor: nation?.color ?? '#000000',
        fgColor: resolveLegacyTextColor(nation?.color ?? '#000000'),
        startTime: typeof worldMeta.starttime === 'string' ? worldMeta.starttime : null,
        unitedTime: gameNow.toISOString(),
        ownerDisplayName:
            typeof asRecord(event.before.meta).ownerDisplayName === 'string'
                ? asRecord(event.before.meta).ownerDisplayName
                : typeof asRecord(event.before.meta).owner_name === 'string'
                  ? asRecord(event.before.meta).owner_name
                  : typeof asRecord(event.before.meta).ownerName === 'string'
                    ? asRecord(event.before.meta).ownerName
                    : null,
        picture: event.before.picture ?? null,
        imgsvr: event.before.imageServer ?? 0,
        serverID: serverId,
        serverIdx,
        scenarioName,
        serverName: typeof worldMeta.serverName === 'string' ? worldMeta.serverName : '',
    };

    for (const type of HALL_OF_FAME_TYPES) {
        const eventMeta = asRecord(event.before.meta);
        let hallValue =
            type === 'experience'
                ? event.before.experience
                : type === 'dedication'
                  ? event.before.dedication
                  : type.endsWith('rate')
                    ? (calc[type] ?? 0)
                    : type.startsWith('dex')
                      ? readCentennialRecordableDexterity(eventMeta, type as CentennialDexKey)
                      : value(type);
        if ((type === 'winrate' || type === 'killrate') && warnum < 10) continue;
        if (type === 'ttrate' && tt < 50) continue;
        if (type === 'tlrate' && tl < 50) continue;
        if (type === 'tsrate' && ts < 50) continue;
        if (type === 'tirate' && ti < 50) continue;
        if (type === 'betrate' && value('betgold') < 1000) continue;
        if (!Number.isFinite(hallValue) || hallValue <= 0) continue;
        hallValue = Number(hallValue);

        await persistHallOfFameCandidate(prisma, {
            serverId,
            season,
            scenario,
            generalNo: event.generalId,
            type: type as HallOfFameType,
            value: hallValue,
            owner: event.before.userId ?? null,
            aux,
        });
    }
};

const archiveGeneral = async (
    prisma: GamePrisma.TransactionClient,
    event: GeneralLifecycleEvent,
    worldMeta: Record<string, unknown>,
    rankValues: ReadonlyMap<string, number>,
    pendingArchiveLogs: readonly GeneralLifecycleArchiveLog[]
): Promise<void> => {
    const serverId =
        typeof worldMeta.serverId === 'string' && worldMeta.serverId.trim() ? worldMeta.serverId.trim() : 'default';
    const recordRows = await prisma.logEntry.findMany({
        where: {
            generalId: event.generalId,
            scope: LogScope.GENERAL,
            category: { in: [LogCategory.HISTORY, LogCategory.BATTLE_BRIEF] },
        },
        orderBy: { id: 'desc' },
        select: { category: true, text: true },
    });
    const archivedMeta = {
        ...asRecord(event.before.meta),
        ...Object.fromEntries(RANK_DATA_TYPES.map((type) => [rankDataMetaKey(type), rankValues.get(type) ?? 0])),
    };
    const pendingGeneralLogs = pendingArchiveLogs.filter((row) => row.generalId === event.generalId);
    const history = [
        ...pendingGeneralLogs
            .filter((row) => row.category === LogCategory.HISTORY)
            .map((row) => row.text)
            .reverse(),
        ...recordRows.filter((row) => row.category === LogCategory.HISTORY).map((row) => row.text),
    ];
    const battleResults = [
        ...pendingGeneralLogs
            .filter((row) => row.category === LogCategory.BATTLE_BRIEF)
            .map((row) => row.text)
            .reverse(),
        ...recordRows.filter((row) => row.category === LogCategory.BATTLE_BRIEF).map((row) => row.text),
    ];
    const data = {
        ...event.before,
        meta: archivedMeta,
        turnTime: event.before.turnTime.toISOString(),
        recentWarTime: event.before.recentWarTime?.toISOString() ?? null,
        history,
        records: { battleResult: battleResults },
        availability: { battleResultLogs: true },
    };
    await prisma.oldGeneral.upsert({
        where: { by_no: { serverId, generalNo: event.generalId } },
        update: {
            owner: event.before.userId ?? null,
            name: event.before.name,
            lastYearMonth: event.year * 100 + event.month,
            turnTime: event.before.turnTime,
            data: asJson(data),
        },
        create: {
            serverId,
            generalNo: event.generalId,
            owner: event.before.userId ?? null,
            name: event.before.name,
            lastYearMonth: event.year * 100 + event.month,
            turnTime: event.before.turnTime,
            data: asJson(data),
        },
    });
};

export const persistGeneralLifecycleEvents = async (
    prisma: GamePrisma.TransactionClient,
    events: GeneralLifecycleEvent[],
    worldMeta: Record<string, unknown>,
    configConst: Record<string, unknown>,
    gameNow = new Date(),
    pendingArchiveLogs: readonly GeneralLifecycleArchiveLog[] = []
): Promise<void> => {
    if (events.length === 0) {
        return;
    }
    await prisma.generalAccessLog.updateMany({
        where: { generalId: { in: events.map((event) => event.generalId) } },
        data: { refreshScore: 0 },
    });

    for (const event of events) {
        if (event.outcome === 'detached' || event.outcome === 'deleted') {
            await prisma.generalAccessLog.deleteMany({ where: { generalId: event.generalId } });
        }
        if (event.outcome !== 'deleted' && event.outcome !== 'retired') {
            continue;
        }
        const rankValues = await loadLifecycleRankValues(prisma, event);
        if (event.outcome === 'deleted') {
            await settleInheritance(prisma, event, worldMeta, false, configConst, rankValues);
            await archiveGeneral(prisma, event, worldMeta, rankValues, pendingArchiveLogs);
        }
        if (event.outcome === 'retired') {
            await settleHall(prisma, event, worldMeta, gameNow, rankValues);
            await settleInheritance(prisma, event, worldMeta, true, configConst, rankValues);
            await persistPostRetirementRankValues(prisma, event);
        }
    }
};
