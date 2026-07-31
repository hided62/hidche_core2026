import { asRecord, HALL_OF_FAME_TYPES, resolveLegacyTextColor, type HallOfFameType } from '@sammo-ts/common';
import type { GamePrisma, InputJsonValue } from '@sammo-ts/infra';
import { LogCategory, LogScope } from '@sammo-ts/logic';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';

const UNIFIER_POINT = 2000;
const asJson = (value: unknown): InputJsonValue => value as InputJsonValue;

export interface UnificationFinalizationInput {
    readonly generationKey: string;
    readonly serverId: string;
    readonly profileName: string;
    readonly winnerNationId: number;
    readonly year: number;
    readonly month: number;
    readonly completedAt: Date;
}

export interface UnificationFinalizationResult {
    status: 'APPLIED' | 'ALREADY_APPLIED';
    generationKey: string;
}

const readNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

const readInteger = (value: unknown, fallback = 0): number => {
    const parsed = typeof value === 'string' ? Number(value) : value;
    return typeof parsed === 'number' && Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};

const computeRate = (numerator: number, denominator: number): number => (denominator > 0 ? numerator / denominator : 0);

const ownerDisplayName = (meta: Record<string, unknown>): string | null => {
    for (const key of ['ownerDisplayName', 'owner_name', 'ownerName']) {
        const value = meta[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return null;
};

const formatHistogram = (value: unknown): string =>
    Object.entries(asRecord(value))
        .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, count]) => `${key}(${count})`)
        .join(', ');

const claimGeneration = async (
    transaction: GamePrisma.TransactionClient,
    input: UnificationFinalizationInput
): Promise<'CLAIMED' | 'ALREADY_APPLIED'> => {
    await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(
            hashtext(${'unification-finalization'}),
            hashtext(${input.generationKey})
        )
    `;
    const existing = await transaction.unificationFinalization.findUnique({
        where: { generationKey: input.generationKey },
    });
    if (existing) {
        const matches =
            existing.serverId === input.serverId &&
            existing.profileName === input.profileName &&
            existing.winnerNation === input.winnerNationId &&
            existing.year === input.year &&
            existing.month === input.month &&
            existing.completedAt.getTime() === input.completedAt.getTime();
        if (!matches) {
            throw new Error(`Unification generation payload mismatch: ${input.generationKey}.`);
        }
        return 'ALREADY_APPLIED';
    }
    await transaction.unificationFinalization.create({
        data: {
            generationKey: input.generationKey,
            serverId: input.serverId,
            profileName: input.profileName,
            winnerNation: input.winnerNationId,
            year: input.year,
            month: input.month,
            completedAt: input.completedAt,
        },
    });
    return 'CLAIMED';
};

export const persistUnificationFinalization = async (
    transaction: GamePrisma.TransactionClient,
    input: UnificationFinalizationInput,
    world: InMemoryTurnWorld
): Promise<UnificationFinalizationResult> => {
    if (!input.generationKey.trim()) {
        throw new Error('Unification finalization requires a non-empty generationKey.');
    }
    const claim = await claimGeneration(transaction, input);
    if (claim === 'ALREADY_APPLIED') {
        return { status: 'ALREADY_APPLIED', generationKey: input.generationKey };
    }

    const state = world.getState();
    if (state.currentYear !== input.year || state.currentMonth !== input.month) {
        throw new Error(
            `Unification snapshot date mismatch: input=${input.year}-${input.month}, world=${state.currentYear}-${state.currentMonth}.`
        );
    }

    const winner = world.getNationById(input.winnerNationId);
    if (!winner) {
        throw new Error(`Unification winner nation does not exist: ${input.winnerNationId}.`);
    }

    const meta = asRecord(state.meta);
    const snapshotServerId =
        typeof meta.serverId === 'string' && meta.serverId.trim() ? meta.serverId.trim() : input.profileName;
    if (snapshotServerId !== input.serverId) {
        throw new Error(`Unification snapshot server mismatch: input=${input.serverId}, world=${snapshotServerId}.`);
    }
    const serverId = input.serverId;
    const serverName =
        typeof meta.serverName === 'string' && meta.serverName.trim() ? meta.serverName.trim() : input.profileName;
    const generals = world.listGenerals();
    const cities = world.listCities();
    const nations = world.listNations();
    const eligibleGenerals = generals.filter((general) => general.userId && general.npcState < 2);

    const pointRows = eligibleGenerals.length
        ? await transaction.inheritancePoint.findMany({
              where: { userId: { in: eligibleGenerals.map((general) => general.userId!) } },
              select: { userId: true, key: true, value: true },
          })
        : [];
    const pointsByUser = new Map<string, Map<string, number>>();
    for (const row of pointRows) {
        const points = pointsByUser.get(row.userId) ?? new Map<string, number>();
        points.set(row.key, row.value);
        pointsByUser.set(row.userId, points);
    }

    for (const general of eligibleGenerals) {
        const userId = general.userId!;
        const generalMeta = asRecord(general.meta);
        const currentPoints = pointsByUser.get(userId) ?? new Map<string, number>();
        const previous = currentPoints.get('previous') ?? 0;
        const livedMonth = readNumber(generalMeta.inherit_lived_month);
        const maxDomestic = readNumber(generalMeta.max_domestic_critical);
        const activeAction = readNumber(generalMeta.inherit_active_action);
        const combat = readNumber(generalMeta.rank_warnum) * 5;
        const sabotage = readNumber(generalMeta.firenum) * 20;
        const dex =
            Object.entries(generalMeta).reduce(
                (sum, [key, value]) => (key.startsWith('dex') ? sum + readNumber(value) : sum),
                0
            ) * 0.001;
        const unifier = currentPoints.get('unifier') ?? 0;
        const unifierAward = general.nationId === input.winnerNationId && general.officerLevel > 4 ? UNIFIER_POINT : 0;
        const total = Math.floor(
            previous + livedMonth + maxDomestic + activeAction * 3 + combat + sabotage + dex + unifier + unifierAward
        );

        await transaction.inheritancePoint.upsert({
            where: { userId_key: { userId, key: 'previous' } },
            update: { value: total },
            create: { userId, key: 'previous', value: total },
        });
        await transaction.inheritancePoint.deleteMany({ where: { userId, key: { not: 'previous' } } });
        await transaction.inheritanceResult.create({
            data: {
                serverId,
                owner: userId,
                generalId: general.id,
                year: input.year,
                month: input.month,
                value: {
                    previous,
                    lived_month: livedMonth,
                    max_domestic_critical: maxDomestic,
                    active_action: activeAction,
                    combat,
                    sabotage,
                    dex,
                    unifier,
                    unifierAward,
                    total,
                    generationKey: input.generationKey,
                },
            },
        });
        await transaction.inheritanceLog.create({
            data: {
                userId,
                serverId,
                year: input.year,
                month: input.month,
                text: `천하 통일 정산: ${total.toLocaleString('ko-KR')} 포인트`,
            },
        });
    }

    const rankRows = generals.length
        ? await transaction.rankData.findMany({
              where: { generalId: { in: generals.map((general) => general.id) } },
              select: { generalId: true, type: true, value: true },
          })
        : [];
    const ranksByGeneral = new Map<number, Record<string, number>>();
    for (const row of rankRows) {
        const ranks = ranksByGeneral.get(row.generalId) ?? {};
        ranks[row.type] = row.value;
        ranksByGeneral.set(row.generalId, ranks);
    }
    const nationMap = new Map(nations.map((nation) => [nation.id, nation]));
    const season = readInteger(meta.season, 1);
    const scenario = readInteger(meta.scenarioId);
    const scenarioName = String(asRecord(meta.scenarioMeta).title ?? '');
    const startTime = typeof meta.starttime === 'string' ? meta.starttime : null;
    const unitedTime = input.completedAt.toISOString();
    const serverCount = await transaction.gameHistory.count();
    const minHallAge = readInteger(asRecord(world.getScenarioConfig().const).minPushHallAge, 30);

    const hallTypes: Array<[HallOfFameType, 'natural' | 'rank' | 'calc']> = HALL_OF_FAME_TYPES.map((type) => {
        if (type === 'experience' || type === 'dedication' || type.startsWith('dex')) {
            return [type, 'natural'];
        }
        return [type, type.endsWith('rate') ? 'calc' : 'rank'];
    });
    for (const general of eligibleGenerals.filter((entry) => entry.age >= minHallAge)) {
        const ranks = ranksByGeneral.get(general.id) ?? {};
        const totals = {
            tt: (ranks.ttw ?? 0) + (ranks.ttd ?? 0) + (ranks.ttl ?? 0),
            tl: (ranks.tlw ?? 0) + (ranks.tld ?? 0) + (ranks.tll ?? 0),
            ts: (ranks.tsw ?? 0) + (ranks.tsd ?? 0) + (ranks.tsl ?? 0),
            ti: (ranks.tiw ?? 0) + (ranks.tid ?? 0) + (ranks.til ?? 0),
        };
        const calc: Record<string, number> = {
            winrate: computeRate(ranks.killnum ?? 0, ranks.warnum ?? 0),
            killrate: computeRate(ranks.killcrew ?? 0, Math.max(1, ranks.deathcrew ?? 0)),
            killrate_person: computeRate(ranks.killcrew_person ?? 0, Math.max(1, ranks.deathcrew_person ?? 0)),
            ttrate: computeRate(ranks.ttw ?? 0, totals.tt),
            tlrate: computeRate(ranks.tlw ?? 0, totals.tl),
            tsrate: computeRate(ranks.tsw ?? 0, totals.ts),
            tirate: computeRate(ranks.tiw ?? 0, totals.ti),
            betrate: computeRate(ranks.betwingold ?? 0, Math.max(1, ranks.betgold ?? 0)),
        };
        const generalMeta = asRecord(general.meta);
        const nation = nationMap.get(general.nationId);
        const background = nation?.color ?? '#000000';
        const aux = {
            name: general.name,
            nationName: nation?.name ?? '재야',
            bgColor: background,
            fgColor: resolveLegacyTextColor(background),
            picture: general.picture ?? null,
            imgsvr: general.imageServer ?? 0,
            startTime,
            unitedTime,
            ownerDisplayName: ownerDisplayName(generalMeta),
            serverID: serverId,
            serverIdx: serverCount,
            serverName,
            scenarioName,
            generationKey: input.generationKey,
        };

        for (const [type, valueType] of hallTypes) {
            const value =
                valueType === 'calc'
                    ? (calc[type] ?? 0)
                    : valueType === 'rank'
                      ? (ranks[type] ?? 0)
                      : type === 'experience'
                        ? general.experience
                        : type === 'dedication'
                          ? general.dedication
                          : readNumber(generalMeta[type]);
            if ((type === 'winrate' || type === 'killrate') && (ranks.warnum ?? 0) < 10) continue;
            if (type === 'ttrate' && totals.tt < 50) continue;
            if (type === 'tlrate' && totals.tl < 50) continue;
            if (type === 'tsrate' && totals.ts < 50) continue;
            if (type === 'tirate' && totals.ti < 50) continue;
            if (type === 'betrate' && (ranks.betgold ?? 0) < 1000) continue;
            if (value <= 0) continue;

            const existing = await transaction.hallOfFame.findFirst({
                where: {
                    OR: [
                        { serverId, type, generalNo: general.id },
                        { serverId, type, owner: general.userId },
                    ],
                },
            });
            if (!existing) {
                await transaction.hallOfFame.create({
                    data: {
                        serverId,
                        season,
                        scenario,
                        generalNo: general.id,
                        type,
                        value,
                        owner: general.userId ?? null,
                        aux,
                    },
                });
            } else if (value > existing.value) {
                await transaction.hallOfFame.update({ where: { id: existing.id }, data: { value, aux } });
            }
        }
    }

    await transaction.gameHistory.update({
        where: { serverId },
        data: { winnerNation: input.winnerNationId, date: input.completedAt },
    });

    const nationHistoryRows = await transaction.logEntry.findMany({
        where: { nationId: input.winnerNationId, scope: LogScope.NATION, category: LogCategory.HISTORY },
        orderBy: { id: 'asc' },
        select: { text: true },
    });
    const nationHistory = nationHistoryRows.map((row) => row.text);
    const winnerGenerals = generals.filter((general) => general.nationId === input.winnerNationId);
    const neutralGenerals = generals.filter((general) => general.nationId === 0);
    const cityCount = cities.filter((city) => city.nationId === input.winnerNationId).length;
    const totalPop = cities.reduce((sum, city) => sum + city.population, 0);
    const totalMaxPop = cities.reduce((sum, city) => sum + city.populationMax, 0);
    const winnerMeta = asRecord(winner.meta);
    const winnerData = {
        ...winner,
        tech: readInteger(winnerMeta.tech),
        aux: {
            ...asRecord(winnerMeta.aux),
            ...asRecord(winnerMeta.max_power),
        },
        msg: String(asRecord(winnerMeta.nationNotice).msg ?? winnerMeta.msg ?? ''),
        scout_msg: String(winnerMeta.scout_msg ?? ''),
        generals: winnerGenerals.map((general) => general.id),
        history: nationHistory,
        generationKey: input.generationKey,
    };
    await transaction.oldNation.upsert({
        where: { serverId_nation_sourceId: { serverId, nation: input.winnerNationId, sourceId: 0 } },
        update: { data: asJson(winnerData), date: input.completedAt },
        create: {
            serverId,
            nation: input.winnerNationId,
            sourceId: 0,
            data: asJson(winnerData),
            date: input.completedAt,
        },
    });
    const neutralData = {
        nation: 0,
        name: '재야',
        generals: neutralGenerals.map((general) => general.id),
        generationKey: input.generationKey,
    };
    await transaction.oldNation.upsert({
        where: { serverId_nation_sourceId: { serverId, nation: 0, sourceId: 0 } },
        update: { data: neutralData, date: input.completedAt },
        create: { serverId, nation: 0, sourceId: 0, data: neutralData, date: input.completedAt },
    });

    const archiveGenerals = [...neutralGenerals, ...winnerGenerals];
    const generalHistoryRows = archiveGenerals.length
        ? await transaction.logEntry.findMany({
              where: {
                  generalId: { in: archiveGenerals.map((general) => general.id) },
                  scope: LogScope.GENERAL,
                  category: LogCategory.HISTORY,
              },
              orderBy: { id: 'asc' },
              select: { generalId: true, text: true },
          })
        : [];
    const historyByGeneral = new Map<number, string[]>();
    for (const row of generalHistoryRows) {
        if (row.generalId === null) continue;
        const history = historyByGeneral.get(row.generalId) ?? [];
        history.push(row.text);
        historyByGeneral.set(row.generalId, history);
    }
    for (const general of archiveGenerals) {
        const data = {
            ...general,
            turnTime: general.turnTime.toISOString(),
            history: historyByGeneral.get(general.id) ?? [],
            generationKey: input.generationKey,
        };
        await transaction.oldGeneral.upsert({
            where: { by_no: { serverId, generalNo: general.id } },
            update: {
                owner: general.userId ?? null,
                name: general.name,
                lastYearMonth: input.year * 100 + input.month,
                turnTime: general.turnTime,
                data: asJson(data),
            },
            create: {
                serverId,
                generalNo: general.id,
                owner: general.userId ?? null,
                name: general.name,
                lastYearMonth: input.year * 100 + input.month,
                turnTime: general.turnTime,
                data: asJson(data),
            },
        });
    }

    const officerMap = new Map(
        winnerGenerals
            .filter((general) => general.officerLevel >= 5)
            .map((general) => [general.officerLevel, general] as const)
    );
    const topList = (type: 'killnum' | 'firenum', limit: number): string =>
        rankRows
            .filter((row) => row.type === type && row.value > 0 && winnerGenerals.some((g) => g.id === row.generalId))
            .sort((left, right) => right.value - left.value)
            .slice(0, limit)
            .map(
                (row) =>
                    `${generals.find((general) => general.id === row.generalId)?.name ?? '무명'}【${row.value.toLocaleString('ko-KR')}】`
            )
            .join(', ');
    const previousNationArchives = await transaction.oldNation.findMany({
        where: { serverId },
        select: { data: true },
    });
    const archivedNationNames = previousNationArchives
        .map((row) => asRecord(row.data).name)
        .filter((name): name is string => typeof name === 'string' && Boolean(name));
    if (!archivedNationNames.includes(winner.name)) archivedNationNames.push(winner.name);
    const statistics = asRecord(meta.dynastyStatistics);
    const nationCount = `1 / ${Math.max(1, readInteger(statistics.maxNationCount, 1))}`;
    const genCount = `${generals.length} / ${Math.max(generals.length, readInteger(statistics.maxGeneralCount))}`;
    const statisticNationNames = String(statistics.maxNationName ?? '').trim();
    const personalHist = formatHistogram(statistics.personalHist);
    const specialHist = [formatHistogram(statistics.specialHist), formatHistogram(statistics.special2Hist)]
        .filter(Boolean)
        .join(' // ');
    const population = `${totalPop} / ${totalMaxPop}`;
    const popRate = totalMaxPop > 0 ? `${Math.round((totalPop / totalMaxPop) * 10000) / 100} %` : '0 %';
    const officer = (level: number) => officerMap.get(level);

    await transaction.emperor.create({
        data: {
            serverId,
            phase: `${serverName}${serverCount}기`,
            nationCount,
            nationName: statisticNationNames || archivedNationNames.join(', '),
            nationHist: formatHistogram(statistics.maxNationHist),
            genCount,
            personalHist,
            specialHist,
            name: winner.name,
            type: winner.typeCode,
            color: winner.color,
            year: input.year,
            month: input.month,
            power: winner.power,
            gennum: winnerGenerals.length,
            citynum: cityCount,
            pop: population,
            poprate: popRate,
            gold: winner.gold,
            rice: winner.rice,
            l12name: officer(12)?.name ?? '',
            l12pic: officer(12)?.picture ?? '',
            l11name: officer(11)?.name ?? '',
            l11pic: officer(11)?.picture ?? '',
            l10name: officer(10)?.name ?? '',
            l10pic: officer(10)?.picture ?? '',
            l9name: officer(9)?.name ?? '',
            l9pic: officer(9)?.picture ?? '',
            l8name: officer(8)?.name ?? '',
            l8pic: officer(8)?.picture ?? '',
            l7name: officer(7)?.name ?? '',
            l7pic: officer(7)?.picture ?? '',
            l6name: officer(6)?.name ?? '',
            l6pic: officer(6)?.picture ?? '',
            l5name: officer(5)?.name ?? '',
            l5pic: officer(5)?.picture ?? '',
            tiger: topList('killnum', 5),
            eagle: topList('firenum', 7),
            gen: winnerGenerals
                .slice()
                .sort((left, right) => right.dedication - left.dedication)
                .map((general) => general.name)
                .join(', '),
            history: nationHistory,
            aux: { winnerNationId: input.winnerNationId, generationKey: input.generationKey },
        },
    });

    return { status: 'APPLIED', generationKey: input.generationKey };
};
