import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { purifyNationHtml } from '../../../security/nationHtml.js';
import { engineAuthedProcedure } from '../../../trpc.js';
import { getAuthenticatedUserId, getMyGeneral } from '../../shared/general.js';
import { legacyRequiredText } from '../settingInput.js';
import { assertNationAccess, assertNationEditable, updateNationSetting } from '../shared.js';

export const setNotice = engineAuthedProcedure
    .input(z.object({ msg: legacyRequiredText(16_384) }))
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
        const msg = purifyNationHtml(input.msg);
        await updateNationSetting(ctx, userId, me, 'setNotice', { kind: 'notice', message: msg });
        return { ok: true, msg };
    });
