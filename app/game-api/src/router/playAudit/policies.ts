import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { asRecord } from '@sammo-ts/common';
import type { GamePrisma } from '@sammo-ts/infra';
import { auditProcedure, monthOrdinal, readAudit, readAuditWorld, zAuditMonth } from './shared.js';

const zArea = z.enum(['NPC_VALUES', 'NPC_NATION_PRIORITY', 'NPC_GENERAL_PRIORITY', 'DEFENCE']);
const zMonth = zAuditMonth.omit({ kind: true });
const zActor = z
    .object({
        generalId: z.number().int(),
        name: z.string(),
        nationId: z.number().int(),
        officerLevel: z.number().int(),
        npcState: z.number().int(),
    })
    .nullable();
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
type Summary = GamePrisma.PlayAuditPolicyGetPayload<{ select: typeof summarySelect }>;

/** 향후 자국 권한 API의 공개 정보 경계. 실제 자국 인가는 호출부에서 별도로 수행한다. */
export const projectPolicySummary = (row: Summary) => {
    if (row.schemaVersion !== 1)
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '지원하지 않는 정책 기록 버전입니다.' });
    return {
        id: row.id,
        nationId: row.nationId,
        area: zArea.parse(row.area),
        revision: row.revision,
        previousId: row.previousId,
        source: z.enum(['BASELINE', 'CHANGE', 'OBSERVED_GAP']).parse(row.source),
        year: row.year,
        month: row.month,
        actor: zActor.parse(row.actor),
        createdAt: row.createdAt,
    };
};

/** 계정·요청·내부 진단 값을 제외한 정책 전후 projection이다. */
export const projectPolicyConfiguration = (
    row: Summary & { before: GamePrisma.JsonValue; after: GamePrisma.JsonValue }
) => {
    const before = row.before === null ? null : asRecord(row.before);
    const after = asRecord(row.after);
    return {
        ...projectPolicySummary(row),
        fields: [...new Set([...Object.keys(before ?? {}), ...Object.keys(after)])].sort().map((key) => ({
            key,
            beforeJson: before === null ? null : JSON.stringify(before[key] ?? null),
            afterJson: JSON.stringify(after[key] ?? null),
            changed: before !== null && JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null),
        })),
    };
};

export const policyHistory = auditProcedure
    .input(
        z
            .object({
                nationId: z.number().int().nonnegative(),
                area: zArea,
                from: zMonth,
                to: zMonth,
                cursor: z.number().int().positive().optional(),
                limit: z.number().int().min(1).max(200).default(50),
            })
            .strict()
    )
    .query(({ ctx, input }) =>
        readAudit(ctx, async (tx) => {
            const world = await readAuditWorld(tx);
            const from = monthOrdinal(input.from.year, input.from.month);
            const to = monthOrdinal(input.to.year, input.to.month);
            if (
                from > to ||
                from < monthOrdinal(world.startYear, world.startMonth) ||
                to > monthOrdinal(world.year, world.month)
            )
                throw new TRPCError({ code: 'BAD_REQUEST', message: '현재 기수 안의 정책 조회 기간을 선택해 주세요.' });
            const rows = world.serverId
                ? await tx.playAuditPolicy.findMany({
                      where: {
                          serverId: world.serverId,
                          nationId: input.nationId,
                          area: input.area,
                          revision: input.cursor === undefined ? undefined : { lt: input.cursor },
                          AND: [
                              {
                                  OR: [
                                      { year: { gt: input.from.year } },
                                      { year: input.from.year, month: { gte: input.from.month } },
                                  ],
                              },
                              {
                                  OR: [
                                      { year: { lt: input.to.year } },
                                      { year: input.to.year, month: { lte: input.to.month } },
                                  ],
                              },
                          ],
                      },
                      orderBy: { revision: 'desc' },
                      take: input.limit + 1,
                      select: summarySelect,
                  })
                : [];
            return {
                ...world,
                coverage: world.serverId ? ('RECORDED_VERSIONS_ONLY' as const) : ('IDENTITY_MISSING' as const),
                items: rows.slice(0, input.limit).map(projectPolicySummary),
                nextCursor: rows.length > input.limit ? rows[input.limit - 1]!.revision : null,
            };
        })
    );

export const policyVersion = auditProcedure
    .input(z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }).strict())
    .query(({ ctx, input }) =>
        readAudit(ctx, async (tx) => {
            const world = await readAuditWorld(tx);
            const row = world.serverId
                ? await tx.playAuditPolicy.findFirst({
                      where: { id: input.id, serverId: world.serverId },
                      select: {
                          ...summarySelect,
                          tick: true,
                          ordinal: true,
                          before: true,
                          after: true,
                          requestId: true,
                          inputSequence: true,
                      },
                  })
                : null;
            if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: '현재 기수의 정책 버전을 찾을 수 없습니다.' });
            return {
                ...world,
                version: {
                    ...projectPolicyConfiguration(row),
                    tick: row.tick?.toString() ?? null,
                    ordinal: row.ordinal,
                    requestId: row.requestId,
                    inputSequence: row.inputSequence?.toString() ?? null,
                },
            };
        })
    );
