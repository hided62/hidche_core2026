import { procedure, router } from '../../trpc.js';

export const healthRouter = router({
    ping: procedure.query(({ ctx }) => ({
        ok: true,
        profile: ctx.profile.name,
        now: new Date().toISOString(),
    })),
});
