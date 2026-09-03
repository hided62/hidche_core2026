import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, engineAuthedProcedure, router } from '../../trpc.js';
import { asNumber, asRecord, parseJson, LiteHashDRBG, type TurnDaemonInheritanceAction } from '@sammo-ts/common';
import {
    ItemLoader,
    isItemKey,
    loadWarTraitModules,
    WarTraitLoader,
    WAR_TRAIT_KEYS,
    isWarTraitKey,
    isCentennialStatResetAllowed,
} from '@sammo-ts/logic';
import type { InheritBuffType, ItemSlot } from '@sammo-ts/logic';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';
import { resolveLegacyCompatibleUniqueConfig } from '@sammo-ts/logic/rewards/legacyUniqueItemPool.js';
import {
    buildResetCost,
    computeInheritanceItems,
    resolveInheritConstants,
    sumInheritanceItems,
} from '../../services/inheritance.js';
import type { GameApiContext, WorldStateRow } from '../../context.js';
import { openAuctionWithDaemon } from '../../auction/open.js';

const BUFF_KEYS: InheritBuffType[] = [
    'warAvoidRatio',
    'warCriticalRatio',
    'warMagicTrialProb',
    'domesticSuccessProb',
    'domesticFailProb',
    'warAvoidRatioOppose',
    'warCriticalRatioOppose',
    'warMagicTrialProbOppose',
];

const UNIQUE_ITEM_SLOT_ORDER: readonly ItemSlot[] = ['horse', 'weapon', 'book', 'item'];

const POSTGRES_INTEGER_MAX = 2_147_483_647;
const MIN_INHERIT_BUFF_LEVEL = 1;
const MAX_INHERIT_BUFF_LEVEL = 5;

const parseBuffRecord = (raw: unknown): Record<string, number> => {
    if (typeof raw === 'string') {
        const parsed = parseJson<Record<string, number>>(raw);
        return parsed ?? {};
    }
    const record = asRecord(raw);
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(record)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            result[key] = value;
        }
    }
    return result;
};

const readBuffLevel = (buff: Record<string, number>, key: InheritBuffType): number => {
    const compatibilityKey = key === 'domesticSuccessProb' ? 'success' : key === 'domesticFailProb' ? 'fail' : null;
    return Math.max(0, Math.min(5, Math.floor(buff[key] ?? (compatibilityKey ? buff[compatibilityKey] : 0) ?? 0)));
};

const loadAvailableUniqueItems = async (worldState: WorldStateRow) => {
    const configConst = asRecord(asRecord(worldState.config).const);
    const loader = new ItemLoader();
    const { allItems } = await resolveLegacyCompatibleUniqueConfig(configConst, loader);
    const enabledKeys: Array<Parameters<ItemLoader['load']>[0]> = [];
    for (const slot of UNIQUE_ITEM_SLOT_ORDER) {
        const entries = allItems[slot] ?? {};
        for (const [key, amount] of Object.entries(asRecord(entries))) {
            if (asNumber(amount, 0) !== 0 && isItemKey(key)) {
                enabledKeys.push(key);
            }
        }
    }
    const items = await Promise.all(
        [...new Set(enabledKeys)].map(async (key) => {
            const item = await loader.load(key);
            return {
                key,
                name: item.name,
                rawName: item.rawName,
                info: item.info ?? '',
                slot: item.slot,
            };
        })
    );
    return items;
};

const resolveWorld = async (ctx: { db: { worldState: { findFirst: () => Promise<unknown> } } }) => {
    const worldState = await ctx.db.worldState.findFirst();
    if (!worldState || typeof worldState !== 'object') {
        throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'World state is not initialized.',
        });
    }
    return worldState as {
        config: unknown;
        meta: unknown;
        currentYear: number;
        currentMonth: number;
        tickSeconds: number;
    };
};

const requestInheritanceAction = async (
    ctx: Pick<GameApiContext, 'turnDaemon' | 'requestId'>,
    userId: string,
    input: TurnDaemonInheritanceAction
) => {
    const result = await ctx.turnDaemon.requestCommand({
        type: 'inheritanceAction',
        userId,
        input,
        ...(ctx.requestId ? { requestId: `${ctx.requestId}:inherit.${input.action}:engine:0:inheritanceAction` } : {}),
    });
    if (!result || result.type !== 'inheritanceAction') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
    }
    if (!result.ok) {
        throw new TRPCError({ code: result.code, message: result.reason });
    }
    return result;
};

const buildTurnTimeZoneList = (tickMinutes: number): string[] => {
    const zones: string[] = [];
    for (let i = 0; i < 60; i += 1) {
        const totalMinutes = i * tickMinutes;
        const hour = Math.floor(totalMinutes / 60) % 24;
        const minute = totalMinutes % 60;
        zones.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    }
    return zones;
};

const formatTurnTimeBaseLabel = (value: number): string => {
    const wholeSeconds = Math.trunc(value);
    const hours = String(Math.trunc(wholeSeconds / 3600)).padStart(2, '0');
    const minutes = String(Math.trunc((wholeSeconds % 3600) / 60)).padStart(2, '0');
    return `${hours}:${minutes}`;
};

export const resolveResetTurnTimeBase = (options: {
    hiddenSeed: string | number;
    userId: string;
    previousTurnTimeBase: string | number;
    tickSeconds: number;
}): { nextTurnTimeBase: number; nextTurnTimeLabel: string } => {
    const rng = new LiteHashDRBG(
        simpleSerialize(options.hiddenSeed, 'ResetTurnTime', options.userId, options.previousTurnTimeBase)
    );
    const nextTurnTimeBase = rng.nextFloat1() * Math.max(60, options.tickSeconds);
    return { nextTurnTimeBase, nextTurnTimeLabel: formatTurnTimeBaseLabel(nextTurnTimeBase) };
};

export const inheritRouter = router({
    getStatus: authedProcedure.query(async ({ ctx }) => {
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

        const general = await ctx.db.general.findFirst({
            where: { userId },
            select: {
                id: true,
                name: true,
                nationId: true,
                npcState: true,
                special2Code: true,
                meta: true,
                turnTime: true,
                leadership: true,
                strength: true,
                intel: true,
            },
        });

        if (!general) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '장수가 존재하지 않습니다.' });
        }

        const rankRows = await ctx.db.rankData.findMany({
            where: {
                generalId: general.id,
                type: { in: ['warnum', 'firenum', 'betwin', 'betgold', 'betwingold'] },
            },
            select: { type: true, value: true },
        });
        const calculationMeta = {
            ...asRecord(general.meta),
            ...Object.fromEntries(rankRows.map((row) => [row.type, row.value])),
            ...Object.fromEntries(rankRows.map((row) => [`rank_${row.type}`, row.value])),
        };

        const meta = asRecord(worldState.meta);
        const isUnited =
            (typeof meta.isUnited === 'number' && meta.isUnited !== 0) ||
            (typeof meta.isunited === 'number' && meta.isunited !== 0);
        const items = await computeInheritanceItems({
            db: ctx.db,
            userId,
            generalMeta: calculationMeta,
            isUnited,
        });
        const totalPoint = sumInheritanceItems(items);

        const inheritConst = resolveInheritConstants(worldState);
        const buffState = parseBuffRecord(asRecord(general.meta).inheritBuff);
        const buffLevels = BUFF_KEYS.reduce<Record<string, number>>((acc, key) => {
            acc[key] = readBuffLevel(buffState, key);
            return acc;
        }, {});

        const resetSpecialLevel = asNumber(asRecord(general.meta).inheritResetSpecialWar, -1) + 1;
        const resetTurnLevel = asNumber(asRecord(general.meta).inheritResetTurnTime, -1) + 1;

        const config = asRecord(worldState.config);
        const canResetStat = isCentennialStatResetAllowed(config);
        const constValues = asRecord(config.const);
        const availableSpecialWar = Array.isArray(constValues.availableSpecialWar)
            ? constValues.availableSpecialWar.filter((key): key is string => typeof key === 'string')
            : [];
        const warKeys = availableSpecialWar.length > 0 ? availableSpecialWar : [...WAR_TRAIT_KEYS];
        const warTraitKeys = warKeys.filter(isWarTraitKey);
        const warModules = await loadWarTraitModules(warTraitKeys, new WarTraitLoader());
        const warSpecials = warModules.map((trait) => ({
            key: trait.key,
            name: trait.name,
            info: trait.info ?? '',
        }));

        const [others, availableUnique] = await Promise.all([
            ctx.db.general.findMany({
                where: { id: { not: general.id }, npcState: { lt: 2 }, userId: { not: null } },
                select: { id: true, name: true },
                orderBy: { id: 'asc' },
            }),
            loadAvailableUniqueItems(worldState),
        ]);

        return {
            items,
            totalPoint,
            inheritConst,
            buffLevels,
            resetCosts: {
                resetSpecialWar: buildResetCost(inheritConst.inheritResetAttrPointBase, resetSpecialLevel),
                resetTurnTime: buildResetCost(inheritConst.inheritResetAttrPointBase, resetTurnLevel),
            },
            resetLevels: {
                resetSpecialWar: resetSpecialLevel,
                resetTurnTime: resetTurnLevel,
            },
            availableSpecialWar: warSpecials,
            availableUnique,
            availableTargetGenerals: others,
            turnTimeZones: buildTurnTimeZoneList(Math.max(1, Math.round(worldState.tickSeconds / 60))),
            isUnited,
            canResetStat,
            currentSpecialWar: general.special2Code ?? 'None',
            currentStat: {
                leadership: general.leadership,
                strength: general.strength,
                intel: general.intel,
            },
        };
    }),
    getLogs: authedProcedure
        .input(
            z.object({
                lastId: z.number().int().min(1).max(POSTGRES_INTEGER_MAX).optional(),
            })
        )
        .query(async ({ ctx, input }) => {
            const userId = ctx.auth?.user.id;
            if (!userId) {
                throw new TRPCError({ code: 'UNAUTHORIZED' });
            }
            const logs = await ctx.db.inheritanceLog.findMany({
                where: {
                    userId,
                    ...(input.lastId === undefined ? {} : { id: { lt: input.lastId } }),
                },
                orderBy: { id: 'desc' },
                take: 30,
                select: { id: true, year: true, month: true, text: true, createdAt: true },
            });
            return logs;
        }),
    buyHiddenBuff: engineAuthedProcedure
        .input(
            z.object({
                type: z.enum(BUFF_KEYS),
                level: z.number().int(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const userId = ctx.auth?.user.id;
            if (!userId) {
                throw new TRPCError({ code: 'UNAUTHORIZED' });
            }
            if (input.level < MIN_INHERIT_BUFF_LEVEL || input.level > MAX_INHERIT_BUFF_LEVEL) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: '유산 강화는 1단계부터 5단계까지만 구입할 수 있습니다.',
                });
            }

            const result = await requestInheritanceAction(ctx, userId, {
                action: 'buyHiddenBuff',
                buffType: input.type,
                level: input.level,
            });
            return { ok: true, remainPoint: result.remainPoint };
        }),
    setNextSpecialWar: engineAuthedProcedure
        .input(
            z.object({
                specialKey: z.string(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const userId = ctx.auth?.user.id;
            if (!userId) {
                throw new TRPCError({ code: 'UNAUTHORIZED' });
            }

            await requestInheritanceAction(ctx, userId, { action: 'setNextSpecialWar', specialKey: input.specialKey });
            return { ok: true };
        }),
    resetSpecialWar: engineAuthedProcedure.mutation(async ({ ctx }) => {
        const userId = ctx.auth?.user.id;
        if (!userId) {
            throw new TRPCError({ code: 'UNAUTHORIZED' });
        }

        await requestInheritanceAction(ctx, userId, { action: 'resetSpecialWar' });
        return { ok: true };
    }),
    resetTurnTime: engineAuthedProcedure.mutation(async ({ ctx }) => {
        const userId = ctx.auth?.user.id;
        if (!userId) {
            throw new TRPCError({ code: 'UNAUTHORIZED' });
        }

        const result = await requestInheritanceAction(ctx, userId, { action: 'resetTurnTime' });
        return {
            ok: true,
            nextTurnTimeBase: result.nextTurnTimeBase!,
            nextTurnTimeLabel: result.nextTurnTimeLabel!,
        };
    }),
    resetStat: engineAuthedProcedure
        .input(
            z.object({
                leadership: z.number().int(),
                strength: z.number().int(),
                intel: z.number().int(),
                inheritBonusStat: z.tuple([z.number().int(), z.number().int(), z.number().int()]).optional(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const userId = ctx.auth?.user.id;
            if (!userId) {
                throw new TRPCError({ code: 'UNAUTHORIZED' });
            }
            const result = await requestInheritanceAction(ctx, userId, {
                action: 'resetStat',
                leadership: input.leadership,
                strength: input.strength,
                intel: input.intel,
                ...(input.inheritBonusStat ? { inheritBonusStat: input.inheritBonusStat } : {}),
            });
            return { ok: true, stats: result.stats! };
        }),
    buyRandomUnique: engineAuthedProcedure.mutation(async ({ ctx }) => {
        const userId = ctx.auth?.user.id;
        if (!userId) {
            throw new TRPCError({ code: 'UNAUTHORIZED' });
        }
        await requestInheritanceAction(ctx, userId, { action: 'buyRandomUnique' });
        return { ok: true };
    }),
    openUniqueAuction: engineAuthedProcedure
        .input(
            z.object({
                itemId: z.string(),
                amount: z.number().int().min(1),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const userId = ctx.auth?.user.id;
            if (!userId) {
                throw new TRPCError({ code: 'UNAUTHORIZED' });
            }
            const worldState = await resolveWorld(ctx);
            const worldMeta = asRecord(worldState.meta);
            if (typeof worldMeta.isUnited === 'number' && worldMeta.isUnited !== 0) {
                throw new TRPCError({ code: 'FORBIDDEN', message: '이미 천하가 통일되었습니다.' });
            }
            const inheritConst = resolveInheritConstants(worldState as WorldStateRow);
            if (input.amount < inheritConst.inheritItemUniqueMinPoint) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '입찰 포인트가 부족합니다.' });
            }
            const general = await ctx.db.general.findFirst({
                where: { userId },
                select: { id: true },
            });
            if (!general) {
                throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '장수가 존재하지 않습니다.' });
            }
            const result = await openAuctionWithDaemon(
                ctx,
                userId,
                general.id,
                {
                    auctionType: 'UNIQUE_ITEM',
                    itemKey: input.itemId,
                    amount: input.amount,
                },
                ctx.requestId ? `${ctx.requestId}:inherit.openUniqueAuction:engine:0:auctionOpen` : undefined
            );
            return { ok: true, ...result };
        }),
    checkOwner: engineAuthedProcedure
        .input(
            z.object({
                targetGeneralId: z.number().int().positive(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const userId = ctx.auth?.user.id;
            if (!userId) {
                throw new TRPCError({ code: 'UNAUTHORIZED' });
            }
            const result = await requestInheritanceAction(ctx, userId, {
                action: 'checkOwner',
                targetGeneralId: input.targetGeneralId,
            });
            return { ok: true, ownerName: result.ownerName!, targetName: result.targetName! };
        }),
});
