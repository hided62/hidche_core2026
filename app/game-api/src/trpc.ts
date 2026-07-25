import { randomUUID } from 'node:crypto';
import { initTRPC, TRPCError } from '@trpc/server';

import type { GameApiContext } from './context.js';
import { IdempotentTurnDaemonTransport } from './daemon/idempotentTransport.js';
import { DuplicateInputEventError, executeInputEvent } from './inputEventBoundary.js';

const t = initTRPC.context<GameApiContext>().create();

const inputEventMiddleware = t.middleware(async ({ ctx, type, path, next }) => {
    if (type !== 'mutation' || !ctx.db.$transaction) {
        return next();
    }

    const requestId = `${ctx.requestId ?? randomUUID()}:${path}`;
    try {
        return await executeInputEvent({
            db: ctx.db,
            requestId,
            eventType: path,
            actorUserId: ctx.auth?.user.id,
            execute: async (transaction) => {
                const result = await next({
                    ctx: {
                        ...ctx,
                        db: transaction,
                        turnDaemon: new IdempotentTurnDaemonTransport(ctx.turnDaemon, requestId),
                    },
                });
                if (!result.ok) {
                    throw result.error;
                }
                return result;
            },
        });
    } catch (error) {
        if (error instanceof DuplicateInputEventError) {
            throw new TRPCError({
                code: 'CONFLICT',
                message: error.message,
            });
        }
        throw error;
    }
});

export const router = t.router;
export const procedure = t.procedure.use(inputEventMiddleware);
export const authedProcedure: typeof procedure = procedure.use(({ ctx, next }) => {
    if (!ctx.auth) {
        throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Unauthorized',
        });
    }
    return next({
        ctx: {
            ...ctx,
            auth: ctx.auth,
        },
    });
});
