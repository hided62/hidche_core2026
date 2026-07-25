import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asRecord } from '@sammo-ts/common';

import { authedProcedure } from '../../../trpc.js';
import { getMyGeneral } from '../../shared/general.js';
import { assertNationAccess, assertNationEditable, updateNationMeta } from '../shared.js';

export const setBlockScout = authedProcedure
    .input(
        z.object({
            value: z.boolean(),
        })
    )
    .mutation(async ({ ctx, input }) => {
        const me = await getMyGeneral(ctx);
        assertNationAccess(me);
        const [nation, worldState] = await Promise.all([
            ctx.db.nation.findUnique({
                where: { id: me.nationId },
                select: { meta: true },
            }),
            ctx.db.worldState.findFirst({
                select: { meta: true },
            }),
        ]);
        if (!nation) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
        }
        assertNationEditable(me, nation.meta);
        const worldMeta = asRecord(worldState?.meta);
        if (worldMeta.block_change_scout === true) {
            throw new TRPCError({
                code: 'FORBIDDEN',
                message: '임관 설정을 바꿀 수 없도록 설정되어 있습니다.',
            });
        }
        const nationMeta = asRecord(nation.meta);
        await updateNationMeta(
            ctx,
            me.nationId,
            {
                scout: input.value ? 1 : 0,
            },
            nationMeta
        );
        return { ok: true };
    });
