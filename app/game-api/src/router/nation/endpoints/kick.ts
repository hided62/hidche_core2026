import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { engineAuthedProcedure } from '../../../trpc.js';
import { getAuthenticatedUserId, getMyGeneral } from '../../shared/general.js';
import { throwIfCommandRejected } from '../../shared/turnDaemon.js';

export const kick = engineAuthedProcedure
    .input(z.object({ destGeneralId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
        const userId = getAuthenticatedUserId(ctx);
        const general = await getMyGeneral(ctx);
        const result = await ctx.turnDaemon.requestCommand({
            type: 'kick',
            ...(ctx.requestId ? { requestId: `${ctx.requestId}:nation.kick:engine:0:kick` } : {}),
            userId,
            generalId: general.id,
            destGeneralId: input.destGeneralId,
        });
        throwIfCommandRejected(result);
        if (!result || result.type !== 'kick') {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
        }
        if (!result.ok) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
        }
        return { ok: true };
    });
