import { asRecord } from '@sammo-ts/common';
import { createGamePostgresConnector, type GamePrisma, type InputJsonValue } from '@sammo-ts/infra';
import { LogCategory, LogScope } from '@sammo-ts/logic';

import { ALL_MERGED_INHERITANCE_KEYS, computeActiveInheritancePoint } from '../turn/inheritancePointCalculation.js';

export const GAME_CANCELLATION_HISTORY_MODES = ['RETAIN_ABANDONED', 'DELETE'] as const;
export const GAME_CANCELLATION_GENERAL_MODES = ['RETAIN', 'DELETE'] as const;

export type GameCancellationHistoryMode = (typeof GAME_CANCELLATION_HISTORY_MODES)[number];
export type GameCancellationGeneralMode = (typeof GAME_CANCELLATION_GENERAL_MODES)[number];

export interface GameCancellationRequest {
    cancellationId: string;
    databaseUrl: string;
    cancelledBy: string;
    reason: string;
    historyMode: GameCancellationHistoryMode;
    generalMode: GameCancellationGeneralMode;
    earnedPointRetentionPercent: number;
    cancelledAt?: Date;
}

export interface GameCancellationSettlementEntry {
    openingPoint: number;
    currentPoint: number;
    earnedPoint: number;
    retainedEarnedPoint: number;
    finalPoint: number;
    baselineSource: string;
}

export interface GameCancellationResult {
    cancellationId: string;
    serverId: string;
    originalSeason: number;
    participantCount: number;
    preservedGeneralCount: number;
    historyMode: GameCancellationHistoryMode;
    generalMode: GameCancellationGeneralMode;
    earnedPointRetentionPercent: number;
    alreadyApplied: boolean;
    settlements: Record<string, GameCancellationSettlementEntry>;
}

const asJson = (value: unknown): InputJsonValue => value as InputJsonValue;

const numberValue = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value.replaceAll(',', ''));
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
};

const integerValue = (value: unknown, fallback = 0): number => {
    const parsed = numberValue(value);
    return parsed === 0 && value === undefined ? fallback : Math.trunc(parsed);
};

const parseLoggedPoint = (text: string, pattern: RegExp): number => {
    const match = pattern.exec(text);
    return match ? numberValue(match[1]) : 0;
};

const sumSettlementEarned = (value: unknown): number => {
    const record = asRecord(value);
    return [
        'lived_month',
        'max_belong',
        'max_domestic_critical',
        'active_action',
        'combat',
        'sabotage',
        'dex',
        'unifier',
        'tournament',
        'betting',
    ].reduce((sum, key) => sum + numberValue(record[key]), 0);
};

export const calculateCancelledInheritancePoint = (input: {
    openingPoint: number;
    earnedPoint: number;
    earnedPointRetentionPercent: number;
}): { retainedEarnedPoint: number; finalPoint: number } => {
    if (
        !Number.isInteger(input.earnedPointRetentionPercent) ||
        input.earnedPointRetentionPercent < 0 ||
        input.earnedPointRetentionPercent > 100
    ) {
        throw new Error('Earned inheritance point retention percent must be an integer from 0 to 100.');
    }
    const retainedEarnedPoint = Math.floor((input.earnedPoint * input.earnedPointRetentionPercent) / 100);
    return {
        retainedEarnedPoint,
        finalPoint: Math.floor(input.openingPoint + retainedEarnedPoint),
    };
};

type ActiveGeneral = {
    id: number;
    userId: string | null;
    name: string;
    nationId: number;
    cityId: number;
    troopId: number;
    npcState: number;
    affinity: number | null;
    bornYear: number;
    deadYear: number;
    picture: string | null;
    imageServer: number;
    leadership: number;
    strength: number;
    intel: number;
    injury: number;
    experience: number;
    dedication: number;
    officerLevel: number;
    gold: number;
    rice: number;
    crew: number;
    crewTypeId: number;
    train: number;
    atmos: number;
    weaponCode: string;
    bookCode: string;
    horseCode: string;
    itemCode: string;
    turnTime: Date;
    recentWarTime: Date | null;
    age: number;
    startAge: number;
    personalCode: string;
    specialCode: string;
    special2Code: string;
    lastTurn: unknown;
    meta: unknown;
    penalty: unknown;
};

const buildActiveGeneralArchive = (
    general: ActiveGeneral,
    ranks: Record<string, number>,
    history: string[],
    battleResults: string[],
    cancellation: { id: string; at: Date; reason: string }
): InputJsonValue =>
    asJson({
        id: general.id,
        userId: general.userId,
        name: general.name,
        nationId: general.nationId,
        cityId: general.cityId,
        troopId: general.troopId,
        npcState: general.npcState,
        affinity: general.affinity,
        bornYear: general.bornYear,
        deadYear: general.deadYear,
        picture: general.picture,
        imageServer: general.imageServer,
        stats: {
            leadership: general.leadership,
            strength: general.strength,
            intelligence: general.intel,
        },
        experience: general.experience,
        dedication: general.dedication,
        officerLevel: general.officerLevel,
        injury: general.injury,
        gold: general.gold,
        rice: general.rice,
        crew: general.crew,
        crewTypeId: general.crewTypeId,
        train: general.train,
        atmos: general.atmos,
        turnTime: general.turnTime.toISOString(),
        recentWarTime: general.recentWarTime?.toISOString() ?? null,
        age: general.age,
        startAge: general.startAge,
        role: {
            personality: general.personalCode,
            specialDomestic: general.specialCode,
            specialWar: general.special2Code,
            items: {
                weapon: general.weaponCode === 'None' ? null : general.weaponCode,
                book: general.bookCode === 'None' ? null : general.bookCode,
                horse: general.horseCode === 'None' ? null : general.horseCode,
                item: general.itemCode === 'None' ? null : general.itemCode,
            },
        },
        lastTurn: general.lastTurn,
        meta: {
            ...asRecord(general.meta),
            ...Object.fromEntries(Object.entries(ranks).map(([key, value]) => [`rank_${key}`, value])),
        },
        penalty: general.penalty,
        history,
        records: { battleResult: battleResults },
        availability: { battleResultLogs: true },
        abandonedGame: {
            cancellationId: cancellation.id,
            cancelledAt: cancellation.at.toISOString(),
            reason: cancellation.reason,
        },
    });

const resultFromPersisted = (row: {
    id: string;
    serverId: string;
    originalSeason: number;
    participantCount: number;
    preservedGeneralCount: number;
    historyMode: GameCancellationHistoryMode;
    generalMode: GameCancellationGeneralMode;
    earnedPointRetentionPercent: number;
    settlement: unknown;
}): GameCancellationResult => ({
    cancellationId: row.id,
    serverId: row.serverId,
    originalSeason: row.originalSeason,
    participantCount: row.participantCount,
    preservedGeneralCount: row.preservedGeneralCount,
    historyMode: row.historyMode,
    generalMode: row.generalMode,
    earnedPointRetentionPercent: row.earnedPointRetentionPercent,
    alreadyApplied: true,
    settlements: asRecord(row.settlement) as Record<string, GameCancellationSettlementEntry>,
});

const cancelGameInTransaction = async (
    prisma: GamePrisma.TransactionClient,
    request: Omit<GameCancellationRequest, 'databaseUrl' | 'cancelledAt'> & { cancelledAt: Date }
): Promise<GameCancellationResult> => {
    await prisma.$queryRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended(current_schema(), 0))::text AS lock_result'
    );

    const existingById = await prisma.gameCancellation.findUnique({ where: { id: request.cancellationId } });
    if (existingById) return resultFromPersisted(existingById);

    const world = await prisma.worldState.findFirst();
    if (!world) {
        const latest = await prisma.gameCancellation.findFirst({ orderBy: { cancelledAt: 'desc' } });
        if (latest) return resultFromPersisted(latest);
        throw new Error('The profile has no active game to cancel.');
    }
    const worldMeta = asRecord(world.meta);
    const serverId = typeof worldMeta.serverId === 'string' ? worldMeta.serverId.trim() : '';
    if (!serverId) throw new Error('The active game has no canonical serverId.');

    const existingByServer = await prisma.gameCancellation.findUnique({ where: { serverId } });
    if (existingByServer) return resultFromPersisted(existingByServer);
    const isUnited = integerValue(worldMeta.isUnited ?? worldMeta.isunited);
    if (isUnited !== 0) throw new Error('A completed or finalizing game cannot be cancelled.');

    const game = await prisma.gameHistory.findUnique({ where: { serverId } });
    if (!game) throw new Error(`The active game history is missing: ${serverId}`);
    if (game.status !== 'OPEN') throw new Error(`Only an OPEN game can be cancelled: ${game.status}`);

    const [activeGenerals, oldGenerals, pointRows, baselineRows, resultRows, inheritanceLogs] = await Promise.all([
        prisma.general.findMany({ where: { userId: { not: null } } }),
        prisma.oldGeneral.findMany({ where: { serverId } }),
        prisma.inheritancePoint.findMany(),
        prisma.gameInheritanceBaseline.findMany({ where: { serverId } }),
        prisma.inheritanceResult.findMany({ where: { serverId } }),
        prisma.inheritanceLog.findMany({
            where: { createdAt: { gte: game.date, lte: request.cancelledAt } },
            orderBy: { id: 'asc' },
        }),
    ]);

    const activeIds = activeGenerals.map((general) => general.id);
    const [resolvedRankRows, resolvedRecordLogs] = await Promise.all([
        activeIds.length ? prisma.rankData.findMany({ where: { generalId: { in: activeIds } } }) : [],
        activeIds.length
            ? prisma.logEntry.findMany({
                  where: {
                      generalId: { in: activeIds },
                      scope: LogScope.GENERAL,
                      category: { in: [LogCategory.HISTORY, LogCategory.BATTLE_BRIEF] },
                  },
                  orderBy: { id: 'desc' },
              })
            : [],
    ]);
    const pointsByUser = new Map<string, Map<string, number>>();
    for (const row of pointRows) {
        const points = pointsByUser.get(row.userId) ?? new Map<string, number>();
        points.set(row.key, row.value);
        pointsByUser.set(row.userId, points);
    }
    const baselineByUser = new Map(baselineRows.map((row) => [row.userId, row]));
    const ranksByGeneral = new Map<number, Record<string, number>>();
    for (const row of resolvedRankRows) {
        const ranks = ranksByGeneral.get(row.generalId) ?? {};
        ranks[row.type] = row.value;
        ranksByGeneral.set(row.generalId, ranks);
    }
    const logsByGeneral = new Map<number, string[]>();
    const battleResultsByGeneral = new Map<number, string[]>();
    for (const row of resolvedRecordLogs) {
        if (row.generalId === null) continue;
        const target =
            row.category === LogCategory.HISTORY
                ? logsByGeneral
                : row.category === LogCategory.BATTLE_BRIEF
                  ? battleResultsByGeneral
                  : null;
        if (!target) continue;
        const logs = target.get(row.generalId) ?? [];
        logs.push(row.text);
        target.set(row.generalId, logs);
    }

    const participantUsers = new Set<string>();
    for (const general of activeGenerals) if (general.userId) participantUsers.add(general.userId);
    for (const general of oldGenerals) if (general.owner) participantUsers.add(general.owner);
    for (const result of resultRows) participantUsers.add(result.owner);
    for (const baseline of baselineRows) participantUsers.add(baseline.userId);

    const resultsByUser = new Map<string, typeof resultRows>();
    for (const result of resultRows) {
        const rows = resultsByUser.get(result.owner) ?? [];
        rows.push(result);
        resultsByUser.set(result.owner, rows);
    }
    const inheritanceLogsByUser = new Map<string, typeof inheritanceLogs>();
    for (const log of inheritanceLogs) {
        if (!participantUsers.has(log.userId)) continue;
        const rows = inheritanceLogsByUser.get(log.userId) ?? [];
        rows.push(log);
        inheritanceLogsByUser.set(log.userId, rows);
    }

    const trackedSpentByUser = new Map<string, number>();
    const trackedByGeneral = new Map<number, { userId: string; value: number }>();
    for (const general of oldGenerals) {
        if (!general.owner) continue;
        const value = numberValue(asRecord(asRecord(general.data).meta).inherit_spent_dyn);
        trackedByGeneral.set(general.generalNo, { userId: general.owner, value });
    }
    for (const general of activeGenerals) {
        if (!general.userId) continue;
        const value = Math.max(
            numberValue(asRecord(general.meta).inherit_spent_dyn),
            numberValue(ranksByGeneral.get(general.id)?.inherit_spent_dyn)
        );
        trackedByGeneral.set(general.id, { userId: general.userId, value });
    }
    for (const tracked of trackedByGeneral.values()) {
        trackedSpentByUser.set(tracked.userId, (trackedSpentByUser.get(tracked.userId) ?? 0) + tracked.value);
    }

    const activeEarnedByUser = new Map<string, number>();
    for (const general of activeGenerals) {
        if (!general.userId || general.npcState >= 2) continue;
        const points = pointsByUser.get(general.userId) ?? new Map<string, number>();
        const inheritancePoints = Object.fromEntries(points);
        const ranks = ranksByGeneral.get(general.id) ?? {};
        const meta = {
            ...asRecord(general.meta),
            ...Object.fromEntries(Object.entries(ranks).map(([k, v]) => [`rank_${k}`, v])),
        };
        const earned = ALL_MERGED_INHERITANCE_KEYS.reduce(
            (sum, key) => sum + computeActiveInheritancePoint({ meta, inheritancePoints }, key),
            0
        );
        activeEarnedByUser.set(general.userId, (activeEarnedByUser.get(general.userId) ?? 0) + earned);
    }

    const settlements: Record<string, GameCancellationSettlementEntry> = {};
    for (const userId of [...participantUsers].sort()) {
        const logs = inheritanceLogsByUser.get(userId) ?? [];
        const settledEarned = (resultsByUser.get(userId) ?? []).reduce(
            (sum, row) => sum + sumSettlementEarned(row.value),
            0
        );
        const settledRefund = (resultsByUser.get(userId) ?? []).reduce(
            (sum, row) => sum + numberValue(asRecord(row.value).refund),
            0
        );
        const actionEarned = logs.reduce(
            (sum, row) =>
                sum +
                parseLoggedPoint(row.text, /보상으로\s+([\d,.]+)\s*포인트 획득/) +
                parseLoggedPoint(row.text, /신규\/복귀 생성으로 포인트\s+([\d,.]+)\s*지급/),
            0
        );
        let baseline = baselineByUser.get(userId);
        if (!baseline) {
            const directSpent = logs.reduce((sum, row) => {
                const standard = parseLoggedPoint(row.text, /^([\d,.]+)\s+포인트로\s+/);
                const statBonus = parseLoggedPoint(row.text, /^([\d,.]+)로 .*보너스 능력치 적용/);
                return sum + standard + statBonus;
            }, 0);
            const currentPoint = pointsByUser.get(userId)?.get('previous') ?? 0;
            const openingPoint =
                currentPoint +
                (trackedSpentByUser.get(userId) ?? 0) +
                directSpent -
                settledRefund -
                settledEarned -
                actionEarned;
            if (!Number.isFinite(openingPoint) || openingPoint < 0) {
                throw new Error(`Cannot reconstruct a safe inheritance baseline for user ${userId}.`);
            }
            baseline = await prisma.gameInheritanceBaseline.create({
                data: {
                    serverId,
                    userId,
                    openingPoint,
                    source: 'RECONSTRUCTED',
                },
            });
            baselineByUser.set(userId, baseline);
        }
        const earnedPoint = settledEarned + actionEarned + (activeEarnedByUser.get(userId) ?? 0);
        const calculated = calculateCancelledInheritancePoint({
            openingPoint: baseline.openingPoint,
            earnedPoint,
            earnedPointRetentionPercent: request.earnedPointRetentionPercent,
        });
        const currentPoint = pointsByUser.get(userId)?.get('previous') ?? 0;
        await prisma.inheritancePoint.upsert({
            where: { userId_key: { userId, key: 'previous' } },
            update: { value: calculated.finalPoint },
            create: { userId, key: 'previous', value: calculated.finalPoint },
        });
        await prisma.inheritancePoint.deleteMany({ where: { userId, key: { not: 'previous' } } });
        await prisma.inheritanceLog.create({
            data: {
                userId,
                serverId,
                year: world.currentYear,
                month: world.currentMonth,
                text: `취소 게임 정산: 원금 ${Math.floor(baseline.openingPoint)}, 획득 ${Math.floor(earnedPoint)} 중 ${request.earnedPointRetentionPercent}% 보전, 최종 ${calculated.finalPoint} 포인트`,
            },
        });
        settlements[userId] = {
            openingPoint: baseline.openingPoint,
            currentPoint,
            earnedPoint,
            retainedEarnedPoint: calculated.retainedEarnedPoint,
            finalPoint: calculated.finalPoint,
            baselineSource: baseline.source,
        };
    }

    let preservedGeneralCount = 0;
    if (request.generalMode === 'RETAIN') {
        const abandonment = { id: request.cancellationId, at: request.cancelledAt, reason: request.reason };
        for (const row of oldGenerals) {
            const data = asRecord(row.data);
            await prisma.oldGeneral.update({
                where: { id: row.id },
                data: {
                    data: asJson({
                        ...data,
                        abandonedGame: {
                            cancellationId: abandonment.id,
                            cancelledAt: abandonment.at.toISOString(),
                            reason: abandonment.reason,
                        },
                    }),
                },
            });
        }
        for (const general of activeGenerals) {
            if (!general.userId || general.npcState >= 2) continue;
            await prisma.oldGeneral.upsert({
                where: { by_no: { serverId, generalNo: general.id } },
                update: {
                    owner: general.userId,
                    name: general.name,
                    lastYearMonth: world.currentYear * 100 + world.currentMonth,
                    turnTime: general.turnTime,
                    data: buildActiveGeneralArchive(
                        general as ActiveGeneral,
                        ranksByGeneral.get(general.id) ?? {},
                        logsByGeneral.get(general.id) ?? [],
                        battleResultsByGeneral.get(general.id) ?? [],
                        abandonment
                    ),
                },
                create: {
                    serverId,
                    generalNo: general.id,
                    owner: general.userId,
                    name: general.name,
                    lastYearMonth: world.currentYear * 100 + world.currentMonth,
                    turnTime: general.turnTime,
                    data: buildActiveGeneralArchive(
                        general as ActiveGeneral,
                        ranksByGeneral.get(general.id) ?? {},
                        logsByGeneral.get(general.id) ?? [],
                        battleResultsByGeneral.get(general.id) ?? [],
                        abandonment
                    ),
                },
            });
        }
        preservedGeneralCount = await prisma.oldGeneral.count({ where: { serverId, owner: { not: null } } });
    } else {
        await prisma.oldGeneral.deleteMany({ where: { serverId } });
    }

    await prisma.hallOfFame.deleteMany({ where: { serverId } });
    await prisma.oldNation.deleteMany({ where: { serverId } });
    await prisma.emperor.deleteMany({ where: { serverId } });
    await prisma.yearbookHistory.deleteMany({ where: { profileName: serverId } });
    await prisma.unificationFinalization.deleteMany({ where: { serverId } });
    await prisma.inheritanceResult.deleteMany({ where: { serverId } });

    if (request.historyMode === 'RETAIN_ABANDONED') {
        const env = asRecord(game.env);
        const envMeta = asRecord(env.meta);
        await prisma.gameHistory.update({
            where: { serverId },
            data: {
                winnerNation: null,
                status: 'ABANDONED',
                env: asJson({
                    ...env,
                    meta: {
                        ...envMeta,
                        cancellationId: request.cancellationId,
                        cancelledAt: request.cancelledAt.toISOString(),
                    },
                }),
            },
        });
    } else {
        await prisma.gameHistory.delete({ where: { serverId } });
    }

    await prisma.worldState.update({
        where: { id: world.id },
        data: {
            meta: asJson({
                ...worldMeta,
                isCancelled: 1,
                cancellationId: request.cancellationId,
                cancelledAt: request.cancelledAt.toISOString(),
            }),
        },
    });

    const created = await prisma.gameCancellation.create({
        data: {
            id: request.cancellationId,
            serverId,
            originalSeason: game.season,
            scenario: game.scenario,
            scenarioName: game.scenarioName,
            openedAt: game.date,
            cancelledAt: request.cancelledAt,
            cancelledBy: request.cancelledBy,
            reason: request.reason,
            historyMode: request.historyMode,
            generalMode: request.generalMode,
            earnedPointRetentionPercent: request.earnedPointRetentionPercent,
            participantCount: participantUsers.size,
            preservedGeneralCount,
            settlement: asJson(settlements),
        },
    });

    return { ...resultFromPersisted(created), alreadyApplied: false };
};

export const cancelGame = async (request: GameCancellationRequest): Promise<GameCancellationResult> => {
    if (!request.reason.trim()) throw new Error('Game cancellation reason is required.');
    if (!GAME_CANCELLATION_HISTORY_MODES.includes(request.historyMode)) throw new Error('Invalid history mode.');
    if (!GAME_CANCELLATION_GENERAL_MODES.includes(request.generalMode)) throw new Error('Invalid general mode.');
    calculateCancelledInheritancePoint({
        openingPoint: 0,
        earnedPoint: 0,
        earnedPointRetentionPercent: request.earnedPointRetentionPercent,
    });
    const connector = createGamePostgresConnector({ url: request.databaseUrl });
    await connector.connect();
    try {
        return await connector.prisma.$transaction(
            (prisma) =>
                cancelGameInTransaction(prisma, {
                    ...request,
                    reason: request.reason.trim(),
                    cancelledAt: request.cancelledAt ?? new Date(),
                }),
            { timeout: 60_000 }
        );
    } finally {
        await connector.disconnect();
    }
};
