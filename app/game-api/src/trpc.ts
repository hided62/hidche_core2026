import { randomUUID } from 'node:crypto';
import { initTRPC, TRPCError } from '@trpc/server';
import { isGameAccessBlocked } from '@sammo-ts/common/auth/sanctions';

import type { GameApiContext } from './context.js';
import { IdempotentTurnDaemonTransport } from './daemon/idempotentTransport.js';
import { DuplicateInputEventError, executeInputEvent } from './inputEventBoundary.js';

const t = initTRPC.context<GameApiContext>().create();

const requireAuthMiddleware = t.middleware(({ ctx, next }) => {
    if (!ctx.auth) {
        throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Unauthorized',
        });
    }
    const profileNames = ctx.profile ? [ctx.profile.name, ctx.profile.id] : [];
    if (isGameAccessBlocked(ctx.auth.sanctions, profileNames)) {
        throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Game access is restricted for this account.',
        });
    }
    return next({
        ctx: {
            ...ctx,
            auth: ctx.auth,
        },
    });
});

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
export const authedProcedure: typeof procedure = procedure.use(requireAuthMiddleware);

// 턴 데몬이 ENGINE input_event와 world/DB 변경을 자체 transaction으로
// 커밋하는 mutation에 사용한다. API input-event transaction으로 한 번 더
// 감싸면 daemon이 아직 commit되지 않은 command를 볼 수 없어 교착된다.
export const engineAuthedProcedure: typeof procedure = t.procedure.use(requireAuthMiddleware);

// 페이지 조회 계측처럼 game state/input-event 원장과 무관한 세션 보조
// mutation에 사용한다. gameplay state 변경에는 사용하지 않는다.
export const sessionActivityProcedure = t.procedure;

// 시뮬레이터처럼 게임 상태를 변경하지 않는 계산은 input-event transaction과
// 이벤트 원장을 만들지 않는다. 인증은 유지하되 lifecycle DB 경계 밖에서 실행한다.
export const readOnlyAuthedProcedure: typeof procedure = t.procedure.use(requireAuthMiddleware);
