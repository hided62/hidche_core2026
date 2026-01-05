import type { GamePrisma, LogCategory, LogScope } from './gamePrisma.js';

export type JsonValue = GamePrisma.JsonValue;
export type InputJsonValue = GamePrisma.InputJsonValue;

export interface TurnEngineWorldStateRow {
    id: number;
    scenarioCode: string;
    currentYear: number;
    currentMonth: number;
    tickSeconds: number;
    config: JsonValue;
    meta: JsonValue;
    updatedAt?: Date | null;
}

export interface TurnEngineGeneralRow {
    id: number;
    name: string;
    nationId: number;
    cityId: number;
    troopId: number;
    leadership: number;
    strength: number;
    intel: number;
    experience: number;
    dedication: number;
    officerLevel: number;
    personalCode: string | null;
    specialCode: string | null;
    special2Code: string | null;
    horseCode: string | null;
    weaponCode: string | null;
    bookCode: string | null;
    itemCode: string | null;
    injury: number;
    gold: number;
    rice: number;
    crew: number;
    crewTypeId: number;
    train: number;
    atmos: number;
    age: number;
    npcState: number;
    meta: JsonValue;
    turnTime: Date;
    recentWarTime: Date | null;
}

export interface TurnEngineCityRow {
    id: number;
    name: string;
    nationId: number;
    level: number;
    population: number;
    populationMax: number;
    agriculture: number;
    agricultureMax: number;
    commerce: number;
    commerceMax: number;
    security: number;
    securityMax: number;
    supplyState: number;
    frontState: number;
    defence: number;
    defenceMax: number;
    wall: number;
    wallMax: number;
    meta: JsonValue;
    trust: number;
    trade: number;
    region: number;
}

export interface TurnEngineNationRow {
    id: number;
    name: string;
    color: string;
    capitalCityId: number | null;
    gold: number;
    rice: number;
    tech: number;
    level: number;
    typeCode: string;
    meta: JsonValue;
}

export interface TurnEngineDiplomacyRow {
    srcNationId: number;
    destNationId: number;
    stateCode: number;
    term: number;
    meta: JsonValue;
}

export interface TurnEngineTroopRow {
    troopLeaderId: number;
    nationId: number;
    name: string;
}

export interface TurnEngineEventRow {
    id: number;
    targetCode: string;
    priority: number;
    condition: JsonValue;
    action: JsonValue;
    meta: JsonValue;
}

export interface TurnEngineGeneralTurnRow {
    generalId: number;
    turnIdx: number;
    actionCode: string;
    arg: JsonValue;
}

export interface TurnEngineNationTurnRow {
    nationId: number;
    officerLevel: number;
    turnIdx: number;
    actionCode: string;
    arg: JsonValue;
}

export interface TurnEngineWorldStateUpdateInput {
    currentYear: number;
    currentMonth: number;
    tickSeconds: number;
    meta: InputJsonValue;
}

export interface TurnEngineWorldStateCreateInput {
    scenarioCode: string;
    currentYear: number;
    currentMonth: number;
    tickSeconds: number;
    config: InputJsonValue;
    meta: InputJsonValue;
}

export interface TurnEngineGeneralUpdateInput {
    name: string;
    nationId: number;
    cityId: number;
    troopId: number;
    leadership: number;
    strength: number;
    intel: number;
    experience: number;
    dedication: number;
    officerLevel: number;
    injury: number;
    gold: number;
    rice: number;
    crew: number;
    crewTypeId: number;
    train: number;
    atmos: number;
    age: number;
    npcState: number;
    horseCode: string;
    weaponCode: string;
    bookCode: string;
    itemCode: string;
    personalCode: string;
    specialCode: string;
    special2Code: string;
    meta: InputJsonValue;
    turnTime: Date;
    recentWarTime: Date | null;
}

export interface TurnEngineGeneralCreateManyInput {
    id: number;
    name: string;
    nationId: number;
    cityId: number;
    troopId?: number;
    npcState: number;
    leadership: number;
    strength: number;
    intel: number;
    experience?: number;
    dedication?: number;
    officerLevel: number;
    injury?: number;
    gold: number;
    rice: number;
    crew?: number;
    crewTypeId: number;
    train?: number;
    atmos?: number;
    age: number;
    horseCode: string;
    weaponCode: string;
    bookCode: string;
    itemCode: string;
    personalCode: string;
    specialCode: string;
    special2Code: string;
    meta: InputJsonValue;
    turnTime: Date;
    recentWarTime?: Date | null;
    affinity?: number | null;
    bornYear?: number;
    deadYear?: number;
    picture?: string | null;
    lastTurn?: InputJsonValue;
    penalty?: InputJsonValue;
}

export interface TurnEngineCityUpdateInput {
    name: string;
    nationId: number;
    level: number;
    population: number;
    populationMax: number;
    agriculture: number;
    agricultureMax: number;
    commerce: number;
    commerceMax: number;
    security: number;
    securityMax: number;
    supplyState: number;
    frontState: number;
    defence: number;
    defenceMax: number;
    wall: number;
    wallMax: number;
    meta: InputJsonValue;
    trust?: number;
    trade?: number;
    region?: number;
}

export interface TurnEngineCityCreateManyInput {
    id: number;
    name: string;
    level: number;
    nationId: number;
    supplyState: number;
    frontState: number;
    population: number;
    populationMax: number;
    agriculture: number;
    agricultureMax: number;
    commerce: number;
    commerceMax: number;
    security: number;
    securityMax: number;
    trust: number;
    trade: number;
    defence: number;
    defenceMax: number;
    wall: number;
    wallMax: number;
    region: number;
    conflict: InputJsonValue;
    meta: InputJsonValue;
}

export interface TurnEngineNationUpdateInput {
    name: string;
    color: string;
    capitalCityId: number | null;
    gold: number;
    rice: number;
    level: number;
    typeCode: string;
    meta: InputJsonValue;
}

export interface TurnEngineNationCreateManyInput {
    id: number;
    name: string;
    color: string;
    capitalCityId: number | null;
    gold: number;
    rice: number;
    tech: number;
    level: number;
    typeCode: string;
    meta: InputJsonValue;
}

export interface TurnEngineTroopUpdateInput {
    nationId: number;
    name: string;
}

export interface TurnEngineTroopCreateManyInput {
    troopLeaderId: number;
    nationId: number;
    name: string;
}

export interface TurnEngineDiplomacyCreateManyInput {
    srcNationId: number;
    destNationId: number;
    stateCode: number;
    term: number;
    meta: InputJsonValue;
}

export interface TurnEngineDiplomacyUpdateInput {
    stateCode: number;
    term: number;
    meta: InputJsonValue;
}

export interface TurnEngineEventCreateManyInput {
    targetCode: string;
    priority: number;
    condition: InputJsonValue;
    action: InputJsonValue;
    meta: InputJsonValue;
}

export interface TurnEngineLogEntryCreateManyInput {
    scope: LogScope;
    category: LogCategory;
    subType: string | null;
    year: number;
    month: number;
    text: string;
    generalId: number | null;
    nationId: number | null;
    userId: number | null;
    meta: InputJsonValue;
    createdAt?: Date;
}

export interface TurnEngineDatabaseClient {
    worldState: {
        findFirst(args?: unknown): Promise<TurnEngineWorldStateRow | null>;
        update(args: { where: { id: number }; data: TurnEngineWorldStateUpdateInput }): Promise<unknown>;
        create(args: { data: TurnEngineWorldStateCreateInput }): Promise<unknown>;
        deleteMany(args?: unknown): Promise<unknown>;
    };
    general: {
        findMany(args?: unknown): Promise<TurnEngineGeneralRow[]>;
        createMany(args: { data: TurnEngineGeneralCreateManyInput[] }): Promise<unknown>;
        update(args: { where: { id: number }; data: TurnEngineGeneralUpdateInput }): Promise<unknown>;
        deleteMany(args?: unknown): Promise<unknown>;
    };
    city: {
        findMany(args?: unknown): Promise<TurnEngineCityRow[]>;
        createMany(args: { data: TurnEngineCityCreateManyInput[] }): Promise<unknown>;
        update(args: { where: { id: number }; data: TurnEngineCityUpdateInput }): Promise<unknown>;
        deleteMany(args?: unknown): Promise<unknown>;
    };
    nation: {
        findMany(args?: unknown): Promise<TurnEngineNationRow[]>;
        createMany(args: { data: TurnEngineNationCreateManyInput[] }): Promise<unknown>;
        update(args: { where: { id: number }; data: TurnEngineNationUpdateInput }): Promise<unknown>;
        deleteMany(args?: unknown): Promise<unknown>;
    };
    diplomacy: {
        findMany(args?: unknown): Promise<TurnEngineDiplomacyRow[]>;
        createMany(args: { data: TurnEngineDiplomacyCreateManyInput[] }): Promise<unknown>;
        update(args: {
            where: {
                srcNationId_destNationId: {
                    srcNationId: number;
                    destNationId: number;
                };
            };
            data: TurnEngineDiplomacyUpdateInput;
        }): Promise<unknown>;
        deleteMany(args?: unknown): Promise<unknown>;
    };
    troop: {
        findMany(args?: unknown): Promise<TurnEngineTroopRow[]>;
        createMany(args: { data: TurnEngineTroopCreateManyInput[] }): Promise<unknown>;
        update(args: { where: { troopLeaderId: number }; data: TurnEngineTroopUpdateInput }): Promise<unknown>;
        deleteMany(args?: unknown): Promise<unknown>;
    };
    event: {
        findMany(args?: unknown): Promise<TurnEngineEventRow[]>;
        createMany(args: { data: TurnEngineEventCreateManyInput[] }): Promise<unknown>;
        deleteMany(args?: unknown): Promise<unknown>;
    };
    logEntry: {
        createMany(args: { data: TurnEngineLogEntryCreateManyInput[] }): Promise<unknown>;
    };
    generalTurn: {
        findMany(args?: unknown): Promise<TurnEngineGeneralTurnRow[]>;
        deleteMany(args?: unknown): Promise<unknown>;
        createMany(args?: unknown): Promise<unknown>;
    };
    nationTurn: {
        findMany(args?: unknown): Promise<TurnEngineNationTurnRow[]>;
        deleteMany(args?: unknown): Promise<unknown>;
        createMany(args?: unknown): Promise<unknown>;
    };
}
