import type { GamePrisma, InputJsonValue } from '@sammo-ts/infra';
import { auditPolicyHash } from './policy.js';
import type { PendingAuditDecision } from './decision.js';

export const AUDIT_DECISION_CHUNK_STEPS = 128;
const BATCH = 200;
/** 요약과 모든 chunk를 기존 gameplay transaction에 저장한다. 후보별 SQL은 발행하지 않는다. */
export const persistAuditDecisions = async (
    tx: GamePrisma.TransactionClient,
    decisions: readonly PendingAuditDecision[]
): Promise<void> => {
    for (let offset = 0; offset < decisions.length; offset += BATCH) {
        const batch = decisions.slice(offset, offset + BATCH);
        const headers = batch.map(({ steps, ...decision }) => {
            if (!Number.isSafeInteger(decision.tick) || decision.tick < 0 || !steps.length)
                throw new Error('Invalid play audit decision');
            if (
                steps[0]?.kind !== 'DECISION_START' ||
                !steps.some((step) => step.kind === 'DECISION_END') ||
                !['DECISION_END', 'EXECUTION_ATTEMPT'].includes(steps.at(-1)!.kind) ||
                (decision.summary.executionCoverage === 'ATTEMPTS' && steps.at(-1)?.kind !== 'EXECUTION_ATTEMPT')
            )
                throw new Error('Incomplete play audit decision');
            if (
                steps.some(
                    (step, index) =>
                        step.phase !== decision.phase || (index > 0 && step.sequence <= steps[index - 1]!.sequence)
                )
            )
                throw new Error('Invalid play audit decision order');
            return {
                ...decision,
                tick: BigInt(decision.tick),
                stepCount: steps.length,
                summary: decision.summary as InputJsonValue,
                hash: auditPolicyHash({ ...decision, steps }),
            };
        });
        await tx.playAuditDecision.createMany({ data: headers, skipDuplicates: true });
        const saved = await tx.playAuditDecision.findMany({
            where: { id: { in: headers.map((row) => row.id) } },
            select: { id: true, hash: true },
        });
        const hashes = new Map(saved.map((row) => [row.id, row.hash]));
        if (headers.some((row) => hashes.get(row.id) !== row.hash))
            throw new Error('Play audit decision replay conflict');
        let chunks: GamePrisma.PlayAuditDecisionChunkCreateManyInput[] = [];
        for (const decision of batch) {
            for (let start = 0; start < decision.steps.length; start += AUDIT_DECISION_CHUNK_STEPS) {
                chunks.push({
                    decisionId: decision.id,
                    ordinal: start / AUDIT_DECISION_CHUNK_STEPS,
                    steps: decision.steps.slice(start, start + AUDIT_DECISION_CHUNK_STEPS) as InputJsonValue,
                });
                if (chunks.length === BATCH) {
                    await tx.playAuditDecisionChunk.createMany({ data: chunks, skipDuplicates: true });
                    chunks = [];
                }
            }
        }
        if (chunks.length) await tx.playAuditDecisionChunk.createMany({ data: chunks, skipDuplicates: true });
    }
};
