import { asRecord } from '@sammo-ts/common';
import type { GamePrismaClient } from '@sammo-ts/infra';

export const AUDIT_RETENTION_BATCH_SIZE = 200;
export type AuditRetentionResult = { status: 'progress' | 'complete' | 'busy' | 'identityChanged'; deleted: number };

/** 새 기수가 활성화된 뒤에만 이전 감사 projection을 작은 transaction으로 정리한다. */
export const prunePreviousAuditBatch = async (
    db: GamePrismaClient,
    expectedServerId: string
): Promise<AuditRetentionResult> => {
    if (!expectedServerId.trim()) return { status: 'identityChanged', deleted: 0 };
    return db.$transaction(
        async (tx) => {
            await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
            // seeder와 동일한 잠금이다. RESET을 기다리게 하지 않고 다음 batch에서 재시도한다.
            const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtextextended(current_schema(), 0)) AS locked
        `;
            if (!lock?.locked) return { status: 'busy', deleted: 0 };
            const world = await tx.worldState.findFirst({ orderBy: { id: 'asc' }, select: { meta: true } });
            if (asRecord(world?.meta).serverId !== expectedServerId) return { status: 'identityChanged', deleted: 0 };
            const diplomacyEvents = await tx.playAuditDiplomacyEvent.findMany({
                where: { serverId: { not: expectedServerId } },
                orderBy: { sequence: 'asc' },
                take: AUDIT_RETENTION_BATCH_SIZE,
                select: { id: true },
            });
            if (diplomacyEvents.length) {
                const deleted = await tx.playAuditDiplomacyEvent.deleteMany({
                    where: { id: { in: diplomacyEvents.map((row) => row.id) } },
                });
                return { status: 'progress', deleted: deleted.count };
            }
            const [decision] = await tx.$queryRaw<{ id: string }[]>`
                SELECT id FROM play_audit_decision WHERE id = COALESCE(
                    (SELECT id FROM play_audit_decision WHERE server_id < ${expectedServerId}
                     ORDER BY server_id, general_id, tick, id LIMIT 1),
                    (SELECT id FROM play_audit_decision WHERE server_id > ${expectedServerId}
                     ORDER BY server_id, general_id, tick, id LIMIT 1)
                ) FOR UPDATE
            `;
            if (decision) {
                const chunks = await tx.playAuditDecisionChunk.findMany({
                    where: { decisionId: decision.id },
                    orderBy: { ordinal: 'asc' },
                    take: AUDIT_RETENTION_BATCH_SIZE,
                    select: { ordinal: true },
                });
                if (chunks.length) {
                    const deleted = await tx.playAuditDecisionChunk.deleteMany({
                        where: { decisionId: decision.id, ordinal: { in: chunks.map((row) => row.ordinal) } },
                    });
                    return { status: 'progress', deleted: deleted.count };
                }
                await tx.playAuditDecision.delete({ where: { id: decision.id } });
                return { status: 'progress', deleted: 1 };
            }
            const policies = await tx.playAuditPolicy.findMany({
                where: { serverId: { not: expectedServerId } },
                orderBy: { id: 'asc' },
                take: AUDIT_RETENTION_BATCH_SIZE,
                select: { id: true },
            });
            if (policies.length) {
                const deleted = await tx.playAuditPolicy.deleteMany({
                    where: { id: { in: policies.map((row) => row.id) } },
                });
                return { status: 'progress', deleted: deleted.count };
            }
            // 부모를 잠가 늦은 child INSERT와 빈 header 삭제의 경쟁도 차단한다.
            const [sample] = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM play_audit_month WHERE server_id <> ${expectedServerId}
            ORDER BY id LIMIT 1 FOR UPDATE
        `;
            if (!sample) return { status: 'complete', deleted: 0 };
            const where = { sampleId: sample.id };
            const generals = await tx.playAuditGeneral.findMany({
                where,
                orderBy: { generalId: 'asc' },
                take: AUDIT_RETENTION_BATCH_SIZE,
                select: { generalId: true },
            });
            if (generals.length) {
                const deleted = await tx.playAuditGeneral.deleteMany({
                    where: { ...where, generalId: { in: generals.map((row) => row.generalId) } },
                });
                return { status: 'progress', deleted: deleted.count };
            }
            const cities = await tx.playAuditCity.findMany({
                where,
                orderBy: { cityId: 'asc' },
                take: AUDIT_RETENTION_BATCH_SIZE,
                select: { cityId: true },
            });
            if (cities.length) {
                const deleted = await tx.playAuditCity.deleteMany({
                    where: { ...where, cityId: { in: cities.map((row) => row.cityId) } },
                });
                return { status: 'progress', deleted: deleted.count };
            }
            const nations = await tx.playAuditNation.findMany({
                where,
                orderBy: { nationId: 'asc' },
                take: AUDIT_RETENTION_BATCH_SIZE,
                select: { nationId: true },
            });
            if (nations.length) {
                const deleted = await tx.playAuditNation.deleteMany({
                    where: { ...where, nationId: { in: nations.map((row) => row.nationId) } },
                });
                return { status: 'progress', deleted: deleted.count };
            }
            // 모든 child가 빈 뒤 부모만 삭제한다. 거대한 FK cascade를 정리 수단으로 쓰지 않는다.
            await tx.playAuditMonth.delete({ where: { id: sample.id } });
            return { status: 'progress', deleted: 1 };
        },
        { maxWait: 1000, timeout: 5000 }
    );
};
