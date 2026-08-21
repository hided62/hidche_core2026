import { TRPCError } from '@trpc/server';

import { accessAuthedProcedure } from '../../../trpc.js';
import { getMyGeneral } from '../../shared/general.js';
import { resolveSecretPermission } from '../../shared/secretPermission.js';
import { MAX_NATION_TURNS, getNationTurnSnapshots } from '../../../turns/reservedTurns.js';
import { assertNationAccess } from '../shared.js';

export const getChiefCenter = accessAuthedProcedure.query(async ({ ctx }) => {
    const me = await getMyGeneral(ctx);
    assertNationAccess(me);

    const [nation, worldState, nationGenerals] = await Promise.all([
        ctx.db.nation.findUnique({
            where: { id: me.nationId },
            select: {
                id: true,
                name: true,
                level: true,
                meta: true,
            },
        }),
        ctx.db.worldState.findFirst(),
        ctx.db.general.findMany({
            where: { nationId: me.nationId, officerLevel: { gte: 5 } },
            select: {
                id: true,
                name: true,
                officerLevel: true,
                npcState: true,
                turnTime: true,
            },
        }),
    ]);

    if (!nation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
    }
    if (!worldState) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'World state is not initialized.' });
    }

    const permissionLevel = resolveSecretPermission(
        {
            nationId: me.nationId,
            officerLevel: me.officerLevel,
            meta: me.meta,
            penalty: me.penalty,
        },
        nation.meta
    );
    if (permissionLevel < 1) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
    }

    const chiefLevels = [12, 10, 8, 6, 11, 9, 7, 5];
    const generalByLevel = new Map(nationGenerals.map((general) => [general.officerLevel, general]));

    const turnsByLevel = await getNationTurnSnapshots(ctx.db, nation.id, chiefLevels);

    const chiefs = chiefLevels.map((level) => {
        const entry = generalByLevel.get(level);
        const snapshot = turnsByLevel.get(level);
        return {
            officerLevel: level,
            name: entry?.name ?? null,
            npcState: entry?.npcState ?? null,
            turnTime: entry?.turnTime ? entry.turnTime.toISOString() : null,
            revision: snapshot?.revision ?? 0,
            turns: snapshot?.turns ?? [],
        };
    });

    return {
        me: {
            id: me.id,
            officerLevel: me.officerLevel,
            nationId: me.nationId,
        },
        nation: {
            id: nation.id,
            name: nation.name,
            level: nation.level,
        },
        currentYear: worldState.currentYear,
        currentMonth: worldState.currentMonth,
        turnTermMinutes: Math.max(1, Math.round(worldState.tickSeconds / 60)),
        maxTurns: MAX_NATION_TURNS,
        chiefs,
    };
});
