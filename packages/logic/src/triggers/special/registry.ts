import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import type { WarActionContext, WarActionModule } from '@sammo-ts/logic/war/actions.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';
import type { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import type {
    SpecialActionKind,
    SpecialActionModule,
    SpecialActionModuleRegistry,
} from './types.js';

const resolveSpecialKey = (
    context: { general: { role: { specialDomestic: string | null; specialWar: string | null } } },
    kind: SpecialActionKind
): string | null =>
    kind === 'domestic'
        ? context.general.role.specialDomestic
        : context.general.role.specialWar;

const resolveModule = <
    TriggerState extends GeneralTriggerState
>(
    registry: SpecialActionModuleRegistry<TriggerState>,
    kind: SpecialActionKind,
    key: string | null
): SpecialActionModule<TriggerState> | null => {
    if (!key) {
        return null;
    }
    const bucket = kind === 'domestic' ? registry.domestic : registry.war;
    return bucket.get(key) ?? null;
};

// General 파이프라인에서 특기 모듈을 선택해 위임하는 라우터.
export class SpecialGeneralActionRouter<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> implements GeneralActionModule<TriggerState> {
    constructor(
        private readonly kind: SpecialActionKind,
        private readonly registry: SpecialActionModuleRegistry<TriggerState>
    ) {}

    private getModule(
        context: GeneralActionContext<TriggerState>
    ): SpecialActionModule<TriggerState> | null {
        const key = resolveSpecialKey(context, this.kind);
        return resolveModule(this.registry, this.kind, key);
    }

    getPreTurnExecuteTriggerList(
        context: GeneralActionContext<TriggerState>
    ) {
        const module = this.getModule(context);
        return module?.getPreTurnExecuteTriggerList?.(context) ?? null;
    }

    onCalcDomestic(
        context: GeneralActionContext<TriggerState>,
        turnType: string,
        varType: string,
        value: number,
        aux?: unknown
    ): number {
        const module = this.getModule(context);
        return module?.onCalcDomestic?.(context, turnType, varType, value, aux) ?? value;
    }

    onCalcStat(
        context: GeneralActionContext<TriggerState>,
        statName: string,
        value: number,
        aux?: unknown
    ): number {
        const module = this.getModule(context);
        return module?.onCalcStat?.(context, statName, value, aux) ?? value;
    }

    onCalcOpposeStat(
        context: GeneralActionContext<TriggerState>,
        statName: string,
        value: number,
        aux?: unknown
    ): number {
        const module = this.getModule(context);
        return (
            module?.onCalcOpposeStat?.(context, statName, value, aux) ?? value
        );
    }

    onCalcStrategic(
        context: GeneralActionContext<TriggerState>,
        turnType: string,
        varType: string,
        value: number
    ): number {
        const module = this.getModule(context);
        return module?.onCalcStrategic?.(context, turnType, varType, value) ?? value;
    }

    onCalcNationalIncome(
        context: GeneralActionContext<TriggerState>,
        type: string,
        amount: number
    ): number {
        const module = this.getModule(context);
        return module?.onCalcNationalIncome?.(context, type, amount) ?? amount;
    }

    onArbitraryAction(
        context: GeneralActionContext<TriggerState>,
        actionType: string,
        phase?: string | null,
        aux?: Record<string, unknown> | null
    ): Record<string, unknown> | null {
        const module = this.getModule(context);
        const result = module?.onArbitraryAction?.(
            context,
            actionType,
            phase,
            aux
        );
        return result === undefined ? aux ?? null : result;
    }
}

// 전투 파이프라인에서 특기 모듈을 선택해 위임하는 라우터.
export class SpecialWarActionRouter<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> implements WarActionModule<TriggerState> {
    constructor(
        private readonly kind: SpecialActionKind,
        private readonly registry: SpecialActionModuleRegistry<TriggerState>
    ) {}

    private getModule(
        context: WarActionContext<TriggerState>
    ): SpecialActionModule<TriggerState> | null {
        const key = resolveSpecialKey(context, this.kind);
        return resolveModule(this.registry, this.kind, key);
    }

    getBattleInitTriggerList(
        context: WarActionContext<TriggerState>
    ): WarTriggerCaller | null {
        const module = this.getModule(context);
        return module?.getBattleInitTriggerList?.(context) ?? null;
    }

    getBattlePhaseTriggerList(
        context: WarActionContext<TriggerState>
    ): WarTriggerCaller | null {
        const module = this.getModule(context);
        return module?.getBattlePhaseTriggerList?.(context) ?? null;
    }

    onCalcStat(
        context: WarActionContext<TriggerState>,
        statName: string,
        value: number | [number, number],
        aux?: unknown
    ): number | [number, number] {
        const module = this.getModule(context);
        return module?.onCalcStat?.(context, statName, value, aux) ?? value;
    }

    onCalcOpposeStat(
        context: WarActionContext<TriggerState>,
        statName: string,
        value: number | [number, number],
        aux?: unknown
    ): number | [number, number] {
        const module = this.getModule(context);
        return module?.onCalcOpposeStat?.(context, statName, value, aux) ?? value;
    }

    getWarPowerMultiplier(
        context: WarActionContext<TriggerState>,
        unit: WarUnit<TriggerState>,
        oppose: WarUnit<TriggerState>
    ): [number, number] {
        const module = this.getModule(context);
        return module?.getWarPowerMultiplier?.(context, unit, oppose) ?? [1, 1];
    }
}

export interface SpecialActionModuleSet<
    TriggerState extends GeneralTriggerState = GeneralTriggerState
> {
    general: GeneralActionModule<TriggerState>[];
    war: WarActionModule<TriggerState>[];
}

export const createSpecialActionModuleRegistry = <
    TriggerState extends GeneralTriggerState = GeneralTriggerState
>(options: {
    domestic?: SpecialActionModule<TriggerState>[];
    war?: SpecialActionModule<TriggerState>[];
}): SpecialActionModuleRegistry<TriggerState> => {
    const domestic = new Map<string, SpecialActionModule<TriggerState>>();
    const war = new Map<string, SpecialActionModule<TriggerState>>();

    for (const module of options.domestic ?? []) {
        domestic.set(module.key, module);
    }
    for (const module of options.war ?? []) {
        war.set(module.key, module);
    }

    return { domestic, war };
};

// 특기 레지스트리를 General/전투 파이프라인용 모듈 목록으로 변환한다.
export const createSpecialActionModules = <
    TriggerState extends GeneralTriggerState = GeneralTriggerState
>(
    registry: SpecialActionModuleRegistry<TriggerState>
): SpecialActionModuleSet<TriggerState> => ({
    general: [
        new SpecialGeneralActionRouter<TriggerState>('domestic', registry),
        new SpecialGeneralActionRouter<TriggerState>('war', registry),
    ],
    war: [
        new SpecialWarActionRouter<TriggerState>('domestic', registry),
        new SpecialWarActionRouter<TriggerState>('war', registry),
    ],
});
