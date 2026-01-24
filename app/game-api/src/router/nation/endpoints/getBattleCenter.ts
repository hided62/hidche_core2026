import { TRPCError } from '@trpc/server';

import { LogCategory } from '@sammo-ts/infra';

import { authedProcedure } from '../../../trpc.js';
import { getMyGeneral } from '../../shared/general.js';
import { assertNationAccess, formatDateTime, resolveNationPermission } from '../shared.js';

export const getBattleCenter = authedProcedure.query(async ({ ctx }) => {
    const me = await getMyGeneral(ctx);
    assertNationAccess(me);

    const [nation, worldState, generalRows] = await Promise.all([
        ctx.db.nation.findUnique({
            where: { id: me.nationId },
            select: {
                id: true,
                name: true,
                color: true,
                level: true,
                meta: true,
            },
        }),
        ctx.db.worldState.findFirst(),
        ctx.db.general.findMany({
            where: { nationId: me.nationId },
            select: {
                id: true,
                name: true,
                npcState: true,
                officerLevel: true,
                cityId: true,
                turnTime: true,
                recentWarTime: true,
                leadership: true,
                strength: true,
                intel: true,
                experience: true,
                dedication: true,
                injury: true,
                gold: true,
                rice: true,
                crew: true,
                train: true,
                atmos: true,
            },
            orderBy: { id: 'asc' },
        }),
    ]);

    if (!nation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
    }
    if (!worldState) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'World state is not initialized.' });
    }

    const permissionLevel = resolveNationPermission(me, nation.meta, true);
    if (permissionLevel < 1) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
    }

    const generalIds = generalRows.map((general) => general.id);
    const battleCounts =
        generalIds.length > 0
            ? await ctx.db.logEntry.groupBy({
                  by: ['generalId'],
                  where: {
                      generalId: { in: generalIds },
                      category: LogCategory.BATTLE_BRIEF,
                  },
                  _count: { _all: true },
              })
            : [];
    const battleCountMap = new Map<number, number>();
    for (const row of battleCounts) {
        if (row.generalId !== null) {
            battleCountMap.set(row.generalId, row._count._all);
        }
    }

    const generals = generalRows.map((general) => ({
        id: general.id,
        name: general.name,
        npcState: general.npcState,
        officerLevel: general.officerLevel,
        cityId: general.cityId,
        turnTime: formatDateTime(general.turnTime),
        recentWar: formatDateTime(general.recentWarTime),
        warnum: battleCountMap.get(general.id) ?? 0,
        stats: {
            leadership: general.leadership,
            strength: general.strength,
            intelligence: general.intel,
        },
        experience: general.experience,
        dedication: general.dedication,
        injury: general.injury,
        gold: general.gold,
        rice: general.rice,
        crew: general.crew,
        train: general.train,
        atmos: general.atmos,
    }));

    return {
        me: {
            id: me.id,
            officerLevel: me.officerLevel,
            permissionLevel,
        },
        nation: {
            id: nation.id,
            name: nation.name,
            color: nation.color,
            level: nation.level,
        },
        currentYear: worldState.currentYear,
        currentMonth: worldState.currentMonth,
        turnTermMinutes: Math.max(1, Math.round(worldState.tickSeconds / 60)),
        generals,
    };
});
