import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { TournamentType } from '@sammo-ts/logic';

import { TournamentStore } from '../../tournament/store.js';
import { buildTournamentKeys } from '../../tournament/keys.js';
import { authedProcedure, procedure, router } from '../../trpc.js';

const hasAdminRole = (roles: string[], profileName: string): boolean => {
    if (roles.includes('superuser') || roles.includes('admin') || roles.includes('admin.superuser')) {
        return true;
    }
    return roles.some((role) => role === 'admin.tournament' || role === `admin.tournament:${profileName}`);
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
});

const zMatch = z.object({
    id: z.number().int().positive(),
    stage: z.number().int().min(0),
    roundIndex: z.number().int().min(0),
    attackerId: z.number().int().positive(),
    defenderId: z.number().int().positive(),
    winnerId: z.number().int().positive().optional(),
    log: z.array(z.string()).optional(),
});

const zBetEntry = z.object({
    generalId: z.number().int().positive(),
    targetId: z.number().int().positive(),
    amount: z.number().int().positive(),
});

export const tournamentRouter = router({
    getState: procedure.query(async ({ ctx }) => {
        const store = new TournamentStore(ctx.redis, buildTournamentKeys(ctx.profile.name));
        return store.getState();
    }),
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
