import { parseGameClockPhase } from '@sammo-ts/common';

import type { DatabaseClient } from '../context.js';

const safeInteger = (value: bigint, label: string): number => {
    const result = Number(value);
    if (!Number.isSafeInteger(result)) throw new Error(`${label} is outside the safe integer range.`);
    return result;
};

export const loadClockReadiness = async (db: DatabaseClient) => {
    if (!db.clockProjectionOutbox) {
        return {
            reconciliationComplete: false,
            gameplayEnabled: false,
            phase: null,
            revision: null,
            deadlineGeneration: null,
            incompleteOutboxCount: null,
        };
    }
    const [world, incompleteOutboxCount] = await Promise.all([
        db.worldState.findFirst({
            orderBy: { id: 'asc' },
            select: { clockPhase: true, clockRevision: true, deadlineGeneration: true },
        }),
        db.clockProjectionOutbox.count({ where: { status: { not: 'APPLIED' } } }),
    ]);
    if (!world) {
        return {
            reconciliationComplete: false,
            gameplayEnabled: false,
            phase: null,
            revision: null,
            deadlineGeneration: null,
            incompleteOutboxCount,
        };
    }
    const phase = parseGameClockPhase(world.clockPhase);
    return {
        reconciliationComplete: phase !== 'RECONCILING' && incompleteOutboxCount === 0,
        gameplayEnabled: phase === 'RUNNING' || phase === 'MANUAL',
        phase,
        revision: safeInteger(world.clockRevision, 'clock revision'),
        deadlineGeneration: safeInteger(world.deadlineGeneration, 'deadline generation'),
        incompleteOutboxCount,
    };
};

export const loadClockAdminStatus = async (db: DatabaseClient) => {
    const readiness = await loadClockReadiness(db);
    if (!db.clockSuspension) {
        return { ...readiness, latestReconciliation: null };
    }
    const latest = await db.clockSuspension.findFirst({
        orderBy: { createdAt: 'desc' },
        include: {
            participants: { orderBy: { participantKey: 'asc' } },
            projectionOutbox: { orderBy: { id: 'asc' } },
        },
    });
    if (!latest) return { ...readiness, latestReconciliation: null };
    return {
        ...readiness,
        latestReconciliation: {
            id: latest.id,
            source: latest.source,
            policy: latest.policy,
            status: latest.status,
            sourceRevision: safeInteger(latest.sourceRevision, 'source revision'),
            targetRevision: safeInteger(latest.targetRevision, 'target revision'),
            cutTick: safeInteger(latest.cutTick, 'cut tick'),
            alignedTick: latest.alignedTick === null ? null : safeInteger(latest.alignedTick, 'aligned tick'),
            participantChecksumBefore: latest.participantChecksumBefore,
            participantChecksumAfter: latest.participantChecksumAfter,
            participants: latest.participants.map((participant) => ({
                key: participant.participantKey,
                policy: participant.policy,
                beforeChecksum: participant.beforeChecksum,
                afterChecksum: participant.afterChecksum,
                affectedCount: participant.affectedCount,
            })),
            outbox: latest.projectionOutbox.map((entry) => ({
                id: entry.id.toString(),
                targetRevision: safeInteger(entry.targetRevision, 'outbox target revision'),
                status: entry.status,
                attempts: entry.attempts,
                lastError: entry.lastError,
            })),
        },
    };
};
