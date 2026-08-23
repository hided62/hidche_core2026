import type {
    City,
    General,
    MapDefinition,
    Nation,
    ScenarioConfig,
    ScenarioMeta,
    ScenarioGeneralPoolCandidate,
    Troop,
    UnitSetDefinition,
    WorldSnapshot,
    GeneralLastTurn,
} from '@sammo-ts/logic';
import type { GameClockMode } from '@sammo-ts/common';

export interface TurnWorldState {
    id: number;
    currentYear: number;
    currentMonth: number;
    tickSeconds: number;
    lastTurnTime: Date;
    clockBaseTime?: Date;
    clockTick?: number;
    clockMode?: GameClockMode;
    clockWallAnchor?: Date;
    lastTurnTick?: number;
    meta: Record<string, unknown>;
}

export interface TurnGeneral extends General {
    userId?: string | null;
    startAge?: number;
    bornYear?: number;
    deadYear?: number;
    affinity?: number | null;
    picture?: string | null;
    imageServer?: number;
    turnTime: Date;
    turnTick?: number;
    recentWarTime?: Date | null;
    recentWarTick?: number | null;
    lastTurn?: GeneralLastTurn;
    penalty?: unknown;
    inheritancePoints?: Record<string, number>;
    refreshScoreTotal?: number;
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

export interface TurnGeneralPoolEntry {
    id: number;
    uniqueName: string;
    ownerUserId: string | null;
    generalId: number | null;
    reservedUntil: Date | null;
    reservedUntilTick: number | null;
    candidate: ScenarioGeneralPoolCandidate;
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

export interface NationBettingCandidate {
    title: string;
    info: string;
    isHtml: true;
    aux: {
        nation: number;
        name: string;
        color: string;
        type: string;
        level: number;
        capital: number | null;
        gennum: number;
        power: number;
        city_cnt: number;
    };
}

export interface PendingNationBettingOpen {
    id: number;
    name: string;
    selectCount: number;
    isExclusive: boolean | null;
    requiresInheritancePoint: true;
    openYearMonth: number;
    closeYearMonth: number;
    candidates: NationBettingCandidate[];
    bonusPoint: number;
}

export interface PendingNationBettingFinish {
    id: number;
    winnerNationIds: number[];
    year: number;
    month: number;
    turnTime: Date;
}

export interface PendingYearbookSnapshot {
    serverId: string;
    sourceId: number;
    year: number;
    month: number;
    map: unknown;
    nations: unknown;
}

export interface PendingUnificationFinalization {
    generationKey: string;
    serverId: string;
    profileName: string;
    winnerNationId: number;
    year: number;
    month: number;
    completedAt: Date;
    auctionCancellations: PendingUnificationAuctionCancellation[];
}

export interface PendingUnificationAuctionCancellation {
    auctionId: number;
    status: 'OPEN' | 'FINALIZING';
    closeAt: Date;
    title: string;
    highestBidId: number | null;
    bidderGeneralId: number | null;
    amount: number | null;
    rankTrackedAmount: number;
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
    generalPoolEntries?: TurnGeneralPoolEntry[];
    generals: TurnGeneral[];
    cities: City[];
    nations: Nation[];
    troops: Troop[];
}

export interface TurnWorldLoadResult {
    state: TurnWorldState;
    snapshot: TurnWorldSnapshot;
}
