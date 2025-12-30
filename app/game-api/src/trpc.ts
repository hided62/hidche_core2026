import { initTRPC, TRPCError } from '@trpc/server';

import type { GameApiContext } from './context.js';

const t = initTRPC.context<GameApiContext>().create();

export const router = t.router;
export const procedure = t.procedure;
export const authedProcedure = t.procedure.use(({ ctx, next }) => {
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
