import { parseGameClockPhase } from '@sammo-ts/common';
import type { GamePrisma } from '@sammo-ts/infra';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';

const safeNumber = (value: bigint, label: string): number => {
    const result = Number(value);
    if (!Number.isSafeInteger(result)) {
        throw new Error(`${label} is outside the JavaScript safe integer range: ${value}.`);
    }
    return result;
};

/**
 * Replays durable suspension ledgers into the already-running daemon before it
 * handles a command or resumes scheduled turns. The caller must hold the clock
 * operation advisory lock so the world row and ledger chain are one snapshot.
 */
export const synchronizeRuntimeClockAuthorityUnderHeldLock = async (
    db: GamePrisma.TransactionClient,
    world: InMemoryTurnWorld
): Promise<boolean> => {
    const durable = await db.worldState.findFirst({
        orderBy: { id: 'asc' },
        select: {
            id: true,
            clockBaseTime: true,
            clockTick: true,
            clockMode: true,
            clockWallAnchor: true,
            lastTurnTick: true,
            clockPhase: true,
            clockRevision: true,
            deadlineGeneration: true,
        },
    });
    if (
        !durable ||
        !durable.clockBaseTime ||
        durable.clockTick === null ||
        !durable.clockWallAnchor ||
        durable.lastTurnTick === null
    ) {
        throw new Error('Runtime clock synchronization requires one fully initialized world clock.');
    }

    const before = world.getGameClockState();
    const durableRevision = safeNumber(durable.clockRevision, 'durable clock revision');
    const durableGeneration = safeNumber(durable.deadlineGeneration, 'durable deadline generation');
    if (before.revision > durableRevision) {
        throw new Error(`In-memory clock revision ${before.revision} is ahead of durable revision ${durableRevision}.`);
    }

    if (before.revision < durableRevision) {
        const ledgers = await db.clockSuspension.findMany({
            where: {
                worldStateId: durable.id,
                sourceRevision: { gte: BigInt(before.revision) },
                targetRevision: { lte: durable.clockRevision },
                status: { in: ['RECONCILING', 'APPLIED'] },
            },
            orderBy: { sourceRevision: 'asc' },
            select: {
                id: true,
                sourceRevision: true,
                targetRevision: true,
                shiftTicks: true,
                alignedTick: true,
                resumeWallAt: true,
            },
        });
        let expectedRevision = before.revision;
        let expectedGeneration = before.deadlineGeneration;
        for (const ledger of ledgers) {
            const sourceRevision = safeNumber(ledger.sourceRevision, `clock suspension ${ledger.id} source revision`);
            const targetRevision = safeNumber(ledger.targetRevision, `clock suspension ${ledger.id} target revision`);
            if (sourceRevision !== expectedRevision || targetRevision !== sourceRevision + 1) {
                throw new Error(
                    `Clock suspension ledger chain is discontinuous at ${ledger.id}: ` +
                        `expected ${expectedRevision}->${expectedRevision + 1}, found ${sourceRevision}->${targetRevision}.`
                );
            }
            if (ledger.shiftTicks === null || ledger.alignedTick === null || !ledger.resumeWallAt) {
                throw new Error(`Clock suspension ${ledger.id} has no completed reconciliation coordinate.`);
            }
            expectedGeneration += 1;
            world.applyDurableClockReconciliation({
                suspensionId: ledger.id,
                sourceRevision,
                targetRevision,
                deadlineGeneration: expectedGeneration,
                alignedTick: safeNumber(ledger.alignedTick, `clock suspension ${ledger.id} aligned tick`),
                shiftTicks: safeNumber(ledger.shiftTicks, `clock suspension ${ledger.id} shift ticks`),
                resumeWallAt: ledger.resumeWallAt,
            });
            expectedRevision = targetRevision;
        }
        if (expectedRevision !== durableRevision || expectedGeneration !== durableGeneration) {
            throw new Error(
                `Clock suspension ledger chain ended at ${expectedRevision}/${expectedGeneration}, ` +
                    `but durable clock is ${durableRevision}/${durableGeneration}.`
            );
        }
    }

    world.synchronizeDurableClockSnapshot({
        baseTime: durable.clockBaseTime,
        tick: safeNumber(durable.clockTick, 'durable clock tick'),
        mode: durable.clockMode === 'manual' ? 'manual' : 'realtime',
        wallAnchor: durable.clockWallAnchor,
        lastTurnTick: safeNumber(durable.lastTurnTick, 'durable last turn tick'),
        phase: parseGameClockPhase(durable.clockPhase),
        revision: durableRevision,
        deadlineGeneration: durableGeneration,
    });

    const after = world.getGameClockState();
    return (
        before.phase !== after.phase ||
        before.revision !== after.revision ||
        before.deadlineGeneration !== after.deadlineGeneration ||
        before.tick !== after.tick ||
        before.wallAnchor.getTime() !== after.wallAnchor.getTime()
    );
};
