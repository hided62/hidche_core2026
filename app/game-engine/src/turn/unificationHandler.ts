import { createGamePostgresConnector } from '@sammo-ts/infra';
import { asRecord, HALL_OF_FAME_TYPES, type HallOfFameType } from '@sammo-ts/common';
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

const readMetaNumberOrNull = (meta: Record<string, unknown>, key: string): number | null => {
    const value = meta[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.floor(value);
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return Math.floor(parsed);
        }
    }
    return null;
};

const computeHallRate = (numerator: number, denominator: number): number => {
    if (denominator <= 0) {
        return 0;
    }
    return numerator / denominator;
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

    const settleHallOfFame = async (winnerNationId: number): Promise<void> => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        await ready;
        const prisma = connector.prisma;
        const state = world.getState();
        const meta = asRecord(state.meta);

        const serverId =
            typeof meta.serverId === 'string' && meta.serverId.trim()
                ? meta.serverId.trim()
                : options.profileName;
        const season = readMetaNumberOrNull(meta, 'season') ?? 1;
        const scenario = readMetaNumberOrNull(meta, 'scenarioId') ?? 0;
        const scenarioName =
            typeof asRecord(meta.scenarioMeta).title === 'string'
                ? String(asRecord(meta.scenarioMeta).title)
                : '';
        const startTime = typeof meta.starttime === 'string' ? meta.starttime : null;
        const unitedTime = new Date().toISOString();

        const [serverCount, nationRows, generalRows, rankRows] = await Promise.all([
            prisma.gameHistory.count(),
            prisma.nation.findMany({ select: { id: true, name: true, color: true } }),
            prisma.general.findMany({
                where: { npcState: { lt: 2 } },
                select: {
                    id: true,
                    userId: true,
                    nationId: true,
                    name: true,
                    picture: true,
                    imageServer: true,
                    experience: true,
                    dedication: true,
                },
            }),
            prisma.rankData.findMany({
                where: { generalId: { gt: 0 } },
                select: { generalId: true, type: true, value: true },
            }),
        ]);

        const nationMap = new Map<number, { name: string; color: string }>();
        for (const nation of nationRows) {
            nationMap.set(nation.id, { name: nation.name, color: nation.color });
        }

        const rankMap = new Map<number, Record<string, number>>();
        for (const row of rankRows) {
            const entry = rankMap.get(row.generalId) ?? {};
            entry[row.type] = row.value;
            rankMap.set(row.generalId, entry);
        }

        const hallTypes: Array<[HallOfFameType, 'natural' | 'rank' | 'calc']> = HALL_OF_FAME_TYPES.map((type) => {
            if (type === 'experience' || type === 'dedication' || type.startsWith('dex')) {
                return [type, 'natural'];
            }
            if (type.endsWith('rate')) {
                return [type, 'calc'];
            }
            return [type, 'rank'];
        });

        for (const general of generalRows) {
            const ranks = rankMap.get(general.id) ?? {};
            const warnum = ranks.warnum ?? 0;
            const killnum = ranks.killnum ?? 0;
            const killcrew = ranks.killcrew ?? 0;
            const deathcrew = ranks.deathcrew ?? 0;
            const killcrewPerson = ranks.killcrew_person ?? 0;
            const deathcrewPerson = ranks.deathcrew_person ?? 0;
            const ttw = ranks.ttw ?? 0;
            const ttd = ranks.ttd ?? 0;
            const ttl = ranks.ttl ?? 0;
            const tlw = ranks.tlw ?? 0;
            const tld = ranks.tld ?? 0;
            const tll = ranks.tll ?? 0;
            const tsw = ranks.tsw ?? 0;
            const tsd = ranks.tsd ?? 0;
            const tsl = ranks.tsl ?? 0;
            const tiw = ranks.tiw ?? 0;
            const tid = ranks.tid ?? 0;
            const til = ranks.til ?? 0;
            const betGold = ranks.betgold ?? 0;
            const betWinGold = ranks.betwingold ?? 0;

            const ttTotal = ttw + ttd + ttl;
            const tlTotal = tlw + tld + tll;
            const tsTotal = tsw + tsd + tsl;
            const tiTotal = tiw + tid + til;

            const calcValues: Record<string, number> = {
                winrate: computeHallRate(killnum, warnum),
                killrate: computeHallRate(killcrew, Math.max(1, deathcrew)),
                killrate_person: computeHallRate(killcrewPerson, Math.max(1, deathcrewPerson)),
                ttrate: computeHallRate(ttw, Math.max(1, ttTotal)),
                tlrate: computeHallRate(tlw, Math.max(1, tlTotal)),
                tsrate: computeHallRate(tsw, Math.max(1, tsTotal)),
                tirate: computeHallRate(tiw, Math.max(1, tiTotal)),
                betrate: computeHallRate(betWinGold, Math.max(1, betGold)),
            };

            const nation = nationMap.get(general.nationId) ?? { name: '재야', color: '#000000' };
            const aux = {
                name: general.name,
                nationName: nation.name,
                bgColor: nation.color,
                fgColor: nation.color,
                picture: general.picture,
                imgsvr: general.imageServer,
                startTime,
                unitedTime,
                ownerName: general.userId ?? null,
                serverID: serverId,
                serverIdx: serverCount,
                serverName: options.profileName,
                scenarioName,
            };

            for (const [typeName, valueType] of hallTypes) {
                let value = 0;
                if (valueType === 'natural') {
                    value = typeName === 'experience' ? general.experience : typeName === 'dedication' ? general.dedication : ranks[typeName] ?? 0;
                } else if (valueType === 'rank') {
                    value = ranks[typeName] ?? 0;
                } else {
                    value = calcValues[typeName] ?? 0;
                }

                if ((typeName === 'winrate' || typeName === 'killrate') && warnum < 10) {
                    continue;
                }
                if (typeName === 'ttrate' && ttTotal < 50) {
                    continue;
                }
                if (typeName === 'tlrate' && tlTotal < 50) {
                    continue;
                }
                if (typeName === 'tsrate' && tsTotal < 50) {
                    continue;
                }
                if (typeName === 'tirate' && tiTotal < 50) {
                    continue;
                }
                if (typeName === 'betrate' && betGold < 1000) {
                    continue;
                }
                if (value <= 0) {
                    continue;
                }

                const existing = await prisma.hallOfFame.findUnique({
                    where: {
                        serverId_type_generalNo: {
                            serverId,
                            type: typeName,
                            generalNo: general.id,
                        },
                    },
                });
                if (!existing) {
                    await prisma.hallOfFame.create({
                        data: {
                            serverId,
                            season,
                            scenario,
                            generalNo: general.id,
                            type: typeName,
                            value,
                            owner: general.userId ?? null,
                            aux,
                        },
                    });
                    continue;
                }
                if (value > existing.value) {
                    await prisma.hallOfFame.update({
                        where: { id: existing.id },
                        data: { value, aux },
                    });
                }
            }
        }

        await prisma.gameHistory.update({
            where: { serverId },
            data: {
                winnerNation: winnerNationId,
                date: new Date(),
            },
        });
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
            void settleHallOfFame(winner.id);
        },
    };

    const close = async (): Promise<void> => {
        await ready;
        await connector.disconnect();
    };

    return { handler, close };
};
