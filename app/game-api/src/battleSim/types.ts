import type { UnitSetDefinition } from '@sammo-ts/logic';

import type { WarEngineConfig, WarTimeContext } from '@sammo-ts/logic';

export type BattleSimAction = 'reorder' | 'battle';

export interface BattleSimGeneralPayload {
    no: number;
    name: string;
    nation: number;
    turntime: string;
    personal: string | null;
    special2: string | null;
    crew: number;
    crewtype: number;
    atmos: number;
    train: number;
    intel: number;
    intel_exp: number;
    book: string | null;
    strength: number;
    strength_exp: number;
    weapon: string | null;
    injury: number;
    leadership: number;
    leadership_exp: number;
    horse: string | null;
    item: string | null;
    explevel: number;
    experience: number;
    dedication: number;
    officer_level: number;
    officer_city: number;
    gold: number;
    rice: number;
    dex1: number;
    dex2: number;
    dex3: number;
    dex4: number;
    dex5: number;
    recent_war: string | null;
    warnum: number;
    killnum: number;
    killcrew: number;
    inheritBuff?: Record<string, number> | number[];
}

export interface BattleSimCityPayload {
    city: number;
    nation: number;
    supply: number;
    name: string;
    pop: number;
    agri: number;
    comm: number;
    secu: number;
    def: number;
    wall: number;
    trust: number;
    level: number;
    pop_max: number;
    agri_max: number;
    comm_max: number;
    secu_max: number;
    def_max: number;
    wall_max: number;
    dead: number;
    state: number;
    conflict: string;
}

export interface BattleSimNationPayload {
    type: string;
    tech: number;
    level: number;
    capital: number;
    nation: number;
    name: string;
    gold: number;
    rice: number;
    gennum: number;
}

export interface BattleSimRequestPayload {
    action: BattleSimAction;
    seed?: string;
    repeatCnt: number;
    year: number;
    month: number;
    attackerGeneral: BattleSimGeneralPayload;
    attackerCity: BattleSimCityPayload;
    attackerNation: BattleSimNationPayload;
    defenderGenerals: BattleSimGeneralPayload[];
    defenderCity: BattleSimCityPayload;
    defenderNation: BattleSimNationPayload;
}

export interface BattleSimJobPayload extends BattleSimRequestPayload {
    unitSet: UnitSetDefinition;
    config: WarEngineConfig;
    time: WarTimeContext;
}

export interface BattleSimLogBuckets {
    generalHistoryLog: string;
    generalActionLog: string;
    generalBattleResultLog: string;
    generalBattleDetailLog: string;
    nationalHistoryLog: string;
    globalHistoryLog: string;
    globalActionLog: string;
}

export interface BattleSimResultPayload {
    result: boolean;
    reason: string;
    datetime?: string;
    lastWarLog?: BattleSimLogBuckets;
    avgWar?: number;
    phase?: number;
    killed?: number;
    maxKilled?: number;
    minKilled?: number;
    dead?: number;
    maxDead?: number;
    minDead?: number;
    attackerRice?: number;
    defenderRice?: number;
    attackerSkills?: Record<string, number>;
    defendersSkills?: Array<Record<string, number>>;
    order?: number[];
}

export interface BattleSimJob {
    jobId: string;
    requestedAt: string;
    payload: BattleSimJobPayload;
}

export interface BattleSimCompleted {
    status: 'completed';
    jobId: string;
    payload: BattleSimResultPayload;
}

export interface BattleSimQueued {
    status: 'queued';
    jobId: string;
}

export type BattleSimTransportResponse = BattleSimCompleted | BattleSimQueued;
