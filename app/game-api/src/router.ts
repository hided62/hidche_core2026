import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { WorldStateRow } from './context.js';
import { authedProcedure, procedure, router } from './trpc.js';
import { buildTurnCommandTable } from './turns/commandTable.js';

const zRunReason = z.enum(['schedule', 'manual', 'poke']);

const zTurnRunBudget = z.object({
    budgetMs: z.number().int().positive(),
    maxGenerals: z.number().int().positive(),
    catchUpCap: z.number().int().positive(),
});

const toWorldStateSnapshot = (row: WorldStateRow) => ({
    scenarioCode: row.scenarioCode,
    currentYear: row.currentYear,
    currentMonth: row.currentMonth,
    tickSeconds: row.tickSeconds,
    config: row.config,
    meta: row.meta,
    updatedAt: row.updatedAt.toISOString(),
});

export const appRouter = router({
    health: router({
        ping: procedure.query(({ ctx }) => ({
            ok: true,
            profile: ctx.profile.name,
            now: new Date().toISOString(),
        })),
    }),
    world: router({
        getState: procedure.query(async ({ ctx }) => {
            const state = await ctx.db.worldState.findFirst();
            return state ? toWorldStateSnapshot(state) : null;
        }),
    }),
    turns: router({
        getCommandTable: authedProcedure
            .input(
                z.object({
                    generalId: z.number().int().positive(),
                })
            )
            .query(async ({ ctx, input }) => {
                const [worldState, general] = await Promise.all([
                    ctx.db.worldState.findFirst(),
                    ctx.db.general.findUnique({ where: { id: input.generalId } }),
                ]);

                if (!worldState) {
                    throw new TRPCError({
                        code: 'PRECONDITION_FAILED',
                        message: 'World state is not initialized.',
                    });
                }

                if (!general) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'General not found.',
                    });
                }

                const [city, nation] = await Promise.all([
                    general.cityId > 0
                        ? ctx.db.city.findUnique({
                              where: { id: general.cityId },
                          })
                        : null,
                    general.nationId > 0
                        ? ctx.db.nation.findUnique({
                              where: { id: general.nationId },
                          })
                        : null,
                ]);

                return buildTurnCommandTable({
                    worldState,
                    general,
                    city,
                    nation,
                });
            }),
    }),
    turnDaemon: router({
        run: procedure
            .input(
                z.object({
                    reason: zRunReason,
                    targetTime: z.string().min(1).optional(),
                    budget: zTurnRunBudget.optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const requestId = await ctx.turnDaemon.sendCommand({
                    type: 'run',
                    reason: input.reason,
                    targetTime: input.targetTime,
                    budget: input.budget,
                });
                return { accepted: true, requestId };
            }),
        pause: procedure
            .input(
                z.object({
                    reason: z.string().min(1).optional(),
                }).optional()
            )
            .mutation(async ({ ctx, input }) => {
                const requestId = await ctx.turnDaemon.sendCommand({
                    type: 'pause',
                    reason: input?.reason,
                });
                return { accepted: true, requestId };
            }),
        resume: procedure
            .input(
                z.object({
                    reason: z.string().min(1).optional(),
                }).optional()
            )
            .mutation(async ({ ctx, input }) => {
                const requestId = await ctx.turnDaemon.sendCommand({
                    type: 'resume',
                    reason: input?.reason,
                });
                return { accepted: true, requestId };
            }),
        status: procedure
            .input(
                z.object({
                    timeoutMs: z.number().int().positive().optional(),
                }).optional()
            )
            .query(async ({ ctx, input }) => {
                return ctx.turnDaemon.requestStatus(input?.timeoutMs);
            }),
    }),
});

export type AppRouter = typeof appRouter;
