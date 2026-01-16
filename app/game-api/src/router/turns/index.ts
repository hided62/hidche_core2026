import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '../../trpc.js';
import { buildTurnCommandTable } from '../../turns/commandTable.js';
import {
    MAX_GENERAL_TURNS,
    MAX_NATION_TURNS,
    setGeneralTurn,
    setNationTurn,
    shiftGeneralTurns,
    shiftNationTurns,
} from '../../turns/reservedTurns.js';

const buildShiftAmountSchema = (maxTurns: number) =>
    z
        .number()
        .int()
        .min(-(maxTurns - 1))
        .max(maxTurns - 1)
        .refine((value) => value !== 0, {
            message: 'Amount must be non-zero.',
        });

export const turnsRouter = router({
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

            const [city, nation, nationGenerals] = await Promise.all([
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
                general.nationId > 0
                    ? ctx.db.general.findMany({
                          where: { nationId: general.nationId },
                      })
                    : Promise.resolve(null),
            ]);

            return buildTurnCommandTable({
                worldState,
                general,
                city,
                nation,
                nationGenerals,
            });
        }),
    reserved: router({
        setGeneral: authedProcedure
            .input(
                z.object({
                    generalId: z.number().int().positive(),
                    turnIndex: z
                        .number()
                        .int()
                        .min(0)
                        .max(MAX_GENERAL_TURNS - 1),
                    action: z.string().min(1),
                    args: z.unknown().optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const general = await ctx.db.general.findUnique({
                    where: { id: input.generalId },
                });
                if (!general) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'General not found.',
                    });
                }

                const turns = await setGeneralTurn(
                    ctx.db,
                    input.generalId,
                    input.turnIndex,
                    input.action,
                    input.args
                );
                return { ok: true, turns };
            }),
        shiftGeneral: authedProcedure
            .input(
                z.object({
                    generalId: z.number().int().positive(),
                    amount: buildShiftAmountSchema(MAX_GENERAL_TURNS),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const general = await ctx.db.general.findUnique({
                    where: { id: input.generalId },
                });
                if (!general) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'General not found.',
                    });
                }

                const turns = await shiftGeneralTurns(ctx.db, input.generalId, input.amount);
                return { ok: true, turns };
            }),
        setNation: authedProcedure
            .input(
                z.object({
                    generalId: z.number().int().positive(),
                    turnIndex: z
                        .number()
                        .int()
                        .min(0)
                        .max(MAX_NATION_TURNS - 1),
                    action: z.string().min(1),
                    args: z.unknown().optional(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const general = await ctx.db.general.findUnique({
                    where: { id: input.generalId },
                });
                if (!general) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'General not found.',
                    });
                }
                if (general.nationId <= 0) {
                    throw new TRPCError({
                        code: 'PRECONDITION_FAILED',
                        message: 'General is not part of a nation.',
                    });
                }
                if (general.officerLevel < 5) {
                    throw new TRPCError({
                        code: 'FORBIDDEN',
                        message: 'General is not an officer.',
                    });
                }

                const turns = await setNationTurn(
                    ctx.db,
                    general.nationId,
                    general.officerLevel,
                    input.turnIndex,
                    input.action,
                    input.args
                );
                return { ok: true, turns };
            }),
        shiftNation: authedProcedure
            .input(
                z.object({
                    generalId: z.number().int().positive(),
                    amount: buildShiftAmountSchema(MAX_NATION_TURNS),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const general = await ctx.db.general.findUnique({
                    where: { id: input.generalId },
                });
                if (!general) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: 'General not found.',
                    });
                }
                if (general.nationId <= 0) {
                    throw new TRPCError({
                        code: 'PRECONDITION_FAILED',
                        message: 'General is not part of a nation.',
                    });
                }
                if (general.officerLevel < 5) {
                    throw new TRPCError({
                        code: 'FORBIDDEN',
                        message: 'General is not an officer.',
                    });
                }

                const turns = await shiftNationTurns(ctx.db, general.nationId, general.officerLevel, input.amount);
                return { ok: true, turns };
            }),
    }),
});
