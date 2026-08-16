import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { engineAuthedProcedure } from '../../../trpc.js';
import { getMyGeneral } from '../../shared/general.js';

export const appoint = engineAuthedProcedure
    .input(
        z.object({
            destGeneralId: z.number().int().nonnegative(),
            destCityId: z.number().int().nonnegative(),
            officerLevel: z.number().int().nonnegative(),
        })
    )
    .mutation(async ({ ctx, input }) => {
        const general = await getMyGeneral(ctx);
        const result = await ctx.turnDaemon.requestCommand({
            type: 'appoint',
            ...(ctx.requestId ? { requestId: `${ctx.requestId}:nation.appoint:engine:0:appoint` } : {}),
            generalId: general.id,
            destGeneralId: input.destGeneralId,
            destCityId: input.destCityId,
            officerLevel: input.officerLevel,
        });
        if (!result || result.type !== 'appoint') {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
        }
        if (!result.ok) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
        }
        return { ok: true };
    });
