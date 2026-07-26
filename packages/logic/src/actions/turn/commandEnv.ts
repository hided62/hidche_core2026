import type { GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import type { WarActionModule } from '@sammo-ts/logic/war/actions.js';
import type { UnitSetDefinition } from '@sammo-ts/logic/world/types.js';
import type { NationTraitModule } from '@sammo-ts/logic/triggers/special/nation/index.js';

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
    trainSideEffectByAtmosTurn?: number;
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
    npcStatTotal?: number;
    npcStatMin?: number;
    npcStatMax?: number;
    randomGeneralFirstNames?: string[];
    randomGeneralMiddleNames?: string[];
    randomGeneralLastNames?: string[];
    availablePersonalities?: string[];
    initialNationGenLimit: number;
    maxTechLevel: number;
    maxStatLevel?: number;
    maxDedicationLevel?: number;
    statUpgradeLimit?: number;
    techLevelIncYear?: number;
    initialAllowedTechLevel?: number;
    baseGold: number;
    baseRice: number;
    generalMinimumGold?: number;
    generalMinimumRice?: number;
    maxResourceActionAmount: number;
    itemCatalog?: Record<string, TurnCommandItemCatalogEntry>;
    generalActionModules?: Array<GeneralActionModule>;
    warActionModules?: Array<WarActionModule>;
    nationTraitModules?: Array<NationTraitModule>;
}
