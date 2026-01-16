import { TRPCError } from '@trpc/server';

import { procedure, router } from '../../trpc.js';
import { buildBattleSimJobPayload } from '../../battleSim/environment.js';
import { zBattleSimJobId, zBattleSimRequest } from '../../battleSim/schema.js';

export const battleRouter = router({
    simulate: procedure.input(zBattleSimRequest).mutation(async ({ ctx, input }) => {
        const worldState = await ctx.db.worldState.findFirst();
        if (!worldState) {
            throw new TRPCError({
                code: 'PRECONDITION_FAILED',
                message: 'World state is not initialized.',
            });
        }

        const payload = await buildBattleSimJobPayload(worldState, input, ctx.profile.id);
        return ctx.battleSim.simulate(payload);
    }),
    getSimulation: procedure.input(zBattleSimJobId).query(async ({ ctx, input }) => {
        const result = await ctx.battleSim.getSimulationResult(input.jobId);
        if (!result) {
            return { status: 'queued', jobId: input.jobId };
        }
        return { status: 'completed', jobId: input.jobId, payload: result };
    }),
});
