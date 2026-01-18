import { createGamePostgresConnector } from '@sammo-ts/infra';
import { asRecord } from '@sammo-ts/common';
import type { LogEntryDraft } from '@sammo-ts/logic';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic';

import type { TurnCalendarHandler } from './inMemoryWorld.js';
import type { InMemoryTurnWorld } from './inMemoryWorld.js';

const UNIFIER_POINT = 2000;

const readMetaNumber = (meta: Record<string, unknown>, key: string): number => {
    const value = meta[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 0;
    }
    return value;
};

const computeDexPoint = (meta: Record<string, unknown>): number => {
    let total = 0;
    for (const [key, value] of Object.entries(meta)) {
        if (!key.startsWith('dex')) {
            continue;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            total += value;
        }
    }
    return total * 0.001;
};

const buildUnificationLog = (nationName: string): LogEntryDraft => ({
    scope: LogScope.SYSTEM,
    category: LogCategory.HISTORY,
    format: LogFormat.YEAR_MONTH,
    text: `<C>●</><Y><b>【통일】</b></><D><b>${nationName}</b></>이 전토를 통일하였습니다.`,
    meta: {},
});

export const createUnificationHandler = (options: {
    databaseUrl: string;
    profileName: string;
    getWorld: () => InMemoryTurnWorld | null;
}): { handler: TurnCalendarHandler; close: () => Promise<void> } => {
    const connector = createGamePostgresConnector({ url: options.databaseUrl });
    const ready = connector.connect();

    const settleInheritance = async (winnerNationId: number, year: number, month: number): Promise<void> => {
        await ready;
        const prisma = connector.prisma;

        const generals = await prisma.general.findMany({
            where: {
                userId: { not: null },
                npcState: { lt: 2 },
            },
            select: {
                id: true,
                userId: true,
                nationId: true,
                officerLevel: true,
                meta: true,
            },
        });

        const userIds = Array.from(new Set(generals.map((general) => general.userId).filter(Boolean))) as string[];
        if (userIds.length === 0) {
            return;
        }

        const pointRows = await prisma.inheritancePoint.findMany({
            where: {
                userId: { in: userIds },
            },
            select: {
                userId: true,
                key: true,
                value: true,
            },
        });
        const pointMap = new Map<string, Map<string, number>>();
        for (const row of pointRows) {
            const bucket = pointMap.get(row.userId) ?? new Map();
            bucket.set(row.key, row.value);
            pointMap.set(row.userId, bucket);
        }

        for (const general of generals) {
            if (!general.userId) {
                continue;
            }
            const meta = asRecord(general.meta);
            const livedMonth = readMetaNumber(meta, 'inherit_lived_month');
            const maxDomestic = readMetaNumber(meta, 'max_domestic_critical');
            const activeAction = readMetaNumber(meta, 'inherit_active_action');
            const combat = readMetaNumber(meta, 'rank_warnum') * 5;
            const sabotage = readMetaNumber(meta, 'firenum') * 20;
            const dex = computeDexPoint(meta);

            const points = pointMap.get(general.userId) ?? new Map();
            const previous = points.get('previous') ?? 0;
            const unifier = points.get('unifier') ?? 0;
            const earned =
                livedMonth +
                maxDomestic +
                activeAction * 3 +
                combat +
                sabotage +
                dex +
                unifier +
                (general.nationId === winnerNationId && general.officerLevel > 4 ? UNIFIER_POINT : 0);

            const total = previous + earned;

            await prisma.inheritancePoint.upsert({
                where: {
                    userId_key: {
                        userId: general.userId,
                        key: 'previous',
                    },
                },
                update: { value: total },
                create: { userId: general.userId, key: 'previous', value: total },
            });

            await prisma.inheritancePoint.deleteMany({
                where: {
                    userId: general.userId,
                    key: { not: 'previous' },
                },
            });

            await prisma.inheritanceResult.create({
                data: {
                    serverId: options.profileName,
                    owner: general.userId,
                    generalId: general.id,
                    year,
                    month,
                    value: {
                        previous,
                        lived_month: livedMonth,
                        max_domestic_critical: maxDomestic,
                        active_action: activeAction,
                        combat,
                        sabotage,
                        dex,
                        unifier,
                        unifierAward: general.nationId === winnerNationId && general.officerLevel > 4 ? UNIFIER_POINT : 0,
                    },
                },
            });

            await prisma.inheritanceLog.create({
                data: {
                    userId: general.userId,
                    year,
                    month,
                    text: `천하 통일 정산: ${Math.floor(total).toLocaleString()} 포인트`,
                },
            });
        }
    };

    const handler: TurnCalendarHandler = {
        onMonthChanged: (context) => {
            const world = options.getWorld();
            if (!world) {
                return;
            }
            const state = world.getState();
            const meta = asRecord(state.meta);
            if (typeof meta.isUnited === 'number' && meta.isUnited !== 0) {
                return;
            }

            const activeNations = world.listNations().filter((nation) => nation.level > 0);
            if (activeNations.length !== 1) {
                return;
            }
            const winner = activeNations[0];
            const cities = world.listCities();
            const ownedCount = cities.filter((city) => city.nationId === winner.id).length;
            if (ownedCount !== cities.length) {
                return;
            }

            world.updateWorldMeta({ isUnited: 2 });
            world.pushLog(buildUnificationLog(winner.name));
            void settleInheritance(winner.id, context.currentYear, context.currentMonth);
        },
    };

    const close = async (): Promise<void> => {
        await ready;
        await connector.disconnect();
    };

    return { handler, close };
};
