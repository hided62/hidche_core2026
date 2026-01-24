import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asRecord } from '@sammo-ts/common';

import { authedProcedure } from '../../../trpc.js';
import { getMyGeneral } from '../../shared/general.js';
import { assertNationAccess, assertNationEditable, resolveWarSettingRemain, updateNationMeta } from '../shared.js';

export const setBlockWar = authedProcedure
    .input(
        z.object({
            value: z.boolean(),
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

        const meta = asRecord(nation.meta);
        const remain = resolveWarSettingRemain(meta);
        if (remain <= 0) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '잔여 횟수가 부족합니다.' });
        }
        const nextRemain = Math.max(0, remain - 1);
        await updateNationMeta(
            ctx,
            me.nationId,
            {
                war: input.value ? 1 : 0,
                available_war_setting_cnt: nextRemain,
            },
            meta
        );
        return { availableCnt: nextRemain };
    });
