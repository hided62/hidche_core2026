import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { LogCategory, LogScope } from '@sammo-ts/infra';

import { authedProcedure } from '../../../trpc.js';
import { getMyGeneral } from '../../shared/general.js';
import { assertNationAccess, resolveNationPermission, zGeneralLogType, type GeneralLogType } from '../shared.js';

export const getGeneralLog = authedProcedure
    .input(
        z.object({
            generalId: z.number().int().positive(),
            type: zGeneralLogType,
            beforeId: z.number().int().positive().optional(),
        })
    )
    .query(async ({ ctx, input }) => {
        const me = await getMyGeneral(ctx);
        assertNationAccess(me);

        const [nation, target] = await Promise.all([
            ctx.db.nation.findUnique({
                where: { id: me.nationId },
                select: { meta: true },
            }),
            ctx.db.general.findUnique({
                where: { id: input.generalId },
                select: { id: true, nationId: true, npcState: true },
            }),
        ]);

        if (!nation) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
        }
        if (!target) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'General not found' });
        }

        const permissionLevel = resolveNationPermission(me, nation.meta, true);
        if (permissionLevel < 1) {
            throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
        }
        if (target.nationId !== me.nationId) {
            throw new TRPCError({ code: 'FORBIDDEN', message: '같은 나라의 장수가 아닙니다.' });
        }
        if (input.type === 'generalAction' && target.npcState < 2 && target.id !== me.id && permissionLevel < 2) {
            throw new TRPCError({
                code: 'FORBIDDEN',
                message: '권한이 부족합니다. 유저 장수의 개인 기록은 수뇌만 열람 가능합니다.',
            });
        }

        const categoryMap: Record<GeneralLogType, LogCategory> = {
            generalHistory: LogCategory.HISTORY,
            generalAction: LogCategory.ACTION,
            battleResult: LogCategory.BATTLE_BRIEF,
            battleDetail: LogCategory.BATTLE_DETAIL,
        };

        const logs = await ctx.db.logEntry.findMany({
            where: {
                generalId: target.id,
                scope: LogScope.GENERAL,
                category: categoryMap[input.type],
                ...(input.type !== 'generalHistory' && input.beforeId ? { id: { lt: input.beforeId } } : {}),
            },
            orderBy: { id: 'desc' },
            ...(input.type === 'generalHistory' ? {} : { take: 30 }),
        });

        return {
            type: input.type,
            generalId: target.id,
            logs: logs.map((entry) => ({
                id: entry.id,
                text: entry.text,
            })),
        };
    });
