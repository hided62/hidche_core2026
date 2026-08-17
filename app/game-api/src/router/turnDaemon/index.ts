import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '../../trpc.js';

const zRunReason = z.enum(['schedule', 'manual', 'poke']);

const zTurnRunBudget = z.object({
    budgetMs: z.number().int().positive(),
    maxGenerals: z.number().int().positive(),
    catchUpCap: z.number().int().positive(),
});

const turnDaemonAdminProcedure = authedProcedure.use(({ ctx, next }) => {
    const roles = ctx.auth?.user.roles ?? [];
    const profileName = ctx.profile.name;
    const canManageProfile =
        roles.includes('superuser') ||
        roles.includes('admin') ||
        roles.includes('admin.superuser') ||
        roles.includes('admin.profiles.runtime') ||
        roles.includes('admin.profiles.runtime:*') ||
        roles.includes(`admin.profiles.runtime:${profileName}`);
    if (!canManageProfile) {
        throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Profile administration permission is required.',
        });
    }
    return next();
});

export const turnDaemonRouter = router({
    run: turnDaemonAdminProcedure
        .input(
            z.object({
                reason: zRunReason,
                targetTime: z.string().min(1).optional(),
                budget: zTurnRunBudget.optional(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const requestId = await ctx.turnDaemon.sendCommand({
                type: 'run',
                reason: input.reason,
                targetTime: input.targetTime,
                budget: input.budget,
            });
            return { accepted: true, requestId };
        }),
    pause: turnDaemonAdminProcedure
        .input(
            z
                .object({
                    reason: z.string().min(1).optional(),
                })
                .optional()
        )
        .mutation(async ({ ctx, input }) => {
            const requestId = await ctx.turnDaemon.sendCommand({
                type: 'pause',
                reason: input?.reason,
            });
            return { accepted: true, requestId };
        }),
    resume: turnDaemonAdminProcedure
        .input(
            z
                .object({
                    reason: z.string().min(1).optional(),
                })
                .optional()
        )
        .mutation(async ({ ctx, input }) => {
            const requestId = await ctx.turnDaemon.sendCommand({
                type: 'resume',
                reason: input?.reason,
            });
            return { accepted: true, requestId };
        }),
    status: turnDaemonAdminProcedure
        .input(
            z
                .object({
                    timeoutMs: z.number().int().positive().optional(),
                })
                .optional()
        )
        .query(async ({ ctx, input }) => ctx.turnDaemon.requestStatus(input?.timeoutMs)),
});
