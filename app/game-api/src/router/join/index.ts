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
import { loadAuthoritativeAccountIcon } from '../../services/accountIconSync.js';
import { getSelectionPoolStatus, reserveSelectionPool, resolveSelectionMaxGeneral } from '../../services/selectPool.js';
import {
    ConflictingTurnDaemonCommandError,
    RejectedNpcPossessionCommandError,
} from '../../daemon/databaseTransport.js';
import { NpcPossessionError, reserveNpcPossessionCandidates } from '@sammo-ts/game-engine';
import { resolveNationScoutMessage } from '../nation/shared.js';

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

const resolveNpcPossessionCommandResult = (
    result: Awaited<ReturnType<GameApiContext['turnDaemon']['requestCommand']>> | null
): { ok: true; generalId: number } => {
    if (!result) {
        throw new TRPCError({
            code: 'TIMEOUT',
            message:
                'NPC 빙의 요청은 접수됐지만 처리 결과를 아직 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요.',
        });
    }
    if (result.type !== 'npcPossessGeneral') {
        throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: '턴 데몬이 올바르지 않은 NPC 빙의 결과를 반환했습니다.',
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

const resolveNpcPossessionRequestId = (
    contextRequestId: string | undefined,
    userId: string,
    clientRequestId: string | undefined
): string | undefined => {
    if (clientRequestId) {
        return `npc-possess:${userId}:${clientRequestId}`;
    }
    return contextRequestId ? `${contextRequestId}:join.possessGeneral` : undefined;
};

const requestNpcPossessionCommand = async (
    ctx: GameApiContext,
    command: Parameters<GameApiContext['turnDaemon']['requestCommand']>[0]
) => {
    try {
        return await ctx.turnDaemon.requestCommand(command);
    } catch (error) {
        if (
            error instanceof RejectedNpcPossessionCommandError ||
            (error instanceof Error && error.name === 'RejectedNpcPossessionCommandError')
        ) {
            throw new TRPCError({
                code: 'PRECONDITION_FAILED',
                message: error.message,
            });
        }
        if (
            error instanceof ConflictingTurnDaemonCommandError ||
            (error instanceof Error && error.name === 'ConflictingTurnDaemonCommandError')
        ) {
            throw new TRPCError({
                code: 'CONFLICT',
                message: '이미 접수된 NPC 빙의 요청과 입력이 다릅니다. 새 요청 번호로 다시 시도해 주세요.',
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
                scoutMessage: resolveNationScoutMessage(meta) || null,
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
                canCreateGeneral: ctx.auth?.identity?.canCreateGeneral !== false,
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
            npcPossession: {
                enabled: asNumber(config.npcMode ?? config.npcmode, 0) === 1,
            },
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
            const accountIcon = input.pic ? await loadAuthoritativeAccountIcon(ctx, userId) : null;
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
                ...(accountIcon
                    ? {
                          ownerPicture: accountIcon.picture,
                          ownerImageServer: accountIcon.imageServer,
                          ownerIconRevision: accountIcon.revision,
                      }
                    : {}),
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
                refresh: z.boolean().optional(),
                keepIds: z.array(z.number().int().positive()).max(5).optional(),
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
            const worldState = await ctx.db.worldState.findFirst();
            if (!worldState) {
                throw new TRPCError({
                    code: 'PRECONDITION_FAILED',
                    message: 'World state is not initialized.',
                });
            }
            try {
                return await reserveNpcPossessionCandidates({
                    db: ctx.db,
                    worldState,
                    userId: auth.user.id,
                    ownerIdentity: auth.user.legacyMemberNo ?? auth.user.id,
                    refresh: input.refresh,
                    keepIds: input.keepIds,
                });
            } catch (error) {
                if (error instanceof NpcPossessionError) {
                    throw new TRPCError({ code: error.code, message: error.message });
                }
                throw error;
            }
        }),
    possessGeneral: engineAuthedProcedure
        .input(
            z.object({
                generalId: z.number().int().positive(),
                tokenNonce: z.number().int().nonnegative(),
                clientRequestId: z.string().uuid().optional(),
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
            const commandRequestId = resolveNpcPossessionRequestId(ctx.requestId, userId, input.clientRequestId);
            const result = await requestNpcPossessionCommand(ctx, {
                type: 'npcPossessGeneral',
                ...(commandRequestId ? { requestId: commandRequestId } : {}),
                userId,
                ownerDisplayName: auth.user.displayName,
                profileId: ctx.profile.id,
                ...(auth.sanctions.legacyPenalty !== undefined
                    ? { ownerLegacyPenalty: auth.sanctions.legacyPenalty }
                    : {}),
                generalId: input.generalId,
                tokenNonce: input.tokenNonce,
            });
            return resolveNpcPossessionCommandResult(result);
        }),
});
