import { asNumber, asRecord } from '@sammo-ts/common';

import type { TurnCalendarHandler } from './inMemoryWorld.js';
import type { InMemoryTurnWorld } from './inMemoryWorld.js';

const MAP_VERSION = 0 as const;

type MapCityCompact = [number, number, number, number, number, number];
type MapNationCompact = [number, string, string, number];

type YearbookMap = {
    result: true;
    version: number;
    startYear: number;
    year: number;
    month: number;
    cityList: MapCityCompact[];
    nationList: MapNationCompact[];
};

type YearbookNation = {
    id: number;
    name: string;
    color: string;
    level: number;
    power: number;
    generalCount: number;
    cities: string[];
};

type DynastyStatistics = {
    maxNationCount: number;
    maxNationName: string;
    maxNationHist: Record<string, number>;
    maxGeneralCount: number;
    currentGeneralCount: number;
    userGeneralCount: number;
    npcGeneralCount: number;
    personalHist: Record<string, number>;
    specialHist: Record<string, number>;
    special2Hist: Record<string, number>;
};

const readState = (meta: Record<string, unknown>): number => {
    const raw = meta.state;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Math.floor(raw);
    }
    return 0;
};

const resolveStartYear = (meta: Record<string, unknown>): number => {
    const scenarioMeta = asRecord(meta.scenarioMeta);
    const startYear = scenarioMeta.startYear;
    if (typeof startYear === 'number' && Number.isFinite(startYear)) {
        return startYear;
    }
    return 0;
};

const buildMapSnapshot = (world: InMemoryTurnWorld, year: number, month: number): YearbookMap => {
    const state = world.getState();
    const cityList: MapCityCompact[] = world.listCities().map((city) => {
        const meta = asRecord(city.meta);
        const stateValue = city.state ?? readState(meta);
        const region = asNumber(meta.region, 0);
        const supplyFlag = city.supplyState > 0 ? 1 : 0;
        return [city.id, city.level, stateValue, city.nationId, region, supplyFlag];
    });

    const nationList: MapNationCompact[] = world
        .listNations()
        .map((nation) => [nation.id, nation.name, nation.color, nation.capitalCityId ?? 0]);

    return {
        result: true,
        version: MAP_VERSION,
        startYear: resolveStartYear(asRecord(state.meta)),
        year,
        month,
        cityList,
        nationList,
    };
};

const buildNationSnapshot = (world: InMemoryTurnWorld): YearbookNation[] => {
    const cities = world.listCities();
    const generals = world.listGenerals();
    const nations = world.listNations();

    const cityStatsByNation = new Map<number, { popSum: number; valueSum: number; maxSum: number }>();
    const cityNamesByNation = new Map<number, string[]>();

    for (const city of cities) {
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
    for (const general of generals) {
        const entry = generalStatsByNation.get(general.nationId) ?? {
            goldRice: 0,
            statPower: 0,
            expDed: 0,
            generalCount: 0,
        };
        entry.generalCount += 1;
        entry.goldRice += general.gold + general.rice;
        const leadership = general.stats.leadership;
        const strength = general.stats.strength;
        const intel = general.stats.intelligence;
        const npcMultiplier = general.npcState < 2 ? 1.2 : 1;
        const leaderCore = leadership >= 40 ? leadership : 0;
        entry.statPower += npcMultiplier * leaderCore * 2 + (Math.sqrt(intel * strength) * 2 + leadership / 2) / 2;
        entry.expDed += general.experience + general.dedication;
        generalStatsByNation.set(general.nationId, entry);
    }

    return nations.map((nation) => {
        const generalStats = generalStatsByNation.get(nation.id) ?? {
            goldRice: 0,
            statPower: 0,
            expDed: 0,
            generalCount: 0,
        };
        const cityStats = cityStatsByNation.get(nation.id) ?? { popSum: 0, valueSum: 0, maxSum: 0 };
        const resource = Math.round(((nation.gold ?? 0) + (nation.rice ?? 0) + generalStats.goldRice) / 100);
        const tech = asNumber(asRecord(nation.meta).tech, 0);
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
            generalCount: generalStats.generalCount,
            cities: cityNamesByNation.get(nation.id) ?? [],
        };
    });
};

const increment = (target: Record<string, number>, key: string): void => {
    target[key] = (target[key] ?? 0) + 1;
};

const updateDynastyStatistics = (world: InMemoryTurnWorld): void => {
    const state = world.getState();
    const previous = asRecord(state.meta.dynastyStatistics);
    const activeNations = world
        .listNations()
        .filter((nation) => nation.level > 0)
        .sort((left, right) => right.power - left.power || left.id - right.id);
    const generals = world.listGenerals();
    const maxNationCount = Math.max(asNumber(previous.maxNationCount, 0), activeNations.length);
    const replaceNationMaximum = activeNations.length > asNumber(previous.maxNationCount, 0);
    const nationHist: Record<string, number> = {};
    for (const nation of activeNations) increment(nationHist, nation.typeCode || 'neutral');

    const personalHist: Record<string, number> = {};
    const specialHist: Record<string, number> = {};
    const special2Hist: Record<string, number> = {};
    let userGeneralCount = 0;
    let npcGeneralCount = 0;
    for (const general of generals) {
        increment(personalHist, general.role.personality || 'None');
        increment(specialHist, general.role.specialDomestic || 'None');
        increment(special2Hist, general.role.specialWar || 'None');
        if (general.npcState < 2) userGeneralCount += 1;
        else npcGeneralCount += 1;
    }

    const statistics: DynastyStatistics = {
        maxNationCount,
        maxNationName: replaceNationMaximum
            ? activeNations.map((nation) => `${nation.name}(${nation.typeCode})`).join(', ')
            : typeof previous.maxNationName === 'string'
              ? previous.maxNationName
              : '',
        maxNationHist: replaceNationMaximum
            ? nationHist
            : Object.fromEntries(
                  Object.entries(asRecord(previous.maxNationHist)).flatMap(([key, value]) =>
                      typeof value === 'number' && Number.isFinite(value) ? [[key, value]] : []
                  )
              ),
        maxGeneralCount: Math.max(asNumber(previous.maxGeneralCount, 0), generals.length),
        currentGeneralCount: generals.length,
        userGeneralCount,
        npcGeneralCount,
        personalHist,
        specialHist,
        special2Hist,
    };
    world.updateWorldMeta({ dynastyStatistics: statistics });
};

const resolveServerId = (world: InMemoryTurnWorld, fallback: string): string => {
    const serverId = world.getState().meta.serverId;
    return typeof serverId === 'string' && serverId.trim() ? serverId.trim() : fallback;
};

export const queueYearbookSnapshot = (
    world: InMemoryTurnWorld,
    profileName: string,
    year: number,
    month: number
): void => {
    world.queueYearbookSnapshot({
        serverId: resolveServerId(world, profileName),
        sourceId: 0,
        year,
        month,
        map: buildMapSnapshot(world, year, month),
        nations: buildNationSnapshot(world),
    });
};

export const createYearbookHandler = (options: {
    profileName: string;
    getWorld: () => InMemoryTurnWorld | null;
}): { handler: TurnCalendarHandler } => ({
    handler: {
        beforeMonthChanged: (context) => {
            const world = options.getWorld();
            if (!world) return;
            updateDynastyStatistics(world);
            queueYearbookSnapshot(world, options.profileName, context.previousYear, context.previousMonth);
        },
    },
});
