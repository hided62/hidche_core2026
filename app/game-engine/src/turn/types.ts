import type {
    City,
    General,
    MapDefinition,
    Nation,
    ScenarioConfig,
    ScenarioDiplomacy,
    ScenarioMeta,
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

export interface TurnWorldSnapshot
    extends Omit<WorldSnapshot, 'generals' | 'cities' | 'nations'> {
    scenarioConfig: ScenarioConfig;
    scenarioMeta?: ScenarioMeta;
    map: MapDefinition;
    unitSet?: UnitSetDefinition;
    diplomacy: ScenarioDiplomacy[];
    events: unknown[];
    initialEvents: unknown[];
    generals: TurnGeneral[];
    cities: City[];
    nations: Nation[];
}

export interface TurnWorldLoadResult {
    state: TurnWorldState;
    snapshot: TurnWorldSnapshot;
}
