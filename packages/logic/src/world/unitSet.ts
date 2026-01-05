import type { City, General, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { CrewTypeDefinition, CrewTypeRequirement, MapDefinition, UnitSetDefinition } from './types.js';

const DEFAULT_REGION_MAP: Record<string, number> = {
    하북: 1,
    중원: 2,
    서북: 3,
    서촉: 4,
    남중: 5,
    초: 6,
    오월: 7,
    동이: 8,
};

const DEFAULT_MAX_TECH_LEVEL = 12;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const asNumber = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const asString = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);

const asStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const asNullableStringArray = (value: unknown): string[] | null => {
    if (value === null || value === undefined) {
        return null;
    }
    return asStringArray(value);
};

const normalizeCoef = (value: unknown): Record<string, number> => {
    if (!isRecord(value)) {
        return {};
    }
    const result: Record<string, number> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === 'number' && Number.isFinite(entry)) {
            result[key] = entry;
        }
    }
    return result;
};

const parseRequirement = (value: unknown): CrewTypeRequirement | null => {
    if (!isRecord(value)) {
        return null;
    }
    const type = asString(value.type, '');
    if (!type) {
        return null;
    }
    switch (type) {
        case 'ReqTech':
            return { type, tech: asNumber(value.tech, 0) };
        case 'ReqRegions':
            return { type, regions: asStringArray(value.regions) };
        case 'ReqCities':
            return { type, cities: asStringArray(value.cities) };
        case 'ReqCitiesWithCityLevel':
            return {
                type,
                level: asNumber(value.level, 0),
                cities: asStringArray(value.cities),
            };
        case 'ReqHighLevelCities':
            return {
                type,
                level: asNumber(value.level, 0),
                count: asNumber(value.count, 0),
            };
        case 'ReqNationAux':
            return {
                type,
                key: asString(value.key, ''),
                op: asString(value.op, '=='),
                value: typeof value.value === 'number' || typeof value.value === 'string' ? value.value : 0,
            };
        case 'ReqMinRelYear':
            return { type, year: asNumber(value.year, 0) };
        case 'ReqChief':
        case 'ReqNotChief':
        case 'Impossible':
            return { type };
        default:
            return { type, ...value };
    }
};

const parseCrewType = (value: unknown): CrewTypeDefinition | null => {
    if (!isRecord(value)) {
        return null;
    }
    const id = asNumber(value.id, 0);
    if (id <= 0) {
        return null;
    }
    const requirements = Array.isArray(value.requirements)
        ? value.requirements.map(parseRequirement).filter((entry): entry is CrewTypeRequirement => entry !== null)
        : [];

    return {
        id,
        armType: asNumber(value.armType, 0),
        name: asString(value.name, ''),
        attack: asNumber(value.attack, 0),
        defence: asNumber(value.defence, 0),
        speed: asNumber(value.speed, 0),
        avoid: asNumber(value.avoid, 0),
        magicCoef: asNumber(value.magicCoef, 0),
        cost: asNumber(value.cost, 0),
        rice: asNumber(value.rice, 0),
        requirements,
        attackCoef: normalizeCoef(value.attackCoef),
        defenceCoef: normalizeCoef(value.defenceCoef),
        info: asStringArray(value.info),
        initSkillTrigger: asNullableStringArray(value.initSkillTrigger),
        phaseSkillTrigger: asNullableStringArray(value.phaseSkillTrigger),
        iActionList: asNullableStringArray(value.iActionList),
    };
};

export const parseUnitSetDefinition = (value: unknown): UnitSetDefinition => {
    const data = asRecord(value);
    const id = asString(data.id, 'unknown');
    const name = asString(data.name, id);
    const defaultCrewTypeId =
        typeof data.defaultCrewTypeId === 'number' && Number.isFinite(data.defaultCrewTypeId)
            ? data.defaultCrewTypeId
            : null;
    const armTypes = isRecord(data.armTypes)
        ? Object.entries(data.armTypes).reduce<Record<string, string>>((acc, [key, entry]) => {
              if (typeof entry === 'string') {
                  acc[key] = entry;
              }
              return acc;
          }, {})
        : undefined;
    const crewTypes = Array.isArray(data.crewTypes)
        ? data.crewTypes.map(parseCrewType).filter((entry): entry is CrewTypeDefinition => entry !== null)
        : [];

    const result: UnitSetDefinition = {
        id,
        name,
        crewTypes,
    };
    if (defaultCrewTypeId !== null) {
        result.defaultCrewTypeId = defaultCrewTypeId;
    }
    if (armTypes) {
        result.armTypes = armTypes;
    }
    if (isRecord(data.meta)) {
        result.meta = data.meta;
    }
    return result;
};

export const buildCrewTypeIndex = (unitSet: UnitSetDefinition | null | undefined): Map<number, CrewTypeDefinition> => {
    const index = new Map<number, CrewTypeDefinition>();
    for (const crewType of unitSet?.crewTypes ?? []) {
        index.set(crewType.id, crewType);
    }
    return index;
};

export const findCrewTypeById = (
    unitSet: UnitSetDefinition | null | undefined,
    crewTypeId: number
): CrewTypeDefinition | null => {
    if (!unitSet?.crewTypes) {
        return null;
    }
    return unitSet.crewTypes.find((crewType) => crewType.id === crewTypeId) ?? null;
};

export const getTechLevel = (tech: number, maxLevel = DEFAULT_MAX_TECH_LEVEL): number => {
    if (!Number.isFinite(tech)) {
        return 0;
    }
    const level = Math.floor(tech / 1000);
    return Math.max(0, Math.min(level, maxLevel));
};

export const getTechAbility = (tech: number): number => getTechLevel(tech) * 25;

export const getTechCost = (tech: number): number => 1 + getTechLevel(tech) * 0.15;

export interface CrewTypeAvailabilityContext {
    general: General;
    nation: Nation | null;
    map: MapDefinition;
    cities: City[];
    currentYear?: number;
    startYear?: number;
}

const resolveNationTech = (nation: Nation | null): number => {
    if (!nation) {
        return 0;
    }
    const tech = nation.meta.tech;
    return typeof tech === 'number' ? tech : 0;
};

const resolveNationAux = (nation: Nation | null): Record<string, unknown> => {
    if (!nation) {
        return {};
    }
    const meta = asRecord(nation.meta);
    const aux = asRecord(meta.aux);
    return Object.keys(aux).length > 0 ? aux : meta;
};

const resolveRelativeYear = (context: CrewTypeAvailabilityContext): number => {
    const { currentYear, startYear } = context;
    if (typeof currentYear === 'number' && typeof startYear === 'number') {
        return Math.max(currentYear - startYear, 0);
    }
    return 0;
};

const resolveRegionMap = (map: MapDefinition): Record<string, number> => {
    const meta = asRecord(map.meta);
    const raw = asRecord(meta.regionMap);
    const extracted: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            extracted[key] = value;
        }
    }
    return Object.keys(extracted).length > 0 ? extracted : DEFAULT_REGION_MAP;
};

const buildCityIndex = (
    map: MapDefinition
): {
    nameToId: Map<string, number>;
    regionById: Map<number, number>;
} => {
    const nameToId = new Map<string, number>();
    const regionById = new Map<number, number>();
    for (const city of map.cities) {
        nameToId.set(city.name, city.id);
        regionById.set(city.id, city.region);
    }
    return { nameToId, regionById };
};

const compareAuxValue = (actual: unknown, op: string, expected: number | string): boolean => {
    const actualNum = typeof actual === 'number' ? actual : typeof actual === 'string' ? Number(actual) : Number.NaN;
    const expectedNum =
        typeof expected === 'number' ? expected : typeof expected === 'string' ? Number(expected) : Number.NaN;

    if (!Number.isNaN(actualNum) && !Number.isNaN(expectedNum)) {
        switch (op) {
            case '==':
                return actualNum === expectedNum;
            case '!=':
                return actualNum !== expectedNum;
            case '>=':
                return actualNum >= expectedNum;
            case '<=':
                return actualNum <= expectedNum;
            case '>':
                return actualNum > expectedNum;
            case '<':
                return actualNum < expectedNum;
            default:
                return actualNum === expectedNum;
        }
    }

    if (op === '!=' || op === '==') {
        return op === '!=' ? String(actual ?? '') !== String(expected) : String(actual ?? '') === String(expected);
    }
    return false;
};

// 병종 요구 조건을 평가해 현재 상황에서 선택 가능한지 계산한다.
export const isCrewTypeAvailable = (
    unitSet: UnitSetDefinition,
    crewTypeId: number,
    context: CrewTypeAvailabilityContext
): boolean => {
    const crewType = findCrewTypeById(unitSet, crewTypeId);
    if (!crewType) {
        return false;
    }

    const nationId = context.nation?.id ?? context.general.nationId;
    const ownedCities = nationId !== undefined ? context.cities.filter((city) => city.nationId === nationId) : [];
    const ownedCityMap = new Map<number, City>();
    for (const city of ownedCities) {
        ownedCityMap.set(city.id, city);
    }

    const { nameToId, regionById } = buildCityIndex(context.map);
    const regionMap = resolveRegionMap(context.map);
    const ownedRegions = new Set<number>();
    for (const city of ownedCities) {
        const region = regionById.get(city.id);
        if (region !== undefined) {
            ownedRegions.add(region);
        }
    }

    const tech = resolveNationTech(context.nation ?? null);
    const relYear = resolveRelativeYear(context);
    const aux = resolveNationAux(context.nation ?? null);

    for (const requirement of crewType.requirements) {
        switch (requirement.type) {
            case 'ReqTech':
                if (tech < (requirement as Extract<CrewTypeRequirement, { type: 'ReqTech' }>).tech) {
                    return false;
                }
                break;
            case 'ReqRegions': {
                const req = requirement as Extract<CrewTypeRequirement, { type: 'ReqRegions' }>;
                const resolved = req.regions
                    .map((name: string) => regionMap[name])
                    .filter((id): id is number => typeof id === 'number');
                if (!resolved.some((id) => ownedRegions.has(id))) {
                    return false;
                }
                break;
            }
            case 'ReqCities': {
                const req = requirement as Extract<CrewTypeRequirement, { type: 'ReqCities' }>;
                const resolved = req.cities
                    .map((name: string) => nameToId.get(name))
                    .filter((id): id is number => typeof id === 'number');
                if (!resolved.some((id) => ownedCityMap.has(id))) {
                    return false;
                }
                break;
            }
            case 'ReqCitiesWithCityLevel': {
                const req = requirement as Extract<CrewTypeRequirement, { type: 'ReqCitiesWithCityLevel' }>;
                const resolved = req.cities
                    .map((name: string) => nameToId.get(name))
                    .filter((id): id is number => typeof id === 'number');
                if (
                    !resolved.some((id) => {
                        const city = ownedCityMap.get(id);
                        return city ? city.level >= req.level : false;
                    })
                ) {
                    return false;
                }
                break;
            }
            case 'ReqHighLevelCities': {
                const req = requirement as Extract<CrewTypeRequirement, { type: 'ReqHighLevelCities' }>;
                const count = ownedCities.filter((city) => city.level >= req.level).length;
                if (count < req.count) {
                    return false;
                }
                break;
            }
            case 'ReqNationAux': {
                const req = requirement as Extract<CrewTypeRequirement, { type: 'ReqNationAux' }>;
                const value = aux[req.key];
                if (!compareAuxValue(value, req.op, req.value)) {
                    return false;
                }
                break;
            }
            case 'ReqMinRelYear':
                if (relYear < (requirement as Extract<CrewTypeRequirement, { type: 'ReqMinRelYear' }>).year) {
                    return false;
                }
                break;
            case 'ReqChief':
                if (context.general.officerLevel <= 4) {
                    return false;
                }
                break;
            case 'ReqNotChief':
                if (context.general.officerLevel > 4) {
                    return false;
                }
                break;
            case 'Impossible':
                return false;
            default:
                return false;
        }
    }

    return true;
};
