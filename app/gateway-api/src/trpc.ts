import { safeTrpcErrorFormatter } from '@sammo-ts/common';
import { AuthBudgetError, isBudgetedAuthAction } from './auth/attemptBudget.js';
import { initTRPC, TRPCError } from '@trpc/server';

import type { GatewayApiContext } from './context.js';

const t = initTRPC.context<GatewayApiContext>().create({ errorFormatter: safeTrpcErrorFormatter });

export const router = t.router;
export const procedure = t.procedure.use(async ({ ctx, path, getRawInput, next }) => {
    if (!isBudgetedAuthAction(path)) return next();
    const raw: unknown = await getRawInput();
    const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const resolveSubject = async (): Promise<string | undefined> => {
        if (path === 'auth.login' && typeof input.username === 'string' && input.username.length <= 64) {
            return `login:${input.username.trim().toLocaleLowerCase('en-US')}`;
        }
        if (path.startsWith('account.') && typeof input.sessionToken === 'string' && input.sessionToken.length <= 256) {
            const session = await ctx.sessions.getSession(input.sessionToken);
            if (session) return `account:${session.userId}`;
        }
        return undefined;
    };
    try {
        return await ctx.authBudget.run(path, ctx.requestIp, resolveSubject, () => next());
    } catch (error) {
        if (!(error instanceof AuthBudgetError)) throw error;
        throw new TRPCError({
            code: error.reason === 'limited' ? 'TOO_MANY_REQUESTS' : 'SERVICE_UNAVAILABLE',
            message:
                error.reason === 'limited'
                    ? `인증 요청이 많습니다. ${error.retryAfterSeconds}초 후 다시 시도해 주세요.`
                    : '인증 보호 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
        });
    }
});
