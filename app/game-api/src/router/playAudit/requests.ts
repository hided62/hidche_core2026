import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { auditProcedure, readAudit, readAuditWorld } from './shared.js';

interface RequestStateRow {
    sequence: bigint;
    requestId: string;
    target: 'API' | 'ENGINE';
    eventType: string;
    status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
    attempts: number;
    acceptedGameTick: bigint | null;
    processingGameTick: bigint | null;
    acceptedClockRevision: bigint | null;
    processingClockRevision: bigint | null;
    createdAt: Date;
    processingAt: Date | null;
    completedAt: Date | null;
    resultRecorded: boolean;
    errorRecorded: boolean;
}

/** 현재 기수의 불변 사건이 참조한 요청만 읽는다. 임의 요청 ID 검색이나 원문 조회는 제공하지 않는다. */
export const requestState = auditProcedure
    .input(z.object({ kind: z.enum(['POLICY', 'DIPLOMACY']), id: z.string().regex(/^[a-f0-9]{64}$/) }).strict())
    .query(({ ctx, input }) =>
        readAudit(ctx, async (tx) => {
            const world = await readAuditWorld(tx);
            const reference = world.serverId
                ? await (input.kind === 'POLICY'
                      ? tx.playAuditPolicy.findFirst({
                            where: { id: input.id, serverId: world.serverId },
                            select: { requestId: true, inputSequence: true },
                        })
                      : tx.playAuditDiplomacyEvent.findFirst({
                            where: { id: input.id, serverId: world.serverId },
                            select: { requestId: true, inputSequence: true },
                        }))
                : null;
            if (!reference)
                throw new TRPCError({ code: 'NOT_FOUND', message: '현재 기수의 감사 기록을 찾을 수 없습니다.' });
            const base = { ...world, coverage: 'CURRENT_JOURNAL_STATE' as const };
            if (!reference.requestId) return { ...base, status: 'NOT_LINKED' as const, request: null };
            if (reference.inputSequence === null)
                return { ...base, status: 'INCOMPLETE_REFERENCE' as const, request: null };
            // unique request_id로 한 행만 읽고 원문 payload/result/error/계정/lease owner는 materialize하지 않는다.
            const rows = await tx.$queryRaw<RequestStateRow[]>`
            SELECT sequence, request_id AS "requestId", target::text AS target, event_type AS "eventType", status::text AS status, attempts,
                accepted_game_tick AS "acceptedGameTick", processing_game_tick AS "processingGameTick",
                accepted_clock_revision AS "acceptedClockRevision", processing_clock_revision AS "processingClockRevision",
                created_at AS "createdAt", processing_at AS "processingAt", completed_at AS "completedAt",
                result IS NOT NULL AS "resultRecorded", error IS NOT NULL AS "errorRecorded"
            FROM input_event WHERE request_id = ${reference.requestId} LIMIT 1
        `;
            const row = rows[0];
            if (!row) return { ...base, status: 'MISSING_REQUEST' as const, request: null };
            if (row.sequence !== reference.inputSequence)
                return { ...base, status: 'REFERENCE_MISMATCH' as const, request: null };
            return {
                ...base,
                status: 'AVAILABLE' as const,
                request: {
                    ...row,
                    sequence: row.sequence.toString(),
                    acceptedGameTick: row.acceptedGameTick?.toString() ?? null,
                    processingGameTick: row.processingGameTick?.toString() ?? null,
                    acceptedClockRevision: row.acceptedClockRevision?.toString() ?? null,
                    processingClockRevision: row.processingClockRevision?.toString() ?? null,
                },
            };
        })
    );
