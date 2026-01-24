import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asRecord } from '@sammo-ts/common';

import { authedProcedure } from '../../../trpc.js';
import { getMyGeneral } from '../../shared/general.js';
import { assertNationAccess, assertNationEditable, updateNationMeta } from '../shared.js';

export const setSecretLimit = authedProcedure
    .input(
        z.object({
            amount: z.number().int().min(1).max(99),
        })
    )
    .mutation(async ({ ctx, input }) => {
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
        const nationMeta = asRecord(nation.meta);
        await updateNationMeta(
            ctx,
            me.nationId,
            {
                secretlimit: input.amount,
            },
            nationMeta
        );
        return { ok: true };
    });
