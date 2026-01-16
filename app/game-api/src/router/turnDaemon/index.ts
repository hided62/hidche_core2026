import { z } from 'zod';

import { procedure, router } from '../../trpc.js';

const zRunReason = z.enum(['schedule', 'manual', 'poke']);

const zTurnRunBudget = z.object({
    budgetMs: z.number().int().positive(),
    maxGenerals: z.number().int().positive(),
    catchUpCap: z.number().int().positive(),
});

export const turnDaemonRouter = router({
    run: procedure
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
    pause: procedure
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
    resume: procedure
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
    status: procedure
        .input(
            z
                .object({
                    timeoutMs: z.number().int().positive().optional(),
                })
                .optional()
        )
        .query(async ({ ctx, input }) => ctx.turnDaemon.requestStatus(input?.timeoutMs)),
});
