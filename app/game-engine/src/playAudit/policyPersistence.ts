import { GamePrisma, type InputJsonValue } from '@sammo-ts/infra';
import { auditPolicyHash, type PendingAuditPolicy } from './policy.js';

export const persistAuditPolicies = async (
    tx: GamePrisma.TransactionClient,
    policies: readonly PendingAuditPolicy[],
    command?: { requestId: string; sequence: bigint; actorUserId: string | null }
): Promise<void> => {
    for (let offset = 0; offset < policies.length; offset += 200) {
        const batch = policies.slice(offset, offset + 200).map((policy) => {
            if (policy.requestId && !command) throw new Error('Play audit policy input event context missing');
            if (
                policy.requestId &&
                command &&
                (policy.requestId !== command.requestId || policy.actor?.userId !== command.actorUserId)
            ) {
                throw new Error('Play audit policy actor/request mismatch');
            }
            return {
                ...policy,
                inputSequence: policy.requestId && command ? command.sequence : null,
                actor: policy.actor ? (JSON.parse(JSON.stringify(policy.actor)) as InputJsonValue) : GamePrisma.DbNull,
                before: policy.before
                    ? (JSON.parse(JSON.stringify(policy.before)) as InputJsonValue)
                    : GamePrisma.DbNull,
                after: JSON.parse(JSON.stringify(policy.after)) as InputJsonValue,
                hash: auditPolicyHash({
                    ...policy,
                    inputSequence: policy.requestId && command ? command.sequence.toString() : null,
                }),
            };
        });
        await tx.playAuditPolicy.createMany({ data: batch, skipDuplicates: true });
        const saved = await tx.playAuditPolicy.findMany({
            where: { id: { in: batch.map((row) => row.id) } },
            select: { id: true, hash: true },
        });
        const hashes = new Map(saved.map((row) => [row.id, row.hash]));
        if (batch.some((row) => hashes.get(row.id) !== row.hash))
            throw new Error('Play audit policy replay payload conflict');
    }
};
