import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure } from '../../../trpc.js';
import { getMyGeneral } from '../../shared/general.js';

export const changePermission = authedProcedure
    .input(
        z.object({
            isAmbassador: z.boolean(),
            targetGeneralIds: z.array(z.number().int().positive()),
        })
    )
    .mutation(async ({ ctx, input }) => {
        const general = await getMyGeneral(ctx);
        const result = await ctx.turnDaemon.requestCommand({
            type: 'changePermission',
            generalId: general.id,
            isAmbassador: input.isAmbassador,
            targetGeneralIds: input.targetGeneralIds,
        });
        if (!result || result.type !== 'changePermission') {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
        }
        if (!result.ok) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
        }
        return { ok: true };
    });
