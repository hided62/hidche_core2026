import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '../../trpc.js';
import { createReadModelDelta } from '../../services/readModelDeltaCache.js';
import { getBoardAccess } from '../board/index.js';
import { getGeneralContext } from '../general/index.js';
import { getTurnCommandTable } from '../turns/index.js';

const zRevision = z.string().regex(/^[A-Za-z0-9_-]{22}$/u);

const zContextBundleInput = z
    .object({
        include: z.object({
            context: z.boolean(),
            commandTable: z.boolean(),
            boardAccess: z.boolean(),
        }),
        known: z
            .object({
                context: zRevision.optional(),
                commandTable: zRevision.optional(),
                boardAccess: zRevision.optional(),
            })
            .optional(),
        forceSnapshot: z.boolean().optional(),
    })
    .refine((input) => Object.values(input.include).some(Boolean), {
        message: 'At least one dashboard context slice must be requested.',
        path: ['include'],
    });

export const dashboardRouter = router({
    getContextBundleDelta: authedProcedure.input(zContextBundleInput).query(async ({ ctx, input }) => {
        const viewerId = ctx.auth?.user.id;
        if (!viewerId) {
            throw new TRPCError({ code: 'UNAUTHORIZED' });
        }

        const currentContext = await getGeneralContext(ctx);
        const generalId = currentContext?.general.id ?? null;
        const [commandTable, boardAccess] = await Promise.all([
            input.include.commandTable && generalId ? getTurnCommandTable(ctx, generalId) : Promise.resolve(undefined),
            input.include.boardAccess && generalId ? getBoardAccess(ctx) : Promise.resolve(undefined),
        ]);
        const context = input.include.context ? currentContext : undefined;

        const [contextDelta, commandTableDelta, boardAccessDelta] = await Promise.all([
            context === undefined
                ? Promise.resolve(undefined)
                : createReadModelDelta({
                      store: ctx.redis,
                      profile: ctx.profile.name,
                      viewerId,
                      slice: `main-context:${generalId ?? 'none'}`,
                      value: context,
                      knownRevision: input.known?.context,
                      forceSnapshot: input.forceSnapshot,
                  }),
            commandTable === undefined
                ? Promise.resolve(undefined)
                : createReadModelDelta({
                      store: ctx.redis,
                      profile: ctx.profile.name,
                      viewerId,
                      slice: `main-command-table:${generalId}`,
                      value: commandTable,
                      knownRevision: input.known?.commandTable,
                      forceSnapshot: input.forceSnapshot,
                  }),
            boardAccess === undefined
                ? Promise.resolve(undefined)
                : createReadModelDelta({
                      store: ctx.redis,
                      profile: ctx.profile.name,
                      viewerId,
                      slice: `main-board-access:${generalId}`,
                      value: boardAccess,
                      knownRevision: input.known?.boardAccess,
                      forceSnapshot: input.forceSnapshot,
                  }),
        ]);

        return {
            context: contextDelta,
            commandTable: commandTableDelta,
            boardAccess: boardAccessDelta,
        };
    }),
});
