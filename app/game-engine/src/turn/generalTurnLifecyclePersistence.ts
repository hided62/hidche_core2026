import { asRecord, HALL_OF_FAME_TYPES, resolveLegacyTextColor, type HallOfFameType } from '@sammo-ts/common';
import type { GamePrisma, InputJsonValue } from '@sammo-ts/infra';
import { LogCategory, LogScope } from '@sammo-ts/logic';

import type { GeneralLifecycleEvent } from './inMemoryWorld.js';

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

const computeDexPoint = (meta: Record<string, unknown>): number => {
    let total = 0;
    for (let dex = 1; dex <= 5; dex += 1) {
        total += readNumber(meta, `dex${dex}`);
    }
    return total * 0.001;
};

const settleInheritance = async (
    prisma: GamePrisma.TransactionClient,
    event: GeneralLifecycleEvent,
    worldMeta: Record<string, unknown>,
    isRebirth: boolean,
    configConst: Record<string, unknown>
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

    const [rows, rankRows] = await Promise.all([
        prisma.inheritancePoint.findMany({
            where: { userId },
            select: { key: true, value: true },
        }),
        prisma.rankData.findMany({
            where: { generalId: event.generalId },
            select: { type: true, value: true },
        }),
    ]);
    const points = new Map(rows.map((row) => [row.key, row.value]));
    const ranks = new Map(rankRows.map((row) => [row.type, row.value]));
    const rank = (key: string): number => ranks.get(key) ?? readNumber(meta, `rank_${key}`);
    const previous = points.get('previous') ?? 0;
    const randomUniqueRefund = meta.inheritRandomUnique
        ? readWorldNumber(configConst, 'inheritItemRandomPoint', 3000)
        : 0;
    const specificSpecialRefund = meta.inheritSpecificSpecialWar
        ? readWorldNumber(configConst, 'inheritSpecificSpecialPoint', 4000)
        : 0;
    const refund = randomUniqueRefund + specificSpecialRefund;
    const lived = readNumber(meta, 'inherit_lived_month');
    const maxBelong = readNumber(meta, 'inherit_max_belong') * 10;
    const maxDomestic = readNumber(meta, 'max_domestic_critical');
    const active = readNumber(meta, 'inherit_active_action') * 3;
    const combat = rank('warnum') * 5;
    const sabotage = (ranks.get('firenum') ?? readNumber(meta, 'firenum')) * 20;
    const dex = computeDexPoint(meta);
    const unifier = points.get('unifier') ?? 0;
    const earned = isRebirth
        ? lived + active + combat + sabotage + dex * 0.5
        : lived + maxBelong + maxDomestic + active + combat + sabotage + dex + unifier;
    const total = Math.trunc(previous + refund + earned);

    await prisma.inheritancePoint.upsert({
        where: { userId_key: { userId, key: 'previous' } },
        update: { value: total },
        create: { userId, key: 'previous', value: total },
    });
    await prisma.inheritancePoint.deleteMany({
        where: {
            userId,
            key: isRebirth ? { notIn: ['previous', 'unifier'] } : { not: 'previous' },
        },
    });
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
                lived_month: lived,
                max_belong: maxBelong,
                max_domestic_critical: maxDomestic,
                active_action: active,
                combat,
                sabotage,
                dex: isRebirth ? dex * 0.5 : dex,
                unifier: isRebirth ? 0 : unifier,
                rebirth: isRebirth,
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
    await prisma.inheritanceLog.create({
        data: {
            userId,
            year: event.year,
            month: event.month,
            text: `${isRebirth ? '은퇴' : '사망'} 정산: ${total.toLocaleString()} 포인트`,
        },
    });
};

const computeRate = (numerator: number, denominator: number): number => (denominator > 0 ? numerator / denominator : 0);

const settleHall = async (
    prisma: GamePrisma.TransactionClient,
    event: GeneralLifecycleEvent,
    worldMeta: Record<string, unknown>,
    gameNow: Date
): Promise<void> => {
    const isUnited = readWorldNumber(worldMeta, 'isUnited', readWorldNumber(worldMeta, 'isunited', 0));
    if (isUnited !== 0) {
        return;
    }
    const [ranks, nation, historyCount] = await Promise.all([
        prisma.rankData.findMany({
            where: { generalId: event.generalId },
            select: { type: true, value: true },
        }),
        event.before.nationId > 0
            ? prisma.nation.findUnique({
                  where: { id: event.before.nationId },
                  select: { name: true, color: true },
              })
            : null,
        prisma.gameHistory.count(),
    ]);
    const rank = new Map(ranks.map((row) => [row.type, row.value]));
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
        serverIdx: historyCount,
        scenarioName,
        serverName: typeof worldMeta.serverName === 'string' ? worldMeta.serverName : '',
    };

    for (const type of HALL_OF_FAME_TYPES) {
        let hallValue =
            type === 'experience'
                ? event.before.experience
                : type === 'dedication'
                  ? event.before.dedication
                  : type.endsWith('rate')
                    ? (calc[type] ?? 0)
                    : value(type);
        if ((type === 'winrate' || type === 'killrate') && warnum < 10) continue;
        if (type === 'ttrate' && tt < 50) continue;
        if (type === 'tlrate' && tl < 50) continue;
        if (type === 'tsrate' && ts < 50) continue;
        if (type === 'tirate' && ti < 50) continue;
        if (type === 'betrate' && value('betgold') < 1000) continue;
        if (!Number.isFinite(hallValue) || hallValue <= 0) continue;
        hallValue = Number(hallValue);

        const existing = await prisma.hallOfFame.findUnique({
            where: {
                serverId_type_generalNo: {
                    serverId,
                    type: type as HallOfFameType,
                    generalNo: event.generalId,
                },
            },
        });
        if (existing) {
            if (hallValue > existing.value) {
                await prisma.hallOfFame.update({
                    where: { id: existing.id },
                    data: { value: hallValue, aux: asJson(aux) },
                });
            }
            continue;
        }
        await prisma.hallOfFame.createMany({
            data: [
                {
                    serverId,
                    season,
                    scenario,
                    generalNo: event.generalId,
                    type,
                    value: hallValue,
                    owner: event.before.userId ?? null,
                    aux: asJson(aux),
                },
            ],
            skipDuplicates: true,
        });
    }
};

const archiveDeletedGeneral = async (
    prisma: GamePrisma.TransactionClient,
    event: GeneralLifecycleEvent,
    worldMeta: Record<string, unknown>
): Promise<void> => {
    const serverId =
        typeof worldMeta.serverId === 'string' && worldMeta.serverId.trim() ? worldMeta.serverId.trim() : 'default';
    const history = await prisma.logEntry.findMany({
        where: {
            generalId: event.generalId,
            scope: LogScope.GENERAL,
            category: LogCategory.HISTORY,
        },
        orderBy: { id: 'desc' },
        select: { text: true },
    });
    const archivedMeta = { ...asRecord(event.before.meta) };
    delete archivedMeta.inheritRandomUnique;
    delete archivedMeta.inheritSpecificSpecialWar;
    const data = {
        ...event.before,
        meta: archivedMeta,
        turnTime: event.before.turnTime.toISOString(),
        recentWarTime: event.before.recentWarTime?.toISOString() ?? null,
        history: history.map((entry) => entry.text),
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
    gameNow = new Date()
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
        if (event.outcome === 'deleted') {
            await archiveDeletedGeneral(prisma, event, worldMeta);
            await settleInheritance(prisma, event, worldMeta, false, configConst);
        }
        if (event.outcome === 'retired') {
            await settleHall(prisma, event, worldMeta, gameNow);
            await settleInheritance(prisma, event, worldMeta, true, configConst);
            await prisma.rankData.updateMany({
                where: { generalId: event.generalId },
                data: { value: 0 },
            });
        }
    }
};
