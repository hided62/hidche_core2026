import type { WorldStateRow } from '../context.js';
import type { BattleSimJobPayload, BattleSimRequestPayload } from './types.js';
import { loadUnitSetDefinitionByName } from './unitSetLoader.js';
import type { WarEngineConfig } from '@sammo-ts/logic';

const DEFAULT_WAR_CONFIG = {
    armPerPhase: 500,
    maxTrainByCommand: 100,
    maxAtmosByCommand: 100,
    maxTrainByWar: 110,
    maxAtmosByWar: 150,
};

const asRecord = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
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

const resolveUnitSetName = (worldState: WorldStateRow, fallback: string): string => {
    const config = asRecord(worldState.config);
    const environment = asRecord(config.environment ?? config.map);
    const unitSet = environment.unitSet;
    if (typeof unitSet === 'string' && unitSet.trim().length > 0) {
        return unitSet;
    }
    return fallback;
};

const resolveStartYear = (worldState: WorldStateRow): number => {
    const meta = asRecord(worldState.meta);
    const scenarioMeta = asRecord(meta.scenarioMeta);
    const startYear = scenarioMeta.startYear;
    if (typeof startYear === 'number' && Number.isFinite(startYear)) {
        return startYear;
    }
    return 0;
};

const resolveCastleCrewTypeId = (unitSet: {
    crewTypes?: Array<{ id: number; name: string; requirements: Array<{ type: string }> }>;
    defaultCrewTypeId?: number;
}): number => {
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
    return crewTypes[0]?.id ?? 0;
};

const resolveCastleArmType = (
    unitSet: {
        crewTypes?: Array<{ id: number; armType: number }>;
    },
    castleCrewTypeId: number
): number => {
    const crewTypes = unitSet.crewTypes ?? [];
    return crewTypes.find((crewType) => crewType.id === castleCrewTypeId)?.armType ?? 0;
};

export const buildBattleSimJobPayload = async (
    worldState: WorldStateRow,
    request: BattleSimRequestPayload,
    profileFallback: string
): Promise<BattleSimJobPayload> => {
    const unitSetName = resolveUnitSetName(worldState, profileFallback);
    const unitSet = await loadUnitSetDefinitionByName(unitSetName);

    const configRecord = asRecord(worldState.config);
    const constValues = asRecord(configRecord.const ?? configRecord.consts);
    const castleCrewTypeId = resolveNumber(constValues, ['castleCrewTypeId'], resolveCastleCrewTypeId(unitSet));
    const castleArmType = resolveCastleArmType(unitSet, castleCrewTypeId);

    const config: WarEngineConfig = {
        armPerPhase: resolveNumber(constValues, ['armPerPhase', 'armperphase'], DEFAULT_WAR_CONFIG.armPerPhase),
        maxTrainByCommand: resolveNumber(constValues, ['maxTrainByCommand'], DEFAULT_WAR_CONFIG.maxTrainByCommand),
        maxAtmosByCommand: resolveNumber(constValues, ['maxAtmosByCommand'], DEFAULT_WAR_CONFIG.maxAtmosByCommand),
        maxTrainByWar: resolveNumber(constValues, ['maxTrainByWar'], DEFAULT_WAR_CONFIG.maxTrainByWar),
        maxAtmosByWar: resolveNumber(constValues, ['maxAtmosByWar'], DEFAULT_WAR_CONFIG.maxAtmosByWar),
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

    return {
        ...request,
        unitSet,
        config,
        time: {
            year: request.year,
            month: request.month,
            startYear: resolveStartYear(worldState),
        },
    };
};
