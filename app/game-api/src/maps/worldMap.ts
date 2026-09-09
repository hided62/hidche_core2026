import type { GameApiContext, WorldStateRow } from '../context.js';
import { asRecord, isRecord } from '@sammo-ts/common';
import { resolveUniqueConfig } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import { readMapWorldSourceRevision } from './worldMapSourceRevision.js';

export type MapCityCompact = [number, number, number, number, number, number];
export type MapNationCompact = [number, string, string, number];

export type BaseMapResult = {
    result: true;
    version: 0;
    startYear: number;
    year: number;
    month: number;
    techLevelLimit: {
        maxLevel: number;
        initialLevel: number;
        increaseYears: number;
    };
    uniqueItemLimit: { count: number; until: { year: number; month: number } | null };
    cityList: MapCityCompact[];
    nationList: MapNationCompact[];
};

export type WorldMapResult = BaseMapResult & {
    spyList: Record<number, number>;
    shownByGeneralList: number[];
    myCity: number | null;
    myNation: number | null;
};

type MapCityRow = {
    id: number;
    level: number;
    nationId: number;
    region: number;
    supplyState: number;
    meta: unknown;
};

type MapNationRow = {
    id: number;
    name: string;
    color: string;
    capitalCityId: number | null;
    meta: unknown;
};

type GeneralCityRow = {
    cityId: number;
};

const MAP_VERSION = 0 as const;
const BASE_MAP_TTL_SECONDS = 30;
const PUBLIC_MAP_TTL_SECONDS = 600;

const resolveStartYear = (worldState: Pick<WorldStateRow, 'meta'>): number => {
    const meta = asRecord(worldState.meta);
    const scenarioMeta = asRecord(meta.scenarioMeta);
    const startYear = scenarioMeta.startYear;
    if (typeof startYear === 'number' && Number.isFinite(startYear)) {
        return startYear;
    }
    return 0;
};

const readState = (meta: Record<string, unknown>): number => {
    const raw = meta.state;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Math.floor(raw);
    }
    return 0;
};

const readPositiveInteger = (value: unknown, fallback: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }
    const normalized = Math.floor(value);
    return normalized > 0 ? normalized : fallback;
};

const resolveTechLevelLimit = (worldState: WorldStateRow): BaseMapResult['techLevelLimit'] => {
    const constValues = asRecord(asRecord(worldState.config).const);
    return {
        maxLevel: readPositiveInteger(constValues.maxTechLevel, 12),
        initialLevel: readPositiveInteger(constValues.initialAllowedTechLevel, 1),
        increaseYears: readPositiveInteger(constValues.techLevelIncYear, 5),
    };
};

// 획득/경매와 같은 시나리오 설정을 사용하며, 장수 개인의 보유 수는 공개하지 않는다.
export const resolveMapUniqueItemLimit = (
    worldState: Pick<WorldStateRow, 'config' | 'meta' | 'currentYear'>
): BaseMapResult['uniqueItemLimit'] => {
    const config = resolveUniqueConfig(asRecord(asRecord(worldState.config).const));
    const startYear = resolveStartYear(worldState);
    const relativeYear = worldState.currentYear - startYear;
    const slotCount = Object.keys(config.allItems).length;
    let count = Math.min(1, slotCount);
    for (const [targetYear, targetCount] of config.maxUniqueItemLimit) {
        const nextCount = Math.min(targetCount, slotCount);
        if (relativeYear < targetYear) {
            if (nextCount !== count) {
                return { count, until: { year: startYear + targetYear - 1, month: 12 } };
            }
        } else {
            count = nextCount;
        }
    }
    return { count, until: null };
};

const normalizeNumberRecord = (value: unknown): Record<number, number> => {
    if (!isRecord(value)) {
        return {};
    }
    const output: Record<number, number> = {};
    for (const [key, rawValue] of Object.entries(value)) {
        const keyNumber = Number(key);
        if (!Number.isFinite(keyNumber)) {
            continue;
        }
        if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
            output[keyNumber] = Math.floor(rawValue);
        }
    }
    return output;
};

const resolveSpyList = (meta: Record<string, unknown>): Record<number, number> => {
    if (meta.spyList !== undefined) {
        return normalizeNumberRecord(meta.spyList);
    }
    if (meta.spy !== undefined) {
        return normalizeNumberRecord(meta.spy);
    }
    return {};
};

const buildBaseMapCacheKey = (ctx: GameApiContext, scope: 'base' | 'public' = 'base'): string =>
    `sammo:map:${scope}:${ctx.profile.id}:${ctx.profile.scenario}`;

export const buildRevisionedBaseMapCacheKey = async (
    ctx: GameApiContext,
    scope: 'base' | 'public' = 'base'
): Promise<string | null> => {
    const revision = await readMapWorldSourceRevision(ctx.db);
    return revision === null ? null : `${buildBaseMapCacheKey(ctx, scope)}:pg${revision}`;
};

const loadBaseMap = async (
    ctx: GameApiContext,
    options?: {
        useCache?: boolean;
        cacheKey?: string;
        cacheScope?: 'base' | 'public';
        ttlSeconds?: number;
    }
): Promise<BaseMapResult | null> => {
    let useCache = options?.useCache ?? true;
    let cacheKey = options?.cacheKey;
    if (useCache && !cacheKey) {
        cacheKey = (await buildRevisionedBaseMapCacheKey(ctx, options?.cacheScope)) ?? undefined;
        if (!cacheKey) {
            useCache = false;
        }
    }
    const ttlSeconds = options?.ttlSeconds ?? BASE_MAP_TTL_SECONDS;

    if (useCache) {
        let cached: string | null = null;
        try {
            cached = await ctx.redis.get(cacheKey!);
        } catch {
            // Redis cache availability must not make the authoritative map unavailable.
            useCache = false;
        }
        if (cached) {
            try {
                const parsed = JSON.parse(cached) as BaseMapResult;
                if (parsed.uniqueItemLimit) {
                    return parsed;
                }
            } catch {
                // Ignore cache parse errors.
            }
        }
    }

    const worldState = await ctx.db.worldState.findFirst();
    if (!worldState) {
        return null;
    }

    const [cityRows, nationRows] = await Promise.all([
        ctx.db.$queryRaw<MapCityRow[]>`
            SELECT id,
                level,
                nation_id as "nationId",
                region,
                supply_state as "supplyState",
                meta
            FROM city
        `,
        ctx.db.$queryRaw<MapNationRow[]>`
            SELECT id,
                name,
                color,
                capital_city_id as "capitalCityId",
                meta
            FROM nation
        `,
    ]);

    const cityList: MapCityCompact[] = cityRows.map((row) => {
        const meta = asRecord(row.meta);
        const state = readState(meta);
        const supplyFlag = row.supplyState > 0 ? 1 : 0;
        return [row.id, row.level, state, row.nationId, row.region, supplyFlag];
    });

    const nationList: MapNationCompact[] = nationRows.map((row) => [
        row.id,
        row.name,
        row.color,
        row.capitalCityId ?? 0,
    ]);

    const baseMap: BaseMapResult = {
        result: true,
        version: MAP_VERSION,
        startYear: resolveStartYear(worldState),
        year: worldState.currentYear,
        month: worldState.currentMonth,
        techLevelLimit: resolveTechLevelLimit(worldState),
        uniqueItemLimit: resolveMapUniqueItemLimit(worldState),
        cityList,
        nationList,
    };

    if (useCache) {
        try {
            await ctx.redis.set(cacheKey!, JSON.stringify(baseMap), {
                EX: ttlSeconds,
            });
        } catch {
            // The computed PostgreSQL result remains usable when Redis is unavailable.
        }
    }

    return baseMap;
};

export const loadPublicMap = async (ctx: GameApiContext, useCache = true): Promise<BaseMapResult | null> => {
    return loadBaseMap(ctx, {
        useCache,
        cacheScope: 'public',
        ttlSeconds: PUBLIC_MAP_TTL_SECONDS,
    });
};

export const loadWorldMap = async (
    ctx: GameApiContext,
    options: {
        generalId?: number;
        neutralView?: boolean;
        showMe?: boolean;
        useCache?: boolean;
    }
): Promise<WorldMapResult | null> => {
    const baseMap = await loadBaseMap(ctx, { useCache: options.useCache ?? true });
    if (!baseMap) {
        return null;
    }

    let myCity: number | null = null;
    let myNation: number | null = null;
    let spyList: Record<number, number> = {};
    let shownByGeneralList: number[] = [];

    if (options.generalId) {
        const general = await ctx.db.general.findUnique({
            where: { id: options.generalId },
        });
        if (general) {
            if (options.showMe !== false && general.cityId > 0) {
                myCity = general.cityId;
            }
            if (options.neutralView !== true && general.nationId > 0) {
                myNation = general.nationId;
            }
        }
    }

    if (myNation !== null) {
        const nation = await ctx.db.nation.findUnique({
            where: { id: myNation },
        });
        if (nation) {
            spyList = resolveSpyList(asRecord(nation.meta));
        }

        const generalCities = await ctx.db.$queryRaw<GeneralCityRow[]>`
            SELECT DISTINCT city_id as "cityId"
            FROM general
            WHERE nation_id = ${myNation}
        `;
        shownByGeneralList = generalCities.map((row) => row.cityId).filter((id) => Number.isFinite(id));
    }

    return {
        ...baseMap,
        spyList,
        shownByGeneralList,
        myCity,
        myNation,
    };
};
