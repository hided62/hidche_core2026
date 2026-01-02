import type { GameApiContext, WorldStateRow } from '../context.js';

export type MapCityCompact = [number, number, number, number, number, number];
export type MapNationCompact = [number, string, string, number];

export type BaseMapResult = {
    result: true;
    version: 0;
    startYear: number;
    year: number;
    month: number;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const asRecord = (value: unknown): Record<string, unknown> =>
    isRecord(value) ? value : {};

const resolveStartYear = (worldState: WorldStateRow): number => {
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

const buildBaseMapCacheKey = (ctx: GameApiContext): string =>
    `sammo:map:base:${ctx.profile.id}:${ctx.profile.scenario}`;

const loadBaseMap = async (
    ctx: GameApiContext,
    useCache: boolean
): Promise<BaseMapResult | null> => {
    const cacheKey = buildBaseMapCacheKey(ctx);
    if (useCache) {
        const cached = await ctx.redis.get(cacheKey);
        if (cached) {
            try {
                return JSON.parse(cached) as BaseMapResult;
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
        return [
            row.id,
            row.level,
            state,
            row.nationId,
            row.region,
            supplyFlag,
        ];
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
        cityList,
        nationList,
    };

    if (useCache) {
        await ctx.redis.set(cacheKey, JSON.stringify(baseMap), {
            EX: BASE_MAP_TTL_SECONDS,
        });
    }

    return baseMap;
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
    const baseMap = await loadBaseMap(ctx, options.useCache ?? true);
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
        shownByGeneralList = generalCities
            .map((row) => row.cityId)
            .filter((id) => Number.isFinite(id));
    }

    return {
        ...baseMap,
        spyList,
        shownByGeneralList,
        myCity,
        myNation,
    };
};
