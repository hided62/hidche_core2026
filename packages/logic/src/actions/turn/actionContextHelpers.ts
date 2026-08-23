import type { General } from '@sammo-ts/logic/domain/entities.js';
import type { ScenarioConfig } from '@sammo-ts/logic/scenario/types.js';
import { LEGACY_DEFAULT_MAX_LEVEL } from '@sammo-ts/logic/scenario/constants.js';
import type { ScenarioMeta } from '@sammo-ts/logic/world/types.js';
import type { WarAftermathConfig, WarEngineConfig, WarTimeContext } from '@sammo-ts/logic/war/types.js';
import type { UnitSetDefinition } from '@sammo-ts/logic/world/types.js';
import type { ActionContextWorldRef, ActionContextWorldState } from './actionContext.js';
import { asRecord } from '@sammo-ts/common';

export interface WorldSummary {
    totalGeneralCount: number;
    totalNpcCount: number;
    averageStats?: General['stats'];
}

export interface NationSummary {
    averageStats?: General['stats'];
    averageExperience?: number;
    averageDedication?: number;
    averageDex?: [number, number, number, number, number];
}

export const buildWorldSummary = (world: ActionContextWorldRef | null): WorldSummary => {
    if (!world) {
        return { totalGeneralCount: 0, totalNpcCount: 0 };
    }
    const generals = world.listGenerals();
    if (generals.length === 0) {
        return { totalGeneralCount: 0, totalNpcCount: 0 };
    }
    const countedGenerals = generals.filter((general) => general.npcState < 4);
    const total = countedGenerals.length;
    const totalGeneralCount = generals.filter((general) => general.npcState <= 2).length;
    const totalNpcCount = generals.filter((general) => general.npcState >= 3 && general.npcState <= 4).length;
    const statSum = countedGenerals.reduce(
        (acc, general) => ({
            leadership: acc.leadership + general.stats.leadership,
            strength: acc.strength + general.stats.strength,
            intelligence: acc.intelligence + general.stats.intelligence,
        }),
        { leadership: 0, strength: 0, intelligence: 0 }
    );
    return {
        totalGeneralCount,
        totalNpcCount,
        averageStats: {
            leadership: statSum.leadership / total,
            strength: statSum.strength / total,
            intelligence: statSum.intelligence / total,
        },
    };
};

export const buildNationSummary = (world: ActionContextWorldRef | null, nationId: number): NationSummary => {
    if (!world || nationId <= 0) {
        return {};
    }
    const generals = world.listGenerals().filter((general) => general.nationId === nationId);
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
    const dexSum = generals.reduce<[number, number, number, number, number]>(
        (acc, general) => [
            acc[0] + Number(general.meta.dex1 ?? 0),
            acc[1] + Number(general.meta.dex2 ?? 0),
            acc[2] + Number(general.meta.dex3 ?? 0),
            acc[3] + Number(general.meta.dex4 ?? 0),
            acc[4] + Number(general.meta.dex5 ?? 0),
        ],
        [0, 0, 0, 0, 0] as [number, number, number, number, number]
    );
    return {
        averageStats: {
            leadership: statSum.leadership / total,
            strength: statSum.strength / total,
            intelligence: statSum.intelligence / total,
        },
        averageExperience: expSum / total,
        averageDedication: dedSum / total,
        averageDex: [dexSum[0] / total, dexSum[1] / total, dexSum[2] / total, dexSum[3] / total, dexSum[4] / total],
    };
};

export const buildAverageNationGeneralCount = (world: ActionContextWorldRef | null): number => {
    if (!world) {
        return 0;
    }
    const generals = world.listGenerals();
    const nations = world.listNations().filter((nation) => nation.level > 0);
    if (nations.length === 0) {
        return generals.length;
    }
    return (
        nations.reduce((sum, nation) => {
            const storedCount = nation.meta.gennum;
            if (typeof storedCount === 'number' && Number.isFinite(storedCount)) {
                return sum + storedCount;
            }
            return sum + generals.filter((general) => general.nationId === nation.id).length;
        }, 0) / nations.length
    );
};

export const resolveStartYear = (world: ActionContextWorldState, scenarioMeta?: ScenarioMeta): number => {
    if (typeof scenarioMeta?.startYear === 'number') {
        return scenarioMeta.startYear;
    }
    return world.currentYear;
};

const readFiniteInteger = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.floor(value);
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return Math.floor(parsed);
        }
    }
    return fallback;
};

export const resolveInitYearMonth = (
    world: ActionContextWorldState,
    scenarioMeta?: ScenarioMeta
): { year: number; month: number } => {
    const meta = asRecord(world.meta);
    const startYear = resolveStartYear(world, scenarioMeta);
    return {
        year: readFiniteInteger(meta.initYear, startYear),
        month: readFiniteInteger(meta.initMonth, 1),
    };
};

export const resolveTurnTermMinutes = (world: ActionContextWorldState): number =>
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
    maxTechLevel: 12,
    defaultCityWall: 1000,
    baseGold: 0,
    baseRice: 2000,
};

const resolveNumber = (record: Record<string, unknown>, keys: string[], fallback: number): number => {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return fallback;
};

// 성벽 병종은 이름/요구조건을 우선해 찾고, 없으면 기본값을 사용한다.
const resolveCastleCrewTypeId = (unitSet: UnitSetDefinition, fallback: number): number => {
    const crewTypes = unitSet.crewTypes ?? [];
    const byName = crewTypes.find((crewType) => crewType.name.includes('성벽'));
    if (byName) {
        return byName.id;
    }
    const byRequirement = crewTypes.find((crewType) =>
        crewType.requirements.some((requirement) => requirement.type === 'Impossible')
    );
    if (byRequirement) {
        return byRequirement.id;
    }
    if (typeof unitSet.defaultCrewTypeId === 'number') {
        return unitSet.defaultCrewTypeId;
    }
    return crewTypes[0]?.id ?? fallback;
};

const resolveCastleArmType = (unitSet: UnitSetDefinition, castleCrewTypeId: number): number => {
    const crewTypes = unitSet.crewTypes ?? [];
    return crewTypes.find((crewType) => crewType.id === castleCrewTypeId)?.armType ?? 0;
};

export const buildWarConfig = (scenarioConfig: ScenarioConfig, unitSet: UnitSetDefinition): WarEngineConfig => {
    const constValues = asRecord(scenarioConfig.const);
    const castleCrewTypeId = resolveNumber(constValues, ['castleCrewTypeId'], resolveCastleCrewTypeId(unitSet, 0));
    const castleArmType = resolveCastleArmType(unitSet, castleCrewTypeId);

    return {
        armPerPhase: resolveNumber(constValues, ['armPerPhase', 'armperphase'], DEFAULT_WAR_CONFIG.armPerPhase),
        maxTrainByCommand: resolveNumber(constValues, ['maxTrainByCommand'], DEFAULT_WAR_CONFIG.maxTrainByCommand),
        maxAtmosByCommand: resolveNumber(constValues, ['maxAtmosByCommand'], DEFAULT_WAR_CONFIG.maxAtmosByCommand),
        maxTrainByWar: resolveNumber(constValues, ['maxTrainByWar'], DEFAULT_WAR_CONFIG.maxTrainByWar),
        maxAtmosByWar: resolveNumber(constValues, ['maxAtmosByWar'], DEFAULT_WAR_CONFIG.maxAtmosByWar),
        maxTechLevel: resolveNumber(constValues, ['maxTechLevel'], DEFAULT_AFTER_CONFIG.maxTechLevel),
        maxGeneralStat: resolveNumber(constValues, ['maxLevel'], LEGACY_DEFAULT_MAX_LEVEL),
        statUpgradeLimit: resolveNumber(constValues, ['upgradeLimit'], 30),
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

export const buildWarAftermathConfig = (
    scenarioConfig: ScenarioConfig,
    castleCrewTypeId: number
): WarAftermathConfig => {
    const constValues = asRecord(scenarioConfig.const);
    return {
        initialNationGenLimit: resolveNumber(constValues, ['initialNationGenLimit'], 0),
        techLevelIncYear: resolveNumber(constValues, ['techLevelIncYear'], DEFAULT_AFTER_CONFIG.techLevelIncYear),
        initialAllowedTechLevel: resolveNumber(
            constValues,
            ['initialAllowedTechLevel'],
            DEFAULT_AFTER_CONFIG.initialAllowedTechLevel
        ),
        maxTechLevel: resolveNumber(constValues, ['maxTechLevel'], DEFAULT_AFTER_CONFIG.maxTechLevel),
        defaultCityWall: resolveNumber(constValues, ['defaultCityWall'], DEFAULT_AFTER_CONFIG.defaultCityWall),
        baseGold: resolveNumber(constValues, ['baseGold', 'basegold'], DEFAULT_AFTER_CONFIG.baseGold),
        baseRice: resolveNumber(constValues, ['baseRice', 'baserice'], DEFAULT_AFTER_CONFIG.baseRice),
        castleCrewTypeId,
        joinMode: 'full',
        joinRuinedNpcProbability: resolveNumber(constValues, ['joinRuinedNPCProp'], 0.1),
    };
};

export const buildWarTime = (world: ActionContextWorldState, scenarioMeta?: ScenarioMeta): WarTimeContext => ({
    year: world.currentYear,
    month: world.currentMonth,
    startYear: resolveStartYear(world, scenarioMeta),
});
