import { randomUUID } from 'node:crypto';
import { initTRPC, TRPCError } from '@trpc/server';
import { ChangeJournal } from '@sammo-ts/common';
import { isGameAccessBlocked } from '@sammo-ts/common/auth/sanctions';
import { writeReadModelChangeJournal } from '@sammo-ts/infra';

import type { GameApiContext } from './context.js';
import { IdempotentTurnDaemonTransport } from './daemon/idempotentTransport.js';
import { DuplicateInputEventError, executeInputEvent } from './inputEventBoundary.js';
import {
    formatGeneralAccessLimitMessage,
    generalAccessLimitEndpoints,
    getGeneralAccessState,
    recordGeneralAccessWeight,
    resolveGeneralAccessEndpointWeight,
    type GeneralAccessEndpoint,
} from './services/generalAccess.js';
import { getDeferredGeneralAccessLimit } from './services/deferredGeneralAccess.js';

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
    const changeJournal = new ChangeJournal();
    let journalPersisted = false;
    try {
        const result = await executeInputEvent({
            db: ctx.db,
            requestId,
            eventType: path,
            actorUserId: ctx.auth?.user.id,
            execute: async (transaction) => {
                const result = await next({
                    ctx: {
                        ...ctx,
                        db: transaction,
                        changeJournal,
                        turnDaemon: new IdempotentTurnDaemonTransport(ctx.turnDaemon, requestId),
                    },
                });
                if (!result.ok) {
                    throw result.error;
                }
                journalPersisted = Boolean(await writeReadModelChangeJournal(transaction, changeJournal.snapshot()));
                return result;
            },
        });
        if (journalPersisted) {
            ctx.readModelOutbox?.wake();
        }
        return result;
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

const generalAccessEndpointMiddleware = t.middleware(async ({ ctx, path, input, next }) => {
    // 실제 HTTP context는 createGameApiContext()가 이 flag를 설정한다.
    // Router 단위 테스트의 부분 DB mock은 명시적으로 opt-in할 때만 계측한다.
    if (ctx.generalAccessTracking !== true) {
        return next();
    }
    const weight = resolveGeneralAccessEndpointWeight(path, input, ctx.profile.name);
    if (weight === undefined) {
        throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `General access endpoint is not registered: ${path}`,
        });
    }
    if (weight === null) {
        return next();
    }
    const endpoint = path as GeneralAccessEndpoint;
    await recordGeneralAccessWeight(ctx, weight);
    if (generalAccessLimitEndpoints.has(endpoint)) {
        const state = await getGeneralAccessState(ctx);
        if (state?.level === 2) {
            throw new TRPCError({
                code: 'TOO_MANY_REQUESTS',
                message: formatGeneralAccessLimitMessage(state),
            });
        }
    }
    return next();
});

const generalAccessLimitMiddleware = t.middleware(async ({ ctx, next }) => {
    if (ctx.generalAccessTracking !== true) {
        return next();
    }
    const state = await getGeneralAccessState(ctx);
    if (state?.level === 2) {
        throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: formatGeneralAccessLimitMessage(state),
        });
    }
    return next();
});

const deferredGeneralAccessLimitMiddleware = t.middleware(async ({ ctx, next }) => {
    if (ctx.generalAccessTracking !== true) {
        return next();
    }
    const state = await getDeferredGeneralAccessLimit(ctx.redis, ctx.profile.name, ctx.auth);
    if (state) {
        throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: formatGeneralAccessLimitMessage(state),
        });
    }
    return next();
});

export const router = t.router;
export const procedure = t.procedure.use(inputEventMiddleware);
export const authedProcedure: typeof procedure = procedure.use(requireAuthMiddleware);

// Ref의 increaseRefresh()는 로그인/제재 확인 뒤, 업무 validation과 mutation
// transaction보다 먼저 별도 저장된다. access middleware를 input-event보다
// 앞에 두어 실패하거나 재시도되는 업무 transaction과 접속 기록을 분리한다.
export const accessAuthedProcedure: typeof procedure = t.procedure
    .use(requireAuthMiddleware)
    .use(generalAccessEndpointMiddleware)
    .use(inputEventMiddleware);

// 턴 데몬이 ENGINE input_event와 world/DB 변경을 자체 transaction으로
// 커밋하는 mutation에 사용한다. API input-event transaction으로 한 번 더
// 감싸면 daemon이 아직 commit되지 않은 command를 볼 수 없어 교착된다.
export const engineAuthedProcedure: typeof procedure = t.procedure.use(requireAuthMiddleware);
export const engineProcedure: typeof procedure = t.procedure;
export const accessEngineAuthedProcedure: typeof procedure = t.procedure
    .use(requireAuthMiddleware)
    .use(generalAccessEndpointMiddleware);

// 페이지 조회 계측처럼 game state/input-event 원장과 무관한 세션 보조
// mutation에 사용한다. gameplay state 변경에는 사용하지 않는다.
export const sessionActivityProcedure = t.procedure;

// 시뮬레이터처럼 게임 상태를 변경하지 않는 계산은 input-event transaction과
// 이벤트 원장을 만들지 않는다. 인증은 유지하되 lifecycle DB 경계 밖에서 실행한다.
export const readOnlyAuthedProcedure: typeof procedure = t.procedure.use(requireAuthMiddleware);
export const accessLimitAuthedProcedure: typeof procedure = t.procedure
    .use(requireAuthMiddleware)
    .use(generalAccessLimitMiddleware);
export const deferredAccessLimitAuthedProcedure: typeof procedure = t.procedure
    .use(requireAuthMiddleware)
    .use(deferredGeneralAccessLimitMiddleware);
// 입력이 있는 Ref handler는 request parsing을 마친 뒤 increaseRefresh()를
// 호출한다. 이 factory들은 parser를 access/input-event middleware 앞에 둔다.
export const accessInputProcedure: typeof procedure.input = (input) =>
    t.procedure.input(input).use(generalAccessEndpointMiddleware).use(inputEventMiddleware);
export const accessAuthedInputProcedure: typeof procedure.input = (input) =>
    t.procedure.use(requireAuthMiddleware).input(input).use(generalAccessEndpointMiddleware).use(inputEventMiddleware);
export const accessEngineAuthedInputProcedure: typeof procedure.input = (input) =>
    t.procedure.use(requireAuthMiddleware).input(input).use(generalAccessEndpointMiddleware);
export const accessReadOnlyAuthedInputProcedure: typeof procedure.input = (input) =>
    t.procedure.use(requireAuthMiddleware).input(input).use(generalAccessEndpointMiddleware);
export const accessLimitAuthedInputProcedure: typeof procedure.input = (input) =>
    t.procedure.use(requireAuthMiddleware).input(input).use(generalAccessLimitMiddleware);
