import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import type {
    GeneralStatBundleMap,
    GeneralStatName,
    TriggerActionPhase,
    TriggerActionType,
    TriggerDomesticActionType,
    TriggerDomesticVarType,
    TriggerNationalIncomeType,
    TriggerStrategicActionType,
    TriggerStrategicVarType,
    WarStatBundleMap,
    WarStatName,
} from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext, WarActionModule } from '@sammo-ts/logic/war/actions.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';
import type { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import type { TraitKind, TraitModule, TraitModuleRegistry } from './types.js';

const resolveTraitKey = (
    context: {
        general: {
            role: {
                personality: string | null;
                specialDomestic: string | null;
                specialWar: string | null;
            };
        };
    },
    kind: TraitKind
): string | null => {
    if (kind === 'domestic') {
        return context.general.role.specialDomestic;
    }
    if (kind === 'war') {
        return context.general.role.specialWar;
    }
    return context.general.role.personality;
};

const resolveModule = <TriggerState extends GeneralTriggerState>(
    registry: TraitModuleRegistry<TriggerState>,
    kind: TraitKind,
    key: string | null
): TraitModule<TriggerState> | null => {
    if (!key) {
        return null;
    }
    let bucket: Map<string, TraitModule<TriggerState>>;
    if (kind === 'domestic') {
        bucket = registry.domestic;
    } else if (kind === 'war') {
        bucket = registry.war;
    } else {
        bucket = registry.personality;
    }
    return bucket.get(key) ?? null;
};

// General 파이프라인에서 특성(특기/성격) 모듈을 선택해 위임하는 라우터.
export class TraitGeneralActionRouter<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionModule<TriggerState> {
    constructor(
        private readonly kind: TraitKind,
        private readonly registry: TraitModuleRegistry<TriggerState>
    ) { }

    private getModule(context: GeneralActionContext<TriggerState>): TraitModule<TriggerState> | null {
        const key = resolveTraitKey(context, this.kind);
        return resolveModule(this.registry, this.kind, key);
    }

    getPreTurnExecuteTriggerList(context: GeneralActionContext<TriggerState>) {
        const module = this.getModule(context);
        return module?.getPreTurnExecuteTriggerList?.(context) ?? null;
    }

    onCalcDomestic(
        context: GeneralActionContext<TriggerState>,
        turnType: TriggerDomesticActionType,
        varType: TriggerDomesticVarType,
        value: number,
        aux?: unknown
    ): number {
        const module = this.getModule(context);
        return module?.onCalcDomestic?.(context, turnType, varType, value, aux) ?? value;
    }

    onCalcStat<T extends GeneralStatName>(
        context: GeneralActionContext<TriggerState>,
        statName: T,
        value: GeneralStatBundleMap[T]['value'],
        aux?: GeneralStatBundleMap[T]['aux']
    ): GeneralStatBundleMap[T]['return'] {
        const module = this.getModule(context);
        const onCalcStat = module?.onCalcStat;
        if (onCalcStat) {
            return onCalcStat(context, statName, value as never, aux as never) as never;
        }
        return value;
    }

    onCalcOpposeStat<T extends GeneralStatName>(
        context: GeneralActionContext<TriggerState>,
        statName: T,
        value: GeneralStatBundleMap[T]['value'],
        aux?: GeneralStatBundleMap[T]['aux']
    ): GeneralStatBundleMap[T]['return'] {
        const module = this.getModule(context);
        const onCalcOpposeStat = module?.onCalcOpposeStat;
        if (onCalcOpposeStat) {
            return onCalcOpposeStat(context, statName, value as never, aux as never) as never;
        }
        return value;
    }

    onCalcStrategic(
        context: GeneralActionContext<TriggerState>,
        turnType: TriggerStrategicActionType,
        varType: TriggerStrategicVarType,
        value: number
    ): number {
        const module = this.getModule(context);
        return module?.onCalcStrategic?.(context, turnType, varType, value) ?? value;
    }

    onCalcNationalIncome(
        context: GeneralActionContext<TriggerState>,
        type: TriggerNationalIncomeType,
        amount: number
    ): number {
        const module = this.getModule(context);
        return module?.onCalcNationalIncome?.(context, type, amount) ?? amount;
    }

    onArbitraryAction(
        context: GeneralActionContext<TriggerState>,
        actionType: TriggerActionType,
        phase?: TriggerActionPhase | null,
        aux?: Record<string, unknown> | null
    ): Record<string, unknown> | null {
        const module = this.getModule(context);
        const result = module?.onArbitraryAction?.(context, actionType, phase, aux);
        return result === undefined ? (aux ?? null) : result;
    }
}

// 전투 파이프라인에서 특성(특기/성격) 모듈을 선택해 위임하는 라우터.
export class TraitWarActionRouter<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements WarActionModule<TriggerState> {
    constructor(
        private readonly kind: TraitKind,
        private readonly registry: TraitModuleRegistry<TriggerState>
    ) { }

    private getModule(context: WarActionContext<TriggerState>): TraitModule<TriggerState> | null {
        const key = resolveTraitKey(context, this.kind);
        return resolveModule(this.registry, this.kind, key);
    }

    getBattleInitTriggerList(context: WarActionContext<TriggerState>): WarTriggerCaller | null {
        const module = this.getModule(context);
        return module?.getBattleInitTriggerList?.(context) ?? null;
    }

    getBattlePhaseTriggerList(context: WarActionContext<TriggerState>): WarTriggerCaller | null {
        const module = this.getModule(context);
        return module?.getBattlePhaseTriggerList?.(context) ?? null;
    }

    onCalcStat<T extends WarStatName>(
        context: WarActionContext<TriggerState>,
        statName: T,
        value: WarStatBundleMap[T]['value'],
        aux?: WarStatBundleMap[T]['aux']
    ): WarStatBundleMap[T]['return'] {
        const module = this.getModule(context);
        const onCalcStat = module?.onCalcStat;
        if (onCalcStat) {
            return onCalcStat(context, statName, value as never, aux as never) as never;
        }
        return value;
    }

    onCalcOpposeStat<T extends WarStatName>(
        context: WarActionContext<TriggerState>,
        statName: T,
        value: WarStatBundleMap[T]['value'],
        aux?: WarStatBundleMap[T]['aux']
    ): WarStatBundleMap[T]['return'] {
        const module = this.getModule(context);
        const onCalcOpposeStat = module?.onCalcOpposeStat;
        if (onCalcOpposeStat) {
            return onCalcOpposeStat(context, statName, value as never, aux as never) as never;
        }
        return value;
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

export interface TraitModuleSet<TriggerState extends GeneralTriggerState = GeneralTriggerState> {
    general: GeneralActionModule<TriggerState>[];
    war: WarActionModule<TriggerState>[];
}

export const createTraitModuleRegistry = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(options: {
    domestic?: TraitModule<TriggerState>[];
    war?: TraitModule<TriggerState>[];
    personality?: TraitModule<TriggerState>[];
}): TraitModuleRegistry<TriggerState> => {
    const domestic = new Map<string, TraitModule<TriggerState>>();
    const war = new Map<string, TraitModule<TriggerState>>();
    const personality = new Map<string, TraitModule<TriggerState>>();

    for (const module of options.domestic ?? []) {
        domestic.set(module.key, module);
    }
    for (const module of options.war ?? []) {
        war.set(module.key, module);
    }
    for (const module of options.personality ?? []) {
        personality.set(module.key, module);
    }

    return { domestic, war, personality };
};

// 특성 레지스트리를 General/전투 파이프라인용 모듈 목록으로 변환한다.
export const createTraitModules = <TriggerState extends GeneralTriggerState = GeneralTriggerState>(
    registry: TraitModuleRegistry<TriggerState>
): TraitModuleSet<TriggerState> => ({
    general: [
        new TraitGeneralActionRouter<TriggerState>('domestic', registry),
        new TraitGeneralActionRouter<TriggerState>('war', registry),
        new TraitGeneralActionRouter<TriggerState>('personality', registry),
    ],
    war: [
        new TraitWarActionRouter<TriggerState>('domestic', registry),
        new TraitWarActionRouter<TriggerState>('war', registry),
        new TraitWarActionRouter<TriggerState>('personality', registry),
    ],
});
