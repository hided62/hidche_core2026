import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { engineAuthedProcedure } from '../../../trpc.js';
import { getAuthenticatedUserId, getMyGeneral } from '../../shared/general.js';
import { assertNationAccess, assertNationEditable, updateNationSetting } from '../shared.js';

export const setBlockWar = engineAuthedProcedure
    .input(
        z.object({
            value: z.boolean(),
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

        const result = await updateNationSetting(ctx, userId, me, 'setBlockWar', {
            kind: 'blockWar',
            value: input.value,
        });
        return { availableCnt: result.availableCnt ?? 0 };
    });
