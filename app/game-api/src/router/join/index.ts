import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { GameApiContext, WorldStateRow } from '../../context.js';
import { authedProcedure, engineAuthedProcedure, router } from '../../trpc.js';
import { asNumber, asRecord, asStringArray } from '@sammo-ts/common';
import {
    isWarTraitKey,
    JOIN_PERSONALITY_TRAIT_KEYS,
    loadPersonalityTraitModules,
    loadWarTraitModules,
    PersonalityTraitLoader,
    WarTraitLoader,
    WAR_TRAIT_KEYS,
} from '@sammo-ts/logic';
import { readInheritancePoint, resolveInheritConstants } from '../../services/inheritance.js';
import { getSelectionPoolStatus, reserveSelectionPool, resolveSelectionMaxGeneral } from '../../services/selectPool.js';
import { ConflictingTurnDaemonCommandError } from '../../daemon/databaseTransport.js';

const resolveSelectionCommandResult = (
    result: Awaited<ReturnType<GameApiContext['turnDaemon']['requestCommand']>> | null,
    expectedType: 'selectPoolCreate' | 'selectPoolReselect'
): { ok: true; generalId: number } => {
    if (!result) {
        throw new TRPCError({
            code: 'TIMEOUT',
            message:
                '장수 선택 요청은 접수됐지만 처리 결과를 아직 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요.',
        });
    }
    if (result.type !== expectedType) {
        throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: '턴 데몬이 올바르지 않은 장수 선택 결과를 반환했습니다.',
        });
    }
    if (!result.ok) {
        throw new TRPCError({
            code: result.code,
            message: result.reason,
        });
    }
    return { ok: true, generalId: result.generalId };
};

const resolveSelectionRequestId = (
    contextRequestId: string | undefined,
    userId: string,
    clientRequestId: string | undefined,
    operation: 'create' | 'reselect'
): string | undefined => {
    if (clientRequestId) {
        return `select-pool:${userId}:${clientRequestId}:${operation}`;
    }
    if (!contextRequestId) {
        return undefined;
    }
    const path = operation === 'create' ? 'join.selectPoolGeneral' : 'join.reselectPoolGeneral';
    return `${contextRequestId}:${path}`;
};

const resolveJoinCreateCommandResult = (
    result: Awaited<ReturnType<GameApiContext['turnDaemon']['requestCommand']>> | null
): { ok: true; generalId: number } => {
    if (!result) {
        throw new TRPCError({
            code: 'TIMEOUT',
            message:
                '장수 생성 요청은 접수됐지만 처리 결과를 아직 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요.',
        });
    }
    if (result.type !== 'joinCreateGeneral') {
        throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: '턴 데몬이 올바르지 않은 장수 생성 결과를 반환했습니다.',
        });
    }
    if (!result.ok) {
        throw new TRPCError({
            code: result.code,
            message: result.reason,
        });
    }
    return { ok: true, generalId: result.generalId };
};

const resolveJoinCreateRequestId = (
    contextRequestId: string | undefined,
    userId: string,
    clientRequestId: string | undefined
): string | undefined => {
    if (clientRequestId) {
        return `join-create:${userId}:${clientRequestId}`;
    }
    return contextRequestId ? `${contextRequestId}:join.createGeneral` : undefined;
};

const requestJoinCreateCommand = async (
    ctx: GameApiContext,
    command: Parameters<GameApiContext['turnDaemon']['requestCommand']>[0]
) => {
    try {
        return await ctx.turnDaemon.requestCommand(command);
    } catch (error) {
        if (
            error instanceof ConflictingTurnDaemonCommandError ||
            (error instanceof Error && error.name === 'ConflictingTurnDaemonCommandError')
        ) {
            throw new TRPCError({
                code: 'CONFLICT',
                message: '이미 접수된 장수 생성 요청과 입력이 다릅니다. 새 요청 번호로 다시 시도해 주세요.',
            });
        }
        throw error;
    }
};

const DEFAULT_JOIN_STAT = {
    total: 165,
    min: 15,
    max: 80,
    bonusMin: 3,
    bonusMax: 5,
};

const buildSpecialityAge = (retirementYear: number, age: number, relativeYear: number, divisor: number): number =>
    Math.max(Math.round((retirementYear - age) / divisor - relativeYear / 2), 3) + age;

export const resolveJoinSpecialityAges = (options: {
    retirementYear: number;
    age: number;
    relativeYear: number;
    scenarioId: number;
}): { domestic: number; war: number } => {
    if (Number.isFinite(options.scenarioId) && options.scenarioId >= 1000) {
        return { domestic: options.age + 3, war: options.age + 3 };
    }
    return {
        domestic: buildSpecialityAge(options.retirementYear, options.age, options.relativeYear, 12),
        war: buildSpecialityAge(options.retirementYear, options.age, options.relativeYear, 6),
    };
};

const resolveJoinStat = (worldState: WorldStateRow) => {
    const config = asRecord(worldState.config);
    const stat = asRecord(config.stat);
    return {
        total: asNumber(stat.total, DEFAULT_JOIN_STAT.total),
        min: asNumber(stat.min, DEFAULT_JOIN_STAT.min),
        max: asNumber(stat.max, DEFAULT_JOIN_STAT.max),
        bonusMin: DEFAULT_JOIN_STAT.bonusMin,
        bonusMax: DEFAULT_JOIN_STAT.bonusMax,
    };
};

const buildTurnTimeZones = (tickSeconds: number): string[] => {
    const zones: string[] = [];
    const legacyZoneSeconds = Math.max(1, Math.floor(tickSeconds / 60));
    for (let i = 0; i < 60; i += 1) {
        const startSeconds = i * legacyZoneSeconds;
        const endSeconds = startSeconds + legacyZoneSeconds - 1;
        const format = (totalSeconds: number, fraction: string): string =>
            `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(
                2,
                '0'
            )}.${fraction}`;
        zones.push(`${format(startSeconds, '000')} ~ ${format(endSeconds, '999')}`);
    }
    return zones;
};

let cachedPersonalityOptions: Array<{ key: string; name: string; info: string }> | null = null;
const zJoinPersonality = z.enum(['Random', ...JOIN_PERSONALITY_TRAIT_KEYS]);

const loadPersonalityOptions = async () => {
    if (cachedPersonalityOptions) {
        return cachedPersonalityOptions;
    }
    const modules = await loadPersonalityTraitModules([...JOIN_PERSONALITY_TRAIT_KEYS], new PersonalityTraitLoader());
    cachedPersonalityOptions = modules.map((trait) => ({
        key: trait.key,
        name: trait.name,
        info: trait.info ?? '',
    }));
    return cachedPersonalityOptions;
};

const loadWarOptions = async (keys: string[]) => {
    const unique = Array.from(new Set(keys.filter((key) => isWarTraitKey(key))));
    const modules = await loadWarTraitModules(unique, new WarTraitLoader());
    return modules.map((trait) => ({
        key: trait.key,
        name: trait.name,
        info: trait.info ?? '',
    }));
};

export const joinRouter = router({
    getConfig: authedProcedure.query(async ({ ctx }) => {
        const worldState = await ctx.db.worldState.findFirst();
        if (!worldState) {
            throw new TRPCError({
                code: 'PRECONDITION_FAILED',
                message: 'World state is not initialized.',
            });
        }

        const config = asRecord(worldState.config);
        const configConst = asRecord(config.const);
        const availableSpecialWar = asStringArray(configConst.availableSpecialWar);
        const warKeys = availableSpecialWar.length > 0 ? availableSpecialWar : [...WAR_TRAIT_KEYS];

        const [personalities, warSpecials, nationRows, userGeneralCount, npcGeneralCount] = await Promise.all([
            loadPersonalityOptions(),
            loadWarOptions(warKeys),
            ctx.db.nation.findMany({
                where: { id: { gt: 0 } },
                select: {
                    id: true,
                    name: true,
                    color: true,
                    meta: true,
                },
                orderBy: { id: 'asc' },
            }),
            ctx.db.general.count({ where: { npcState: { lt: 2 } } }),
            ctx.db.general.count({ where: { npcState: { gte: 2 } } }),
        ]);

        const nations = nationRows.map((nation) => {
            const meta = asRecord(nation.meta);
            return {
                id: nation.id,
                name: nation.name,
                color: nation.color,
                scoutMessage: typeof meta.infoText === 'string' ? meta.infoText : null,
            };
        });

        const inheritConst = resolveInheritConstants(worldState);
        const inheritTotalPoint = ctx.auth?.user.id
            ? await readInheritancePoint(ctx.db, ctx.auth.user.id, 'previous')
            : 0;
        const selectionPool = await getSelectionPoolStatus(ctx.db, worldState, ctx.auth?.user.id ?? '');
        const tickMinutes = Math.max(1, Math.round(worldState.tickSeconds / 60));
        const maxGeneral = resolveSelectionMaxGeneral(worldState);
        const inheritCities = await ctx.db.city.findMany({
            select: { id: true, name: true, level: true, region: true },
            orderBy: { id: 'asc' },
        });

        return {
            rules: {
                stat: resolveJoinStat(worldState),
                allowCustomName: (Math.floor(asNumber(config.blockGeneralCreate, 0)) & 2) === 0,
            },
            user: {
                id: ctx.auth?.user.id ?? '',
                displayName: ctx.auth?.user.displayName ?? '',
            },
            personalities: [{ key: 'Random', name: '???', info: '무작위 성격을 선택합니다.' }, ...personalities],
            warSpecials,
            nations,
            serverInfo: {
                currentYear: worldState.currentYear,
                currentMonth: worldState.currentMonth,
                tickMinutes,
                maxGeneral,
                userGeneralCount,
                npcGeneralCount,
            },
            inherit: {
                totalPoint: inheritTotalPoint,
                costs: {
                    inheritBornSpecialPoint: inheritConst.inheritBornSpecialPoint,
                    inheritBornTurntimePoint: inheritConst.inheritBornTurntimePoint,
                    inheritBornCityPoint: inheritConst.inheritBornCityPoint,
                    inheritBornStatPoint: inheritConst.inheritBornStatPoint,
                },
                availableCities: inheritCities,
                turnTimeZones: buildTurnTimeZones(worldState.tickSeconds),
                availableSpecialWar: warSpecials,
            },
            selectionPool,
        };
    }),
    getSelectionPool: authedProcedure.mutation(async ({ ctx }) => {
        const userId = ctx.auth?.user.id;
        if (!userId) {
            throw new TRPCError({ code: 'UNAUTHORIZED' });
        }
        const worldState = await ctx.db.worldState.findFirst();
        if (!worldState) {
            throw new TRPCError({
                code: 'PRECONDITION_FAILED',
                message: 'World state is not initialized.',
            });
        }
        return reserveSelectionPool({
            db: ctx.db,
            worldState,
            userId,
            seedOwnerIdentity: ctx.auth?.user.legacyMemberNo ?? userId,
        });
    }),
    selectPoolGeneral: engineAuthedProcedure
        .input(
            z.object({
                uniqueName: z.string().min(1).max(20),
                personality: z.string().min(1),
                clientRequestId: z.string().uuid().optional(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const auth = ctx.auth;
            if (!auth) {
                throw new TRPCError({ code: 'UNAUTHORIZED' });
            }
            const userId = auth.user.id;
            if (auth.identity?.canCreateGeneral === false) {
                throw new TRPCError({
                    code: 'FORBIDDEN',
                    message: '이 서버에서는 카카오 인증을 완료해야 장수를 생성할 수 있습니다.',
                });
            }
            const commandRequestId = resolveSelectionRequestId(ctx.requestId, userId, input.clientRequestId, 'create');
            const result = await ctx.turnDaemon.requestCommand({
                type: 'selectPoolCreate',
                ...(commandRequestId ? { requestId: commandRequestId } : {}),
                userId,
                ownerDisplayName: auth.user.displayName,
                uniqueName: input.uniqueName,
                personality: input.personality,
                seedOwnerIdentity: auth.user.legacyMemberNo ?? userId,
            });
            return resolveSelectionCommandResult(result, 'selectPoolCreate');
        }),
    reselectPoolGeneral: engineAuthedProcedure
        .input(
            z.object({
                uniqueName: z.string().min(1).max(20),
                clientRequestId: z.string().uuid().optional(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const auth = ctx.auth;
            if (!auth) {
                throw new TRPCError({ code: 'UNAUTHORIZED' });
            }
            const userId = auth.user.id;
            const commandRequestId = resolveSelectionRequestId(
                ctx.requestId,
                userId,
                input.clientRequestId,
                'reselect'
            );
            const result = await ctx.turnDaemon.requestCommand({
                type: 'selectPoolReselect',
                ...(commandRequestId ? { requestId: commandRequestId } : {}),
                userId,
                ownerDisplayName: auth.user.displayName,
                uniqueName: input.uniqueName,
            });
            return resolveSelectionCommandResult(result, 'selectPoolReselect');
        }),
    createGeneral: engineAuthedProcedure
        .input(
            z.object({
                name: z.string().min(1).max(18),
                leadership: z.number().int(),
                strength: z.number().int(),
                intel: z.number().int(),
                pic: z.boolean(),
                character: zJoinPersonality,
                clientRequestId: z.string().uuid().optional(),
                inheritSpecial: z.string().optional(),
                inheritTurntimeZone: z.number().int().optional(),
                inheritCity: z.number().int().optional(),
                inheritBonusStat: z.tuple([z.number().int(), z.number().int(), z.number().int()]).optional(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const auth = ctx.auth;
            if (!auth) {
                throw new TRPCError({ code: 'UNAUTHORIZED' });
            }
            if (auth.identity?.canCreateGeneral === false) {
                throw new TRPCError({
                    code: 'FORBIDDEN',
                    message: '이 서버에서는 카카오 인증을 완료해야 장수를 생성할 수 있습니다.',
                });
            }
            const userId = auth.user.id;
            const commandRequestId = resolveJoinCreateRequestId(ctx.requestId, userId, input.clientRequestId);
            const result = await requestJoinCreateCommand(ctx, {
                type: 'joinCreateGeneral',
                ...(commandRequestId ? { requestId: commandRequestId } : {}),
                userId,
                ownerDisplayName: auth.user.displayName,
                seedOwnerIdentity: auth.user.legacyMemberNo ?? userId,
                name: input.name,
                leadership: input.leadership,
                strength: input.strength,
                intel: input.intel,
                pic: input.pic,
                character: input.character,
                profileId: ctx.profile.id,
                ...(auth.user.picture !== undefined ? { ownerPicture: auth.user.picture } : {}),
                ...(auth.user.imageServer !== undefined ? { ownerImageServer: auth.user.imageServer } : {}),
                ...(auth.user.canUseGeneralPicture !== undefined
                    ? {
                          ownerCanUsePicture: auth.user.canUseGeneralPicture,
                      }
                    : {}),
                ...(auth.sanctions.legacyPenalty !== undefined
                    ? {
                          ownerLegacyPenalty: auth.sanctions.legacyPenalty,
                      }
                    : {}),
                ...(input.inheritSpecial !== undefined ? { inheritSpecial: input.inheritSpecial } : {}),
                ...(input.inheritTurntimeZone !== undefined ? { inheritTurntimeZone: input.inheritTurntimeZone } : {}),
                ...(input.inheritCity !== undefined ? { inheritCity: input.inheritCity } : {}),
                ...(input.inheritBonusStat !== undefined ? { inheritBonusStat: input.inheritBonusStat } : {}),
            });
            return resolveJoinCreateCommandResult(result);
        }),
    listPossessCandidates: authedProcedure
        .input(
            z.object({
                limit: z.number().int().min(1).max(50).optional(),
                offset: z.number().int().min(0).optional(),
            })
        )
        .query(async ({ ctx, input }) => {
            const limit = input.limit ?? 20;
            const offset = input.offset ?? 0;

            const candidates = await ctx.db.general.findMany({
                where: {
                    userId: null,
                    npcState: { gte: 2 },
                },
                orderBy: { id: 'asc' },
                skip: offset,
                take: limit,
                select: {
                    id: true,
                    name: true,
                    npcState: true,
                    nationId: true,
                    cityId: true,
                    leadership: true,
                    strength: true,
                    intel: true,
                    age: true,
                    officerLevel: true,
                    personalCode: true,
                    specialCode: true,
                    special2Code: true,
                    picture: true,
                    imageServer: true,
                },
            });

            const [nationRows, cityRows] = await Promise.all([
                ctx.db.nation.findMany({ select: { id: true, name: true, color: true } }),
                ctx.db.city.findMany({ select: { id: true, name: true } }),
            ]);
            const nationMap = new Map(nationRows.map((nation) => [nation.id, nation]));
            const cityMap = new Map(cityRows.map((city) => [city.id, city]));

            return candidates.map((candidate) => {
                const nation = nationMap.get(candidate.nationId);
                const city = cityMap.get(candidate.cityId);
                return {
                    id: candidate.id,
                    name: candidate.name,
                    npcState: candidate.npcState,
                    nation: nation
                        ? { id: nation.id, name: nation.name, color: nation.color }
                        : { id: 0, name: '재야', color: '#666666' },
                    city: city ? { id: city.id, name: city.name } : null,
                    stats: {
                        leadership: candidate.leadership,
                        strength: candidate.strength,
                        intelligence: candidate.intel,
                    },
                    age: candidate.age,
                    officerLevel: candidate.officerLevel,
                    personality: candidate.personalCode,
                    special: candidate.specialCode,
                    specialWar: candidate.special2Code,
                    picture: candidate.picture,
                    imageServer: candidate.imageServer,
                };
            });
        }),
    possessGeneral: authedProcedure
        .input(
            z.object({
                generalId: z.number().int().positive(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const userId = ctx.auth?.user.id;
            if (!userId) {
                throw new TRPCError({ code: 'UNAUTHORIZED' });
            }
            const existing = await ctx.db.general.findFirst({ where: { userId } });
            if (existing) {
                throw new TRPCError({
                    code: 'PRECONDITION_FAILED',
                    message: '이미 장수가 생성되어 있습니다.',
                });
            }

            await ctx.db.$transaction!(async (db) => {
                const [candidate, worldState] = await Promise.all([
                    db.general.findUnique({
                        where: { id: input.generalId },
                        select: { npcState: true, meta: true },
                    }),
                    db.worldState.findFirst({
                        select: { currentYear: true, currentMonth: true },
                    }),
                ]);
                if (!candidate || candidate.npcState < 2 || !worldState) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: '빙의 가능한 장수를 찾지 못했습니다.',
                    });
                }

                const now = new Date();
                const updated = await db.general.updateMany({
                    where: {
                        id: input.generalId,
                        userId: null,
                        npcState: candidate.npcState,
                    },
                    data: {
                        userId,
                        npcState: 1,
                        meta: {
                            ...asRecord(candidate.meta),
                            npc_org: candidate.npcState,
                            owner_name: ctx.auth?.user.displayName ?? '',
                            pickYearMonth: worldState.currentYear * 12 + worldState.currentMonth - 1,
                            killturn: 6,
                            defence_train: 80,
                        },
                        updatedAt: now,
                    },
                });
                if (updated.count === 0) {
                    throw new TRPCError({
                        code: 'NOT_FOUND',
                        message: '빙의 가능한 장수를 찾지 못했습니다.',
                    });
                }
                await db.generalAccessLog.upsert({
                    where: { generalId: input.generalId },
                    update: {
                        userId,
                        lastRefresh: now,
                        refresh: 0,
                        refreshTotal: 0,
                        refreshScore: 0,
                        refreshScoreTotal: 0,
                    },
                    create: {
                        generalId: input.generalId,
                        userId,
                        lastRefresh: now,
                    },
                });
            });

            return { ok: true };
        }),
});
