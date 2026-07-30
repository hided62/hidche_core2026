import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { GeneralActionContext, GeneralTriggerCaller } from '@sammo-ts/logic/triggers/general.js';
import type {
    GeneralStatName,
    TriggerDomesticActionType,
    TriggerDomesticVarType,
    TriggerNationalIncomeType,
    TriggerStrategicActionType,
    TriggerStrategicVarType,
    WarStatName,
} from '@sammo-ts/logic/actionModules/types.js';
import type { GeneralActionEventHandlers } from '@sammo-ts/logic/actionModules/events.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';

export type ItemSlot = 'horse' | 'weapon' | 'book' | 'item';

export interface ItemModule<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    key: string;
    name: string;
    rawName: string;
    info: string;
    slot: ItemSlot;
    cost: number | null;
    buyable: boolean;
    consumable: boolean;
    initialCharges?: number;
    consumeOnStrategySuccess?: boolean;
    reqSecu: number;
    unique: boolean;

    getPreTurnExecuteTriggerList?(
        context: GeneralActionContext<TriggerState>
    ): GeneralTriggerCaller<TriggerState> | null;

    onCalcDomestic?(
        context: GeneralActionContext<TriggerState>,
        turnType: TriggerDomesticActionType,
        varType: TriggerDomesticVarType,
        value: number,
        aux?: unknown
    ): number;

    onCalcStat?: {
        (context: GeneralActionContext<TriggerState>, statName: GeneralStatName, value: number, aux?: unknown): number;
        (
            context: WarActionContext<TriggerState>,
            statName: WarStatName,
            value: number | [number, number],
            aux?: unknown
        ): number | [number, number];
    };

    onCalcOpposeStat?: {
        (context: GeneralActionContext<TriggerState>, statName: GeneralStatName, value: number, aux?: unknown): number;
        (
            context: WarActionContext<TriggerState>,
            statName: WarStatName,
            value: number | [number, number],
            aux?: unknown
        ): number | [number, number];
    };

    onCalcStrategic?(
        context: GeneralActionContext<TriggerState>,
        turnType: TriggerStrategicActionType,
        varType: TriggerStrategicVarType,
        value: number
    ): number;

    onCalcNationalIncome?(
        context: GeneralActionContext<TriggerState>,
        type: TriggerNationalIncomeType,
        amount: number
    ): number;

    eventHandlers?: GeneralActionEventHandlers<TriggerState>;

    getBattleInitTriggerList?(context: WarActionContext<TriggerState>): WarTriggerCaller | null;

    getBattlePhaseTriggerList?(context: WarActionContext<TriggerState>): WarTriggerCaller | null;

    getWarPowerMultiplier?(
        context: WarActionContext<TriggerState>,
        unit: WarUnit<TriggerState>,
        oppose: WarUnit<TriggerState>
    ): [number, number];
}

export interface ItemModuleExport<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    itemModule: ItemModule<TriggerState>;
}
