import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { GamePrisma } from '@sammo-ts/infra';
import type { GameApiContext } from '../../context.js';
import { authedProcedure } from '../../trpc.js';
import { getAuthenticatedUserId } from '../shared/general.js';
import { resolveSecretPermission } from '../shared/secretPermission.js';
import { projectPolicyConfiguration, projectPolicySummary } from '../playAudit/policies.js';
import { readAudit, readAuditWorld } from '../playAudit/shared.js';

const area = z.enum(['NPC_VALUES', 'NPC_NATION_PRIORITY', 'NPC_GENERAL_PRIORITY']);
const summarySelect = {
    id: true,
    schemaVersion: true,
    nationId: true,
    area: true,
    revision: true,
    previousId: true,
    source: true,
    year: true,
    month: true,
    actor: true,
    createdAt: true,
} satisfies GamePrisma.PlayAuditPolicySelect;

// 소속·기밀 권한과 이력을 같은 snapshot에서 읽어 이적/권한 변경 경합을 막는다.
const readNationId = async (ctx: GameApiContext, tx: GamePrisma.TransactionClient): Promise<number> => {
    const general = await tx.general.findFirst({ where: { userId: getAuthenticatedUserId(ctx) } });
    if (!general) throw new TRPCError({ code: 'NOT_FOUND', message: '장수 정보를 찾을 수 없습니다.' });
    if (general.nationId <= 0)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '국가에 소속되어있지 않습니다.' });
    const nation = await tx.nation.findUnique({ where: { id: general.nationId }, select: { meta: true } });
    if (!nation) throw new TRPCError({ code: 'NOT_FOUND', message: '국가 정보를 찾을 수 없습니다.' });
    if (resolveSecretPermission(general, nation.meta) < 1)
        throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
    return general.nationId;
};

export const policyHistory = authedProcedure
    .input(
        z
            .object({
                area,
                cursor: z.number().int().positive().optional(),
                limit: z.number().int().min(1).max(50).default(20),
            })
            .strict()
    )
    .query(({ ctx, input }) =>
        readAudit(ctx, async (tx) => {
            const nationId = await readNationId(ctx, tx);
            const world = await readAuditWorld(tx);
            const rows = world.serverId
                ? await tx.playAuditPolicy.findMany({
                      where: {
                          serverId: world.serverId,
                          nationId,
                          area: input.area,
                          revision: input.cursor === undefined ? undefined : { lt: input.cursor },
                      },
                      orderBy: { revision: 'desc' },
                      take: input.limit + 1,
                      select: summarySelect,
                  })
                : [];
            return {
                coverage: world.serverId ? ('RECORDED_VERSIONS_ONLY' as const) : ('IDENTITY_MISSING' as const),
                historyGap: world.historyGap,
                items: rows.slice(0, input.limit).map(projectPolicySummary),
                nextCursor: rows.length > input.limit ? rows[input.limit - 1]!.revision : null,
            };
        })
    );

export const policyVersion = authedProcedure
    .input(z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }).strict())
    .query(({ ctx, input }) =>
        readAudit(ctx, async (tx) => {
            const nationId = await readNationId(ctx, tx);
            const world = await readAuditWorld(tx);
            const row = world.serverId
                ? await tx.playAuditPolicy.findFirst({
                      where: { id: input.id, serverId: world.serverId, nationId, area: { in: area.options } },
                      select: { ...summarySelect, before: true, after: true },
                  })
                : null;
            if (!row)
                throw new TRPCError({ code: 'NOT_FOUND', message: '자국의 현재 기수 정책 기록을 찾을 수 없습니다.' });
            return projectPolicyConfiguration(row);
        })
    );
