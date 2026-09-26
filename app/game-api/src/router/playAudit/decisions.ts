import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { GamePrisma } from '@sammo-ts/infra';
import { auditProcedure, monthOrdinal, readAudit, readAuditWorld, zAuditMonth } from './shared.js';

const zEffectivePolicy = z.object({
    schemaVersion: z.literal(1),
    general: z.object({ priority: z.array(z.string()), flags: z.record(z.string(), z.boolean()) }),
    nation: z.object({
        priority: z.array(z.string()),
        flags: z.record(z.string(), z.boolean()),
        values: z.object({
            reqNationGold: z.number(),
            reqNationRice: z.number(),
            reqHumanWarUrgentGold: z.number(),
            reqHumanWarUrgentRice: z.number(),
            reqHumanWarRecommandGold: z.number(),
            reqHumanWarRecommandRice: z.number(),
            reqHumanDevelGold: z.number(),
            reqHumanDevelRice: z.number(),
            reqNpcWarGold: z.number(),
            reqNpcWarRice: z.number(),
            reqNpcDevelGold: z.number(),
            reqNpcDevelRice: z.number(),
            minimumResourceActionAmount: z.number(),
            maximumResourceActionAmount: z.number(),
            minNpcWarLeadership: z.number(),
            minWarCrew: z.number(),
            minNpcRecruitCityPopulation: z.number(),
            safeRecruitCityPopulationRatio: z.number(),
            properWarTrainAtmos: z.number(),
            cureThreshold: z.number(),
        }),
        combatForce: z.record(z.string(), z.array(z.number()).length(2)),
        supportForce: z.array(z.number()),
        developForce: z.array(z.number()),
    }),
});
const zId = z.string().regex(/^[a-f0-9]{64}$/);
const zTick = z
    .string()
    .regex(/^\d{1,16}$/)
    .refine((value) => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER));
const zSummary = z.object({
    schemaVersion: z.literal(1),
    coverage: z.literal('PROCEDURES'),
    executionCoverage: z.literal('ATTEMPTS').optional(),
    executionStatus: z.enum(['PREPARING', 'BLOCKED', 'RESOLVED']).optional(),
    clockRevision: z.number().int(),
    codeVersion: z.string().nullable(),
    policyRefs: z.object({
        NPC_VALUES: zId.optional(),
        NPC_NATION_PRIORITY: zId.optional(),
        NPC_GENERAL_PRIORITY: zId.optional(),
        DEFENCE: zId.optional(),
    }),
    requestedAction: z.string(),
    selectedAction: z.string().nullable(),
    selectedReason: z.string().nullable(),
    executedAction: z.string(),
    completed: z.boolean().nullable(),
    usedFallback: z.boolean(),
    blockedReason: z.string().nullable(),
});
const zValue = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.object({ entityId: z.number() }),
    z.object({ unprojected: z.literal(true) }),
]);
const zStep = z.intersection(
    z.object({
        sequence: z.number().int().nonnegative(),
        phase: z.enum(['general', 'nation']),
        generalId: z.number().int(),
        nationId: z.number().int(),
        cityId: z.number().int(),
        npcState: z.number().int(),
        year: z.number().int(),
        month: z.number().int(),
        tick: z.number().nullable(),
    }),
    z.discriminatedUnion('kind', [
        z.object({
            kind: z.literal('EXECUTION_ATTEMPT'),
            attempt: z.number().int().min(0).max(5),
            requestedAction: z.string(),
            resolvedAction: z.string(),
            executedAction: z.string().nullable(),
            completed: z.boolean(),
            usedFallback: z.boolean(),
            alternativeAction: z.string().nullable(),
            preparation: z.object({ term: z.number().int().positive(), total: z.number().int().positive() }).nullable(),
            checks: z
                .array(
                    z.object({
                        stage: z.enum(['ARGS', 'CONSTRAINT', 'COOLDOWN', 'CONTEXT', 'BLOCK']),
                        action: z.string(),
                        result: z.enum(['allow', 'deny', 'unknown']),
                        reason: z.string().nullable(),
                    })
                )
                .max(5),
        }),
        z.object({
            kind: z.literal('DECISION_START'),
            reservedAction: z.string(),
            effectivePolicy: zEffectivePolicy.optional(),
        }),
        z.object({ kind: z.literal('DECISION_END'), action: z.string().nullable(), reason: z.string().nullable() }),
        z.object({ kind: z.literal('DECISION_ERROR') }),
        z.object({ kind: z.literal('PROCEDURE_START'), procedure: z.string() }),
        z.object({
            kind: z.literal('PROCEDURE_END'),
            procedure: z.string(),
            action: z.string().nullable(),
            reason: z.string().nullable(),
        }),
        z.object({
            kind: z.literal('PROCEDURE_SKIP'),
            procedure: z.string(),
            reason: z.enum(['POLICY', 'AUTOMATION', 'NO_HANDLER']),
        }),
        z.object({
            kind: z.literal('CANDIDATE'),
            action: z.string(),
            result: z.enum(['INVALID_ARGS', 'allow', 'deny', 'unknown']),
            constraint: z.string().nullable(),
        }),
        z.object({
            kind: z.literal('RNG'),
            method: z.string(),
            parameters: z.array(z.number()).nullable(),
            result: z.union([zValue, z.array(zValue)]),
        }),
    ])
);
const select = {
    id: true,
    executionId: true,
    phase: true,
    generalId: true,
    nationId: true,
    cityId: true,
    npcState: true,
    year: true,
    month: true,
    tick: true,
    stepCount: true,
    summary: true,
    createdAt: true,
} satisfies GamePrisma.PlayAuditDecisionSelect;
const project = (row: GamePrisma.PlayAuditDecisionGetPayload<{ select: typeof select }>) => ({
    ...row,
    phase: z.enum(['general', 'nation']).parse(row.phase),
    tick: row.tick.toString(),
    summary: zSummary.parse(row.summary),
});
export const decisionHistory = auditProcedure
    .input(
        z
            .object({
                generalId: z.number().int().positive().max(2147483647),
                month: zAuditMonth.omit({ kind: true }).optional(),
                phase: z.enum(['general', 'nation']).optional(),
                cursor: z.object({ tick: zTick, id: zId }).strict().optional(),
                limit: z.number().int().min(1).max(200).default(50),
            })
            .strict()
    )
    .query(({ ctx, input }) =>
        readAudit(ctx, async (tx) => {
            const world = await readAuditWorld(tx);
            // 장수 턴은 월 경계와 동시에 실행되지 않는다. 현재 상태에서는 마지막으로
            // 실제 결정이 저장된 월을 열고, 명시한 과거 월은 빈 월이어도 그대로 보존한다.
            const latest =
                !input.month && world.serverId
                    ? await tx.playAuditDecision.findFirst({
                          where: {
                              serverId: world.serverId,
                              generalId: input.generalId,
                              phase: input.phase,
                              AND: [
                                  {
                                      OR: [
                                          { year: { gt: world.startYear } },
                                          { year: world.startYear, month: { gte: world.startMonth } },
                                      ],
                                  },
                                  {
                                      OR: [
                                          { year: { lt: world.year } },
                                          { year: world.year, month: { lte: world.month } },
                                      ],
                                  },
                              ],
                          },
                          orderBy: [{ year: 'desc' }, { month: 'desc' }, { tick: 'desc' }, { id: 'desc' }],
                          select: { year: true, month: true },
                      })
                    : null;
            const month = input.month ?? latest ?? { year: world.year, month: world.month };
            const ordinal = monthOrdinal(month.year, month.month);
            if (
                ordinal < monthOrdinal(world.startYear, world.startMonth) ||
                ordinal > monthOrdinal(world.year, world.month)
            )
                throw new TRPCError({ code: 'BAD_REQUEST', message: '현재 기수 안의 결정 조회 월을 선택해 주세요.' });
            const rows = world.serverId
                ? await tx.playAuditDecision.findMany({
                      where: {
                          serverId: world.serverId,
                          generalId: input.generalId,
                          year: month.year,
                          month: month.month,
                          phase: input.phase,
                          ...(input.cursor
                              ? {
                                    OR: [
                                        { tick: { lt: BigInt(input.cursor.tick) } },
                                        { tick: BigInt(input.cursor.tick), id: { lt: input.cursor.id } },
                                    ],
                                }
                              : {}),
                      },
                      orderBy: [{ tick: 'desc' }, { id: 'desc' }],
                      take: input.limit + 1,
                      select,
                  })
                : [];
            const last = rows[input.limit - 1];
            return {
                ...world,
                month,
                currentMonth: { year: world.year, month: world.month },
                selection: input.month ? ('MONTH' as const) : ('LATEST' as const),
                coverage: world.serverId ? ('PROCEDURES_ONLY' as const) : ('IDENTITY_MISSING' as const),
                items: rows.slice(0, input.limit).map(project),
                nextCursor: rows.length > input.limit && last ? { tick: last.tick.toString(), id: last.id } : null,
            };
        })
    );
export const decisionDetail = auditProcedure
    .input(
        z
            .object({
                id: zId,
                generalId: z.number().int().positive().max(2147483647),
                cursor: z.number().int().nonnegative().max(2147483647).optional(),
                limit: z.number().int().min(1).max(4).default(1),
            })
            .strict()
    )
    .query(({ ctx, input }) =>
        readAudit(ctx, async (tx) => {
            const world = await readAuditWorld(tx);
            const row = world.serverId
                ? await tx.playAuditDecision.findFirst({
                      where: { id: input.id, generalId: input.generalId, serverId: world.serverId },
                      select,
                  })
                : null;
            if (!row)
                throw new TRPCError({ code: 'NOT_FOUND', message: '현재 기수에서 해당 결정 기록을 찾을 수 없습니다.' });
            const chunks = await tx.playAuditDecisionChunk.findMany({
                where: { decisionId: row.id, ordinal: input.cursor === undefined ? undefined : { gt: input.cursor } },
                orderBy: { ordinal: 'asc' },
                take: input.limit,
                select: { ordinal: true, steps: true },
            });
            return {
                ...world,
                decision: project(row),
                chunks: chunks.slice(0, input.limit).map((chunk) => ({
                    ordinal: chunk.ordinal,
                    steps: z.array(zStep).max(128).parse(chunk.steps),
                })),
                nextCursor:
                    chunks.length && chunks.at(-1)!.ordinal + 1 < Math.ceil(row.stepCount / 128)
                        ? chunks.at(-1)!.ordinal
                        : null,
            };
        })
    );
