import type { City, General, Nation, StatBlock, Troop } from '@sammo-ts/logic/domain/entities.js';
import type { ScenarioConfig, ScenarioDiplomacy } from '@sammo-ts/logic/scenario/types.js';

export interface ScenarioMeta {
    title: string;
    startYear: number | null;
    life: number | null;
    fiction: number | null;
    history: string[];
    ignoreDefaultEvents: boolean;
}

export interface MapCityStats {
    population: number;
    agriculture: number;
    commerce: number;
    security: number;
    defence: number;
    wall: number;
}

export interface MapCityDefinition {
    id: number;
    name: string;
    level: number;
    region: number;
    position: {
        x: number;
        y: number;
    };
    connections: number[];
    max: MapCityStats;
    initial: MapCityStats;
    meta?: Record<string, unknown>;
}

export interface MapDefaults {
    trust: number;
    trade: number;
    supplyState: number;
    frontState: number;
}

export interface MapDefinition {
    id: string;
    name: string;
    cities: MapCityDefinition[];
    defaults?: Partial<MapDefaults>;
    meta?: Record<string, unknown>;
}

export interface UnitSetDefinition {
    id: string;
    name: string;
    defaultCrewTypeId?: number;
    armTypes?: Record<string, string>;
    crewTypes?: CrewTypeDefinition[];
    meta?: Record<string, unknown>;
}

export type CrewTypeRequirement =
    | { type: 'ReqTech'; tech: number }
    | { type: 'ReqRegions'; regions: string[] }
    | { type: 'ReqCities'; cities: string[] }
    | { type: 'ReqCitiesWithCityLevel'; level: number; cities: string[] }
    | { type: 'ReqHighLevelCities'; level: number; count: number }
    | { type: 'ReqNationAux'; key: string; op: string; value: number | string }
    | { type: 'ReqMinRelYear'; year: number }
    | { type: 'ReqChief' }
    | { type: 'ReqNotChief' }
    | { type: 'Impossible' }
    | { type: string; [key: string]: unknown };

export interface CrewTypeDefinition {
    id: number;
    armType: number;
    name: string;
    attack: number;
    defence: number;
    speed: number;
    avoid: number;
    magicCoef: number;
    cost: number;
    rice: number;
    requirements: CrewTypeRequirement[];
    attackCoef: Record<string, number>;
    defenceCoef: Record<string, number>;
    info: string[];
    initSkillTrigger: string[] | null;
    phaseSkillTrigger: string[] | null;
    iActionList: string[] | null;
}

export interface NationSeed {
    id: number;
    name: string;
    color: string;
    gold: number;
    rice: number;
    infoText: string | null;
    tech: number;
    typeCode: string;
    level: number;
    cityIds: number[];
    capitalCityId: number | null;
    meta: Record<string, unknown>;
}

export interface CitySeed {
    id: number;
    name: string;
    nationId: number;
    level: number;
    state: number;
    population: number;
    populationMax: number;
    agriculture: number;
    agricultureMax: number;
    commerce: number;
    commerceMax: number;
    security: number;
    securityMax: number;
    defence: number;
    defenceMax: number;
    wall: number;
    wallMax: number;
    supplyState: number;
    frontState: number;
    trust: number;
    trade: number;
    region: number;
    position: {
        x: number;
        y: number;
    };
    connections: number[];
    meta: Record<string, unknown>;
}

export interface GeneralSeed {
    id: number;
    name: string;
    nationId: number;
    cityId: number;
    stats: StatBlock;
    officerLevel: number;
    birthYear: number;
    deathYear: number;
    affinity: number | null;
    personality: string | null;
    special: string | null;
    specialWar: string | null;
    horse: string | null;
    weapon: string | null;
    book: string | null;
    item: string | null;
    picture: number | string | null;
    npcType: number;
    text: string | null;
    crewTypeId: number;
    meta: Record<string, unknown>;
}

export interface WorldSeedPayload {
    scenarioConfig: ScenarioConfig;
    scenarioMeta: ScenarioMeta;
    map: MapDefinition;
    unitSet?: UnitSetDefinition;
    nations: NationSeed[];
    cities: CitySeed[];
    generals: GeneralSeed[];
    troops: Troop[];
    diplomacy: ScenarioDiplomacy[];
    events: unknown[];
    initialEvents: unknown[];
}

export interface WorldSnapshot {
    scenarioConfig: ScenarioConfig;
    scenarioMeta?: ScenarioMeta;
    map: MapDefinition;
    unitSet?: UnitSetDefinition;
    nations: Nation[];
    cities: City[];
    generals: General[];
    troops: Troop[];
    diplomacy: ScenarioDiplomacy[];
    events: unknown[];
    initialEvents: unknown[];
}
