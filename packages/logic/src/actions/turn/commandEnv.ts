import type { GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import type { WarActionModule } from '@sammo-ts/logic/war/actions.js';

export interface TurnCommandEnv {
    develCost: number;
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
    generalActionModules?: Array<GeneralActionModule>;
    warActionModules?: Array<WarActionModule>;
}
