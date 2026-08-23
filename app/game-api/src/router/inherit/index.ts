import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, engineAuthedProcedure, router } from '../../trpc.js';
import { asNumber, asRecord, parseJson, LiteHashDRBG } from '@sammo-ts/common';
import {
    ItemLoader,
    isItemKey,
    loadWarTraitModules,
    sendMessage,
    WarTraitLoader,
    WAR_TRAIT_KEYS,
    isWarTraitKey,
    isCentennialStatResetAllowed,
} from '@sammo-ts/logic';
import type { InheritBuffType, ItemSlot, MessageDraft, MessageRecordDraft } from '@sammo-ts/logic';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';
import { resolveLegacyCompatibleUniqueConfig } from '@sammo-ts/logic/rewards/legacyUniqueItemPool.js';
import {
    appendInheritanceLog,
    buildResetCost,
    computeInheritanceItems,
    readInheritancePoint,
    readUserStateMeta,
    resolveInheritConstants,
    setInheritancePoint,
    sumInheritanceItems,
    writeUserStateMeta,
} from '../../services/inheritance.js';
import type { GameApiContext, WorldStateRow } from '../../context.js';
import { openAuctionWithDaemon } from '../../auction/open.js';
import { buildTargetFromGeneral } from '../../messages/targets.js';
import { insertMessage } from '../../messages/store.js';
import { loadCurrentGameTime } from '../../services/gameClock.js';

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

const BUFF_LABELS: Record<InheritBuffType, string> = {
    warAvoidRatio: '회피 확률 증가',
    warCriticalRatio: '필살 확률 증가',
    warMagicTrialProb: '전투계략 시도 확률 증가',
    domesticSuccessProb: '내정 성공률 증가',
    domesticFailProb: '내정 실패율 감소',
    warAvoidRatioOppose: '상대 회피 확률 감소',
    warCriticalRatioOppose: '상대 필살 확률 감소',
    warMagicTrialProbOppose: '상대 전투계략 시도 확률 감소',
};

const POSTGRES_INTEGER_MAX = 2_147_483_647;

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

const serializeBuffRecord = (buff: Record<string, number>): string => JSON.stringify(buff);

const readStringList = (raw: unknown): string[] => {
    const parsed = typeof raw === 'string' ? parseJson<unknown>(raw) : raw;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
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

const patchGeneral = async (
    ctx: Pick<GameApiContext, 'turnDaemon'>,
    generalId: number,
    patch: {
        meta?: Record<string, unknown>;
        turnTime?: string;
        stats?: {
            leadership?: number;
            strength?: number;
            intelligence?: number;
        };
        specialWar?: string | null;
    }
): Promise<void> => {
    const result = await ctx.turnDaemon.requestCommand({
        type: 'patchGeneral',
        generalId,
        patch,
    });
    if (!result || result.type !== 'patchGeneral') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
    }
    if (!result.ok) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
    }
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

const resolveSeasonValue = (meta: Record<string, unknown>): number | null => {
    const raw = meta.season;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Math.floor(raw);
    }
    if (typeof raw === 'string') {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
            return Math.floor(parsed);
        }
    }
    return null;
};

const readResetSeasons = (meta: Record<string, unknown>): number[] => {
    if (!Array.isArray(meta.last_stat_reset)) {
        return [];
    }
    return meta.last_stat_reset
        .map((value) => (typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null))
        .filter((value): value is number => value !== null);
};

const pickWeightedIndex = (rng: LiteHashDRBG, weights: number[]): number => {
    const total = weights.reduce((acc, value) => acc + value, 0);
    if (total <= 0) {
        return 0;
    }
    let cursor = rng.nextFloat1() * total;
    for (let i = 0; i < weights.length; i += 1) {
        cursor -= weights[i] ?? 0;
        if (cursor <= 0) {
            return i;
        }
    }
    return weights.length - 1;
};

const buildRandomBonus = (rng: LiteHashDRBG, baseStats: [number, number, number]): [number, number, number] => {
    const bonusCount = rng.nextInt(2) + 3;
    const bonus = [0, 0, 0] as [number, number, number];
    for (let i = 0; i < bonusCount; i += 1) {
        const index = pickWeightedIndex(rng, baseStats);
        bonus[index] += 1;
    }
    return bonus;
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
    buyHiddenBuff: authedProcedure
        .input(
            z.object({
                type: z.enum(BUFF_KEYS),
                level: z.number().int().min(1).max(5),
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
            const general = await ctx.db.general.findFirst({
                where: { userId },
                select: { id: true, meta: true },
            });
            if (!general) {
                throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '장수가 존재하지 않습니다.' });
            }

            const buff = parseBuffRecord(asRecord(general.meta).inheritBuff);
            const prevLevel = readBuffLevel(buff, input.type);
            if (input.level === prevLevel) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '이미 구입했습니다.' });
            }
            if (input.level < prevLevel) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '이미 더 높은 등급을 구입했습니다.' });
            }
            const cost = inheritConst.inheritBuffPoints[input.level] - inheritConst.inheritBuffPoints[prevLevel];
            const currentPoint = await readInheritancePoint(ctx.db, userId, 'previous');
            if (currentPoint < cost) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '유산 포인트가 부족합니다.' });
            }

            const buffText = BUFF_LABELS[input.type];
            const moreText = prevLevel > 0 ? '추가' : '';
            buff[input.type] = input.level;
            await patchGeneral(ctx, general.id, {
                meta: {
                    ...asRecord(general.meta),
                    inheritBuff: serializeBuffRecord(buff),
                },
            });

            await setInheritancePoint(ctx.db, userId, 'previous', currentPoint - cost);
            await appendInheritanceLog(
                ctx.db,
                userId,
                worldState.currentYear,
                worldState.currentMonth,
                `${cost} 포인트로 ${buffText} ${input.level} 단계 ${moreText}구입`
            );
            return { ok: true, remainPoint: currentPoint - cost };
        }),
    setNextSpecialWar: authedProcedure
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

            const worldState = await resolveWorld(ctx);
            const worldMeta = asRecord(worldState.meta);
            if (typeof worldMeta.isUnited === 'number' && worldMeta.isUnited !== 0) {
                throw new TRPCError({ code: 'FORBIDDEN', message: '이미 천하가 통일되었습니다.' });
            }

            if (!isWarTraitKey(input.specialKey)) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '잘못된 전투 특기입니다.' });
            }
            const config = asRecord(worldState.config);
            const constValues = asRecord(config.const);
            const allowedSpecialWar = Array.isArray(constValues.availableSpecialWar)
                ? constValues.availableSpecialWar.filter((key): key is string => typeof key === 'string')
                : [];
            if (allowedSpecialWar.length > 0 && !allowedSpecialWar.includes(input.specialKey)) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '허용되지 않은 전투 특기입니다.' });
            }

            const inheritConst = resolveInheritConstants(worldState as WorldStateRow);
            const currentPoint = await readInheritancePoint(ctx.db, userId, 'previous');
            if (currentPoint < inheritConst.inheritSpecificSpecialPoint) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '유산 포인트가 부족합니다.' });
            }

            const general = await ctx.db.general.findFirst({
                where: { userId },
                select: { id: true, meta: true, special2Code: true },
            });
            if (!general) {
                throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '장수가 존재하지 않습니다.' });
            }
            if (general.special2Code === input.specialKey) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '이미 그 특기를 보유하고 있습니다.' });
            }
            const meta = asRecord(general.meta);
            const reservedSpecial =
                typeof meta.inheritSpecificSpecialWar === 'string' ? meta.inheritSpecificSpecialWar : null;
            if (reservedSpecial === input.specialKey) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '이미 그 특기를 예약하였습니다.' });
            }
            if (reservedSpecial) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '이미 예약한 특기가 있습니다.' });
            }

            const [warModule] = await loadWarTraitModules([input.specialKey], new WarTraitLoader());
            const warName = warModule?.name ?? input.specialKey;

            await patchGeneral(ctx, general.id, {
                meta: {
                    ...meta,
                    inheritSpecificSpecialWar: input.specialKey,
                },
            });

            await setInheritancePoint(
                ctx.db,
                userId,
                'previous',
                currentPoint - inheritConst.inheritSpecificSpecialPoint
            );
            await appendInheritanceLog(
                ctx.db,
                userId,
                worldState.currentYear,
                worldState.currentMonth,
                `${inheritConst.inheritSpecificSpecialPoint} 포인트로 다음 전투 특기로 ${warName} 지정`
            );
            return { ok: true };
        }),
    resetSpecialWar: authedProcedure.mutation(async ({ ctx }) => {
        const userId = ctx.auth?.user.id;
        if (!userId) {
            throw new TRPCError({ code: 'UNAUTHORIZED' });
        }

        const worldState = await resolveWorld(ctx);
        const worldMeta = asRecord(worldState.meta);
        if (asNumber(worldMeta.isunited ?? worldMeta.isUnited, 0) !== 0) {
            throw new TRPCError({ code: 'FORBIDDEN', message: '이미 천하가 통일되었습니다.' });
        }

        const general = await ctx.db.general.findFirst({
            where: { userId },
            select: { id: true, special2Code: true, meta: true },
        });
        if (!general) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '장수가 존재하지 않습니다.' });
        }
        if (!general.special2Code || general.special2Code === 'None') {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '이미 전투 특기가 공란입니다.' });
        }

        const inheritConst = resolveInheritConstants(worldState as WorldStateRow);
        const currentLevel = asNumber(asRecord(general.meta).inheritResetSpecialWar, -1);
        const nextLevel = currentLevel + 1;
        const cost = buildResetCost(inheritConst.inheritResetAttrPointBase, nextLevel);
        const currentPoint = await readInheritancePoint(ctx.db, userId, 'previous');
        if (currentPoint < cost) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '유산 포인트가 부족합니다.' });
        }

        const meta = asRecord(general.meta);
        const prevList = readStringList(meta.prev_types_special2);
        prevList.push(general.special2Code);

        await patchGeneral(ctx, general.id, {
            specialWar: null,
            meta: {
                ...meta,
                inheritResetSpecialWar: nextLevel,
                prev_types_special2: prevList,
            },
        });

        await setInheritancePoint(ctx.db, userId, 'previous', currentPoint - cost);
        await appendInheritanceLog(
            ctx.db,
            userId,
            worldState.currentYear,
            worldState.currentMonth,
            `${cost} 포인트로 전투 특기 초기화`
        );
        return { ok: true };
    }),
    resetTurnTime: authedProcedure.mutation(async ({ ctx }) => {
        const userId = ctx.auth?.user.id;
        if (!userId) {
            throw new TRPCError({ code: 'UNAUTHORIZED' });
        }

        const worldState = await resolveWorld(ctx);
        const worldMeta = asRecord(worldState.meta);
        if (typeof worldMeta.isUnited === 'number' && worldMeta.isUnited !== 0) {
            throw new TRPCError({ code: 'FORBIDDEN', message: '이미 천하가 통일되었습니다.' });
        }

        const general = await ctx.db.general.findFirst({
            where: { userId },
            select: { id: true, meta: true, turnTick: true },
        });
        if (!general) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '장수가 존재하지 않습니다.' });
        }

        const inheritConst = resolveInheritConstants(worldState as WorldStateRow);
        const currentLevel = asNumber(asRecord(general.meta).inheritResetTurnTime, -1);
        const nextLevel = currentLevel + 1;
        const cost = buildResetCost(inheritConst.inheritResetAttrPointBase, nextLevel);
        const currentPoint = await readInheritancePoint(ctx.db, userId, 'previous');
        if (currentPoint < cost) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '유산 포인트가 부족합니다.' });
        }

        const generalMeta = asRecord(general.meta);
        const rawSeedTurnTime = generalMeta.nextTurnTimeBase ?? general.turnTick ?? 0;
        const seedTurnTime =
            typeof rawSeedTurnTime === 'string' || typeof rawSeedTurnTime === 'number'
                ? rawSeedTurnTime
                : typeof rawSeedTurnTime === 'bigint'
                  ? Number(rawSeedTurnTime)
                  : 0;
        const hiddenSeed =
            typeof worldMeta.hiddenSeed === 'string' || typeof worldMeta.hiddenSeed === 'number'
                ? worldMeta.hiddenSeed
                : 'inherit';
        const { nextTurnTimeBase, nextTurnTimeLabel } = resolveResetTurnTimeBase({
            hiddenSeed,
            userId,
            previousTurnTimeBase: seedTurnTime,
            tickSeconds: worldState.tickSeconds,
        });

        await patchGeneral(ctx, general.id, {
            meta: {
                ...generalMeta,
                inheritResetTurnTime: nextLevel,
                nextTurnTimeBase,
            },
        });

        await setInheritancePoint(ctx.db, userId, 'previous', currentPoint - cost);
        await appendInheritanceLog(
            ctx.db,
            userId,
            worldState.currentYear,
            worldState.currentMonth,
            `${cost} 포인트로 턴 시간을 바꾸어 다다음 턴부터 ${nextTurnTimeLabel} 적용`
        );
        return { ok: true, nextTurnTimeBase, nextTurnTimeLabel };
    }),
    resetStat: authedProcedure
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
            const worldState = await resolveWorld(ctx);
            const worldMeta = asRecord(worldState.meta);
            if (typeof worldMeta.isUnited === 'number' && worldMeta.isUnited !== 0) {
                throw new TRPCError({ code: 'FORBIDDEN', message: '이미 천하가 통일되었습니다.' });
            }
            const config = asRecord(worldState.config);
            const statConfig = asRecord(config.stat);
            const statTotal = asNumber(statConfig.total, input.leadership + input.strength + input.intel);
            const statMin = asNumber(statConfig.min, 1);
            const statMax = asNumber(statConfig.max, 999);

            const total = input.leadership + input.strength + input.intel;
            if (total !== statTotal) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: `능력치 총합이 ${statTotal}이 아닙니다. 다시 입력해주세요!`,
                });
            }
            if (
                input.leadership < statMin ||
                input.strength < statMin ||
                input.intel < statMin ||
                input.leadership > statMax ||
                input.strength > statMax ||
                input.intel > statMax
            ) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '능력치 범위를 벗어났습니다.' });
            }

            const inheritConst = resolveInheritConstants(worldState as WorldStateRow);
            const bonus = input.inheritBonusStat ?? [0, 0, 0];
            const bonusSum = bonus.reduce((acc, value) => acc + value, 0);
            if (bonus.some((value) => value < 0)) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: '보너스 능력치가 음수입니다. 다시 입력해주세요!',
                });
            }
            if (bonusSum !== 0 && (bonusSum < 3 || bonusSum > 5)) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: '보너스 능력치 합이 잘못 지정되었습니다. 다시 입력해주세요!',
                });
            }

            const general = await ctx.db.general.findFirst({
                where: { userId },
                select: { id: true, npcState: true },
            });
            if (!general) {
                throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '장수가 존재하지 않습니다.' });
            }
            if (general.npcState >= 2) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: 'NPC는 능력치 초기화를 할 수 없습니다.' });
            }
            if (!isCentennialStatResetAllowed(config)) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: '100기 올스타 장수는 능력치 초기화를 사용할 수 없습니다.',
                });
            }

            const currentPoint = await readInheritancePoint(ctx.db, userId, 'previous');
            const cost = bonusSum > 0 ? inheritConst.inheritBornStatPoint : 0;
            if (currentPoint < cost) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '유산 포인트가 부족합니다.' });
            }

            const seasonValue = resolveSeasonValue(worldMeta);
            if (seasonValue !== null) {
                const userState = await readUserStateMeta(ctx.db, userId);
                const resetSeasons = readResetSeasons(userState);
                if (resetSeasons.includes(seasonValue)) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: '이번 시즌에 이미 능력치를 초기화하셨습니다.',
                    });
                }
            }

            const finalBonus =
                bonusSum === 0
                    ? buildRandomBonus(
                          new LiteHashDRBG(`${asRecord(worldState.meta).hiddenSeed ?? 'inherit'}:ResetStat:${userId}`),
                          [input.leadership, input.strength, input.intel]
                      )
                    : (bonus as [number, number, number]);
            const nextStats = {
                leadership: input.leadership + finalBonus[0],
                strength: input.strength + finalBonus[1],
                intel: input.intel + finalBonus[2],
            };

            await patchGeneral(ctx, general.id, {
                stats: {
                    leadership: nextStats.leadership,
                    strength: nextStats.strength,
                    intelligence: nextStats.intel,
                },
            });

            await appendInheritanceLog(
                ctx.db,
                userId,
                worldState.currentYear,
                worldState.currentMonth,
                `통솔 ${input.leadership}, 무력 ${input.strength}, 지력 ${input.intel} 스탯 재설정`
            );
            if (bonusSum > 0) {
                await appendInheritanceLog(
                    ctx.db,
                    userId,
                    worldState.currentYear,
                    worldState.currentMonth,
                    `${cost}로 통솔 ${finalBonus[0]}, 무력 ${finalBonus[1]}, 지력 ${finalBonus[2]} 보너스 능력치 적용`
                );
            } else {
                await appendInheritanceLog(
                    ctx.db,
                    userId,
                    worldState.currentYear,
                    worldState.currentMonth,
                    `통솔 ${finalBonus[0]}, 무력 ${finalBonus[1]}, 지력 ${finalBonus[2]} 보너스 능력치 적용`
                );
            }
            if (cost > 0) {
                await setInheritancePoint(ctx.db, userId, 'previous', currentPoint - cost);
            }
            if (seasonValue !== null) {
                const userState = await readUserStateMeta(ctx.db, userId);
                const resetSeasons = readResetSeasons(userState);
                const nextSeasons = resetSeasons.includes(seasonValue) ? resetSeasons : [...resetSeasons, seasonValue];
                await writeUserStateMeta(ctx.db, userId, {
                    ...userState,
                    last_stat_reset: nextSeasons,
                });
            }
            return { ok: true, stats: nextStats };
        }),
    buyRandomUnique: authedProcedure.mutation(async ({ ctx }) => {
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
        const currentPoint = await readInheritancePoint(ctx.db, userId, 'previous');
        if (currentPoint < inheritConst.inheritItemRandomPoint) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '유산 포인트가 부족합니다.' });
        }

        const general = await ctx.db.general.findFirst({
            where: { userId },
            select: { id: true, meta: true },
        });
        if (!general) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '장수가 존재하지 않습니다.' });
        }
        const meta = asRecord(general.meta);
        if (meta.inheritRandomUnique !== undefined && meta.inheritRandomUnique !== null) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: '이미 구입 명령을 내렸습니다. 다음 턴까지 기다려주세요.',
            });
        }

        await patchGeneral(ctx, general.id, {
            meta: {
                ...meta,
                inheritRandomUnique: 1,
            },
        });

        await setInheritancePoint(ctx.db, userId, 'previous', currentPoint - inheritConst.inheritItemRandomPoint);
        await appendInheritanceLog(
            ctx.db,
            userId,
            worldState.currentYear,
            worldState.currentMonth,
            `${inheritConst.inheritItemRandomPoint} 포인트로 랜덤 유니크 구입`
        );
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
    checkOwner: authedProcedure
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
            const worldState = await resolveWorld(ctx);
            const worldMeta = asRecord(worldState.meta);
            if (typeof worldMeta.isUnited === 'number' && worldMeta.isUnited !== 0) {
                throw new TRPCError({ code: 'FORBIDDEN', message: '이미 천하가 통일되었습니다.' });
            }
            const inheritConst = resolveInheritConstants(worldState as WorldStateRow);
            const currentPoint = await readInheritancePoint(ctx.db, userId, 'previous');
            if (currentPoint < inheritConst.inheritCheckOwnerPoint) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '유산 포인트가 부족합니다.' });
            }

            const [general, target] = await Promise.all([
                ctx.db.general.findFirst({ where: { userId } }),
                ctx.db.general.findUnique({ where: { id: input.targetGeneralId } }),
            ]);
            if (!general) {
                throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '장수가 존재하지 않습니다.' });
            }
            if (!target || !target.userId) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '대상 장수가 존재하지 않습니다.' });
            }
            if (target.id === general.id) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '자신의 정보는 확인할 수 없습니다.' });
            }

            const rawOwnerName = asRecord(target.meta).ownerName;
            const ownerName =
                typeof rawOwnerName === 'string' && rawOwnerName.trim().length > 0 ? rawOwnerName : '알수없음';

            await setInheritancePoint(ctx.db, userId, 'previous', currentPoint - inheritConst.inheritCheckOwnerPoint);
            await appendInheritanceLog(
                ctx.db,
                userId,
                worldState.currentYear,
                worldState.currentMonth,
                `${inheritConst.inheritCheckOwnerPoint} 포인트로 장수 소유자 확인`
            );

            const [generalTarget, checkedTarget, gameTime] = await Promise.all([
                buildTargetFromGeneral(ctx.db, general),
                buildTargetFromGeneral(ctx.db, target),
                loadCurrentGameTime(ctx.db),
            ]);
            const systemTarget: MessageDraft['src'] = {
                generalId: 0,
                generalName: '',
                nationId: 0,
                nationName: 'System',
                color: '#000000',
                icon: '',
            };
            const validUntil = new Date('9999-12-31T00:00:00.000Z');
            const sendSystemPrivateMessage = async (dest: MessageDraft['dest'], text: string): Promise<void> => {
                await sendMessage(
                    {
                        insertMessage: (draft: MessageRecordDraft) => insertMessage(ctx.db, draft),
                    },
                    {
                        msgType: 'private',
                        src: systemTarget,
                        dest,
                        text,
                        time: gameTime.now,
                        validUntil,
                        option: {},
                    },
                    { sendDestOnly: true }
                );
                ctx.changeJournal?.mark('messages.mailbox', dest.generalId);
            };

            await sendSystemPrivateMessage(generalTarget, `${target.name}의 소유자는 ${ownerName} 입니다.`);
            await sendSystemPrivateMessage(checkedTarget, '소유자명이 누군가에 의해 확인되었습니다.');
            return { ok: true, ownerName, targetName: target.name };
        }),
});
