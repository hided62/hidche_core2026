import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { engineAuthedProcedure } from '../../../trpc.js';
import { getAuthenticatedUserId, getMyGeneral } from '../../shared/general.js';
import { assertNationAccess, assertNationEditable, updateNationSetting } from '../shared.js';

export const setRate = engineAuthedProcedure
    .input(
        z.object({
            amount: z.number().int().min(5).max(30),
        })
    )
    .mutation(async ({ ctx, input }) => {
        const userId = getAuthenticatedUserId(ctx);
        const me = await getMyGeneral(ctx);
        assertNationAccess(me);
        const nation = await ctx.db.nation.findUnique({
            where: { id: me.nationId },
            select: { meta: true },
        });
        if (!nation) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
        }
        assertNationEditable(me, nation.meta);
        await updateNationSetting(ctx, userId, me, 'setRate', { kind: 'rate', amount: input.amount });
        return { ok: true };
    });
