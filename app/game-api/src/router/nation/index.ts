import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '../../trpc.js';
import { getMyGeneral } from '../shared/general.js';

export const nationRouter = router({
    changePermission: authedProcedure
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
        }),
    kick: authedProcedure
        .input(z.object({ destGeneralId: z.number().int().positive() }))
        .mutation(async ({ ctx, input }) => {
            const general = await getMyGeneral(ctx);
            const result = await ctx.turnDaemon.requestCommand({
                type: 'kick',
                generalId: general.id,
                destGeneralId: input.destGeneralId,
            });
            if (!result || result.type !== 'kick') {
                throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
            }
            if (!result.ok) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
            }
            return { ok: true };
        }),
    appoint: authedProcedure
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
        }),
});
