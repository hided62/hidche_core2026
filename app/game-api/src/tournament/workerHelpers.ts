import { asRecord, createTournamentRng } from '@sammo-ts/common';
import { resolveTournamentBattle, TournamentType } from '@sammo-ts/logic';

import type { TurnDaemonTransport } from '../daemon/transport.js';
import type { TournamentStore } from './store.js';
import type { TournamentBetEntry, TournamentMatchEntry, TournamentParticipantEntry, TournamentState } from './types.js';

export type TournamentPrismaClient = {
    general: {
        findMany: (args: {
            where: Record<string, unknown>;
            select: Record<string, boolean>;
        }) => Promise<Array<Record<string, unknown>>>;
        update: (args: { where: { id: number }; data: { gold: number } }) => Promise<unknown>;
    };
    worldState: {
        findFirst: () => Promise<{ meta?: unknown; currentYear?: number; config?: unknown } | null>;
    };
    $transaction: (actions: Promise<unknown>[]) => Promise<unknown[]>;
};

export const sleepMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const isBattleStage = (stage: number): boolean => stage >= 7 && stage <= 10;
export const isPreBattleStage = (stage: number): boolean => stage >= 1 && stage <= 6;

export const nextStage = (stage: number): number => {
    switch (stage) {
        case 7:
            return 8;
        case 8:
            return 9;
        case 9:
            return 10;
        default:
            return 0;
    }
};

export const resolveNextAt = (state: TournamentState): string =>
    new Date(Date.now() + Math.max(1, state.termSeconds) * 1000).toISOString();

export const resolveBettingCloseAt = (state: TournamentState): string => {
    const bettingTermMs = Math.min(state.termSeconds * 60, 3600) * 1000;
    return new Date(Date.now() + Math.max(1000, bettingTermMs)).toISOString();
};

export const resolveStatValue = (
    type: TournamentType,
    entry: { leadership: number; strength: number; intel: number }
): number => {
    switch (type) {
        case TournamentType.LEADERSHIP:
            return entry.leadership;
        case TournamentType.STRENGTH:
            return entry.strength;
        case TournamentType.INTEL:
            return entry.intel;
        case TournamentType.TOTAL:
        default:
            return entry.leadership + entry.strength + entry.intel;
    }
};

export const resolveGroupPair = (stage: number, phase: number): [number, number] | null => {
    if (stage === 2) {
        const pairMap: Array<[number, number]> = [
            [0, 1], [2, 3], [4, 5], [6, 7],
            [0, 2], [1, 3], [4, 6], [5, 7],
            [0, 3], [1, 6], [2, 5], [4, 7],
            [0, 4], [1, 5], [2, 6], [3, 7],
            [0, 5], [1, 4], [2, 7], [3, 6],
            [0, 6], [1, 7], [2, 4], [3, 5],
            [0, 7], [1, 2], [3, 4], [5, 6],
        ];
        const basePair = pairMap[phase % 28];
        if (!basePair) {
            return null;
        }
        return phase >= 28 ? [basePair[1], basePair[0]] : basePair;
    }

    if (stage === 4) {
        const pairMap: Array<[number, number]> = [
            [0, 1], [2, 3],
            [0, 2], [1, 3],
            [0, 3], [1, 2],
        ];
        return pairMap[phase % 6] ?? null;
    }

    return null;
};

export const assignGroupSlots = (
    participants: Array<TournamentParticipantEntry & { groupId?: number; groupNo?: number }>,
    groupCount: number,
    groupSize: number,
    groupStart: number
): TournamentParticipantEntry[] => {
    const groupCounts = Array.from({ length: groupCount }, () => 0);
    for (const entry of participants) {
        if (entry.groupId !== undefined && entry.groupId >= groupStart && entry.groupId < groupStart + groupCount) {
            const idx = entry.groupId - groupStart;
            if (idx >= 0 && idx < groupCount) {
                groupCounts[idx] += 1;
            }
        }
    }

    return participants.map((entry) => {
        if (entry.groupId !== undefined && entry.groupNo !== undefined) {
            return entry;
        }
        const minCount = Math.min(...groupCounts);
        const groupIdx = groupCounts.findIndex((count) => count === minCount);
        const groupNo = groupCounts[groupIdx] ?? 0;
        groupCounts[groupIdx] = groupNo + 1;
        return {
            ...entry,
            groupId: groupStart + groupIdx,
            groupNo: groupNo < groupSize ? groupNo : groupNo % groupSize,
            win: 0,
            draw: 0,
            lose: 0,
            gl: 0,
        };
    });
};

export const selectWeighted = <T>(
    rng: ReturnType<typeof createTournamentRng>,
    pool: Array<{ item: T; weight: number }>
): T => rng.choiceUsingWeightPair(pool.map((entry) => [entry.item, entry.weight]));

export const fillParticipants = async (options: {
    prisma: TournamentPrismaClient;
    state: TournamentState;
    baseSeed: string;
    current: TournamentParticipantEntry[];
    limit: number;
}): Promise<TournamentParticipantEntry[]> => {
    const { prisma, state, baseSeed, limit } = options;
    const takenIds = new Set(options.current.map((entry) => entry.id));
    const result = [...options.current];

    if (result.length >= limit) {
        return result;
    }

    const applicants = await prisma.general.findMany({
        where: {
            meta: { path: ['tnmt'], equals: 1 },
        },
        select: {
            id: true,
            name: true,
            leadership: true,
            strength: true,
            intel: true,
            meta: true,
            npcState: true,
        },
    });

    const applicantPool = applicants
        .map((entry) => asRecord(entry))
        .filter((entry) => typeof entry.id === 'number' && !takenIds.has(entry.id))
        .map((entry) => {
            const leadership = typeof entry.leadership === 'number' ? entry.leadership : 0;
            const strength = typeof entry.strength === 'number' ? entry.strength : 0;
            const intel = typeof entry.intel === 'number' ? entry.intel : 0;
            const score = resolveStatValue(state.type, { leadership, strength, intel });
            const meta = asRecord(entry.meta);
            const level = typeof meta.explevel === 'number' ? meta.explevel : 0;
            return {
                item: {
                    id: entry.id as number,
                    name: typeof entry.name === 'string' ? entry.name : '무명장수',
                    leadership,
                    strength,
                    intel,
                    level,
                },
                weight: Math.max(1, score ** 1.5),
            };
        });

    const applicantRng = createTournamentRng(baseSeed, {
        openYear: state.openYear,
        openMonth: state.openMonth,
        stage: 1,
        phase: state.phase,
        matchIndex: 0,
        participantIndex: 0,
        extraSeed: 'fill:applicants',
    });

    while (result.length < limit && applicantPool.length > 0) {
        const picked = selectWeighted(applicantRng, applicantPool);
        applicantPool.splice(applicantPool.findIndex((entry) => entry.item.id === picked.id), 1);
        takenIds.add(picked.id);
        result.push(picked);
    }

    if (result.length >= limit) {
        return result;
    }

    const npcRows = await prisma.general.findMany({
        where: {
            npcState: { gte: 2 },
        },
        select: {
            id: true,
            name: true,
            leadership: true,
            strength: true,
            intel: true,
            meta: true,
            npcState: true,
        },
    });

    const npcPool = npcRows
        .map((entry) => asRecord(entry))
        .filter((entry) => typeof entry.id === 'number' && !takenIds.has(entry.id))
        .map((entry) => {
            const leadership = typeof entry.leadership === 'number' ? entry.leadership : 0;
            const strength = typeof entry.strength === 'number' ? entry.strength : 0;
            const intel = typeof entry.intel === 'number' ? entry.intel : 0;
            const score = resolveStatValue(state.type, { leadership, strength, intel });
            const meta = asRecord(entry.meta);
            const level = typeof meta.explevel === 'number' ? meta.explevel : 0;
            return {
                item: {
                    id: entry.id as number,
                    name: typeof entry.name === 'string' ? entry.name : '무명장수',
                    leadership,
                    strength,
                    intel,
                    level,
                },
                weight: Math.max(1, score ** 1.5),
            };
        });

    const npcRng = createTournamentRng(baseSeed, {
        openYear: state.openYear,
        openMonth: state.openMonth,
        stage: 1,
        phase: state.phase,
        matchIndex: 0,
        participantIndex: 1,
        extraSeed: 'fill:npc',
    });

    while (result.length < limit && npcPool.length > 0) {
        const picked = selectWeighted(npcRng, npcPool);
        npcPool.splice(npcPool.findIndex((entry) => entry.item.id === picked.id), 1);
        takenIds.add(picked.id);
        result.push(picked);
    }

    let dummyId = -1;
    while (result.length < limit) {
        while (takenIds.has(dummyId)) {
            dummyId -= 1;
        }
        takenIds.add(dummyId);
        result.push({
            id: dummyId,
            name: '무명장수',
            leadership: 10,
            strength: 10,
            intel: 10,
            level: 10,
        });
        dummyId -= 1;
    }

    return result;
};

export const applyGroupMatch = (
    participants: TournamentParticipantEntry[],
    attacker: TournamentParticipantEntry,
    defender: TournamentParticipantEntry,
    state: TournamentState,
    baseSeed: string,
    matchIndex: number
): TournamentParticipantEntry[] => {
    const result = resolveTournamentBattle({
        type: state.type,
        battleType: 0,
        attacker: {
            id: attacker.id,
            name: attacker.name,
            stats: {
                leadership: attacker.leadership,
                strength: attacker.strength,
                intel: attacker.intel,
            },
            level: attacker.level,
        },
        defender: {
            id: defender.id,
            name: defender.name,
            stats: {
                leadership: defender.leadership,
                strength: defender.strength,
                intel: defender.intel,
            },
            level: defender.level,
        },
        context: {
            openYear: state.openYear,
            openMonth: state.openMonth,
            stage: state.stage,
            phase: state.phase,
            matchIndex,
        },
        baseSeed,
    });

    const glDelta = Math.round((result.totalDamage.defender - result.totalDamage.attacker) / 50);

    return participants.map((entry) => {
        if (entry.id !== attacker.id && entry.id !== defender.id) {
            return entry;
        }
        const next = {
            ...entry,
            win: entry.win ?? 0,
            draw: entry.draw ?? 0,
            lose: entry.lose ?? 0,
            gl: entry.gl ?? 0,
        };
        if (result.draw) {
            next.draw += 1;
            return next;
        }
        if (result.winnerId === entry.id) {
            next.win += 1;
            next.gl += glDelta;
            return next;
        }
        next.lose += 1;
        next.gl -= glDelta;
        return next;
    });
};

export const sortByRanking = (entries: TournamentParticipantEntry[]): TournamentParticipantEntry[] =>
    [...entries].sort((lhs, rhs) => {
        const lhsPoints = (lhs.win ?? 0) * 3 + (lhs.draw ?? 0);
        const rhsPoints = (rhs.win ?? 0) * 3 + (rhs.draw ?? 0);
        if (lhsPoints !== rhsPoints) {
            return rhsPoints - lhsPoints;
        }
        const lhsGl = lhs.gl ?? 0;
        const rhsGl = rhs.gl ?? 0;
        if (lhsGl !== rhsGl) {
            return rhsGl - lhsGl;
        }
        return lhs.id - rhs.id;
    });

export const buildFinal16MatchesFromGroups = (
    participants: TournamentParticipantEntry[]
): TournamentMatchEntry[] | null => {
    const groupOrder = [10, 14, 11, 15, 12, 16, 13, 17, 14, 10, 15, 11, 16, 12, 17, 13];
    const rankOrder = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2];

    const selected: number[] = [];
    for (let i = 0; i < groupOrder.length; i += 1) {
        const groupId = groupOrder[i]!;
        const rank = rankOrder[i]!;
        const entry = participants.find((p) => p.groupId === groupId && p.finalRank === rank);
        if (!entry) {
            return null;
        }
        selected.push(entry.id);
    }

    return selected.reduce<TournamentMatchEntry[]>((acc, _id, idx) => {
        if (idx % 2 !== 0) {
            return acc;
        }
        const attackerId = selected[idx];
        const defenderId = selected[idx + 1];
        if (attackerId === undefined || defenderId === undefined) {
            return acc;
        }
        acc.push({
            id: acc.length + 1,
            stage: 7,
            roundIndex: acc.length,
            attackerId,
            defenderId,
        });
        return acc;
    }, []);
};

export const pickFinalists = (
    state: TournamentState,
    participants: Array<{ id: number; leadership: number; strength: number; intel: number }>
): number[] =>
    participants
        .slice()
        .sort((lhs, rhs) => {
            const lVal = resolveStatValue(state.type, lhs);
            const rVal = resolveStatValue(state.type, rhs);
            if (lVal !== rVal) {
                return rVal - lVal;
            }
            return lhs.id - rhs.id;
        })
        .slice(0, 16)
        .map((entry) => entry.id);

export const buildInitialMatches = (
    state: TournamentState,
    baseSeed: string,
    participantIds: number[]
): TournamentMatchEntry[] => {
    const rng = createTournamentRng(baseSeed, {
        openYear: state.openYear,
        openMonth: state.openMonth,
        stage: 5,
        phase: state.phase,
        matchIndex: 0,
        participantIndex: 0,
        extraSeed: 'round16',
    });
    const shuffled = rng.shuffle(participantIds);
    const pairs = shuffled.slice(0, 16);
    if (pairs.length < 2 || pairs.length % 2 !== 0) {
        throw new Error('대진표를 구성할 참가자가 부족합니다.');
    }
    return pairs.reduce<TournamentMatchEntry[]>((acc, _id, idx) => {
        if (idx % 2 !== 0) {
            return acc;
        }
        const attackerId = pairs[idx];
        const defenderId = pairs[idx + 1];
        if (attackerId === undefined || defenderId === undefined) {
            return acc;
        }
        acc.push({
            id: acc.length + 1,
            stage: 7,
            roundIndex: acc.length,
            attackerId,
            defenderId,
        });
        return acc;
    }, []);
};

export const buildNextMatches = (stage: number, matches: TournamentMatchEntry[]): TournamentMatchEntry[] => {
    const stageMatches = matches.filter((match) => match.stage === stage);
    const winners = stageMatches
        .map((match) => match.winnerId)
        .filter((winner): winner is number => typeof winner === 'number');

    if (winners.length === 0 || winners.length % 2 !== 0) {
        throw new Error('다음 라운드를 만들 수 없습니다.');
    }

    const nextIdBase = matches.reduce((max, entry) => Math.max(max, entry.id), 0) + 1;
    const nextStageValue = nextStage(stage);
    const result: TournamentMatchEntry[] = [];

    for (let i = 0; i < winners.length; i += 2) {
        const attackerId = winners[i];
        const defenderId = winners[i + 1];
        if (attackerId === undefined || defenderId === undefined) {
            continue;
        }
        result.push({
            id: nextIdBase + result.length,
            stage: nextStageValue,
            roundIndex: i / 2,
            attackerId,
            defenderId,
        });
    }

    if (result.length === 0) {
        throw new Error('다음 라운드 대진 생성에 실패했습니다.');
    }
    return result;
};

export const buildBettingPayouts = (
    winnerId: number,
    entries: TournamentBetEntry[]
): { payouts: Array<{ generalId: number; amount: number }>; total: number; refundAll: boolean } => {
    const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
    if (total <= 0) {
        return { payouts: [], total: 0, refundAll: false };
    }
    const winners = entries.filter((entry) => entry.targetId === winnerId);
    const winnersTotal = winners.reduce((sum, entry) => sum + entry.amount, 0);
    if (winnersTotal <= 0) {
        const refunds = entries.map((entry) => ({ generalId: entry.generalId, amount: entry.amount }));
        return { payouts: refunds, total, refundAll: true };
    }
    const ratio = total / winnersTotal;
    const payouts = winners.map((entry) => ({
        generalId: entry.generalId,
        amount: Math.round(entry.amount * ratio),
    }));
    return { payouts, total, refundAll: false };
};

export const buildTournamentRewardPayload = (
    matches: TournamentMatchEntry[]
): { top16: number[]; top8: number[]; top4: number[]; winnerId: number; runnerUpId: number } => {
    const top16 = new Set<number>();
    const top8 = new Set<number>();
    const top4 = new Set<number>();

    for (const match of matches) {
        if (match.stage === 7) {
            top16.add(match.attackerId);
            top16.add(match.defenderId);
            if (typeof match.winnerId === 'number') {
                top8.add(match.winnerId);
            }
        }
        if (match.stage === 8 && typeof match.winnerId === 'number') {
            top4.add(match.winnerId);
        }
    }

    const finalMatch = matches.find((match) => match.stage === 10 && typeof match.winnerId === 'number');
    if (!finalMatch || typeof finalMatch.winnerId !== 'number') {
        throw new Error('결승전 결과를 찾을 수 없습니다.');
    }
    const winnerId = finalMatch.winnerId;
    const runnerUpId = finalMatch.attackerId === winnerId ? finalMatch.defenderId : finalMatch.attackerId;

    return {
        top16: Array.from(top16),
        top8: Array.from(top8),
        top4: Array.from(top4),
        winnerId,
        runnerUpId,
    };
};

export const resolveNumber = (source: Record<string, unknown>, keys: string[], fallback: number): number => {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return fallback;
};

export const seedNpcBets = async (options: {
    prisma: TournamentPrismaClient;
    store: TournamentStore;
    state: TournamentState;
    baseSeed: string;
    daemonTransport: TurnDaemonTransport;
}): Promise<void> => {
    const { prisma, store, state, baseSeed, daemonTransport } = options;
    const existing = await store.getBettingEntries();
    if (existing.length > 0) {
        return;
    }

    const matches = await store.getMatches();
    const candidateIds = Array.from(
        new Set(
            matches
                .filter((match) => match.stage === 7)
                .flatMap((match) => [match.attackerId, match.defenderId])
        )
    );
    if (candidateIds.length === 0) {
        return;
    }

    const worldState = await prisma.worldState.findFirst();
    const config = asRecord(worldState?.config ?? {});
    const constValues = asRecord(config.const ?? config);
    const startYear = resolveNumber(constValues, ['startYear', 'startyear'], state.openYear);
    const currentYear = worldState?.currentYear ?? state.openYear;
    const betGold = Math.max(10, Math.floor((3 + currentYear - startYear) * 0.334) * 10);

    const npcList = await prisma.general.findMany({
        where: {
            npcState: { gte: 2 },
            gold: { gte: 500 + betGold },
        },
        select: { id: true, gold: true },
    });
    const npcBetList = npcList
        .map((entry) => asRecord(entry))
        .filter((entry) => typeof entry.id === 'number' && typeof entry.gold === 'number');
    if (npcBetList.length === 0) {
        return;
    }

    const rng = createTournamentRng(baseSeed, {
        openYear: state.openYear,
        openMonth: state.openMonth,
        stage: 6,
        phase: 0,
        matchIndex: 0,
        participantIndex: 0,
        extraSeed: `OpenBettingTournament:${state.bettingId ?? 'none'}`,
    });

    const entries = [...existing];
    for (const npc of npcBetList) {
        const targetId = rng.choice(candidateIds);
        entries.push({ generalId: npc.id as number, targetId, amount: betGold });
    }

    await daemonTransport.sendCommand({
        type: 'adjustGeneralResources',
        reason: 'tournamentNpcBet',
        adjustments: npcBetList.map((npc) => ({
            generalId: npc.id as number,
            goldDelta: -betGold,
        })),
    });
    await store.setBettingEntries(entries);
};
