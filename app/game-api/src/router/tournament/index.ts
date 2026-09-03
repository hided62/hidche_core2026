import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asRecord } from '@sammo-ts/common';
import type { TournamentType } from '@sammo-ts/logic';
import type { TournamentState } from '../../tournament/types.js';

import { TournamentStore, type TournamentClockContext } from '../../tournament/store.js';
import { buildTournamentKeys } from '../../tournament/keys.js';
import { assignManualApplicantGroup } from '../../tournament/workerHelpers.js';
import { accessAuthedProcedure, authedProcedure, engineAuthedProcedure, router } from '../../trpc.js';
import { getMyGeneral } from '../shared/general.js';
import { loadCurrentGameTime } from '../../services/gameClock.js';
import { ensureActiveRedisClockFence, ensureBettingRedisClockFence } from '../../services/redisClockFence.js';
import { loadClockAdminStatus } from '../../services/clockReadiness.js';

const hasAdminRole = (roles: string[], profileName: string): boolean => {
    if (roles.includes('superuser') || roles.includes('admin') || roles.includes('admin.superuser')) {
        return true;
    }
    return roles.some((role) => role === 'admin.tournament' || role === `admin.tournament:${profileName}`);
};

const resolveNumber = (source: Record<string, unknown>, keys: string[], fallback: number): number => {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return fallback;
};

const resolveCurrentDevelCost = (worldState: { config?: unknown; meta?: unknown } | null): number => {
    const config = asRecord(worldState?.config ?? {});
    const constValues = asRecord(config.const ?? config);
    const configured = resolveNumber(constValues, ['develCost', 'develcost', 'develrate'], 0);
    return resolveNumber(asRecord(worldState?.meta), ['develcost', 'develCost', 'develrate'], configured);
};

const adminProcedure = authedProcedure.use(({ ctx, next }) => {
    const roles = ctx.auth?.user.roles ?? [];
    if (!hasAdminRole(roles, ctx.profile.name)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin permission is required.' });
    }
    return next();
});

const withTournamentClockMutation = async <T>(
    ctx: {
        db: Parameters<typeof loadCurrentGameTime>[0];
        redis: Parameters<typeof ensureActiveRedisClockFence>[0];
        profile: { name: string };
    },
    store: TournamentStore,
    operation: () => Promise<T>
): Promise<T> => {
    const gameTime = await loadCurrentGameTime(ctx.db);
    const fence = await ensureActiveRedisClockFence(ctx.redis, ctx.profile.name, gameTime);
    if (!fence) {
        throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Clock reconciliation is incomplete; tournament mutation is disabled.',
        });
    }
    const clockContext: TournamentClockContext = {
        phase: fence.phase,
        revision: fence.revision,
        deadlineGeneration: fence.generation,
        dateToTick: gameTime.dateToTick,
    };
    return store.withClockContext(clockContext, () => store.withMutationLock(operation));
};

const withTournamentBetClockMutation = async <T>(
    ctx: {
        db: Parameters<typeof loadCurrentGameTime>[0];
        redis: Parameters<typeof ensureBettingRedisClockFence>[0];
        profile: { name: string };
    },
    store: TournamentStore,
    operation: () => Promise<T>
): Promise<T> => {
    const gameTime = await loadCurrentGameTime(ctx.db);
    const fence = await ensureBettingRedisClockFence(ctx.redis, ctx.profile.name, gameTime);
    if (!fence) {
        throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Clock reconciliation is incomplete; tournament betting is disabled.',
        });
    }
    return store.withClockContext(
        {
            phase: fence.phase,
            revision: fence.revision,
            deadlineGeneration: fence.generation,
            dateToTick: gameTime.dateToTick,
        },
        () => store.withMutationLock(operation)
    );
};

const tournamentBetCommandRequestId = (requestId: string | undefined, step: string): string | undefined =>
    requestId ? `${requestId}:tournamentBet:${step}` : undefined;

const zTournamentState = z.object({
    stage: z.number().int().min(0),
    phase: z.number().int().min(0),
    type: z.number().int().min(0).max(3),
    auto: z.boolean(),
    openYear: z.number().int(),
    openMonth: z.number().int(),
    termSeconds: z.number().int().positive(),
    nextAt: z.string().min(1),
    bettingId: z.number().int().optional(),
    bettingCloseAt: z.string().optional(),
    winnerId: z.number().int().optional(),
    bettingSettled: z.boolean().optional(),
    rewardSettled: z.boolean().optional(),
    participantsLockedAt: z.string().optional(),
    lastError: z.string().optional(),
    lastErrorAt: z.string().optional(),
});

const zParticipant = z.object({
    id: z.number().int().positive(),
    name: z.string().min(1),
    leadership: z.number().int().min(0),
    strength: z.number().int().min(0),
    intel: z.number().int().min(0),
    level: z.number().int().min(0),
    groupId: z.number().int().optional(),
    groupNo: z.number().int().optional(),
    win: z.number().int().optional(),
    draw: z.number().int().optional(),
    lose: z.number().int().optional(),
    gl: z.number().int().optional(),
    seedRank: z.number().int().optional(),
    finalRank: z.number().int().optional(),
    preliminaryGroupId: z.number().int().min(0).max(7).optional(),
    preliminaryGroupNo: z.number().int().min(0).max(7).optional(),
    preliminaryRank: z.number().int().min(1).max(8).optional(),
    preliminaryWin: z.number().int().min(0).optional(),
    preliminaryDraw: z.number().int().min(0).optional(),
    preliminaryLose: z.number().int().min(0).optional(),
    preliminaryGl: z.number().int().optional(),
});

const zMatch = z.object({
    id: z.number().int().positive(),
    stage: z.number().int().min(0),
    roundIndex: z.number().int().min(0),
    groupId: z.number().int().min(0).max(17).optional(),
    attackerId: z.number().int().positive(),
    defenderId: z.number().int().positive(),
    winnerId: z.number().int().positive().optional(),
    log: z.array(z.string()).optional(),
    logEntries: z
        .array(
            z.object({
                phase: z.number().int().min(0),
                attackerEnergy: z.number().int(),
                defenderEnergy: z.number().int(),
                attackerDamage: z.number().int(),
                defenderDamage: z.number().int(),
                text: z.string(),
            })
        )
        .optional(),
    lastEnergy: z
        .object({
            attacker: z.number().int(),
            defender: z.number().int(),
        })
        .optional(),
});

const zBetEntry = z.object({
    generalId: z.number().int().positive(),
    targetId: z.number().int().positive(),
    amount: z.number().int().positive(),
});

const zSeedParticipants = z.object({
    generalIds: z.array(z.number().int().positive()).optional(),
    limit: z.number().int().min(1).max(256).optional(),
    includeNpc: z.boolean().optional(),
});

const tournamentRankTypes = ['tt', 'tl', 'ts', 'ti'] as const;

const tournamentRankInfo = {
    tt: { title: '전 력 전', statLabel: '종합' },
    tl: { title: '통 솔 전', statLabel: '통솔' },
    ts: { title: '일 기 토', statLabel: '무력' },
    ti: { title: '설 전', statLabel: '지력' },
} as const;

export const tournamentRouter = router({
    getState: authedProcedure.query(async ({ ctx }) => {
        await getMyGeneral(ctx);
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
        return store.getState();
    }),
    getAdminStatus: adminProcedure.query(async ({ ctx }) => ({
        ok: true,
        clock: await loadClockAdminStatus(ctx.db),
    })),
    getSnapshot: accessAuthedProcedure.query(async ({ ctx }) => {
        await getMyGeneral(ctx);
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
        const [state, participants, matches, bets, sourceRevision] = await Promise.all([
            store.getState(),
            store.getParticipants(),
            store.getMatches(),
            store.getBettingEntries(),
            store.getSourceRevision(),
        ]);
        const participantIds = [...new Set(participants.map((participant) => participant.id))];
        const iconRows =
            participantIds.length === 0
                ? []
                : await ctx.db.general.findMany({
                      where: { id: { in: participantIds } },
                      select: { id: true, picture: true, imageServer: true, npcState: true },
                  });
        const iconsByGeneralId = new Map(iconRows.map((general) => [general.id, general]));
        const publicParticipants = participants.map((participant) => {
            const icon = iconsByGeneralId.get(participant.id);
            return {
                ...participant,
                picture: icon?.picture ?? null,
                imageServer: icon?.imageServer ?? 0,
                npcState: icon?.npcState ?? 0,
            };
        });
        return { state, participants: publicParticipants, matches, betCount: bets.length, sourceRevision };
    }),
    getRankings: authedProcedure.query(async ({ ctx }) => {
        await getMyGeneral(ctx);
        const rankTypeNames = tournamentRankTypes.flatMap((prefix) => [
            `${prefix}p`,
            `${prefix}g`,
            `${prefix}w`,
            `${prefix}d`,
            `${prefix}l`,
        ]);
        const candidateRows = await Promise.all(
            tournamentRankTypes.map((prefix) =>
                ctx.db.rankData.findMany({
                    where: { type: `${prefix}g` },
                    orderBy: { value: 'desc' },
                    take: 40,
                    select: { generalId: true },
                })
            )
        );
        const candidateIdsByPrefix = new Map(
            tournamentRankTypes.map((prefix, index) => [
                prefix,
                new Set((candidateRows[index] ?? []).map((row) => row.generalId)),
            ])
        );
        const candidateIds = new Set(candidateRows.flatMap((rows) => rows.map((row) => row.generalId)));
        const scoreRows = await ctx.db.rankData.findMany({
            where: { generalId: { in: [...candidateIds] }, type: { in: rankTypeNames } },
            select: { generalId: true, type: true, value: true },
        });
        const rankMap = new Map<number, Record<string, number>>();
        for (const row of scoreRows) {
            const ranks = rankMap.get(row.generalId) ?? {};
            ranks[row.type] = row.value;
            rankMap.set(row.generalId, ranks);
        }
        const generals = await ctx.db.general.findMany({
            where: { id: { in: [...rankMap.keys()] } },
            select: {
                id: true,
                name: true,
                npcState: true,
                picture: true,
                imageServer: true,
                leadership: true,
                strength: true,
                intel: true,
            },
        });

        return tournamentRankTypes.map((prefix) => {
            const entries = generals
                .filter((general) => candidateIdsByPrefix.get(prefix)?.has(general.id))
                .map((general) => {
                    const ranks = rankMap.get(general.id) ?? {};
                    const win = ranks[`${prefix}w`] ?? 0;
                    const draw = ranks[`${prefix}d`] ?? 0;
                    const lose = ranks[`${prefix}l`] ?? 0;
                    const score = ranks[`${prefix}g`] ?? 0;
                    const stat =
                        prefix === 'tt'
                            ? general.leadership + general.strength + general.intel
                            : prefix === 'tl'
                              ? general.leadership
                              : prefix === 'ts'
                                ? general.strength
                                : general.intel;
                    return {
                        generalId: general.id,
                        name: general.name,
                        npcState: general.npcState,
                        picture: general.picture,
                        imageServer: general.imageServer,
                        stat,
                        games: win + draw + lose,
                        win,
                        draw,
                        lose,
                        score,
                        prizes: ranks[`${prefix}p`] ?? 0,
                    };
                })
                .sort(
                    (lhs, rhs) =>
                        rhs.score - lhs.score ||
                        rhs.games - lhs.games ||
                        rhs.win - lhs.win ||
                        rhs.draw - lhs.draw ||
                        lhs.lose - rhs.lose
                )
                .slice(0, 30)
                .map((entry, index) => ({ rank: index + 1, ...entry }));
            return { prefix, ...tournamentRankInfo[prefix], entries };
        });
    }),
    setState: adminProcedure.input(zTournamentState).mutation(async ({ ctx, input }) => {
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
        return withTournamentClockMutation(ctx, store, async () => {
            await store.setState({
                ...input,
                type: input.type as TournamentType,
            });
            return { ok: true };
        });
    }),
    patchState: adminProcedure.input(zTournamentState.partial()).mutation(async ({ ctx, input }) => {
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
        return withTournamentClockMutation(ctx, store, async () => {
            const current = await store.getState();
            if (!current) {
                throw new TRPCError({ code: 'NOT_FOUND', message: 'Tournament state not found.' });
            }
            const next = {
                ...current,
                ...input,
                type: (input.type !== undefined ? input.type : current.type) as TournamentType,
            };
            await store.setState(next);
            return { ok: true };
        });
    }),
    setParticipants: adminProcedure.input(z.array(zParticipant)).mutation(async ({ ctx, input }) => {
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
        return withTournamentClockMutation(ctx, store, async () => {
            await store.setParticipants(input);
            return { ok: true, count: input.length };
        });
    }),
    setMatches: adminProcedure.input(z.array(zMatch)).mutation(async ({ ctx, input }) => {
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
        return withTournamentClockMutation(ctx, store, async () => {
            await store.setMatches(input);
            return { ok: true, count: input.length };
        });
    }),
    setBettingEntries: adminProcedure.input(z.array(zBetEntry)).mutation(async ({ ctx, input }) => {
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
        return withTournamentClockMutation(ctx, store, async () => {
            await store.setBettingEntries(input);
            return { ok: true, count: input.length };
        });
    }),
    seedParticipants: adminProcedure.input(zSeedParticipants).mutation(async ({ ctx, input }) => {
        const limit = input.limit ?? 64;
        const includeNpc = input.includeNpc ?? true;
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));

        const generals =
            input.generalIds && input.generalIds.length > 0
                ? await ctx.db.general.findMany({
                      where: { id: { in: input.generalIds } },
                      select: { id: true, name: true, leadership: true, strength: true, intel: true, meta: true },
                  })
                : await ctx.db.general.findMany({
                      where: includeNpc ? {} : { npcState: 0 },
                      orderBy: [{ leadership: 'desc' }, { strength: 'desc' }, { intel: 'desc' }, { id: 'asc' }],
                      take: limit,
                      select: { id: true, name: true, leadership: true, strength: true, intel: true, meta: true },
                  });

        const participants = generals.map((general) => {
            const meta = asRecord(general.meta);
            const level = typeof meta.explevel === 'number' ? meta.explevel : 0;
            return {
                id: general.id,
                name: general.name,
                leadership: general.leadership,
                strength: general.strength,
                intel: general.intel,
                level,
            };
        });

        return withTournamentClockMutation(ctx, store, async () => {
            await store.setParticipants(participants);
            return { ok: true, count: participants.length };
        });
    }),
    getBettingSummary: authedProcedure.query(async ({ ctx }) => {
        const general = await getMyGeneral(ctx);
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
        const [state, entries, matches] = await Promise.all([
            store.getState(),
            store.getBettingEntries(),
            store.getMatches(),
        ]);

        if (!state || state.stage < 5) {
            return { state, totals: {}, myTotals: {}, totalAmount: 0, myAmount: 0 };
        }

        const candidateIds = new Set<number>();
        for (const match of matches) {
            if (match.stage === 7) {
                candidateIds.add(match.attackerId);
                candidateIds.add(match.defenderId);
            }
        }

        const totals: Record<number, number> = {};
        const myTotals: Record<number, number> = {};
        let totalAmount = 0;
        let myAmount = 0;
        for (const entry of entries) {
            if (!candidateIds.has(entry.targetId)) {
                continue;
            }
            totals[entry.targetId] = (totals[entry.targetId] ?? 0) + entry.amount;
            totalAmount += entry.amount;
            if (entry.generalId === general.id) {
                myTotals[entry.targetId] = (myTotals[entry.targetId] ?? 0) + entry.amount;
                myAmount += entry.amount;
            }
        }

        return { state, totals, myTotals, totalAmount, myAmount };
    }),
    join: authedProcedure.mutation(async ({ ctx }) => {
        const general = await getMyGeneral(ctx);
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
        return withTournamentClockMutation(ctx, store, async () => {
            const state = await store.getState();
            if (!state || state.stage !== 1 || state.participantsLockedAt) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '참가 신청 기간이 아닙니다.' });
            }

            const [participants, worldState] = await Promise.all([
                store.getParticipants(),
                ctx.db.worldState.findFirst(),
            ]);
            if (participants.some((entry) => entry.id === general.id)) {
                return { ok: true, count: participants.length };
            }
            if (participants.length >= 64) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '참가 인원이 가득 찼습니다.' });
            }

            const develCost = resolveCurrentDevelCost(worldState);
            const feeResult = await ctx.turnDaemon.requestCommand({
                type: 'adjustGeneralResources',
                reason: 'tournamentJoin',
                adjustments: [{ generalId: general.id, goldDelta: -develCost, minGoldAfter: 0 }],
            });
            if (!feeResult || feeResult.type !== 'adjustGeneralResources') {
                throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
            }
            if (!feeResult.ok || feeResult.processed !== 1) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: feeResult.ok ? '금이 부족합니다.' : feeResult.reason,
                });
            }

            const meta = asRecord(general.meta);
            const level = typeof meta.explevel === 'number' ? meta.explevel : 0;
            const applicant = assignManualApplicantGroup({
                state,
                baseSeed: String(asRecord(worldState?.meta).hiddenSeed ?? 'tournament'),
                current: participants,
                applicant: {
                    id: general.id,
                    name: general.name,
                    leadership: general.leadership,
                    strength: general.strength,
                    intel: general.intel,
                    level,
                },
            });
            const next = participants.concat(applicant);

            try {
                await store.setParticipants(next);
            } catch (error) {
                await ctx.turnDaemon.requestCommand({
                    type: 'adjustGeneralResources',
                    reason: 'tournamentJoinRollback',
                    adjustments: [{ generalId: general.id, goldDelta: develCost }],
                });
                throw error;
            }
            return { ok: true, count: next.length };
        });
    }),
    cancel: adminProcedure.mutation(async ({ ctx }) => {
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
        return withTournamentClockMutation(ctx, store, async () => {
            const state = await store.getState();
            if (!state) {
                throw new TRPCError({ code: 'NOT_FOUND', message: 'Tournament state not found.' });
            }

            const [participants, bets] = await Promise.all([store.getParticipants(), store.getBettingEntries()]);

            const worldState = await ctx.db.worldState.findFirst();
            const develCost = resolveCurrentDevelCost(worldState);

            const refundMap = new Map<number, number>();
            for (const participant of participants) {
                if (participant.id <= 0) {
                    continue;
                }
                if (participant.groupId !== undefined && participant.groupId >= 0 && participant.groupId < 8) {
                    refundMap.set(participant.id, (refundMap.get(participant.id) ?? 0) + develCost);
                }
            }
            for (const bet of bets) {
                refundMap.set(bet.generalId, (refundMap.get(bet.generalId) ?? 0) + bet.amount);
            }

            if (refundMap.size > 0) {
                await ctx.turnDaemon.sendCommand({
                    type: 'tournamentRefund',
                    refunds: Array.from(refundMap.entries()).map(([generalId, amount]) => ({
                        generalId,
                        amount,
                    })),
                    reason: 'cancel',
                });
            }

            await Promise.all([store.setParticipants([]), store.setMatches([]), store.setBettingEntries([])]);

            const gameTime = await loadCurrentGameTime(ctx.db);
            const nextState: TournamentState = {
                ...state,
                stage: 0,
                phase: 0,
                auto: false,
                winnerId: undefined,
                bettingSettled: true,
                rewardSettled: false,
                bettingCloseAt: undefined,
                participantsLockedAt: undefined,
                nextAt: gameTime.now.toISOString(),
            };
            await store.setState(nextState);
            return { ok: true };
        });
    }),
    // This route delegates its game mutations to durable ENGINE input events.
    // Wrapping it in the API input-event transaction would hold the clock
    // advisory lock while waiting for the daemon to claim the child event.
    placeBet: engineAuthedProcedure
        .input(
            z.object({
                targetId: z.number().int().positive(),
                amount: z.number().int().min(10),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const general = await getMyGeneral(ctx);
            const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
            return withTournamentBetClockMutation(ctx, store, async () => {
                const state = await store.getState();
                if (!state || state.stage !== 6) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: '베팅 기간이 아닙니다.' });
                }
                const closeAt = state.bettingCloseAt ? new Date(state.bettingCloseAt).getTime() : 0;
                const gameNow = (await loadCurrentGameTime(ctx.db)).now.getTime();
                if (closeAt && closeAt <= gameNow) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: '베팅이 마감되었습니다.' });
                }

                const [matches, entries] = await Promise.all([store.getMatches(), store.getBettingEntries()]);
                const candidateIds = new Set<number>();
                for (const match of matches) {
                    if (match.stage === 7) {
                        candidateIds.add(match.attackerId);
                        candidateIds.add(match.defenderId);
                    }
                }
                if (!candidateIds.has(input.targetId)) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: '올바르지 않은 베팅 대상입니다.' });
                }

                const previousBetAmount = entries
                    .filter((entry) => entry.generalId === general.id)
                    .reduce((sum, entry) => sum + entry.amount, 0);
                if (previousBetAmount + input.amount > 1_000) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: `${1_000 - previousBetAmount}금까지만 베팅 가능합니다.`,
                    });
                }

                const adjustResult = await ctx.turnDaemon.requestCommand({
                    type: 'adjustGeneralResources',
                    requestId: tournamentBetCommandRequestId(ctx.requestId, 'resources'),
                    reason: 'tournamentBet',
                    adjustments: [{ generalId: general.id, goldDelta: -input.amount, minGoldAfter: 500 }],
                });
                if (!adjustResult || adjustResult.type !== 'adjustGeneralResources') {
                    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
                }
                if (!adjustResult.ok || adjustResult.processed !== 1) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: adjustResult.ok ? '금이 부족합니다.' : adjustResult.reason,
                    });
                }

                const rankResult = await ctx.turnDaemon.requestCommand({
                    type: 'adjustGeneralMeta',
                    requestId: tournamentBetCommandRequestId(ctx.requestId, 'rank'),
                    reason: 'tournamentBet',
                    adjustments: [
                        {
                            generalId: general.id,
                            metaDelta: { betgold: input.amount },
                        },
                    ],
                });
                if (!rankResult || rankResult.type !== 'adjustGeneralMeta' || !rankResult.ok) {
                    await ctx.turnDaemon.requestCommand({
                        type: 'adjustGeneralResources',
                        requestId: tournamentBetCommandRequestId(ctx.requestId, 'rank-rollback-resources'),
                        reason: 'tournamentBetRollback',
                        adjustments: [{ generalId: general.id, goldDelta: input.amount }],
                    });
                    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '베팅 기록을 저장하지 못했습니다.' });
                }

                try {
                    await store.appendBettingEntry({
                        generalId: general.id,
                        targetId: input.targetId,
                        amount: input.amount,
                    });
                } catch (error) {
                    await Promise.all([
                        ctx.turnDaemon.requestCommand({
                            type: 'adjustGeneralResources',
                            requestId: tournamentBetCommandRequestId(ctx.requestId, 'projection-rollback-resources'),
                            reason: 'tournamentBetRollback',
                            adjustments: [{ generalId: general.id, goldDelta: input.amount }],
                        }),
                        ctx.turnDaemon.requestCommand({
                            type: 'adjustGeneralMeta',
                            requestId: tournamentBetCommandRequestId(ctx.requestId, 'projection-rollback-rank'),
                            reason: 'tournamentBetRollback',
                            adjustments: [
                                {
                                    generalId: general.id,
                                    metaDelta: { betgold: -input.amount },
                                },
                            ],
                        }),
                    ]);
                    throw error;
                }
                return { ok: true };
            });
        }),
});
