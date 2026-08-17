import { GAME_TICKS_PER_TURN, LiteHashDRBG, RandUtil, asRecord } from '@sammo-ts/common';
import {
    LogCategory,
    LogFormat,
    LogScope,
    AVAILABLE_NATION_TRAIT_KEYS,
    getCityDistance,
    type City,
    type MapDefinition,
    type Nation,
    type TurnCommandEnv,
} from '@sammo-ts/logic';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import { buildNpcStats, pickNpcNames } from './monthlyCreateManyNpcAction.js';
import type { MonthlyEventActionHandler, MonthlyEventEnvironment } from './monthlyEventHandler.js';
import type { InMemoryReservedTurnStore } from './reservedTurnStore.js';
import type { TurnGeneral } from './types.js';

const CITY_KEYS = ['population', 'agriculture', 'commerce', 'security', 'defence', 'wall'] as const;
const NATION_COLORS = [
    '#FF0000',
    '#800000',
    '#A0522D',
    '#FF6347',
    '#FFA500',
    '#FFDAB9',
    '#FFD700',
    '#FFFF00',
    '#7CFC00',
    '#00FF00',
    '#808000',
    '#008000',
    '#2E8B57',
    '#008080',
    '#20B2AA',
    '#6495ED',
    '#7FFFD4',
    '#AFEEEE',
    '#87CEEB',
    '#00FFFF',
    '#00BFFF',
    '#0000FF',
    '#000080',
    '#483D8B',
    '#7B68EE',
    '#BA55D3',
    '#800080',
    '#FF00FF',
    '#FFC0CB',
    '#F5F5DC',
    '#E0FFFF',
    '#FFFFFF',
    '#A9A9A9',
] as const;
const NPC_TYPE = 6;
const NPC_PREFIX = 'ⓤ';
const STAT_TYPE_WEIGHTS = { 무: 1, 지: 1 } as const;

type CityValues = Record<(typeof CITY_KEYS)[number], number>;

const resolveHiddenSeed = (world: InMemoryTurnWorld): string | number => {
    const state = world.getState();
    const value = state.meta.hiddenSeed ?? state.meta.seed ?? state.id;
    return typeof value === 'string' || typeof value === 'number' ? value : String(value);
};

const trimAverage = (values: number[]): number => {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((left, right) => left - right);
    if (sorted.length >= 3) {
        const reduceCount = Math.max(Math.round(sorted.length / 6), 1);
        sorted.splice(sorted.length - reduceCount, reduceCount);
        sorted.splice(0, reduceCount);
    }
    return Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length);
};

const calculateAverageCity = (rng: RandUtil, cities: City[]): CityValues => {
    if (cities.length === 0) {
        throw new Error('RaiseNPCNation requires at least one level 5 or 6 city.');
    }
    const occupied = cities.filter((city) => city.nationId !== 0);
    if (occupied.length === 0) {
        const selected = rng.choice(cities);
        return {
            population: selected.populationMax,
            agriculture: selected.agricultureMax,
            commerce: selected.commerceMax,
            security: selected.securityMax,
            defence: selected.defenceMax,
            wall: selected.wallMax,
        };
    }
    const sorted = [...occupied].sort((left, right) => {
        const leftSum = left.agriculture + left.commerce + left.security + left.defence + left.wall;
        const rightSum = right.agriculture + right.commerce + right.security + right.defence + right.wall;
        return leftSum - rightSum;
    });
    if (sorted.length >= 3) {
        const reduceCount = Math.max(Math.round(sorted.length / 6), 1);
        sorted.splice(sorted.length - reduceCount, reduceCount);
        sorted.splice(0, reduceCount);
    }
    return Object.fromEntries(
        CITY_KEYS.map((key) => [key, Math.trunc(sorted.reduce((sum, city) => sum + city[key], 0) / sorted.length)])
    ) as CityValues;
};

const buildSpecialityAge = (retirementYear: number, age: number, relativeYear: number, divisor: number): number =>
    Math.max(Math.round((retirementYear - age) / divisor - relativeYear / 2), 3) + age;

const createNpcGeneral = (options: {
    world: InMemoryTurnWorld;
    reservedTurns: InMemoryReservedTurnStore;
    rng: RandUtil;
    env: TurnCommandEnv;
    environment: MonthlyEventEnvironment;
    baseName: string;
    nationId: number;
    cityId: number;
    officerLevel: number;
    bornYear: number;
    deadYear: number;
    killturn?: number;
}): TurnGeneral => {
    const { world, reservedTurns, rng, env, environment } = options;
    const stats = buildNpcStats(rng, env, STAT_TYPE_WEIGHTS);
    const affinity = rng.nextRangeInt(1, 150);
    const personality = rng.choice(env.availablePersonalities ?? ['che_안전']);
    const age = environment.year - options.bornYear;
    const relativeYear = Math.max(environment.year - environment.startyear, 0);
    const constValues = asRecord(world.getScenarioConfig().const);
    const retirementYear =
        typeof constValues.retirementYear === 'number' && Number.isFinite(constValues.retirementYear)
            ? constValues.retirementYear
            : 80;
    const turnMinutes = world.getState().tickSeconds / 60;
    if (!(turnMinutes > 0) || !Number.isInteger(turnMinutes)) {
        throw new Error('RaiseNPCNation requires a positive integer turn term.');
    }
    const turnSecond = rng.nextRangeInt(0, turnMinutes * 60 - 1);
    const turnFraction = rng.nextRangeInt(0, 999_999);
    const ticksPerSecond = GAME_TICKS_PER_TURN / world.getState().tickSeconds;
    const turnTick =
        world.dateToGameTick(environment.turnTime) +
        turnSecond * ticksPerSecond +
        Math.floor((turnFraction * ticksPerSecond) / 1_000_000);
    const turnTime = world.gameTickToDate(turnTick);
    const killturn =
        options.killturn ??
        (options.deadYear - environment.year) * 12 +
            rng.nextRangeInt(0, 11) +
            environment.month -
            1;
    const id = world.getNextGeneralId();
    const general: TurnGeneral = {
        id,
        userId: null,
        name: `${NPC_PREFIX}${options.baseName}`,
        nationId: options.nationId,
        cityId: options.cityId,
        troopId: 0,
        stats,
        experience: age * 100,
        dedication: age * 100,
        officerLevel: options.officerLevel,
        role: {
            personality,
            specialDomestic: env.defaultSpecialDomestic,
            specialWar: env.defaultSpecialWar,
            items: { horse: null, weapon: null, book: null, item: null },
        },
        injury: 0,
        gold: 1_000,
        rice: 1_000,
        crew: 0,
        crewTypeId: env.defaultCrewTypeId,
        train: 0,
        atmos: 0,
        age,
        npcState: NPC_TYPE,
        bornYear: options.bornYear,
        deadYear: options.deadYear,
        affinity,
        picture: 'default.jpg',
        triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
        lastTurn: { command: '휴식' },
        turnTime,
        turnTick,
        recentWarTime: null,
        meta: {
            killturn,
            npcType: NPC_TYPE,
            npc_org: NPC_TYPE,
            belong: 0,
            dedlevel: 1,
            specage: buildSpecialityAge(retirementYear, age, relativeYear, 12),
            specage2: buildSpecialityAge(retirementYear, age, relativeYear, 6),
            dex1: 0,
            dex2: 0,
            dex3: 0,
            dex4: 0,
            dex5: 0,
        },
    };
    if (!world.addGeneral(general)) {
        throw new Error(`RaiseNPCNation generated duplicate general id ${id}.`);
    }
    reservedTurns.ensureGeneralTurns(id);
    return general;
};

const resolveServerId = (world: InMemoryTurnWorld): string | null => {
    const value = world.getState().meta.serverId;
    return typeof value === 'string' && value !== '' ? value : null;
};

export const createRaiseNpcNationHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
    reservedTurns: InMemoryReservedTurnStore;
    env: TurnCommandEnv;
    map: MapDefinition;
    loadArchivedNationMaxId?: (serverId: string) => Promise<number>;
}): MonthlyEventActionHandler => {
    return async (_args, environment) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const targetCities = world.listCities().filter((city) => city.level >= 5 && city.level <= 6);
        const rng = new RandUtil(
            new LiteHashDRBG(
                simpleSerialize(resolveHiddenSeed(world), 'RaiseNPCNation', environment.year, environment.month)
            )
        );
        const cityShuffleRng = new RandUtil(
            new LiteHashDRBG(
                simpleSerialize(
                    resolveHiddenSeed(world),
                    'RaiseNPCNation',
                    environment.year,
                    environment.month,
                    'emptyCities'
                )
            )
        );
        const averageCity = calculateAverageCity(rng, targetCities);
        const occupiedCityIds = targetCities.filter((city) => city.nationId !== 0).map((city) => city.id);
        const emptyCities = cityShuffleRng.shuffle(targetCities.filter((city) => city.nationId === 0));
        const activeNations = world.listNations().filter((nation) => nation.id !== 0 && nation.level > 0);
        const generalCounts = activeNations.map(
            (nation) => world.listGenerals().filter((general) => general.nationId === nation.id).length
        );
        const averageGeneralCount =
            generalCounts.length === 0 ? options.env.initialNationGenLimit : trimAverage(generalCounts);
        const averageTech =
            activeNations.length === 0
                ? 0
                : Math.trunc(
                      activeNations.reduce((sum, nation) => {
                          const tech = nation.meta.tech;
                          return sum + (typeof tech === 'number' && Number.isFinite(tech) ? tech : 0);
                      }, 0) / activeNations.length
                  );

        const currentLast = world.getState().meta.lastNationId;
        const currentLastNumber =
            typeof currentLast === 'number' && Number.isFinite(currentLast) ? currentLast : 0;
        const liveNationMax = world.listNations().reduce((maxId, nation) => Math.max(maxId, nation.id), 0);
        let resolvedLastNationId = Math.max(currentLastNumber, liveNationMax);
        const serverId = resolveServerId(world);
        if (serverId && options.loadArchivedNationMaxId) {
            const archivedMax = await options.loadArchivedNationMaxId(serverId);
            resolvedLastNationId = Math.max(resolvedLastNationId, archivedMax);
        }
        if (resolvedLastNationId !== currentLastNumber) {
            world.updateWorldMeta({ lastNationId: resolvedLastNationId });
        }

        const createdCityIds: number[] = [];
        for (const city of emptyCities) {
            const distanceFromOccupied = occupiedCityIds.reduce(
                (distance, cityId) => Math.min(distance, getCityDistance(options.map, city.id, cityId)),
                999
            );
            if (distanceFromOccupied < 3) {
                continue;
            }
            const distanceFromCreated = createdCityIds.reduce(
                (distance, cityId) => Math.min(distance, getCityDistance(options.map, city.id, cityId)),
                999
            );
            if (distanceFromCreated < 2) {
                continue;
            }

            const nationId = world.getNextNationId();
            const color = rng.choice([...NATION_COLORS]);
            const typeCode = rng.choice([...AVAILABLE_NATION_TRAIT_KEYS]);
            const nation: Nation = {
                id: nationId,
                name: `${NPC_PREFIX}${city.name}`,
                color,
                capitalCityId: city.id,
                chiefGeneralId: null,
                gold: 0,
                rice: 2_000,
                power: 0,
                level: 2,
                typeCode,
                meta: {
                    tech: averageTech,
                    infoText: `우리도 할 수 있다! ${city.name}군`,
                    bill: 100,
                    rate: 15,
                    scout: 0,
                    war: 0,
                    strategicCommandLimit: 24,
                    surrenderLimit: 72,
                    can_국기변경: 1,
                },
            };
            if (!world.addNation(nation)) {
                throw new Error(`RaiseNPCNation generated duplicate nation id ${nationId}.`);
            }

            const ruler = createNpcGeneral({
                world,
                reservedTurns: options.reservedTurns,
                rng,
                env: options.env,
                environment,
                baseName: `${city.name}태수`,
                nationId,
                cityId: city.id,
                officerLevel: 12,
                bornYear: environment.year - 20,
                deadYear: environment.year + 60,
                killturn: 240,
            });
            const subordinateNames = pickNpcNames(
                rng,
                Math.max(averageGeneralCount - 1, 0),
                world.listGenerals(),
                options.env
            );
            for (const baseName of subordinateNames) {
                const deadYear =
                    environment.year +
                    10 +
                    Math.trunc(60 * (1 - Math.log2(rng.nextRange(1, 1024)) / 10));
                createNpcGeneral({
                    world,
                    reservedTurns: options.reservedTurns,
                    rng,
                    env: options.env,
                    environment,
                    baseName,
                    nationId,
                    cityId: city.id,
                    officerLevel: 1,
                    bornYear: environment.year - 20,
                    deadYear,
                });
            }
            world.updateNation(nationId, {
                chiefGeneralId: ruler.id,
                meta: { ...nation.meta, gennum: 1 + subordinateNames.length },
            });
            options.reservedTurns.ensureNationTurns(nationId, 12);
            options.reservedTurns.ensureNationTurns(nationId, 11);
            options.reservedTurns.ensureNationTurns(nationId, 10);
            options.reservedTurns.ensureNationTurns(nationId, 9);
            world.updateCity(city.id, {
                nationId,
                population: Math.min(city.populationMax, averageCity.population),
                agriculture: Math.min(city.agricultureMax, averageCity.agriculture),
                commerce: Math.min(city.commerceMax, averageCity.commerce),
                security: Math.min(city.securityMax, averageCity.security),
                defence: Math.min(city.defenceMax, averageCity.defence),
                wall: Math.min(city.wallMax, averageCity.wall),
                meta: { ...city.meta, trust: 100 },
            });
            createdCityIds.push(city.id);
        }

        if (createdCityIds.length > 0) {
            world.pushLog({
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                text: '<L><b>【공지】</b></>공백지에 임의의 국가가 생성되었습니다.',
                format: LogFormat.YEAR_MONTH,
                year: environment.year,
                month: environment.month,
            });
        }
    };
};
