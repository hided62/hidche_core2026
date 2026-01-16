import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { WorldStateRow } from '../../context.js';
import { procedure, router } from '../../trpc.js';
import { loadWorldMap } from '../../maps/worldMap.js';
import { loadMapLayout } from '../../maps/mapLayout.js';

const toWorldStateSnapshot = (row: WorldStateRow) => ({
    scenarioCode: row.scenarioCode,
    currentYear: row.currentYear,
    currentMonth: row.currentMonth,
    tickSeconds: row.tickSeconds,
    config: row.config,
    meta: row.meta,
    updatedAt: row.updatedAt.toISOString(),
});

export const worldRouter = router({
    getState: procedure.query(async ({ ctx }) => {
        const state = await ctx.db.worldState.findFirst();
        return state ? toWorldStateSnapshot(state) : null;
    }),
    getMapLayout: procedure.query(async ({ ctx }) => {
        return loadMapLayout(ctx.profile.scenario);
    }),
    getMap: procedure
        .input(
            z.object({
                generalId: z.number().int().positive().optional(),
                neutralView: z.boolean().optional(),
                showMe: z.boolean().optional(),
                useCache: z.boolean().optional(),
            })
        )
        .query(async ({ ctx, input }) => {
            const map = await loadWorldMap(ctx, input);
            if (!map) {
                throw new TRPCError({
                    code: 'PRECONDITION_FAILED',
                    message: 'World state is not initialized.',
                });
            }
            return map;
        }),
});
