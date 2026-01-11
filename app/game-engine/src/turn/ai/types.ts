import type {
    City,
    GeneralActionDefinition,
    MapDefinition,
    Nation,
    ScenarioConfig,
    ScenarioMeta,
    Troop,
    TurnCommandEnv,
    UnitSetDefinition,
} from '@sammo-ts/logic';
import type { TurnDiplomacy, TurnGeneral, TurnWorldState } from '../types.js';
import type { ReservedTurnEntry } from '../reservedTurnStore.js';

export interface AiWorldView {
    getGeneralById(id: number): TurnGeneral | null;
    getCityById(id: number): City | null;
    getNationById(id: number): Nation | null;
    getTroopById(id: number): Troop | null;
    getDiplomacyEntry(srcNationId: number, destNationId: number): TurnDiplomacy | null;
    listGenerals(): TurnGeneral[];
    listCities(): City[];
    listNations(): Nation[];
    listTroops(): Troop[];
    listDiplomacy(): TurnDiplomacy[];
}

export interface AiStaticContext {
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

export interface AiTurnContext {
    general: TurnGeneral;
    city?: City;
    nation?: Nation | null;
    world: TurnWorldState;
    worldRef: AiWorldView | null;
    reservedTurn: ReservedTurnEntry;
}

export interface AiCommandCandidate {
    action: string;
    args: Record<string, unknown>;
    reason: string;
}

export interface AiReservedTurnProvider {
    getGeneralTurn(generalId: number, turnIdx: number): ReservedTurnEntry;
}
