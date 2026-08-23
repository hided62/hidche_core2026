import { createHash } from 'crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asRecord, isRecord } from '@sammo-ts/common';
import { LogCategory, LogScope } from '@sammo-ts/logic';

import type { GameApiContext } from '../../context.js';
import { loadPublicMap, type BaseMapResult } from '../../maps/worldMap.js';
import {
    formatGeneralAccessLimitMessage,
    generalAccessEndpointWeights,
    getGeneralAccessState,
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
    generalCount: number;
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
    const state = ctx.generalAccessTracking === true ? await getGeneralAccessState(ctx) : null;
    if (state?.level === 2) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: formatGeneralAccessLimitMessage(state) });
    }
};

const parseTextArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const readStoredSnapshotNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

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
        const generalCount =
            typeof item.generalCount === 'number'
                ? item.generalCount
                : typeof item.gennum === 'number'
                  ? item.gennum
                  : 0;
        const cities = Array.isArray(item.cities)
            ? item.cities.filter((city): city is string => typeof city === 'string')
            : null;
        if (id === null || name === null || color === null || level === null || power === null || !cities) {
            continue;
        }
        output.push({ id, name, color, level, power, generalCount, cities });
    }
    return output;
};

const resolveArchiveTarget = (
    worldMeta: unknown,
    profileId: string,
    profileName: string,
    requestedServerId?: string
): { archiveKey: string; legacyAlias: string | null; isCurrentProfile: boolean } => {
    const rawServerId = asRecord(worldMeta).serverId;
    const canonicalServerId = typeof rawServerId === 'string' && rawServerId.trim() ? rawServerId.trim() : profileName;
    const requested = requestedServerId ?? profileName;
    const isCurrentProfile = requested === profileName || requested === canonicalServerId;
    return {
        archiveKey: isCurrentProfile ? canonicalServerId : requested,
        legacyAlias:
            isCurrentProfile && canonicalServerId !== profileName
                ? profileName
                : isCurrentProfile && profileId !== canonicalServerId
                  ? profileId
                  : null,
        isCurrentProfile,
    };
};

const normalizeArchivedLogs = (value: unknown, month: number): string[] => {
    const logs = parseTextArray(value);
    return logs.length ? logs : [`<C>●</>${month}월: 기록 없음`];
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
                meta: true,
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

    const generalStatsByNation = new Map<
        number,
        { goldRice: number; statPower: number; expDed: number; generalCount: number }
    >();
    for (const general of generalRows) {
        const entry = generalStatsByNation.get(general.nationId) ?? {
            goldRice: 0,
            statPower: 0,
            expDed: 0,
            generalCount: 0,
        };
        entry.generalCount += 1;
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

    const projected = nationRows.map<YearbookNation>((nation) => {
        const generalStats = generalStatsByNation.get(nation.id) ?? {
            goldRice: 0,
            statPower: 0,
            expDed: 0,
            generalCount: 0,
        };
        const nationMeta = asRecord(nation.meta);
        const storedPower = readStoredSnapshotNumber(nationMeta.power);
        let power = 1;
        if (nation.id !== 0) {
            if (storedPower !== null) {
                power = storedPower;
            } else {
                const cityStats = cityStatsByNation.get(nation.id) ?? { popSum: 0, valueSum: 0, maxSum: 0 };
                const resource = Math.round(((nation.gold ?? 0) + (nation.rice ?? 0) + generalStats.goldRice) / 100);
                const tech = nation.tech ?? 0;
                const cityPower =
                    nation.level > 0 && cityStats.maxSum > 0
                        ? Math.round((cityStats.popSum * cityStats.valueSum) / cityStats.maxSum / 100)
                        : 0;
                const expDed = Math.round(generalStats.expDed / 100);
                power = Math.round((resource + tech + cityPower + generalStats.statPower + expDed) / 10);
            }
        }
        const storedGeneralCount = readStoredSnapshotNumber(nationMeta.gennum);
        const generalCount = nation.id === 0 ? 1 : (storedGeneralCount ?? generalStats.generalCount);

        return {
            id: nation.id,
            name: nation.id === 0 ? '재야' : nation.name,
            color: nation.id === 0 ? '#000000' : nation.color,
            level: nation.id === 0 ? 0 : nation.level,
            power,
            generalCount,
            cities: cityNamesByNation.get(nation.id) ?? [],
        };
    });
    return projected.sort((left, right) => right.power - left.power);
};

const readGlobalActionLogs = async (ctx: GameApiContext, year: number, month: number) => {
    const actionLogs = await ctx.db.logEntry.findMany({
        where: {
            scope: LogScope.SYSTEM,
            category: { in: [LogCategory.SUMMARY, LogCategory.ACTION] },
            year,
            month,
        },
        orderBy: { id: 'desc' },
    });

    return actionLogs.map((entry) => entry.text);
};

const readLogs = async (ctx: GameApiContext, year: number, month: number) => {
    const [historyLogs, globalAction] = await Promise.all([
        ctx.db.logEntry.findMany({
            where: {
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                year,
                month,
            },
            orderBy: { id: 'desc' },
        }),
        readGlobalActionLogs(ctx, year, month),
    ]);

    const globalHistory = historyLogs.map((entry) => entry.text);

    return { globalHistory, globalAction };
};

const buildLogs = async (ctx: GameApiContext, year: number, month: number) => {
    const { globalHistory, globalAction } = await readLogs(ctx, year, month);
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
            const target = resolveArchiveTarget(worldState.meta, ctx.profile.id, ctx.profile.name, input?.serverID);

            const findRange = async (profileName: string) =>
                Promise.all([
                    ctx.db.yearbookHistory.findFirst({
                        where: { profileName },
                        select: { year: true, month: true },
                        orderBy: [{ year: 'asc' as const }, { month: 'asc' as const }],
                    }),
                    ctx.db.yearbookHistory.findFirst({
                        where: { profileName },
                        select: { year: true, month: true },
                        orderBy: [{ year: 'desc' as const }, { month: 'desc' as const }],
                    }),
                ]);
            const ranges = await Promise.all(
                [target.archiveKey, target.legacyAlias]
                    .filter((value): value is string => Boolean(value))
                    .map(findRange)
            );
            const firstRow = ranges
                .map(([first]) => first)
                .filter((row): row is NonNullable<typeof row> => Boolean(row))
                .sort((a, b) => joinYearMonth(a.year, a.month) - joinYearMonth(b.year, b.month))[0];
            const lastRow = ranges
                .map(([, last]) => last)
                .filter((row): row is NonNullable<typeof row> => Boolean(row))
                .sort((a, b) => joinYearMonth(b.year, b.month) - joinYearMonth(a.year, a.month))[0];

            if (!target.isCurrentProfile && (!firstRow || !lastRow)) {
                throw new TRPCError({ code: 'NOT_FOUND', message: '연감 범위를 찾을 수 없습니다.' });
            }

            const currentYearMonth = joinYearMonth(worldState.currentYear, worldState.currentMonth);
            const fallbackYearMonth = currentYearMonth - 1;
            const firstYearMonth = firstRow ? joinYearMonth(firstRow.year, firstRow.month) : fallbackYearMonth;
            const lastYearMonth = lastRow ? joinYearMonth(lastRow.year, lastRow.month) : fallbackYearMonth;
            const selectedYearMonth = target.isCurrentProfile ? currentYearMonth : lastYearMonth;

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
            const target = resolveArchiveTarget(worldState.meta, ctx.profile.id, ctx.profile.name, input.serverID);
            const shouldRecordAfterHashCheck = target.isCurrentProfile && Boolean(input.hash);
            if (target.isCurrentProfile && !shouldRecordAfterHashCheck) {
                await recordHistoryAccess(ctx);
            }

            const isCurrent =
                target.isCurrentProfile &&
                worldState.currentYear === input.year &&
                worldState.currentMonth === input.month;

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

            const findArchivedRow = (profileName: string) =>
                ctx.db.yearbookHistory.findFirst({
                    where: { profileName, year: input.year, month: input.month },
                    orderBy: [{ sourceId: 'desc' as const }, { id: 'desc' as const }],
                });
            let row = await findArchivedRow(target.archiveKey);
            if (!row && target.legacyAlias) {
                row = await findArchivedRow(target.legacyAlias);
            }
            if (!row) {
                throw new TRPCError({ code: 'NOT_FOUND', message: '연감 데이터를 찾을 수 없습니다.' });
            }

            const map = asRecord(row.map) as BaseMapResult;
            const nations = parseYearbookNations(row.nations);
            const globalHistory = normalizeArchivedLogs(row.globalHistory, input.month);
            let globalAction = normalizeArchivedLogs(row.globalAction, input.month);
            if (target.isCurrentProfile) {
                const liveGlobalAction = await readGlobalActionLogs(ctx, input.year, input.month);
                if (liveGlobalAction.length) {
                    globalAction = liveGlobalAction;
                }
            }
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
