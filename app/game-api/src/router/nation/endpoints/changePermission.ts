import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { engineAuthedProcedure } from '../../../trpc.js';
import { getAuthenticatedUserId, getMyGeneral } from '../../shared/general.js';
import { throwIfCommandRejected } from '../../shared/turnDaemon.js';

export const changePermission = engineAuthedProcedure
    .input(
        z.object({
            isAmbassador: z.boolean(),
            targetGeneralIds: z
                .array(z.number().int().positive())
                .max(2)
                .refine((ids) => new Set(ids).size === ids.length, '중복된 장수를 지정할 수 없습니다.'),
        })
    )
    .mutation(async ({ ctx, input }) => {
        const userId = getAuthenticatedUserId(ctx);
        const general = await getMyGeneral(ctx);
        const result = await ctx.turnDaemon.requestCommand({
            type: 'changePermission',
            ...(ctx.requestId
                ? { requestId: `${ctx.requestId}:nation.changePermission:engine:0:changePermission` }
                : {}),
            userId,
            generalId: general.id,
            isAmbassador: input.isAmbassador,
            targetGeneralIds: input.targetGeneralIds,
        });
        throwIfCommandRejected(result);
        if (!result || result.type !== 'changePermission') {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
        }
        if (!result.ok) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
        }
        return { ok: true };
    });
