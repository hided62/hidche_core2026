import type { RandUtil } from '@sammo-ts/common';

import type { City, General, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { GeneralActionModule } from '@sammo-ts/logic/actionModules/general.js';
import type { ActionLogger } from '@sammo-ts/logic/logging/actionLogger.js';
import type { LogEntryDraft } from '@sammo-ts/logic/logging/types.js';
import type { TracePort } from '@sammo-ts/logic/ports/trace.js';
import type { UnitSetDefinition } from '@sammo-ts/logic/world/types.js';
import type { WarActionModule } from './actions.js';
import type { WarTriggerRegistry } from './triggers.js';

export interface WarArmTypes {
    footman?: number;
    archer?: number;
    cavalry?: number;
    wizard?: number;
    siege?: number;
    misc?: number;
    castle?: number;
}

export interface WarEngineConfig {
    armPerPhase: number;
    maxTrainByCommand: number;
    maxAtmosByCommand: number;
    maxTrainByWar: number;
    maxAtmosByWar: number;
    maxGeneralStat?: number;
    statUpgradeLimit?: number;
    castleCrewTypeId: number;
    armTypes: WarArmTypes;
}

export interface WarTimeContext {
    year: number;
    month: number;
    startYear: number;
}

export interface WarGeneralInput<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    general: General<TriggerState>;
    city: City;
    nation: Nation | null;
    logger?: ActionLogger;
    modules?: ReadonlyArray<WarActionModule<TriggerState> | null | undefined>;
}

export interface WarBattleInput<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    seed?: string;
    rng?: RandUtil;
    unitSet: UnitSetDefinition;
    config: WarEngineConfig;
    time: WarTimeContext;
    attacker: WarGeneralInput<TriggerState>;
    defenders: WarGeneralInput<TriggerState>[];
    defenderCity: City;
    defenderNation: Nation | null;
    triggerRegistry?: WarTriggerRegistry;
    loggerFactory?: (options: { generalId?: number; nationId?: number }) => ActionLogger;
    trace?: (event: WarBattleTraceEvent) => void;
}

export interface WarBattleTraceUnitSnapshot {
    kind: 'general' | 'city';
    id: number;
    name: string;
    isAttacker: boolean;
    crewTypeId: number;
    phase: number;
    realPhase: number;
    maxPhase: number;
    hp: number;
    rawWarPower: number;
    warPower: number;
    warPowerMultiplier: number;
    killed: number;
    dead: number;
    activatedSkills: Record<string, number>;
    general?: {
        crew: number;
        rice: number;
        train: number;
        atmos: number;
        injury: number;
        experience: number;
        dedication: number;
        dex1: number;
        dex2: number;
        dex3: number;
        dex4: number;
        dex5: number;
    };
    cityState?: {
        defence: number;
        wall: number;
        population: number;
    };
}

export interface WarBattleTraceEvent {
    seq: number;
    event: string;
    attacker: WarBattleTraceUnitSnapshot;
    defender: WarBattleTraceUnitSnapshot | null;
    city: WarBattleTraceUnitSnapshot;
    details: Record<string, unknown>;
}

export interface WarUnitReport {
    id: number | null;
    type: 'general' | 'city';
    name: string;
    isAttacker: boolean;
    killed: number;
    dead: number;
    /** Number of battle phases consumed by this unit. */
    phase?: number;
}

export interface WarBattleMetrics {
    attackerPhase: number;
    attackerActivatedSkills: Record<string, number>;
    defenderActivatedSkills: Array<Record<string, number>>;
}

export interface WarBattleOutcome<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    attacker: General<TriggerState>;
    defenders: General<TriggerState>[];
    defenderCity: City;
    logs: LogEntryDraft[];
    conquered: boolean;
    reports: WarUnitReport[];
    metrics?: WarBattleMetrics;
}

export interface WarAftermathConfig {
    initialNationGenLimit: number;
    techLevelIncYear: number;
    initialAllowedTechLevel: number;
    maxTechLevel: number;
    defaultCityWall: number;
    baseGold: number;
    baseRice: number;
    castleCrewTypeId: number;
    /** Legacy admin join mode. Ruined-nation scout/join draws are skipped in onlyRandom mode. */
    joinMode?: 'full' | 'onlyRandom';
    /** Probability that an eligible ruined NPC reserves a future appointment. */
    joinRuinedNpcProbability?: number;
}

export interface RuinedNpcJoinPlan {
    generalId: number;
    destNationId: number;
    joinTurn: number;
}

export interface WarAftermathTechContext {
    side: 'attacker' | 'defender';
    nation: Nation;
    attackerReport: WarUnitReport;
    baseGain: number;
}

export interface WarDiplomacyDelta {
    fromNationId: number;
    toNationId: number;
    deadDelta: number;
}

export interface ConquerCityOutcome<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    conquerNationId: number;
    nationCollapsed: boolean;
    collapseRewardGold: number;
    collapseRewardRice: number;
    logs: LogEntryDraft[];
    nations: Nation[];
    cities: City[];
    generals: General<TriggerState>[];
    ruinedNpcJoinPlans: RuinedNpcJoinPlan[];
}

export interface WarAftermathInput<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    battle: WarBattleOutcome<TriggerState>;
    attackerNation: Nation;
    defenderNation: Nation | null;
    attackerCity: City;
    defenderCity: City;
    nations: Nation[];
    cities: City[];
    generals: General<TriggerState>[];
    unitSet: UnitSetDefinition;
    config: WarAftermathConfig;
    time: WarTimeContext;
    hiddenSeed?: string;
    rng?: RandUtil;
    generalActionModules?: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined>;
    calcNationTechGain?: (context: WarAftermathTechContext) => number;
    trace?: TracePort;
}

export interface WarAftermathOutcome<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    nations: Nation[];
    cities: City[];
    generals: General<TriggerState>[];
    diplomacyDeltas: WarDiplomacyDelta[];
    logs: LogEntryDraft[];
    conquered: boolean;
    conquest?: ConquerCityOutcome<TriggerState>;
}
