import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asRecord } from '@sammo-ts/common';
import { getDexLevel } from '@sammo-ts/logic';

import {
    accessAuthedInputProcedure,
    accessReadOnlyAuthedInputProcedure,
    authedProcedure,
    readOnlyAuthedProcedure,
    router,
} from '../../trpc.js';
import { buildBattleSimEnvironment, buildBattleSimJobPayload } from '../../battleSim/environment.js';
import { zBattleSimJobId, zBattleSimRequest } from '../../battleSim/schema.js';
import {
    BATTLE_SIM_CITY_LEVELS,
    BATTLE_SIM_DEX_LEVELS,
    BATTLE_SIM_NATION_LEVELS,
    loadBattleSimItemOptions,
    loadBattleSimTraitOptions,
} from '../../battleSim/simulatorOptions.js';
import { getMyGeneral } from '../shared/general.js';

const readNumber = (value: unknown, fallback = 0): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    return fallback;
};

const normalizeOptionalKey = (value: string | null): string | null => {
    if (!value || value === 'None') {
        return null;
    }
    return value;
};

const getAuthenticatedUserId = (auth: { user: { id: string } } | null): string => {
    const userId = auth?.user.id;
    if (!userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
    }
    return userId;
};

const resolveExpLevel = (meta: Record<string, unknown>, experience: number): number => {
    const expLevel = meta.explevel ?? meta.expLevel;
    if (typeof expLevel === 'number' && Number.isFinite(expLevel)) {
        return Math.max(0, Math.floor(expLevel));
    }
    if (!Number.isFinite(experience) || experience <= 0) {
        return 0;
    }
    return Math.floor(Math.sqrt(experience));
};

const resolveDexValue = (meta: Record<string, unknown>, key: string): number => {
    const raw = readNumber(meta[key], 0);
    const level = getDexLevel(raw);
    return BATTLE_SIM_DEX_LEVELS[level]?.value ?? 0;
};

export const battleRouter = router({
    simulate: accessReadOnlyAuthedInputProcedure(zBattleSimRequest).mutation(async ({ ctx, input }) => {
        const worldState = await ctx.db.worldState.findFirst();
        if (!worldState) {
            throw new TRPCError({
                code: 'PRECONDITION_FAILED',
                message: 'World state is not initialized.',
            });
        }

        const payload = await buildBattleSimJobPayload(worldState, input, ctx.profile.id);
        return ctx.battleSim.simulate(payload, getAuthenticatedUserId(ctx.auth));
    }),
    getSimulation: readOnlyAuthedProcedure.input(zBattleSimJobId).query(async ({ ctx, input }) => {
        const result = await ctx.battleSim.getSimulationResult(input.jobId, getAuthenticatedUserId(ctx.auth));
        if (!result) {
            return { status: 'queued', jobId: input.jobId };
        }
        return { status: 'completed', jobId: input.jobId, payload: result };
    }),
    getSimulatorContext: authedProcedure.query(async ({ ctx }) => {
        const worldState = await ctx.db.worldState.findFirst();
        if (!worldState) {
            throw new TRPCError({
                code: 'PRECONDITION_FAILED',
                message: 'World state is not initialized.',
            });
        }

        const environment = await buildBattleSimEnvironment(worldState, ctx.profile.id);
        const [traits, items] = await Promise.all([loadBattleSimTraitOptions(), loadBattleSimItemOptions()]);

        const crewTypes = (environment.unitSet.crewTypes ?? [])
            .filter((crewType) => crewType.armType !== environment.config.armTypes.castle)
            .map((crewType) => ({
                id: crewType.id,
                name: crewType.name,
                armType: crewType.armType,
            }));

        return {
            world: {
                startYear: environment.startYear,
                currentYear: worldState.currentYear,
                currentMonth: worldState.currentMonth,
            },
            config: {
                maxTrainByWar: environment.config.maxTrainByWar,
                maxAtmosByWar: environment.config.maxAtmosByWar,
                maxTrainByCommand: environment.config.maxTrainByCommand,
                maxAtmosByCommand: environment.config.maxAtmosByCommand,
            },
            unitSet: {
                defaultCrewTypeId: environment.unitSet.defaultCrewTypeId ?? crewTypes[0]?.id ?? 0,
                crewTypes,
            },
            nationTypes: traits.nationTypes,
            eventDomesticTraits: traits.eventDomesticTraits,
            warTraits: traits.warTraits,
            personalities: traits.personalities,
            items,
            nationLevels: BATTLE_SIM_NATION_LEVELS,
            cityLevels: BATTLE_SIM_CITY_LEVELS,
            dexLevels: BATTLE_SIM_DEX_LEVELS,
        };
    }),
    getGeneralList: authedProcedure.query(async ({ ctx }) => {
        const me = await getMyGeneral(ctx);
        const [generals, nations] = await Promise.all([
            ctx.db.general.findMany({
                select: {
                    id: true,
                    name: true,
                    npcState: true,
                    nationId: true,
                },
            }),
            ctx.db.nation.findMany({
                select: {
                    id: true,
                    name: true,
                    color: true,
                },
            }),
        ]);

        const nationMap = new Map<number, { id: number; name: string; color: string }>();
        for (const nation of nations) {
            nationMap.set(nation.id, nation);
        }

        const generalsByNation: Record<number, Array<{ id: number; name: string; npcState: number }>> = {};
        for (const general of generals) {
            if (!generalsByNation[general.nationId]) {
                generalsByNation[general.nationId] = [];
            }
            generalsByNation[general.nationId]?.push({
                id: general.id,
                name: general.name,
                npcState: general.npcState,
            });
        }

        if (generalsByNation[0] && !nationMap.has(0)) {
            nationMap.set(0, { id: 0, name: '재야', color: '#000000' });
        }

        return {
            myNationId: me.nationId,
            myGeneralId: me.id,
            nations: Array.from(nationMap.values()),
            generalsByNation,
        };
    }),
    getGeneralDetail: accessAuthedInputProcedure(
            z.object({
                generalId: z.number().int().positive(),
            })
        )
        .query(async ({ ctx, input }) => {
            const worldState = await ctx.db.worldState.findFirst();
            if (!worldState) {
                throw new TRPCError({
                    code: 'PRECONDITION_FAILED',
                    message: 'World state is not initialized.',
                });
            }

            const me = await getMyGeneral(ctx);
            const general = await ctx.db.general.findUnique({
                where: { id: input.generalId },
                select: {
                    id: true,
                    name: true,
                    npcState: true,
                    nationId: true,
                    leadership: true,
                    strength: true,
                    intel: true,
                    officerLevel: true,
                    injury: true,
                    rice: true,
                    crew: true,
                    crewTypeId: true,
                    atmos: true,
                    train: true,
                    experience: true,
                    horseCode: true,
                    weaponCode: true,
                    bookCode: true,
                    itemCode: true,
                    personalCode: true,
                    specialCode: true,
                    special2Code: true,
                    meta: true,
                },
            });

            if (!general) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: 'General not found.',
                });
            }

            const environment = await buildBattleSimEnvironment(worldState, ctx.profile.id);
            const defaultCrewTypeId =
                environment.unitSet.defaultCrewTypeId ?? environment.unitSet.crewTypes?.[0]?.id ?? 0;

            const meta = asRecord(general.meta);
            const isSameNation = me.nationId > 0 && me.nationId === general.nationId;

            const base = {
                no: general.id,
                name: general.name,
                officer_level: general.officerLevel,
                explevel: resolveExpLevel(meta, general.experience),
                leadership: general.leadership,
                horse: normalizeOptionalKey(general.horseCode),
                strength: general.strength,
                weapon: normalizeOptionalKey(general.weaponCode),
                intel: general.intel,
                book: normalizeOptionalKey(general.bookCode),
                item: normalizeOptionalKey(general.itemCode),
                injury: general.injury,
                rice: general.rice,
                personal: normalizeOptionalKey(general.personalCode),
                special: normalizeOptionalKey(general.specialCode),
                special2: normalizeOptionalKey(general.special2Code),
                crew: general.crew,
                crewtype: general.crewTypeId,
                atmos: general.atmos,
                train: general.train,
                dex1: resolveDexValue(meta, 'dex1'),
                dex2: resolveDexValue(meta, 'dex2'),
                dex3: resolveDexValue(meta, 'dex3'),
                dex4: resolveDexValue(meta, 'dex4'),
                dex5: resolveDexValue(meta, 'dex5'),
                defence_train: readNumber(meta.defenceTrain, 80),
                warnum: readNumber(meta.rank_warnum, 0),
                killnum: readNumber(meta.rank_killnum, 0),
                killcrew: readNumber(meta.rank_killcrew, 0),
            };

            if (!isSameNation) {
                return {
                    general: {
                        ...base,
                        officer_level: 1,
                        horse: null,
                        weapon: null,
                        book: null,
                        item: null,
                        crew: 0,
                        crewtype: defaultCrewTypeId,
                        rice: 10000,
                        train: environment.config.maxTrainByCommand,
                        atmos: environment.config.maxAtmosByCommand,
                        dex1: 0,
                        dex2: 0,
                        dex3: 0,
                        dex4: 0,
                        dex5: 0,
                        defence_train: 80,
                        warnum: 0,
                        killnum: 0,
                        killcrew: 0,
                    },
                };
            }

            return { general: base };
        }),
});
