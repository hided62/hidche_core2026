import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '../../trpc.js';

export const troopRouter = router({
    join: authedProcedure
        .input(
            z.object({
                generalId: z.number().int().positive(),
                troopId: z.number().int().positive(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const result = await ctx.turnDaemon.requestCommand({
                type: 'troopJoin',
                generalId: input.generalId,
                troopId: input.troopId,
            });
            if (!result) {
                throw new TRPCError({
                    code: 'TIMEOUT',
                    message: 'Turn daemon did not respond.',
                });
            }
            if (result.type !== 'troopJoin') {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Unexpected turn daemon response.',
                });
            }
            if (!result.ok) {
                throw new TRPCError({
                    code: 'PRECONDITION_FAILED',
                    message: result.reason,
                });
            }

            return { ok: true };
        }),
    exit: authedProcedure
        .input(
            z.object({
                generalId: z.number().int().positive(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const result = await ctx.turnDaemon.requestCommand({
                type: 'troopExit',
                generalId: input.generalId,
            });
            if (!result) {
                throw new TRPCError({
                    code: 'TIMEOUT',
                    message: 'Turn daemon did not respond.',
                });
            }
            if (result.type !== 'troopExit') {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Unexpected turn daemon response.',
                });
            }
            if (!result.ok) {
                throw new TRPCError({
                    code: 'PRECONDITION_FAILED',
                    message: result.reason,
                });
            }

            return { ok: true, wasLeader: result.wasLeader };
        }),
});
