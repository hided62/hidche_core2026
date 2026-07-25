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
    GeneralLastTurn,
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
    userId?: string | null;
    bornYear?: number;
    deadYear?: number;
    affinity?: number | null;
    turnTime: Date;
    recentWarTime?: Date | null;
    lastTurn?: GeneralLastTurn;
    penalty?: unknown;
}

export interface TurnDiplomacy {
    fromNationId: number;
    toNationId: number;
    state: number;
    term: number;
    dead: number;
    meta: Record<string, unknown>;
}

export interface TurnEvent {
    id: number;
    targetCode: string;
    priority: number;
    condition: unknown;
    action: unknown;
    meta: Record<string, unknown>;
}

export interface PendingNeutralAuction {
    registrationKey: string;
    type: 'BUY_RICE' | 'SELL_RICE';
    targetCode: string;
    hostGeneralId: 0;
    hostName: '상인';
    detail: Record<string, unknown>;
    closeAt: Date;
}

export interface TurnWorldSnapshot extends Omit<
    WorldSnapshot,
    'generals' | 'cities' | 'nations' | 'troops' | 'diplomacy'
> {
    scenarioConfig: ScenarioConfig;
    scenarioMeta?: ScenarioMeta;
    worldConfig?: Record<string, unknown>;
    map: MapDefinition;
    unitSet?: UnitSetDefinition;
    diplomacy: TurnDiplomacy[];
    events: TurnEvent[];
    initialEvents: TurnEvent[];
    generals: TurnGeneral[];
    cities: City[];
    nations: Nation[];
    troops: Troop[];
}

export interface TurnWorldLoadResult {
    state: TurnWorldState;
    snapshot: TurnWorldSnapshot;
}
