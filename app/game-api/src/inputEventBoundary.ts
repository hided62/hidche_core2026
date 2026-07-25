import type { GamePrisma } from '@sammo-ts/infra';

import type { DatabaseClient } from './context.js';

const asJson = (value: unknown): GamePrisma.InputJsonValue => value as GamePrisma.InputJsonValue;

export class DuplicateInputEventError extends Error {
    constructor(readonly requestId: string) {
        super(`Input event ${requestId} was already accepted.`);
        this.name = 'DuplicateInputEventError';
    }
}

export const executeInputEvent = async <T>(options: {
    db: DatabaseClient;
    requestId: string;
    eventType: string;
    actorUserId?: string | null;
    execute(db: DatabaseClient): Promise<T>;
}): Promise<T> => {
    const { db, requestId, eventType, actorUserId, execute } = options;
    if (!db.$transaction) {
        return execute(db);
    }

    const processingAt = new Date();
    try {
        await db.inputEvent.create({
            data: {
                requestId,
                target: 'API',
                eventType,
                payload: asJson({}),
                actorUserId: actorUserId ?? null,
                status: 'PROCESSING',
                processingAt,
                attempts: 1,
            },
        });
    } catch (error) {
        const isUniqueConflict =
            typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
        if (!isUniqueConflict) {
            throw error;
        }
        const claimedRetry = await db.inputEvent.updateMany({
            where: { requestId, status: 'FAILED' },
            data: {
                status: 'PROCESSING',
                error: null,
                processingAt,
                completedAt: null,
                attempts: { increment: 1 },
            },
        });
        if (claimedRetry.count === 0) {
            throw new DuplicateInputEventError(requestId);
        }
    }

    try {
        return await db.$transaction(async (transaction) => {
            const result = await execute(transaction);
            await transaction.inputEvent.update({
                where: { requestId },
                data: {
                    status: 'SUCCEEDED',
                    result: asJson({ ok: true }),
                    completedAt: new Date(),
                },
            });
            return result;
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown API input event error.';
        await db.inputEvent.update({
            where: { requestId },
            data: {
                status: 'FAILED',
                error: message,
                completedAt: new Date(),
            },
        });
        throw error;
    }
};
