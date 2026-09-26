import { GamePrisma, type InputJsonValue } from '@sammo-ts/infra';
import { asRecord } from '@sammo-ts/common';
import { AUDIT_POLICY_AREAS, auditPolicyHash, type PendingAuditPolicy } from './policy.js';
import type { InMemoryTurnWorld } from '../turn/inMemoryWorld.js';

export const persistAuditPolicies = async (
    tx: GamePrisma.TransactionClient,
    policies: readonly PendingAuditPolicy[],
    command?: { requestId: string; sequence: bigint; actorUserId: string | null }
): Promise<void> => {
    for (let offset = 0; offset < policies.length; offset += 200) {
        const batch = policies.slice(offset, offset + 200).map((policy) => {
            if (!Number.isSafeInteger(policy.tick) || policy.tick < 0)
                throw new Error('Invalid play audit policy tick');
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
                tick: BigInt(policy.tick),
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

/** 원장은 그대로 두고, 구버전 NPC 생성이 유실한 head projection만 복구한다. */
export const restoreMissingAuditPolicyHeads = async (
    tx: GamePrisma.TransactionClient,
    world: InMemoryTurnWorld
): Promise<boolean> => {
    const serverId = world.getState().meta.serverId;
    if (typeof serverId !== 'string' || !serverId.trim()) return false;
    const missing = world.listNations().flatMap((nation) => {
        const heads = asRecord(nation.meta._playAuditPolicy);
        return AUDIT_POLICY_AREAS.filter((area) => heads[area] === undefined).map(
            (area) => GamePrisma.sql`(nation_id = ${nation.id} AND area = ${area})`
        );
    });
    if (!missing.length) return false;
    // DISTINCT ON으로 각 국가/영역의 마지막 revision만 읽는다. 과거 기수는 복구하지 않는다.
    const rows = await tx.$queryRaw<
        { id: string; nationId: number; area: string; revision: number; after: InputJsonValue }[]
    >(GamePrisma.sql`
        SELECT DISTINCT ON (nation_id, area)
            id, nation_id AS "nationId", area, revision, "after"
        FROM play_audit_policy
        WHERE server_id = ${serverId} AND (${GamePrisma.join(missing, ' OR ')})
        ORDER BY nation_id, area, revision DESC
    `);
    for (const row of rows) {
        if (row.revision < 1 || row.id !== auditPolicyHash([serverId, row.nationId, row.area, row.revision])) {
            throw new Error('Invalid persisted play audit policy head');
        }
        const nation = world.getNationById(row.nationId)!;
        const heads = nation.meta._playAuditPolicy;
        world.updateNation(nation.id, {
            meta: {
                ...nation.meta,
                _playAuditPolicy: {
                    ...(heads && typeof heads === 'object' && !Array.isArray(heads) ? heads : {}),
                    [row.area]: { id: row.id, revision: row.revision, hash: auditPolicyHash(row.after), serverId },
                },
            },
        });
    }
    // 실제 정책이 원장 after와 다르면 후속 initializeAuditPolicies가 OBSERVED_GAP을 남긴다.
    // 이 메타데이터와 새 이력은 기존 lease/fencing을 거친 startup flush에서 함께 commit된다.
    return rows.length > 0;
};
