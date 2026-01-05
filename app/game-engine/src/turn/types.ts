import type {
    City,
    General,
    MapDefinition,
    Nation,
    ScenarioConfig,
    ScenarioMeta,
    Troop,
    UnitSetDefinition,
    WorldSnapshot,
} from '@sammo-ts/logic';

export interface TurnWorldState {
    id: number;
    currentYear: number;
    currentMonth: number;
    tickSeconds: number;
    lastTurnTime: Date;
    meta: Record<string, unknown>;
}

export interface TurnGeneral extends General {
    turnTime: Date;
    recentWarTime?: Date | null;
}

export interface TurnDiplomacy {
    fromNationId: number;
    toNationId: number;
    state: number;
    term: number;
    dead: number;
    meta: Record<string, unknown>;
}

export interface TurnWorldSnapshot extends Omit<
    WorldSnapshot,
    'generals' | 'cities' | 'nations' | 'troops' | 'diplomacy'
> {
    scenarioConfig: ScenarioConfig;
    scenarioMeta?: ScenarioMeta;
    map: MapDefinition;
    unitSet?: UnitSetDefinition;
    diplomacy: TurnDiplomacy[];
    events: unknown[];
    initialEvents: unknown[];
    generals: TurnGeneral[];
    cities: City[];
    nations: Nation[];
    troops: Troop[];
}

export interface TurnWorldLoadResult {
    state: TurnWorldState;
    snapshot: TurnWorldSnapshot;
}
