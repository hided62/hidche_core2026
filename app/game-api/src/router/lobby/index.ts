import { TRPCError } from '@trpc/server';

import { zWorldStateConfig, zWorldStateMeta } from '../../context.js';
import { procedure, router } from '../../trpc.js';

export const lobbyRouter = router({
    info: procedure.query(async ({ ctx }) => {
        const rawWorldState = await ctx.db.worldState.findFirst();
        if (!rawWorldState) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'World state not found',
            });
        }

        const worldState = {
            ...rawWorldState,
            config: zWorldStateConfig.parse(rawWorldState.config),
            meta: zWorldStateMeta.parse(rawWorldState.meta),
        };

        const userCnt = await ctx.db.general.count({ where: { npcState: 0 } });
        const npcCnt = await ctx.db.general.count({ where: { npcState: { gt: 0 } } });
        const nationCnt = await ctx.db.nation.count({ where: { level: { gt: 0 } } });

        let myGeneral = null;
        if (ctx.auth?.user.id) {
            const general = await ctx.db.general.findFirst({
                where: { userId: ctx.auth.user.id },
                select: { name: true, picture: true },
            });
            if (general) {
                myGeneral = {
                    name: general.name,
                    picture: general.picture,
                };
            }
        }

        return {
            year: worldState.currentYear,
            month: worldState.currentMonth,
            userCnt,
            maxUserCnt: worldState.config.maxUserCnt ?? 500,
            npcCnt,
            nationCnt,
            turnTerm: worldState.tickSeconds / 60,
            fictionMode: worldState.config.fictionMode ?? '사실',
            starttime: worldState.meta.starttime ?? '',
            opentime: worldState.meta.opentime ?? '',
            turntime: worldState.meta.turntime ?? '',
            otherTextInfo: worldState.meta.otherTextInfo ?? '',
            isUnited: worldState.meta.isUnited ?? 0,
            myGeneral,
        };
    }),
});
