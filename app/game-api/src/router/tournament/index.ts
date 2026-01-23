import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asRecord } from '@sammo-ts/common';
import type { TournamentType } from '@sammo-ts/logic';
import type { TournamentState } from '../../tournament/types.js';

import { TournamentStore } from '../../tournament/store.js';
import { buildTournamentKeys } from '../../tournament/keys.js';
import { authedProcedure, procedure, router } from '../../trpc.js';

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

const adminProcedure = authedProcedure.use(({ ctx, next }) => {
    const roles = ctx.auth?.user.roles ?? [];
    if (!hasAdminRole(roles, ctx.profile.name)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin permission is required.' });
    }
    return next();
});

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
});

const zMatch = z.object({
    id: z.number().int().positive(),
    stage: z.number().int().min(0),
    roundIndex: z.number().int().min(0),
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

export const tournamentRouter = router({
    getState: procedure.query(async ({ ctx }) => {
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
        return store.getState();
    }),
    getAdminStatus: adminProcedure.query(async () => ({ ok: true })),
    getSnapshot: procedure.query(async ({ ctx }) => {
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
        const [state, participants, matches, bets] = await Promise.all([
            store.getState(),
            store.getParticipants(),
            store.getMatches(),
            store.getBettingEntries(),
        ]);
        return { state, participants, matches, bets };
    }),
    setState: adminProcedure.input(zTournamentState).mutation(async ({ ctx, input }) => {
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
        await store.setState({
            ...input,
            type: input.type as TournamentType,
        });
        return { ok: true };
    }),
    patchState: adminProcedure.input(zTournamentState.partial()).mutation(async ({ ctx, input }) => {
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
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
    }),
    setParticipants: adminProcedure.input(z.array(zParticipant)).mutation(async ({ ctx, input }) => {
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
        await store.setParticipants(input);
        return { ok: true, count: input.length };
    }),
    setMatches: adminProcedure.input(z.array(zMatch)).mutation(async ({ ctx, input }) => {
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
        await store.setMatches(input);
        return { ok: true, count: input.length };
    }),
    setBettingEntries: adminProcedure.input(z.array(zBetEntry)).mutation(async ({ ctx, input }) => {
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
        await store.setBettingEntries(input);
        return { ok: true, count: input.length };
    }),
    seedParticipants: adminProcedure.input(zSeedParticipants).mutation(async ({ ctx, input }) => {
        const limit = input.limit ?? 64;
        const includeNpc = input.includeNpc ?? true;
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));

        const generals = input.generalIds && input.generalIds.length > 0
            ? await ctx.db.general.findMany({
                  where: { id: { in: input.generalIds } },
                  select: { id: true, name: true, leadership: true, strength: true, intel: true, meta: true },
              })
            : await ctx.db.general.findMany({
                  where: includeNpc ? {} : { npcState: 0 },
                  orderBy: [
                      { leadership: 'desc' },
                      { strength: 'desc' },
                      { intel: 'desc' },
                      { id: 'asc' },
                  ],
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

        await store.setParticipants(participants);
        return { ok: true, count: participants.length };
    }),
    getBettingSummary: authedProcedure.query(async ({ ctx }) => {
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
        const userId = ctx.auth?.user.id;
        const general = userId
            ? await ctx.db.general.findFirst({ where: { userId }, select: { id: true } })
            : null;

        for (const entry of entries) {
            if (!candidateIds.has(entry.targetId)) {
                continue;
            }
            totals[entry.targetId] = (totals[entry.targetId] ?? 0) + entry.amount;
            totalAmount += entry.amount;
            if (general && entry.generalId === general.id) {
                myTotals[entry.targetId] = (myTotals[entry.targetId] ?? 0) + entry.amount;
                myAmount += entry.amount;
            }
        }

        return { state, totals, myTotals, totalAmount, myAmount };
    }),
    join: authedProcedure.mutation(async ({ ctx }) => {
        const userId = ctx.auth?.user.id;
        if (!userId) {
            throw new TRPCError({ code: 'UNAUTHORIZED' });
        }
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
        const state = await store.getState();
        if (!state || state.stage !== 1 || state.participantsLockedAt) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '참가 신청 기간이 아닙니다.' });
        }

        const participants = await store.getParticipants();

        const general = await ctx.db.general.findFirst({
            where: { userId },
            select: { id: true, name: true, leadership: true, strength: true, intel: true, meta: true },
        });
        if (!general) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '장수 정보를 찾을 수 없습니다.' });
        }

        const nextMeta = { ...asRecord(general.meta), tnmt: 1 };
        await ctx.db.general.update({
            where: { id: general.id },
            data: { meta: nextMeta },
        });

        const already = participants.find((entry) => entry.id === general.id);
        if (already) {
            return { ok: true, count: participants.length };
        }

        if (participants.length >= 64) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '참가 인원이 가득 찼습니다.' });
        }

        const meta = asRecord(general.meta);
        const level = typeof meta.explevel === 'number' ? meta.explevel : 0;
        const next = participants.concat({
            id: general.id,
            name: general.name,
            leadership: general.leadership,
            strength: general.strength,
            intel: general.intel,
            level,
        });

        await store.setParticipants(next);
        return { ok: true, count: next.length };
    }),
    cancel: adminProcedure.mutation(async ({ ctx }) => {
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
        const state = await store.getState();
        if (!state) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Tournament state not found.' });
        }

        const [participants, bets] = await Promise.all([
            store.getParticipants(),
            store.getBettingEntries(),
        ]);

        const worldState = await ctx.db.worldState.findFirst();
        const config = asRecord(worldState?.config ?? {});
        const constValues = asRecord(config.const ?? config);
        const develCost = resolveNumber(constValues, ['develCost', 'develcost', 'develrate'], 0);

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

        await Promise.all([
            store.setParticipants([]),
            store.setMatches([]),
            store.setBettingEntries([]),
        ]);

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
            nextAt: new Date().toISOString(),
        };
        await store.setState(nextState);
        return { ok: true };
    }),
    placeBet: authedProcedure
        .input(
            z.object({
                targetId: z.number().int().positive(),
                amount: z.number().int().positive(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const userId = ctx.auth?.user.id;
            if (!userId) {
                throw new TRPCError({ code: 'UNAUTHORIZED' });
            }
            const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
            const state = await store.getState();
            if (!state || state.stage !== 6) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '베팅 기간이 아닙니다.' });
            }
            const closeAt = state.bettingCloseAt ? new Date(state.bettingCloseAt).getTime() : 0;
            if (closeAt && closeAt <= Date.now()) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '베팅이 마감되었습니다.' });
            }

            const matches = await store.getMatches();
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

            const general = await ctx.db.general.findFirst({
                where: { userId },
                select: { id: true, gold: true },
            });
            if (!general) {
                throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '장수가 존재하지 않습니다.' });
            }

            const minRemainGold = 500;
            if (general.gold - input.amount < minRemainGold) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '소지금이 부족합니다.' });
            }

            await ctx.db.general.update({
                where: { id: general.id },
                data: { gold: general.gold - input.amount },
            });

            await store.appendBettingEntry({
                generalId: general.id,
                targetId: input.targetId,
                amount: input.amount,
            });

            return { ok: true };
        }),
});
