import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { ITEM_KEYS, loadItemModules } from '@sammo-ts/logic';

import { authedProcedure, router } from '../../trpc.js';
import { buildBattleSimEnvironment } from '../../battleSim/environment.js';
import { loadBattleSimTraitOptions } from '../../battleSim/simulatorOptions.js';
import { buildTurnCommandTable } from '../../turns/commandTable.js';
import {
    parseReservedTurnArgs,
    TURN_COMMAND_NATION_COLORS,
    type TurnCommandInputOptions,
} from '../../turns/commandInput.js';
import {
    MAX_GENERAL_TURNS,
    MAX_NATION_TURNS,
    listGeneralTurns,
    listNationTurns,
    setGeneralTurn,
    setNationTurn,
    shiftGeneralTurns,
    shiftNationTurns,
} from '../../turns/reservedTurns.js';
import { getOwnedGeneral } from '../shared/general.js';

const buildShiftAmountSchema = (maxTurns: number) =>
    z
        .number()
        .int()
        .min(-(maxTurns - 1))
        .max(maxTurns - 1)
        .refine((value) => value !== 0, {
            message: 'Amount must be non-zero.',
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
                getOwnedGeneral(ctx, input.generalId),
            ]);

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
        }),
    reserved: router({
        getGeneral: authedProcedure
            .input(
                z.object({
                    generalId: z.number().int().positive(),
                })
            )
            .query(async ({ ctx, input }) => {
                await getOwnedGeneral(ctx, input.generalId);

                return listGeneralTurns(ctx.db, input.generalId);
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

                return listNationTurns(ctx.db, general.nationId, general.officerLevel);
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
                })
            )
            .mutation(async ({ ctx, input }) => {
                await getOwnedGeneral(ctx, input.generalId);
                const args = await parseCommandArgs('general', input.action, input.args);

                const turns = await setGeneralTurn(
                    ctx.db,
                    input.generalId,
                    input.turnIndex,
                    input.action,
                    args
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
                await getOwnedGeneral(ctx, input.generalId);

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

                const turns = await setNationTurn(
                    ctx.db,
                    general.nationId,
                    general.officerLevel,
                    input.turnIndex,
                    input.action,
                    args
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

                const turns = await shiftNationTurns(ctx.db, general.nationId, general.officerLevel, input.amount);
                return { ok: true, turns };
            }),
    }),
});
