import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { engineAuthedProcedure } from '../../../trpc.js';
import { getAuthenticatedUserId, getMyGeneral } from '../../shared/general.js';
import { assertNationAccess, assertNationEditable, updateNationSetting } from '../shared.js';

export const setSecretLimit = engineAuthedProcedure
    .input(
        z.object({
            amount: z.number().int().min(1).max(99),
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
        await updateNationSetting(ctx, userId, me, 'setSecretLimit', {
            kind: 'secretLimit',
            amount: input.amount,
        });
        return { ok: true };
    });
