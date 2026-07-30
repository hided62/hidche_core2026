import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import { type GeneralActionContext, GeneralTriggerCaller } from '@sammo-ts/logic/triggers/general.js';
import type {
    GeneralStatName,
    TriggerDomesticActionType,
    TriggerDomesticVarType,
    TriggerNationalIncomeType,
    TriggerStrategicActionType,
    TriggerStrategicVarType,
} from './types.js';
import {
    dispatchGeneralActionEventHandlers,
    type GeneralActionEvent,
    type GeneralActionEventContext,
    type GeneralActionEventHandlers,
    type GeneralActionEventType,
} from './events.js';

interface GeneralActionModuleBase<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    getName?: (() => string) | undefined;
    getInfo?: (() => string) | undefined;

    getPreTurnExecuteTriggerList?:
        ((context: GeneralActionContext<TriggerState>) => GeneralTriggerCaller<TriggerState> | null) | undefined;

    onCalcDomestic?:
        | ((
              context: GeneralActionContext<TriggerState>,
              turnType: TriggerDomesticActionType,
              varType: TriggerDomesticVarType,
              value: number,
              aux?: unknown
          ) => number)
        | undefined;

    onCalcStat?:
        | ((
              context: GeneralActionContext<TriggerState>,
              statName: GeneralStatName,
              value: number,
              aux?: unknown
          ) => number)
        | undefined;

    onCalcOpposeStat?:
        | ((
              context: GeneralActionContext<TriggerState>,
              statName: GeneralStatName,
              value: number,
              aux?: unknown
          ) => number)
        | undefined;

    onCalcStrategic?:
        | ((
              context: GeneralActionContext<TriggerState>,
              turnType: TriggerStrategicActionType,
              varType: TriggerStrategicVarType,
              value: number
          ) => number)
        | undefined;

    onCalcNationalIncome?:
        | ((context: GeneralActionContext<TriggerState>, type: TriggerNationalIncomeType, amount: number) => number)
        | undefined;
}

interface GeneralActionLeafModule<TriggerState extends GeneralTriggerState> {
    eventHandlers?: GeneralActionEventHandlers<TriggerState> | undefined;
    handleEvent?: never;
}

interface GeneralActionCompositeModule<TriggerState extends GeneralTriggerState> {
    eventHandlers?: never;
    handleEvent<K extends GeneralActionEventType>(
        context: GeneralActionEventContext<K, TriggerState>,
        event: GeneralActionEvent<K, TriggerState>
    ): GeneralActionEvent<K, TriggerState>;
}

/**
 * leaf handler와 합성 router는 상호 배타적입니다. 한 module이 같은 이벤트를
 * 두 경로로 중복 처리할 수 없습니다.
 */
export type GeneralActionModule<TriggerState extends GeneralTriggerState = GeneralTriggerState> =
    GeneralActionModuleBase<TriggerState> &
        (GeneralActionLeafModule<TriggerState> | GeneralActionCompositeModule<TriggerState>);

export const dispatchGeneralActionModuleEvent = <
    TriggerState extends GeneralTriggerState,
    K extends GeneralActionEventType,
>(
    module: GeneralActionModule<TriggerState>,
    context: GeneralActionEventContext<K, TriggerState>,
    event: GeneralActionEvent<K, TriggerState>
): GeneralActionEvent<K, TriggerState> =>
    module.handleEvent
        ? module.handleEvent(context, event)
        : dispatchGeneralActionEventHandlers(module.eventHandlers, context, event);

export class GeneralActionPipeline<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    private readonly modules: ReadonlyArray<GeneralActionModule<TriggerState>>;

    constructor(modules: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined>) {
        this.modules = modules.filter(Boolean) as ReadonlyArray<GeneralActionModule<TriggerState>>;
    }

    getPreTurnExecuteTriggerList(context: GeneralActionContext<TriggerState>): GeneralTriggerCaller<TriggerState> {
        const triggerCaller = new GeneralTriggerCaller<TriggerState>();

        for (const module of this.modules) {
            const triggers = module.getPreTurnExecuteTriggerList?.(context);
            if (triggers) {
                triggerCaller.merge(triggers);
            }
        }

        return triggerCaller;
    }

    onCalcDomestic(
        context: GeneralActionContext<TriggerState>,
        turnType: TriggerDomesticActionType,
        varType: TriggerDomesticVarType,
        value: number,
        aux?: unknown
    ): number {
        let current = value;
        for (const module of this.modules) {
            if (!module.onCalcDomestic) {
                continue;
            }
            current = module.onCalcDomestic(context, turnType, varType, current, aux);
        }
        return current;
    }

    onCalcStat(
        context: GeneralActionContext<TriggerState>,
        statName: GeneralStatName,
        value: number,
        aux?: unknown
    ): number {
        let current = value;
        for (const module of this.modules) {
            if (!module.onCalcStat) {
                continue;
            }
            current = module.onCalcStat(context, statName, current, aux);
        }
        return current;
    }

    onCalcOpposeStat(
        context: GeneralActionContext<TriggerState>,
        statName: GeneralStatName,
        value: number,
        aux?: unknown
    ): number {
        let current = value;
        for (const module of this.modules) {
            if (!module.onCalcOpposeStat) {
                continue;
            }
            current = module.onCalcOpposeStat(context, statName, current, aux);
        }
        return current;
    }

    onCalcStrategic(
        context: GeneralActionContext<TriggerState>,
        turnType: TriggerStrategicActionType,
        varType: TriggerStrategicVarType,
        value: number
    ): number {
        let current = value;
        for (const module of this.modules) {
            if (!module.onCalcStrategic) {
                continue;
            }
            current = module.onCalcStrategic(context, turnType, varType, current);
        }
        return current;
    }

    onCalcNationalIncome(
        context: GeneralActionContext<TriggerState>,
        type: TriggerNationalIncomeType,
        amount: number
    ): number {
        let current = amount;
        for (const module of this.modules) {
            if (!module.onCalcNationalIncome) {
                continue;
            }
            current = module.onCalcNationalIncome(context, type, current);
        }
        return current;
    }

    dispatch<K extends GeneralActionEventType>(
        context: GeneralActionEventContext<K, TriggerState>,
        event: GeneralActionEvent<K, TriggerState>
    ): GeneralActionEvent<K, TriggerState> {
        let current = event;
        for (const module of this.modules) {
            current = dispatchGeneralActionModuleEvent(module, context, current);
        }
        return current;
    }
}
