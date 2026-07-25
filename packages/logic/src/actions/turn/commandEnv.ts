import type { GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import type { WarActionModule } from '@sammo-ts/logic/war/actions.js';
import type { UnitSetDefinition } from '@sammo-ts/logic/world/types.js';

export interface TurnCommandItemCatalogEntry {
    slot: 'horse' | 'weapon' | 'book' | 'item';
    name: string;
    rawName: string;
    cost: number | null;
    reqSecu: number;
    buyable: boolean;
    unique: boolean;
    initialCharges?: number;
}

export interface TurnCommandEnv {
    unitSet?: UnitSetDefinition;
    develCost: number;
    minAvailableRecruitPop?: number;
    trainDelta: number;
    atmosDelta: number;
    maxTrainByCommand: number;
    maxAtmosByCommand: number;
    sabotageDefaultProb: number;
    sabotageProbCoefByStat: number;
    sabotageDefenceCoefByGeneralCount: number;
    sabotageDamageMin: number;
    sabotageDamageMax: number;
    openingPartYear: number;
    maxGeneral: number;
    defaultNpcGold: number;
    defaultNpcRice: number;
    defaultCrewTypeId: number;
    defaultSpecialDomestic: string | null;
    defaultSpecialWar: string | null;
    initialNationGenLimit: number;
    maxTechLevel: number;
    baseGold: number;
    baseRice: number;
    maxResourceActionAmount: number;
    itemCatalog?: Record<string, TurnCommandItemCatalogEntry>;
    generalActionModules?: Array<GeneralActionModule>;
    warActionModules?: Array<WarActionModule>;
}
