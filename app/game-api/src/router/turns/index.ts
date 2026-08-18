import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { loadActionModuleBundle } from '@sammo-ts/logic';
import { asRecord } from '@sammo-ts/common';

import { accessAuthedInputProcedure, authedProcedure, router } from '../../trpc.js';
import { buildBattleSimEnvironment } from '../../battleSim/environment.js';
import { loadBattleSimTraitOptions } from '../../battleSim/simulatorOptions.js';
import {
    buildRecruitmentCommandInfo,
    buildTurnCommandTable,
    evaluateReservedTurnPermission,
} from '../../turns/commandTable.js';
import { loadMapDefinitionByName } from '../../maps/mapDefinition.js';
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
    setNationTurnAtCurrentPosition,
    setNationTurnsAtCurrentPositions,
    shiftGeneralTurns,
    shiftNationTurns,
} from '../../turns/reservedTurns.js';
import { getOwnedGeneral } from '../shared/general.js';
import type { GameApiContext, GeneralRow, WorldStateRow } from '../../context.js';
import {
    buildRefAmountPresets,
    buildRefGeneralTargetOptions,
    buildRefNationTargetOptions,
} from '../../turns/commandTargets.js';

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

const resolveMapName = (worldState: WorldStateRow, fallback: string): string => {
    const config = asRecord(worldState.config);
    const environment = asRecord(config.environment ?? config.map);
    const mapName = environment.mapName;
    return typeof mapName === 'string' && mapName.trim().length > 0 ? mapName : fallback;
};

const plainLegacyInfo = (value: string): string =>
    value
        .replace(/<br\s*\/?>/giu, ' · ')
        .replace(/<[^>]+>/gu, '')
        .replace(/\s+/gu, ' ')
        .trim();

const readGeneralMetaNumber = (meta: unknown, key: string): number | null => {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
    const value = (meta as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
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

    const environmentPromise = buildBattleSimEnvironment(worldState, ctx.profile.id);
    const moduleBundlePromise = environmentPromise.then((environment) =>
        loadActionModuleBundle(environment.unitSet, environment.scenarioEffect)
    );
    const [
        city,
        nation,
        nationGenerals,
        cities,
        nations,
        generals,
        diplomacy,
        troops,
        environment,
        traits,
        moduleBundle,
        map,
    ] = await Promise.all([
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
        ctx.db.city.findMany({ orderBy: { id: 'asc' } }),
        ctx.db.nation.findMany({
            select: {
                id: true,
                name: true,
                color: true,
                capitalCityId: true,
                level: true,
                meta: true,
            },
            orderBy: { id: 'asc' },
        }),
        ctx.db.general.findMany({
            select: {
                id: true,
                name: true,
                nationId: true,
                cityId: true,
                npcState: true,
                officerLevel: true,
                gold: true,
                rice: true,
                crew: true,
                train: true,
                atmos: true,
                troopId: true,
            },
            orderBy: [{ npcState: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        }),
        general.nationId > 0
            ? ctx.db.diplomacy.findMany({ where: { srcNationId: general.nationId } })
            : Promise.resolve([]),
        general.nationId > 0
            ? ctx.db.troop.findMany({ where: { nationId: general.nationId }, orderBy: { troopLeaderId: 'asc' } })
            : Promise.resolve([]),
        environmentPromise,
        loadBattleSimTraitOptions(),
        moduleBundlePromise,
        loadMapDefinitionByName(resolveMapName(worldState, ctx.profile.id)),
    ]);

    const nationById = new Map(nations.map((entry) => [entry.id, entry]));
    const cityById = new Map(cities.map((entry) => [entry.id, entry]));
    const generalCountByNation = new Map<number, number>();
    for (const entry of generals) {
        generalCountByNation.set(entry.nationId, (generalCountByNation.get(entry.nationId) ?? 0) + 1);
    }
    const cityCountByNation = new Map<number, number>();
    for (const entry of cities) {
        cityCountByNation.set(entry.nationId, (cityCountByNation.get(entry.nationId) ?? 0) + 1);
    }
    const diplomacyByNation = new Map(diplomacy.map((entry) => [entry.destNationId, entry]));
    const adjacentNationIds = new Set<number>();
    const actorCityIds = new Set(
        cities.filter((entry) => entry.nationId === general.nationId).map((entry) => entry.id)
    );
    for (const mapCity of map.cities) {
        if (!actorCityIds.has(mapCity.id)) continue;
        for (const adjacentId of mapCity.connections) {
            const adjacentNationId = cityById.get(adjacentId)?.nationId;
            if (adjacentNationId && adjacentNationId !== general.nationId) adjacentNationIds.add(adjacentNationId);
        }
    }
    const nationTargetOptions = buildRefNationTargetOptions({
        actorNationId: general.nationId,
        nations: nations.map((entry) => {
            const relation = diplomacyByNation.get(entry.id);
            return {
                id: entry.id,
                name: entry.name,
                color: entry.color,
                capitalName: entry.capitalCityId ? (cityById.get(entry.capitalCityId)?.name ?? '-') : '-',
                level: entry.level,
                power: readGeneralMetaNumber(entry.meta, 'power') ?? 0,
                generalCount: generalCountByNation.get(entry.id) ?? 0,
                cityCount: cityCountByNation.get(entry.id) ?? 0,
                diplomacyState: relation?.stateCode ?? 2,
                diplomacyTerm: relation?.term ?? 0,
                adjacent: adjacentNationIds.has(entry.id),
                diplomacyRestricted: (readGeneralMetaNumber(entry.meta, 'surlimit') ?? 0) !== 0,
            };
        }),
    });
    const generalTargetOptions = buildRefGeneralTargetOptions({
        actorId: general.id,
        actorNationId: general.nationId,
        generals,
        nationNames: new Map(nations.map((entry) => [entry.id, entry.name])),
        cityNames: new Map(cities.map((entry) => [entry.id, entry.name])),
        troopNames: new Map(troops.map((entry) => [entry.troopLeaderId, entry.name])),
    });
    const items: TurnCommandInputOptions['items'] = {
        horse: [{ value: 'None', label: '판매/해제' }],
        weapon: [{ value: 'None', label: '판매/해제' }],
        book: [{ value: 'None', label: '판매/해제' }],
        item: [{ value: 'None', label: '판매/해제' }],
    };
    for (const item of moduleBundle.itemModules) {
        if (item.buyable) {
            const cost = item.cost ?? 0;
            const currentSecurity = city?.security ?? 0;
            const availability =
                currentSecurity < item.reqSecu
                    ? `현재 구입 불가: 치안 ${item.reqSecu.toLocaleString()} 필요`
                    : general.gold < cost
                      ? `현재 구입 불가: 자금 ${cost.toLocaleString()} 필요`
                      : '현재 구입 가능';
            items[item.slot].push({
                value: item.key,
                label: item.name,
                description: `${availability} · 가격 ${cost.toLocaleString()} · ${plainLegacyInfo(item.info)}`,
            });
        }
    }
    const inputOptions: TurnCommandInputOptions = {
        cities: cities.map((entry) => ({
            value: entry.id,
            label: `${entry.name} (${nationById.get(entry.nationId)?.name ?? '무주'})`,
        })),
        nations: nationTargetOptions.nations,
        nationTargets: nationTargetOptions.nationTargets,
        generals: generalTargetOptions.generals,
        generalTargets: generalTargetOptions.generalTargets,
        crewTypes: (environment.unitSet.crewTypes ?? [])
            .filter((entry) => !entry.requirements.some((requirement) => requirement.type === 'Impossible'))
            .map((entry) => ({ value: entry.id, label: entry.name })),
        armTypes: Object.entries(environment.unitSet.armTypes ?? {}).map(([value, label]) => {
            const dexterity = readGeneralMetaNumber(general.meta, `dex${value}`);
            return {
                value: Number(value),
                label,
                ...(dexterity === null ? {} : { description: `현재 숙련 ${dexterity.toLocaleString()}` }),
            };
        }),
        nationTypes: traits.nationTypes.map((entry) => ({
            value: entry.key,
            label: entry.name,
            description: plainLegacyInfo(entry.info),
        })),
        colors: TURN_COMMAND_NATION_COLORS.map((color, index) => ({
            value: index,
            label: `색상 ${index + 1}`,
            color,
        })),
        items,
        recruitment: buildRecruitmentCommandInfo({
            worldState,
            general,
            city,
            nation,
            cities,
            map,
            unitSet: environment.unitSet,
            generalActionModules: moduleBundle.general,
        }),
        amountPresets: buildRefAmountPresets(
            nation?.level ?? 0,
            readGeneralMetaNumber(asRecord(asRecord(worldState.config).const), 'maxResourceActionAmount') ?? 10_000
        ),
        context: {
            actorGold: general.gold,
            actorRice: general.rice,
            ...(city ? { citySecurity: city.security } : {}),
            ...(nation ? { nationGold: nation.gold, nationRice: nation.rice, nationLevel: nation.level } : {}),
        },
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
    getCommandTable: accessAuthedInputProcedure(
        z.object({
            generalId: z.number().int().positive(),
        })
    ).query(({ ctx, input }) => getTurnCommandTable(ctx, input.generalId)),
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
                ctx.changeJournal?.mark('reserved.general', input.generalId);
                ctx.changeJournal?.mark('dashboard.global');
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
                ctx.changeJournal?.mark('reserved.general', input.generalId);
                ctx.changeJournal?.mark('dashboard.global');
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
                ctx.changeJournal?.mark('reserved.general', input.generalId);
                ctx.changeJournal?.mark('dashboard.global');
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
                ctx.changeJournal?.mark('reserved.general', input.generalId);
                ctx.changeJournal?.mark('dashboard.global');
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
                    setNationTurnAtCurrentPosition(
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
                    setNationTurnsAtCurrentPositions(
                        ctx.db,
                        general.nationId,
                        general.officerLevel,
                        updates,
                        input.expectedRevision
                    )
                );
                return { ok: true, ...snapshot };
            }),
    }),
});
