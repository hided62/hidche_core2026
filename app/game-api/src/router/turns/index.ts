import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { ITEM_KEYS, loadItemModules } from '@sammo-ts/logic';

import { authedProcedure, router } from '../../trpc.js';
import { buildBattleSimEnvironment } from '../../battleSim/environment.js';
import { loadBattleSimTraitOptions } from '../../battleSim/simulatorOptions.js';
import { buildTurnCommandTable, evaluateReservedTurnPermission } from '../../turns/commandTable.js';
import {
    parseReservedTurnArgs,
    TURN_COMMAND_NATION_COLORS,
    type TurnCommandInputOptions,
} from '../../turns/commandInput.js';
import {
    MAX_GENERAL_TURNS,
    MAX_NATION_TURNS,
    ReservedTurnRevisionConflictError,
    expandGeneralTurnIndices,
    getGeneralTurnSnapshot,
    getNationTurnSnapshot,
    repeatGeneralTurns,
    repeatNationTurns,
    setGeneralTurn,
    setGeneralTurns,
    setNationTurn,
    setNationTurns,
    shiftGeneralTurns,
    shiftNationTurns,
} from '../../turns/reservedTurns.js';
import { getOwnedGeneral } from '../shared/general.js';
import type { GameApiContext, GeneralRow, WorldStateRow } from '../../context.js';

const zPushAmount = z
    .number()
    .int()
    .min(-12)
    .max(12)
    .refine((value) => value !== 0, {
        message: 'Amount must be non-zero.',
    });

const zRepeatAmount = z.number().int().min(1).max(12);

const buildTurnListSchema = (minimum: number, maximum: number) =>
    z.array(z.number().int().min(minimum).max(maximum)).min(1);

const buildBulkEntrySchema = (turnList: z.ZodType<number[]>) =>
    z.object({
        turnList,
        action: z.string().min(1),
        args: z.unknown().optional(),
    });

const parseCommandArgs = async (scope: 'general' | 'nation', action: string, args: unknown) => {
    try {
        return await parseReservedTurnArgs(scope, action, args);
    } catch (error) {
        throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error instanceof Error ? error.message : 'Invalid turn command arguments.',
            cause: error,
        });
    }
};

const mutateReservedTurns = async <T>(mutation: () => Promise<T>): Promise<T> => {
    try {
        return await mutation();
    } catch (error) {
        if (error instanceof ReservedTurnRevisionConflictError) {
            throw new TRPCError({
                code: 'CONFLICT',
                message: 'Reserved turn queue changed. Reload and retry.',
                cause: error,
            });
        }
        throw error;
    }
};

const getReservationWorldState = async (ctx: GameApiContext): Promise<WorldStateRow> => {
    const worldState = await ctx.db.worldState.findFirst();
    if (!worldState) {
        throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'World state is not initialized.',
        });
    }
    return worldState;
};

const assertReservedTurnPermission = async (
    worldState: WorldStateRow,
    general: GeneralRow,
    scope: 'general' | 'nation',
    action: string,
    args: Record<string, unknown>
): Promise<void> => {
    const result = await evaluateReservedTurnPermission({
        worldState,
        general,
        scope,
        action,
        args,
    });
    if (result.kind === 'allow') {
        return;
    }
    throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message:
            result.kind === 'deny' ? `예약 불가능한 커맨드 :${result.reason}` : '예약 권한을 확인할 정보가 부족합니다.',
    });
};

export const getTurnCommandTable = async (ctx: GameApiContext, generalId: number) => {
    const [worldState, general] = await Promise.all([ctx.db.worldState.findFirst(), getOwnedGeneral(ctx, generalId)]);

    if (!worldState) {
        throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'World state is not initialized.',
        });
    }

    const [city, nation, nationGenerals, cities, nations, generals, environment, traits, itemModules] =
        await Promise.all([
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
            ctx.db.city.findMany({
                select: { id: true, name: true, nationId: true },
                orderBy: { id: 'asc' },
            }),
            ctx.db.nation.findMany({
                select: { id: true, name: true, color: true },
                orderBy: { id: 'asc' },
            }),
            ctx.db.general.findMany({
                where: { npcState: { lt: 2 } },
                select: { id: true, name: true, nationId: true, cityId: true },
                orderBy: { id: 'asc' },
            }),
            buildBattleSimEnvironment(worldState, ctx.profile.id),
            loadBattleSimTraitOptions(),
            loadItemModules([...ITEM_KEYS]),
        ]);

    const nationById = new Map(nations.map((entry) => [entry.id, entry]));
    const cityById = new Map(cities.map((entry) => [entry.id, entry]));
    const items: TurnCommandInputOptions['items'] = {
        horse: [{ value: 'None', label: '판매/해제' }],
        weapon: [{ value: 'None', label: '판매/해제' }],
        book: [{ value: 'None', label: '판매/해제' }],
        item: [{ value: 'None', label: '판매/해제' }],
    };
    for (const item of itemModules) {
        if (item.buyable) {
            items[item.slot].push({ value: item.key, label: item.name });
        }
    }
    const inputOptions: TurnCommandInputOptions = {
        cities: cities.map((entry) => ({
            value: entry.id,
            label: `${entry.name} (${nationById.get(entry.nationId)?.name ?? '무주'})`,
        })),
        nations: nations.map((entry) => ({
            value: entry.id,
            label: entry.name,
            color: entry.color,
        })),
        generals: generals.map((entry) => ({
            value: entry.id,
            label: `${entry.name} (${nationById.get(entry.nationId)?.name ?? '무소속'} · ${
                cityById.get(entry.cityId)?.name ?? '재야'
            })`,
        })),
        crewTypes: (environment.unitSet.crewTypes ?? [])
            .filter((entry) => !entry.requirements.some((requirement) => requirement.type === 'Impossible'))
            .map((entry) => ({ value: entry.id, label: entry.name })),
        armTypes: Object.entries(environment.unitSet.armTypes ?? {}).map(([value, label]) => ({
            value: Number(value),
            label,
        })),
        nationTypes: traits.nationTypes.map((entry) => ({ value: entry.key, label: entry.name })),
        colors: TURN_COMMAND_NATION_COLORS.map((color, index) => ({
            value: index,
            label: `색상 ${index + 1}`,
            color,
        })),
        items,
    };

    return buildTurnCommandTable({
        worldState,
        general,
        city,
        nation,
        nationGenerals,
        inputOptions,
    });
};

export const turnsRouter = router({
    getCommandTable: authedProcedure
        .input(
            z.object({
                generalId: z.number().int().positive(),
            })
        )
        .query(({ ctx, input }) => getTurnCommandTable(ctx, input.generalId)),
    reserved: router({
        getGeneral: authedProcedure
            .input(
                z.object({
                    generalId: z.number().int().positive(),
                })
            )
            .query(async ({ ctx, input }) => {
                await getOwnedGeneral(ctx, input.generalId);

                return getGeneralTurnSnapshot(ctx.db, input.generalId);
            }),
        getNation: authedProcedure
            .input(
                z.object({
                    generalId: z.number().int().positive(),
                })
            )
            .query(async ({ ctx, input }) => {
                const general = await getOwnedGeneral(ctx, input.generalId);
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

                return getNationTurnSnapshot(ctx.db, general.nationId, general.officerLevel);
            }),
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
                    expectedRevision: z.number().int().nonnegative(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const general = await getOwnedGeneral(ctx, input.generalId);
                const args = await parseCommandArgs('general', input.action, input.args);
                const worldState = await getReservationWorldState(ctx);
                await assertReservedTurnPermission(worldState, general, 'general', input.action, args);

                const snapshot = await mutateReservedTurns(() =>
                    setGeneralTurn(ctx.db, input.generalId, input.turnIndex, input.action, args, input.expectedRevision)
                );
                return { ok: true, ...snapshot };
            }),
        shiftGeneral: authedProcedure
            .input(
                z.object({
                    generalId: z.number().int().positive(),
                    amount: zPushAmount,
                    expectedRevision: z.number().int().nonnegative(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                await getOwnedGeneral(ctx, input.generalId);

                const snapshot = await mutateReservedTurns(() =>
                    shiftGeneralTurns(ctx.db, input.generalId, input.amount, input.expectedRevision)
                );
                return { ok: true, ...snapshot };
            }),
        repeatGeneral: authedProcedure
            .input(
                z.object({
                    generalId: z.number().int().positive(),
                    amount: zRepeatAmount,
                    expectedRevision: z.number().int().nonnegative(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                await getOwnedGeneral(ctx, input.generalId);
                const snapshot = await mutateReservedTurns(() =>
                    repeatGeneralTurns(ctx.db, input.generalId, input.amount, input.expectedRevision)
                );
                return { ok: true, ...snapshot };
            }),
        setGeneralBulk: authedProcedure
            .input(
                z.object({
                    generalId: z.number().int().positive(),
                    entries: z.array(buildBulkEntrySchema(buildTurnListSchema(-3, MAX_GENERAL_TURNS - 1))).min(1),
                    expectedRevision: z.number().int().nonnegative(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const general = await getOwnedGeneral(ctx, input.generalId);
                const updates = await Promise.all(
                    input.entries.map(async (entry) => ({
                        turnIndices: expandGeneralTurnIndices(entry.turnList),
                        action: entry.action,
                        args: await parseCommandArgs('general', entry.action, entry.args),
                    }))
                );
                const worldState = await getReservationWorldState(ctx);
                for (const update of updates) {
                    await assertReservedTurnPermission(worldState, general, 'general', update.action, update.args);
                }
                const snapshot = await mutateReservedTurns(() =>
                    setGeneralTurns(ctx.db, input.generalId, updates, input.expectedRevision)
                );
                return { ok: true, ...snapshot };
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
                    expectedRevision: z.number().int().nonnegative(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const general = await getOwnedGeneral(ctx, input.generalId);
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
                const args = await parseCommandArgs('nation', input.action, input.args);
                const worldState = await getReservationWorldState(ctx);
                await assertReservedTurnPermission(worldState, general, 'nation', input.action, args);

                const snapshot = await mutateReservedTurns(() =>
                    setNationTurn(
                        ctx.db,
                        general.nationId,
                        general.officerLevel,
                        input.turnIndex,
                        input.action,
                        args,
                        input.expectedRevision
                    )
                );
                return { ok: true, ...snapshot };
            }),
        shiftNation: authedProcedure
            .input(
                z.object({
                    generalId: z.number().int().positive(),
                    amount: zPushAmount,
                    expectedRevision: z.number().int().nonnegative(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const general = await getOwnedGeneral(ctx, input.generalId);
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

                const snapshot = await mutateReservedTurns(() =>
                    shiftNationTurns(
                        ctx.db,
                        general.nationId,
                        general.officerLevel,
                        input.amount,
                        input.expectedRevision
                    )
                );
                return { ok: true, ...snapshot };
            }),
        repeatNation: authedProcedure
            .input(
                z.object({
                    generalId: z.number().int().positive(),
                    amount: zRepeatAmount,
                    expectedRevision: z.number().int().nonnegative(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const general = await getOwnedGeneral(ctx, input.generalId);
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
                const snapshot = await mutateReservedTurns(() =>
                    repeatNationTurns(
                        ctx.db,
                        general.nationId,
                        general.officerLevel,
                        input.amount,
                        input.expectedRevision
                    )
                );
                return { ok: true, ...snapshot };
            }),
        setNationBulk: authedProcedure
            .input(
                z.object({
                    generalId: z.number().int().positive(),
                    entries: z.array(buildBulkEntrySchema(buildTurnListSchema(0, MAX_NATION_TURNS - 1))).min(1),
                    expectedRevision: z.number().int().nonnegative(),
                })
            )
            .mutation(async ({ ctx, input }) => {
                const general = await getOwnedGeneral(ctx, input.generalId);
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
                const updates = await Promise.all(
                    input.entries.map(async (entry) => ({
                        turnIndices: entry.turnList,
                        action: entry.action,
                        args: await parseCommandArgs('nation', entry.action, entry.args),
                    }))
                );
                const worldState = await getReservationWorldState(ctx);
                for (const update of updates) {
                    await assertReservedTurnPermission(worldState, general, 'nation', update.action, update.args);
                }
                const snapshot = await mutateReservedTurns(() =>
                    setNationTurns(ctx.db, general.nationId, general.officerLevel, updates, input.expectedRevision)
                );
                return { ok: true, ...snapshot };
            }),
    }),
});
