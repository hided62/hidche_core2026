import { asRecord } from '@sammo-ts/common';
import { createGamePostgresConnector, GamePrisma, type RedisConnector } from '@sammo-ts/infra';
import { buildNeutralResourceAuctionPlan } from '@sammo-ts/logic';

import type { TurnCalendarHandler } from '../turn/inMemoryWorld.js';
import type { InMemoryTurnWorld } from '../turn/inMemoryWorld.js';

interface NeutralAuctionCountRow {
    type: 'BUY_RICE' | 'SELL_RICE';
    count: bigint | number;
}

interface TournamentState {
    stage?: unknown;
}

const readFiniteNumber = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
};

const average = (values: number[]): number => {
    if (values.length === 0) {
        return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const parseTournamentState = (raw: string | null): TournamentState | null => {
    if (!raw) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        return asRecord(parsed);
    } catch {
        return null;
    }
};

const isTournamentActive = async (
    profileName: string,
    redis: RedisConnector['client'] | null | undefined
): Promise<boolean> => {
    if (!redis) {
        return false;
    }
    const state = parseTournamentState(await redis.get(`sammo:${profileName}:tournament:state`));
    return readFiniteNumber(state?.stage, 0) > 0;
};

export interface NeutralAuctionRegistrar {
    handler: TurnCalendarHandler;
    close(): Promise<void>;
}

export const createNeutralAuctionRegistrar = async (options: {
    databaseUrl: string;
    profileName: string;
    getWorld: () => InMemoryTurnWorld | null;
    getRedisClient: () => RedisConnector['client'] | null | undefined;
    getWorldConfig: () => Record<string, unknown> | null | undefined;
    now?: () => Date;
    loadNeutralAuctionCounts?: () => Promise<NeutralAuctionCountRow[]>;
    loadTournamentActive?: () => Promise<boolean>;
}): Promise<NeutralAuctionRegistrar> => {
    const connector = options.loadNeutralAuctionCounts
        ? null
        : createGamePostgresConnector({ url: options.databaseUrl });
    await connector?.connect();
    const loadNeutralAuctionCounts =
        options.loadNeutralAuctionCounts ??
        (() =>
            connector!.prisma.$queryRaw<NeutralAuctionCountRow[]>(
                GamePrisma.sql`
                    SELECT type, count(*) AS count
                    FROM auction
                    WHERE host_general_id = 0
                      AND type IN ('BUY_RICE'::"AuctionType", 'SELL_RICE'::"AuctionType")
                    GROUP BY type
                `
            ));

    const handler: TurnCalendarHandler = {
        onMonthChanged: async (context) => {
            const world = options.getWorld();
            if (!world) {
                return;
            }
            const state = world.getState();
            const hiddenSeed =
                typeof state.meta.hiddenSeed === 'string' || typeof state.meta.hiddenSeed === 'number'
                    ? state.meta.hiddenSeed
                    : state.id;
            const eligibleGenerals = world.listGenerals().filter((general) => general.npcState < 2);
            const counts = await loadNeutralAuctionCounts();
            const countByType = new Map(counts.map((row) => [row.type, Number(row.count)]));
            for (const pending of world.peekDirtyState().pendingNeutralAuctions) {
                countByType.set(pending.type, (countByType.get(pending.type) ?? 0) + 1);
            }
            const worldConfig = asRecord(options.getWorldConfig() ?? {});
            const consumeTournamentRoll =
                worldConfig.tournamentTrig === true &&
                !(await (options.loadTournamentActive
                    ? options.loadTournamentActive()
                    : isTournamentActive(options.profileName, options.getRedisClient())));
            const plans = buildNeutralResourceAuctionPlan({
                hiddenSeed,
                seedYear: context.previousYear,
                seedMonth: context.previousMonth,
                nationCount: world.listNations().length,
                consumeTournamentRoll,
                averageGold: average(eligibleGenerals.map((general) => general.gold)),
                averageRice: average(eligibleGenerals.map((general) => general.rice)),
                buyRiceAuctionCount: countByType.get('BUY_RICE') ?? 0,
                sellRiceAuctionCount: countByType.get('SELL_RICE') ?? 0,
            });

            const registrationKey = `${context.currentYear}-${String(context.currentMonth).padStart(2, '0')}`;
            world.updateWorldMeta({ neutralAuctionRegistrationKey: registrationKey });
            const turnMinutes = Math.max(1, Math.round(state.tickSeconds / 60));
            for (const plan of plans) {
                const openedAt = options.now?.() ?? new Date();
                const hostResourceName = plan.auctionType === 'BUY_RICE' ? '쌀' : '금';
                world.queueNeutralAuction({
                    registrationKey,
                    type: plan.auctionType,
                    targetCode: String(plan.amount),
                    hostGeneralId: 0,
                    hostName: '상인',
                    detail: {
                        title: `${hostResourceName} ${plan.amount} 경매`,
                        hostName: '상인',
                        amount: plan.amount,
                        isReverse: false,
                        startBidAmount: plan.startBidAmount,
                        finishBidAmount: plan.finishBidAmount,
                        neutralRegistrationKey: registrationKey,
                        seedYear: context.previousYear,
                        seedMonth: context.previousMonth,
                        closeTurnCnt: plan.closeTurnCnt,
                    },
                    closeAt: new Date(openedAt.getTime() + plan.closeTurnCnt * turnMinutes * 60_000),
                });
            }
        },
    };

    return {
        handler,
        close: async () => {
            await connector?.disconnect();
        },
    };
};
