import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { auditProcedure, monthOrdinal, readAudit, readAuditWorld } from './shared.js';

const categoryByType = {
    generalHistory: 'HISTORY',
    generalAction: 'ACTION',
    battleResult: 'BATTLE_BRIEF',
    battleDetail: 'BATTLE_DETAIL',
} as const;
export const generalLogs = auditProcedure
    .input(
        z
            .object({
                generalId: z.number().int().nonnegative(),
                type: z.enum(['generalHistory', 'generalAction', 'battleResult', 'battleDetail']),
                month: z
                    .object({ year: z.number().int().min(0).max(9999), month: z.number().int().min(1).max(12) })
                    .strict()
                    .optional(),
                cursor: z.number().int().positive().optional(),
                limit: z.number().int().min(1).max(200).default(50),
            })
            .strict()
    )
    .query(({ ctx, input }) =>
        readAudit(ctx, async (tx) => {
            const world = await readAuditWorld(tx);
            if (
                input.month &&
                (monthOrdinal(input.month.year, input.month.month) < monthOrdinal(world.startYear, world.startMonth) ||
                    monthOrdinal(input.month.year, input.month.month) > monthOrdinal(world.year, world.month))
            ) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '현재 기수 안의 로그 월을 선택해 주세요.' });
            }
            const rows = world.serverId
                ? await tx.logEntry.findMany({
                      where: {
                          serverId: world.serverId,
                          generalId: input.generalId,
                          scope: 'GENERAL',
                          category: categoryByType[input.type],
                          id: input.cursor === undefined ? undefined : { lt: input.cursor },
                          year: input.month?.year,
                          month: input.month?.month,
                      },
                      orderBy: { id: 'desc' },
                      take: input.limit + 1,
                      select: { id: true, year: true, month: true, text: true, createdAt: true },
                  })
                : [];
            return {
                ...world,
                type: input.type,
                coverage: world.serverId ? ('IDENTIFIED_LOGS_ONLY' as const) : ('IDENTITY_MISSING' as const),
                items: rows.slice(0, input.limit),
                nextCursor: rows.length > input.limit ? rows[input.limit - 1]!.id : null,
            };
        })
    );
