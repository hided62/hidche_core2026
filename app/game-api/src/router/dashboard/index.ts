import { TRPCError } from '@trpc/server';
import type { ReadModelDelta } from '@sammo-ts/common';
import { z } from 'zod';

import { accessLimitAuthedProcedure, router } from '../../trpc.js';
import {
    canUseDashboardSourceRevision,
    readDashboardSourceRevisionState,
    type DashboardSourceRevisionState,
    type DashboardSourceSlice,
} from '../../services/dashboardSourceRevision.js';
import { createReadModelDelta } from '../../services/readModelDeltaCache.js';
import { getBoardAccess } from '../board/index.js';
import { getGeneralContext } from '../general/index.js';
import { getTurnCommandTable } from '../turns/index.js';

const zRevision = z.string().regex(/^[A-Za-z0-9_-]{22}$/u);

const zContextBundleInput = z.object({
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
    knownSource: z
        .object({
            context: zRevision.optional(),
            commandTable: zRevision.optional(),
            boardAccess: zRevision.optional(),
        })
        .optional(),
    forceSnapshot: z.boolean().optional(),
});

const createDashboardSliceDelta = async <T>(options: {
    included: boolean;
    sourceState: DashboardSourceRevisionState | null;
    slice: DashboardSourceSlice;
    knownContent?: string;
    knownSource?: string;
    forceSnapshot?: boolean;
    load: () => Promise<T | undefined>;
    create: (value: T) => Promise<ReadModelDelta<T>>;
}): Promise<ReadModelDelta<T> | undefined> => {
    if (!options.included) {
        return undefined;
    }

    const sourceRevision = options.sourceState?.sourceRevisions[options.slice];
    if (
        sourceRevision !== undefined &&
        options.knownContent !== undefined &&
        canUseDashboardSourceRevision({
            state: options.sourceState,
            slice: options.slice,
            knownContent: options.knownContent,
            knownSource: options.knownSource,
            forceSnapshot: options.forceSnapshot,
        })
    ) {
        return {
            kind: 'unchanged',
            revision: options.knownContent,
            sourceRevision,
        };
    }

    const value = await options.load();
    if (value === undefined) {
        return undefined;
    }
    const delta = await options.create(value);
    return sourceRevision ? { ...delta, sourceRevision } : delta;
};

export const dashboardRouter = router({
    getContextBundleDelta: accessLimitAuthedProcedure.input(zContextBundleInput).query(async ({ ctx, input }) => {
        const viewerId = ctx.auth?.user.id;
        if (!viewerId) {
            throw new TRPCError({ code: 'UNAUTHORIZED' });
        }

        const includesProjection = Object.values(input.include).some(Boolean);
        let generalId: number | null = null;
        if (includesProjection) {
            generalId =
                ctx.realtimeAccessGeneralId ??
                (
                    await ctx.db.general.findFirst({
                        where: { userId: viewerId },
                        orderBy: { id: 'asc' },
                        select: { id: true },
                    })
                )?.id ??
                null;
        }
        const sourceState = generalId
            ? await readDashboardSourceRevisionState(ctx.db, generalId)
            : null;

        const [contextDelta, commandTableDelta, boardAccessDelta] = await Promise.all([
            createDashboardSliceDelta({
                included: input.include.context,
                sourceState,
                slice: 'context',
                knownContent: input.known?.context,
                knownSource: input.knownSource?.context,
                forceSnapshot: input.forceSnapshot,
                load: () => getGeneralContext(ctx),
                create: (value) =>
                    createReadModelDelta({
                        store: ctx.redis,
                        profile: ctx.profile.name,
                        viewerId,
                        slice: `main-context:${generalId ?? 'none'}`,
                        value,
                        knownRevision: input.known?.context,
                        forceSnapshot: input.forceSnapshot,
                    }),
            }),
            createDashboardSliceDelta({
                included: input.include.commandTable && generalId !== null,
                sourceState,
                slice: 'commandTable',
                knownContent: input.known?.commandTable,
                knownSource: input.knownSource?.commandTable,
                forceSnapshot: input.forceSnapshot,
                load: () => (generalId ? getTurnCommandTable(ctx, generalId) : Promise.resolve(undefined)),
                create: (value) =>
                    createReadModelDelta({
                        store: ctx.redis,
                        profile: ctx.profile.name,
                        viewerId,
                        slice: `main-command-table:${generalId}`,
                        value,
                        knownRevision: input.known?.commandTable,
                        forceSnapshot: input.forceSnapshot,
                    }),
            }),
            createDashboardSliceDelta({
                included: input.include.boardAccess && generalId !== null,
                sourceState,
                slice: 'boardAccess',
                knownContent: input.known?.boardAccess,
                knownSource: input.knownSource?.boardAccess,
                forceSnapshot: input.forceSnapshot,
                load: () => (generalId ? getBoardAccess(ctx) : Promise.resolve(undefined)),
                create: (value) =>
                    createReadModelDelta({
                        store: ctx.redis,
                        profile: ctx.profile.name,
                        viewerId,
                        slice: `main-board-access:${generalId}`,
                        value,
                        knownRevision: input.known?.boardAccess,
                        forceSnapshot: input.forceSnapshot,
                    }),
            }),
        ]);

        return {
            context: contextDelta,
            commandTable: commandTableDelta,
            boardAccess: boardAccessDelta,
        };
    }),
});
