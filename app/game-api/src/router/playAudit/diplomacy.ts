import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { hashAuditDiplomacyDocument, type GamePrisma } from '@sammo-ts/infra';
import { auditProcedure, monthOrdinal, readAudit, readAuditWorld, zAuditMonth } from './shared.js';

const zActor = z
    .object({
        generalId: z.number().int(),
        name: z.string(),
        nationId: z.number().int(),
        officerLevel: z.number().int(),
        npcState: z.number().int(),
        actionKey: z.string().optional(),
        kind: z.enum(['nation', 'general']).optional(),
        actionOrdinal: z.number().int().positive().optional(),
        messageId: z.number().int().positive().optional(),
    })
    .nullable();
const zState = z
    .object({
        state: z.union([z.number().int(), z.enum(['PROPOSED', 'ACTIVATED', 'REPLACED', 'CANCELLED'])]),
        term: z.number().int().optional(),
        dead: z.number().optional(),
        isDead: z.boolean().optional(),
        isShowing: z.boolean().optional(),
        srcSignerId: z.number().int().nullable().optional(),
        destSignerId: z.number().int().nullable().optional(),
        srcNationName: z.string().nullable().optional(),
        destNationName: z.string().nullable().optional(),
        srcSignerName: z.string().nullable().optional(),
        destSignerName: z.string().nullable().optional(),
        stateOption: z.string().nullable().optional(),
        reason: z.string().nullable().optional(),
        reasonAction: z.string().nullable().optional(),
        reasonActorId: z.number().int().nullable().optional(),
    })
    .nullable();
const summarySelect = {
    id: true,
    sequence: true,
    schemaVersion: true,
    srcNationId: true,
    destNationId: true,
    category: true,
    source: true,
    eventType: true,
    documentId: true,
    previousDocumentId: true,
    year: true,
    month: true,
    actor: true,
    createdAt: true,
} satisfies GamePrisma.PlayAuditDiplomacyEventSelect;
type Summary = GamePrisma.PlayAuditDiplomacyEventGetPayload<{ select: typeof summarySelect }>;
export const projectDiplomacySummary = (row: Summary) => {
    if (row.schemaVersion !== 1)
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '지원하지 않는 외교 기록 버전입니다.' });
    return {
        id: row.id,
        sequence: row.sequence.toString(),
        srcNationId: row.srcNationId,
        destNationId: row.destNationId,
        category: z.enum(['DOCUMENT', 'RELATION']).parse(row.category),
        source: z.enum(['API', 'ENGINE', 'BASELINE']).parse(row.source),
        eventType: row.eventType,
        documentId: row.documentId,
        previousDocumentId: row.previousDocumentId,
        year: row.year,
        month: row.month,
        actor: zActor.parse(row.actor),
        createdAt: row.createdAt,
    };
};
const zSequence = z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/)
    .refine((value) => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n);
const zId = z.string().regex(/^[a-f0-9]{64}$/);

export const diplomacyHistory = auditProcedure
    .input(
        z
            .object({
                nationId: z.number().int().positive(),
                otherNationId: z.number().int().positive(),
                from: zAuditMonth.omit({ kind: true }),
                to: zAuditMonth.omit({ kind: true }),
                category: z.enum(['DOCUMENT', 'RELATION']).optional(),
                cursor: zSequence.optional(),
                limit: z.number().int().min(1).max(200).default(50),
            })
            .strict()
            .refine((input) => input.nationId !== input.otherNationId, '서로 다른 국가를 선택해 주세요.')
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
                throw new TRPCError({ code: 'BAD_REQUEST', message: '현재 기수 안의 외교 조회 기간을 선택해 주세요.' });
            const rows = world.serverId
                ? await tx.playAuditDiplomacyEvent.findMany({
                      where: {
                          serverId: world.serverId,
                          nationA: Math.min(input.nationId, input.otherNationId),
                          nationB: Math.max(input.nationId, input.otherNationId),
                          category: input.category,
                          sequence: input.cursor === undefined ? undefined : { lt: BigInt(input.cursor) },
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
                      select: summarySelect,
                      orderBy: { sequence: 'desc' },
                      take: input.limit + 1,
                  })
                : [];
            return {
                ...world,
                coverage: world.serverId ? ('RECORDED_EVENTS_ONLY' as const) : ('IDENTITY_MISSING' as const),
                items: rows.slice(0, input.limit).map(projectDiplomacySummary),
                nextCursor: rows.length > input.limit ? rows[input.limit - 1]!.sequence.toString() : null,
            };
        })
    );

export const diplomacyEvent = auditProcedure.input(z.object({ id: zId }).strict()).query(({ ctx, input }) =>
    readAudit(ctx, async (tx) => {
        const world = await readAuditWorld(tx);
        const row = world.serverId
            ? await tx.playAuditDiplomacyEvent.findFirst({
                  where: { id: input.id, serverId: world.serverId },
                  select: {
                      ...summarySelect,
                      before: true,
                      after: true,
                      tick: true,
                      clockRevision: true,
                      executionId: true,
                      ordinal: true,
                      requestId: true,
                      inputSequence: true,
                      documentHash: true,
                  },
              })
            : null;
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: '현재 기수의 외교 기록을 찾을 수 없습니다.' });
        const document =
            row.documentId === null
                ? null
                : await tx.diplomacyLetter.findUnique({
                      where: { id: row.documentId },
                      select: {
                          id: true,
                          srcNationId: true,
                          destNationId: true,
                          prevId: true,
                          textBrief: true,
                          textDetail: true,
                          srcSignerId: true,
                          date: true,
                      },
                  });
        const documentStatus =
            row.documentId === null
                ? ('NOT_APPLICABLE' as const)
                : !document
                  ? ('MISSING_REFERENCE' as const)
                  : hashAuditDiplomacyDocument(document) !== row.documentHash
                    ? ('HASH_MISMATCH' as const)
                    : ('AVAILABLE' as const);
        return {
            ...world,
            event: {
                ...projectDiplomacySummary(row),
                before: zState.parse(row.before),
                after: zState.parse(row.after),
                tick: row.tick?.toString() ?? null,
                clockRevision: row.clockRevision?.toString() ?? null,
                executionId: row.executionId,
                ordinal: row.ordinal,
                requestId: row.requestId,
                inputSequence: row.inputSequence?.toString() ?? null,
                documentStatus,
                document:
                    documentStatus === 'AVAILABLE' && document
                        ? {
                              id: document.id,
                              brief: document.textBrief,
                              detail: document.textDetail,
                              writtenAt: document.date,
                          }
                        : null,
            },
        };
    })
);
