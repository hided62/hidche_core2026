import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type {
    GeneralActionContext,
    GeneralTriggerCaller,
} from '@sammo-ts/logic/triggers/general.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';

export type ItemSlot = 'horse' | 'weapon' | 'book' | 'item';

export interface ItemModule<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> {
    key: string;
    name: string;
    rawName: string;
    info: string;
    slot: ItemSlot;
    cost: number | null;
    buyable: boolean;
    consumable: boolean;
    reqSecu: number;
    unique: boolean;

    getPreTurnExecuteTriggerList?(
        context: GeneralActionContext<TriggerState>
    ): GeneralTriggerCaller<TriggerState> | null;

    onCalcDomestic?(
        context: GeneralActionContext<TriggerState>,
        turnType: string,
        varType: string,
        value: number,
        aux?: unknown
    ): number;

    onCalcStat?: {
        (
            context: GeneralActionContext<TriggerState>,
            statName: string,
            value: number,
            aux?: unknown
        ): number;
        (
            context: WarActionContext<TriggerState>,
            statName: string,
            value: number | [number, number],
            aux?: unknown
        ): number | [number, number];
    };

    onCalcOpposeStat?: {
        (
            context: GeneralActionContext<TriggerState>,
            statName: string,
            value: number,
            aux?: unknown
        ): number;
        (
            context: WarActionContext<TriggerState>,
            statName: string,
            value: number | [number, number],
            aux?: unknown
        ): number | [number, number];
    };

    onCalcStrategic?(
        context: GeneralActionContext<TriggerState>,
        turnType: string,
        varType: string,
        value: number
    ): number;

    onCalcNationalIncome?(
        context: GeneralActionContext<TriggerState>,
        type: string,
        amount: number
    ): number;

    onArbitraryAction?(
        context: GeneralActionContext<TriggerState>,
        actionType: string,
        phase?: string | null,
        aux?: Record<string, unknown> | null
    ): Record<string, unknown> | null;

    getBattleInitTriggerList?(
        context: WarActionContext<TriggerState>
    ): WarTriggerCaller | null;

    getBattlePhaseTriggerList?(
        context: WarActionContext<TriggerState>
    ): WarTriggerCaller | null;

    getWarPowerMultiplier?(
        context: WarActionContext<TriggerState>,
        unit: WarUnit<TriggerState>,
        oppose: WarUnit<TriggerState>
    ): [number, number];
}

export interface ItemModuleExport<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> {
    itemModule: ItemModule<TriggerState>;
}
