import { createHash } from 'crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asRecord, isRecord } from '@sammo-ts/common';
import { LogCategory, LogScope } from '@sammo-ts/infra';

import type { GameApiContext } from '../../context.js';
import { loadPublicMap, type BaseMapResult } from '../../maps/worldMap.js';
import {
    generalAccessEndpointWeights,
    recordGeneralAccessWeight,
} from '../../services/generalAccess.js';
import { authedProcedure, router } from '../../trpc.js';
import { getMyGeneral } from '../shared/general.js';

type YearbookNation = {
    id: number;
    name: string;
    color: string;
    level: number;
    power: number;
    cities: string[];
};

const joinYearMonth = (year: number, month: number): number => year * 12 + month - 1;
const zServerId = z.string().trim().min(1).max(64);

const computeHash = (payload: unknown): string => createHash('sha256').update(JSON.stringify(payload)).digest('hex');

const recordHistoryAccess = async (ctx: GameApiContext): Promise<void> => {
    if (ctx.generalAccessTracking !== true) {
        return;
    }
    await recordGeneralAccessWeight(ctx, generalAccessEndpointWeights['yearbook.getHistory']);
};

const parseTextArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const parseYearbookNations = (value: unknown): YearbookNation[] => {
    if (!Array.isArray(value)) {
        return [];
    }
    const output: YearbookNation[] = [];
    for (const item of value) {
        if (!isRecord(item)) {
            continue;
        }
        const id = typeof item.id === 'number' ? item.id : null;
        const name = typeof item.name === 'string' ? item.name : null;
        const color = typeof item.color === 'string' ? item.color : null;
        const level = typeof item.level === 'number' ? item.level : null;
        const power = typeof item.power === 'number' ? item.power : null;
        const cities = Array.isArray(item.cities)
            ? item.cities.filter((city): city is string => typeof city === 'string')
            : null;
        if (id === null || name === null || color === null || level === null || power === null || !cities) {
            continue;
        }
        output.push({ id, name, color, level, power, cities });
    }
    return output;
};

const buildNationSnapshot = async (ctx: GameApiContext) => {
    const [nationRows, cityRows, generalRows] = await Promise.all([
        ctx.db.nation.findMany({
            select: {
                id: true,
                name: true,
                color: true,
                level: true,
                gold: true,
                rice: true,
                tech: true,
            },
            orderBy: { id: 'asc' },
        }),
        ctx.db.city.findMany({
            select: {
                id: true,
                name: true,
                nationId: true,
                population: true,
                agriculture: true,
                commerce: true,
                security: true,
                defence: true,
                wall: true,
                populationMax: true,
                agricultureMax: true,
                commerceMax: true,
                securityMax: true,
                defenceMax: true,
                wallMax: true,
            },
        }),
        ctx.db.general.findMany({
            select: {
                nationId: true,
                npcState: true,
                leadership: true,
                strength: true,
                intel: true,
                experience: true,
                dedication: true,
                gold: true,
                rice: true,
            },
        }),
    ]);

    const cityStatsByNation = new Map<number, { popSum: number; valueSum: number; maxSum: number }>();
    const cityNamesByNation = new Map<number, string[]>();

    for (const city of cityRows) {
        const entry = cityStatsByNation.get(city.nationId) ?? { popSum: 0, valueSum: 0, maxSum: 0 };
        const valueSum = city.population + city.agriculture + city.commerce + city.security + city.wall + city.defence;
        const maxSum =
            city.populationMax +
            city.agricultureMax +
            city.commerceMax +
            city.securityMax +
            city.wallMax +
            city.defenceMax;
        entry.popSum += city.population;
        entry.valueSum += valueSum;
        entry.maxSum += maxSum;
        cityStatsByNation.set(city.nationId, entry);

        const cityNames = cityNamesByNation.get(city.nationId) ?? [];
        cityNames.push(city.name);
        cityNamesByNation.set(city.nationId, cityNames);
    }

    const generalStatsByNation = new Map<number, { goldRice: number; statPower: number; expDed: number }>();
    for (const general of generalRows) {
        const entry = generalStatsByNation.get(general.nationId) ?? { goldRice: 0, statPower: 0, expDed: 0 };
        entry.goldRice += general.gold + general.rice;
        const leadership = general.leadership;
        const strength = general.strength;
        const intel = general.intel;
        const npcMultiplier = general.npcState < 2 ? 1.2 : 1;
        const leaderCore = leadership >= 40 ? leadership : 0;
        entry.statPower += npcMultiplier * leaderCore * 2 + (Math.sqrt(intel * strength) * 2 + leadership / 2) / 2;
        entry.expDed += general.experience + general.dedication;
        generalStatsByNation.set(general.nationId, entry);
    }

    return nationRows.map<YearbookNation>((nation) => {
        const generalStats = generalStatsByNation.get(nation.id) ?? { goldRice: 0, statPower: 0, expDed: 0 };
        const cityStats = cityStatsByNation.get(nation.id) ?? { popSum: 0, valueSum: 0, maxSum: 0 };
        const resource = Math.round(((nation.gold ?? 0) + (nation.rice ?? 0) + generalStats.goldRice) / 100);
        const tech = nation.tech ?? 0;
        const cityPower =
            nation.level > 0 && cityStats.maxSum > 0
                ? Math.round((cityStats.popSum * cityStats.valueSum) / cityStats.maxSum / 100)
                : 0;
        const expDed = Math.round(generalStats.expDed / 100);
        const power = Math.round((resource + tech + cityPower + generalStats.statPower + expDed) / 10);

        return {
            id: nation.id,
            name: nation.name,
            color: nation.color,
            level: nation.level,
            power,
            cities: cityNamesByNation.get(nation.id) ?? [],
        };
    });
};

const buildLogs = async (ctx: GameApiContext, year: number, month: number) => {
    const [historyLogs, actionLogs] = await Promise.all([
        ctx.db.logEntry.findMany({
            where: {
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                year,
                month,
            },
            orderBy: { id: 'desc' },
        }),
        ctx.db.logEntry.findMany({
            where: {
                scope: LogScope.SYSTEM,
                category: LogCategory.ACTION,
                year,
                month,
            },
            orderBy: { id: 'desc' },
        }),
    ]);

    const globalHistory = historyLogs.map((entry) => entry.text);
    const globalAction = actionLogs.map((entry) => entry.text);

    return {
        globalHistory: globalHistory.length ? globalHistory : [`<C>●</>${month}월: 기록 없음`],
        globalAction: globalAction.length ? globalAction : [`<C>●</>${month}월: 기록 없음`],
    };
};

export const yearbookRouter = router({
    getRange: authedProcedure
        .input(
            z
                .object({
                    serverID: zServerId.optional(),
                })
                .optional()
        )
        .query(async ({ ctx, input }) => {
            await getMyGeneral(ctx);
            const worldState = await ctx.db.worldState.findFirst();
            if (!worldState) {
                throw new TRPCError({
                    code: 'PRECONDITION_FAILED',
                    message: 'World state is not initialized.',
                });
            }
            const targetProfileName = input?.serverID ?? ctx.profile.name;
            const isCurrentProfile = targetProfileName === ctx.profile.name;

            const firstRow = await ctx.db.yearbookHistory.findFirst({
                where: { profileName: targetProfileName },
                select: { year: true, month: true },
                orderBy: [{ year: 'asc' }, { month: 'asc' }],
            });

            const lastRow = await ctx.db.yearbookHistory.findFirst({
                where: { profileName: targetProfileName },
                select: { year: true, month: true },
                orderBy: [{ year: 'desc' }, { month: 'desc' }],
            });

            if (!isCurrentProfile && (!firstRow || !lastRow)) {
                throw new TRPCError({ code: 'NOT_FOUND', message: '연감 범위를 찾을 수 없습니다.' });
            }

            const currentYearMonth = joinYearMonth(worldState.currentYear, worldState.currentMonth);
            const fallbackYearMonth = currentYearMonth - 1;
            const firstYearMonth = firstRow ? joinYearMonth(firstRow.year, firstRow.month) : fallbackYearMonth;
            const lastYearMonth = lastRow ? joinYearMonth(lastRow.year, lastRow.month) : fallbackYearMonth;
            const selectedYearMonth = isCurrentProfile ? currentYearMonth : lastYearMonth;

            return {
                firstYearMonth,
                lastYearMonth,
                currentYearMonth: selectedYearMonth,
            };
        }),
    getHistory: authedProcedure
        .input(
            z.object({
                year: z.number().int(),
                month: z.number().int().min(1).max(12),
                hash: z.string().optional(),
                serverID: zServerId.optional(),
            })
        )
        .query(async ({ ctx, input }) => {
            await getMyGeneral(ctx);
            const worldState = await ctx.db.worldState.findFirst();
            if (!worldState) {
                throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'World state is not initialized.' });
            }
            const targetProfileName = input.serverID ?? ctx.profile.name;
            const isCurrentProfile = targetProfileName === ctx.profile.name;
            const shouldRecordAfterHashCheck = isCurrentProfile && Boolean(input.hash);
            if (isCurrentProfile && !shouldRecordAfterHashCheck) {
                await recordHistoryAccess(ctx);
            }

            const isCurrent =
                isCurrentProfile && worldState.currentYear === input.year && worldState.currentMonth === input.month;

            if (isCurrent) {
                const { globalHistory, globalAction } = await buildLogs(ctx, input.year, input.month);
                const map = await loadPublicMap(ctx, false);
                if (!map) {
                    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'World map is not available.' });
                }
                const nations = await buildNationSnapshot(ctx);
                const data = {
                    year: input.year,
                    month: input.month,
                    map,
                    nations,
                    globalHistory,
                    globalAction,
                };
                const hash = computeHash(data);
                if (input.hash && input.hash === hash) {
                    return { notModified: true, hash };
                }
                if (shouldRecordAfterHashCheck) {
                    await recordHistoryAccess(ctx);
                }
                return { notModified: false, hash, data };
            }

            const row = await ctx.db.yearbookHistory.findFirst({
                where: {
                    profileName: targetProfileName,
                    year: input.year,
                    month: input.month,
                },
                orderBy: [{ sourceId: 'desc' }, { id: 'desc' }],
            });
            if (!row) {
                throw new TRPCError({ code: 'NOT_FOUND', message: '연감 데이터를 찾을 수 없습니다.' });
            }

            const map = asRecord(row.map) as BaseMapResult;
            const nations = parseYearbookNations(row.nations);
            const archivedLogs =
                isCurrentProfile && row.sourceId === 0
                    ? await buildLogs(ctx, input.year, input.month)
                    : {
                          globalHistory: parseTextArray(row.globalHistory),
                          globalAction: parseTextArray(row.globalAction),
                      };
            const { globalHistory, globalAction } = archivedLogs;
            const data = {
                year: input.year,
                month: input.month,
                map,
                nations,
                globalHistory,
                globalAction,
            };
            const hash = computeHash({ map, nations, globalHistory, globalAction });
            if (input.hash && input.hash === hash) {
                return { notModified: true, hash };
            }
            if (shouldRecordAfterHashCheck) {
                await recordHistoryAccess(ctx);
            }
            return { notModified: false, hash, data };
        }),
});
