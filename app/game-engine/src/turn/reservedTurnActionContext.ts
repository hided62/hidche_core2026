import type {
    City,
    General,
    MapDefinition,
    Nation,
    ScenarioConfig,
    ScenarioMeta,
    WarAftermathConfig,
    WarEngineConfig,
    WarTimeContext,
    UnitSetDefinition,
} from '@sammo-ts/logic';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { TurnGeneral, TurnWorldState } from './types.js';

interface WorldSummary {
    totalGeneralCount: number;
    totalNpcCount: number;
    averageStats?: General['stats'];
}

interface NationSummary {
    averageStats?: General['stats'];
    averageExperience?: number;
    averageDedication?: number;
}

export interface ActionRandomSource {
    nextFloat(): number;
    nextBool(probability: number): boolean;
    nextInt(minInclusive: number, maxExclusive: number): number;
}

export type ActionContextBase = {
    general: TurnGeneral;
    city?: City;
    nation?: Nation | null;
    rng: ActionRandomSource;
};

export type ActionResolveContext = ActionContextBase & Record<string, unknown>;

export interface ActionContextOptions {
    world: TurnWorldState;
    scenarioConfig: ScenarioConfig;
    scenarioMeta?: ScenarioMeta;
    map?: MapDefinition;
    unitSet?: UnitSetDefinition;
    worldRef: InMemoryTurnWorld | null;
    actionArgs: Record<string, unknown>;
    createGeneralId: () => number;
    seedBase: string;
}

type ActionContextBuilder = (
    base: ActionContextBase,
    options: ActionContextOptions
) => ActionResolveContext | null;

const buildWorldSummary = (world: InMemoryTurnWorld | null): WorldSummary => {
    if (!world) {
        return { totalGeneralCount: 0, totalNpcCount: 0 };
    }
    const generals = world.listGenerals();
    if (generals.length === 0) {
        return { totalGeneralCount: 0, totalNpcCount: 0 };
    }
    const total = generals.length;
    const npcCount = generals.filter((general) => general.npcState > 0).length;
    const statSum = generals.reduce(
        (acc, general) => ({
            leadership: acc.leadership + general.stats.leadership,
            strength: acc.strength + general.stats.strength,
            intelligence: acc.intelligence + general.stats.intelligence,
        }),
        { leadership: 0, strength: 0, intelligence: 0 }
    );
    return {
        totalGeneralCount: total,
        totalNpcCount: npcCount,
        averageStats: {
            leadership: statSum.leadership / total,
            strength: statSum.strength / total,
            intelligence: statSum.intelligence / total,
        },
    };
};

const buildNationSummary = (
    world: InMemoryTurnWorld | null,
    nationId: number
): NationSummary => {
    if (!world || nationId <= 0) {
        return {};
    }
    const generals = world.listGenerals().filter(
        (general) => general.nationId === nationId
    );
    if (generals.length === 0) {
        return {};
    }
    const total = generals.length;
    const statSum = generals.reduce(
        (acc, general) => ({
            leadership: acc.leadership + general.stats.leadership,
            strength: acc.strength + general.stats.strength,
            intelligence: acc.intelligence + general.stats.intelligence,
        }),
        { leadership: 0, strength: 0, intelligence: 0 }
    );
    const expSum = generals.reduce((acc, general) => acc + general.experience, 0);
    const dedSum = generals.reduce((acc, general) => acc + general.dedication, 0);
    return {
        averageStats: {
            leadership: statSum.leadership / total,
            strength: statSum.strength / total,
            intelligence: statSum.intelligence / total,
        },
        averageExperience: expSum / total,
        averageDedication: dedSum / total,
    };
};

const buildAverageNationGeneralCount = (world: InMemoryTurnWorld | null): number => {
    if (!world) {
        return 0;
    }
    const generals = world.listGenerals();
    const nations = world.listNations();
    if (nations.length === 0) {
        return generals.length;
    }
    return generals.length / nations.length;
};

const resolveStartYear = (
    world: TurnWorldState,
    scenarioMeta?: ScenarioMeta
): number => {
    if (typeof scenarioMeta?.startYear === 'number') {
        return scenarioMeta.startYear;
    }
    return world.currentYear;
};

const resolveTurnTermMinutes = (world: TurnWorldState): number =>
    Math.max(1, Math.round(world.tickSeconds / 60));

const DEFAULT_WAR_CONFIG = {
    armPerPhase: 500,
    maxTrainByCommand: 100,
    maxAtmosByCommand: 100,
    maxTrainByWar: 110,
    maxAtmosByWar: 150,
};

const DEFAULT_AFTER_CONFIG = {
    techLevelIncYear: 5,
    initialAllowedTechLevel: 1,
    defaultCityWall: 1000,
};

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

const resolveNumber = (
    record: Record<string, unknown>,
    keys: string[],
    fallback: number
): number => {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return fallback;
};

const resolveCastleCrewTypeId = (
    unitSet: UnitSetDefinition,
    fallback: number
): number => {
    const crewTypes = unitSet.crewTypes ?? [];
    const byName = crewTypes.find((crewType) => crewType.name.includes('성벽'));
    if (byName) {
        return byName.id;
    }
    const byRequirement = crewTypes.find((crewType) =>
        crewType.requirements.some(
            (requirement) => requirement.type === 'Impossible'
        )
    );
    if (byRequirement) {
        return byRequirement.id;
    }
    if (typeof unitSet.defaultCrewTypeId === 'number') {
        return unitSet.defaultCrewTypeId;
    }
    return crewTypes[0]?.id ?? fallback;
};

const resolveCastleArmType = (
    unitSet: UnitSetDefinition,
    castleCrewTypeId: number
): number => {
    const crewTypes = unitSet.crewTypes ?? [];
    return (
        crewTypes.find((crewType) => crewType.id === castleCrewTypeId)?.armType ??
        0
    );
};

const buildWarConfig = (
    scenarioConfig: ScenarioConfig,
    unitSet: UnitSetDefinition
): WarEngineConfig => {
    const constValues = asRecord(scenarioConfig.const);
    const castleCrewTypeId = resolveNumber(
        constValues,
        ['castleCrewTypeId'],
        resolveCastleCrewTypeId(unitSet, 0)
    );
    const castleArmType = resolveCastleArmType(unitSet, castleCrewTypeId);

    return {
        armPerPhase: resolveNumber(
            constValues,
            ['armPerPhase', 'armperphase'],
            DEFAULT_WAR_CONFIG.armPerPhase
        ),
        maxTrainByCommand: resolveNumber(
            constValues,
            ['maxTrainByCommand'],
            DEFAULT_WAR_CONFIG.maxTrainByCommand
        ),
        maxAtmosByCommand: resolveNumber(
            constValues,
            ['maxAtmosByCommand'],
            DEFAULT_WAR_CONFIG.maxAtmosByCommand
        ),
        maxTrainByWar: resolveNumber(
            constValues,
            ['maxTrainByWar'],
            DEFAULT_WAR_CONFIG.maxTrainByWar
        ),
        maxAtmosByWar: resolveNumber(
            constValues,
            ['maxAtmosByWar'],
            DEFAULT_WAR_CONFIG.maxAtmosByWar
        ),
        castleCrewTypeId,
        armTypes: {
            footman: 1,
            archer: 2,
            cavalry: 3,
            wizard: 4,
            siege: 5,
            misc: 6,
            castle: castleArmType,
        },
    };
};

const buildWarAftermathConfig = (
    scenarioConfig: ScenarioConfig,
    castleCrewTypeId: number
): WarAftermathConfig => {
    const constValues = asRecord(scenarioConfig.const);
    return {
        initialNationGenLimit: resolveNumber(
            constValues,
            ['initialNationGenLimit'],
            0
        ),
        techLevelIncYear: resolveNumber(
            constValues,
            ['techLevelIncYear'],
            DEFAULT_AFTER_CONFIG.techLevelIncYear
        ),
        initialAllowedTechLevel: resolveNumber(
            constValues,
            ['initialAllowedTechLevel'],
            DEFAULT_AFTER_CONFIG.initialAllowedTechLevel
        ),
        maxTechLevel: resolveNumber(constValues, ['maxTechLevel'], 0),
        defaultCityWall: resolveNumber(
            constValues,
            ['defaultCityWall'],
            DEFAULT_AFTER_CONFIG.defaultCityWall
        ),
        baseGold: resolveNumber(constValues, ['baseGold', 'basegold'], 0),
        baseRice: resolveNumber(constValues, ['baseRice', 'baserice'], 0),
        castleCrewTypeId,
    };
};

const buildWarTime = (
    world: TurnWorldState,
    scenarioMeta?: ScenarioMeta
): WarTimeContext => ({
    year: world.currentYear,
    month: world.currentMonth,
    startYear: resolveStartYear(world, scenarioMeta),
});

// 커맨드별로 필요한 컨텍스트 확장 데이터를 구성한다.
const ACTION_CONTEXT_BUILDERS: Record<string, ActionContextBuilder> = {
    che_인재탐색: (base, options) => ({
        ...base,
        currentYear: options.world.currentYear,
        worldSummary: buildWorldSummary(options.worldRef),
        createGeneralId: options.createGeneralId,
    }),
    che_의병모집: (base, options) => {
        const nationSummary = buildNationSummary(
            options.worldRef,
            base.general.nationId
        );
        return {
            ...base,
            currentYear: options.world.currentYear,
            startYear: resolveStartYear(options.world, options.scenarioMeta),
            averageNationGeneralCount: buildAverageNationGeneralCount(
                options.worldRef
            ),
            nationAverageStats: nationSummary.averageStats,
            nationAverageExperience: nationSummary.averageExperience,
            nationAverageDedication: nationSummary.averageDedication,
            createGeneralId: options.createGeneralId,
        };
    },
    che_포상: (base, options) => {
        const destGeneralId = options.actionArgs.destGeneralId;
        if (typeof destGeneralId !== 'number') {
            return null;
        }
        const destGeneral = options.worldRef?.getGeneralById(destGeneralId);
        if (!destGeneral) {
            return null;
        }
        return {
            ...base,
            destGeneral,
        };
    },
    che_발령: (base, options) => {
        const destGeneralId = options.actionArgs.destGeneralId;
        const destCityId = options.actionArgs.destCityId;
        if (typeof destGeneralId !== 'number' || typeof destCityId !== 'number') {
            return null;
        }
        const destGeneral = options.worldRef?.getGeneralById(destGeneralId);
        const destCity = options.worldRef?.getCityById(destCityId);
        if (!destGeneral || !destCity) {
            return null;
        }
        return {
            ...base,
            destGeneral,
            destCity,
            currentYear: options.world.currentYear,
            currentMonth: options.world.currentMonth,
            turnTermMinutes: resolveTurnTermMinutes(options.world),
            generalTurnTime: base.general.turnTime,
            destGeneralTurnTime: destGeneral.turnTime,
        };
    },
    che_징병: (base, options) => {
        if (!options.map || !options.unitSet) {
            return null;
        }
        return {
            ...base,
            map: options.map,
            unitSet: options.unitSet,
            cities: options.worldRef?.listCities() ?? [],
            currentYear: options.world.currentYear,
            startYear: resolveStartYear(options.world, options.scenarioMeta),
        };
    },
    che_불가침제의: (base, options) => ({
        ...base,
        currentYear: options.world.currentYear,
        currentMonth: options.world.currentMonth,
    }),
    che_출병: (base, options) => {
        if (!options.unitSet || !options.worldRef) {
            return null;
        }
        const destCityId = options.actionArgs.destCityId;
        if (typeof destCityId !== 'number') {
            return null;
        }
        const destCity = options.worldRef.getCityById(destCityId);
        if (!destCity) {
            return null;
        }
        const destNation =
            destCity.nationId > 0
                ? options.worldRef.getNationById(destCity.nationId)
                : null;
        const diplomacy = options.worldRef.listDiplomacy();
        const warConfig = buildWarConfig(options.scenarioConfig, options.unitSet);
        const aftermathConfig = buildWarAftermathConfig(
            options.scenarioConfig,
            warConfig.castleCrewTypeId
        );
        return {
            ...base,
            destCity,
            destNation,
            cities: options.worldRef.listCities(),
            nations: options.worldRef.listNations(),
            generals: options.worldRef.listGenerals(),
            unitSet: options.unitSet,
            map: options.map,
            diplomacy,
            time: buildWarTime(options.world, options.scenarioMeta),
            seedBase: options.seedBase,
            warConfig,
            aftermathConfig,
        };
    },
};

export const buildActionContext = (
    key: string,
    base: ActionContextBase,
    options: ActionContextOptions
): ActionResolveContext | null => {
    const builder = ACTION_CONTEXT_BUILDERS[key];
    return builder ? builder(base, options) : base;
};
