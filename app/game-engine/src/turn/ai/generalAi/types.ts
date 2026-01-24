import type {
    City,
    GeneralActionDefinition,
    MapDefinition,
    Nation,
    ScenarioConfig,
    ScenarioMeta,
    TurnCommandEnv,
    UnitSetDefinition,
} from '@sammo-ts/logic';

import type { ReservedTurnEntry } from '../../reservedTurnStore.js';
import type { TurnGeneral, TurnWorldState } from '../../types.js';
import type { AiReservedTurnProvider, AiWorldView } from '../types.js';

export interface GeneralAIOptions {
    general: TurnGeneral;
    city?: City;
    nation?: Nation | null;
    world: TurnWorldState;
    worldRef: AiWorldView | null;
    reservedTurnProvider: AiReservedTurnProvider;
    scenarioConfig: ScenarioConfig;
    scenarioMeta?: ScenarioMeta;
    map?: MapDefinition;
    unitSet?: UnitSetDefinition;
    commandEnv: TurnCommandEnv;
    generalDefinitions: Map<string, GeneralActionDefinition>;
    nationDefinitions: Map<string, GeneralActionDefinition>;
    generalFallback: GeneralActionDefinition;
    nationFallback: GeneralActionDefinition;
}

export type GeneralAiDebugState = {
    generalId: number;
    nationId: number | null;
    cityId: number | null;
    yearMonth: number;
    startYear: number;
    startYearMonth: number;
    dipState: number;
    attackable: boolean;
    warTargetNation: Record<number, number>;
    genType: number;
    lastAttackable: number;
    frontCities: Array<{ id: number; frontState: number; supplyState: number }>;
    supplyCities: Array<{ id: number; frontState: number; supplyState: number }>;
    policy: {
        minAvailableRecruitPop: number;
        minNpcWarLeadership: number;
        minWarCrew: number;
        cureThreshold: number;
    };
};

export type { ReservedTurnEntry };
