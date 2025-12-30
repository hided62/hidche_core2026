import type { RandUtil } from '@sammo-ts/common';

import type {
    City,
    General,
    GeneralTriggerState,
    Nation,
} from '../domain/entities.js';
import type { ActionLogger } from '../logging/actionLogger.js';
import type { LogEntryDraft } from '../logging/types.js';
import type { UnitSetDefinition } from '../world/types.js';
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
    castleCrewTypeId: number;
    armTypes: WarArmTypes;
}

export interface WarTimeContext {
    year: number;
    month: number;
    startYear: number;
}

export interface WarGeneralInput<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> {
    general: General<TriggerState>;
    city: City;
    nation: Nation | null;
    logger?: ActionLogger;
    modules?: Array<WarActionModule<TriggerState> | null | undefined>;
}

export interface WarBattleInput<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> {
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
}

export interface WarUnitReport {
    id: number | null;
    type: 'general' | 'city';
    name: string;
    isAttacker: boolean;
    killed: number;
    dead: number;
}

export interface WarBattleOutcome<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> {
    attacker: General<TriggerState>;
    defenders: General<TriggerState>[];
    defenderCity: City;
    logs: LogEntryDraft[];
    conquered: boolean;
    reports: WarUnitReport[];
}
