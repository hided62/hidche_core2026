import type { GeneralTriggerState } from '../domain/entities.js';
import { type GeneralActionContext, GeneralTriggerCaller } from './general.js';

export interface GeneralActionModule<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    getName?(): string;
    getInfo?(): string;

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

    onCalcStat?(
        context: GeneralActionContext<TriggerState>,
        statName: string,
        value: number,
        aux?: unknown
    ): number;

    onCalcOpposeStat?(
        context: GeneralActionContext<TriggerState>,
        statName: string,
        value: number,
        aux?: unknown
    ): number;

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
}

export class GeneralActionPipeline<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    private readonly modules: GeneralActionModule<TriggerState>[];

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined>) {
        this.modules = modules.filter(Boolean) as GeneralActionModule<TriggerState>[];
    }

    getPreTurnExecuteTriggerList(
        context: GeneralActionContext<TriggerState>
    ): GeneralTriggerCaller<TriggerState> {
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
        turnType: string,
        varType: string,
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
        statName: string,
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
        statName: string,
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
        turnType: string,
        varType: string,
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
        type: string,
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

    onArbitraryAction(
        context: GeneralActionContext<TriggerState>,
        actionType: string,
        phase?: string | null,
        aux?: Record<string, unknown> | null
    ): Record<string, unknown> | null {
        let current = aux ?? null;
        for (const module of this.modules) {
            if (!module.onArbitraryAction) {
                continue;
            }
            const result = module.onArbitraryAction(context, actionType, phase, current);
            if (result !== undefined) {
                current = result;
            }
        }
        return current;
    }
}
