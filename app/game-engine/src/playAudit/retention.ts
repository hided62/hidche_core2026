import { asRecord } from '@sammo-ts/common';
import { GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';

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
            await tx.$executeRaw`SET LOCAL lock_timeout = '250ms'`;
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
            // 이미 있는 (server_id,nation_id,tick,id) 인덱스 순서로 여러 부모를 잠근다.
            // chunk 총량과 빈 header 삭제량의 합도 BATCH 이하로 제한한다.
            let decisions = await tx.$queryRaw<{ id: string }[]>`
                SELECT id FROM play_audit_decision WHERE server_id < ${expectedServerId}
                ORDER BY server_id, nation_id, tick, id LIMIT ${AUDIT_RETENTION_BATCH_SIZE} FOR UPDATE
            `;
            if (!decisions.length) {
                decisions = await tx.$queryRaw<{ id: string }[]>`
                    SELECT id FROM play_audit_decision WHERE server_id > ${expectedServerId}
                    ORDER BY server_id, nation_id, tick, id LIMIT ${AUDIT_RETENTION_BATCH_SIZE} FOR UPDATE
                `;
            }
            if (decisions.length) {
                const ids = decisions.map(({ id }) => id);
                const [chunks] = await tx.$queryRaw<{ deleted: number }[]>(GamePrisma.sql`
                    WITH batch AS (
                        SELECT decision_id, ordinal FROM play_audit_decision_chunk
                        WHERE decision_id IN (${GamePrisma.join(ids)})
                        ORDER BY decision_id, ordinal LIMIT ${AUDIT_RETENTION_BATCH_SIZE}
                    ), removed AS (
                        DELETE FROM play_audit_decision_chunk c USING batch b
                        WHERE c.decision_id=b.decision_id AND c.ordinal=b.ordinal RETURNING 1
                    ) SELECT count(*)::integer AS deleted FROM removed
                `);
                const count = chunks?.deleted ?? 0;
                const remaining = AUDIT_RETENTION_BATCH_SIZE - count;
                if (!remaining) return { status: 'progress', deleted: count };
                const empty = await tx.playAuditDecision.findMany({
                    where: { id: { in: ids }, chunks: { none: {} } },
                    select: { id: true },
                    orderBy: { id: 'asc' },
                    take: remaining,
                });
                const headers = await tx.playAuditDecision.deleteMany({
                    where: { id: { in: empty.map(({ id }) => id) } },
                });
                return { status: 'progress', deleted: count + headers.count };
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
